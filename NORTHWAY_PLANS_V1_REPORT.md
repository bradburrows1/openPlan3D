# Northway Plans v1: final report

Branch: `northway-stage-7`. Nothing has been merged to `main` or deployed.

## Status: **Ready with noted limitations**

Every critical workflow in the Definition of Done has been checked by automated end-to-end tests. These
ran against the production build in Chromium, with a real Supabase Auth, PostgREST and PostgreSQL stack:

* sign in;
* create or import a plan;
* edit it, including with touch;
* add findings and recommendations, and assign priorities;
* save, close, reopen and amend;
* export both plans;
* sign out and back in.

It is not marked plain "Ready" for three reasons:

* The exports have not yet been opened in **Microsoft Word itself**. They were checked with document
  layout tests and LibreOffice.
* Nothing has been tried on a **real iPad**. Touch was tested with simulated multi-touch in Chromium,
  not in Safari.
* It has not yet been **deployed** to `plans.northwaypreservation.co.uk`.

Each of these needs Brad. They are listed below.

## Verified functionality

| Area | What was verified |
|---|---|
| End-to-end acceptance | **"14 Example Street, Ilkley"**: sign in → import a RoomPlan scan → edit → F1–F3 findings, a finding pin and a finding line → R1 Priority 3, R2 Priority 2, R3 Priority 1, R4 Further Investigation → save → back to the library → reopen → amend → add a second floor → export the Survey Findings and Recommended Works plans (PNG and PDF) → duplicate → sign out and sign back in. Everything was intact after each step (`northway-acceptance.spec.ts`). |
| Speed (production build, local) | Sign-in page 0.2 s; sign-in to library 0.7 s; import and open 0.38 s; save 0.25 s; reopen 0.39 s; PNG export 0.6–0.8 s; PDF about 2 s. A large survey (many rooms, findings and recommendations) validates and renders within 1.5 s. |
| iPad and touch | A pinch or two-finger pan never draws. A tap that wobbles 6 px selects without moving anything. One-finger drag moves items. Handles can be grabbed with a finger. Controls are at least 40 px, and dialog buttons 44 px. There is a portrait hint. Apple Pencil is delivered as touch, so it behaves the same. |
| Saving | Saving… / Saved / Unsaved changes / Save failed / Offline — not saved. **Saved** appears only after Supabase confirms. When a save fails, the edits stay on the device and can be restored after a reload. Leaving with unsaved changes asks first. |
| Sessions | If the sign-in ends elsewhere, the edits are kept on the device, the reason is explained, and signing in again returns to the same plan with **Restore my changes** offered. |
| Errors | Plain messages for save, import, library, duplicate and delete failures. Raw database text is never shown. |
| Imports | Malformed or unsupported files are refused with the standard message and never reach the editor. RoomPlan and OpenPlan3D files import. |
| Exports | 300 dpi PNG sized for Word (17 cm wide, at most 21.5 cm tall, so the plan and caption fit on one page). Full-page A4 PDF. Long recommendation text wraps and is never cut off. Colour plus pattern/reference letters, readable in greyscale. |
| Library | Newest first. Search by name, customer or address. Delete always asks for confirmation, and the Delete button only becomes active after 0.7 s, so a double tap cannot confirm it. |
| Older plans | Plans saved by Stages 3, 4, 5 and 6 open, keep their references and save in the current format. Recommendations without a priority show **Priority required**. |
| Multi-floor | Floors keep their own findings and recommendations, and export separately. |
| Security | See `SECURITY_CHECKLIST.md`: RLS on, staff list only, no public sign-up, publishable key only in the browser, no secrets committed, plan IDs (not addresses) in URLs, no plan data logged, `npm audit --omit=dev` 0 vulnerabilities. |
| PWA | The manifest, home-screen metadata and icons are served. Name: "Northway Plans". |
| Automated tests | 1,248 unit tests pass and `svelte-check` is clean. The full browser suite is 407 tests: in the final full run 405 passed, and 2 failed: one test still expected the old error wording (updated and now passing); the other was an upstream room-label test that has since passed 10 times out of 10 on its own. The production build passes. |

## Known limitations

* **PDF is an image** of the page (crisp at 300 dpi), so its text cannot be selected or searched.
  The PNG remains the recommended format for Word.
* **No offline launch.** The app must be opened once with signal. After that you can keep working
  without signal, but saving needs a connection.
* **Home-screen app on iPad** has its own sign-in, separate from Safari. Sign in once inside it.
* **Recovery copies are kept per device.** Unsaved edits on one iPad are not visible on another
  device until they are saved.
* **No self-service password reset.** Passwords are set in Supabase by Brad.
* **No Content-Security-Policy** header yet. The risk is low, because no third-party scripts are loaded.
* **Preview deployments** share the database if they are given the same keys (see DEPLOYMENT.md step 10).
* **Interim app icon:** the emblem from the approved logo, on white. Replace it when approved square
  artwork exists (see DEPLOYMENT.md).
* Labels on items placed very close together can overlap. Move one item slightly apart if that happens.
* Very long addresses are shortened with "…" in the export header.
* The upstream editor's bottom status bar can sit close to the iPad home indicator in the
  home-screen app.

## Manual actions required from Brad

1. **Supabase** (DEPLOYMENT.md steps 1–5):
   * create the project (UK or EU region);
   * turn **public sign-up off**;
   * run the migration;
   * create the Brad and Lewis accounts and add them to the staff list.
2. **Vercel** (steps 6–10):
   * import the repository;
   * add `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY`;
   * choose the production branch (`northway-stage-7` for the first trial, or `main` after you merge it);
   * protect previews.
3. **Domain** (steps 12–15):
   * add `plans.northwaypreservation.co.uk` in Vercel;
   * add the `plans` CNAME record at your DNS provider;
   * set the Supabase Site URL and Redirect URLs.
4. **Word check:** insert both exported PNGs into a real Northway Word report and confirm the size and
   readability.
5. **iPad check:** run the first live test below on a real iPad in Safari, and from the home screen.
6. **Optional:** supply approved square icon artwork to replace the interim icon.

## Recommended first live test checklist

Use a real but low-stakes survey, on the live address.

- [ ] Signed out, `https://plans.northwaypreservation.co.uk` shows the sign-in page with a padlock.
- [ ] Brad signs in on the laptop; Lewis signs in on the iPad.
- [ ] On the iPad: **Add to Home Screen**, open it from the icon, sign in once.
- [ ] Import a RoomPlan scan from the iPhone, or draw a blank plan.
- [ ] Pinch and pan around the plan: nothing is drawn by accident.
- [ ] Add three findings (an area, a pin and a line) with your own wording.
- [ ] Add four recommendations: Priority 3, 2, 1 and FI, with a long sentence in one of them.
- [ ] **Save**: the top bar says **Saved**.
- [ ] Turn on Airplane Mode, make an edit and press Save: it says **Offline — not saved**. Turn
      Airplane Mode off and save again: it says **Saved**.
- [ ] Go back to Plans, reopen the plan, change one priority and save.
- [ ] Open the same plan on the other device: the change is there.
- [ ] Export the **Survey Findings Plan** and the **Recommended Works Plan** as PNG and insert them
      into the Word report. Check that they are full width, the text is readable, the long sentence
      wraps in full, and they print well on A4, including in greyscale.
- [ ] Duplicate the plan, then delete the copy (the confirmation should take a moment to become active).
- [ ] Sign out on both devices.

When this checklist passes, Northway Plans v1 meets the Definition of Done. **Development stops here;
no further stage has been started.**
