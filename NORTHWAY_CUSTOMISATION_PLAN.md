# Northway customisation plan: survey overlays and branded exports

Status: **Stages 2, 4 and 5 implemented the survey overlays, legends and branded exports** (see
"Stage 2", "Stage 4" and "Stage 5: what was built" at the end). This note builds on the code map in
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

## Stage 4: what was built

Recommended Works is a second overlay layer, separate from Survey Findings. Both layers share one
model, store, renderer and exporters, and each can be edited, shown and hidden on its own.

* **Model** (`src/lib/models/types.ts`):
  * `Floor.recommendedWorks?: RecommendedWorkZone[]` alongside `Floor.surveyFindings?: SurveyFindingZone[]`.
  * Both extend `OverlayZoneBase`: `{ id, layer, code, name?, color?, preset?, shape: 'rect', x, y,
    width, height, note? }`. `layer` is `'survey-findings'` or `'recommended-works'`.
  * `preset` is the preset code a zone started from, or `null` for a custom zone.
  * New zones copy the preset's code, name and colour, so later edits to one zone, or to the preset
    list, never change other zones.
  * Rotation is not supported (rectangles are axis-aligned).
* **Configuration** (`src/lib/northway/zonePresets.ts`). The only place presets, colours and layer
  styles are defined:
  * `ZONE_PALETTE`: 10 muted colours (blue, navy, indigo, teal, sage green, amber, orange, muted red,
    mauve, grey).
  * `SURVEY_FINDING_PRESETS`: HM, WM, DR, WR, MG, CD, PD, RD, TD and SV.
  * `RECOMMENDED_WORK_PRESETS`: WT, DPT, TR, DRT, WRT, MR, VI, PR, MT and FI.
  * Each preset is `{ layer, code, name, color, disabled? }`. An admin screen could later load the
    same shape from the database: `disabled` hides a preset from pickers while saved plans still
    recognise it.
  * `LAYER_STYLES`:
    * findings: 25% fill, solid 1.75 px border, code top-left;
    * recommendations: 7% fill, diagonal hatch, dashed 2 px border, code on a white tag top-right.
  * Helpers: `zoneAppearance()` resolves a zone's code, name and colour. `suggestCode()` and
    `cleanCode()` handle short codes (uppercase letters and digits, at most 4 in the editor, up to 8
    accepted in files).
  * `overlayTypesInUse()` lists the distinct types used on the given floors, per layer, as
    `{ code, name, color, custom }`. It is ready for the Stage 5 legend.
* **Store** (`overlayStore.ts`):
  * `placingZone` holds the armed template (preset or custom).
  * Operations: `addZone`, `updateZone` (coalesced undo), `applyZonePreset`, `setZoneRect` (drag),
    `duplicateZone`, `removeZone`, `floorZones()`.
  * `surveyStore.ts`, `surveyPresets.ts` and `surveyRenderer.ts` remain as thin Stage 2 wrappers.
* **Rendering**:
  * `overlayRenderer.ts` is shared by the canvas, the PNG and PDF exports, and scaled print.
    `overlaySvg.ts` emits the SVG equivalent, with one hatch pattern per colour.
  * Drawing order: room fills, findings, recommendations, walls and openings, codes, then selection
    and handles.
* **Overlaps**:
  * A click picks the smallest zone under the pointer. For equal areas, the recommendation (drawn on
    top) wins.
  * Pressing the zone that is already selected keeps it, so it can be dragged. A click without
    dragging moves the selection to the next zone under the pointer.
  * Hiding a layer also makes the other layer easier to reach.
* **UI**:
  * Build tab: Survey Findings (Add Issue Area, presets, **+ Custom Finding**, Show/Hide) and
    Recommended Works (Add Recommended Area, presets, **+ Custom Recommendation**, Show/Hide).
  * The custom dialog (`components/ZoneTemplateDialog.svelte`) takes a name, a code (suggested from
    the name, editable, uppercase, at most 4 characters) and a colour, then **Draw Area**.
  * The properties panel for a selected zone edits:
    * the type/preset (picking one copies its code, name and colour; "Custom" detaches it);
    * name, code and colour;
    * width and depth;
    * Duplicate and Delete.
    Editing never moves the zone.
* **Visibility**: `ProjectSettings.showSurveyFindings` and `showRecommendedWorks` (per browser).
  Exports follow both through `surveyPlanView()`.
* **Persistence**:
  * Both layers are part of `project_data`, so save, reopen, recovery and duplicate carry them
    unchanged.
  * `schema_version` stays 1: the new fields are optional. `readProject()` fills older zones' name,
    colour and preset from their preset code on load.

Not done in Stage 4: rotation, polygons and admin preset editing. Legends and exports followed in Stage 5.

## Stage 5: what was built

### Free-text pins and lines

* **Model** (`src/lib/models/types.ts`):
  * `Floor.overlayPins?: OverlayPin[]`: `{ id, layer, ref, description, color, x, y }`.
  * `Floor.overlayLines?: OverlayLine[]`: `{ id, layer, ref, description, color, points[] }`, with two
    or more points (polylines).
  * Each item has its own `layer` (`survey-findings` or `recommended-works`). They follow the same
    Show/Hide toggles as the areas.
* **UI**: each layer group in the Build tab has **+ Area**, **+ Pin** and **+ Line** (accessible names
  "Add Finding Pin", "Add Recommendation Line", …).
  * Pin: click the plan, then `MarkupDialog.svelte` asks for a description (required, up to 500
    characters) and a colour.
  * Line: click each point. Double-click, Enter or **Finish** completes it, Backspace removes the last
    point and Escape cancels. The same dialog then asks for a description and colour.
  * Properties panel: edit the description and colour, duplicate or delete. The reference is shown
    as a badge and cannot be edited.
  * Line geometry: drag a point to reshape the line, or the band to move it. Double-click the line
    to add a point, or a point to remove it ("Remove last point" also works).
