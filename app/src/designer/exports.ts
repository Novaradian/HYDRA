// Sheet exports: SVG, PNG, vector PDF (jsPDF + svg2pdf.js), DXF R12, parts list CSV / XLSX (ExcelJS), print.
import { jsPDF } from 'jspdf';
import { svg2pdf } from 'svg2pdf.js';
import * as ExcelNS from 'exceljs';
import * as S from '../store';
import { download, slug } from '../util';
import { sheetSvg, type Fmt } from './render';
import { paperOf, worldOf, viewOf, isInfinite, bom, bomGrouped, netlist, PAPER, r2, type Sheet } from './model';
import { bomDeep, netlist2 } from './asm';
import { isAsm } from './geom';
const rowsOf = (sh: Sheet, fmt: Fmt) => sh.components.some(c => isAsm(c.ref)) ? bomDeep(sh, S.project.value, fmt) : bom(sh, fmt);
// infinite canvas → paper: ask which sheet, then fit the drawing on it (10 mm margin, caption line)
async function paperFor(sh: Sheet): Promise<[number, number] | null> {
  if (!isInfinite(sh)) return paperOf(sh);
  const [, , w, h] = viewOf(sh); const land = w >= h; const sizes = ['A4', 'A3', 'A2', 'A1', 'A0'];
  const fits = sizes.find(k => { const [a, b] = PAPER[k]; const [pw, ph] = land ? [a, b] : [b, a]; return w <= pw - 20 && h <= ph - 26; }) || 'A0';
  const r = await S.confirmDlg('Paper for the infinite canvas', `The drawing is ${Math.round(w)} × ${Math.round(h)} mm. Choose the paper — it is fitted with a 10 mm margin (1:1 if it fits: ${fits}).`, [...sizes.map(k => ({ label: k, value: k, primary: k === fits })), { label: 'Cancel', value: '' }]);
  if (!r) return null; const [a, b] = PAPER[r]; return land ? [a, b] : [b, a];
}
function fitted(sh: Sheet, c: Ctx, pw: number, ph: number, extra: any = {}) {
  if (!isInfinite(sh)) return sheetSvg(sh, { ...c, ...extra });
  const [vx, vy, w, h] = viewOf(sh); const k = Math.min((pw - 20) / w, (ph - 26) / h); const sc = k >= 1 ? 1 : k;
  const inner = sheetSvg(sh, { ...c, ...extra }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const ox = (pw - w * sc) / 2, oy = 10 + (ph - 26 - h * sc) / 2; const font = extra.pdf ? 'helvetica' : 'IBM Plex Sans, Arial, sans-serif';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}mm" height="${ph}mm" viewBox="0 0 ${pw} ${ph}"><rect width="${pw}" height="${ph}" fill="#fff"/><g transform="translate(${r2(ox)} ${r2(oy)}) scale(${r2(sc * 1000) / 1000}) translate(${-vx} ${-vy})">${inner}</g><text x="10" y="${ph - 6}" font-size="3" fill="#3A4757" font-family="${font}">${(c.project || '').replace(/[<&]/g, '')} · ${sh.name.replace(/[<&]/g, '')} · ${sc >= 1 ? '1:1' : 'scale ' + (sc < 1 ? '1:' + r2(1 / sc) : '1:1')} · HYDRA</text></svg>`;
}

export type Ctx = { sheetNo: number; sheets: number; project?: string; units?: string; fmt: Fmt };
const fname = (sh: Sheet, ext: string) => `${slug(S.project.value?.manifest.name || 'hydra')}_${slug(sh.name)}.${ext}`;
function fontCss() { // the app's embedded IBM Plex / JetBrains Mono faces, so exported SVG and PNG look like the screen
  try { return [...document.styleSheets].flatMap(ss => { try { return [...ss.cssRules]; } catch { return []; } }).filter(r => r.constructor.name === 'CSSFontFaceRule').map(r => r.cssText).join('\n'); } catch { return ''; }
}
export function exportSvg(sh: Sheet, c: Ctx, embedFonts = true) { download(fname(sh, 'svg'), sheetSvg(sh, { ...c, fontCss: embedFonts ? fontCss() : '' }), 'image/svg+xml'); S.toast('SVG exported', 'ok'); }

