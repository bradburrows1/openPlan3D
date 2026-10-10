import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { LOCAL_STAFF } from '../../tooling/northway-supabase/local-stack.mjs';

// Northway Stage 5: free-text pins and lines, stable F/R references, automatic legends and the
// branded Survey Findings / Recommended Works / Combined exports. Runs against the local
// Supabase stack (see playwright.config.ts global setup).
test.use({ storageState: { cookies: [], origins: [] } }); // start signed out

const BRAD = LOCAL_STAFF[0];
const RUN = Date.now().toString(36);
const NAME = `Stage 5 Test Property ${RUN}`;
const ADDRESS = '14 Moor Lane, Leeds LS1 2AB';
const SAVE = process.env.NORTHWAY_SAVE_EXPORTS;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(BRAD.email);
  await page.getByLabel('Password').fill(BRAD.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('button', { name: 'New Plan' })).toBeVisible();
}

async function menuDownload(page: Page, label: string) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const file = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  return readFile((await (await file).path())!);
}

const project = async (page: Page) => JSON.parse((await menuDownload(page, 'Download JSON')).toString('utf8'));

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...from); await page.mouse.down();
  await page.mouse.move(...to, { steps: 8 }); await page.mouse.up();
}

/** Width, height and DPI of a PNG (from IHDR and pHYs). */
function pngInfo(png: Buffer) {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const phys = png.indexOf('pHYs');
  return { width, height, dpi: phys > 0 ? Math.round(png.readUInt32BE(phys + 4) * 0.0254) : null };
}

const row = (page: Page, name: string) => page.locator('[data-plan-row]').filter({ has: page.getByRole('link', { name, exact: true }) });
const refs = (items: any[] = []) => items.map(item => item.ref);

