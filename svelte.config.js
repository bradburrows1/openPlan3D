import nodeAdapter from '@sveltejs/adapter-node';
import vercelAdapter from '@sveltejs/adapter-vercel';

// Vercel sets VERCEL=1 during its builds. Everywhere else (local `node build`,
// Playwright, Firebase App Hosting) keeps the upstream Node adapter.
const adapter = process.env.VERCEL ? vercelAdapter() : nodeAdapter();

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter
	}
};

export default config;
