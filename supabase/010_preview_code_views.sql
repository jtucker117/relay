-- Relay migration 010 — preview access code + view tracking
-- access_code: a short code the client enters to view (no account/email needed).
-- view_count / last_viewed_at: track when the client opens the preview.
alter table public.previews add column if not exists access_code   text;
alter table public.previews add column if not exists view_count    integer not null default 0;
alter table public.previews add column if not exists last_viewed_at timestamptz;
