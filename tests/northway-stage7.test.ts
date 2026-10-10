import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { get } from 'svelte/store';
import { createProjectFromRoomPlan } from '$lib/utils/roomplanImport';
import { readProject } from '$lib/utils/projectValidation';
import { projectSettings } from '$lib/stores/settings';
import { documentToProject } from '$lib/northway/cloud/projectDocument';
import { actionFailureMessage, failureKind, saveFailureMessage, IMPORT_FAILURE } from '$lib/northway/cloud/errors';
import { projectFromFile } from '$lib/northway/cloud/importPlan';
import { prepareReport } from '$lib/northway/export/reportExport';
import { buildLegend } from '$lib/northway/legend';
import { unassignedRefs } from '$lib/northway/overlayStore';
import { priorityStyle } from '$lib/northway/priorities';
import type { Measure } from '$lib/northway/export/reportLayout';
import { roomProject } from './fixtures/project';

vi.mock('jspdf', () => ({ default: class {} }));

const measure: Measure = (text, size, bold) => text.length * size * (bold ? 0.58 : 0.52);
const ID = '0b2c7e5a-4f3a-4b8e-9a5f-3c2d1e0f9a8b';
const open = (data: unknown, schema_version: number) => documentToProject({ id: ID, project_name: 'Plan', project_data: JSON.parse(JSON.stringify(data)), schema_version });

beforeEach(() => {
  projectSettings.update(settings => ({ ...settings, objectLibrary: 'survey', showSurveyFindings: true, showRecommendedWorks: true }));
});

// ── Plain-English errors ─────────────────────────────────────────────

it('explains failures in plain English and never claims a save worked', () => {
  vi.stubGlobal('navigator', { onLine: true });
  expect(failureKind({ message: 'TypeError: Failed to fetch' })).toBe('offline');
  expect(failureKind({ message: 'Load failed' })).toBe('offline'); // Safari's wording
  expect(failureKind({ code: 'PGRST301', message: 'JWT expired' })).toBe('auth');
  expect(failureKind({ code: '23514', message: 'new row violates check constraint' })).toBe('server');
  expect(saveFailureMessage({ message: 'boom', code: '500' })).toBe('The project could not be saved. Your changes remain on this device. Please try again.');
  expect(saveFailureMessage({ message: 'Failed to fetch' })).toMatch(/offline.*remain on this device/);
  expect(saveFailureMessage({ message: 'JWT expired' })).toMatch(/sign-in has ended.*remain on this device/);
  expect(actionFailureMessage('open this plan', { message: 'relation does not exist' })).toBe('Could not open this plan. Please try again. If it keeps happening, reload the page.');
  vi.stubGlobal('navigator', { onLine: false });
  expect(failureKind({ message: 'anything' })).toBe('offline'); // the browser knows it is offline
  vi.unstubAllGlobals();
});

it('refuses malformed imports with one clear message, and keeps accepting real files', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  for (const bad of ['not json', '{"floors": "nope"}', '{"rooms": 1}', JSON.stringify({ floors: [{ walls: [{ start: null }] }] })]) {
    await expect(projectFromFile(new File([bad], 'broken.json'))).rejects.toThrow(IMPORT_FAILURE);
  }
  const huge = new File(['x'], 'huge.json');
  Object.defineProperty(huge, 'size', { value: 65 * 1024 * 1024 });
  await expect(projectFromFile(huge)).rejects.toThrow(/larger than 64 MB/);
  const multi = await projectFromFile(new File([readFileSync('static/test-roomplan-multiroom.json')], '14 Example Street.json'));
  expect(multi.suggestedName).toBe('14 Example Street');
  expect(multi.project.floors[0].walls.length).toBeGreaterThan(10);
  vi.restoreAllMocks();
});

// ── Backwards compatibility across every stage ───────────────────────

it('opens Stage 3, 4, 5 and 6 plans without losing anything', () => {
  // Stage 3: plain plan with an issue area, no recommended works, schema 1.
  const stage3 = JSON.parse(JSON.stringify(roomProject()));
  stage3.floors[0].surveyFindings = [{ id: 'f', layer: 'survey-findings', code: 'HM', shape: 'rect', x: 0, y: 0, width: 50, height: 50 }];
  const p3 = open(stage3, 1);
  expect(p3.floors[0].surveyFindings![0]).toMatchObject({ ref: 'F1', name: 'High Moisture', color: '#3b82c4' });
  expect(p3.floors[0].recommendedWorks).toBeUndefined();

  // Stage 4: service-coloured recommendation with a custom code, schema 1.
  const stage4 = structuredClone(stage3);
  stage4.floors[0].recommendedWorks = [{ id: 'r', layer: 'recommended-works', code: 'OF', name: 'Open Floor', color: '#2fa3a8', preset: null, shape: 'rect', x: 0, y: 0, width: 50, height: 50 }];
  const p4 = open(stage4, 1);
  expect(p4.floors[0].recommendedWorks![0]).toMatchObject({ ref: 'R1', priority: 'unassigned', code: 'OF', name: 'Open Floor', color: '#2fa3a8' });
  expect(unassignedRefs(p4.floors[0])).toEqual(['R1']);

  // Stage 5: references, pins and lines with old recommendation metadata, schema 2.
  const stage5 = structuredClone(stage4);
  stage5.surveyReferences = { F: 2, R: 2 };
  stage5.floors[0].surveyFindings[0].ref = 'F1';
  stage5.floors[0].recommendedWorks[0].ref = 'R1';
  stage5.floors[0].overlayPins = [{ id: 'p', layer: 'survey-findings', ref: 'F2', description: 'Defective rainwater goods', color: '#9466ad', x: 1, y: 1 }];
  stage5.floors[0].overlayLines = [{ id: 'l', layer: 'recommended-works', ref: 'R2', description: 'Install DPC', color: '#5d5fb8', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }];
  stage5.surveyDate = '2026-10-09';
  const p5 = open(stage5, 2);
  expect(p5.floors[0].overlayPins![0]).toMatchObject({ ref: 'F2', description: 'Defective rainwater goods' });
  expect(p5.floors[0].overlayLines![0]).toMatchObject({ ref: 'R2', priority: 'unassigned' });
  expect(p5.surveyDate).toBe('2026-10-09');

  // Stage 6: priorities set, schema 3: unchanged.
  const stage6 = structuredClone(stage5);
  stage6.floors[0].recommendedWorks[0].priority = 'priority_3';
  stage6.floors[0].overlayLines[0].priority = 'further_investigation';
  stage6.floors[0].overlayLines[0].quotedPricePence = 45000;
  const p6 = open(stage6, 3);
  expect(p6.floors[0].recommendedWorks![0].priority).toBe('priority_3');
  expect(p6.floors[0].overlayLines![0]).toMatchObject({ priority: 'further_investigation', quotedPricePence: 45000 });
  expect(unassignedRefs(p6.floors[0])).toEqual([]);
  expect(p6.surveyReferences).toEqual({ F: 2, R: 2 });
});

