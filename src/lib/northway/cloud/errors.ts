/**
 * Northway Plans: plain-English error messages for staff, and technical details for developers.
 *
 * Every database or network failure is classified as:
 *   offline  no connection (Wi-Fi dropped, in a cellar, roof space…)
 *   auth     the sign-in session has ended
 *   server   anything else
 * Only the error's name, code and message are logged (never plan, customer or address data).
 */
export type FailureKind = 'offline' | 'auth' | 'server';

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function failureKind(error: unknown): FailureKind {
  if (isOffline()) return 'offline';
  const e = error as { message?: unknown; code?: unknown; status?: unknown; name?: unknown } | null;
  const text = `${e?.name ?? ''} ${e?.message ?? ''}`;
  if (/Failed to fetch|NetworkError|Load failed|network|fetch failed|ERR_INTERNET|timed? ?out/i.test(text)) return 'offline';
  if (e?.code === 'PGRST301' || e?.code === 'PGRST302' || e?.status === 401 || /JWT|expired|not authenticated|invalid claim|refresh token/i.test(text)) return 'auth';
  return 'server';
}

/** Log enough to debug, nothing more. */
export function logFailure(context: string, error: unknown): void {
  const e = error as { name?: unknown; code?: unknown; message?: unknown } | null;
  console.warn(`[Northway Plans] ${context} failed`, { name: e?.name, code: e?.code, message: typeof e?.message === 'string' ? e.message.slice(0, 300) : undefined });
}

const SAVE_MESSAGES: Record<FailureKind, string> = {
  offline: 'You appear to be offline, so the plan could not be saved. Your changes remain on this device. Save again when you are back online.',
  auth: 'Your sign-in has ended, so the plan could not be saved. Your changes remain on this device. Sign in again and reopen this plan to restore them.',
  server: 'The project could not be saved. Your changes remain on this device. Please try again.',
};

export function saveFailureMessage(error: unknown): string {
  return SAVE_MESSAGES[failureKind(error)];
}

/** Library and other actions ("open this plan", "duplicate this plan", …). */
export function actionFailureMessage(action: string, error: unknown): string {
  switch (failureKind(error)) {
    case 'offline': return `Could not ${action}: Northway Plans could not be reached. Check the connection and try again.`;
    case 'auth': return `Could not ${action}: your sign-in has ended. Sign in again and try once more.`;
    default: return `Could not ${action}. Please try again. If it keeps happening, reload the page.`;
  }
}

export const IMPORT_FAILURE = 'This floor plan file could not be imported. Check that it is a supported OpenPlan3D or RoomPlan file.';
