-- Fix: the preview_comments RLS policies referenced profiles.id, but this
-- schema keys profiles by user_id (auth.uid() = profiles.user_id). The wrong
-- column made the policies match nothing, so the Change requests list read
-- back empty. Recreate all three against user_id.

drop policy if exists "read own org preview comments" on public.preview_comments;
create policy "read own org preview comments" on public.preview_comments
  for select using (org_id in (select org_id from public.profiles where user_id = auth.uid()));

drop policy if exists "manage own org preview comments" on public.preview_comments;
create policy "manage own org preview comments" on public.preview_comments
  for update using (org_id in (select org_id from public.profiles where user_id = auth.uid()));

drop policy if exists "delete own org preview comments" on public.preview_comments;
create policy "delete own org preview comments" on public.preview_comments
  for delete using (org_id in (select org_id from public.profiles where user_id = auth.uid()));
