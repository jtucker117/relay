// Supabase Edge Function: lead-search
// Powers the Leads board's "🔍 Live search". Takes a plain-language query — either a
// place ("Cleveland, texas") or a trade in a place ("roofers in Conroe") — and returns
// real local businesses in the `leads` shape, filtered to actual prospects.
//
// What "prospect" means here: a business with NO website, a Facebook page standing in
// for one, a drag-and-drop builder page, or a site that's visibly stale (not mobile
// friendly, copyright years out of date, broken, http-only). Those are the businesses
// SiteStac can sell to. Businesses with a modern site are dropped unless the caller
// asks for them (onlyProspects: false).
//
// Pipeline:
//   1. resolveArea()  — turn the typed place into a real map viewport, so results come
//                       from the town the user typed instead of a hard-coded bias point.
//   2. searchPlaces() — one Text Search per trade inside that viewport (a bare city gets
//                       fanned out across TRADES; a query naming a trade runs just one).
//   3. classify()     — verdict from the URL alone where that's decisive (none/social/builder).
//   4. probeSite()    — actually fetch the remaining homepages to catch stale custom sites.
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

// Non-business place types. A bare city/region query returns the locality itself, which
// is what used to land on the board as a phantom lead named "Cleveland".
const GEO_TYPES = new Set([
  "locality", "political", "administrative_area_level_1", "administrative_area_level_2",
  "administrative_area_level_3", "administrative_area_level_4", "country", "postal_code",
  "postal_code_prefix", "postal_town", "neighborhood", "sublocality", "sublocality_level_1",
  "sublocality_level_2", "route", "street_address", "colloquial_area", "natural_feature",
  "archipelago", "continent", "plus_code", "premise", "subpremise", "intersection",
  "geocode", "landmark", "town_square",
]);

// Trades worth prospecting, fanned out when the query is just a place. Ordered by how
// well they convert for a local web agency — the list is capped because each entry is a
// billed Places request.
const TRADES = [
  "roofing contractor", "hvac contractor", "plumber", "electrician",
  "landscaping lawn care", "pest control", "house cleaning service", "painting contractor",
  "remodeling contractor", "concrete contractor", "pressure washing", "tree service",
  "fence contractor", "garage door service", "auto repair shop", "towing service",
];

// Words that mean the user already told us WHAT to look for, so we skip the fan-out.
const TRADE_HINTS = [
  "roof", "hvac", "air condition", "heating", "plumb", "electric", "landscap", "lawn",
  "pest", "clean", "paint", "floor", "remodel", "contractor", "concrete", "paving",
  "pressure wash", "power wash", "tree", "pool", "garage", "fenc", "auto", "mechanic",
  "tow", "moving", "storage", "realtor", "real estate", "insurance", "attorney", "lawyer",
  "legal", "dentist", "dental", "doctor", "medical", "chiro", "salon", "barber", "spa",
  "massage", "gym", "fitness", "restaurant", "food", "cater", "photograph", "event",
  "retail", "shop", "store", "church", "nonprofit", "gun", "firearm", "outdoor", "repair",
  "service", "compan", "business", "septic", "well", "welding", "glass", "window", "door",
  "cabinet", "countertop", "granite", "solar", "security", "alarm", "sign", "print",
];

// Every search is fenced to one state. Without this, a query with no town in it
// ("home builders") has nothing to pin it down and Google happily returns Oregon.
const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana",
  IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

type Verdict = "none" | "social" | "builder" | "stale" | "modern";
type Social = { platform: string; url: string };

interface Lead {
  id: string; place_id: string | null; name: string; category: string | null;
  area: string | null; phone: string | null; address: string | null; zip: string | null;
  rating: number | null; reviews: number; web_status: string; website: string | null;
  state: string | null;
  site_verdict: Verdict; site_reason: string | null; socials: Social[];
  lat: number | null; lng: number | null; source: "live";
}

// ---------------------------------------------------------------------------
// Site quality
// ---------------------------------------------------------------------------

// Social profiles standing in for a website — a strong prospect, they already care
// about being findable but have nowhere to send people.
const SOCIAL_RE = /facebook\.com|fb\.com|instagram\.com|linktr\.ee|yelp\.com|nextdoor\.com|twitter\.com|x\.com\/|tiktok\.com|linkedin\.com|business\.google|g\.page/i;
// Drag-and-drop / free-tier builder hosts. Squarespace and Webflow are deliberately NOT
// here — those are usually current sites and flagging them wastes outreach.
const BUILDER_RE = /wixsite\.com|wix\.com|godaddysites\.com|business\.site|weebly\.com|blogspot\.com|wordpress\.com|squarespace6|jimdo|webs\.com|angelfire|tripod\.com|homestead\.com|yolasite|webnode|site123|strikingly\.com|myshopify\.com\/password/i;

