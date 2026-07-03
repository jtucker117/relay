-- Relay CRM — Supabase schema (Critical 1: auth + shared multi-tenant DB)
-- Run in the Supabase SQL editor (or `supabase db push`). Idempotent-ish: safe to re-run
-- during setup, but DROP-and-recreate policies if you change them.
--
-- Model: one agency = one `orgs` row (workspace). Every business table carries `org_id`
-- and is guarded by RLS so a row is only visible to members of its org. `previews` are the
-- exception — the public client portal reads them through an Edge Function using the service
-- role AFTER the email-lock check, never via the anon client.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Core tenancy: orgs + profiles
-- ---------------------------------------------------------------------------
create table if not exists orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- One profile per auth user. role drives permissions (Owner/Admin/Salesperson/Builder).
create table if not exists profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid references orgs(id) on delete set null,
  name        text not null default '',
  email       text not null default '',
  role        text not null default 'Owner'
                check (role in ('Owner','Admin','Salesperson','Builder')),
  pending     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Helper: the caller's org_id. `stable` + security definer so RLS policies can call it
-- without recursing into profiles' own RLS.
create or replace function auth_org()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from profiles where user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Deals (+ comments, attachments as child tables; brief embedded as jsonb)
-- ---------------------------------------------------------------------------
create table if not exists deals (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  company     text not null default '',
  name        text not null default '',
  contact     text not null default '',
  email       text not null default '',
  phone       text,
  package_id  text not null default 'one' check (package_id in ('one','three','multi')),
  addons      text[] not null default '{}',
  stage       text not null default 'lead'
                check (stage in ('lead','qualified','proposal','negotiation','won')),
  source      text not null default '',
  notes       text not null default '',
  brief       jsonb,                       -- { website, social, industry, timeline, pages[], tones[], content[], colors[], fonts[], logo, refs[], notes, gbp, valueProp, cta, location }
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists deals_org_idx on deals(org_id);

create table if not exists comments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  deal_id     uuid not null references deals(id) on delete cascade,
  author      text not null default '',
  initials    text not null default '',
  text        text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists comments_deal_idx on comments(deal_id);

create table if not exists attachments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  deal_id     uuid not null references deals(id) on delete cascade,
  type        text not null check (type in ('link','image')),
  url         text not null,
  label       text,
  name        text,
  created_at  timestamptz not null default now()
);
create index if not exists attachments_deal_idx on attachments(deal_id);

-- ---------------------------------------------------------------------------
-- Activities
-- ---------------------------------------------------------------------------
create table if not exists activities (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  title       text not null default '',
  deal        text not null default '',     -- denormalized deal/company label (matches prototype)
  type        text not null default 'task' check (type in ('call','email','meeting','task')),
  bucket      text not null default 'today' check (bucket in ('today','tomorrow','week')),
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists activities_org_idx on activities(org_id);

-- ---------------------------------------------------------------------------
-- Previews (+ pins). HTML body lives in Storage bucket `previews` at `<slug>.html`.
-- ---------------------------------------------------------------------------
create table if not exists previews (
  slug          text primary key,
  org_id        uuid not null references orgs(id) on delete cascade,
  deal_id       uuid references deals(id) on delete set null,
  company       text not null default '',
  contact       text not null default '',
  client_email  text not null default '',
  package_name  text not null default '',
  tier_name     text not null default '',
  status        text not null default 'review' check (status in ('review','approved','changes')),
  active        boolean not null default true,   -- kill switch
  build_status  text check (build_status in ('building','shipped')),
  published_at  timestamptz not null default now(),
  expiry        timestamptz not null default (now() + interval '14 days'),
  decided_at    timestamptz,
  updated_at    timestamptz not null default now()
);
create index if not exists previews_org_idx on previews(org_id);
create index if not exists previews_deal_idx on previews(deal_id);

create table if not exists pins (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  preview_slug  text not null references previews(slug) on delete cascade,
  x             numeric not null,            -- percent 0-100
  y             numeric not null,
  text          text not null default '',
  reply         text,
  replied_by    text,
  replied_at    timestamptz,
  resolved      boolean not null default false,
  created_at    timestamptz not null default now()
);
create index if not exists pins_preview_idx on pins(preview_slug);

-- ---------------------------------------------------------------------------
-- Invoices (+ lines, signature). One invoice per deal (prototype keys by dealId).
-- ---------------------------------------------------------------------------
create table if not exists invoices (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  deal_id           uuid not null references deals(id) on delete cascade,
  number            text not null,           -- INV-YYYY-NNNNN
  status            text not null default 'draft' check (status in ('draft','sent','paid')),
  deposit_pct       integer not null default 50,
  tax_pct           numeric not null default 0,
  notes             text not null default '',
  client_name       text not null default '',
  client_company    text not null default '',
  client_email      text not null default '',
  auto_bill         boolean not null default false,
  bill_day          integer,                 -- 1-31
  stripe_session_id text,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  paid_at           timestamptz,
  unique (deal_id)
);
create index if not exists invoices_org_idx on invoices(org_id);

create table if not exists invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  invoice_id  uuid not null references invoices(id) on delete cascade,
  descr       text not null default '',
  amount      numeric not null default 0,
  recurring   boolean not null default false,
  custom      boolean not null default false,
  sort        integer not null default 0
);
create index if not exists invoice_lines_invoice_idx on invoice_lines(invoice_id);