export async function exportPng(sh: Sheet, c: Ctx, dpi = 200) {
  const [pw, ph] = isInfinite(sh) ? viewOf(sh).slice(2) : paperOf(sh); const w = Math.round(pw / 25.4 * dpi), h = Math.round(ph / 25.4 * dpi);
  const svg = sheetSvg(sh, { ...c, fontCss: fontCss() }).replace(/width="[^"]*mm" height="[^"]*mm"/, `width="${w}" height="${h}"`);
  const img = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Could not render the sheet image')); img.src = url; });
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
  const blob: Blob = await new Promise(res => cv.toBlob(b => res(b!), 'image/png'));
  download(fname(sh, 'png'), blob); S.toast(`PNG exported (${dpi} dpi, ${w} × ${h} px)`, 'ok');
}

function mountSvg(svgText: string) {
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-30000px;top:0;width:10px;height:10px;overflow:hidden;visibility:hidden;pointer-events:none';
  host.innerHTML = svgText; document.body.appendChild(host); return { host, svg: host.querySelector('svg') as SVGSVGElement };
}
export async function pdfBlob(sh: Sheet, c: Ctx, paper?: [number, number]): Promise<Blob | null> {
  const pp = paper || await paperFor(sh); if (!pp) return null; const [pw, ph] = pp;
  const doc = new (jsPDF as any)({ orientation: pw >= ph ? 'landscape' : 'portrait', unit: 'mm', format: [pw, ph], compress: true });
  doc.setProperties({ title: sh.name, subject: 'Circuit diagram (ISO 1219-2)', creator: 'HYDRA ' + S.APP_VERSION, author: sh.title?.drawnBy || '' });
  const { host, svg } = mountSvg(fitted(sh, c, pw, ph, { pdf: true }));
  try { await svg2pdf(svg, doc, { x: 0, y: 0, width: pw, height: ph }); } finally { host.remove(); }
  return doc.output('blob');
}
export async function exportPdf(sh: Sheet, c: Ctx) { const b = await pdfBlob(sh, c); if (!b) return; download(fname(sh, 'pdf'), b, 'application/pdf'); S.toast('Vector PDF exported', 'ok'); }

