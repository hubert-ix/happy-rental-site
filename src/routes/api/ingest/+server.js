import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runIngest } from '$lib/server/ingest.js';

export const config = { maxDuration: 60 };

/** Called by Vercel Cron or Supabase pg_cron with "Authorization: Bearer $CRON_SECRET". */
export async function GET({ request, url }) {
	if (!env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) {
		error(401, 'Unauthorized');
	}
	const summary = await runIngest(env, { dashboardUrl: url.origin });
	return json(summary);
}
