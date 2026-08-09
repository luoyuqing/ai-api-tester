import type { CaseKind, Dimension, ProbeResult, RequestSample, ScoringMode } from '@/types';
import { round1 } from '@/constants/scoring';
import { isCancellation } from '@/engine/errors';
import {
  BaseProbe,
  categoryMetrics,
  lastUserPrompt,
  sampleOf,
  turnsOf,
  type ProbePlanContext,
  type ProbeRunContext,
} from '@/engine/probes/Probe';

export const CHAT_METRIC_KEYS = {
  CASES: 'caseCount',
  SCORED: 'scoredCases',
  FAILED: 'failedCases',
  AVERAGE: 'weightedScore',
  MODE: 'scoringMode',
} as const;

/** Max output length for a quality case — the rubrics never need more. */
const CHAT_MAX_TOKENS = 800;

/**
 * FUNC-01 — multi-turn coherence and instruction following.
 *
 * Every case is replayed as a full conversation (the recorded assistant turns
 * are sent back verbatim, so the model is judged on the *same* history rather
 * than on its own previous answer). Scoring is delegated to the configured
 * Scorer, which is why this probe works unchanged for rule / llm-judge / hybrid.
 */
export class ChatQualityProbe extends BaseProbe {
  public readonly id = 'probe.func.chat';

  public readonly caseKind: CaseKind = 'func.chat';

  public readonly dimension: Dimension = 'functionality';

  public estimateUnits(plan: ProbePlanContext): number {
    // An LLM judge doubles the request count (one answer + one verdict).
    const perCase = plan.config.scoring.mode === 'rule' ? 1 : 2;
    return plan.cases.length * perCase;
  }

  public async run(ctx: ProbeRunContext): Promise<ProbeResult> {
    const startedAt = Date.now();
    const cases = ctx.cases;
    if (cases.length === 0) {
      return this.skipped(ctx, startedAt, '所选用例集中没有 func.chat 用例');
    }

    const samples: RequestSample[] = [];
    const evidence: string[] = [];
    const perCaseMetrics: Record<string, number | string | null> = {};
    let weightSum = 0;
    let scoreSum = 0;
    let scoredCases = 0;
    let failedCases = 0;
    let scoringMode: ScoringMode = ctx.scorer.mode;

    for (const testCase of cases) {
      await ctx.gate();
      const weight = testCase.weight > 0 ? testCase.weight : 1;
      try {
        const outcome = await ctx.adapter.chat(
          { messages: turnsOf(testCase), maxTokens: CHAT_MAX_TOKENS, temperature: 0 },
          this.callOptions(ctx, { stream: false }),
        );
        samples.push(sampleOf(outcome));
        ctx.tick();

        if (!outcome.ok) failedCases += 1;

        await ctx.gate();
        const scored = await ctx.scorer.score({
          caseId: testCase.id,
          kind: this.caseKind,
          prompt: lastUserPrompt(testCase),
          response: outcome.ok ? outcome.text : (outcome.errorMessage ?? ''),
          expectation: testCase.expectation,
          rubric: testCase.judgeRubric,
          ok: outcome.ok,
          errorCategory: outcome.errorCategory,
          signal: ctx.signal,
          timeoutMs: ctx.config.timeoutMs,
        });
        if (ctx.scorer.mode !== 'rule') ctx.tick();
        scoringMode = scored.mode;

        weightSum += weight;
        scoreSum += weight * scored.score;
        scoredCases += 1;
        perCaseMetrics[`case.${testCase.id}.score`] = scored.score;

        evidence.push(`【${testCase.title}】得分 ${scored.score}（权重 ${weight}）`);
        scored.evidence.slice(0, 6).forEach((line) => evidence.push(`  ${line}`));
        if (outcome.ok) {
          evidence.push(`  响应摘要：${this.snippet(outcome.text, 300)}`);
        } else {
          evidence.push(`  请求失败：${outcome.errorMessage ?? '未知错误'}`);
        }

        ctx.log(
          outcome.ok ? (scored.score >= 60 ? 'info' : 'warn') : 'error',
          `${testCase.title} 判分 ${scored.score}${outcome.ok ? '' : `（请求失败：${outcome.errorCategory}）`}`,
        );
      } catch (err) {
        if (isCancellation(err)) throw err;
        failedCases += 1;
        weightSum += weight;
        scoredCases += 1;
        perCaseMetrics[`case.${testCase.id}.score`] = 0;
        evidence.push(`【${testCase.title}】执行异常：${(err as Error).message}，计 0 分`);
        ctx.log('error', `${testCase.title} 执行异常：${(err as Error).message}`);
        ctx.tick();
      }
    }

    if (scoredCases === 0 || weightSum <= 0) {
      return this.compose(ctx, startedAt, {
        status: 'error',
        samples,
        metrics: {
          [CHAT_METRIC_KEYS.CASES]: cases.length,
          [CHAT_METRIC_KEYS.SCORED]: 0,
          [CHAT_METRIC_KEYS.FAILED]: failedCases,
          ...categoryMetrics(samples),
        },
        evidence,
        errorMessage: '所有聊天质量用例均未能完成判分',
      });
    }

    const average = round1(scoreSum / weightSum);

    return this.compose(ctx, startedAt, {
      status: 'pass',
      samples,
      metrics: {
        [CHAT_METRIC_KEYS.CASES]: cases.length,
        [CHAT_METRIC_KEYS.SCORED]: scoredCases,
        [CHAT_METRIC_KEYS.FAILED]: failedCases,
        [CHAT_METRIC_KEYS.AVERAGE]: average,
        [CHAT_METRIC_KEYS.MODE]: scoringMode,
        ...perCaseMetrics,
        ...categoryMetrics(samples),
      },
      rawScore: average,
      scoringMode,
      evidence,
    });
  }
}

export default ChatQualityProbe;
