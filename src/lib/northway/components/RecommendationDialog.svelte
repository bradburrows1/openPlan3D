<script lang="ts">
  /**
   * New recommendation: choose the Northway Priority, write the recommendation, then draw or place it.
   * A work type is optional and only offers starting text; it never sets the colour or priority.
   */
  import { modalDialog } from '$lib/utils/modalDialog';
  import { presetsFor } from '../zonePresets';
  import type { NorthwayPriority } from '../priorities';
  import PrioritySelector from './PrioritySelector.svelte';

  let { kind, onclose, onsubmit }: {
    kind: 'area' | 'pin' | 'line';
    onclose: () => void;
    onsubmit: (draft: { priority: NorthwayPriority; text: string; workType: string | null }) => void;
  } = $props();

  let priority = $state<NorthwayPriority | null>(null);
  let text = $state('');
  let workType = $state('');
  let suggested = '';
  let error = $state<string | null>(null);
  const action = $derived({ area: 'Draw Area', pin: 'Place Pin', line: 'Draw Line' }[kind]);
  const title = $derived({ area: 'New recommended area', pin: 'New recommendation pin', line: 'New recommendation line' }[kind]);

  /** "Timber Repair / Replacement" → "Timber repair / replacement" as starting text, unless the surveyor already wrote something. */
  function chooseWorkType(code: string) {
    workType = code;
    const preset = presetsFor('recommended-works').find(p => p.code === code);
    if (preset && (!text.trim() || text === suggested)) {
      suggested = preset.name.charAt(0) + preset.name.slice(1).toLowerCase();
      text = suggested;
    }
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!priority) { error = 'Choose a Northway Priority.'; return; }
    if (!text.trim()) { error = 'Write the recommendation.'; return; }
    onsubmit({ priority, text: text.trim(), workType: workType || null });
  }
</script>

<dialog use:modalDialog class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" aria-label={title} data-recommendation-dialog
  onclick={(e) => { if (e.target === e.currentTarget) onclose(); }} oncancel={(e) => { e.preventDefault(); onclose(); }}>
  <form class="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4" onsubmit={submit}>
    <h2 class="text-base font-semibold text-slate-900">{title}</h2>
    <PrioritySelector value={priority} onchange={(value) => { priority = value; error = null; }} />
    <label class="block">
      <span class="text-xs text-gray-500">Recommendation</span>
      <textarea class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm resize-y" rows="3" maxlength="500" bind:value={text}
        placeholder="e.g. Replace decayed floor joists and affected floorboards to rear reception room"
        onkeydown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }}></textarea>
    </label>
    <label class="block">
      <span class="text-xs text-gray-500">Work type <span class="text-gray-400">(optional)</span></span>
      <select class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" value={workType} onchange={(e) => chooseWorkType((e.target as HTMLSelectElement).value)}>
        <option value="">None</option>
        {#each presetsFor('recommended-works') as preset (preset.code)}<option value={preset.code}>{preset.name}</option>{/each}
      </select>
    </label>
    {#if error}<p role="alert" class="text-sm text-red-700">{error}</p>{/if}
    <div class="flex justify-end gap-2 pt-1">
      <button type="button" class="px-3 py-2 text-sm text-slate-600 hover:text-slate-900" onclick={onclose}>Cancel</button>
      <button type="submit" class="px-4 py-2 rounded-lg bg-[#083335] text-white text-sm font-semibold hover:bg-[#0c4447]">{action}</button>
    </div>
  </form>
</dialog>
