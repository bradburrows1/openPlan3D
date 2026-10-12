import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { LOCAL_STAFF } from '../../tooling/northway-supabase/local-stack.mjs';

// F and R references are display labels that always run 1, 2, 3… with no gaps. Each sequence is
// independent, item ids never change, and the plan, the sidebar, saved plans and every export
// show the same current numbers.
test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 900 } });

const BRAD = LOCAL_STAFF[0];
const NAME = `Sequential references ${Date.now().toString(36)}`;

async function project(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
}

const sidebar = (page: Page) => page.locator('[data-plan-references] [data-reference]');
const row = (page: Page, name: string) => page.locator('[data-plan-row]').filter({ has: page.getByRole('link', { name, exact: true }) });

test('references close up after deletes, per layer, through save, reopen and export', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Record the text drawn into export images (not the editor canvas).
  await page.addInitScript(() => {
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
      if (this.canvas instanceof HTMLCanvasElement && !this.canvas.getAttribute('aria-label') && !this.canvas.isConnected) ((window as any).__exportText ??= []).push(String(text));
      return maxWidth === undefined ? fill.call(this, text, x, y) : fill.call(this, text, x, y, maxWidth);
    };
  });
  await page.goto('/login');
  await page.getByLabel('Email').fill(BRAD.email);
  await page.getByLabel('Password').fill(BRAD.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByRole('button', { name: 'New Plan' }).click();
  await page.getByRole('button', { name: /Blank Plan/ }).click();
  await page.getByLabel(/Project name/).fill(NAME);
  await page.getByLabel(/Property address/).fill('14 Example Street, Ilkley');
  await page.getByRole('button', { name: 'Create Plan' }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  const box = (await page.getByRole('application').locator('canvas').first().boundingBox())!;
  const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);
  const findings = page.locator('[data-survey-findings]'), works = page.locator('[data-recommended-works]');
  const badge = page.locator('[data-reference-badge]');

  const addFinding = async (text: string, x: number) => {
    await findings.getByRole('button', { name: 'Add Finding Pin' }).click();
    await page.mouse.click(cx + x, cy - 100);
    const dialog = page.getByRole('dialog', { name: 'Finding pin' });
    await dialog.getByRole('textbox', { name: 'Description' }).fill(text);
    await dialog.getByRole('button', { name: 'Add Pin' }).click();
  };
  const addRecommendation = async (priority: string, text: string, x: number) => {
    await works.getByRole('button', { name: 'Add Recommendation Pin' }).click();
    const form = page.getByRole('dialog', { name: 'New recommendation pin' });
    await form.getByRole('radio', { name: priority }).click();
    await form.getByRole('textbox', { name: 'Recommendation' }).fill(text);
    await form.getByRole('button', { name: 'Place Pin' }).click();
    await page.mouse.click(cx + x, cy + 100);
  };
  const remove = async (ref: string) => {
    await page.locator(`[data-plan-references] [data-reference="${ref}"]`).click();
    await expect(badge).toHaveText(ref);
    await page.locator('[data-plan-properties]').getByRole('button', { name: 'Delete', exact: true }).click();
  };

  // Findings: F1, F2, F3 → delete F2 → F1, F2 → add → F1, F2, F3.
  await addFinding('Damp patch to chimney breast', -200);
  await addFinding('Defective rainwater goods above', -100);
  await addFinding('Woodworm flight holes to skirting', 0);
  await expect(badge).toHaveText('F3');
  const before = (await project(page)).floors[0].overlayPins;
  await remove('F2');
  await expect(sidebar(page)).toHaveText([/F1\s*Damp patch/, /F2\s*Woodworm flight holes/]);
  await addFinding('Mould growth behind wardrobe', 100);
  await expect(badge).toHaveText('F3');
  await expect(sidebar(page)).toHaveText([/F1\s*Damp patch/, /F2\s*Woodworm/, /F3\s*Mould growth/]);
  const afterFindings = (await project(page)).floors[0].overlayPins;
  // The ids are unchanged: only the label moved.
  expect(afterFindings.find((p: any) => p.description.startsWith('Woodworm')).id).toBe(before[2].id);

  // Recommendations, independently: R1, R2, R3 → delete R2 → R1, R2 → add → R1, R2, R3.
  await addRecommendation('3 — Priority Work', 'Treat timbers for woodworm', -200);
  await addRecommendation('2 — Recommended Work', 'Improve subfloor ventilation', -100);
  await addRecommendation('1 — Advisory Work', 'Clear gutters annually', 0);
  await expect(badge).toHaveText('R3');
  await remove('R2');
  await addRecommendation('FI — Further Investigation', 'Lift floorboards to inspect joists', 100);
  await expect(badge).toHaveText('R3');
  await expect(sidebar(page)).toHaveText([
    /F1\s*Damp patch/, /F2\s*Woodworm/, /F3\s*Mould growth/,
    /R1\s*3\s*Treat timbers/, /R2\s*1\s*Clear gutters/, /R3\s*FI\s*Lift floorboards/,
  ]);
  let saved = await project(page);
  const pins = (layer: string) => saved.floors[0].overlayPins.filter((p: any) => p.layer === layer).map((p: any) => [p.ref, p.description, p.priority ?? null]);
  expect(pins('survey-findings')).toEqual([['F1', 'Damp patch to chimney breast', null], ['F2', 'Woodworm flight holes to skirting', null], ['F3', 'Mould growth behind wardrobe', null]]);
  expect(pins('recommended-works')).toEqual([['R1', 'Treat timbers for woodworm', 'priority_3'], ['R2', 'Clear gutters annually', 'priority_1'], ['R3', 'Lift floorboards to inspect joists', 'further_investigation']]);
  expect(saved.surveyReferences).toEqual({ F: 3, R: 3 });

  // Save, close, reopen: the same order and numbers.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  await page.getByRole('link', { name: /Back to Plans/ }).click();
  await row(page, NAME).getByRole('link', { name: 'Open' }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  const reopened = await project(page);
  expect(reopened.floors[0].overlayPins).toEqual(saved.floors[0].overlayPins);
  await expect(sidebar(page)).toHaveText([/F1/, /F2/, /F3/, /R1/, /R2/, /R3/]);

  // Every export shows the current references on the plan and in its legend, and nothing else.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: /Survey Plan \(PNG \/ PDF\)/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Export survey plan' });
  for (const [view, expected] of [['Survey Findings Plan', ['F1', 'F2', 'F3']], ['Recommended Works Plan', ['R1', 'R2', 'R3']], ['Combined Plan', ['F1', 'F2', 'F3', 'R1', 'R2', 'R3']]] as const) {
    await dialog.getByRole('radio', { name: view }).check();
    await page.evaluate(() => { (window as any).__exportText = []; });
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download PNG (300 dpi)' }).click();
    await download;
    const drawn: string[] = await page.evaluate(() => (window as any).__exportText);
    const references = drawn.filter(text => /^[FR]\d+$/.test(text));
    // Each reference is drawn on the plan and again in the legend.
    for (const ref of expected) expect(references.filter(text => text === ref).length, `${view}: ${ref}`).toBeGreaterThanOrEqual(2);
    expect([...new Set(references)].sort(), view).toEqual([...expected].sort());
  }
  await dialog.getByRole('button', { name: 'Close' }).click();
  saved = reopened;
  expect(errors).toEqual([]);
});
