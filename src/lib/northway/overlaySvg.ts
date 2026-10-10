/**
 * Northway: SVG markup for both overlay layers, matching overlayRenderer's canvas drawing
 * (one SVG unit = 1 cm, as in the SVG export). Recommendations use a hatch pattern per colour.
 */
import type { OverlayLine, OverlayPin, OverlayZone } from '$lib/models/types';
import { MARKUP_STYLES, lineMidpoint } from './markupRenderer';
import { zoneCodeBox, zoneLabel } from './overlayRenderer';
import { LAYER_STYLES, rgba, zoneAppearance } from './zonePresets';
import { itemColor, itemInk } from './priorities';

const escapeXml = (value: string) => value.replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]!);
/** Width of the 11px semibold code in the SVG, estimated (no text measuring outside a canvas). */
const codeWidth = (code: string) => code.length * 7.2;

/** `defs` (hatch patterns), `areas` (drawn above room fills, below walls) and `codes` (drawn last). */
export function overlaySvg(zones: readonly OverlayZone[], offsetX: number, offsetY: number): { defs: string; areas: string; codes: string } {
  const patterns = new Map<string, string>();
  let areas = '', codes = '';
  const ordered = [...zones.filter(zone => zone.layer !== 'recommended-works'), ...zones.filter(zone => zone.layer === 'recommended-works')];
  for (const zone of ordered) {
    const { code, color } = zoneAppearance(zone), style = LAYER_STYLES[zone.layer], label = zoneLabel(zone);
    const ink = zone.layer === 'recommended-works' ? itemInk(zone) : color;
    const x = zone.x - offsetX, y = zone.y - offsetY;
    const attr = zone.layer === 'recommended-works' ? 'data-recommended-work' : 'data-survey-finding';
    const dash = style.dash.length ? ` stroke-dasharray="${style.dash.join(' ')}"` : '';
    areas += `  <rect ${attr}="${escapeXml(code)}" x="${x}" y="${y}" width="${zone.width}" height="${zone.height}" fill="${rgba(color, style.fillOpacity)}" stroke="none"/>\n`;
    if (style.hatch) {
      const id = `nw-hatch-${color.slice(1).toLowerCase()}`;
      if (!patterns.has(id)) patterns.set(id, `    <pattern id="${id}" patternUnits="userSpaceOnUse" width="${style.hatch.spacing}" height="${style.hatch.spacing}" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${style.hatch.spacing}" stroke="${rgba(color, style.hatch.opacity)}" stroke-width="${style.hatch.width}"/></pattern>\n`);
      areas += `  <rect x="${x}" y="${y}" width="${zone.width}" height="${zone.height}" fill="url(#${id})" stroke="none"/>\n`;
    }
    areas += `  <rect x="${x}" y="${y}" width="${zone.width}" height="${zone.height}" fill="none" stroke="${rgba(ink, style.borderOpacity)}" stroke-width="${style.borderWidth}"${dash}/>\n`;
    const box = zoneCodeBox({ x, y, width: zone.width, height: zone.height }, zone.layer, codeWidth(label));
    if (style.codeTag) codes += `  <rect x="${box.x + 0.5}" y="${box.y + 0.5}" width="${box.width - 1}" height="${box.height - 1}" fill="rgba(255, 255, 255, 0.92)" stroke="${rgba(ink, 0.95)}" stroke-width="1"/>\n`;
    codes += `  <text x="${box.x + box.pad}" y="${box.y + box.pad}" dominant-baseline="hanging" font-size="11" font-weight="700" fill="${rgba(ink, 0.95)}" font-family="sans-serif">${escapeXml(label)}</text>\n`;
  }
  return { defs: patterns.size ? `  <defs>\n${[...patterns.values()].join('')}  </defs>\n` : '', areas, codes };
}

/** SVG for free-text lines (`lines`, above walls) and reference markers for pins and lines (`markers`, on top). */
export function markupSvg(pins: readonly OverlayPin[], lines: readonly OverlayLine[], offsetX: number, offsetY: number): { lines: string; markers: string } {
  let bands = '', markers = '';
  const marker = (item: OverlayPin | OverlayLine, label: string, cx: number, cy: number, attr: string) => {
    const layer = item.layer, color = itemColor(item), ink = itemInk(item);
    const style = MARKUP_STYLES[layer], r = Math.max(10, codeWidth(label) * 0.95 / 2 + 4);
    const shape = style.marker === 'circle'
      ? `<circle cx="${cx}" cy="${cy}" r="${r}"`
      : `<polygon points="${Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + (i * Math.PI) / 3; return `${(cx + r * 1.08 * Math.cos(a)).toFixed(2)},${(cy + r * 1.08 * Math.sin(a)).toFixed(2)}`; }).join(' ')}"`;
    markers += `  <g ${attr}>${shape} fill="${style.filled ? rgba(color, 0.95) : '#ffffff'}" stroke="${style.filled ? 'rgba(0, 0, 0, 0.25)' : rgba(ink, 0.95)}" stroke-width="${style.filled ? 1 : 1.75}"/>`
      + `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="10" font-weight="700" fill="${style.filled ? '#ffffff' : ink}" font-family="sans-serif">${escapeXml(label)}</text></g>\n`;
  };
  for (const line of lines) {
    const style = MARKUP_STYLES[line.layer], points = line.points.map(p => `${p.x - offsetX},${p.y - offsetY}`).join(' ');
    const dash = style.coreDash.length ? ` stroke-dasharray="${style.coreDash.join(' ')}"` : '';
    const color = itemColor(line), ink = line.layer === 'recommended-works' ? itemInk(line) : color;
    bands += `  <polyline data-markup-line="${escapeXml(line.ref ?? '')}" points="${points}" fill="none" stroke="${rgba(color, style.bandOpacity)}" stroke-width="${style.bandWidth}" stroke-linecap="round" stroke-linejoin="round"/>\n`;
    bands += `  <polyline points="${points}" fill="none" stroke="${rgba(ink, 0.95)}" stroke-width="${style.coreWidth}" stroke-linejoin="round"${dash}/>\n`;
    const mid = lineMidpoint(line.points);
    marker(line, line.ref ?? '', mid.x - offsetX, mid.y - offsetY, `data-line-marker="${escapeXml(line.ref ?? '')}"`);
  }
  for (const pin of pins) marker(pin, pin.ref ?? '', pin.x - offsetX, pin.y - offsetY, `data-markup-pin="${escapeXml(pin.ref ?? '')}"`);
  return { lines: bands, markers };
}
