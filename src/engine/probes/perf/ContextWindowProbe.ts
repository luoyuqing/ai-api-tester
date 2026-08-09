import type {
  CaseKind,
  ChatTurn,
  Dimension,
  ErrorCategory,
  ProbeResult,
  RequestSample,
  TestCase,
} from '@/types';
import { formatPercent, formatTokens } from '@/lib/timer';
import { ERROR_CATEGORY } from '@/constants/errorCodes';
import {
  CHARS_PER_TOKEN_APPROX,
  DEFAULT_CONTEXT_LADDER,
  DEFAULT_CONTEXT_REFINE_ROUNDS,
} from '@/constants/defaults';
import { isCancellation } from '@/engine/errors';
import {
  BaseProbe,
  categoryMetrics,
  sampleOf,
  type ProbePlanContext,
  type ProbeRunContext,
} from '@/engine/probes/Probe';

export const CONTEXT_METRIC_KEYS = {
  MAX_TOKENS: 'maxContextTokens',
  LADDER_MAX_TRIED: 'ladderMaxTried',
  RECALL_RATE: 'needleRecallRate',
  RECALL_HITS: 'needleRecallHits',
  RECALL_TRIALS: 'needleRecallTrials',
  PROBED_ROUNDS: 'probedRounds',
  REFINE_ROUNDS: 'refineRounds',
  UPPER_BOUND_REASON: 'upperBoundReason',
  INCONCLUSIVE: 'inconclusive',
} as const;

/** Error categories that legitimately mark the upper bound of the window. */
const BOUNDARY_CATEGORIES: readonly ErrorCategory[] = [
  ERROR_CATEGORY.CONTEXT_EXCEEDED,
  ERROR_CATEGORY.BAD_REQUEST,
];

/** English filler keeps ~4 characters per token, matching CHARS_PER_TOKEN_APPROX. */
const FILLER_SENTENCE =
  'The quarterly infrastructure review recorded steady throughput across all regional clusters, ' +
  'with capacity planning notes archived for later reference by the platform reliability group. ';

/** Deterministic-looking but per-run unique needle so caching cannot fake a hit. */
function makeNeedleCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `AC-${code}`;
}

/** Build a haystack of approximately `targetTokens` tokens with the needle in the middle. */
export function buildHaystack(targetTokens: number, needleCode: string): string {
  const targetChars = Math.max(200, Math.floor(targetTokens * CHARS_PER_TOKEN_APPROX));
  const needle = `\n【重要】审计凭证编号（audit voucher number）是 ${needleCode}，请牢记该编号。\n`;
  const fillerChars = Math.max(100, targetChars - needle.length);
  const repeats = Math.ceil(fillerChars / FILLER_SENTENCE.length);
  const filler = FILLER_SENTENCE.repeat(repeats).slice(0, fillerChars);
  const half = Math.floor(filler.length / 2);
  return `${filler.slice(0, half)}${needle}${filler.slice(half)}`;
}

/** Outcome of one ladder/binary probe at a given token size. */
interface RungResult {
  tokens: number;
  ok: boolean;
  recalled: boolean;
  category: ErrorCategory;
  message?: string;
}

/**
 * PERF-03 — usable context window, measured with a needle-in-a-haystack ladder.
 *
 * Two-stage strategy (architecture D3):
 *  1. coarse ascending ladder scan until the first failure
 *  2. binary refinement inside `[lastOk, firstFail]` for `contextRefineRounds`
 *
 * Every successful rung additionally verifies whether the buried audit code can
 * be recalled, producing the long-context quality score that is blended into
 * `perf.context` (70% size / 30% recall, see aggregate/normalize.ts).
 */
export class ContextWindowProbe extends BaseProbe {
  public readonly id = 'probe.perf.context';

  public readonly caseKind: CaseKind = 'perf.context';

  public readonly dimension: Dimension = 'performance';

  public estimateUnits(plan: ProbePlanContext): number {
    return this.ladder(plan).length + this.refineRounds(plan);
  }

