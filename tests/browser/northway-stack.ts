// Northway: fixed settings for the local Supabase stack used by the browser suite.
// LOCAL TEST VALUES ONLY: this secret signs tokens for a throwaway database.
import { localAnonKey } from '../../tooling/northway-supabase/local-stack.mjs';

export const TEST_SUPABASE_PORT = 54421;
export const TEST_SUPABASE_URL = `http://127.0.0.1:${TEST_SUPABASE_PORT}`;
export const TEST_JWT_SECRET = 'northway-playwright-local-only-secret-0123456789';
export const TEST_PUBLISHABLE_KEY: string = localAnonKey(TEST_JWT_SECRET);
/** Signed-in staff session plus the full object library, for upstream specs. */
export const SIGNED_IN_STATE = '.northway-local/playwright/signed-in-staff.json';
