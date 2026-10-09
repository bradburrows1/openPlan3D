# Northway customisation plan: survey overlays and branded exports

Status: **Stage 2 implemented the Survey Findings layer** (see "Stage 2: what was built" at the end).
Recommended Works, legends and branded exports are still plans. This note builds on the code map in
[`NORTHWAY_ARCHITECTURE.md`](NORTHWAY_ARCHITECTURE.md).

Goal for later stages:

* draggable and resizable rectangular zones, plus freeform polygon zones;
* semi-transparent fills;
* two independent layers, **Survey Findings** (high moisture, woodworm, timber decay, …) and
  **Recommended Works** (DPC injection, timber treatment, replastering, …);
* preset classifications;
* an automatic legend;
* branded PNG and PDF exports.

## 1. Where overlay objects live

Add a small, self-contained module set rather than spreading code through upstream files:

```
src/lib/northway/
  surveyTypes.ts        // SurveyZone, SurveyLayer, ZoneClassification types
  surveyPresets.ts      // preset classifications: id, label, layer, colour, pattern
  surveyStore.ts        // add/update/remove/move zone functions, built on project.ts mutate()
  surveyRenderer.ts     // drawSurveyZones(cs, floor, …) and drawLegend(ctx, …), pure functions
  surveyHitTest.ts      // findZoneAt, findZoneHandleAt
  SurveyPanel.svelte    // layer toggles, preset picker, zone properties
```

Upstream files then need only small, clearly marked hooks (`// Northway:` comments):
`FloorPlanCanvas.svelte` (draw call, tool branch, hit test), `BuildPanel.svelte` (tool buttons),
`export.ts` and `scaledPrint.ts` (draw zones and the legend), `projectValidation.ts` (validate the new
field), and `types.ts` (one optional field on `Floor`).

## 2. Stored project data

Zones belong to a floor, so they share its coordinates (centimetres) and are saved, undone, versioned
and exported with it:

```ts
// types.ts
export interface Floor { /* … */ surveyZones?: SurveyZone[] }

// northway/surveyTypes.ts
export type SurveyLayer = 'findings' | 'works';
export interface SurveyZone {
  id: string;
  layer: SurveyLayer;
  classification: string;          // preset id, e.g. 'high-moisture', 'woodworm', 'dpc-injection'
  shape: 'rect' | 'polygon';
  points: Point[];                 // rect: 4 corners (supports rotation); polygon: n ≥ 3, world cm
  label?: string;                  // optional override shown on the plan
  note?: string;                   // free text for the report
  colorOverride?: string;          // rarely used; presets normally decide colour
  opacity?: number;                // default from preset (≈0.35)
  locked?: boolean;
}
```

* Make the field **optional** and default it to `[]`. Old files, upstream files and RoomPlan imports
  then load unchanged, and Northway files still open in upstream OpenPlan3D, which ignores the unknown
  field.
* Store a preset **id**, not a colour, so a later palette or branding change re-styles existing plans.
  Keep the presets in code and version them, never in project files.
* `projectValidation.ts → readProject()` currently passes unknown keys through unchecked. Add an
  explicit `elements('surveyZones', …)` validator so a corrupt file cannot crash the renderer.
* Project packages: check that `projectPackageBridge.ts → webToNative` and `nativeToWeb` carry
  `surveyZones` through an iPhone round trip. Add a test, because this is the most likely place for data
  to be silently dropped.
* Settings that are not project data, such as which layers are visible, go in `projectSettings`
  (localStorage), the same way `planStyle` does.

## 3. Zoom, pan and selection

* **Rendering**: call `drawSurveyZones(getCS(), floor, …)` from `FloorPlanCanvas.draw()` **after rooms
  and before walls**. The tint then sits on the floor, and walls, doors, windows and labels stay crisp
  on top. Convert each point with `worldToScreen(cs, …)`, exactly as `drawRooms` does, so zoom and pan
  need no extra code. Keep stroke widths in screen pixels (for example `Math.max(1, 1.5 * zoom)`).
* **Tools**: add `'zone-rect'` and `'zone-poly'` to the `Tool` union in `stores/project.ts`. Rectangle
  is press, drag, release. Polygon is click per vertex and double-click or click the first point to
  close, the same interaction as the wall tool (`wallStart` and `wallSequenceFirst`). Reuse
  `snap`, `magneticSnap` and `angleSnap` from `canvasInteraction.ts` so zones snap to the grid and to
  wall endpoints.
* **Selection**: reuse the existing `selectedElementId` and `selectedElementIds` stores (zone ids are
  unique `uid()`s). Test zones **after** furniture, openings and walls, but **before** rooms.
  Otherwise a zone covering a whole room would stop users selecting walls inside it.
