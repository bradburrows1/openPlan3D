import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LOCAL_STAFF } from '../../tooling/northway-supabase/local-stack.mjs';

// Northway Stage 3: sign-in, the plan library and saving/reopening editable plans.
// Runs against the local Supabase stack (see playwright.config.ts global setup).
test.use({ storageState: { cookies: [], origins: [] } }); // start signed out

const BRAD = LOCAL_STAFF[0];
// Unique per run, so plans from earlier runs against the same stack never collide.
const RUN = Date.now().toString(36);
const NAME = `Stage 3 Test Property ${RUN}`;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(BRAD.email);
  await page.getByLabel('Password').fill(BRAD.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('button', { name: 'New Plan' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
}

async function exportedJSON(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...from); await page.mouse.down();
  await page.mouse.move(...to, { steps: 8 }); await page.mouse.up();
}

const row = (page: Page, name: string) => page.locator('[data-plan-row]').filter({ has: page.getByRole('link', { name, exact: true }) });

test('signed-out visitors cannot reach the library, the editors or plan data', async ({ page }) => {
  for (const path of ['/', '/local', '/editor', '/projects/00000000-0000-4000-8000-000000000000']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
  await expect(page.getByRole('heading', { name: 'Northway Plans' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Northway Preservation' })).toBeVisible();
  await expect(page.getByText('Floor plans for Northway Preservation')).toBeVisible();
  await page.getByLabel('Email').fill(BRAD.email);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('alert')).toHaveText('The email or password is incorrect.');
});

test('Stage 3 workflow: create, draw, find, save, reopen, edit, export, duplicate, delete', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  await expect(page.getByRole('img', { name: 'Northway Preservation' })).toBeVisible();

  // 4. New blank plan named "Stage 3 Test Property".
  await page.getByRole('button', { name: 'New Plan' }).click();
  await page.getByRole('button', { name: /Blank Plan/ }).click();
  await page.getByLabel(/Project name/).fill(NAME);
  await page.getByLabel(/Property address/).fill('1 Test Street');
  await page.getByRole('button', { name: 'Create Plan' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const projectUrl = page.url();
  await expect(page.getByRole('button', { name: NAME })).toBeVisible();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');

  // 5–7. Draw a room, add a door, a window, a fixture and HM/WM issue areas.
  const canvas = page.getByRole('application').locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);
  const corners: [number, number][] = [[cx - 200, cy - 140], [cx + 200, cy - 140], [cx + 200, cy + 140], [cx - 200, cy + 140]];
  // The canvas zooms to fit its first content once; let that happen on a wall we then undo.
  await page.getByRole('button', { name: /Draw Wall/ }).click();
  await page.mouse.click(...corners[0]); await page.mouse.click(...corners[1]);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Unsaved changes');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved'); // back to the saved plan
  await page.getByRole('button', { name: /Draw Wall/ }).click();
  for (const [x, y] of corners) await page.mouse.click(x, y);
  await page.mouse.click(...corners[0]);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Unsaved changes');
  await page.getByRole('button', { name: /^Single/ }).first().click();
  await page.mouse.click(cx, cy - 140);
  await page.getByRole('button', { name: /^Standard/ }).first().click();
  await page.mouse.click(cx + 200, cy);
  await page.getByRole('button', { name: 'Objects', exact: true }).click();
  await page.locator('[data-fixed-fixtures]').getByRole('button', { name: /Toilet/ }).click();
  await page.mouse.click(cx - 150, cy + 100);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('button', { name: 'Add Issue Area' }).click();
  await page.getByRole('button', { name: /High Moisture/ }).click();
  await drag(page, [cx - 180, cy - 120], [cx - 60, cy - 40]);
  // HM is now selected and the properties panel narrows the canvas, re-centring the plan.
  const shift = Math.round(((await canvas.boundingBox())!.width - box.width) / 2);
  await page.getByRole('button', { name: /Woodworm Activity/ }).click();
  await drag(page, [cx + 40 + shift, cy + 20], [cx + 160 + shift, cy + 110]);
  const drawn = (await exportedJSON(page)).floors[0];
  expect(drawn.walls).toHaveLength(4);
  expect(drawn.doors).toHaveLength(1);
  expect(drawn.windows).toHaveLength(1);
  expect(drawn.furniture.map((f: any) => f.catalogId)).toEqual(['toilet']);
  expect(drawn.surveyFindings.map((z: any) => z.code)).toEqual(['HM', 'WM']);

  // 8. Save.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');

  // 9–10. Back to the library; the plan is listed first.
  await page.getByRole('link', { name: /Back to Plans/ }).click();
  await expect(page.locator('[data-plan-row]').first()).toContainText(NAME);
  await expect(row(page, NAME)).toContainText('1 Test Street');
  await page.getByRole('searchbox').fill(`test street ${RUN}`);
  await expect(page.locator('[data-plan-row]')).toHaveCount(1);
  await page.getByRole('searchbox').fill('');

  // 11–12. Sign out, sign back in.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(projectUrl);
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page);

  // 13–14. Reopen: the complete editable plan is restored.
  await row(page, NAME).getByRole('link', { name: 'Open' }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  const reopened = (await exportedJSON(page)).floors[0];
  for (const key of ['walls', 'doors', 'windows', 'furniture', 'surveyFindings']) expect(reopened[key]).toEqual(drawn[key]);

  // 15. Move a wall: lengthen Wall 1, which moves its end point.
  await page.getByRole('button', { name: 'Toggle Layers Panel', exact: true }).click();
  await page.getByRole('button', { name: /Wall 1$/ }).click();
  const length = page.getByRole('textbox', { name: /^Length/ }).or(page.getByRole('spinbutton', { name: /^Length/ })).first();
  await length.fill('450');
  await length.press('Enter');
  const moved = (await exportedJSON(page)).floors[0];
  expect(moved.walls).not.toEqual(reopened.walls);
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Unsaved changes');

  // Leaving with unsaved changes asks first; dismissing keeps the editor open.
  page.once('dialog', dialog => { expect(dialog.message()).toContain('unsaved changes'); void dialog.dismiss(); });
  await page.getByRole('link', { name: /Back to Plans/ }).click();
  await expect(page).toHaveURL(projectUrl);

  // 16–17. Rename in the editor and save again.
  await page.getByRole('button', { name: NAME }).click();
  await page.getByRole('textbox', { name: 'Project name' }).fill(`${NAME} - revisited`);
  await page.getByRole('textbox', { name: 'Project name' }).press('Enter');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');

  // 18. Export PNG (and the PDF) still work.
  for (const label of ['Export 2D as PNG', 'Export as PDF']) {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: label, exact: true }).click();
    expect((await readFile((await (await download).path())!)).byteLength).toBeGreaterThan(1000);
  }

  // 19–20. Duplicate from the library; the copy is independently editable.
  await page.getByRole('link', { name: /Back to Plans/ }).click();
  await row(page, `${NAME} - revisited`).getByRole('button', { name: 'Duplicate' }).click();
  const copyRow = row(page, `${NAME} - revisited (Copy)`);
  await expect(copyRow).toBeVisible();
  await copyRow.getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const copyUrl = page.url();
  expect(copyUrl).not.toBe(projectUrl);
  const copy = (await exportedJSON(page)).floors[0];
  expect(copy.walls).toEqual(moved.walls);
  expect(copy.surveyFindings).toEqual(moved.surveyFindings);
  // Edit the copy only: thicken Wall 1.
  await page.getByRole('button', { name: 'Toggle Layers Panel', exact: true }).click();
  await page.getByRole('button', { name: /Wall 1$/ }).click();
  const thickness = page.getByRole('spinbutton', { name: 'Thickness (cm)', exact: true });
  await thickness.fill('35');
  await thickness.press('Tab');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  expect((await exportedJSON(page)).floors[0].walls[0].thickness).toBe(35);
  await page.goto(projectUrl);
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  expect((await exportedJSON(page)).floors[0].walls).toEqual(moved.walls);

  // Rename details from the library.
  await page.getByRole('link', { name: /Back to Plans/ }).click();
  await row(page, `${NAME} - revisited`).getByRole('button', { name: 'Rename' }).click();
  await page.getByLabel(/Customer name/).fill('Smith');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(row(page, `${NAME} - revisited`)).toContainText('Smith');

  // 21. Delete the duplicate after confirming.
  await row(page, `${NAME} - revisited (Copy)`).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('heading', { name: `Delete "${NAME} - revisited (Copy)"?` })).toBeVisible();
  await expect(page.getByText('This cannot be undone.')).toBeVisible();
  await page.getByRole('dialog', { name: 'Delete plan' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row(page, `${NAME} - revisited (Copy)`)).toHaveCount(0);
  await expect(row(page, `${NAME} - revisited`)).toHaveCount(1);
  await page.goto(copyUrl);
  await expect(page.getByText('This plan could not be found.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('imports a RoomPlan scan and an OpenPlan3D file as library plans', async ({ page }) => {
  await signIn(page);
  for (const [file, expected] of [['test-roomplan.json', 'test-roomplan'], ['tests/fixtures/connected-dimensions.openplan.json', null]] as const) {
    await page.getByRole('button', { name: 'New Plan' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Import Plan/ }).click();
    await (await chooser).setFiles(resolve(file));
    const name = page.getByLabel(/Project name/);
    if (expected) await expect(name).toHaveValue(expected);
    await name.fill(`Imported ${file.split('/').pop()} ${RUN}`);
    await page.getByRole('button', { name: 'Create Plan' }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    const floor = (await exportedJSON(page)).floors[0];
    expect(floor.walls.length).toBeGreaterThan(0);
    await page.getByRole('link', { name: /Back to Plans/ }).click();
    await expect(row(page, `Imported ${file.split('/').pop()} ${RUN}`)).toBeVisible();
  }
});

test('a failed save keeps the edits, says so, and recovers them after a reload', async ({ page, context }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'New Plan' }).click();
  await page.getByRole('button', { name: /Blank Plan/ }).click();
  await page.getByLabel(/Project name/).fill(`Offline save test ${RUN}`);
  await page.getByRole('button', { name: 'Create Plan' }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  const canvas = page.getByRole('application').locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  await page.getByRole('button', { name: 'Add Issue Area' }).click();
  await page.getByRole('button', { name: /Condensation/ }).click();
  await drag(page, [box.x + 300, box.y + 200], [box.x + 420, box.y + 280]);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-cloud-save-error]')).toContainText('Your changes remain on this device');
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Offline — not saved');
  await context.setOffline(false);
  page.once('dialog', dialog => void dialog.accept());
  await page.reload();
  await expect(page.locator('[data-recovery-offer]')).toBeVisible();
  await page.getByRole('button', { name: 'Restore my changes' }).click();
  expect((await exportedJSON(page)).floors[0].surveyFindings.map((z: any) => z.code)).toEqual(['CD']);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('[data-recovery-offer]')).toHaveCount(0);
  expect((await exportedJSON(page)).floors[0].surveyFindings.map((z: any) => z.code)).toEqual(['CD']);
});
