import { db } from './supabase.js';
import { openMailbox } from './gmail.js';
import { extractListings, dedupeKey, normalizeAddress, normalizeListing, parseBedrooms } from './extract.js';
import { geocode, pointInPolygon } from './geo.js';
import { scoreListing } from './score.js';
import { notifyMatches } from './notify.js';
import { CRITERIA } from './config.js';

const pick = (next, prev) => (next === null || next === undefined ? prev ?? null : next);
// For yes/no features: a "true" from any site wins; otherwise take whichever is known.
const pickBool = (next, prev) => (next === true || prev === true ? true : pick(next, prev));

// A locked field protects the columns that go with it
const LOCK_COLUMNS = {
	address: ['address', 'addr_key'],
	bedrooms_raw: ['bedrooms_raw', 'bedrooms']
};
const lockedColumns = (field) => LOCK_COLUMNS[field] ?? [field];

/** Insert a new listing or merge it into the one we already have (matched by MLS, then address). */
export async function upsertListing(env, supabase, l) {
	const key = dedupeKey(l);
	const addrKey = l.address ? normalizeAddress(l.address, l.unit) : null;

	let { data: existing } = await supabase.from('listings').select('*').eq('dedupe_key', key).maybeSingle();
	if (!existing && addrKey) {
		({ data: existing } = await supabase.from('listings').select('*').eq('addr_key', addrKey).limit(1).maybeSingle());
	}
	const prev = existing || {};
	// Fields you corrected on the dashboard are never overwritten by a new email
	const locked = new Set(prev.locked_fields || []);
	const keep = (field, next) => (locked.has(field) ? prev[field] : next);

	const merged = {
		mls: pick(l.mls, prev.mls),
		url: pick(prev.url, l.url), // keep the first link we saw as the primary one
		urls: [...new Set([...(prev.urls || []), l.url].filter(Boolean))],
		sources: [...new Set([...(prev.sources || []), l.source].filter(Boolean))],
		address: keep('address', pick(l.address, prev.address)),
		addr_key: locked.has('address') ? prev.addr_key : pick(addrKey, prev.addr_key),
		unit: pick(l.unit, prev.unit),
		price: keep('price', pick(l.price, prev.price)),
		previous_price: prev.previous_price ?? null,
		bedrooms: pick(l.bedrooms, prev.bedrooms),
		bedrooms_raw: pick(l.bedrooms_raw, prev.bedrooms_raw),
		bathrooms: pick(l.bathrooms, prev.bathrooms),
		sqft_raw: pick(l.sqft_raw, prev.sqft_raw),
		sqft_min: pick(l.sqft_min, prev.sqft_min),
		sqft_max: l.sqft_min !== null && l.sqft_min !== undefined ? l.sqft_max : prev.sqft_max ?? null,
		parking_spaces: pick(l.parking_spaces, prev.parking_spaces),
		has_garage: pickBool(l.has_garage, prev.has_garage),
		has_backyard: pickBool(l.has_backyard, prev.has_backyard),
		has_storage: pickBool(l.has_storage, prev.has_storage),
		property_type: pick(l.property_type, prev.property_type),
		summary: pick(l.summary, prev.summary),
		lat: prev.lat ?? null,
		lng: prev.lng ?? null,
		last_seen: new Date().toISOString()
	};

	// Restore every locked field (and its related columns) to the value you set
	for (const field of locked) for (const col of lockedColumns(field)) if (col in merged) merged[col] = prev[col];

	const priceLocked = locked.has('price');
	const priceDropped = existing && !priceLocked && l.price && prev.price && l.price < prev.price;
	if (existing && !priceLocked && l.price && prev.price && l.price !== prev.price) merged.previous_price = prev.price;

	if (merged.lat === null && merged.address) {
		const hit = await geocode(env, supabase, merged.address);
		if (hit) Object.assign(merged, hit);
	}
	merged.in_area = merged.lat === null ? null : pointInPolygon(merged.lng, merged.lat);

	const { passes, notes } = scoreListing(merged);
	merged.passes_filters = passes;
	merged.score_notes = notes;
	if (priceDropped) merged.notified_at = null; // a price drop is worth another ping

	if (existing) {
		const { error } = await supabase.from('listings').update(merged).eq('id', existing.id);
		if (error) throw error;
		return { id: existing.id, isNew: false };
	}
	const { data, error } = await supabase
		.from('listings')
		.insert({ ...merged, dedupe_key: key })
		.select('id')
		.single();
	if (error) throw error;
	return { id: data.id, isNew: true };
}

