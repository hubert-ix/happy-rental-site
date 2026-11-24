import { CRITERIA } from './config.js';

/**
 * Hard filters decide passes (true/false). Features become tags: ✓ has it, ✗ doesn't, ? not mentioned.
 * There is no computed score: you give each listing a score yourself on the dashboard.
 * @returns {{ passes: boolean, notes: string[] }}
 */
export function scoreListing(l, c = CRITERIA) {
	const notes = [];
	let passes = true;
	const fail = (msg) => {
		passes = false;
		notes.push(`✗ ${msg}`);
	};

	// --- hard filters ---
	const unitText = [l.unit, l.property_type, l.address].filter(Boolean).join(' ').toLowerCase();
	// Whole words only: "lower" must not match "Flowertown Ave"
	const excluded = c.excludeUnitKeywords.find((k) => new RegExp(`\\b${k}\\b`, 'i').test(unitText));
	const type = String(l.property_type ?? '').trim().toLowerCase();
	if (excluded) fail(`${excluded} unit`);
	else if (['room', 'commercial', 'parking'].includes(type)) fail(`${type}, not a home`);

	if (l.bedrooms === null || l.bedrooms === undefined) notes.push('? bedrooms');
	else if (l.bedrooms < c.minBedrooms) fail(`${l.bedrooms_raw ?? l.bedrooms} bed`);

	if (l.price === null || l.price === undefined) notes.push('? price');
	else if (l.price > c.maxPrice) fail(`$${l.price.toLocaleString('en-CA')} over budget`);
	else if (l.price < c.minPrice) fail(`$${l.price.toLocaleString('en-CA')} under $${c.minPrice.toLocaleString('en-CA')}`);

	if (l.in_area === false) fail('outside area');
	else if (l.in_area === null || l.in_area === undefined) notes.push('? location (not geocoded)');

	// --- feature tags ---
	if (l.has_backyard === true) notes.push('✓ backyard');
	else if (l.has_backyard === false) notes.push('✗ no backyard');
	else notes.push('? backyard');

	let parking = l.parking_spaces;
	if ((parking === null || parking === undefined) && l.has_garage === true) parking = 1; // a garage is at least one spot
	if (parking === null || parking === undefined) notes.push('? parking');
	else if (parking >= c.minParking) notes.push(`✓ ${parking} parking`);
	else if (parking >= 1) notes.push(`~ ${parking} parking`);
	else notes.push('✗ no parking');

	if (l.has_garage === true || l.has_storage === true) notes.push(l.has_garage ? '✓ garage' : '✓ storage');
	else if (l.has_garage === false && l.has_storage === false) notes.push('✗ no garage/storage');
	else notes.push('? garage/storage');

	return { passes, notes };
}
