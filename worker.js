// Cloudflare Worker for Relay.
// Serves the built SPA from static assets, and proxies /preview* to the Supabase
// `preview` edge function so the client-facing share link is on relay.sitestac.com
// instead of a supabase.co URL (hides where the site was built + looks branded).

const PREVIEW_FN = 'https://hifuypelxeryqqrfhapx.supabase.co/functions/v1/preview'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/preview' || url.pathname.startsWith('/preview/')) {
      const fwd = new Headers(request.headers)
      fwd.delete('accept-encoding') // avoid content-encoding mismatch when we re-emit
      const upstream = await fetch(PREVIEW_FN + url.search, {
        method: request.method,
        headers: fwd,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        redirect: 'manual', // let the client's browser follow 303s + store the cookie
      })

      // Supabase serves edge-function HTML as text/plain + a sandbox CSP (anti-phishing).
      // On our own domain we rewrite it so the browser actually renders the preview.
      const headers = new Headers(upstream.headers)
      if ((headers.get('content-type') || '').includes('text/plain')) {
        headers.set('content-type', 'text/html; charset=utf-8')
      }
      headers.delete('content-security-policy')
      headers.delete('x-content-type-options')
      return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers })
    }
    return env.ASSETS.fetch(request)
  },
}
