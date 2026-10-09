import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Northway Stage 2: survey object library and Survey Findings issue areas.

async function importPlan(page: Page, file: string) {
  await page.getByRole('button', { name: 'Export', exact: true }).press('Enter');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import JSON', exact: true }).press('Enter');
  await (await chooser).setFiles(resolve(file));
}

async function exportJSON(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 8 });
  await page.mouse.up();
}

test('survey plan: fixtures only, issue areas, layer toggle, save and export', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/editor');
  // The browser suite starts in the full library for upstream specs; use the app default.
  await page.evaluate(() => localStorage.setItem('o3d_settings', JSON.stringify({ objectLibrary: 'survey' })));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  await importPlan(page, 'test-roomplan.json');
  const status = page.getByRole('application');
  await expect(status).toContainText('20 walls');
  // RoomPlan furniture is kept in the data but only the toilet and basin are shown.
  await expect(status).toContainText('2 objects');
  expect((await exportJSON(page)).floors[0].furniture).toHaveLength(13);

  // The Objects tab offers only the short Fixed Fixtures group.
  await page.getByRole('button', { name: 'Objects', exact: true }).click();
  const fixtures = page.locator('[data-fixed-fixtures]');
  await expect(fixtures.getByRole('button')).toHaveText([/Kitchen unit/, /Kitchen sink/, /Hob/, /Toilet/, /Basin/, /Bath/, /Shower/, /Chimney breast/, /Stairs/]);
  await expect(page.getByText('Queen Bed')).toHaveCount(0);
  await page.getByRole('button', { name: 'Build', exact: true }).click();

  // Exact pointer-to-world mapping for the handle checks below.
  await page.getByRole('button', { name: 'Snap to Grid', exact: true }).click();

  // HM: arm the preset and drag a rectangle.
  await page.getByRole('button', { name: 'Add Issue Area' }).click();
  await page.getByRole('button', { name: /High Moisture/ }).click();
  await drag(page, [560, 230], [700, 330]);
  let zones = (await exportJSON(page)).floors[0].surveyFindings;
  expect(zones).toHaveLength(1);
  expect(zones[0]).toMatchObject({ code: 'HM', layer: 'survey-findings', shape: 'rect' });
  const zoom = 140 / zones[0].width;

  // WM, drawn while HM is selected, so the layout is stable from here on.
  await page.getByRole('button', { name: /Woodworm Activity/ }).click();
  await drag(page, [820, 420], [960, 520]);
  zones = (await exportJSON(page)).floors[0].surveyFindings;
  expect(zones.map((z: any) => z.code)).toEqual(['HM', 'WM']);
  const wm = zones[1];
  expect(wm.width).toBeCloseTo(140 / zoom, 0);
  expect(wm.height).toBeCloseTo(100 / zoom, 0);

  // Resize WM from its south-east handle, then move it by its interior.
  await drag(page, [960, 520], [1000, 550]);
  let resized = (await exportJSON(page)).floors[0].surveyFindings[1];
  expect(resized.x).toBeCloseTo(wm.x, 3);
  expect(resized.width).toBeCloseTo(wm.width + 40 / zoom, 0);
  expect(resized.height).toBeCloseTo(wm.height + 30 / zoom, 0);
  await drag(page, [880, 470], [930, 450]);
  const moved = (await exportJSON(page)).floors[0].surveyFindings[1];
  expect(moved.x).toBeCloseTo(resized.x + 50 / zoom, 0);
  expect(moved.y).toBeCloseTo(resized.y - 20 / zoom, 0);
  expect(moved.width).toBeCloseTo(resized.width, 3);

  // Change type, undo it, and confirm the walls underneath did not move.
  const panel = page.locator('[data-issue-area-properties]');
  await panel.getByRole('combobox', { name: 'Issue type' }).selectOption('DR');
  expect((await exportJSON(page)).floors[0].surveyFindings[1].code).toBe('DR');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const afterUndo = await exportJSON(page);
  expect(afterUndo.floors[0].surveyFindings[1].code).toBe('WM');

  // Duplicate and delete.
  await panel.getByRole('button', { name: 'Duplicate' }).click();
  expect((await exportJSON(page)).floors[0].surveyFindings).toHaveLength(3);
  await page.locator('[data-issue-area-properties]').getByRole('button', { name: 'Delete' }).click();
  const beforeGrab = (await exportJSON(page)).floors[0].surveyFindings;
  expect(beforeGrab).toHaveLength(2);

  // Nothing is selected now, so the canvas has its original layout. Grabbing HM
  // selects it and opens the properties panel mid-gesture; the area must still
  // follow the pointer exactly instead of jumping with the re-centred canvas.
  await drag(page, [630, 280], [660, 300]);
  const grabbed = (await exportJSON(page)).floors[0].surveyFindings[0];
  expect(grabbed.x).toBeCloseTo(beforeGrab[0].x + 30 / zoom, 0);
  expect(grabbed.y).toBeCloseTo(beforeGrab[0].y + 20 / zoom, 0);
  await expect(page.locator('[data-issue-area-properties]')).toBeVisible();

  // Hide and show the layer without losing zones.
  await page.getByRole('button', { name: 'Hide Survey Findings' }).click();
  expect((await exportJSON(page)).floors[0].surveyFindings).toHaveLength(2);
  await page.getByRole('button', { name: 'Show Survey Findings' }).click();

  // Save, reload and keep everything.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved ✓', { exact: true })).toBeVisible();
  const saved = await exportJSON(page);
  await page.reload();
  await expect(status).toContainText('2 objects');
  expect(await exportJSON(page)).toEqual(saved);
  expect(saved.floors[0].walls).toEqual(afterUndo.floors[0].walls);

  // PNG and PDF exports complete.
  for (const label of ['Export 2D as PNG', 'Export as PDF']) {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: label, exact: true }).click();
    expect((await readFile((await (await download).path())!)).byteLength).toBeGreaterThan(1000);
  }

  // The full object library shows the movable furniture again.
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('o3d_settings') || '{}');
    localStorage.setItem('o3d_settings', JSON.stringify({ ...settings, objectLibrary: 'full' }));
  });
  await page.reload();
  await expect(status).toContainText('13 objects');
  expect(errors).toEqual([]);
});