// ── A large realistic survey stays fast ──────────────────────────────

it('handles a large multi-room survey with many findings and recommendations quickly', () => {
  const project = createProjectFromRoomPlan(JSON.parse(readFileSync('static/test-roomplan-multiroom.json', 'utf8')), 'Large');
  const floor = project.floors[0];
  const priorities = ['priority_3', 'priority_2', 'priority_1', 'further_investigation'] as const;
  floor.surveyFindings = Array.from({ length: 15 }, (_, i) => ({ id: `f${i}`, layer: 'survey-findings' as const, code: 'HM', name: 'High Moisture', color: '#3b82c4', preset: 'HM', shape: 'rect' as const, x: i * 40, y: 0, width: 80, height: 60 }));
  floor.recommendedWorks = Array.from({ length: 15 }, (_, i) => ({ id: `r${i}`, layer: 'recommended-works' as const, code: 'REC', name: `Replace locally decayed joist ends adjacent to the rear external wall and reinstate affected floorboards (${i + 1})`, color: '#b8443d', preset: null, priority: priorities[i % 4], shape: 'rect' as const, x: i * 40, y: 100, width: 80, height: 60 }));
  floor.overlayPins = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, layer: (i % 2 ? 'recommended-works' : 'survey-findings') as any, description: `Pin note ${i}`, color: '#9466ad', x: i * 30, y: 200, ...(i % 2 ? { priority: 'priority_2' as const } : {}) }));
  floor.overlayLines = Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, layer: (i % 2 ? 'recommended-works' : 'survey-findings') as any, description: `Line note ${i}`, color: '#3b82c4', points: [{ x: 0, y: i * 10 }, { x: 200, y: i * 10 }, { x: 200, y: i * 10 + 100 }], ...(i % 2 ? { priority: 'priority_1' as const } : {}) }));
  const started = performance.now();
  const loaded = readProject(JSON.parse(JSON.stringify(project)));
  const json = JSON.stringify(loaded);
  const legend = buildLegend(loaded.floors[0]);
  const report = prepareReport(loaded, loaded.floors[0].id, 'combined', { projectName: 'Large', floorName: 'Ground Floor' }, get(projectSettings), measure, 'a4')!;
  const elapsed = performance.now() - started;
  expect(legend['survey-findings']).toHaveLength(25);
  expect(legend['recommended-works']).toHaveLength(25);
  expect(report.layout.legendLayout.rows.filter(r => r.kind === 'entry')).toHaveLength(50);
  expect(json.length).toBeLessThan(1_000_000); // well within a comfortable save size
  expect(elapsed).toBeLessThan(1500);
  // Every recommendation keeps its priority colour.
  expect(legend['recommended-works'].every(e => e.color === priorityStyle(e.priority!).color)).toBe(true);
});

it('wraps long recommendations in full, keeping the reference and priority', () => {
  const text = 'Replace locally decayed joist ends adjacent to the rear external wall and reinstate affected floorboards following completion of moisture-related repairs.';
  const project = JSON.parse(JSON.stringify(roomProject()));
  project.floors[0].recommendedWorks = [{ id: 'r', layer: 'recommended-works', ref: 'R1', code: 'REC', name: text, color: '#b8443d', preset: null, priority: 'priority_3', shape: 'rect', x: 0, y: 0, width: 50, height: 50 }];
  const loaded = readProject(project);
  for (const paper of ['word', 'a4'] as const) {
    const report = prepareReport(loaded, loaded.floors[0].id, 'recommended-works', { projectName: 'x', floorName: 'Ground Floor' }, get(projectSettings), measure, paper)!;
    const entry = report.layout.legendLayout.rows.find(r => r.kind === 'entry')!;
    expect(entry.entry).toMatchObject({ ref: 'R1', priority: 'priority_3' });
    expect(entry.lines.length).toBeGreaterThan(1); // wrapped
    expect(entry.lines.join(' ')).toBe(text); // never truncated
    expect(report.layout.legend.y + report.layout.legend.height).toBeLessThanOrEqual(report.layout.footer.y);
  }
});
