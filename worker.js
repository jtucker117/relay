// Cloudflare Worker for Relay.
// Serves the built SPA from static assets, and proxies /preview* to the Supabase
// `preview` edge function so the client-facing share link is on relay.sitestac.com
// instead of a supabase.co URL (hides where the site was built + looks branded).

const PREVIEW_FN = 'https://hifuypelxeryqqrfhapx.supabase.co/functions/v1/preview'
// Public anon/publishable key (already shipped in the browser bundle). Required on the
// proxied request — Supabase neuters apikey-less browser requests to text/plain with a
// sandbox CSP (anti-phishing), which breaks HTML rendering.
const ANON_KEY = 'sb_publishable_wjExbRE5y7cqoYK45zx9SQ_l4YHc6Ex'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/preview' || url.pathname.startsWith('/preview/')) {
      const headers = new Headers(request.headers)
      headers.set('apikey', ANON_KEY)
      headers.set('authorization', `Bearer ${ANON_KEY}`)
      return fetch(PREVIEW_FN + url.search, {
        method: request.method,
        headers,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
        // Let the client's browser follow 303s (so it stores the access-code cookie).
        redirect: 'manual',
      })
    }
    return env.ASSETS.fetch(request)
  },
}
