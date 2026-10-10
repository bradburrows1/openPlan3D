/**
 * Northway report export: a purpose-built survey drawing for Word and PDF reports, rendered from
 * the project data (never a screenshot of the editor). One floor and one view per page:
 *
 *   Survey Findings Plan     plan + findings (areas, pins, lines) + findings legend
 *   Recommended Works Plan   plan + recommended works + recommended works legend
 *   Combined Plan            both layers and both legend sections
 *
 * The view chooses the layers for this export only; the editor's Show/Hide settings are untouched.
 * PNGs are 300 dpi on a white background, tagged with that resolution. The default "Word report"
 * size is 17 cm wide, so Word places it at text width without shrinking the text; "A4 page" is a
 * full sheet. PDFs are always A4.
 */
import jsPDF from 'jspdf';
import type { Floor, OverlayLayer, Project } from '$lib/models/types';
import type { ProjectSettings } from '$lib/stores/settings';
import type { CanvasState } from '$lib/utils/canvasInteraction';
import { printBounds } from '$lib/utils/printLayout';
import { drawPlanContent } from '$lib/utils/scaledPrint';
import { buildLegend, type LegendEntry } from '../legend';
import { MARKUP_STYLES } from '../markupRenderer';
import { surveyPlanView, type LayerSelection } from '../planView';
import { formatSurveyDate } from '../surveyMeta';
import { LAYER_STYLES, rgba } from '../zonePresets';
import { calculateReportLayout, scaleBarLength, type LegendSection, type Measure, type Paper, type ReportLayout } from './reportLayout';

export type ReportView = 'survey-findings' | 'recommended-works' | 'combined';

export const REPORT_VIEWS: readonly { id: ReportView; label: string; title: string; file: string }[] = [
  { id: 'survey-findings', label: 'Survey Findings Plan', title: 'SURVEY FINDINGS PLAN', file: 'Survey-Findings' },
  { id: 'recommended-works', label: 'Recommended Works Plan', title: 'RECOMMENDED WORKS PLAN', file: 'Recommended-Works' },
  { id: 'combined', label: 'Combined Plan', title: 'SURVEY FINDINGS AND RECOMMENDED WORKS PLAN', file: 'Combined-Plan' },
];

export const FOOTER_TEXT = 'Northway Preservation | Damp & Timber Specialists';
const BRAND = '#083335', INK = '#0f172a', MUTED = '#475569', RULE = '#cbd5e1';
const FONT = 'Helvetica, Arial, sans-serif';
/** Export resolution. */
export const REPORT_DPI = 300;
/** Plan drawing units per mm: sets the size of on-plan labels and markers (11 px code ≈ 2.5 mm). */
const PLAN_UNITS_PER_MM = 4.4;

export function viewLayers(view: ReportView): LayerSelection {
  return { 'survey-findings': view !== 'recommended-works', 'recommended-works': view !== 'survey-findings' };
}

export interface ReportDetails {
  projectName: string;
  propertyAddress?: string | null;
  floorName: string;
  surveyDate?: string;
}

const SECTION_TITLES: Record<OverlayLayer, string> = { 'survey-findings': 'SURVEY FINDINGS', 'recommended-works': 'RECOMMENDED WORKS' };
const EMPTY_TEXT: Record<OverlayLayer, string> = { 'survey-findings': 'No findings recorded on this floor.', 'recommended-works': 'No recommended works recorded on this floor.' };

export function legendSections(floor: Floor, view: ReportView): LegendSection[] {
  const layers = viewLayers(view), legend = buildLegend(floor, layers);
  return (['survey-findings', 'recommended-works'] as const).filter(layer => layers[layer])
    .map(layer => ({ layer, title: SECTION_TITLES[layer], entries: legend[layer], emptyText: EMPTY_TEXT[layer] }));
}

/** Safe file name: "14-Moor-Lane-Ground-Floor-Survey-Findings.png". Uses the address's first line, not the customer. */
export function reportFilename(details: ReportDetails, view: ReportView, extension: 'png' | 'pdf'): string {
  const slug = (value: string, max: number) => value.normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
  const place = slug(details.propertyAddress?.split(/[,\n]/)[0] ?? '', 60) || slug(details.projectName, 60) || 'Survey-Plan';
  const floor = slug(details.floorName, 40);
  return [place, floor, REPORT_VIEWS.find(v => v.id === view)!.file].filter(Boolean).join('-') + '.' + extension;
}

