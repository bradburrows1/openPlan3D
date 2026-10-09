/**
 * Northway: start the local Supabase stack (real Supabase Auth, PostgREST and
 * PostgreSQL with our migration) and sign in a staff account for the upstream
 * editor specs, which now sit behind sign-in. Northway specs opt out and sign in
 * through the login page themselves.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { startLocalStack, LOCAL_STAFF } from '../../tooling/northway-supabase/local-stack.mjs';
import { SIGNED_IN_STATE, TEST_JWT_SECRET, TEST_PUBLISHABLE_KEY, TEST_SUPABASE_PORT, TEST_SUPABASE_URL } from './northway-stack';

export default async function globalSetup() {
  const stack = await startLocalStack({ port: TEST_SUPABASE_PORT, jwtSecret: TEST_JWT_SECRET });
  const client = createClient(TEST_SUPABASE_URL, TEST_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword(LOCAL_STAFF[1]);
  if (error || !data.session) throw error ?? new Error('Could not sign in the test staff account.');
  mkdirSync(dirname(SIGNED_IN_STATE), { recursive: true });
  writeFileSync(SIGNED_IN_STATE, JSON.stringify({
    cookies: [],
    origins: [{ origin: 'http://127.0.0.1:4188', localStorage: [
      // Upstream specs exercise the full furniture catalogue; Northway specs choose their own.
      { name: 'o3d_settings', value: JSON.stringify({ objectLibrary: 'full' }) },
      { name: 'northway-plans-auth', value: JSON.stringify(data.session) },
    ] }],
  }));
  return async () => { await stack.stop(); };
}
