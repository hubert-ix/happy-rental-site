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
		expect(() => coerceListings('[{"address": "1 A')).toThrow('not valid JSON: [{"address": "1 A');
		expect(coerceListings('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
	});
});

describe('extractWithClaude', () => {
	const env = { ANTHROPIC_API_KEY: 'k' };
	const email = { subject: 'rental-import', from: 'me', text: 'listings…' };

	it('handles listings sent back as a JSON string (the "raw.map is not a function" bug)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => reply({ listings: '[{"address":"139 McKee Avenue","price":3200}]' })));
		expect(await extractWithClaude(env, email)).toEqual([{ address: '139 McKee Avenue', price: 3200 }]);
	});

	it('asks for strict, schema-checked output', async () => {
		const fetchMock = vi.fn(async () => reply({ listings: [] }));
		vi.stubGlobal('fetch', fetchMock);
		await extractWithClaude(env, email);
		const tool = JSON.parse(fetchMock.mock.calls[0][1].body).tools[0];
		expect(tool.strict).toBe(true);
		expect(tool.input_schema.additionalProperties).toBe(false);
		expect(tool.input_schema.properties.listings.items.additionalProperties).toBe(false);
	});

	it('falls back to non-strict if the API rejects strict mode', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'strict tool use is not supported for this model' })
			.mockResolvedValueOnce(reply({ listings: [{ address: '1 A St' }] }));
		vi.stubGlobal('fetch', fetchMock);
		expect(await extractWithClaude(env, email)).toEqual([{ address: '1 A St' }]);
		expect(JSON.parse(fetchMock.mock.calls[1][1].body).tools[0].strict).toBeUndefined();
	});

	it('explains when an email has too many listings for one reply', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => reply({ listings: [] }, 'max_tokens')));
		await expect(extractWithClaude(env, email)).rejects.toThrow('split it into smaller emails');
	});
});
