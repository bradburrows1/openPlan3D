<script lang="ts">
  /** Small Northway Priority tag: 3, 2, 1, FI, or ? while a priority is still required. */
  import { priorityStyle, type NorthwayPriority } from '../priorities';
  import { rgba } from '../zonePresets';
  let { priority, size = 'sm' }: { priority: NorthwayPriority; size?: 'sm' | 'md' } = $props();
  let style = $derived(priorityStyle(priority));
</script>

<span class="inline-flex items-center justify-center shrink-0 rounded font-bold leading-none {size === 'md' ? 'min-w-7 h-6 px-1.5 text-xs' : 'min-w-6 h-5 px-1 text-[11px]'}"
  style="background: {rgba(style.color, 0.28)}; color: {style.ink}; box-shadow: inset 0 0 0 1px {rgba(style.ink, 0.7)}"
  title={style.label} data-priority-badge={priority}>{style.badge}</span>
