-- Relay cleanup — remove leads captured before live search was fenced to a state.
--
-- The old search had no geographic fence, so a query like "home builders" saved
-- businesses from Oregon to Florida onto the shared board. This deletes them.
--
-- NOT a migration: it deletes data. Run STEP 1 first, eyeball the list, then run STEP 2.
-- Requires migration 013 (the `state` column).

-- ---------------------------------------------------------------------------
-- STEP 1 — look before you delete. Nothing is removed by this query.
-- ---------------------------------------------------------------------------
select state, count(*) as leads, min(name) as example
  from public.leads
 where coalesce(state, '') <> 'TX'
 group by state
 order by leads desc;

-- Anything you've already worked is worth keeping regardless of where it is —
-- this shows out-of-state leads that are NOT untouched, so you don't lose real work.
select id, name, area, state, status, contacted_on
  from public.leads
 where coalesce(state, '') <> 'TX'
   and (status <> 'new' or contacted_on is not null or coalesce(notes, '') <> '')
 order by status;

-- ---------------------------------------------------------------------------
-- STEP 2 — delete. Only untouched ('new', never contacted, no notes) out-of-state
-- leads go; anything you've actually worked survives.
-- ---------------------------------------------------------------------------
-- delete from public.leads
--  where coalesce(state, '') <> 'TX'
--    and status = 'new'
--    and contacted_on is null
--    and coalesce(notes, '') = '';

-- Rows whose state never got backfilled (no parseable address) are left alone on
-- purpose — deleting on a null would take good Texas leads with it.
