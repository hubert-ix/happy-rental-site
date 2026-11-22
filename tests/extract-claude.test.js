import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractWithClaude, chunkByListings } from '../src/lib/server/extract.js';

afterEach(() => vi.unstubAllGlobals());

const env = { ANTHROPIC_API_KEY: 'k' };
const listingLine = (n) =>
	`$3,${String(n).padStart(3, '0')}/Monthly ${n} TEST STREET, Toronto 3 Bedrooms [https://www.realtor.ca/real-estate/${3000 + n}/${n}-test-street-toronto]`;
const page = (count) => ['[https://www.realtor.ca/map#]', ...Array.from({ length: count }, (_, i) => listingLine(i + 1))].join('\n');

let callId = 0;
const record = (n) => ({ type: 'tool_use', id: `t${callId++}`, name: 'record_listing', input: { address: `${n} Test Street`, url: `https://www.realtor.ca/real-estate/${3000 + n}/${n}-test-street-toronto`, price: 3000 + n, bedrooms_raw: '3' } });
const reply = (content, stop_reason = 'tool_use') => ({ ok: true, status: 200, json: async () => ({ stop_reason, content }) });

describe('chunkByListings', () => {
	it('keeps short emails whole and splits long ones into ~20-listing chunks', () => {
		expect(chunkByListings(page(7))).toHaveLength(1);
		const chunks = chunkByListings(page(45));
		expect(chunks).toHaveLength(3);
		expect(chunks.join('\n')).toBe(page(45)); // nothing lost or reordered
	});
});

describe('extractWithClaude', () => {
	const email = (n) => ({ subject: '', from: 'me', text: page(n) });

	it('collects many parallel record_listing calls from one reply', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => reply([1, 2, 3, 4, 5, 6, 7].map(record))));
		const out = await extractWithClaude(env, email(7));
		expect(out.map((l) => l.address)).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => `${n} Test Street`));
	});

	it('keeps going when Claude records one listing per turn (the "only 1 of 40" bug)', async () => {
		let n = 0;
		const fetchMock = vi.fn(async (_url, init) => {
			n++;
			return n <= 7 ? reply([record(n)]) : reply([{ type: 'text', text: 'All done.' }], 'end_turn');
		});
		vi.stubGlobal('fetch', fetchMock);
		const out = await extractWithClaude(env, email(7));
		expect(out).toHaveLength(7);
		// later turns acknowledge the previous calls and allow stopping
		const second = JSON.parse(fetchMock.mock.calls[1][1].body);
		expect(second.tool_choice).toEqual({ type: 'auto' });
		expect(second.messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', content: 'recorded' });
	});

	it('tells Claude how many listings to expect and uses strict tools', async () => {
		const fetchMock = vi.fn(async () => reply([1, 2, 3].map(record)));
		vi.stubGlobal('fetch', fetchMock);
		await extractWithClaude(env, email(3));
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.messages[0].content).toContain('expect about 3 record_listing calls');
		expect(body.tool_choice).toEqual({ type: 'any' });
		expect(body.tools.every((t) => t.strict === true && t.input_schema.additionalProperties === false)).toBe(true);
	});

	it('drops repeats of a listing recorded in an earlier turn', async () => {
		const replies = [reply([record(1), record(2)]), reply([record(2), record(3)]), reply([], 'end_turn')];
		vi.stubGlobal('fetch', vi.fn(async () => replies.shift()));
		const out = await extractWithClaude(env, email(4));
		expect(out.map((l) => l.price)).toEqual([3001, 3002, 3003]);
	});

	it('returns nothing for a non-listing email', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => reply([{ type: 'tool_use', id: 'x', name: 'no_listings', input: {} }])));
		expect(await extractWithClaude(env, { subject: 'Welcome!', from: 'x', text: 'Thanks for signing up' })).toEqual([]);
	});

	it('falls back to non-strict tools if the API rejects strict mode', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce({ ok: false, status: 400, text: async () => 'strict tool use is not supported for this model' })
			.mockResolvedValueOnce(reply([record(1)], 'end_turn'));
		vi.stubGlobal('fetch', fetchMock);
		expect(await extractWithClaude(env, email(1))).toHaveLength(1);
		expect(JSON.parse(fetchMock.mock.calls[1][1].body).tools[0].strict).toBeUndefined();
	});
});
