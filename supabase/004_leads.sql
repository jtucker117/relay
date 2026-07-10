-- Relay migration 004 — Leads board (outreach pool: business info + outreach tracking in one)
-- Run in the Supabase SQL editor after schema.sql. Safe to re-run.
-- Ports the standalone SiteStac lead tool into Relay so outreach is shared across the team.
--
-- NOTE on scoping: Relay's other tables are org-scoped via auth_org(). Leads are a single
-- shared team pool (Jordan + Spencer, one org today), so this table is intentionally global
-- to any authenticated user rather than org_id-partitioned. Revisit if Relay goes multi-org.

create table if not exists public.leads (
  id           text primary key,           -- Google place_id when available, else generated id
  place_id     text,                        -- Google Places id (null for manual/live-search leads)
  name         text not null,
  category     text,
  area         text,
  phone        text,
  address      text,
  zip          text,
  rating       numeric,
  reviews      integer default 0,
  web_status   text check (web_status in ('confirmed','likely','maybe')) default 'likely',
  lat          double precision,
  lng          double precision,
  source       text check (source in ('places','manual','live')) default 'manual',

  -- outreach tracking
  status       text check (status in ('new','contacted','followup','interested','won','lost','unfit')) default 'new',
  contacted_on date,
  notes        text,

  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists leads_area_idx     on public.leads (area);
create index if not exists leads_status_idx   on public.leads (status);
create index if not exists leads_category_idx on public.leads (category);

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads
  for each row execute function public.touch_updated_at();

-- Row Level Security — logged-in team members only (Relay requires Supabase auth).
alter table public.leads enable row level security;

drop policy if exists "team can read leads"   on public.leads;
drop policy if exists "team can write leads"   on public.leads;

create policy "team can read leads"
  on public.leads for select
  to authenticated using (true);

create policy "team can write leads"
  on public.leads for all
  to authenticated using (true) with check (true);
