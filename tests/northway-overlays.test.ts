import { beforeEach, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { OverlayZone, RecommendedWorkZone, SurveyFindingZone } from '$lib/models/types';
import { currentProject, loadProject, removeElement, undo, redo } from '$lib/stores/project';
import { projectSettings } from '$lib/stores/settings';
import { readProject } from '$lib/utils/projectValidation';
import { surveyPlanView } from '$lib/northway/planView';
import {
  LAYER_STYLES, RECOMMENDED_WORK_PRESETS, SURVEY_FINDING_PRESETS, ZONE_PALETTE, cleanCode, findPreset, overlayTypesInUse, suggestCode, zoneAppearance,
} from '$lib/northway/zonePresets';
import { addZone, applyZonePreset, duplicateZone, presetTemplate, removeZone, setZoneRect, updateZone } from '$lib/northway/overlayStore';
import { drawZoneAreas, drawZoneCodes, pickZoneAt, zonesAt } from '$lib/northway/overlayRenderer';
import { overlaySvg } from '$lib/northway/overlaySvg';
import { roomProject } from './fixtures/project';

vi.mock('jspdf', () => ({ default: class {} }));

const floor = () => get(currentProject)!.floors[0];
const rect = { x: 100, y: 50, width: 200, height: 150 };
const finding = (extra: Partial<SurveyFindingZone> = {}): SurveyFindingZone => ({ id: 'f', layer: 'survey-findings', code: 'WM', name: 'Woodworm Activity', color: '#d9823b', preset: 'WM', shape: 'rect', ...rect, ...extra });
const work = (extra: Partial<RecommendedWorkZone> = {}): RecommendedWorkZone => ({ id: 'w', layer: 'recommended-works', code: 'WT', name: 'Woodworm Treatment', color: '#d9823b', preset: 'WT', shape: 'rect', ...rect, ...extra });

beforeEach(() => {
  projectSettings.update(settings => ({ ...settings, showSurveyFindings: true, showRecommendedWorks: true }));
});

// ── Configuration ────────────────────────────────────────────────────

it('defines the ten recommended works presets separately from the findings', () => {
  expect(RECOMMENDED_WORK_PRESETS.map(p => p.code)).toEqual(['WT', 'DPT', 'TR', 'DRT', 'WRT', 'MR', 'VI', 'PR', 'MT', 'FI']);
  expect(RECOMMENDED_WORK_PRESETS.map(p => p.name)).toEqual([
    'Woodworm Treatment', 'Damp Proofing Treatment', 'Timber Repair / Replacement', 'Dry Rot Treatment', 'Wet Rot Treatment',
    'Mould Remediation', 'Ventilation Improvement', 'Plaster Removal / Reinstatement', 'Masonry Treatment / Repair', 'Further Investigation',
  ]);
  expect(SURVEY_FINDING_PRESETS.map(p => p.code)).toEqual(['HM', 'WM', 'DR', 'WR', 'MG', 'CD', 'PD', 'RD', 'TD', 'SV']);
  expect(RECOMMENDED_WORK_PRESETS.every(p => p.layer === 'recommended-works')).toBe(true);
  // Every preset colour comes from the shared palette.
  const palette = new Set(ZONE_PALETTE.map(c => c.hex));
  expect([...SURVEY_FINDING_PRESETS, ...RECOMMENDED_WORK_PRESETS].every(p => palette.has(p.color))).toBe(true);
  expect(ZONE_PALETTE.length).toBeGreaterThanOrEqual(8);
  expect(ZONE_PALETTE.length).toBeLessThanOrEqual(10);
  expect(findPreset('recommended-works', 'HM')).toBeUndefined(); // the layers' presets never mix
});

it('styles recommendations differently from findings without relying on colour', () => {
  const findings = LAYER_STYLES['survey-findings'], works = LAYER_STYLES['recommended-works'];
  expect(findings.dash).toEqual([]);
  expect(findings.hatch).toBeNull();
  expect(works.dash.length).toBeGreaterThan(0);
  expect(works.hatch).not.toBeNull();
  expect(works.fillOpacity).toBeLessThan(findings.fillOpacity);
  expect(works.borderWidth).toBeGreaterThan(findings.borderWidth);
  expect(works.codeCorner).not.toBe(findings.codeCorner);
});

it('suggests and limits short codes', () => {
  expect(suggestCode('Defective Pointing')).toBe('DP');
  expect(suggestCode('Damp Proofing Treatment')).toBe('DPT');
  expect(suggestCode('Open Floor for Further Inspection')).toBe('OFFI');
  expect(suggestCode('Asbestos')).toBe('AS');
  expect(suggestCode('   ')).toBe('');
  expect(cleanCode('of')).toBe('OF');
  expect(cleanCode('d-p 12345')).toBe('DP12');
});

it('resolves appearance from the zone, then its preset, then neutral defaults', () => {
  // Since Stage 6 a recommendation's colour comes from its Northway Priority, never its stored colour.
  expect(zoneAppearance(work({ name: 'Inject cream', color: '#2fa3a8', priority: 'priority_3' }))).toEqual({ code: 'WT', name: 'Inject cream', color: '#b8443d', custom: false });
  expect(zoneAppearance({ layer: 'survey-findings', code: 'HM' })).toMatchObject({ name: 'High Moisture', color: '#3b82c4', custom: false });
  expect(zoneAppearance({ layer: 'recommended-works', code: 'OF', name: 'Open Floor', color: '#5d5fb8', preset: null })).toMatchObject({ custom: true, color: '#a1a1aa' }); // unassigned
  expect(zoneAppearance({ layer: 'survey-findings', code: 'ZZ' })).toMatchObject({ name: 'ZZ', color: '#7a7f87', custom: true });
});

it('lists the zone types in use for the Stage 5 legend', () => {
  const types = overlayTypesInUse([
    { surveyFindings: [finding(), finding({ id: 'f2' }), finding({ id: 'dp', code: 'DP', name: 'Defective Pointing', color: '#5d5fb8', preset: null })], recommendedWorks: [work()] },
    { recommendedWorks: [work({ id: 'w2' }), work({ id: 'of', code: 'OF', name: 'Open Floor for Further Inspection', color: '#2fa3a8', preset: null })] },
  ]);
  expect(types['survey-findings'].map(t => t.code)).toEqual(['WM', 'DP']);
  expect(types['recommended-works']).toEqual([
    { code: 'WT', name: 'Woodworm Treatment', color: '#a1a1aa', custom: false },
    { code: 'OF', name: 'Open Floor for Further Inspection', color: '#a1a1aa', custom: true },
  ]);
});

// ── Editing ──────────────────────────────────────────────────────────

it('adds both layers independently, edits metadata without moving them, and undoes', () => {
  loadProject(roomProject());
  const hm = addZone(presetTemplate(findPreset('survey-findings', 'HM')!), rect);
  const wt = addZone(presetTemplate(findPreset('recommended-works', 'WT')!), rect);
  const of = addZone({ layer: 'recommended-works', code: 'OF', name: 'Open Floor for Further Inspection', color: '#2fa3a8', preset: null }, { x: 0, y: 0, width: 50, height: 50 });
  expect(floor().surveyFindings!.map(z => z.id)).toEqual([hm]);
  expect(floor().recommendedWorks!.map(z => z.id)).toEqual([wt, of]);
  // A recommendation created without a priority is 'unassigned' (grey) until the surveyor chooses one.
  expect(floor().recommendedWorks![0]).toMatchObject({ layer: 'recommended-works', code: 'WT', name: 'Woodworm Treatment', color: '#a1a1aa', priority: 'unassigned', preset: 'WT', ...rect });

  updateZone(hm, { name: 'High Moisture - chimney breast' });
  updateZone(hm, { code: 'HMC' });
  updateZone(hm, { color: '#1f4f8f' });
  expect(floor().surveyFindings![0]).toMatchObject({ name: 'High Moisture - chimney breast', code: 'HMC', color: '#1f4f8f', preset: 'HM', ...rect });
  // Editing one zone never changes the preset or other zones.
  expect(findPreset('survey-findings', 'HM')).toMatchObject({ name: 'High Moisture', color: '#3b82c4' });
  undo();
  expect(floor().surveyFindings![0].color).toBe('#3b82c4');
  redo();

  applyZonePreset(wt, 'VI'); // on a recommendation, a preset is only its work type
  expect(floor().recommendedWorks![0]).toMatchObject({ code: 'VI', workType: 'VI', name: 'Woodworm Treatment', priority: 'unassigned', preset: 'VI', ...rect });
  applyZonePreset(wt, 'HM'); // not a recommendation preset: ignored
  expect(floor().recommendedWorks![0].code).toBe('VI');

  setZoneRect(of, { x: 10, y: 20, width: 60, height: 70 });
  expect(floor().recommendedWorks![1]).toMatchObject({ x: 10, y: 20, width: 60, height: 70 });

  const copy = duplicateZone(of)!;
  expect(floor().recommendedWorks![2]).toMatchObject({ id: copy, code: 'OF', preset: null, priority: 'unassigned', x: 40, y: 50 });
  expect(floor().surveyFindings).toHaveLength(1);
  removeZone(copy);
  removeElement(of); // the Delete key path
  expect(floor().recommendedWorks!.map(z => z.id)).toEqual([wt]);
  undo();
  expect(floor().recommendedWorks!.map(z => z.id)).toEqual([wt, of]);
});

// ── Overlaps ─────────────────────────────────────────────────────────

it('selects overlapping zones sensibly and cycles through them on repeat clicks', () => {
  const big = finding({ id: 'big', x: 0, y: 0, width: 400, height: 400 });
  const wm = finding({ id: 'wm' }), wt = work({ id: 'wt' });
  const zones: OverlayZone[] = [big, wm, wt];
  const p = { x: 150, y: 100 };
  // Same area: the recommendation (drawn on top) first; the large zone last.
  expect(zonesAt(p, zones).map(z => z.id)).toEqual(['wt', 'wm', 'big']);
  expect(pickZoneAt(p, zones)?.id).toBe('wt');
  expect(pickZoneAt(p, zones, 'wt')?.id).toBe('wm');
  expect(pickZoneAt(p, zones, 'wm')?.id).toBe('big');
  expect(pickZoneAt(p, zones, 'big')?.id).toBe('wt');
  expect(pickZoneAt({ x: 10, y: 10 }, zones)?.id).toBe('big');
  expect(pickZoneAt({ x: 900, y: 900 }, zones)).toBeNull();
});

// ── Drawing and export ───────────────────────────────────────────────

function recordingContext() {
  const calls: { op: string; args: unknown[]; dash: number[] }[] = [];
  let dash: number[] = [];
  const ctx = new Proxy({
    setLineDash: (value: number[]) => { dash = value; },
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as Record<string, unknown>, {
    get: (target, key) => target[key as string] ?? ((...args: unknown[]) => calls.push({ op: String(key), args, dash })),
    set: (target, key, value) => { target[key as string] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

it('draws findings under recommendations with hatch and dashed borders only on recommendations', () => {
  const { ctx, calls } = recordingContext();
  drawZoneAreas({ ctx, width: 800, height: 600, zoom: 1, camX: 0, camY: 0 }, [work(), finding()]);
  const borders = calls.filter(c => c.op === 'strokeRect');
  expect(borders.map(c => c.dash)).toEqual([[], [7, 4]]); // finding first (solid), then recommendation (dashed)
  expect(calls.filter(c => c.op === 'clip')).toHaveLength(1); // the hatch is clipped to the recommendation
  expect(calls.filter(c => c.op === 'lineTo').length).toBeGreaterThan(5);
  calls.length = 0;
  drawZoneCodes({ ctx, width: 800, height: 600, zoom: 1, camX: 0, camY: 0 }, [work(), finding()]);
  expect(calls.filter(c => c.op === 'fillText').map(c => c.args[0])).toEqual(['WM', 'WT']);
});

it('exports matching SVG for both layers', () => {
  const svg = overlaySvg([finding(), work({ priority: 'priority_3' }), work({ id: 'w2', priority: 'further_investigation' })], 0, 0);
  expect(svg.defs.match(/<pattern /g)).toHaveLength(2); // one hatch per priority colour
  expect(svg.areas).toContain('data-survey-finding="WM"');
  expect(svg.areas).toContain('data-recommended-work="WT"');
  expect(svg.areas).toContain('stroke-dasharray="7 4"');
  expect(svg.areas.indexOf('data-survey-finding')).toBeLessThan(svg.areas.indexOf('data-recommended-work'));
  expect(svg.codes.match(/<text /g)).toHaveLength(3);
});

it('hides each layer independently in exported views without touching the project', () => {
  const project = roomProject();
  project.floors[0].surveyFindings = [finding()];
  project.floors[0].recommendedWorks = [work()];
  const settings = get(projectSettings);
  const noWorks = surveyPlanView(project, { ...settings, showRecommendedWorks: false }).floors[0];
  expect(noWorks.recommendedWorks).toEqual([]);
  expect(noWorks.surveyFindings).toHaveLength(1);
  const noFindings = surveyPlanView(project, { ...settings, showSurveyFindings: false }).floors[0];
  expect(noFindings.surveyFindings).toEqual([]);
  expect(noFindings.recommendedWorks).toHaveLength(1);
  expect(project.floors[0].recommendedWorks).toHaveLength(1);
});

// ── Files ────────────────────────────────────────────────────────────

it('validates recommended works and keeps custom zones as saved', () => {
  const saved = JSON.parse(JSON.stringify(roomProject()));
  saved.floors[0].recommendedWorks = [{ id: 'w', code: 'DPT', x: 0, y: 0, width: 100, height: 40 }, work({ id: 'of', code: 'OF', name: 'Open Floor', color: '#5d5fb8', preset: null })];
  const loaded = readProject(saved).floors[0].recommendedWorks!;
  expect(loaded[0]).toMatchObject({ layer: 'recommended-works', shape: 'rect', preset: 'DPT', name: 'Damp Proofing Treatment', color: '#5d5fb8' });
  expect(loaded[1]).toMatchObject({ code: 'OF', name: 'Open Floor', preset: null });
  expect(readProject(JSON.parse(JSON.stringify(roomProject()))).floors[0].recommendedWorks).toBeUndefined();

  const bad = (zone: object) => { const copy = structuredClone(saved); copy.floors[0].recommendedWorks = [{ ...work(), ...zone }]; return () => readProject(copy); };
  expect(bad({ color: 'red' })).toThrow(/recommendedWorks\[0\]\.color/);
  expect(bad({ code: 'ABCDEFGHI' })).toThrow(/recommendedWorks\[0\]\.code/);
  expect(bad({ code: '' })).toThrow(/recommendedWorks\[0\]\.code/);
  expect(bad({ layer: 'survey-findings' })).toThrow(/recommendedWorks\[0\]\.layer/);
  expect(bad({ height: 0 })).toThrow(/recommendedWorks\[0\]\.height/);
});
