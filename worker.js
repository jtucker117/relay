// Cloudflare Worker for Relay.
// Serves the built SPA from static assets, and proxies /preview* to the Supabase
// `preview` edge function so the client-facing share link is on relay.sitestac.com
// instead of a supabase.co URL (hides where the site was built + looks branded).

const PREVIEW_FN = 'https://hifuypelxeryqqrfhapx.supabase.co/functions/v1/preview'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/preview' || url.pathname.startsWith('/preview/')) {
      // Forward method, headers (incl. cookie), body, and query string to the function.
      // redirect: 'manual' so the client's browser (not the Worker) follows 303s and
      // stores the email-gate cookie.
      const proxied = new Request(PREVIEW_FN + url.search, request)
      return fetch(proxied, { redirect: 'manual' })
    }
    return env.ASSETS.fetch(request)
  },
}
