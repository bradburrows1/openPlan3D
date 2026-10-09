/**
 * Northway: 2D plan appearance.
 *
 * 'technical' (the default) draws a plain survey-style plan: neutral room
 * fills, no floor textures or fallback wood/tile/stone patterns, and darker
 * labels. 'decorative' restores upstream OpenPlan3D behaviour (per-room
 * colours and floor-material textures). Room data such as floorTexture and
 * color is never changed by the style, so switching back is lossless.
 */
export type PlanStyle = 'technical' | 'decorative';

export const DEFAULT_PLAN_STYLE: PlanStyle = 'technical';

export function isTechnicalStyle(settings: { planStyle?: PlanStyle } | undefined): boolean {
  return (settings?.planStyle ?? DEFAULT_PLAN_STYLE) === 'technical';
}

/** Technical palette: restrained greys only, no brand colours. */
export const TECHNICAL = {
  /** Opaque fill for exports on white paper. */
  roomFill: '#f4f4f5',
  /** Editor fill: blends to roomFill over white but keeps traced underlay images visible. */
  canvasRoomFill: 'rgba(161, 161, 170, 0.12)',
  roomLabel: '#1f2937',
  roomSubLabel: '#4b5563',
} as const;

const DECORATIVE_EXPORT_FILLS = ['#bfdbfe', '#fde68a', '#bbf7d0', '#fecaca', '#ddd6fe', '#a5f3fc', '#fed7aa'];

/** Room fill used by the PNG, SVG and PDF exporters. */
export function exportRoomFill(index: number, technical: boolean): { color: string; opacity: number } {
  return technical
    ? { color: TECHNICAL.roomFill, opacity: 1 }
    : { color: DECORATIVE_EXPORT_FILLS[index % DECORATIVE_EXPORT_FILLS.length], opacity: 0.4 };
}
