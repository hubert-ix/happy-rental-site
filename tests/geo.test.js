import { describe, it, expect, vi, beforeEach } from 'vitest';
import { geocode, geocodeQuery } from '../src/lib/server/geo.js';

function fakeCache() {
	const rows = [];
	return {
		rows,
		from: () => ({
			select: () => ({ eq: (k, v) => ({ maybeSingle: async () => ({ data: rows.find((r) => r[k] === v) ?? null }) }) }),
			upsert: async (row) => (rows.push(row), { error: null })
		})
	};
}

beforeEach(() => vi.unstubAllGlobals());

describe('geocode', () => {
	it('strips unit prefixes from the query', () => {
		expect(geocodeQuery('Main - 139 McKee Avenue')).toBe('139 McKee Avenue, Toronto, Ontario, Canada');
		expect(geocodeQuery('UPPER-80 Alamosa Dr')).toBe('80 Alamosa Dr, Toronto, Ontario, Canada');
	});

	it('uses LocationIQ when a key is set, and caches the hit', async () => {
		const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => [{ lat: '43.77', lon: '-79.41' }] }));
		vi.stubGlobal('fetch', fetchMock);
		const db = fakeCache();
		const hit = await geocode({ LOCATIONIQ_KEY: 'pk.test' }, db, '139 McKee Avenue');
		expect(hit).toEqual({ lat: 43.77, lng: -79.41 });
		expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/us1\.locationiq\.com\/v1\/search\?.*key=pk\.test/);
		expect(db.rows).toHaveLength(1);
		// second call is served from the cache
		expect(await geocode({ LOCATIONIQ_KEY: 'pk.test' }, db, '139 McKee Avenue')).toEqual({ lat: 43.77, lng: -79.41 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('caches LocationIQ "Unable to geocode" (404) as not found', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, text: async () => '' })));
		const db = fakeCache();
		expect(await geocode({ LOCATIONIQ_KEY: 'k' }, db, '1 Nowhere Lane')).toBe(null);
		expect(db.rows[0].found).toBe(false);
	});

	it('does not cache errors, so the next run retries', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, text: async () => 'blocked' })));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const db = fakeCache();
		expect(await geocode({}, db, '2 Somewhere St')).toBe(null);
		expect(db.rows).toHaveLength(0);
		expect(warn.mock.calls[0][0]).toContain('Nominatim geocoding failed');
		expect(warn.mock.calls[0][0]).toContain('HTTP 403');
	});
});
