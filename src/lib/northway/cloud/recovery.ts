/**
 * Northway Plans: a local recovery copy of unsaved edits, per project, in this
 * browser only. It is written while a plan has unsaved changes and deleted once
 * they are saved, so a crash, closed tab or failed network save does not lose
 * work. It never replaces the saved plan by itself: the editor offers to restore it.
 */
const DB = 'northway-plans-recovery', STORE = 'drafts', VERSION = 1;

export interface RecoveryDraft {
  projectId: string;
  /** Revision of the saved plan these edits started from. */
  baseRevision: number;
  savedAt: string;
  json: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'projectId' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode), request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(tx.error ?? request.error);
    });
  } finally { db.close(); }
}

/** Best effort: storage may be full or blocked; the explicit Save still works. */
export async function writeDraft(draft: RecoveryDraft): Promise<void> {
  try { await run('readwrite', store => store.put(draft)); } catch {}
}

export async function readDraft(projectId: string): Promise<RecoveryDraft | null> {
  try { return (await run<RecoveryDraft | undefined>('readonly', store => store.get(projectId))) ?? null; } catch { return null; }
}

export async function deleteDraft(projectId: string): Promise<void> {
  try { await run('readwrite', store => store.delete(projectId)); } catch {}
}
