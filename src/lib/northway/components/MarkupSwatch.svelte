<script lang="ts">
  /** Small preview of an overlay item's style: area, pin marker or line, per layer. Used in the UI legend and dialogs. */
  import type { OverlayLayer } from '$lib/models/types';
  import { MARKUP_STYLES } from '../markupRenderer';
  import { rgba } from '../zonePresets';
  import ZoneSwatch from './ZoneSwatch.svelte';

  let { kind, layer, color, width = 24, height = 16 }: { kind: 'area' | 'pin' | 'line'; layer: OverlayLayer; color: string; width?: number; height?: number } = $props();
  let style = $derived(MARKUP_STYLES[layer]);
  const hexagon = (cx: number, cy: number, r: number) => Array.from({ length: 6 }, (_, i) => {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(' ');
</script>

{#if kind === 'area'}
  <ZoneSwatch {layer} {color} {width} {height} />
{:else}
  <svg {width} {height} viewBox="0 0 {width} {height}" class="shrink-0" aria-hidden="true">
    {#if kind === 'line'}
      <line x1="2" y1={height - 3} x2={width - 2} y2="3" stroke={rgba(color, style.bandOpacity)} stroke-width="5" stroke-linecap="round" />
      <line x1="2" y1={height - 3} x2={width - 2} y2="3" stroke={rgba(color, 0.95)} stroke-width="1.5" stroke-dasharray={style.coreDash.length ? '3 2' : undefined} />
    {:else if style.marker === 'circle'}
      <circle cx={width / 2} cy={height / 2} r={height / 2 - 1.5} fill={rgba(color, 0.95)} />
    {:else}
      <polygon points={hexagon(width / 2, height / 2, height / 2 - 1.5)} fill="#fff" stroke={rgba(color, 0.95)} stroke-width="1.5" />
    {/if}
  </svg>
{/if}
