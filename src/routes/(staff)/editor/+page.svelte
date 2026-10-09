<script lang="ts">
  import { t, locale } from '$lib/i18n';
  import { projectServiceMessage } from '$lib/i18n/projectServiceMessages';
  import { CaptureImportError } from '$lib/i18n/captureImportError';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { base } from '$app/paths';
  import { replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { currentProject, createDefaultProject, loadProject } from '$lib/stores/project';
  import { localStore, storageErrorMessage, downloadLibraryBackup } from '$lib/services/datastore';
  import { autoSave, markClean, saveState } from '$lib/stores/saveStatus';
  import { createProjectFromRoomPlan, isRoomPlanJson } from '$lib/utils/roomplanImport';
  import EditorWorkspace from '$lib/components/editor/EditorWorkspace.svelte';

  let ready = $state(false);

  // iOS capture handoff (?import=CODE → fetch RoomPlan JSON from Firebase Storage inbox)
  let importingCapture = $state(false);
  let importError = $state<string | CaptureImportError | null>(null);
  let loadError = $state<string | null>(null);

  async function backupLibrary() {
    try { await downloadLibraryBackup(); }
    catch (error) { loadError = storageErrorMessage(error); }
  }

  /** Fetch a RoomPlan capture uploaded by the iOS app and open it as a new project. Returns true on success. */
  async function importCaptureFromCode(code: string): Promise<boolean> {
    importingCapture = true;
    try {
      const url = `https://firebasestorage.googleapis.com/v0/b/openplan3d.firebasestorage.app/o/inbox%2F${code}.json?alt=media`;
      let res: Response;
      try {
        res = await fetch(url);
      } catch {
        throw new CaptureImportError('captureImport.network');
      }
      if (res.status === 404) {
        throw new CaptureImportError('captureImport.missing', { code });
      }
      if (!res.ok) {
        throw new CaptureImportError('captureImport.http', { status: res.status });
      }
      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new CaptureImportError('captureImport.json');
      }
      if (!isRoomPlanJson(data)) {
        throw new CaptureImportError('captureImport.format');
      }
      const project = createProjectFromRoomPlan(data, `Room Capture ${code}`);
      loadProject(project);
      // A storage failure must not discard a successfully downloaded capture.
      await autoSave();
      // Remove ?import=CODE so a refresh doesn't re-import
      replaceState(`${base}/editor?id=${project.id}`, page.state);
      return true;
    } catch (e: any) {
      importError = e instanceof CaptureImportError ? e : e?.message ?? new CaptureImportError('captureImport.fallback');
      return false;
    } finally {
      importingCapture = false;
    }
  }


  async function initializeEditor() {
    loadError = null;
    try {
      const url = new URL(window.location.href);

      // iOS capture handoff: ?import=CODE
      const rawCode = url.searchParams.get('import');
      if (rawCode) {
        const code = rawCode.toUpperCase();
        if (/^[A-Z2-9]{4,32}$/.test(code)) {
          if (await importCaptureFromCode(code)) {
            ready = true;
            return;
          }
          // Import failed — fall through to the normal load flow (error shown via toast)
        } else {
          importError = new CaptureImportError('captureImport.code');
        }
      }

      const id = url.searchParams.get('id');
      if (id) {
        // A new/imported project may exist only in memory if its first save failed.
        const pending = get(currentProject);
        if (pending?.id === id && get(saveState) !== 'saved') { ready = true; return; }
        const project = await localStore.load(id);
        if (project) {
          loadProject(project);
          markClean();
        } else {
          const p = createDefaultProject();
          loadProject(p);
          await autoSave();
          replaceState(`${base}/editor?id=${p.id}`, page.state);
        }
      } else {
        const p = createDefaultProject();
        loadProject(p);
        await autoSave();
        replaceState(`${base}/editor?id=${p.id}`, page.state);
      }
      ready = true;
    } catch (error) {
      loadError = storageErrorMessage(error);
    }
  }

  onMount(() => {
    void initializeEditor();
    // Imports can replace the active project from either sidebar or toolbar.
    // Keep reloads pointed at that project once initial route loading is complete.
    const stopSyncProjectUrl = currentProject.subscribe((project) => {
      if (!ready || !project) return;
      const url = new URL(window.location.href);
      if (url.searchParams.get('id') === project.id) return;
      url.searchParams.delete('import');
      url.searchParams.set('id', project.id);
      replaceState(url, page.state);
    });
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (get(saveState) !== 'saved') {
        void autoSave();
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const onVisibilityChange = () => {
      if (document.hidden && get(saveState) === 'unsaved') void autoSave();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stopSyncProjectUrl();
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  });
</script>


{#if ready}
  <EditorWorkspace />
{:else}
  <div class="h-screen flex flex-col items-center justify-center gap-3">
    {#if loadError}
      <p role="alert" class="max-w-lg px-6 text-center text-red-700">{projectServiceMessage(loadError, $locale)}</p>
      <button class="text-blue-700 underline" onclick={initializeEditor}>{$t('library.retry')}</button>
      <button class="text-blue-700 underline" onclick={backupLibrary}>{$t('library.backup')}</button>
      <a class="text-blue-700 underline" href={`${base}/local`}>{$t('editorRecovery.back')}</a>
    {:else if importingCapture}
      <div class="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" aria-hidden="true"></div>
      <p class="text-gray-400">{$t('editorRecovery.importing')}</p>
    {:else}
      <p class="text-gray-400">{$t('editorRecovery.loading')}</p>
    {/if}
  </div>
{/if}

<!-- iOS capture import error toast -->
{#if importError}
  <div class="fixed top-16 left-1/2 -translate-x-1/2 z-[100] w-[calc(100vw-2rem)] max-w-md bg-red-50 border border-red-200 text-red-700 rounded-lg shadow-lg px-4 py-3 flex items-start gap-3" role="alert">
    <svg class="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
    <div class="flex-1 text-sm">
      <p class="font-semibold">{$t('editorRecovery.failed')}</p>
      <p>{importError instanceof CaptureImportError ? $t(importError.key, importError.variables) : importError}</p>
    </div>
    <button class="text-red-400 hover:text-red-600 text-lg leading-none" onclick={() => importError = null} aria-label={$t('editorRecovery.dismiss')}>✕</button>
  </div>
{/if}
