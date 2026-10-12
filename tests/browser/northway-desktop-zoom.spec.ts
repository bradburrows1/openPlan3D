import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { LOCAL_STAFF } from '../../tooling/northway-supabase/local-stack.mjs';

// Laptop and desktop zoom on a realistic Northway plan: rooms, doors, windows, a dimension, finding
// and recommendation areas, a pin and a line. Mouse-wheel clicks (slow and fast), trackpad scroll
// and pinch, pan, then selecting, moving, resizing and drawing after zooming. Every overlay label
// must keep the same position relative to the plan at every zoom level (no drift), and the plan
// point under the cursor must stay under it.
test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 900 } });

const BRAD = LOCAL_STAFF[0];
const LABELS = ['F1', 'F2', 'F3', 'R1', 'Marker A', 'Marker B'];
/** World anchor of each label: the finding area's top-left and the recommendation area's top-right corner (where their codes sit), the pin, the line's middle. */
const ANCHORS: Record<string, { x: number; y: number }> = { F1: { x: 50, y: 50 }, R1: { x: 530, y: 220 }, F2: { x: 300, y: 110 }, F3: { x: 300, y: 380 } };

async function plan() {
  const project = JSON.parse(await readFile('tests/fixtures/legacy-furniture-previews.openplan.json', 'utf8'));
  const floor = project.floors[0];
  floor.furniture = [];
  floor.measurements = [{ id: 'dim', x1: 0, y1: -60, x2: 600, y2: -60 }];
  floor.textAnnotations = [['A', 100], ['B', 500]].map(([k, x]) => ({ id: `m${k}`, x, y: 470, text: `Marker ${k}`, fontSize: 14, rotation: 0, color: '#123456' }));
  floor.surveyFindings = [{ id: 'zf', layer: 'survey-findings', ref: 'F1', code: 'HM', name: 'High Moisture', color: '#3b82c4', preset: 'HM', shape: 'rect', x: 50, y: 50, width: 150, height: 100 }];
  floor.recommendedWorks = [{ id: 'zr', layer: 'recommended-works', ref: 'R1', code: 'VI', name: 'Improve subfloor ventilation', color: '#b8443d', preset: 'VI', priority: 'priority_3', workType: 'VI', shape: 'rect', x: 350, y: 220, width: 180, height: 120 }];
  floor.overlayPins = [{ id: 'pf', layer: 'survey-findings', ref: 'F2', description: 'Defective rainwater goods above', color: '#9466ad', x: 300, y: 110 }];
  floor.overlayLines = [{ id: 'lf', layer: 'survey-findings', ref: 'F3', description: 'Elevated moisture along base of wall', color: '#3b82c4', points: [{ x: 20, y: 380 }, { x: 580, y: 380 }] }];
  project.surveyReferences = { F: 3, R: 1 };
  return Buffer.from(JSON.stringify(project));
}

