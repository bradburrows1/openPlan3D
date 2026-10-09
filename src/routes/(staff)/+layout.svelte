<script lang="ts">
  // Northway: every page in this group (library, editors) is for signed-in staff only.
  import type { Snippet } from 'svelte';
  import AuthGate from '$lib/northway/components/AuthGate.svelte';
  let { children }: { children: Snippet } = $props();
</script>

<AuthGate>{@render children()}</AuthGate>
