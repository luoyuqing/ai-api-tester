/**
 * Per-sub-metric normalisation (architecture §7.4).
 *
 * Every raw measurement is mapped onto a 0-100 `MetricRecord.score`. A probe
 * that was skipped / errored yields `score = null` (N/A) and is EXCLUDED from
 * the weighted mean — its weight is redistributed across the remaining
 * sub-metrics of the dimension (never counted as a silent 0).
 */
import type { CaseKind, Dimension, MetricRecord, ProbeResult } from '@/types';
import {
  CONTEXT_BASE_TOKENS,
  CONTEXT_MAX_TOKENS,
  CONTEXT_QUALITY_WEIGHT,
  CONTEXT_SIZE_WEIGHT,
  ERROR_RATE_PENALTY_PER_PERCENT,
  E2E_BEST_MS,
  E2E_WORST_MS,
  TIMEOUT_RATE_PENALTY_PER_PERCENT,
  TTFT_BEST_MS,
  TTFT_WORST_MS,
  clamp,
  round1,
} from '@/constants/scoring';
import {
  METRIC_KEYS,
  SUB_METRIC_META,
  type MetricKey,
  type SubMetricMeta,
} from '@/constants/dimensions';
import { formatPercent, formatTokens } from '@/lib/timer';

/** Which probe result (by case kind) feeds a given sub-metric. */
const SOURCE_CASE_KIND: Readonly<Record<MetricKey, CaseKind>> = {
  [METRIC_KEYS.TTFT]: 'perf.latency',
  [METRIC_KEYS.E2E]: 'perf.latency',
  [METRIC_KEYS.ERROR_RATE]: 'perf.stability',
  [METRIC_KEYS.TIMEOUT_RATE]: 'perf.stability',
  [METRIC_KEYS.CONTEXT]: 'perf.context',
  [METRIC_KEYS.CONTEXT_QUALITY]: 'perf.context',
  [METRIC_KEYS.CHAT]: 'func.chat',
  [METRIC_KEYS.IMAGE]: 'func.image',
  [METRIC_KEYS.MULTIMODAL]: 'func.multimodal',
  [METRIC_KEYS.AGENT]: 'func.agent',
  [METRIC_KEYS.MODERATION]: 'safe.moderation',
  [METRIC_KEYS.SENSITIVE]: 'safe.sensitive',
  [METRIC_KEYS.JAILBREAK]: 'safe.jailbreak',
};

function num(metrics: Record<string, unknown>, key: string): number | null {
  const v = metrics[key];
  return typeof v === 'number' ? v : null;
}

/** Coerce a raw metric value into `MetricRecord.rawValue` (string|number|null).
 *  Boolean flags are rendered as 'true'/'false'; everything else passes through. */
function coerceRawValue(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return v as string | number;
}

/** Best→100 / worst→0 linear ramp; null input stays null. */
function linear(value: number | null, best: number, worst: number): number | null {
  if (value === null || Number.isNaN(value)) return null;
  if (worst <= best) return value <= best ? 100 : 0;
  return clamp(((worst - value) / (worst - best)) * 100);
}

function errorRateScore(rate: number | null): number | null {
  if (rate === null) return null;
  return clamp(100 - rate * 100 * ERROR_RATE_PENALTY_PER_PERCENT);
}

function timeoutRateScore(rate: number | null): number | null {
  if (rate === null) return null;
  return clamp(100 - rate * 100 * TIMEOUT_RATE_PENALTY_PER_PERCENT);
}

function contextScore(tokens: number | null, recallRate: number | null): number | null {
  if (tokens === null) return null;
  const sizeScore = linear(tokens, CONTEXT_BASE_TOKENS, CONTEXT_MAX_TOKENS) ?? 0;
  const recallScore = recallRate === null ? 0 : recallRate * 100;
  return clamp(CONTEXT_SIZE_WEIGHT * sizeScore + CONTEXT_QUALITY_WEIGHT * recallScore);
}

