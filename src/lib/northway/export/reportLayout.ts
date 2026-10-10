/**
 * Northway report export: page layout. Pure geometry (no canvas), so it is unit-tested.
 *
 * The page is A4, in millimetres. Header (logo, title, address, floor, survey date) on top, a
 * one-line footer at the bottom, and between them the plan and the legend. Two arrangements are
 * tried on both orientations, legend beside the plan or legend below it, and the one that draws the
 * plan largest wins. The plan keeps its aspect ratio and is centred in its box; the legend never
 * overlaps it. Long legends use smaller text, more columns, or, as a last resort, a taller page.
 */
import type { OverlayLayer } from '$lib/models/types';
import type { LegendEntry } from '../legend';
import type { Bounds } from '$lib/utils/printLayout';

export type Measure = (text: string, sizeMm: number, bold?: boolean) => number;

/**
 * Paper formats. 'a4' is a full A4 page (PDF, printing). 'word' is sized to drop into a Word report
 * at text width (17 cm) without scaling, so legend text stays at about 8.5 pt in the document.
 */
export type Paper = 'a4' | 'word';
export const PAPERS: Record<Paper, { sizes: [number, number][]; margin: number; header: number }> = {
  a4: { sizes: [[297, 210], [210, 297]], margin: 12, header: 25 },
  // Word: always 17 cm wide; the height follows the plan (from a short landscape figure up to a full page).
  word: { sizes: [110, 125, 140, 160, 180, 205, 230].map(height => [170, height] as [number, number]), margin: 4, header: 21 },
};
export const PAGE = { footer: 9, gap: 6, scaleBar: 9 };
const MAX_FONT = 3.0, MIN_FONT = 2.3, FONT_STEP = 0.1;
const SWATCH = 7, SWATCH_GAP = 2.2, COLUMN_GAP = 6;

export interface LegendSection { layer: OverlayLayer; title: string; entries: LegendEntry[]; emptyText: string }

export interface LegendRow {
  kind: 'heading' | 'entry' | 'empty';
  column: number;
  y: number;
  height: number;
  section: LegendSection;
  entry?: LegendEntry;
  /** Wrapped text lines (entry description, or the heading/empty text). */
  lines: string[];
}

export interface LegendLayout {
  font: number;
  columns: number;
  columnWidth: number;
  height: number;
  /** Column offsets inside each row: swatch, reference, code, text. */
  refX: number;
  codeX: number;
  textX: number;
  rows: LegendRow[];
  fits: boolean;
}

export interface Box { x: number; y: number; width: number; height: number }

export interface ReportLayout {
  paper: Paper;
  orientation: 'landscape' | 'portrait';
  pageWidth: number;
  pageHeight: number;
  header: Box;
  /** Area the plan is centred in (excludes the scale bar strip). */
  plan: Box;
  scaleBar: Box;
  legend: Box;
  legendPosition: 'side' | 'bottom';
  legendLayout: LegendLayout;
  footer: Box;
  /** Plan scale in mm of paper per cm of building, and the world point at the plan box centre. */
  mmPerCm: number;
  center: { x: number; y: number };
}

/** Greedy word wrap; a word longer than the width is broken by characters. */
export function wrapText(text: string, width: number, size: number, measure: Measure): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, size) <= width) { line = candidate; continue; }
      if (line) lines.push(line);
      if (measure(word, size) <= width) { line = word; continue; }
      let chunk = '';
      for (const char of word) {
        if (measure(chunk + char, size) > width && chunk) { lines.push(chunk); chunk = char; } else chunk += char;
      }
      line = chunk;
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}

type BlockRow = Omit<LegendRow, 'column' | 'y'> & { gapBefore?: number };
interface Block { rows: BlockRow[]; height: number }

