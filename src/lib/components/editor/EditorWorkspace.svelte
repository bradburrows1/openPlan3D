<script lang="ts">
  /**
   * The editor shell shared by the local editor (/editor) and Northway Plans
   * (/projects/[id]): toolbar, panels, canvas, 3D viewer and overlays. Loading and
   * saving belong to the page that hosts it.
   */
  import { t } from '$lib/i18n';
  import { modalDialog, hasOpenModal } from '$lib/utils/modalDialog';
  import { onDestroy } from 'svelte';
  import { reportLoadingFailure } from '$lib/services/deployment';
  import { viewMode, selectedElementId, selectedRoomId, selectedTool, placingFurnitureId, elevationWallId, elevationPickMode } from '$lib/stores/project';
  import TopBar from '$lib/components/toolbar/TopBar.svelte';
  import BuildPanel from '$lib/components/sidebar/BuildPanel.svelte';
  import PropertiesPanel from '$lib/components/sidebar/PropertiesPanel.svelte';
  import LayersPanel from '$lib/components/sidebar/LayersPanel.svelte';
  import FloorPlanCanvas from '$lib/components/editor/FloorPlanCanvas.svelte';
  import MarkupDialog from '$lib/northway/components/MarkupDialog.svelte';
  import AlignmentToolbar from '$lib/components/editor/AlignmentToolbar.svelte';
  import UndoHistoryPanel from '$lib/components/editor/UndoHistoryPanel.svelte';
  import CommandPalette from '$lib/components/editor/CommandPalette.svelte';
  import ElevationView from '$lib/components/editor/ElevationView.svelte';
  import PrintLayout from '$lib/components/editor/PrintLayout.svelte';
  import OnboardingTooltip from '$lib/components/OnboardingTooltip.svelte';
  import { triggerTip } from '$lib/stores/onboarding.svelte';

  /** Northway Plans: save to the project library instead of this browser. */
  let { cloud = false }: { cloud?: boolean } = $props();

  let showLayers = $state(false);
  let commandPaletteOpen = $state(false);
  let printOpen = $state(false);

  // Lazy-load ThreeViewer to avoid loading Three.js (~1.4MB) until 3D mode is activated
  let ThreeViewer: any = $state(null);
  $effect(() => {
    if (mode === '3d' && !ThreeViewer) {
      import('$lib/components/viewer3d/ThreeViewer.svelte').then(m => { ThreeViewer = m.default; }).catch(() => {
        viewMode.set('2d');
        reportLoadingFailure();
      });
    }
  });

  let mode = $state<'2d' | '3d'>('2d');
  let showHelp = $state(false);
  let shortcutCopyState = $state<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  let shortcutCopyGeneration = 0;
  $effect(() => {
    showHelp;
    shortcutCopyGeneration++;
    shortcutCopyState = 'idle';
  });
  let showUndoHistory = $state(false);
  let historyTrigger: HTMLButtonElement | undefined = $state();
  function toggleHistory(trigger: HTMLButtonElement) {
    historyTrigger = trigger;
    showUndoHistory = !showUndoHistory;
  }

  // Mobile (< md): BuildPanel becomes an off-canvas drawer toggled by the Tools FAB.
  let buildPanelOpen = $state(false);
  // Close the drawer once the user has picked a tool / item so the canvas is usable
  onDestroy(selectedTool.subscribe(() => { if (buildPanelOpen) buildPanelOpen = false; }));
  onDestroy(placingFurnitureId.subscribe((id) => { if (id && buildPanelOpen) buildPanelOpen = false; }));

  onDestroy(viewMode.subscribe((m) => {
    mode = m;
    if (m === '3d') {
      // Clear selection when entering 3D — start in view-only mode
      selectedElementId.set(null);
      selectedRoomId.set(null);
      elevationPickMode.set(false);
      // Onboarding tip for first 3D view
      triggerTip('first-3d', 200, 80);
    }
  }));

  function onEditorKeydown(e: KeyboardEvent) {
    if (hasOpenModal()) return;
    const target = e.target as HTMLElement | null;
    const typing = !!target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'p' && mod) { e.preventDefault(); printOpen = true; }
    if ((e.key === 'k' && mod) || (e.key === '/' && !mod && !e.altKey && !typing)) {
      e.preventDefault(); commandPaletteOpen = !commandPaletteOpen;
    }
    if (e.key === '?' && !mod && !e.altKey && !typing) { showHelp = !showHelp; e.preventDefault(); }
    if (e.key === 'Escape' && showHelp) showHelp = false;
    if (e.key === 'l' && !mod && !e.altKey && !typing) showLayers = !showLayers;
  }
