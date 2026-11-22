// SVG string builders shared by the canvas (static layers) and every export (SVG, PNG, PDF, DXF, print).
import { geomOf, xfAttr, xfBB, xfPoint, INK, isConn, type Geom } from './geom';
import { frameSvg, livePts, ptsD, LINE, ENCL_DASH, worldOf, viewOf, isInfinite, keyValues, r2, type Sheet, type Comp } from './model';
import { overlaySvg, isElec } from './elec';
import * as S from '../store';

const escX = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export type Fmt = (q: string, v: number) => string;
export const FONTS = { ui: 'IBM Plex Sans, Arial, sans-serif', mono: 'JetBrains Mono, Consolas, monospace' };
const PDF_FONTS = { ui: 'helvetica', mono: 'courier' };

// tag label beside a part (ISO 1219-2 identification code + the key value of the instance)
export function labelPos(c: Comp, g: Geom) {
  if (g.kind === 'conn') { const [x, y] = xfPoint(c, 10.5, 1.1); return { x, y, anchor: 'middle' }; }
  const b = xfBB(c, g.bb); const pos = c.labelPos || (g.kind === 'asm' && g.asm?.expanded ? 'top' : 'right');
  if (pos === 'left') return { x: b[0] - 2.5, y: b[1] + 3.5, anchor: 'end' };
  if (pos === 'top') return g.kind === 'asm' ? { x: b[0] + 1, y: b[1] - 2, anchor: 'start' } : { x: (b[0] + b[2]) / 2, y: b[1] - 6.5, anchor: 'middle' };
  if (pos === 'bottom') return { x: (b[0] + b[2]) / 2, y: b[3] + 4.5, anchor: 'middle' };
  return { x: b[2] + 2.5, y: b[1] + 3.5, anchor: 'start' };
}
export function labelSvg(c: Comp, g: Geom, fmt: Fmt, color = INK, fonts = FONTS) {
  if (c.labelPos === 'hidden') return '';
  const p = labelPos(c, g);
  if (g.kind === 'conn') return `<text x="${r2(p.x)}" y="${r2(p.y)}" font-size="3" font-weight="700" text-anchor="middle" fill="${color}" font-family="${fonts.ui}">${escX(c.tag)}</text>`;
  const kv = keyValues(c, g, fmt);
  return `<text x="${r2(p.x)}" y="${r2(p.y)}" font-size="3.4" font-weight="700" text-anchor="${p.anchor}" fill="${color}" font-family="${fonts.ui}">${escX(c.tag)}</text>` +
    (kv ? `<text x="${r2(p.x)}" y="${r2(p.y + 3.6)}" font-size="2.5" text-anchor="${p.anchor}" fill="${color === INK ? '#3A4757' : color}" font-family="${fonts.mono}">${escX(kv)}</text>` : '');
}
export const pipeAttrs = (kind: string, ink = INK) => { const L = LINE[kind] || LINE.work; return `fill="none" stroke="${ink}" stroke-width="${L.w}" stroke-linejoin="miter" stroke-linecap="butt"${L.dash ? ` stroke-dasharray="${L.dash}"` : ''}`; };
export function junctionDegree(sh: Sheet) { const m = new Map<string, number>(); sh.pipes.forEach(p => [p.a, p.b].forEach(e => { if (e && 'j' in e) m.set(e.j, (m.get(e.j) || 0) + 1); })); return m; }
const pdfFonts = (s: string) => s.replace(/IBM Plex Sans, Arial, sans-serif/g, 'helvetica').replace(/JetBrains Mono, Consolas, monospace/g, 'courier');

