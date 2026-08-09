/** Evaluation task configuration + engine entry contracts. */
import type { Provider, Transport } from './provider';
import type { PlaceholderDictionary, TestSuite } from './testcase';
import type { EvaluationResult } from './metrics';
import type { RunEvent } from './events';

export type Dimension = 'performance' | 'functionality' | 'safety';

export const ALL_DIMENSIONS: readonly Dimension[] = ['performance', 'functionality', 'safety'] as const;

export type ScoringMode = 'rule' | 'llm-judge' | 'hybrid';

export interface ScoringSetting {
  mode: ScoringMode;
  /** Provider used as the judge when mode !== 'rule'. */
  judgeProviderId?: string;
}

/** Per-dimension sub-metric weights; missing keys fall back to the defaults. */
export type WeightOverrides = Record<string, number>;

export interface EvaluationConfig {
  id: string;
  name: string;
  /** Target models (2-5 recommended). */
  providerIds: string[];
  dimensions: Dimension[];
  suiteIds: string[];
  /** 1-20 */
  concurrency: number;
  timeoutMs: number;
  /** Retries for 429 / 5xx. Default 2. */
  maxRetries: number;
  /** PERF-02 sample size. Default 30. */
  stabilitySampleSize: number;
  /** PERF-01 sample size (excluding the discarded warm-up). Default 5. */
  latencySampleSize: number;
  scoring: ScoringSetting;
  /** PERF-03 ladder in tokens. */
  contextLadder: number[];
  /** Extra binary-search refinement rounds after the coarse ladder scan. */
  contextRefineRounds: number;
  /** User acknowledged the compliance notice for the safety dimension. */
  safetyAcknowledged: boolean;
  /** Optional per-metric weight overrides. */
  weightOverrides?: WeightOverrides;
  isTemplate: boolean;
  createdAt: number;
}

export type TaskStatus = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';

export interface EvaluationHandle {
  taskId: string;
  cancel(): void;
  pause(): void;
  resume(): void;
  promise: Promise<EvaluationResult[]>;
}

export interface EngineHooks {
  /** Single event outlet — the engine never touches a store or React. */
  onEvent?(e: RunEvent): void;
}

/**
 * Everything the engine needs from the outside world.
 * `secrets` maps providerId → plaintext API key and only ever lives in memory.
 */
export interface EngineDeps {
  providers: Provider[];
  suites: TestSuite[];
  secrets: Record<string, string>;
  /** Factory so the engine stays testable with a mock transport. */
  createTransport: (mode: Provider['transport']) => Transport;
  /** Locally imported placeholder dictionary for the safety suites. */
  placeholders?: PlaceholderDictionary;
  /** Called for each finished probe so the UI layer can persist incrementally. */
  onProbePersist?: (providerId: string, probeResultId: string) => void;
}

export interface PlanUnit {
  id: string;
  providerId: string;
  probeId: string;
  dimension: Dimension;
  /** Estimated request count, used for the progress denominator. */
  units: number;
}
