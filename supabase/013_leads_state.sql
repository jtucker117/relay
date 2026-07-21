-- Relay migration 013 — Leads: record the state.
-- Live search is fenced to one state (a query like "home builders" with no town in it
-- used to return results from Oregon to Florida). Storing the state lets the board
-- filter the same way and makes the fence auditable after the fact.
-- Run in the Supabase SQL editor after 012. Safe to re-run.

alter table public.leads add column if not exists state text;

create index if not exists leads_state_idx on public.leads (state);

-- Backfill from the address we already stored: "…, Conroe, TX 77301, USA".
update public.leads
   set state = upper((regexp_match(address, ',\s*([A-Z]{2})\s+\d{5}'))[1])
 where state is null
   and address is not null
   and address ~ ',\s*[A-Z]{2}\s+\d{5}';
