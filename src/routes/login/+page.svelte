<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { authState, initAuth, signIn } from '$lib/northway/cloud/auth';

  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  // After an ended session: explain, and return to the plan that was open (only a plan URL, never an outside link).
  let expired = $state(false);
  let next = $state('/');
  onMount(() => {
    const query = new URLSearchParams(location.search);
    expired = query.get('expired') === '1';
    const target = query.get('next') ?? '';
    if (/^\/projects\/[0-9a-f-]{36}$/.test(target)) next = target;
    void initAuth();
  });
  $effect(() => { if ($authState.status === 'signed-in') void goto(next, { replaceState: true }); });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true; error = null;
    try { error = await signIn(email, password); }
    finally { busy = false; }
    if (!error) { password = ''; void goto(next, { replaceState: true }); }
  }
</script>

<svelte:head><title>Sign in · Northway Plans</title></svelte:head>

<main class="min-h-screen flex items-center justify-center bg-slate-50 px-4" data-northway-touch>
  <div class="w-full max-w-sm">
    <div class="bg-white border border-slate-200 rounded-xl shadow-sm px-8 py-9">
      <img src="/northway-logo.svg" alt="Northway Preservation" class="h-9 mb-8" />
      <h1 class="text-xl font-semibold text-slate-900">Northway Plans</h1>
      <p class="text-sm text-slate-500 mt-1 mb-6">Floor plans for Northway Preservation</p>
      {#if expired}
        <p role="status" class="mb-4 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-session-expired>
          Your session has ended. Sign in again to continue. Any unsaved changes were kept on this device and will be offered when the plan reopens.
        </p>
      {/if}
      {#if $authState.status === 'unconfigured'}
        <p role="alert" class="text-sm text-red-700">Sign-in is not configured yet. Set the Supabase environment variables (see SUPABASE_SETUP.md).</p>
      {:else}
        <form class="space-y-4" onsubmit={submit}>
          <label class="block">
            <span class="text-sm font-medium text-slate-700">Email</span>
            <input type="email" autocomplete="username" required bind:value={email}
              class="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1f8e78]/40 focus:border-[#1f8e78]" />
          </label>
          <label class="block">
            <span class="text-sm font-medium text-slate-700">Password</span>
            <input type="password" autocomplete="current-password" required bind:value={password}
              class="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1f8e78]/40 focus:border-[#1f8e78]" />
          </label>
          {#if error}<p role="alert" class="text-sm text-red-700">{error}</p>{/if}
          <button type="submit" disabled={busy}
            class="w-full py-2.5 rounded-lg bg-[#083335] text-white text-sm font-semibold hover:bg-[#0c4447] disabled:opacity-60 transition-colors">
            {busy ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      {/if}
    </div>
    <p class="text-xs text-slate-400 text-center mt-6">Internal tool for Northway Preservation staff. Accounts are created by an administrator.</p>
  </div>
</main>
