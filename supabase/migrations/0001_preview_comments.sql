-- Preview change-requests: client-dropped pins + comments on a published preview.
-- Positions are stored as fractions (0..1) of the rendered document so a pin
-- re-renders at the same spot regardless of viewport width.
--
-- No migration tooling is wired up in this repo yet, so run this once in the
-- Supabase SQL editor (Dashboard → SQL) for project hifuypelxeryqqrfhapx.

create table if not exists public.preview_comments (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null,
  org_id     uuid,
  x_pct      double precision not null,   -- 0..1 of document width
  y_pct      double precision not null,   -- 0..1 of document height
  text       text not null,
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists preview_comments_slug_idx on public.preview_comments(slug);

alter table public.preview_comments enable row level security;

-- Clients submit comments through the edge function (service role), so no
-- anonymous insert policy is needed. Relay users read/manage comments that
-- belong to their own workspace.
drop policy if exists "read own org preview comments" on public.preview_comments;
create policy "read own org preview comments" on public.preview_comments
  for select using (org_id in (select org_id from public.profiles where id = auth.uid()));

drop policy if exists "manage own org preview comments" on public.preview_comments;
create policy "manage own org preview comments" on public.preview_comments
  for update using (org_id in (select org_id from public.profiles where id = auth.uid()));

drop policy if exists "delete own org preview comments" on public.preview_comments;
create policy "delete own org preview comments" on public.preview_comments
  for delete using (org_id in (select org_id from public.profiles where id = auth.uid()));
