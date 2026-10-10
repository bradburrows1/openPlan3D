/**
 * Northway Plans: the open cloud project in the editor and its save state.
 *
 * Saving is explicit (Save button or Ctrl+S). Changes are detected by comparing
 * the editor's project with the last saved document, so undoing back to the
 * saved state reads as "Saved" again. While there are unsaved changes a recovery
 * copy is kept in this browser (recovery.ts).
 */
import { writable, get } from 'svelte/store';
import type { Project } from '$lib/models/types';
import { currentProject, loadProject } from '$lib/stores/project';
import { readProject } from '$lib/utils/projectValidation';
import { requireSupabase } from './supabase';
import { createProject, saveProject, ProjectConflictError, ProjectMissingError, type ProjectRow } from './projectsApi';
import { documentToProject } from './projectDocument';
import { deleteDraft, readDraft, writeDraft, type RecoveryDraft } from './recovery';
import { isOffline, logFailure, saveFailureMessage } from './errors';
import { onSessionEnding } from './auth';

export interface CloudSession {
  id: string;
  revision: number;
  /** Revision found on the server when a save was refused as a conflict. */
  serverRevision?: number;
}

export type CloudSaveState = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict' | 'missing';

export const cloudSession = writable<CloudSession | null>(null);
export const cloudSaveState = writable<CloudSaveState>('saved');
export const cloudSaveError = writable<string | null>(null);
export const cloudLastSaved = writable<Date | null>(null);
/** A recovery copy from an earlier visit that differs from the saved plan. */
export const recoveryOffer = writable<(RecoveryDraft & { newerOnServer: boolean }) | null>(null);
/** Library details of the open plan (for export title blocks); renames in the library update them on next open. */
export const cloudDetails = writable<{ customer_name: string | null; property_address: string | null } | null>(null);
/** False while the browser reports no connection (cellars, roof spaces…). Saving is not attempted silently. */
export const networkOnline = writable(!isOffline());
if (typeof window !== 'undefined') {
  addEventListener('online', () => networkOnline.set(true));
  addEventListener('offline', () => networkOnline.set(false));
}

let savedJson = '';
let stopWatching: (() => void) | null = null;
let compareTimer: ReturnType<typeof setTimeout> | null = null;
let draftTimer: ReturnType<typeof setTimeout> | null = null;

/** Stable comparison form: plain JSON, ignoring the timestamp every edit refreshes. */
function canonical(project: Project): string {
  const plain = JSON.parse(JSON.stringify(project));
  delete plain.updatedAt;
  return JSON.stringify(plain);
}

export function hasUnsavedChanges(): boolean {
  return get(cloudSession) !== null && get(cloudSaveState) !== 'saved';
}

function refreshState() {
  const session = get(cloudSession), project = get(currentProject);
  if (!session || !project || project.id !== session.id) return;
  const state = get(cloudSaveState);
  if (state === 'saving') return;
  const dirty = canonical(project) !== savedJson;
  if (!dirty) {
    if (state !== 'conflict' && state !== 'missing') { cloudSaveState.set('saved'); cloudSaveError.set(null); }
    if (draftTimer) clearTimeout(draftTimer);
    void deleteDraft(session.id);
    return;
  }
  if (state === 'saved') cloudSaveState.set('unsaved');
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const current = get(currentProject), live = get(cloudSession);
    if (!current || !live || current.id !== live.id) return;
    void writeDraft({ projectId: live.id, baseRevision: live.revision, savedAt: new Date().toISOString(), json: JSON.stringify(current) });
  }, 1500);
}

/** Write the recovery copy now (not after the usual 1.5 s pause), if there is anything unsaved. */
export function flushRecoveryDraft(): void {
  const project = get(currentProject), live = get(cloudSession);
  if (!project || !live || project.id !== live.id) return;
  if (canonical(project) === savedJson) return;
  if (draftTimer) clearTimeout(draftTimer);
  void writeDraft({ projectId: live.id, baseRevision: live.revision, savedAt: new Date().toISOString(), json: JSON.stringify(project) });
}

// Closing Safari, switching apps on the iPad or locking it: keep the latest edits on this device.
function onHide() { if (document.visibilityState === 'hidden') flushRecoveryDraft(); }
// A session that ends while editing (expired, signed out elsewhere) unmounts the editor: keep edits first.
onSessionEnding(flushRecoveryDraft);

function watch() {
  stopWatching?.();
  const unsubscribe = currentProject.subscribe(() => {
    if (compareTimer) clearTimeout(compareTimer);
    compareTimer = setTimeout(refreshState, 250);
  });
  document.addEventListener('visibilitychange', onHide);
  addEventListener('pagehide', flushRecoveryDraft);
  stopWatching = () => { unsubscribe(); document.removeEventListener('visibilitychange', onHide); removeEventListener('pagehide', flushRecoveryDraft); };
}

