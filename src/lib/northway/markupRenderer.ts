/**
 * Northway: drawing and hit testing for free-text pins and lines, shared by the editor canvas
 * and every exporter. Sizes are in screen pixels (export layout units), so markers stay legible
 * at any plan scale.
 *
 * Findings are solid: a filled circular marker, and a solid band with a solid core line.
 * Recommendations are outlined: a white hexagonal marker with a coloured border, and a lighter
 * band with a dashed core line. The two read apart in greyscale, without relying on colour.
 */
import type { OverlayLayer, OverlayLine, OverlayPin, Point } from '$lib/models/types';
import { worldToScreen, type CanvasState } from '$lib/utils/canvasInteraction';
import { rgba } from './zonePresets';
import { itemColor, itemInk, PRIORITIES } from './priorities';

export interface MarkupStyle {
  /** Marker outline: circle (findings) or hexagon (recommendations). */
  marker: 'circle' | 'hexagon';
  /** Filled marker with white text (findings) or white marker with coloured text (recommendations). */
  filled: boolean;
  bandWidth: number;
  bandOpacity: number;
  coreWidth: number;
  coreDash: number[];
}

export const MARKUP_STYLES: Readonly<Record<OverlayLayer, MarkupStyle>> = {
  'survey-findings': { marker: 'circle', filled: true, bandWidth: 7, bandOpacity: 0.45, coreWidth: 1.75, coreDash: [] },
  'recommended-works': { marker: 'hexagon', filled: false, bandWidth: 7, bandOpacity: 0.2, coreWidth: 2, coreDash: [8, 5] },
};

const MARKER_FONT = '700 10px sans-serif';
/** Smallest marker radius in screen pixels; long references (F123) widen it. */
const MARKER_RADIUS = 10;
const VERTEX_HANDLE = 7;

export function markerRadius(ctx: CanvasRenderingContext2D, label: string): number {
  ctx.save(); ctx.font = MARKER_FONT;
  const width = ctx.measureText(label).width;
  ctx.restore();
  return Math.max(MARKER_RADIUS, width / 2 + 4);
}

function markerPath(ctx: CanvasRenderingContext2D, style: MarkupStyle, x: number, y: number, r: number) {
  ctx.beginPath();
  if (style.marker === 'circle') ctx.arc(x, y, r, 0, Math.PI * 2);
  else for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 6 + (i * Math.PI) / 3, px = x + r * 1.08 * Math.cos(angle), py = y + r * 1.08 * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * A reference marker (F1 / R1) centred on a screen point. Also used for line labels. Recommendations
 * pass their priority colour and its darker ink: a lightly tinted hexagon with an ink outline and text.
 */
export function drawReferenceMarker(ctx: CanvasRenderingContext2D, layer: OverlayLayer, color: string, label: string, x: number, y: number, ink: string = color): void {
  const style = MARKUP_STYLES[layer], r = markerRadius(ctx, label);
  ctx.save();
  ctx.setLineDash([]);
  markerPath(ctx, style, x, y, r + 1.5);
  ctx.fillStyle = '#ffffff';
  ctx.fill(); // white halo keeps the marker readable over walls and hatching
  markerPath(ctx, style, x, y, r);
  ctx.fillStyle = style.filled ? rgba(color, 0.95) : '#ffffff';
  ctx.fill();
  if (!style.filled) { ctx.fillStyle = rgba(color, 0.22); ctx.fill(); }
  ctx.lineWidth = style.filled ? 1 : 1.75;
  ctx.strokeStyle = style.filled ? rgba('#000000', 0.25) : rgba(ink, 0.95);
  ctx.stroke();
  ctx.font = MARKER_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style.filled ? '#ffffff' : rgba(ink, 1);
  ctx.fillText(label, x, y + 0.5);
  ctx.restore();
}

const pinLabel = (item: OverlayPin | OverlayLine) => item.ref ?? '•';

function screenPoints(cs: CanvasState, points: readonly Point[]) {
  return points.map(p => worldToScreen(cs, p.x, p.y));
}

/** Point halfway along a polyline, by length (where its reference marker sits). */
export function lineMidpoint(points: readonly Point[]): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let remaining = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] ? Math.min(1, remaining / lengths[i]) : 0;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t };
    }
    remaining -= lengths[i];
  }
  return points[0];
}

function stroke(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
}

/** Line bands and core lines, findings first. Drawn above walls so markups along walls stay visible. */
export function drawMarkupLines(cs: CanvasState, lines: readonly OverlayLine[]): void {
  const { ctx } = cs;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const line of [...lines].sort((a, b) => Number(a.layer === 'recommended-works') - Number(b.layer === 'recommended-works'))) {
    const style = MARKUP_STYLES[line.layer], pts = screenPoints(cs, line.points);
    ctx.setLineDash([]);
    const color = itemColor(line), ink = line.layer === 'recommended-works' ? itemInk(line) : color;
    ctx.strokeStyle = rgba(color, style.bandOpacity);
    ctx.lineWidth = style.bandWidth;
    stroke(ctx, pts);
    ctx.setLineDash(style.coreDash);
    ctx.lineCap = style.coreDash.length ? 'butt' : 'round';
    ctx.strokeStyle = rgba(ink, 0.95);
    ctx.lineWidth = style.coreWidth;
    stroke(ctx, pts);
    ctx.lineCap = 'round';
  }
  ctx.restore();
}

