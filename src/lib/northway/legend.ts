/**
 * Northway: the automatic legend. It lists only the items actually on a floor, per layer, in
 * stable reference order (F1, F2, … then R1, R2, …), never alphabetically, so a reader can go from a
 * marker on the plan to its line in the legend.
 *
 *   F2  HM  High Moisture            (area from a preset: reference, type code, name)
 *   F3  DP  Defective Pointing       (custom area)
 *   F4      Restricted access …      (pin or line: reference and description)
 */
import type { Floor, OverlayLayer } from '$lib/models/types';
import { refNumber } from './references';
import { zoneAppearance } from './zonePresets';
import type { LayerSelection } from './planView';

export type LegendKind = 'area' | 'pin' | 'line';

export interface LegendEntry {
  id: string;
  ref: string;
  layer: OverlayLayer;
  kind: LegendKind;
  /** Type code for areas (HM, WT, or a custom code); pins and lines have none. */
  code?: string;
  /** Area name or pin/line description. */
  text: string;
  color: string;
}

export const LEGEND_LAYERS: readonly OverlayLayer[] = ['survey-findings', 'recommended-works'];

export function buildLegend(
  floor: Pick<Floor, 'surveyFindings' | 'recommendedWorks' | 'overlayPins' | 'overlayLines'> | undefined,
  layers: LayerSelection = { 'survey-findings': true, 'recommended-works': true },
): Record<OverlayLayer, LegendEntry[]> {
  const entries: LegendEntry[] = [];
  if (floor) {
    for (const zone of [...floor.surveyFindings ?? [], ...floor.recommendedWorks ?? []]) {
      const look = zoneAppearance(zone);
      entries.push({ id: zone.id, ref: zone.ref ?? '', layer: zone.layer, kind: 'area', code: zone.code, text: look.name, color: look.color });
    }
    for (const pin of floor.overlayPins ?? []) entries.push({ id: pin.id, ref: pin.ref ?? '', layer: pin.layer, kind: 'pin', text: pin.description, color: pin.color });
    for (const line of floor.overlayLines ?? []) entries.push({ id: line.id, ref: line.ref ?? '', layer: line.layer, kind: 'line', text: line.description, color: line.color });
  }
  entries.sort((a, b) => refNumber(a.ref) - refNumber(b.ref));
  return {
    'survey-findings': layers['survey-findings'] ? entries.filter(entry => entry.layer === 'survey-findings') : [],
    'recommended-works': layers['recommended-works'] ? entries.filter(entry => entry.layer === 'recommended-works') : [],
  };
}

/** One line of plain text per entry, e.g. "F2 — HM — High Moisture" or "F4 — Restricted access …". */
export function legendText(entry: LegendEntry): string {
  return [entry.ref, entry.kind === 'area' && entry.code && entry.code !== entry.text ? entry.code : null, entry.text].filter(Boolean).join(' — ');
}
