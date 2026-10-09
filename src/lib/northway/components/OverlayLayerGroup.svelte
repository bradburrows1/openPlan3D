<script lang="ts">
  /**
   * One overlay layer in the Build panel: Add Issue Area / Add Recommended Area with its
   * presets, + Custom Finding / + Custom Recommendation, and the layer's own Show/Hide.
   */
  import type { OverlayLayer } from '$lib/models/types';
  import { t } from '$lib/i18n';
  import { currentProject, placingFurnitureId, selectedElementId, selectedElementIds, selectedTool } from '$lib/stores/project';
  import { projectSettings } from '$lib/stores/settings';
  import { placingZone, presetTemplate, floorZones, type ZoneTemplate } from '../overlayStore';
  import { ZONE_PALETTE, presetsFor } from '../zonePresets';
  import ZoneSwatch from './ZoneSwatch.svelte';
  import ZoneTemplateDialog from './ZoneTemplateDialog.svelte';

  let { layer }: { layer: OverlayLayer } = $props();

  const findings = $derived(layer === 'survey-findings');
  const settingKey = $derived(findings ? 'showSurveyFindings' : 'showRecommendedWorks');
  const text = $derived(findings
    ? { title: $t('northway.surveyFindings'), add: $t('northway.addIssueArea'), help: $t('northway.addIssueAreaHelp'), custom: $t('northway.customFinding'), show: $t('northway.showSurveyFindings'), hide: $t('northway.hideSurveyFindings') }
    : { title: $t('northway.recommendedWorks'), add: $t('northway.addRecommendedArea'), help: $t('northway.addRecommendedAreaHelp'), custom: $t('northway.customRecommendation'), show: $t('northway.showRecommendedWorks'), hide: $t('northway.hideRecommendedWorks') });
  // Stage 2 test hooks for the findings group are kept; recommendations get their own.
  const hooks = $derived(findings
    ? { group: { 'data-survey-findings': '' }, presets: { 'data-issue-presets': '' }, toggle: { 'data-survey-findings-toggle': '' } }
    : { group: { 'data-recommended-works': '' }, presets: { 'data-work-presets': '' }, toggle: { 'data-recommended-works-toggle': '' } });

  let pickerOpen = $state(false);
  let dialogOpen = $state(false);
  let visible = $derived($projectSettings[settingKey] !== false);
  let armed = $derived($placingZone?.layer === layer ? $placingZone : null);

  function arm(template: ZoneTemplate) {
    selectedTool.set('select');
    placingFurnitureId.set(null);
    if (!visible) projectSettings.update(settings => ({ ...settings, [settingKey]: true }));
    placingZone.set(template);
  }

  function togglePreset(template: ZoneTemplate) {
    if (armed && armed.preset === template.preset && armed.code === template.code) placingZone.set(null);
    else arm(template);
  }

  /** A custom zone starts with a palette colour not yet used in this layer on the current floor. */
  function freshColour(): string {
    const floor = $currentProject?.floors.find(f => f.id === $currentProject?.activeFloorId);
    const used = new Set(floorZones(floor).filter(zone => zone.layer === layer).map(zone => zone.color?.toLowerCase()));
    return (ZONE_PALETTE.find(colour => !used.has(colour.hex.toLowerCase())) ?? ZONE_PALETTE[0]).hex;
  }

  function toggleVisible() {
    if (visible) {
      // Hidden zones must not stay selected, or Delete would remove something unseen.
      const ids = new Set(($currentProject?.floors ?? []).flatMap(floor => floorZones(floor)).filter(zone => zone.layer === layer).map(zone => zone.id));
      if (armed) placingZone.set(null);
      if (ids.has($selectedElementId ?? '')) selectedElementId.set(null);
      selectedElementIds.update(current => new Set([...current].filter(id => !ids.has(id))));
    }
    projectSettings.update(settings => ({ ...settings, [settingKey]: !visible }));
  }
</script>

<h3 class="text-xs font-semibold text-gray-400 uppercase mb-2 mt-3">{text.title}</h3>
<div class="space-y-1" {...hooks.group} role="group" aria-label={text.title}>
  <button
    class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors {pickerOpen || armed ? 'bg-blue-50 text-slate-800 ring-1 ring-blue-200' : 'hover:bg-gray-50 text-gray-700'}"
    aria-expanded={pickerOpen}
    onclick={() => { pickerOpen = !pickerOpen; if (!pickerOpen && armed) placingZone.set(null); }}
  >
    <div class="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
      {#if findings}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="16" height="12" rx="1" stroke-dasharray="3 2"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/></svg>
      {:else}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="16" height="12" rx="1"/><line x1="8" y1="18" x2="16" y2="6" stroke-width="1.25"/><line x1="4" y1="14" x2="9" y2="6" stroke-width="1.25"/><line x1="13" y1="18" x2="20" y2="9" stroke-width="1.25"/></svg>
      {/if}
    </div>
    <div class="text-left">
      <div class="font-medium">{text.add}</div>
      <div class="text-xs text-gray-400">{text.help}</div>
    </div>
  </button>
  {#if pickerOpen}
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

{#if dialogOpen}
  <ZoneTemplateDialog {layer} initialColor={freshColour()} onclose={() => dialogOpen = false}
    ondraw={(template) => { dialogOpen = false; arm(template); }} />
{/if}
