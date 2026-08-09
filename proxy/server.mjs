#!/usr/bin/env node
/**
 * ai-api-tester — zero-dependency CORS / streaming forward proxy sidecar.
 *
 * Why: some AI providers do not emit `Access-Control-Allow-Origin`, and browsers
 * refuse to send certain headers. This sidecar forwards the request verbatim and
 * pipes the (possibly SSE) response straight back without buffering, so the
 * front-end TTFT measurement stays accurate.
 *
 * Requirements: Node >= 18 (uses node:http + global fetch + Web Streams). NO npm deps.
 *
 * Usage:
 *   node proxy/server.mjs --port 8787 --allow-origin http://localhost:5173
 *   node proxy/server.mjs --allow-origin "*" --verbose
 *
 * Protocol:
 *   POST/GET  http://localhost:8787/proxy
 *   header    x-target-url: https://api.openai.com/v1/chat/completions
 *   Everything else (method, body, remaining headers) is forwarded as-is.
 *
 *   GET       http://localhost:8787/health  -> {"ok":true,...}
 */

import http from 'node:http';
import { Readable } from 'node:stream';

// ─────────────────────────── CLI args ───────────────────────────

/**
 * Parse `--key value` / `--flag` style arguments.
 * @param {string[]} argv
 * @returns {Record<string, string | boolean>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const PORT = Number(args.port ?? 8787);
const TIMEOUT_MS = Number(args.timeout ?? 120000);
const VERBOSE = args.verbose === true || args.verbose === 'true';
const ALLOW_ORIGIN_RAW = String(args['allow-origin'] ?? 'http://localhost:5173');
const ALLOW_ALL = ALLOW_ORIGIN_RAW.trim() === '*';
const ALLOW_LIST = ALLOW_ORIGIN_RAW.split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Hop-by-hop headers must never be forwarded upstream.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'origin',
  'referer',
  'x-target-url',
  'accept-encoding',
]);

// Response headers we drop because Node re-computes them.
const STRIP_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'access-control-allow-origin',
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-expose-headers',
]);

const SECRET_PATTERN = /(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/g;

/**
 * Mask API keys before printing anything to stdout.
 * @param {string} text
 * @returns {string}
 */
function redact(text) {
  return String(text).replace(SECRET_PATTERN, '$1***');
}

/**
 * @param {string | undefined} origin
 * @returns {string | null} the value to echo back, or null when not allowed
 */
function resolveAllowedOrigin(origin) {
  if (ALLOW_ALL) return origin || '*';
  if (!origin) return null;
  return ALLOW_LIST.includes(origin) ? origin : null;
}

/**
 * @param {http.ServerResponse} res
 * @param {string | null} allowedOrigin
 */
function applyCorsHeaders(res, allowedOrigin) {
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,Authorization,X-Target-Url,X-Request-Id,X-Api-Key,Api-Key,Accept,Anthropic-Version',
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Type,X-Request-Id,X-Proxy-Upstream-Status,X-Proxy-Error',
  );
  res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Collect the incoming request body as a Buffer (undefined for GET/HEAD).
 * @param {http.IncomingMessage} req
 * @returns {Promise<Buffer | undefined>}
 */
function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    req.on('error', reject);
  });
}

// ─────────────────────────── server ───────────────────────────

