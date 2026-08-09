import type { CaseKind, Dimension, ProbeResult, RequestSample } from '@/types';
import { computeLatencyStats, formatPercent } from '@/lib/timer';
import { ERROR_CATEGORY } from '@/constants/errorCodes';
import { DEFAULT_STABILITY_SAMPLE_SIZE, MIN_STABILITY_SAMPLE_SIZE } from '@/constants/defaults';
import { isCancellation } from '@/engine/errors';
import {
  BaseProbe,
  categoryMetrics,
  sampleOf,
  turnsOf,
  type ProbePlanContext,
  type ProbeRunContext,
} from '@/engine/probes/Probe';

export const STABILITY_METRIC_KEYS = {
  TOTAL: 'totalRequests',
  FAILED: 'failedRequests',
  TIMEOUTS: 'timeoutRequests',
  ERROR_RATE: 'errorRate',
  TIMEOUT_RATE: 'timeoutRate',
  RETRY_SUCCESS: 'retrySucceeded',
  E2E_P50: 'e2eP50',
  E2E_P95: 'e2eP95',
  SAMPLE_SIZE_OK: 'sampleSizeSatisfied',
} as const;

/**
 * PERF-02 — error rate and timeout rate over a fixed sample (N ≥ 30).
 *
 * Statistical convention (§7.1):
 *  - 错误率 = 最终失败的请求数 / 总请求数（重试成功的**不算失败**）
 *  - 超时率 = timeout 类错误数 / 总请求数（超时是错误率的子集）
 *
 * The requests are intentionally cheap (a one-token arithmetic answer) and
 * non-streaming: what is being measured is the reliability of the pipeline,
 * not the quality of the reply.
 */
export class StabilityProbe extends BaseProbe {
  public readonly id = 'probe.perf.stability';

  public readonly caseKind: CaseKind = 'perf.stability';

  public readonly dimension: Dimension = 'performance';

  public estimateUnits(plan: ProbePlanContext): number {
    return this.sampleSize(plan);
  }

  public async run(ctx: ProbeRunContext): Promise<ProbeResult> {
    const startedAt = Date.now();
    const testCase = ctx.cases[0];
    if (!testCase) {
      return this.skipped(ctx, startedAt, '所选用例集中没有 perf.stability 基准用例');
    }

    const total = this.sampleSize(ctx);
    const samples: RequestSample[] = [];
    let retrySucceeded = 0;

    for (let i = 0; i < total; i += 1) {
      await ctx.gate();
      try {
        const outcome = await ctx.adapter.chat(
          { messages: turnsOf(testCase), maxTokens: 16, temperature: 0 },
          this.callOptions(ctx, { stream: false }),
        );
        const sample = sampleOf(outcome);
        samples.push(sample);
        if (outcome.ok && outcome.retried > 0) retrySucceeded += 1;
        // Only log every 5th sample plus every failure — 30 lines of "✓" is noise.
        if (!outcome.ok) {
          ctx.log('warn', `稳定性采样 ${i + 1}/${total} 失败：${outcome.errorCategory} ${outcome.errorMessage ?? ''}`);
        } else if ((i + 1) % 5 === 0 || i === total - 1) {
          ctx.log('info', `稳定性采样进度 ${i + 1}/${total}（当前失败 ${samples.filter((s) => !s.ok).length} 次）`);
        }
      } catch (err) {
        if (isCancellation(err)) throw err;
        samples.push({
          ok: false,
          ttftMs: null,
          e2eMs: 0,
          errorCategory: ERROR_CATEGORY.UNKNOWN,
          retried: 0,
          rawSnippet: (err as Error).message,
        });
        ctx.log('error', `稳定性采样 ${i + 1}/${total} 异常：${(err as Error).message}`);
      } finally {
        ctx.tick();
      }
    }

    const failed = samples.filter((s) => !s.ok);
    const timeouts = failed.filter((s) => s.errorCategory === ERROR_CATEGORY.TIMEOUT);
    const errorRate = samples.length > 0 ? failed.length / samples.length : 0;
    const timeoutRate = samples.length > 0 ? timeouts.length / samples.length : 0;
    const e2e = computeLatencyStats(samples.filter((s) => s.ok).map((s) => s.e2eMs));
    const sampleSizeSatisfied = samples.length >= MIN_STABILITY_SAMPLE_SIZE;

    const evidence: string[] = [
      `样本量 ${samples.length}（PERF-02 要求 ≥ ${MIN_STABILITY_SAMPLE_SIZE}${sampleSizeSatisfied ? '，已满足' : '，未满足，结论仅供参考'}）`,
      `错误率 ${formatPercent(errorRate)}（失败 ${failed.length} 次，其中超时 ${timeouts.length} 次）`,
      `重试后成功 ${retrySucceeded} 次，按口径不计入失败`,
    ];
    const categories = categoryMetrics(samples);
    Object.keys(categories).forEach((key) => {
      evidence.push(`${key.replace('errors.', '错误分类 ')}：${categories[key]} 次`);
    });

    return this.compose(ctx, startedAt, {
      status: samples.length === 0 ? 'error' : 'pass',
      caseId: testCase.id,
      samples,
      metrics: {
        [STABILITY_METRIC_KEYS.TOTAL]: samples.length,
        [STABILITY_METRIC_KEYS.FAILED]: failed.length,
        [STABILITY_METRIC_KEYS.TIMEOUTS]: timeouts.length,
        [STABILITY_METRIC_KEYS.ERROR_RATE]: errorRate,
        [STABILITY_METRIC_KEYS.TIMEOUT_RATE]: timeoutRate,
        [STABILITY_METRIC_KEYS.RETRY_SUCCESS]: retrySucceeded,
        [STABILITY_METRIC_KEYS.E2E_P50]: e2e.p50,
        [STABILITY_METRIC_KEYS.E2E_P95]: e2e.p95,
        [STABILITY_METRIC_KEYS.SAMPLE_SIZE_OK]: sampleSizeSatisfied,
        ...categories,
      },
      evidence,
      errorMessage: samples.length === 0 ? '未能完成任何稳定性采样' : undefined,
    });
  }

  private sampleSize(plan: ProbePlanContext): number {
    const configured = plan.config.stabilitySampleSize ?? DEFAULT_STABILITY_SAMPLE_SIZE;
    return Math.max(1, Math.floor(configured));
  }
}

export default StabilityProbe;
