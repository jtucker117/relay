// Supabase Edge Function: send-invite
// Emails a workspace invitation using Supabase's built-in auth email (no third-party
// provider). Calls the GoTrue admin /invite endpoint with the service-role key, which
// Supabase injects into every edge function automatically — so no extra secret needed.
//
// Flow: the browser first inserts the invite row (email + role + org) into `invites`,
// then calls this. The invite email creates the auth user; the handle_new_user trigger
// matches the invites row and attaches them to this workspace with the chosen role.
//
// Deploy:  supabase functions deploy send-invite   (Verify JWT: ON)
// No secrets required (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-provided).
//
// NOTE: Supabase's default email sender is rate-limited (a few per hour) and sends from
// a supabase.co address — fine for adding teammates. Swap to custom SMTP / Resend later
// for higher volume or your own domain.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("Supabase service credentials are not available.");

    const { email, name, appUrl } = await req.json();
    if (!email || !String(email).trim()) throw new Error("Missing invitee email.");
    const to = String(email).trim();
    const redirect = String(appUrl || "https://relay.sitestac.com").replace(/\/$/, "");

    const res = await fetch(`${url}/auth/v1/invite?redirect_to=${encodeURIComponent(redirect)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ email: to, data: { name: name ?? "" } }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.msg || data?.error_description || data?.message || `Invite failed (${res.status})`;
      // Already-a-user isn't fatal: the invite row still lets them join on next sign-in.
      throw new Error(msg);
    }

    return new Response(JSON.stringify({ ok: true }), {
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