function legendBlocks(sections: LegendSection[], font: number, columnWidth: number, measure: Measure) {
  const lineHeight = font * 1.38, entryGap = font * 0.5, headingHeight = font * 1.15 * 1.3 + font * 0.7, sectionGap = font * 1.4;
  const refWidth = Math.max(measure('F00', font, true), ...sections.flatMap(s => s.entries.map(e => measure(e.ref, font, true)))) + 1.8;
  const codeWidth = sections.some(s => s.entries.some(e => e.kind === 'area' && e.code))
    ? Math.max(...sections.flatMap(s => s.entries.filter(e => e.kind === 'area' && e.code).map(e => measure(e.code!, font, true)))) + 1.8 : 0;
  const refX = SWATCH + SWATCH_GAP, codeX = refX + refWidth, textX = codeX + codeWidth;
  const textWidth = Math.max(10, columnWidth - textX);
  // Each block is kept together in one column: a section heading with its first entry, then one block per entry.
  const blocks: Block[] = [];
  sections.forEach((section, index) => {
    const heading = { kind: 'heading' as const, height: headingHeight, gapBefore: index ? sectionGap : 0, section, lines: [section.title] };
    const items = section.entries.length
      ? section.entries.map(entry => {
          const lines = wrapText(entry.text, textWidth, font, measure);
          return { kind: 'entry' as const, height: lines.length * lineHeight + entryGap, section, entry, lines };
        })
      : [{ kind: 'empty' as const, height: lineHeight + entryGap, section, lines: wrapText(section.emptyText, columnWidth, font, measure) }];
    blocks.push({ rows: [heading, items[0]], height: heading.gapBefore + heading.height + items[0].height });
    for (const item of items.slice(1)) blocks.push({ rows: [item], height: item.height });
  });
  return { blocks, refX, codeX, textX };
}

function flow(blocks: Block[], columns: number, maxHeight: number): { rows: LegendRow[]; height: number; fits: boolean } {
  const rows: LegendRow[] = [];
  let column = 0, y = 0, height = 0, fits = true;
  for (const block of blocks) {
    if (y > 0 && y + block.height > maxHeight) { column++; y = 0; }
    if (column >= columns) { fits = false; column = columns - 1; }
    for (const { gapBefore = 0, ...row } of block.rows) {
      if (y > 0) y += gapBefore; // a new column never starts with the gap that separates sections
      rows.push({ ...row, column, y });
      y += row.height;
    }
    height = Math.max(height, y);
    if (y > maxHeight) fits = false;
  }
  return { rows, height, fits };
}

/** Lay out the legend in `columns` columns, within maxHeight or (maxHeight = Infinity) balanced as short as possible. */
export function layoutLegend(sections: LegendSection[], columnWidth: number, columns: number, font: number, maxHeight: number, measure: Measure): LegendLayout {
  const { blocks, refX, codeX, textX } = legendBlocks(sections, font, columnWidth, measure);
  let result = flow(blocks, columns, maxHeight);
  if (!Number.isFinite(maxHeight) || columns > 1) {
    // Balance: the shortest height at which the blocks still fit in the columns.
    const total = blocks.reduce((sum, b) => sum + b.height, 0), tallest = Math.max(0, ...blocks.map(b => b.height));
    let low = Math.max(tallest, total / columns), high = Math.min(total, Number.isFinite(maxHeight) ? maxHeight : total);
    if (high >= low) {
      for (let i = 0; i < 24; i++) {
        const mid = (low + high) / 2;
        if (flow(blocks, columns, mid).fits) high = mid; else low = mid;
      }
      const balanced = flow(blocks, columns, high + 0.01);
      if (balanced.fits) result = balanced;
    }
  }
  return { font, columns, columnWidth, height: result.height, refX, codeX, textX, rows: result.rows, fits: result.fits && result.height <= maxHeight + 0.01 };
}

function fitPlan(box: Box, bounds: Bounds) {
  const width = Math.max(1, bounds.maxX - bounds.minX), height = Math.max(1, bounds.maxY - bounds.minY);
  return { mmPerCm: Math.min(box.width / width, box.height / height), center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 } };
}

/** Bounds padded so markers, labels and borders at the edge stay inside the plan box. */
export function paddedBounds(bounds: Bounds): Bounds {
  const pad = Math.max(40, 0.04 * Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY));
  return { minX: bounds.minX - pad, minY: bounds.minY - pad, maxX: bounds.maxX + pad, maxY: bounds.maxY + pad };
}

