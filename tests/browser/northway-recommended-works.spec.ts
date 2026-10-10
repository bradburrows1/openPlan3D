import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { LOCAL_STAFF } from '../../tooling/northway-supabase/local-stack.mjs';

// Northway Stage 4: Survey Findings and Recommended Works as two independent overlay
// layers, with presets, custom zones, editing, persistence, export and duplication.
// Runs against the local Supabase stack (see playwright.config.ts global setup).
test.use({ storageState: { cookies: [], origins: [] } }); // start signed out

const BRAD = LOCAL_STAFF[0];
const RUN = Date.now().toString(36);
const NAME = `Stage 4 Test Property ${RUN}`;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(BRAD.email);
  await page.getByLabel('Password').fill(BRAD.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('button', { name: 'New Plan' })).toBeVisible();
}

async function download(page: Page, label: string) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const file = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  return readFile((await (await file).path())!);
}

const floor = async (page: Page) => JSON.parse((await download(page, 'Download JSON')).toString('utf8')).floors[0];

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...from); await page.mouse.down();
  await page.mouse.move(...to, { steps: 8 }); await page.mouse.up();
}

const row = (page: Page, name: string) => page.locator('[data-plan-row]').filter({ has: page.getByRole('link', { name, exact: true }) });
const codes = (zones: any[] = []) => zones.map(zone => zone.code);
const geometry = ({ x, y, width, height }: any) => ({ x, y, width, height });

