<script lang="ts">
  /** The shared zone palette plus a custom colour. No opacity or stroke controls: each layer's style sets those. */
  import { t } from '$lib/i18n';
  import { ZONE_PALETTE } from '../zonePresets';

  let { value, onchange }: { value: string; onchange: (color: string) => void } = $props();
  let custom = $derived(!ZONE_PALETTE.some(colour => colour.hex.toLowerCase() === value.toLowerCase()));
</script>

<div class="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={$t('northway.zoneColour')} data-zone-palette>
  {#each ZONE_PALETTE as colour}
    {@const chosen = colour.hex.toLowerCase() === value.toLowerCase()}
    <button type="button" role="radio" aria-checked={chosen} aria-label={colour.name} title={colour.name}
      class="w-6 h-6 rounded-full border-2 transition-shadow {chosen ? 'border-slate-900 ring-2 ring-offset-1 ring-slate-300' : 'border-white shadow-[0_0_0_1px_rgba(0,0,0,0.15)]'}"
      style="background: {colour.hex}" onclick={() => onchange(colour.hex)}></button>
  {/each}
  <label class="relative w-6 h-6 rounded-full border-2 cursor-pointer overflow-hidden {custom ? 'border-slate-900 ring-2 ring-offset-1 ring-slate-300' : 'border-white shadow-[0_0_0_1px_rgba(0,0,0,0.15)]'}"
    title={$t('northway.customColour')} style="background: {custom ? value : 'conic-gradient(#b5534f, #d9823b, #a8792f, #6b8a68, #2fa3a8, #3b82c4, #5d5fb8, #9466ad, #b5534f)'}">
    <span class="sr-only">{$t('northway.customColour')}</span>
    <input type="color" class="absolute inset-0 opacity-0 cursor-pointer" {value} oninput={(e) => onchange((e.target as HTMLInputElement).value)} data-custom-colour />
  </label>
</div>
