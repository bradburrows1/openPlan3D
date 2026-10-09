# Northway Floor Plans: OpenPlan3D architecture notes (Stage 1)

These notes cover the codebase this fork inherits from
[OpenPlan3D / open3dFloorplan](https://github.com/theLodgeBots/open3dFloorplan) (v0.9.0). They were
written while setting up the Northway Preservation internal floor-plan tool. File paths are relative
to the repository root. For the plan for later stages, see
[`NORTHWAY_CUSTOMISATION_PLAN.md`](NORTHWAY_CUSTOMISATION_PLAN.md).

## 1. Licence and fork obligations

| Item | Licence | What we must do |
|---|---|---|
| Application code | **MIT**, © 2026 theLodgeStudio (`LICENSE`) | Keep `LICENSE`, including the copyright line and permission notice, in the repository and in any distributed copy. We may use, modify and sell, sublicense, or keep the fork private and internal. No warranty is given. |
| Textures (`static/textures/`) | CC0 (ambientCG), see `static/textures/CREDITS.md` | Nothing required. Keep `CREDITS.md` as good practice. |
| 3D models (`static/models/`) | CC0 (Kenney), see `static/models/*-License.txt` | Nothing required. `npm run catalog:check` verifies that these notice files are unchanged, so do not edit them. |
| npm dependencies | Mostly MIT, Apache-2.0 and BSD. A few MPL-2.0 packages are build tooling (Tailwind's `lightningcss`). | Nothing extra for internal use. MPL only matters if we modify an MPL file itself. |

Practical points:

* Add a Northway copyright line for **our** changes elsewhere, for example in a `NOTICE` file. Keep the
  original MIT notice intact.
* MIT does not grant trademark rights. In a later branding stage, replace the "OpenPlan3D" product name
  and logo in the UI with Northway naming rather than presenting the tool as OpenPlan3D. A short
  "Based on OpenPlan3D (MIT)" credit on an About screen is courteous but not required.
* `package.json` still names the upstream author and repository. Leave this until the branding stage.

## 2. Framework, dependencies and build

* **SvelteKit 2 + Svelte 5 (runes) + TypeScript**, built with **Vite 7**. Styling is **Tailwind CSS 4**.
* **three.js 0.182** powers the 3D view (`src/lib/components/viewer3d/ThreeViewer.svelte`), with
  `three-gpu-pathtracer` and `three-mesh-bvh` for the optional path-traced render.
* `jspdf` handles PDF export, `jszip` handles RoomPlan `.zip` and project packages, `dxf-writer` handles
  DXF and DWG export, and `svg-pathdata` parses SVG symbols.
* `firebase` (client analytics only, see §11) and `google-auth-library` (server routes for iPhone
  handoff and assistant sharing; both are disabled unless configured).
* Tests: **Vitest** unit tests (`tests/*.test.ts`, about 1,180 tests) and **Playwright** browser tests
  (`tests/browser/*.spec.ts`, which run against the production build on port 4188).
* Upstream deploys to Firebase App Hosting with `@sveltejs/adapter-node` (`apphosting.yaml`). This fork
  also builds with `@sveltejs/adapter-vercel` when `VERCEL` is set (see `DEPLOYMENT_VERCEL.md`).
* Build guard: `vite.config.ts` refuses to run `vite build` unless `NODE_ENV=production`. Use
  `NODE_ENV=production npm run build`.
* The runtime is almost entirely client-side. Projects live in the browser (IndexedDB) and there is no
  login. The only server code is `src/routes/api/*` and `src/routes/mcp`, which fail closed with HTTP
  503 unless their environment variables are set.

Commands:

```bash
npm ci                              # install (Node 22+; .nvmrc says 24)
npm run dev                         # dev server on http://localhost:5173
NODE_ENV=production npm run build   # production build -> build/ (node) or .vercel/output (Vercel)
node build/index.js                 # serve the node build (PORT=3000 by default)
npm run check                       # svelte-check / TypeScript
npm test                            # Vitest unit tests
npx playwright test --project=chromium   # browser tests (needs a production build)
```

## 3. The 2D floor-plan editor

* Page: `src/routes/editor/+page.svelte` contains the TopBar, BuildPanel, canvas, PropertiesPanel and
  3D viewer.
* Canvas: `src/lib/components/editor/FloorPlanCanvas.svelte` (about 4,300 lines) is a single HTML
  `<canvas>` with immediate-mode rendering.
  * It holds the camera state (`zoom`, `camX`, `camY`) and builds a `CanvasState` with `getCS()`.
  * Coordinates come from `worldToScreen` and `screenToWorld` in `src/lib/utils/canvasInteraction.ts`.
    World units are **centimetres**.
  * `draw()` repaints from scratch in layer order: grid, guides, background image, **rooms**, the ghost
    of the floor below, walls and joints, doors, windows, entourage, furniture, stairs, columns,
    measurements and annotations, text, then the selection UI. Repaints go through `markDirty()` and
    `drawScheduler.ts` (one frame per change).
  * Pointer handling (`onMouseDown`, `onMouseMove`, `onMouseUp`, `onWheel`) switches on `currentTool`
    (`select | wall | door | window | furniture | text | measure | annotate`). Pan uses the middle
    button, Space+drag or pan mode. The wheel zooms around the cursor.
* Drawing primitives are pure functions in `src/lib/utils/canvasRenderer.ts` (`drawWall`, `drawRooms`,
  `drawDoorOnWall`, `drawWindowOnWall`, `drawAnnotations` and so on). They take
  `(cs: CanvasState, element, …)`, so the same code draws the editor, print pages and parts of the
  exports.
* Hit testing: `src/lib/utils/hitTesting.ts` (`findWallAt`, `findRoomAt`, `findFurnitureAt` and similar).
* State: `src/lib/stores/project.ts` provides the `currentProject` writable, the `activeFloor` derived
  store, the selection stores (`selectedElementId`, `selectedElementIds`, `selectedRoomId`) and every
  mutation (`addWall`, `updateRoom`, …). Mutations call `mutate(fn, description)`, which snapshots the
  project as JSON onto the undo stack (50 steps or 32 MB), then applies `fn` to the active floor.
  `beginUndoGroup` and `endUndoGroup` batch changes, and drags use `beginDrag` plus non-snapshotting
  moves.
* Side panels: `src/lib/components/sidebar/BuildPanel.svelte` (tools and catalogue),
  `PropertiesPanel.svelte` (properties of the selection), `LayersPanel.svelte` (layer visibility and
  the element list), `ItemDetailsPanel.svelte` (notes, photos, costs).

## 4. Manual wall and room drawing

* Wall tool (`W`): click to start, click again for each corner, and double-click or click the first
  point to finish. Code is in `FloorPlanCanvas.svelte` (`tool === 'wall'` branches, `wallStart` and
  `wallSequenceFirst`). Endpoints use grid, angle (`angleSnap`) and magnetic (`magneticSnap`)
  snapping. Each segment calls `addWall(start, end)`.
* A wall (`src/lib/models/types.ts` → `Wall`) has `start`, `end`, `thickness`, `height`, optional
  `curvePoint` (a quadratic curve), colour and texture. `src/lib/utils/wallEditing.ts`,
  `splitWallGeometry.ts` and `splitWallRooms.ts` handle editing.
* **Rooms are derived, not drawn.** `src/lib/utils/roomDetection.ts` (`detectRooms` and
  `resolveRooms`) finds closed wall loops and merges them with any stored `floor.rooms` entries, which
  hold the name, colour, texture and label offset. `roomNesting.ts` handles holes, and `interiorArea.ts`
  calculates areas. Room templates (`roomTemplates.ts`, `houseTemplates.ts`) drop in ready-made walls.

## 5. Doors, windows, labels and dimensions

* Doors and windows are attached to a wall: `{ wallId, position: 0..1, width, height, type }`. They are
  placed with the door and window tools (`openingDrop.ts`, `openingAlignment.ts`) and drawn by
  `drawDoorOnWall` and `drawWindowOnWall`. Swing arcs and type-specific symbols are in
  `canvasRenderer.ts`, with shared geometry in `planOpening.ts`.
* Room labels: `drawRooms()` writes "Name (area)" at `roomLabelPosition()`. Users can drag the label,
  which stores `room.labelOffset`.
* Dimensions:
  * Wall lengths are drawn inside `drawWall()` when `showDimensions && showExternalDimensions`.
    Centreline or edge-to-edge (`wallMeasureMode`).
  * Internal room W×H text is drawn in `drawRooms()` when `showInternalDimensions`.
  * Door and window offsets are shown for the selected opening (`drawDoorDistanceDimensions` and
    similar).
  * The user tools are `measure` (`floor.measurements`) and `annotate` (dimension lines,
    `floor.annotations`). Text labels are `floor.textAnnotations`.
  * Settings live in `src/lib/stores/settings.ts` (`projectSettings`, which persists to localStorage key
    `o3d_settings`).

## 6. Apple RoomPlan / OpenPlan3D imports

* RoomPlan JSON (the `CapturedRoom` / `CapturedStructure` export) is converted by
  `src/lib/utils/roomplanImport.ts`:
  * `validateRoomPlan` (in `roomplanValidation.ts`) checks the input.
  * `importRoomPlanFloors` creates one `Floor` per storey.
  * `importRoomPlan` converts the 4×4 transforms (metres, Y-up) into 2D centimetres, straightens and
    orthogonalises walls, merges corners, and maps doors, windows and openings onto walls and objects
    onto furniture.
  * `createProjectFromRoomPlan` wraps the result in a `Project`.
  * `.zip` exports are unpacked by `extractRoomJsonFromZip`.
* Entry points:
  * "Import RoomPlan" in the BuildPanel (with straighten and orthogonal options).
  * Export menu → "Import JSON" in TopBar, which detects RoomPlan JSON or a native project.
  * The Welcome screen.
  * `?import=CODE` handoff from the OpenPlan3D iPhone app. **This fetches from the upstream author's
    Firebase bucket.** See §11.
* All imports go through `src/lib/services/projectOpening.ts → openProject()`. It validates first,
  saves the current project, then opens the new one as a separate local project.
* Native project JSON is validated by `src/lib/utils/projectValidation.ts → readProject()`.
* **iPhone project packages** (`.zip` containing `plan.json` and assets) are read and written by
  `src/lib/services/projectPackage.ts`, `projectPackageZip.ts` and `projectPackageBridge.ts`.
  `nativeToWeb` and `webToNative` keep iPhone-only metadata so a round trip through the web is
  lossless.

## 7. Saving and exporting projects

* Autosave and save use IndexedDB database `openplan3d-local` (`src/lib/services/localDatabase.ts`,
  `datastore.ts → localStore`), with stores for projects, thumbnails, history and meta. Save status is
  in `stores/saveStatus.ts`, and version snapshots in `stores/versionHistory.ts`.
* Export menu → "Download JSON" writes `<name>.openplan.json`, which is the full `Project`.
  `projectBackup.ts` provides a recovery download, and the library backup exports every project.
* "Project package" (`.zip`) is the iPhone-compatible format.
* Nothing is stored on a server. Data stays on the surveyor's device unless they export it.

## 8. PNG, PDF and image exports

All exports are in `src/lib/utils/export.ts` unless stated otherwise:

* **2D PNG**: `exportAsPNG(canvas, project)` redraws the active floor onto an off-screen canvas at up to
  2× scale (maximum 4,096 px), with a white background and title. Room fills and labels are drawn
  inline. Walls, doors, windows, furniture, stairs and annotations reuse `canvasRenderer` functions.
* **SVG**: `exportAsSVG(project)` builds the SVG as a string. It is separate code that mirrors the
  canvas output, with symbols from `canvasSymbolSvg.ts` and `furnitureSvg.ts`.
* **PDF**: `exportPDF(project)` and `renderPDF` produce an A4 landscape sheet with a border and title
  block. The plan is rasterised on an off-screen canvas, followed by an optional 3D snapshot and a room
  schedule page.
* **Scaled print / print PDF**: `src/lib/utils/scaledPrint.ts` (`renderPrintPage`, `createPrintPDF`)
  draws at true scale (1:50 or 1:100) using the canvasRenderer functions directly. The UI is in
  `components/editor/PrintLayout.svelte`.
* **DXF / DWG**: `src/lib/utils/cadExport.ts`.
* **3D PNG**: `exportAs3DPNG` and `captureMain3D.ts`.
* Bounds: `planContentBounds.ts`, `printLayout.ts → printBounds` and the `extendBoundsFor*` helpers in
  `export.ts`.

## 9. Floor materials, textures and room finishes

* `Room.floorTexture` is a material ID: `'hardwood'`, `'light-oak'`, tile and stone IDs, or `'none'`
  for a solid colour. `Room.color` is an optional hex tint.
* Texture images are `static/textures/floor-*.webp`, mapped in `src/lib/utils/textureFiles.ts`. They
  are loaded and cached by `textureGenerator.ts → getFloorTextureCanvas()`. Material metadata and
  labels are in `materials.ts` and `i18n/*`.
* Upstream 2D behaviour (`canvasRenderer.ts`):
  * `getRoomFill` applies a per-room or per-type pastel tint.
  * `drawRoomFloorPattern` paints the texture at 50% opacity. Without a texture, it draws procedural
    **wood planks, tile grids or stone hatching** chosen by room name.
* Imports and detection set defaults: `roomDetection.ts` and `roomplanImport.ts` use `'hardwood'`, and
  `projectValidation.ts` and `projectPackageBridge.ts` use `'light-oak'`. RoomPlan packages also carry
  a `colorHex` per room.
* The 3D view (`ThreeViewer.svelte`) applies the same textures to floor meshes.
* UI: the PropertiesPanel shows a room colour swatch grid and a floor-material picker, and the canvas
  context menu has "Change Floor Texture".

### Stage 1 change: technical plan style (default)

The new setting `ProjectSettings.planStyle` is `'technical'` by default; `'decorative'` restores the
upstream behaviour. The setting is defined in `src/lib/utils/planStyle.ts`. In technical style:

* every room is filled `#f4f4f5` (very light grey), and per-room colours are ignored;
* no floor texture and no wood, tile or stone fallback pattern is drawn;
* room labels and sizes are drawn in dark grey (`#1f2937` / `#4b5563`) instead of pale grey, so they
  stay legible;
* the PNG, SVG, PDF and scaled-print exports use the same neutral fill;
* the PropertiesPanel colour and material pickers and the "Change Floor Texture" menu item are hidden.

The data is **not** changed. `floorTexture` and `color` are still read, written, imported and exported,
so turning on Settings → Dimensions → "Decorative floor finishes" brings every finish back. Imported and
new plans look neutral because the rendering ignores finishes, not because the data was rewritten. The
3D view still shows floor textures; that view is outside the survey drawing.

## 10. Files most likely to change in later stages

| Concern | Files |
|---|---|
| Data model for overlays | `src/lib/models/types.ts`, `src/lib/stores/project.ts`, `src/lib/utils/projectValidation.ts` |
| Drawing overlays | `src/lib/utils/canvasRenderer.ts` (or a new `surveyOverlayRenderer.ts`), `FloorPlanCanvas.svelte` (`draw()`, pointer handlers) |
| Hit testing and selection | `src/lib/utils/hitTesting.ts`, `FloorPlanCanvas.svelte`, `PropertiesPanel.svelte`, `LayersPanel.svelte`, `ContextMenu.svelte` |
| Tools UI | `src/lib/components/sidebar/BuildPanel.svelte`, `stores/project.ts` (`Tool` type), `utils/shortcuts.ts` |
| Exports and legend | `src/lib/utils/export.ts` (PNG, SVG, PDF), `scaledPrint.ts`, `planContentBounds.ts`, `planExportContent.ts`, `cadExport.ts` (optional) |
| Style and branding | `src/lib/utils/planStyle.ts`, `src/app.css`, `src/app.html`, `static/favicon.svg`, `i18n/locales/en.ts` |
| iPhone package round trip | `src/lib/utils/projectPackageBridge.ts` (web-only fields must survive `webToNative` and `nativeToWeb`) |

### Stage 2 additions

Stage 2 added the survey object library (fixed fixtures only by default) and the Survey Findings
issue areas. Both live in `src/lib/northway/`, with small `// Northway:` hooks in upstream files. See
"Stage 2: what was built" in [`NORTHWAY_CUSTOMISATION_PLAN.md`](NORTHWAY_CUSTOMISATION_PLAN.md).

## 11. Risks and limitations found

* **Upstream analytics**: `src/routes/+layout.svelte` loaded Firebase Analytics for the upstream
  `openplan3d` project unless `PUBLIC_ENABLE_ANALYTICS=false`. This fork now loads it only when
  `PUBLIC_ENABLE_ANALYTICS=true`, so no usage data goes to a third party by default.
* **iPhone handoff (`/editor?import=CODE`)** downloads captures from the upstream author's Firebase
  Storage bucket (`openplan3d.firebasestorage.app`). Customer property scans would pass through a third
  party's cloud. For customer work, export the RoomPlan JSON or `.zip` from the phone and use **Import
  RoomPlan** or **Import JSON** instead.
* "Share with assistant" and the `/mcp` route point to `app.openplan3d.com` and are disabled (503) on
  our deployment. Hide them in the branding stage.
* Data is per browser and per device (IndexedDB). Clearing site data or switching device loses
  unexported projects, so surveyors should keep JSON exports with the job until a storage stage exists.
* Room fills and labels in the PNG, SVG and PDF exports are separate code paths from the on-screen
  canvas. Any visual change, and the future overlays, must be made in each exporter, or the exporters
  should be refactored to share one renderer.
* Upstream rendering quirk: in the PNG export, wall-length labels overlap the wall bodies. This is
  pre-existing, not caused by Stage 1, and worth fixing in the export-styling stage.
* RoomPlan imports bring in furniture (beds, sofas) drawn in colour. The Furniture layer toggle hides it
  on screen, but the PNG, SVG and PDF exports always include it. Consider an "exclude furniture" export
  option for survey drawings later.
