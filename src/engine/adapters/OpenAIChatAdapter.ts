import type {
  CallOptions,
  ChatInput,
  ChatOutcome,
  RequestTelemetry,
  ToolCallObserved,
  TokenUsage,
} from '@/types';
import { createTelemetry } from '@/types';
import { HttpError, truncateSnippet } from '@/lib/http';
import {
  ToolCallAccumulator,
  extractDeltaContent,
  parseOpenAIChunk,
  type OpenAIStreamPayload,
} from '@/lib/sse';
import { ERROR_CATEGORY, matchProviderErrorMessage } from '@/constants/errorCodes';
import { now } from '@/lib/timer';
import { OpenAICompatibleAdapter } from '@/engine/adapters/ProviderAdapter';
import { EvaluationError } from '@/engine/errors';

/** Shape of a non-streaming `/chat/completions` response we care about. */
interface ChatCompletionBody {
  choices?: Array<{
    index?: number;
    finish_reason?: string | null;
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; type?: string; code?: string };
}

function parseArguments(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function toUsage(raw: ChatCompletionBody['usage']): TokenUsage | undefined {
  if (!raw) return undefined;
  return {
    promptTokens: raw.prompt_tokens,
    completionTokens: raw.completion_tokens,
    totalTokens: raw.total_tokens,
  };
}

/**
 * `/v1/chat/completions` adapter — streaming and non-streaming.
 *
 * Timing rules (architecture §7.3):
 *  - `t0` is captured by the Transport on the line right before `fetch()`
 *  - `ttftMs` = arrival of the first SSE event carrying a non-empty
 *    `delta.content` − t0 (falls back to the first byte for tool-call-only
 *    replies, which legitimately never produce a content delta)
 *  - `e2eMs` = `[DONE]` / full parse completion − t0
 *  - non-streaming calls report `ttftMs = null`
 */
export class OpenAIChatAdapter extends OpenAICompatibleAdapter {
  public async chat(input: ChatInput, opt: CallOptions): Promise<ChatOutcome> {
    const wantStream = opt.stream !== false && this.provider.supportsStream;
    return wantStream ? this.chatStreaming(input, opt) : this.chatBlocking(input, opt);
  }

  /** Body shared by both modes. */
  protected buildPayload(input: ChatInput, opt: CallOptions, stream: boolean): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: this.provider.model,
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      stream,
    };
    const maxTokens = input.maxTokens ?? opt.maxTokens;
    if (typeof maxTokens === 'number') payload.max_tokens = maxTokens;
    const temperature = input.temperature ?? opt.temperature;
    if (typeof temperature === 'number') payload.temperature = temperature;
    if (input.tools && input.tools.length > 0) {
      payload.tools = input.tools;
      payload.tool_choice = input.toolChoice ?? 'auto';
    }
    if (input.responseFormatJson) payload.response_format = { type: 'json_object' };
    if (stream) payload.stream_options = { include_usage: true };
    if (input.extraBody) Object.assign(payload, input.extraBody);
    return payload;
  }

  // ───────────────────────── streaming ─────────────────────────

  private async chatStreaming(input: ChatInput, opt: CallOptions): Promise<ChatOutcome> {
    const telemetry = createTelemetry();
    const req = this.buildRequest({
      path: '/chat/completions',
      payload: this.buildPayload(input, opt, true),
      opt,
      telemetry,
      extraHeaders: { Accept: 'text/event-stream' },
    });
    const transport = this.transportFor(opt);

    let text = '';
    let ttftMs: number | null = null;
    let finishReason: string | undefined;
    let usage: TokenUsage | undefined;
    let inlineError: { message: string; code?: string } | null = null;
    const tools = new ToolCallAccumulator();

    try {
      for await (const chunk of transport.stream(req, opt.signal)) {
        if (chunk.done) break;
        const payload: OpenAIStreamPayload | null = parseOpenAIChunk(chunk.data);
        if (!payload) continue;
        if (payload.error) {
          inlineError = { message: payload.error.message ?? '流式响应返回错误', code: payload.error.code };
          break;
        }
        const delta = extractDeltaContent(payload);
        if (delta.length > 0) {
          if (ttftMs === null && telemetry.t0 !== null) ttftMs = now() - telemetry.t0;
          text += delta;
        }
        tools.ingest(payload);
        const reason = payload.choices?.[0]?.finish_reason;
        if (reason) finishReason = reason;
        if (payload.usage) usage = toUsage(payload.usage);
      }
    } catch (err) {
      return this.toFailure(err, telemetry, true);
    }

    const e2eMs = this.elapsedSince(telemetry);

    if (inlineError) {
      return {
        ok: false,
        text,
        ttftMs,
        e2eMs,
        status: telemetry.status ?? undefined,
        errorCategory: matchProviderErrorMessage(inlineError.message) ?? ERROR_CATEGORY.SERVER,
        retried: telemetry.retried,
        errorMessage: inlineError.message,
        rawSnippet: truncateSnippet(inlineError.message),
        streamed: true,
      };
    }

    const toolCalls = this.collectStreamedTools(tools);
    // Tool-call-only replies never emit a content delta: use the first byte.
    if (ttftMs === null && toolCalls.length > 0 && telemetry.t0 !== null && telemetry.firstByteAt !== null) {
      ttftMs = telemetry.firstByteAt - telemetry.t0;
    }

    return {
      ok: true,
      text,
      ttftMs: ttftMs === null ? null : Math.round(ttftMs * 10) / 10,
      e2eMs,
      status: telemetry.status ?? 200,
      errorCategory: ERROR_CATEGORY.NONE,
      retried: telemetry.retried,
      finishReason,
      usage,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      rawSnippet: truncateSnippet(text),
      streamed: true,
    };
  }

  private collectStreamedTools(acc: ToolCallAccumulator): ToolCallObserved[] {
    if (acc.isEmpty()) return [];
    return acc.list().map((t) => ({
      id: t.id,
      name: t.name,
      argumentsRaw: t.argumentsRaw,
      argumentsParsed: parseArguments(t.argumentsRaw),
    }));
  }

  // ───────────────────────── non-streaming ─────────────────────────

  private async chatBlocking(input: ChatInput, opt: CallOptions): Promise<ChatOutcome> {
    const telemetry = createTelemetry();
    try {
      const req = this.buildRequest({
        path: '/chat/completions',
        payload: this.buildPayload(input, opt, false),
        opt,
        telemetry,
      });
      const transport = this.transportFor(opt);
      const response = await transport.request(req, opt.signal);
      const e2eMs = this.elapsedSince(telemetry);

      let body: ChatCompletionBody | null = null;
      try {
        body = JSON.parse(response.bodyText) as ChatCompletionBody;
      } catch {
        return {
          ok: false,
          text: '',
          ttftMs: null,
          e2eMs,
          status: response.status,
          errorCategory: ERROR_CATEGORY.PARSE,
          retried: response.retried,
          errorMessage: '响应不是合法 JSON',
          rawSnippet: truncateSnippet(response.bodyText),
          streamed: false,
        };
      }

      // Some gateways return HTTP 200 with an error envelope.
      if (body?.error) {
        const message = body.error.message ?? '服务返回错误';
        return {
          ok: false,
          text: '',
          ttftMs: null,
          e2eMs,
          status: response.status,
          errorCategory: matchProviderErrorMessage(message) ?? ERROR_CATEGORY.SERVER,
          retried: response.retried,
          errorMessage: message,
          rawSnippet: truncateSnippet(response.bodyText),
          streamed: false,
        };
      }

      const choice = body?.choices?.[0];
      const text = choice?.message?.content ?? '';
      const toolCalls: ToolCallObserved[] = (choice?.message?.tool_calls ?? []).map((t) => ({
        id: t.id,
        name: t.function?.name ?? '',
        argumentsRaw: t.function?.arguments ?? '',
        argumentsParsed: parseArguments(t.function?.arguments ?? ''),
      }));

      return {
        ok: true,
        text,
        ttftMs: null,
        e2eMs,
        status: response.status,
        errorCategory: ERROR_CATEGORY.NONE,
        retried: response.retried,
        finishReason: choice?.finish_reason ?? undefined,
        usage: toUsage(body?.usage),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        rawSnippet: truncateSnippet(response.bodyText),
        streamed: false,
      };
    } catch (err) {
      return this.toFailure(err, telemetry, false);
    }
  }

  /** Normalise any thrown transport error into a failed ChatOutcome. */
  protected toFailure(err: unknown, telemetry: RequestTelemetry, streamed: boolean): ChatOutcome {
    const wrapped = EvaluationError.from(err, { providerId: this.provider.id });
    return {
      ok: false,
      text: '',
      ttftMs: null,
      e2eMs: this.elapsedSince(telemetry),
      status: err instanceof HttpError ? err.status : (telemetry.status ?? undefined),
      errorCategory: wrapped.category,
      retried: wrapped.retried || telemetry.retried,
      errorMessage: wrapped.message,
      rawSnippet: wrapped.snippet,
      streamed,
    };
  }
}

export default OpenAIChatAdapter;
