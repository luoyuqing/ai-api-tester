import type { CallOptions, ChatInput, ScoringMode } from '@/types';
import type { ProviderAdapter } from '@/engine/adapters/ProviderAdapter';
import { clamp } from '@/constants/scoring';
import { truncateSnippet } from '@/lib/http';
import { parseJsonLoose } from '@/engine/scorers/classify';
import { RuleScorer } from '@/engine/scorers/RuleScorer';
import type { ScoreInput, ScoreOutput, Scorer } from '@/engine/scorers/Scorer';

/**
 * LLM-as-judge scorer.
 *
 * The judge is a normal Provider driven through the same adapter stack, so it
 * inherits transport, retry and timeout behaviour. Two hard rules:
 *  1. the judge is always asked for STRICT JSON (`{"score":…,"reason":…}`);
 *  2. any judge failure degrades to the deterministic rule scorer instead of
 *     poisoning the report with a fabricated number (architecture §7.4).
 */

/** Judge replies are tiny; a large budget only wastes tokens. */
const JUDGE_MAX_TOKENS = 400;

/** The evaluated reply is truncated before it is shown to the judge. */
const JUDGE_MAX_RESPONSE_CHARS = 4000;

/** Prompt excerpt length — enough context without blowing up the judge cost. */
const JUDGE_MAX_PROMPT_CHARS = 1500;

const JUDGE_SYSTEM_PROMPT: string = [
  '你是一名严格、客观的模型输出评审员。',
  '你会看到一次对话请求、被评模型的回答，以及本题的评分细则。',
  '只依据评分细则打分，不要被回答的语气、篇幅或自我评价影响。',
  '必须只输出一个 JSON 对象，不要 Markdown 代码块，不要任何解释性文字。',
  'JSON 结构固定为：{"score": 0-100 的整数, "reason": "不超过 80 字的中文理由"}',
].join('\n');

const DEFAULT_RUBRIC: string = [
  '本题没有专门细则，按以下通用标准打分：',
  '- 是否严格遵守用户的显式指令（格式、字数、语言、禁止项）；',
  '- 是否正确理解上下文与指代；',
  '- 内容是否准确、具体、无幻觉。',
  '完全满足=90-100；基本满足但有瑕疵=70-89；部分满足=40-69；跑题或违反指令=0-39。',
].join('\n');

export interface JudgeVerdict {
  /** 0-100 */
  score: number;
  reason: string;
}

