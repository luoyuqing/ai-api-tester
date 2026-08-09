import dayjs from 'dayjs';
import type { LatencyStats } from '@/types';

/**
 * High-resolution clock. `performance.now()` is sub-millisecond and monotonic,
 * which is why every latency measurement uses it instead of Date.now().
 */
export function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Simple stopwatch used by adapters: `const sw = stopwatch(); ... sw.elapsed()`. */
export interface Stopwatch {
  readonly t0: number;
  elapsed(): number;
}

export function stopwatch(): Stopwatch {
  const t0 = now();
  return {
    t0,
    elapsed: () => now() - t0,
  };
}

/** Sleep that rejects when the signal aborts. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Arithmetic mean, null for an empty sample. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((acc, v) => acc + v, 0);
  return total / values.length;
}

/** Population standard deviation, null for an empty sample. */
export function stddev(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const m = mean(values);
  if (m === null) return null;
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Linear-interpolated percentile.
 * @param values unsorted samples
 * @param p 0-100
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const weight = rank - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

/** mean / p50 / p95 / min / max — the standard latency report (architecture §7.3). */
export function computeLatencyStats(values: readonly number[]): LatencyStats {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) {
    return { count: 0, mean: null, p50: null, p95: null, min: null, max: null };
  }
  return {
    count: clean.length,
    mean: round(mean(clean)),
    p50: round(percentile(clean, 50)),
    p95: round(percentile(clean, 95)),
    min: round(Math.min(...clean)),
    max: round(Math.max(...clean)),
  };
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

/** "820ms" / "3.2s" / "1m 05s" */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/** Local, human-readable timestamp. */
export function formatTimestamp(ts: number | null | undefined): string {
  if (!ts) return '—';
  return dayjs(ts).format('YYYY-MM-DD HH:mm:ss');
}

/** ISO 8601 UTC — the canonical export format (architecture §7.5). */
export function toIsoUtc(ts: number | null | undefined): string {
  if (!ts) return '';
  return dayjs(ts).toISOString();
}

/** "88.0%" */
export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** "128k" / "204.8k" / "4096" */
export function formatTokens(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined || !Number.isFinite(tokens)) return '—';
  if (tokens >= 1000) return `${(tokens / 1024).toFixed(tokens % 1024 === 0 ? 0 : 1)}k`;
  return String(tokens);
}