// straight-segment paths (M L H V Z, absolute or relative) → exact polylines; null when the path has curves
function linearPath(d: string): { pts: number[][]; closed: boolean }[] | null {
  if (/[ACQSTacqst]/.test(d)) return null;
  const tok = d.match(/[MLHVZmlhvz]|-?\d*\.?\d+(?:e-?\d+)?/g) || []; const subs: { pts: number[][]; closed: boolean }[] = []; let cur: { pts: number[][]; closed: boolean } | null = null; let x = 0, y = 0, sx = 0, sy = 0, cmd = ''; let i = 0;
  const num = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
    switch (cmd) {
      case 'M': case 'm': { const nx = num(), ny = num(); x = cmd === 'm' ? x + nx : nx; y = cmd === 'm' ? y + ny : ny; sx = x; sy = y; cur = { pts: [[x, y]], closed: false }; subs.push(cur); cmd = cmd === 'm' ? 'l' : 'L'; break; }
      case 'L': case 'l': { const nx = num(), ny = num(); x = cmd === 'l' ? x + nx : nx; y = cmd === 'l' ? y + ny : ny; cur?.pts.push([x, y]); break; }
      case 'H': case 'h': { const nx = num(); x = cmd === 'h' ? x + nx : nx; cur?.pts.push([x, y]); break; }
      case 'V': case 'v': { const ny = num(); y = cmd === 'v' ? y + ny : ny; cur?.pts.push([x, y]); break; }
      case 'Z': case 'z': { if (cur) cur.closed = true; x = sx; y = sy; cmd = ''; break; }
      default: return null;
    }
  }
  return subs;
}
// R12 text is ANSI: map the symbols HYDRA uses to DXF control codes or ASCII, anything else to \U+XXXX
const DXF_MAP: Record<string, string> = { 'Ø': '%%c', 'ø': '%%c', '°': '%%d', '±': '%%p', '·': '-', '³': '3', '²': '2', 'µ': 'u', '×': 'x', '—': '-', '–': '-', '…': '...', 'φ': 'phi', '₀': '0', '→': '->', '“': '"', '”': '"', '’': "'" };
const dxfStr = (s: string) => s.replace(/[^\x20-\x7E]/g, ch => DXF_MAP[ch] ?? ('\\U+' + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')));
// ---------- DXF (AutoCAD R12 ASCII), mm, every visible stroke flattened to LINE / CIRCLE / TEXT / SOLID ----------
export function dxfText(sh: Sheet, c: Ctx) {
  const inf = isInfinite(sh); const [vx, vy, W0, H0] = viewOf(sh); const W = inf ? vx + W0 : worldOf(sh)[0], H = inf ? vy + H0 : worldOf(sh)[1]; const s = inf ? 1 : sh.scale || 1;
  const { host, svg } = mountSvg(sheetSvg(sh, { ...c, pdf: true }));
  const out: string[] = []; const P = (code: number, v: any) => out.push(String(code), String(v));
  const f = (n: number) => (Math.round(n / s * 1000) / 1000).toString();
  const root = svg.getScreenCTM()!.inverse();
  const layerOf = (el: Element) => (el.closest('[data-layer]') as HTMLElement)?.dataset.layer || '0';
  const ltOf = (el: Element) => { const d = el.getAttribute('stroke-dasharray'); if (!d) return 'CONTINUOUS'; const n = d.trim().split(/[\s,]+/).length; return n >= 4 ? 'DASHDOT' : parseFloat(d) < 1.5 ? 'HIDDEN' : 'DASHED'; };
  const ents: string[][] = [];
  const pt = (m: DOMMatrix, x: number, y: number) => { const q = new DOMPoint(x, y).matrixTransform(m); return [q.x, H - q.y]; };
  const line = (el: Element, a: number[], b: number[]) => { if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4) return; const o: any[] = []; o.push(0, 'LINE', 8, layerOf(el), 6, ltOf(el), 10, f(a[0]), 20, f(a[1]), 30, 0, 11, f(b[0]), 21, f(b[1]), 31, 0); ents.push(o); };
  const poly = (el: Element, pts: number[][], closed: boolean) => { for (let i = 0; i < pts.length - 1; i++) line(el, pts[i], pts[i + 1]); if (closed && pts.length > 2) line(el, pts[pts.length - 1], pts[0]); };
  const filled = (el: Element) => { const fl = el.getAttribute('fill'); return !!fl && fl !== 'none' && fl !== '#fff' && fl !== '#ffffff' && fl !== 'white'; };
  const solid = (el: Element, pts: number[][]) => { if (pts.length < 3 || pts.length > 4) return; const q = pts.length === 3 ? [pts[0], pts[1], pts[2], pts[2]] : [pts[0], pts[1], pts[3], pts[2]]; const o: any[] = [0, 'SOLID', 8, layerOf(el)]; q.forEach((p, i) => o.push(10 + i, f(p[0]), 20 + i, f(p[1]), 30 + i, 0)); ents.push(o); };
  try {
    svg.querySelectorAll('line,polyline,polygon,rect,circle,path,text').forEach(el => {
      if (el.closest('[display=none]')) return; const g = el as SVGGraphicsElement; const m = root.multiply(g.getScreenCTM()!);
      const A = (n: string) => parseFloat(el.getAttribute(n) || '0');
      switch (el.tagName) {
        case 'line': line(el, pt(m, A('x1'), A('y1')), pt(m, A('x2'), A('y2'))); break;
        case 'polyline': case 'polygon': { const pts = (el.getAttribute('points') || '').trim().split(/\s+/).map(p => p.split(',').map(Number)).map(p => pt(m, p[0], p[1])); poly(el, pts, el.tagName === 'polygon'); if (el.tagName === 'polygon' && filled(el)) solid(el, pts); break; }
        case 'rect': { if (el.getAttribute('fill') === '#fff' && !el.getAttribute('stroke')) break; const x = A('x'), y = A('y'), w = A('width'), h = A('height'); const pts = [pt(m, x, y), pt(m, x + w, y), pt(m, x + w, y + h), pt(m, x, y + h)]; if (!el.getAttribute('stroke') || el.getAttribute('stroke') === 'none') { if (filled(el)) solid(el, pts); break; } poly(el, pts, true); break; }
        case 'circle': { const c0 = pt(m, A('cx'), A('cy')); const sc = Math.hypot(m.a, m.b); const r = A('r') * sc; ents.push([0, 'CIRCLE', 8, layerOf(el), 6, ltOf(el), 10, f(c0[0]), 20, f(c0[1]), 30, 0, 40, f(r)] as any); if (filled(el) && r < 2) { ents.push([0, 'CIRCLE', 8, layerOf(el), 10, f(c0[0]), 20, f(c0[1]), 30, 0, 40, f(r / 2)] as any); } break; }
        case 'path': {
          const d = el.getAttribute('d') || '';
          const lin = linearPath(d);
          if (lin) { lin.forEach(sp => { const pts = sp.pts.map(q => pt(m, q[0], q[1])); poly(el, pts, sp.closed); if (sp.closed && filled(el)) solid(el, pts); }); break; }
          (/m/.test(d) ? [d] : d.split(/(?=M)/).filter(x => x.trim())).forEach(sd => {
            const pe = document.createElementNS('http://www.w3.org/2000/svg', 'path'); pe.setAttribute('d', sd); el.parentNode!.appendChild(pe);
            try { const L = pe.getTotalLength(); const n = Math.max(12, Math.min(160, Math.ceil(L / 0.6))); const pts: number[][] = []; for (let i = 0; i <= n; i++) { const q = pe.getPointAtLength(L * i / n); pts.push(pt(m, q.x, q.y)); } poly(el, pts, false); } finally { pe.remove(); }
          });
          break;
        }
        case 'text': { const tx = (el.textContent || '').trim(); if (!tx) break; const p0 = pt(m, A('x'), A('y')); const sc = Math.hypot(m.a, m.b); const hgt = A('font-size') * sc * 0.72; const an = el.getAttribute('text-anchor'); const rot = Math.atan2(-m.b, m.a) * 180 / Math.PI;
          const o: any[] = [0, 'TEXT', 8, layerOf(el), 10, f(p0[0]), 20, f(p0[1]), 30, 0, 40, f(hgt), 1, dxfStr(tx.replace(/[\r\n]/g, ' '))]; if (Math.abs(rot) > 0.01) o.push(50, Math.round(rot * 1000) / 1000); if (an === 'middle' || an === 'end') o.push(72, an === 'middle' ? 1 : 2, 11, f(p0[0]), 21, f(p0[1]), 31, 0); ents.push(o); break; }
      }
    });
  } finally { host.remove(); }
  const layers = ['0', 'FRAME', 'ENCLOSURE', 'WORK', 'PILOT', 'DRAIN', 'JUNCTION', 'PARTS', 'TAGS', 'TEXT'];
  const colors: Record<string, number> = { FRAME: 8, ENCLOSURE: 3, WORK: 7, PILOT: 5, DRAIN: 4, JUNCTION: 7, PARTS: 7, TAGS: 5, TEXT: 7, '0': 7 };
  P(0, 'SECTION'); P(2, 'HEADER'); P(9, '$ACADVER'); P(1, 'AC1009'); P(9, '$DWGCODEPAGE'); P(3, 'ANSI_1252'); P(9, '$INSBASE'); P(10, 0); P(20, 0); P(30, 0);
  P(9, '$EXTMIN'); P(10, f(inf ? vx : 0)); P(20, f(inf ? H - (vy + H0) : 0)); P(30, 0); P(9, '$EXTMAX'); P(10, f(W)); P(20, f(inf ? H - vy : H)); P(30, 0);
  P(9, '$LIMMIN'); P(10, f(inf ? vx : 0)); P(20, f(inf ? H - (vy + H0) : 0)); P(9, '$LIMMAX'); P(10, f(W)); P(20, f(inf ? H - vy : H)); P(9, '$LTSCALE'); P(40, 1); P(0, 'ENDSEC');
  P(0, 'SECTION'); P(2, 'TABLES');
  P(0, 'TABLE'); P(2, 'LTYPE'); P(70, 4);
  const lt = (name: string, desc: string, pat: number[]) => { P(0, 'LTYPE'); P(2, name); P(70, 0); P(3, desc); P(72, 65); P(73, pat.length); P(40, pat.reduce((a, b) => a + Math.abs(b), 0)); pat.forEach(x => P(49, x)); };
  lt('CONTINUOUS', 'Solid line', []); lt('DASHED', 'Pilot line __ __ __', [2.4, -1.2]); lt('HIDDEN', 'Drain line _ _ _', [1, -0.9]); lt('DASHDOT', 'Enclosure (chain) __ . __', [7, -1.5, 0, -1.5]);
  P(0, 'ENDTAB');
  P(0, 'TABLE'); P(2, 'LAYER'); P(70, layers.length);
  layers.forEach(l => { P(0, 'LAYER'); P(2, l); P(70, 0); P(62, colors[l] || 7); P(6, l === 'PILOT' ? 'DASHED' : l === 'DRAIN' ? 'HIDDEN' : l === 'ENCLOSURE' ? 'DASHDOT' : 'CONTINUOUS'); });
  P(0, 'ENDTAB'); P(0, 'TABLE'); P(2, 'STYLE'); P(70, 1); P(0, 'STYLE'); P(2, 'STANDARD'); P(70, 0); P(40, 0); P(41, 1); P(50, 0); P(71, 0); P(42, 2.5); P(3, 'txt'); P(4, ''); P(0, 'ENDTAB');
  P(0, 'ENDSEC'); P(0, 'SECTION'); P(2, 'ENTITIES');
  ents.forEach(e => { for (let i = 0; i < e.length; i += 2) P(e[i] as any, e[i + 1]); });
  P(0, 'ENDSEC'); P(0, 'EOF');
  return { text: out.join('\r\n') + '\r\n', count: ents.length };
}
export function exportDxf(sh: Sheet, c: Ctx) { const r = dxfText(sh, c); download(fname(sh, 'dxf'), r.text, 'application/dxf'); S.toast(`DXF exported (R12, mm, ${r.count} entities)`, 'ok'); }

// ---------- parts list ----------
const csvCell = (v: any) => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function exportBomCsv(sh: Sheet, c: Ctx) {
  const rows = rowsOf(sh, c.fmt); const head = ['Item', 'Tag', 'Description', 'Standard', 'Group', 'Values on this instance', 'Notes', 'Qty', 'Library ref'];
  const body = rows.map(r => [r.item, r.tag, r.name, r.standard, r.group, r.values, r.desc, r.qty, r.ref].map(csvCell).join(','));
  download(fname(sh, 'bom.csv'), '﻿' + [head.join(','), ...body].join('\r\n'), 'text/csv'); S.toast('Parts list exported (CSV)', 'ok');
}
export async function exportBomXlsx(sh: Sheet, c: Ctx) {
  const E: any = (ExcelNS as any).Workbook ? ExcelNS : (ExcelNS as any).default;
  const wb = new E.Workbook(); wb.creator = 'HYDRA ' + S.APP_VERSION; wb.created = new Date();
  const rows = rowsOf(sh, c.fmt);
  const sheetOf = (name: string, cols: [string, string, number][], data: any[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.columns = cols.map(([h, k, w]) => ({ key: k, width: w }));
    ws.getCell('A1').value = `${S.project.value?.manifest.name || ''} — ${sh.name}`; ws.getCell('A1').font = { bold: true, size: 13 };
    ws.getCell('A2').value = `Parts list · ${sh.type} circuit · ISO 1219-2 identification · exported ${new Date().toLocaleString()}`; ws.getCell('A2').font = { color: { argb: 'FF5B6878' }, size: 9 };
    const hr = ws.getRow(4); cols.forEach(([h], i) => { const cell = hr.getCell(i + 1); cell.value = h; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF26313E' } }; cell.alignment = { vertical: 'middle' }; });
    data.forEach(d => { const r = ws.addRow(cols.map(([, k]) => d[k])); r.eachCell((cell: any) => { cell.border = { bottom: { style: 'hair', color: { argb: 'FFD5DEE7' } } }; }); });
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
    return ws;
  };
  sheetOf('Parts by tag', [['Item', 'item', 6], ['Tag', 'tag', 9], ['Description', 'name', 44], ['Standard', 'standard', 20], ['Group', 'group', 20], ['Values on this instance', 'values', 26], ['Notes', 'desc', 26], ['Qty', 'qty', 6], ['Library ref', 'ref', 24]], rows);
  sheetOf('Grouped', [['Item', 'item', 6], ['Qty', 'qty', 6], ['Description', 'name', 44], ['Values', 'values', 26], ['Tags', 'tag', 30], ['Standard', 'standard', 20], ['Library ref', 'ref', 24]], bomGrouped(rows));
  const nl = netlist(sh); const ws3 = wb.addWorksheet('Connections'); ws3.columns = [{ width: 8 }, { width: 14 }, { width: 70 }, { width: 14 }];
  ws3.addRow(['Net', 'Line type', 'Ports', 'Length (mm, drawing)']).font = { bold: true };
  nl.nets.forEach((n: any) => ws3.addRow([n.id, n.kind, n.ports.join(', '), n.length_mm]));
  const buf = await wb.xlsx.writeBuffer();
  download(fname(sh, 'bom.xlsx'), new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); S.toast('Parts list exported (Excel, 3 sheets)', 'ok');
}
// hydra.netlist/2: the whole machine (assemblies flattened, path tags); sheets without assemblies keep the v1 shape as "sheet"
export function exportNetlist(sh: Sheet, p?: any) { const nl = p ? { ...netlist2(sh, p), sheetNetlist: netlist(sh) } : netlist(sh); download(fname(sh, 'netlist.json'), JSON.stringify(nl, null, 2), 'application/json'); S.toast('Simulation netlist exported (JSON, hydra.netlist/2)', 'ok'); }

// ---------- print (exact paper size, vector) ----------
export async function printSheet(sh: Sheet, c: Ctx) {
  const pp = await paperFor(sh); if (!pp) return; const [pw, ph] = pp; const svg = fitted(sh, c, pw, ph, {});
  const f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
  f.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${sh.name}</title><style>${fontCss()}@page{size:${pw}mm ${ph}mm;margin:0}html,body{margin:0;padding:0}svg{display:block;width:${pw}mm;height:${ph}mm}</style></head><body>${svg}</body></html>`;
  f.onload = () => { setTimeout(() => { try { f.contentWindow!.focus(); f.contentWindow!.print(); } catch (e) { S.notify('Print failed: ' + e, 'err'); } setTimeout(() => f.remove(), 60000); }, 250); };
  document.body.appendChild(f);
}
