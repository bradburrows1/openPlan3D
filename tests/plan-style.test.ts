import { expect, it } from 'vitest';
import { drawRoomFloorPattern, getRoomFill } from '$lib/utils/canvasRenderer';
import { exportRoomFill, isTechnicalStyle, TECHNICAL } from '$lib/utils/planStyle';
import type { Room } from '$lib/models/types';

const room = (overrides: Partial<Room> = {}): Room => ({ id: 'r', name: 'Kitchen', walls: [], floorTexture: 'hardwood', area: 12, ...overrides });

function patternCalls(r: Room, technical: boolean) {
  let calls = 0;
  const ctx = new Proxy({}, { get: (_t, key) => key === 'createPattern' ? () => null : () => { calls++; } }) as unknown as CanvasRenderingContext2D;
  drawRoomFloorPattern({ ctx, width: 500, height: 500, zoom: 1, camX: 0, camY: 0 }, r,
    [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }], [], technical);
  return calls;
}

it('defaults to the technical style, including legacy settings without planStyle', () => {
  expect(isTechnicalStyle(undefined)).toBe(true);
  expect(isTechnicalStyle({})).toBe(true);
  expect(isTechnicalStyle({ planStyle: 'technical' })).toBe(true);
  expect(isTechnicalStyle({ planStyle: 'decorative' })).toBe(false);
});

it('fills every room with the same neutral colour in technical style, ignoring room colours', () => {
  expect(getRoomFill(room(), 0, true)).toBe(TECHNICAL.roomFill);
  expect(getRoomFill(room({ color: '#ff0000', floorTexture: 'none' }), 3, true)).toBe(TECHNICAL.roomFill);
  expect(getRoomFill(room({ color: '#ff0000' }), 0, false)).toBe('rgba(255, 0, 0, 0.12)');
});

it('draws no floor texture or fallback pattern in technical style', () => {
  for (const name of ['Kitchen', 'Living Room', 'Garage']) {
    expect(patternCalls(room({ name, floorTexture: '' }), true)).toBe(0);
    expect(patternCalls(room({ name, floorTexture: '' }), false)).toBeGreaterThan(0);
  }
});

it('exports neutral opaque room fills in technical style and the upstream pastels otherwise', () => {
  expect(exportRoomFill(0, true)).toEqual({ color: TECHNICAL.roomFill, opacity: 1 });
  expect(exportRoomFill(5, true)).toEqual({ color: TECHNICAL.roomFill, opacity: 1 });
  expect(exportRoomFill(0, false)).toEqual({ color: '#bfdbfe', opacity: 0.4 });
});