async function openPlan(page: Page) {
  await page.addInitScript(labels => {
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
      if (labels.includes(text) && this.canvas.getAttribute('aria-label') === 'Floor plan editor canvas') {
        const p = new DOMPoint(x, y).matrixTransform(this.getTransform()), b = this.canvas.getBoundingClientRect();
        ((window as any).__labels ??= {})[text] = { x: b.x + p.x * b.width / this.canvas.width, y: b.y + p.y * b.height / this.canvas.height };
      }
      return maxWidth === undefined ? fill.call(this, text, x, y) : fill.call(this, text, x, y, maxWidth);
    };
  }, LABELS);
  await page.goto('/login');
  await page.getByLabel('Email').fill(BRAD.email);
  await page.getByLabel('Password').fill(BRAD.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByRole('button', { name: 'New Plan' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Import Plan/ }).click();
  await (await chooser).setFiles({ name: 'zoom-test.openplan.json', mimeType: 'application/json', buffer: await plan() });
  await page.getByLabel(/Project name/).fill(`Zoom test ${Date.now().toString(36)}`);
  await page.getByRole('button', { name: 'Create Plan' }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  await expect.poll(() => page.evaluate(labels => labels.every(l => (window as any).__labels?.[l]), LABELS)).toBe(true);
}

/** Where the plan is: the screen scale (px per cm) and a world → screen mapping from the two markers. */
async function view(page: Page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const labels = await page.evaluate(() => JSON.parse(JSON.stringify((window as any).__labels)));
  const scale = (labels['Marker B'].x - labels['Marker A'].x) / 400;
  const origin = { x: labels['Marker A'].x - 100 * scale, y: labels['Marker A'].y - 470 * scale };
  const toScreen = (w: { x: number; y: number }) => ({ x: origin.x + w.x * scale, y: origin.y + w.y * scale });
  /** Each overlay label's screen offset from its world anchor: constant at every zoom unless it drifts. */
  const offsets = Object.fromEntries(Object.entries(ANCHORS).map(([label, anchor]) => {
    const at = toScreen(anchor);
    return [label, { x: labels[label].x - at.x, y: labels[label].y - at.y }];
  }));
  return { scale, toScreen, offsets };
}

function expectNoDrift(reference: Awaited<ReturnType<typeof view>>, now: Awaited<ReturnType<typeof view>>, step: string) {
  for (const label of Object.keys(ANCHORS)) {
    expect(Math.abs(now.offsets[label].x - reference.offsets[label].x), `${step}: ${label} x`).toBeLessThan(1.5);
    expect(Math.abs(now.offsets[label].y - reference.offsets[label].y), `${step}: ${label} y`).toBeLessThan(1.5);
  }
}

/** Wait until a mouse-wheel ease has finished: the markers stop moving between checks. */
async function settle(page: Page) {
  const read = () => page.evaluate(() => JSON.stringify((window as any).__labels?.['Marker B']));
  let last = '', still = 0;
  // Two quiet checks in a row, 400 ms apart: a slow frame under load cannot pass for a finished ease.
  await expect.poll(async () => { await page.waitForTimeout(400); const now = await read(); still = now === last ? still + 1 : 0; last = now; return still >= 2; }, { timeout: 15_000 }).toBe(true);
}

/** Native-style trackpad wheel events (arbitrary deltas, no 120-unit click), 16 ms apart. */
const trackpad = (page: Page, at: { x: number; y: number }, events: [number, number][], ctrlKey = false) => page.evaluate(async ({ at, events, ctrlKey }) => {
  const canvas = document.querySelector('canvas[aria-label="Floor plan editor canvas"]')!;
  for (const [deltaX, deltaY] of events) {
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX, deltaY, deltaMode: 0, clientX: at.x, clientY: at.y, ctrlKey, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 16));
  }
}, { at, events, ctrlKey });

async function projectJson(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
}

