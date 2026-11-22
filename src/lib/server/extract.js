// Turn an alert email into structured listings.
// 1) htmlToText keeps link targets inline so nothing is lost.
// 2) Claude reads the text and returns listings through a forced tool call (strict JSON).
// 3) normalizeListing cleans the numbers. Without an API key we fall back to link-only rows.

const SOURCES = [
	['realtor.ca', /realtor\.ca/i],
	['rentals.ca', /rentals\.ca/i],
	['zolo', /zolo\.ca/i],
	['kijiji', /kijiji\.ca/i],
	['condos.ca', /condos\.ca/i],
	['strata', /strata\.ca/i],
	['housesigma', /housesigma\.com/i],
	['zumper', /zumper\.com|padmapper\.com/i],
	['liv.rent', /liv\.rent/i],
	['facebook', /facebookmail\.com|facebook\.com/i]
];

export function detectSource(from = '', body = '') {
	for (const [name, re] of SOURCES) if (re.test(from)) return name;
	for (const [name, re] of SOURCES) if (re.test(body)) return name;
	return 'other';
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#36': '$' };

function decodeEntities(s) {
	return s
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
		.replace(/&([a-z0-9#]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Unwrap click-tracking redirects such as https://click.x.com/?u=https%3A%2F%2Frealtor.ca%2F... */
export function unwrapUrl(href) {
	try {
		const u = new URL(href);
		for (const value of u.searchParams.values()) {
			if (/^https?:\/\//i.test(value)) return unwrapUrl(value);
		}
	} catch {
		/* not a URL */
	}
	return href;
}

/** Strip tracking params so the same listing link from two emails compares equal. */
export function normalizeUrl(href) {
	try {
		const u = new URL(unwrapUrl(href));
		for (const key of [...u.searchParams.keys()]) {
			if (/^(utm_|mc_|fbclid|gclid|ref|source|cid|campaign)/i.test(key)) u.searchParams.delete(key);
		}
		u.hash = '';
		return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + u.search).toLowerCase();
	} catch {
		return href.toLowerCase();
	}
}

export function htmlToText(html) {
	if (!html) return '';
	let s = html
		.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, ' $1 ')
		.replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
			const label = inner.replace(/<[^>]+>/g, ' ').trim();
			return ` ${label} [${unwrapUrl(decodeEntities(href))}] `;
		})
		.replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d|\/table)[^>]*>/gi, '\n')
		.replace(/<td[^>]*>/gi, ' | ')
		.replace(/<[^>]+>/g, ' ');
	s = decodeEntities(s);
	return s
		.split('\n')
		.map((l) => l.replace(/[ \t ]+/g, ' ').trim())
		.filter(Boolean)
		.join('\n');
}

const LISTING_LINK_PATTERNS = [
	/https?:\/\/(?:www\.)?realtor\.ca\/real-estate\/\d+\/[^\s\])"']+/gi,
	/https?:\/\/(?:www\.)?rentals\.ca\/[a-z-]+\/[a-z0-9-]+(?:\/[a-z0-9-]+)?/gi,
	/https?:\/\/(?:www\.)?zolo\.ca\/[a-z-]+-real-estate\/[a-z0-9-]+(?:\/[a-z0-9-]+)?/gi,
	/https?:\/\/(?:www\.)?kijiji\.ca\/v-[^\s\])"']+\/\d+/gi,
	/https?:\/\/(?:www\.)?condos\.ca\/toronto\/[^\s\])"']+/gi,
	/https?:\/\/(?:www\.)?strata\.ca\/toronto\/[^\s\])"']+/gi
];

/** Deterministic pass: every link that looks like an individual listing page. */
export function extractListingLinks(text) {
	const seen = new Map();
	for (const re of LISTING_LINK_PATTERNS) {
		for (const m of text.matchAll(re)) {
			const key = normalizeUrl(m[0]);
			if (!seen.has(key)) seen.set(key, m[0]);
		}
	}
	return [...seen.values()];
}

