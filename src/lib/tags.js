// Turns the scorer's compact notes ("✓ backyard", "? parking", "✗ $4,800 over budget")
// into display tags: { kind: 'good' | 'bad' | 'meh' | 'unknown', label, isPlace }.

const KINDS = { '✓': 'good', '✗': 'bad', '~': 'meh', '?': 'unknown' };

export function noteToTag(note) {
	const kind = KINDS[note[0]] ?? 'unknown';
	let text = note.slice(1).trim();

	if (kind === 'unknown') {
		text = text.replace(/\s*\(not geocoded\)/, '').replace('garage/storage', 'garage / storage');
		text = `${text} unknown`;
	} else {
		text = text.replace('garage/storage', 'garage / storage');
	}

	return { kind, label: text, isPlace: /location|area/.test(text) };
}

export const MAX_SCORE = 10;

// Traffic light: green for a 10, through yellow, to red for a 0. Index = score.
const COLOURS = ['#dc4b4b', '#e86a48', '#f08c48', '#f5ac4a', '#f7c94f', '#f2e05a', '#cfdc5a', '#a8d15a', '#7cc35a', '#4cb25a', '#1f9e5a'];
const UNSCORED = '#dedede';

const scoreIndex = (score) => Math.round(Math.max(0, Math.min(score, MAX_SCORE)));

/** Badge and map-dot colour for a score out of 10: green for 10, red for 0, grey when unscored. */
export function scoreColour(score) {
	if (score === null || score === undefined) return UNSCORED;
	return COLOURS[scoreIndex(score)];
}

/** Text colour for the badge: white on the darker greens and reds, otherwise null (keeps the CSS colour). */
export function scoreTextColour(score) {
	if (score === null || score === undefined) return null;
	const [r, g, b] = COLOURS[scoreIndex(score)].match(/\w\w/g).map((h) => parseInt(h, 16));
	return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? null : '#ffffff';
}
