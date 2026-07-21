-- Relay migration 012 — Leads: why a business is a prospect, and how to reach them.
--
-- site_verdict / site_reason come from the lead-search function actually fetching the
-- business's homepage, so the board can say "Copyright still says 2016" instead of just
-- guessing from the URL. socials holds profile links scraped from that page (or found by
-- web search for the no-website leads, who are the best prospects and the hardest to reach).
--
-- Run in the Supabase SQL editor after 011. Safe to re-run.

alter table public.leads add column if not exists site_verdict text
  check (site_verdict in ('none','social','builder','stale','modern'));
alter table public.leads add column if not exists site_reason text;
alter table public.leads add column if not exists socials jsonb not null default '[]'::jsonb;

-- "Show me every business in Conroe with no site" is the main query this board exists for.
create index if not exists leads_site_verdict_idx on public.leads (site_verdict);

-- Backfill the verdict for rows captured before this migration, from what we already know.
update public.leads
   set site_verdict = case
         when website is null or btrim(website) = '' then 'none'
         when website ~* 'facebook\.com|instagram\.com|linktr\.ee|yelp\.com' then 'social'
         when website ~* 'wixsite\.com|godaddysites\.com|business\.site|weebly\.com' then 'builder'
         else 'modern'
       end,
       site_reason = case
         when website is null or btrim(website) = '' then 'No website at all'
         else 'Carried over — not yet checked'
       end
 where site_verdict is null;
