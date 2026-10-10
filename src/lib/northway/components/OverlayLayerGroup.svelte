<script lang="ts">
  /**
   * One overlay layer in the Build panel:
   *   + Area  presets or a custom finding/recommendation (Stage 4)
   *   + Pin   a free-text point marker
   *   + Line  a free-text line or polyline
   * and the layer's own Show/Hide.
   */
  import type { OverlayLayer } from '$lib/models/types';
  import { t } from '$lib/i18n';
  import { currentProject, placingFurnitureId, selectedElementId, selectedElementIds, selectedTool } from '$lib/stores/project';
  import { projectSettings } from '$lib/stores/settings';
  import { placingZone, presetTemplate, freshLayerColour, placingMarkup, lineDraft, finishLineDraft, cancelMarkupTool, type ZoneTemplate } from '../overlayStore';
  import { floorItems } from '../references';
  import { presetsFor } from '../zonePresets';
  import ZoneSwatch from './ZoneSwatch.svelte';
  import ZoneTemplateDialog from './ZoneTemplateDialog.svelte';
  import RecommendationDialog from './RecommendationDialog.svelte';
  import PriorityBadge from './PriorityBadge.svelte';
  import { priorityStyle, type NorthwayPriority } from '../priorities';
  import { unassignedRefs } from '../overlayStore';

  let { layer }: { layer: OverlayLayer } = $props();

  const findings = $derived(layer === 'survey-findings');
  const settingKey = $derived(findings ? 'showSurveyFindings' : 'showRecommendedWorks');
  const text = $derived(findings
    ? { title: $t('northway.surveyFindings'), add: $t('northway.addIssueArea'), help: $t('northway.addIssueAreaHelp'), custom: $t('northway.customFinding'), show: $t('northway.showSurveyFindings'), hide: $t('northway.hideSurveyFindings'), pin: $t('northway.addFindingPin'), line: $t('northway.addFindingLine') }
    : { title: $t('northway.recommendedWorks'), add: $t('northway.addRecommendedArea'), help: $t('northway.addRecommendedAreaHelp'), custom: $t('northway.customRecommendation'), show: $t('northway.showRecommendedWorks'), hide: $t('northway.hideRecommendedWorks'), pin: $t('northway.addRecommendationPin'), line: $t('northway.addRecommendationLine') });
  // Stage 2 test hooks for the findings group are kept; recommendations get their own.
  const hooks = $derived(findings
    ? { group: { 'data-survey-findings': '' }, presets: { 'data-issue-presets': '' }, toggle: { 'data-survey-findings-toggle': '' } }
    : { group: { 'data-recommended-works': '' }, presets: { 'data-work-presets': '' }, toggle: { 'data-recommended-works-toggle': '' } });

  let pickerOpen = $state(false);
  let dialogOpen = $state(false);
  let visible = $derived($projectSettings[settingKey] !== false);
  let armed = $derived($placingZone?.layer === layer ? $placingZone : null);
  let markupArmed = $derived($placingMarkup?.layer === layer ? $placingMarkup.kind : null);
  /** Recommended Works: the dialog (priority, text) comes before drawing. */
  let recommendationKind = $state<'area' | 'pin' | 'line' | null>(null);
  /** What is about to be drawn or placed, shown while armed. */
  let armedRecommendation = $derived(findings ? null
    : armed ? { priority: armed.priority ?? 'unassigned', text: armed.name }
    : $placingMarkup?.layer === layer && $placingMarkup.draft ? { priority: $placingMarkup.draft.priority ?? 'unassigned', text: $placingMarkup.draft.description } : null);
  let needPriority = $derived.by(() => {
    if (findings) return [];
    const project = $currentProject;
    return unassignedRefs(project?.floors.find(f => f.id === project.activeFloorId));
  });

  function armRecommendation(kind: 'area' | 'pin' | 'line', draft: { priority: NorthwayPriority; text: string; workType: string | null }) {
    recommendationKind = null;
    prepare();
    cancelMarkupTool();
    placingZone.set(null);
    const color = priorityStyle(draft.priority).color;
    if (kind === 'area') placingZone.set({ layer, code: draft.workType ?? 'REC', name: draft.text, color, preset: draft.workType, priority: draft.priority, workType: draft.workType });
    else placingMarkup.set({ kind, layer, draft: { layer, description: draft.text, color, priority: draft.priority, workType: draft.workType } });
  }

  function prepare() {
    selectedTool.set('select');
    placingFurnitureId.set(null);
    if (!visible) projectSettings.update(settings => ({ ...settings, [settingKey]: true }));
  }

  function arm(template: ZoneTemplate) {
    prepare();
    cancelMarkupTool();
    placingZone.set(template);
  }

  function togglePreset(template: ZoneTemplate) {
    if (armed && armed.preset === template.preset && armed.code === template.code) placingZone.set(null);
    else arm(template);
  }

  function toggleArea() {
    if (!findings) { if (armed) placingZone.set(null); else { cancelMarkupTool(); recommendationKind = 'area'; } return; }
    pickerOpen = !pickerOpen;
    if (pickerOpen) cancelMarkupTool();
    else if (armed) placingZone.set(null);
  }

  function toggleMarkup(kind: 'pin' | 'line') {
    if (markupArmed === kind) { cancelMarkupTool(); return; }
    if (!findings) { placingZone.set(null); cancelMarkupTool(); recommendationKind = kind; return; }
    prepare();
    placingZone.set(null);
    pickerOpen = false;
    lineDraft.set([]);
    placingMarkup.set({ kind, layer });
  }

  function activeFloor() {
    const project = $currentProject;
    return project?.floors.find(f => f.id === project.activeFloorId);
  }

  function toggleVisible() {
    if (visible) {
      // Hidden items must not stay selected, or Delete would remove something unseen.
      const ids = new Set(($currentProject?.floors ?? []).flatMap(floor => floorItems(floor)).filter(item => item.layer === layer).map(item => item.id));
      if (armed) placingZone.set(null);
      if (markupArmed) cancelMarkupTool();
      if (ids.has($selectedElementId ?? '')) selectedElementId.set(null);
      selectedElementIds.update(current => new Set([...current].filter(id => !ids.has(id))));
    }
    projectSettings.update(settings => ({ ...settings, [settingKey]: !visible }));
  }

  const toolClass = (on: boolean) => `flex-1 min-w-0 flex items-center justify-center gap-1 px-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${on ? 'bg-blue-50 text-slate-800 ring-1 ring-blue-200' : 'bg-gray-50 hover:bg-gray-100 text-gray-700'}`;
