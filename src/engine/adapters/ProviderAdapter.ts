import type {
  CallOptions,
  ChatInput,
  ChatOutcome,
  ConnectivityResult,
  HandshakeOutcome,
  HttpMethod,
  HttpRequest,
  HttpResponse,
  ImageOutcome,
  MultimodalInput,
  Provider,
  ProtocolKind,
  RequestTelemetry,
  Transport,
  TransportMode,
} from '@/types';
import { createTelemetry } from '@/types';
import { HttpError, truncateSnippet } from '@/lib/http';
import { ERROR_CATEGORY } from '@/constants/errorCodes';
import { requestId as newRequestId } from '@/lib/id';
import { now } from '@/lib/timer';
import { EvaluationError } from '@/engine/errors';

/**
 * Protocol adapter contract (architecture §3.2).
 *
 * An adapter converts the neutral evaluation input into a provider-specific
 * HTTP payload and measures timings. It never scores, never retries (retry is
 * centralised in lib/http.ts) and never touches persistence.
 */
export interface ProviderAdapter {
  readonly kind: ProtocolKind;
  readonly provider: Provider;
  chat(input: ChatInput, opt: CallOptions): Promise<ChatOutcome>;
  image?(prompt: string, opt: CallOptions): Promise<ImageOutcome>;
  multimodal?(input: MultimodalInput, opt: CallOptions): Promise<ChatOutcome>;
  handshake?(framework: string, opt: HandshakeCallOptions): Promise<HandshakeOutcome>;
  ping(opt: CallOptions): Promise<ConnectivityResult>;
}

/** Agent handshake needs the case prompt on top of the standard call options. */
export interface HandshakeCallOptions extends CallOptions {
  /** Case prompt; the adapter falls back to a builtin default when omitted. */
  prompt?: string;
  /** Case id, echoed into the evidence lines. */
  caseId?: string;
}

/** Everything an adapter needs to talk to one provider. */
export interface AdapterDeps {
  provider: Provider;
  /** Plaintext API key — memory only, never logged or persisted. */
  secret: string;
  transport: Transport;
  /** Optional factory enabling per-call `transportOverride`. */
  resolveTransport?: (mode: TransportMode) => Transport;
}

/** Raw result of one JSON round-trip, with the timings the probes need. */
export interface JsonCallResult {
  response: HttpResponse;
  /** JSON.parse'd body; null when the body was not valid JSON. */
  json: Record<string, unknown> | null;
  telemetry: RequestTelemetry;
  e2eMs: number;
}

/** Join an endpoint base with an API path, tolerating a fully-qualified base. */
export function joinUrl(base: string, path: string): string {
  const trimmed = base.trim().replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  if (trimmed.toLowerCase().endsWith(suffix.toLowerCase())) return trimmed;
  return `${trimmed}${suffix}`;
}

/** Append a query parameter without clobbering an existing query string. */
export function appendQueryParam(url: string, key: string, value: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

/** Approximate token count: CJK chars count as 1, latin words as ~1.3. */
export function approxTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const rest = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ');
  const words = rest.split(/\s+/).filter(Boolean).length;
  return Math.round(cjk + words * 1.3);
}

/**
 * Shared implementation for every OpenAI-compatible endpoint.
 * Subclasses only add payload shaping for their specific route.
 */
export abstract class OpenAICompatibleAdapter implements ProviderAdapter {
  public readonly kind: ProtocolKind = 'openai-compatible';

  public readonly provider: Provider;

  protected readonly secret: string;

  private readonly defaultTransport: Transport;

  private readonly transportFactory?: (mode: TransportMode) => Transport;

  public constructor(deps: AdapterDeps) {
    this.provider = deps.provider;
    this.secret = deps.secret;
    this.defaultTransport = deps.transport;
    this.transportFactory = deps.resolveTransport;
  }

  public abstract chat(input: ChatInput, opt: CallOptions): Promise<ChatOutcome>;

  // ───────────────────────── infrastructure ─────────────────────────

  /** Transport for this call — honours `opt.transportOverride` when possible. */
  protected transportFor(opt: CallOptions): Transport {
    const override = opt.transportOverride;
    if (override && this.transportFactory && override !== this.defaultTransport.mode) {
      return this.transportFactory(override);
    }
    return this.defaultTransport;
  }

  /** Auth headers derived from the provider's auth style. */
  protected authHeaders(): Record<string, string> {
    const { auth } = this.provider;
    if (!this.secret) return {};
    if (auth.style === 'bearer') return { Authorization: `Bearer ${this.secret}` };
    if (auth.style === 'api-key-header') {
      return { [auth.headerName && auth.headerName.length > 0 ? auth.headerName : 'x-api-key']: this.secret };
    }
    return {};
  }