export interface PreparedReport {
  project: Project;
  floor: Floor;
  view: ReportView;
  details: ReportDetails;
  layout: ReportLayout;
  sections: LegendSection[];
}

const fontSpec = (size: number, bold = false) => `${bold ? '700' : '400'} ${size}px ${FONT}`;

export function canvasMeasure(ctx: CanvasRenderingContext2D): Measure {
  return (text, size, bold) => { ctx.font = fontSpec(size, bold); return ctx.measureText(text).width; };
}

/** Decide everything about the page before drawing it. Returns null when the floor is empty. */
export function prepareReport(project: Project, floorId: string, view: ReportView, details: ReportDetails, settings: ProjectSettings, measure: Measure, paper: Paper = 'a4'): PreparedReport | null {
  const visible = surveyPlanView(project, settings, viewLayers(view));
  const floor = visible.floors.find(f => f.id === floorId);
  const bounds = floor && printBounds(floor, visible.customEntourage);
  if (!floor || !bounds) return null;
  const sections = legendSections(floor, view);
  return { project: visible, floor, view, details, sections, layout: calculateReportLayout(bounds, sections, measure, paper) };
}

// ── Drawing (all in millimetres) ────────────────────────────────────

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string, options: { bold?: boolean; align?: CanvasTextAlign; maxWidth?: number; spacing?: number } = {}) {
  ctx.font = fontSpec(size, options.bold);
  ctx.fillStyle = color;
  ctx.textAlign = options.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  if (options.spacing && 'letterSpacing' in ctx) (ctx as any).letterSpacing = `${options.spacing}px`;
  let value2 = value;
  if (options.maxWidth) while (value2.length > 1 && ctx.measureText(value2).width > options.maxWidth) value2 = value2.slice(0, -2) + '…';
  ctx.fillText(value2, x, y);
  if (options.spacing && 'letterSpacing' in ctx) (ctx as any).letterSpacing = '0px';
}

function drawHeader(ctx: CanvasRenderingContext2D, report: PreparedReport, logo: HTMLImageElement | null) {
  const { header } = report.layout, { details } = report, compact = report.layout.paper === 'word';
  const logoHeight = compact ? 8 : 10, logoWidth = logo ? logoHeight * (logo.naturalWidth || 260) / (logo.naturalHeight || 40) : 0;
  if (logo) ctx.drawImage(logo, header.x, header.y + 1, logoWidth, logoHeight);
  else text(ctx, 'Northway Preservation', header.x, header.y + 8, 5, BRAND, { bold: true });
  const right = header.x + header.width, maxWidth = header.width - Math.max(logoWidth, 50) - 6;
  const title = REPORT_VIEWS.find(v => v.id === report.view)!.title;
  // Long titles (the Combined plan on a portrait page) get smaller before they are shortened.
  let titleSize = compact ? 4 : 4.6;
  ctx.font = fontSpec(titleSize, true);
  while (titleSize > 3 && ctx.measureText(title).width + title.length * 0.35 > maxWidth) { titleSize -= 0.1; ctx.font = fontSpec(titleSize, true); }
  text(ctx, title, right, header.y + (compact ? 4.8 : 5.5), titleSize, BRAND, { bold: true, align: 'right', maxWidth, spacing: titleSize * 0.075 });
  const address = details.propertyAddress?.replace(/\s*\n\s*/g, ', ').trim() || details.projectName;
  text(ctx, address, right, header.y + (compact ? 10.6 : 12.5), compact ? 3.3 : 3.6, INK, { align: 'right', maxWidth });
  const line = [details.floorName, details.surveyDate ? `Survey date: ${formatSurveyDate(details.surveyDate)}` : ''].filter(Boolean).join('   ·   ');
  text(ctx, line, right, header.y + (compact ? 15.8 : 18.5), compact ? 2.9 : 3.1, MUTED, { align: 'right', maxWidth });
  ctx.strokeStyle = BRAND;
  ctx.lineWidth = 0.45;
  ctx.beginPath(); ctx.moveTo(header.x, header.y + header.height); ctx.lineTo(right, header.y + header.height); ctx.stroke();
}

function drawFooter(ctx: CanvasRenderingContext2D, layout: ReportLayout) {
  const { footer } = layout;
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 0.25;
  ctx.beginPath(); ctx.moveTo(footer.x, footer.y + 1); ctx.lineTo(footer.x + footer.width, footer.y + 1); ctx.stroke();
  text(ctx, FOOTER_TEXT, footer.x, footer.y + 6, 2.7, MUTED);
}

