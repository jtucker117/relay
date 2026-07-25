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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Email the workspace when a client requests changes (best-effort, via Resend).
async function notifyChanges(rec: { org_id?: string | null; company?: string | null }, slug: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey || !rec.org_id) return;
  const from = Deno.env.get("RESEND_FROM") || "Relay <onboarding@resend.dev>";
  // Notify the workspace OWNER only — not every member. Emailing all profiles
  // swept in admins (and anyone else on the team) who shouldn't get client
  // review pings. Override the recipient with PREVIEW_NOTIFY_EMAIL if set.
  const override = Deno.env.get("PREVIEW_NOTIFY_EMAIL");
  let to: string[];
  if (override) {
    to = override.split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    const { data: owners } = await supa.from("profiles").select("email").eq("org_id", rec.org_id).eq("role", "Owner");
    to = (owners ?? []).map((p: { email?: string }) => p.email).filter(Boolean) as string[];
  }
  if (!to.length) return;
  const { count } = await supa.from("preview_comments").select("id", { count: "exact", head: true }).eq("slug", slug);
  const n = count ?? 0;
  const company = rec.company || "A client";
  const link = `https://relay.sitestac.com/preview?p=${slug}`;
  const subject = `${company} requested changes` + (n ? ` (${n} note${n === 1 ? "" : "s"})` : "");
  const body = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 20px;color:#1A1A1E">
    <b style="font-size:16px">Relay</b>
    <div style="background:#FBFBFA;border:1px solid #E4E3DE;border-radius:14px;padding:24px;margin-top:16px">
      <p style="margin:0 0 10px;font-size:15px"><b>${esc(company)}</b> reviewed their site preview and requested changes.</p>
      <p style="margin:0 0 18px;color:#5C5C63;font-size:14px">${n} note${n === 1 ? "" : "s"} pinned on the site.</p>
      <a href="${link}" style="display:inline-block;background:#5B4FE9;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:10px">Open the preview</a>
    </div>
  </div>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html: body }),
  });
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
// The inner match is a tempered token that cannot cross a </script>, so this
// removes ONLY the single <script> holding the CF marker — never the runtime or
// bundle scripts around it. (A greedy [\s\S]*? here would swallow everything
// from the first <script> to the beacon and blank the page.)
const stripCfBeacon = (s: string) =>
  s.replace(/<script\b[^>]*>(?:(?!<\/script>)[\s\S])*?(?:__CF\$cv\$params|challenge-platform)(?:(?!<\/script>)[\s\S])*?<\/script>/gi, "");

const DETERRENT = `<script>
document.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('keydown',e=>{const k=(e.key||'').toLowerCase();
if((e.ctrlKey||e.metaKey)&&['s','u','p'].includes(k))e.preventDefault();
if(k==='f12')e.preventDefault();});
// In-page anchor fix. The site is framed via srcdoc, which has no document URL,
// so a bare "#contact" link resolves against the PARENT (relay.sitestac.com/
// preview) and navigates the frame there — a subrequest that drops the Lax
// gate cookie, re-showing the access-code screen. Intercept anchor clicks and
// scroll within the frame instead of navigating.
document.addEventListener('click',function(e){
  var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;
  if(!a)return;
  var h=a.getAttribute('href')||'';
  if(h.charAt(0)!=='#')return;
  e.preventDefault();
  if(h.length<2){window.scrollTo({top:0,behavior:'smooth'});return;}
  var id=decodeURIComponent(h.slice(1));
  var el=document.getElementById(id)||document.getElementsByName(id)[0];
  if(el)el.scrollIntoView({behavior:'smooth'});
},true);
</script>`;

