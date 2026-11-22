import { AREA_POLYGON } from './config.js';

/** Ray-casting point-in-polygon. polygon = [[lng, lat], ...] */
export function pointInPolygon(lng, lat, polygon = AREA_POLYGON) {
	let inside = false;
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const [xi, yi] = polygon[i];
		const [xj, yj] = polygon[j];
		const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
		if (crosses) inside = !inside;
	}
	return inside;
}

let lastCall = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Strip unit prefixes like "Main - " or "Upper-" that confuse geocoders. */
export function geocodeQuery(address) {
	const street = address.replace(/^(main|upper|lower|front|back|rear|bsmt|basement)\s*(floor)?\s*[-–:]\s*/i, '').trim();
	return `${street}, Toronto, Ontario, Canada`;
}

/**
 * Which geocoder to call. LocationIQ (free key, 5,000/day) is used when LOCATIONIQ_KEY is set;
 * otherwise public OpenStreetMap Nominatim, which often refuses requests from cloud hosts like Vercel.
 * Both take the same parameters and return the same [{ lat, lon }] shape.
 */
function provider(env) {
	if (env.LOCATIONIQ_KEY) {
		return { name: 'LocationIQ', url: 'https://us1.locationiq.com/v1/search', minGapMs: 550, params: { key: env.LOCATIONIQ_KEY }, headers: {} };
	}
	return {
		name: 'Nominatim',
		url: 'https://nominatim.openstreetmap.org/search',
		minGapMs: 1100,
		params: { email: env.NOMINATIM_EMAIL || '' },
		headers: { 'user-agent': `happy-rental/0.1 (${env.NOMINATIM_EMAIL || 'personal use'})` }
	};
}

/**
 * Geocode a Toronto street address, cached in Supabase.
 * Returns { lat, lng }, or null when the address can't be found or the geocoder is unavailable.
 */
export async function geocode(env, supabase, address) {
	if (!address) return null;
	const query = geocodeQuery(address);

	const { data: cached } = await supabase.from('geocode_cache').select('*').eq('query', query).maybeSingle();
	if (cached) return cached.found ? { lat: cached.lat, lng: cached.lng } : null;

	const p = provider(env);
	const wait = p.minGapMs - (Date.now() - lastCall);
	if (wait > 0) await sleep(wait);
	lastCall = Date.now();

	const params = new URLSearchParams({ q: query, format: 'json', limit: '1', countrycodes: 'ca', ...p.params });
	let res;
	try {
		res = await fetch(`${p.url}?${params}`, { headers: p.headers });
	} catch (err) {
		console.warn(`${p.name} geocoding error for "${query}": ${err.message}`);
		return null;
	}

	// LocationIQ answers "no match" with 404 { error: "Unable to geocode" }: a real answer, so cache it
	const notFound = res.status === 404;
	if (!res.ok && !notFound) {
		// Rate limit, outage, bad key, blocked IP: don't cache, so the next run retries
		console.warn(`${p.name} geocoding failed for "${query}": HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
		return null;
	}

	const hit = notFound ? null : (await res.json())[0];
	const result = hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;

	const { error } = await supabase.from('geocode_cache').upsert({
		query,
		lat: result?.lat ?? null,
		lng: result?.lng ?? null,
		found: !!result
	});
	if (error) console.warn(`geocode_cache write failed: ${error.message}`);
	return result;
}
