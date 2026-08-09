import type { CaseKind, Dimension, ProbeResult, RequestSample } from '@/types';
import { computeLatencyStats, formatDuration } from '@/lib/timer';
import { DEFAULT_LATENCY_SAMPLE_SIZE } from '@/constants/defaults';
import { isCancellation } from '@/engine/errors';
import {
  BaseProbe,
  categoryMetrics,
  sampleOf,
  turnsOf,
  type ProbePlanContext,
  type ProbeRunContext,
} from '@/engine/probes/Probe';

/** Metric keys written into `ProbeResult.metrics`. */
export const LATENCY_METRIC_KEYS = {
  TTFT_P50: 'ttftP50',
  TTFT_P95: 'ttftP95',
  TTFT_MEAN: 'ttftMean',
  TTFT_MIN: 'ttftMin',
  TTFT_MAX: 'ttftMax',
  TTFT_SAMPLES: 'ttftSamples',
  E2E_P50: 'e2eP50',
  E2E_P95: 'e2eP95',
  E2E_MEAN: 'e2eMean',
  E2E_MIN: 'e2eMin',
  E2E_MAX: 'e2eMax',
  E2E_SAMPLES: 'e2eSamples',
  TOTAL: 'totalRequests',
  FAILED: 'failedRequests',
  STREAMED: 'streamed',
} as const;

/**
 * PERF-01 — first-token latency and end-to-end latency.
 *
 * Each latency case is sampled `config.latencySampleSize` times. The warm-up
 * request is issued once per provider by the engine (§7.3) and is NOT part of
 * this probe, so every sample here counts.
 *
 * Streaming is requested whenever the provider supports it; for non-streaming
 * endpoints `ttftMs` stays null and the TTFT sub-metric becomes N/A rather
 * than a zero (§7.4 N/A rule).
 */
export class LatencyProbe extends BaseProbe {
  public readonly id = 'probe.perf.latency';

  public readonly caseKind: CaseKind = 'perf.latency';

  public readonly dimension: Dimension = 'performance';

  public estimateUnits(plan: ProbePlanContext): number {
    return plan.cases.length * this.sampleSize(plan);
  }

  public async run(ctx: ProbeRunContext): Promise<ProbeResult> {
    const startedAt = Date.now();
    const cases = ctx.cases;
    if (cases.length === 0) {
      return this.skipped(ctx, startedAt, '所选用例集中没有 perf.latency 用例');
    }

    const sampleSize = this.sampleSize(ctx);
    const samples: RequestSample[] = [];
    const evidence: string[] = [];
    const perCase: Record<string, number | string | null> = {};

    for (const testCase of cases) {
      const caseSamples: RequestSample[] = [];
      for (let i = 0; i < sampleSize; i += 1) {
        await ctx.gate();
        try {
          const outcome = await ctx.adapter.chat(
            { messages: turnsOf(testCase), maxTokens: 256 },
            this.callOptions(ctx, { stream: true }),
          );
          const sample = sampleOf(outcome);
          samples.push(sample);
          caseSamples.push(sample);
          ctx.log(
            outcome.ok ? 'info' : 'warn',
            `${testCase.title} #${i + 1} TTFT=${
              sample.ttftMs === null ? '—（非流式）' : formatDuration(sample.ttftMs)
            } 耗时=${formatDuration(sample.e2eMs)} ${outcome.ok ? '✓' : `✗ ${outcome.errorMessage ?? ''}`}`,
          );
        } catch (err) {
          if (isCancellation(err)) throw err;
          ctx.log('error', `${testCase.title} #${i + 1} 采样异常：${(err as Error).message}`);
        } finally {
          ctx.tick();
        }
      }

      const caseTtft = caseSamples
        .filter((s) => s.ok && s.ttftMs !== null)
        .map((s) => s.ttftMs as number);
      const caseE2e = caseSamples.filter((s) => s.ok).map((s) => s.e2eMs);
      const ttftStats = computeLatencyStats(caseTtft);
      const e2eStats = computeLatencyStats(caseE2e);
      perCase[`case.${testCase.id}.ttftP50`] = ttftStats.p50;
      perCase[`case.${testCase.id}.e2eP50`] = e2eStats.p50;
      evidence.push(
        `${testCase.title}：TTFT p50=${
          ttftStats.p50 === null ? '—' : formatDuration(ttftStats.p50)
        } / E2E p50=${e2eStats.p50 === null ? '—' : formatDuration(e2eStats.p50)}（成功 ${caseE2e.length}/${caseSamples.length}）`,
      );
    }

    const okSamples = samples.filter((s) => s.ok);
    const ttftValues = okSamples.filter((s) => s.ttftMs !== null).map((s) => s.ttftMs as number);
    const e2eValues = okSamples.map((s) => s.e2eMs);
    const ttft = computeLatencyStats(ttftValues);
    const e2e = computeLatencyStats(e2eValues);
    const streamed = ttftValues.length > 0;

    if (okSamples.length === 0) {
      return this.compose(ctx, startedAt, {
        status: 'error',
        samples,
        metrics: {
          [LATENCY_METRIC_KEYS.TOTAL]: samples.length,
          [LATENCY_METRIC_KEYS.FAILED]: samples.length,
          [LATENCY_METRIC_KEYS.STREAMED]: false,
          ...categoryMetrics(samples),
        },
        evidence,
        errorMessage: '全部延迟采样均失败，无法得出 TTFT / E2E',
      });
    }

    if (!streamed) {
      evidence.push('该端点未提供流式响应，TTFT 记为 N/A（不按 0 分计入权重）');
    }

    return this.compose(ctx, startedAt, {
      status: 'pass',
      samples,
      metrics: {
        [LATENCY_METRIC_KEYS.TTFT_P50]: ttft.p50,
        [LATENCY_METRIC_KEYS.TTFT_P95]: ttft.p95,
        [LATENCY_METRIC_KEYS.TTFT_MEAN]: ttft.mean,
        [LATENCY_METRIC_KEYS.TTFT_MIN]: ttft.min,
        [LATENCY_METRIC_KEYS.TTFT_MAX]: ttft.max,
        [LATENCY_METRIC_KEYS.TTFT_SAMPLES]: ttft.count,
        [LATENCY_METRIC_KEYS.E2E_P50]: e2e.p50,
        [LATENCY_METRIC_KEYS.E2E_P95]: e2e.p95,
        [LATENCY_METRIC_KEYS.E2E_MEAN]: e2e.mean,
        [LATENCY_METRIC_KEYS.E2E_MIN]: e2e.min,
        [LATENCY_METRIC_KEYS.E2E_MAX]: e2e.max,
        [LATENCY_METRIC_KEYS.E2E_SAMPLES]: e2e.count,
        [LATENCY_METRIC_KEYS.TOTAL]: samples.length,
        [LATENCY_METRIC_KEYS.FAILED]: samples.length - okSamples.length,
        [LATENCY_METRIC_KEYS.STREAMED]: streamed,
        ...perCase,
        ...categoryMetrics(samples),
      },
      evidence,
    });
  }

  /** Sample count per case, always at least 1. */
  private sampleSize(plan: ProbePlanContext): number {
    const configured = plan.config.latencySampleSize ?? DEFAULT_LATENCY_SAMPLE_SIZE;
    return Math.max(1, Math.floor(configured));
  }
}

export default LatencyProbe;
