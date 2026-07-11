// Supabase Edge Function: lead-search
// Powers the Leads board's "🔍 Live search" button. Takes a plain-language query
// (e.g. "roofers in Conroe"), uses Claude + the Anthropic web_search tool to find
// real local businesses, and returns them in the `leads` table shape. Runs
// server-side so the ANTHROPIC_API_KEY never touches the browser.
//
// Deploy:  supabase functions deploy lead-search   (Verify JWT: ON)
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// (or create it in the Supabase dashboard → Edge Functions and paste this code)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WEB_STATUS = new Set(["confirmed", "likely", "maybe"]);

function slug(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

interface RawLead {
  name?: string; category?: string; area?: string; phone?: string;
  address?: string; zip?: string; rating?: number | null; reviews?: number | null;
  web_status?: string; lat?: number | null; lng?: number | null;
}

// Coerce a model-returned object into a safe leads row (stable id for idempotent upsert).
function normalize(r: RawLead) {
  const name = String(r.name ?? "").trim();
  if (!name) return null;
  const zip = r.zip ? String(r.zip).trim() : null;
  const area = r.area ? String(r.area).trim() : null;
  const rating = typeof r.rating === "number" && isFinite(r.rating) ? r.rating : null;
  const reviews = typeof r.reviews === "number" && isFinite(r.reviews) ? Math.round(r.reviews) : 0;
  const web = WEB_STATUS.has(String(r.web_status)) ? String(r.web_status) : "maybe";
  const lat = typeof r.lat === "number" && isFinite(r.lat) ? r.lat : null;
  const lng = typeof r.lng === "number" && isFinite(r.lng) ? r.lng : null;
  return {
    id: `live-${slug(name)}-${zip ?? slug(area ?? "")}`,
    place_id: null,
    name,
    category: r.category ? String(r.category).trim() : null,
    area,
    phone: r.phone ? String(r.phone).trim() : null,
    address: r.address ? String(r.address).trim() : null,
    zip,
    rating,
    reviews,
    web_status: web,
    lat,
    lng,
    source: "live",
  };
}

function buildPrompt(query: string): string {
  return `Find real, currently-operating local businesses matching this request: "${query}".

Use web search (Google Maps / business listings / directories) to gather ACTUAL businesses — never invent them. Return up to 20.

For each business provide:
- name
- category (short, e.g. "Roofing", "Taqueria", "Auto Repair")
- area (the city/town, e.g. "Conroe", "Magnolia")
- phone (as "###-###-####" if available, else null)
- address (street address if available, else null)
- zip (5-digit, else null)
- rating (Google star rating as a number, else null)
- reviews (review count as an integer, else 0)
- lat and lng (decimal coordinates if you can determine them, else null)
- web_status: your read on whether they lack a strong modern website (a good sales prospect):
    "confirmed" = clearly no real website / only a Facebook page,
    "likely" = weak or outdated site,
    "maybe" = seems to already have a decent site.

Output ONLY a raw JSON array of objects with exactly those keys. No markdown, no code fences, no commentary before or after.`;
}

function extractJson(text: string): RawLead[] {
  let t = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  t = t.slice(start, end + 1);
  try {
    const parsed = JSON.parse(t);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set on this function.");

    const { query } = await req.json();
    if (!query || !String(query).trim()) throw new Error("Missing search query.");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 8000,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
        messages: [{ role: "user", content: buildPrompt(String(query).trim()) }],
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Anthropic API ${res.status}`);

    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n");

    const leads = extractJson(text).map(normalize).filter(Boolean);

    // De-dupe by id (same business surfaced twice in one search).
    const seen = new Set<string>();
    const unique = leads.filter((l) => {
      if (!l || seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });

    return new Response(JSON.stringify({ leads: unique }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Live search failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
