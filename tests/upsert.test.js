import { describe, it, expect, vi, beforeEach } from 'vitest';
import { upsertListing, applyManualEdit } from '../src/lib/server/ingest.js';
import { normalizeListing } from '../src/lib/server/extract.js';

// Tiny in-memory stand-in for the parts of supabase-js that ingest uses.
function fakeSupabase() {
	const tables = { listings: [], geocode_cache: [] };
	let nextId = 1;
	const query = (table) => {
		const filters = [];
		let op = 'select';
		let payload;
		const rows = () => tables[table].filter((r) => filters.every(([k, v]) => r[k] === v));
		const api = {
			select: () => api,
			eq: (k, v) => (filters.push([k, v]), op === 'update' ? run() : api),
			limit: () => api,
			maybeSingle: async () => ({ data: rows()[0] ?? null }),
			single: async () => ({ data: op === 'insert' ? payload : rows()[0] ?? null, error: null }),
			insert: (row) => {
				op = 'insert';
				payload = { ...row, id: nextId++ };
				tables[table].push(payload);
				return api;
			},
			update: (patch) => ((op = 'update'), (payload = patch), api),
			upsert: async (row) => {
				tables[table].push(row);
				return { error: null };
			}
		};
		const run = async () => {
			rows().forEach((r) => Object.assign(r, payload));
			return { error: null };
		};
		return api;
	};
	return { from: query, tables };
}

beforeEach(() => {
	// Geocoder: pretend every McKee address sits at Yonge/Sheppard
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({ ok: true, json: async () => [{ lat: '43.770', lon: '-79.414' }] }))
	);
});

describe('upsertListing', () => {
	it('merges the same unit seen on Kijiji (no MLS) and realtor.ca (with MLS)', async () => {
		const sb = fakeSupabase();
		const env = { NOMINATIM_EMAIL: 'test@example.com' };

		const kijiji = normalizeListing(
			{ url: 'https://www.kijiji.ca/v-apartments/x/123', address: '79 McKee Ave', unit: 'Front', price: 3600, bedrooms_raw: '3', has_backyard: true, sqft_raw: '1100-1500' },
			'kijiji'
		);
		const first = await upsertListing(env, sb, kijiji);
		expect(first.isNew).toBe(true);

		const realtor = normalizeListing(
			{
				url: 'https://www.realtor.ca/real-estate/30051369/front-79-mckee-avenue',
				mls: 'C13579778',
				address: '79 McKee Avenue',
				unit: 'FRONT',
				price: 3500,
				bedrooms_raw: '3',
				parking_spaces: 4,
				has_garage: true,
				has_backyard: null
			},
			'realtor.ca'
		);
		const second = await upsertListing(env, sb, realtor);
		expect(second.isNew).toBe(false);
		expect(sb.tables.listings).toHaveLength(1);

		const row = sb.tables.listings[0];
		expect(row.sources).toEqual(['kijiji', 'realtor.ca']);
		expect(row.mls).toBe('C13579778');
		expect(row.price).toBe(3500);
		expect(row.previous_price).toBe(3600);
		expect(row.has_backyard).toBe(true); // kept from Kijiji even though realtor.ca didn't say
		expect([row.sqft_min, row.sqft_max]).toEqual([1100, 1500]); // kept: realtor.ca didn't state a size
		expect(row.in_area).toBe(true);
		expect(row.passes_filters).toBe(true);
		expect(row.score).toBe(85);
		expect(row.notified_at).toBe(null); // price drop re-arms the notification
		expect(fetch).toHaveBeenCalledTimes(1); // geocoded once, then reused
	});
});

describe('manual edits', () => {
	it('saves a corrected title and price, re-scores, and keeps them when new emails arrive', async () => {
		const sb = fakeSupabase();
		const env = { NOMINATIM_EMAIL: 'test@example.com' };

		// Kijiji paste with a misread price and no proper address
		const misread = normalizeListing(
			{ url: 'https://www.kijiji.ca/v-apartments/x/999', address: 'Listing', price: 1900, bedrooms_raw: '3' },
			'kijiji'
		);
		const { id } = await upsertListing(env, sb, misread);
		expect(sb.tables.listings[0].passes_filters).toBe(false); // $1,900 is under the minimum

		await applyManualEdit(env, sb, id, { address: '79 McKee Avenue', price: 3300 });
		let row = sb.tables.listings[0];
		expect(row.address).toBe('79 McKee Avenue');
		expect(row.price).toBe(3300);
		expect(row.previous_price).toBe(null);
		expect(row.locked_fields.sort()).toEqual(['address', 'price']);
		expect(row.in_area).toBe(true); // re-geocoded from the new address
		expect(row.passes_filters).toBe(true); // re-scored with the corrected price

		// The same ad arrives again with the wrong price: the correction must survive
		await upsertListing(env, sb, misread);
		row = sb.tables.listings[0];
		expect(sb.tables.listings).toHaveLength(1);
		expect(row.address).toBe('79 McKee Avenue');
		expect(row.price).toBe(3300);
		expect(row.previous_price).toBe(null);
		expect(row.passes_filters).toBe(true);
	});

	it('only locks the fields that actually changed', async () => {
		const sb = fakeSupabase();
		const l = normalizeListing({ url: 'https://x.ca/v-a/1', address: '1 A St', price: 3000, bedrooms_raw: '3' }, 'kijiji');
		const { id } = await upsertListing({}, sb, l);
		await applyManualEdit({}, sb, id, { address: '1 A St', price: 3100 });
		expect(sb.tables.listings[0].locked_fields).toEqual(['price']);
	});
});

describe('deleted listings', () => {
	it('stay deleted when the same listing arrives in a later email', async () => {
		const sb = fakeSupabase();
		const l = normalizeListing({ url: 'https://x.ca/v-a/7', address: '7 Basement Rd', price: 2600, bedrooms_raw: '3' }, 'kijiji');
		const { id } = await upsertListing({}, sb, l);
		sb.tables.listings[0].status = 'deleted'; // what the dashboard's delete action does

		const again = await upsertListing({}, sb, { ...l, price: 2550 });
		expect(again).toEqual({ id, isNew: false });
		expect(sb.tables.listings).toHaveLength(1);
		expect(sb.tables.listings[0].status).toBe('deleted');
	});
});
