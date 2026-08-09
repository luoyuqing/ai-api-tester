import type { LogLevel, LogLine, LogTag } from '@/types';
import { DEBUG_ENABLED, LOG_BUFFER_LIMIT } from '@/constants/defaults';
import { nextShortId } from '@/lib/id';

/**
 * Ring-buffer logger.
 *
 * Hard rule (architecture §7.2): API keys must NEVER reach the log. Every
 * message passes through `redactSecrets()` before it is stored or printed.
 */

const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  // OpenAI-style keys: sk-xxxx / sk-proj-xxxx
  /\b(sk-[A-Za-z0-9]{0,8}-?)[A-Za-z0-9_-]{8,}\b/g,
  // Bearer tokens
  /\b(Bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi,
  // Generic api key assignments
  /("?(?:api[_-]?key|apikey|access[_-]?token|authorization)"?\s*[:=]\s*"?)([^"\s,}]{6,})/gi,
  // Anthropic / Google style
  /\b(sk-ant-)[A-Za-z0-9_-]{8,}\b/g,
  /\b(AIza)[A-Za-z0-9_-]{20,}\b/g,
];

/** Replace secret-looking substrings with a masked form. */
export function redactSecrets(input: string): string {
  let output = String(input ?? '');
  output = output.replace(SECRET_PATTERNS[0], '$1***');
  output = output.replace(SECRET_PATTERNS[1], '$1***');
  output = output.replace(SECRET_PATTERNS[2], '$1***');
  output = output.replace(SECRET_PATTERNS[3], '$1***');
  output = output.replace(SECRET_PATTERNS[4], '$1***');
  return output;
}

export type LogSubscriber = (line: LogLine) => void;

class RingLogger {
  private buffer: LogLine[] = [];

  private readonly limit: number;

  private subscribers = new Set<LogSubscriber>();

  public constructor(limit: number = LOG_BUFFER_LIMIT) {
    this.limit = limit;
  }

  /** Append a line; oldest entries are dropped once the cap is reached. */
  public push(level: LogLevel, tag: LogTag, message: string, providerName?: string): LogLine {
    const line: LogLine = {
      id: nextShortId(),
      level,
      tag,
      providerName,
      message: redactSecrets(message),
      ts: Date.now(),
    };
    this.buffer.push(line);
    if (this.buffer.length > this.limit) {
      this.buffer.splice(0, this.buffer.length - this.limit);
    }
    this.subscribers.forEach((fn) => {
      try {
        fn(line);
      } catch {
        /* a broken subscriber must not break logging */
      }
    });
    if (DEBUG_ENABLED) {
      const printer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      printer(`[${tag}]${providerName ? ` ${providerName}` : ''} ${line.message}`);
    }
    return line;
  }

  public info(tag: LogTag, message: string, providerName?: string): LogLine {
    return this.push('info', tag, message, providerName);
  }

  public warn(tag: LogTag, message: string, providerName?: string): LogLine {
    return this.push('warn', tag, message, providerName);
  }

  public error(tag: LogTag, message: string, providerName?: string): LogLine {
    return this.push('error', tag, message, providerName);
  }

  public success(tag: LogTag, message: string, providerName?: string): LogLine {
    return this.push('success', tag, message, providerName);
  }

  public list(): LogLine[] {
    return this.buffer.slice();
  }

  public clear(): void {
    this.buffer = [];
  }

  public subscribe(fn: LogSubscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  /** Plain-text dump for the "copy logs" action. */
  public toText(): string {
    return this.buffer
      .map((l) => {
        const time = new Date(l.ts).toISOString();
        const who = l.providerName ? ` ${l.providerName}` : '';
        return `${time} [${l.tag}]${who} ${l.message}`;
      })
      .join('\n');
  }
}

export const logger = new RingLogger();

/**
 * Format a log line the way the console expects (architecture §7.8):
 * `[PERF] GPT-4o TTFT=820ms 耗时=3.2s ✓`
 */
export function formatLogLine(line: LogLine): string {
  const time = new Date(line.ts).toLocaleTimeString('zh-CN', { hour12: false });
  const who = line.providerName ? ` ${line.providerName}` : '';
  return `${time} [${line.tag}]${who} ${line.message}`;
}

export default logger;
