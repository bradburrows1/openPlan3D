/**
 * Northway Priority System for Recommended Works.
 *
 * A simple, homeowner-friendly priority for each recommendation: 3 Priority Work (red), 2 Recommended
 * Work (amber), 1 Advisory Work (yellow) and FI Further Investigation (blue-grey, no number). It is
 * Northway's own guide, not an RICS condition rating, and must not be described as one. Green is
 * deliberately not used: every Recommended Works item asks for some action.
 *
 * Priority sets the colour of every Recommended Works item (area, pin or line). Findings keep their
 * issue colours. Work type, recommendation text, geometry and the R reference are separate fields.
 */
import type { OverlayItem } from '$lib/models/types';

/** Same neutral grey as zonePresets.UNKNOWN_ZONE_COLOR (not imported, to keep this module dependency-free). */
const NEUTRAL = '#7a7f87';

export type NorthwayPriority = 'priority_3' | 'priority_2' | 'priority_1' | 'further_investigation' | 'unassigned';

export interface PriorityStyle {
  id: NorthwayPriority;
  /** Badge text on legends and controls: 3, 2, 1, FI (or ? while unassigned). */
  badge: string;
  /** Short name: "Priority Work". */
  name: string;
  /** Control and legend label: "3 — Priority Work". */
  label: string;
  /** Customer-facing definition for the Northway Priority Guide. */
  definition: string;
  /** Fill, hatch and band colour (muted, printable). */
  color: string;
  /** Darker shade of the same colour for text, outlines and dashes, readable on white and in print. */
  ink: string;
}

/** Order shown in controls and the guide: most urgent first, Further Investigation last. */
export const PRIORITIES: readonly PriorityStyle[] = [
  { id: 'priority_3', badge: '3', name: 'Priority Work', label: '3 — Priority Work', color: '#b8443d', ink: '#8c2f29',
    definition: 'Work that should be addressed promptly to prevent significant deterioration or further damage.' },
  { id: 'priority_2', badge: '2', name: 'Recommended Work', label: '2 — Recommended Work', color: '#d68a2e', ink: '#9a5a12',
    definition: 'Work recommended to correct an identified defect or reduce the risk of deterioration.' },
  { id: 'priority_1', badge: '1', name: 'Advisory Work', label: '1 — Advisory Work', color: '#d9b425', ink: '#7d6508',
    definition: 'Lower-priority, preventative or maintenance work that would benefit the property.' },
  { id: 'further_investigation', badge: 'FI', name: 'Further Investigation', label: 'FI — Further Investigation', color: '#6f8197', ink: '#43536a',
    definition: 'Additional inspection or opening-up is required before the condition or required works can be fully confirmed.' },
];

/** Older recommendations, saved before priorities existed, until a surveyor chooses one. Never inferred. */
export const UNASSIGNED: PriorityStyle = {
  id: 'unassigned', badge: '?', name: 'Priority required', label: 'Priority required', color: '#a1a1aa', ink: '#52525b',
  definition: 'No Northway Priority has been chosen for this recommendation yet.',
};

export const PRIORITY_IDS: readonly NorthwayPriority[] = [...PRIORITIES.map(p => p.id), 'unassigned'];

export function isPriority(value: unknown): value is NorthwayPriority {
  return typeof value === 'string' && (PRIORITY_IDS as readonly string[]).includes(value);
}

export function priorityStyle(priority: NorthwayPriority | undefined | null): PriorityStyle {
  return PRIORITIES.find(p => p.id === priority) ?? UNASSIGNED;
}

/** A recommendation's priority; anything without a valid one counts as unassigned. Findings have none. */
export function itemPriority(item: Pick<OverlayItem, 'layer'> & { priority?: unknown }): NorthwayPriority | null {
  if (item.layer !== 'recommended-works') return null;
  return isPriority(item.priority) ? item.priority : 'unassigned';
}

/** The colour an overlay item is drawn in: findings keep their own colour; recommendations use their priority. */
export function itemColor(item: Pick<OverlayItem, 'layer'> & { color?: string; priority?: unknown }): string {
  const priority = itemPriority(item);
  return priority ? priorityStyle(priority).color : item.color ?? NEUTRAL;
}

/** Text/outline colour: the priority's darker shade for recommendations, the item colour for findings. */
export function itemInk(item: Pick<OverlayItem, 'layer'> & { color?: string; priority?: unknown }): string {
  const priority = itemPriority(item);
  return priority ? priorityStyle(priority).ink : item.color ?? NEUTRAL;
}

/** Quoted price in pence → "£1,250.00" (for a future costs schedule; never drawn on the plan). */
export function formatPence(pence: number | null | undefined): string {
  if (pence === null || pence === undefined || !Number.isFinite(pence)) return '';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
}

/** "1,250.5" or "£1250.50" → 125050 pence; empty → null; anything else → undefined (invalid). */
export function parsePounds(text: string): number | null | undefined {
  const cleaned = text.replace(/[£,\s]/g, '');
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  return Math.round(Number(cleaned) * 100);
}
