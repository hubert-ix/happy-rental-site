import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/supabase.js';
import { AREA_GEOJSON, CRITERIA } from '$lib/server/config.js';

const STATUSES = ['new', 'shortlisted', 'contacted', 'viewing', 'rejected', 'gone'];
const VIEWS = ['matches', 'all', ...STATUSES];

export async function load({ url }) {
	const view = VIEWS.includes(url.searchParams.get('view')) ? url.searchParams.get('view') : 'matches';
	const supabase = db(env);

	let q = supabase.from('listings').select('*').order('score', { ascending: false }).order('first_seen', { ascending: false }).limit(300);
	if (view === 'matches') q = q.eq('passes_filters', true).not('status', 'in', '(rejected,gone)');
	else if (view !== 'all') q = q.eq('status', view);

	const [{ data: listings, error }, { data: lastEmail }, { count: matchCount }] = await Promise.all([
		q,
		supabase.from('alert_emails').select('processed_at').order('processed_at', { ascending: false }).limit(1).maybeSingle(),
		supabase.from('listings').select('id', { count: 'exact', head: true }).eq('passes_filters', true).not('status', 'in', '(rejected,gone)')
	]);
	if (error) throw error;

	return {
		view,
		views: VIEWS,
		statuses: STATUSES,
		listings: listings || [],
		matchCount: matchCount ?? 0,
		lastRun: lastEmail?.processed_at ?? null,
		area: AREA_GEOJSON,
		criteria: CRITERIA
	};
}

export const actions = {
	status: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const status = String(form.get('status'));
		if (!id || !STATUSES.includes(status)) return fail(400, { message: 'Bad status' });
		const { error } = await db(env).from('listings').update({ status }).eq('id', id);
		if (error) return fail(500, { message: error.message });
		return { ok: true };
	},
	note: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const notes = String(form.get('notes') || '').slice(0, 2000);
		const { error } = await db(env).from('listings').update({ notes }).eq('id', id);
		if (error) return fail(500, { message: error.message });
		return { ok: true };
	}
};
