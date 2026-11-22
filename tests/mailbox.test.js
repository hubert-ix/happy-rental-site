import { describe, it, expect, vi } from 'vitest';

const calls = [];
const raw = (subject) =>
	Buffer.from(`From: alerts@rentals.ca\r\nSubject: ${subject}\r\nContent-Type: text/html\r\n\r\n<p>${subject}</p>\r\n`);

vi.mock('imapflow', () => ({
	ImapFlow: class {
		constructor(opts) {
			calls.push(['new', opts.auth]);
		}
		async connect() {}
		async list() {
			return [{ path: 'INBOX' }, { path: '[Gmail]/Tous les messages', specialUse: '\\All' }];
		}
		async getMailboxLock(path, opts) {
			calls.push(['lock', path, opts]);
			return { release: () => calls.push(['release']) };
		}
		async search(query, opts) {
			calls.push(['search', query, opts]);
			return [11, 42, 7];
		}
		async fetchAll(uids) {
			return uids.map((uid) => ({ uid, emailId: `gm${uid}` }));
		}
		async fetchOne(uid) {
			return { source: raw(`listing ${uid}`), internalDate: new Date('2026-11-21T17:00:00Z') };
		}
		async logout() {
			calls.push(['logout']);
		}
	}
}));

const { openMailbox } = await import('../src/lib/server/gmail.js');

describe('openMailbox (app password IMAP)', () => {
	it('searches All Mail with Gmail syntax, newest first, and reads messages', async () => {
		const box = await openMailbox({ GMAIL_USER: 'me@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop' });

		expect(calls[0]).toEqual(['new', { user: 'me@gmail.com', pass: 'abcdefghijklmnop' }]);
		expect(calls[1]).toEqual(['lock', '[Gmail]/Tous les messages', { readOnly: true }]); // localized name found by flag

		const ids = await box.listMessageIds('label:rental-alerts newer_than:7d');
		expect(calls.find((c) => c[0] === 'search')[1]).toEqual({ gmraw: 'label:rental-alerts newer_than:7d' });
		expect(ids).toEqual(['gm42', 'gm11', 'gm7']);

		const email = await box.getMessage('gm42');
		expect(email).toMatchObject({ id: 'gm42', subject: 'listing 42', from: 'alerts@rentals.ca' });
		expect(email.html).toContain('<p>listing 42</p>');
		expect(email.receivedAt).toBe('2026-11-21T17:00:00.000Z');

		await box.close();
		expect(calls.slice(-2)).toEqual([['release'], ['logout']]);
	});

	it('refuses to run without credentials', async () => {
		await expect(openMailbox({})).rejects.toThrow('GMAIL_USER and GMAIL_APP_PASSWORD');
	});
});
