-- Happy Rental schema. Run once in the Supabase SQL editor.
-- All access goes through the server with the secret key (sb_secret_...), which bypasses RLS,
-- so RLS is on with no policies: the publishable key can't read or write anything here.

create table if not exists alert_emails (
  gmail_id      text primary key,
  received_at   timestamptz,
  sender        text,
  subject       text,
  source        text,                 -- realtor.ca, rentals.ca, zolo, kijiji, ...
  listing_count int default 0,
  error         text,
  processed_at  timestamptz default now()
);

create table if not exists listings (
  id               bigint generated always as identity primary key,
  dedupe_key       text unique not null,   -- mls:<n> | url:<normalized> | addr:<normalized>
  addr_key         text,                   -- normalized street+unit, matches across sites without MLS
  mls              text,
  url              text,
  urls             text[] default '{}',    -- every link seen for this listing, across sites
  sources          text[] default '{}',
  address          text,
  unit             text,
  price            int,
  previous_price   int,
  bedrooms         numeric,                -- "3+1" is stored as 3 (above-grade)
  bedrooms_raw     text,
  bathrooms        numeric,
  sqft_raw         text,                   -- as written, e.g. "1100-1500"
  sqft_min         int,
  sqft_max         int,                    -- null for open-ended "2000+"
  parking_spaces   int,
  has_garage       boolean,                -- null = unknown
  has_backyard     boolean,
  has_storage      boolean,
  property_type    text,
  summary          text,
  lat              double precision,
  lng              double precision,
  in_area          boolean,                -- null = could not geocode
  passes_filters   boolean not null default false,
  score            int not null default 0,
  score_notes      text[] default '{}',
  status           text not null default 'new'
                   check (status in ('new','shortlisted','contacted','viewing','rejected','gone')),
  notes            text,
  notified_at      timestamptz,
  first_seen       timestamptz not null default now(),
  last_seen        timestamptz not null default now()
);

create index if not exists listings_score_idx on listings (passes_filters, score desc);
create index if not exists listings_status_idx on listings (status);
create index if not exists listings_addr_idx on listings (addr_key);

create table if not exists geocode_cache (
  query      text primary key,
  lat        double precision,
  lng        double precision,
  found      boolean not null,
  created_at timestamptz default now()
);

alter table alert_emails  enable row level security;
alter table listings      enable row level security;
alter table geocode_cache enable row level security;

-- ---------------------------------------------------------------------------
-- OPTIONAL: run ingest every 30 minutes from Supabase instead of Vercel Cron
-- (Vercel Hobby only allows one cron run per day). Enable the pg_cron and
-- pg_net extensions under Database > Extensions first, then edit and run:
--
-- select cron.schedule(
--   'rental-radar-ingest',
--   '*/30 * * * *',
--   $$
--   select net.http_get(
--     url     := 'https://YOUR-APP.vercel.app/api/ingest',
--     headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'),
--     timeout_milliseconds := 60000
--   );
--   $$
-- );
-- ---------------------------------------------------------------------------
