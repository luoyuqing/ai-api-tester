// 健康检查端点：对应前端的 pingProxySidecar（GET /tester-proxy/health）。
export async function onRequest() {
  return new Response(
    JSON.stringify({
      ok: true,
      service: 'ai-api-tester-proxy',
      runtime: 'cloudflare-pages-functions',
    }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
}
