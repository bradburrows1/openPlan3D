import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { LOCAL_STAFF } from '../../tooling/northway-supabase/local-stack.mjs';

// Northway Stage 7: iPad behaviour (real multi-touch through the DevTools protocol), saving while
// offline, a session that ends while editing, delete safety and the installable web app.
test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1180, height: 820 }, hasTouch: true });

const BRAD = LOCAL_STAFF[0];
const RUN = Date.now().toString(36);

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(BRAD.email);
  await page.getByLabel('Password').fill(BRAD.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('button', { name: 'New Plan' })).toBeVisible();
}

async function newPlan(page: Page, name: string) {
  await page.getByRole('button', { name: 'New Plan' }).click();
  await page.getByRole('button', { name: /Blank Plan/ }).click();
  await page.getByLabel(/Project name/).fill(name);
  await page.getByRole('button', { name: 'Create Plan' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  const canvas = page.getByRole('application').locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);
  const corners: [number, number][] = [[cx - 260, cy - 180], [cx + 260, cy - 180], [cx + 260, cy + 180], [cx - 260, cy + 180]];
  await page.getByRole('button', { name: /Draw Wall/ }).click();
  await page.mouse.click(...corners[0]); await page.mouse.click(...corners[1]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: /Draw Wall/ }).click();
  for (const [x, y] of corners) await page.mouse.click(x, y);
  await page.mouse.click(...corners[0]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('s'); // grid snapping off (the toolbar button is hidden at iPad width)
  return { canvas, box, cx, cy };
}

async function projectJson(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
}

/** Multi-touch through the DevTools protocol: each event lists every finger still down. */
function touches(cdp: CDPSession) {
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: [number, number][]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
  return {
    async tap(x: number, y: number, jitter = 0) {
      await send('touchStart', [[x, y]]);
      if (jitter) await send('touchMove', [[x + jitter, y + jitter / 2]]);
      await send('touchEnd', []);
    },
    async drag(from: [number, number], to: [number, number], steps = 8) {
      await send('touchStart', [from]);
      await new Promise(resolve => setTimeout(resolve, 160)); // a deliberate press, not the start of a pinch
      for (let i = 1; i <= steps; i++) await send('touchMove', [[from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps]]);
      await send('touchEnd', []);
    },
    /** Two fingers: the first lands, the second follows quickly, then they spread and move. */
    async pinch(cx: number, cy: number) {
      await send('touchStart', [[cx - 40, cy]]);
      await new Promise(resolve => setTimeout(resolve, 30));
      await send('touchStart', [[cx - 40, cy], [cx + 40, cy]]);
      for (let i = 1; i <= 6; i++) await send('touchMove', [[cx - 40 - i * 10, cy + i * 5], [cx + 40 + i * 10, cy + i * 5]]);
      await send('touchEnd', []);
    },
  };
}

test('iPad touch: pinch never draws, taps select without nudging, fingers can drag and resize', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await signIn(page);
  const { canvas, box, cx, cy } = await newPlan(page, `iPad touch ${RUN}`);
  const cdp = await page.context().newCDPSession(page);
  const touch = touches(cdp);
  const findings = page.locator('[data-survey-findings]');
  const badge = page.locator('[data-reference-badge]');

  // With + Pin armed, a two-finger pinch zooms and pans the plan but places nothing.
  await findings.getByRole('button', { name: 'Add Finding Pin' }).click();
  const zoomBefore = await page.getByRole('application').textContent();
  await touch.pinch(cx, cy);
  await expect(page.getByRole('dialog', { name: 'Finding pin' })).toHaveCount(0);
  expect(await page.getByRole('application').textContent()).not.toBe(zoomBefore); // the zoom level changed
  expect((await projectJson(page)).floors[0].overlayPins ?? []).toHaveLength(0);
  await expect(findings.getByRole('button', { name: 'Add Finding Pin' })).toHaveAttribute('aria-pressed', 'true'); // still armed

  // A single tap places the pin.
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await touch.tap(cx + 100, cy - 60);
  const dialog = page.getByRole('dialog', { name: 'Finding pin' });
  await dialog.getByRole('textbox', { name: 'Description' }).fill('Defective rainwater goods above this location');
  await dialog.getByRole('button', { name: 'Add Pin' }).click();
  await expect(badge).toHaveText('F1');
  const placed = (await projectJson(page)).floors[0].overlayPins[0];

  // Select something else, then tap the pin with a 6 px wobble: selected, not moved.
  await page.keyboard.press('Escape');
  await expect(badge).toHaveCount(0);
  const s = Math.round(((await canvas.boundingBox())!.width - box.width) / 2);
  await touch.tap(cx + 100 + s, cy - 60, 6);
  await expect(badge).toHaveText('F1');
  expect((await projectJson(page)).floors[0].overlayPins[0]).toEqual(placed);

  // A deliberate finger drag moves it.
  const s2 = Math.round(((await canvas.boundingBox())!.width - box.width) / 2);
  await touch.drag([cx + 100 + s2, cy - 60], [cx + 160 + s2, cy - 20]);
  const moved = (await projectJson(page)).floors[0].overlayPins[0];
  expect(moved.ref).toBe('F1');
  expect(moved.x).toBeGreaterThan(placed.x + 20);

  // An area's resize handle can be grabbed with a finger a little outside the mouse-sized target.
  await findings.getByRole('button', { name: 'Add Issue Area' }).click();
  await findings.getByRole('button', { name: /High Moisture/ }).click();
  await page.mouse.move(cx - 220 + s2, cy - 150); await page.mouse.down();
  await page.mouse.move(cx - 100 + s2, cy - 60, { steps: 6 }); await page.mouse.up();
  const area = (await projectJson(page)).floors[0].surveyFindings[0];
  const s3 = Math.round(((await canvas.boundingBox())!.width - box.width) / 2);
  await touch.drag([cx - 100 + s3 + 14, cy - 60 + 14], [cx - 40 + s3 + 14, cy - 20 + 14]); // 14 px off the corner
  const resized = (await projectJson(page)).floors[0].surveyFindings[0];
  expect(resized.width).toBeGreaterThan(area.width + 20);
  expect(resized.x).toBeCloseTo(area.x, 3);

  // Touch-sized controls on the iPad.
  for (const name of ['Undo', 'Redo', 'Save']) {
    const size = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
    expect(size.height).toBeGreaterThanOrEqual(40);
    expect(size.width).toBeGreaterThanOrEqual(40);
  }
  // Upstream 3D, elevation and DXF/DWG are not offered in the Northway editor.
  await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export as DXF' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export 3D as PNG' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Survey Plan/ })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('offline saving, an ended session and delete safety keep work safe', async ({ page, context }) => {
  test.slow();
  await signIn(page);
  const NAME = `Reliability ${RUN}`;
  const { cx, cy } = await newPlan(page, NAME);
  const projectUrl = page.url();
  const state = page.locator('[data-cloud-save-state]');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(state).toHaveText('Saved');

  // Offline: clearly shown, a save fails honestly, nothing is lost; back online, Save works.
  await context.setOffline(true);
  await expect(page.locator('[data-offline-banner]')).toContainText('Changes are not yet saved to Northway Plans');
  const findings = page.locator('[data-survey-findings]');
  await findings.getByRole('button', { name: 'Add Finding Pin' }).click();
  await page.mouse.click(cx, cy);
  await page.getByRole('dialog', { name: 'Finding pin' }).getByRole('textbox', { name: 'Description' }).fill('Noted in the cellar with no signal');
  await page.getByRole('dialog', { name: 'Finding pin' }).getByRole('button', { name: 'Add Pin' }).click();
  await expect(state).toHaveText('Offline — not saved');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-cloud-save-error]')).toContainText('could not be saved. Your changes remain on this device');
  await expect(state).not.toHaveText('Saved');
  await context.setOffline(false);
  await expect(page.locator('[data-offline-banner]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(state).toHaveText('Saved');
  await expect(page.locator('[data-cloud-save-error]')).toHaveCount(0);

  // Session ends while editing (signed out in another tab): edits are kept, the user is told why,
  // and signing in returns to the same plan with the edits offered back.
  await findings.getByRole('button', { name: 'Add Finding Pin' }).click();
  await page.mouse.click(cx + 80, cy + 40);
  await page.getByRole('dialog', { name: 'Finding pin' }).getByRole('textbox', { name: 'Description' }).fill('Edit made just before the session ended');
  await page.getByRole('dialog', { name: 'Finding pin' }).getByRole('button', { name: 'Add Pin' }).click();
  await expect(state).toHaveText('Unsaved changes');
  const other = await context.newPage();
  await other.goto('/');
  await other.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login\?expired=1&next=%2Fprojects%2F/);
  await expect(page.locator('[data-session-expired]')).toContainText('unsaved changes were kept on this device');
  await other.close();
  await page.getByLabel('Email').fill(BRAD.email);
  await page.getByLabel('Password').fill(BRAD.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(projectUrl);
  await expect(page.locator('[data-recovery-offer]')).toBeVisible();
  await page.getByRole('button', { name: 'Restore my changes' }).click();
  const restored = await projectJson(page);
  expect(restored.floors[0].overlayPins.map((p: any) => p.description)).toContain('Edit made just before the session ended');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(state).toHaveText('Saved');

  // Delete: confirmation always; an immediate second tap cannot confirm.
  await page.getByRole('link', { name: /Back to Plans/ }).click();
  const row = page.locator('[data-plan-row]').filter({ has: page.getByRole('link', { name: NAME, exact: true }) });
  await row.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.locator('[data-delete-confirm]');
  await expect(confirm).toBeDisabled();
  await expect(confirm).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toBeVisible(); // nothing was deleted
});

test('installable web app: manifest, icons and home-screen metadata', async ({ page, request }) => {
  await page.goto('/login');
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBe('/manifest.webmanifest');
  const manifest = await (await request.get(manifestHref!)).json();
  expect(manifest).toMatchObject({ name: 'Northway Plans', short_name: 'Northway Plans', display: 'standalone', start_url: '/', theme_color: '#083335', background_color: '#ffffff' });
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect((await request.get(apple!)).headers()['content-type']).toContain('image/png');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Northway Plans');
});
