import { get, writable } from 'svelte/store';
import type { SurveyFindingZone } from '$lib/models/types';
import { currentProject, mutateActiveFloor, newElementId } from '$lib/stores/project';

/** Preset armed by Add Issue Area; the next drag on the plan creates a zone with it. */
export const placingSurveyFinding = writable<SurveyFindingZone['code'] | null>(null);

export type ZoneRect = Pick<SurveyFindingZone, 'x' | 'y' | 'width' | 'height'>;

/** Smallest side of an issue area in cm; smaller drags are treated as clicks. */
export const MIN_ZONE_SIZE = 10;

/** Normalise a dragged rectangle (any corner order) to top-left + size. */
export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): ZoneRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export function addSurveyFinding(code: SurveyFindingZone['code'], rect: ZoneRect): string {
  const id = newElementId();
  mutateActiveFloor(floor => {
    (floor.surveyFindings ??= []).push({ id, layer: 'survey-findings', code, shape: 'rect', ...rect });
  }, 'Added issue area');
  return id;
}

export function updateSurveyFinding(id: string, updates: Partial<Pick<SurveyFindingZone, 'code' | 'x' | 'y' | 'width' | 'height' | 'note'>>) {
  mutateActiveFloor(floor => {
    const zone = floor.surveyFindings?.find(item => item.id === id);
    if (zone) Object.assign(zone, updates);
  }, 'Edited issue area', `survey-finding:${id}:${Object.keys(updates).sort().join(',')}`);
}

/** Reposition or resize during a drag, without an undo snapshot (the gesture owns it). */
export function setSurveyFindingRect(id: string, rect: ZoneRect) {
  const project = get(currentProject);
  const floor = project?.floors.find(f => f.id === project.activeFloorId);
  const zone = floor?.surveyFindings?.find(item => item.id === id);
  if (!project || !zone) return;
  Object.assign(zone, rect);
  project.updatedAt = new Date();
  currentProject.set({ ...project });
}

export function removeSurveyFinding(id: string) {
  mutateActiveFloor(floor => {
    if (floor.surveyFindings) floor.surveyFindings = floor.surveyFindings.filter(item => item.id !== id);
  }, 'Deleted issue area');
}

/** Copy an issue area, offset down and right so the copy is visible. */
export function duplicateSurveyFinding(id: string, offset = 30): string | null {
  const project = get(currentProject);
  const source = project?.floors.find(f => f.id === project.activeFloorId)?.surveyFindings?.find(item => item.id === id);
  if (!source) return null;
  const copy = newElementId();
  mutateActiveFloor(floor => {
    (floor.surveyFindings ??= []).push({ ...structuredClone(source), id: copy, x: source.x + offset, y: source.y + offset });
  }, 'Duplicated issue area');
  return copy;
}
