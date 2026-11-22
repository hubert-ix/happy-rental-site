import { env } from '$env/dynamic/private';

/** Basic-auth gate for the dashboard. /api/ingest has its own bearer-token check. */
export async function handle({ event, resolve }) {
	if (event.url.pathname.startsWith('/api/ingest')) return resolve(event);

	const header = event.request.headers.get('authorization') || '';
	const [scheme, encoded] = header.split(' ');
	const password = scheme === 'Basic' && encoded ? atob(encoded).split(':').slice(1).join(':') : null;

	if (!env.DASHBOARD_PASSWORD || password !== env.DASHBOARD_PASSWORD) {
		return new Response('Authentication required', {
			status: 401,
			headers: { 'WWW-Authenticate': 'Basic realm="Rental Radar"' }
		});
	}
	return resolve(event);
}
