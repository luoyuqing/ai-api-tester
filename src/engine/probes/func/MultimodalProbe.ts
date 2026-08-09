import type {
  CaseKind,
  ChatOutcome,
  Dimension,
  ErrorCategory,
  Modality,
  ProbeResult,
  RequestSample,
  TestCase,
} from '@/types';
import { ERROR_CATEGORY } from '@/constants/errorCodes';
import {
  MODALITY_SUPPORT_LABELS,
  MODALITY_SUPPORT_SCORE,
  MODALITY_WEIGHTS,
  round1,
  type ModalitySupport,
} from '@/constants/scoring';
import { isCancellation } from '@/engine/errors';
import {
  BaseProbe,
  categoryMetrics,
  sampleOf,
  type ProbePlanContext,
  type ProbeRunContext,
} from '@/engine/probes/Probe';

export const MULTIMODAL_METRIC_KEYS = {
  IMAGE: 'image',
  AUDIO: 'audio',
  VIDEO: 'video',
  MEASURED: 'measuredModalities',
  SCORE: 'weightedScore',
} as const;

/** Failures that genuinely mean "this content part is not accepted". */
const UNSUPPORTED_CATEGORIES: readonly ErrorCategory[] = [
  ERROR_CATEGORY.BAD_REQUEST,
  ERROR_CATEGORY.PARSE,
];

/** Failures that say nothing about modality support — excluded from the mean. */
const INFRA_CATEGORIES: readonly ErrorCategory[] = [
  ERROR_CATEGORY.AUTH,
  ERROR_CATEGORY.NETWORK,
  ERROR_CATEGORY.TIMEOUT,
  ERROR_CATEGORY.RATE_LIMIT,
  ERROR_CATEGORY.SERVER,
  ERROR_CATEGORY.CONTEXT_EXCEEDED,
];

interface ModalityVerdict {
  modality: Modality;
  support: ModalitySupport | null;
  reason: string;
}

/**
 * FUNC-03 — image / audio / video input support, judged per modality.
 *
 * 支持=100 / 降级=50 / 不支持=0，按 MODALITY_WEIGHTS 加权求均值 (§7.4).
 *
 * A modality that failed for infrastructure reasons (auth, network, 5xx …) is
 * reported as unmeasured and dropped from the denominator, so a flaky network
 * cannot masquerade as "不支持".
 */
export class MultimodalProbe extends BaseProbe {
  public readonly id = 'probe.func.multimodal';

  public readonly caseKind: CaseKind = 'func.multimodal';

  public readonly dimension: Dimension = 'functionality';

  public estimateUnits(plan: ProbePlanContext): number {
    return plan.cases.filter((c) => Boolean(c.attachment)).length;
  }

