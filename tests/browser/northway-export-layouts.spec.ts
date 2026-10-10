import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Northway Stage 5: report exports for awkward plans. A large multi-room RoomPlan scan with a long
// legend, a long narrow plan, and a second floor exported on its own. Uses the signed-in local editor.
const SAVE = process.env.NORTHWAY_SAVE_EXPORTS;
const LONG = 'Elevated moisture readings recorded with a calibrated meter along the base of the wall, consistent with bridging of the damp-proof course by raised external ground levels';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('o3d_settings', JSON.stringify({ objectLibrary: 'survey' })));
});

const PRIORITY_CYCLE = ['3 — Priority Work', '2 — Recommended Work', '1 — Advisory Work', 'FI — Further Investigation'];
let recommendationCount = 0;

async function addPin(page: Page, layer: 'Finding' | 'Recommendation', at: [number, number], description: string) {
  if (layer === 'Recommendation') {
    // Stage 6: a recommendation is described (priority and text) before it is placed.
    await page.getByRole('button', { name: 'Add Recommendation Pin' }).click();
    const form = page.getByRole('dialog', { name: 'New recommendation pin' });
    await form.getByRole('radio', { name: PRIORITY_CYCLE[recommendationCount++ % 4] }).click();
    await form.getByRole('textbox', { name: 'Recommendation' }).fill(description);
    await form.getByRole('button', { name: 'Place Pin' }).click();
    await page.mouse.click(...at);
    return;
  }
  await page.getByRole('button', { name: `Add ${layer} Pin` }).click();
  await page.mouse.click(...at);
  const dialog = page.getByRole('dialog', { name: `${layer} pin` });
  await dialog.getByRole('textbox', { name: 'Description' }).fill(description);
  await dialog.getByRole('button', { name: 'Add Pin' }).click();
  await expect(dialog).toBeHidden();
}

function pngSize(png: Buffer) { return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }; }

async function exportPng(page: Page, view: string, name: string, address?: string) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: /Survey Plan \(PNG \/ PDF\)/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Export survey plan' });
  if (address) await dialog.getByRole('textbox', { name: 'Property address' }).fill(address);
  await dialog.getByRole('radio', { name: view }).check();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download PNG (300 dpi)' }).click();
  const file = await download;
  const png = await readFile((await file.path())!);
  if (SAVE) await writeFile(`${SAVE}/${name}`, png);
  await dialog.getByRole('button', { name: 'Close' }).click();
  return { png, filename: file.suggestedFilename() };
}

test('large scan with a long legend, and a second floor exported on its own', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/editor');
  await page.getByRole('button', { name: 'Export', exact: true }).press('Enter');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import JSON', exact: true }).press('Enter');
  await (await chooser).setFiles(resolve('test-roomplan.json'));
  await expect(page.getByRole('application')).toContainText('20 walls');
  const canvas = page.getByRole('application').locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);

  await addPin(page, 'Finding', [cx - 150, cy - 80], LONG);
  for (let i = 0; i < 11; i++) await addPin(page, 'Finding', [cx - 200 + i * 35, cy + 60 - (i % 3) * 40], `Finding note ${i + 2}: ${LONG.slice(0, 40 + i * 9)}`);
  for (let i = 0; i < 6; i++) await addPin(page, 'Recommendation', [cx - 180 + i * 60, cy - 20], `Recommended work ${i + 1}: install additional subfloor ventilation to this elevation`);
  const combined = await exportPng(page, 'Combined Plan', 'stage5-large-combined.png', '27 Main Street, York YO1 7HH');
  expect(combined.filename).toMatch(/^27-Main-Street-.+-Combined-Plan\.png$/);
  expect(pngSize(combined.png).width).toBe(2008); // Word report width at 300 dpi

  // A second floor: exported on its own, named in the export dialog.
  await page.getByRole('button', { name: 'Add Floor', exact: true }).click();
  await page.getByRole('button', { name: /Exterior walls/ }).click();
  await addPin(page, 'Finding', [cx, cy], 'Restricted inspection of roof space');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: /Survey Plan \(PNG \/ PDF\)/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Export survey plan' });
  await expect(dialog.getByRole('combobox', { name: 'Floor', exact: true })).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Plan / floor name' }).fill('Roof Space');
  await dialog.getByRole('combobox', { name: 'Plan / floor name' }).press('Tab');
  await dialog.getByRole('textbox', { name: 'Property address' }).fill('27 Main Street, York YO1 7HH');
  await expect(dialog.locator('[data-export-filename]')).toHaveText('27-Main-Street-Roof-Space-Survey-Findings.png');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download PNG (300 dpi)' }).click();
  const png = await readFile((await (await download).path())!);
  if (SAVE) await writeFile(`${SAVE}/stage5-second-floor.png`, png);
  // The first floor is still selectable, and keeps its own name.
  const options = await dialog.getByRole('combobox', { name: 'Floor', exact: true }).locator('option').allTextContents();
  expect(options).toHaveLength(2);
  expect(options[1]).toBe('Roof Space');
  await dialog.getByRole('button', { name: 'Close' }).click();
  expect(errors).toEqual([]);
});

test('long narrow plan keeps its proportions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/editor');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  const canvas = page.getByRole('application').locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);
  // A corridor-shaped plan, much taller than wide.
  const corners: [number, number][] = [[cx - 40, cy - 300], [cx + 40, cy - 300], [cx + 40, cy + 300], [cx - 40, cy + 300]];
  await page.getByRole('button', { name: /Draw Wall/ }).click();
  for (const [x, y] of corners) await page.mouse.click(x, y);
  await page.mouse.click(...corners[0]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Fit', exact: false }).first().click().catch(() => {});
  const view = await canvas.boundingBox();
  await addPin(page, 'Finding', [Math.round(view!.x + view!.width / 2), Math.round(view!.y + view!.height / 2)], 'Damp staining to corridor ceiling');
  const exported = await exportPng(page, 'Survey Findings Plan', 'stage5-narrow.png', 'Flat 3, 8 Long Row, Hull');
  const size = pngSize(exported.png);
  expect(size.height).toBeGreaterThan(size.width); // portrait page for a tall plan
  expect(errors).toEqual([]);
});
