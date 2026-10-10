import { beforeEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { OverlayLine, OverlayPin, Project } from '$lib/models/types';
import { createDefaultProject, currentProject, loadProject, removeElement, undo, redo } from '$lib/stores/project';
import { projectSettings } from '$lib/stores/settings';
import { readProject } from '$lib/utils/projectValidation';
import { createProjectFromRoomPlan } from '$lib/utils/roomplanImport';
import { readFileSync } from 'node:fs';
import { issueRef, normalizeReferences, parseRef } from '$lib/northway/references';
import { addLine, addPin, addZone, duplicateMarkup, duplicateZone, insertLinePoint, presetTemplate, removeLinePoint, removeMarkup, removeZone, setLinePoints, setPinPosition, updateMarkup, finishLineDraft, lineDraft, placingMarkup, pendingMarkup } from '$lib/northway/overlayStore';
import { findPreset } from '$lib/northway/zonePresets';
import { buildLegend, legendText } from '$lib/northway/legend';
import { surveyPlanView } from '$lib/northway/planView';
import { findMarkupAt, findLineVertexAt, findLineSegmentAt, lineMidpoint } from '$lib/northway/markupRenderer';
import { markupSvg } from '$lib/northway/overlaySvg';
import { calculateReportLayout, layoutLegend, paddedBounds, scaleBarLength, wrapText, type LegendSection, type Measure } from '$lib/northway/export/reportLayout';
import { legendSections, pngWithDpi, reportFilename, viewLayers } from '$lib/northway/export/reportExport';
import { formatSurveyDate, setFloorName, setSurveyDate } from '$lib/northway/surveyMeta';
import { CURRENT_SCHEMA_VERSION, documentToProject, migrateDocument, NewerSchemaError } from '$lib/northway/cloud/projectDocument';
import { roomProject } from './fixtures/project';

vi.mock('jspdf', () => ({ default: class {} }));

const floor = () => get(currentProject)!.floors[0];
const all = () => floor();
/** Rough text measure for layout tests: average glyph ≈ half the font size. */
const measure: Measure = (text, size, bold) => text.length * size * (bold ? 0.58 : 0.52);
const HM = presetTemplate(findPreset('survey-findings', 'HM')!), WT = presetTemplate(findPreset('recommended-works', 'WT')!);
const rect = { x: 0, y: 0, width: 100, height: 80 };

beforeEach(() => {
  projectSettings.update(settings => ({ ...settings, showSurveyFindings: true, showRecommendedWorks: true, objectLibrary: 'survey' }));
  loadProject(roomProject());
});

// ── Stable references ────────────────────────────────────────────────

it('numbers findings F1… and recommendations R1… across areas, pins and lines', () => {
  addZone(HM, rect);
  const pin = addPin({ layer: 'survey-findings', description: 'Defective rainwater goods above this location', color: '#9466ad' }, { x: 10, y: 10 });
  const line = addLine({ layer: 'survey-findings', description: 'Elevated moisture along base of external wall', color: '#3b82c4' }, [{ x: 0, y: 0 }, { x: 0, y: 200 }, { x: 300, y: 200 }]);
  addZone(WT, rect);
  addPin({ layer: 'recommended-works', description: 'Open floor locally for further inspection', color: '#2fa3a8' }, { x: 50, y: 50 });
  addLine({ layer: 'recommended-works', description: 'Install additional damp-proof course along this wall', color: '#5d5fb8' }, [{ x: 0, y: 0 }, { x: 400, y: 0 }]);
  expect(all().surveyFindings!.map(z => z.ref)).toEqual(['F1']);
  expect(all().overlayPins!.map(p => p.ref)).toEqual(['F2', 'R2']);
  expect(all().overlayLines!.map(l => l.ref)).toEqual(['F3', 'R3']);
  expect(all().recommendedWorks!.map(z => z.ref)).toEqual(['R1']);
  expect(get(currentProject)!.surveyReferences).toEqual({ F: 3, R: 3 });

  // Moving and editing keep the reference.
  setPinPosition(pin, { x: 90, y: 90 });
  updateMarkup(pin, { description: 'Defective rainwater goods (rear)', color: '#1f4f8f' });
  setLinePoints(line, [{ x: 5, y: 5 }, { x: 5, y: 205 }, { x: 305, y: 205 }]);
  expect(all().overlayPins![0]).toMatchObject({ ref: 'F2', x: 90, y: 90, description: 'Defective rainwater goods (rear)', color: '#1f4f8f' });
  expect(all().overlayLines![0].ref).toBe('F3');
});

it('never renumbers or reuses a reference after deletes, duplicates and undo', () => {
  const a = addZone(HM, rect), b = addPin({ layer: 'survey-findings', description: 'b', color: '#3b82c4' }, { x: 0, y: 0 });
  addPin({ layer: 'survey-findings', description: 'c', color: '#3b82c4' }, { x: 0, y: 0 });
  removeMarkup(b); // F2 deleted: F3 stays F3
  expect(all().overlayPins!.map(p => p.ref)).toEqual(['F3']);
  expect(addPin({ layer: 'survey-findings', description: 'd', color: '#3b82c4' }, { x: 0, y: 0 })).toBeTruthy();
  expect(all().overlayPins!.map(p => p.ref)).toEqual(['F3', 'F4']);
  const copy = duplicateZone(a)!;
  expect(all().surveyFindings!.find(z => z.id === copy)!.ref).toBe('F5');
  undo(); // the duplicate is gone, but F5 is not handed out again in this session
  expect(all().surveyFindings!.map(z => z.ref)).toEqual(['F1']);
  addZone(HM, rect);
  expect(all().surveyFindings!.map(z => z.ref)).toEqual(['F1', 'F6']);
  redo(); // nothing to redo after a new edit
  removeZone(a);
  removeElement(all().overlayPins![0].id); // Delete key
  expect(get(currentProject)!.surveyReferences!.F).toBe(6);
  const dup = duplicateMarkup(all().overlayPins![0].id)!;
  expect(all().overlayPins!.find(p => p.id === dup)!.ref).toBe('F7');
});

it('gives older plans references once, in floor order, and keeps them on every later load', () => {
  const stage4 = JSON.parse(JSON.stringify(roomProject()));
  stage4.floors[0].surveyFindings = [
    { id: 'a', layer: 'survey-findings', code: 'HM', shape: 'rect', x: 0, y: 0, width: 10, height: 10 },
    { id: 'b', layer: 'survey-findings', code: 'WM', shape: 'rect', x: 0, y: 0, width: 10, height: 10 },
  ];
  stage4.floors[0].recommendedWorks = [{ id: 'c', layer: 'recommended-works', code: 'WT', shape: 'rect', x: 0, y: 0, width: 10, height: 10 }];
  const loaded = readProject(stage4);
  expect(loaded.floors[0].surveyFindings!.map(z => z.ref)).toEqual(['F1', 'F2']);
  expect(loaded.floors[0].recommendedWorks![0].ref).toBe('R1');
  expect(loaded.surveyReferences).toEqual({ F: 2, R: 1 });
  const again = readProject(JSON.parse(JSON.stringify(loaded)));
  expect(again.floors[0].surveyFindings!.map(z => z.ref)).toEqual(['F1', 'F2']);
  // A plan with no overlays is left exactly as it was.
  expect('surveyReferences' in readProject(JSON.parse(JSON.stringify(roomProject())))).toBe(false);
});

it('repairs duplicate, missing and wrong-layer references without touching valid ones', () => {
  const project = roomProject();
  project.surveyReferences = { F: 9, R: 0 };
  project.floors[0].overlayPins = [
    { id: 'p1', layer: 'survey-findings', ref: 'F4', description: 'a', color: '#3b82c4', x: 0, y: 0 },
    { id: 'p2', layer: 'survey-findings', ref: 'F4', description: 'copy', color: '#3b82c4', x: 0, y: 0 },
    { id: 'p3', layer: 'recommended-works', ref: 'F7', description: 'wrong letter', color: '#3b82c4', x: 0, y: 0 },
    { id: 'p4', layer: 'survey-findings', description: 'none', color: '#3b82c4', x: 0, y: 0 },
  ];
  normalizeReferences(project);
  expect(project.floors[0].overlayPins!.map(p => p.ref)).toEqual(['F4', 'F10', 'R1', 'F11']);
  expect(project.surveyReferences).toEqual({ F: 11, R: 1 });
  expect(parseRef('F12')).toEqual({ prefix: 'F', n: 12 });
  expect(parseRef('F0')).toBeNull();
  expect(parseRef('X1')).toBeNull();
  const fresh = createDefaultProject('x');
  expect(issueRef(fresh, 'recommended-works')).toBe('R1');
});

// ── Pins and lines ───────────────────────────────────────────────────

it('captures a line from clicks, drops double-click repeats, and edits its points', () => {
  placingMarkup.set({ kind: 'line', layer: 'survey-findings' });
  lineDraft.set([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 100 }]);
  expect(finishLineDraft()).toBe(true);
  expect(get(pendingMarkup)).toEqual({ kind: 'line', layer: 'survey-findings', points: [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 200, y: 100 }] });
  expect(get(placingMarkup)).toBeNull();
  placingMarkup.set({ kind: 'line', layer: 'survey-findings' });
  lineDraft.set([{ x: 0, y: 0 }]);
  expect(finishLineDraft()).toBe(false); // one point is not a line
  pendingMarkup.set(null);

  const id = addLine({ layer: 'recommended-works', description: 'DPC', color: '#5d5fb8' }, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  insertLinePoint(id, 0, { x: 50, y: 20 });
  expect(all().overlayLines![0].points).toEqual([{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: 100, y: 0 }]);
  removeLinePoint(id, 1);
  removeLinePoint(id, 1); // a line keeps two points
  expect(all().overlayLines![0].points).toHaveLength(2);
});

