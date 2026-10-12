# Northway Plans: sequential references and laptop zoom

A focused usability pass after v1, made on branch `claude/wizardly-lamport-it480x`. Nothing else was
changed: no new tools, no export redesign, no priority changes, no database, auth or iOS work.

## 1. Sequential F and R references

### What changed

* Findings always show **F1, F2, F3…** and recommendations **R1, R2, R3…**, with no gaps, everywhere:
  * the plan;
  * the "On this plan" list;
  * the properties badge;
  * legends;
  * PNG and PDF exports (Findings, Recommended Works and Combined plans).
* Deleting F2 makes F3 the new F2 (and F4 the new F3). The same applies to R.
* The two sequences are independent. Adding or deleting a finding never changes an R number, and the
  reverse is also true.
* Older saved plans with gaps (for example F1, F3, F5) open as F1, F2, F3, in the same order. No
  manual repair is needed.

### How it works

* **The reference is only a display label.** Each item's permanent identity is its `id`, which never
  changes. Selection, editing, undo, saving, Supabase, duplication and migrations all use the `id`.
* **Order is creation order.** A new item always gets the next number, and renumbering keeps the
  existing order. Reopening a plan never reorders anything. Numbering is never based on sorting
  UUIDs.
* `compactReferences()` (`src/lib/northway/references.ts`) renumbers each layer 1…n:
  * It runs on every change to the open project (the `currentProject` store in
    `src/lib/stores/project.ts`) and on every load.
  * The plan, the list, the legend and the exports therefore all read the same current numbers.
* Undo brings a deleted item back with its old number, and the later ones move back down.
* Numbering is project-wide, across all floors, as before.

## 2. Laptop and desktop zoom

### Audit: what made zoom feel glitchy

These were measured in Chromium on the production build before any change.

| # | Finding | Effect |
|---|---|---|
| 1 | Every wheel event zoomed by a fixed 10%, however small the movement. | A trackpad sends 60+ small events a second, so a tiny two-finger scroll (20 events of 3 px) zoomed out **6.7×** (to 15%). |
| 2 | Pinch zoomed a fixed 5% per event. | Ten small pinch events zoomed in 1.6×. Pinch felt jumpy. |
| 3 | A trackpad scroll zoomed while it was perfectly vertical, and panned the moment any sideways movement appeared. | One gesture flipped between zooming and panning: visible jumps. |
| 4 | Zooming in was ×1.1 and zooming out ×0.9. | In-then-out did not return to the same scale (99%). |
| 5 | **The plan jumped 128 px sideways whenever something was selected or deselected.** The properties panel opens on selection, which narrows the canvas. The view kept its centre, so the plan shifted by half the panel width. | Looked like random "recentring" while working. It also happened on iPad in landscape. |
| 6 | Safari on a Mac reports a trackpad pinch as gesture events, which were not handled. | Pinching zoomed the whole web page instead of the plan. |
| ✓ | Cursor-centred zoom maths (0.04 px drift), shared coordinate transform for all overlays, the redraw scheduler (one draw per frame) and the wheel listener (not passive, so the page does not scroll). | Already correct, so they were kept. The coordinate system was not rewritten. |

### What changed

The zoom logic is in `src/lib/utils/wheelZoom.ts`, used by `FloorPlanCanvas.svelte`.

* **Zoom scales with the movement.** One mouse-wheel click is one 10% step. A trackpad zooms in
  proportion to how far you scroll: 100 px of scrolling equals one click. A pinch follows your
  fingers. Each event is capped, so a fast flick can never jump several levels at once.
* **Mouse-wheel clicks ease** to the new scale over a few frames (about 0.13 s), rather than snapping.
  Trackpad and pinch input is already continuous and is applied directly.
* **Zoom in and zoom out are exact inverses**, so in-then-out returns to the same scale.
* **Cursor-centred:** the point under the pointer stays under it (measured drift under 0.1 px).
* **One decision per gesture.** Whether a gesture is a mouse wheel or a trackpad, and whether it
  zooms or pans, is decided when it starts and kept until it ends. The existing behaviour is
  otherwise unchanged:
  * mouse wheel zooms;
  * trackpad up/down zooms;
  * a sideways trackpad scroll pans;
  * pinch zooms;
  * Space + drag pans.
* **The plan stays still** when the canvas changes size, whether from the properties panel opening
  or closing or the window resizing.
* **Safari (Mac):** a trackpad pinch now zooms the plan, not the page. On iPad the existing touch
  pinch is untouched: gesture events are ignored while fingers are on the screen.
* **Limits** are unchanged, because they were sensible:
  * maximum 1000% (10 screen pixels per cm), enough to mark a small patch;
  * minimum: a quarter of "fit whole plan" or 10%, whichever is lower.

### Verified

All of these were checked in Chromium (the engine of Chrome and Edge) on the production build, on a
realistic plan with rooms, doors, windows, a dimension, finding and recommendation areas, a pin and a
line (`tests/browser/northway-desktop-zoom.spec.ts`):

* slow and fast mouse-wheel zoom towards different rooms;
* trackpad scroll, pinch and sideways pan;
* Space + drag pan;
* selecting, moving and resizing an area, moving a pin, and drawing a new area after zooming;
* every F/R label keeping the same position relative to the plan at every zoom (under 1.5 px);
* the browser page itself never scrolling or zooming;
* the plan not moving when the properties panel opens or closes.

`tests/wheel-zoom.test.ts` covers the zoom maths. The existing iPad multi-touch test still passes:
pinch never draws, taps select without moving, fingers drag and resize.

Sequential references: `tests/browser/northway-sequential-references.spec.ts` follows the exact
steps:

1. Add three findings, delete F2, add one, and check F1, F2, F3.
2. Do the same for recommendations, with priorities kept.
3. Save, close and reopen.
4. Export the Findings, Recommended Works and Combined plans, and check that each reference is drawn
   on the plan and in the legend, with no stale numbers.

### Browser limitations (not hidden)

* **Only Chromium is installed in the test environment.** Chrome and Edge use the same engine and
  behave the same. **Safari (Mac and iPad) and Firefox were not tested automatically.**
  * The Safari pinch handling follows Safari's documented gesture events.
  * Firefox mouse wheels report lines, which are handled.
  * Please try both on a real Mac and iPad (checklist below).
* Telling a mouse wheel from a trackpad relies on the browser's legacy `wheelDeltaY` value, which
  Chrome, Edge and Safari provide. A mouse with a free-spinning or high-resolution wheel may be treated
  like a trackpad. It still zooms smoothly, just in smaller steps.
* The test environment renders without a graphics card, so frame rates there are much lower than on a
  real laptop. Timings were not used as a pass mark.

### Quick manual check (Mac or Windows laptop, and iPad)

- [ ] Point at a room and scroll the mouse wheel: it zooms towards that room in small, smooth steps.
- [ ] On the trackpad, a small two-finger scroll zooms a little, not a lot.
- [ ] Pinch on the trackpad: the plan zooms, not the whole page (Safari as well as Chrome).
- [ ] A two-finger sideways scroll pans.
- [ ] Select an area: the plan does not jump when the panel on the right opens.
- [ ] After zooming, draw an area and drag a pin: they land exactly under the pointer.
- [ ] On the iPad: pinch and two-finger pan still work, and taps still select.
- [ ] Add F1–F3, delete F2: the remaining ones read F1, F2. Export: the plan and legend match.
