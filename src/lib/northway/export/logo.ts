import { base } from '$app/paths';

/**
 * The approved Northway logo, supplied by Northway Preservation (static/northway-logo.svg). It is
 * drawn as-is on exports, never redrawn. To change it, replace that file (keep the name; an SVG with
 * width/height attributes, or a PNG at least 1200 px wide renamed in LOGO_PATH).
 */
export const LOGO_PATH = '/northway-logo.svg';

let pending: Promise<HTMLImageElement | null> | null = null;

/** Load once; resolves null (and the export shows the company name in plain text) if the file is missing. */
export function loadNorthwayLogo(): Promise<HTMLImageElement | null> {
  pending ??= new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => { pending = null; resolve(null); };
    image.src = `${base}${LOGO_PATH}`;
  });
  return pending;
}
