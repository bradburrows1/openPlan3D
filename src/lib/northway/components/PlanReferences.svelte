<script lang="ts">
  /** The current floor's legend in the sidebar: every finding and recommendation by reference. Click one to select it. */
  import { t } from '$lib/i18n';
  import { currentProject, selectedElementId, selectedElementIds, selectedRoomId } from '$lib/stores/project';
  import { projectSettings } from '$lib/stores/settings';
  import { buildLegend, LEGEND_LAYERS } from '../legend';
  import { settingsLayers } from '../planView';
  import MarkupSwatch from './MarkupSwatch.svelte';

  // Floors are edited in place, so read them through the project (a new object on every change).
  let legend = $derived.by(() => {
    const project = $currentProject;
    return buildLegend(project?.floors.find(f => f.id === project.activeFloorId), settingsLayers($projectSettings));
  });
  let empty = $derived(!legend['survey-findings'].length && !legend['recommended-works'].length);

  function select(id: string) {
    selectedRoomId.set(null);
    selectedElementIds.set(new Set());
    selectedElementId.set(id);
  }
</script>

{#if !empty}
  <h3 class="text-xs font-semibold text-gray-400 uppercase mb-2 mt-3">{$t('northway.planReferences')}</h3>
  <div class="space-y-2" data-plan-references>
    {#each LEGEND_LAYERS as layer (layer)}
      {#if legend[layer].length}
        <ul class="space-y-0.5" aria-label={layer === 'survey-findings' ? $t('northway.surveyFindings') : $t('northway.recommendedWorks')}>
          {#each legend[layer] as entry (entry.id)}
            <li>
              <button class="w-full flex items-start gap-2 px-2 py-1 rounded-md text-left text-xs hover:bg-gray-50 {$selectedElementId === entry.id ? 'bg-blue-50 ring-1 ring-blue-200' : ''}" onclick={() => select(entry.id)} data-reference={entry.ref}>
                <span class="mt-0.5"><MarkupSwatch kind={entry.kind} {layer} color={entry.color} width={18} height={12} /></span>
                <span class="font-semibold w-7 shrink-0 text-slate-800">{entry.ref}</span>
                {#if entry.kind === 'area'}<span class="font-semibold shrink-0" style="color: {entry.color}">{entry.code}</span>{/if}
                <span class="text-gray-600 line-clamp-2 break-words min-w-0">{entry.text}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/each}
  </div>
{/if}