* **Editing**: corner and vertex handles reuse the `findHandleAt` pattern. Moves use
  `beginDrag()` + a non-snapshotting move + one commit, exactly like `moveFurniture`, so a drag becomes
  one undo step. Delete, duplicate, copy and paste and the context menu follow the furniture handlers.
* **Layers**: add "Survey Findings" and "Recommended Works" to `layerVis` and the `LayersPanel`. A
  hidden layer is neither drawn nor hit-tested. Locked zones can be selected but not dragged, like
  `FurnitureItem.locked`.
* **Properties**: `SurveyPanel.svelte`, shown when the selection is a zone, has the classification
  picker filtered by layer, label, note and opacity. Put it in `PropertiesPanel.svelte` behind a single
  `{#if selectedZone}` branch.

## 4. Image and PDF exports

* Draw zones with the **same `surveyRenderer.ts` functions** everywhere: on screen, in `exportAsPNG`,
  in `renderPDF`, and in `scaledPrint.renderPrintPage`. All of these use a `CanvasState`-style
  transform or can build one. SVG needs a small string emitter alongside, in the same module, so the
  two cannot drift apart.
* Extend the bounds helpers (`extendBoundsFor*` in `export.ts`, `planContentBounds.ts`,
  `printLayout.printBounds`) and `planExportContent.hasPlanExportContent` to include zones.
* **Legend**: `drawLegend(ctx, zonesInUse, layout)` lists only classifications used on the exported
  floor, grouped by layer, with a swatch and label. On PNG, place it in a reserved strip on the right or
  bottom. On PDF, place it next to the title block.
* **Branding**: replace the hard-coded title, border and colours in `renderPDF` and `exportAsPNG` with an
  `ExportTheme` object (logo data URL, company name and colours, footer text) kept in
  `src/lib/northway/exportTheme.ts`. Plan geometry and branding then stay separate.
* For Word reports, prefer a **PNG at a fixed physical width** (for example 16 cm at 300 dpi) with a
  white background. Offer "Findings only", "Works only" and "Both" export variants by reusing the layer
  visibility flags.
* Optionally, a room-schedule-style page in `renderPDF` can list each zone's classification, room and
  note.

## 5. Not breaking upstream OpenPlan3D

* Keep upstream code paths intact and **add** rather than replace. Every Northway behaviour switch goes
  through one setting or module (`planStyle.ts` now, `src/lib/northway/*` later).
* Every new project field is optional, and no existing field changes meaning. Do not rewrite
  `floorTexture` or `color` on import.
* Wrap hooks in upstream files in short `// Northway:` comments so merges from upstream are easy to
  resolve. Keep a `upstream` remote and merge, not rebase, periodically:
  `git remote add upstream https://github.com/theLodgeBots/open3dFloorplan.git`.
* Keep the existing test suites green (`npm test`, `npm run check`, Playwright). Add unit tests next to
  each new module and one browser spec for draw, move, undo and export.
* Do not fork the large components (`FloorPlanCanvas.svelte`, `export.ts`) into copies. Call into new
  modules from small hooks instead.

## 6. Existing patterns to reuse

| Need | Reuse |
|---|---|
| Undoable edits | `mutate(fn, description)`, `beginUndoGroup`/`endUndoGroup`, `beginDrag` (`stores/project.ts`) |
| World and screen transforms | `worldToScreen` and `screenToWorld`, `CanvasState` (`utils/canvasInteraction.ts`) |
| Polygon fill with holes and clipping | `traceRoomRings` (`utils/roomNesting.ts`), `drawRooms` structure |
| Point-in-polygon and handles | `pointInPolygon` and `findHandleAt` (`utils/hitTesting.ts`) |
| Click-to-place polyline tool | wall tool (`wallStart`, `wallSequenceFirst` in `FloorPlanCanvas.svelte`) |
| Draggable and resizable box | entourage items (`moveEntourage`, `resizeEntourage`) and furniture resize handles (`resizeFurnitureFromHandle`) |
| Layer visibility | `layerVis` in `FloorPlanCanvas.svelte` plus `LayersPanel.svelte` |
| Notes and photos per item | `ItemDetails` and `ItemDetailsPanel.svelte` (could be extended with a `'zones'` `DetailKind`) |
| Persisted UI preference | `projectSettings` (`stores/settings.ts`), as `planStyle` does |
| Export bounds and content checks | `extendBoundsFor*` (`export.ts`), `planContentBounds.ts`, `planExportContent.ts` |
| i18n strings | `src/lib/i18n/locales/en.ts` (keep `pt.ts` keys in parity; a test enforces this) |

## Stage 2: what was built

