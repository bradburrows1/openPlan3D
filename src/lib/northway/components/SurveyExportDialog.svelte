<script lang="ts">
  /**
   * Export → Survey Plan: one floor as a Northway-branded Survey Findings, Recommended Works or
   * Combined plan, as a 300 dpi PNG or a PDF. The chosen view applies to this export only.
   */
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { modalDialog } from '$lib/utils/modalDialog';
  import { currentProject } from '$lib/stores/project';
  import { projectSettings } from '$lib/stores/settings';
  import { cloudDetails } from '../cloud/session';
  import { setFloorName, setSurveyDate } from '../surveyMeta';
  import { canvasMeasure, exportReport, prepareReport, renderReport, REPORT_VIEWS, reportFilename, type ReportView } from '../export/reportExport';
  import { loadNorthwayLogo } from '../export/logo';
  import type { Paper } from '../export/reportLayout';

  let { onclose }: { onclose: () => void } = $props();

  let project = $derived($currentProject);
  let floorId = $state(get(currentProject)?.activeFloorId ?? '');
  let view = $state<ReportView>('survey-findings');
  /** PNG size: Word report width (default) or a full A4 page. The PDF is always A4. */
  let paper = $state<Paper>('word');
  let floor = $derived(project?.floors.find(f => f.id === floorId));
  // Fresh objects, so a renamed floor shows its new name (floors are edited in place).
  let floorOptions = $derived(project?.floors.map(f => ({ id: f.id, name: f.name })) ?? []);
  let floorName = $state('');
  let localAddress = $state('');
  let logo = $state<HTMLImageElement | null>(null);
  let busy = $state<'png' | 'pdf' | null>(null);
  let error = $state<string | null>(null);
  let preview: HTMLCanvasElement | undefined = $state();
  const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

  let cloud = $derived($cloudDetails !== null);
  let address = $derived(cloud ? $cloudDetails?.property_address ?? '' : localAddress);
  let details = $derived({ projectName: project?.name ?? '', propertyAddress: address || null, floorName: floor?.name ?? '', surveyDate: project?.surveyDate });
  const prepare = (size: Paper) => project && floor && measureCanvas ? prepareReport(project, floor.id, view, details, $projectSettings, canvasMeasure(measureCanvas), size) : null;
  let report = $derived(prepare(paper));

  $effect(() => { floorName = floor?.name ?? ''; });
  onMount(() => { void loadNorthwayLogo().then(image => { logo = image; }); });

  $effect(() => {
    if (!preview || !report) return;
    const scale = Math.min(520 / report.layout.pageWidth, 520 / report.layout.pageHeight);
    renderReport(preview, report, $projectSettings, logo, scale * Math.min(2, window.devicePixelRatio || 1));
    preview.style.width = `${report.layout.pageWidth * scale}px`;
    preview.style.height = `${report.layout.pageHeight * scale}px`;
  });

  async function download(format: 'png' | 'pdf') {
    if (!report || busy) return;
    busy = format; error = null;
    try {
      await new Promise(resolve => setTimeout(resolve, 30)); // let the button show its busy state
      const target = format === 'pdf' && paper !== 'a4' ? prepare('a4') : report;
      if (target) await exportReport(target, $projectSettings, logo, format);
    } catch (e) {
      error = e instanceof Error ? e.message : 'The export could not be created.';
    } finally { busy = null; }
  }
</script>

