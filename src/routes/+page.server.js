import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/supabase.js';
import { AREA_GEOJSON, CRITERIA } from '$lib/server/config.js';
import { applyManualEdit } from '$lib/server/ingest.js';

const STATUSES = ['new', 'shortlisted', 'contacted', 'viewing', 'rejected', 'gone'];
const VIEWS = ['matches', 'all', ...STATUSES];

export async function load({ url }) {
	const view = VIEWS.includes(url.searchParams.get('view')) ? url.searchParams.get('view') : 'matches';
	const supabase = db(env);

	let q = supabase.from('listings').select('*').order('effective_score', { ascending: false }).order('first_seen', { ascending: false }).limit(300);
	if (view === 'matches') q = q.eq('passes_filters', true).not('status', 'in', '(rejected,gone,deleted)');
	else if (view === 'all') q = q.neq('status', 'deleted');
	else q = q.eq('status', view);

	const [{ data: listings, error }, { data: lastEmail }, { count: matchCount }] = await Promise.all([
		q,
		supabase.from('alert_emails').select('processed_at').order('processed_at', { ascending: false }).limit(1).maybeSingle(),
		supabase.from('listings').select('id', { count: 'exact', head: true }).eq('passes_filters', true).not('status', 'in', '(rejected,gone,deleted)')
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
	score: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const raw = String(form.get('score') ?? '').trim();
		// Empty (or the reset button) clears the override and goes back to the computed score
		const score_override = form.get('reset') || raw === '' ? null : Number(raw);
		if (!id || (score_override !== null && (!Number.isInteger(score_override) || score_override < 0 || score_override > 999))) {
			return fail(400, { message: 'Score must be a whole number from 0 to 999' });
		}
		const { error } = await db(env).from('listings').update({ score_override }).eq('id', id);
		if (error) return fail(500, { message: error.message });
		return { ok: true };
	},
	edit: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const address = String(form.get('address') ?? '').trim();
		const rawPrice = String(form.get('price') ?? '').replace(/[$,\s]/g, '');
		const price = rawPrice === '' ? null : Number(rawPrice);
		if (!id) return fail(400, { message: 'Missing listing id' });
		if (!address) return fail(400, { message: 'Title cannot be empty' });
		if (price !== null && (!Number.isInteger(price) || price < 0 || price > 100_000)) {
			return fail(400, { message: 'Price must be a whole number of dollars' });
		}
		try {
			await applyManualEdit(env, db(env), id, { address, price });
		} catch (err) {
			return fail(500, { message: err.message });
		}
		return { ok: true };
	},
	delete: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { message: 'Missing listing id' });
		// Soft delete: the row stays as a marker so the same listing in a later email stays hidden
		const { error } = await db(env).from('listings').update({ status: 'deleted' }).eq('id', id);
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
