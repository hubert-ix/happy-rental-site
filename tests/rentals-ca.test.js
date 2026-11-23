import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	htmlToText,
	compactLinks,
	resolveLinkRef,
	countListingBlocks,
	parseBedrooms,
	normalizeListing,
	extractListings
} from '../src/lib/server/extract.js';

afterEach(() => vi.unstubAllGlobals());

// Same structure as a real rentals.ca alert: each card links its photo, price, beds and address
// separately, every link wrapped in a unique ~600-character click-tracking URL.
const track = (n) => `https://url0000.rentals.ca/ls/click?upn=u001.${'x'.repeat(560)}${n}_${'y'.repeat(40)}${n}`;
let n = 0;
const card = (price, beds, address) => `
  <table><tr><td>
    <a href="${track(++n)}"><img src="https://img.example/${n}.jpg" alt=""></a>
  </td></tr>
  <tr><td><a href="${track(++n)}" style="color:#000"><b>${price}</b></a></td></tr>
  <tr><td><a href="${track(++n)}">${beds}</a></td></tr>
  <tr><td><a href="${track(++n)}">${address}</a></td></tr></table>`;
const html = `<html><body><table>
  <tr><td><a href="${track(++n)}">Rentals.ca</a></td></tr>
  <tr><td>Here are 3 new listings matching your previous searches on Rentals.ca</td></tr>
  <tr><td>All Houses, $0 to $3500, 3 Bedroom</td></tr>
  <tr><td>${card('$2699', '3.5 BED &bull; 2 BATH', '2 Torbolton Drive, Toronto')}</td></tr>
  <tr><td>${card('$2600 - $3300', '0-3 BED &bull; 1-2 BATH', '561 Towns at Sherbourne Place, Toronto')}</td></tr>
  <tr><td>${card('$2795', '3 BED &bull; 2 BATH', '239 Apache Trail, North York')}</td></tr>
  <tr><td><a href="${track(++n)}">Unsubscribe</a> | <a href="${track(++n)}">Terms</a></td></tr>
</table></body></html>`;

describe('rentals.ca alert emails', () => {
	it('shrinks tracking links to short references, keeping each card readable', () => {
		const raw = htmlToText(html);
		const { text, links } = compactLinks(raw);
		expect(text.length).toBeLessThan(raw.length / 5);
		expect(text).toContain('$2699 [L3]\n3.5 BED • 2 BATH [L4]\n2 Torbolton Drive, Toronto [L5]');
		expect(links.get('L3')).toBe(track(3));
		expect(countListingBlocks(text)).toBe(3); // the "$0 to $3500" search summary has no link
	});

	it('resolves references back to URLs and leaves real URLs alone', () => {
		const links = new Map([['L4', 'https://a.example/4']]);
		expect(resolveLinkRef('L4', links)).toBe('https://a.example/4');
		expect(resolveLinkRef('[l4]', links)).toBe('https://a.example/4');
		expect(resolveLinkRef('L99', links)).toBe(null);
		expect(resolveLinkRef('https://www.realtor.ca/real-estate/1/x', links)).toBe('https://www.realtor.ca/real-estate/1/x');
	});

	it('handles ranges: lowest price, highest bedroom count', () => {
		expect(normalizeListing({ price: '$2,600 - $3,300' }, 'x').price).toBe(2600);
		expect(normalizeListing({ price: 3200 }, 'x').price).toBe(3200);
		expect(parseBedrooms('0-3')).toBe(3);
		expect(parseBedrooms('2 - 4')).toBe(4);
		expect(parseBedrooms('3+1')).toBe(3);
		expect(parseBedrooms('3.5')).toBe(3.5);
	});

	it('end to end: Claude sees the short text and its references become real links', async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({
				stop_reason: 'tool_use',
				content: [
					{ type: 'tool_use', id: 'a', name: 'record_listing', input: { url: 'L3', address: '2 Torbolton Drive', price: 2699, bedrooms_raw: '3.5' } },
					{ type: 'tool_use', id: 'b', name: 'record_listing', input: { url: 'L7', address: '561 Towns at Sherbourne Place', price: 2600, bedrooms_raw: '0-3' } },
					{ type: 'tool_use', id: 'c', name: 'record_listing', input: { url: 'L11', address: '239 Apache Trail', price: 2795, bedrooms_raw: '3' } }
				]
			})
		}));
		vi.stubGlobal('fetch', fetchMock);

		const { source, listings } = await extractListings({ ANTHROPIC_API_KEY: 'k' }, { from: 'Rentals.ca <no-reply@rentals.ca>', subject: 'New listings', html, text: '' });

		const sent = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
		expect(sent).toContain('expect about 3 record_listing calls');
		expect(sent).not.toContain('url0000.rentals.ca'); // no tracking noise reaches Claude
		expect(source).toBe('rentals.ca');
		expect(listings.map((l) => [l.address, l.price, l.bedrooms, l.url])).toEqual([
			['2 Torbolton Drive', 2699, 3.5, track(3)],
			['561 Towns at Sherbourne Place', 2600, 3, track(7)],
			['239 Apache Trail', 2795, 3, track(11)]
		]);
	});
});
