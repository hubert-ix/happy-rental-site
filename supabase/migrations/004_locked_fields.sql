-- Fields you've corrected by hand on the dashboard (e.g. {address,price}).
-- New emails about the listing never overwrite a locked field. Run once in the Supabase SQL editor.
alter table listings add column if not exists locked_fields text[] not null default '{}';
