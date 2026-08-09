import type {
  CallOptions,
  CaseKind,
  ChatInput,
  ChatOutcome,
  ChatTurn,
  Dimension,
  EvaluationConfig,
  HandshakeOutcome,
  ImageOutcome,
  LogLevel,
  PlaceholderDictionary,
  ProbeResult,
  ProbeStatus,
  Provider,
  RequestSample,
  ScoringMode,
  TestCase,
} from '@/types';
import { ERROR_CATEGORY } from '@/constants/errorCodes';
import { isCaseResolvable } from '@/data/testsets';
import { approxTokens, type ProviderAdapter } from '@/engine/adapters/ProviderAdapter';
import type { Scorer } from '@/engine/scorers/Scorer';
import { EvaluationError, isCancellation } from '@/engine/errors';

/**
 * Probe contract (architecture §3.2 / §6 T03).
 *
 * A probe owns exactly one `CaseKind`, converts its cases into adapter calls
 * and returns ONE aggregated `ProbeResult`. It never normalises to 0-100 —
 * that is the aggregator's job — and never touches persistence or React.
 */

/** Everything needed to decide whether a probe can run and how big it is. */
export interface ProbePlanInput {
  provider: Provider;
  config: EvaluationConfig;
  /** Cases of this probe's kind, already collected from the selected suites. */
  cases: TestCase[];
  placeholders: PlaceholderDictionary;
}

/**
 * Runtime context handed to `Probe.run` — the single source of truth.
 *
 * `gate` and `checkpoint` are deliberately separate: `gate` acquires a
 * scheduler slot before issuing a request, while `checkpoint` only parks the
 * probe while the task is paused. Merging them would make a paused task hold
 * its concurrency slots hostage.
 */
export interface ProbeContext extends ProbePlanInput {
  adapter: ProviderAdapter;
  scorer: Scorer;
  signal: AbortSignal;
  /** Awaits a free scheduler slot; rejects when the task is cancelled. */
  gate(): Promise<void>;
  /** Awaits while the task is paused; throws CancelledError when cancelled. */
  checkpoint(): Promise<void>;
  /** Report finished request units so the progress bar can advance. */
  tick(units?: number): void;
  /** Emit a log line through the RunEvent channel. */
  log(level: LogLevel, message: string): void;
}

export interface SupportVerdict {
  supported: boolean;
  /** Why the probe cannot run — surfaced verbatim as the metric's N/A reason. */
  reason?: string;
}

export const SUPPORTED: SupportVerdict = Object.freeze({ supported: true });

export function unsupported(reason: string): SupportVerdict {
  return { supported: false, reason };
}

/** Alias so probe `supports()` can declare a precise return type. */
export type ProbeSupport = SupportVerdict;

/** Cases whose placeholders all resolve against the supplied dictionary. */
export function resolvableCases(plan: ProbePlanInput): TestCase[] {
  const dict = plan.placeholders ?? {};
  return plan.cases.filter((c) => isCaseResolvable(c, dict));
}

export interface Probe {
  readonly id: string;
  readonly label: string;
  readonly caseKind: CaseKind;
  readonly dimension: Dimension;
  /** Capability / configuration gate. A `false` verdict produces a skip. */
  supports(input: ProbePlanInput): SupportVerdict;
  /** Estimated request count — the progress denominator. */
  estimateUnits(input: ProbePlanInput): number;
  run(ctx: ProbeContext): Promise<ProbeResult>;
}

// ───────────────────────── shared helpers ─────────────────────────

/** Chat endpoints are required by every probe except the image one. */
export function requiresChat(provider: Provider): SupportVerdict {
  if (provider.type === 'image') {
    return unsupported('该 Provider 登记为纯生图服务，不具备对话能力');
  }
  return SUPPORTED;
}

/** Build the adapter call options for one request. */
export function callOptionsOf(ctx: ProbeContext, extra: Partial<CallOptions> = {}): CallOptions {
  return {
    timeoutMs: ctx.config.timeoutMs,
    signal: ctx.signal,
    maxRetries: ctx.config.maxRetries,
    stream: false,
    ...extra,
  };
}

/** Turns → messages, falling back to the single-turn prompt. */
export function chatInputOf(testCase: TestCase, overrides: Partial<ChatInput> = {}): ChatInput {
  const turns: ChatTurn[] =
    testCase.turns && testCase.turns.length > 0
      ? testCase.turns.map((t) => ({ role: t.role, content: t.content }))
      : [{ role: 'user', content: testCase.prompt ?? '' }];
  return { messages: turns, ...overrides };
}

/** The instruction actually being judged (last user turn, or the prompt). */
export function lastUserPrompt(testCase: TestCase): string {
  if (testCase.prompt && testCase.prompt.length > 0) return testCase.prompt;
  const turns = testCase.turns ?? [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].role === 'user') return turns[i].content;
  }
  return '';
}

