import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { get } from 'svelte/store';
import type { FurnitureItem, Project } from '$lib/models/types';
import { createDefaultProject, currentProject, loadProject, removeElement, undo, redo } from '$lib/stores/project';
import { projectSettings } from '$lib/stores/settings';
import { createProjectFromRoomPlan } from '$lib/utils/roomplanImport';
import { readProject } from '$lib/utils/projectValidation';
import { exportAsPNG, exportAsSVG } from '$lib/utils/export';
import { projectPackageBytes, readProjectPackage } from '$lib/services/projectPackage';
import { fixedFixtureIds, planFurniture, FIXTURE_LIBRARY_IDS, FIXED_FIXTURE_IDS } from '$lib/northway/fixtures';
import { surveyPlanView } from '$lib/northway/planView';
import { SURVEY_FINDING_PRESETS, BORDER_OPACITY, FILL_OPACITY, surveyFindingColor } from '$lib/northway/surveyPresets';
import { addSurveyFinding, updateSurveyFinding, setSurveyFindingRect, duplicateSurveyFinding, removeSurveyFinding, normalizeRect } from '$lib/northway/surveyStore';
import { drawSurveyFindingAreas, drawSurveyFindingCodes, findSurveyFindingAt, findSurveyFindingHandleAt, resizeZoneRect } from '$lib/northway/surveyRenderer';
import { roomProject } from './fixtures/project';

vi.mock('jspdf', () => ({ default: class {} }));

const item = (id: string, catalogId: string, x: number, y: number, extra: Partial<FurnitureItem> = {}): FurnitureItem =>
  ({ id, catalogId, position: { x, y }, rotation: 0, scale: { x: 1, y: 1, z: 1 }, ...extra });

const zones = () => get(currentProject)!.floors[0].surveyFindings ?? [];

let downloaded: Blob[];
let drawn: { fillRect: number[][]; strokeRect: number[][]; text: string[] };

