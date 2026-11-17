// Compatibility for relative API URLs in existing clients and the lite player.
// _routes.json limits Worker execution to API requests; assets stay on Pages.
const DEFAULT_API_ORIGIN = 'https://167-233-103-143.sslip.io';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    let target;
    try { target = new URL(url.pathname + url.search, env.VITE_API_URL || DEFAULT_API_ORIGIN); }
    catch { return Response.json({ error: 'API configuration unavailable' }, { status: 503 }); }
    if (target.protocol !== 'https:' || target.origin === url.origin) {
      return Response.json({ error: 'API configuration unavailable' }, { status: 503 });
    }
    try {
      const upstream = new Request(target, request);
      upstream.headers.delete('host');
      const response = await fetch(upstream, { redirect: 'manual', cf: { cacheTtl: 0 } });
      const headers = new Headers(response.headers);
      if ((headers.get('content-type') || '').includes('application/json')) headers.set('Cache-Control', 'private, no-store');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch {
      return Response.json({ error: 'API unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    }
  },
};
