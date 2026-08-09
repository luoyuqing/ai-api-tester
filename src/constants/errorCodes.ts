import type { ErrorCategory } from '@/types';

/**
 * Error taxonomy (architecture §7.1).
 * Classification priority: exception type > HTTP status > response body text.
 */
export const ERROR_CATEGORY = {
  NONE: 'none',
  NETWORK: 'network',
  AUTH: 'auth',
  RATE_LIMIT: 'rate_limit',
  TIMEOUT: 'timeout',
  SERVER: 'server',
  BAD_REQUEST: 'bad_request',
  CONTEXT_EXCEEDED: 'context_exceeded',
  PARSE: 'parse',
  UNKNOWN: 'unknown',
} as const;

export const ALL_ERROR_CATEGORIES: readonly ErrorCategory[] = [
  'none',
  'network',
  'auth',
  'rate_limit',
  'timeout',
  'server',
  'bad_request',
  'context_exceeded',
  'parse',
  'unknown',
];

export const ERROR_CATEGORY_LABELS: Record<ErrorCategory, string> = {
  none: '成功',
  network: '网络/CORS',
  auth: '鉴权失败',
  rate_limit: '限流',
  timeout: '超时',
  server: '服务端错误',
  bad_request: '请求错误',
  context_exceeded: '超出上下文',
  parse: '解析失败',
  unknown: '未知错误',
};

/** Status codes that justify an automatic retry. */
export const RETRYABLE_STATUS: readonly number[] = [408, 409, 425, 429, 500, 502, 503, 504];

export const RETRYABLE_CATEGORIES: readonly ErrorCategory[] = ['rate_limit', 'server', 'network'];

/**
 * Map an HTTP status code to an error category.
 * 401/403 → auth; 429 → rate_limit; 5xx → server; 4xx → bad_request.
 */
export function httpStatusToCategory(status: number): ErrorCategory {
  if (status >= 200 && status < 300) return ERROR_CATEGORY.NONE;
  if (status === 401 || status === 403) return ERROR_CATEGORY.AUTH;
  if (status === 429) return ERROR_CATEGORY.RATE_LIMIT;
  if (status === 408 || status === 504) return ERROR_CATEGORY.TIMEOUT;
  if (status >= 500) return ERROR_CATEGORY.SERVER;
  if (status >= 400) return ERROR_CATEGORY.BAD_REQUEST;
  return ERROR_CATEGORY.UNKNOWN;
}

/** Frozen lookup table kept for direct reference by tests / docs. */
export const HTTP_STATUS_TO_CATEGORY: Readonly<Record<number, ErrorCategory>> = Object.freeze({
  400: ERROR_CATEGORY.BAD_REQUEST,
  401: ERROR_CATEGORY.AUTH,
  403: ERROR_CATEGORY.AUTH,
  404: ERROR_CATEGORY.BAD_REQUEST,
  408: ERROR_CATEGORY.TIMEOUT,
  413: ERROR_CATEGORY.CONTEXT_EXCEEDED,
  422: ERROR_CATEGORY.BAD_REQUEST,
  429: ERROR_CATEGORY.RATE_LIMIT,
  500: ERROR_CATEGORY.SERVER,
  502: ERROR_CATEGORY.SERVER,
  503: ERROR_CATEGORY.SERVER,
  504: ERROR_CATEGORY.TIMEOUT,
});

/** Vendor error-text fingerprints, checked in declaration order. */
const MESSAGE_PATTERNS: ReadonlyArray<{ re: RegExp; category: ErrorCategory }> = [
  { re: /context[_\s-]?length|maximum context|context window|too many tokens|reduce the length/i, category: ERROR_CATEGORY.CONTEXT_EXCEEDED },
  { re: /rate[_\s-]?limit|too many requests|quota exceeded|请求过于频繁/i, category: ERROR_CATEGORY.RATE_LIMIT },
  { re: /invalid[_\s-]?api[_\s-]?key|unauthorized|authentication|permission denied|无效的?密钥/i, category: ERROR_CATEGORY.AUTH },
  { re: /timed?[_\s-]?out|deadline exceeded|超时/i, category: ERROR_CATEGORY.TIMEOUT },
  { re: /internal server error|service unavailable|bad gateway|upstream error|服务暂不可用/i, category: ERROR_CATEGORY.SERVER },
  { re: /invalid[_\s-]?request|unsupported|model[_\s-]?not[_\s-]?found|does not exist|参数错误/i, category: ERROR_CATEGORY.BAD_REQUEST },
  { re: /failed to fetch|network ?error|load failed|ERR_|CORS/i, category: ERROR_CATEGORY.NETWORK },
];

/**
 * Inspect a provider error payload/message and return a category, or null when
 * nothing matches (caller should keep the status-derived category).
 */
export function matchProviderErrorMessage(text: string | null | undefined): ErrorCategory | null {
  if (!text) return null;
  for (const { re, category } of MESSAGE_PATTERNS) {
    if (re.test(text)) return category;
  }
  return null;
}

/**
 * Classify a thrown exception. Highest priority in the taxonomy.
 * @param err arbitrary thrown value
 * @param timedOut set when the caller knows the abort came from its own timeout
 */
export function exceptionToCategory(err: unknown, timedOut = false): ErrorCategory {
  if (timedOut) return ERROR_CATEGORY.TIMEOUT;
  if (err instanceof DOMException) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return ERROR_CATEGORY.TIMEOUT;
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return ERROR_CATEGORY.TIMEOUT;
    if (err.name === 'TypeError' || /failed to fetch|load failed|networkerror/i.test(err.message)) {
      return ERROR_CATEGORY.NETWORK;
    }
    if (err.name === 'SyntaxError') return ERROR_CATEGORY.PARSE;
    const byMessage = matchProviderErrorMessage(err.message);
    if (byMessage) return byMessage;
  }
  return ERROR_CATEGORY.UNKNOWN;
}

/** True when a failure category is worth retrying. */
export function isRetryableCategory(category: ErrorCategory): boolean {
  return RETRYABLE_CATEGORIES.includes(category);
}