beforeEach(() => {
  projectSettings.update(settings => ({ ...settings, planStyle: 'technical', objectLibrary: 'survey', showSurveyFindings: true }));
  downloaded = [];
  drawn = { fillRect: [], strokeRect: [], text: [] };
  const ctx = new Proxy({
    fillRect: (...args: number[]) => drawn.fillRect.push(args), strokeRect: (...args: number[]) => drawn.strokeRect.push(args),
    fillText: (text: string) => drawn.text.push(text), measureText: () => ({ width: 14 }),
  }, { get: (target, key) => target[key as keyof typeof target] ?? (() => {}) });
  const canvas = { width: 400, height: 300, getContext: () => ctx, toBlob: (callback: BlobCallback) => callback(new Blob(['png'])) };
  vi.stubGlobal('document', { createElement: (tag: string) => tag === 'canvas' ? canvas : { click: vi.fn() }, querySelectorAll: () => [], querySelector: () => null });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { downloaded.push(blob as Blob); return 'blob:test'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

// ── Fixed fixtures and movable furniture ─────────────────────────────

it('keeps fixed fixtures and hides movable furniture in the survey library', () => {
  const furniture = [
    item('wc', 'toilet', 0, 0), item('bath', 'bathtub', 200, 0), item('basin', 'sink_b', 400, 0), item('shower', 'shower', 600, 0),
    item('hob', 'stove', 0, 300), item('unit', 'counter', 200, 300), item('chimney', 'fireplace', 400, 300), item('stairs', 'stairs', 600, 300),
    item('drain', 'sym_drain', 800, 300),
    item('bed', 'bed_queen', 0, 600), item('sofa', 'sofa', 300, 600), item('table', 'dining_table', 600, 600), item('chair', 'chair', 800, 600),
    item('desk', 'desk', 0, 900), item('plant', 'potted_plant', 300, 900), item('rug', 'rug', 600, 900), item('lamp', 'floor_lamp', 900, 900),
    item('unknown', 'imported_object', 1200, 900, { sourceCategory: 'piano' }),
  ];
  expect([...fixedFixtureIds(furniture)].sort()).toEqual(['basin', 'bath', 'chimney', 'drain', 'hob', 'shower', 'stairs', 'unit', 'wc'].sort());
  expect(planFurniture(furniture, { objectLibrary: 'survey' }).map(i => i.id)).not.toContain('sofa');
  expect(planFurniture(furniture, {})).toHaveLength(9); // missing setting means survey
  expect(planFurniture(furniture, { objectLibrary: 'full' })).toHaveLength(furniture.length);
});

it('treats RoomPlan storage as a fitted unit only beside a sink or appliance', () => {
  const furniture = [
    item('sink', 'sink_k', 0, 0, { width: 60, depth: 60 }),
    item('base1', 'storage', 60, 0, { width: 60, depth: 60, height: 88 }), // touches the sink
    item('base2', 'storage', 125, 0, { width: 60, depth: 60, height: 88 }), // continues the run
    item('wardrobe', 'storage', 200, 0, { width: 60, depth: 60, height: 200 }), // too tall: movable
    item('chest', 'storage', 600, 400, { width: 80, depth: 45, height: 80 }), // far from any fitting
  ];
  expect([...fixedFixtureIds(furniture)].sort()).toEqual(['base1', 'base2', 'sink']);
});

it('offers only genuinely fixed items in the Fixed Fixtures library group', () => {
  for (const id of FIXTURE_LIBRARY_IDS) expect(FIXED_FIXTURE_IDS.has(id)).toBe(true);
  expect(FIXTURE_LIBRARY_IDS).toEqual(expect.arrayContaining(['counter', 'sink_k', 'toilet', 'bathtub', 'shower']));
});

it('imports RoomPlan captures intact while hiding movable objects from the survey view', () => {
  const project = createProjectFromRoomPlan(JSON.parse(readFileSync('test-roomplan.json', 'utf8')), 'Capture');
  const floor = project.floors[0];
  expect(floor.walls.length).toBeGreaterThan(0);
  expect(floor.doors.length).toBeGreaterThan(0);
  expect(floor.windows.length).toBeGreaterThan(0);
  expect(floor.furniture).toHaveLength(13); // nothing deleted
  const visible = planFurniture(floor.furniture, { objectLibrary: 'survey' }).map(i => i.catalogId).sort();
  expect(visible).toEqual(['sink_b', 'toilet']);
  // Users can add findings afterwards.
  loadProject(project);
  addSurveyFinding('HM', { x: 0, y: 0, width: 100, height: 50 });
  expect(zones()).toHaveLength(1);
});

// ── Presets ──────────────────────────────────────────────────────────

it('defines the ten survey finding presets with distinct restrained colours', () => {
  expect(SURVEY_FINDING_PRESETS.map(p => p.code)).toEqual(['HM', 'WM', 'DR', 'WR', 'MG', 'CD', 'PD', 'RD', 'TD', 'SV']);
  expect(new Set(SURVEY_FINDING_PRESETS.map(p => p.color)).size).toBe(10);
  expect(FILL_OPACITY).toBeGreaterThanOrEqual(0.2); expect(FILL_OPACITY).toBeLessThanOrEqual(0.3);
  expect(BORDER_OPACITY).toBeGreaterThanOrEqual(0.7); expect(BORDER_OPACITY).toBeLessThanOrEqual(0.9);
  for (const { color } of SURVEY_FINDING_PRESETS) {
    const v = parseInt(color.slice(1), 16), [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    // No neon: no channel pinned at full brightness and saturation kept moderate.
    expect(Math.max(r, g, b)).toBeLessThan(230);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(170);
  }
  expect(surveyFindingColor('ZZ')).toMatch(/^#/); // unknown future codes still draw
});

// ── Zone editing ─────────────────────────────────────────────────────

it('creates, moves, resizes, retypes, duplicates and deletes zones with undo', () => {
  loadProject(roomProject());
  const id = addSurveyFinding('HM', normalizeRect({ x: 300, y: 200 }, { x: 100, y: 50 }));
  expect(zones()[0]).toMatchObject({ id, layer: 'survey-findings', code: 'HM', shape: 'rect', x: 100, y: 50, width: 200, height: 150 });

  setSurveyFindingRect(id, { x: 120, y: 60, width: 200, height: 150 });
  expect(zones()[0]).toMatchObject({ x: 120, y: 60 });
  setSurveyFindingRect(id, resizeZoneRect(zones()[0], 'se', { x: 400, y: 260 }, 10));
  expect(zones()[0]).toMatchObject({ x: 120, y: 60, width: 280, height: 200 });

  updateSurveyFinding(id, { code: 'WM' });
  expect(zones()[0].code).toBe('WM');
  undo();
  expect(zones()[0].code).toBe('HM');
  redo();
  expect(zones()[0].code).toBe('WM');

  const copy = duplicateSurveyFinding(id)!;
  expect(zones()).toHaveLength(2);
  expect(zones()[1]).toMatchObject({ id: copy, code: 'WM', x: 150, y: 90 });
  removeSurveyFinding(copy);
  removeElement(id); // the Delete key path
  expect(zones()).toHaveLength(0);
  undo();
  expect(zones().map(z => z.id)).toEqual([id]);
});

it('resizes from any handle without inverting and hit-tests the topmost zone', () => {
  const start = { x: 0, y: 0, width: 100, height: 100 };
  expect(resizeZoneRect(start, 'nw', { x: -50, y: -20 }, 10)).toEqual({ x: -50, y: -20, width: 150, height: 120 });
  expect(resizeZoneRect(start, 'e', { x: -500, y: 40 }, 10)).toEqual({ x: 0, y: 0, width: 10, height: 100 });
  expect(resizeZoneRect(start, 'n', { x: 0, y: 300 }, 10)).toEqual({ x: 0, y: 90, width: 100, height: 10 });
  const a = { id: 'a', layer: 'survey-findings' as const, code: 'HM', shape: 'rect' as const, ...start };
  const b = { ...a, id: 'b', x: 50, y: 50 };
  expect(findSurveyFindingAt({ x: 75, y: 75 }, [a, b])?.id).toBe('b');
  expect(findSurveyFindingAt({ x: 10, y: 10 }, [a, b])?.id).toBe('a');
  expect(findSurveyFindingAt({ x: 500, y: 500 }, [a, b])).toBeNull();
  expect(findSurveyFindingHandleAt({ x: 101, y: 99 }, a, 1)).toBe('se');
  expect(findSurveyFindingHandleAt({ x: 50, y: 50 }, a, 1)).toBeNull();
});

it('draws zones aligned with the camera at any zoom and pan', () => {
  const zone = { id: 'z', layer: 'survey-findings' as const, code: 'WM', shape: 'rect' as const, x: 100, y: 50, width: 200, height: 100 };
  const fills: number[][] = [], texts: string[] = [];
  const ctx = new Proxy({ fillRect: (...args: number[]) => fills.push(args), fillText: (text: string) => texts.push(text), measureText: () => ({ width: 14 }) },
    { get: (target, key) => target[key as keyof typeof target] ?? (() => {}) }) as unknown as CanvasRenderingContext2D;
  drawSurveyFindingAreas({ ctx, width: 800, height: 600, zoom: 2, camX: 100, camY: 50 }, [zone]);
  // worldToScreen: (world - cam) * zoom + size / 2
  expect(fills[0]).toEqual([400, 300, 400, 200]);
  drawSurveyFindingCodes({ ctx, width: 800, height: 600, zoom: 0.5, camX: 0, camY: 0 }, [zone]);
  expect(texts).toEqual(['WM']); // short code only
});

// ── Layer, persistence and exports ───────────────────────────────────

it('hides the Survey Findings layer from exports without deleting zones', () => {
  const project = roomProject();
  project.floors[0].surveyFindings = [{ id: 'z', layer: 'survey-findings', code: 'HM', shape: 'rect', x: 10, y: 10, width: 50, height: 50 }];
  expect(surveyPlanView(project, { ...get(projectSettings), showSurveyFindings: false }).floors[0].surveyFindings).toEqual([]);
  expect(project.floors[0].surveyFindings).toHaveLength(1);
  expect(surveyPlanView(project, get(projectSettings)).floors[0].surveyFindings).toHaveLength(1);
});

it('loads older projects without zones unchanged and validates saved zones', () => {
  const older = JSON.parse(JSON.stringify(roomProject()));
  const loaded = readProject(older);
  expect('surveyFindings' in loaded.floors[0]).toBe(false);

  const saved = JSON.parse(JSON.stringify(roomProject()));
  saved.floors[0].surveyFindings = [{ id: 'z1', code: 'PD', x: 5, y: 6, width: 70, height: 80 }];
  // Stage 2 zones had no name or colour: they take their preset's.
  expect(readProject(saved).floors[0].surveyFindings).toEqual([{ id: 'z1', layer: 'survey-findings', shape: 'rect', code: 'PD', preset: 'PD', name: 'Penetrating Damp', color: '#1f4f8f', x: 5, y: 6, width: 70, height: 80 }]);
  saved.floors[0].surveyFindings[0].width = 0;
  expect(() => readProject(saved)).toThrow(/surveyFindings\[0\]\.width/);
  saved.floors[0].surveyFindings = [{ id: saved.floors[0].walls[0].id, code: 'HM', x: 0, y: 0, width: 1, height: 1 }];
  expect(() => readProject(saved)).toThrow(/duplicates another element/);
});

it('keeps zones through an iPhone project package round trip', () => {
  const project = roomProject() as Project;
  project.floors[0].surveyFindings = [{ id: 'z1', layer: 'survey-findings', code: 'TD', name: 'Timber Deterioration', color: '#b5534f', preset: 'TD', shape: 'rect', x: 20, y: 30, width: 90, height: 40 }];
  project.floors[0].recommendedWorks = [{ id: 'r1', layer: 'recommended-works', code: 'OF', name: 'Open Floor for Further Inspection', color: '#2fa3a8', preset: null, shape: 'rect', x: 20, y: 30, width: 90, height: 40 }];
  const returned = readProjectPackage(projectPackageBytes(project)).project;
  expect(returned.floors[0].surveyFindings).toEqual(project.floors[0].surveyFindings);
  expect(returned.floors[0].recommendedWorks).toEqual(project.floors[0].recommendedWorks);
});

it('exports zones and fixtures but not movable furniture in SVG', async () => {
  const project = roomProject();
  project.floors[0].furniture = [item('wc', 'toilet', 100, 100), item('sofa', 'sofa', 250, 150)];
  project.floors[0].surveyFindings = [
    { id: 'z1', layer: 'survey-findings', code: 'HM', shape: 'rect', x: 20, y: 30, width: 90, height: 40 },
    { id: 'z2', layer: 'survey-findings', code: 'WM', shape: 'rect', x: 200, y: 100, width: 60, height: 60 },
  ];
  exportAsSVG(project);
  const svg = await downloaded[0].text();
  expect(svg.match(/data-survey-finding="(\w+)"/g)).toEqual(['data-survey-finding="HM"', 'data-survey-finding="WM"']);
  expect(svg).toContain('>HM</text>');
  expect(svg).toContain('rgba(59, 130, 196, 0.25)');
  expect(svg).not.toMatch(/Sofa/i);

  projectSettings.update(settings => ({ ...settings, showSurveyFindings: false }));
  exportAsSVG(project);
  expect(await downloaded[1].text()).not.toContain('data-survey-finding');
  expect(project.floors[0].surveyFindings).toHaveLength(2);
});

it('draws zones and their codes in the PNG export at the editor scale', async () => {
  const project = roomProject();
  project.floors[0].surveyFindings = [{ id: 'z1', layer: 'survey-findings', code: 'DR', shape: 'rect', x: 20, y: 30, width: 90, height: 40 }];
  await exportAsPNG(null, project);
  expect(downloaded).toHaveLength(1);
  expect(drawn.text).toContain('DR');
  // One world centimetre per export unit, exactly as the editor draws at 100%.
  expect(drawn.fillRect.some(([, , w, h]) => w === 90 && h === 40)).toBe(true);
  expect(drawn.strokeRect.some(([, , w, h]) => w === 90 && h === 40)).toBe(true);
});
