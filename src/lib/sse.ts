import type { StreamChunk } from '@/types';

/**
 * Server-Sent Events parser.
 *
 * Handles the three things that break naive implementations:
 *  1. events split across network chunks (half lines are buffered)
 *  2. multi-line `data:` payloads (joined with \n per the spec)
 *  3. the OpenAI `data: [DONE]` sentinel
 */

const DONE_SENTINEL = '[DONE]';

interface RawEvent {
  event?: string;
  id?: string;
  dataLines: string[];
}

function emptyEvent(): RawEvent {
  return { dataLines: [] };
}

function toChunk(raw: RawEvent): StreamChunk | null {
  if (raw.dataLines.length === 0 && !raw.event && !raw.id) return null;
  const data = raw.dataLines.join('\n');
  return {
    data,
    event: raw.event,
    id: raw.id,
    done: data.trim() === DONE_SENTINEL,
  };
}

/**
 * Parse a text stream into SSE events.
 * The generator finishes after the `[DONE]` sentinel or when the stream ends.
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let current = emptyEvent();

  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Normalise CRLF / CR to LF so line splitting is uniform.
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line === '') {
          // Blank line terminates the current event.
          const chunk = toChunk(current);
          current = emptyEvent();
          if (chunk) {
            yield chunk;
            if (chunk.done) return;
          }
        } else if (line.startsWith(':')) {
          // Comment / keep-alive — ignore.
        } else {
          const colon = line.indexOf(':');
          const field = colon === -1 ? line : line.slice(0, colon);
          let content = colon === -1 ? '' : line.slice(colon + 1);
          if (content.startsWith(' ')) content = content.slice(1);

          if (field === 'data') current.dataLines.push(content);
          else if (field === 'event') current.event = content;
          else if (field === 'id') current.id = content;
          // `retry` is irrelevant for a one-shot evaluation request.
        }

        newlineIndex = buffer.indexOf('\n');
      }
    }

    // Flush whatever is left (some servers omit the trailing blank line).
    const tail = buffer.trim();
    if (tail.length > 0) {
      for (const line of tail.split('\n')) {
        if (line.startsWith('data:')) {
          current.dataLines.push(line.slice(5).replace(/^ /, ''));
        }
      }
    }
    const last = toChunk(current);
    if (last) yield last;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
}

/** Shape of an OpenAI streaming delta we care about. */
export interface OpenAIStreamDelta {
  content?: string;
  role?: string;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

export interface OpenAIStreamChoice {
  index?: number;
  delta?: OpenAIStreamDelta;
  finish_reason?: string | null;
}

export interface OpenAIStreamPayload {
  id?: string;
  object?: string;
  model?: string;
  choices?: OpenAIStreamChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; type?: string; code?: string };
}

/**
 * Safe JSON parse for one SSE `data:` payload.
 * Returns null for `[DONE]`, empty payloads and malformed JSON.
 */
export function parseOpenAIChunk(data: string): OpenAIStreamPayload | null {
  const trimmed = data.trim();
  if (!trimmed || trimmed === DONE_SENTINEL) return null;
  try {
    return JSON.parse(trimmed) as OpenAIStreamPayload;
  } catch {
    return null;
  }
}

/** Extract the text delta from a parsed chunk (empty string when absent). */
export function extractDeltaContent(payload: OpenAIStreamPayload | null): string {
  if (!payload?.choices?.length) return '';
  const delta = payload.choices[0]?.delta;
  return typeof delta?.content === 'string' ? delta.content : '';
}

/** Accumulator that reassembles streamed tool_call fragments. */
export class ToolCallAccumulator {
  private byIndex = new Map<number, { id?: string; name: string; args: string }>();

  public ingest(payload: OpenAIStreamPayload | null): void {
    const deltas = payload?.choices?.[0]?.delta?.tool_calls;
    if (!deltas?.length) return;
    deltas.forEach((tc, i) => {
      const index = typeof tc.index === 'number' ? tc.index : i;
      const existing = this.byIndex.get(index) ?? { name: '', args: '' };
      if (tc.id) existing.id = tc.id;
      if (tc.function?.name) existing.name += tc.function.name;
      if (tc.function?.arguments) existing.args += tc.function.arguments;
      this.byIndex.set(index, existing);
    });
  }

  public isEmpty(): boolean {
    return this.byIndex.size === 0;
  }

  public list(): Array<{ id?: string; name: string; argumentsRaw: string }> {
    return Array.from(this.byIndex.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => ({ id: v.id, name: v.name, argumentsRaw: v.args }));
  }
}