function drawPlan(ctx: CanvasRenderingContext2D, report: PreparedReport, settings: ProjectSettings) {
  const { plan, mmPerCm, center } = report.layout;
  ctx.save();
  ctx.beginPath();
  ctx.rect(plan.x, plan.y, plan.width, plan.height);
  ctx.clip();
  ctx.translate(plan.x, plan.y);
  ctx.scale(1 / PLAN_UNITS_PER_MM, 1 / PLAN_UNITS_PER_MM);
  const cs: CanvasState = { ctx, width: plan.width * PLAN_UNITS_PER_MM, height: plan.height * PLAN_UNITS_PER_MM, zoom: mmPerCm * PLAN_UNITS_PER_MM, camX: center.x, camY: center.y };
  drawPlanContent(cs, report.floor, report.project, settings);
  ctx.restore();
}

function drawScaleBar(ctx: CanvasRenderingContext2D, layout: ReportLayout) {
  const cm = scaleBarLength(layout.mmPerCm), length = cm * layout.mmPerCm, x = layout.scaleBar.x + 1, y = layout.scaleBar.y + 3.5;
  ctx.lineWidth = 0.25;
  ctx.strokeStyle = INK;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? '#ffffff' : INK;
    ctx.fillRect(x + (length / 4) * i, y, length / 4, 1.3);
  }
  ctx.strokeRect(x, y, length, 1.3);
  const label = cm >= 100 ? `${cm / 100} m` : `${cm * 10} mm`;
  text(ctx, '0', x, y + 4.6, 2.4, MUTED, { align: 'center' });
  text(ctx, label, x + length, y + 4.6, 2.4, MUTED, { align: 'center' });
  text(ctx, 'Approximate scale', x + length + 6, y + 1.4, 2.4, MUTED);
}

function hexagon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    if (i) ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); else ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  ctx.closePath();
}

/** The legend swatch: the same visual language as the plan (solid findings, dashed/hatched/outlined recommendations). */
export function drawLegendSwatch(ctx: CanvasRenderingContext2D, entry: Pick<LegendEntry, 'kind' | 'layer' | 'color'>, x: number, y: number, size: number) {
  const w = size * 2.3, h = size * 1.45, color = entry.color;
  ctx.save();
  ctx.setLineDash([]);
  if (entry.kind === 'area') {
    const style = LAYER_STYLES[entry.layer];
    ctx.fillStyle = rgba(color, Math.max(style.fillOpacity, 0.06));
    ctx.fillRect(x, y, w, h);
    if (style.hatch) {
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.strokeStyle = rgba(color, style.hatch.opacity + 0.1); ctx.lineWidth = 0.18;
      ctx.beginPath();
      for (let t = -h; t < w; t += 1.1) { ctx.moveTo(x + t, y + h); ctx.lineTo(x + t + h, y); }
      ctx.stroke(); ctx.restore();
    }
    ctx.strokeStyle = rgba(color, style.borderOpacity);
    ctx.lineWidth = style.dash.length ? 0.4 : 0.35;
    ctx.setLineDash(style.dash.length ? [0.9, 0.55] : []);
    ctx.strokeRect(x, y, w, h);
  } else if (entry.kind === 'line') {
    const style = MARKUP_STYLES[entry.layer], cy = y + h / 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(color, style.bandOpacity); ctx.lineWidth = h * 0.55;
    ctx.beginPath(); ctx.moveTo(x + 0.6, cy); ctx.lineTo(x + w - 0.6, cy); ctx.stroke();
    ctx.lineCap = style.coreDash.length ? 'butt' : 'round';
    ctx.setLineDash(style.coreDash.length ? [1.1, 0.7] : []);
    ctx.strokeStyle = rgba(color, 0.95); ctx.lineWidth = 0.4;
    ctx.beginPath(); ctx.moveTo(x + 0.6, cy); ctx.lineTo(x + w - 0.6, cy); ctx.stroke();
  } else {
    const style = MARKUP_STYLES[entry.layer], r = h * 0.48, cx = x + w / 2, cy = y + h / 2;
    if (style.marker === 'circle') { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); } else hexagon(ctx, cx, cy, r * 1.05);
    ctx.fillStyle = style.filled ? rgba(color, 0.95) : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 0.35;
    ctx.strokeStyle = style.filled ? rgba('#000000', 0.25) : rgba(color, 0.95);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLegend(ctx: CanvasRenderingContext2D, layout: ReportLayout) {
  const { legend, legendLayout: l, legendPosition } = layout;
  if (legendPosition === 'side') {
    ctx.strokeStyle = RULE; ctx.lineWidth = 0.25;
    ctx.beginPath(); ctx.moveTo(legend.x - 3, legend.y); ctx.lineTo(legend.x - 3, layout.plan.y + layout.plan.height + layout.scaleBar.height); ctx.stroke();
  }
  const gap = legendPosition === 'side' ? 0 : (legend.width - l.columns * l.columnWidth) / Math.max(1, l.columns - 1);
  const lineHeight = l.font * 1.38;
  for (const row of l.rows) {
    const x = legend.x + row.column * (l.columnWidth + gap), y = legend.y + row.y;
    if (row.kind === 'heading') {
      text(ctx, row.lines[0], x, y + l.font * 1.15, l.font * 1.08, BRAND, { bold: true, spacing: 0.25 });
      ctx.strokeStyle = RULE; ctx.lineWidth = 0.2;
      ctx.beginPath(); ctx.moveTo(x, y + l.font * 1.65); ctx.lineTo(x + l.columnWidth, y + l.font * 1.65); ctx.stroke();
    } else if (row.kind === 'empty') {
      text(ctx, row.lines[0], x, y + l.font, l.font, MUTED);
    } else if (row.entry) {
      const baseline = y + l.font;
      drawLegendSwatch(ctx, row.entry, x, baseline - l.font * 0.95, l.font);
      text(ctx, row.entry.ref, x + l.refX, baseline, l.font, INK, { bold: true });
      if (row.entry.kind === 'area' && row.entry.code) text(ctx, row.entry.code, x + l.codeX, baseline, l.font, row.entry.color, { bold: true });
      row.lines.forEach((line, i) => text(ctx, line, x + l.textX, baseline + i * lineHeight, l.font, INK));
    }
  }
}

/** Draw the whole page onto a canvas at `pxPerMm` (≈11.8 for 300 dpi; smaller for previews). */
export function renderReport(canvas: HTMLCanvasElement, report: PreparedReport, settings: ProjectSettings, logo: HTMLImageElement | null, pxPerMm: number) {
  const { layout } = report;
  canvas.width = Math.round(layout.pageWidth * pxPerMm);
  canvas.height = Math.round(layout.pageHeight * pxPerMm);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(canvas.width / layout.pageWidth, canvas.height / layout.pageHeight);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, layout.pageWidth, layout.pageHeight);
  drawHeader(ctx, report, logo);
  drawPlan(ctx, report, settings);
  drawScaleBar(ctx, layout);
  drawLegend(ctx, layout);
  drawFooter(ctx, layout);
}

