/**
 * Northway Plans: staff sign-in state.
 *
 * Signed in AND listed in northway_plan_staff = staff. The database enforces the
 * same rule with Row Level Security; this store only decides what to show.
 */
import { writable, get } from 'svelte/store';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from './supabase';

export type AuthStatus = 'loading' | 'unconfigured' | 'signed-out' | 'not-staff' | 'signed-in' | 'error';
export interface AuthState { status: AuthStatus; email?: string; message?: string; /** Signed out without asking (session expired or ended elsewhere). */ expired?: boolean }

export const authState = writable<AuthState>({ status: 'loading' });

let started: Promise<void> | null = null;
let signingOut = false;
const endingHooks = new Set<() => void>();

/** Run just before an unexpected sign-out takes the editor away, e.g. to keep unsaved edits on the device. */
export function onSessionEnding(hook: () => void): () => void {
  endingHooks.add(hook);
  return () => endingHooks.delete(hook);
}

async function evaluate(session: Session | null) {
  const supabase = getSupabase();
  if (!supabase) { authState.set({ status: 'unconfigured' }); return; }
  if (!session) { authState.set({ status: 'signed-out' }); return; }
  const { data, error } = await supabase.from('northway_plan_staff').select('user_id').eq('user_id', session.user.id).maybeSingle();
  if (error) authState.set({ status: 'error', email: session.user.email, message: 'Could not check your access. Check your connection and reload.' });
  else authState.set({ status: data ? 'signed-in' : 'not-staff', email: session.user.email });
}

/** Restore the saved session once per page load and follow later sign-ins and sign-outs. */
export function initAuth(): Promise<void> {
  return started ??= (async () => {
    const supabase = getSupabase();
    if (!supabase) { authState.set({ status: 'unconfigured' }); return; }
    supabase.auth.onAuthStateChange((event, session) => {
      // Supabase advises not awaiting other calls inside this callback.
      if (event === 'SIGNED_OUT') {
        const expired = !signingOut && get(authState).status === 'signed-in';
        if (expired) for (const hook of endingHooks) { try { hook(); } catch { /* keep signing out */ } }
        authState.set({ status: 'signed-out', expired });
      }
      else if (event === 'SIGNED_IN' && get(authState).status !== 'signed-in') setTimeout(() => void evaluate(session), 0);
    });
    const { data } = await supabase.auth.getSession();
    await evaluate(data.session);
  })();
}

/** Returns an error message, or null when signed in as staff. */
export async function signIn(email: string, password: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return 'Northway Plans is not connected to Supabase yet.';
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  // One message for unknown email and wrong password, so accounts cannot be probed.
  if (error || !data.session) return error?.status === 400 || error?.status === 401 || !data.session ? 'The email or password is incorrect.' : 'Could not sign in. Check your connection and try again.';
  await evaluate(data.session);
  if (get(authState).status === 'not-staff') return 'This account is not authorised for Northway Plans. Ask Brad to add you.';
  return get(authState).status === 'signed-in' ? null : get(authState).message ?? 'Could not sign in.';
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  signingOut = true;
  try { await supabase?.auth.signOut({ scope: 'local' }); }
  finally { signingOut = false; }
  authState.set({ status: 'signed-out' });
}
