/**
 * Stage 2 Survey Findings operations, kept for existing callers.
 * Both overlay layers are handled by overlayStore.ts.
 */
import type { SurveyFindingZone } from '$lib/models/types';
import { addZone, duplicateZone, removeZone, setZoneRect, updateZone, type ZoneDetails, type ZoneRect } from './overlayStore';
import { findPreset, UNKNOWN_ZONE_COLOR } from './zonePresets';

export { MIN_ZONE_SIZE, normalizeRect, type ZoneRect } from './overlayStore';

export function addSurveyFinding(code: SurveyFindingZone['code'], rect: ZoneRect): string {
  const preset = findPreset('survey-findings', code);
  return addZone({ layer: 'survey-findings', code, name: preset?.name ?? code, color: preset?.color ?? UNKNOWN_ZONE_COLOR, preset: preset ? code : null }, rect);
}

export const updateSurveyFinding = (id: string, updates: ZoneDetails & Partial<ZoneRect>) => updateZone(id, updates);
export const setSurveyFindingRect = setZoneRect;
export const removeSurveyFinding = removeZone;
export const duplicateSurveyFinding = duplicateZone;
