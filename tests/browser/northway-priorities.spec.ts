import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { LOCAL_STAFF } from '../../tooling/northway-supabase/local-stack.mjs';

// Northway Stage 6: the Northway Priority System for Recommended Works. A realistic survey with
// three findings and four prioritised recommendations, priority edits, save/reopen, exports,
// duplication, and an older plan whose recommendations load as "Priority required".
test.use({ storageState: { cookies: [], origins: [] } }); // start signed out

const BRAD = LOCAL_STAFF[0];
const RUN = Date.now().toString(36);
const NAME = `Stage 6 Test Property ${RUN}`;
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
const projectJson = async (page: Page) => JSON.parse((await menuDownload(page, 'Download JSON')).toString('utf8'));

async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...from); await page.mouse.down();
  await page.mouse.move(...to, { steps: 8 }); await page.mouse.up();
}

const row = (page: Page, name: string) => page.locator('[data-plan-row]').filter({ has: page.getByRole('link', { name, exact: true }) });

async function openExport(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByRole('button', { name: /Survey Plan \(PNG \/ PDF\)/ }).click();
  return page.getByRole('dialog', { name: 'Export survey plan' });
}

test('Northway Priority workflow: prioritised recommendations, edits, exports and older plans', async ({ page }, testInfo) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await signIn(page);
  await page.getByRole('button', { name: 'New Plan' }).click();
  await page.getByRole('button', { name: /Blank Plan/ }).click();
  await page.getByLabel(/Project name/).fill(NAME);
  await page.getByLabel(/Property address/).fill('22 Station Road, Harrogate HG1 1AA');
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
  await page.getByRole('button', { name: 'Snap to Grid', exact: true }).click();

  const findings = page.locator('[data-survey-findings]'), works = page.locator('[data-recommended-works]');
  const badge = page.locator('[data-reference-badge]');

  // Findings: F1 High Moisture, F2 Timber Deterioration (areas), F3 Woodworm Activity (pin).
  await findings.getByRole('button', { name: 'Add Issue Area' }).click();
  await findings.getByRole('button', { name: /High Moisture/ }).click();
  await drag(page, [cx - 220, cy - 140], [cx - 80, cy - 40]);
  const s = Math.round(((await canvas.boundingBox())!.width - box.width) / 2);
  await findings.getByRole('button', { name: /Timber Deterioration/ }).click();
  await drag(page, [cx + 40 + s, cy + 20], [cx + 200 + s, cy + 140]);
  await findings.getByRole('button', { name: 'Add Finding Pin' }).click();
  await page.mouse.click(cx - 20 + s, cy + 100);
  await page.getByRole('dialog', { name: 'Finding pin' }).getByRole('textbox', { name: 'Description' }).fill('Woodworm Activity: active flight holes in floorboards');
  await page.getByRole('dialog', { name: 'Finding pin' }).getByRole('button', { name: 'Add Pin' }).click();
  await expect(badge).toHaveText('F3');

  // Recommendations: Add → Choose Priority → Type Recommendation → Draw/Place.
  const recommend = async (kind: 'area' | 'pin' | 'line', priority: string, text: string) => {
    await works.getByRole('button', { name: { area: 'Add Recommended Area', pin: 'Add Recommendation Pin', line: 'Add Recommendation Line' }[kind] }).click();
    const form = page.getByRole('dialog', { name: { area: 'New recommended area', pin: 'New recommendation pin', line: 'New recommendation line' }[kind] });
    // No code, colour or work type is needed. Without a priority, nothing can be drawn.
    await form.getByRole('textbox', { name: 'Recommendation' }).fill(text);
    await form.getByRole('button', { name: { area: 'Draw Area', pin: 'Place Pin', line: 'Draw Line' }[kind] }).click();
    await expect(form.getByRole('alert')).toHaveText('Choose a Northway Priority.');
    await form.getByRole('radio', { name: priority }).click();
    await form.getByRole('button', { name: { area: 'Draw Area', pin: 'Place Pin', line: 'Draw Line' }[kind] }).click();
    await expect(form).toBeHidden();
  };
  await recommend('area', '3 — Priority Work', 'Replace decayed floor joists and affected floorboards to rear reception room');
  await drag(page, [cx + 60 + s, cy + 40], [cx + 220 + s, cy + 150]);
  await expect(badge).toHaveText('R1');
  await recommend('pin', '2 — Recommended Work', 'Apply insecticidal treatment to accessible affected floor timbers');
  await page.mouse.click(cx + 20 + s, cy + 100);
  await expect(badge).toHaveText('R2');
  await recommend('line', '1 — Advisory Work', 'Improve subfloor ventilation');
  await page.mouse.click(cx - 200 + s, cy + 150);
  await page.mouse.dblclick(cx + 0 + s, cy + 150);
  await expect(badge).toHaveText('R3');
  await recommend('area', 'FI — Further Investigation', 'Lift floor locally to inspect concealed joist ends');
  await drag(page, [cx - 60 + s, cy - 140], [cx + 40 + s, cy - 60]);
  await expect(badge).toHaveText('R4');

  let plan = await projectJson(page), floor = plan.floors[0];
  expect(floor.surveyFindings.map((z: any) => [z.ref, z.code, z.color])).toEqual([['F1', 'HM', '#3b82c4'], ['F2', 'TD', '#b5534f']]); // issue colours kept
  expect(floor.recommendedWorks.map((z: any) => [z.ref, z.priority, z.color])).toEqual([['R1', 'priority_3', '#b8443d'], ['R4', 'further_investigation', '#6f8197']]);
  expect(floor.overlayPins.filter((p: any) => p.layer === 'recommended-works').map((p: any) => [p.ref, p.priority, p.color])).toEqual([['R2', 'priority_2', '#d68a2e']]);
  expect(floor.overlayLines.map((l: any) => [l.ref, l.priority, l.color])).toEqual([['R3', 'priority_1', '#d9b425']]);
  expect(floor.overlayPins.find((p: any) => p.ref === 'F3').priority).toBeUndefined(); // findings have no priority
  await expect(page.locator('[data-plan-references] [data-reference]')).toHaveText([
    /F1\s*HM\s*High Moisture/, /F2\s*TD\s*Timber Deterioration/, /F3\s*Woodworm/,
    /R1\s*3\s*Replace decayed/, /R2\s*2\s*Apply insecticidal/, /R3\s*1\s*Improve subfloor/, /R4\s*FI\s*Lift floor/,
  ]);

  // Change R3 from 1 to 2 without redrawing it; the help explains the four priorities.
  await page.locator('[data-plan-references] [data-reference="R3"]').click();
  const props = page.locator('[data-recommendation-properties]');
  await expect(badge).toHaveText('R3');
  await props.getByRole('button', { name: 'What the Northway Priorities mean' }).click();
  await expect(props.locator('[data-priority-help]')).toContainText('Lower-priority, preventative or maintenance work that would benefit the property.');
  await expect(props.locator('[data-priority-help]')).toContainText('not an RICS condition rating');
  await props.getByRole('radio', { name: '2 — Recommended Work' }).click();
  await props.getByRole('combobox', { name: /Work type/ }).selectOption({ label: 'Ventilation Improvement' });
  await props.getByRole('textbox', { name: /Quoted price/ }).fill('450');
  await props.getByRole('textbox', { name: /Quoted price/ }).press('Tab');
  let changed = (await projectJson(page)).floors[0].overlayLines[0];
  expect(changed).toMatchObject({ ref: 'R3', priority: 'priority_2', color: '#d68a2e', workType: 'VI', quotedPricePence: 45000, description: 'Improve subfloor ventilation' });
  expect(changed.points).toEqual(floor.overlayLines[0].points);
  await props.getByRole('radio', { name: '1 — Advisory Work' }).click();
  expect((await projectJson(page)).floors[0].overlayLines[0]).toMatchObject({ ref: 'R3', priority: 'priority_1', color: '#d9b425' });

  // Save, sign out, sign in, reopen: priorities intact.
  plan = await projectJson(page);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  await page.getByRole('link', { name: /Back to Plans/ }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page);
  await row(page, NAME).getByRole('link', { name: 'Open' }).click();
  await expect(page.locator('[data-cloud-save-state]')).toHaveText('Saved');
  const reopened = await projectJson(page);
  for (const key of ['surveyFindings', 'recommendedWorks', 'overlayPins', 'overlayLines']) expect(reopened.floors[0][key]).toEqual(plan.floors[0][key]);

  // Exports: no priority is missing, so the final Recommended Works and Survey Findings plans download.
  let dialog = await openExport(page);
  await expect(dialog.getByRole('radio', { name: 'Survey Findings Plan' })).toBeChecked(); // separate plans are the default
  await expect(dialog.locator('[data-export-priority-required]')).toHaveCount(0);
  for (const [label, file] of [['Survey Findings Plan', 'Survey-Findings'], ['Recommended Works Plan', 'Recommended-Works']] as const) {
    await dialog.getByRole('radio', { name: label }).check();
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download PNG (300 dpi)' }).click();
    const png = await download;
    expect(png.suggestedFilename()).toBe(`22-Station-Road-Ground-Floor-${file}.png`);
    if (SAVE) await writeFile(`${SAVE}/stage6-${file}.png`, await readFile((await png.path())!));
  }
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Duplicate keeps every priority.
  await page.getByRole('link', { name: /Back to Plans/ }).click();
  await row(page, NAME).getByRole('button', { name: 'Duplicate' }).click();
  await row(page, `${NAME} (Copy)`).getByRole('link', { name: 'Open' }).click();
  const copy = await projectJson(page);
  expect(copy.floors[0].recommendedWorks).toEqual(plan.floors[0].recommendedWorks);
  expect(copy.floors[0].overlayLines).toEqual(plan.floors[0].overlayLines);

  // An older (Stage 5) plan: its recommendations have no priority and load as "Priority required".
  const older = structuredClone(plan);
  for (const item of [...older.floors[0].recommendedWorks, ...older.floors[0].overlayPins, ...older.floors[0].overlayLines]) {
    if (item.layer === 'recommended-works') { delete item.priority; delete item.workType; delete item.quotedPricePence; }
  }
  older.floors[0].recommendedWorks[0].color = '#b5534f'; // a red Stage 4 colour must not be read as Priority 3
  const olderFile = testInfo.outputPath('stage5-plan.openplan.json');
  await writeFile(olderFile, JSON.stringify(older));
  await page.getByRole('link', { name: /Back to Plans/ }).click();
  await page.getByRole('button', { name: 'New Plan' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Import Plan/ }).click();
  await (await chooser).setFiles(olderFile);
  await page.getByLabel(/Project name/).fill(`Older plan ${RUN}`);
  await page.getByRole('button', { name: 'Create Plan' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(works.locator('[data-priority-required]')).toHaveText('Priority required: R1, R2, R3, R4');
  const imported = (await projectJson(page)).floors[0];
  expect(imported.recommendedWorks.map((z: any) => z.priority)).toEqual(['unassigned', 'unassigned']);

  // The final Recommended Works export is blocked until each has a priority; a marked draft is allowed.
  dialog = await openExport(page);
  await dialog.getByRole('radio', { name: 'Recommended Works Plan' }).check();
  await expect(dialog.locator('[data-export-priority-required]')).toContainText('R1, R2, R3, R4');
  await expect(dialog.getByRole('button', { name: 'Download PNG (300 dpi)' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Download PDF (A4)' })).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Survey Findings Plan' }).check(); // findings are not affected
  await expect(dialog.getByRole('button', { name: 'Download PNG (300 dpi)' })).toBeEnabled();
  await dialog.getByRole('radio', { name: 'Recommended Works Plan' }).check();
  await dialog.getByRole('checkbox', { name: /Export a draft anyway/ }).check();
  const draft = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download PNG (300 dpi)' }).click();
  const draftFile = await draft;
  expect(draftFile.suggestedFilename()).toBe(`Older-plan-${RUN}-Ground-Floor-Recommended-Works-DRAFT.png`); // no address on the imported plan
  if (SAVE) await writeFile(`${SAVE}/stage6-draft.png`, await readFile((await draftFile.path())!));
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Assigning priorities clears the warning.
  for (const ref of ['R1', 'R2', 'R3', 'R4']) {
    await page.locator('[data-plan-references] [data-reference="' + ref + '"]').click();
    await expect(page.locator('[data-recommendation-properties] [data-priority-required]')).toBeVisible();
    await page.locator('[data-recommendation-properties]').getByRole('radio', { name: '2 — Recommended Work' }).click();
  }
  await expect(works.locator('[data-priority-required]')).toHaveCount(0);
  if (SAVE) await page.screenshot({ path: `${SAVE}/stage6-editor.png` });
  expect(errors).toEqual([]);
});
