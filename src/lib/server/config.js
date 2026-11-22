// Search criteria and the search area. Edit these to change what counts as a match.

export const CRITERIA = {
	minBedrooms: 3,
	maxPrice: 3500,
	minParking: 2,
	// Anything cheaper is almost always a basement, a single room, or a misread price
	minPrice: 2500,
	// Units whose address/type mention these words are rejected outright
	excludeUnitKeywords: [
		'basement', 'lower', 'bsmt', 'room for rent', 'shared',
		'commercial', 'office', 'retail', 'storefront', 'warehouse', 'parking space'
	],
	// Score at or above this (and passing hard filters) triggers a notification
	notifyMinScore: 50
};

// Points awarded for "nice to have" features. Unknown = 0 points but flagged.
export const WEIGHTS = {
	backyard: 30,
	parking: 30, // full points at minParking, half at 1 space
	garageOrStorage: 25,
	underBudgetPer100: 3, // small bonus for every $100 under maxPrice…
	underBudgetMax: 15, // …capped, so cheapness alone can't push a listing to the top
	explicitNoPenalty: -20 // listing explicitly says the feature is missing
};

/**
 * Search area: Finch (north), Eglinton (south), Bathurst (west), Victoria Park (east).
 * [lng, lat] pairs at the major intersections along those roads.
 * Victoria Park points are from geocoded addresses at Finch, Sheppard and Eglinton; the rest are
 * approximate. Paste AREA_GEOJSON into https://geojson.io to check or redraw.
 */
export const AREA_POLYGON = [
	[-79.444, 43.7745], // Bathurst & Finch
	[-79.4155, 43.7804], // Yonge & Finch
	[-79.3905, 43.785], // Bayview & Finch
	[-79.37, 43.788], // Leslie & Finch
	[-79.3315, 43.7947], // Victoria Park & Finch
	[-79.3238, 43.7755], // Victoria Park & Sheppard
	[-79.3025, 43.7255], // Victoria Park & Eglinton
	[-79.337, 43.72], // Eglinton at the DVP
	[-79.36, 43.7155], // Leslie & Eglinton
	[-79.377, 43.7115], // Bayview & Eglinton
	[-79.3985, 43.7066], // Yonge & Eglinton
	[-79.4265, 43.7], // Bathurst & Eglinton
	[-79.444, 43.7745] // close the ring
];

export const AREA_GEOJSON = {
	type: 'Feature',
	properties: { name: 'Finch–Eglinton / Bathurst–Victoria Park' },
	geometry: { type: 'Polygon', coordinates: [AREA_POLYGON] }
};