  /** Full URL for an API path, including the query-param auth style. */
  protected urlFor(path: string): string {
    const base = joinUrl(this.provider.endpoint, path);
    if (this.provider.auth.style === 'query-param' && this.secret) {
      const key =
        this.provider.auth.queryParamName && this.provider.auth.queryParamName.length > 0
          ? this.provider.auth.queryParamName
          : 'key';
      return appendQueryParam(base, key, this.secret);
    }
    return base;
  }

  /** Assemble an HttpRequest with auth, telemetry and correlation id attached. */
  protected buildRequest(params: {
    path: string;
    method?: HttpMethod;
    payload?: unknown;
    opt: CallOptions;
    telemetry: RequestTelemetry;
    extraHeaders?: Record<string, string>;
  }): HttpRequest {
    const { path, method = 'POST', payload, opt, telemetry, extraHeaders } = params;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.authHeaders(),
      ...(this.provider.extraHeaders ?? {}),
      ...(extraHeaders ?? {}),
    };
    if (method === 'GET') delete headers['Content-Type'];
    return {
      url: this.urlFor(path),
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      timeoutMs: opt.timeoutMs > 0 ? opt.timeoutMs : this.provider.timeoutMs,
      requestId: opt.requestId ?? newRequestId(),
      transport: opt.transportOverride ?? this.provider.transport,
      maxRetries: opt.maxRetries ?? 0,
      telemetry,
    };
  }

  /** One non-streaming JSON round-trip. Throws HttpError on failure. */
  protected async callJson(params: {
    path: string;
    method?: HttpMethod;
    payload?: unknown;
    opt: CallOptions;
    extraHeaders?: Record<string, string>;
  }): Promise<JsonCallResult> {
    const telemetry = createTelemetry();
    const req = this.buildRequest({ ...params, telemetry });
    const transport = this.transportFor(params.opt);
    const response = await transport.request(req, params.opt.signal);
    const t0 = telemetry.t0 ?? now();
    const e2eMs = now() - t0;
    let json: Record<string, unknown> | null = null;
    try {
      json = response.bodyText ? (JSON.parse(response.bodyText) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    return { response, json, telemetry, e2eMs };
  }

  /** Elapsed time since the transport captured `t0` (falls back to 0). */
  protected elapsedSince(telemetry: RequestTelemetry): number {
    return telemetry.t0 === null ? 0 : Math.max(0, now() - telemetry.t0);
  }

  // ───────────────────────── connectivity ─────────────────────────

  /**
   * Cheapest possible reachability probe:
   *  1. `GET /models` — free on virtually every OpenAI-compatible gateway
   *  2. fall back to a 1-token chat completion when /models is not routed
   */
  public async ping(opt: CallOptions): Promise<ConnectivityResult> {
    const started = now();
    try {
      const { response } = await this.callJson({
        path: '/models',
        method: 'GET',
        opt: { ...opt, maxRetries: 0 },
      });
      return {
        ok: true,
        latencyMs: Math.round(now() - started),
        message: `连通正常（GET /models ${response.status}）`,
      };
    } catch (err) {
      const category = err instanceof HttpError ? err.category : ERROR_CATEGORY.UNKNOWN;
      // An auth failure is already conclusive — no point spending a chat call.
      if (category === ERROR_CATEGORY.AUTH) {
        return {
          ok: false,
          latencyMs: Math.round(now() - started),
          errorCategory: category,
          message: `鉴权失败：${err instanceof Error ? err.message : String(err)}`,
        };
      }
      return this.pingViaChat(opt, started, err);
    }
  }

  /** Minimal-cost fallback probe (max_tokens = 1). */
  private async pingViaChat(
    opt: CallOptions,
    started: number,
    previousError: unknown,
  ): Promise<ConnectivityResult> {
    try {
      const outcome = await this.chat(
        { messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 },
        { ...opt, stream: false, maxRetries: 0 },
      );
      if (outcome.ok) {
        return {
          ok: true,
          latencyMs: Math.round(outcome.e2eMs),
          message: `连通正常（chat 探测 ${Math.round(outcome.e2eMs)}ms）`,
        };
      }
      return {
        ok: false,
        latencyMs: Math.round(outcome.e2eMs),
        errorCategory: outcome.errorCategory,
        message: outcome.errorMessage ?? '探测请求失败',
      };
    } catch (err) {
      const wrapped = EvaluationError.from(err, { providerId: this.provider.id });
      const first = previousError instanceof Error ? previousError.message : String(previousError);
      return {
        ok: false,
        latencyMs: Math.round(now() - started),
        errorCategory: wrapped.category,
        message: `${wrapped.message}（/models 探测同样失败：${truncateSnippet(first, 160)}）`,
      };
    }
  }
}
