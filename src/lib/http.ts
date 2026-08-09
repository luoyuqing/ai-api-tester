import type {
  ErrorCategory,
  HttpRequest,
  HttpResponse,
  StreamChunk,
  Transport,
  TransportMode,
} from '@/types';
import {
  ERROR_CATEGORY,
  exceptionToCategory,
  httpStatusToCategory,
  isRetryableCategory,
  matchProviderErrorMessage,
} from '@/constants/errorCodes';
import {
  RETRY_BASE_DELAY_MS,
  RETRY_JITTER_MS,
  RETRY_MAX_DELAY_MS,
  SNIPPET_MAX_CHARS,
} from '@/constants/defaults';
import { getProxyBase } from '@/lib/runtimeConfig';
import { parseSSEStream } from '@/lib/sse';
import { delay, now } from '@/lib/timer';
import { logger } from '@/lib/logger';

/**
 * The ONLY place in the app that is allowed to call `fetch()`.
 * Probes, adapters and components must go through a Transport (architecture §7.2).
 */

export class HttpError extends Error {
  public readonly status?: number;

  public readonly category: ErrorCategory;

  public readonly bodyText?: string;

  public readonly retried: number;

  public readonly requestId: string;

  public constructor(params: {
    message: string;
    category: ErrorCategory;
    status?: number;
    bodyText?: string;
    retried?: number;
    requestId?: string;
  }) {
    super(params.message);
    this.name = 'HttpError';
    this.category = params.category;
    this.status = params.status;
    this.bodyText = params.bodyText;
    this.retried = params.retried ?? 0;
    this.requestId = params.requestId ?? '';
  }
}

