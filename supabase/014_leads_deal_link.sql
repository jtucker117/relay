-- Relay migration 014 — Leads: link a lead to the deal it became.
--
-- Converting a lead to a pipeline deal is one-way and easy to do twice by accident
-- (two people working the same board, or one person hitting the button again after a
-- refresh). Storing the deal id makes the board show "In pipeline" and lets the convert
-- action skip anything already converted.
--
-- Run in the Supabase SQL editor after 013. Safe to re-run.

alter table public.leads add column if not exists deal_id uuid
  references public.deals(id) on delete set null;

create index if not exists leads_deal_id_idx on public.leads (deal_id);
