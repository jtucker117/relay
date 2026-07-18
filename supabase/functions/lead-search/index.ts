// Supabase Edge Function: lead-search
// Powers the Leads board's "🔍 Live search". Takes a plain-language query
// (e.g. "roofers in Conroe") and returns real local businesses in the `leads` shape.
//
// Primary engine: Google Places API (New) Text Search — accurate, structured data
// (name, category, address, phone, rating, reviews, coords, website, city). Each
// business is keyed by its Google place id, so records are unique and de-dupe against
// the seeded pool automatically. If GOOGLE_PLACES_API_KEY isn't set, falls back to a
// Claude web-search pass so the button still works.
//
// Deploy:  supabase functions deploy lead-search   (Verify JWT: ON)
// Secrets: supabase secrets set GOOGLE_PLACES_API_KEY=...   (a server key — NOT the
//            referrer-restricted browser Maps key; enable "Places API (New)")
//          supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (fallback only)

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WEB_STATUS = new Set(["confirmed", "likely", "maybe"]);

interface Lead {
  id: string; place_id: string | null; name: string; category: string | null;
  area: string | null; phone: string | null; address: string | null; zip: string | null;
  rating: number | null; reviews: number; web_status: string; website: string | null;
  lat: number | null; lng: number | null; source: "live";
}

// A business with no site is the best prospect for a web agency; a social/builder page is weaker.
function webStatus(website: string | null): string {
  if (!website) return "confirmed";
  const w = website.toLowerCase();
  if (/facebook\.com|instagram\.com|linktr\.ee|yelp\.com|business\.site|wixsite\.com|godaddysites\.com/.test(w)) return "likely";
  return "maybe";
}

// ---- Google Places API (New): the good path ----
interface PlaceComponent { types?: string[]; longText?: string; shortText?: string }
function comp(components: PlaceComponent[] | undefined, type: string): string | null {
  const c = (components ?? []).find((x) => (x.types ?? []).includes(type));
  return c ? (c.shortText || c.longText || null) : null;
}

async function searchPlaces(key: string, query: string): Promise<Lead[]> {
  const fieldMask = [
    "places.id", "places.displayName", "places.formattedAddress", "places.nationalPhoneNumber",
    "places.rating", "places.userRatingCount", "places.location", "places.websiteUri",
    "places.businessStatus", "places.primaryTypeDisplayName", "places.addressComponents",
    "nextPageToken",
  ].join(",");

  const out: Lead[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 3; page++) { // up to 60 businesses
    // Bias toward the SiteStac service area (Magnolia / The Woodlands / Conroe) so a bare
    // query like "roofers" returns local businesses. A town named in the query still wins.
    const body: Record<string, unknown> = {
      textQuery: query,
      maxResultCount: 20,
      regionCode: "US",
      locationBias: { circle: { center: { latitude: 30.2, longitude: -95.55 }, radius: 50000 } },
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": fieldMask },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Google Places ${res.status}`);

    for (const p of (data.places ?? [])) {
      if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;
      const name = p.displayName?.text ?? "";
      if (!name) continue;
      const website = p.websiteUri || null;
      out.push({
        id: p.id,
        place_id: p.id,
        name,
        category: p.primaryTypeDisplayName?.text ?? null,
        area: comp(p.addressComponents, "locality") || comp(p.addressComponents, "postal_town") || null,
        phone: p.nationalPhoneNumber || null,
        address: p.formattedAddress || null,
        zip: comp(p.addressComponents, "postal_code"),
        rating: typeof p.rating === "number" ? p.rating : null,
        reviews: typeof p.userRatingCount === "number" ? p.userRatingCount : 0,
        web_status: webStatus(website),
        website,
        lat: p.location?.latitude ?? null,
        lng: p.location?.longitude ?? null,
        source: "live",
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

// ---- Claude web-search fallback (used only when GOOGLE_PLACES_API_KEY is unset) ----
function slug(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);
}
async function searchClaude(apiKey: string, query: string): Promise<Lead[]> {
  const prompt = `Find real, currently-operating local businesses matching: "${query}". Use web search — never invent. Return up to 20 as a raw JSON array; each object: name, category, area, phone ("###-###-####" or null), address, zip, rating (number|null), reviews (int), lat, lng, website (url|null). Output ONLY the JSON array, no prose or code fences.`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-5", max_tokens: 8000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic API ${res.status}`);
  const text = (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
  const start = text.indexOf("["), end = text.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  let raw: Record<string, unknown>[] = [];
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  return raw.map((r) => {
    const name = String(r.name ?? "").trim();
    if (!name) return null;
    const zip = r.zip ? String(r.zip).trim() : null;
    const area = r.area ? String(r.area).trim() : null;
    const website = r.website ? String(r.website).trim() : null;
    return {
      id: `live-${slug(name)}-${zip ?? slug(area ?? "")}`,
      place_id: null, name,
      category: r.category ? String(r.category).trim() : null,
      area, phone: r.phone ? String(r.phone).trim() : null,
      address: r.address ? String(r.address).trim() : null, zip,
      rating: typeof r.rating === "number" ? r.rating : null,
      reviews: typeof r.reviews === "number" ? Math.round(r.reviews) : 0,
      web_status: WEB_STATUS.has(String(r.web_status)) ? String(r.web_status) : webStatus(website),
      website,
      lat: typeof r.lat === "number" ? r.lat : null,
      lng: typeof r.lng === "number" ? r.lng : null,
      source: "live" as const,
    } as Lead;
  }).filter((x): x is Lead => x !== null);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { query } = await req.json();
    if (!query || !String(query).trim()) throw new Error("Missing search query.");
    const q = String(query).trim();

    const placesKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
    let leads: Lead[];
    if (placesKey) {
      leads = await searchPlaces(placesKey, q);
    } else {
      const anthropic = Deno.env.get("ANTHROPIC_API_KEY");
      if (!anthropic) throw new Error("Set GOOGLE_PLACES_API_KEY (recommended) or ANTHROPIC_API_KEY on this function.");
      leads = await searchClaude(anthropic, q);
    }

    // De-dupe by id.
    const seen = new Set<string>();
    const unique = leads.filter((l) => l.id && !seen.has(l.id) && seen.add(l.id));

    return new Response(JSON.stringify({ leads: unique, count: unique.length }), {
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
