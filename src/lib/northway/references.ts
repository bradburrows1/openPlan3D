/**
 * Northway: plan references. Every Survey Findings item (area, pin or line) shows F1, F2, … and
 * every Recommended Works item R1, R2, …, numbered across the whole project (all floors). The two
 * sequences are independent.
 *
 * A reference is only the customer-facing label. Each item's permanent identity is its `id`, which
 * never changes. References are kept sequential with no gaps: deleting F2 makes F3 the new F2.
 * The order is creation order, which the stored numbers already record (a new item is always
 * issued the next number), so renumbering is deterministic and reopening a plan never reorders it.
 * compactReferences runs on every change to the open project (stores/project.ts) and on load.
 */
import type { Floor, OverlayItem, OverlayLayer, Project } from '$lib/models/types';

export type RefPrefix = 'F' | 'R';

export const refPrefix = (layer: OverlayLayer): RefPrefix => layer === 'survey-findings' ? 'F' : 'R';

const REF_PATTERN = /^([FR])([1-9]\d{0,5})$/;

/** 'F12' → { prefix: 'F', n: 12 }; anything else → null. */
export function parseRef(ref: unknown): { prefix: RefPrefix; n: number } | null {
  const match = typeof ref === 'string' ? REF_PATTERN.exec(ref) : null;
  return match ? { prefix: match[1] as RefPrefix, n: Number(match[2]) } : null;
}

/** Sort key: references in numeric order (F2 before F10), items without one last. */
export function refNumber(ref: string | undefined): number {
  return parseRef(ref)?.n ?? Number.MAX_SAFE_INTEGER;
}

/** Every referenced item on a floor, in a fixed order (areas, pins, lines). */
export function floorItems(floor: Pick<Floor, 'surveyFindings' | 'recommendedWorks' | 'overlayPins' | 'overlayLines'>): OverlayItem[] {
  return [...floor.surveyFindings ?? [], ...floor.recommendedWorks ?? [], ...floor.overlayPins ?? [], ...floor.overlayLines ?? []];
}

/** Issue the next reference for a layer and record it on the project. */
export function issueRef(project: Project, layer: OverlayLayer): string {
  const prefix = refPrefix(layer);
  let max = 0;
  for (const floor of project.floors) for (const item of floorItems(floor)) {
    const parsed = parseRef(item.ref);
    if (parsed?.prefix === prefix) max = Math.max(max, parsed.n);
  }
  const ref = `${prefix}${max + 1}`;
  project.surveyReferences = { F: project.surveyReferences?.F ?? 0, R: project.surveyReferences?.R ?? 0, [prefix]: max + 1 };
  return ref;
}

/**
 * Renumber each layer F1…Fn and R1…Rn with no gaps, keeping the existing order: items keep their
 * relative order by current number; items without a valid reference for their layer, and second
 * copies of a reference (a pasted or imported duplicate), go last in floor and item order.
 * Item ids and everything else are untouched. Returns true when anything changed. Mutates.
 */
export function compactReferences(project: Project): boolean {
  let changed = false;
  for (const prefix of ['F', 'R'] as const) {
    const seen = new Set<number>(), keyed: { item: OverlayItem; key: number; order: number }[] = [];
    for (const floor of project.floors) for (const item of floorItems(floor)) {
      if (refPrefix(item.layer) !== prefix) continue;
      const parsed = parseRef(item.ref);
      const valid = parsed?.prefix === prefix && !seen.has(parsed.n);
      if (valid) seen.add(parsed!.n);
      keyed.push({ item, key: valid ? parsed!.n : Number.POSITIVE_INFINITY, order: keyed.length });
    }
    keyed.sort((a, b) => a.key - b.key || a.order - b.order);
    keyed.forEach(({ item }, index) => {
      const ref = `${prefix}${index + 1}`;
      if (item.ref !== ref) { item.ref = ref; changed = true; }
    });
    const count = keyed.length;
    if ((project.surveyReferences || count) && project.surveyReferences?.[prefix] !== count) {
      project.surveyReferences = { F: project.surveyReferences?.F ?? 0, R: project.surveyReferences?.R ?? 0, [prefix]: count };
      changed = true;
    }
  }
  return changed;
}

/** Give every item a sequential reference for its layer (compactReferences). Mutates and returns the project. */
export function normalizeReferences(project: Project): Project {
  compactReferences(project);
  return project;
}
