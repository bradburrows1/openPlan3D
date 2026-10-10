<script lang="ts">
  /**
   * Northway: shows its content only to signed-in staff. Everyone else is sent to
   * /login. Data is protected by Row Level Security regardless; this gate keeps
   * the editor and library out of sight.
   */
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { authState, initAuth, signOut } from '$lib/northway/cloud/auth';

  let { children }: { children: Snippet } = $props();

  onMount(() => { void initAuth(); });
  $effect(() => {
    if ($authState.status !== 'signed-out') return;
    // An ended session (not Sign out) explains itself and brings the user back to the same plan.
    // Unsaved edits were kept on this device first (onSessionEnding) and are offered on reopening.
    const back = location.pathname.startsWith('/projects/') ? `&next=${encodeURIComponent(location.pathname)}` : '';
    void goto($authState.expired ? `/login?expired=1${back}` : '/login', { replaceState: true });
  });
</script>

{#if $authState.status === 'signed-in'}
  {@render children()}
{:else}
  <main class="min-h-screen flex items-center justify-center bg-slate-50 px-4">
    <div class="max-w-sm w-full text-center space-y-4" data-auth-gate={$authState.status}>
      {#if $authState.status !== 'loading'}<img src="/northway-logo.svg" alt="Northway Preservation" class="h-8 mx-auto" />{/if}
      {#if $authState.status === 'unconfigured'}
        <p role="alert" class="text-sm text-slate-700">Northway Plans is not connected to its database yet. Set <code>PUBLIC_SUPABASE_URL</code> and <code>PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> (see SUPABASE_SETUP.md).</p>
      {:else if $authState.status === 'not-staff'}
        <p role="alert" class="text-sm text-slate-700">{$authState.email} is not authorised for Northway Plans.</p>
        <button class="text-sm text-slate-700 underline" onclick={signOut}>Sign out</button>
      {:else if $authState.status === 'error'}
        <p role="alert" class="text-sm text-slate-700">{$authState.message}</p>
        <button class="text-sm text-slate-700 underline" onclick={() => location.reload()}>Reload</button>
      {:else}
        <p class="text-sm text-slate-500">Loading…</p>
      {/if}
    </div>
  </main>
{/if}
