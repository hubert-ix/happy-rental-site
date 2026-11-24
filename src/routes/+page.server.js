import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/supabase.js';
import { AREA_GEOJSON, CRITERIA } from '$lib/server/config.js';
import { applyManualEdit, addManualListing } from '$lib/server/ingest.js';

const STATUSES = ['new', 'reviewed', 'shortlisted', 'contacted', 'viewing', 'rejected', 'gone'];
const VIEWS = ['matches', 'all', ...STATUSES];

export async function load({ url }) {
	const view = VIEWS.includes(url.searchParams.get('view')) ? url.searchParams.get('view') : 'matches';
	const supabase = db(env);

	let q = supabase.from('listings').select('*').order('score_override', { ascending: false, nullsFirst: false }).order('first_seen', { ascending: false }).limit(300);
	if (view === 'matches') q = q.eq('passes_filters', true).not('status', 'in', '(rejected,gone,deleted)');
	else if (view === 'all') q = q.neq('status', 'deleted');
	else q = q.eq('status', view);

	const [{ data: listings, error }, { data: lastEmail }, { count: matchCount }] = await Promise.all([
		q,
		supabase.from('alert_emails').select('processed_at').order('processed_at', { ascending: false }).limit(1).maybeSingle(),
		supabase.from('listings').select('id', { count: 'exact', head: true }).eq('passes_filters', true).not('status', 'in', '(rejected,gone,deleted)')
	]);
	if (error) throw error;

	// "New" listings always come first; within each group, highest score first (unscored last), then newest.
	const sorted = (listings || []).sort(
		(a, b) =>
			(b.status === 'new') - (a.status === 'new') ||
			(b.score_override ?? -1) - (a.score_override ?? -1) ||
			String(b.first_seen ?? '').localeCompare(String(a.first_seen ?? ''))
	);

	return {
		view,
		views: VIEWS,
		statuses: STATUSES,
		listings: sorted,
		matchCount: matchCount ?? 0,
		lastRun: lastEmail?.processed_at ?? null,
		area: AREA_GEOJSON,
		criteria: CRITERIA
	};
}

/**
 * Read the add/edit listing form. Empty text and number fields become null. Toggles send "yes",
 * "no" or nothing: when adding, nothing means not mentioned (null); when editing, it means
 * "leave as it is" (undefined, so applyManualEdit skips it).
 */
function readListingForm(form, { editing }) {
	const text = (name) => String(form.get(name) ?? '').trim() || null;
	const number = (name) => {
		const raw = text(name)?.replace(/[$,\s]/g, '');
		return raw ? Number(raw) : null;
	};
	const toggle = (name) => ({ yes: true, no: false })[text(name)] ?? (editing ? undefined : null);

	const fields = {
		address: text('address'),
		unit: text('unit'),
		price: number('price'),
		bedrooms_raw: text('bedrooms'),
		bathrooms: number('bathrooms'),
		parking_spaces: number('parking_spaces'),
		has_backyard: toggle('has_backyard'),
		has_garage: toggle('has_garage'),
		has_storage: toggle('has_storage'),
		url: text('url'),
		summary: text('summary')
	};

	let problem = null;
	if (!fields.address) problem = 'Enter an address or a title';
	for (const [name, value] of Object.entries({ price: fields.price, bathrooms: fields.bathrooms, parking: fields.parking_spaces })) {
		if (value !== null && (!Number.isFinite(value) || value < 0)) problem = `Check the ${name}`;
	}
	if (fields.url && !/^https?:\/\//i.test(fields.url)) problem = 'The link must start with http:// or https://';
	if (fields.price !== null && Number.isFinite(fields.price) && !Number.isInteger(fields.price)) problem = 'Price must be a whole number of dollars';

	return { fields, notes: text('notes'), problem };
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
		// Empty (or the Clear button) removes the score
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
		if (!id) return fail(400, { message: 'Missing listing id' });
		const { fields, notes, problem } = readListingForm(form, { editing: true });
		if (problem) return fail(400, { message: problem });
		try {
			const supabase = db(env);
			const row = await applyManualEdit(env, supabase, id, fields);
			if ((row.notes ?? null) !== notes) await supabase.from('listings').update({ notes }).eq('id', id);
		} catch (err) {
			return fail(500, { message: err.message });
		}
		return { ok: true };
	},

	add: async ({ request }) => {
		const { fields, notes, problem } = readListingForm(await request.formData(), { editing: false });
		if (problem) return fail(400, { message: problem });
		try {
			const { id, isNew } = await addManualListing(env, db(env), fields, notes);
			return { added: true, id, isNew };
		} catch (err) {
			return fail(500, { message: err.message });
		}
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
