import type { CallOptions, ChatOutcome, Modality, MultimodalInput, TokenUsage } from '@/types';
import { HttpError, truncateSnippet } from '@/lib/http';
import { ERROR_CATEGORY, matchProviderErrorMessage } from '@/constants/errorCodes';
import { OpenAIChatAdapter } from '@/engine/adapters/OpenAIChatAdapter';
import { EvaluationError } from '@/engine/errors';

interface ChatCompletionBody {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; type?: string; code?: string };
}

/** `data:audio/wav;base64,AAAA` → `{ mime: 'audio/wav', base64: 'AAAA' }`. */
export function splitDataUrl(dataUrl: string): { mime: string; base64: string } {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return { mime: 'application/octet-stream', base64: '' };
  return { mime: match[1], base64: match[3] ?? '' };
}

/** `audio/wav` → `wav` (the `format` field expected by input_audio parts). */
export function mimeToFormat(mime: string): string {
  const subtype = mime.split('/')[1] ?? '';
  return subtype.replace(/^x-/, '').split(';')[0] || 'bin';
}

/**
 * FUNC-03 probe adapter.
 *
 * Builds OpenAI-style multimodal `content parts` and reports whether the
 * endpoint accepted them. Always non-streaming: what matters is acceptance,
 * not first-token latency.
 */
export class MultimodalAdapter extends OpenAIChatAdapter {
  public async multimodal(input: MultimodalInput, opt: CallOptions): Promise<ChatOutcome> {
    const payload: Record<string, unknown> = {
      model: this.provider.model,
      stream: false,
      max_tokens: input.modality === 'image' ? 128 : 200,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: input.prompt }, this.buildMediaPart(input)],
        },
      ],
    };

    try {
      const { response, json, e2eMs } = await this.callJson({
        path: '/chat/completions',
        payload,
        opt,
      });
      const body = json as ChatCompletionBody | null;

      if (body?.error) {
        const message = body.error.message ?? '多模态请求返回错误';
        return this.failure(message, matchProviderErrorMessage(message), e2eMs, response.status, response.bodyText);
      }
      if (!body?.choices?.length) {
        return this.failure(
          '响应缺少 choices，无法判定多模态支持度',
          ERROR_CATEGORY.PARSE,
          e2eMs,
          response.status,
          response.bodyText,
        );
      }

      const usage: TokenUsage | undefined = body.usage
        ? {
            promptTokens: body.usage.prompt_tokens,
            completionTokens: body.usage.completion_tokens,
            totalTokens: body.usage.total_tokens,
          }
        : undefined;

      return {
        ok: true,
        text: body.choices[0]?.message?.content ?? '',
        ttftMs: null,
        e2eMs,
        status: response.status,
        errorCategory: ERROR_CATEGORY.NONE,
        retried: response.retried,
        finishReason: body.choices[0]?.finish_reason ?? undefined,
        usage,
        rawSnippet: truncateSnippet(response.bodyText),
        streamed: false,
      };
    } catch (err) {
      const wrapped = EvaluationError.from(err, { providerId: this.provider.id });
      return {
        ok: false,
        text: '',
        ttftMs: null,
        e2eMs: 0,
        status: err instanceof HttpError ? err.status : undefined,
        errorCategory: wrapped.category,
        retried: wrapped.retried,
        errorMessage: wrapped.message,
        rawSnippet: wrapped.snippet,
        streamed: false,
      };
    }
  }

  /** Content part for one modality, following the de-facto OpenAI conventions. */
  private buildMediaPart(input: MultimodalInput): Record<string, unknown> {
    const modality: Modality = input.modality;
    if (modality === 'image') {
      return { type: 'image_url', image_url: { url: input.dataUrl, detail: 'low' } };
    }
    if (modality === 'audio') {
      const { mime, base64 } = splitDataUrl(input.dataUrl);
      return {
        type: 'input_audio',
        input_audio: { data: base64, format: mimeToFormat(input.mimeType || mime) },
      };
    }
    return { type: 'video_url', video_url: { url: input.dataUrl } };
  }

  private failure(
    message: string,
    category: ReturnType<typeof matchProviderErrorMessage>,
    e2eMs: number,
    status: number,
    bodyText: string,
  ): ChatOutcome {
    return {
      ok: false,
      text: '',
      ttftMs: null,
      e2eMs,
      status,
      errorCategory: category ?? ERROR_CATEGORY.BAD_REQUEST,
      retried: 0,
      errorMessage: message,
      rawSnippet: truncateSnippet(bodyText),
      streamed: false,
    };
  }
}

export default MultimodalAdapter;
