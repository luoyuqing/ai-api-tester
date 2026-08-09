/**
 * Dimension + overall aggregation (architecture §7.4).
 *
 *  - dimension score   = Σ(sub.score·sub.weight) / Σ(sub.weight) over NON-N/A subs
 *  - overall score     = Σ(dim.score·dim.weight) / Σ(dim.weight) over NON-N/A dims
 *
 * N/A sub-metrics (score === null) drop out of the denominator, so their weight
 * is silently redistributed — "不适用" never counts as a zero.
 */
import type { Dimension, DimensionScore, EvaluationConfig, EvaluationResult, ProbeResult } from '@/types';
import { ALL_DIMENSIONS } from '@/types';
import { DIMENSION_WEIGHTS, SUB_METRIC_META } from '@/constants/dimensions';
import { round1 } from '@/constants/scoring';
import { buildMetricRecords } from './normalize';

/** Aggregate one provider's probe results into dimension + overall scores. */
export function aggregate(
  probeResults: readonly ProbeResult[],
  config: EvaluationConfig,
): { dimensionScores: DimensionScore[]; overallScore: number | null } {
  const records = buildMetricRecords(probeResults);

  const selected: Dimension[] = ALL_DIMENSIONS.filter((d) => config.dimensions.includes(d));

  const dimensionScores: DimensionScore[] = selected.map((dimension) => {
    const metrics = records.filter((r) => r.dimension === dimension);
    let weightSum = 0;
    let scoreSum = 0;
    metrics.forEach((r) => {
      if (r.score !== null) {
        weightSum += r.weight;
        scoreSum += r.weight * r.score;
      }
    });
    const score = weightSum > 0 ? round1(scoreSum / weightSum) : null;
    return {
      dimension,
      score,
      metrics,
      effectiveWeight: DIMENSION_WEIGHTS[dimension],
    };
  });

  let dimWeightSum = 0;
  let dimScoreSum = 0;
  dimensionScores.forEach((d) => {
    if (d.score !== null) {
      const w = DIMENSION_WEIGHTS[d.dimension];
      dimWeightSum += w;
      dimScoreSum += w * d.score;
    }
  });
  const overallScore = dimWeightSum > 0 ? round1(dimScoreSum / dimWeightSum) : null;

  return { dimensionScores, overallScore };
}

/** Build a complete EvaluationResult for one provider. */
export function buildResult(
  params: {
    taskId: string;
    providerId: string;
    providerName: string;
    model: string;
    probeResults: ProbeResult[];
    config: EvaluationConfig;
    engineVersion: string;
    suiteVersions: Record<string, string>;
    startedAt: number;
    endedAt: number;
  },
): EvaluationResult {
  const { dimensionScores, overallScore } = aggregate(params.probeResults, params.config);
  return {
    id: params.taskId ? `${params.taskId}:${params.providerId}` : params.providerId,
    taskId: params.taskId,
    providerId: params.providerId,
    providerName: params.providerName,
    model: params.model,
    dimensionScores,
    overallScore,
    probeResults: params.probeResults,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    configSnapshot: params.config,
    engineVersion: params.engineVersion,
    suiteVersions: params.suiteVersions,
  };
}
