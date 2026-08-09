/** ID helpers. All persisted entities use crypto.randomUUID (architecture §7.5). */

let shortCounter = 0;

/** RFC-4122 v4 UUID with a manual fallback for non-secure contexts. */
export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  // Fallback: getRandomValues-based v4
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Monotonically increasing short id, used for log line keys. */
export function nextShortId(): number {
  shortCounter += 1;
  return shortCounter;
}

/** Human-friendly short id, e.g. `req_k3f9a1`. */
export function shortId(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${rand}`;
}

/** Correlation id sent as `X-Request-Id`. */
export function requestId(): string {
  return `aiat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Deterministic secret vault reference for a provider. */
export function secretRefFor(providerId: string): string {
  return `secret:${providerId}`;
}
