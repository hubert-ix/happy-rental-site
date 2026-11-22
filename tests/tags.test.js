import { describe, it, expect } from 'vitest';
import { noteToTag, scoreTier } from '../src/lib/tags.js';

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

	it('tiers scores against the notify threshold', () => {
		expect(scoreTier(85)).toBe('high');
		expect(scoreTier(50)).toBe('high');
		expect(scoreTier(33)).toBe('mid');
		expect(scoreTier(9)).toBe('low');
	});
});
