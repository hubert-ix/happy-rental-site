// Dry run: shows what the extractor sees and returns for matching emails. Writes nothing.
// Usage:  node --env-file=.env scripts/debug-email.js "label:rental-alerts newer_than:1d" [maxEmails] [full]
//         add "full" to print the whole text sent to Claude instead of the first 800 characters

import { openMailbox } from '../src/lib/server/gmail.js';
import { extractListings, htmlToText, dedupeKey, compactLinks, countListingBlocks, chunkByListings } from '../src/lib/server/extract.js';

const query = process.argv[2] || 'label:rental-alerts newer_than:1d';
const max = Number(process.argv[3] || 5);
const full = process.argv[4] === 'full';

const mailbox = await openMailbox(process.env);
try {
	const ids = (await mailbox.listMessageIds(query)).slice(0, max);
	console.log(`${ids.length} email(s) match: ${query}\n`);

	for (const id of ids) {
		const email = await mailbox.getMessage(id);
		const raw = htmlToText(email.html) || email.text || '';
		const { text } = compactLinks(raw); // what Claude actually receives
		console.log('='.repeat(80));
		console.log(`id ${id} · ${email.receivedAt} · from ${email.from}`);
		console.log(`subject: ${email.subject || '(none)'}`);
		console.log(`html: ${email.html.length} chars · text: ${raw.length} chars, ${text.length} after shortening links (limit 60,000)`);
		console.log(`listings expected: ${countListingBlocks(text)} · Claude calls (chunks): ${chunkByListings(text).length}`);
		console.log(`--- start of text ---\n${full ? text : text.slice(0, 800)}\n--- end of excerpt ---`);

		const { source, listings } = await extractListings(process.env, email);
		const keys = listings.map(dedupeKey);
		const distinct = new Set(keys).size;
		console.log(`\nsource: ${source} · listings extracted: ${listings.length} · distinct keys: ${distinct}`);
		for (const [i, l] of listings.entries()) {
			console.log(
				`${String(i + 1).padStart(2)}. ${keys[i]}\n    ${l.address ?? '(no address)'}${l.unit ? ` [${l.unit}]` : ''} · ` +
					`$${l.price ?? '?'} · ${l.bedrooms_raw ?? '?'} bed · ${l.url ?? '(no url)'}`
			);
		}
		console.log();
	}
} finally {
	await mailbox.close();
}
