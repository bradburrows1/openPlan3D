/**
 * Northway: drawing and hit testing for Survey Finding issue areas.
 * Pure functions over a CanvasState, shared by the editor canvas and the exporters,
 * so the exported position and scale always match the editor.
 */
import type { Point, SurveyFindingZone } from '$lib/models/types';
import { worldToScreen, type CanvasState } from '$lib/utils/canvasInteraction';
import { BORDER_OPACITY, BORDER_WIDTH, FILL_OPACITY, rgba, surveyFindingColor } from './surveyPresets';
import type { ZoneRect } from './surveyStore';

export type ZoneHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: readonly ZoneHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** Screen-pixel size of resize handles and their hit area. */
const HANDLE_SIZE = 8;
const HANDLE_HIT = 9;

function screenRect(cs: CanvasState, zone: ZoneRect) {
  const a = worldToScreen(cs, zone.x, zone.y), b = worldToScreen(cs, zone.x + zone.width, zone.y + zone.height);
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}

/** Fills and borders: drawn above room fills and below walls. */
export function drawSurveyFindingAreas(cs: CanvasState, zones: readonly SurveyFindingZone[]): void {
  const { ctx } = cs;
  ctx.save();
  ctx.setLineDash([]);
  for (const zone of zones) {
    const r = screenRect(cs, zone), color = surveyFindingColor(zone.code);
    ctx.fillStyle = rgba(color, FILL_OPACITY);
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = rgba(color, BORDER_OPACITY);
    ctx.lineWidth = BORDER_WIDTH;
    ctx.strokeRect(r.x, r.y, r.width, r.height);
  }
  ctx.restore();
}

/** Short codes only (HM, WM, …), drawn discreetly in the top-left corner. */
export function drawSurveyFindingCodes(cs: CanvasState, zones: readonly SurveyFindingZone[]): void {
  const { ctx } = cs;
  ctx.save();
  ctx.font = '600 11px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (const zone of zones) {
    const r = screenRect(cs, zone);
    const label = String(zone.code);
    const width = ctx.measureText(label).width;
    // Small areas get a centred code so it stays inside the outline.
    const roomy = r.width >= width + 10 && r.height >= 19;
    const x = roomy ? r.x + 5 : r.x + r.width / 2 - width / 2;
    const y = roomy ? r.y + 4 : r.y + r.height / 2 - 6;
    ctx.fillStyle = rgba(surveyFindingColor(zone.code), 0.95);
    ctx.fillText(label, x, y);
  }
  ctx.restore();
}

/** Selection outline plus eight resize handles, drawn on top of the plan. */
export function drawSurveyFindingSelection(cs: CanvasState, zone: SurveyFindingZone): void {
  const { ctx } = cs;
  const r = screenRect(cs, zone);
  ctx.save();
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4);
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffffff';
  for (const handle of HANDLES) {
    const p = worldToScreen(cs, ...handlePoint(zone, handle));
    ctx.fillRect(p.x - HANDLE_SIZE / 2, p.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.strokeRect(p.x - HANDLE_SIZE / 2, p.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
  }
  ctx.restore();
}

/** Preview while dragging out a new issue area. */
export function drawSurveyFindingDraft(cs: CanvasState, code: string, rect: ZoneRect): void {
  drawSurveyFindingAreas(cs, [{ id: 'draft', layer: 'survey-findings', code, shape: 'rect', ...rect }]);
}

/** World position of a resize handle. */
export function zoneHandlePoint(zone: ZoneRect, handle: ZoneHandle): Point {
  const [x, y] = handlePoint(zone, handle);
  return { x, y };
}

function handlePoint(zone: ZoneRect, handle: ZoneHandle): [number, number] {
  const x = handle.includes('w') ? zone.x : handle.includes('e') ? zone.x + zone.width : zone.x + zone.width / 2;
  const y = handle.includes('n') ? zone.y : handle.includes('s') ? zone.y + zone.height : zone.y + zone.height / 2;
  return [x, y];
}

/** Topmost issue area containing a world point. */
export function findSurveyFindingAt(p: Point, zones: readonly SurveyFindingZone[] | undefined): SurveyFindingZone | null {
  for (let i = (zones?.length ?? 0) - 1; i >= 0; i--) {
    const zone = zones![i];
    if (p.x >= zone.x && p.x <= zone.x + zone.width && p.y >= zone.y && p.y <= zone.y + zone.height) return zone;
  }
  return null;
}

/** Resize handle of a selected issue area under a world point. */
export function findSurveyFindingHandleAt(p: Point, zone: ZoneRect, zoom: number): ZoneHandle | null {
  const tolerance = HANDLE_HIT / zoom;
  for (const handle of HANDLES) {
    const [x, y] = handlePoint(zone, handle);
    if (Math.abs(p.x - x) <= tolerance && Math.abs(p.y - y) <= tolerance) return handle;
  }
  return null;
}

/** New rectangle when a handle is dragged to a world point; the opposite side stays put. */
export function resizeZoneRect(start: ZoneRect, handle: ZoneHandle, p: Point, minSize: number): ZoneRect {
  let left = start.x, top = start.y, right = start.x + start.width, bottom = start.y + start.height;
  if (handle.includes('w')) left = Math.min(p.x, right - minSize);
  if (handle.includes('e')) right = Math.max(p.x, left + minSize);
  if (handle.includes('n')) top = Math.min(p.y, bottom - minSize);
  if (handle.includes('s')) bottom = Math.max(p.y, top + minSize);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function zoneCursor(handle: ZoneHandle): string {
  return handle === 'n' || handle === 's' ? 'ns-resize' : handle === 'e' || handle === 'w' ? 'ew-resize'
    : handle === 'nw' || handle === 'se' ? 'nwse-resize' : 'nesw-resize';
}
