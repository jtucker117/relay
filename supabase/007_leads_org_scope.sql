-- Relay migration 007 — Scope leads to a workspace (org).
-- Leads were originally a single global pool (any authenticated user saw all leads).
-- With more than one workspace that leaks across them, so partition by org_id like the
-- rest of Relay. New leads auto-attach to the inserter's workspace via the auth_org()
-- default, so no app change is needed. Run in the relay project after 004/005/006.

-- 1) Add the column.
alter table public.leads add column if not exists org_id uuid references orgs(id) on delete cascade;

-- 2) Backfill every existing lead to the SiteStac workspace (jordan@sitestac.com's org).
update public.leads
set org_id = (select org_id from profiles where lower(email) = 'jordan@sitestac.com' limit 1)
where org_id is null;

-- 3) New leads auto-attach to the inserting user's workspace.
alter table public.leads alter column org_id set default auth_org();

create index if not exists leads_org_idx on public.leads (org_id);

-- 4) Replace the global policies with org-scoped ones.
drop policy if exists "team can read leads"  on public.leads;
drop policy if exists "team can write leads"  on public.leads;

create policy leads_org_read  on public.leads for select using (org_id = auth_org());
create policy leads_org_write on public.leads for all    using (org_id = auth_org()) with check (org_id = auth_org());