it('hit-tests pins, line markers, bands, vertices and segments', () => {
  const pin: OverlayPin = { id: 'p', layer: 'survey-findings', ref: 'F1', description: 'x', color: '#3b82c4', x: 100, y: 100 };
  const line: OverlayLine = { id: 'l', layer: 'recommended-works', ref: 'R1', description: 'y', color: '#3b82c4', points: [{ x: 0, y: 300 }, { x: 400, y: 300 }, { x: 400, y: 600 }] };
  expect(findMarkupAt({ x: 105, y: 100 }, [pin], [line], 1)?.id).toBe('p');
  expect(findMarkupAt({ x: 380, y: 302 }, [pin], [line], 1)?.id).toBe('l');
  expect(findMarkupAt({ x: 200, y: 200 }, [pin], [line], 1)).toBeNull();
  expect(lineMidpoint(line.points)).toEqual({ x: 350, y: 300 }); // half of 700 cm, on the first segment
  expect(findLineVertexAt({ x: 401, y: 599 }, line, 1)).toBe(2);
  expect(findLineSegmentAt({ x: 402, y: 450 }, line, 1)).toBe(1);
  const svg = markupSvg([pin], [line], 0, 0);
  expect(svg.lines).toContain('stroke-dasharray="8 5"'); // recommendations are dashed
  expect(svg.markers).toContain('<circle'); // finding pin: circle
  expect(svg.markers).toContain('<polygon'); // recommendation marker: hexagon
});

