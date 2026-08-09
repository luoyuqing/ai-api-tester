import type { CallOptions, ImageOutcome, ImageResultItem } from '@/types';
import { HttpError, truncateSnippet } from '@/lib/http';
import { ERROR_CATEGORY, matchProviderErrorMessage } from '@/constants/errorCodes';
import { OpenAIChatAdapter } from '@/engine/adapters/OpenAIChatAdapter';
import { EvaluationError } from '@/engine/errors';

/** Shape of a `/images/generations` response. */
interface ImageResponseBody {
  created?: number;
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  error?: { message?: string; type?: string; code?: string };
}

/** Default generation parameters — kept small to limit evaluation cost. */
const DEFAULT_IMAGE_SIZE = '1024x1024';

/**
 * `/v1/images/generations` adapter.
 *
 * Inherits the chat/ping plumbing so an image endpoint that also exposes chat
 * (One-API, vLLM gateways, …) can still be reached for connectivity checks.
 */
export class OpenAIImageAdapter extends OpenAIChatAdapter {
  public async image(prompt: string, opt: CallOptions): Promise<ImageOutcome> {
    const model = this.provider.imageModel ?? this.provider.model;
    const basePayload: Record<string, unknown> = {
      model,
      prompt,
      n: 1,
      size: DEFAULT_IMAGE_SIZE,
      response_format: 'b64_json',
    };

    const first = await this.tryImageCall(basePayload, opt);
    if (first.ok || !this.shouldRetryWithoutOptionals(first)) return first;

    // Some gateways reject `response_format` / `size`; retry with the minimum body.
    const minimal: Record<string, unknown> = { model, prompt, n: 1 };
    const second = await this.tryImageCall(minimal, opt);
    if (second.ok) return second;
    return {
      ...second,
      errorMessage: `${second.errorMessage ?? '生图请求失败'}（已尝试去除 response_format/size 后重试）`,
    };
  }

  /** True when the failure looks like an unsupported optional parameter. */
  private shouldRetryWithoutOptionals(outcome: ImageOutcome): boolean {
    if (outcome.errorCategory !== ERROR_CATEGORY.BAD_REQUEST) return false;
    const text = `${outcome.errorMessage ?? ''} ${outcome.rawSnippet ?? ''}`;
    return /response_format|size|unsupported|unknown (parameter|field)/i.test(text);
  }

  private async tryImageCall(
    payload: Record<string, unknown>,
    opt: CallOptions,
  ): Promise<ImageOutcome> {
    try {
      const { response, json, e2eMs, telemetry } = await this.callJson({
        path: '/images/generations',
        payload,
        opt,
      });

      const body = json as ImageResponseBody | null;
      if (body?.error) {
        const message = body.error.message ?? '生图服务返回错误';
        return {
          ok: false,
          images: [],
          e2eMs,
          status: response.status,
          errorCategory: matchProviderErrorMessage(message) ?? ERROR_CATEGORY.SERVER,
          retried: response.retried,
          errorMessage: message,
          rawSnippet: truncateSnippet(response.bodyText),
        };
      }

      if (!body || !Array.isArray(body.data)) {
        return {
          ok: false,
          images: [],
          e2eMs,
          status: response.status,
          errorCategory: ERROR_CATEGORY.PARSE,
          retried: response.retried,
          errorMessage: '响应缺少 data 数组，无法解析生图结果',
          rawSnippet: truncateSnippet(response.bodyText),
        };
      }

      const images: ImageResultItem[] = body.data.map((d) => ({
        b64Json: d.b64_json,
        url: d.url,
        revisedPrompt: d.revised_prompt,
      }));

      return {
        ok: images.length > 0,
        images,
        e2eMs,
        status: response.status,
        errorCategory: images.length > 0 ? ERROR_CATEGORY.NONE : ERROR_CATEGORY.PARSE,
        retried: telemetry.retried,
        errorMessage: images.length > 0 ? undefined : 'data 数组为空',
      };
    } catch (err) {
      const wrapped = EvaluationError.from(err, { providerId: this.provider.id });
      return {
        ok: false,
        images: [],
        e2eMs: 0,
        status: err instanceof HttpError ? err.status : undefined,
        errorCategory: wrapped.category,
        retried: wrapped.retried,
        errorMessage: wrapped.message,
        rawSnippet: wrapped.snippet,
      };
    }
  }
}

export default OpenAIImageAdapter;
