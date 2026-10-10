import { get, writable } from 'svelte/store';
import type { Floor, OverlayLayer, OverlayLine, OverlayPin, OverlayZone, Point, RecommendationFields } from '$lib/models/types';
import { priorityStyle, type NorthwayPriority } from './priorities';
import { currentProject, mutateActiveFloor, newElementId, selectedElementId, selectedElementIds, selectedRoomId } from '$lib/stores/project';
import { ZONE_PALETTE, findPreset, type ZonePreset } from './zonePresets';
import { issueRef } from './references';

/** What the next drawn zone will be: a preset, or a custom finding/recommendation from the dialog. */
export interface ZoneTemplate {
  layer: OverlayLayer;
  code: string;
  name: string;
  color: string;
  /** The preset code it started from, or null for a custom zone. */
  preset: string | null;
  /** Recommended Works: the chosen Northway Priority and optional work type (name holds the recommendation text). */
  priority?: NorthwayPriority;
  workType?: string | null;
}

/** Recommendation fields for a new item: priority (its colour follows) and optional work type. */
function recommendationFields(layer: OverlayLayer, priority: NorthwayPriority | undefined, workType: string | null | undefined): Partial<RecommendationFields> & { color?: string } {
  if (layer !== 'recommended-works') return {};
  const chosen = priority ?? 'unassigned';
  return { priority: chosen, workType: workType ?? null, color: priorityStyle(chosen).color };
}

/** Template armed by Add Issue Area / Add Recommended Area / Draw Area; the next drag on the plan creates a zone from it. */
export const placingZone = writable<ZoneTemplate | null>(null);

export function presetTemplate(preset: ZonePreset): ZoneTemplate {
  return { layer: preset.layer, code: preset.code, name: preset.name, color: preset.color, preset: preset.code };
}

export type ZoneRect = Pick<OverlayZone, 'x' | 'y' | 'width' | 'height'>;
export type ZoneDetails = Partial<Pick<OverlayZone, 'code' | 'name' | 'color' | 'preset' | 'note'>> & { workType?: string | null };

/** Smallest side of a zone in cm; smaller drags are treated as clicks. */
export const MIN_ZONE_SIZE = 10;

const LIST_KEY = { 'survey-findings': 'surveyFindings', 'recommended-works': 'recommendedWorks' } as const;
const NOUN = { 'survey-findings': 'issue area', 'recommended-works': 'recommended area' } as const;

/** The floor's zones of one layer (creating the array when asked). */
export function layerZones(floor: Floor, layer: OverlayLayer, create = false): OverlayZone[] | undefined {
  const key = LIST_KEY[layer];
  if (create) floor[key] ??= [];
  return floor[key] as OverlayZone[] | undefined;
}

/** Both layers of a floor, findings first (drawing order). */
export function floorZones(floor: Floor | undefined): OverlayZone[] {
  return floor ? [...floor.surveyFindings ?? [], ...floor.recommendedWorks ?? []] : [];
}

function findZone(floor: Floor | undefined, id: string): OverlayZone | undefined {
  return floorZones(floor).find(zone => zone.id === id);
}

function activeFloor() {
  const project = get(currentProject);
  return project?.floors.find(f => f.id === project.activeFloorId);
}

/** The next stable reference for a layer, recorded on the open project (call inside a mutation). */
function nextRef(layer: OverlayLayer): string | undefined {
  const project = get(currentProject);
  return project ? issueRef(project, layer) : undefined;
}

/** Normalise a dragged rectangle (any corner order) to top-left + size. */
export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): ZoneRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** Add a zone from a template. The template's name, code and colour are copied into the zone, so later preset edits never change it. */
export function addZone(template: ZoneTemplate, rect: ZoneRect): string {
  const id = newElementId();
  const { layer, code, name, color, preset } = template;
  mutateActiveFloor(floor => {
    layerZones(floor, layer, true)!.push({ id, layer, ref: nextRef(layer), code, name, color, preset, shape: 'rect', ...rect,
      ...recommendationFields(layer, template.priority, template.workType) } as OverlayZone);
  }, `Added ${NOUN[layer]}`);
  return id;
}