test('Stage 4 workflow: findings and recommended works, custom zones, toggles, save, export, duplicate', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  // 1–2. Sign in and open a new plan with a room.
  await signIn(page);
  await page.getByRole('button', { name: 'New Plan' }).click();
  await page.getByRole('button', { name: /Blank Plan/ }).click();
  await page.getByLabel(/Project name/).fill(NAME);
  await page.getByRole('button', { name: 'Create Plan' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();
  const canvas = page.getByRole('application').locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);
  const corners: [number, number][] = [[cx - 220, cy - 150], [cx + 220, cy - 150], [cx + 220, cy + 150], [cx - 220, cy + 150]];
  // The canvas zooms to fit its first content once; let that happen on a wall we then undo.
  await page.getByRole('button', { name: /Draw Wall/ }).click();
  await page.mouse.click(...corners[0]); await page.mouse.click(...corners[1]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: /Draw Wall/ }).click();
  for (const [x, y] of corners) await page.mouse.click(x, y);
  await page.mouse.click(...corners[0]);
  await page.keyboard.press('Escape');

  // Exact pointer-to-world mapping for the move and resize checks below.
  await page.getByRole('button', { name: 'Snap to Grid', exact: true }).click();

  // 3–4. Survey Findings: HM and WM presets.
  const findings = page.locator('[data-survey-findings]');
  const works = page.locator('[data-recommended-works]');
  await findings.getByRole('button', { name: 'Add Issue Area' }).click();
  await findings.getByRole('button', { name: /High Moisture/ }).click();
  await drag(page, [cx - 200, cy - 130], [cx - 60, cy - 40]);
  // HM is selected and the properties panel narrows the canvas, re-centring the plan.
  // A zone stays selected from here until the layer toggles, so the layout is stable.
  const s = Math.round(((await canvas.boundingBox())!.width - box.width) / 2);
  await findings.getByRole('button', { name: /Woodworm Activity/ }).click();
  await drag(page, [cx + 40 + s, cy + 20], [cx + 180 + s, cy + 120]);

  // 5–7. Custom finding "Defective Pointing" (DP) with a chosen colour.
  await findings.getByRole('button', { name: '+ Custom Finding' }).click();
  let dialog = page.getByRole('dialog', { name: 'Custom finding' });
  await dialog.getByRole('textbox', { name: 'Name' }).fill('Defective Pointing');
  await expect(dialog.getByRole('textbox', { name: 'Code' })).toHaveValue('DP'); // suggested from the name
  await dialog.getByRole('radio', { name: 'Indigo' }).click();
  await dialog.getByRole('button', { name: 'Draw Area' }).click();
  await expect(dialog).toBeHidden();
  await expect(findings.locator('[data-armed-custom-zone]')).toContainText('Defective Pointing');
  await drag(page, [cx - 200 + s, cy + 40], [cx - 90 + s, cy + 130]);

  // 8–9. Recommended Works (Stage 6 flow: priority and text first, then draw): WT over the WM area, and VI.
  const recommend = async (priority: string, text: string | null, workType: string | null, from: [number, number], to: [number, number]) => {
    await works.getByRole('button', { name: 'Add Recommended Area' }).click();
    const form = page.getByRole('dialog', { name: 'New recommended area' });
    await form.getByRole('radio', { name: priority }).click();
    if (workType) await form.getByRole('combobox', { name: /Work type/ }).selectOption({ label: workType });
    if (text) await form.getByRole('textbox', { name: 'Recommendation' }).fill(text);
    await form.getByRole('button', { name: 'Draw Area' }).click();
    await drag(page, from, to);
  };
  await recommend('2 — Recommended Work', null, 'Woodworm Treatment', [cx + 40 + s, cy + 20], [cx + 180 + s, cy + 120]);
  await recommend('1 — Advisory Work', null, 'Ventilation Improvement', [cx - 30 + s, cy - 130], [cx + 80 + s, cy - 60]);

  // 10–12. Custom recommendation: free text only, no code or colour to choose.
  await recommend('FI — Further Investigation', 'Open Floor for Further Inspection', null, [cx - 200 + s, cy - 130], [cx - 120 + s, cy - 70]);
  void dialog;

  const drawn = await floor(page);
  expect(codes(drawn.surveyFindings)).toEqual(['HM', 'WM', 'DP']);
  expect(codes(drawn.recommendedWorks)).toEqual(['WT', 'VI', 'REC']);
  expect(drawn.surveyFindings[2]).toMatchObject({ layer: 'survey-findings', name: 'Defective Pointing', color: '#5d5fb8', preset: null });
  expect(drawn.recommendedWorks[0]).toMatchObject({ layer: 'recommended-works', name: 'Woodworm treatment', preset: 'WT', workType: 'WT', priority: 'priority_2' });
  expect(drawn.recommendedWorks[2]).toMatchObject({ name: 'Open Floor for Further Inspection', priority: 'further_investigation', workType: null, preset: null });
  expect(geometry(drawn.recommendedWorks[0])).toEqual(geometry(drawn.surveyFindings[1])); // WT exactly over WM
  const zoom = 140 / drawn.surveyFindings[0].width;

  // 13. Move and resize. Pressing the shared WM/WT area takes the recommendation (drawn on top).
  await drag(page, [cx + 110 + s, cy + 70], [cx + 140 + s, cy + 90]);
  let now = await floor(page);
  expect(now.recommendedWorks[0].x).toBeCloseTo(drawn.recommendedWorks[0].x + 30 / zoom, 0);
  expect(now.surveyFindings[1]).toEqual(drawn.surveyFindings[1]);
  await expect(page.locator('[data-recommendation-properties]')).toBeVisible();
  // A click (no drag) where they still overlap moves the selection on to WM; then resize WM.
  await page.mouse.click(cx + 120 + s, cy + 80);
  await expect(page.locator('[data-issue-area-properties]').getByRole('textbox', { name: 'Code' })).toHaveValue('WM');
  await drag(page, [cx + 180 + s, cy + 120], [cx + 210 + s, cy + 140]);
  now = await floor(page);
  expect(now.surveyFindings[1].width).toBeCloseTo(drawn.surveyFindings[1].width + 30 / zoom, 0);
  expect(now.surveyFindings[1].x).toBeCloseTo(drawn.surveyFindings[1].x, 3);
  expect(now.recommendedWorks[0].width).toBeCloseTo(drawn.recommendedWorks[0].width, 3);

  // 14. Rename HM without changing its geometry; undo and redo the rename.
  await page.mouse.click(cx - 70 + s, cy - 50); // HM only
  const hmPanel = page.locator('[data-issue-area-properties]');
  await expect(hmPanel.getByRole('textbox', { name: 'Code' })).toHaveValue('HM');
  await hmPanel.getByRole('textbox', { name: 'Name' }).fill('High Moisture - chimney breast');
  await hmPanel.getByRole('textbox', { name: 'Name' }).press('Tab');
  await hmPanel.getByRole('radio', { name: 'Navy' }).click();
  now = await floor(page);
  expect(now.surveyFindings[0]).toMatchObject({ name: 'High Moisture - chimney breast', code: 'HM', color: '#1f4f8f', preset: 'HM', ...geometry(drawn.surveyFindings[0]) });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await floor(page)).surveyFindings[0].color).toBe('#3b82c4');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await floor(page)).surveyFindings[0].color).toBe('#1f4f8f');

  // 15–17. Layer toggles: each hides only its own layer; nothing is deleted.
  await findings.getByRole('button', { name: 'Hide Survey Findings' }).click();
  await expect(hmPanel).toBeHidden(); // the hidden HM is no longer selected
  await expect(works.getByRole('button', { name: 'Hide Recommended Works' })).toBeVisible();
  await works.getByRole('button', { name: 'Hide Recommended Works' }).click();
  await findings.getByRole('button', { name: 'Show Survey Findings' }).click();
  await works.getByRole('button', { name: 'Show Recommended Works' }).click();
  const edited = await floor(page);
  expect(codes(edited.surveyFindings)).toEqual(['HM', 'WM', 'DP']);
  expect(codes(edited.recommendedWorks)).toEqual(['WT', 'VI', 'REC']);

  // 18–21. Save, sign out, sign in, reopen: everything persisted.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  await page.getByRole('link', { name: /Back to Plans/ }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page);
  await row(page, NAME).getByRole('link', { name: 'Open' }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  const reopened = await floor(page);
  expect(reopened.surveyFindings).toEqual(edited.surveyFindings);
  expect(reopened.recommendedWorks).toEqual(edited.recommendedWorks);

  // 22. Exports: PNG and PDF render; the SVG shows the two layers differently.
  const png = await download(page, 'Export 2D as PNG');
  expect(png.byteLength).toBeGreaterThan(1000);
  if (process.env.NORTHWAY_SAVE_EXPORTS) {
    await writeFile(`${process.env.NORTHWAY_SAVE_EXPORTS}/stage4-plan.png`, png);
    await page.screenshot({ path: `${process.env.NORTHWAY_SAVE_EXPORTS}/stage4-editor.png` });
  }
  expect((await download(page, 'Export as PDF')).byteLength).toBeGreaterThan(1000);
  const svg = (await download(page, 'Export as SVG')).toString('utf8');
  expect(svg.match(/data-survey-finding="(\w+)"/g)).toEqual(['data-survey-finding="HM"', 'data-survey-finding="WM"', 'data-survey-finding="DP"']);
  expect(svg.match(/data-recommended-work="(\w+)"/g)).toEqual(['data-recommended-work="WT"', 'data-recommended-work="VI"', 'data-recommended-work="REC"']);
  expect(svg).toContain('<pattern id="nw-hatch-');
  expect(svg).toContain('stroke-dasharray="7 4"');

  // 23–24. Duplicate from the library; the copy keeps both layers.
  await page.getByRole('link', { name: /Back to Plans/ }).click();
  await row(page, NAME).getByRole('button', { name: 'Duplicate' }).click();
  await row(page, `${NAME} (Copy)`).getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  expect(page.url()).not.toBe(projectUrl);
  const copy = await floor(page);
  expect(copy.surveyFindings).toEqual(edited.surveyFindings);
  expect(copy.recommendedWorks).toEqual(edited.recommendedWorks);
  expect(errors).toEqual([]);
});
