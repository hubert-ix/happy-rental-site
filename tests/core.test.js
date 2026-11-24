import { describe, it, expect } from 'vitest';
import { pointInPolygon } from '../src/lib/server/geo.js';
import { scoreListing } from '../src/lib/server/score.js';
import {
	htmlToText,
	extractListingLinks,
	unwrapUrl,
	normalizeUrl,
	normalizeListing,
	parseBedrooms,
	dedupeKey,
	normalizeAddress,
	detectSource,
	findMls,
	parseSqft
} from '../src/lib/server/extract.js';
import { parseRawEmail } from '../src/lib/server/gmail.js';
import { formatSqft } from '../src/lib/format.js';

describe('search area polygon', () => {
	const inside = {
		'79 McKee Ave (Yonge/Sheppard)': [-79.414, 43.77],
		'Bayview Village': [-79.38, 43.768],
		'Lawrence Park': [-79.395, 43.725],
		'Armour Heights': [-79.425, 43.74],
		'York Mills & Leslie': [-79.363, 43.757],
		'Parkwoods (east of the DVP)': [-79.325, 43.76],
		'Victoria Village': [-79.31, 43.735],
		'Woody Vine Way (just south of Finch, by Leslie)': [-79.368905, 43.789317],
		'Linus Rd at Finch (south side, by Don Mills)': [-79.3555, 43.7919]
	};
	const outside = {
		'Scarborough (current place)': [-79.25, 43.77],
		'Yonge & Steeles': [-79.42, 43.797],
		'North of Finch at Leslie (Old Cummer)': [-79.37, 43.7945],
		'West of Bathurst (Bathurst Manor)': [-79.455, 43.755],
		'South of Eglinton (Davisville)': [-79.395, 43.698],
		'East of Victoria Park (Wexford)': [-79.295, 43.75],
		'Warden & Sheppard': [-79.305, 43.78],
		'South of Eglinton (Flemingdon)': [-79.33, 43.714]
	};
	for (const [name, [lng, lat]] of Object.entries(inside)) {
		it(`includes ${name}`, () => expect(pointInPolygon(lng, lat)).toBe(true));
	}
	for (const [name, [lng, lat]] of Object.entries(outside)) {
		it(`excludes ${name}`, () => expect(pointInPolygon(lng, lat)).toBe(false));
	}
});

describe('scoring', () => {
	const base = {
		price: 3500,
		bedrooms: 3,
		bedrooms_raw: '3',
		in_area: true,
		has_backyard: null,
		parking_spaces: null,
		has_garage: null,
		has_storage: null
	};

	it('full match passes, with tags and no computed score', () => {
		const r = scoreListing({ ...base, has_backyard: true, parking_spaces: 4, has_garage: true });
		expect(r.passes).toBe(true);
		expect(r.score).toBeUndefined();
		expect(r.notes).toEqual(expect.arrayContaining(['✓ backyard', '✓ 4 parking', '✓ garage']));
	});

	it('over budget fails', () => {
		const r = scoreListing({ ...base, price: 4800 });
		expect(r.passes).toBe(false);
		expect(r.notes.some((n) => n.includes('over budget'))).toBe(true);
	});

	it('2 bedrooms fails, 3+1 passes', () => {
		expect(scoreListing({ ...base, bedrooms: 2, bedrooms_raw: '2+1' }).passes).toBe(false);
		expect(scoreListing({ ...base, bedrooms: 3, bedrooms_raw: '3+1' }).passes).toBe(true);
	});

	it('basement / lower units are excluded', () => {
		expect(scoreListing({ ...base, unit: 'Lower' }).passes).toBe(false);
		expect(scoreListing({ ...base, property_type: 'Basement apartment' }).passes).toBe(false);
	});

	it('outside area fails, unknown location passes with a flag', () => {
		expect(scoreListing({ ...base, in_area: false }).passes).toBe(false);
		const r = scoreListing({ ...base, in_area: null });
		expect(r.passes).toBe(true);
		expect(r.notes).toContain('? location (not geocoded)');
	});

	it('unknowns pass with ? notes', () => {
		const r = scoreListing(base);
		expect(r.passes).toBe(true);
		expect(r.notes).toEqual(expect.arrayContaining(['? backyard', '? parking', '? garage/storage']));
	});

	it('garage implies at least one parking spot', () => {
		const r = scoreListing({ ...base, has_garage: true });
		expect(r.notes).toContain('~ 1 parking');
	});
});

