import { describe, it, expect } from 'vitest';
import { noteToTag, scoreColour } from '../src/lib/tags.js';

describe('display tags', () => {
	it('turns scorer notes into labelled tags', () => {
		expect(noteToTag('✓ backyard')).toEqual({ kind: 'good', label: 'backyard', isPlace: false });
		expect(noteToTag('~ 1 parking')).toEqual({ kind: 'meh', label: '1 parking', isPlace: false });
		expect(noteToTag('✗ $4,800 over budget')).toEqual({ kind: 'bad', label: '$4,800 over budget', isPlace: false });
		expect(noteToTag('? parking')).toEqual({ kind: 'unknown', label: 'parking unknown', isPlace: false });
		expect(noteToTag('? garage/storage').label).toBe('garage / storage unknown');
		expect(noteToTag('? location (not geocoded)')).toEqual({ kind: 'unknown', label: 'location unknown', isPlace: true });
		expect(noteToTag('✗ outside area').isPlace).toBe(true);
	});

		it('colours scores out of 10, green to red', () => {
		expect(scoreColour(10)).toBe('#1f9e5a');
		expect(scoreColour(0)).toBe('#dc4b4b');
		expect(scoreColour(null)).toBe('#dedede');
		expect(scoreTextColour(10)).toBe('#ffffff');
		expect(scoreTextColour(5)).toBe(null);
		expect(scoreTextColour(null)).toBe(null);
	});
});