// the drawing itself (no frame): enclosures, lines, junctions, parts, tags, texts — as DXF / PDF layers
export function sheetBody(sh: Sheet, o: { fmt: Fmt; pdf?: boolean; layers?: boolean }) {
  const fonts = o.pdf ? PDF_FONTS : FONTS; const L = (name: string, body: string) => o.layers === false ? body : `<g data-layer="${name}">${body}</g>`;
  let b = '';
  b += L('ENCLOSURE', sh.enclosures.map(e => `<rect x="${r2(e.x)}" y="${r2(e.y)}" width="${r2(e.w)}" height="${r2(e.h)}" fill="none" stroke="${INK}" stroke-width="0.35" stroke-dasharray="${ENCL_DASH}"/>` + (e.label ? `<text x="${r2(e.x + 2)}" y="${r2(e.y + 5)}" font-size="3" fill="${INK}" font-family="${fonts.ui}">${escX(e.label)}</text>` : '')).join(''));
  (isElec(sh) ? ['wire', 'power', 'pe'] : ['work', 'pilot', 'drain']).forEach(k => { b += L(k.toUpperCase(), sh.pipes.filter(p => p.kind === k).map(p => `<path d="${ptsD(livePts(sh, p))}" ${pipeAttrs(k)}/>`).join('')); });
  const deg = junctionDegree(sh);
  b += L('JUNCTION', sh.junctions.filter(j => (deg.get(j.id) || 0) >= 3).map(j => `<circle cx="${r2(j.x)}" cy="${r2(j.y)}" r="1" fill="${INK}"/>`).join(''));
  b += L('PARTS', sh.components.map(c => { let inner = geomOf(c.ref).inner; if (o.pdf) inner = pdfFonts(inner); return `<g transform="${xfAttr(c)}">${inner}</g>`; }).join(''));
  b += L('TAGS', sh.components.map(c => labelSvg(c, geomOf(c.ref), o.fmt, INK, fonts)).join(''));
  if (isElec(sh)) b += L('XREF', o.pdf ? pdfFonts(overlaySvg(sh, S.project.value)) : overlaySvg(sh, S.project.value));
  b += L('TEXT', sh.texts.map(t => `<text x="${r2(t.x)}" y="${r2(t.y)}" font-size="${t.h}" fill="${INK}" font-family="${fonts.ui}">${escX(t.s)}</text>`).join(''));
  return b;
}

// full drawing; mode 'pdf' switches to the PDF standard fonts so jsPDF can embed text.
// Sheet mode: the paper with ISO 5457 frame. Infinite canvas: the drawing with a margin, no frame.
export function sheetSvg(sh: Sheet, o: { sheetNo: number; sheets: number; project?: string; units?: string; fmt: Fmt; pdf?: boolean; fontCss?: string; frame?: boolean }) {
  const inf = isInfinite(sh); const s = inf ? 1 : sh.scale || 1;
  const [vx, vy, W, H] = inf ? viewOf(sh) : [0, 0, ...worldOf(sh)];
  const fonts = o.pdf ? PDF_FONTS : FONTS;
  let b = '';
  if (o.frame !== false && !inf) b += `<g data-layer="FRAME">${frameSvg(sh, { sheetNo: o.sheetNo, sheets: o.sheets, project: o.project, units: o.units, fontUi: fonts.ui, fontMono: fonts.mono }).svg}</g>`;
  else b += `<rect x="${vx}" y="${vy}" width="${W}" height="${H}" fill="#fff"/>`;
  b += sheetBody(sh, { fmt: o.fmt, pdf: o.pdf });
  const style = o.fontCss ? `<style>${o.fontCss}</style>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(W / s)}mm" height="${r2(H / s)}mm" viewBox="${vx} ${vy} ${r2(W)} ${r2(H)}"><title>${escX(sh.name)}</title>${style}${b}</svg>`;
}
// small preview (Home tab sheet cards): the drawing only, fitted
export function thumbSvg(sh: Sheet, fmt: Fmt) {
  const [vx, vy, W, H] = viewOf({ ...sh, mode: 'infinite' } as Sheet, 6);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${W} ${H}" preserveAspectRatio="xMidYMid meet">${sheetBody(sh, { fmt, layers: false })}</svg>`;
}
export { isConn };
