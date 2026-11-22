// Display helpers shared by the dashboard and the email digest.

const n = (v) => Number(v).toLocaleString('en-CA');

/** { 1100, 1500 } -> "1,100–1,500 sqft", { 1400, 1400 } -> "1,400 sqft", { 2000, null } -> "2,000+ sqft" */
export function formatSqft(min, max) {
	if (min === null || min === undefined) return null;
	if (max === null || max === undefined) return `${n(min)}+ sqft`;
	if (max === min) return `${n(min)} sqft`;
	return `${n(min)}–${n(max)} sqft`;
}