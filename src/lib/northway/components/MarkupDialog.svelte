<script lang="ts">
  /**
   * The description step of + Pin / + Line: after the location or points are chosen on the plan,
   * ask for the surveyor's own description and a colour, then create the item with the next
   * stable reference. Cancelling creates nothing.
   */
  import { get } from 'svelte/store';
  import { t } from '$lib/i18n';
  import { modalDialog } from '$lib/utils/modalDialog';
  import { currentProject, selectedElementId, selectedElementIds, selectedRoomId } from '$lib/stores/project';
  import { addLine, addPin, freshLayerColour, pendingMarkup } from '../overlayStore';
  import ZoneColourPicker from './ZoneColourPicker.svelte';
  import MarkupSwatch from './MarkupSwatch.svelte';

  const MAX_DESCRIPTION = 500;
  let description = $state('');
  let color = $state('#3b82c4');
  let error = $state<string | null>(null);
  let pending = $derived($pendingMarkup);
  let findings = $derived(pending?.layer === 'survey-findings');
  let title = $derived(!pending ? '' : pending.kind === 'pin'
    ? (findings ? $t('northway.findingPinTitle') : $t('northway.recommendationPinTitle'))
    : (findings ? $t('northway.findingLineTitle') : $t('northway.recommendationLineTitle')));

  // Fresh form each time geometry arrives.
  let lastPending: unknown = null;
  $effect(() => {
    if (pending && pending !== lastPending) {
      const project = get(currentProject);
      description = '';
      error = null;
      color = freshLayerColour(project?.floors.find(f => f.id === project.activeFloorId), pending.layer);
    }
    lastPending = pending;
  });

  function close() { pendingMarkup.set(null); }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const text = description.trim();
    if (!pending) return;
    if (!text) { error = $t('northway.markupDescriptionRequired'); return; }
    const draft = { layer: pending.layer, description: text, color };
    const id = pending.kind === 'pin' ? addPin(draft, pending.at) : addLine(draft, pending.points);
    pendingMarkup.set(null);
    selectedRoomId.set(null);
    selectedElementIds.set(new Set());
    selectedElementId.set(id);
  }
</script>

{#if pending}
  <dialog use:modalDialog class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" aria-label={title} data-markup-dialog
    onclick={(e) => { if (e.target === e.currentTarget) close(); }} oncancel={(e) => { e.preventDefault(); close(); }}>
    <form class="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4" onsubmit={submit}>
      <h2 class="text-base font-semibold text-slate-900 flex items-center gap-2">
        <MarkupSwatch kind={pending.kind} layer={pending.layer} {color} />
        {title}
      </h2>
      <label class="block">
        <span class="text-xs text-gray-500">{$t('northway.markupDescription')}</span>
        <!-- svelte-ignore a11y_autofocus -->
        <textarea class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm resize-y" rows="3" maxlength={MAX_DESCRIPTION} autofocus bind:value={description}
          placeholder={pending.kind === 'pin'
            ? (findings ? $t('northway.findingPinExample') : $t('northway.recommendationPinExample'))
            : (findings ? $t('northway.findingLineExample') : $t('northway.recommendationLineExample'))}
          onkeydown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }}></textarea>
        <span class="block text-xs text-gray-400 mt-1">{$t('northway.markupDescriptionHelp')}</span>
      </label>
      <div>
        <span class="block text-xs text-gray-500 mb-1.5">{$t('northway.zoneColour')}</span>
        <ZoneColourPicker value={color} onchange={(value) => color = value} />
      </div>
      {#if error}<p role="alert" class="text-sm text-red-700">{error}</p>{/if}
      <div class="flex justify-end gap-2 pt-1">
        <button type="button" class="px-3 py-2 text-sm text-slate-600 hover:text-slate-900" onclick={close}>{$t('northway.cancel')}</button>
        <button type="submit" class="px-4 py-2 rounded-lg bg-[#083335] text-white text-sm font-semibold hover:bg-[#0c4447]">
          {pending.kind === 'pin' ? $t('northway.addPin') : $t('northway.addLine')}
        </button>
      </div>
    </form>
  </dialog>
{/if}
