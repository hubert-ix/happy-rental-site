// Gmail access with an app password: IMAP (imapflow) to read alerts, SMTP (nodemailer) to send digests.
// No Google Cloud project, OAuth consent screen or refresh tokens needed.

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

function credentials(env) {
	const user = env.GMAIL_USER;
	const pass = (env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''); // Google shows it as "abcd efgh ijkl mnop"
	if (!user || !pass) throw new Error('Set GMAIL_USER and GMAIL_APP_PASSWORD');
	return { user, pass };
}

/**
 * Open one IMAP session for a whole ingest run.
 * Searches "All Mail" with Gmail's own search syntax (X-GM-RAW), so GMAIL_QUERY works
 * exactly like the Gmail search box, including labels and archived messages.
 */
export async function openMailbox(env) {
	const client = new ImapFlow({
		host: 'imap.gmail.com',
		port: 993,
		secure: true,
		auth: credentials(env),
		logger: false
	});
	await client.connect();

	// "[Gmail]/All Mail" is localized ("Tous les messages", ...), so find it by its special-use flag
	const boxes = await client.list();
	const allMail = boxes.find((b) => b.specialUse === '\\All')?.path || '[Gmail]/All Mail';
	const lock = await client.getMailboxLock(allMail, { readOnly: true });

	const uidById = new Map(); // Gmail message id -> IMAP uid

	return {
		/** Gmail message ids (X-GM-MSGID) matching the query, newest first. */
		async listMessageIds(query, max = 100) {
			const uids = (await client.search({ gmraw: query }, { uid: true })) || [];
			const newest = uids.sort((a, b) => b - a).slice(0, max);
			if (!newest.length) return [];
			const ids = [];
			for (const msg of await client.fetchAll(newest, { uid: true, emailId: true }, { uid: true })) {
				uidById.set(msg.emailId, msg.uid);
				ids.push({ id: msg.emailId, uid: msg.uid });
			}
			return ids.sort((a, b) => b.uid - a.uid).map((m) => m.id);
		},

		async getMessage(id) {
			const uid = uidById.get(id);
			if (!uid) throw new Error(`Unknown message id ${id}; call listMessageIds first`);
			const msg = await client.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true });
			if (!msg) throw new Error(`Message ${id} not found`);
			return { id, ...(await parseRawEmail(msg.source, msg.internalDate)) };
		},

		async close() {
			lock.release();
			await client.logout().catch(() => {});
		}
	};
}

/** Raw RFC 822 source -> the fields extract.js needs. */
export async function parseRawEmail(source, internalDate) {
	const parsed = await simpleParser(source);
	return {
		receivedAt: new Date(internalDate || parsed.date || Date.now()).toISOString(),
		from: parsed.from?.text || '',
		subject: parsed.subject || '',
		html: typeof parsed.html === 'string' ? parsed.html : '',
		text: parsed.text || ''
	};
}

/** Send an HTML email from the alerts account to `to`. */
export async function sendEmail(env, { to, subject, html }) {
	const { user, pass } = credentials(env);
	const transport = nodemailer.createTransport({
		host: 'smtp.gmail.com',
		port: 465,
		secure: true,
		auth: { user, pass }
	});
	return transport.sendMail({ from: `Rental Radar <${user}>`, to, subject, html });
}
