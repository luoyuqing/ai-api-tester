/** Measurement + scoring result types. */
import type { CaseKind } from './testcase';
import type { Dimension, EvaluationConfig, ScoringMode } from './evaluation';

export type ErrorCategory =
  | 'none'
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'server'
  | 'bad_request'
  | 'context_exceeded'
  | 'parse'
  | 'unknown';

/** Atomic observation of a single HTTP call. */
export interface RequestSample {
  ok: boolean;
  /** null for non-streaming calls. */
  ttftMs: number | null;
  e2eMs: number;
  status?: number;
  errorCategory: ErrorCategory;
  /** How many retries were consumed before this outcome. */
  retried: number;
  outputTokensApprox?: number;
  /** Truncated to 2000 chars for evidence display. */
  rawSnippet?: string;
}

export type ProbeStatus = 'pass' | 'fail' | 'skip' | 'error';

export interface ProbeResult {
  probeId: string;
  caseKind: CaseKind;
  providerId: string;
  caseId?: string;
  status: ProbeStatus;
  samples: RequestSample[];
  /** Raw (non-normalised) measurements keyed by metric name. */
  metrics: Record<string, number | string | boolean | null>;
  /** 0-100 for scoring probes. */
  rawScore?: number;
  scoringMode?: ScoringMode;
  /** Explainable request/response excerpts. */
  evidence?: string[];
  /** Why the probe was skipped, if it was. */
  skipReason?: string;
  errorMessage?: string;
  startedAt: number;
  endedAt: number;
}

/** A normalised sub-metric ready for aggregation & display. */
export interface MetricRecord {
  /** e.g. 'perf.ttft' / 'safe.jailbreak'. */
  key: string;
  label: string;
  dimension: Dimension;
  rawValue: number | string | null;
  /** Pre-formatted for the table, e.g. "820ms" / "88%" / "支持". */
  displayValue: string;
  /** 0-100, or null for N/A (excluded from the weighted mean). */
  score: number | null;
  weight: number;
  /** Extra numbers for drill-down (p95, per-category counts, …). */
  detail?: Record<string, number | string | null>;
  /** Evidence excerpts collected from the contributing probes. */
  evidence?: string[];
  /** Explains why the metric is N/A. */
  naReason?: string;
}

export interface DimensionScore {
  dimension: Dimension;
  score: number | null;
  metrics: MetricRecord[];
  /** Weight actually used for the overall score (0 when the dimension is N/A). */
  effectiveWeight: number;
}

export interface EvaluationResult {
  id: string;
  taskId: string;
  providerId: string;
  providerName: string;
  model: string;
  dimensionScores: DimensionScore[];
  overallScore: number | null;
  probeResults: ProbeResult[];
  startedAt: number;
  endedAt: number;
  /** Reproducibility: the full task config used to produce this result. */
  configSnapshot: EvaluationConfig;
  engineVersion: string;
  /** suiteId → suite version, recorded for auditability (§7.10). */
  suiteVersions: Record<string, string>;
}

/** Lightweight index row persisted in localStorage for list/search screens. */
export interface ResultIndexItem {
  id: string;
  taskId: string;
  providerId: string;
  providerName: string;
  model: string;
  overallScore: number | null;
  performanceScore: number | null;
  functionalityScore: number | null;
  safetyScore: number | null;
  startedAt: number;
  endedAt: number;
  engineVersion: string;
  configName: string;
}

/** Aggregated latency statistics (architecture §7.3). */
export interface LatencyStats {
  count: number;
  mean: number | null;
  p50: number | null;
  p95: number | null;
  min: number | null;
  max: number | null;
}
