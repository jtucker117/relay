// Supabase Edge Function: preview  (PUBLIC - deploy with "Verify JWT" OFF)
// The email-locked client portal. Serves a published preview at:
//   https://<project>.supabase.co/functions/v1/preview?p=<slug>
//
// Protection model (best-effort - browser-rendered code is never 100% hidden):
//   - Email gate: viewer must enter the client's email -> sets a signed cookie.
//   - The site HTML is served only through this function with a valid cookie,
//     never as a public file URL. Framing locked to same-origin.
//   - Server-enforced kill switch (active) + expiry.
//   - Right-click / View-Source / Save shortcuts disabled (deterrent only).
//
// Deploy:  supabase functions deploy preview --no-verify-jwt
// (or in the dashboard, create it and turn OFF "Verify JWT")

import { createClient } from "npm:@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

const enc = new TextEncoder();
const esc = (s: string) => (s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
// Minimal escaping for a double-quoted `srcdoc` attribute: only `&` and `"`
// need encoding; the browser reconstructs the original HTML before parsing the
// frame document. Keeps the inlined payload lean (no need to escape every `<`).
const srcdocEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// Always respond as UTF-8 HTML. Use an explicit Headers object so the runtime
// never falls back to text/plain (which shows the markup as raw text).
function html(body: string, extra: Record<string, string> = {}): Response {
  const h = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(body, { headers: h });
}

async function sign(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(SERVICE_ROLE),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function cookieValid(cookieVal: string | null, slug: string): Promise<boolean> {
  if (!cookieVal) return false;
  const sig = cookieVal.split(".")[1];
  if (!sig) return false;
  return sig === (await sign(`${slug}:ok`));
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

// Strip any Cloudflare bot-detection beacon that got baked into the stored HTML
// (it ends up there when a site is bundled/saved from a CF-fronted URL). Baked
// into a saved file, that beacon throws "Cannot read properties of null
// (reading 'document')" on load — which the client sees as a red error bar.
// Match any <script> that references the CF markers and drop it wholesale.
const stripCfBeacon = (s: string) =>
  s.replace(/<script\b[^>]*>[\s\S]*?(?:__CF\$cv\$params|challenge-platform)[\s\S]*?<\/script>/gi, "");

const DETERRENT = `<script>
document.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('keydown',e=>{const k=(e.key||'').toLowerCase();
if((e.ctrlKey||e.metaKey)&&['s','u','p'].includes(k))e.preventDefault();
if(k==='f12')e.preventDefault();});
</script>`;

const shell = (title: string, body: string) => html(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{--indigo:#5B4FE9}*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#F1F0EC;color:#1A1A1E}
.wrap{max-width:440px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #E4E3DE;border-radius:16px}
h1{font-size:20px;margin:0 0 8px}p{color:#5C5C63}
input{width:100%;padding:11px 12px;border:1px solid #E4E3DE;border-radius:10px;font-size:15px;margin:12px 0}
button{width:100%;padding:12px;border:none;border-radius:10px;background:var(--indigo);color:#fff;font-weight:600;font-size:15px;cursor:pointer}
.err{color:#c33;font-size:14px}
</style></head><body>${body}</body></html>`);

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const slug = url.searchParams.get("p") ?? "";
  if (!slug) return shell("Not found", `<div class="wrap"><h1>Preview not found</h1></div>`);

  const { data: rec } = await supa.from("previews").select("*").eq("slug", slug).maybeSingle();
  if (!rec) return shell("Not available", `<div class="wrap"><h1>This preview isn't available.</h1></div>`);
  if (!rec.active) return shell("Closed", `<div class="wrap"><h1>This preview is no longer available.</h1><p>Reach out to your project contact for an updated link.</p></div>`);
  if (rec.expiry && new Date(rec.expiry) < new Date())
    return shell("Expired", `<div class="wrap"><h1>This preview link has expired.</h1></div>`);

  const cookieName = `pv_${slug}`;
  const email = (rec.client_email ?? "").trim();
  const code = (rec.access_code ?? "").trim();
  const gated = !!(code || email);

  if (req.method === "POST") {
    const form = await req.formData();
    if (form.get("_action") === "decide") {
      const status = form.get("status") === "approved" ? "approved" : "changes";
      await supa.from("previews").update({ status, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("slug", slug);
      // Relative redirect so it works whether served at supabase.co/... or proxied at relay.sitestac.com/preview.
      return new Response(null, { status: 303, headers: { Location: `?p=${slug}` } });
    }
    const entered = String(form.get("code") ?? "").trim();
    const ok = (code && entered.toUpperCase() === code.toUpperCase()) ||
               (email && entered.toLowerCase() === email.toLowerCase());
    if (ok) {
      const val = `1.${await sign(`${slug}:ok`)}`;
      return new Response(null, {
        status: 303,
        headers: {
          Location: `?p=${slug}`,
          "Set-Cookie": `${cookieName}=${encodeURIComponent(val)}; HttpOnly; Secure; SameSite=Lax; Path=/preview; Max-Age=1209600`,
        },
      });
    }
    return shell("Enter your access code", gateHtml(slug, esc(rec.company), true));
  }

  const unlocked = !gated || (await cookieValid(readCookie(req, cookieName), slug));
  if (!unlocked) return shell("Enter your access code", gateHtml(slug, esc(rec.company), false));

  // Raw site as a standalone network response. Kept for external URLs (302) and
  // as a direct-open fallback. The portal itself no longer frames this route for
  // stored HTML — see the srcdoc note below.
  if (url.searchParams.get("raw") === "1") {
    if (rec.external_url) return new Response(null, { status: 302, headers: { Location: rec.external_url } });
    const { data: file } = await supa.storage.from("previews").download(`${slug}.html`);
    if (!file) return shell("Missing", `<div class="wrap"><h1>Preview content missing.</h1></div>`);
    let site = stripCfBeacon(await file.text());
    site = site.includes("</body>") ? site.replace("</body>", `${DETERRENT}</body>`) : site + DETERRENT;
    return html(site, { "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "frame-ancestors 'self'" });
  }

  // Build the site frame for the portal.
  //   - Stored HTML is inlined via `srcdoc` (NOT a network `src="…&raw=1"`).
  //     Reason: on relay.sitestac.com, Cloudflare injects its JS-detection beacon
  //     into every proxied HTML response. Inside our opaque-origin sandbox frame
  //     (allow-scripts, no allow-same-origin) that beacon throws
  //     "Cannot read properties of null (reading 'document')" in the client's
  //     console. srcdoc has no network response for CF to inject into, so the
  //     beacon never reaches the frame — while the sandbox stays just as tight.
  //     Do NOT switch this back to a network src, and do NOT add allow-same-origin
  //     to silence it (that would give arbitrary preview HTML our origin).
  //   - External URLs keep the redirect route (they load from their own origin).
  let frameTag: string;
  if (rec.external_url) {
    frameTag = `<iframe src="?p=${slug}&raw=1" title="Website preview" sandbox="allow-scripts"></iframe>`;
  } else {
    const { data: file } = await supa.storage.from("previews").download(`${slug}.html`);
    if (!file) return shell("Missing", `<div class="wrap"><h1>Preview content missing.</h1></div>`);
    let site = stripCfBeacon(await file.text());
    site = site.includes("</body>") ? site.replace("</body>", `${DETERRENT}</body>`) : site + DETERRENT;
    frameTag = `<iframe srcdoc="${srcdocEsc(site)}" title="Website preview" sandbox="allow-scripts"></iframe>`;
  }

  // Log the view — the client opened the portal.
  await supa.from("previews").update({
    view_count: (rec.view_count ?? 0) + 1,
    last_viewed_at: new Date().toISOString(),
  }).eq("slug", slug);

  const statusLabel = rec.status === "approved" ? "Approved" : rec.status === "changes" ? "Changes requested" : "In review";
  return html(portalHtml(slug, esc(rec.company), statusLabel, frameTag));
});

function gateHtml(slug: string, company: string, err: boolean) {
  return `<div class="wrap">
    <h1>Website preview for ${company}</h1>
    <p>Enter the access code from your invitation to view your site.</p>
    <form method="post" action="?p=${slug}">
      <input type="text" name="code" placeholder="Access code" required autofocus autocapitalize="characters" autocomplete="off">
      ${err ? `<div class="err">That code doesn't match. Check the message your link came in.</div>` : ""}
      <button type="submit">View preview</button>
    </form>
  </div>`;
}

function portalHtml(slug: string, company: string, statusLabel: string, frameTag: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Preview for ${company}</title><style>
*{box-sizing:border-box}html,body{margin:0;height:100%}body{font-family:system-ui,-apple-system,sans-serif;background:#161619;display:flex;flex-direction:column}
.bar{display:flex;align-items:center;gap:12px;padding:10px 16px;color:#fff;background:#161619;border-bottom:1px solid #26262C}
.bar b{font-size:14px}.chip{font-size:12px;background:#26262C;color:#cfcfe0;padding:3px 9px;border-radius:20px}
.spacer{flex:1}
.act{border:none;border-radius:9px;padding:8px 14px;font-weight:600;font-size:13px;cursor:pointer}
.approve{background:#3E9E6E;color:#fff}.changes{background:#E0932E;color:#fff;margin-right:8px}
iframe{flex:1;width:100%;border:none;background:#fff}
form{display:inline}
</style>
<script>document.addEventListener('contextmenu',e=>e.preventDefault());</script></head>
<body>
  <div class="bar">
    <b>${company}</b><span class="chip">${statusLabel}</span>
    <span class="spacer"></span>
    <form method="post" action="?p=${slug}"><input type="hidden" name="_action" value="decide"><input type="hidden" name="status" value="changes"><button class="act changes" type="submit">Request changes</button></form>
    <form method="post" action="?p=${slug}"><input type="hidden" name="_action" value="decide"><input type="hidden" name="status" value="approved"><button class="act approve" type="submit">Approve this site</button></form>
  </div>
  ${frameTag}
</body></html>`;
}