  public async run(ctx: ProbeRunContext): Promise<ProbeResult> {
    const startedAt = Date.now();
    const cases = ctx.cases.filter((c) => Boolean(c.attachment));
    if (cases.length === 0) {
      return this.skipped(ctx, startedAt, '所选用例集中没有带附件的 func.multimodal 用例');
    }
    if (!ctx.adapter.multimodal) {
      return this.skipped(ctx, startedAt, '当前协议适配器未实现多模态接口，记为 N/A');
    }

    const samples: RequestSample[] = [];
    const evidence: string[] = [];
    const verdicts: ModalityVerdict[] = [];

    for (const testCase of cases) {
      await ctx.gate();
      const attachment = testCase.attachment;
      if (!attachment) continue;
      try {
        const outcome = await ctx.adapter.multimodal(
          {
            modality: attachment.modality,
            mimeType: attachment.mimeType,
            dataUrl: attachment.dataUrl,
            prompt: testCase.prompt ?? testCase.title,
          },
          this.callOptions(ctx, { stream: false }),
        );
        samples.push(sampleOf(outcome));
        const verdict = this.judge(attachment.modality, outcome, testCase);
        verdicts.push(verdict);
        evidence.push(
          `【${testCase.title}】${
            verdict.support === null ? '无法判定' : MODALITY_SUPPORT_LABELS[verdict.support]
          } — ${verdict.reason}`,
        );
        if (outcome.ok && outcome.text.trim().length > 0) {
          evidence.push(`  响应摘要：${this.snippet(outcome.text, 200)}`);
        }
        ctx.log(
          verdict.support === 'supported' ? 'info' : verdict.support === null ? 'error' : 'warn',
          `${attachment.modality} 模态：${verdict.support === null ? '无法判定' : MODALITY_SUPPORT_LABELS[verdict.support]}`,
        );
      } catch (err) {
        if (isCancellation(err)) throw err;
        verdicts.push({
          modality: attachment.modality,
          support: null,
          reason: `执行异常：${(err as Error).message}`,
        });
        evidence.push(`【${testCase.title}】执行异常：${(err as Error).message}`);
        ctx.log('error', `${attachment.modality} 模态探测异常：${(err as Error).message}`);
      } finally {
        ctx.tick();
      }
    }

    const measured = verdicts.filter((v) => v.support !== null);
    const metrics: Record<string, number | string | boolean | null> = {
      [MULTIMODAL_METRIC_KEYS.MEASURED]: measured.length,
      ...categoryMetrics(samples),
    };
    verdicts.forEach((v) => {
      metrics[v.modality] = v.support === null ? null : MODALITY_SUPPORT_LABELS[v.support];
      metrics[`${v.modality}.score`] = v.support === null ? null : MODALITY_SUPPORT_SCORE[v.support];
    });

    if (measured.length === 0) {
      return this.compose(ctx, startedAt, {
        status: 'error',
        samples,
        metrics,
        evidence,
        errorMessage: '三类模态均因链路错误无法判定，多模态支持度记为 N/A',
      });
    }

    let weightSum = 0;
    let scoreSum = 0;
    measured.forEach((v) => {
      const weight = MODALITY_WEIGHTS[v.modality] ?? 0;
      if (weight <= 0) return;
      weightSum += weight;
      scoreSum += weight * MODALITY_SUPPORT_SCORE[v.support as ModalitySupport];
    });
    const rawScore = weightSum > 0 ? round1(scoreSum / weightSum) : 0;
    metrics[MULTIMODAL_METRIC_KEYS.SCORE] = rawScore;

    evidence.push(
      `加权均值（图 ${MODALITY_WEIGHTS.image} / 音 ${MODALITY_WEIGHTS.audio} / 视 ${MODALITY_WEIGHTS.video}，仅统计可判定项）= ${rawScore}`,
    );

    return this.compose(ctx, startedAt, {
      status: 'pass',
      samples,
      metrics,
      rawScore,
      scoringMode: 'rule',
      evidence,
    });
  }

  /** Tri-state verdict for one modality. */
  private judge(modality: Modality, outcome: ChatOutcome, testCase: TestCase): ModalityVerdict {
    if (outcome.ok) {
      const text = outcome.text.trim();
      if (text.length === 0) {
        return {
          modality,
          support: 'degraded',
          reason: '接口接受了该 content part 但返回空内容',
        };
      }
      // The suites explicitly invite the model to say it cannot handle the媒体.
      if (/无法(处理|解析|读取|查看|识别)|不支持(该|这)?(音频|视频|图片|文件)|cannot (process|read|see|access)/i.test(text)) {
        return {
          modality,
          support: 'degraded',
          reason: `请求被接受但模型自述无法处理该媒体：${this.snippet(text, 120)}`,
        };
      }
      return {
        modality,
        support: 'supported',
        reason: `接口接受 ${modality} content part 并返回了实质内容（用例 ${testCase.id}）`,
      };
    }

    if (UNSUPPORTED_CATEGORIES.includes(outcome.errorCategory)) {
      return {
        modality,
        support: 'unsupported',
        reason: `接口以 ${outcome.errorCategory} 拒绝该 content part：${this.snippet(outcome.errorMessage ?? '', 120)}`,
      };
    }

    if (INFRA_CATEGORIES.includes(outcome.errorCategory)) {
      return {
        modality,
        support: null,
        reason: `链路层错误（${outcome.errorCategory}），本模态不计入加权均值`,
      };
    }

    return {
      modality,
      support: 'unsupported',
      reason: `请求失败（${outcome.errorCategory}）：${this.snippet(outcome.errorMessage ?? '', 120)}`,
    };
  }
}

export default MultimodalProbe;