it('validates pins and lines in saved files', () => {
  const saved = JSON.parse(JSON.stringify(roomProject()));
  saved.floors[0].overlayPins = [{ id: 'p', layer: 'survey-findings', description: 'x', color: '#3b82c4', x: 0, y: 0 }];
  saved.floors[0].overlayLines = [{ id: 'l', layer: 'recommended-works', description: 'y', color: '#3b82c4', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }];
  saved.surveyDate = '2026-10-09';
  const loaded = readProject(saved);
  expect(loaded.floors[0].overlayPins![0].ref).toBe('F1');
  expect(loaded.floors[0].overlayLines![0].ref).toBe('R1');
  const bad = (change: (copy: any) => void) => { const copy = structuredClone(saved); change(copy); return () => readProject(copy); };
  expect(bad(c => { c.floors[0].overlayLines[0].points = [{ x: 0, y: 0 }]; })).toThrow(/overlayLines\[0\]\.points/);
  expect(bad(c => { c.floors[0].overlayPins[0].color = 'blue'; })).toThrow(/overlayPins\[0\]\.color/);
  expect(bad(c => { c.floors[0].overlayPins[0].layer = 'other'; })).toThrow(/overlayPins\[0\]\.layer/);
  expect(bad(c => { c.floors[0].overlayPins[0].description = 'x'.repeat(501); })).toThrow(/description/);
  expect(bad(c => { c.surveyDate = '9/10/2026'; })).toThrow(/surveyDate/);
  expect(bad(c => { c.surveyReferences = { F: -1, R: 0 }; })).toThrow(/surveyReferences/);
});

