<script lang="ts">
  /** Northway Plans: edit one saved plan. The URL carries only its UUID. */
  import { onDestroy, untrack } from 'svelte';
  import { page } from '$app/state';
  import { beforeNavigate } from '$app/navigation';
  import PortraitHint from '$lib/northway/components/PortraitHint.svelte';
  import EditorWorkspace from '$lib/components/editor/EditorWorkspace.svelte';
  import { currentProject } from '$lib/stores/project';
  import { requireSupabase } from '$lib/northway/cloud/supabase';
  import { getProject } from '$lib/northway/cloud/projectsApi';
  import { openCloudProject, closeCloudProject, hasUnsavedChanges, recoveryOffer, restoreRecovery, discardRecovery } from '$lib/northway/cloud/session';

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let status = $state<'loading' | 'ready' | 'missing' | 'error'>('loading');
  let message = $state('');
  let generation = 0;

  async function load(id: string) {
    const current = ++generation;
    status = 'loading';
    if (!UUID.test(id)) { status = 'missing'; return; }
    try {
      const row = await getProject(requireSupabase(), id);
      if (current !== generation) return;
      if (!row) { status = 'missing'; return; }
      await openCloudProject(row);
      if (current === generation) status = 'ready';
    } catch (error) {
      if (current !== generation) return;
      message = error instanceof Error ? error.message : 'Could not open this plan.';
      status = 'error';
    }
  }

  $effect(() => {
    const id = page.params.id ?? '';
    untrack(() => void load(id));
  });

  // Leaving with unsaved changes: Back to Plans, other links, reloads and closing the tab.
  beforeNavigate((navigation) => {
    if (!hasUnsavedChanges()) return;
    if (navigation.type === 'leave') { navigation.cancel(); return; } // browser shows its own prompt
    if (!confirm('This plan has unsaved changes. Leave without saving?')) navigation.cancel();
  });

  onDestroy(closeCloudProject);

  const savedLabel = (iso: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
</script>

<svelte:head><title>{$currentProject && status === 'ready' ? `${$currentProject.name} · ` : ''}Northway Plans</title></svelte:head>

{#if status === 'ready'}
  <EditorWorkspace cloud />
  <PortraitHint />
  {#if $recoveryOffer}
    <div role="alert" data-recovery-offer class="fixed top-16 left-1/2 -translate-x-1/2 z-[100] w-[calc(100vw-2rem)] max-w-lg bg-amber-50 border border-amber-200 text-amber-900 rounded-lg shadow-lg px-4 py-3 text-sm">
      <p class="font-semibold">Unsaved changes from this device were found</p>
      <p class="mt-1">They were last kept on {savedLabel($recoveryOffer.savedAt)}.{$recoveryOffer.newerOnServer ? ' The plan has been saved since then, so restoring will replace those newer changes when you save.' : ''}</p>
      <div class="flex gap-4 mt-2">
        <button class="font-semibold underline" onclick={restoreRecovery}>Restore my changes</button>
        <button class="underline" onclick={discardRecovery}>Discard them</button>
      </div>
    </div>
  {/if}
{:else}
  <main class="h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
    {#if status === 'loading'}
      <p class="text-slate-500">Opening plan…</p>
    {:else if status === 'missing'}
      <p class="text-slate-700">This plan could not be found. It may have been deleted.</p>
      <a class="text-sm underline text-slate-700" href="/">Back to Plans</a>
    {:else}
      <p role="alert" class="text-red-700 max-w-lg">{message}</p>
      <button class="text-sm underline text-slate-700" onclick={() => load(page.params.id ?? '')}>Try again</button>
      <a class="text-sm underline text-slate-700" href="/">Back to Plans</a>
    {/if}
  </main>
{/if}
