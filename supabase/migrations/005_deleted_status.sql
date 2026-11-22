-- Adds a "deleted" status: the listing is hidden everywhere, and kept as a marker so the same
-- listing arriving in a later email stays hidden instead of being re-created.
-- Run once in the Supabase SQL editor.
alter table listings drop constraint if exists listings_status_check;
alter table listings add constraint listings_status_check
  check (status in ('new','shortlisted','contacted','viewing','rejected','gone','deleted'));

-- To bring a deleted listing back:
--   update listings set status = 'new' where id = 123;
