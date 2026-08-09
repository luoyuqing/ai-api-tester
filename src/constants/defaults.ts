import type { EvaluationConfig, TransportMode } from '@/types';

/** Engine version stamped onto every EvaluationResult (§7.10). */
export const ENGINE_VERSION: string =
  (import.meta.env?.VITE_ENGINE_VERSION as string | undefined) ?? '1.0.0';

/**
 * Default base for the local CORS sidecar. Resolved at runtime so the same
 * build works for:
 *   - npm run dev              → http://localhost:8787 (Node sidecar on laptop)
 *   - deployed to server/path  → `${window.location.origin}/tester-proxy` so
 *                                the sidecar can be reverse-proxied by nginx
 *                                under the same origin (avoids CORS, no extra
 *                                security group ports).
 *
 * The user can still override this at runtime via the settings store.
 */
export function getDefaultProxyBase(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    // The deployed sidecar is reverse-proxied under /tester-proxy; in dev we
    // fall back to the local Node port. Both yield same-origin fetches.
    return `${window.location.origin.replace(/\/+$/, '')}/tester-proxy`;
  }
  return 'http://localhost:8787';
}

export const DEFAULT_TRANSPORT: TransportMode =
  ((import.meta.env?.VITE_DEFAULT_TRANSPORT as TransportMode | undefined) ?? 'direct');

export const DEBUG_ENABLED: boolean =
  String(import.meta.env?.VITE_DEBUG ?? 'false').toLowerCase() === 'true';

// ───────────────────────── run defaults ─────────────────────────

export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 20;
export const DEFAULT_CONCURRENCY = 5;

export const DEFAULT_TIMEOUT_MS = 60000;
export const MIN_TIMEOUT_MS = 5000;
export const MAX_TIMEOUT_MS = 300000;

export const DEFAULT_MAX_RETRIES = 2;
export const MAX_RETRIES_LIMIT = 5;

/** PERF-02 requires N ≥ 30. */
export const MIN_STABILITY_SAMPLE_SIZE = 30;
export const DEFAULT_STABILITY_SAMPLE_SIZE = 30;

/** PERF-01 samples, excluding the discarded warm-up request. */
export const DEFAULT_LATENCY_SAMPLE_SIZE = 5;

/** Exactly one warm-up request per provider per round; its result is discarded. */
export const WARMUP_REQUEST_COUNT = 1;

/** PERF-03 coarse ladder in tokens. */
export const DEFAULT_CONTEXT_LADDER: readonly number[] = [
  4096, 8192, 16384, 32768, 65536, 131072, 204800,
];

export const DEFAULT_CONTEXT_REFINE_ROUNDS = 2;

/** Approximate characters per token used to build the haystack filler. */
export const CHARS_PER_TOKEN_APPROX = 4;

/** Recommended comparison range on the dashboard. */
export const MIN_COMPARE_MODELS = 2;
export const MAX_COMPARE_MODELS = 5;

/** Exponential backoff for 429 / 5xx retries. */
export const RETRY_BASE_DELAY_MS = 800;
export const RETRY_MAX_DELAY_MS = 8000;
export const RETRY_JITTER_MS = 250;

/** Progress event throttling inside the Scheduler. */
export const PROGRESS_THROTTLE_MS = 100;

/** UI event batching in useEvaluationRun. */
export const UI_EVENT_FLUSH_MS = 16;

/** Ring-buffer capacity for the log console. */
export const LOG_BUFFER_LIMIT = 5000;

/** Evidence snippets are truncated to this many characters. */
export const SNIPPET_MAX_CHARS = 2000;

/** Connectivity ping budget. */
export const PING_TIMEOUT_MS = 10000;

// ───────────────────────── storage ─────────────────────────

export const STORAGE_PREFIX = 'aiat';
export const SCHEMA_VERSION = 1;

export const STORAGE_KEYS = {
  META: 'aiat:meta:v1',
  PROVIDERS: 'aiat:providers:v1',
  SECRETS: 'aiat:secrets:v1',
  CONFIGS: 'aiat:configs:v1',
  RESULT_INDEX: 'aiat:results:idx:v1',
  SETTINGS: 'aiat:settings:v1',
  UI: 'aiat:ui:v1',
  DEVICE_KEY: 'aiat:devicekey:v1',
  KDF_SALT: 'aiat:kdfsalt:v1',
} as const;

/** IndexedDB store used by idb-keyval. */
export const IDB_DB_NAME = 'aiat';
export const IDB_STORE_NAME = 'aiat-results';

export const IDB_KEY_PREFIX = {
  RESULT: 'result:',
  IMAGE: 'image:',
  SUITE: 'suite:',
  PROBE: 'probe:',
} as const;

// ───────────────────────── default config ─────────────────────────

/** Builtin suite ids (must match src/data/testsets/index.ts). */
export const BUILTIN_SUITE_IDS: readonly string[] = [
  'suite.perf.default',
  'suite.chat.default',
  'suite.image.default',
  'suite.multimodal.default',
  'suite.agent.default',
  'suite.safe.moderation',
  'suite.safe.sensitive',
  'suite.safe.jailbreak',
];

/** Factory for a fresh evaluation config (id/createdAt filled by the caller). */
export function createDefaultEvaluationConfig(
  overrides: Partial<EvaluationConfig> = {},
): Omit<EvaluationConfig, 'id' | 'createdAt'> {
  return {
    name: '未命名评测任务',
    providerIds: [],
    dimensions: ['performance', 'functionality', 'safety'],
    suiteIds: [...BUILTIN_SUITE_IDS],
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    stabilitySampleSize: DEFAULT_STABILITY_SAMPLE_SIZE,
    latencySampleSize: DEFAULT_LATENCY_SAMPLE_SIZE,
    scoring: { mode: 'rule' },
    contextLadder: [...DEFAULT_CONTEXT_LADDER],
    contextRefineRounds: DEFAULT_CONTEXT_REFINE_ROUNDS,
    safetyAcknowledged: false,
    isTemplate: false,
    ...overrides,
  };
}

/** Default provider draft values used by the config form. */
export const DEFAULT_PROVIDER_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
