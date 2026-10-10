import { beforeEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { currentProject, loadProject, undo } from '$lib/stores/project';
import { projectSettings } from '$lib/stores/settings';
import { readProject } from '$lib/utils/projectValidation';
import { PRIORITIES, UNASSIGNED, formatPence, itemColor, itemInk, itemPriority, parsePounds, priorityStyle } from '$lib/northway/priorities';
import { addLine, addPin, addZone, duplicateMarkup, duplicateZone, placePinAt, placingMarkup, setPriority, unassignedRefs, updateRecommendation, setZoneRect, applyZonePreset } from '$lib/northway/overlayStore';
import { buildLegend, legendText } from '$lib/northway/legend';
import { findPreset } from '$lib/northway/zonePresets';
import { calculateReportLayout, type Measure } from '$lib/northway/export/reportLayout';
import { legendSections, reportFilename } from '$lib/northway/export/reportExport';
import { overlaySvg, markupSvg } from '$lib/northway/overlaySvg';
import { CURRENT_SCHEMA_VERSION, documentToProject } from '$lib/northway/cloud/projectDocument';
import { roomProject } from './fixtures/project';

vi.mock('jspdf', () => ({ default: class {} }));

const floor = () => get(currentProject)!.floors[0];
const rect = { x: 0, y: 0, width: 200, height: 120 };
const measure: Measure = (text, size, bold) => text.length * size * (bold ? 0.58 : 0.52);
const rec = (priority: any, text: string) => ({ layer: 'recommended-works' as const, code: 'REC', name: text, color: priorityStyle(priority).color, preset: null, priority });

beforeEach(() => {
  projectSettings.update(settings => ({ ...settings, showSurveyFindings: true, showRecommendedWorks: true, objectLibrary: 'survey' }));
  loadProject(roomProject());
});

/** Hue in degrees of a #rrggbb colour. */
function hue(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

// ── The priority system ──────────────────────────────────────────────

it('defines Northway Priorities 3, 2, 1 and Further Investigation with the agreed wording', () => {
  expect(PRIORITIES.map(p => [p.id, p.badge, p.label])).toEqual([
    ['priority_3', '3', '3 — Priority Work'],
    ['priority_2', '2', '2 — Recommended Work'],
    ['priority_1', '1', '1 — Advisory Work'],
    ['further_investigation', 'FI', 'FI — Further Investigation'],
  ]);
  expect(PRIORITIES.map(p => p.definition)).toEqual([
    'Work that should be addressed promptly to prevent significant deterioration or further damage.',
    'Work recommended to correct an identified defect or reduce the risk of deterioration.',
    'Lower-priority, preventative or maintenance work that would benefit the property.',
    'Additional inspection or opening-up is required before the condition or required works can be fully confirmed.',
  ]);
  // Red, amber, yellow; never green. Further Investigation is a muted blue-grey.
  const [p3, p2, p1, fi] = PRIORITIES.map(p => hue(p.color));
  expect(p3 < 15 || p3 > 345).toBe(true);
  expect(p2).toBeGreaterThan(20); expect(p2).toBeLessThan(40);
  expect(p1).toBeGreaterThan(40); expect(p1).toBeLessThan(60);
  expect(fi).toBeGreaterThan(195); expect(fi).toBeLessThan(230);
  for (const p of PRIORITIES) expect(hue(p.color) > 70 && hue(p.color) < 170).toBe(false);
  // Not presented as an RICS condition rating.
  const wording = JSON.stringify([...PRIORITIES, UNASSIGNED]);
  expect(wording).not.toMatch(/RICS|Condition Rating|Condition [123]/i);
});

it('colours recommendations by priority and leaves findings their own colour', () => {
  expect(itemColor({ layer: 'survey-findings', color: '#3b82c4' })).toBe('#3b82c4');
  expect(itemColor({ layer: 'recommended-works', color: '#3b82c4', priority: 'priority_3' })).toBe('#b8443d');
  expect(itemColor({ layer: 'recommended-works', color: '#b8443d' })).toBe(UNASSIGNED.color); // no priority: grey, never inferred from colour
  expect(itemInk({ layer: 'recommended-works', priority: 'priority_1' })).toBe('#7d6508');
  expect(itemPriority({ layer: 'survey-findings', priority: 'priority_3' } as any)).toBeNull();
});

// ── Creating and editing recommendations ─────────────────────────────

it('creates recommendations with priority and free text, and edits priority without touching reference or geometry', () => {
  const r1 = addZone(rec('priority_3', 'Replace decayed floor joists and affected floorboards to rear reception room'), rect);
  const r2 = addPin({ layer: 'recommended-works', description: 'Apply insecticidal treatment to accessible affected floor timbers', color: '', priority: 'priority_2', workType: 'WT' }, { x: 50, y: 50 });
  const r3 = addLine({ layer: 'recommended-works', description: 'Improve subfloor ventilation', color: '', priority: 'priority_1' }, [{ x: 0, y: 0 }, { x: 300, y: 0 }]);
  const r4 = addZone(rec('further_investigation', 'Lift floor locally to inspect concealed joist ends'), { x: 300, y: 0, width: 80, height: 60 });
  expect(floor().recommendedWorks!.map(z => [z.ref, z.priority, z.color])).toEqual([['R1', 'priority_3', '#b8443d'], ['R4', 'further_investigation', '#6f8197']]);
  expect(floor().overlayPins![0]).toMatchObject({ ref: 'R2', priority: 'priority_2', workType: 'WT', color: '#d68a2e' });
  expect(floor().overlayLines![0]).toMatchObject({ ref: 'R3', priority: 'priority_1', color: '#d9b425' });

  setZoneRect(r1, { x: 10, y: 10, width: 220, height: 130 }); // move and resize
  setPriority(r3, 'priority_2'); // Lewis reviews the photographs: 1 → 2
  setPriority(r1, 'priority_2');
  expect(floor().overlayLines![0]).toMatchObject({ ref: 'R3', priority: 'priority_2', color: '#d68a2e', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] });
  expect(floor().recommendedWorks![0]).toMatchObject({ ref: 'R1', priority: 'priority_2', x: 10, y: 10, width: 220, height: 130 });
  undo();
  expect(floor().recommendedWorks![0].priority).toBe('priority_3');

  updateRecommendation(r4, { text: 'Further opening-up required behind fitted units', workType: 'FI', quotedPricePence: 25000 });
  updateRecommendation(r2, { text: 'Apply localised woodworm treatment to affected timbers' });
  expect(floor().recommendedWorks![1]).toMatchObject({ ref: 'R4', name: 'Further opening-up required behind fitted units', workType: 'FI', quotedPricePence: 25000 });
  expect(floor().overlayPins![0].description).toBe('Apply localised woodworm treatment to affected timbers');
  updateRecommendation(r4, { quotedPricePence: null });
  expect('quotedPricePence' in floor().recommendedWorks![1]).toBe(false);

  // A work type on a recommendation never changes its priority or colour.
  applyZonePreset(r4, 'DRT');
  expect(floor().recommendedWorks![1]).toMatchObject({ priority: 'further_investigation', workType: 'DRT', color: '#6f8197' });

  // Duplicates keep the priority and get their own reference.
  const copyArea = duplicateZone(r1)!, copyPin = duplicateMarkup(r2)!;
  expect(floor().recommendedWorks!.find(z => z.id === copyArea)).toMatchObject({ ref: 'R5', priority: 'priority_3' });
  expect(floor().overlayPins!.find(p => p.id === copyPin)).toMatchObject({ ref: 'R6', priority: 'priority_2' });
});

it('places a described recommendation pin straight away', () => {
  placingMarkup.set({ kind: 'pin', layer: 'recommended-works', draft: { layer: 'recommended-works', description: 'Lift floor locally', color: '', priority: 'further_investigation' } });
  const id = placePinAt({ x: 5, y: 6 });
  expect(floor().overlayPins!.find(p => p.id === id)).toMatchObject({ ref: 'R1', priority: 'further_investigation', x: 5, y: 6 });
  expect(get(placingMarkup)).toBeNull();
});

// ── Older plans ──────────────────────────────────────────────────────

it('loads older recommendations as Unassigned, never guessing from colour or type', () => {
  const stage5 = JSON.parse(JSON.stringify(roomProject()));
  stage5.floors[0].recommendedWorks = [
    { id: 'a', layer: 'recommended-works', ref: 'R1', code: 'DRT', name: 'Dry Rot Treatment', color: '#b5534f', preset: 'DRT', shape: 'rect', x: 0, y: 0, width: 10, height: 10 },
    { id: 'b', layer: 'recommended-works', ref: 'R2', code: 'FI', name: 'Further Investigation', color: '#3b82c4', preset: 'FI', shape: 'rect', x: 0, y: 0, width: 10, height: 10 },
  ];
  stage5.floors[0].overlayPins = [{ id: 'p', layer: 'recommended-works', ref: 'R3', description: 'Old note', color: '#d9823b', x: 0, y: 0 }];
  stage5.floors[0].surveyFindings = [{ id: 'f', layer: 'survey-findings', ref: 'F1', code: 'HM', name: 'High Moisture', color: '#3b82c4', preset: 'HM', shape: 'rect', x: 0, y: 0, width: 10, height: 10 }];
  const opened = documentToProject({ id: '0b2c7e5a-4f3a-4b8e-9a5f-3c2d1e0f9a8b', project_name: 'Stage 5 plan', project_data: stage5, schema_version: 2 });
  const f = opened.floors[0];
  expect(f.recommendedWorks!.map(z => z.priority)).toEqual(['unassigned', 'unassigned']); // even the FI preset
  expect(f.overlayPins![0].priority).toBe('unassigned');
  expect(f.recommendedWorks![0].color).toBe('#b5534f'); // old data kept as saved
  expect(itemColor(f.recommendedWorks![0])).toBe(UNASSIGNED.color); // but drawn grey
  expect('priority' in f.surveyFindings![0]).toBe(false); // findings never get a priority
  expect(unassignedRefs(f)).toEqual(['R1', 'R2', 'R3']);
  expect(CURRENT_SCHEMA_VERSION).toBe(3);
});

it('validates priority, price and future fields', () => {
  const saved = JSON.parse(JSON.stringify(roomProject()));
  saved.floors[0].recommendedWorks = [{ id: 'a', layer: 'recommended-works', ref: 'R1', code: 'REC', name: 'x', color: '#b8443d', preset: null, shape: 'rect', x: 0, y: 0, width: 10, height: 10,
    priority: 'priority_3', workType: 'TR', quotedPricePence: 125050, specification: 'BS 8417', quantity: '4 joists' }];
  expect(readProject(saved).floors[0].recommendedWorks![0]).toMatchObject({ priority: 'priority_3', workType: 'TR', quotedPricePence: 125050, specification: 'BS 8417', quantity: '4 joists' });
  const bad = (change: (copy: any) => void) => { const copy = structuredClone(saved); change(copy); return () => readProject(copy); };
  expect(bad(c => { c.floors[0].recommendedWorks[0].priority = 'condition_3'; })).toThrow(/priority/);
  expect(bad(c => { c.floors[0].recommendedWorks[0].quotedPricePence = 12.5; })).toThrow(/quotedPricePence/);
  expect(bad(c => { c.floors[0].recommendedWorks[0].quotedPricePence = -1; })).toThrow(/quotedPricePence/);
  expect(parsePounds('£1,250.50')).toBe(125050);
  expect(parsePounds('')).toBeNull();
  expect(parsePounds('12.345')).toBeUndefined();
  expect(formatPence(125050)).toBe('£1,250.50');
});

// ── Legend and exports ───────────────────────────────────────────────

it('lists recommendations as Reference → Priority → Recommendation, with the Priority Guide', () => {
  addZone({ ...presetTemplateFor('HM') }, rect); // F1
  addZone(rec('priority_3', 'Replace decayed floor joists and affected floorboards'), rect); // R1
  addPin({ layer: 'recommended-works', description: 'Apply localised woodworm treatment to affected timbers', color: '', priority: 'priority_2', workType: 'WT' }, { x: 0, y: 0 }); // R2
  addLine({ layer: 'recommended-works', description: 'Improve subfloor ventilation', color: '', priority: 'priority_1' }, [{ x: 0, y: 0 }, { x: 10, y: 0 }]); // R3
  addZone(rec('further_investigation', 'Lift floor locally for further investigation'), rect); // R4
  const legend = buildLegend(floor());
  expect(legend['recommended-works'].map(legendText)).toEqual([
    'R1 — Priority 3 — Replace decayed floor joists and affected floorboards',
    'R2 — Priority 2 — Apply localised woodworm treatment to affected timbers',
    'R3 — Priority 1 — Improve subfloor ventilation',
    'R4 — Further Investigation — Lift floor locally for further investigation',
  ]);
  expect(legend['recommended-works'].every(e => e.code === undefined)).toBe(true); // no WT/TR/DPT codes for homeowners
  expect(legendText(legend['survey-findings'][0])).toBe('F1 — HM — High Moisture'); // findings unchanged

  const works = legendSections(floor(), 'recommended-works');
  expect(works[0].guide!.title).toBe('NORTHWAY PRIORITY GUIDE');
  expect(works[0].guide!.items.map(i => `${i.badge} — ${i.name}`)).toEqual(['3 — Priority Work', '2 — Recommended Work', '1 — Advisory Work', 'FI — Further Investigation']);
  const findingsOnly = legendSections(floor(), 'survey-findings');
  expect(findingsOnly.map(s => s.guide)).toEqual([undefined]); // the Survey Findings Plan has no priority key

  const layout = calculateReportLayout({ minX: 0, minY: 0, maxX: 600, maxY: 400 }, works, measure, 'word');
  const rows = layout.legendLayout.rows;
  expect(rows.map(r => r.kind).slice(0, 6)).toEqual(['heading', 'guide-title', 'guide', 'guide', 'guide', 'guide']);
  expect(rows.filter(r => r.kind === 'entry')).toHaveLength(4);
  for (let i = 1; i < rows.length; i++) if (rows[i].column === rows[i - 1].column) expect(rows[i].y).toBeGreaterThanOrEqual(rows[i - 1].y + rows[i - 1].height - 1e-9);
  expect(layout.legend.y + layout.legend.height).toBeLessThanOrEqual(layout.footer.y);

  // Plan styling follows priority in SVG too.
  const svg = overlaySvg(floor().recommendedWorks!, 0, 0);
  expect(svg.areas).toContain('stroke="rgba(140, 47, 41, 0.95)"'); // Priority 3 ink border
  expect(markupSvg(floor().overlayPins!, floor().overlayLines!, 0, 0).lines).toContain('stroke-dasharray'); // recommendation lines dashed
});

it('marks draft exports in the file name', () => {
  const details = { projectName: 'x', propertyAddress: '14 Moor Lane, Leeds', floorName: 'Ground Floor' };
  expect(reportFilename({ ...details, draft: true }, 'recommended-works', 'png')).toBe('14-Moor-Lane-Ground-Floor-Recommended-Works-DRAFT.png');
  expect(reportFilename(details, 'recommended-works', 'png')).toBe('14-Moor-Lane-Ground-Floor-Recommended-Works.png');
});

function presetTemplateFor(code: string) {
  const preset = findPreset('survey-findings', code)!;
  return { layer: preset.layer, code: preset.code, name: preset.name, color: preset.color, preset: preset.code };
}

it('lays out a very long combined legend with the Priority Guide on the Word size', () => {
  // Regression: when the legend overflowed every Word-size frame, no layout was chosen.
  const long = 'Elevated moisture readings recorded with a calibrated meter along the base of the wall, consistent with bridging of the damp-proof course by raised external ground levels';
  for (let i = 0; i < 12; i++) addPin({ layer: 'survey-findings', description: long, color: '#3b82c4' }, { x: i * 10, y: 0 });
  for (let i = 0; i < 6; i++) addPin({ layer: 'recommended-works', description: 'Install additional subfloor ventilation to this elevation', color: '', priority: 'priority_2' }, { x: i * 10, y: 50 });
  const sections = legendSections(floor(), 'combined');
  const layout = calculateReportLayout({ minX: 0, minY: 0, maxX: 1000, maxY: 700 }, sections, measure, 'word');
  expect(layout.pageWidth).toBe(170);
  expect(layout.legend.y + layout.legend.height).toBeLessThanOrEqual(layout.footer.y);
  expect(layout.legendLayout.rows.filter(r => r.kind === 'entry')).toHaveLength(18);
});
