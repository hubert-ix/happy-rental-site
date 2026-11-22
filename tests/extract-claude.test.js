import { describe, it, expect, vi, afterEach } from 'vitest';
import { coerceListings, extractWithClaude } from '../src/lib/server/extract.js';

afterEach(() => vi.unstubAllGlobals());

const reply = (input, stop_reason = 'tool_use') => ({
	ok: true,
	json: async () => ({ stop_reason, content: [{ type: 'tool_use', name: 'record_listings', input }] })
});

describe('coerceListings', () => {
	it('accepts an array, a JSON string, an object or nothing', () => {
		const one = { address: '1 A St' };
		expect(coerceListings([one])).toEqual([one]);
		expect(coerceListings(JSON.stringify([one]))).toEqual([one]);
		expect(coerceListings(JSON.stringify({ listings: [one] }))).toEqual([one]);
		expect(coerceListings(one)).toEqual([one]);
		expect(coerceListings(undefined)).toEqual([]);
	});

	it('rejects a string that is not JSON with a clear message', () => {
		expect(() => coerceListings('[{"address": "1 A')).toThrow('not valid JSON');
	});
});

describe('extractWithClaude', () => {
	const env = { ANTHROPIC_API_KEY: 'k' };
	const email = { subject: 'rental-import', from: 'me', text: 'listings…' };

	it('handles listings sent back as a JSON string (the "raw.map is not a function" bug)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => reply({ listings: '[{"address":"139 McKee Avenue","price":3200}]' })));
		expect(await extractWithClaude(env, email)).toEqual([{ address: '139 McKee Avenue', price: 3200 }]);
	});

	it('explains when an email has too many listings for one reply', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => reply({ listings: [] }, 'max_tokens')));
		await expect(extractWithClaude(env, email)).rejects.toThrow('split it into smaller emails');
	});
});