/**
 * Retry geocoding for listings that still have no coordinates (e.g. the geocoder was down
 * when they arrived), then re-check the area filter and rescore them.
 */
export async function backfillLocations(env, supabase, limit = 20) {
	const { data: rows } = await supabase
		.from('listings')
		.select('*')
		.is('lat', null)
		.not('address', 'is', null)
		.not('status', 'in', '(rejected,gone,deleted)')
		.order('first_seen', { ascending: false })
		.limit(limit);

	let located = 0;
	for (const row of rows || []) {
		const hit = await geocode(env, supabase, row.address);
		if (!hit) continue;
		const updated = { ...row, ...hit, in_area: pointInPolygon(hit.lng, hit.lat) };
		const { passes, notes } = scoreListing(updated);
		const { error } = await supabase
			.from('listings')
			.update({ lat: hit.lat, lng: hit.lng, in_area: updated.in_area, passes_filters: passes, score_notes: notes })
			.eq('id', row.id);
		if (!error) located++;
	}
	return located;
}

/**
 * Re-apply the current scoring rules and search area to every listing, so changes to criteria,
 * weights or AREA_POLYGON in config.js also reach listings that arrived earlier.
 * Only rows whose result changed are written.
 */
export async function rescoreAll(supabase) {
	const { data: rows } = await supabase.from('listings').select('*').not('status', 'in', '(gone,deleted)').limit(1000);
	let changed = 0;
	for (const row of rows || []) {
		// Recheck the area too, so changes to AREA_POLYGON apply to listings located earlier
		const in_area = row.lat == null || row.lng == null ? row.in_area : pointInPolygon(row.lng, row.lat);
		const { passes, notes } = scoreListing({ ...row, in_area });
		const same =
			row.in_area === in_area &&
			row.passes_filters === passes &&
			JSON.stringify(row.score_notes) === JSON.stringify(notes);
		if (same) continue;
		const { error } = await supabase
			.from('listings')
			.update({ in_area, passes_filters: passes, score_notes: notes })
			.eq('id', row.id);
		if (!error) changed++;
	}
	return changed;
}

export async function runIngest(env, { dashboardUrl } = {}) {
	const supabase = db(env);
	const max = Number(env.MAX_EMAILS_PER_RUN || 15);
	const summary = { emailsFound: 0, emailsProcessed: 0, listingsSeen: 0, newListings: 0, located: 0, rescored: 0, notified: 0, errors: [] };

	const mailbox = await openMailbox(env);
	try {
		const ids = await mailbox.listMessageIds(env.GMAIL_QUERY || 'label:rental-alerts newer_than:7d');
		summary.emailsFound = ids.length;

		const { data: done } = ids.length
			? // Emails that failed (error set) are retried on the next run
				await supabase.from('alert_emails').select('gmail_id').in('gmail_id', ids).is('error', null)
			: { data: [] };
		const doneSet = new Set((done || []).map((d) => d.gmail_id));
		const todo = ids.filter((id) => !doneSet.has(id)).slice(0, max);

		// Vercel stops functions at 60s: don't start a new email after ~40s; the rest wait for the next run
		const started = Date.now();
		const budgetMs = Number(env.INGEST_BUDGET_MS || 40_000);

		for (const id of todo) {
			if (Date.now() - started > budgetMs) {
				summary.deferred = todo.length - summary.emailsProcessed;
				break;
			}
			const record = { gmail_id: id, listing_count: 0, error: null };
			try {
				const email = await mailbox.getMessage(id);
				Object.assign(record, { received_at: email.receivedAt, sender: email.from, subject: email.subject });
				const { source, listings } = await extractListings(env, email);
				record.source = source;
				for (const l of listings) {
					const { isNew } = await upsertListing(env, supabase, l);
					summary.listingsSeen++;
					if (isNew) summary.newListings++;
				}
				record.listing_count = listings.length;
			} catch (err) {
				record.error = String(err?.message || err).slice(0, 1000);
				summary.errors.push({ id, error: record.error });
			}
			await supabase.from('alert_emails').upsert(record);
			summary.emailsProcessed++;
		}
	} finally {
		await mailbox.close();
	}

	summary.located = await backfillLocations(env, supabase);
	summary.rescored = await rescoreAll(supabase);

	const { data: matches } = await supabase
		.from('listings')
		.select('*')
		.eq('passes_filters', true)
		.is('notified_at', null)
		.not('status', 'in', '(rejected,gone,deleted)')
		.order('first_seen', { ascending: false });

	if (matches?.length) {
		await notifyMatches(env, matches, dashboardUrl);
		await supabase
			.from('listings')
			.update({ notified_at: new Date().toISOString() })
			.in('id', matches.map((m) => m.id));
		summary.notified = matches.length;
	}
	return summary;
}