/** MLS numbers in Toronto look like C13579778, E1234567, W..., N..., X... */
export function findMls(text = '') {
	const m = text.match(/\b(?:MLS[®#:\s]*)?([CEWNSX]\d{7,8})\b/);
	return m ? m[1].toUpperCase() : null;
}

const EXTRACT_TOOL = {
	name: 'record_listings',
	description: 'Record every distinct rental listing found in the email.',
	// Grammar-constrained output: the input is guaranteed to match this schema (a real array, never a string)
	strict: true,
	input_schema: {
		type: 'object',
		properties: {
			listings: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						url: { type: ['string', 'null'], description: 'Link to this listing exactly as it appears in [brackets]' },
						mls: { type: ['string', 'null'] },
						address: { type: ['string', 'null'], description: 'Street address only, e.g. "79 McKee Avenue"' },
						unit: { type: ['string', 'null'], description: 'e.g. "Main", "Upper", "Front", "Lower", "1203"' },
						neighbourhood: { type: ['string', 'null'] },
						price: { type: ['number', 'null'], description: 'Monthly rent in CAD' },
						bedrooms_raw: { type: ['string', 'null'], description: 'As written, e.g. "3+1"' },
						bathrooms: { type: ['number', 'null'] },
						sqft_raw: { type: ['string', 'null'], description: 'Interior size as written, e.g. "1100-1500 sqft", "1,400 sq. ft."' },
						parking_spaces: { type: ['number', 'null'] },
						has_garage: { type: ['boolean', 'null'] },
						has_backyard: { type: ['boolean', 'null'] },
						has_storage: { type: ['boolean', 'null'] },
						property_type: { type: ['string', 'null'], description: 'house, main floor, townhouse, condo, basement...' },
						summary: { type: ['string', 'null'], description: 'One short sentence in your own words' }
					},
					required: ['url', 'address', 'price', 'bedrooms_raw'],
					additionalProperties: false
				}
			}
		},
		required: ['listings'],
		additionalProperties: false
	}
};

const SYSTEM = `You extract rental listings from real-estate alert emails sent to a renter in Toronto.
Rules:
- One entry per distinct listing. Ignore ads, "similar homes" upsells, agent bios, and footer links.
- Only record what the email states. Use null for anything not stated. Never guess.
- Booleans: true if stated present, false only if explicitly stated absent ("no parking", "no yard access"), otherwise null.
- A garage counts as has_garage=true; a shed, locker or "storage" counts as has_storage=true.
- Exclusive or shared backyard access both count as has_backyard=true.
- If an email is not a listing alert at all, return an empty list.`;

/**
 * The tool's `listings` should be an array, but with long emails the model sometimes sends it as a
 * JSON string (or a single object). Accept all three shapes.
 */
export function coerceListings(value) {
	if (Array.isArray(value)) return value;
	if (typeof value === 'string') {
		// Strip ```json fences or stray text around the JSON before parsing
		const cleaned = value.replace(/^\s*```(?:json)?|```\s*$/g, '').trim();
		const start = cleaned.search(/[[{]/);
		const end = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
		try {
			return coerceListings(JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned));
		} catch {
			throw new Error(`Claude returned listings as text that is not valid JSON: ${value.slice(0, 200)}`);
		}
	}
	if (value && typeof value === 'object') return Array.isArray(value.listings) ? value.listings : [value];
	return [];
}

function claudeRequest(env, { subject, from, text }, tool) {
	return fetch('https://api.anthropic.com/v1/messages', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-api-key': env.ANTHROPIC_API_KEY,
			'anthropic-version': '2023-06-01'
		},
		body: JSON.stringify({
			model: env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
			// ~150 tokens per listing: room for a full page of pasted search results
			max_tokens: 16000,
			system: SYSTEM,
			tools: [tool],
			tool_choice: { type: 'tool', name: tool.name },
			messages: [
				{
					role: 'user',
					content: `From: ${from}\nSubject: ${subject}\n\n${text.slice(0, 60_000)}`
				}
			]
		})
	});
}

export async function extractWithClaude(env, email) {
	let res = await claudeRequest(env, email, EXTRACT_TOOL);
	if (res.status === 400) {
		// If strict mode is ever rejected (model or schema not supported), retry without it once
		const body = await res.text();
		if (!/strict|schema/i.test(body)) throw new Error(`Claude extraction failed: 400 ${body}`);
		console.warn(`Strict tool use rejected, retrying without it: ${body.slice(0, 200)}`);
		const { strict, ...lenientTool } = EXTRACT_TOOL;
		res = await claudeRequest(env, email, lenientTool);
	}
	if (!res.ok) throw new Error(`Claude extraction failed: ${res.status} ${await res.text()}`);
	const json = await res.json();
	if (json.stop_reason === 'max_tokens') {
		throw new Error('Too many listings in one email for a single extraction; split it into smaller emails');
	}
	const call = json.content?.find((c) => c.type === 'tool_use');
	return coerceListings(call?.input?.listings);
}