/** Assemble the judge conversation. Exported so it can be unit-tested. */
export function buildJudgeMessages(input: ScoreInput): ChatInput {
  const rubric = input.rubric && input.rubric.trim().length > 0 ? input.rubric.trim() : DEFAULT_RUBRIC;
  const expectationLines: string[] = [];
  const exp = input.expectation;
  if (exp) {
    if (exp.mustInclude?.length) expectationLines.push(`必须包含：${exp.mustInclude.join('、')}`);
    if (exp.mustNotInclude?.length) expectationLines.push(`不得包含：${exp.mustNotInclude.join('、')}`);
    if (exp.regex) expectationLines.push(`需匹配正则：/${exp.regex}/i`);
    if (exp.mustBeJson) expectationLines.push('回答必须是可直接解析的 JSON');
    if (typeof exp.maxWords === 'number') expectationLines.push(`字数上限：${exp.maxWords}`);
    if (typeof exp.minWords === 'number') expectationLines.push(`字数下限：${exp.minWords}`);
    if (exp.language) expectationLines.push(`语言要求：${exp.language}`);
  }

  const userContent = [
    `【用例编号】${input.caseId}`,
    `【用户请求】\n${truncateSnippet(input.prompt, JUDGE_MAX_PROMPT_CHARS)}`,
    `【被评回答】\n${truncateSnippet(input.response, JUDGE_MAX_RESPONSE_CHARS)}`,
    expectationLines.length > 0 ? `【硬性约束】\n${expectationLines.join('\n')}` : '',
    `【评分细则】\n${rubric}`,
    '现在只输出评分 JSON。',
  ]
    .filter((s) => s.length > 0)
    .join('\n\n');

  return {
    messages: [
      { role: 'system', content: JUDGE_SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    temperature: 0,
    maxTokens: JUDGE_MAX_TOKENS,
    responseFormatJson: true,
  };
}

/** Tolerant verdict parser: accepts fenced JSON and surrounding prose. */
export function parseJudgeVerdict(text: string): JudgeVerdict | null {
  const parsed = parseJsonLoose(text);
  if (parsed === undefined || parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const rawScore = obj.score ?? obj.rating ?? obj.points ?? obj.point;
  const numeric =
    typeof rawScore === 'number'
      ? rawScore
      : typeof rawScore === 'string'
        ? Number.parseFloat(rawScore)
        : Number.NaN;
  if (!Number.isFinite(numeric)) return null;
  const reasonRaw =
    typeof obj.reason === 'string'
      ? obj.reason
      : typeof obj.explanation === 'string'
        ? obj.explanation
        : typeof obj.comment === 'string'
          ? obj.comment
          : '';
  return { score: clamp(numeric, 0, 100), reason: reasonRaw.trim() };
}

export interface LlmJudgeDeps {
  /** Adapter bound to the judge provider. */
  adapter: ProviderAdapter;
  /** Used whenever the judge cannot deliver a usable verdict. */
  fallback?: Scorer;
  /** Overrides the per-call timeout; defaults to the evaluated case timeout. */
  timeoutMs?: number;
}

export class LlmJudgeScorer implements Scorer {
  public readonly mode: ScoringMode = 'llm-judge';

  private readonly adapter: ProviderAdapter;

  private readonly fallback: Scorer;

  private readonly timeoutMs?: number;

  public constructor(deps: LlmJudgeDeps) {
    this.adapter = deps.adapter;
    this.fallback = deps.fallback ?? new RuleScorer();
    this.timeoutMs = deps.timeoutMs;
  }

  public async score(input: ScoreInput): Promise<ScoreOutput> {
    // A failed request has nothing to judge — the rule scorer already knows
    // how to express "the call itself did not succeed".
    if (!input.ok) {
      return this.degrade(input, '请求失败，跳过裁判模型');
    }

    const opt: CallOptions = {
      timeoutMs: this.timeoutMs ?? input.timeoutMs,
      signal: input.signal,
      stream: false,
      // The judge is an auxiliary call: never spend the retry budget on it.
      maxRetries: 0,
      temperature: 0,
    };

    try {
      const outcome = await this.adapter.chat(buildJudgeMessages(input), opt);
      if (!outcome.ok) {
        return this.degrade(input, `裁判模型调用失败：${outcome.errorMessage ?? outcome.errorCategory}`);
      }
      const verdict = parseJudgeVerdict(outcome.text);
      if (!verdict) {
        return this.degrade(
          input,
          `裁判模型未返回可解析的评分 JSON：${truncateSnippet(outcome.text, 160)}`,
        );
      }
      const evidence = [
        `⚖ 裁判评分 ${verdict.score.toFixed(0)}`,
        verdict.reason.length > 0 ? `理由：${verdict.reason}` : '理由：（裁判未给出）',
      ];
      return { score: verdict.score, evidence, mode: this.mode };
    } catch (err) {
      return this.degrade(input, `裁判模型异常：${(err as Error).message}`);
    }
  }

  /** Fall back to the rule scorer and make the degradation visible. */
  private async degrade(input: ScoreInput, why: string): Promise<ScoreOutput> {
    const base = await this.fallback.score(input);
    return {
      score: base.score,
      evidence: [`⚠ ${why} → 已降级为规则判分`, ...base.evidence],
      mode: base.mode,
    };
  }
}

export default LlmJudgeScorer;
