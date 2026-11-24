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

/** Score badge colour for a score you set: 50+ green, 20+ yellow, below that pink. */
export function scoreTier(score, high = 50) {
	if (score >= high) return 'high';
	if (score >= 20) return 'mid';
	return 'low';
}