function toNumber(v) {
	if (v === null || v === undefined || v === '') return null;
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	const n = Number(String(v).replace(/[^0-9.]/g, ''));
	return Number.isFinite(n) && String(v).match(/\d/) ? n : null;
}

/** "3+1" -> 3, "3 beds" -> 3, "Studio" -> 0 */
export function parseBedrooms(raw) {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === 'number') return raw;
	if (/studio|bachelor/i.test(raw)) return 0;
	const m = String(raw).match(/(\d+(?:\.\d+)?)/);
	return m ? Number(m[1]) : null;
}

/**
 * "1100-1500 sqft" -> { min: 1100, max: 1500 }, "1,400 sq. ft." -> { min: 1400, max: 1400 },
 * "2000+" -> { min: 2000, max: null }. Values under 200 are ignored, as are metres.
 */
export function parseSqft(raw) {
	if (raw === null || raw === undefined || raw === '') return { min: null, max: null };
	if (typeof raw === 'number') return raw >= 200 ? { min: raw, max: raw } : { min: null, max: null };
	const s = String(raw).replace(/,/g, '');
	if (/\bm(²|2|eters?|etres?)\b|sq\.?\s*m\b/i.test(s)) return { min: null, max: null };
	const nums = [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Math.round(Number(m[0]))).filter((n) => n >= 200);
	if (!nums.length) return { min: null, max: null };
	if (nums.length === 1) return { min: nums[0], max: /\+/.test(s) ? null : nums[0] };
	return { min: Math.min(nums[0], nums[1]), max: Math.max(nums[0], nums[1]) };
}

export function normalizeListing(raw, source) {
	const sqft = parseSqft(raw.sqft_raw);
	const url = raw.url ? unwrapUrl(raw.url) : null;
	const mls = (raw.mls && String(raw.mls).toUpperCase().replace(/[^A-Z0-9]/g, '')) || findMls(url || '') || null;
	return {
		source,
		url,
		mls,
		address: raw.address?.trim() || null,
		unit: raw.unit?.trim() || null,
		neighbourhood: raw.neighbourhood || null,
		price: toNumber(raw.price),
		bedrooms_raw: raw.bedrooms_raw ?? null,
		bedrooms: parseBedrooms(raw.bedrooms_raw),
		bathrooms: toNumber(raw.bathrooms),
		sqft_raw: raw.sqft_raw ?? null,
		sqft_min: sqft.min,
		sqft_max: sqft.max,
		parking_spaces: toNumber(raw.parking_spaces),
		has_garage: typeof raw.has_garage === 'boolean' ? raw.has_garage : null,
		has_backyard: typeof raw.has_backyard === 'boolean' ? raw.has_backyard : null,
		has_storage: typeof raw.has_storage === 'boolean' ? raw.has_storage : null,
		property_type: raw.property_type || null,
		summary: raw.summary || null
	};
}

export function normalizeAddress(address = '', unit = '') {
	const street = address
		.toLowerCase()
		.replace(/\b(avenue)\b/g, 'ave')
		.replace(/\b(street)\b/g, 'st')
		.replace(/\b(drive)\b/g, 'dr')
		.replace(/\b(road)\b/g, 'rd')
		.replace(/\b(crescent)\b/g, 'cres')
		.replace(/\b(boulevard)\b/g, 'blvd')
		.replace(/\b(court)\b/g, 'crt')
		.replace(/,.*$/, '') // drop ", Toronto, ON ..."
		.replace(/[^a-z0-9 ]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	const u = (unit || '').toLowerCase().replace(/[^a-z0-9]/g, '');
	return u ? `${street}#${u}` : street;
}

export function dedupeKey(l) {
	if (l.mls) return `mls:${l.mls}`;
	if (l.address) return `addr:${normalizeAddress(l.address, l.unit)}`;
	if (l.url) return `url:${normalizeUrl(l.url)}`;
	return null;
}

export async function extractListings(env, email) {
	const text = htmlToText(email.html) || email.text || '';
	const source = detectSource(email.from, text);

	let raw;
	if (env.ANTHROPIC_API_KEY) {
		raw = await extractWithClaude(env, { subject: email.subject, from: email.from, text });
	} else {
		// Fallback: link-only rows, so you at least see something in the dashboard
		raw = extractListingLinks(text).map((url) => ({ url, address: null, price: null, bedrooms_raw: null }));
	}
	return { source, listings: raw.map((r) => normalizeListing(r, source)).filter((l) => dedupeKey(l)) };
}
