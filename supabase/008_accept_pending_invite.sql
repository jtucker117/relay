-- Relay migration 008 — accept_pending_invite()
-- handle_new_user only attaches a workspace to BRAND-NEW signups. If someone who already
-- has an account gets invited, they land org-less on onboarding. This RPC lets the app
-- attach such a user to the workspace that invited them, on their next login.
create or replace function public.accept_pending_invite()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inv invites%rowtype;
  my_email text;
begin
  select email into my_email from profiles where user_id = auth.uid();
  if my_email is null then return false; end if;

  select * into inv from invites where lower(email) = lower(my_email) limit 1;
  if inv.id is null then return false; end if;

  update profiles
    set org_id = inv.org_id,
        role   = coalesce(inv.role, 'Salesperson'),
        pending = false
  where user_id = auth.uid();

  delete from invites where id = inv.id;
  return true;
end $$;

grant execute on function public.accept_pending_invite() to authenticated;