/** Choose orientation and legend position for a plan and its legend. */
export function calculateReportLayout(bounds: Bounds, sections: LegendSection[], measure: Measure, paper: Paper = 'a4'): ReportLayout {
  const padded = paddedBounds(bounds), spec = PAPERS[paper], margin = spec.margin;
  const candidates: (ReportLayout & { score: number })[] = [];
  for (const [pageWidth, pageHeight] of spec.sizes) {
    const orientation = pageHeight > pageWidth ? 'portrait' as const : 'landscape' as const;
    const header = { x: margin, y: margin, width: pageWidth - 2 * margin, height: spec.header };
    const footer = { x: margin, y: pageHeight - margin - PAGE.footer, width: pageWidth - 2 * margin, height: PAGE.footer };
    const body = { x: margin, y: header.y + header.height + 4, width: pageWidth - 2 * margin, height: footer.y - 3 - (header.y + header.height + 4) };

    // Legend beside the plan.
    const sideWidth = Math.min(88, Math.max(paper === 'word' ? 58 : 64, pageWidth * 0.3));
    for (let font = MAX_FONT; font >= MIN_FONT - 1e-9; font -= FONT_STEP) {
      const legendLayout = layoutLegend(sections, sideWidth, 1, font, body.height, measure);
      if (!legendLayout.fits) continue;
      const planOuter = { x: body.x, y: body.y, width: body.width - sideWidth - PAGE.gap, height: body.height };
      const plan = { ...planOuter, height: planOuter.height - PAGE.scaleBar };
      const fit = fitPlan(plan, padded);
      candidates.push({ paper, orientation, pageWidth, pageHeight, header, footer, plan, scaleBar: { x: plan.x, y: plan.y + plan.height, width: plan.width, height: PAGE.scaleBar },
        legend: { x: body.x + body.width - sideWidth, y: body.y, width: sideWidth, height: legendLayout.height }, legendPosition: 'side', legendLayout, ...fit, score: fit.mmPerCm * 1.04 });
      break;
    }

    // Legend below the plan.
    const columns = pageWidth > 250 ? 3 : 2, columnWidth = (body.width - (columns - 1) * COLUMN_GAP) / columns;
    for (let font = MAX_FONT; font >= MIN_FONT - 1e-9; font -= FONT_STEP) {
      const legendLayout = layoutLegend(sections, columnWidth, columns, font, Infinity, measure);
      const planHeight = body.height - legendLayout.height - PAGE.gap - PAGE.scaleBar;
      if (planHeight < body.height * 0.45 && font > MIN_FONT + 1e-9) continue;
      const plan = { x: body.x, y: body.y, width: body.width, height: Math.max(planHeight, body.height * 0.45) };
      // Too long for the page even at the smallest text: the page grows rather than overlapping.
      const extra = Math.max(0, plan.height + PAGE.scaleBar + PAGE.gap + legendLayout.height - body.height);
      const height = pageHeight + extra;
      const fit = fitPlan(plan, padded);
      const scaleBar = { x: plan.x, y: plan.y + plan.height, width: plan.width, height: PAGE.scaleBar };
      candidates.push({ paper, orientation, pageWidth, pageHeight: height, header, footer: { ...footer, y: footer.y + extra }, plan, scaleBar,
        legend: { x: body.x, y: scaleBar.y + scaleBar.height + PAGE.gap, width: body.width, height: legendLayout.height }, legendPosition: 'bottom', legendLayout, ...fit, score: fit.mmPerCm - extra });
      break;
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (paper === 'word') {
    // In a Word report a shorter figure sits on the page with its text: take the shortest one that
    // still draws the plan within 10% of the largest possible scale.
    const best = candidates[0].score;
    candidates.sort((a, b) => a.pageHeight - b.pageHeight || b.score - a.score);
    const chosen = candidates.find(c => c.score >= best * 0.9)!;
    candidates.splice(0, candidates.length, chosen);
  }
  const { score: _score, ...best } = candidates[0];
  return best;
}

/** A round scale-bar length (cm) that is 20–45 mm long on paper. */
export function scaleBarLength(mmPerCm: number): number {
  const options = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  return options.find(cm => cm * mmPerCm >= 20) ?? options[options.length - 1];
}
