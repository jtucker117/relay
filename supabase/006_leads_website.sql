-- Relay migration 006 — Leads: add website column.
-- The single most useful signal for a web-design agency: does this business already
-- have a real site? Populated by Google Places live search. Run after 004/005.
alter table public.leads add column if not exists website text;