  public async run(ctx: ProbeRunContext): Promise<ProbeResult> {
    const startedAt = Date.now();
    const testCase = ctx.cases[0];
    if (!testCase) {
      return this.skipped(ctx, startedAt, '所选用例集中没有 perf.context 用例');
    }

    const ladder = this.ladder(ctx);
    if (ladder.length === 0) {
      return this.skipped(ctx, startedAt, '上下文阶梯为空，无法进行窗口探测');
    }

    const needleCode = makeNeedleCode();
    const samples: RequestSample[] = [];
    const rungs: RungResult[] = [];
    const evidence: string[] = [`埋点凭证编号：${needleCode}`];

    let lastOk = 0;
    let firstFail = 0;
    let boundaryReason = '未触达上界（阶梯已跑满）';
    let inconclusive = false;

    // ── stage 1: coarse ladder scan ──
    for (const tokens of ladder) {
      await ctx.gate();
      const rung = await this.probeAt(ctx, testCase, tokens, needleCode, samples);
      rungs.push(rung);
      evidence.push(this.describeRung(rung));

      if (rung.ok) {
        lastOk = tokens;
        continue;
      }
      firstFail = tokens;
      if (BOUNDARY_CATEGORIES.includes(rung.category)) {
        boundaryReason = `在 ${formatTokens(tokens)} 命中 ${rung.category}，判定为上界`;
      } else if (rung.category === ERROR_CATEGORY.TIMEOUT) {
        boundaryReason = `在 ${formatTokens(tokens)} 超时，按上界处理（可能是耗时而非容量限制）`;
      } else {
        boundaryReason = `在 ${formatTokens(tokens)} 出现 ${rung.category}，非容量类错误，探测提前结束`;
        inconclusive = true;
      }
      break;
    }

    // ── stage 2: binary refinement ──
    let refineUsed = 0;
    const refineBudget = this.refineRounds(ctx);
    if (firstFail > 0 && !inconclusive) {
      let low = lastOk;
      let high = firstFail;
      while (refineUsed < refineBudget && high - low > 1024) {
        await ctx.gate();
        const mid = Math.floor((low + high) / 2);
        const rung = await this.probeAt(ctx, testCase, mid, needleCode, samples);
        rungs.push(rung);
        evidence.push(`二分细化 ${this.describeRung(rung)}`);
        refineUsed += 1;
        if (rung.ok) {
          low = mid;
          lastOk = Math.max(lastOk, mid);
        } else {
          high = mid;
        }
      }
    }
    // Unused refinement units must still advance the progress bar.
    for (let i = refineUsed; i < refineBudget; i += 1) ctx.tick();

    const recallTrials = rungs.filter((r) => r.ok).length;
    const recallHits = rungs.filter((r) => r.ok && r.recalled).length;
    const recallRate = recallTrials > 0 ? recallHits / recallTrials : null;

    if (lastOk === 0) {
      return this.compose(ctx, startedAt, {
        status: 'error',
        caseId: testCase.id,
        samples,
        metrics: {
          [CONTEXT_METRIC_KEYS.MAX_TOKENS]: null,
          [CONTEXT_METRIC_KEYS.LADDER_MAX_TRIED]: ladder[ladder.length - 1],
          [CONTEXT_METRIC_KEYS.RECALL_RATE]: null,
          [CONTEXT_METRIC_KEYS.RECALL_HITS]: 0,
          [CONTEXT_METRIC_KEYS.RECALL_TRIALS]: 0,
          [CONTEXT_METRIC_KEYS.PROBED_ROUNDS]: rungs.length,
          [CONTEXT_METRIC_KEYS.REFINE_ROUNDS]: refineUsed,
          [CONTEXT_METRIC_KEYS.UPPER_BOUND_REASON]: boundaryReason,
          [CONTEXT_METRIC_KEYS.INCONCLUSIVE]: true,
          ...categoryMetrics(samples),
        },
        evidence,
        errorMessage: `最低阶梯 ${formatTokens(ladder[0])} 即失败，无法测出可用上下文窗口`,
      });
    }

    evidence.push(
      `可用上下文窗口 ≈ ${formatTokens(lastOk)} tokens；needle 召回 ${recallHits}/${recallTrials}（${formatPercent(recallRate)}）`,
    );

    return this.compose(ctx, startedAt, {
      status: 'pass',
      caseId: testCase.id,
      samples,
      metrics: {
        [CONTEXT_METRIC_KEYS.MAX_TOKENS]: lastOk,
        [CONTEXT_METRIC_KEYS.LADDER_MAX_TRIED]: ladder[ladder.length - 1],
        [CONTEXT_METRIC_KEYS.RECALL_RATE]: recallRate,
        [CONTEXT_METRIC_KEYS.RECALL_HITS]: recallHits,
        [CONTEXT_METRIC_KEYS.RECALL_TRIALS]: recallTrials,
        [CONTEXT_METRIC_KEYS.PROBED_ROUNDS]: rungs.length,
        [CONTEXT_METRIC_KEYS.REFINE_ROUNDS]: refineUsed,
        [CONTEXT_METRIC_KEYS.UPPER_BOUND_REASON]: boundaryReason,
        [CONTEXT_METRIC_KEYS.INCONCLUSIVE]: inconclusive,
        ...categoryMetrics(samples),
      },
      evidence,
    });
  }

