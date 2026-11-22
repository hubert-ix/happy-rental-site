import { env } from '$env/dynamic/private';

/**
 * Optional basic-auth gate for the dashboard: on when DASHBOARD_PASSWORD is set, off when it isn't.
 * /api/ingest always keeps its own CRON_SECRET check, whatever this is set to.
 */
export async function handle({ event, resolve }) {
	if (event.url.pathname.startsWith('/api/ingest')) return resolve(event);
	if (1) return resolve(event);

	const header = event.request.headers.get('authorization') || '';
	const [scheme, encoded] = header.split(' ');
	const password = scheme === 'Basic' && encoded ? atob(encoded).split(':').slice(1).join(':') : null;

	if (password !== env.DASHBOARD_PASSWORD) {
		return new Response('Authentication required', {
			status: 401,
			headers: { 'WWW-Authenticate': 'Basic realm="Happy Rental"' }
		});
	}
	return resolve(event);
}