</script>

<h3 class="text-xs font-semibold text-gray-400 uppercase mb-2 mt-3">{text.title}</h3>
<div class="space-y-1" {...hooks.group} role="group" aria-label={text.title}>
  <div class="flex gap-1.5">
    <button class={toolClass(pickerOpen || !!armed)} aria-expanded={findings ? pickerOpen : undefined} aria-label={text.add} title={text.help} onclick={toggleArea}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        {#if findings}<rect x="4" y="6" width="16" height="12" rx="1"/>{:else}<rect x="4" y="6" width="16" height="12" rx="1" stroke-dasharray="3 2"/>{/if}
      </svg>
      <span class="whitespace-nowrap">+ {$t('northway.area')}</span>
    </button>
    <button class={toolClass(markupArmed === 'pin')} aria-pressed={markupArmed === 'pin'} aria-label={text.pin} title={text.pin} onclick={() => toggleMarkup('pin')}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        {#if findings}<circle cx="12" cy="12" r="7"/>{:else}<polygon points="12,4 19,8 19,16 12,20 5,16 5,8"/>{/if}
      </svg>
      <span class="whitespace-nowrap">+ {$t('northway.pin')}</span>
    </button>
    <button class={toolClass(markupArmed === 'line')} aria-pressed={markupArmed === 'line'} aria-label={text.line} title={text.line} onclick={() => toggleMarkup('line')}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
        <polyline points="4,18 10,10 20,8" stroke-dasharray={findings ? undefined : '4 3'}/>
      </svg>
      <span class="whitespace-nowrap">+ {$t('northway.line')}</span>
    </button>
  </div>

  {#if armedRecommendation}
    <div class="px-2 py-1.5 rounded-md bg-blue-50 ring-1 ring-blue-200 text-xs space-y-1" data-armed-recommendation>
      <div class="flex items-start gap-2">
        <PriorityBadge priority={armedRecommendation.priority} />
        <span class="text-slate-800 line-clamp-2 break-words min-w-0">{armedRecommendation.text}</span>
      </div>
      {#if armed}<p class="text-gray-500">Drag a rectangle on the plan.</p>{/if}
    </div>
  {/if}
  {#if markupArmed === 'pin'}
    <p class="px-1 py-1 text-xs text-gray-500" data-markup-hint>{$t('northway.pinHint')}</p>
  {:else if markupArmed === 'line'}
    <div class="px-1 py-1 space-y-1.5" data-markup-hint>
      <p class="text-xs text-gray-500">{$t('northway.lineHint')}</p>
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-400 flex-1">{$t('northway.linePoints', { count: $lineDraft.length })}</span>
        <button class="px-2.5 py-1 text-xs rounded border border-gray-200 hover:bg-gray-50" onclick={cancelMarkupTool}>{$t('northway.cancel')}</button>
        <button class="px-2.5 py-1 text-xs rounded bg-[#083335] text-white font-semibold disabled:opacity-50" disabled={$lineDraft.length < 2} onclick={() => finishLineDraft()}>{$t('northway.finishLine')}</button>
      </div>
    </div>
  {/if}

  {#if pickerOpen && findings}
    <div class="grid grid-cols-1 gap-1 pl-2" {...hooks.presets}>
      {#each presetsFor(layer) as preset (preset.code)}
        {@const template = presetTemplate(preset)}
        {@const on = !!armed && armed.preset === preset.code}
        <button
          class="flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs transition-colors {on ? 'bg-blue-50 ring-1 ring-blue-300 text-slate-800' : 'hover:bg-gray-50 text-gray-700'}"
          aria-pressed={on}
          title={preset.name}
          onclick={() => togglePreset(template)}
        >
          <ZoneSwatch {layer} color={preset.color} />
          <span class="font-semibold w-7" style="color: {preset.color}">{preset.code}</span>
          <span class="truncate">{preset.name}</span>
        </button>
      {/each}
      {#if armed && armed.preset === null}
        <div class="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs bg-blue-50 ring-1 ring-blue-300 text-slate-800" data-armed-custom-zone>
          <ZoneSwatch {layer} color={armed.color} />
          <span class="font-semibold w-7" style="color: {armed.color}">{armed.code}</span>
          <span class="truncate">{armed.name}</span>
        </div>
      {/if}
      <button class="flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs text-slate-700 hover:bg-gray-50 font-medium" onclick={() => dialogOpen = true}>
        {text.custom}
      </button>
    </div>
  {/if}
  {#if needPriority.length}
    <p class="px-2 py-1 text-xs text-amber-800 bg-amber-50 rounded-md" role="status" data-priority-required>
      Priority required: {needPriority.join(', ')}
    </p>
  {/if}
  <button
    class="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-gray-600 hover:bg-gray-50"
    aria-pressed={!visible}
    {...hooks.toggle}
    onclick={toggleVisible}
  >
    <span aria-hidden="true">{visible ? '◉' : '○'}</span>
    {visible ? text.hide : text.show}
  </button>
</div>

{#if recommendationKind}
  {@const kind = recommendationKind}
  <RecommendationDialog {kind} onclose={() => recommendationKind = null} onsubmit={(draft) => armRecommendation(kind, draft)} />
{/if}

{#if dialogOpen}
  <ZoneTemplateDialog {layer} initialColor={freshLayerColour(activeFloor(), layer)} onclose={() => dialogOpen = false}
    ondraw={(template) => { dialogOpen = false; arm(template); }} />
{/if}
