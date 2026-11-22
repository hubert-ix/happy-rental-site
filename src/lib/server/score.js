import { CRITERIA, WEIGHTS } from './config.js';

/**
 * Hard filters decide passes (true/false). Soft features add points.
 * Unknown values never fail a listing; they add a "?" note so you know what to ask the landlord.
 * @returns {{ passes: boolean, score: number, notes: string[] }}
 */
export function scoreListing(l, c = CRITERIA, w = WEIGHTS) {
	const notes = [];
	let passes = true;
	let score = 0;
	const fail = (msg) => {
		passes = false;
		notes.push(`✗ ${msg}`);
	};

	// --- hard filters ---
	const unitText = [l.unit, l.property_type, l.address].filter(Boolean).join(' ').toLowerCase();
	const excluded = c.excludeUnitKeywords.find((k) => unitText.includes(k));
	if (excluded) fail(`${excluded} unit`);

	if (l.bedrooms === null || l.bedrooms === undefined) notes.push('? bedrooms');
	else if (l.bedrooms < c.minBedrooms) fail(`${l.bedrooms_raw ?? l.bedrooms} bed`);

	if (l.price === null || l.price === undefined) notes.push('? price');
	else if (l.price > c.maxPrice) fail(`$${l.price.toLocaleString('en-CA')} over budget`);

	if (l.in_area === false) fail('outside area');
	else if (l.in_area === null || l.in_area === undefined) notes.push('? location (not geocoded)');

	// --- soft features ---
	if (l.has_backyard === true) {
		score += w.backyard;
		notes.push('✓ backyard');
	} else if (l.has_backyard === false) {
		score += w.explicitNoPenalty;
		notes.push('✗ no backyard');
	} else notes.push('? backyard');

	let parking = l.parking_spaces;
	if ((parking === null || parking === undefined) && l.has_garage === true) parking = 1; // a garage is at least one spot
	if (parking === null || parking === undefined) notes.push('? parking');
	else if (parking >= c.minParking) {
		score += w.parking;
		notes.push(`✓ ${parking} parking`);
	} else if (parking >= 1) {
		score += Math.round(w.parking / 2);
		notes.push(`~ ${parking} parking`);
	} else {
		score += w.explicitNoPenalty;
		notes.push('✗ no parking');
	}

	if (l.has_garage === true || l.has_storage === true) {
		score += w.garageOrStorage;
		notes.push(l.has_garage ? '✓ garage' : '✓ storage');
	} else if (l.has_garage === false && l.has_storage === false) {
		score += w.explicitNoPenalty;
		notes.push('✗ no garage/storage');
	} else notes.push('? garage/storage');

	if (typeof l.price === 'number' && l.price <= c.maxPrice) {
		score += Math.floor((c.maxPrice - l.price) / 100) * w.underBudgetPer100;
	}

	return { passes, score: Math.max(score, 0), notes };
}