const server = http.createServer(async (req, res) => {
  const origin = /** @type {string | undefined} */ (req.headers.origin);
  const allowedOrigin = resolveAllowedOrigin(origin);

  applyCorsHeaders(res, allowedOrigin);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(allowedOrigin || !origin ? 204 : 403);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (url.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'ai-api-tester-proxy',
      port: PORT,
      allowOrigin: ALLOW_ALL ? '*' : ALLOW_LIST,
      timeoutMs: TIMEOUT_MS,
      node: process.version,
    });
    return;
  }

  if (url.pathname !== '/proxy') {
    sendJson(res, 404, { error: 'not_found', message: 'Use POST /proxy with x-target-url header.' });
    return;
  }

  if (origin && !allowedOrigin) {
    sendJson(res, 403, {
      error: 'origin_not_allowed',
      message: `Origin ${origin} is not in the allow list. Restart with --allow-origin.`,
    });
    return;
  }

  // Target URL can come from the header or the `url` query param.
  const targetRaw =
    (typeof req.headers['x-target-url'] === 'string' ? req.headers['x-target-url'] : '') ||
    url.searchParams.get('url') ||
    '';

  if (!targetRaw) {
    sendJson(res, 400, {
      error: 'missing_target',
      message: 'Missing x-target-url header (or ?url= query param).',
    });
    return;
  }

  /** @type {URL} */
  let target;
  try {
    target = new URL(targetRaw);
  } catch {
    sendJson(res, 400, { error: 'bad_target', message: `Invalid target URL: ${targetRaw}` });
    return;
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    sendJson(res, 400, { error: 'bad_protocol', message: 'Only http/https targets are supported.' });
    return;
  }

  // Build upstream headers.
  /** @type {Record<string, string>} */
  const upstreamHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    upstreamHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }

  const body = await readBody(req).catch(() => undefined);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // Abort upstream when the browser disconnects.
  req.on('aborted', () => controller.abort());
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  const startedAt = Date.now();

  try {
    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers: upstreamHeaders,
      body,
      signal: controller.signal,
      redirect: 'follow',
      // @ts-expect-error Node-specific: allow streaming request bodies when present
      duplex: body ? 'half' : undefined,
    });

    /** @type {Record<string, string>} */
    const outHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) return;
      outHeaders[key] = value;
    });
    outHeaders['x-proxy-upstream-status'] = String(upstream.status);

    // Re-apply CORS (writeHead below replaces nothing already set via setHeader,
    // but be explicit so the values survive).
    if (allowedOrigin) outHeaders['access-control-allow-origin'] = allowedOrigin;
    outHeaders['access-control-expose-headers'] =
      'Content-Type,X-Request-Id,X-Proxy-Upstream-Status,X-Proxy-Error';

    res.writeHead(upstream.status, outHeaders);

    if (upstream.body) {
      // Stream passthrough — critical for SSE / TTFT accuracy: no buffering.
      const nodeStream = Readable.fromWeb(/** @type {any} */ (upstream.body));
      nodeStream.on('error', () => {
        if (!res.writableEnded) res.end();
      });
      nodeStream.pipe(res);
    } else {
      res.end();
    }

    if (VERBOSE) {
      // eslint-disable-next-line no-console
      console.log(
        redact(
          `[proxy] ${req.method} ${target.host}${target.pathname} -> ${upstream.status} (${
            Date.now() - startedAt
          }ms)`,
        ),
      );
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    if (!res.headersSent) {
      sendJson(res, aborted ? 504 : 502, {
        error: aborted ? 'upstream_timeout' : 'upstream_error',
        message: redact(err instanceof Error ? err.message : String(err)),
        target: `${target.protocol}//${target.host}${target.pathname}`,
      });
    } else if (!res.writableEnded) {
      res.end();
    }
    if (VERBOSE) {
      // eslint-disable-next-line no-console
      console.error(redact(`[proxy] ERROR ${target.host}${target.pathname}: ${String(err)}`));
    }
  } finally {
    clearTimeout(timer);
  }
});

server.on('clientError', (_err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(PORT, () => {
  const banner = [
    '',
    '  ┌────────────────────────────────────────────────────────────┐',
    '  │  ai-api-tester · CORS / SSE 转发 sidecar                    │',
    '  ├────────────────────────────────────────────────────────────┤',
    `  │  监听端口   : ${String(PORT).padEnd(45)}│`,
    `  │  允许来源   : ${(ALLOW_ALL ? '* (全部，仅限内网调试)' : ALLOW_LIST.join(', ')).padEnd(43)}│`,
    `  │  上游超时   : ${`${TIMEOUT_MS} ms`.padEnd(45)}│`,
    `  │  转发入口   : POST http://localhost:${String(PORT).padEnd(24)}/proxy │`,
    '  │  目标地址   : 通过 x-target-url 请求头指定                  │',
    '  ├────────────────────────────────────────────────────────────┤',
    '  │  ⚠ 仅限内网使用：本进程会原样转发含 API Key 的请求头，       │',
    '  │    请勿暴露到公网，评测结束后请关闭。                        │',
    '  └────────────────────────────────────────────────────────────┘',
    '',
  ].join('\n');
  // eslint-disable-next-line no-console
  console.log(banner);
});

const shutdown = () => {
  // eslint-disable-next-line no-console
  console.log('\n[proxy] 正在关闭…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
