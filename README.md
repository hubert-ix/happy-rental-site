# Happy Rental

Collects rental listings from the saved-search **alert emails** that realtor.ca, rentals.ca, Zolo, Kijiji and others send you. It pulls out the details, de-duplicates across sites, checks each listing against your area and must-haves, and pings you when a match appears.

No scraping: every listing arrives through each site's own alert feature.

```
Saved searches on each site ──► Gmail (label: rental-alerts)
                                      │  every 30 min (or daily)
                                      ▼
                         /api/ingest (SvelteKit on Vercel)
        Gmail IMAP → Claude extracts fields → LocationIQ geocode
                 → inside polygon? → filters + tags → merge duplicates
                                      │
                    Supabase (listings) ──► Dashboard (map + list + status)
                                      └───► Email digest / ntfy push for new matches
```

## Current criteria

Edit these in `src/lib/server/config.js`.

| | |
|---|---|
| Hard filters | 3+ bedrooms (above grade, so "3+1" counts) · ≤ $3,500 · inside Finch–Eglinton / Bathurst–Victoria Park · not basement/lower |
| Points | backyard +30 · 2+ parking +30 (1 spot +15) · garage or storage +25 · +3 per $100 under budget |
| Penalty | −20 when a listing explicitly says a feature is missing |
| Notify at | every new listing that passes the filters |

A value the email doesn't mention never fails a listing. It shows as a grey `? parking` tag so you know what to ask about.

---

## Setup (about 45 minutes)

### 1. Supabase
1. Create a project (region **ca-central-1** if you want it close by).
2. In the SQL editor, run `supabase/schema.sql`.
3. Under **Settings → API Keys**, create a secret key (`sb_secret_...`) and put it in `.env` as `SUPABASE_SECRET_KEY`, along with the project URL. You don't need the publishable key: the dashboard loads its data on the server, so the browser never talks to Supabase.

### 2. A Gmail inbox for alerts
Use a dedicated Gmail account (e.g. `hubert.rentals@gmail.com`). It keeps the noise out of your main inbox, and the app only ever sees that account.

Create a Gmail filter: *from:(realtor.ca OR rentals.ca OR zolo.ca OR kijiji.ca OR condos.ca OR strata.ca OR housesigma.com OR padmapper.com OR zumper.com OR liv.rent)* → **Apply label `rental-alerts`**, Skip Inbox (optional).

### 3. Gmail access (app password)
No Google Cloud project needed. The app reads mail over IMAP and sends the digest over SMTP.
1. Sign in to the alerts account and turn on **2-Step Verification** (myaccount.google.com → Security). App passwords only appear once it's on.
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), create one named `Happy Rental`, and copy the 16 characters.
3. In `.env`, set `GMAIL_USER` to the alerts address and `GMAIL_APP_PASSWORD` to the app password.
4. IMAP is on by default for Gmail. If the first run fails to log in, check Gmail → Settings → *Forwarding and POP/IMAP* → **Enable IMAP**.

The app password can only read and send mail in this one account. Revoke it on the same page at any time.

### 4. Claude API key
Get one at console.anthropic.com and set `ANTHROPIC_API_KEY`. Extraction uses Haiku. A typical alert email costs a fraction of a cent, so expect well under $1/month.

Without a key the app still runs, but it only records listing links (no price/beds/features).

### 5. Saved searches on each site
Sign up with the alerts address and save a search with email alerts set to **instant** where offered.

- **realtor.ca**: For Rent → Residential → 3+ beds → max $3,500 → draw your area on the map → Save search → notifications on.
- **rentals.ca**: search North York / Toronto, 3+ beds, ≤ $3,500 → "Create an Alert".
- **Zolo, Condos.ca, Strata, HouseSigma**: save a Willowdale / Bayview Village / Lawrence Park search with alerts.
- **Kijiji**: search "3 bedroom main floor" in Toronto Long Term Rentals, max $3,500 → Save search → email alerts.

Set the site filters a bit looser than your real criteria (e.g. don't require a garage). Each site words features differently, and the scorer handles the nuance.

### 6. Run locally
```bash
cp .env.example .env    # fill it in
npm install
npm test                # 29 tests, no network needed
npm run ingest:local    # one ingest pass against your real inbox
npm run dev             # dashboard at http://localhost:5173 (any username + DASHBOARD_PASSWORD)
```

### 7. Deploy to Vercel
1. Push to GitHub, import into Vercel, and add every `.env` variable in Project Settings → Environment Variables.
2. **Scheduling**, pick one:
   - **Vercel Pro**: change `vercel.json` to `"schedule": "*/30 * * * *"`.
   - **Vercel Hobby** (one run per day max): keep the daily Vercel cron and add the **pg_cron** job at the bottom of `schema.sql`. It calls `/api/ingest` every 30 minutes from Supabase for free.
3. Phone push (optional): install the **ntfy** app, subscribe to a long random topic name, and set `NTFY_TOPIC` to it.

---

## Things to check

- **The area polygon is approximate.** The points in `config.js` follow the major intersections along Finch, Victoria Park, Eglinton and Bathurst. Changes take effect for existing listings on the next run. Paste `AREA_GEOJSON` into [geojson.io](https://geojson.io) and nudge any edge that's off. Listings within a block of a boundary are where it matters.
- **Geocoding** uses LocationIQ (free key, 5,000 lookups/day; results cached in `geocode_cache`). Sign up at locationiq.com and set `LOCATIONIQ_KEY`. Without a key it falls back to public Nominatim, which usually refuses requests from Vercel. Listings that couldn't be located are retried on every run, and failures are logged in Vercel's function logs. Until a listing is located it passes with a `? location` tag, so check those by eye.
- **Your first real emails:** after the first `ingest:local`, look at the `alert_emails` table. Any row with an `error`, or with `listing_count = 0` for a real alert, means that site's format needs a tweak to the prompt in `extract.js`.

## Files

```
src/lib/server/config.js    criteria, weights, polygon   ← edit me
src/lib/server/gmail.js     Gmail IMAP read + SMTP send (app password)
src/lib/server/extract.js   HTML→text, link/MLS detection, Claude extraction, normalising, dedupe keys
src/lib/server/geo.js       point-in-polygon + cached geocoding (LocationIQ, Nominatim fallback)
src/lib/server/score.js     hard filters + feature tags
src/lib/server/ingest.js    the pipeline + cross-site merge
src/lib/server/notify.js    email digest + ntfy push
src/routes/api/ingest       cron endpoint (Bearer CRON_SECRET)
src/routes/+page.*          dashboard: map, list, status buttons, notes
src/hooks.server.js         basic-auth gate for the dashboard
scripts/                    local ingest runner
supabase/schema.sql         tables + optional pg_cron schedule
```
