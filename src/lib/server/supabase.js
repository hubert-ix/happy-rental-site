import { createClient } from '@supabase/supabase-js';

let client;

/**
 * Server-only client using the Supabase secret key (sb_secret_...), which bypasses RLS.
 * Never import this from a +page.svelte or anything that ships to the browser.
 */
export function db(env = process.env) {
	if (!client) {
		const key = env.SUPABASE_SECRET_KEY;
		if (!key?.startsWith('sb_secret_')) {
			throw new Error('SUPABASE_SECRET_KEY must be set to a secret key (sb_secret_...)');
		}
		client = createClient(env.SUPABASE_URL, key, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
	}
	return client;
}