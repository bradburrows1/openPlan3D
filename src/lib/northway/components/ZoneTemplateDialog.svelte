<script lang="ts">
  /** + Custom Finding / + Custom Recommendation: name, short code and colour, then Draw Area. */
  import type { OverlayLayer } from '$lib/models/types';
  import { t } from '$lib/i18n';
  import { modalDialog } from '$lib/utils/modalDialog';
  import { MAX_CODE_LENGTH, cleanCode, suggestCode } from '../zonePresets';
  import type { ZoneTemplate } from '../overlayStore';
  import ZoneColourPicker from './ZoneColourPicker.svelte';
  import ZoneSwatch from './ZoneSwatch.svelte';

  let { layer, initialColor, onclose, ondraw }: { layer: OverlayLayer; initialColor: string; onclose: () => void; ondraw: (template: ZoneTemplate) => void } = $props();

  let name = $state('');
  let code = $state('');
  /** Until the code is typed in, it follows the name. */
  let codeEdited = $state(false);
  // svelte-ignore state_referenced_locally
  let color = $state(initialColor);
  let error = $state<string | null>(null);
  let title = $derived(layer === 'survey-findings' ? $t('northway.customFindingTitle') : $t('northway.customRecommendationTitle'));

  function onName(value: string) {
    name = value;
    if (!codeEdited) code = suggestCode(value);
  }

  function onCode(input: HTMLInputElement) {
    codeEdited = input.value !== '';
    code = cleanCode(input.value);
    input.value = code;
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim()) { error = $t('northway.zoneNameRequired'); return; }
    if (!code) { error = $t('northway.zoneCodeRequired'); return; }
    ondraw({ layer, code, name: name.trim(), color, preset: null });
  }
</script>

<dialog use:modalDialog class="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" aria-label={title} data-zone-template-dialog
  onclick={(e) => { if (e.target === e.currentTarget) onclose(); }} oncancel={(e) => { e.preventDefault(); onclose(); }}>
  <form class="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5 space-y-4" onsubmit={submit}>
    <h2 class="text-base font-semibold text-slate-900">{title}</h2>
    <label class="block">
      <span class="text-xs text-gray-500">{$t('northway.zoneName')}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="w-full px-2 py-1.5 border border-gray-200 rounded text-sm" maxlength="80" autofocus value={name}
        oninput={(e) => onName((e.target as HTMLInputElement).value)}
        placeholder={layer === 'survey-findings' ? $t('northway.customFindingExample') : $t('northway.customRecommendationExample')} />
    </label>
    <label class="block">
      <span class="text-xs text-gray-500">{$t('northway.zoneCode')}</span>
      <input class="w-24 px-2 py-1.5 border border-gray-200 rounded text-sm font-semibold uppercase tracking-wide" value={code}
        oninput={(e) => onCode(e.target as HTMLInputElement)} autocomplete="off" spellcheck="false" />
      <span class="block text-xs text-gray-400 mt-1">{$t('northway.zoneCodeHelp', { max: MAX_CODE_LENGTH })}</span>
    </label>
    <div>
      <span class="block text-xs text-gray-500 mb-1.5">{$t('northway.zoneColour')}</span>
      <ZoneColourPicker value={color} onchange={(value) => color = value} />
    </div>
    <div class="flex items-center gap-2 text-xs text-gray-600" aria-hidden="true">
      <ZoneSwatch {layer} {color} width={36} height={22} />
      <span class="font-semibold" style="color: {color}">{code || '—'}</span>
      <span class="truncate">{name.trim()}</span>
    </div>
    {#if error}<p role="alert" class="text-sm text-red-700">{error}</p>{/if}
    <div class="flex justify-end gap-2 pt-1">
      <button type="button" class="px-3 py-2 text-sm text-slate-600 hover:text-slate-900" onclick={onclose}>{$t('northway.cancel')}</button>
      <button type="submit" class="px-4 py-2 rounded-lg bg-[#083335] text-white text-sm font-semibold hover:bg-[#0c4447]">{$t('northway.drawArea')}</button>
    </div>
  </form>
</dialog>
