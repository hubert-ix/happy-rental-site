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

/**
 * Geocode a Toronto street address with OpenStreetMap Nominatim, cached in Supabase.
 * Nominatim's usage policy: max 1 request/second and an identifying User-Agent.
 */
export async function geocode(env, supabase, address) {
	if (!address) return null;
	const query = `${address.replace(/^(main|upper|lower|front|back|rear)\s*-\s*/i, '')}, Toronto, Ontario, Canada`;

	const { data: cached } = await supabase.from('geocode_cache').select('*').eq('query', query).maybeSingle();
	if (cached) return cached.found ? { lat: cached.lat, lng: cached.lng } : null;

	const wait = 1100 - (Date.now() - lastCall);
	if (wait > 0) await sleep(wait);
	lastCall = Date.now();

	const params = new URLSearchParams({
		q: query,
		format: 'jsonv2',
		limit: '1',
		countrycodes: 'ca',
		email: env.NOMINATIM_EMAIL || ''
	});
	const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
		headers: { 'user-agent': `rental-radar/0.1 (${env.NOMINATIM_EMAIL || 'personal use'})` }
	});
	if (!res.ok) return null; // transient; don't cache failures
	const [hit] = await res.json();
	const result = hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;

	await supabase.from('geocode_cache').upsert({
		query,
		lat: result?.lat ?? null,
		lng: result?.lng ?? null,
		found: !!result
	});
	return result;
}
