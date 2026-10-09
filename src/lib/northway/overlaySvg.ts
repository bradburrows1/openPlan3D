/**
 * Northway: SVG markup for both overlay layers, matching overlayRenderer's canvas drawing
 * (one SVG unit = 1 cm, as in the SVG export). Recommendations use a hatch pattern per colour.
 */
import type { OverlayZone } from '$lib/models/types';
import { zoneCodeBox } from './overlayRenderer';
import { LAYER_STYLES, rgba, zoneAppearance } from './zonePresets';

const escapeXml = (value: string) => value.replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]!);
/** Width of the 11px semibold code in the SVG, estimated (no text measuring outside a canvas). */
const codeWidth = (code: string) => code.length * 7.2;

/** `defs` (hatch patterns), `areas` (drawn above room fills, below walls) and `codes` (drawn last). */
export function overlaySvg(zones: readonly OverlayZone[], offsetX: number, offsetY: number): { defs: string; areas: string; codes: string } {
  const patterns = new Map<string, string>();
  let areas = '', codes = '';
  const ordered = [...zones.filter(zone => zone.layer !== 'recommended-works'), ...zones.filter(zone => zone.layer === 'recommended-works')];
  for (const zone of ordered) {
    const { code, color } = zoneAppearance(zone), style = LAYER_STYLES[zone.layer];
    const x = zone.x - offsetX, y = zone.y - offsetY;
    const attr = zone.layer === 'recommended-works' ? 'data-recommended-work' : 'data-survey-finding';
    const dash = style.dash.length ? ` stroke-dasharray="${style.dash.join(' ')}"` : '';
    areas += `  <rect ${attr}="${escapeXml(code)}" x="${x}" y="${y}" width="${zone.width}" height="${zone.height}" fill="${rgba(color, style.fillOpacity)}" stroke="none"/>\n`;
    if (style.hatch) {
      const id = `nw-hatch-${color.slice(1).toLowerCase()}`;
      if (!patterns.has(id)) patterns.set(id, `    <pattern id="${id}" patternUnits="userSpaceOnUse" width="${style.hatch.spacing}" height="${style.hatch.spacing}" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${style.hatch.spacing}" stroke="${rgba(color, style.hatch.opacity)}" stroke-width="${style.hatch.width}"/></pattern>\n`);
      areas += `  <rect x="${x}" y="${y}" width="${zone.width}" height="${zone.height}" fill="url(#${id})" stroke="none"/>\n`;
    }
    areas += `  <rect x="${x}" y="${y}" width="${zone.width}" height="${zone.height}" fill="none" stroke="${rgba(color, style.borderOpacity)}" stroke-width="${style.borderWidth}"${dash}/>\n`;
    const box = zoneCodeBox({ x, y, width: zone.width, height: zone.height }, zone.layer, codeWidth(code));
    if (style.codeTag) codes += `  <rect x="${box.x + 0.5}" y="${box.y + 0.5}" width="${box.width - 1}" height="${box.height - 1}" fill="rgba(255, 255, 255, 0.92)" stroke="${rgba(color, 0.95)}" stroke-width="1"/>\n`;
    codes += `  <text x="${box.x + box.pad}" y="${box.y + box.pad}" dominant-baseline="hanging" font-size="11" font-weight="600" fill="${rgba(color, 0.95)}" font-family="sans-serif">${escapeXml(code)}</text>\n`;
  }
  return { defs: patterns.size ? `  <defs>\n${[...patterns.values()].join('')}  </defs>\n` : '', areas, codes };
}
