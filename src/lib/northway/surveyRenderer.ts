/**
 * Stage 2 names for Survey Finding drawing, kept for existing callers.
 * Both overlay layers are drawn by overlayRenderer.ts.
 */
import type { OverlayZone, Point } from '$lib/models/types';
import type { CanvasState } from '$lib/utils/canvasInteraction';
import { drawZoneAreas, drawZoneCodes, drawZoneDraft, findZoneHandleAt, zonesAt } from './overlayRenderer';
import type { ZoneRect } from './overlayStore';
import { findPreset, UNKNOWN_ZONE_COLOR } from './zonePresets';

export { drawZoneSelection as drawSurveyFindingSelection, resizeZoneRect, zoneCursor, zoneHandlePoint, type ZoneHandle } from './overlayRenderer';

export const drawSurveyFindingAreas = (cs: CanvasState, zones: readonly OverlayZone[]) => drawZoneAreas(cs, zones);
export const drawSurveyFindingCodes = (cs: CanvasState, zones: readonly OverlayZone[]) => drawZoneCodes(cs, zones);
export const findSurveyFindingAt = (p: Point, zones: readonly OverlayZone[] | undefined) => zonesAt(p, zones)[0] ?? null;
export const findSurveyFindingHandleAt = findZoneHandleAt;

export function drawSurveyFindingDraft(cs: CanvasState, code: string, rect: ZoneRect): void {
  const preset = findPreset('survey-findings', code);
  drawZoneDraft(cs, { layer: 'survey-findings', code, name: preset?.name ?? code, color: preset?.color ?? UNKNOWN_ZONE_COLOR, preset: preset ? code : null }, rect);
}
