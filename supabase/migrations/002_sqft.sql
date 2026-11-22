-- Adds square footage. Run once in the Supabase SQL editor on an existing database.
alter table listings
  add column if not exists sqft_raw text,
  add column if not exists sqft_min int,
  add column if not exists sqft_max int;
