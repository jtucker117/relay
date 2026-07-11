// Supabase Edge Function: send-invite
// Emails a workspace invitation via Resend when someone is invited in
// Settings → Team & users. Runs server-side so RESEND_API_KEY never hits the browser.
// The invite ROW is still created client-side (RLS-protected); this only sends the email.
//
// Deploy:  supabase functions deploy send-invite   (Verify JWT: ON)
// Secrets: supabase secrets set RESEND_API_KEY=re_...
//          supabase secrets set RESEND_FROM="Relay <invites@sitestac.com>"
//            (optional — must be a Resend-verified sender; defaults to the Resend
//             sandbox address which only delivers to your own account email.)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

function emailHtml(opts: { greeting: string; who: string; workspace: string; role: string; link: string; email: string }) {
  const { greeting, who, workspace, role, link, email } = opts;
  return `<!doctype html>
<html>
  <body style="margin:0;background:#F1F0EC;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1A1A1E;">
    <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
        <span style="display:inline-block;width:30px;height:30px;border-radius:8px;background:#5B4FE9;color:#fff;text-align:center;line-height:30px;font-weight:700;">R</span>
        <b style="font-size:18px;">Relay</b>
      </div>
      <div style="background:#FBFBFA;border:1px solid #E4E3DE;border-radius:14px;padding:28px;">
        <p style="margin:0 0 14px;font-size:15px;">${esc(greeting)}</p>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">
          ${esc(who)} invited you to join <b>${esc(workspace)}</b> on Relay as a <b>${esc(role)}</b>.
        </p>
        <a href="${esc(link)}" style="display:inline-block;background:#5B4FE9;color:#fff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:10px;">
          Create your account
        </a>
        <p style="margin:20px 0 0;font-size:13px;color:#5C5C63;line-height:1.5;">
          Use this exact email address when you sign up — <b>${esc(email)}</b> — so you're added to the right workspace.
        </p>
        <p style="margin:12px 0 0;font-size:12px;color:#8A8A90;word-break:break-all;">
          Or paste this link into your browser:<br>${esc(link)}
        </p>
      </div>
      <p style="margin:18px 0 0;font-size:12px;color:#8A8A90;text-align:center;">Relay — SiteStac CRM</p>
    </div>
  </body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) throw new Error("RESEND_API_KEY is not set on this function.");
    const from = Deno.env.get("RESEND_FROM") || "Relay <onboarding@resend.dev>";

    const { email, name, role, orgName, inviterName, appUrl } = await req.json();
    if (!email || !String(email).trim()) throw new Error("Missing invitee email.");

    const to = String(email).trim();
    const base = String(appUrl || "https://relay.sitestac.com").replace(/\/$/, "");
    const link = `${base}/login?email=${encodeURIComponent(to)}`;
    const workspace = String(orgName || "the team");
    const who = String(inviterName || "A teammate");
    const roleLabel = String(role || "team member");
    const greeting = name ? `Hi ${name},` : "Hi,";

    const html = emailHtml({ greeting, who, workspace, role: roleLabel, link, email: to });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `You're invited to ${workspace} on Relay`,
        html,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || data?.error?.message || `Resend API ${res.status}`);

    return new Response(JSON.stringify({ ok: true, id: data?.id ?? null }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to send invite email";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
