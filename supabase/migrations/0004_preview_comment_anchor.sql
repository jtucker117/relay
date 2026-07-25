-- Anchor pins to the DOM element they were dropped on (JSON: {sel, ox, oy}) so
-- they follow content across responsive breakpoints, instead of floating at a
-- fixed x/y that only lines up at the width they were created. x_pct/y_pct stay
-- as a fallback when the element can't be resolved.
alter table public.preview_comments add column if not exists anchor text;
