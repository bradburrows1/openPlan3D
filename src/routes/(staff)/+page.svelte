<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { modalDialog } from '$lib/utils/modalDialog';
  import { createDefaultProject } from '$lib/stores/project';
  import type { Project } from '$lib/models/types';
  import { authState, signOut } from '$lib/northway/cloud/auth';
  import { requireSupabase } from '$lib/northway/cloud/supabase';
  import { createProject, deleteProject, duplicateProject, filterProjects, listProjects, updateMetadata, type ProjectSummary } from '$lib/northway/cloud/projectsApi';
  import { projectFromFile } from '$lib/northway/cloud/importPlan';
  import { deleteDraft } from '$lib/northway/cloud/recovery';

  let projects = $state<ProjectSummary[]>([]);
  let loading = $state(true);
  let listError = $state<string | null>(null);
  let search = $state('');
  let visible = $derived(filterProjects(projects, search));

  // New Plan: choose blank or import, then name it.
  let newOpen = $state(false);
  let newStep = $state<'choose' | 'details'>('choose');
  let pendingProject = $state<Project | null>(null);
  let importing = $state(false);
  // Shared details form (new plan and rename).
  let detailsFor = $state<ProjectSummary | null>(null);
  let formName = $state('');
  let formCustomer = $state('');
  let formAddress = $state('');
  let formError = $state<string | null>(null);
  let busy = $state(false);
  let deleteTarget = $state<ProjectSummary | null>(null);
  let fileInput = $state<HTMLInputElement>();

  const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const formatDate = (value: string) => dateFormat.format(new Date(value));

  async function refresh() {
    loading = true;
    try { projects = await listProjects(requireSupabase()); listError = null; }
    catch (error) { listError = error instanceof Error ? error.message : 'Could not load your plans.'; }
    finally { loading = false; }
  }
  onMount(refresh);

  function openNew() {
    newOpen = true; newStep = 'choose'; pendingProject = null; formError = null;
  }

  function startDetails(project: Project, suggestedName = '') {
    pendingProject = project;
    formName = suggestedName; formCustomer = ''; formAddress = ''; formError = null;
    newStep = 'details';
  }

  async function chooseImport() {
    formError = null;
    fileInput?.click();
  }

  async function onFileChosen() {
    const file = fileInput?.files?.[0];
    if (fileInput) fileInput.value = '';
    if (!file) return;
    importing = true; formError = null;
    try {
      const { project, suggestedName } = await projectFromFile(file);
      startDetails(project, suggestedName);
    } catch (error) {
      formError = `${error instanceof Error ? error.message : 'Could not read this file.'} Nothing was imported.`;
    } finally { importing = false; }
  }

  async function createPlan(event: SubmitEvent) {
    event.preventDefault();
    if (!pendingProject || busy) return;
    busy = true; formError = null;
    try {
      const row = await createProject(requireSupabase(), { project_name: formName, customer_name: formCustomer, property_address: formAddress }, pendingProject);
      newOpen = false;
      await goto(`/projects/${row.id}`);
    } catch (error) { formError = error instanceof Error ? error.message : 'Could not create this plan.'; }
    finally { busy = false; }
  }

  function openRename(project: ProjectSummary) {
    detailsFor = project;
    formName = project.project_name; formCustomer = project.customer_name ?? ''; formAddress = project.property_address ?? ''; formError = null;
  }

  async function saveDetails(event: SubmitEvent) {
    event.preventDefault();
    if (!detailsFor || busy) return;
    busy = true; formError = null;
    try {
      await updateMetadata(requireSupabase(), detailsFor.id, { project_name: formName, customer_name: formCustomer, property_address: formAddress });
      detailsFor = null;
      await refresh();
    } catch (error) { formError = error instanceof Error ? error.message : 'Could not save these details.'; }
    finally { busy = false; }
  }

  async function duplicate(project: ProjectSummary) {
    busy = true; listError = null;
    try { await duplicateProject(requireSupabase(), project.id); await refresh(); }
    catch (error) { listError = error instanceof Error ? error.message : 'Could not duplicate this plan.'; }
    finally { busy = false; }
  }

  // Delete safety: the confirm button only arms a moment after the dialog opens, so a quick double
  // tap on an iPad (Delete, then wherever the dialog appears) can never confirm by accident.
  let deleteArmed = $state(false);
  let deleteArmTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    clearTimeout(deleteArmTimer);
    deleteArmed = false;
    if (deleteTarget) deleteArmTimer = setTimeout(() => { deleteArmed = true; }, 700);
  });

  async function confirmDelete() {
    if (!deleteTarget || busy || !deleteArmed) return;
    const target = deleteTarget;
    busy = true; listError = null;
    try {
      await deleteProject(requireSupabase(), target.id);
      await deleteDraft(target.id);
      deleteTarget = null;
      await refresh();
    } catch (error) { listError = error instanceof Error ? error.message : 'Could not delete this plan.'; deleteTarget = null; }
    finally { busy = false; }
  }

  async function logout() {
    await signOut();
    await goto('/login', { replaceState: true });
  }