// Client annotation engine, injected into the framed site. Renders existing
// pins (window.__relayComments) and, when the portal sends {__relay:'mode',on},
// lets the client click anywhere to drop a pin + note (POSTed as _action=comment).
// Bundled sites replace documentElement after load, so all state lives on
// window/document (which persist) and a watchdog re-mounts the pin layer.
const ANNOTATE = `<script>(function(){
  var slug=(new URLSearchParams(location.search)).get('p')||'';
  var comments=(window.__relayComments||[]).slice();
  var mode=false, LID='__relay_pins';
  function docH(){var d=document;return Math.max(d.documentElement.scrollHeight,d.body?d.body.scrollHeight:0,d.documentElement.clientHeight)}
  function docW(){return document.documentElement.clientWidth||window.innerWidth}
  function layer(){var l=document.getElementById(LID);if(!l){l=document.createElement('div');l.id=LID;l.style.cssText='position:absolute;top:0;left:0;width:100%;height:0;z-index:2147482000;pointer-events:none';(document.body||document.documentElement).appendChild(l)}return l}
  function pin(c,n){
    var H=docH(),p=document.createElement('div');
    p.style.cssText='position:absolute;left:'+(c.x_pct*100)+'%;top:'+(c.y_pct*H)+'px;transform:translate(-50%,-100%);pointer-events:auto';
    var dot=document.createElement('div');
    dot.style.cssText='min-width:24px;height:24px;padding:0 7px;border-radius:13px 13px 13px 3px;background:'+(c.resolved?'#8A8A90':'#E0932E')+';color:#fff;font:700 12px/24px -apple-system,sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:default';
    dot.textContent=n;
    var tip=document.createElement('div');
    tip.style.cssText='position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);background:#1A1A1E;color:#fff;font:13px/1.45 -apple-system,sans-serif;padding:8px 11px;border-radius:9px;width:max-content;max-width:240px;white-space:pre-wrap;display:none;box-shadow:0 6px 18px rgba(0,0,0,.45)';
    tip.textContent=c.text;
    dot.onmouseenter=function(){tip.style.display='block'};dot.onmouseleave=function(){tip.style.display='none'};
    p.appendChild(tip);p.appendChild(dot);return p;
  }
  function render(){var l=layer();l.innerHTML='';for(var i=0;i<comments.length;i++)l.appendChild(pin(comments[i],i+1));try{parent.postMessage({__relay:'count',n:comments.length},'*')}catch(e){}}
  function setMode(on){mode=on;document.documentElement.style.cursor=on?'crosshair':'';var h=document.getElementById('__relay_hint');if(on&&!h){h=document.createElement('div');h.id='__relay_hint';h.style.cssText='position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#5B4FE9;color:#fff;font:600 13px/1 -apple-system,sans-serif;padding:11px 18px;border-radius:22px;z-index:2147483600;box-shadow:0 6px 18px rgba(0,0,0,.35);pointer-events:none';h.textContent='Click anywhere on the site to leave a note';document.body.appendChild(h)}else if(!on&&h){h.remove()}}
  function closeComposer(){var c=document.getElementById('__relay_composer');if(c)c.remove()}
  function composer(x_pct,y_pct,pageY){
    closeComposer();
    var box=document.createElement('div');box.id='__relay_composer';
    box.style.cssText='position:absolute;left:'+(x_pct*100)+'%;top:'+pageY+'px;transform:translate(-50%,12px);z-index:2147483600;background:#fff;border:1px solid #E4E3DE;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.28);padding:10px;width:250px;font-family:-apple-system,sans-serif;pointer-events:auto';
    var ta=document.createElement('textarea');ta.placeholder='What should change here?';ta.style.cssText='width:100%;height:66px;border:1px solid #E4E3DE;border-radius:8px;padding:8px;font:13px/1.4 -apple-system,sans-serif;resize:none;box-sizing:border-box';
    var row=document.createElement('div');row.style.cssText='display:flex;gap:6px;margin-top:8px';
    var save=document.createElement('button');save.type='button';save.textContent='Add note';save.style.cssText='flex:1;background:#5B4FE9;color:#fff;border:none;border-radius:8px;padding:8px;font-weight:600;cursor:pointer';
    var cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.style.cssText='background:#F1F0EC;border:none;border-radius:8px;padding:8px 10px;cursor:pointer';
    row.appendChild(save);row.appendChild(cancel);box.appendChild(ta);box.appendChild(row);document.body.appendChild(box);ta.focus();
    cancel.onclick=closeComposer;
    save.onclick=function(){var t=ta.value.trim();if(!t)return;save.textContent='Saving…';save.disabled=true;
      fetch('?p='+encodeURIComponent(slug),{method:'POST',credentials:'same-origin',headers:{'content-type':'application/x-www-form-urlencoded'},body:'_action=comment&x='+x_pct+'&y='+y_pct+'&text='+encodeURIComponent(t)})
      .then(function(r){return r.json()}).then(function(res){
        if(!res||res.error||!res.id){save.textContent='Try again';save.disabled=false;save.style.background='#c0392b';return}
        comments.push({x_pct:x_pct,y_pct:y_pct,text:t,resolved:false,id:res.id});closeComposer();render();
      })
      .catch(function(){save.textContent='Try again';save.disabled=false;save.style.background='#c0392b'});
    };
  }
  document.addEventListener('click',function(e){
    if(!mode)return;var t=e.target;
    if(t&&t.closest&&t.closest('#__relay_composer,#'+LID))return;
    e.preventDefault();e.stopPropagation();
    composer(e.clientX/docW(),e.pageY/docH(),e.pageY);
  },true);
  window.addEventListener('message',function(e){if(e.data&&e.data.__relay==='mode')setMode(!!e.data.on)});
  window.addEventListener('resize',render);
  setInterval(function(){var l=document.getElementById(LID);if(!l||!l.isConnected)render()},1000);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render);else render();
  setTimeout(render,1500);setTimeout(render,3500);
})();</script>`;

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
  // The access code is the on/off switch: clear it (access_code = null) to make
  // the preview open to anyone with the link. Email still works as an alternate
  // unlock value when a code IS set, but on its own it never gates.
  const gated = !!code;

  if (req.method === "POST") {
    const form = await req.formData();
    const unlockedForPost = !gated || (await cookieValid(readCookie(req, cookieName), slug));

    // Client dropped a change-request pin. Requires an unlocked session.
    if (form.get("_action") === "comment") {
      if (!unlockedForPost) return json({ error: "locked" }, 401);
      const x = Number(form.get("x")), y = Number(form.get("y"));
      const text = String(form.get("text") ?? "").trim().slice(0, 2000);
      if (!text || !isFinite(x) || !isFinite(y)) return json({ error: "invalid" }, 400);
      const { data: ins, error } = await supa.from("preview_comments").insert({
        slug, org_id: rec.org_id,
        x_pct: Math.min(1, Math.max(0, x)), y_pct: Math.max(0, y), text,
      }).select("id").single();
      if (error) return json({ error: error.message }, 500);
      return json({ id: ins?.id });
    }

    if (form.get("_action") === "decide") {
      const status = form.get("status") === "approved" ? "approved" : "changes";
      await supa.from("previews").update({ status, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("slug", slug);
      if (status === "changes") { try { await notifyChanges(rec, slug); } catch (_e) { /* email is best-effort */ } }
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
    // Embed existing change-request pins + the annotation engine.
    const { data: cmts } = await supa.from("preview_comments")
      .select("id,x_pct,y_pct,text,resolved").eq("slug", slug).order("created_at", { ascending: true });
    const dataScript = `<script>window.__relayComments=${JSON.stringify(cmts ?? []).replace(/</g, "\\u003c")}</script>`;
    const inject = dataScript + DETERRENT + ANNOTATE;
    site = site.includes("</body>") ? site.replace("</body>", `${inject}</body>`) : site + inject;
    return html(site, { "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "frame-ancestors 'self'" });
  }

  // Frame the site via the network ?raw=1 route (a real document URL), NOT srcdoc.
  //   - srcdoc has no document URL, which breaks bundled sites (blob assets /
  //     fetches resolve against about:srcdoc) — they render blank — and makes
  //     in-page "#section" links resolve against the parent and blow away the
  //     gate cookie. A real ?raw=1 URL renders correctly and scrolls in-frame.
  //   - `allow-same-origin`: the raw response is same-origin (relay.sitestac.com),
  //     so Cloudflare's injected JS-detection beacon runs at a REAL origin and no
  //     longer throws the "reading 'document'" error. Preview content is
  //     first-party (agency-generated/uploaded), so same-origin is acceptable;
  //     the stored HTML is also beacon-stripped server-side on the raw route.
  //   - allow-forms/allow-popups so the previewed site's forms and links work.
  const sandbox = "allow-scripts allow-same-origin allow-forms allow-popups";
  const frameTag = `<iframe src="?p=${slug}&raw=1" title="Website preview" sandbox="${sandbox}"></iframe>`;

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
.approve{background:#3E9E6E;color:#fff}.changes{background:#E0932E;color:#fff}.ghost{background:#26262C;color:#fff}
.act+.act{margin-left:8px}
iframe{flex:1;width:100%;border:none;background:#fff}
#mode-comment{align-items:center;gap:12px}
.hint{color:#cfcfe0;font-size:13px}
</style>
<script>document.addEventListener('contextmenu',e=>e.preventDefault());</script></head>
<body>
  <div class="bar">
    <b>${company}</b><span class="chip" id="statuschip">${statusLabel}</span>
    <span class="spacer"></span>
    <span id="mode-default">
      <button class="act changes" id="btn-request" type="button">Request changes</button>
      <form method="post" action="?p=${slug}" style="display:inline"><input type="hidden" name="_action" value="decide"><input type="hidden" name="status" value="approved"><button class="act approve" type="submit">Approve this site</button></form>
    </span>
    <span id="mode-comment" style="display:none">
      <span class="hint">Click the site to pin a note<span id="cnt"></span></span>
      <button class="act ghost" id="btn-exit" type="button">Cancel</button>
      <button class="act approve" id="btn-done" type="button">Send to team</button>
    </span>
  </div>
  ${frameTag}
  <form method="post" action="?p=${slug}" id="form-changes" style="display:none"><input type="hidden" name="_action" value="decide"><input type="hidden" name="status" value="changes"></form>
  <script>
    var fr=document.querySelector('iframe');
    function msg(on){try{fr.contentWindow.postMessage({__relay:'mode',on:on},'*')}catch(e){}}
    function show(commentMode){document.getElementById('mode-default').style.display=commentMode?'none':'';document.getElementById('mode-comment').style.display=commentMode?'inline-flex':'none'}
    document.getElementById('btn-request').onclick=function(){show(true);msg(true)};
    document.getElementById('btn-exit').onclick=function(){show(false);msg(false)};
    document.getElementById('btn-done').onclick=function(){msg(false);document.getElementById('form-changes').submit()};
    window.addEventListener('message',function(e){if(e.data&&e.data.__relay==='count'){var c=document.getElementById('cnt');if(c)c.textContent=e.data.n?(' \\u00b7 '+e.data.n):''}});
  </script>
</body></html>`;
}