Stage 2 followed this plan with a few deliberate simplifications:

* **Survey object library** (`src/lib/northway/fixtures.ts`). `ProjectSettings.objectLibrary` defaults
  to `'survey'`. Only fixed fixtures are drawn, hit-tested, listed and exported:
  * kitchen units, sinks, hobs and fitted appliances;
  * sanitaryware;
  * fireplaces, stairs and garage doors;
  * plumbing and electrical symbols.

  RoomPlan `storage` counts as a fitted unit only when it is no taller than 110 cm and within 30 cm
  of a sink, worktop or fitted appliance, or of another fitted unit. Movable furniture stays in the
  project data. Settings → Dimensions → Full object library brings the upstream library and furniture
  back. Exporters see the survey view through `src/lib/northway/planView.ts → surveyPlanView()`.
* **Model.** `Floor.surveyFindings?: SurveyFindingZone[]` with `{ id, layer: 'survey-findings', code,
  shape: 'rect', x, y, width, height, note? }`. `x`/`y` is the top-left corner in world cm. The
  rectangle is axis-aligned; rotation and polygons are not implemented yet. Unknown codes are kept and
  drawn in grey.
* **Presets** (`surveyPresets.ts`): HM, WM, DR, WR, MG, CD, PD, RD, TD and SV. Fill 25%, border
  80%, 1.75 px.
* **Store** (`surveyStore.ts`) uses `mutateActiveFloor()`. That and `newElementId()` are the only new
  exports in `stores/project.ts`. `removeElement()` also deletes zones, so the Delete key works.
* **Rendering** (`surveyRenderer.ts`) is shared by the canvas, PNG, PDF and scaled print. SVG has a
  matching string emitter in `export.ts`. Order: areas after room fills, codes after walls and
  openings, selection and handles last.
* **Interaction** (`FloorPlanCanvas.svelte`, marked `// Northway:`):
  * Areas are hit-tested after walls, openings and fixtures but before rooms and room labels.
  * Moves and resizes follow screen deltas, so the properties panel opening mid-gesture cannot shift
    an area.
  * Areas are not part of wall snapping, select-all or marquee selection.
* **UI**: Build tab → Survey Findings (Add Issue Area, presets, Show/Hide); the Issue area properties
  panel (type, width, depth, duplicate, delete); the Objects tab's Fixed Fixtures group.
* **Layer visibility** is `ProjectSettings.showSurveyFindings` (per browser). Exports follow it.

Not done in Stage 2, and next in line:

* Recommended Works as a second layer: add `layer: 'recommended-works'` and its own presets, and
  reuse every module above.
* Legend and branded exports, polygon zones, rotation, per-zone notes in the UI, and DXF output.

## Stage 3: what was built

* **Sign-in.**
  * Supabase Auth, email and password only, with public sign-up disabled.
  * `src/lib/northway/cloud/auth.ts` holds the sign-in state; `AuthGate.svelte` guards the
    `src/routes/(staff)/` route group (`/`, `/projects/[id]`, `/editor`, `/local`).
  * `/login` is the only public page. Staff means signed in **and** listed in `northway_plan_staff`.
* **Storage.**
  * `floor_plan_projects`, one row per plan (migration in `supabase/migrations/`).
  * `project_data` holds the complete editable project document, the same JSON as Download JSON,
    validated with `readProject()`. It is versioned by `schema_version`, and `revision` guards
    against concurrent saves.
  * Access is through `src/lib/northway/cloud/projectsApi.ts`; the document format is in
    `projectDocument.ts`.
* **Library** (`src/routes/(staff)/+page.svelte`).
  * New Plan (Blank or Import), search, rename, duplicate and delete with confirmation.
  * Imports go through `importPlan.ts`: RoomPlan JSON or zip, OpenPlan3D JSON, project packages.
* **Editor.**
  * `/projects/[id]` hosts the shared `EditorWorkspace.svelte`, with `TopBar` in `cloud` mode: Back to
    Plans, project name, Saved / Unsaved changes, and Save (also Ctrl+S).
  * `session.ts` decides "unsaved" by comparing the plan with the last saved document, saves with
    the revision check, and offers Replace / Save as new plan on a conflict.
  * Unsaved edits are mirrored to a per-browser recovery copy (`recovery.ts`), which is offered back
    after a crash or failed save.
  * Local autosave and version history are off for cloud plans.
* **Upstream local mode** is kept, behind sign-in, at `/editor` and `/local`. It is unlinked from
  the Northway UI, and the upstream browser suite keeps running against it.
* **Testing.** `tooling/northway-supabase/` runs a real Supabase Auth + PostgREST + PostgreSQL stack
  locally for the RLS integration tests and the browser suite.