// Fields that can be set by hand, from the edit form or the "Add listing" form
const EDITABLE = ['address', 'unit', 'price', 'bedrooms_raw', 'bathrooms', 'parking_spaces', 'has_backyard', 'has_garage', 'has_storage', 'url', 'summary'];

/**
 * Apply values set on the dashboard. Every field that changes is locked so later emails don't
 * overwrite it; a new address is re-geocoded, and the listing is re-scored straight away.
 * `fields` may hold any of EDITABLE; fields left undefined are untouched.
 */
export async function applyManualEdit(env, supabase, id, fields) {
	const { data: row, error: readError } = await supabase.from('listings').select('*').eq('id', id).single();
	if (readError || !row) throw new Error(readError?.message || `Listing ${id} not found`);

	const changes = {};
	const locked = new Set(row.locked_fields || []);

	for (const field of EDITABLE) {
		const value = fields[field];
		if (value === undefined || value === row[field]) continue;
		changes[field] = value;
		locked.add(field);
	}

	if ('address' in changes) {
		const address = changes.address;
		changes.addr_key = address ? normalizeAddress(address, changes.unit ?? row.unit) : row.addr_key;
		const hit = address ? await geocode(env, supabase, address) : null;
		changes.lat = hit?.lat ?? null;
		changes.lng = hit?.lng ?? null;
		changes.in_area = hit ? pointInPolygon(hit.lng, hit.lat) : null;
	}
	if ('price' in changes) changes.previous_price = null; // a correction isn't a price change
	if ('bedrooms_raw' in changes) changes.bedrooms = parseBedrooms(changes.bedrooms_raw);
	if ('url' in changes && changes.url) changes.urls = [...new Set([...(row.urls || []), changes.url])];
	if (!Object.keys(changes).length) return row;

	const { passes, notes } = scoreListing({ ...row, ...changes });
	Object.assign(changes, { passes_filters: passes, score_notes: notes, locked_fields: [...locked] });

	const { error } = await supabase.from('listings').update(changes).eq('id', id);
	if (error) throw new Error(error.message);
	return { ...row, ...changes };
}

/**
 * Add a listing typed in on the dashboard. It goes through the same path as email imports
 * (duplicate check, geocoding, scoring), then everything you entered is applied and locked.
 * Returns { id, isNew }: isNew is false when it matched a listing already in the list.
 */
export async function addManualListing(env, supabase, fields, notes) {
	if (!fields.address) throw new Error('An address or title is required');
	const listing = normalizeListing(fields, 'manual');
	const { id, isNew } = await upsertListing(env, supabase, listing);

	const entered = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined && v !== ''));
	await applyManualEdit(env, supabase, id, entered);
	// applyManualEdit skips values that already match: lock them too, since you entered them
	const { data: row } = await supabase.from('listings').select('*').eq('id', id).single();
	const locked = [...new Set([...(row?.locked_fields || []), ...Object.keys(entered)])];
	const extra = { locked_fields: locked };
	if (notes) extra.notes = notes;
	await supabase.from('listings').update(extra).eq('id', id);
	return { id, isNew };
}