/** Edit one zone's details or size. Changing it never touches the preset list or other zones. */
export function updateZone(id: string, updates: ZoneDetails & Partial<ZoneRect>) {
  const layer = findZone(activeFloor(), id)?.layer ?? 'survey-findings';
  mutateActiveFloor(floor => {
    const zone = findZone(floor, id);
    if (zone) Object.assign(zone, updates);
  }, `Edited ${NOUN[layer]}`, `overlay-zone:${id}:${Object.keys(updates).sort().join(',')}`);
}

/**
 * Switch a zone to another preset: a finding takes that preset's code, name and colour. A
 * recommendation only takes it as its work type: its text, priority and colour are kept (priority,
 * not the work type, decides the colour). Geometry is unchanged.
 */
export function applyZonePreset(id: string, code: string) {
  const zone = findZone(activeFloor(), id);
  const preset = zone && findPreset(zone.layer, code);
  if (!preset) return;
  if (zone.layer === 'recommended-works') updateZone(id, { code: preset.code, preset: preset.code, workType: preset.code } as ZoneDetails);
  else updateZone(id, { code: preset.code, name: preset.name, color: preset.color, preset: preset.code });
}

/** Reposition or resize during a drag, without an undo snapshot (the gesture owns it). */
export function setZoneRect(id: string, rect: ZoneRect) {
  const project = get(currentProject);
  const zone = findZone(project?.floors.find(f => f.id === project.activeFloorId), id);
  if (!project || !zone) return;
  Object.assign(zone, rect);
  project.updatedAt = new Date();
  currentProject.set({ ...project });
}

export function removeZone(id: string) {
  const layer = findZone(activeFloor(), id)?.layer ?? 'survey-findings';
  mutateActiveFloor(floor => {
    if (floor.surveyFindings) floor.surveyFindings = floor.surveyFindings.filter(item => item.id !== id);
    if (floor.recommendedWorks) floor.recommendedWorks = floor.recommendedWorks.filter(item => item.id !== id);
  }, `Deleted ${NOUN[layer]}`);
}

/** Copy a zone into the same layer with its own new reference, offset down and right so the copy is visible. */
export function duplicateZone(id: string, offset = 30): string | null {
  const source = findZone(activeFloor(), id);
  if (!source) return null;
  const copy = newElementId();
  mutateActiveFloor(floor => {
    layerZones(floor, source.layer, true)!.push({ ...structuredClone(source), id: copy, ref: nextRef(source.layer), x: source.x + offset, y: source.y + offset });
  }, `Duplicated ${NOUN[source.layer]}`);
  return copy;
}

// ── Free-text pins and lines ─────────────────────────────────────────

/** What a pin or line is being created with: the layer, then the dialog's description and colour. */
export interface MarkupDraft { layer: OverlayLayer; description: string; color: string; priority?: NorthwayPriority; workType?: string | null }

/**
 * Pin or line tool armed by + Pin / + Line. Findings: geometry is captured on the plan, then the dialog
 * asks for text. Recommendations: the dialog comes first (priority and text), so `draft` is set and
 * the item is created as soon as it is placed.
 */
export const placingMarkup = writable<{ kind: 'pin' | 'line'; layer: OverlayLayer; draft?: MarkupDraft } | null>(null);

/** Geometry captured on the plan and waiting for its description (the canvas sets it, the dialog consumes it). */
export const pendingMarkup = writable<{ kind: 'pin'; layer: OverlayLayer; at: Point } | { kind: 'line'; layer: OverlayLayer; points: Point[] } | null>(null);

const MARKUP_NOUN = { 'survey-findings': 'finding', 'recommended-works': 'recommendation' } as const;

export function floorPins(floor: Floor | undefined): OverlayPin[] { return floor?.overlayPins ?? []; }
export function floorLines(floor: Floor | undefined): OverlayLine[] { return floor?.overlayLines ?? []; }

function findPin(floor: Floor | undefined, id: string) { return floor?.overlayPins?.find(pin => pin.id === id); }
function findLine(floor: Floor | undefined, id: string) { return floor?.overlayLines?.find(line => line.id === id); }

