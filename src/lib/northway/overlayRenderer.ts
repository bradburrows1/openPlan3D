/**
 * Northway: drawing and hit testing for the two overlay layers (Survey Findings and
 * Recommended Works). Pure functions over a CanvasState, shared by the editor canvas
 * and the exporters, so exported position, scale and styling always match the editor.
 *
 * Findings: tinted fill, solid border, reference (F1…) top-left.
 * Recommendations: very light fill, diagonal hatch, dashed heavier border, reference (R1…) on a
 * white tag top-right. The two read differently without relying on colour.
 */
import type { OverlayZone, Point } from '$lib/models/types';
import { worldToScreen, type CanvasState } from '$lib/utils/canvasInteraction';
import { LAYER_STYLES, rgba, zoneAppearance } from './zonePresets';
import { itemInk } from './priorities';
import type { ZoneRect, ZoneTemplate } from './overlayStore';

export type ZoneHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: readonly ZoneHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
/** Screen-pixel size of resize handles and their hit area. */
const HANDLE_SIZE = 8;
const HANDLE_HIT = 9;
const CODE_FONT = '700 11px sans-serif';

function screenRect(cs: CanvasState, zone: ZoneRect) {
  const a = worldToScreen(cs, zone.x, zone.y), b = worldToScreen(cs, zone.x + zone.width, zone.y + zone.height);
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}

/** Findings first, then recommendations, keeping each layer's order: the drawing order. */
function stacked(zones: readonly OverlayZone[]): OverlayZone[] {
  return [...zones.filter(zone => zone.layer !== 'recommended-works'), ...zones.filter(zone => zone.layer === 'recommended-works')];
}

/** Fills, hatching and borders: drawn above room fills and below walls. Findings sit under recommendations. */
export function drawZoneAreas(cs: CanvasState, zones: readonly OverlayZone[]): void {
  const { ctx } = cs;
  ctx.save();
  for (const zone of stacked(zones)) {
    const r = screenRect(cs, zone), style = LAYER_STYLES[zone.layer], { color } = zoneAppearance(zone);
    ctx.fillStyle = rgba(color, style.fillOpacity);
    ctx.fillRect(r.x, r.y, r.width, r.height);
    if (style.hatch) {
      const { spacing, width, opacity } = style.hatch;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.width, r.height);
      ctx.clip();
      ctx.beginPath();
      for (let t = -r.height; t < r.width; t += spacing) {
        ctx.moveTo(r.x + t, r.y + r.height);
        ctx.lineTo(r.x + t + r.height, r.y);
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = rgba(color, opacity);
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.restore();
    }
    ctx.setLineDash(style.dash);
    // Recommendations: the priority's darker shade, so even Advisory (yellow) keeps a firm outline.
    ctx.strokeStyle = rgba(zone.layer === 'recommended-works' ? itemInk(zone) : color, style.borderOpacity);
    ctx.lineWidth = style.borderWidth;
    ctx.strokeRect(r.x, r.y, r.width, r.height);
  }
  ctx.restore();
}

/** Where a zone's code is drawn, in screen pixels (top-left of the text box). Shared with the SVG exporter. */
export function zoneCodeBox(r: { x: number; y: number; width: number; height: number }, layer: OverlayZone['layer'], textWidth: number) {
  const style = LAYER_STYLES[layer], pad = style.codeTag ? 3 : 0;
  const boxWidth = textWidth + pad * 2, boxHeight = 11 + pad * 2;
  // Small areas get a centred code so it stays inside the outline.
  const roomy = r.width >= boxWidth + 10 && r.height >= boxHeight + 8;
  if (!roomy) return { x: r.x + r.width / 2 - boxWidth / 2, y: r.y + r.height / 2 - boxHeight / 2, width: boxWidth, height: boxHeight, pad };
  const x = style.codeCorner === 'top-left' ? r.x + 5 : r.x + r.width - 5 - boxWidth;
  return { x, y: r.y + 4, width: boxWidth, height: boxHeight, pad };
}

/** Each zone's stable reference (F1, R2, …; the type code for unreferenced drafts), drawn discreetly in its layer's corner. */
export function drawZoneCodes(cs: CanvasState, zones: readonly OverlayZone[]): void {
  const { ctx } = cs;
  ctx.save();
  ctx.font = CODE_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.setLineDash([]);
  for (const zone of stacked(zones)) {
    const style = LAYER_STYLES[zone.layer], code = zoneLabel(zone), color = zone.layer === 'recommended-works' ? itemInk(zone) : zoneAppearance(zone).color;
    const box = zoneCodeBox(screenRect(cs, zone), zone.layer, ctx.measureText(code).width);
    if (style.codeTag) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.fillRect(box.x, box.y, box.width, box.height);
      ctx.strokeStyle = rgba(color, 0.95);
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1);
    }
    ctx.fillStyle = rgba(color, 0.95);
    ctx.fillText(code, box.x + box.pad, box.y + box.pad);
  }
  ctx.restore();
}

/** The text drawn on the plan for a zone: its reference, or its code before it has one. */
export function zoneLabel(zone: Pick<OverlayZone, 'ref' | 'code'>): string {
  return zone.ref ?? zone.code;
}

/** Selection outline plus eight resize handles, drawn on top of the plan. */
export function drawZoneSelection(cs: CanvasState, zone: ZoneRect, handleSize = HANDLE_SIZE): void {
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
    ctx.fillRect(p.x - handleSize / 2, p.y - handleSize / 2, handleSize, handleSize);
    ctx.strokeRect(p.x - handleSize / 2, p.y - handleSize / 2, handleSize, handleSize);
  }
  ctx.restore();
}

/** Preview while dragging out a new zone. */
export function drawZoneDraft(cs: CanvasState, template: ZoneTemplate, rect: ZoneRect): void {
  drawZoneAreas(cs, [{ id: 'draft', shape: 'rect', ...template, ...rect } as OverlayZone]);
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

/**
 * Every zone containing a world point, best pick first: the smallest area wins (so a small
 * zone inside a large one stays reachable), and equal areas go to the one drawn on top
 * (recommendations above findings). Clicking again cycles through the rest.
 */
export function zonesAt(p: Point, zones: readonly OverlayZone[] | undefined): OverlayZone[] {
  const order = stacked(zones ?? []);
  return order
    .map((zone, index) => ({ zone, index }))
    .filter(({ zone }) => p.x >= zone.x && p.x <= zone.x + zone.width && p.y >= zone.y && p.y <= zone.y + zone.height)
    .sort((a, b) => a.zone.width * a.zone.height - b.zone.width * b.zone.height || b.index - a.index)
    .map(({ zone }) => zone);
}

/** The zone a click selects. With a zone already selected there, the next one under the point (click to cycle). */
export function pickZoneAt(p: Point, zones: readonly OverlayZone[] | undefined, selectedId: string | null = null): OverlayZone | null {
  const hits = zonesAt(p, zones);
  if (!hits.length) return null;
  const current = selectedId ? hits.findIndex(zone => zone.id === selectedId) : -1;
  return current < 0 ? hits[0] : hits[(current + 1) % hits.length];
}

/** Resize handle of a selected zone under a world point. `hit` is the screen-pixel reach (larger for touch). */
export function findZoneHandleAt(p: Point, zone: ZoneRect, zoom: number, hit = HANDLE_HIT): ZoneHandle | null {
  const tolerance = hit / zoom;
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