</script>

<svelte:window on:keydown={onEditorKeydown} />

  <div class="h-screen flex flex-col overflow-hidden">
    <TopBar {cloud} onToggleLayers={() => showLayers = !showLayers} layersOpen={showLayers} onToggleHistory={toggleHistory} historyOpen={showUndoHistory} />
    <!-- Keep canvas/viewer controls beneath toolbar menus and project dialogs. -->
    <div class="flex flex-1 overflow-hidden isolate">
      {#if mode === '2d'}
        <!-- Build panel: inline sidebar on md+, off-canvas drawer on phones -->
        {#if buildPanelOpen}
          <div
            class="md:hidden fixed inset-x-0 top-12 bottom-0 bg-black/40 z-40"
            onclick={() => buildPanelOpen = false}
            aria-hidden="true"
          ></div>
        {/if}
        <div class="h-full max-md:fixed max-md:left-0 max-md:top-12 max-md:bottom-0 max-md:h-auto max-md:z-50 max-md:shadow-2xl max-md:transition-transform max-md:duration-200 {buildPanelOpen ? '' : 'max-md:-translate-x-full'}">
          <BuildPanel />
        </div>
      {/if}
      <div class="flex-1 min-w-0 relative">
        {#if mode === '2d'}
          <FloorPlanCanvas />
          <MarkupDialog />
          <AlignmentToolbar />
          {#if $elevationWallId}
            <!-- Integrated elevation view replaces the plan canvas area (sidebars stay) -->
            <ElevationView />
          {/if}
        {:else}
          {#if ThreeViewer}
            <ThreeViewer />
          {:else}
            <div class="flex items-center justify-center h-full text-slate-400">{$t('shortcuts.loading3d')}</div>
          {/if}
        {/if}
      </div>
      {#if showLayers && mode === '2d'}
        <LayersPanel />
      {/if}
      <PropertiesPanel is3D={mode === '3d'} />
    </div>
  </div>

  <!-- Tools drawer FAB (mobile only) -->
  {#if mode === '2d'}
    <button
      class="md:hidden fixed bottom-4 left-4 w-12 h-12 rounded-full bg-blue-600 text-white shadow-lg active:bg-blue-700 transition-colors z-40 flex items-center justify-center"
      onclick={() => buildPanelOpen = !buildPanelOpen}
      title={$t('buildTools.tools')}
      aria-label={$t('editorPanels.tools')}
      aria-expanded={buildPanelOpen}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
    </button>
  {/if}

  <!-- Layers toggle button -->
  {#if mode === '2d'}
    <button
      class="max-md:hidden fixed bottom-4 left-14 w-8 h-8 rounded-full shadow-lg hover:bg-slate-600 transition-colors z-50 text-sm"
      class:bg-blue-600={showLayers}
      class:text-white={showLayers}
      class:bg-slate-700={!showLayers}
      class:text-gray-300={!showLayers}
      onclick={() => showLayers = !showLayers}
      title={$t('editorPanels.layersTitle')}
      aria-label={$t('editorPanels.layers')}
      aria-expanded={showLayers}
    >🗂</button>
  {/if}

  <!-- Undo History toggle button -->
  <button
    class="max-md:hidden fixed bottom-4 left-24 w-8 h-8 rounded-full shadow-lg hover:bg-slate-600 transition-colors z-50 text-sm"
    class:bg-blue-600={showUndoHistory}
    class:text-white={showUndoHistory}
    class:bg-slate-700={!showUndoHistory}
    class:text-gray-300={!showUndoHistory}
    onclick={(event) => toggleHistory(event.currentTarget)}
    title={$t('undoHistory.title')}
    aria-label={$t('editorPanels.history')}
      aria-expanded={showUndoHistory}
  >⟲</button>

  <UndoHistoryPanel bind:visible={showUndoHistory} returnFocusTo={historyTrigger} />

  <!-- Help button (desktop only — keyboard shortcuts are meaningless on touch) -->
  <button
    class="max-md:hidden fixed bottom-4 left-4 w-8 h-8 rounded-full bg-slate-700 text-white text-sm font-bold shadow-lg hover:bg-slate-600 transition-colors z-50"
    onclick={() => showHelp = !showHelp}
    title={`${$t('shortcuts.title')} (?)`}
    aria-label={$t('shortcuts.title')}
  >?</button>

  <!-- Shortcuts overlay -->
  {#if showHelp}
    <dialog use:modalDialog class="modal-overlay fixed inset-0 bg-black/50 flex items-center justify-center z-50" onclick={(e) => { if (e.target === e.currentTarget) showHelp = false; }} oncancel={(e) => { e.preventDefault(); showHelp = false; }} onkeydown={(e) => { if (e.key === '?') { e.preventDefault(); showHelp = false; } }} aria-label={$t('shortcuts.title')}>
      <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[85vh] flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
          <div class="flex items-center gap-2">
            <svg class="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707"/></svg>
            <h2 class="text-lg font-bold text-slate-800">{$t('shortcuts.title')}</h2>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="text-xs px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800 transition-colors flex items-center gap-1.5"
              disabled={shortcutCopyState === 'copying'}
              onclick={async () => {
                const generation = ++shortcutCopyGeneration;
                shortcutCopyState = 'copying';
                const text = [
                  $t('shortcuts.title') + ' — Open3D Floorplan',
                  '',
                  '── ' + $t('shortcuts.tools') + ' ──',
                  "V          " + $t('shortcuts.select'),
                  "W          " + $t('shortcuts.wall'),
                  "D          " + $t('shortcuts.door'),
                  "H          " + $t('shortcuts.pan'),
                  "M          " + $t('shortcuts.measure'),
                  "N          " + $t('shortcuts.annotate'),
                  "T          " + $t('shortcuts.text'),
                  "S          " + $t('shortcuts.snap'),
                  '',
                  '── ' + $t('shortcuts.edit') + ' ──',
                  "Ctrl+Z     " + $t('shortcuts.undo'),
                  "Ctrl+Y     " + $t('shortcuts.redo'),
                  "Ctrl+C     " + $t('shortcuts.copy'),
                  "Ctrl+V     " + $t('shortcuts.paste'),
                  "Ctrl+A     " + $t('shortcuts.selectAll'),
                  "Ctrl+D     " + $t('shortcuts.deselectAll'),
                  "Ctrl+S     " + $t('shortcuts.save'),
                  "Esc        " + $t('shortcuts.cancel'),
                  '',
                  '── ' + $t('shortcuts.elements') + ' ──',
                  "R          " + $t('shortcuts.rotate'),
                  "Del/Back   " + $t('shortcuts.delete'),
                  "Ctrl+L     " + $t('shortcuts.lock'),
                  "Ctrl+G     " + $t('shortcuts.group'),
                  "Ctrl+\u21e7+G   " + $t('shortcuts.ungroup'),
                  '',
                  '── ' + $t('shortcuts.view') + ' ──',
                  "Tab        " + $t('shortcuts.mode'),
                  "F          " + $t('shortcuts.fit'),
                  "G          " + $t('shortcuts.grid'),
                  "L          " + $t('shortcuts.layers'),
                  "?          " + $t('shortcuts.show'),
                  '',
                  '── ' + $t('shortcuts.canvas') + ' ──',
                  $t('shortcuts.scroll') + ' ' + $t('shortcuts.zoom'),
                  "+/-        " + $t('shortcuts.zoom'),
                  $t('shortcuts.spaceDrag') + ' ' + $t('shortcuts.panCanvas'),
                  '',
                  '── ' + $t('shortcuts.walls') + ' ──',
                  $t('shortcuts.doubleClick') + ' ' + $t('shortcuts.finishWall'),
                  "C          " + $t('shortcuts.closeWall'),
                ].join('\n');
                try {
                  await navigator.clipboard.writeText(text);
                  if (generation === shortcutCopyGeneration) shortcutCopyState = 'copied';
                } catch {
                  if (generation === shortcutCopyGeneration) shortcutCopyState = 'failed';
                }
              }}
              aria-label={$t('shortcuts.copyLabel')}
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
              {$t('shortcuts.copyAll')}
            </button>
            <button class="text-gray-400 hover:text-gray-600 text-xl leading-none" onclick={() => showHelp = false} aria-label={$t('shortcuts.close')}>✕</button>
          </div>
        </div>

        <!-- Body -->
        <div class="overflow-y-auto px-6 py-4">
          <div class="grid grid-cols-2 gap-x-8 gap-y-0 text-sm">
            <!-- Left column -->
            <div>
              <!-- Tools -->
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-bold uppercase tracking-wider text-indigo-500">{$t('shortcuts.tools')}</span>
                <div class="flex-1 h-px bg-indigo-100"></div>
              </div>
              <div class="space-y-1.5 mb-5">
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.select')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">V</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.wall')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">W</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.door')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">D</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.pan')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">H</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.measure')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">M</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.annotate')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">N</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.text')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">T</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.snap')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">S</kbd></div>
              </div>

              <!-- Edit -->
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-bold uppercase tracking-wider text-amber-500">{$t('shortcuts.edit')}</span>
                <div class="flex-1 h-px bg-amber-100"></div>
              </div>
              <div class="space-y-1.5 mb-5">
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.undo')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+Z</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.redo')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+Y</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.copy')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+C</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.paste')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+V</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.selectAll')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+A</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.deselectAll')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+D</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.save')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+S</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.cancel')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Esc</kbd></div>
              </div>
            </div>

            <!-- Right column -->
            <div>
              <!-- Elements -->
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-bold uppercase tracking-wider text-emerald-500">{$t('shortcuts.elements')}</span>
                <div class="flex-1 h-px bg-emerald-100"></div>
              </div>
              <div class="space-y-1.5 mb-5">
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.rotate')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">R</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.delete')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Del</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.lock')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+L</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.group')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+G</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.ungroup')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Ctrl+⇧+G</kbd></div>
              </div>

              <!-- View -->
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-bold uppercase tracking-wider text-blue-500">{$t('shortcuts.view')}</span>
                <div class="flex-1 h-px bg-blue-100"></div>
              </div>
              <div class="space-y-1.5 mb-5">
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.mode')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">Tab</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.fit')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">F</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.grid')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">G</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.layers')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">L</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.show')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">?</kbd></div>
              </div>

              <!-- Canvas -->
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-bold uppercase tracking-wider text-purple-500">{$t('shortcuts.canvas')}</span>
                <div class="flex-1 h-px bg-purple-100"></div>
              </div>
              <div class="space-y-1.5 mb-5">
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.zoom')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">{$t('shortcuts.scroll')}</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.zoom')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">+ / −</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.panCanvas')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">{$t('shortcuts.spaceDrag')}</kbd></div>
              </div>

              <!-- Walls -->
              <div class="flex items-center gap-2 mb-2">
                <span class="text-xs font-bold uppercase tracking-wider text-rose-500">{$t('shortcuts.walls')}</span>
                <div class="flex-1 h-px bg-rose-100"></div>
              </div>
              <div class="space-y-1.5">
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.finishWall')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">{$t('shortcuts.doubleClick')}</kbd></div>
                <div class="flex justify-between"><span class="text-gray-600">{$t('shortcuts.closeWall')}</span><kbd class="px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-slate-700 border border-gray-200">C</kbd></div>
              </div>
            </div>
          </div>
        </div>

        {#if shortcutCopyState !== 'idle'}
          <p role="status" class="px-6 py-2 text-xs text-slate-600">{$t(`shortcuts.${shortcutCopyState}`)}</p>
        {/if}

        <!-- Footer -->
        <div class="px-6 py-3 border-t border-gray-100 text-center">
          <p class="text-xs text-gray-400">{$t('shortcuts.footer')}</p>
        </div>
      </div>
    </dialog>
  {/if}

  <CommandPalette bind:open={commandPaletteOpen} />
  <PrintLayout bind:open={printOpen} />
  <OnboardingTooltip />