export function addPin(draft: MarkupDraft, at: Point): string {
  const id = newElementId();
  mutateActiveFloor(floor => {
    (floor.overlayPins ??= []).push({ id, layer: draft.layer, ref: nextRef(draft.layer), description: draft.description, color: draft.color, x: at.x, y: at.y,
      ...recommendationFields(draft.layer, draft.priority, draft.workType) });
  }, `Added ${MARKUP_NOUN[draft.layer]} pin`);
  return id;
}

export function addLine(draft: MarkupDraft, points: Point[]): string {
  const id = newElementId();
  mutateActiveFloor(floor => {
    (floor.overlayLines ??= []).push({ id, layer: draft.layer, ref: nextRef(draft.layer), description: draft.description, color: draft.color, points: points.map(p => ({ x: p.x, y: p.y })),
      ...recommendationFields(draft.layer, draft.priority, draft.workType) });
  }, `Added ${MARKUP_NOUN[draft.layer]} line`);
  return id;
}

/** Edit a pin's or line's description or colour. The reference never changes. */
export function updateMarkup(id: string, updates: Partial<Pick<OverlayPin, 'description' | 'color'>>) {
  mutateActiveFloor(floor => {
    const item = findPin(floor, id) ?? findLine(floor, id);
    if (item) Object.assign(item, updates);
  }, 'Edited markup', `overlay-markup:${id}:${Object.keys(updates).sort().join(',')}`);
}

/** Move a pin during a drag, without an undo snapshot (the gesture owns it). */
export function setPinPosition(id: string, at: Point) {
  const project = get(currentProject);
  const pin = findPin(project?.floors.find(f => f.id === project.activeFloorId), id);
  if (!project || !pin) return;
  pin.x = at.x; pin.y = at.y;
  project.updatedAt = new Date();
  currentProject.set({ ...project });
}

/** Replace a line's points during a drag (move or vertex edit), without an undo snapshot. */
export function setLinePoints(id: string, points: Point[]) {
  const project = get(currentProject);
  const line = findLine(project?.floors.find(f => f.id === project.activeFloorId), id);
  if (!project || !line) return;
  line.points = points.map(p => ({ x: p.x, y: p.y }));
  project.updatedAt = new Date();
  currentProject.set({ ...project });
}

/** Remove one point of a polyline (it keeps at least two). */
export function removeLinePoint(id: string, index: number) {
  const line = findLine(activeFloor(), id);
  if (!line || line.points.length <= 2) return;
  mutateActiveFloor(floor => {
    const target = findLine(floor, id);
    if (target) target.points = target.points.filter((_, i) => i !== index);
  }, 'Removed line point');
}

/** Insert a point into a polyline after segment index `after`. */
export function insertLinePoint(id: string, after: number, at: Point) {
  mutateActiveFloor(floor => {
    const target = findLine(floor, id);
    if (target) target.points.splice(after + 1, 0, { x: at.x, y: at.y });
  }, 'Added line point');
}

export function removeMarkup(id: string) {
  mutateActiveFloor(floor => {
    if (floor.overlayPins) floor.overlayPins = floor.overlayPins.filter(item => item.id !== id);
    if (floor.overlayLines) floor.overlayLines = floor.overlayLines.filter(item => item.id !== id);
  }, 'Deleted markup');
}

/** Copy a pin or line with its own new reference, offset so the copy is visible. */
export function duplicateMarkup(id: string, offset = 30): string | null {
  const floor = activeFloor(), pin = findPin(floor, id), line = findLine(floor, id);
  if (!pin && !line) return null;
  const copy = newElementId();
  mutateActiveFloor(target => {
    if (pin) (target.overlayPins ??= []).push({ ...structuredClone(pin), id: copy, ref: nextRef(pin.layer), x: pin.x + offset, y: pin.y + offset });
    else if (line) (target.overlayLines ??= []).push({ ...structuredClone(line), id: copy, ref: nextRef(line.layer), points: line.points.map(p => ({ x: p.x + offset, y: p.y + offset })) });
  }, 'Duplicated markup');
  return copy;
}

/** Points clicked so far for a line being drawn (shared by the canvas and the sidebar's Finish button). */
export const lineDraft = writable<Point[]>([]);

