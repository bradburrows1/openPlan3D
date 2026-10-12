import { expect, it } from 'vitest';
import { GESTURE_GAP_MS, MAX_ZOOM, NOTCH_FACTOR, clampZoom, isNotchedWheel, readWheel, wheelZoomFactor, zoomAbout, type WheelLike } from '$lib/utils/wheelZoom';

const wheel = (over: Partial<WheelLike>): WheelLike => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, ...over });
const mouse = (clicks: number) => wheel({ deltaY: 100 * clicks, wheelDeltaY: -120 * clicks });

it('recognises a mouse wheel click on every browser and treats trackpads as smooth', () => {
  expect(isNotchedWheel(mouse(1))).toBe(true); // Chrome / Edge
  expect(isNotchedWheel(wheel({ deltaY: 4.000244, wheelDeltaY: -120 }))).toBe(true); // Safari mouse
  expect(isNotchedWheel(wheel({ deltaY: 3, deltaMode: 1 }))).toBe(true); // Firefox mouse (lines)
  expect(isNotchedWheel(wheel({ deltaY: 2.5, wheelDeltaY: -7 }))).toBe(false); // trackpad
  expect(isNotchedWheel(wheel({ deltaY: 2 }))).toBe(false); // no legacy field
});

it('zooms one step per mouse click, and in then out returns to the same scale', () => {
  const out = wheelZoomFactor(mouse(1), true), zoomIn = wheelZoomFactor(mouse(-1), true);
  expect(out).toBeCloseTo(NOTCH_FACTOR, 10);
  expect(out * zoomIn).toBeCloseTo(1, 10);
  // Safari's few-pixel click and Firefox's three lines both count as one click.
  expect(wheelZoomFactor(wheel({ deltaY: 4, wheelDeltaY: -120 }), true)).toBeCloseTo(NOTCH_FACTOR, 10);
  expect(wheelZoomFactor(wheel({ deltaY: 3, deltaMode: 1 }), true)).toBeCloseTo(NOTCH_FACTOR, 10);
  // A burst counts at most one and a half clicks per event.
  expect(wheelZoomFactor(mouse(5), true)).toBeCloseTo(NOTCH_FACTOR ** 1.5, 10);
});

it('scales trackpad scroll and pinch with the size of the movement', () => {
  // Thirty 3-pixel trackpad events: 90 px of scroll is under one click, not thirty clicks.
  let zoom = 1;
  for (let i = 0; i < 30; i++) zoom *= wheelZoomFactor(wheel({ deltaY: 3, wheelDeltaY: -9 }), false);
  expect(zoom).toBeCloseTo(NOTCH_FACTOR ** 0.9, 10);
  // Pinch follows the gesture (about e^-deltaY/100) and is capped per event.
  expect(wheelZoomFactor(wheel({ deltaY: -2, ctrlKey: true }), false)).toBeCloseTo(Math.exp(0.02), 10);
  expect(wheelZoomFactor(wheel({ deltaY: -500, ctrlKey: true }), false)).toBeCloseTo(Math.exp(0.25), 10);
  // Ctrl + mouse wheel zooms one click, not a huge pinch.
  expect(wheelZoomFactor(wheel({ deltaY: 100, wheelDeltaY: -120, ctrlKey: true }), true)).toBeCloseTo(NOTCH_FACTOR, 10);
});

it('decides zoom or pan once per gesture', () => {
  let g = readWheel(wheel({ deltaY: 4, wheelDeltaY: -12 }), null, 0);
  expect(g).toMatchObject({ action: 'zoom', notched: false });
  // A sideways twitch inside the same gesture keeps zooming.
  g = readWheel(wheel({ deltaX: 2, deltaY: 4, wheelDeltaY: -12 }), g, 16);
  expect(g.action).toBe('zoom');
  // After a pause, a sideways scroll starts a pan gesture, which stays a pan.
  g = readWheel(wheel({ deltaX: 6, deltaY: 1 }), g, 16 + GESTURE_GAP_MS + 1);
  expect(g.action).toBe('pan');
  g = readWheel(wheel({ deltaY: 5 }), g, 16 + GESTURE_GAP_MS + 20);
  expect(g.action).toBe('pan');
  // Starting a pinch always zooms, and ending it starts a new gesture.
  g = readWheel(wheel({ deltaY: -2, ctrlKey: true }), g, 16 + GESTURE_GAP_MS + 40);
  expect(g).toMatchObject({ action: 'zoom', pinch: true });
  g = readWheel(wheel({ deltaX: 6 }), g, 16 + GESTURE_GAP_MS + 60);
  expect(g).toMatchObject({ action: 'pan', pinch: false });
  // A mouse wheel always zooms.
  expect(readWheel(mouse(1), null, 0)).toMatchObject({ action: 'zoom', notched: true });
});

it('keeps the plan point under the cursor and clamps the scale', () => {
  const view = { camX: 120, camY: -40, zoom: 0.8 }, width = 900, height = 600, sx = 700, sy = 150;
  const world = { x: (sx - width / 2) / view.zoom + view.camX, y: (sy - height / 2) / view.zoom + view.camY };
  for (const next of [0.2, 1.7, 9]) {
    const cam = zoomAbout(view, sx, sy, width, height, next);
    expect((world.x - cam.camX) * next + width / 2).toBeCloseTo(sx, 9);
    expect((world.y - cam.camY) * next + height / 2).toBeCloseTo(sy, 9);
  }
  expect(clampZoom(50, 0.05)).toBe(MAX_ZOOM);
  expect(clampZoom(0.001, 0.05)).toBe(0.05);
});
