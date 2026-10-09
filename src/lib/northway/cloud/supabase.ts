/**
 * Northway Plans: the browser Supabase client.
 *
 * Only public values are used here: the project URL and the publishable (anon)
 * key. Both are designed to be visible in the browser; Row Level Security is what
 * protects the data. A service-role or secret key must never be configured for
 * this app (see SUPABASE_SETUP.md).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

let client: SupabaseClient | null = null;

export function supabaseConfig(): { url: string; key: string } | null {
  const url = env.PUBLIC_SUPABASE_URL?.trim(), key = (env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.PUBLIC_SUPABASE_ANON_KEY)?.trim();
  return url && key ? { url, key } : null;
}

/** The shared browser client, or null when Supabase is not configured (the app then fails closed). */
export function getSupabase(): SupabaseClient | null {
  if (typeof window === 'undefined') return null;
  if (client) return client;
  const config = supabaseConfig();
  if (!config) return null;
  client = createClient(config.url, config.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'northway-plans-auth' },
  });
  return client;
}

export function requireSupabase(): SupabaseClient {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Northway Plans is not connected to Supabase. Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  return supabase;
}
