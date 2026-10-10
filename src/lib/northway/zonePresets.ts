/**
 * Northway overlay configuration: the colour palette, the preset findings and
 * recommendations, and how each layer is drawn. Everything that looks up a
 * preset, colour or layer style comes through this module, so a later admin
 * screen can load these from the database instead of this file.
 */
import type { Floor, OverlayLayer, OverlayZone } from '$lib/models/types';
import { itemColor } from './priorities';

export interface PaletteColour { id: string; name: string; hex: string }

/** Restrained technical palette, readable on white, light-grey floors, screen and print. */
export const ZONE_PALETTE: readonly PaletteColour[] = [
  { id: 'blue', name: 'Blue', hex: '#3b82c4' },
  { id: 'navy', name: 'Navy', hex: '#1f4f8f' },
  { id: 'indigo', name: 'Indigo', hex: '#5d5fb8' },
  { id: 'teal', name: 'Teal', hex: '#2fa3a8' },
  { id: 'green', name: 'Sage green', hex: '#6b8a68' },
  { id: 'amber', name: 'Amber', hex: '#a8792f' },
  { id: 'orange', name: 'Orange', hex: '#d9823b' },
  { id: 'red', name: 'Muted red', hex: '#b5534f' },
  { id: 'purple', name: 'Mauve', hex: '#9466ad' },
  { id: 'grey', name: 'Grey', hex: '#7a7f87' },
];

export interface ZonePreset {
  layer: OverlayLayer;
  code: string;
  name: string;
  color: string;
  /** Hidden from pickers but still recognised in saved plans. */
  disabled?: boolean;
}

const hex = (id: string) => ZONE_PALETTE.find(colour => colour.id === id)!.hex;

export const SURVEY_FINDING_PRESETS: readonly ZonePreset[] = [
  { layer: 'survey-findings', code: 'HM', name: 'High Moisture', color: hex('blue') },
  { layer: 'survey-findings', code: 'WM', name: 'Woodworm Activity', color: hex('orange') },
  { layer: 'survey-findings', code: 'DR', name: 'Dry Rot', color: hex('purple') },
  { layer: 'survey-findings', code: 'WR', name: 'Wet Rot', color: hex('amber') },
  { layer: 'survey-findings', code: 'MG', name: 'Mould Growth', color: hex('green') },
  { layer: 'survey-findings', code: 'CD', name: 'Condensation', color: hex('teal') },
  { layer: 'survey-findings', code: 'PD', name: 'Penetrating Damp', color: hex('navy') },
  { layer: 'survey-findings', code: 'RD', name: 'Rising Damp Indicators', color: hex('indigo') },
  { layer: 'survey-findings', code: 'TD', name: 'Timber Deterioration', color: hex('red') },
  { layer: 'survey-findings', code: 'SV', name: 'Subfloor Ventilation Issue', color: hex('grey') },
];

export const RECOMMENDED_WORK_PRESETS: readonly ZonePreset[] = [
  { layer: 'recommended-works', code: 'WT', name: 'Woodworm Treatment', color: hex('orange') },
  { layer: 'recommended-works', code: 'DPT', name: 'Damp Proofing Treatment', color: hex('indigo') },
  { layer: 'recommended-works', code: 'TR', name: 'Timber Repair / Replacement', color: hex('red') },
  { layer: 'recommended-works', code: 'DRT', name: 'Dry Rot Treatment', color: hex('purple') },
  { layer: 'recommended-works', code: 'WRT', name: 'Wet Rot Treatment', color: hex('amber') },
  { layer: 'recommended-works', code: 'MR', name: 'Mould Remediation', color: hex('green') },
  { layer: 'recommended-works', code: 'VI', name: 'Ventilation Improvement', color: hex('teal') },
  { layer: 'recommended-works', code: 'PR', name: 'Plaster Removal / Reinstatement', color: hex('navy') },
  { layer: 'recommended-works', code: 'MT', name: 'Masonry Treatment / Repair', color: hex('grey') },
  { layer: 'recommended-works', code: 'FI', name: 'Further Investigation', color: hex('blue') },
];

