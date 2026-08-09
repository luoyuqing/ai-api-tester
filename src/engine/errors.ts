import type { ErrorCategory } from '@/types';
import { ERROR_CATEGORY, exceptionToCategory } from '@/constants/errorCodes';
import { HttpError, truncateSnippet } from '@/lib/http';

/**
 * Engine-level error taxonomy.
 *
 * `lib/http.ts` already classifies transport failures into an `ErrorCategory`;
 * this module simply lifts arbitrary thrown values into a uniform shape so a
 * probe never has to `instanceof`-check three different error classes.
 *
 * Classification priority (architecture §7.1): 异常类型 > HTTP 状态码 > 响应体文案.
 */
export class EvaluationError extends Error {
  public readonly category: ErrorCategory;

  public readonly status?: number;

  public readonly retried: number;

  public readonly requestId?: string;

  /** Truncated response body / error payload used as evidence. */
  public readonly snippet?: string;

  /** Which provider produced the failure (used by the log tag). */
  public readonly providerId?: string;

  public constructor(params: {
    message: string;
    category?: ErrorCategory;
    status?: number;
    retried?: number;
    requestId?: string;
    snippet?: string;
    providerId?: string;
  }) {
    super(params.message);
    this.name = 'EvaluationError';
    this.category = params.category ?? ERROR_CATEGORY.UNKNOWN;
    this.status = params.status;
    this.retried = params.retried ?? 0;
    this.requestId = params.requestId;
    this.snippet = params.snippet;
    this.providerId = params.providerId;
  }

  /**
   * Normalise any thrown value into an EvaluationError, optionally tagging it
   * with the provider that produced it. This is the entry point adapters and
   * probes use so they never have to `instanceof`-check three error classes.
   */
  public static from(
    err: unknown,
    ctx: { providerId?: string; fallbackMessage?: string } = {},
  ): EvaluationError {
    const base = toEvaluationError(err, ctx.fallbackMessage ?? '未知错误');
    // Never re-wrap a cancellation: downstream code relies on the concrete
    // CancelledError instance to tell "user aborted" from "provider failed".
    if (base instanceof CancelledError) return base;
    if (!ctx.providerId || base.providerId === ctx.providerId) return base;
    const tagged = new EvaluationError({
      message: base.message,
      category: base.category,
      status: base.status,
      retried: base.retried,
      requestId: base.requestId,
      snippet: base.snippet,
      providerId: ctx.providerId,
    });
    tagged.name = base.name;
    return tagged;
  }
}

/** Raised when the user cancels the task. Never counted as a provider failure. */
export class CancelledError extends EvaluationError {
  public constructor(message = '评测已取消') {
    super({ message, category: ERROR_CATEGORY.NONE });
    this.name = 'CancelledError';
  }
}

/** Raised when a probe is asked to exercise a capability the provider lacks. */
export class CapabilityUnsupportedError extends EvaluationError {
  public readonly capability: string;

  public constructor(capability: string, message?: string) {
    super({
      message: message ?? `当前 Provider 不支持能力：${capability}`,
      category: ERROR_CATEGORY.BAD_REQUEST,
    });
    this.name = 'CapabilityUnsupportedError';
    this.capability = capability;
  }
}

/** Raised when the engine configuration itself is invalid (fail fast, no requests). */
export class ConfigurationError extends EvaluationError {
  public constructor(message: string) {
    super({ message, category: ERROR_CATEGORY.BAD_REQUEST });
    this.name = 'ConfigurationError';
  }
}

/**
 * True when the thrown value represents a user-initiated abort rather than a
 * provider failure. `lib/http.ts` marks those with `category === 'none'`.
 */
export function isCancellation(err: unknown): boolean {
  if (err instanceof CancelledError) return true;
  if (err instanceof HttpError) return err.category === ERROR_CATEGORY.NONE;
  if (err instanceof DOMException) return err.name === 'AbortError';
  if (err instanceof Error) return err.name === 'AbortError';
  return false;
}

/** Map any thrown value onto an ErrorCategory. */
export function classifyError(err: unknown): ErrorCategory {
  if (isCancellation(err)) return ERROR_CATEGORY.NONE;
  if (err instanceof EvaluationError) return err.category;
  if (err instanceof HttpError) return err.category;
  return exceptionToCategory(err);
}

/** Best-effort human-readable message. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Evidence snippet extracted from an error, if the transport captured one. */
export function errorSnippet(err: unknown): string | undefined {
  if (err instanceof HttpError && err.bodyText) return truncateSnippet(err.bodyText);
  if (err instanceof EvaluationError && err.snippet) return err.snippet;
  return undefined;
}

/** Normalise any thrown value into an EvaluationError. */
export function toEvaluationError(err: unknown, fallbackMessage = '未知错误'): EvaluationError {
  if (err instanceof EvaluationError) return err;
  if (isCancellation(err)) return new CancelledError();
  if (err instanceof HttpError) {
    return new EvaluationError({
      message: err.message || fallbackMessage,
      category: err.category,
      status: err.status,
      retried: err.retried,
      requestId: err.requestId,
      snippet: err.bodyText,
    });
  }
  return new EvaluationError({
    message: errorMessage(err) || fallbackMessage,
    category: exceptionToCategory(err),
  });
}