describe('email parsing', () => {
	const sampleHtml = `
	<html><head><style>.x{color:red}</style></head><body>
	<table>
	  <tr><td><a href="https://click.realtor.ca/track?u=https%3A%2F%2Fwww.realtor.ca%2Freal-estate%2F30051369%2Ffront-79-mckee-avenue-toronto-willowdale-east%3Futm_source%3Demail">FRONT - 79 MCKEE AVENUE</a></td></tr>
	  <tr><td>$3,500/Monthly &nbsp;|&nbsp; 3 Bedrooms &amp; 1 Bath</td></tr>
	  <tr><td>MLS&reg;: C13579778</td></tr>
	  <tr><td><a href="https://www.realtor.ca/real-estate/30311208/upper-80-alamosa-drive-toronto-bayview-village">UPPER - 80 ALAMOSA DRIVE</a></td></tr>
	  <tr><td><a href="https://www.realtor.ca/settings/unsubscribe">Unsubscribe</a></td></tr>
	</table></body></html>`;

	it('htmlToText keeps unwrapped link targets and decodes entities', () => {
		const text = htmlToText(sampleHtml);
		expect(text).toContain('FRONT - 79 MCKEE AVENUE [https://www.realtor.ca/real-estate/30051369/');
		expect(text).toContain('3 Bedrooms & 1 Bath');
		expect(text).not.toContain('color:red');
	});

	it('extractListingLinks finds listing pages but not footer links', () => {
		const links = extractListingLinks(htmlToText(sampleHtml));
		expect(links).toHaveLength(2);
		expect(links.some((l) => l.includes('unsubscribe'))).toBe(false);
	});

	it('unwraps tracking redirects and strips utm params', () => {
		const tracked = 'https://click.example.com/x?u=https%3A%2F%2Fwww.rentals.ca%2Fnorth-york%2F45-mayall-avenue%3Futm_source%3Dalert';
		expect(unwrapUrl(tracked)).toBe('https://www.rentals.ca/north-york/45-mayall-avenue?utm_source=alert');
		expect(normalizeUrl(tracked)).toBe('rentals.ca/north-york/45-mayall-avenue');
	});

	it('detects source from sender, then body', () => {
		expect(detectSource('REALTOR.ca <noreply@realtor.ca>')).toBe('realtor.ca');
		expect(detectSource('alerts@mail.com', 'see https://rentals.ca/x')).toBe('rentals.ca');
	});

	it('finds Toronto MLS numbers', () => {
		expect(findMls('MLS®: C13579778')).toBe('C13579778');
		expect(findMls('no number here')).toBe(null);
	});

	it('parses a raw multipart alert email', async () => {
		const raw = [
			'From: REALTOR.ca <noreply@realtor.ca>',
			'Subject: =?UTF-8?B?' + Buffer.from('3 new listings · Willowdale').toString('base64') + '?=',
			'Date: Sat, 21 Nov 2026 12:00:00 -0500',
			'MIME-Version: 1.0',
			'Content-Type: multipart/alternative; boundary="b1"',
			'',
			'--b1',
			'Content-Type: text/plain; charset=utf-8',
			'',
			'plain body',
			'--b1',
			'Content-Type: text/html; charset=utf-8',
			'Content-Transfer-Encoding: quoted-printable',
			'',
			'<b>$3,500/Monthly</b> =E2=80=93 3 beds',
			'--b1--',
			''
		].join('\r\n');
		const email = await parseRawEmail(Buffer.from(raw));
		expect(email.from).toContain('noreply@realtor.ca');
		expect(email.subject).toBe('3 new listings · Willowdale');
		expect(email.html).toContain('$3,500/Monthly</b> – 3 beds');
		expect(email.text).toBe('plain body');
		expect(email.receivedAt).toBe('2026-11-21T17:00:00.000Z');
	});
});

