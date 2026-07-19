-- Relay migration 009 — preview_drafts
-- Persist the in-progress website preview per deal so an uploaded / AI-generated
-- preview survives a page refresh (it used to live only in React state and vanish).
create table if not exists public.preview_drafts (
  deal_id      uuid primary key references deals(id) on delete cascade,
  org_id       uuid not null default auth_org() references orgs(id) on delete cascade,
  html         text,
  external_url text,
  updated_at   timestamptz not null default now()
);

alter table public.preview_drafts enable row level security;
drop policy if exists preview_drafts_org on public.preview_drafts;
create policy preview_drafts_org on public.preview_drafts for all
  using (org_id = auth_org()) with check (org_id = auth_org());
