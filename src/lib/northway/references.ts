/**
 * Northway: stable plan references. Every Survey Findings item (area, pin or line) gets F1, F2, …
 * and every Recommended Works item R1, R2, …, unique across the whole project (all floors).
 *
 * A reference is issued once and stored with the item. Deleting an item never renumbers the
 * others, and its number is not reused: the project keeps the highest number issued per layer
 * (Project.surveyReferences). Within a session a high-water mark also survives undo, which
 * restores whole-project snapshots, so an undone F7 is not handed out again.
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

const highWater = new Map<string, { F: number; R: number }>();

function highest(project: Project, prefix: RefPrefix): number {
  let max = Math.max(project.surveyReferences?.[prefix] ?? 0, highWater.get(project.id)?.[prefix] ?? 0);
  for (const floor of project.floors) for (const item of floorItems(floor)) {
    const parsed = parseRef(item.ref);
    if (parsed?.prefix === prefix) max = Math.max(max, parsed.n);
  }
  return max;
}

function record(project: Project, prefix: RefPrefix, n: number) {
  project.surveyReferences = { F: project.surveyReferences?.F ?? 0, R: project.surveyReferences?.R ?? 0 };
  project.surveyReferences[prefix] = Math.max(project.surveyReferences[prefix], n);
  const mark = highWater.get(project.id) ?? { F: 0, R: 0 };
  mark[prefix] = Math.max(mark[prefix], n);
  highWater.set(project.id, mark);
}

/** Issue the next reference for a layer and record it on the project. */
export function issueRef(project: Project, layer: OverlayLayer): string {
  const prefix = refPrefix(layer), n = highest(project, prefix) + 1;
  record(project, prefix, n);
  return `${prefix}${n}`;
}

/**
 * Give every item a valid, unique reference for its layer, keeping all existing ones.
 * Items from older plans (Stage 2–4 areas), duplicates (the second copy) and references with the
 * wrong layer letter get new numbers after the highest in use, in floor and item order.
 * The counters are raised to at least the highest number present. Mutates and returns the project.
 */
export function normalizeReferences(project: Project): Project {
  const seen = new Set<string>(), pending: OverlayItem[] = [];
  for (const floor of project.floors) for (const item of floorItems(floor)) {
    const parsed = parseRef(item.ref);
    if (parsed && parsed.prefix === refPrefix(item.layer) && !seen.has(item.ref!)) seen.add(item.ref!);
    else pending.push(item);
  }
  for (const prefix of ['F', 'R'] as const) {
    let max = project.surveyReferences?.[prefix] ?? 0;
    for (const ref of seen) { const parsed = parseRef(ref)!; if (parsed.prefix === prefix) max = Math.max(max, parsed.n); }
    for (const item of pending) if (refPrefix(item.layer) === prefix) item.ref = `${prefix}${++max}`;
    if (max > 0 || project.surveyReferences) record(project, prefix, max);
  }
  return project;
}