test('laptop zoom is smooth, cursor-centred and keeps every overlay aligned', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPlan(page);
  const start = await view(page);

  // Slow mouse wheel: three clicks in, towards the recommendation area.
  const rCentre = { x: 440, y: 280 };
  let at = start.toScreen(rCentre);
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -100); await settle(page); }
  let now = await view(page);
  expect(now.scale / start.scale).toBeCloseTo(1 / 0.9 ** 3, 2);
  expect(Math.hypot(now.toScreen(rCentre).x - at.x, now.toScreen(rCentre).y - at.y), 'slow wheel anchor').toBeLessThan(1.5);
  expectNoDrift(start, now, 'slow wheel');

  // Fast mouse wheel: five clicks out in quick succession, towards the finding area.
  const fCentre = { x: 125, y: 100 };
  let before = now;
  at = before.toScreen(fCentre);
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 100);
  await settle(page);
  now = await view(page);
  expect(now.scale / before.scale).toBeCloseTo(0.9 ** 5, 2);
  expect(Math.hypot(now.toScreen(fCentre).x - at.x, now.toScreen(fCentre).y - at.y), 'fast wheel anchor').toBeLessThan(1.5);
  expectNoDrift(start, now, 'fast wheel');

  // Trackpad scroll: thirty small events zoom gently (not several levels), towards the pin.
  before = now;
  at = before.toScreen(ANCHORS.F2);
  await trackpad(page, at, Array.from({ length: 30 }, () => [0, -3]));
  now = await view(page);
  expect(now.scale / before.scale).toBeCloseTo(0.9 ** -0.9, 2);
  expect(Math.hypot(now.toScreen(ANCHORS.F2).x - at.x, now.toScreen(ANCHORS.F2).y - at.y), 'trackpad anchor').toBeLessThan(1.5);
  expectNoDrift(start, now, 'trackpad scroll');

  // A sideways twitch in the middle of a scroll gesture does not switch it to panning.
  before = now;
  at = before.toScreen(rCentre);
  await trackpad(page, at, Array.from({ length: 20 }, (_, i) => [i % 4 === 3 ? 2 : 0, 4]));
  now = await view(page);
  expect(now.scale / before.scale).toBeCloseTo(0.9 ** 0.8, 2);
  expect(Math.hypot(now.toScreen(rCentre).x - at.x, now.toScreen(rCentre).y - at.y), 'mixed gesture anchor').toBeLessThan(1.5);

  // Trackpad pinch: ten small pinch events.
  before = now;
  await trackpad(page, at, Array.from({ length: 10 }, () => [0, -2]), true);
  now = await view(page);
  expect(now.scale / before.scale).toBeCloseTo(Math.exp(0.2), 2);
  expectNoDrift(start, now, 'pinch');

  // A sideways trackpad gesture pans without zooming.
  before = now;
  const markerBefore = before.toScreen({ x: 0, y: 0 });
  await trackpad(page, at, Array.from({ length: 10 }, () => [6, 0]));
  await page.waitForTimeout(200);
  now = await view(page);
  expect(now.scale).toBeCloseTo(before.scale, 6);
  expect(now.toScreen({ x: 0, y: 0 }).x - markerBefore.x).toBeCloseTo(-60, 0);

  // Space + drag pans after zooming; the scale is unchanged and the plan moves with the pointer.
  before = now;
  const p0 = before.toScreen({ x: 0, y: 0 });
  await page.mouse.move(700, 500);
  await page.keyboard.down('Space');
  await page.mouse.down(); await page.mouse.move(780, 460, { steps: 6 }); await page.mouse.up();
  await page.keyboard.up('Space');
  now = await view(page);
  expect(now.scale).toBeCloseTo(before.scale, 6);
  expect(now.toScreen({ x: 0, y: 0 }).x - p0.x).toBeCloseTo(80, 0);
  expect(now.toScreen({ x: 0, y: 0 }).y - p0.y).toBeCloseTo(-40, 0);
  expectNoDrift(start, now, 'space pan');

  // The browser page itself never scrolled or zoomed.
  expect(await page.evaluate(() => [scrollX, scrollY, visualViewport?.scale ?? 1])).toEqual([0, 0, 1]);

  // After zooming: select the recommendation area, move it, resize it. Snapping off, so moves are exact.
  await page.getByRole('button', { name: 'Snap to Grid', exact: true }).click();
  const v = now;
  at = v.toScreen(rCentre);
  const f1 = async () => page.evaluate(() => ({ ...(window as any).__labels.F1 }));
  const f1Before = await f1();
  await page.mouse.move(at.x, at.y); await page.mouse.down();
  await page.mouse.move(at.x + 40, at.y + 20, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('[data-reference-badge]')).toHaveText('R1');
  // Selecting opens the properties panel, which narrows the canvas: the plan must not jump.
  await expect(page.locator('[data-plan-properties]')).toBeVisible();
  const f1Selected = await f1();
  expect(Math.hypot(f1Selected.x - f1Before.x, f1Selected.y - f1Before.y), 'plan moved when the panel opened').toBeLessThan(1);
  const corner = v.toScreen({ x: 350 + 180 + 40 / v.scale, y: 220 + 120 + 20 / v.scale });
  await page.waitForTimeout(600);
  await page.mouse.move(corner.x, corner.y); await page.mouse.down();
  await page.mouse.move(corner.x + 30, corner.y + 24, { steps: 8 }); await page.mouse.up();

  // Move the pin.
  const pin = v.toScreen(ANCHORS.F2);
  await page.waitForTimeout(600);
  await page.mouse.move(pin.x, pin.y); await page.mouse.down();
  await page.mouse.move(pin.x - 30, pin.y + 15, { steps: 8 }); await page.mouse.up();

  // Deselecting closes the panel: the plan stays put.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-plan-properties]')).toBeHidden();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const f1Closed = await f1();
  expect(Math.hypot(f1Closed.x - f1Before.x, f1Closed.y - f1Before.y), 'plan moved when the panel closed').toBeLessThan(1);

  // Draw a new finding area after zooming.
  await page.getByRole('button', { name: 'Add Issue Area' }).click();
  await page.getByRole('button', { name: /Condensation/ }).click();
  const a = v.toScreen({ x: 63, y: 204 }), b = v.toScreen({ x: 201, y: 297 });
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();

  const floor = (await projectJson(page)).floors[0];
  const r = floor.recommendedWorks[0];
  expect(r.x).toBeCloseTo(350 + 40 / v.scale, 0);
  expect(r.y).toBeCloseTo(220 + 20 / v.scale, 0);
  expect(r.width).toBeCloseTo(180 + 30 / v.scale, 0);
  expect(r.height).toBeCloseTo(120 + 24 / v.scale, 0);
  expect(floor.overlayPins[0].x).toBeCloseTo(300 - 30 / v.scale, 0);
  expect(floor.overlayPins[0].y).toBeCloseTo(110 + 15 / v.scale, 0);
  const drawn = floor.surveyFindings.find((z: any) => z.code === 'CD');
  expect(drawn).toMatchObject({ ref: 'F4' });
  expect(drawn.x).toBeCloseTo(63, 0); expect(drawn.y).toBeCloseTo(204, 0);
  expect(drawn.width).toBeCloseTo(138, 0); expect(drawn.height).toBeCloseTo(93, 0);
  expect(errors).toEqual([]);
});
