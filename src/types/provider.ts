/**
 * Provider domain types + the transport/adapter I/O contracts.
 * Single source of truth — never redeclare these shapes elsewhere.
 */
import type { ErrorCategory } from './metrics';
import type { ChatTurn } from './testcase';

// ───────────────────────── Provider ─────────────────────────

export type ProviderType = 'chat' | 'image' | 'multimodal' | 'agent';

/** MVP only implements `openai-compatible`; `custom` is the extension point. */
export type ProtocolKind = 'openai-compatible' | 'custom';

export type TransportMode = 'direct' | 'proxy';

export type AuthStyle = 'bearer' | 'api-key-header' | 'query-param';

export interface ProviderAuth {
  style: AuthStyle;
  /** Header name for `api-key-header` (e.g. `x-api-key`). */
  headerName?: string;
  /** Query param name for `query-param` (e.g. `key`). */
  queryParamName?: string;
}

export interface Provider {
  id: string;
  /** Display name, e.g. "GPT-4o". */
  name: string;
  type: ProviderType;
  protocol: ProtocolKind;
  /** Base URL without trailing slash, e.g. https://api.openai.com/v1 */
  endpoint: string;
  model: string;
  /** Points at an entry in the encrypted secret vault — never a plaintext key. */
  secretRef: string;
  auth: ProviderAuth;
  transport: TransportMode;
  /** Whether SSE streaming is available (drives TTFT collection). */
  supportsStream: boolean;
  extraHeaders?: Record<string, string>;
  timeoutMs: number;
  tags?: string[];
  /** Optional dedicated model id for image generation. */
  imageModel?: string;
  /** Free-form note shown in the UI. */
  note?: string;
  createdAt: number;
  updatedAt: number;
}

/** Form draft — id/timestamps are assigned on save. */
export type ProviderDraft = Omit<Provider, 'id' | 'createdAt' | 'updatedAt' | 'secretRef'> & {
  id?: string;
  secretRef?: string;
};

export interface ConnectivityResult {
  ok: boolean;
  latencyMs: number;
  errorCategory?: ErrorCategory;
  message: string;
  /** True when the failure looks like a browser CORS rejection → suggest proxy mode. */
  corsSuspected?: boolean;
}

// ───────────────────────── Transport ─────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Mutable telemetry slot filled in by the Transport.
 *
 * `t0` is captured on the line IMMEDIATELY before `fetch()` (architecture §7.3),
 * which is why it has to be produced inside lib/http.ts rather than by the
 * adapter — the adapter reads it back through this object.
 */
export interface RequestTelemetry {
  t0: number | null;
  /** performance.now() when the response headers arrived. */
  headersAt: number | null;
  /** performance.now() when the first body byte arrived. */
  firstByteAt: number | null;
  /** Retries consumed before the final attempt. */
  retried: number;
  status: number | null;
  ok: boolean;
}

export function createTelemetry(): RequestTelemetry {
  return { t0: null, headersAt: null, firstByteAt: null, retried: 0, status: null, ok: false };
}

export interface HttpRequest {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  /** Already-serialised body (JSON string) or undefined for GET. */
  body?: string;
  timeoutMs: number;
  /** Correlates logs across layers; sent as `X-Request-Id`. */
  requestId: string;
  /** Which transport implementation must handle this request. */
  transport: TransportMode;
  /** Retry budget for 429 / 5xx. Handled centrally in lib/http.ts. */
  maxRetries?: number;
  /** Filled in by the transport; read back by the adapter for exact timings. */
  telemetry?: RequestTelemetry;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Raw response body as text (callers parse JSON themselves). */
  bodyText: string;
  /** Retries actually performed before this response was produced. */
  retried: number;
}

/** One parsed SSE event. */
export interface StreamChunk {
  /** `data:` payload with the prefix stripped; multi-line data is joined by `\n`. */
  data: string;
  event?: string;
  id?: string;
  /** True for the terminal `data: [DONE]` sentinel. */
  done: boolean;
}

export interface StreamOpenInfo {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
}

/** Transport abstraction — direct (browser → provider) or proxy (browser → sidecar → provider). */
export interface Transport {
  readonly mode: TransportMode;
  request(req: HttpRequest, signal: AbortSignal): Promise<HttpResponse>;
  stream(req: HttpRequest, signal: AbortSignal): AsyncIterable<StreamChunk>;
}

// ───────────────────── Adapter I/O contracts ─────────────────────

export interface CallOptions {
  timeoutMs: number;
  signal: AbortSignal;
  /** Ask for SSE. Adapter falls back to non-streaming when the provider cannot. */
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  maxRetries?: number;
  requestId?: string;
  /**
   * Overrides the provider's default transport for this single call.
   * Only honoured when the adapter was built with a transport factory.
   */
  transportOverride?: TransportMode;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCallObserved {
  id?: string;
  name: string;
  /** Raw argument string as returned by the model. */
  argumentsRaw: string;
  /** Parsed arguments, null when the JSON was malformed. */
  argumentsParsed: Record<string, unknown> | null;
}

export interface ChatInput {
  messages: ChatTurn[];
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
  responseFormatJson?: boolean;
  /** Escape hatch for provider-specific body fields. */
  extraBody?: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatOutcome {
  ok: boolean;
  text: string;
  /** null for non-streaming calls (architecture §7.3). */
  ttftMs: number | null;
  e2eMs: number;
  status?: number;
  errorCategory: ErrorCategory;
  retried: number;
  finishReason?: string;
  usage?: TokenUsage;
  toolCalls?: ToolCallObserved[];
  /** Truncated raw body/first error line, ≤2000 chars. */
  rawSnippet?: string;
  /** Human-readable error message when ok === false. */
  errorMessage?: string;
  /** True when the adapter actually used SSE. */
  streamed: boolean;
}

export interface ImageResultItem {
  b64Json?: string;
  url?: string;
  revisedPrompt?: string;
}

export interface ImageOutcome {
  ok: boolean;
  images: ImageResultItem[];
  e2eMs: number;
  status?: number;
  errorCategory: ErrorCategory;
  retried: number;
  rawSnippet?: string;
  errorMessage?: string;
}

export type Modality = 'image' | 'audio' | 'video';

export interface MultimodalInput {
  modality: Modality;
  mimeType: string;
  /** data: URL with inline base64 payload. */
  dataUrl: string;
  prompt: string;
}

export type HandshakeLevel = 'pass' | 'partial' | 'fail';

export interface HandshakeOutcome {
  ok: boolean;
  framework: string;
  level: HandshakeLevel;
  /** Why this level was assigned — surfaced in the report. */
  reason: string;
  e2eMs: number;
  errorCategory: ErrorCategory;
  retried: number;
  evidence: string[];
  toolCalls?: ToolCallObserved[];
}
