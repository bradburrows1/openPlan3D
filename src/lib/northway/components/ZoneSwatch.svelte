<script lang="ts">
  /** Small preview of how a zone is drawn: a tinted box for findings, a hatched dashed box for recommendations. */
  import type { OverlayLayer } from '$lib/models/types';
  import { LAYER_STYLES, rgba } from '../zonePresets';

  let { layer, color, width = 24, height = 16 }: { layer: OverlayLayer; color: string; width?: number; height?: number } = $props();
  const id = $props.id();
  let style = $derived(LAYER_STYLES[layer]);
</script>

<svg {width} {height} viewBox="0 0 {width} {height}" class="shrink-0" aria-hidden="true">
  {#if style.hatch}
    <defs>
      <pattern id="hatch-{id}" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="5" stroke={rgba(color, style.hatch.opacity + 0.15)} stroke-width="1" />
      </pattern>
    </defs>
  {/if}
  <rect x="1" y="1" width={width - 2} height={height - 2} fill={rgba(color, style.fillOpacity)} />
  {#if style.hatch}<rect x="1" y="1" width={width - 2} height={height - 2} fill="url(#hatch-{id})" />{/if}
  <rect x="1" y="1" width={width - 2} height={height - 2} fill="none" stroke={rgba(color, style.borderOpacity)} stroke-width="1.5" stroke-dasharray={style.dash.length ? '3 2' : undefined} />
</svg>