* **Store** (`overlayStore.ts`): `addPin`, `addLine`, `updateMarkup`, `setPinPosition`,
  `setLinePoints`, `insertLinePoint`, `removeLinePoint`, `removeMarkup`, `duplicateMarkup`,
  `placingMarkup`, `pendingMarkup`, `lineDraft` and `finishLineDraft`.
* **Rendering** (`markupRenderer.ts`), shared by the canvas, every export and print:
  * findings: a filled **circle** marker, and a solid band with a solid core line;
  * recommendations: a white **hexagon** marker with a coloured outline, and a lighter band with a
    **dashed** core line;
  * only the reference (F2, R3) is drawn on the plan; the description goes in the legend;
  * lines are drawn above walls (they usually follow one), and markers are drawn last.

### Stable references (`src/lib/northway/references.ts`)

* Every Survey Findings item (area, pin or line) gets F1, F2, …; every Recommended Works item gets
  R1, R2, …. Numbers are unique across the whole project (all floors).
* The reference is stored on the item (`ref`). `Project.surveyReferences = { F, R }` keeps the
  highest number issued, so deleting F2 never renumbers F3, and F2 is never reused.
* Undo restores whole-project snapshots, so a per-session high-water mark also stops an undone
  number from being issued again.
* Moving, editing or retyping an item keeps its reference. Duplicating gives the copy a new one.
* `normalizeReferences()` runs on every load:
  * older areas without a reference get one, in floor and item order;
  * a duplicated reference (the second copy) or one with the wrong letter for its layer gets the
    next free number;
  * valid references are never changed.
* The plan shows the reference: areas show it in their corner, instead of the type code.

### Automatic legend (`src/lib/northway/legend.ts`)

* `buildLegend(floor, layers)` lists only the items on that floor, in numeric reference order
  (F2 before F10, never alphabetical), split into Survey Findings and Recommended Works.
* Areas read reference, code, name (`F2  HM  High Moisture`). Pins and lines read reference and
  description (`F4  Restricted access beneath fitted kitchen`).
* Each entry has a swatch in the plan's own style (area, circle or hexagon, solid or dashed line).
* The Build tab shows the same list as "On this plan". Clicking an entry selects the item.

### Survey plan exports (`src/lib/northway/export/`)

* **Export → Survey Plan (PNG / PDF)…** opens `SurveyExportDialog.svelte`. It has:
  * a floor selector (multi-floor plans export one floor at a time);
  * the plan type: **Survey Findings Plan**, **Recommended Works Plan** or **Combined Plan**;
  * the PNG size: **Word report** (17 cm wide) or **A4 page**;
  * property address, plan/floor name and survey date;
  * a live preview.
* The plan type picks the layers for that export only (`viewLayers` passed to `surveyPlanView`). The
  editor's own Show/Hide settings are never changed.
* Page layout (`reportLayout.ts`, pure and unit-tested):
  * header with the logo, title, property address, floor and survey date;
  * the plan, fitted without distortion (one scale for both axes) and centred;
  * an approximate scale bar;
  * the legend, beside or below the plan, whichever draws the plan larger;
  * the footer "Northway Preservation | Damp & Timber Specialists".
  * Long legends wrap, use smaller text (down to about 6.5 pt) and more columns, and as a last
    resort make the page taller. The legend never overlaps the plan.
  * Word report size: the figure height follows the plan's shape (the shortest frame that still
    draws the plan within 10% of its largest size).
* Rendering (`reportExport.ts`):
  * drawn from the project data with `drawPlanContent()` (shared with scaled print), never a
    screenshot;
  * no grid, handles, hover outlines, hidden furniture or unused legend entries;
  * PNG at 300 dpi on white, with a pHYs resolution tag so Word inserts it at its true size;
  * PDF: an A4 page from jsPDF holding the same 300 dpi page.
* File names come from the first line of the address, the floor name and the plan type
  (`14-Moor-Lane-Ground-Floor-Survey-Findings.png`). They are sanitised, and the customer name is
  never used.
* The generic exports (Export 2D as PNG, SVG, PDF and print) now include pins and lines too.

### Metadata

* `Project.surveyDate` ('YYYY-MM-DD') and floor names (`Floor.name`) are edited in the export dialog
  and saved with the plan (`surveyMeta.ts`).
* The property address comes from the library row (`cloudDetails` in `cloud/session.ts`) and is
  changed with Rename in the library. The customer name is not printed on exports.

### Logo

* `static/northway-logo.svg` is the approved logo supplied by Northway (also used on the sign-in
  page and library). Exports draw it as-is (`export/logo.ts`); it is not redrawn.
* To change it, replace that file and keep the name. If it ever fails to load, exports show
  "Northway Preservation" in plain text instead.

### Format

* `CURRENT_SCHEMA_VERSION` is now **2** (`cloud/projectDocument.ts`). Version 1 documents open and
  get references on load. Version 2 stops an older open tab, which cannot show pins, lines or
  references, from editing a newer plan.

### Known limitations

* PDFs hold a 300 dpi image of the page, not vector paths and text (jsPDF has no full canvas
  equivalent). They print sharply, but the text in them is not selectable.
* A pin or line drawn exactly on a wall makes that spot pick the markup first; select the wall
  elsewhere along its length.
* Labels can overlap when markers are placed very close together, or when an area's reference
  corner sits on another area's reference. Move one of the items slightly.
* There is no editor to retype a reference by hand (by design: references are stable).
* Export dialog text is English only.
