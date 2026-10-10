import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LOCAL_STAFF } from '../../tooling/northway-supabase/local-stack.mjs';

// Northway Plans v1 acceptance: a realistic survey from scan to report-ready exports.
// Login → import a scan → edit → findings → recommendations with priorities → save → close →
// reopen → amend → second floor → export both plans → duplicate → sign out and back in.
test.use({ storageState: { cookies: [], origins: [] } });

const BRAD = LOCAL_STAFF[0];
const RUN = Date.now().toString(36);
const NAME = `14 Example Street, Ilkley ${RUN}`;
const SAVE = process.env.NORTHWAY_SAVE_EXPORTS;

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(BRAD.email);
  await page.getByLabel('Password').fill(BRAD.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('button', { name: 'New Plan' })).toBeVisible();
}

async function projectJson(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...from); await page.mouse.down();
  await page.mouse.move(...to, { steps: 6 }); await page.mouse.up();
}

const row = (page: Page, name: string) => page.locator('[data-plan-row]').filter({ has: page.getByRole('link', { name, exact: true }) });

test('Northway Plans v1 acceptance: scan to Word-ready Findings and Recommended Works plans', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const timings: Record<string, number> = {};
  const time = async <T>(label: string, fn: () => Promise<T>) => { const t = Date.now(); const result = await fn(); timings[label] = Date.now() - t; return result; };

  // Login, then import the scan as a new plan.
  await signIn(page);
  await page.getByRole('button', { name: 'New Plan' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Import Plan/ }).click();
  await (await chooser).setFiles(resolve('static/test-roomplan-multiroom.json'));
  await page.getByLabel(/Project name/).fill(NAME);
  await page.getByLabel(/Customer name/).fill('Mr and Mrs Example');
  await page.getByLabel(/Property address/).fill('14 Example Street, Ilkley LS29 9AA');
  await time('import and open', async () => {
    await page.getByRole('button', { name: 'Create Plan' }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  });
  const projectUrl = page.url();
  const imported = (await projectJson(page)).floors[0];
  expect(imported.walls.length).toBeGreaterThan(10);
  expect(imported.doors.length + imported.windows.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await page.getByRole('button', { name: 'Snap to Grid', exact: true }).click();
  const canvas = page.getByRole('application').locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);

  // Fixed fixtures: kitchen units and a sink.
  await page.getByRole('button', { name: 'Objects', exact: true }).click();
  await page.locator('[data-fixed-fixtures]').getByRole('button', { name: /Kitchen unit/ }).click();
  await page.mouse.click(cx + 120, cy + 110);
  await page.keyboard.press('Escape');
  await page.locator('[data-fixed-fixtures]').getByRole('button', { name: /Kitchen sink/ }).click();
  await page.mouse.click(cx + 180, cy + 110);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Build', exact: true }).click();

  const findings = page.locator('[data-survey-findings]'), works = page.locator('[data-recommended-works]');
  const badge = page.locator('[data-reference-badge]');
  const area = async (preset: RegExp, from: [number, number], to: [number, number]) => {
    if (!(await findings.locator('[data-issue-presets]').isVisible())) await findings.getByRole('button', { name: 'Add Issue Area' }).click();
    await findings.getByRole('button', { name: preset }).click();
    await drag(page, from, to);
  };
  // F1 High Moisture (rear dining-room wall), F2 Timber Deterioration, F3 Woodworm Activity.
  await area(/High Moisture/, [cx - 200, cy - 150], [cx - 110, cy - 110]);
  const s = Math.round(((await canvas.boundingBox())!.width - box.width) / 2);
  await area(/Timber Deterioration/, [cx - 60 + s, cy - 60], [cx + 20 + s, cy]);
  await area(/Woodworm Activity/, [cx + 40 + s, cy - 60], [cx + 120 + s, cy]);
  await expect(badge).toHaveText('F3');
  // F4 pin and F5 line along the base of an external wall.
  await findings.getByRole('button', { name: 'Add Finding Pin' }).click();
  await page.mouse.click(cx - 150 + s, cy + 40);
  await page.getByRole('dialog', { name: 'Finding pin' }).getByRole('textbox', { name: 'Description' }).fill('Defective rainwater goods above this location');
  await page.getByRole('dialog', { name: 'Finding pin' }).getByRole('button', { name: 'Add Pin' }).click();
  await findings.getByRole('button', { name: 'Add Finding Line' }).click();
  await page.mouse.click(cx - 200 + s, cy + 80);
  await page.mouse.click(cx - 80 + s, cy + 80);
  await page.mouse.dblclick(cx - 80 + s, cy + 140);
  await page.getByRole('dialog', { name: 'Finding line' }).getByRole('textbox', { name: 'Description' }).fill('Elevated moisture readings along base of external wall');
  await page.getByRole('dialog', { name: 'Finding line' }).getByRole('button', { name: 'Add Line' }).click();
  await expect(badge).toHaveText('F5');

  // Recommended Works: Add → Priority → Recommendation → Draw/Place.
  const recommend = async (kind: 'area' | 'pin' | 'line', priority: string, text: string) => {
    await works.getByRole('button', { name: { area: 'Add Recommended Area', pin: 'Add Recommendation Pin', line: 'Add Recommendation Line' }[kind] }).click();
    const form = page.getByRole('dialog', { name: { area: 'New recommended area', pin: 'New recommendation pin', line: 'New recommendation line' }[kind] });
    await form.getByRole('radio', { name: priority }).click();
    await form.getByRole('textbox', { name: 'Recommendation' }).fill(text);
    await form.getByRole('button', { name: { area: 'Draw Area', pin: 'Place Pin', line: 'Draw Line' }[kind] }).click();
  };
  await recommend('area', '3 — Priority Work', 'Replace locally decayed floor joists and affected floorboards.');
  await drag(page, [cx - 55 + s, cy - 55], [cx + 15 + s, cy - 5]);
  await recommend('area', '2 — Recommended Work', 'Apply insecticidal treatment to accessible affected floor timbers.');
  await drag(page, [cx + 45 + s, cy - 55], [cx + 115 + s, cy - 5]);
  await recommend('line', '1 — Advisory Work', 'Improve subfloor ventilation.');
  await page.mouse.click(cx + 40 + s, cy + 150);
  await page.mouse.dblclick(cx + 160 + s, cy + 150);
  await recommend('pin', 'FI — Further Investigation', 'Lift floor locally to inspect concealed joist ends.');
  await page.mouse.click(cx - 20 + s, cy + 60);
  await expect(badge).toHaveText('R4');

  // Floor name and survey date for the exports.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: /Survey Plan \(PNG \/ PDF\)/ }).click();
  let dialog = page.getByRole('dialog', { name: 'Export survey plan' });
  await dialog.getByRole('combobox', { name: 'Plan / floor name' }).fill('Ground Floor');
  await dialog.getByRole('combobox', { name: 'Plan / floor name' }).press('Tab');
  await dialog.getByLabel('Survey date').fill('2026-10-09');
  await dialog.getByLabel('Survey date').press('Tab');
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Save, close, reopen: everything is still there.
  await time('save', async () => {
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  });
  const saved = await projectJson(page);
  const ground = saved.floors[0];
  expect(ground.surveyFindings.map((z: any) => `${z.ref} ${z.code}`)).toEqual(['F1 HM', 'F2 TD', 'F3 WM']);
  expect(ground.overlayPins.map((p: any) => `${p.ref} ${p.priority ?? '-'}`)).toEqual(['F4 -', 'R4 further_investigation']);
  expect(ground.overlayLines.map((l: any) => `${l.ref} ${l.points.length} ${l.priority ?? '-'}`)).toEqual(['F5 3 -', 'R3 2 priority_1']);
  expect(ground.recommendedWorks.map((z: any) => `${z.ref} ${z.priority}`)).toEqual(['R1 priority_3', 'R2 priority_2']);
  expect(ground.furniture.map((f: any) => f.catalogId)).toEqual(expect.arrayContaining(['counter', 'sink_k']));
  await page.getByRole('link', { name: /Back to Plans/ }).click();
  await expect(page.locator('[data-plan-row]').first()).toContainText(NAME); // newest first
  await page.getByRole('searchbox').fill('Example Street Ilkley');
  await expect(row(page, NAME)).toBeVisible();
  await time('reopen', async () => {
    await row(page, NAME).getByRole('link', { name: 'Open' }).click();
    await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  });
  expect((await projectJson(page)).floors).toEqual(saved.floors);

  // Amend: reword R3 and raise it to Priority 2 without redrawing.
  await page.locator('[data-plan-references] [data-reference="R3"]').click();
  const props = page.locator('[data-recommendation-properties]');
  await props.getByRole('textbox', { name: 'Recommendation' }).fill('Improve subfloor ventilation by installing additional air bricks to the front elevation.');
  await props.getByRole('radio', { name: '2 — Recommended Work' }).click();

  // A second floor with its own findings: overlays stay on their floor.
  await page.getByRole('button', { name: 'Add Floor', exact: true }).click();
  await page.getByRole('button', { name: /Exterior walls/ }).click();
  await findings.getByRole('button', { name: 'Add Finding Pin' }).click();
  await page.mouse.click(cx + s, cy);
  await page.getByRole('dialog', { name: 'Finding pin' }).getByRole('textbox', { name: 'Description' }).fill('Restricted access to roof void hatch');
  await page.getByRole('dialog', { name: 'Finding pin' }).getByRole('button', { name: 'Add Pin' }).click();
  await expect(badge).toHaveText('F6');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  const amended = await projectJson(page);
  expect(amended.floors).toHaveLength(2);
  expect(amended.floors[0].overlayLines[1]).toMatchObject({ ref: 'R3', priority: 'priority_2', description: 'Improve subfloor ventilation by installing additional air bricks to the front elevation.' });
  expect(amended.floors[1].overlayPins.map((p: any) => p.ref)).toEqual(['F6']);
  expect(amended.floors[0].overlayPins.map((p: any) => p.ref)).toEqual(['F4', 'R4']);

  // Export the Ground Floor plans for the report (Word size PNG and A4 PDF), then the first floor.
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: /Survey Plan \(PNG \/ PDF\)/ }).click();
  dialog = page.getByRole('dialog', { name: 'Export survey plan' });
  await dialog.getByRole('combobox', { name: 'Floor', exact: true }).selectOption({ label: 'Ground Floor' });
  for (const [label, file] of [['Survey Findings Plan', 'Survey-Findings'], ['Recommended Works Plan', 'Recommended-Works']] as const) {
    await dialog.getByRole('radio', { name: label }).check();
    for (const [button, ext] of [['Download PNG (300 dpi)', 'png'], ['Download PDF (A4)', 'pdf']] as const) {
      const download = page.waitForEvent('download');
      await time(`export ${file} ${ext}`, async () => { await dialog.getByRole('button', { name: button }).click(); await download; });
      const file_ = await download;
      expect(file_.suggestedFilename()).toBe(`14-Example-Street-Ground-Floor-${file}.${ext}`);
      if (SAVE) await writeFile(`${SAVE}/acceptance-${file}.${ext}`, await readFile((await file_.path())!));
    }
  }
  await dialog.getByRole('combobox', { name: 'Floor', exact: true }).selectOption({ index: 1 });
  await dialog.getByRole('radio', { name: 'Survey Findings Plan' }).check();
  await expect(dialog.locator('[data-export-filename]')).toHaveText('14-Example-Street-Floor-1-Survey-Findings.png');
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Duplicate, then sign out and back in: the plan and its copy are intact.
  await page.getByRole('link', { name: /Back to Plans/ }).click();
  await row(page, NAME).getByRole('button', { name: 'Duplicate' }).click();
  await expect(row(page, `${NAME} (Copy)`)).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page);
  await row(page, `${NAME} (Copy)`).getByRole('link', { name: 'Open' }).click();
  const copy = await projectJson(page);
  expect(copy.floors.map((f: any) => [f.name, f.overlayPins?.length])).toEqual(amended.floors.map((f: any) => [f.name, f.overlayPins?.length]));
  expect(copy.floors[0].recommendedWorks).toEqual(amended.floors[0].recommendedWorks);
  await page.goto(projectUrl);
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  expect((await projectJson(page)).floors).toEqual(amended.floors);

  console.log('TIMINGS', JSON.stringify(timings));
  for (const [label, ms] of Object.entries(timings)) expect(ms, label).toBeLessThan(15_000);
  expect(errors).toEqual([]);
});