/** Reference markers for lines (at their midpoint) and pins, drawn on top of the plan. */
export function drawMarkupMarkers(cs: CanvasState, pins: readonly OverlayPin[], lines: readonly OverlayLine[]): void {
  for (const line of lines) {
    const mid = lineMidpoint(line.points), p = worldToScreen(cs, mid.x, mid.y);
    drawReferenceMarker(cs.ctx, line.layer, itemColor(line), pinLabel(line), p.x, p.y, itemInk(line));
  }
  for (const pin of pins) {
    const p = worldToScreen(cs, pin.x, pin.y);
    drawReferenceMarker(cs.ctx, pin.layer, itemColor(pin), pinLabel(pin), p.x, p.y, itemInk(pin));
  }
}

/** Selection: a dashed ring around a pin, or the line's vertex handles. */
export function drawMarkupSelection(cs: CanvasState, item: OverlayPin | OverlayLine, handleSize = VERTEX_HANDLE): void {
  const { ctx } = cs;
  ctx.save();
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1.5;
  if ('points' in item) {
    ctx.setLineDash([5, 3]);
    stroke(ctx, screenPoints(cs, item.points));
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    for (const p of screenPoints(cs, item.points)) {
      ctx.fillRect(p.x - handleSize / 2, p.y - handleSize / 2, handleSize, handleSize);
      ctx.strokeRect(p.x - handleSize / 2, p.y - handleSize / 2, handleSize, handleSize);
    }
  } else {
    const p = worldToScreen(cs, item.x, item.y);
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, markerRadius(ctx, pinLabel(item)) + 5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Preview of a line being drawn: the clicked points plus the segment to the pointer. */
export function drawLineDraft(cs: CanvasState, layer: OverlayLayer, color: string, points: readonly Point[], pointer: Point | null): void {
  if (!points.length) return;
  const all = pointer ? [...points, pointer] : [...points];
  if (all.length >= 2) drawMarkupLines(cs, [{ id: 'draft', layer, description: '', color, points: all, ...(layer === 'recommended-works' ? { priority: priorityForColor(color) } : {}) }]);
  const { ctx } = cs;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = rgba(color, 0.95);
  ctx.lineWidth = 1.5;
  for (const p of screenPoints(cs, points)) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  ctx.restore();
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Topmost pin or line under a world point (pins and line markers first, then line bands). */
/** `slack` widens every target in screen pixels (used for touch). */
export function findMarkupAt(p: Point, pins: readonly OverlayPin[], lines: readonly OverlayLine[], zoom: number, measure: (label: string) => number = () => MARKER_RADIUS, slack = 0): OverlayPin | OverlayLine | null {
  for (let i = pins.length - 1; i >= 0; i--) {
    if (Math.hypot(p.x - pins[i].x, p.y - pins[i].y) <= (measure(pinLabel(pins[i])) + 2 + slack) / zoom) return pins[i];
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const mid = lineMidpoint(lines[i].points);
    if (Math.hypot(p.x - mid.x, p.y - mid.y) <= (measure(pinLabel(lines[i])) + 2 + slack) / zoom) return lines[i];
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const pts = lines[i].points, tolerance = (MARKUP_STYLES[lines[i].layer].bandWidth / 2 + 4 + slack) / zoom;
    for (let k = 1; k < pts.length; k++) if (segmentDistance(p, pts[k - 1], pts[k]) <= tolerance) return lines[i];
  }
  return null;
}

/** Index of the selected line's vertex under a world point, or -1. */
export function findLineVertexAt(p: Point, line: OverlayLine, zoom: number, slack = 0): number {
  const tolerance = (VERTEX_HANDLE / 2 + 3 + slack) / zoom;
  return line.points.findIndex(v => Math.abs(p.x - v.x) <= tolerance && Math.abs(p.y - v.y) <= tolerance);
}

/** Index of the segment of a line under a world point (for inserting a point), or -1. */
export function findLineSegmentAt(p: Point, line: OverlayLine, zoom: number): number {
  const tolerance = (MARKUP_STYLES[line.layer].bandWidth / 2 + 4) / zoom;
  for (let k = 1; k < line.points.length; k++) if (segmentDistance(p, line.points[k - 1], line.points[k]) <= tolerance) return k - 1;
  return -1;
}

/** The priority whose colour a draft line uses (drafts only carry a colour). */
function priorityForColor(color: string) {
  return PRIORITIES.find(p => p.color === color)?.id ?? 'unassigned';
}