/** Load a saved row into the editor and start tracking changes. */
export async function openCloudProject(row: ProjectRow): Promise<void> {
  const project = documentToProject(row);
  loadProject(project);
  savedJson = canonical(get(currentProject) ?? project);
  cloudSession.set({ id: row.id, revision: row.revision });
  cloudDetails.set({ customer_name: row.customer_name ?? null, property_address: row.property_address ?? null });
  cloudSaveState.set('saved');
  cloudSaveError.set(null);
  cloudLastSaved.set(new Date(row.updated_at));
  recoveryOffer.set(null);
  watch();
  const draft = await readDraft(row.id);
  if (draft && get(cloudSession)?.id === row.id) {
    let differs = false;
    try { differs = canonical(readProject(JSON.parse(draft.json))) !== canonical(readProject(JSON.parse(JSON.stringify(project)))); } catch {}
    if (differs) recoveryOffer.set({ ...draft, newerOnServer: draft.baseRevision !== row.revision });
    else void deleteDraft(row.id);
  }
}

/** Put this device's unsaved edits back into the editor (still unsaved until Save). */
export function restoreRecovery(): void {
  const offer = get(recoveryOffer), session = get(cloudSession);
  if (!offer || !session || offer.projectId !== session.id) return;
  const project = readProject(JSON.parse(offer.json));
  project.id = session.id;
  loadProject(project);
  recoveryOffer.set(null);
}

export async function discardRecovery(): Promise<void> {
  const offer = get(recoveryOffer);
  recoveryOffer.set(null);
  if (offer) await deleteDraft(offer.projectId);
}

/**
 * Save the editor's project to Northway Plans. With overwrite, replaces a version
 * saved elsewhere (only after the user chose to). Returns true when saved.
 */
export async function saveCloudProject({ overwrite = false } = {}): Promise<boolean> {
  const session = get(cloudSession), project = get(currentProject);
  if (!session || !project || project.id !== session.id || get(cloudSaveState) === 'saving') return false;
  const expected = overwrite && session.serverRevision !== undefined ? session.serverRevision : session.revision;
  cloudSaveState.set('saving');
  cloudSaveError.set(null);
  try {
    // A plain-JSON snapshot: later edits cannot leak into this save.
    const snapshot = JSON.parse(JSON.stringify(project)) as Project, snapshotJson = canonical(snapshot);
    const result = await saveProject(requireSupabase(), session.id, expected, snapshot, snapshot.name);
    if (get(cloudSession)?.id !== session.id) return true;
    savedJson = snapshotJson;
    cloudSession.set({ id: session.id, revision: result.revision });
    cloudLastSaved.set(new Date(result.updated_at));
    cloudSaveState.set('saved');
    refreshState(); // edits made while saving stay "Unsaved changes"
    return true;
  } catch (error) {
    if (get(cloudSession)?.id !== session.id) return false;
    if (error instanceof ProjectConflictError) {
      cloudSession.set({ ...session, serverRevision: error.serverRevision });
      cloudSaveState.set('conflict');
      cloudSaveError.set(error.message);
    } else if (error instanceof ProjectMissingError) {
      cloudSaveState.set('missing');
      cloudSaveError.set(error.message);
    } else {
      // Never claim success: say why in plain English, and keep the technical detail for developers.
      logFailure('save plan', (error as { cause?: unknown })?.cause ?? error);
      cloudSaveState.set('error');
      cloudSaveError.set(saveFailureMessage((error as { cause?: unknown })?.cause ?? error));
    }
    // Keep the edits safe on this device until a save succeeds.
    void writeDraft({ projectId: session.id, baseRevision: session.revision, savedAt: new Date().toISOString(), json: JSON.stringify(project) });
    return false;
  }
}

/** Keep the editor's version as a separate new plan (after a conflict or deletion). Returns its id. */
export async function saveCloudProjectAsNew(): Promise<string | null> {
  const session = get(cloudSession), project = get(currentProject);
  if (!session || !project) return null;
  try {
    const row = await createProject(requireSupabase(), { project_name: `${project.name || 'Untitled plan'} (Copy)` }, project);
    await deleteDraft(session.id);
    savedJson = canonical(get(currentProject)!); // the copy holds these edits; leaving is safe
    cloudSaveState.set('saved');
    return row.id;
  } catch (error) {
    cloudSaveError.set(error instanceof Error ? error.message : 'Could not save a copy.');
    return null;
  }
}

export function closeCloudProject(): void {
  stopWatching?.(); stopWatching = null;
  if (compareTimer) clearTimeout(compareTimer);
  if (draftTimer) clearTimeout(draftTimer);
  cloudSession.set(null);
  cloudSaveState.set('saved');
  cloudSaveError.set(null);
  recoveryOffer.set(null);
  cloudDetails.set(null);
}
