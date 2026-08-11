// Cloudflare Pages Function — CORS / SSE 转发中继。
// 完整镜像 proxy/server.mjs 的契约（前端零改动）：
//   POST /tester-proxy/proxy  + 请求头 x-target-url: <真实地址>  →  原样转发并流式回传
//   浏览器 → 同域 /tester-proxy/proxy → Cloudflare 边缘 → 厂商 API（无浏览器 CORS 限制）
//
// 运行于 Workers 运行时（Web Standard fetch / Request / Response / Streams）。
// 流式透传几乎不消耗 CPU 时间（CPU 时间只算实际计算，不算网络等待），
// 因此即便 LLM 响应持续数十秒也远低于 Workers 的 CPU 限额。

// 跳过的逐跳头（不得转发给上游）。
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

// 响应里要剥离的头（运行时与上游会重新计算）。
const STRIP_RESPONSE = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'access-control-allow-origin',
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-expose-headers',
]);

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers':
      'Content-Type,Authorization,X-Target-Url,X-Request-Id,X-Api-Key,Api-Key,Accept,Anthropic-Version',
    'access-control-expose-headers': 'Content-Type,X-Request-Id,X-Proxy-Upstream-Status,X-Proxy-Error',
    'access-control-max-age': '86400',
  };
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders() },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // 防跨站滥用：仅允许同源（即本 SPA）调用，第三方网站无法借本中继发请求。
  const origin = request.headers.get('origin');
  const host = new URL(request.url).host;
  if (origin && safeHost(origin) !== host) {
    return json(403, { error: 'origin_not_allowed', message: `Origin ${origin} 不是同源请求。` });
  }

  const url = new URL(request.url);
  const targetRaw =
    request.headers.get('x-target-url') || url.searchParams.get('url') || '';
  if (!targetRaw) {
    return json(400, { error: 'missing_target', message: '缺少 x-target-url 请求头（或 ?url= 参数）。' });
  }

  let target;
  try {
    target = new URL(targetRaw);
  } catch {
    return json(400, { error: 'bad_target', message: `非法目标 URL：${targetRaw}` });
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return json(400, { error: 'bad_protocol', message: '仅支持 http/https 目标。' });
  }

  // 构造上游请求头。
  const upstreamHeaders = {};
  for (const [key, value] of request.headers.entries()) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    upstreamHeaders[key] = value;
  }

  const init = { method: request.method, headers: upstreamHeaders, redirect: 'follow' };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    // ReadableStream 可直接作为 fetch body 透传（Workers 支持流式请求体）。
    init.body = request.body;
  }

  try {
    const upstream = await fetch(target.toString(), init);
    const outHeaders = {};
    for (const [key, value] of upstream.headers.entries()) {
      if (STRIP_RESPONSE.has(key.toLowerCase())) continue;
      outHeaders[key] = value;
    }
    outHeaders['x-proxy-upstream-status'] = String(upstream.status);
    Object.assign(outHeaders, corsHeaders());
    return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(502, { error: 'upstream_error', message });
  }
}

function safeHost(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return '';
  }
}
