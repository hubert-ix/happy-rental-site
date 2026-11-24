-- Adds a "reviewed" status: you've looked at the listing, but haven't decided anything yet.
-- Run once in the Supabase SQL editor.
alter table listings drop constraint if exists listings_status_check;
alter table listings add constraint listings_status_check
  check (status in ('new','reviewed','shortlisted','contacted','viewing','rejected','gone','deleted'));