/** Truncate a body/snippet for evidence display. */
export function truncateSnippet(text: string, max = SNIPPET_MAX_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[truncated ${text.length - max} chars]`;
}

/** Exponential backoff with jitter. */
export function backoffDelay(attempt: number): number {
  const base = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
  return base + Math.random() * RETRY_JITTER_MS;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * Combine the caller's abort signal with a per-request timeout.
 * Returns the composed signal plus a disposer and a "did we time out" probe.
 */
function withTimeout(
  signal: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; dispose: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let didTimeout = false;

  const onOuterAbort = (): void => controller.abort(signal.reason);
  if (signal.aborted) controller.abort(signal.reason);
  else signal.addEventListener('abort', onOuterAbort, { once: true });

  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort(new DOMException('Request timeout', 'TimeoutError'));
  }, timeoutMs);

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onOuterAbort);
    },
    timedOut: () => didTimeout,
  };
}

/** Derive the real fetch target + headers for a given transport mode. */
function resolveTarget(req: HttpRequest): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = { ...req.headers, 'X-Request-Id': req.requestId };
  if (req.transport === 'proxy') {
    return {
      url: `${getProxyBase()}/proxy`,
      headers: { ...headers, 'x-target-url': req.url },
    };
  }
  return { url: req.url, headers };
}

/** Classify a failed response using the taxonomy priority order. */
export function categorizeResponse(status: number, bodyText: string): ErrorCategory {
  const byBody = matchProviderErrorMessage(bodyText);
  const byStatus = httpStatusToCategory(status);
  // Body text wins only when it is more specific than the status-derived value.
  if (byBody === ERROR_CATEGORY.CONTEXT_EXCEEDED) return byBody;
  if (byStatus !== ERROR_CATEGORY.UNKNOWN && byStatus !== ERROR_CATEGORY.NONE) return byStatus;
  return byBody ?? ERROR_CATEGORY.UNKNOWN;
}

/**
 * Base transport. `direct` and `proxy` only differ in how the target URL and
 * headers are resolved, so they share the whole retry/timeout/parse pipeline.
 */
abstract class BaseTransport implements Transport {
  public abstract readonly mode: TransportMode;

  public async request(req: HttpRequest, signal: AbortSignal): Promise<HttpResponse> {
    const maxRetries = req.maxRetries ?? 0;
    const telemetry = req.telemetry;
    let attempt = 0;

    for (;;) {
      const scope = withTimeout(signal, req.timeoutMs);
      const { url, headers } = resolveTarget({ ...req, transport: this.mode });

      try {
        if (telemetry) {
          telemetry.t0 = now();
          telemetry.retried = attempt;
        }
        const res = await fetch(url, {
          method: req.method,
          headers,
          body: req.body,
          signal: scope.signal,
          // Never attach cookies to a third-party AI endpoint.
          credentials: 'omit',
          mode: 'cors',
          redirect: 'follow',
        });
        if (telemetry) {
          telemetry.headersAt = now();
          telemetry.status = res.status;
        }
        const bodyText = await res.text();
        if (telemetry) {
          telemetry.firstByteAt = telemetry.firstByteAt ?? now();
          telemetry.ok = res.ok;
        }

        if (!res.ok) {
          const category = categorizeResponse(res.status, bodyText);
          const err = new HttpError({
            message: `HTTP ${res.status} ${res.statusText || ''}`.trim(),
            category,
            status: res.status,
            bodyText: truncateSnippet(bodyText),
            retried: attempt,
            requestId: req.requestId,
          });
          if (attempt < maxRetries && isRetryableCategory(category)) {
            scope.dispose();
            await delay(backoffDelay(attempt), signal);
            attempt += 1;
            continue;
          }
          throw err;
        }

        return {
          ok: true,
          status: res.status,
          statusText: res.statusText,
          headers: headersToRecord(res.headers),
          bodyText,
          retried: attempt,
        };
      } catch (err) {
        if (err instanceof HttpError) throw err;
        const category = exceptionToCategory(err, scope.timedOut());
        // A user-initiated cancel must not be retried.
        const userCancelled = signal.aborted && !scope.timedOut();
        const httpErr = new HttpError({
          message: userCancelled
            ? '请求已取消'
            : err instanceof Error
              ? err.message
              : String(err),
          category: userCancelled ? ERROR_CATEGORY.NONE : category,
          retried: attempt,
          requestId: req.requestId,
        });
        if (!userCancelled && attempt < maxRetries && isRetryableCategory(category)) {
          scope.dispose();
          await delay(backoffDelay(attempt), signal);
          attempt += 1;
          continue;
        }
        throw httpErr;
      } finally {
        scope.dispose();
      }
    }
  }

  public async *stream(req: HttpRequest, signal: AbortSignal): AsyncIterable<StreamChunk> {
    const maxRetries = req.maxRetries ?? 0;
    const telemetry = req.telemetry;
    let attempt = 0;

    for (;;) {
      const scope = withTimeout(signal, req.timeoutMs);
      const { url, headers } = resolveTarget({ ...req, transport: this.mode });
      let response: Response;

      try {
        if (telemetry) {
          telemetry.t0 = now();
          telemetry.retried = attempt;
        }
        response = await fetch(url, {
          method: req.method,
          headers: { Accept: 'text/event-stream', ...headers },
          body: req.body,
          signal: scope.signal,
          credentials: 'omit',
          mode: 'cors',
          redirect: 'follow',
        });
        if (telemetry) {
          telemetry.headersAt = now();
          telemetry.status = response.status;
        }
      } catch (err) {
        scope.dispose();
        const category = exceptionToCategory(err, scope.timedOut());
        const userCancelled = signal.aborted && !scope.timedOut();
        if (!userCancelled && attempt < maxRetries && isRetryableCategory(category)) {
          await delay(backoffDelay(attempt), signal);
          attempt += 1;
          continue;
        }
        throw new HttpError({
          message: userCancelled ? '请求已取消' : err instanceof Error ? err.message : String(err),
          category: userCancelled ? ERROR_CATEGORY.NONE : category,
          retried: attempt,
          requestId: req.requestId,
        });
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        scope.dispose();
        const category = categorizeResponse(response.status, bodyText);
        if (attempt < maxRetries && isRetryableCategory(category)) {
          await delay(backoffDelay(attempt), signal);
          attempt += 1;
          continue;
        }
        throw new HttpError({
          message: `HTTP ${response.status} ${response.statusText || ''}`.trim(),
          category,
          status: response.status,
          bodyText: truncateSnippet(bodyText),
          retried: attempt,
          requestId: req.requestId,
        });
      }

      if (!response.body) {
        scope.dispose();
        throw new HttpError({
          message: '响应无可读流（该端点可能不支持 SSE）',
          category: ERROR_CATEGORY.PARSE,
          status: response.status,
          retried: attempt,
          requestId: req.requestId,
        });
      }

      if (telemetry) telemetry.ok = true;

      try {
        let first = true;
        for await (const chunk of parseSSEStream(response.body, scope.signal)) {
          if (first) {
            first = false;
            if (telemetry) telemetry.firstByteAt = now();
          }
          yield chunk;
        }
        return;
      } catch (err) {
        const category = exceptionToCategory(err, scope.timedOut());
        throw new HttpError({
          message: err instanceof Error ? err.message : String(err),
          category,
          status: response.status,
          retried: attempt,
          requestId: req.requestId,
        });
      } finally {
        scope.dispose();
      }
    }
  }
}

/** Browser → provider. Fastest path, but subject to CORS. */
export class DirectTransport extends BaseTransport {
  public readonly mode: TransportMode = 'direct';
}

/** Browser → local Node sidecar → provider. Solves CORS / forbidden headers. */
export class ProxyTransport extends BaseTransport {
  public readonly mode: TransportMode = 'proxy';
}

const DIRECT = new DirectTransport();
const PROXY = new ProxyTransport();

/** Factory used by the engine (injected through EngineDeps for testability). */
export function createTransport(mode: TransportMode): Transport {
  return mode === 'proxy' ? PROXY : DIRECT;
}

/** Quick health check for the sidecar, used by the config UI. */
export async function pingProxySidecar(timeoutMs = 3000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${getProxyBase()}/health`, {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Heuristic: a network-category failure on a direct transport is usually CORS. */
export function looksLikeCors(category: ErrorCategory, mode: TransportMode): boolean {
  return category === ERROR_CATEGORY.NETWORK && mode === 'direct';
}

/** Debug helper — never logs the Authorization header value. */
export function logRequest(req: HttpRequest, note: string): void {
  logger.info('SYS', `${note} ${req.method} ${req.url} [${req.requestId}]`);
}