describe('normalising and de-duplication', () => {
	it('parses bedroom strings', () => {
		expect(parseBedrooms('3+1')).toBe(3);
		expect(parseBedrooms('3 beds')).toBe(3);
		expect(parseBedrooms('Bachelor')).toBe(0);
		expect(parseBedrooms(null)).toBe(null);
	});

	it('normalises messy prices', () => {
		const l = normalizeListing({ url: null, address: '79 McKee Avenue', price: '$3,500/mo', bedrooms_raw: '3' }, 'kijiji');
		expect(l.price).toBe(3500);
		expect(l.bedrooms).toBe(3);
	});

	it('same house from two sites gets the same address key', () => {
		expect(normalizeAddress('79 McKee Avenue, Toronto, ON', 'Front')).toBe(normalizeAddress('79 MCKEE AVE', 'FRONT'));
		expect(normalizeAddress('79 McKee Ave', 'Front')).not.toBe(normalizeAddress('79 McKee Ave', 'Back'));
	});

	it('prefers MLS, then address, then URL for the key', () => {
		expect(dedupeKey({ mls: 'C13579778', address: 'x' })).toBe('mls:C13579778');
		expect(dedupeKey({ address: '80 Alamosa Drive', unit: 'Upper' })).toBe('addr:80 alamosa dr#upper');
		expect(dedupeKey({ url: 'https://www.zolo.ca/toronto-real-estate/1-a/' })).toBe('url:zolo.ca/toronto-real-estate/1-a');
		expect(dedupeKey({})).toBe(null);
	});
});

describe('square footage', () => {
	it('parses ranges, single values and open-ended sizes', () => {
		expect(parseSqft('1100-1500 sqft')).toEqual({ min: 1100, max: 1500 });
		expect(parseSqft('1,400 sq. ft.')).toEqual({ min: 1400, max: 1400 });
		expect(parseSqft('2000+')).toEqual({ min: 2000, max: null });
		expect(parseSqft('1500 - 2000')).toEqual({ min: 1500, max: 2000 });
		expect(parseSqft(1250)).toEqual({ min: 1250, max: 1250 });
	});

	it('ignores missing, tiny and metric values', () => {
		expect(parseSqft(null)).toEqual({ min: null, max: null });
		expect(parseSqft('3 beds')).toEqual({ min: null, max: null });
		expect(parseSqft('130 m²')).toEqual({ min: null, max: null });
	});

	it('flows through normalizeListing', () => {
		const l = normalizeListing({ address: '1 A St', price: 3400, bedrooms_raw: '3', sqft_raw: '1100-1500' }, 'zolo');
		expect([l.sqft_min, l.sqft_max, l.sqft_raw]).toEqual([1100, 1500, '1100-1500']);
	});

	it('formats for display', () => {
		expect(formatSqft(1100, 1500)).toBe('1,100–1,500 sqft');
		expect(formatSqft(1400, 1400)).toBe('1,400 sqft');
		expect(formatSqft(2000, null)).toBe('2,000+ sqft');
		expect(formatSqft(null, null)).toBe(null);
	});
});

describe('scoring guards against bad prices and non-homes', () => {
	const base = { price: 3500, bedrooms: 3, bedrooms_raw: '3', in_area: true, has_backyard: null, parking_spaces: null, has_garage: null, has_storage: null };

	it('rejects anything under the minimum price (usually basements)', () => {
		const r = scoreListing({ ...base, price: 1900, parking_spaces: 1 });
		expect(r.passes).toBe(false);
		expect(r.notes).toContain('✗ $1,900 under $2,500');
		expect(scoreListing({ ...base, price: 2500 }).passes).toBe(true);
		expect(scoreListing({ ...base, price: null }).passes).toBe(true); // unknown price still shown, with a ? tag
	});

	it('rejects commercial space, single rooms and parking spots', () => {
		expect(scoreListing({ ...base, property_type: 'commercial' }).passes).toBe(false);
		expect(scoreListing({ ...base, property_type: 'Room' }).passes).toBe(false);
		expect(scoreListing({ ...base, property_type: 'office space' }).passes).toBe(false);
	});

	it('matches excluded words as whole words only', () => {
		expect(scoreListing({ ...base, address: '12 Flowertown Avenue' }).passes).toBe(true);
		expect(scoreListing({ ...base, property_type: '3 bedroom house' }).passes).toBe(true);
		expect(scoreListing({ ...base, unit: 'Lower' }).passes).toBe(false);
	});
});
