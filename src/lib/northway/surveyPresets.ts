import type { SurveyFindingCode } from '$lib/models/types';

/** Northway survey finding presets. Colours are restrained, report-friendly hues. */
export interface SurveyFindingPreset {
  code: SurveyFindingCode;
  /** English name; the UI uses the northway.preset.<code> translation. */
  name: string;
  /** Base colour: the fill is drawn at FILL_OPACITY and the border at BORDER_OPACITY. */
  color: string;
}

export const SURVEY_FINDING_PRESETS: readonly SurveyFindingPreset[] = [
  { code: 'HM', name: 'High Moisture', color: '#3b82c4' },
  { code: 'WM', name: 'Woodworm Activity', color: '#d9823b' },
  { code: 'DR', name: 'Dry Rot', color: '#9466ad' },
  { code: 'WR', name: 'Wet Rot', color: '#a8792f' },
  { code: 'MG', name: 'Mould Growth', color: '#6b8a68' },
  { code: 'CD', name: 'Condensation', color: '#2fa3a8' },
  { code: 'PD', name: 'Penetrating Damp', color: '#1f4f8f' },
  { code: 'RD', name: 'Rising Damp Indicators', color: '#5d5fb8' },
  { code: 'TD', name: 'Timber Deterioration', color: '#b5534f' },
  { code: 'SV', name: 'Subfloor Ventilation Issue', color: '#7a7f87' },
];

export const FILL_OPACITY = 0.25;
export const BORDER_OPACITY = 0.8;
/** Border width in screen pixels at 100% zoom; it scales gently with zoom. */
export const BORDER_WIDTH = 1.75;

const UNKNOWN_PRESET_COLOR = '#7a7f87';

export function surveyFindingPreset(code: string): SurveyFindingPreset | undefined {
  return SURVEY_FINDING_PRESETS.find(preset => preset.code === code);
}

export function surveyFindingColor(code: string): string {
  return surveyFindingPreset(code)?.color ?? UNKNOWN_PRESET_COLOR;
}

/** '#rrggbb' plus an opacity as an rgba() string, for both canvas and SVG. */
export function rgba(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
