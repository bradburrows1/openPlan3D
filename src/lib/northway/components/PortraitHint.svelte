<script lang="ts">
  /** A discreet suggestion to rotate an iPad to landscape for editing. Portrait still works; dismissible. */
  import { onMount } from 'svelte';
  let show = $state(false);
  let dismissed = false;
  function check() {
    const touch = matchMedia('(pointer: coarse)').matches;
    show = !dismissed && touch && innerHeight > innerWidth && innerWidth < 1100;
  }
  onMount(() => {
    try { dismissed = sessionStorage.getItem('northway-portrait-hint') === 'dismissed'; } catch { /* storage may be blocked */ }
    check();
    addEventListener('resize', check);
    return () => removeEventListener('resize', check);
  });
  function dismiss() {
    dismissed = true; show = false;
    try { sessionStorage.setItem('northway-portrait-hint', 'dismissed'); } catch { /* fine */ }
  }
</script>

{#if show}
  <div role="status" data-portrait-hint class="fixed bottom-16 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-full bg-slate-800/90 text-white text-sm pl-4 pr-1 py-1 shadow-lg">
    <span>For the best editing experience, rotate your iPad to landscape.</span>
    <button class="rounded-full min-w-11 min-h-11 hover:bg-white/10" onclick={dismiss} aria-label="Dismiss">✕</button>
  </div>
{/if}