/** How each layer is drawn. Findings: solid tint. Recommendations: light tint, hatch, dashed border, boxed code. */
export interface LayerStyle {
  label: string;
  fillOpacity: number;
  borderOpacity: number;
  /** Border width in screen pixels (export units at 100%). */
  borderWidth: number;
  /** Border dash pattern; empty for a solid line. */
  dash: number[];
  /** Diagonal hatch, or null for none. */
  hatch: { spacing: number; width: number; opacity: number } | null;
  /** Where the short code sits, so a finding and a recommendation on the same area never collide. */
  codeCorner: 'top-left' | 'top-right';
  /** Draw the code on a small white tag (readable over the hatch). */
  codeTag: boolean;
}

export const LAYER_STYLES: Readonly<Record<OverlayLayer, LayerStyle>> = {
  'survey-findings': { label: 'Survey Findings', fillOpacity: 0.25, borderOpacity: 0.8, borderWidth: 1.75, dash: [], hatch: null, codeCorner: 'top-left', codeTag: false },
  'recommended-works': { label: 'Recommended Works', fillOpacity: 0.12, borderOpacity: 0.95, borderWidth: 2, dash: [7, 4], hatch: { spacing: 9, width: 1, opacity: 0.5 }, codeCorner: 'top-right', codeTag: true },
};

export const UNKNOWN_ZONE_COLOR = hex('grey');
export const MAX_CODE_LENGTH = 4;

export function presetsFor(layer: OverlayLayer, includeDisabled = false): readonly ZonePreset[] {
  const list = layer === 'survey-findings' ? SURVEY_FINDING_PRESETS : RECOMMENDED_WORK_PRESETS;
  return includeDisabled ? list : list.filter(preset => !preset.disabled);
}

export function findPreset(layer: OverlayLayer, code: string | null | undefined): ZonePreset | undefined {
  return code ? presetsFor(layer, true).find(preset => preset.code === code) : undefined;
}

export function isHexColour(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

/**
 * What a zone shows: its own values, falling back to its preset, then to neutral defaults.
 * Recommended Works areas take their colour from their Northway Priority (priorities.ts), never from
 * their stored colour or work type.
 */
export function zoneAppearance(zone: Pick<OverlayZone, 'layer' | 'code' | 'name' | 'color' | 'preset'> & { priority?: unknown }): { code: string; name: string; color: string; custom: boolean } {
  const preset = findPreset(zone.layer, zone.preset === undefined ? zone.code : zone.preset);
  return {
    code: zone.code,
    name: zone.name?.trim() || preset?.name || zone.code,
    color: zone.layer === 'recommended-works' ? itemColor(zone) : isHexColour(zone.color) ? zone.color : preset?.color ?? UNKNOWN_ZONE_COLOR,
    custom: zone.preset === null || !preset,
  };
}


/** Uppercase letters and digits only, at most MAX_CODE_LENGTH. */
export function cleanCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX_CODE_LENGTH);
}

/** Suggest a short code from a name: initials of the main words ("Defective Pointing" → "DP"). */
export function suggestCode(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(word => word && !/^(and|or|of|the|for|to|a|an|in|at|on)$/i.test(word));
  if (!words.length) return '';
  const initials = words.map(word => word[0]).join('');
  return cleanCode(initials.length >= 2 ? initials : words[0].slice(0, 2));
}

/**
 * Stage 5 legend input: the distinct zone types used on these floors, per layer,
 * in first-use order, each with its code, name and colour.
 */
export function overlayTypesInUse(floors: readonly Pick<Floor, 'surveyFindings' | 'recommendedWorks'>[]): Record<OverlayLayer, { code: string; name: string; color: string; custom: boolean }[]> {
  const result: Record<OverlayLayer, { code: string; name: string; color: string; custom: boolean }[]> = { 'survey-findings': [], 'recommended-works': [] };
  for (const floor of floors) for (const zone of [...floor.surveyFindings ?? [], ...floor.recommendedWorks ?? []]) {
    const look = zoneAppearance(zone), list = result[zone.layer];
    if (!list.some(entry => entry.code === look.code && entry.name === look.name && entry.color === look.color)) list.push(look);
  }
  return result;
}

/** '#rrggbb' plus an opacity as an rgba() string, for both canvas and SVG. */
export function rgba(hexColour: string, alpha: number): string {
  const value = parseInt(hexColour.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
