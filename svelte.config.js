import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// Toronto-adjacent region keeps Supabase round-trips short if your project is in ca-central-1
		adapter: adapter({ regions: ['yul1'] })
	}
};

export default config;