/** Case weight with a safe default (0 weights would silently vanish). */
export function caseWeight(testCase: TestCase): number {
  const w = typeof testCase.weight === 'number' ? testCase.weight : 1;
  return w > 0 ? w : 1;
}

/**
 * Failure snippets are only kept for failed calls: a successful 30-sample
 * stability run would otherwise push megabytes into IndexedDB.
 */
export function sampleFromChat(outcome: ChatOutcome): RequestSample {
  return {
    ok: outcome.ok,
    ttftMs: outcome.ttftMs,
    e2eMs: Math.round(outcome.e2eMs * 10) / 10,
    status: outcome.status,
    errorCategory: outcome.errorCategory,
    retried: outcome.retried,
    outputTokensApprox: outcome.usage?.completionTokens ?? approxTokens(outcome.text ?? ''),
    rawSnippet: outcome.ok ? undefined : outcome.rawSnippet,
  };
}

export function sampleFromImage(outcome: ImageOutcome): RequestSample {
  return {
    ok: outcome.ok,
    ttftMs: null,
    e2eMs: Math.round(outcome.e2eMs * 10) / 10,
    status: outcome.status,
    errorCategory: outcome.errorCategory,
    retried: outcome.retried,
    rawSnippet: outcome.ok ? undefined : outcome.rawSnippet,
  };
}

export function sampleFromHandshake(outcome: HandshakeOutcome): RequestSample {
  return {
    ok: outcome.ok,
    ttftMs: null,
    e2eMs: Math.round(outcome.e2eMs * 10) / 10,
    errorCategory: outcome.errorCategory,
    retried: outcome.retried,
  };
}

/** `pass` when at least one call succeeded, `fail` when every call failed. */
export function statusFromSamples(samples: readonly RequestSample[]): ProbeStatus {
  if (samples.length === 0) return 'skip';
  return samples.some((s) => s.ok) ? 'pass' : 'fail';
}

export interface BuildResultParams {
  probe: Probe;
  providerId: string;
  startedAt: number;
  status: ProbeStatus;
  samples: RequestSample[];
  metrics: Record<string, number | string | boolean | null>;
  rawScore?: number;
  scoringMode?: ScoringMode;
  evidence?: string[];
  caseId?: string;
  skipReason?: string;
  errorMessage?: string;
}

export function buildResult(params: BuildResultParams): ProbeResult {
  return {
    probeId: params.probe.id,
    caseKind: params.probe.caseKind,
    providerId: params.providerId,
    caseId: params.caseId,
    status: params.status,
    samples: params.samples,
    metrics: params.metrics,
    rawScore: params.rawScore,
    scoringMode: params.scoringMode,
    evidence: params.evidence,
    skipReason: params.skipReason,
    errorMessage: params.errorMessage,
    startedAt: params.startedAt,
    endedAt: Date.now(),
  };
}

/** Uniform "this probe did not run" result so the aggregator can show N/A. */
export function skipResult(
  probe: Probe,
  providerId: string,
  reason: string,
  startedAt: number = Date.now(),
): ProbeResult {
  return buildResult({
    probe,
    providerId,
    startedAt,
    status: 'skip',
    samples: [],
    metrics: {},
    skipReason: reason,
  });
}

/** Uniform "the probe itself blew up" result (never thrown to the scheduler). */
export function errorResult(
  probe: Probe,
  providerId: string,
  err: unknown,
  startedAt: number = Date.now(),
): ProbeResult {
  const wrapped = EvaluationError.from(err, { providerId, fallbackMessage: '探针执行异常' });
  return buildResult({
    probe,
    providerId,
    startedAt,
    status: 'error',
    samples: [],
    metrics: { 'error.category': wrapped.category },
    errorMessage: wrapped.message,
    evidence: wrapped.snippet ? [wrapped.snippet] : undefined,
  });
}

/** Re-throw user cancellations, swallow everything else into a value. */
export function rethrowIfCancelled(err: unknown): void {
  if (isCancellation(err)) throw err;
}

/**
 * Bounded-parallel map with a cooperative checkpoint before each item.
 *
 * Deliberately independent from the Scheduler's semaphore: probes are already
 * scheduled as top-level tasks, so borrowing the same slots here could
 * deadlock when every slot is held by a waiting probe.
 */
export async function parallelMap<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  checkpoint?: () => Promise<void>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  if (items.length === 0) return out;
  const size = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let cursor = 0;

  const runner = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      if (checkpoint) await checkpoint();
      out[index] = await worker(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: size }, () => runner()));
  return out;
}

