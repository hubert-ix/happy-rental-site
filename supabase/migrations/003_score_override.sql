-- Lets you set a listing's score yourself. Run once in the Supabase SQL editor.
-- The computed score keeps updating as new emails arrive; your override wins while it's set.
alter table listings
  add column if not exists score_override int,
  add column if not exists effective_score int generated always as (coalesce(score_override, score)) stored;

create index if not exists listings_effective_score_idx on listings (effective_score desc);