/** Resolve a sub-metric into a displayable, optionally N/A, record. */
function buildRecord(meta: SubMetricMeta, probe: ProbeResult | undefined): MetricRecord {
  const na = (reason: string): MetricRecord => ({
    key: meta.key,
    label: meta.label,
    dimension: meta.dimension,
    rawValue: coerceRawValue(probe?.metrics ? probe.metrics[primaryKey(meta.key)] : null),
    displayValue: 'N/A',
    score: null,
    weight: meta.weight,
    evidence: probe?.evidence,
    naReason: reason,
  });

  if (!probe || probe.status === 'skip') {
    return na(probe?.skipReason ?? '该子指标未测量（无相关用例或被跳过）');
  }
  if (probe.status === 'error') {
    return na('探针执行异常，无法得出可靠测量值');
  }

  const m = probe.metrics;
  switch (meta.key) {
    case METRIC_KEYS.TTFT: {
      const raw = num(m, 'ttftP50');
      if (raw === null) return na('该端点未提供流式响应，TTFT 不适用');
      return record(meta, probe, raw, `${Math.round(raw)}ms`, linear(raw, TTFT_BEST_MS, TTFT_WORST_MS), {
        p95: num(m, 'ttftP95'),
        samples: num(m, 'ttftSamples'),
      });
    }
    case METRIC_KEYS.E2E: {
      const raw = num(m, 'e2eP50');
      if (raw === null) return na('缺少端到端耗时测量');
      return record(meta, probe, raw, `${Math.round(raw)}ms`, linear(raw, E2E_BEST_MS, E2E_WORST_MS), {
        p95: num(m, 'e2eP95'),
        samples: num(m, 'e2eSamples'),
      });
    }
    case METRIC_KEYS.ERROR_RATE: {
      const raw = num(m, 'errorRate');
      if (raw === null) return na('缺少错误率测量');
      return record(meta, probe, raw, formatPercent(raw), errorRateScore(raw), {
        failed: num(m, 'failedRequests'),
        total: num(m, 'totalRequests'),
      });
    }
    case METRIC_KEYS.TIMEOUT_RATE: {
      const raw = num(m, 'timeoutRate');
      if (raw === null) return na('缺少超时率测量');
      return record(meta, probe, raw, formatPercent(raw), timeoutRateScore(raw), {
        timeouts: num(m, 'timeoutRequests'),
        total: num(m, 'totalRequests'),
      });
    }
    case METRIC_KEYS.CONTEXT: {
      const raw = num(m, 'maxContextTokens');
      const recall = num(m, 'needleRecallRate');
      if (raw === null) return na('未能测出可用上下文窗口');
      return record(meta, probe, raw, formatTokens(raw), contextScore(raw, recall), {
        recallRate: recall === null ? null : round1(recall * 100),
        recallHits: num(m, 'needleRecallHits'),
        recallTrials: num(m, 'needleRecallTrials'),
      });
    }
    case METRIC_KEYS.CONTEXT_QUALITY: {
      const recall = num(m, 'needleRecallRate');
      const raw = recall === null ? null : round1(recall * 100);
      return {
        key: meta.key,
        label: meta.label,
        dimension: meta.dimension,
        rawValue: raw,
        displayValue: raw === null ? 'N/A' : `${raw}%`,
        // Display-only sub-metric — excluded from the weighted mean.
        score: null,
        weight: 0,
        evidence: probe.evidence,
        naReason: raw === null ? '召回率不可测' : undefined,
      };
    }
    case METRIC_KEYS.CHAT:
    case METRIC_KEYS.IMAGE:
    case METRIC_KEYS.MULTIMODAL:
    case METRIC_KEYS.AGENT:
    case METRIC_KEYS.MODERATION:
    case METRIC_KEYS.SENSITIVE:
    case METRIC_KEYS.JAILBREAK: {
      const raw = typeof probe.rawScore === 'number' ? probe.rawScore : null;
      if (raw === null) return na('未能得出判分');
      return record(meta, probe, raw, `${round1(raw)}`, clamp(raw));
    }
    default:
      return na('未知子指标');
  }
}

/** The metric key a sub-metric primarily reads (for the rawValue fallback). */
function primaryKey(key: MetricKey): string {
  switch (key) {
    case METRIC_KEYS.TTFT:
      return 'ttftP50';
    case METRIC_KEYS.E2E:
      return 'e2eP50';
    case METRIC_KEYS.ERROR_RATE:
      return 'errorRate';
    case METRIC_KEYS.TIMEOUT_RATE:
      return 'timeoutRate';
    case METRIC_KEYS.CONTEXT:
      return 'maxContextTokens';
    case METRIC_KEYS.CONTEXT_QUALITY:
      return 'needleRecallRate';
    default:
      return 'weightedScore';
  }
}

function record(
  meta: SubMetricMeta,
  probe: ProbeResult,
  rawValue: number | string | null,
  displayValue: string,
  score: number | null,
  detail?: Record<string, number | string | null>,
): MetricRecord {
  return {
    key: meta.key,
    label: meta.label,
    dimension: meta.dimension,
    rawValue,
    displayValue,
    score,
    weight: meta.weight,
    detail,
    evidence: probe.evidence,
    naReason: score === null ? '数值不可用' : undefined,
  };
}

/**
 * Build every sub-metric record for a provider's probe results.
 * Records whose `score` is null are the N/A entries the aggregator skips.
 */
export function buildMetricRecords(probeResults: readonly ProbeResult[]): MetricRecord[] {
  const byKind = new Map<CaseKind, ProbeResult>();
  probeResults.forEach((r) => {
    if (!byKind.has(r.caseKind)) byKind.set(r.caseKind, r);
  });

  return SUB_METRIC_META.map((meta) => {
    const probe = byKind.get(SOURCE_CASE_KIND[meta.key]);
    return buildRecord(meta, probe);
  });
}

/** Records for one dimension only (used by the dashboard drill-down). */
export function buildDimensionRecords(
  probeResults: readonly ProbeResult[],
  dimension: Dimension,
): MetricRecord[] {
  return buildMetricRecords(probeResults).filter((r) => r.dimension === dimension);
}