// Social profiles we care about, most useful first. Facebook is the one that matters for
// these businesses — it's usually where their photos, hours and reviews actually live.
const SOCIAL_PATTERNS: { platform: string; re: RegExp }[] = [
  { platform: "facebook", re: /https?:\/\/(?:[\w-]+\.)?facebook\.com\/[^\s"'<>)]+/gi },
  { platform: "instagram", re: /https?:\/\/(?:www\.)?instagram\.com\/[^\s"'<>)]+/gi },
  { platform: "youtube", re: /https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|channel\/|user\/|@)[^\s"'<>)]+/gi },
  { platform: "tiktok", re: /https?:\/\/(?:www\.)?tiktok\.com\/@[^\s"'<>)]+/gi },
  { platform: "linkedin", re: /https?:\/\/(?:[\w-]+\.)?linkedin\.com\/(?:company|in)\/[^\s"'<>)]+/gi },
  { platform: "x", re: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s"'<>)]+/gi },
  { platform: "yelp", re: /https?:\/\/(?:www\.)?yelp\.com\/biz\/[^\s"'<>)]+/gi },
];
// Share widgets and login walls masquerading as profiles.
const NOT_A_PROFILE = /\/(?:sharer|share\.php|share|dialog|plugins|intent|login|signup|tr\?|embed|widget|policies|help|privacy|terms)\b|[?&](?:u|url|text)=/i;

function cleanSocial(url: string): string {
  return url.replace(/[),.;'"]+$/, "").replace(/[?#].*$/, "").replace(/\/$/, "");
}
// Pull profile links out of a homepage — the footer/header icons nearly every site has.
function extractSocials(html: string): Social[] {
  const out: Social[] = [];
  const seen = new Set<string>();
  for (const { platform, re } of SOCIAL_PATTERNS) {
    for (const m of html.matchAll(re)) {
      const url = cleanSocial(m[0]);
      if (NOT_A_PROFILE.test(url)) continue;
      // Require an actual handle segment after the host, not a bare domain link.
      const path = url.replace(/^https?:\/\/[^/]+/i, "");
      if (path.length < 2) continue;
      if (seen.has(platform)) continue;   // one link per platform is plenty
      seen.add(platform);
      out.push({ platform, url });
      break;
    }
  }
  return out;
}
// When the "website" Google has on file IS the social page, that's already the link.
function socialFromWebsite(website: string | null): Social[] {
  if (!website) return [];
  for (const { platform, re } of SOCIAL_PATTERNS) {
    re.lastIndex = 0;
    if (new RegExp(re.source, "i").test(website)) return [{ platform, url: cleanSocial(website) }];
  }
  return [];
}

// Verdict we can reach from the URL alone. Returns null when we must fetch the page.
function classify(website: string | null): { verdict: Verdict; reason: string } | null {
  if (!website || !website.trim()) return { verdict: "none", reason: "No website at all" };
  const w = website.toLowerCase();
  if (SOCIAL_RE.test(w)) return { verdict: "social", reason: "Uses a social page instead of a website" };
  if (BUILDER_RE.test(w)) return { verdict: "builder", reason: "Free drag-and-drop builder page" };
  return null;
}

// Fetch the homepage and look for age. Kept deliberately cheap: 6s cap, first 120KB only.
async function probeSite(url: string): Promise<{ verdict: Verdict; reason: string; socials: Social[] }> {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const isHttp = /^http:\/\//i.test(target);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(target, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RelayLeadBot/1.0)" },
    });
    if (!res.ok) return { verdict: "stale", reason: `Site returns ${res.status}`, socials: [] };

    // The redirect chain matters: a "custom" domain that lands on Wix is still a builder.
    const landed = res.url.toLowerCase();
    if (BUILDER_RE.test(landed)) return { verdict: "builder", reason: "Redirects to a builder page", socials: [] };
    if (SOCIAL_RE.test(landed)) return { verdict: "social", reason: "Redirects to a social page", socials: socialFromWebsite(res.url) };

    const buf = new Uint8Array(await res.arrayBuffer());
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 120_000));
    const lower = html.toLowerCase();
    // Grab their profile links while we have the page open — no extra request.
    const socials = extractSocials(html);

    // Not mobile friendly — the single most sellable flaw in 2026.
    if (!/<meta[^>]+name=["']?viewport/i.test(lower)) {
      return { verdict: "stale", reason: "Not mobile friendly (no viewport tag)", socials };
    }
    // Visibly abandoned: last copyright year is years behind.
    const years = [...lower.matchAll(/(?:©|&copy;|copyright)[^0-9]{0,24}(19|20)\d{2}/g)]
      .map((m) => parseInt(m[0].slice(-4), 10))
      .filter((y) => y >= 1995 && y <= CURRENT_YEAR + 1);
    if (years.length) {
      const newest = Math.max(...years);
      if (newest <= CURRENT_YEAR - 3) return { verdict: "stale", reason: `Copyright still says ${newest}`, socials };
    }
    // Dead-tech markers.
    if (/<frameset|\.swf\b|shockwave-flash/i.test(lower)) {
      return { verdict: "stale", reason: "Built on dead tech (frames/Flash)", socials };
    }
    if (isHttp && !res.url.toLowerCase().startsWith("https://")) {
      return { verdict: "stale", reason: "No HTTPS — browsers flag it as insecure", socials };
    }
    return { verdict: "modern", reason: "Site looks current", socials };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { verdict: "stale", reason: aborted ? "Site timed out loading" : "Site failed to load", socials: [] };
  } finally {
    clearTimeout(timer);
  }
}

const CURRENT_YEAR = new Date().getFullYear();

// Legacy column kept in sync so the existing board chips/filters keep working.
function webStatus(v: Verdict): string {
  if (v === "none") return "confirmed";
  if (v === "modern") return "maybe";
  return "likely";
}
const isProspect = (v: Verdict) => v !== "modern";

// Run `jobs` with bounded concurrency so 60 site probes don't open 60 sockets at once.
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Google Places API (New)
// ---------------------------------------------------------------------------
interface PlaceComponent { types?: string[]; longText?: string; shortText?: string }
function comp(components: PlaceComponent[] | undefined, type: string): string | null {
  const c = (components ?? []).find((x) => (x.types ?? []).includes(type));
  return c ? (c.shortText || c.longText || null) : null;
}

interface Viewport { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } }
interface Area { name: string; viewport: Viewport | null; center?: { lat: number; lng: number } | null; isGeo?: boolean }

function inViewport(pt: { lat: number; lng: number } | null | undefined, vp: Viewport | null): boolean {
  if (!pt || !vp) return false;
  return pt.lat >= vp.low.latitude && pt.lat <= vp.high.latitude &&
    pt.lng >= vp.low.longitude && pt.lng <= vp.high.longitude;
}

async function placesText(key: string, body: Record<string, unknown>, fieldMask: string) {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": fieldMask },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Google Places ${res.status}`);
  return data;
}

// Turn "Cleveland, texas" into that town's actual map rectangle. Without this, every
// search was biased to a fixed point near Magnolia and quietly returned the wrong town.
async function resolveArea(key: string, place: string): Promise<Area | null> {
  const data = await placesText(
    key,
    { textQuery: place, maxResultCount: 5, regionCode: "US" },
    "places.displayName,places.viewport,places.location,places.types,places.formattedAddress",
  );
  const places: Record<string, unknown>[] = data.places ?? [];
  if (!places.length) return null;
  // Prefer a genuine locality result over a business that happens to match the name.
  const geo = places.find((p) => ((p.types as string[]) ?? []).some((t) => GEO_TYPES.has(t)));
  const city = geo ?? places[0];
  const vp = city.viewport as Viewport | undefined;
  const name = (city.displayName as { text?: string })?.text ?? place;
  const loc = city.location as { latitude?: number; longitude?: number } | undefined;
  return {
    name,
    viewport: vp ?? null,
    center: loc?.latitude != null ? { lat: loc.latitude, lng: loc.longitude! } : null,
    // Only a genuine geographic hit is safe to search inside. "home builders" resolves to
    // some random contractor, and pinning the search to that business's block is nonsense.
    isGeo: Boolean(geo),
  };
}

const FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress", "places.nationalPhoneNumber",
  "places.rating", "places.userRatingCount", "places.location", "places.websiteUri",
  "places.businessStatus", "places.primaryTypeDisplayName", "places.primaryType",
  "places.types", "places.addressComponents",
  "nextPageToken",
].join(",");

// Is this result an actual business, or a place/road/city Google threw in?
function isBusiness(p: Record<string, unknown>, areaName: string | null): boolean {
  const types: string[] = (p.types as string[]) ?? [];
  const primary = p.primaryType as string | undefined;
  // Any geographic type at all disqualifies it — businesses never carry `locality`.
  if (types.some((t) => GEO_TYPES.has(t))) return false;
  if (primary && GEO_TYPES.has(primary)) return false;
  const name = ((p.displayName as { text?: string })?.text ?? "").trim();
  if (!name) return false;
  // "Cleveland" the lead was literally the town's own name.
  if (areaName && name.toLowerCase() === areaName.toLowerCase().split(",")[0].trim()) return false;
  // A real listing has either a business category or some trace of customers. A brand-new
  // no-website business still gets a primaryType, so this doesn't filter out good prospects.
  const hasSignal = Boolean(primary) || Boolean(p.nationalPhoneNumber) ||
    typeof p.rating === "number" || (typeof p.userRatingCount === "number" && (p.userRatingCount as number) > 0) ||
    Boolean(p.websiteUri);
  return hasSignal;
}

function toLead(p: Record<string, unknown>): Lead {
  const website = (p.websiteUri as string) || null;
  return {
    id: p.id as string,
    place_id: p.id as string,
    name: ((p.displayName as { text?: string })?.text ?? "").trim(),
    category: (p.primaryTypeDisplayName as { text?: string })?.text ?? null,
    area: comp(p.addressComponents as PlaceComponent[], "locality") ||
      comp(p.addressComponents as PlaceComponent[], "postal_town") || null,
    phone: (p.nationalPhoneNumber as string) || null,
    address: (p.formattedAddress as string) || null,
    zip: comp(p.addressComponents as PlaceComponent[], "postal_code"),
    state: comp(p.addressComponents as PlaceComponent[], "administrative_area_level_1"),
    rating: typeof p.rating === "number" ? p.rating : null,
    reviews: typeof p.userRatingCount === "number" ? (p.userRatingCount as number) : 0,
    web_status: "likely",
    website,
    site_verdict: "none",
    site_reason: null,
    socials: [],
    lat: (p.location as { latitude?: number })?.latitude ?? null,
    lng: (p.location as { longitude?: number })?.longitude ?? null,
    source: "live",
  };
}

// One trade, inside one area, up to `pages` × 20 results.
async function searchOne(key: string, textQuery: string, area: Area | null, pages: number): Promise<Lead[]> {
  const out: Lead[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < pages; page++) {
    const body: Record<string, unknown> = { textQuery, maxResultCount: 20, regionCode: "US" };
    // A resolved viewport is a hard restriction — results cannot drift to another town.
    if (area?.viewport) body.locationRestriction = { rectangle: area.viewport };
    if (pageToken) body.pageToken = pageToken;

    const data = await placesText(key, body, FIELD_MASK);
    for (const p of (data.places ?? []) as Record<string, unknown>[]) {
      if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;
      if (!isBusiness(p, area?.name ?? null)) continue;
      out.push(toLead(p));
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

const hasTradeTerm = (q: string) => TRADE_HINTS.some((h) => q.toLowerCase().includes(h));

// Strip a leading trade phrase to get at the place: "roofers in Conroe" → "Conroe".
function placePart(q: string): string {
  const m = q.match(/\b(?:in|near|around|at)\b\s+(.+)$/i);
  return (m ? m[1] : q).trim();
}

async function searchPlaces(key: string, query: string, industry: string | null, stateCode: string): Promise<{ leads: Lead[]; area: string | null; trades: number }> {
  const q = query.trim();
  const namedTrade = industry?.trim() || (hasTradeTerm(q) ? q : null);
  const place = placePart(q);
  const stateName = STATES[stateCode] ?? "Texas";

  // The state is the outer fence — resolved first so there's always somewhere to pin to,
  // even when the query names no town at all ("home builders").
  const stateArea = await resolveArea(key, stateName).catch(() => null);

  // Then the town, if the query named one we can trust.
  const typed = await resolveArea(key, place).catch(() => null);
  const typedIsInState = typed?.isGeo && (
    !stateArea?.viewport || inViewport(typed.center, stateArea.viewport)
  );
  // A town outside the chosen state (or a non-place like "home builders") is ignored in
  // favour of the state itself — the state filter always wins.
  const area = typedIsInState ? typed : stateArea;

  const fanOut = async (): Promise<Lead[][]> =>
    await pooled(TRADES, 6, (t) =>
      searchOne(key, `${t} in ${area?.name ?? place}`, area, 1).catch(() => [] as Lead[]));

  let batches: Lead[][];
  let trades: number;
  if (namedTrade) {
    // The user said what they want — one search, deeper (up to 60).
    const text = industry?.trim() ? `${industry.trim()} in ${area?.name ?? place}` : q;
    trades = 1;
    batches = [await searchOne(key, text, area, 3)];
    // Safety net: a town whose name merely CONTAINS a trade word ("Towne Lake" → "tow")
    // gets misread as a trade query and returns nothing once the city itself is filtered
    // out. Rather than hand-tune the word list, notice the empty result and fan out.
    if (batches[0].length < 3) {
      trades = TRADES.length;
      batches = [...batches, ...(await fanOut())];
    }
  } else {
    // Bare place: fan out across trades so "Cleveland, texas" returns businesses, not a city.
    trades = TRADES.length;
    batches = await fanOut();
  }
  return { leads: batches.flat(), area: area?.name ?? null, trades };
}

// ---- Claude web-search fallback (only when GOOGLE_PLACES_API_KEY is unset) ----
function slug(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);
}
async function searchClaude(apiKey: string, query: string): Promise<Lead[]> {
  const prompt = `Find real, currently-operating local BUSINESSES matching: "${query}". Use web search — never invent. Only actual businesses: no cities, towns, neighborhoods, roads or landmarks. Prefer businesses with no website or an old one. Return up to 20 as a raw JSON array; each object: name, category, area, phone ("###-###-####" or null), address, zip, rating (number|null), reviews (int), lat, lng, website (url|null). Output ONLY the JSON array, no prose or code fences.`;
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
  const place = placePart(query).toLowerCase().split(",")[0].trim();
  return raw.map((r) => {
    const name = String(r.name ?? "").trim();
    if (!name) return null;
    // Same guard as the Places path: the model sometimes returns the town itself.
    if (name.toLowerCase() === place) return null;
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
      web_status: "likely", website, state: null,
      site_verdict: "none" as Verdict, site_reason: null, socials: socialFromWebsite(website),
      lat: typeof r.lat === "number" ? r.lat : null,
      lng: typeof r.lng === "number" ? r.lng : null,
      source: "live" as const,
    } as Lead;
  }).filter((x): x is Lead => x !== null);
}

// ---- Social lookup for the no-website leads ----
// These are the best prospects and the only ones with no page to scrape. One batched
// Claude web-search call resolves their Facebook/Instagram so there's a way in besides
// a cold call. Optional: silently skipped when ANTHROPIC_API_KEY isn't set.
async function findSocials(apiKey: string, leads: Lead[]): Promise<void> {
  if (!leads.length) return;
  const list = leads.map((l, i) => `${i + 1}. ${l.name}${l.area ? ` — ${l.area}` : ""}${l.address ? `, ${l.address}` : ""}`).join("\n");
  const prompt = `For each business below, use web search to find its official social media profile URLs (Facebook page, Instagram, or both).

${list}

Rules:
- Only return a URL if you are confident it belongs to THAT business in THAT town. Match the name and location.
- Never guess or construct a URL from the business name. If you can't verify it, omit the business.
- No search-result URLs, no facebook.com/sharer links, no personal profiles.

Return ONLY a raw JSON array, no prose or code fences. Each object: {"i": <the number above>, "facebook": <url|null>, "instagram": <url|null>}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-5", max_tokens: 4000,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 12 }],
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const text = (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");
    const start = text.indexOf("["), end = text.lastIndexOf("]");
    if (start === -1 || end === -1) return;
    const rows: Record<string, unknown>[] = JSON.parse(text.slice(start, end + 1));
    for (const r of rows) {
      const idx = Number(r.i) - 1;
      const lead = leads[idx];
      if (!lead) continue;
      const found: Social[] = [];
      for (const platform of ["facebook", "instagram"] as const) {
        const raw = r[platform];
        if (typeof raw !== "string" || !raw.trim()) continue;
        const url = cleanSocial(raw.trim());
        // Trust but verify: must be a real profile URL on the right host.
        const pat = SOCIAL_PATTERNS.find((s) => s.platform === platform)!;
        if (!new RegExp(pat.re.source, "i").test(url) || NOT_A_PROFILE.test(url)) continue;
        found.push({ platform, url });
      }
      if (found.length) lead.socials = found;
    }
  } catch { /* best-effort — a lead with no socials is still a lead */ }
  finally { clearTimeout(timer); }
}

// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const payload = await req.json();
    const query = String(payload?.query ?? "").trim();
    if (!query) throw new Error("Missing search query.");
    const industry: string | null = payload?.industry ? String(payload.industry).trim() : null;
    const rawState = String(payload?.state ?? "TX").trim().toUpperCase();
    const stateCode = STATES[rawState] ? rawState : "TX";
    // Default ON: the board is for finding sellable businesses, not a phone book.
    const onlyProspects = payload?.onlyProspects !== false;

    const placesKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
    let found: Lead[];
    let area: string | null = null;
    if (placesKey) {
      const r = await searchPlaces(placesKey, query, industry, stateCode);
      found = r.leads; area = r.area;
    } else {
      const anthropic = Deno.env.get("ANTHROPIC_API_KEY");
      if (!anthropic) throw new Error("Set GOOGLE_PLACES_API_KEY (recommended) or ANTHROPIC_API_KEY on this function.");
      found = await searchClaude(anthropic, query);
    }

    // De-dupe across the trade fan-out (a business can match two trades).
    const byId = new Map<string, Lead>();
    for (const l of found) if (l.id && !byId.has(l.id)) byId.set(l.id, l);
    let unique = [...byId.values()];

    // Hard state fence. A viewport rectangle overlaps neighbouring states at the corners,
    // so the bounding box is not enough on its own — check the address Google gave us.
    const stateName = STATES[stateCode];
    const stateRe = new RegExp(`(,\\s*${stateCode}\\b|\\b${stateName}\\b)`, "i");
    const outOfState = unique.filter((l) =>
      l.state ? l.state.toUpperCase() !== stateCode : !(l.address && stateRe.test(l.address)));
    const dropped = outOfState.length;
    unique = unique.filter((l) => !outOfState.includes(l));

    // Verdict from the URL where that's decisive; fetch the rest. Probing is capped so a
    // huge result set can't blow the function's wall clock.
    const needProbe: Lead[] = [];
    for (const l of unique) {
      const quick = classify(l.website);
      if (quick) {
        l.site_verdict = quick.verdict; l.site_reason = quick.reason;
        l.socials = socialFromWebsite(l.website);
      } else needProbe.push(l);
    }
    const PROBE_CAP = 80;
    const probing = needProbe.slice(0, PROBE_CAP);
    await pooled(probing, 10, async (l) => {
      const r = await probeSite(l.website!);
      l.site_verdict = r.verdict; l.site_reason = r.reason; l.socials = r.socials;
    });
    // Anything past the cap keeps its site but is treated as unknown-modern (not a prospect),
    // so we never claim a site is stale without having looked at it.
    for (const l of needProbe.slice(PROBE_CAP)) {
      l.site_verdict = "modern"; l.site_reason = "Has a site (not checked — result cap)";
    }
    for (const l of unique) l.web_status = webStatus(l.site_verdict);

    const prospects = unique.filter((l) => isProspect(l.site_verdict));
    const leads = onlyProspects ? prospects : unique;

    // The no-website leads have nothing to scrape — go find their socials properly.
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const SOCIAL_LOOKUP_CAP = 25;
    if (anthropicKey) {
      const noSite = leads.filter((l) => l.site_verdict === "none" && !l.socials.length).slice(0, SOCIAL_LOOKUP_CAP);
      await findSocials(anthropicKey, noSite);
    }

    // Best prospects first: no site at all, then social/builder, then stale.
    const rank: Record<Verdict, number> = { none: 0, social: 1, builder: 2, stale: 3, modern: 4 };
    leads.sort((a, b) => rank[a.site_verdict] - rank[b.site_verdict] || b.reviews - a.reviews);

    return new Response(JSON.stringify({
      leads,
      count: leads.length,
      scanned: unique.length,
      prospects: prospects.length,
      area,
      state: stateCode,
      outOfState: dropped,
      probed: probing.length,
      withSocials: leads.filter((l) => l.socials.length > 0).length,
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Live search failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
