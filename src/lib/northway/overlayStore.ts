import { get, writable } from 'svelte/store';
import type { Floor, OverlayLayer, OverlayZone } from '$lib/models/types';
import { currentProject, mutateActiveFloor, newElementId } from '$lib/stores/project';
import { findPreset, type ZonePreset } from './zonePresets';

/** What the next drawn zone will be: a preset, or a custom finding/recommendation from the dialog. */
export interface ZoneTemplate {
  layer: OverlayLayer;
  code: string;
  name: string;
  color: string;
  /** The preset code it started from, or null for a custom zone. */
  preset: string | null;
}

/** Template armed by Add Issue Area / Add Recommended Area / Draw Area; the next drag on the plan creates a zone from it. */
export const placingZone = writable<ZoneTemplate | null>(null);

export function presetTemplate(preset: ZonePreset): ZoneTemplate {
  return { layer: preset.layer, code: preset.code, name: preset.name, color: preset.color, preset: preset.code };
}

export type ZoneRect = Pick<OverlayZone, 'x' | 'y' | 'width' | 'height'>;
export type ZoneDetails = Partial<Pick<OverlayZone, 'code' | 'name' | 'color' | 'preset' | 'note'>>;

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

/** Normalise a dragged rectangle (any corner order) to top-left + size. */
export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): ZoneRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** Add a zone from a template. The template's name, code and colour are copied into the zone, so later preset edits never change it. */
export function addZone(template: ZoneTemplate, rect: ZoneRect): string {
  const id = newElementId();
  const { layer, code, name, color, preset } = template;
  mutateActiveFloor(floor => {
    layerZones(floor, layer, true)!.push({ id, layer, code, name, color, preset, shape: 'rect', ...rect } as OverlayZone);
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

/** Switch a zone to another preset: it takes that preset's code, name and colour. Geometry is unchanged. */
export function applyZonePreset(id: string, code: string) {
  const zone = findZone(activeFloor(), id);
  const preset = zone && findPreset(zone.layer, code);
  if (preset) updateZone(id, { code: preset.code, name: preset.name, color: preset.color, preset: preset.code });
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

/** Copy a zone into the same layer, offset down and right so the copy is visible. */
export function duplicateZone(id: string, offset = 30): string | null {
  const source = findZone(activeFloor(), id);
  if (!source) return null;
  const copy = newElementId();
  mutateActiveFloor(floor => {
    layerZones(floor, source.layer, true)!.push({ ...structuredClone(source), id: copy, x: source.x + offset, y: source.y + offset });
  }, `Duplicated ${NOUN[source.layer]}`);
  return copy;
}