test('Stage 5 workflow: pins, lines, stable references, legends and branded exports', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  // 1–2. Sign in and open a saved plan with a room.
  await signIn(page);
  await page.getByRole('button', { name: 'New Plan' }).click();
  await page.getByRole('button', { name: /Blank Plan/ }).click();
  await page.getByLabel(/Project name/).fill(NAME);
  await page.getByLabel(/Property address/).fill(ADDRESS);
  await page.getByRole('button', { name: 'Create Plan' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const canvas = page.getByRole('application').locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);
  const corners: [number, number][] = [[cx - 240, cy - 160], [cx + 240, cy - 160], [cx + 240, cy + 160], [cx - 240, cy + 160]];
  await page.getByRole('button', { name: /Draw Wall/ }).click();
  await page.mouse.click(...corners[0]); await page.mouse.click(...corners[1]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: /Draw Wall/ }).click();
  for (const [x, y] of corners) await page.mouse.click(x, y);
  await page.mouse.click(...corners[0]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  await page.getByRole('button', { name: 'Snap to Grid', exact: true }).click();

  const findings = page.locator('[data-survey-findings]'), works = page.locator('[data-recommended-works]');
  const badge = page.locator('[data-reference-badge]');

  // 3. HM area.
  await findings.getByRole('button', { name: 'Add Issue Area' }).click();
  await findings.getByRole('button', { name: /High Moisture/ }).click();
  await drag(page, [cx - 220, cy - 140], [cx - 100, cy - 60]);
  await expect(badge).toHaveText('F1');
  const s = Math.round(((await canvas.boundingBox())!.width - box.width) / 2); // the properties panel is open from here on

  // 4–5. Finding pin with the surveyor's own description and a colour.
  await findings.getByRole('button', { name: 'Add Finding Pin' }).click();
  await page.mouse.click(cx + 120 + s, cy - 100);
  let dialog = page.getByRole('dialog', { name: 'Finding pin' });
  await dialog.getByRole('textbox', { name: 'Description' }).fill('Defective rainwater goods above this location');
  await dialog.getByRole('radio', { name: 'Mauve' }).click();
  await dialog.getByRole('button', { name: 'Add Pin' }).click();
  await expect(badge).toHaveText('F2');

  // 6–7. Finding line along the base of the walls, three points, finished with Finish.
  await findings.getByRole('button', { name: 'Add Finding Line' }).click();
  await page.mouse.click(cx - 230 + s, cy + 40);
  await page.mouse.click(cx - 230 + s, cy + 150);
  await page.mouse.click(cx - 60 + s, cy + 150);
  await expect(findings.getByText('3 points')).toBeVisible();
  await findings.getByRole('button', { name: 'Finish' }).click();
  dialog = page.getByRole('dialog', { name: 'Finding line' });
  await dialog.getByRole('textbox', { name: 'Description' }).fill('Elevated moisture along base of external wall');
  await dialog.getByRole('button', { name: 'Add Line' }).click();
  await expect(badge).toHaveText('F3');

  // 8. WT area.
  await works.getByRole('button', { name: 'Add Recommended Area' }).click();
  await works.getByRole('button', { name: /Woodworm Treatment/ }).click();
  await drag(page, [cx + 20 + s, cy + 20], [cx + 180 + s, cy + 130]);
  await expect(badge).toHaveText('R1');

  // 9. Recommendation pin.
  await works.getByRole('button', { name: 'Add Recommendation Pin' }).click();
  await page.mouse.click(cx + 100 + s, cy + 75);
  dialog = page.getByRole('dialog', { name: 'Recommendation pin' });
  await dialog.getByRole('textbox', { name: 'Description' }).fill('Open floor locally for further inspection');
  await dialog.getByRole('button', { name: 'Add Pin' }).click();
  await expect(badge).toHaveText('R2');

  // 10. Recommendation line: two points, double-click to finish.
  await works.getByRole('button', { name: 'Add Recommendation Line' }).click();
  await page.mouse.click(cx - 200 + s, cy - 150);
  await page.mouse.dblclick(cx + 200 + s, cy - 150);
  dialog = page.getByRole('dialog', { name: 'Recommendation line' });
  await dialog.getByRole('textbox', { name: 'Description' }).fill('Install additional damp-proof course along this wall');
  await dialog.getByRole('button', { name: 'Add Line' }).click();
  await expect(badge).toHaveText('R3');

  let saved = (await project(page));
  let floor = saved.floors[0];
  expect(refs(floor.surveyFindings)).toEqual(['F1']);
  expect(refs(floor.recommendedWorks)).toEqual(['R1']);
  expect(floor.overlayPins.map((p: any) => [p.ref, p.layer, p.description, p.color])).toEqual([
    ['F2', 'survey-findings', 'Defective rainwater goods above this location', '#9466ad'],
    ['R2', 'recommended-works', 'Open floor locally for further inspection', floor.overlayPins[1].color],
  ]);
  expect(floor.overlayLines.map((l: any) => [l.ref, l.points.length])).toEqual([['F3', 3], ['R3', 2]]);

  // References stay put: move the F2 pin, edit its text, and drag a point of the F3 line.
  const pin = floor.overlayPins[0], line = floor.overlayLines[0];
  const zoom = 120 / floor.surveyFindings[0].width;
  await drag(page, [cx + 120 + s, cy - 100], [cx + 150 + s, cy - 80]);
  await expect(badge).toHaveText('F2');
  const markup = page.locator('[data-markup-properties]');
  await markup.getByRole('textbox', { name: 'Description' }).fill('Defective rainwater goods above this location (rear)');
  await page.mouse.click(cx - 145 + s, cy + 150); // select the F3 line by its band
  await expect(badge).toHaveText('F3');
  await drag(page, [cx - 60 + s, cy + 150], [cx - 40 + s, cy + 150]);
  saved = await project(page);
  floor = saved.floors[0];
  expect(floor.overlayPins[0]).toMatchObject({ ref: 'F2', description: 'Defective rainwater goods above this location (rear)' });
  expect(floor.overlayPins[0].x).toBeCloseTo(pin.x + 30 / zoom, 0);
  expect(floor.overlayLines[0].ref).toBe('F3');
  expect(floor.overlayLines[0].points[2].x).toBeCloseTo(line.points[2].x + 20 / zoom, 0);
  expect(floor.overlayLines[0].points[0]).toEqual(line.points[0]);

  // A deleted reference is not reused: add and delete a pin (F4); the next finding is F5.
  await findings.getByRole('button', { name: 'Add Finding Pin' }).click();
  await page.mouse.click(cx - 20 + s, cy - 20);
  await page.getByRole('dialog', { name: 'Finding pin' }).getByRole('textbox', { name: 'Description' }).fill('Temporary note');
  await page.getByRole('dialog', { name: 'Finding pin' }).getByRole('button', { name: 'Add Pin' }).click();
  await expect(badge).toHaveText('F4');
  await markup.getByRole('button', { name: 'Delete' }).click();
  await findings.getByRole('button', { name: 'Add Finding Pin' }).click();
  await page.mouse.click(cx - 20 + s, cy - 20);
  await page.getByRole('dialog', { name: 'Finding pin' }).getByRole('textbox', { name: 'Description' }).fill('Restricted access beneath fitted kitchen');
  await page.getByRole('dialog', { name: 'Finding pin' }).getByRole('button', { name: 'Add Pin' }).click();
  await expect(badge).toHaveText('F5');

  // The sidebar legend lists everything by reference.
  await expect(page.locator('[data-plan-references] [data-reference]')).toHaveText([
    /F1\s*HM\s*High Moisture/, /F2\s*Defective rainwater/, /F3\s*Elevated moisture/, /F5\s*Restricted access/,
    /R1\s*WT\s*Woodworm Treatment/, /R2\s*Open floor/, /R3\s*Install additional/,
  ]);

  // Export details: floor name and survey date are stored with the plan.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: /Survey Plan \(PNG \/ PDF\)/ }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export survey plan' });
  await expect(exportDialog.getByRole('textbox', { name: 'Property address' })).toHaveValue(ADDRESS);
  await exportDialog.getByRole('combobox', { name: 'Plan / floor name' }).fill('Ground Floor');
  await exportDialog.getByRole('combobox', { name: 'Plan / floor name' }).press('Tab');
  await exportDialog.getByLabel('Survey date').fill('2026-10-09');
  await exportDialog.getByLabel('Survey date').press('Tab');
  await exportDialog.getByRole('button', { name: 'Close' }).click();

  // 11–14. Save, sign out, sign in, reopen: references, text, colours and geometry intact.
  const edited = await project(page);
  expect(edited.surveyDate).toBe('2026-10-09');
  expect(edited.floors[0].name).toBe('Ground Floor');
  expect(edited.surveyReferences).toEqual({ F: 5, R: 3 });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  await page.getByRole('link', { name: /Back to Plans/ }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page);
  await row(page, NAME).getByRole('link', { name: 'Open' }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  const reopened = await project(page);
  for (const key of ['surveyFindings', 'recommendedWorks', 'overlayPins', 'overlayLines', 'name']) expect(reopened.floors[0][key]).toEqual(edited.floors[0][key]);
  expect(reopened.surveyReferences).toEqual(edited.surveyReferences);
  expect(reopened.surveyDate).toBe('2026-10-09');

  // 15–24. Branded exports for each view: 300 dpi PNG with a sensible name, and a PDF.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: /Survey Plan \(PNG \/ PDF\)/ }).click();
  const shown = page.getByRole('dialog', { name: 'Export survey plan' });
  await expect(shown.locator('[data-export-preview]')).toBeVisible();
  for (const [label, file] of [['Survey Findings Plan', 'Survey-Findings'], ['Recommended Works Plan', 'Recommended-Works'], ['Combined Plan', 'Combined-Plan']] as const) {
    await shown.getByRole('radio', { name: label }).check();
    await expect(shown.locator('[data-export-filename]')).toHaveText(`14-Moor-Lane-Ground-Floor-${file}.png`);
    const pngDownload = page.waitForEvent('download');
    await shown.getByRole('button', { name: 'Download PNG (300 dpi)' }).click();
    const png = await pngDownload;
    expect(png.suggestedFilename()).toBe(`14-Moor-Lane-Ground-Floor-${file}.png`);
    const bytes = await readFile((await png.path())!);
    const info = pngInfo(bytes);
    expect(info.dpi).toBe(300);
    expect(info.width).toBe(2008); // Word report width: 170 mm at 300 dpi
    if (SAVE) await writeFile(`${SAVE}/${png.suggestedFilename()}`, bytes);
    const pdfDownload = page.waitForEvent('download');
    await shown.getByRole('button', { name: 'Download PDF (A4)' }).click();
    const pdf = await pdfDownload;
    expect(pdf.suggestedFilename()).toBe(`14-Moor-Lane-Ground-Floor-${file}.pdf`);
    const pdfBytes = await readFile((await pdf.path())!);
    expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
    if (SAVE) await writeFile(`${SAVE}/${pdf.suggestedFilename()}`, pdfBytes);
  }
  // A full A4 page is available as a PNG too.
  await shown.getByRole('radio', { name: /A4 page/ }).check();
  const a4Download = page.waitForEvent('download');
  await shown.getByRole('button', { name: 'Download PNG (300 dpi)' }).click();
  const a4 = pngInfo(await readFile((await (await a4Download).path())!));
  expect([Math.max(a4.width, a4.height), Math.min(a4.width, a4.height), a4.dpi]).toEqual([3508, 2480, 300]); // A4 at 300 dpi
  if (SAVE) await shown.locator('[data-export-preview]').screenshot({ path: `${SAVE}/stage5-preview.png` });
  await shown.getByRole('button', { name: 'Close' }).click();

  // The export view never changes the editor's own layer settings.
  await expect(findings.getByRole('button', { name: 'Hide Survey Findings' })).toBeVisible();
  await expect(works.getByRole('button', { name: 'Hide Recommended Works' })).toBeVisible();
  if (SAVE) await page.screenshot({ path: `${SAVE}/stage5-editor.png` });

  // Duplicate keeps every reference.
  await page.getByRole('link', { name: /Back to Plans/ }).click();
  await row(page, NAME).getByRole('button', { name: 'Duplicate' }).click();
  await row(page, `${NAME} (Copy)`).getByRole('link', { name: 'Open' }).click();
  const copy = await project(page);
  expect(copy.floors[0].overlayPins).toEqual(edited.floors[0].overlayPins);
  expect(copy.floors[0].overlayLines).toEqual(edited.floors[0].overlayLines);
  expect(copy.surveyReferences).toEqual(edited.surveyReferences);
  expect(errors).toEqual([]);
});