<dialog use:modalDialog class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" aria-label="Export survey plan" data-survey-export
  onclick={(e) => { if (e.target === e.currentTarget && !busy) onclose(); }} oncancel={(e) => { e.preventDefault(); if (!busy) onclose(); }}>
  <div class="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[calc(100vh-2rem)] overflow-auto p-5 flex flex-col md:flex-row gap-5">
    <div class="md:w-72 shrink-0 space-y-4">
      <h2 class="text-base font-semibold text-slate-900">Export survey plan</h2>
      {#if floorOptions.length > 1}
        <label class="block">
          <span class="text-xs text-gray-500">Floor</span>
          <!-- Not bind:value: the binding can adopt the first option before the floors render. -->
          <select class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" onchange={(e) => floorId = (e.target as HTMLSelectElement).value}>
            {#each floorOptions as f (f.id)}<option value={f.id} selected={f.id === floorId}>{f.name}</option>{/each}
          </select>
        </label>
      {/if}
      <fieldset class="space-y-1">
        <legend class="text-xs text-gray-500 mb-1">Plan</legend>
        {#each REPORT_VIEWS as option (option.id)}
          <label class="flex items-center gap-2 text-sm text-slate-800 px-2 py-1.5 rounded-md cursor-pointer {view === option.id ? 'bg-slate-100' : 'hover:bg-gray-50'}">
            <input type="radio" name="survey-export-view" value={option.id} bind:group={view} />
            {option.label}
          </label>
        {/each}
      </fieldset>
      <fieldset class="space-y-1">
        <legend class="text-xs text-gray-500 mb-1">PNG size</legend>
        <label class="flex items-start gap-2 text-sm text-slate-800 px-2 py-1.5 rounded-md cursor-pointer {paper === 'word' ? 'bg-slate-100' : 'hover:bg-gray-50'}">
          <input type="radio" name="survey-export-paper" value="word" bind:group={paper} class="mt-1" />
          <span>Word report <span class="block text-xs text-gray-500">17 cm wide; text stays readable at page width</span></span>
        </label>
        <label class="flex items-start gap-2 text-sm text-slate-800 px-2 py-1.5 rounded-md cursor-pointer {paper === 'a4' ? 'bg-slate-100' : 'hover:bg-gray-50'}">
          <input type="radio" name="survey-export-paper" value="a4" bind:group={paper} class="mt-1" />
          <span>A4 page <span class="block text-xs text-gray-500">Full sheet, as the PDF</span></span>
        </label>
      </fieldset>
      <div class="space-y-3 border-t border-gray-100 pt-3">
        <label class="block">
          <span class="text-xs text-gray-500">Property address</span>
          {#if cloud}
            <input class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm bg-gray-50 text-gray-700" value={address} readonly placeholder="Not set" />
            <span class="block text-xs text-gray-400 mt-1">Change it with Rename in the plan library.</span>
          {:else}
            <input class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" bind:value={localAddress} placeholder="For this export only" />
          {/if}
        </label>
        <label class="block">
          <span class="text-xs text-gray-500">Plan / floor name</span>
          <input class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" bind:value={floorName} list="northway-floor-names" maxlength="80"
            onchange={() => { if (floor && floorName.trim()) setFloorName(floor.id, floorName); else floorName = floor?.name ?? ''; }} />
          <datalist id="northway-floor-names">
            {#each ['Ground Floor', 'First Floor', 'Second Floor', 'Cellar', 'Basement', 'Subfloor', 'Roof Space'] as name}<option value={name}></option>{/each}
          </datalist>
        </label>
        <label class="block">
          <span class="text-xs text-gray-500">Survey date</span>
          <input type="date" class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" value={project?.surveyDate ?? ''}
            onchange={(e) => setSurveyDate((e.target as HTMLInputElement).value)} />
        </label>
        <p class="text-xs text-gray-400">Floor name and survey date are saved with the plan.</p>
      </div>
      {#if error}<p role="alert" class="text-sm text-red-700">{error}</p>{/if}
      <div class="space-y-2 border-t border-gray-100 pt-3">
        <button class="w-full px-4 py-2 rounded-lg bg-[#083335] text-white text-sm font-semibold hover:bg-[#0c4447] disabled:opacity-60" disabled={!report || !!busy} onclick={() => download('png')}>
          {busy === 'png' ? 'Creating PNG…' : 'Download PNG (300 dpi)'}
        </button>
        <button class="w-full px-4 py-2 rounded-lg border border-[#083335] text-[#083335] text-sm font-semibold hover:bg-slate-50 disabled:opacity-60" disabled={!report || !!busy} onclick={() => download('pdf')}>
          {busy === 'pdf' ? 'Creating PDF…' : 'Download PDF (A4)'}
        </button>
        {#if report}<p class="text-xs text-gray-400 break-all" data-export-filename>{reportFilename(details, view, 'png')}</p>{/if}
        <button class="w-full px-3 py-2 text-sm text-slate-600 hover:text-slate-900" disabled={!!busy} onclick={onclose}>Close</button>
      </div>
    </div>
    <div class="flex-1 min-w-0 flex items-start justify-center bg-slate-100 rounded-lg p-4">
      {#if report}
        <canvas bind:this={preview} class="bg-white shadow-md max-w-full" aria-label="Preview of the exported plan" data-export-preview></canvas>
      {:else}
        <p class="text-sm text-slate-500 self-center">This floor is empty. Draw or import a plan first.</p>
      {/if}
    </div>
  </div>
</dialog>
