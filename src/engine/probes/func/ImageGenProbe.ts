import type {
  CaseKind,
  Dimension,
  ErrorCategory,
  ImageOutcome,
  ProbeResult,
  RequestSample,
  TestCase,
} from '@/types';
import { formatPercent } from '@/lib/timer';
import { ERROR_CATEGORY } from '@/constants/errorCodes';
import {
  IMAGE_PARSABLE_WEIGHT,
  IMAGE_RELEVANCE_FACTOR,
  IMAGE_SUCCESS_WEIGHT,
  clamp,
  round1,
} from '@/constants/scoring';
import { isCancellation } from '@/engine/errors';
import {
  BaseProbe,
  categoryMetrics,
  type ProbePlanContext,
  type ProbeRunContext,
} from '@/engine/probes/Probe';

export const IMAGE_METRIC_KEYS = {
  ATTEMPTS: 'attempts',
  SUCCESS: 'successCount',
  PARSABLE: 'parsableCount',
  SUCCESS_RATE: 'successRate',
  PARSABLE_RATE: 'parsableRate',
  RELEVANCE: 'relevanceScore',
  RELEVANCE_MEASURED: 'relevanceMeasured',
  CAPABILITY: 'capability',
} as const;

/** Failure categories that prove the endpoint simply has no image route. */
const CAPABILITY_MISS_CATEGORIES: readonly ErrorCategory[] = [
  ERROR_CATEGORY.BAD_REQUEST,
  ERROR_CATEGORY.PARSE,
];

/**
 * FUNC-02 — image generation availability, parsability and prompt relevance.
 *
 * `生图可用性 = 成功率×50 + 可解析率×20 + 相关性分×0.3` (§7.4).
 *
 * Capability detection is measurement-driven rather than declaration-driven:
 * the first case is attempted regardless of `provider.type`; if it comes back
 * with a `bad_request`/`parse` failure the endpoint clearly has no
 * `/images/generations` route, the remaining cases are abandoned to save quota
 * and the sub-metric becomes N/A (skip) instead of a 0 score — "不具备该能力"
 * must never be confused with "该能力差" (§7.4 N/A rule).
 */
export class ImageGenProbe extends BaseProbe {
  public readonly id = 'probe.func.image';

  public readonly caseKind: CaseKind = 'func.image';

  public readonly dimension: Dimension = 'functionality';

  public estimateUnits(plan: ProbePlanContext): number {
    return plan.cases.length;
  }