/** Sequential map with a checkpoint — used wherever timing must stay clean. */
export async function serialMap<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  checkpoint?: () => Promise<void>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += 1) {
    if (checkpoint) await checkpoint();
    out.push(await worker(items[i], i));
  }
  return out;
}

/** Count failures by category — feeds the stability drill-down table. */
export function countByCategory(samples: readonly RequestSample[]): Record<string, number> {
  const counts: Record<string, number> = {};
  samples.forEach((s) => {
    if (s.ok || s.errorCategory === ERROR_CATEGORY.NONE) return;
    counts[s.errorCategory] = (counts[s.errorCategory] ?? 0) + 1;
  });
  return counts;
}

// ───────────────────────────── runtime types ─────────────────────────────

/**
 * Planning-time view of a probe run: the inputs needed to decide support and
 * estimate the unit count. No adapter / scorer / runtime controls.
 */
export type ProbePlanContext = ProbePlanInput;

/**
 * Alias kept for readability at call sites that build the context.
 * It must stay identical to `ProbeContext`: two structurally different runtime
 * contexts is exactly what broke probe registration before.
 */
export type ProbeRunContext = ProbeContext;

/** Truncate text for evidence display. */
export function snippet(text: string, maxLen: number): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= maxLen ? clean : `${clean.slice(0, maxLen)}…`;
}

/** ChatOutcome / ImageOutcome → RequestSample (failure snippets retained). */
export function sampleOf(outcome: ChatOutcome | ImageOutcome): RequestSample {
  const ok = outcome.ok;
  return {
    ok,
    ttftMs: 'ttftMs' in outcome ? (outcome.ttftMs ?? null) : null,
    e2eMs: Math.round(outcome.e2eMs * 10) / 10,
    status: outcome.status,
    errorCategory: outcome.errorCategory,
    retried: outcome.retried,
    rawSnippet: ok ? undefined : outcome.rawSnippet,
  };
}

/** TestCase → ChatTurn[] (single-turn falls back to the prompt). */
export function turnsOf(testCase: TestCase): ChatTurn[] {
  return chatInputOf(testCase).messages;
}

/** Category failure counts, merged into a probe's metric bag. */
export function categoryMetrics(samples: readonly RequestSample[]): Record<string, number> {
  return countByCategory(samples);
}

/**
 * Base class every concrete probe extends. It owns the result-assembly glue
 * (`compose` / `skipped` / `callOptions`) so individual probes stay focused on
 * their measurement logic and never touch persistence or React.
 */
export abstract class BaseProbe implements Probe {
  public abstract readonly id: string;
  public abstract readonly caseKind: CaseKind;
  public abstract readonly dimension: Dimension;

  public get label(): string {
    return this.id;
  }

  public supports(_input: ProbePlanInput): SupportVerdict {
    return SUPPORTED;
  }

  public abstract estimateUnits(input: ProbePlanContext): number;

  public abstract run(ctx: ProbeRunContext): Promise<ProbeResult>;

  /** Truncate text for evidence display (instance-side alias of `snippet`). */
  protected snippet(text: string, maxLen = 300): string {
    return snippet(text, maxLen);
  }

  /** Build the CallOptions for one adapter request from the run context. */
  protected callOptions(ctx: ProbeRunContext, extra: Partial<CallOptions> = {}): CallOptions {
    return {
      timeoutMs: ctx.config.timeoutMs,
      signal: ctx.signal,
      maxRetries: ctx.config.maxRetries,
      stream: false,
      ...extra,
    };
  }

  /** Assemble a finished ProbeResult from the probe's measured payload. */
  protected compose(
    ctx: ProbeRunContext,
    startedAt: number,
    params: {
      status: ProbeStatus;
      samples: RequestSample[];
      metrics: Record<string, number | string | boolean | null>;
      evidence?: string[];
      errorMessage?: string;
      rawScore?: number;
      scoringMode?: ScoringMode;
      /** Set when the probe measured exactly one case (drill-down anchor). */
      caseId?: string;
      /** Set when a probe finishes as a skip while still reporting metrics. */
      skipReason?: string;
    },
  ): ProbeResult {
    return buildResult({
      probe: this,
      providerId: ctx.provider.id,
      startedAt,
      status: params.status,
      samples: params.samples,
      metrics: params.metrics,
      evidence: params.evidence,
      errorMessage: params.errorMessage,
      rawScore: params.rawScore,
      scoringMode: params.scoringMode,
      caseId: params.caseId,
      skipReason: params.skipReason,
    });
  }

  /** Uniform "no cases / unsupported" skip result. */
  protected skipped(ctx: ProbeRunContext, startedAt: number, reason: string): ProbeResult {
    return buildResult({
      probe: this,
      providerId: ctx.provider.id,
      startedAt,
      status: 'skip',
      samples: [],
      metrics: {},
      skipReason: reason,
    });
  }
}
