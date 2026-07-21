-- Relay migration 011 — Deals: richer lead intake.
-- Three things we want captured the moment a lead lands, so a builder can start
-- research without chasing the salesperson:
--   website  — their current/old site (or "none"), the starting point for a rebuild
--   socials  — FB/IG/Google profile links; often the only place their photos + hours live
--   industry — drives which similar sites we pull for reference
-- Run in the Supabase SQL editor after 010. Safe to re-run.

alter table public.deals add column if not exists website  text;
alter table public.deals add column if not exists socials  text;
alter table public.deals add column if not exists industry text;

-- Industry is the main slice we filter/report on ("show me all the roofers").
create index if not exists deals_industry_idx on public.deals (industry);