it('migrates stored documents to the current schema and refuses newer ones', () => {
  expect(CURRENT_SCHEMA_VERSION).toBe(3);
  const stage4 = JSON.parse(JSON.stringify(roomProject()));
  stage4.floors[0].surveyFindings = [{ id: 'a', layer: 'survey-findings', code: 'HM', shape: 'rect', x: 0, y: 0, width: 10, height: 10 }];
  const opened = documentToProject({ id: '0b2c7e5a-4f3a-4b8e-9a5f-3c2d1e0f9a8b', project_name: 'Old', project_data: stage4, schema_version: 1 });
  expect(opened.floors[0].surveyFindings![0].ref).toBe('F1');
  expect(() => migrateDocument(stage4, 4)).toThrow(NewerSchemaError);
});

// ── Legend and export views ──────────────────────────────────────────

it('builds the legend from items in use, in reference order, per layer', () => {
  addPin({ layer: 'survey-findings', description: 'Defective rainwater goods', color: '#9466ad' }, { x: 0, y: 0 }); // F1
  addZone(HM, rect); // F2
  addZone({ layer: 'survey-findings', code: 'DP', name: 'Defective external pointing', color: '#5d5fb8', preset: null }, rect); // F3
  addZone(WT, rect); // R1
  addLine({ layer: 'recommended-works', description: 'Remove contaminated plaster to this section', color: '#1f4f8f' }, [{ x: 0, y: 0 }, { x: 10, y: 0 }]); // R2
  for (let i = 0; i < 8; i++) addPin({ layer: 'survey-findings', description: `note ${i}`, color: '#3b82c4' }, { x: 0, y: 0 }); // F4–F11
  const legend = buildLegend(all());
  expect(legend['survey-findings'].map(e => e.ref)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11']); // numeric, not F10 before F2
  expect(legend['survey-findings'].slice(0, 3).map(legendText)).toEqual(['F1 — Defective rainwater goods', 'F2 — HM — High Moisture', 'F3 — DP — Defective external pointing']);
  // Recommendations read reference → priority → recommendation (no type codes); without a priority they are flagged.
  expect(legend['recommended-works'].map(legendText)).toEqual(['R1 — Priority required — Woodworm Treatment', 'R2 — Priority required — Remove contaminated plaster to this section']);
  expect(legend['recommended-works'][1]).toMatchObject({ kind: 'line', priority: 'unassigned', color: '#a1a1aa' });
  // Export views: each plan shows only its own layer, without touching the editor settings.
  const findingsOnly = surveyPlanView(get(currentProject)!, get(projectSettings), viewLayers('survey-findings')).floors[0];
  expect(findingsOnly.recommendedWorks).toEqual([]);
  expect(findingsOnly.overlayLines).toEqual([]);
  expect(findingsOnly.overlayPins).toHaveLength(9);
  expect(legendSections(findingsOnly, 'survey-findings').map(s => s.title)).toEqual(['SURVEY FINDINGS']);
  expect(legendSections(all(), 'combined').map(s => s.entries.length)).toEqual([11, 2]);
  expect(legendSections(all(), 'recommended-works')[0].entries.map(e => e.ref)).toEqual(['R1', 'R2']);
  expect(get(projectSettings).showRecommendedWorks).toBe(true);
});

it('lays out plans of any shape without distortion and never under the legend', () => {
  const sections: LegendSection[] = [{ layer: 'survey-findings', title: 'SURVEY FINDINGS', emptyText: 'none', entries: [
    { id: '1', ref: 'F1', layer: 'survey-findings', kind: 'area', code: 'HM', text: 'High Moisture', color: '#3b82c4' },
    { id: '2', ref: 'F2', layer: 'survey-findings', kind: 'pin', text: 'Defective rainwater goods above this location', color: '#9466ad' },
  ] }];
  const boxes = (l: ReturnType<typeof calculateReportLayout>) => {
    const legendBox = l.legend, planBox = { ...l.plan, height: l.plan.height + l.scaleBar.height };
    const overlap = !(legendBox.x >= planBox.x + planBox.width || planBox.x >= legendBox.x + legendBox.width || legendBox.y >= planBox.y + planBox.height || planBox.y >= legendBox.y + legendBox.height);
    return { overlap, insidePage: legendBox.y + legendBox.height <= l.footer.y && planBox.y + planBox.height <= l.footer.y };
  };
  const wide = calculateReportLayout({ minX: 0, minY: 0, maxX: 3000, maxY: 400 }, sections, measure); // long terrace
  const tall = calculateReportLayout({ minX: 0, minY: 0, maxX: 400, maxY: 3000 }, sections, measure); // long narrow plan
  const square = calculateReportLayout({ minX: 0, minY: 0, maxX: 800, maxY: 800 }, sections, measure);
  const huge = calculateReportLayout({ minX: -5000, minY: -2000, maxX: 5000, maxY: 2000 }, sections, measure);
  for (const layout of [wide, tall, square, huge]) {
    expect(boxes(layout)).toEqual({ overlap: false, insidePage: true });
    const padded = paddedBounds(layout === wide ? { minX: 0, minY: 0, maxX: 3000, maxY: 400 } : layout === tall ? { minX: 0, minY: 0, maxX: 400, maxY: 3000 } : layout === square ? { minX: 0, minY: 0, maxX: 800, maxY: 800 } : { minX: -5000, minY: -2000, maxX: 5000, maxY: 2000 });
    // One scale for both axes: the drawn plan fits its box in both directions.
    expect((padded.maxX - padded.minX) * layout.mmPerCm).toBeLessThanOrEqual(layout.plan.width + 1e-6);
    expect((padded.maxY - padded.minY) * layout.mmPerCm).toBeLessThanOrEqual(layout.plan.height + 1e-6);
  }
  expect(tall.orientation).toBe('portrait');
  expect(wide.orientation).toBe('landscape');
  // The Word report size: 17 cm wide, same rules.
  for (const plan of [{ minX: 0, minY: 0, maxX: 3000, maxY: 400 }, { minX: 0, minY: 0, maxX: 400, maxY: 3000 }, { minX: 0, minY: 0, maxX: 800, maxY: 600 }]) {
    const word = calculateReportLayout(plan, sections, measure, 'word');
    expect(word.pageWidth).toBe(170);
    expect(boxes(word)).toEqual({ overlap: false, insidePage: true });
    // A Word figure is only as tall as the plan needs.
    if (plan.maxY > plan.maxX * 2) expect(word.pageHeight).toBeGreaterThanOrEqual(200); // the tallest Word frames (200–215 mm)
    if (plan.maxX > plan.maxY * 2) expect(word.pageHeight).toBeLessThanOrEqual(125);
  }
  expect(scaleBarLength(0.1)).toBe(200);
  expect(scaleBarLength(0.02)).toBe(1000);
});

it('wraps very long descriptions and keeps long legends on the page', () => {
  expect(wrapText('Elevated moisture readings along base of external wall', 40, 3, measure).length).toBeGreaterThan(1);
  expect(wrapText('Supercalifragilisticexpialidocious', 20, 3, measure).every(line => measure(line, 3) <= 20)).toBe(true);
  const long = 'Elevated moisture readings recorded with a calibrated meter along the base of the rear external wall, consistent with bridging of the damp-proof course by raised external ground levels.';
  const entries = Array.from({ length: 30 }, (_, i) => ({ id: String(i), ref: `F${i + 1}`, layer: 'survey-findings' as const, kind: 'pin' as const, text: long, color: '#3b82c4' }));
  const sections: LegendSection[] = [{ layer: 'survey-findings', title: 'SURVEY FINDINGS', emptyText: '', entries }];
  const layout = calculateReportLayout({ minX: 0, minY: 0, maxX: 1000, maxY: 700 }, sections, measure);
  expect(layout.legend.y + layout.legend.height).toBeLessThanOrEqual(layout.footer.y);
  expect(layout.legendLayout.rows.filter(r => r.kind === 'entry')).toHaveLength(30);
  // Rows in the same column never overlap.
  const rows = layout.legendLayout.rows;
  for (let i = 1; i < rows.length; i++) if (rows[i].column === rows[i - 1].column) expect(rows[i].y).toBeGreaterThanOrEqual(rows[i - 1].y + rows[i - 1].height - 1e-9);
  const legend = layoutLegend(sections, 80, 1, 3, 60, measure);
  expect(legend.fits).toBe(false);
});

it('names files safely from the address and floor, without the customer', () => {
  const details = { projectName: '14 Moor Lane - Smith', propertyAddress: '14 Moor Lane, Leeds LS1 2AB', floorName: 'Ground Floor', surveyDate: '2026-10-09' };
  expect(reportFilename(details, 'survey-findings', 'png')).toBe('14-Moor-Lane-Ground-Floor-Survey-Findings.png');
  expect(reportFilename(details, 'recommended-works', 'pdf')).toBe('14-Moor-Lane-Ground-Floor-Recommended-Works.pdf');
  expect(reportFilename(details, 'combined', 'png')).toBe('14-Moor-Lane-Ground-Floor-Combined-Plan.png');
  expect(reportFilename({ ...details, propertyAddress: 'Flat 2/3 "Rosé" Court\nYork', floorName: 'Roof Space' }, 'survey-findings', 'png')).toBe('Flat-2-3-Rose-Court-Roof-Space-Survey-Findings.png');
  expect(reportFilename({ ...details, propertyAddress: null, projectName: '../../etc' }, 'survey-findings', 'png')).toBe('etc-Ground-Floor-Survey-Findings.png');
  expect(reportFilename({ ...details, propertyAddress: '', projectName: '' , floorName: '' }, 'combined', 'png')).toBe('Survey-Plan-Combined-Plan.png');
  expect(formatSurveyDate('2026-10-09')).toBe('9 October 2026');
  expect(formatSurveyDate('bad')).toBe('');
});

it('stores survey date and floor names with undo', () => {
  setSurveyDate('2026-10-09');
  setFloorName(floor().id, '  Cellar ');
  expect(get(currentProject)!.surveyDate).toBe('2026-10-09');
  expect(floor().name).toBe('Cellar');
  undo();
  expect(floor().name).not.toBe('Cellar');
  setSurveyDate('');
  expect('surveyDate' in get(currentProject)!).toBe(false);
});

it('tags PNGs with their resolution for Word', () => {
  const png = Uint8Array.from(readFileSync('docs/reviews/assets/native-reflection-mirrored.png'));
  const tagged = pngWithDpi(png, 300);
  const text = Buffer.from(tagged);
  const at = text.indexOf('pHYs');
  expect(at).toBe(37); // straight after IHDR (8-byte signature + 25-byte IHDR + 4-byte length)
  expect(Math.round(text.readUInt32BE(at + 4) * 0.0254)).toBe(300);
  expect(tagged.length).toBe(png.length + 21);
});

it('keeps references and markups through RoomPlan imports and floor changes', () => {
  const project: Project = createProjectFromRoomPlan(JSON.parse(readFileSync('test-roomplan.json', 'utf8')), 'Scan');
  loadProject(project);
  addZone(HM, rect);
  addPin({ layer: 'recommended-works', description: 'Install additional subfloor ventilation', color: '#2fa3a8' }, { x: 100, y: 100 });
  const saved = readProject(JSON.parse(JSON.stringify(get(currentProject))));
  expect(saved.floors[0].surveyFindings![0].ref).toBe('F1');
  expect(saved.floors[0].overlayPins![0]).toMatchObject({ ref: 'R1', description: 'Install additional subfloor ventilation' });
});
