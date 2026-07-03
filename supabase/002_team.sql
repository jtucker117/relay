-- Relay migration 002 — Team & users (invites + role management)
-- Run in the Supabase SQL editor after schema.sql. Safe to re-run.

-- Pending invites. When someone signs up with a matching email, handle_new_user
-- attaches them to the org with this role and deletes the invite.
create table if not exists invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  email       text not null,
  name        text not null default '',
  role        text not null default 'Salesperson'
                check (role in ('Admin','Salesperson','Builder')),
  invited_by  text not null default '',
  created_at  timestamptz not null default now(),
  unique (org_id, email)
);
create index if not exists invites_email_idx on invites(lower(email));

alter table invites enable row level security;
drop policy if exists invites_org_all on invites;
create policy invites_org_all on invites
  for all using (org_id = auth_org()) with check (org_id = auth_org());

-- Let org members remove OTHER members' profiles (not themselves).
drop policy if exists profiles_delete_org on profiles;
create policy profiles_delete_org on profiles
  for delete using (org_id = auth_org() and user_id <> auth.uid());

-- Replace the signup handler so it honors a pending invite (join that org + role),
-- otherwise create an org-less profile that goes through onboarding as an Owner.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv invites%rowtype;
begin
  select * into inv from invites where lower(email) = lower(coalesce(new.email, '')) limit 1;

  insert into profiles (user_id, email, name, org_id, role, pending)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'name', inv.name, ''),
    inv.org_id,                                   -- null when no invite → onboarding
    coalesce(inv.role, 'Owner'),
    false
  )
  on conflict (user_id) do nothing;

  if inv.id is not null then
    delete from invites where id = inv.id;
  end if;

  return new;
end;
$$;
