-- Relay migration 003 — preview publishing (email-locked client portal)
-- Run in the Supabase SQL editor after 002_team.sql. Safe to re-run.

-- A published preview can be hosted HTML (in the `previews` Storage bucket) or an
-- external URL (e.g. a Lovable build — not code-protected, just embedded).
alter table previews add column if not exists external_url text;

-- Let signed-in app users manage the private `previews` Storage bucket (upload the
-- generated/uploaded HTML). The public portal reads it via the service role, never anon.
drop policy if exists previews_bucket_authed on storage.objects;
create policy previews_bucket_authed on storage.objects
  for all to authenticated
  using (bucket_id = 'previews')
  with check (bucket_id = 'previews');