// ── Output ───────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Add a pHYs chunk so Word, PDF tools and image viewers know the PNG's real resolution. */
export function pngWithDpi(png: Uint8Array, dpi: number): Uint8Array {
  const IHDR_END = 8 + 25; // signature + IHDR chunk (length, type, 13 data bytes, crc)
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21), view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  view.setUint32(8, ppm); view.setUint32(12, ppm); chunk[16] = 1; // unit: metre
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, IHDR_END)); out.set(chunk, IHDR_END); out.set(png.subarray(IHDR_END), IHDR_END + chunk.length);
  return out;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The image could not be created.')), 'image/png'));
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Render at 300 dpi and download as PNG or PDF. Returns the file name. */
export async function exportReport(report: PreparedReport, settings: ProjectSettings, logo: HTMLImageElement | null, format: 'png' | 'pdf'): Promise<string> {
  // The PDF is always a full A4 page; a PNG uses the paper the report was prepared for.
  const canvas = document.createElement('canvas');
  renderReport(canvas, report, settings, logo, REPORT_DPI / 25.4);
  const filename = reportFilename(report.details, report.view, format);
  const png = pngWithDpi(new Uint8Array(await (await canvasBlob(canvas)).arrayBuffer()), REPORT_DPI);
  if (format === 'png') {
    download(new Blob([png as BlobPart], { type: 'image/png' }), filename);
  } else {
    const { pageWidth, pageHeight } = report.layout;
    const pdf = new jsPDF({ orientation: pageWidth > pageHeight ? 'landscape' : 'portrait', unit: 'mm', format: [pageWidth, pageHeight], compress: true });
    pdf.setProperties({ title: filename.replace(/\.pdf$/, ''), creator: 'Northway Plans' });
    pdf.addImage(png, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
    download(pdf.output('blob'), filename);
  }
  canvas.width = canvas.height = 0;
  return filename;
}