  public async run(ctx: ProbeRunContext): Promise<ProbeResult> {
    const startedAt = Date.now();
    const cases = ctx.cases;
    if (cases.length === 0) {
      return this.skipped(ctx, startedAt, '所选用例集中没有 func.image 用例');
    }
    if (!ctx.adapter.image) {
      return this.skipped(ctx, startedAt, '当前协议适配器未实现生图接口，记为 N/A');
    }

    const samples: RequestSample[] = [];
    const evidence: string[] = [];
    let attempts = 0;
    let successCount = 0;
    let parsableCount = 0;
    let relevanceHits = 0;
    let relevanceChecks = 0;
    let capabilityMissed = false;

    for (let index = 0; index < cases.length; index += 1) {
      const testCase = cases[index];
      await ctx.gate();
      attempts += 1;
      try {
        const outcome = await ctx.adapter.image(testCase.prompt ?? testCase.title, this.callOptions(ctx));
        samples.push(this.imageSample(outcome));

        if (outcome.ok) {
          successCount += 1;
          const parsable = outcome.images.some(
            (img) => (img.b64Json && img.b64Json.length > 0) || (img.url && img.url.length > 0),
          );
          if (parsable) parsableCount += 1;
          const relevance = this.measureRelevance(testCase, outcome);
          relevanceChecks += relevance.checked;
          relevanceHits += relevance.hits;
          evidence.push(
            `【${testCase.title}】成功，返回 ${outcome.images.length} 张${parsable ? '（含可解析载荷）' : '（无 b64/url 载荷）'}${
              relevance.checked > 0 ? `，关键词命中 ${relevance.hits}/${relevance.checked}` : '，未返回 revised_prompt，跳过相关性核对'
            }`,
          );
          ctx.log('info', `${testCase.title} 生图成功（${Math.round(outcome.e2eMs)}ms）`);
        } else {
          evidence.push(
            `【${testCase.title}】失败（${outcome.errorCategory}）：${this.snippet(outcome.errorMessage ?? '未知错误', 200)}`,
          );
          ctx.log('warn', `${testCase.title} 生图失败：${outcome.errorCategory} ${outcome.errorMessage ?? ''}`);
          if (index === 0 && CAPABILITY_MISS_CATEGORIES.includes(outcome.errorCategory)) {
            capabilityMissed = true;
            // Refund the untried units so the progress bar stays truthful.
            for (let rest = index + 1; rest < cases.length; rest += 1) ctx.tick();
            ctx.tick();
            break;
          }
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
        evidence.push(`【${testCase.title}】执行异常：${(err as Error).message}`);
        ctx.log('error', `${testCase.title} 生图异常：${(err as Error).message}`);
      }
      ctx.tick();
    }

    if (capabilityMissed) {
      return this.compose(ctx, startedAt, {
        status: 'skip',
        samples,
        metrics: {
          [IMAGE_METRIC_KEYS.ATTEMPTS]: attempts,
          [IMAGE_METRIC_KEYS.SUCCESS]: 0,
          [IMAGE_METRIC_KEYS.CAPABILITY]: 'unsupported',
          ...categoryMetrics(samples),
        },
        evidence,
        skipReason: '该端点未提供 /images/generations（首个用例即返回参数类错误），判定为不具备生图能力，记为 N/A',
      });
    }

    const successRate = attempts > 0 ? successCount / attempts : 0;
    const parsableRate = attempts > 0 ? parsableCount / attempts : 0;
    // No revised_prompt anywhere → relevance cannot be falsified; give full
    // credit rather than penalising a provider for omitting an optional field.
    const relevance = relevanceChecks > 0 ? (relevanceHits / relevanceChecks) * 100 : 100;
    const rawScore = round1(
      clamp(
        successRate * IMAGE_SUCCESS_WEIGHT +
          parsableRate * IMAGE_PARSABLE_WEIGHT +
          relevance * IMAGE_RELEVANCE_FACTOR,
      ),
    );

    evidence.push(
      `成功率 ${formatPercent(successRate)} × ${IMAGE_SUCCESS_WEIGHT} + 可解析率 ${formatPercent(parsableRate)} × ${IMAGE_PARSABLE_WEIGHT} + 相关性 ${round1(relevance)} × ${IMAGE_RELEVANCE_FACTOR} = ${rawScore}`,
    );

    return this.compose(ctx, startedAt, {
      status: successCount > 0 ? 'pass' : 'fail',
      samples,
      metrics: {
        [IMAGE_METRIC_KEYS.ATTEMPTS]: attempts,
        [IMAGE_METRIC_KEYS.SUCCESS]: successCount,
        [IMAGE_METRIC_KEYS.PARSABLE]: parsableCount,
        [IMAGE_METRIC_KEYS.SUCCESS_RATE]: successRate,
        [IMAGE_METRIC_KEYS.PARSABLE_RATE]: parsableRate,
        [IMAGE_METRIC_KEYS.RELEVANCE]: round1(relevance),
        [IMAGE_METRIC_KEYS.RELEVANCE_MEASURED]: relevanceChecks,
        [IMAGE_METRIC_KEYS.CAPABILITY]: successCount > 0 ? 'supported' : 'failing',
        ...categoryMetrics(samples),
      },
      rawScore,
      scoringMode: 'rule',
      evidence,
    });
  }

  /** ImageOutcome has no TTFT — map it onto the shared sample shape. */
  private imageSample(outcome: ImageOutcome): RequestSample {
    return {
      ok: outcome.ok,
      ttftMs: null,
      e2eMs: Math.round(outcome.e2eMs * 10) / 10,
      status: outcome.status,
      errorCategory: outcome.errorCategory,
      retried: outcome.retried,
      rawSnippet: outcome.ok
        ? `images=${outcome.images.length}`
        : (outcome.rawSnippet ?? outcome.errorMessage),
    };
  }

  /** Keyword hit rate against `revised_prompt`, when the provider returns one. */
  private measureRelevance(testCase: TestCase, outcome: ImageOutcome): { hits: number; checked: number } {
    const keywords = testCase.expectation?.mustInclude ?? [];
    if (keywords.length === 0) return { hits: 0, checked: 0 };
    const revised = outcome.images
      .map((img) => img.revisedPrompt ?? '')
      .filter((t) => t.length > 0)
      .join(' ')
      .toLowerCase();
    if (revised.length === 0) return { hits: 0, checked: 0 };
    const hits = keywords.filter((k) => revised.includes(k.toLowerCase())).length;
    return { hits, checked: keywords.length };
  }
}

export default ImageGenProbe;
