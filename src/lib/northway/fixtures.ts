/**
 * Northway: which plan objects belong on a survey drawing.
 *
 * Fixed fixtures (kitchen units, sinks, sanitaryware, fireplaces, stairs, technical
 * symbols) help a surveyor orient the plan and stay visible. Movable household
 * furniture and decor are hidden from the default view, the object library, hit
 * testing and the exports. Nothing is deleted: the full library setting brings
 * everything back.
 */
import type { FurnitureItem } from '$lib/models/types';
import { getCatalogItem } from '$lib/utils/furnitureCatalog';
import { furniturePlanBounds } from '$lib/utils/furniturePlanBounds';

/** Catalogue ids that are always treated as fixed fixtures. */
export const FIXED_FIXTURE_IDS: ReadonlySet<string> = new Set([
  // Kitchen units, sinks and fitted appliances
  'counter', 'sink_k', 'stove', 'oven', 'dishwasher', 'fridge', 'washer_dryer',
  // Bathroom sanitaryware
  'sink_b', 'toilet', 'bathtub', 'shower',
  // Architectural features
  'fireplace', 'stairs', 'garage_door_single', 'garage_door_double',
]);

/** The short Fixed Fixtures group offered in the survey object library. */
export const FIXTURE_LIBRARY_IDS: readonly string[] = [
  'counter', 'sink_k', 'stove', 'toilet', 'sink_b', 'bathtub', 'shower', 'fireplace',
];

/** Kitchen or bathroom items that a RoomPlan "storage" unit can be fitted alongside. */
const FITTED_ANCHOR_IDS: ReadonlySet<string> = new Set([
  'counter', 'sink_k', 'sink_b', 'stove', 'oven', 'dishwasher', 'fridge', 'washer_dryer',
]);

/** Worktop-height storage only: wardrobes and tall shelving stay movable. */
const MAX_FITTED_UNIT_HEIGHT = 110;
/** Gap in cm within which a storage unit counts as part of a fitted run. */
const FITTED_RUN_GAP = 30;

export type ObjectLibrary = 'survey' | 'full';

export function isSurveyLibrary(settings: { objectLibrary?: ObjectLibrary } | undefined): boolean {
  return (settings?.objectLibrary ?? 'survey') === 'survey';
}

function isAlwaysFixed(item: FurnitureItem): boolean {
  if (item.customModelId) return false;
  if (FIXED_FIXTURE_IDS.has(item.catalogId)) return true;
  // 2D technical symbols (plumbing, electrical) are services, not furniture.
  return getCatalogItem(item.catalogId)?.symbol === true;
}

function gap(a: FurnitureItem, b: FurnitureItem): number {
  const p = furniturePlanBounds(a), q = furniturePlanBounds(b);
  const dx = Math.max(0, p.minX - q.maxX, q.minX - p.maxX);
  const dy = Math.max(0, p.minY - q.maxY, q.minY - p.maxY);
  return Math.hypot(dx, dy);
}

/**
 * Ids of the fixed fixtures on a floor. RoomPlan reports both kitchen cabinetry and
 * wardrobes as "storage", so a storage unit is fixed only when it is worktop height
 * and joins a sink, worktop or fitted appliance, directly or through other units.
 */
export function fixedFixtureIds(furniture: readonly FurnitureItem[]): Set<string> {
  const fixed = new Set<string>();
  const anchors: FurnitureItem[] = [];
  for (const item of furniture) {
    if (!isAlwaysFixed(item)) continue;
    fixed.add(item.id);
    if (FITTED_ANCHOR_IDS.has(item.catalogId)) anchors.push(item);
  }
  let pending = furniture.filter(item => item.catalogId === 'storage' && !item.customModelId &&
    (item.height ?? getCatalogItem('storage')!.height) <= MAX_FITTED_UNIT_HEIGHT);
  for (let grew = true; grew && pending.length;) {
    grew = false;
    pending = pending.filter(unit => {
      if (!anchors.some(anchor => gap(unit, anchor) <= FITTED_RUN_GAP)) return true;
      fixed.add(unit.id); anchors.push(unit); grew = true;
      return false;
    });
  }
  return fixed;
}

/** Furniture drawn, selectable and exported in the current workflow. */
export function planFurniture(furniture: readonly FurnitureItem[], settings: { objectLibrary?: ObjectLibrary } | undefined): FurnitureItem[] {
  if (!isSurveyLibrary(settings)) return [...furniture];
  const fixed = fixedFixtureIds(furniture);
  return furniture.filter(item => fixed.has(item.id));
}

/** Restrained colours for fixtures in the technical plan style. */
export const TECHNICAL_FIXTURE = { fill: '#a1a1aa', stroke: '#52525b' } as const;
