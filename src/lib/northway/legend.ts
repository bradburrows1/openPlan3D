/**
 * Northway: the automatic legend. It lists only the items actually on a floor, per layer, in
 * stable reference order (F1, F2, … then R1, R2, …), never alphabetically, so a reader can go from a
 * marker on the plan to its line in the legend.
 *
 *   F2  HM  High Moisture            (area from a preset: reference, type code, name)
 *   F3  DP  Defective Pointing       (custom area)
 *   F4      Restricted access …      (pin or line: reference and description)
 *   R1  3   Replace decayed joists   (recommendation: reference, Northway Priority, recommendation)
 */
import type { Floor, OverlayLayer } from '$lib/models/types';
import { refNumber } from './references';
import { zoneAppearance } from './zonePresets';
import { itemColor, itemPriority, priorityStyle, type NorthwayPriority } from './priorities';
import type { LayerSelection } from './planView';

export type LegendKind = 'area' | 'pin' | 'line';

export interface LegendEntry {
  id: string;
  ref: string;
  layer: OverlayLayer;
  kind: LegendKind;
  /** Type code for areas (HM, WT, or a custom code); pins and lines have none. */
  code?: string;
  /** Area name or pin/line description (the recommendation, for Recommended Works). */
  text: string;
  color: string;
  /** Recommended Works only: the Northway Priority, and the optional work type as secondary information. */
  priority?: NorthwayPriority;
  workType?: string | null;
}

export const LEGEND_LAYERS: readonly OverlayLayer[] = ['survey-findings', 'recommended-works'];

export function buildLegend(
  floor: Pick<Floor, 'surveyFindings' | 'recommendedWorks' | 'overlayPins' | 'overlayLines'> | undefined,
  layers: LayerSelection = { 'survey-findings': true, 'recommended-works': true },
): Record<OverlayLayer, LegendEntry[]> {
  const entries: LegendEntry[] = [];
  if (floor) {
    const recommendation = (item: { layer: OverlayLayer; priority?: unknown; workType?: string | null }) =>
      item.layer === 'recommended-works' ? { priority: itemPriority(item)!, workType: item.workType ?? null } : {};
    for (const zone of floor.surveyFindings ?? []) {
      const look = zoneAppearance(zone);
      entries.push({ id: zone.id, ref: zone.ref ?? '', layer: zone.layer, kind: 'area', code: zone.code, text: look.name, color: look.color });
    }
    // Recommendations lead with their priority; type codes (WT, TR…) are not shown to homeowners.
    for (const zone of floor.recommendedWorks ?? []) entries.push({ id: zone.id, ref: zone.ref ?? '', layer: zone.layer, kind: 'area', text: zoneAppearance(zone).name, color: itemColor(zone), ...recommendation(zone) });
    for (const pin of floor.overlayPins ?? []) entries.push({ id: pin.id, ref: pin.ref ?? '', layer: pin.layer, kind: 'pin', text: pin.description, color: itemColor(pin), ...recommendation(pin) });
    for (const line of floor.overlayLines ?? []) entries.push({ id: line.id, ref: line.ref ?? '', layer: line.layer, kind: 'line', text: line.description, color: itemColor(line), ...recommendation(line) });
  }
  entries.sort((a, b) => refNumber(a.ref) - refNumber(b.ref));
  return {
    'survey-findings': layers['survey-findings'] ? entries.filter(entry => entry.layer === 'survey-findings') : [],
    'recommended-works': layers['recommended-works'] ? entries.filter(entry => entry.layer === 'recommended-works') : [],
  };
}

/** Legend wording for a priority: "Priority 3", "Further Investigation", "Priority required". */
export function priorityText(priority: NorthwayPriority): string {
  const style = priorityStyle(priority);
  return /^\d$/.test(style.badge) ? `Priority ${style.badge}` : style.name;
}

/**
 * One line of plain text per entry: "F2 — HM — High Moisture", "F4 — Restricted access …" or, for a
 * recommendation, "R1 — Priority 3 — Replace decayed floor joists" (the same order as a future quotation table).
 */
export function legendText(entry: LegendEntry): string {
  if (entry.priority) return [entry.ref, priorityText(entry.priority), entry.text].join(' — ');
  return [entry.ref, entry.kind === 'area' && entry.code && entry.code !== entry.text ? entry.code : null, entry.text].filter(Boolean).join(' — ');
}
