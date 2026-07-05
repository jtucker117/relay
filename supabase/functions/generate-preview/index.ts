// Supabase Edge Function: generate-preview
// Generates a complete, self-contained marketing site from a deal brief using
// Claude Opus 4.8 + the StakSites design philosophy. Runs server-side so the
// ANTHROPIC_API_KEY never touches the browser.
//
// Deploy:  supabase functions deploy generate-preview
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// (or create it in the Supabase dashboard → Edge Functions and paste this code)
//
// Uses a plain fetch to the Anthropic API (no SDK) for maximum Deno reliability.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Brief {
  industry?: string; website?: string; social?: string; timeline?: string;
  pages?: string[]; tones?: string[]; content?: string[]; colors?: string[];
  fonts?: string[]; refs?: string[]; notes?: string; gbp?: string;
  valueProp?: string; cta?: string; location?: string;
}

function buildPrompt(company: string, packageId: string, brief: Brief): string {
  const pageCount = packageId === "one" ? 1 : packageId === "three" ? 3 : 6;
  const structure = pageCount === 1
    ? "A single long-scroll page with 6-8 niche-native sections and a sticky/anchored nav."
    : `A ${pageCount}-section site with a working top nav. Use one HTML file with a tiny inline <script> that shows/hides sections (SPA-style), each section a full page.`;

  const b = brief || {};
  const lines = [
    `- Business name: ${company}`,
    b.industry && `- Niche (be specific): ${b.industry}`,
    b.valueProp && `- One-line value prop: ${b.valueProp}`,
    b.tones?.length && `- Tone (3 words): ${b.tones.join(", ")}`,
    b.cta && `- Primary action (the ONE CTA): ${b.cta}`,
    b.location && `- Location / service area: ${b.location}`,
    b.website && `- Existing site: ${b.website}`,
    b.social && `- Social: ${b.social}`,
    b.gbp && `- Google Business Profile: ${b.gbp}`,
    b.colors?.length && `- Brand colors (build the palette AROUND these): ${b.colors.join(", ")}`,
    b.fonts?.length && `- Font direction: ${b.fonts.join(", ")}`,
    b.pages?.length && `- Requested pages: ${b.pages.join(", ")}`,
    b.refs?.length && `- Reference sites: ${b.refs.join(", ")}`,
    b.content?.length && `- Content readiness: ${b.content.join(", ")}`,
    b.notes && `- Notes: ${b.notes}`,
  ].filter(Boolean).join("\n");

  return `ROLE
You are designing an Awwwards-caliber marketing site that must look made FOR THIS BUSINESS ALONE. If your output could be reskinned for an unrelated business just by swapping the copy, you have failed. Distinctiveness is the whole job.

BUSINESS BRIEF
${lines}

STEP 1 — NICHE RESEARCH (do this before designing)
- Identify 3-5 best-in-class real references in this exact niche and extract that category's NATIVE palette, typography, and layout/interaction patterns. Never borrow another niche's look.
- List 3 generic AI defaults you will deliberately NOT do.

STEP 2 — COMMIT TO ONE VISUAL ARCHETYPE
Pick ONE and let it drive everything: Cinematic Dark / Editorial-Magazine / Sport-Kinetic / Retro-Collector-Playful / Industrial-Utility / Soft-Organic / Brutalist-Editorial. Hybrids only if justified in one sentence.

STEP 3 — STRUCTURE TO THE NICHE
${structure}
Use the niche's real vocabulary and CTAs ("Reserve a Bay", "Get a Quote", "Add to Binder") — never generic "Get Started / Learn More".

STEP 4 — CRAFT BAR
- Distinctive, niche-native TYPE PAIRING (never Inter+Poppins). ONE committed accent palette built around the client's brand colors if provided; no default purple-on-white.
- A signature hero matched to the archetype; intentional asymmetric layout; off-grid meta labels; tasteful scroll/micro-interactions.

ANTI-PATTERNS — DO NOT SHIP
- Reused hero/palette across niches. Default shadcn-blue buttons. Rounded-2xl 3-card lucide grids. Purple-pink gradients on white. Glassmorphism. Two competing hero CTAs. Stock-photo placeholders. Emoji icons. Generic "Get Started / Learn More".

CONTENT RULES
- Use only the real business facts from the brief. No invented awards/stats. If a fact is missing, insert a clearly-marked [PLACEHOLDER: …]. Write niche-specific, voice-driven copy — no lorem.

TECH
- A single self-contained HTML document: inline <style> and any inline <script>. No external assets, no CDN links, no external fonts (use a strong system-font stack styled distinctively, or an embedded @font-face only if you inline the data). Fluid type via clamp(). Responsive and mobile-first. Respect prefers-reduced-motion. Semantic HTML, single <h1>.

OUTPUT
Return ONLY the raw HTML document, beginning with <!doctype html> and nothing else — no markdown, no code fences, no commentary.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set on this function.");

    const { company, packageId, brief } = await req.json();
    if (!company) throw new Error("Missing company.");

    const prompt = buildPrompt(company, packageId ?? "one", brief ?? {});

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 20000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `Anthropic API ${res.status}`);
    if (data?.stop_reason === "refusal") throw new Error("The model declined this request. Try adjusting the brief.");

    let html = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text).join("");
    // Strip accidental code fences and any preamble before <!doctype/<html.
    html = html.replace(/^```html?\s*/i, "").replace(/```\s*$/i, "").trim();
    const start = html.search(/<!doctype html|<html/i);
    if (start > 0) html = html.slice(start);

    return new Response(JSON.stringify({ html }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