create table if not exists signatures (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  invoice_id  uuid not null references invoices(id) on delete cascade,
  mode        text not null check (mode in ('draw','type')),
  image       text,                          -- data URL for draw mode (move to Storage later)
  name        text,                          -- typed name for type mode
  signed_at   timestamptz not null default now(),
  unique (invoice_id)
);

-- ---------------------------------------------------------------------------
-- Org settings (business info that brands invoices)
-- ---------------------------------------------------------------------------
create table if not exists org_settings (
  org_id      uuid primary key references orgs(id) on delete cascade,
  name        text not null default 'SiteStac',
  tagline     text not null default '',
  site        text not null default 'sitestac.com',
  email       text not null default '',
  phone       text not null default '',
  addr        text not null default '',
  logo        text not null default ''       -- Storage path or data URL
);

-- ---------------------------------------------------------------------------
-- Bootstrap: create a bare profile on signup; RPC to spin up the first org.
-- ---------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (user_id, email, name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Called once by the first user to create their agency workspace and become its Owner.
create or replace function bootstrap_org(org_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org uuid;
begin
  if (select org_id from profiles where user_id = auth.uid()) is not null then
    raise exception 'You already belong to an org';
  end if;
  insert into orgs (name) values (org_name) returning id into new_org;
  update profiles set org_id = new_org, role = 'Owner' where user_id = auth.uid();
  insert into org_settings (org_id, name) values (new_org, org_name)
    on conflict (org_id) do nothing;
  return new_org;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table orgs           enable row level security;
alter table profiles       enable row level security;
alter table deals          enable row level security;
alter table comments       enable row level security;
alter table attachments    enable row level security;
alter table activities     enable row level security;
alter table previews       enable row level security;
alter table pins           enable row level security;
alter table invoices       enable row level security;
alter table invoice_lines  enable row level security;
alter table signatures     enable row level security;
alter table org_settings   enable row level security;

-- profiles: a user always sees their own row; members see others in their org.
drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles
  for select using (user_id = auth.uid() or org_id = auth_org());
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles
  for update using (user_id = auth.uid() or org_id = auth_org());
drop policy if exists profiles_insert_self on profiles;
create policy profiles_insert_self on profiles
  for insert with check (user_id = auth.uid());

-- orgs: members can read their own org.
drop policy if exists orgs_member on orgs;
create policy orgs_member on orgs
  for select using (id = auth_org());

-- Generic per-org policy applied to every business table.
do $$
declare t text;
begin
  foreach t in array array[
    'deals','comments','attachments','activities','previews','pins',
    'invoices','invoice_lines','signatures','org_settings'
  ] loop
    execute format('drop policy if exists %I_org_all on %I;', t, t);
    execute format(
      'create policy %I_org_all on %I for all using (org_id = auth_org()) with check (org_id = auth_org());',
      t, t
    );
  end loop;
end $$;

-- Note: the public client portal does NOT use these policies. The preview Edge Function
-- validates the email-lock cookie, then reads/writes previews + pins with the service role
-- (which bypasses RLS). Never expose the service key to the browser.
