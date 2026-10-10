# Stage 7 audit: Northway Plans before production

The audit was done on the Stage 6 build (`northway-stage-6`, commit 84c767a) before any Stage 7
change. I inspected the code and ran the production build in Chromium at:

* iPad landscape: 1180 × 820, touch enabled;
* iPad portrait: 820 × 1180;
* desktop: 1440 × 900.

Each finding is rated:

* **D** (defect): fix in Stage 7;
* **U** (usability): improve in Stage 7;
* **OK**: already fine, leave alone;
* **Doc**: document only.

## Summary

The core survey workflow is complete and well tested: 1,243 unit tests and 403 browser tests, with
RLS integration tests against a real Supabase Auth, PostgREST and PostgreSQL stack.

The Stage 7 work is mostly about iPad touch behaviour, lost-work protection around expired
sessions and network failures, clearer error wording, PWA metadata, hiding a few upstream
features, and documentation. No architectural rewrite is needed.

## Findings

### Editor layout and desktop usability

| # | Area | Finding | Rating |
|---|---|---|---|
| 1 | Layout | Three-column editor: Build panel, canvas, properties. Clear on desktop. | OK |
| 2 | Upstream features | The 2D/3D toggle, Elevation view, "Export 3D as PNG", DXF and DWG export and onboarding tips are visible in the Northway editor. None is part of the survey workflow. The onboarding tip "Your plan is ready! Try SVG…" covers the plan after import. | U |
| 3 | Build panel | Build panel → Import RoomPlan replaces the open cloud plan. Imports belong in Library → New Plan → Import Plan. | U |
| 4 | Build panel | Room templates and presets (Rooms tab) and the upstream Objects library are already reduced to fixed fixtures. | OK |

### iPad and touch

| # | Area | Finding | Rating |
|---|---|---|---|
| 5 | Touch targets | Under 44 px at iPad size: Undo/Redo (28 px), More (28 px), Export icon (30 × 26), 2D/3D (24 px high), zoom controls (28 px), status-bar toggles (14–51 px wide), layer Hide/Show toggles (28 px high), floating help/library/history buttons. | U |
| 6 | Touch, pan vs draw | One finger is turned into a mouse press *immediately*. When a two-finger pinch starts, the first finger has already pressed. With + Pin armed this places a pin, with an area armed it creates a 1 m area, and with a line armed it adds a point. Panning can therefore draw. | D |
| 7 | Touch, select vs move | Dragging starts after 3 px of movement, tuned for a mouse. A finger tap often moves 3–8 px, so tapping to select can nudge walls, areas or pins. | D |
| 8 | Handles | Area resize handles (8 px drawn, 9 px hit) and line point handles (7 px) are mouse-sized; hard to grab with a finger. | U |
| 9 | Pinch zoom / pan | Two-finger pinch zooms about the midpoint and pans. Overlays use the same world-to-screen transform, so they stay aligned at any zoom (checked in tests at several zoom levels). | OK |
| 10 | Page zoom | The canvas uses `touch-action: none`. Double-tapping UI outside the canvas can still zoom the page on iOS. | U |
| 11 | Apple Pencil | Safari delivers Pencil input as touch events, which follow the same one-finger path. Pencil works wherever a finger works; items 6 and 7 apply equally. | OK |
| 12 | Portrait | Portrait (820 wide) works; the Build panel takes about 255 px. A gentle hint is enough. | U |

### Survey workflow

| # | Area | Finding | Rating |
|---|---|---|---|
| 13 | Findings | Area, Pin and Line work, and F references are stable. | OK |
| 14 | Recommendations and priority | Dialog-first flow: priority, then recommendation text, then draw. Priority definitions match the brief. No RICS wording. | OK |
| 15 | Layers | Show/Hide per layer works. Toggles are small (item 5). | U |
| 16 | Overlaps | Click-cycling between overlapping areas works with a mouse; on touch it depends on item 7. | OK |

### Saving, recovery, sessions and network

