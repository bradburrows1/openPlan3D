<script lang="ts">
  /**
   * Northway Priority control: 3 Priority · 2 Recommended · 1 Advisory · FI Further Investigation,
   * with a small (i) that shows the four definitions. Not an RICS condition rating.
   */
  import { PRIORITIES, type NorthwayPriority } from '../priorities';
  import PriorityBadge from './PriorityBadge.svelte';

  let { value, onchange }: { value: NorthwayPriority | null; onchange: (priority: NorthwayPriority) => void } = $props();
  let helpOpen = $state(false);
  const SHORT: Record<string, string> = { priority_3: 'Priority', priority_2: 'Recommended', priority_1: 'Advisory', further_investigation: 'Further Investigation' };
</script>

<div class="space-y-1.5" data-priority-selector>
  <div class="flex items-center gap-1.5">
    <span class="text-xs text-gray-500" id="northway-priority-label">Northway Priority</span>
    <button type="button" class="w-4 h-4 rounded-full border border-gray-300 text-[10px] leading-none text-gray-500 hover:bg-gray-50 hover:text-gray-700"
      aria-label="What the Northway Priorities mean" aria-expanded={helpOpen} onclick={() => helpOpen = !helpOpen}>i</button>
  </div>
  <div class="grid grid-cols-1 gap-1" role="radiogroup" aria-labelledby="northway-priority-label">
    {#each PRIORITIES as priority (priority.id)}
      {@const chosen = value === priority.id}
      <button type="button" role="radio" aria-checked={chosen} aria-label={priority.label} title={priority.definition}
        class="flex items-center gap-1.5 px-1.5 py-1.5 rounded-md border text-left text-xs transition-colors {chosen ? 'border-slate-700 bg-slate-50 text-slate-900 font-semibold' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}"
        onclick={() => onchange(priority.id)}>
        <PriorityBadge priority={priority.id} />
        <span>{SHORT[priority.id]}</span>
      </button>
    {/each}
  </div>
  {#if helpOpen}
    <dl class="rounded-md bg-slate-50 border border-slate-200 p-2 space-y-1.5 text-xs" data-priority-help>
      {#each PRIORITIES as priority (priority.id)}
        <div class="flex gap-2">
          <dt><PriorityBadge priority={priority.id} /></dt>
          <dd class="text-gray-600"><span class="font-semibold text-gray-800">{priority.name}.</span> {priority.definition}</dd>
        </div>
      {/each}
      <p class="text-[11px] text-gray-400 pt-0.5">Northway's own guide for homeowners; not an RICS condition rating.</p>
    </dl>
  {/if}
</div>
