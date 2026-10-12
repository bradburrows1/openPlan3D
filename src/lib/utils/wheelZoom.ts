/**
 * Mouse-wheel and trackpad zoom for the 2D plan canvas.
 *
 * A wheel event can come from a notched mouse wheel (one large step per click), a precision
 * trackpad (a stream of small deltas, 60+ events a second) or a trackpad pinch (Chrome, Edge and
 * Firefox send it as a wheel event with ctrlKey set). The zoom applied scales with the size of the
 * movement, so a small trackpad gesture zooms a little and one mouse-wheel click zooms one step.
 * Zoom in and zoom out are exact inverses, so in-then-out returns to the same scale.
 */

/** Largest zoom: 10 screen pixels per centimetre, enough to mark a small patch accurately. */
export const MAX_ZOOM = 10;

/** One mouse-wheel click zooms by this factor (out) or its inverse (in). */
export const NOTCH_FACTOR = 0.9;
/** Pixels of scroll that count as one wheel click. */
const NOTCH_PIXELS = 100;
/** Pixels per line when the browser reports lines (Firefox with a mouse wheel). */
const LINE_PIXELS = 100 / 3;
/** Most scroll counted from a single event, so a burst never jumps several levels at once. */
const MAX_EVENT_PIXELS = 150;
/** Pinch: zoom per unit of deltaY (Chrome reports about 1–10 per pinch event). */
const PINCH_RATE = 0.01;
/** Most pinch counted from a single event. */
const MAX_PINCH_PIXELS = 25;
/** Events closer together than this belong to the same gesture. */
export const GESTURE_GAP_MS = 150;

export type WheelAction = 'zoom' | 'pan';

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  /** Non-standard but present in Chrome, Edge and Safari: ±120 per mouse-wheel click. */
  wheelDeltaY?: number;
}

/**
 * True when the event looks like a notched mouse wheel rather than a trackpad: the browser reports
 * lines or pages (Firefox), or the legacy wheelDeltaY is a whole number of 120-unit clicks
 * (Chrome, Edge and Safari; a trackpad gives arbitrary values).
 */
export function isNotchedWheel(e: WheelLike): boolean {
  if (e.deltaMode !== 0) return true;
  const legacy = e.wheelDeltaY;
  return e.deltaX === 0 && typeof legacy === 'number' && legacy !== 0 && legacy % 120 === 0;
}

/** What a gesture (a run of wheel events less than GESTURE_GAP_MS apart) is doing. */
export interface WheelGesture { action: WheelAction; notched: boolean; pinch: boolean; time: number }

/**
 * Classify an event, keeping the decision made at the start of its gesture. A pinch and a mouse
 * wheel zoom. A trackpad two-finger scroll keeps the editor's existing behaviour (vertical scroll
 * zooms, a sideways scroll pans), but the choice, like mouse-or-trackpad, is made once per gesture,
 * so one gesture never flips between zooming and panning or between step and smooth zoom.
 */
export function readWheel(e: WheelLike, previous: WheelGesture | null, now: number): WheelGesture {
  // Starting or ending a pinch (ctrlKey) also starts a new gesture.
  if (previous && now - previous.time < GESTURE_GAP_MS && previous.pinch === e.ctrlKey) return { ...previous, time: now };
  const notched = isNotchedWheel(e);
  return { action: e.ctrlKey || notched || e.deltaX === 0 ? 'zoom' : 'pan', notched, pinch: e.ctrlKey, time: now };
}

const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

/** Scroll in pixels for a mouse wheel: one click counts as NOTCH_PIXELS whatever the browser reports. */
function notchPixels(e: WheelLike, pageHeight: number): number {
  if (e.deltaMode === 1) return e.deltaY * LINE_PIXELS;
  if (e.deltaMode === 2) return e.deltaY * pageHeight;
  const legacy = e.wheelDeltaY;
  if (legacy && legacy % 120 === 0) return Math.sign(e.deltaY || -legacy) * NOTCH_PIXELS * Math.abs(legacy) / 120;
  return e.deltaY;
}

/** The zoom multiplier for one event (>1 zooms in). */
export function wheelZoomFactor(e: WheelLike, notched: boolean, pageHeight = 800): number {
  if (notched) return Math.pow(NOTCH_FACTOR, clamp(notchPixels(e, pageHeight), MAX_EVENT_PIXELS) / NOTCH_PIXELS);
  if (e.ctrlKey) return Math.exp(-clamp(e.deltaY, MAX_PINCH_PIXELS) * PINCH_RATE);
  return Math.pow(NOTCH_FACTOR, clamp(e.deltaY, MAX_EVENT_PIXELS) / NOTCH_PIXELS);
}

export function clampZoom(value: number, minimum: number): number {
  return Math.max(minimum, Math.min(MAX_ZOOM, value));
}

/**
 * Camera centre after changing the zoom so the plan point under the screen point (sx, sy) stays
 * under it. The camera (camX, camY) is the world point at the centre of a width × height view.
 */
export function zoomAbout(view: { camX: number; camY: number; zoom: number }, sx: number, sy: number, width: number, height: number, newZoom: number): { camX: number; camY: number } {
  const worldX = (sx - width / 2) / view.zoom + view.camX;
  const worldY = (sy - height / 2) / view.zoom + view.camY;
  return { camX: worldX - (sx - width / 2) / newZoom, camY: worldY - (sy - height / 2) / newZoom };
}
