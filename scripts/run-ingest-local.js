// Run one ingest pass from your machine (handy for testing parsers before deploying).
// Usage:  node --env-file=.env scripts/run-ingest-local.js

import { runIngest } from '../src/lib/server/ingest.js';

const summary = await runIngest(process.env, { dashboardUrl: 'http://localhost:5173' });
console.log(JSON.stringify(summary, null, 2));