</script>

<svelte:head><title>Northway Plans</title></svelte:head>

<div class="min-h-screen bg-slate-50" data-northway-touch>
  <header class="bg-white border-b border-slate-200">
    <div class="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
      <img src="/northway-logo.svg" alt="Northway Preservation" class="h-7" />
      <span class="h-6 w-px bg-slate-200 max-sm:hidden"></span>
      <h1 class="text-base font-semibold text-slate-900 max-sm:hidden">Northway Plans</h1>
      <div class="flex-1"></div>
      <span class="text-sm text-slate-500 max-md:hidden" data-user-email>{$authState.email}</span>
      <button class="text-sm text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg px-3 py-1.5" onclick={logout}>Sign out</button>
    </div>
  </header>

  <main class="max-w-6xl mx-auto px-4 sm:px-6 py-8">
    <div class="flex flex-wrap items-center gap-3 mb-5">
      <button class="px-4 py-2 rounded-lg bg-[#083335] text-white text-sm font-semibold hover:bg-[#0c4447]" onclick={openNew}>New Plan</button>
      <input type="search" bind:value={search} placeholder="Search…" aria-label="Search plans by project, customer or property"
        class="flex-1 min-w-48 max-w-md px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1f8e78]/40 focus:border-[#1f8e78]" />
    </div>

    {#if listError}<p role="alert" class="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{listError}</p>{/if}

    <div class="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <table class="w-full text-sm" data-plan-library>
        <thead class="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-4 py-3">Project</th>
            <th class="px-4 py-3 max-md:hidden">Property</th>
            <th class="px-4 py-3 max-md:hidden">Customer</th>
            <th class="px-4 py-3 max-sm:hidden">Last Updated</th>
            <th class="px-4 py-3 max-lg:hidden">Created</th>
            <th class="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          {#if loading}
            <tr><td colspan="6" class="px-4 py-10 text-center text-slate-400">Loading plans…</td></tr>
          {:else if visible.length === 0}
            <tr><td colspan="6" class="px-4 py-10 text-center text-slate-500">{projects.length ? 'No plans match your search.' : 'No plans yet. Choose New Plan to draw or import one.'}</td></tr>
          {:else}
            {#each visible as project (project.id)}
              <tr class="hover:bg-slate-50" data-plan-row={project.id}>
                <td class="px-4 py-3">
                  <a class="font-medium text-slate-900 hover:underline" href={`/projects/${project.id}`}>{project.project_name}</a>
                  <div class="md:hidden text-xs text-slate-500">{[project.property_address, project.customer_name].filter(Boolean).join(' · ')}</div>
                </td>
                <td class="px-4 py-3 text-slate-600 max-md:hidden">{project.property_address ?? ''}</td>
                <td class="px-4 py-3 text-slate-600 max-md:hidden">{project.customer_name ?? ''}</td>
                <td class="px-4 py-3 text-slate-600 whitespace-nowrap max-sm:hidden">{formatDate(project.updated_at)}</td>
                <td class="px-4 py-3 text-slate-500 whitespace-nowrap max-lg:hidden">{formatDate(project.created_at)}</td>
                <td class="px-4 py-3">
                  <div class="flex justify-end gap-1 text-xs">
                    <a class="px-2 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-100" href={`/projects/${project.id}`}>Open</a>
                    <button class="px-2 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-100" onclick={() => openRename(project)}>Rename</button>
                    <button class="px-2 py-1 rounded border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:opacity-50" disabled={busy} onclick={() => duplicate(project)}>Duplicate</button>
                    <button class="px-2 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50" onclick={() => deleteTarget = project}>Delete</button>
                  </div>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </main>
</div>

<input type="file" accept=".json,.zip,application/json,application/zip" class="hidden" bind:this={fileInput} onchange={onFileChosen} data-import-input />

{#if newOpen}
  <dialog use:modalDialog class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" aria-label="New Plan"
    onclick={(e) => { if (e.target === e.currentTarget && !busy) newOpen = false; }} oncancel={(e) => { e.preventDefault(); if (!busy) newOpen = false; }}>
    <div class="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
      <h2 class="text-lg font-semibold text-slate-900 mb-4">New Plan</h2>
      {#if newStep === 'choose'}
        <div class="grid gap-3">
          <button class="text-left border border-slate-200 rounded-lg p-4 hover:border-[#1f8e78] hover:bg-slate-50" onclick={() => startDetails(createDefaultProject())}>
            <div class="font-medium text-slate-900">Blank Plan</div>
            <div class="text-sm text-slate-500">Start an empty plan and draw it in the editor.</div>
          </button>
          <button class="text-left border border-slate-200 rounded-lg p-4 hover:border-[#1f8e78] hover:bg-slate-50 disabled:opacity-60" disabled={importing} onclick={chooseImport}>
            <div class="font-medium text-slate-900">{importing ? 'Reading file…' : 'Import Plan'}</div>
            <div class="text-sm text-slate-500">Apple RoomPlan scan (.json or .zip), OpenPlan3D project file or project package.</div>
          </button>
        </div>
        {#if formError}<p role="alert" class="mt-3 text-sm text-red-700">{formError}</p>{/if}
        <div class="mt-5 text-right"><button class="text-sm text-slate-600 hover:text-slate-900" onclick={() => newOpen = false}>Cancel</button></div>
      {:else}
        <form class="space-y-3" onsubmit={createPlan}>
          {@render detailsFields()}
          {#if formError}<p role="alert" class="text-sm text-red-700">{formError}</p>{/if}
          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="px-3 py-2 text-sm text-slate-600 hover:text-slate-900" onclick={() => newStep = 'choose'}>Back</button>
            <button type="submit" disabled={busy} class="px-4 py-2 rounded-lg bg-[#083335] text-white text-sm font-semibold hover:bg-[#0c4447] disabled:opacity-60">{busy ? 'Creating…' : 'Create Plan'}</button>
          </div>
        </form>
      {/if}
    </div>
  </dialog>
{/if}

{#if detailsFor}
  <dialog use:modalDialog class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" aria-label="Rename plan"
    onclick={(e) => { if (e.target === e.currentTarget && !busy) detailsFor = null; }} oncancel={(e) => { e.preventDefault(); if (!busy) detailsFor = null; }}>
    <form class="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-3" onsubmit={saveDetails}>
      <h2 class="text-lg font-semibold text-slate-900 mb-1">Plan details</h2>
      {@render detailsFields()}
      {#if formError}<p role="alert" class="text-sm text-red-700">{formError}</p>{/if}
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" class="px-3 py-2 text-sm text-slate-600 hover:text-slate-900" onclick={() => detailsFor = null}>Cancel</button>
        <button type="submit" disabled={busy} class="px-4 py-2 rounded-lg bg-[#083335] text-white text-sm font-semibold hover:bg-[#0c4447] disabled:opacity-60">{busy ? 'Saving…' : 'Save details'}</button>
      </div>
    </form>
  </dialog>
{/if}

{#if deleteTarget}
  <dialog use:modalDialog class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" aria-label="Delete plan"
    oncancel={(e) => { e.preventDefault(); if (!busy) deleteTarget = null; }}>
    <div class="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
      <h2 class="text-base font-semibold text-slate-900">Delete "{deleteTarget.project_name}"?</h2>
      <p class="text-sm text-slate-600 mt-2">This cannot be undone.</p>
      <div class="flex justify-end gap-2 mt-6">
        <button class="px-3 py-2 text-sm text-slate-600 hover:text-slate-900" onclick={() => deleteTarget = null}>Cancel</button>
        <button class="px-4 py-2 rounded-lg bg-red-700 text-white text-sm font-semibold hover:bg-red-800 disabled:opacity-60" disabled={busy || !deleteArmed} onclick={confirmDelete} data-delete-confirm>{busy ? 'Deleting…' : 'Delete'}</button>
      </div>
    </div>
  </dialog>
{/if}

{#snippet detailsFields()}
  <label class="block">
    <span class="text-sm font-medium text-slate-700">Project name <span class="text-red-700">*</span></span>
    <input required maxlength="200" bind:value={formName} placeholder="e.g. 14 Moor Lane - Smith"
      class="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1f8e78]/40 focus:border-[#1f8e78]" />
  </label>
  <label class="block">
    <span class="text-sm font-medium text-slate-700">Customer name <span class="text-slate-400 font-normal">(optional)</span></span>
    <input maxlength="200" bind:value={formCustomer}
      class="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1f8e78]/40 focus:border-[#1f8e78]" />
  </label>
  <label class="block">
    <span class="text-sm font-medium text-slate-700">Property address <span class="text-slate-400 font-normal">(optional)</span></span>
    <textarea maxlength="500" rows="2" bind:value={formAddress}
      class="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1f8e78]/40 focus:border-[#1f8e78] resize-none"></textarea>
  </label>
{/snippet}
