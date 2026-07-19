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

async function cookieValid(cookieVal: string | null, slug: string, email: string): Promise<boolean> {
  if (!cookieVal || !email) return false;
  const [b64, sig] = cookieVal.split(".");
  if (!b64 || !sig) return false;
  try {
    const got = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
    if (got.toLowerCase() !== email.toLowerCase()) return false;
    return sig === (await sign(`${slug}:${email.toLowerCase()}`));
  } catch { return false; }
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

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

  if (req.method === "POST") {
    const form = await req.formData();
    if (form.get("_action") === "decide") {
      const status = form.get("status") === "approved" ? "approved" : "changes";
      await supa.from("previews").update({ status, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("slug", slug);
      // Relative redirect so it works whether served at supabase.co/... or proxied at relay.sitestac.com/preview.
      return new Response(null, { status: 303, headers: { Location: `?p=${slug}` } });
    }
    const entered = String(form.get("email") ?? "").trim();
    if (email && entered.toLowerCase() === email.toLowerCase()) {
      const val = `${btoa(entered)}.${await sign(`${slug}:${email.toLowerCase()}`)}`;
      return new Response(null, {
        status: 303,
        headers: {
          Location: `?p=${slug}`,
          "Set-Cookie": `${cookieName}=${encodeURIComponent(val)}; HttpOnly; Secure; SameSite=Lax; Path=/preview; Max-Age=1209600`,
        },
      });
    }
    return shell("Enter your email", gateHtml(slug, esc(rec.company), true));
  }

  const unlocked = !email || (await cookieValid(readCookie(req, cookieName), slug, email));
  if (!unlocked) return shell("Enter your email", gateHtml(slug, esc(rec.company), false));

  // Raw site (framed by the portal only).
  if (url.searchParams.get("raw") === "1") {
    if (rec.external_url) return new Response(null, { status: 302, headers: { Location: rec.external_url } });
    const { data: file } = await supa.storage.from("previews").download(`${slug}.html`);
    if (!file) return shell("Missing", `<div class="wrap"><h1>Preview content missing.</h1></div>`);
    let site = await file.text();
    site = site.includes("</body>") ? site.replace("</body>", `${DETERRENT}</body>`) : site + DETERRENT;
    return html(site, { "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "frame-ancestors 'self'" });
  }

  const statusLabel = rec.status === "approved" ? "Approved" : rec.status === "changes" ? "Changes requested" : "In review";
  return html(portalHtml(slug, esc(rec.company), statusLabel));
});

function gateHtml(slug: string, company: string, err: boolean) {
  return `<div class="wrap">
    <h1>Website preview for ${company}</h1>
    <p>Enter the email this preview was sent to.</p>
    <form method="post" action="?p=${slug}">
      <input type="email" name="email" placeholder="you@company.com" required autofocus>
      ${err ? `<div class="err">That email doesn't match. Try the address the link was sent to.</div>` : ""}
      <button type="submit">View preview</button>
    </form>
  </div>`;
}

function portalHtml(slug: string, company: string, statusLabel: string) {
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
  <iframe src="?p=${slug}&raw=1" title="Website preview" sandbox="allow-scripts"></iframe>
</body></html>`;
}
