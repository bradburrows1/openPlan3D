/**
 * Stage 2 names for the Survey Findings presets, kept for existing imports.
 * The configuration itself lives in zonePresets.ts.
 */
import { LAYER_STYLES, SURVEY_FINDING_PRESETS, UNKNOWN_ZONE_COLOR, findPreset, rgba, type ZonePreset } from './zonePresets';

export { SURVEY_FINDING_PRESETS, rgba };
export type SurveyFindingPreset = ZonePreset;

export const FILL_OPACITY = LAYER_STYLES['survey-findings'].fillOpacity;
export const BORDER_OPACITY = LAYER_STYLES['survey-findings'].borderOpacity;
export const BORDER_WIDTH = LAYER_STYLES['survey-findings'].borderWidth;

export function surveyFindingPreset(code: string): ZonePreset | undefined {
  return findPreset('survey-findings', code);
}

export function surveyFindingColor(code: string): string {
  return surveyFindingPreset(code)?.color ?? UNKNOWN_ZONE_COLOR;
}