  /** One request at a given context size. Always ticks exactly one unit. */
  private async probeAt(
    ctx: ProbeRunContext,
    testCase: TestCase,
    tokens: number,
    needleCode: string,
    samples: RequestSample[],
  ): Promise<RungResult> {
    const question =
      testCase.prompt ??
      '请阅读上面全部内容，回答：文中提到的「审计凭证编号」是多少？只输出编号本身，不要任何解释。';
    const messages: ChatTurn[] = [
      { role: 'user', content: buildHaystack(tokens, needleCode) },
      { role: 'user', content: question },
    ];

    try {
      const outcome = await ctx.adapter.chat(
        { messages, maxTokens: 64, temperature: 0 },
        this.callOptions(ctx, { stream: false }),
      );
      samples.push(sampleOf(outcome));
      const recalled = outcome.ok && outcome.text.toUpperCase().includes(needleCode.toUpperCase());
      ctx.log(
        outcome.ok ? 'info' : 'warn',
        `上下文阶梯 ${formatTokens(tokens)}：${
          outcome.ok ? `成功，needle ${recalled ? '召回 ✓' : '未召回 ✗'}` : `失败（${outcome.errorCategory}）`
        }`,
      );
      return {
        tokens,
        ok: outcome.ok,
        recalled,
        category: outcome.errorCategory,
        message: outcome.errorMessage,
      };
    } catch (err) {
      if (isCancellation(err)) throw err;
      const message = (err as Error).message;
      samples.push({
        ok: false,
        ttftMs: null,
        e2eMs: 0,
        errorCategory: ERROR_CATEGORY.UNKNOWN,
        retried: 0,
        rawSnippet: message,
      });
      ctx.log('error', `上下文阶梯 ${formatTokens(tokens)} 异常：${message}`);
      return { tokens, ok: false, recalled: false, category: ERROR_CATEGORY.UNKNOWN, message };
    } finally {
      ctx.tick();
    }
  }

  private describeRung(rung: RungResult): string {
    if (rung.ok) {
      return `${formatTokens(rung.tokens)}：成功，needle ${rung.recalled ? '召回' : '未召回'}`;
    }
    return `${formatTokens(rung.tokens)}：失败（${rung.category}）${rung.message ? ` — ${this.snippet(rung.message, 160)}` : ''}`;
  }

  /** Ascending, de-duplicated ladder. */
  private ladder(plan: ProbePlanContext): number[] {
    const source =
      plan.config.contextLadder && plan.config.contextLadder.length > 0
        ? plan.config.contextLadder
        : DEFAULT_CONTEXT_LADDER;
    return Array.from(new Set(source.filter((n) => Number.isFinite(n) && n > 0))).sort((a, b) => a - b);
  }

  private refineRounds(plan: ProbePlanContext): number {
    const configured = plan.config.contextRefineRounds ?? DEFAULT_CONTEXT_REFINE_ROUNDS;
    return Math.max(0, Math.floor(configured));
  }
}

export default ContextWindowProbe;
