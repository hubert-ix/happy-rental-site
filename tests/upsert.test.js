import { describe, it, expect, vi, beforeEach } from 'vitest';
import { upsertListing } from '../src/lib/server/ingest.js';
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
			single: async () => ({ data: payload, error: null }),
			insert: (row) => {
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
			{ url: 'https://www.kijiji.ca/v-apartments/x/123', address: '79 McKee Ave', unit: 'Front', price: 3600, bedrooms_raw: '3', has_backyard: true },
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
		expect(row.in_area).toBe(true);
		expect(row.passes_filters).toBe(true);
		expect(row.score).toBe(85);
		expect(row.notified_at).toBe(null); // price drop re-arms the notification
		expect(fetch).toHaveBeenCalledTimes(1); // geocoded once, then reused
	});
});