/** Finish the line being drawn: with two or more distinct points it goes to the description dialog. */
export function finishLineDraft(): boolean {
  const tool = get(placingMarkup);
  // A double-click lands its second press on the last point: drop repeated points.
  const points = get(lineDraft).filter((p, i, all) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) >= 1);
  lineDraft.set([]);
  if (!tool || tool.kind !== 'line') return false;
  placingMarkup.set(null);
  if (points.length < 2) return false;
  if (tool.draft) { selectNew(addLine(tool.draft, points)); return true; }
  pendingMarkup.set({ kind: 'line', layer: tool.layer, points });
  return true;
}

export function cancelMarkupTool() {
  lineDraft.set([]);
  placingMarkup.set(null);
}

/** A palette colour not yet used on this layer of the floor (areas, pins and lines), for a new custom item. */
export function freshLayerColour(floor: Floor | undefined, layer: OverlayLayer): string {
  const used = new Set([
    ...floorZones(floor).filter(zone => zone.layer === layer).map(zone => zone.color),
    ...floorPins(floor).filter(pin => pin.layer === layer).map(pin => pin.color),
    ...floorLines(floor).filter(line => line.layer === layer).map(line => line.color),
  ].map(color => color?.toLowerCase()));
  return (ZONE_PALETTE.find(colour => !used.has(colour.hex.toLowerCase())) ?? ZONE_PALETTE[0]).hex;
}

/** Select a just-created item (as the dialogs do). */
function selectNew(id: string) {
  selectedRoomId.set(null);
  selectedElementIds.set(new Set());
  selectedElementId.set(id);
}

/** Place a pin at a point: recommendations with a draft are created at once; findings go to the dialog. */
export function placePinAt(at: Point): string | null {
  const tool = get(placingMarkup);
  if (!tool || tool.kind !== 'pin') return null;
  placingMarkup.set(null);
  if (tool.draft) { const id = addPin(tool.draft, at); selectNew(id); return id; }
  pendingMarkup.set({ kind: 'pin', layer: tool.layer, at });
  return null;
}

// ── Northway Priority (Recommended Works) ────────────────────────────

function findRecommendation(floor: Floor | undefined, id: string): (OverlayZone | OverlayPin | OverlayLine) & RecommendationFields | undefined {
  const item = floorZones(floor).find(zone => zone.id === id) ?? findPin(floor, id) ?? findLine(floor, id);
  return item?.layer === 'recommended-works' ? item as any : undefined;
}

/** Change a recommendation's priority. Its reference, text and geometry are unchanged; its colour follows. */
export function setPriority(id: string, priority: NorthwayPriority) {
  mutateActiveFloor(floor => {
    const item = findRecommendation(floor, id);
    if (item) { item.priority = priority; item.color = priorityStyle(priority).color; }
  }, 'Changed priority');
}

/** Edit a recommendation's text (area name or pin/line description), work type or quoted price. */
export function updateRecommendation(id: string, updates: { text?: string; workType?: string | null; quotedPricePence?: number | null }) {
  mutateActiveFloor(floor => {
    const item = findRecommendation(floor, id);
    if (!item) return;
    if (updates.text !== undefined) { if ('points' in item || !('shape' in item)) (item as OverlayPin).description = updates.text; else (item as OverlayZone).name = updates.text; }
    if (updates.workType !== undefined) item.workType = updates.workType;
    if (updates.quotedPricePence !== undefined) { if (updates.quotedPricePence === null) delete item.quotedPricePence; else item.quotedPricePence = updates.quotedPricePence; }
  }, 'Edited recommendation', `recommendation:${id}:${Object.keys(updates).sort().join(',')}`);
}

/** References of recommendations on a floor that still need a priority (blocks the final export). */
export function unassignedRefs(floor: Floor | undefined): string[] {
  return [...floorZones(floor), ...floorPins(floor), ...floorLines(floor)]
    .filter(item => item.layer === 'recommended-works' && ((item as RecommendationFields).priority ?? 'unassigned') === 'unassigned')
    .map(item => item.ref ?? '').filter(Boolean)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}