| # | Area | Finding | Rating |
|---|---|---|---|
| 17 | Save states | Saved / Unsaved changes / Saving… exist, and Saved appears only after the server confirms (revision check). A failed save still says "Unsaved changes" in the top bar, with a banner. There is no explicit "Save failed" state. | U |
| 18 | Save errors | Errors show raw Supabase text ("Could not save plan: Failed to fetch"). | D |
| 19 | Offline | No offline indicator. An offline save fails, and the edits are kept in the local recovery copy, but the user isn't told they are offline. | U |
| 20 | Local recovery | An IndexedDB recovery copy is written 1.5 s after each change and after every failed save. Restore / Discard is offered on reopen. It never overwrites the server copy automatically. | OK |
| 21 | Closing the app | When Safari or the home-screen app is closed within 1.5 s of an edit, that edit may not have reached the recovery copy. | U |
| 22 | Expired session | When the session ends (refresh fails, or signed out elsewhere), the auth gate unmounts the editor at once and redirects to /login. Edits made in the last 1.5 s may be lost, there is no explanation, and after signing in the user lands on the library, not the plan. | D |
| 23 | Navigation guard | Back to Plans, links, reload and closing the tab warn when there are unsaved changes. | OK |
| 24 | Autosave | Not present. Explicit Save plus local recovery is the safer design. | Doc |

### Library

| # | Area | Finding | Rating |
|---|---|---|---|
| 25 | Library basics | Newest first (`updated_at desc`). Search covers name, customer and address. Loading row, busy states. | OK |
| 26 | Library errors | List, duplicate and delete errors show raw Supabase text. | U |
| 27 | Delete safety | Delete always asks for confirmation. The Delete button is live as soon as the dialog opens, so a fast double tap could confirm before the dialog is seen. | D |

### Imports

| # | Area | Finding | Rating |
|---|---|---|---|
| 28 | Import validation | Every import goes through `readProject()` validation, with a 64 MB limit. Malformed files are refused without touching the editor. | OK |
| 29 | Import errors | Messages such as "Invalid project: floors[0].walls[3].start must be an object" are developer wording. | U |
| 30 | Imported plans | RoomPlan walls, doors, windows and openings import; fixed fixtures (toilet, sink, …) are kept and movable furniture is hidden. | OK |

### Exports

| # | Area | Finding | Rating |
|---|---|---|---|
| 31 | Plans and legends | Findings, Recommended Works and Combined plans; 300 dpi PNG with a resolution tag; Word size (17 cm) and A4; PDF; legends wrap and never truncate the item text. | OK |
| 32 | Long addresses | The header shortens over-long addresses with "…". Rare; acceptable. | Doc |
| 33 | PDF quality | The PDF is an image of the page, not selectable text. | Doc |

### PWA, security, deployment and code health

| # | Area | Finding | Rating |
|---|---|---|---|
| 34 | PWA | No web manifest, no Apple home-screen metadata and no app icon. Only `favicon.svg` (upstream) and the approved wordmark `northway-logo.svg` exist; there is no approved square icon. | D |
| 35 | Security | RLS, the staff allowlist, no public sign-up, UUID routes and the publishable key only were verified in Stage 3 tests. A final recheck and a checklist are needed. | Doc |
| 36 | Dependencies | `npm audit --omit=dev` reports one low-severity advisory in `dompurify` (used by jsPDF's HTML renderer, which Northway does not use); a patch-level fix is available. | U |
| 37 | Deployment | Vercel adapter configured; deployment docs are split across DEPLOYMENT_VERCEL.md and SUPABASE_SETUP.md. A single non-developer DEPLOYMENT.md is needed. | Doc |
| 38 | Performance | Large plans have not been measured end to end on the Stage 6 build. | Doc |
| 39 | Logging | No project payloads are logged by Northway code. Analytics are off by default. | OK |

## Plan

1. **Touch and iPad:**
   * defer the touch press so a pinch never draws (6);
   * a touch-sized drag threshold (7);
   * finger-sized handles on touch screens (8);
   * 44 px touch targets on coarse pointers (5);
   * stop double-tap page zoom (10);
   * a portrait hint (12);
   * hide upstream 3D, Elevation, DXF/DWG, onboarding tips and the Build-panel RoomPlan import in the Northway editor only (2, 3). The upstream local editor at /editor keeps them, and its tests keep running.
2. **PWA:** web manifest, Apple home-screen metadata and an interim icon taken from the approved logo's own emblem, with the replacement files documented (34).
3. **Saving:**
   * "Save failed" and "Offline" states (17, 19);
   * friendly save errors (18);
   * write the recovery copy immediately when the page is hidden or closed (21);
   * on an expired session, write the recovery copy before leaving, explain why, and return to the plan after signing in (22).
4. **Errors and safety:** friendly import and library errors (26, 29); delay the delete confirmation (27).
5. **Dependencies:** apply the patch-level `dompurify` fix (36).
6. **Verification:** realistic acceptance, multi-floor, touch, offline, backward-compatibility and performance tests (38).
7. **Documents:** SECURITY_CHECKLIST.md, DEPLOYMENT.md, NORTHWAY_PLANS_USER_GUIDE.md and NORTHWAY_PLANS_V1_REPORT.md.
