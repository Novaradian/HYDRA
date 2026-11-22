// Circuit sheet model: data shapes, sheet frame, ISO 1219-2 tags, orthogonal routing, connection graph (nets),
// rule check and parts list. Pure functions over a sheet object so they work on project data and on Immer drafts.
import Graph from 'graphology';
import { connectedComponents } from 'graphology-components';
import { geomOf, portWorld, xfBB, hasSolenoid, mediumOf, NEUTRAL, LETTER_NAME, INK, isConn, isAsm, splitRef, type Geom, type PortG } from './geom';
import { defaults } from './fields';
import { uid } from '../util';

export type End = { c: string; p: string } | { j: string } | null;
export type Comp = { id: string; ref: string; tag: string; x: number; y: number; rot: number; mirror?: boolean; values?: Record<string, any>; desc?: string; labelPos?: 'right' | 'left' | 'top' | 'bottom' | 'hidden'; circuit?: number };
export type Pipe = { id: string; kind: 'work' | 'pilot' | 'drain' | 'wire' | 'power' | 'pe'; a: End; b: End; pts: number[][]; size?: string; len?: number; wno?: string };
export type Junc = { id: string; x: number; y: number };
export type Txt = { id: string; x: number; y: number; s: string; h: number };
export type Encl = { id: string; x: number; y: number; w: number; h: number; label?: string };
export type TitleData = { company?: string; drawnBy?: string; checkedBy?: string; drawingNo?: string; rev?: string; date?: string };
export type Sheet = { id: string; type: string; name: string; size: string; orient?: 'landscape' | 'portrait'; scale?: number; grid?: number; circuitNo?: number; components: Comp[]; pipes: Pipe[]; junctions: Junc[]; texts: Txt[]; enclosures: Encl[]; title?: TitleData; connections?: any[]; sample?: string; designerVersion?: number; mode?: 'sheet' | 'infinite'; wireNos?: boolean };

export const PAPER: Record<string, [number, number]> = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };
// ISO 5457 field (zone) counts, landscape: columns × rows
export const ZONES: Record<string, [number, number]> = { A4: [6, 4], A3: [8, 6], A2: [12, 8], A1: [16, 12], A0: [24, 16] };
export const SCALES: [number, string][] = [[1, '1:1'], [1.5, '1:1.5'], [2, '1:2'], [3, '1:3'], [4, '1:4']];
export const scaleLabel = (s: number) => SCALES.find(x => x[0] === s)?.[1] || `1:${s}`;
export function paperOf(sh: Sheet): [number, number] { const [w, h] = PAPER[sh.size] || PAPER.A3; return sh.orient === 'portrait' ? [h, w] : [w, h]; }
export function worldOf(sh: Sheet): [number, number] { const s = sh.scale || 1; const [w, h] = paperOf(sh); return [w * s, h * s]; }
export const MARGIN = { left: 20, other: 10 };
export const isInfinite = (sh: Sheet) => sh.mode === 'infinite';
// bounding box of everything drawn on the sheet (null when empty)
export function contentBB(sh: Sheet): number[] | null {
  let b = [1e9, 1e9, -1e9, -1e9]; const add = (q: number[]) => { b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]; };
  sh.components.forEach(c => { const g = geomOf(c.ref); const q = xfBB(c, g.bb); add(q); if (c.labelPos !== 'hidden' && !isConn(c.ref)) add([q[2], q[1], q[2] + 4 + Math.min(40, (c.tag || '').length * 2.4), q[1] + 6]); });
  sh.pipes.forEach(p => livePts(sh, p).forEach(q => add([q[0], q[1], q[0], q[1]])));
  sh.junctions.forEach(j => add([j.x - 1, j.y - 1, j.x + 1, j.y + 1]));
  sh.texts.forEach(t => add([t.x, t.y - t.h, t.x + t.s.length * t.h * 0.56, t.y + t.h * 0.3]));
  sh.enclosures.forEach(e => add([e.x, e.y, e.x + e.w, e.y + e.h]));
  return b[0] <= b[2] ? b : null;
}
// world rectangle an export shows: the paper on a sheet, the drawing (plus margin) on an infinite canvas
export function viewOf(sh: Sheet, margin = 10): [number, number, number, number] {
  if (!isInfinite(sh)) { const [W, H] = worldOf(sh); return [0, 0, W, H]; }
  const b = contentBB(sh) || [0, 0, 100, 60]; return [r2(b[0] - margin), r2(b[1] - margin), r2(b[2] - b[0] + 2 * margin), r2(b[3] - b[1] + 2 * margin)];
}
// move every item of a sheet (used when an infinite canvas is put onto paper)
export function shiftSheet(c: Sheet, dx: number, dy: number) {
  c.components.forEach(x => { x.x = r2(x.x + dx); x.y = r2(x.y + dy); }); c.junctions.forEach(j => { j.x = r2(j.x + dx); j.y = r2(j.y + dy); });
  c.texts.forEach(t => { t.x = r2(t.x + dx); t.y = r2(t.y + dy); }); c.enclosures.forEach(e => { e.x = r2(e.x + dx); e.y = r2(e.y + dy); });
  c.pipes.forEach(p => { p.pts = p.pts.map(q => [r2(q[0] + dx), r2(q[1] + dy)]); });
}
// smallest landscape paper (and scale) whose drawing area takes the drawing, title block kept clear
export function fitPaper(sh: Sheet): { size: string; scale: number } {
  const b = contentBB(sh); if (!b) return { size: 'A3', scale: 1 }; const w = b[2] - b[0] + 20, h = b[3] - b[1] + 20;
  for (const sc of SCALES.map(x => x[0])) for (const size of Object.keys(PAPER)) { const [W, H] = PAPER[size]; const aw = (W - MARGIN.left - MARGIN.other) * sc, ah = (H - 2 * MARGIN.other - 38) * sc; if (w <= aw && h <= ah) return { size, scale: sc }; }
  return { size: 'A0', scale: 4 };
}
export function drawArea(sh: Sheet) { const s = sh.scale || 1; const [W, H] = worldOf(sh); return [MARGIN.left * s, MARGIN.other * s, W - MARGIN.other * s, H - MARGIN.other * s]; }
export const r2 = (n: number) => Math.round(n * 100) / 100;
const escX = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- normalise older sheets (parts-only samples, v0.3 projects) ----------
export function needsNormalise(c: any) { return !c.pipes || !c.junctions || !c.texts || !c.enclosures || (c.components || []).some((x: any) => x.x == null || !x.id); }
export function normalise(c: any) {
  c.components = c.components || []; c.pipes = c.pipes || []; c.junctions = c.junctions || []; c.texts = c.texts || []; c.enclosures = c.enclosures || [];
  c.size = c.size || 'A3'; c.scale = c.scale || 1; c.circuitNo = c.circuitNo || 1; c.designerVersion = 1;
  const [x0, y0] = drawArea(c); let col = 0, row = 0;
  const loose = c.components.filter((x: any) => x.x == null);
  c.components.forEach((x: any) => { if (!x.id) x.id = uid('c'); if (x.ref && !/^(std|lib):/.test(x.ref)) x.ref = 'std:' + x.ref; if (x.rot == null) x.rot = 0; });
  loose.forEach((x: any) => { x.x = x0 + 50 + col * 60; x.y = y0 + 45 + row * 60; x.rot = 0; col++; if (col > 5) { col = 0; row++; } });
  // tags from the sample builder ("h_pump_fixed-1") are replaced by ISO 1219-2 codes
  if (c.components.some((x: any) => !x.tag || /_/.test(x.tag))) { const taken = new Set<string>(); c.components.forEach((x: any) => { if (!x.tag || /_/.test(x.tag)) { const g = geomOf(x.ref); x.tag = nextTag(taken, c.circuitNo || 1, g.letter); } taken.add(x.tag); }); }
  c.components.forEach((x: any) => { if (!x.values) x.values = defaults(geomOf(x.ref)); });
}

// ---------- tags (ISO 1219-2 component code: circuit number + component letter + number, e.g. 1A1, 1V2) ----------
export const TAG_RE = /^(\d+)([A-Z])(\d+)$/;
export function nextTag(taken: Set<string> | string[], circuit: number, letter: string) {
  const set = taken instanceof Set ? taken : new Set(taken); let n = 1; while (set.has(`${circuit}${letter}${n}`)) n++; return `${circuit}${letter}${n}`;
}
export function allTags(project: any, exceptSheet?: string) { const out: string[] = []; Object.values(project?.circuits || {}).forEach((c: any) => { if (c.id === exceptSheet || c.type === 'electric') return; (c.components || []).forEach((x: any) => x.tag && !isConn(x.ref) && !isAsm(x.ref) && out.push(x.tag)); }); return out; }
// connectors (X1, X2 …) and assembly instances (U1, U2 …) are numbered per sheet, without a circuit number
export function nextLocalTag(sh: Sheet, letter: 'X' | 'U') { const t = new Set(sh.components.map(c => c.tag)); let n = 1; while (t.has(letter + n)) n++; return letter + n; }
export const isPlain = (c: Comp) => !isConn(c.ref) && !isAsm(c.ref);
// renumber in reading order per circuit and letter: left → right, then bottom → top (energy flow upwards)
export function renumber(c: Sheet) {
  const groups: Record<string, Comp[]> = {};
  c.components.filter(isPlain).forEach(x => { const g = geomOf(x.ref); const m = TAG_RE.exec(x.tag || ''); const cn = x.circuit || (m ? +m[1] : c.circuitNo || 1); (groups[cn + g.letter] ||= []).push(x); });
  Object.entries(groups).forEach(([k, list]) => { const cn = parseInt(k), letter = k.replace(/^\d+/, ''); list.sort((a, b) => (a.x - b.x) || (b.y - a.y)).forEach((x, i) => { x.tag = `${cn}${letter}${i + 1}`; }); });
}

// ---------- ports & pipe ends ----------
export type PortW = PortG & { c: string; wx: number; wy: number; wdir: number; tag: string };
export function compPorts(c: Comp, g?: Geom, medium?: string): PortW[] { const gg = g || geomOf(c.ref); return gg.ports.map(p => { const w = portWorld(c, p); return { ...p, domain: mediumOf(gg, p.domain, medium), c: c.id, wx: w.x, wy: w.y, wdir: w.dir, tag: c.tag }; }); }
export function endKey(e: End) { return !e ? '' : 'c' in e ? `c:${e.c}:${e.p}` : `j:${e.j}`; }
export function endPos(sh: Sheet, e: End, pos?: (id: string) => Comp | Junc | undefined): { x: number; y: number; dir?: number } | null {
  if (!e) return null;
  if ('j' in e) { const j = (pos?.(e.j) as Junc) || sh.junctions.find(x => x.id === e.j); return j ? { x: j.x, y: j.y } : null; }
  const c = (pos?.(e.c) as Comp) || sh.components.find(x => x.id === e.c); if (!c) return null;
  const g = geomOf(c.ref); const p = g.ports.find(q => q.key === e.p); if (!p) return null; const w = portWorld(c, p); return { x: w.x, y: w.y, dir: w.dir };
}
export function endLabel(sh: Sheet, e: End) {
  if (!e) return 'open end';
  if ('j' in e) { const i = sh.junctions.findIndex(x => x.id === e.j); return `junction J${i + 1}`; }
  const c = sh.components.find(x => x.id === e.c); if (!c) return '?'; const p = geomOf(c.ref).ports.find(q => q.key === e.p); return `${c.tag}.${p?.name ?? e.p}`;
}

// ---------- orthogonal routing ----------
const same = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
export function simplify(pts: number[][]) {
  const out: number[][] = [];
  pts.forEach(p => { if (!out.length || !same(out[out.length - 1], p)) out.push([r2(p[0]), r2(p[1])]); });
  for (let i = 1; i < out.length - 1;) { const a = out[i - 1], b = out[i], c = out[i + 1]; const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); if (Math.abs(cross) < 1e-6) out.splice(i, 1); else i++; }
  return out;
}
// L-shaped elbow from a to b. vertFirst: leave a vertically
export function elbow(a: number[], b: number[], vertFirst: boolean, ortho = true): number[][] {
  if (!ortho || Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6) return [b];
  return vertFirst ? [[a[0], b[1]], b] : [[b[0], a[1]], b];
}
const isVert = (dir?: number) => dir === 90 || dir === 270;
// move one end of a polyline while keeping the neighbouring segment orthogonal
export function reattach(pts: number[][], atStart: boolean, np: number[], dir?: number) {
  let arr = (atStart ? pts : pts.slice().reverse()).map(p => p.slice());
  const old = arr[0];
  if (arr.length <= 2) {
    const o = arr[arr.length - 1]; arr[0] = np;
    if (Math.abs(np[0] - o[0]) > 1e-6 && Math.abs(np[1] - o[1]) > 1e-6) {
      const wasOrtho = Math.abs(old[0] - o[0]) < 1e-6 || Math.abs(old[1] - o[1]) < 1e-6;
      if (wasOrtho || dir != null) { const v = dir != null ? isVert(dir) : Math.abs(old[0] - o[0]) < 1e-6; arr = [np, v ? [np[0], o[1]] : [o[0], np[1]], o]; }
    }
  } else {
    const nb = arr[1]; const vert = Math.abs(old[0] - nb[0]) < 1e-6, hor = Math.abs(old[1] - nb[1]) < 1e-6;
    arr[0] = np; if (vert) nb[0] = np[0]; else if (hor) nb[1] = np[1];
  }
  return atStart ? arr : arr.reverse();
}
// live geometry of a pipe for given (possibly moved) part / junction positions
export function livePts(sh: Sheet, p: Pipe, pos?: (id: string) => Comp | Junc | undefined, delta?: { dx: number; dy: number; ids: Set<string> }) {
  let pts = p.pts.map(q => q.slice());
  if (delta && delta.ids.has(p.id)) pts = pts.map(q => [q[0] + delta.dx, q[1] + delta.dy]);
  const ea = endPos(sh, p.a, pos), eb = endPos(sh, p.b, pos);
  if (!pts.length) pts = [[ea?.x ?? 0, ea?.y ?? 0], [eb?.x ?? 0, eb?.y ?? 0]];
  const s = pts[0], e = pts[pts.length - 1];
  if (ea && eb && !same(s, [ea.x, ea.y]) && !same(e, [eb.x, eb.y]) && Math.abs((ea.x - s[0]) - (eb.x - e[0])) < 1e-6 && Math.abs((ea.y - s[1]) - (eb.y - e[1])) < 1e-6) {
    const dx = ea.x - s[0], dy = ea.y - s[1]; return pts.map(q => [q[0] + dx, q[1] + dy]);
  }
  if (ea && !same(s, [ea.x, ea.y])) pts = reattach(pts, true, [ea.x, ea.y], ea.dir);
  if (eb && !same(pts[pts.length - 1], [eb.x, eb.y])) pts = reattach(pts, false, [eb.x, eb.y], eb.dir);
  return pts;
}
export const ptsD = (pts: number[][]) => pts.length ? 'M' + pts.map(p => r2(p[0]) + ',' + r2(p[1])).join('L') : '';
export function segDist(px: number, py: number, a: number[], b: number[]) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; let t = L2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx, y = a[1] + t * dy; return { d: Math.hypot(px - x, py - y), x, y, t };
}
export const pipeLen = (pts: number[][]) => pts.reduce((s, p, i) => i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);

// ---------- line styles (ISO 1219-1: working line solid; pilot and drain lines dashed) ----------
export const LINE: Record<string, { w: number; dash: string; label: string }> = {
  work: { w: 0.5, dash: '', label: 'Working line' },
  pilot: { w: 0.35, dash: '2.4 1.2', label: 'Pilot line' },
  drain: { w: 0.35, dash: '1 0.9', label: 'Drain / leakage line' },
  // electric sheets (IEC 60617 / IEC 61082): control wiring thin, main circuit heavier, protective earth dash-dot
  wire: { w: 0.3, dash: '', label: 'Wire (control)' },
  power: { w: 0.55, dash: '', label: 'Power wire (main circuit)' },
  pe: { w: 0.3, dash: '3 0.8 0.6 0.8', label: 'Protective earth (PE)' }
};
export const ENCL_DASH = '7 1.5 1.2 1.5';

// ---------- connection graph & nets ----------
export type Net = { id: string; nodes: string[]; pipes: string[]; ports: { c: string; p: string }[] };
export function buildGraph(sh: Sheet) {
  const g = new (Graph as any)({ multi: true, type: 'undirected' });
  sh.components.forEach(c => compPorts(c, undefined, sh.type).forEach(p => { if (p.domain !== 'electrical') g.mergeNode(`c:${c.id}:${p.key}`, { kind: 'port', c: c.id, p: p.key, role: p.role, domain: p.domain }); }));
  sh.junctions.forEach(j => g.mergeNode('j:' + j.id, { kind: 'junction' }));
  sh.pipes.forEach(p => {
    const a = p.a ? endKey(p.a) : `f:${p.id}:a`, b = p.b ? endKey(p.b) : `f:${p.id}:b`;
    [a, b].forEach(k => { if (!g.hasNode(k)) g.addNode(k, { kind: k.startsWith('f:') ? 'free' : 'dangling' }); });
    g.addEdgeWithKey(p.id, a, b, { kind: p.kind });
  });
  return g;
}
export function netsOf(sh: Sheet): Net[] {
  const g = buildGraph(sh); const comps: string[][] = connectedComponents(g);
  return comps.filter(n => n.length > 1 || g.degree(n[0]) > 0).map((nodes, i) => {
    const pipes = new Set<string>(); nodes.forEach(n => g.forEachEdge(n, (e: string) => pipes.add(e)));
    return { id: 'N' + (i + 1), nodes, pipes: [...pipes], ports: nodes.filter(n => n.startsWith('c:')).map(n => { const [, c, ...p] = n.split(':'); return { c, p: p.join(':') }; }) };
  });
}
// simulation-ready netlist (the simulation reads this)
export function netlist(sh: Sheet) {
  const nets = netsOf(sh);
  return { schema: 'hydra.netlist/1', sheet: sh.id, name: sh.name, medium: sh.type, generated: new Date().toISOString(),
    components: sh.components.map(c => { const g = geomOf(c.ref); return { id: c.id, tag: c.tag, ref: c.ref, cls: g.cls, letter: g.letter, values: c.values || {}, valve: g.valve ? JSON.parse(JSON.stringify(g.valve)) : undefined, ports: g.ports.map(p => ({ key: p.key, name: p.name, role: p.role, domain: p.domain, net: nets.find(n => n.ports.some(q => q.c === c.id && q.p === p.key))?.id || null })) }; }),
    nets: nets.map(n => ({ id: n.id, kind: [...new Set(n.pipes.map(pid => sh.pipes.find(p => p.id === pid)?.kind))].join('+') || 'none', ports: n.ports.map(q => { const c = sh.components.find(x => x.id === q.c)!; return `${c.tag}.${geomOf(c.ref).ports.find(p => p.key === q.p)?.name ?? q.p}`; }), pipes: n.pipes, length_mm: Math.round(n.pipes.reduce((s, pid) => { const p = sh.pipes.find(x => x.id === pid); return s + (p ? pipeLen(p.pts) : 0); }, 0)) })) };
}

// ---------- rule check ----------
export type Issue = { level: 'ok' | 'info' | 'warn' | 'err'; text: string; ids?: string[] };
export function ruleCheck(sh: Sheet, project?: any): Issue[] {
  const out: Issue[] = []; const hyd = sh.type !== 'pneumatic';
  const G = new Map(sh.components.map(c => [c.id, geomOf(c.ref)]));
  const used = new Map<string, number>(); sh.pipes.forEach(p => [p.a, p.b].forEach(e => { if (e) used.set(endKey(e), (used.get(endKey(e)) || 0) + 1); }));
  // missing parts
  sh.components.forEach(c => { if (G.get(c.id)!.kind === 'missing') out.push({ level: 'err', text: isAsm(c.ref) ? `${c.tag}: ${G.get(c.id)!.name}` : `${c.tag}: library part not found (${c.ref}) — re-link or replace it`, ids: [c.id] }); });
  // domain on fluid sheets
  sh.components.forEach(c => { const g = G.get(c.id)!; if (g.domain === 'electrical') out.push({ level: 'warn', text: `${c.tag} is an electrical part — place it on an electric sheet`, ids: [c.id] }); else if (g.kind !== 'missing' && g.kind !== 'conn' && !(g.kind === 'std' && NEUTRAL.has(g.cls)) && g.domain !== (hyd ? 'hydraulic' : 'pneumatic')) out.push({ level: 'info', text: `${c.tag} is a ${g.domain} part on a ${hyd ? 'hydraulic' : 'pneumatic'} sheet`, ids: [c.id] }); });
  // open ports
  const open: string[] = [], exh: string[] = [], multi: string[] = [];
  sh.components.forEach(c => compPorts(c, G.get(c.id), sh.type).forEach(p => {
    if (p.domain === 'electrical') return; const k = `c:${c.id}:${p.key}`; const n = used.get(k) || 0;
    if (!n) { if (!hyd && (p.role === 'exhaust')) exh.push(`${c.tag}.${p.name}`); else open.push(c.id + '|' + `${c.tag}.${p.name}`); }
    if (n > 1) multi.push(c.id + '|' + `${c.tag}.${p.name}`);
  }));
  const freeEnds = sh.pipes.filter(p => !p.a || !p.b);
  const dangling = sh.pipes.filter(p => [p.a, p.b].some(e => e && ('c' in e ? !sh.components.some(x => x.id === e.c) : !sh.junctions.some(j => j.id === e.j))));
  if (open.length) out.push({ level: 'warn', text: `${open.length} open port${open.length > 1 ? 's' : ''}: ${open.slice(0, 8).map(x => x.split('|')[1]).join(', ')}${open.length > 8 ? '…' : ''}`, ids: [...new Set(open.map(x => x.split('|')[0]))] });
  if (freeEnds.length) out.push({ level: 'err', text: `${freeEnds.length} pipe${freeEnds.length > 1 ? 's' : ''} with an open end — connect it to a port or junction`, ids: freeEnds.map(p => p.id) });
  if (dangling.length) out.push({ level: 'err', text: `${dangling.length} pipe${dangling.length > 1 ? 's' : ''} attached to a deleted part`, ids: dangling.map(p => p.id) });
  if (!open.length && !freeEnds.length && !dangling.length && sh.components.length) out.push({ level: 'ok', text: 'All ports connected · no open pipe ends' });
  if (exh.length) out.push({ level: 'info', text: `Exhaust to atmosphere at ${exh.slice(0, 6).join(', ')}${exh.length > 6 ? '…' : ''} — add silencers if needed` });
  if (multi.length) out.push({ level: 'warn', text: `Two lines on one port at ${multi.map(x => x.split('|')[1]).join(', ')} — branch with a junction instead`, ids: [...new Set(multi.map(x => x.split('|')[0]))] });
  // line type on pilot and drain ports (ISO 1219-1: dashed lines)
  const wrongKind: string[] = [];
  sh.pipes.forEach(p => [p.a, p.b].forEach(e => { if (!e || !('c' in e)) return; const g = G.get(e.c); const port = g?.ports.find(q => q.key === e.p); if (!port) return;
    if ((port.role === 'pilot' && p.kind !== 'pilot') || (port.role === 'drain' && p.kind === 'work')) wrongKind.push(p.id + '|' + `${sh.components.find(c => c.id === e.c)!.tag}.${port.name}`); }));
  if (wrongKind.length) out.push({ level: 'info', text: `Pilot / drain port on a working line: ${wrongKind.map(x => x.split('|')[1]).join(', ')} — draw it as a pilot (P) or drain (D) line`, ids: wrongKind.map(x => x.split('|')[0]) });
  // junctions
  const jdeg = new Map<string, number>(); sh.pipes.forEach(p => [p.a, p.b].forEach(e => { if (e && 'j' in e) jdeg.set(e.j, (jdeg.get(e.j) || 0) + 1); }));
  const lone = sh.junctions.filter(j => (jdeg.get(j.id) || 0) < 2); if (lone.length) out.push({ level: 'warn', text: `${lone.length} junction${lone.length > 1 ? 's' : ''} with fewer than two lines`, ids: lone.map(j => j.id) });
  // domain mismatch across a net, and line kind on ports
  const nets = netsOf(sh);
  nets.forEach(n => {
    const doms = new Set(n.ports.map(q => { const gg = G.get(q.c); const pd = gg?.ports.find(p => p.key === q.p)?.domain; return gg && pd ? mediumOf(gg, pd, sh.type) : null; }).filter(Boolean));
    if (doms.size > 1) out.push({ level: 'err', text: `Net ${n.id} joins hydraulic and pneumatic ports`, ids: n.pipes });
  });
  // duplicate tags (sheet) and across project
  const plain = sh.components.filter(isPlain);
  const seen: Record<string, string[]> = {}; sh.components.forEach(c => (seen[c.tag] ||= []).push(c.id));
  const dups = Object.entries(seen).filter(([, v]) => v.length > 1);
  dups.forEach(([tg, v]) => out.push({ level: 'err', text: `Tag ${tg} is used ${v.length} times on this sheet`, ids: v }));
  const usedAsAsm = (id: string) => Object.values(project?.circuits || {}).some((c: any) => (c.components || []).some((x: any) => isAsm(x.ref) && splitRef(x.ref)[1] === id));
  const other = new Set(project && !usedAsAsm(sh.id) ? Object.values(project.circuits || {}).filter((c: any) => c.id !== sh.id && c.type !== 'electric' && !usedAsAsm(c.id)).flatMap((c: any) => (c.components || []).filter(isPlain).map((x: any) => x.tag)) : []); const cross = plain.filter(c => other.has(c.tag));
  if (cross.length) out.push({ level: 'warn', text: `Tag${cross.length > 1 ? 's' : ''} ${cross.map(c => c.tag).join(', ')} also used on another sheet`, ids: cross.map(c => c.id) });
  const badTag = plain.filter(c => !TAG_RE.test(c.tag || ''));
  if (badTag.length) out.push({ level: 'info', text: `${badTag.length} tag${badTag.length > 1 ? 's' : ''} not in ISO 1219-2 form (e.g. 1V2): ${badTag.slice(0, 6).map(c => c.tag || '—').join(', ')}`, ids: badTag.map(c => c.id) });
  if (!dups.length && plain.length) { const ts = plain.map(c => c.tag).sort(); out.push({ level: 'ok', text: `Tags unique (${ts[0]} … ${ts[ts.length - 1]})` }); }
  // energy source, tank and pressure protection
  const pumps = sh.components.filter(c => ['pump', 'pumpmotor'].includes(G.get(c.id)!.cls) && G.get(c.id)!.domain === (hyd ? 'hydraulic' : 'pneumatic'));
  const sources = sh.components.filter(c => ['source'].includes(G.get(c.id)!.cls));
  const tanks = sh.components.filter(c => G.get(c.id)!.cls === 'tank');
  const iface = sh.components.some(c => isConn(c.ref)), hasInst = sh.components.some(c => isAsm(c.ref));
  if (iface || hasInst) out.push({ level: 'info', text: iface ? 'Assembly sheet (has interface ports): supply, tank and relief checks run on the machine sheet that uses it' : 'Machine sheet: supply, tank and relief checks cover the parts drawn here; the simulation checks the whole machine' });
  if (sh.components.length && !iface && !hasInst) {
    if (!pumps.length && !sources.length) out.push({ level: 'warn', text: hyd ? 'No pump on this sheet — add a power unit or a pressure source' : 'No compressor or pressure source on this sheet' });
    if (hyd && !tanks.length && sh.components.some(c => G.get(c.id)!.domain === 'hydraulic')) out.push({ level: 'err', text: 'No tank on this hydraulic sheet' });
  }
  const netOf = (c: string, p: string) => nets.find(n => n.ports.some(q => q.c === c && q.p === p));
  if (hyd && !iface) pumps.forEach(pc => {
    const g = G.get(pc.id)!; if (g.item?.id === 'h_pump_pc' || g.item?.id === 'h_pump_var_ctrl') { out.push({ level: 'ok', text: `Pump ${pc.tag} is pressure-compensated` }); return; }
    const outPort = g.ports.find(p => p.role === 'supply' || p.key === 'P'); if (!outPort) return;
    const n = netOf(pc.id, outPort.key);
    const relief = n?.ports.find(q => { const gg = G.get(q.c); return gg && gg.cls === 'pressure' && /relief|safety|vent/.test(gg.item?.id || gg.name.toLowerCase()); });
    if (relief) out.push({ level: 'ok', text: `Pump ${pc.tag} protected by relief valve ${sh.components.find(x => x.id === relief.c)!.tag}` });
    else out.push({ level: 'warn', text: `Pump ${pc.tag} has no pressure-relief valve on its outlet line`, ids: [pc.id] });
  });
  if (hyd && tanks.length && !iface && !hasInst) {
    const bad: string[] = []; let any = false;
    sh.components.forEach(c => { const g = G.get(c.id)!; if (g.cls !== 'valve' && g.cls !== 'pressure') return; g.ports.filter(p => p.role === 'return').forEach(p => { const n = netOf(c.id, p.key); if (!n) return; any = true; if (!n.ports.some(q => G.get(q.c)?.cls === 'tank' || G.get(q.c)?.cls === 'filter' || G.get(q.c)?.cls === 'cooler')) bad.push(`${c.tag}.${p.name}`); }); });
    if (bad.length) out.push({ level: 'warn', text: `Return line${bad.length > 1 ? 's' : ''} ${bad.join(', ')} not led to a tank`, ids: [] });
    else if (any) out.push({ level: 'ok', text: 'Every return line ends at a tank' });
  }
  // solenoids are wired on the electric sheet
  const sol = sh.components.filter(c => hasSolenoid(G.get(c.id)!.valve));
  if (sol.length) { const untagged = sol.filter(c => ['a', 'b'].some(sd => (sd === 'a' ? G.get(c.id)!.valve.ops.left : G.get(c.id)!.valve.ops.right).some((o: any) => ['solenoid', 'proportional', 'servo'].includes(o.type)) && !String(c.values?.['y' + sd] || '').trim()));
    out.push({ level: 'info', text: untagged.length ? `${untagged.map(c => c.tag).join(', ')}: give the solenoids their tags (Values › Solenoid a / b tag) to link them to coils on an electric sheet` : `${sol.map(c => c.tag).join(', ')}: solenoids tagged — wired on an electric sheet` }); }
  // layout: outside the frame, overlapping parts
  const [x0, y0, x1, y1] = drawArea(sh);
  const outside = isInfinite(sh) ? [] : sh.components.filter(c => { const b = xfBB(c, G.get(c.id)!.bb); return b[0] < x0 || b[1] < y0 || b[2] > x1 || b[3] > y1; });
  if (outside.length) out.push({ level: 'warn', text: `${outside.map(c => c.tag).join(', ')} outside the drawing frame`, ids: outside.map(c => c.id) });
  const bbs = sh.components.map(c => ({ c, b: xfBB(c, G.get(c.id)!.bb) })); const ov: string[] = [];
  for (let i = 0; i < bbs.length; i++) for (let j = i + 1; j < bbs.length; j++) { const a = bbs[i].b, b = bbs[j].b; const ix = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), iy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); if (ix > 3 && iy > 3) ov.push(bbs[i].c.id, bbs[j].c.id); }
  if (ov.length) out.push({ level: 'warn', text: `Overlapping parts: ${[...new Set(ov)].map(id => sh.components.find(c => c.id === id)!.tag).join(', ')}`, ids: [...new Set(ov)] });
  if (!sh.components.length) out.push({ level: 'info', text: 'The sheet is empty — drag parts from the Parts panel' });
  const rank = { err: 0, warn: 1, info: 2, ok: 3 } as const; return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

// ---------- parts list (BOM) ----------
export function keyValues(c: Comp, g: Geom, fmt: (q: string, v: number) => string) {
  const v = c.values || {};
  if (g.domain === 'electrical') { const id = g.item?.id || ''; // electrical parts: the value that identifies them on the drawing
    if (id === 'e_terminal') return v.tno != null && v.tno !== '' ? ':' + v.tno : '';
    if (g.cls === 'plc') return v.sym || '';
    if (g.cls === 'coil') return [v.u, id.startsWith('e_coil_t') && typeof v.delay === 'number' ? fmt('time', v.delay) : ''].filter(Boolean).join(' · ');
    if (g.cls === 'motor') return typeof v.p === 'number' ? fmt('power', v.p) : '';
    if (/fuse|breaker|overload/.test(g.cls)) return typeof v.i === 'number' ? `${v.i} A${v.char ? ' ' + v.char : ''}` : '';
    if (g.cls === 'supply' || g.cls === 'lamp') return [g.cls === 'lamp' ? v.colour : '', v.u].filter(Boolean).join(' · ');
    if (g.cls === 'pushbutton' || g.cls === 'switch') return v.func || '';
    return ''; }
  switch (g.cls) {
    case 'cylinder': return v.bore != null ? `Ø${fmt('length', v.bore)}/${fmt('length', v.rod)} × ${fmt('length', v.stroke)}` : '';
    case 'pump': case 'pumpmotor': case 'motor': return v.vg != null ? `${fmt('displacement', v.vg)}` + (v.n ? ` · ${Math.round(v.n)} rpm` : '') : v.q != null ? fmt('flow', v.q) : '';
    case 'drive': return v.p != null ? `${fmt('power', v.p)} · ${Math.round(v.n)} rpm` : '';
    case 'pressure': case 'cartridge': case 'source': case 'frl': return v.set != null ? fmt('pressure', v.set) : v.p != null ? fmt('pressure', v.p) : '';
    case 'check': return v.crack != null ? fmt('pressure', v.crack) : '';
    case 'flow': return v.open != null ? `${Math.round(v.open)} %` : '';
    case 'accumulator': return v.vol != null ? `${fmt('volume', v.vol)} · p₀ ${fmt('pressure', v.pre)}` : '';
    case 'tank': case 'receiver': return v.vol != null ? fmt('volume', v.vol) : '';
    case 'gauge': return typeof v.range === 'number' ? `0–${fmt(g.item?.id === 'h_thermo' ? 'temperature' : /flow/.test(g.item?.id || '') ? 'flow' : 'pressure', v.range)}` : (v.range || '');
    case 'filter': return v.rating || '';
    case 'switch': case 'sensor': return typeof v.set === 'number' ? fmt(/temp/.test(g.item?.id || '') ? 'temperature' : 'pressure', v.set) : (v.set || '');
    case 'valve': return v.size || g.valve?.nominalSize || '';
    case 'assembly': return g.name;
    case 'connector': return '';
  }
  return '';
}
export type BomRow = { item: number; tag: string; name: string; standard: string; letter: string; group: string; values: string; ref: string; qty: number; desc: string };
export function bom(sh: Sheet, fmt: (q: string, v: number) => string): BomRow[] {
  const order = 'PMAVSZ';
  return sh.components.filter(c => !isConn(c.ref)).map(c => { const g = geomOf(c.ref); return { item: 0, tag: c.tag, name: g.name, standard: g.standard, letter: g.letter, group: LETTER_NAME[g.letter] || '', values: keyValues(c, g, fmt), ref: c.ref, qty: 1, desc: c.desc || '' }; })
    .sort((a, b) => (order.indexOf(a.letter) - order.indexOf(b.letter)) || a.tag.localeCompare(b.tag, undefined, { numeric: true })).map((r, i) => ({ ...r, item: i + 1 }));
}
export function bomGrouped(rows: BomRow[]) {
  const m = new Map<string, BomRow & { tags: string[] }>();
  rows.forEach(r => { const k = r.ref + '|' + r.values; const e = m.get(k); if (e) { e.qty++; e.tags.push(r.tag); } else m.set(k, { ...r, tags: [r.tag] }); });
  return [...m.values()].map((r, i) => ({ ...r, item: i + 1, tag: r.tags.join(', ') }));
}

// ---------- ISO 5457 frame + ISO 7200 title block ----------
export function frameSvg(sh: Sheet, ctx: { sheetNo: number; sheets: number; project?: string; units?: string; fontUi?: string; fontMono?: string }) {
  const s = sh.scale || 1; const [W, H] = worldOf(sh); const [x0, y0, x1, y1] = drawArea(sh);
  const ui = ctx.fontUi || 'IBM Plex Sans, Arial, sans-serif', mono = ctx.fontMono || 'JetBrains Mono, Consolas, monospace';
  const [zc, zr] = (() => { const z = ZONES[sh.size] || ZONES.A3; return sh.orient === 'portrait' ? [z[1], z[0]] : z; })();
  const thin = 0.25 * s, thick = 0.7 * s; let o = '';
  o += `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`;
  o += `<rect x="${x0}" y="${y0}" width="${r2(x1 - x0)}" height="${r2(y1 - y0)}" fill="none" stroke="${INK}" stroke-width="${thick}"/>`;
  // zone grid: columns numbered left→right, rows lettered top→bottom, in the margin strip
  const cw = (x1 - x0) / zc, rh = (y1 - y0) / zr, m = 5 * s, fs = 3.2 * s;
  for (let i = 0; i <= zc; i++) { const x = x0 + i * cw; o += `<line x1="${r2(x)}" y1="${y0 - m}" x2="${r2(x)}" y2="${y0}" stroke="${INK}" stroke-width="${thin}"/><line x1="${r2(x)}" y1="${y1}" x2="${r2(x)}" y2="${y1 + m}" stroke="${INK}" stroke-width="${thin}"/>`; if (i < zc) { const cx = r2(x + cw / 2); o += `<text x="${cx}" y="${r2(y0 - 1.3 * s)}" font-size="${fs}" text-anchor="middle" fill="${INK}" font-family="${mono}">${i + 1}</text><text x="${cx}" y="${r2(y1 + m - 1.3 * s)}" font-size="${fs}" text-anchor="middle" fill="${INK}" font-family="${mono}">${i + 1}</text>`; } }
  for (let i = 0; i <= zr; i++) { const y = y0 + i * rh; o += `<line x1="${x0 - m}" y1="${r2(y)}" x2="${x0}" y2="${r2(y)}" stroke="${INK}" stroke-width="${thin}"/><line x1="${x1}" y1="${r2(y)}" x2="${x1 + m}" y2="${r2(y)}" stroke="${INK}" stroke-width="${thin}"/>`; if (i < zr) { const cy = r2(y + rh / 2 + 1.1 * s); const L = String.fromCharCode(65 + i); o += `<text x="${r2(x0 - m / 2)}" y="${cy}" font-size="${fs}" text-anchor="middle" fill="${INK}" font-family="${mono}">${L}</text><text x="${r2(x1 + m / 2)}" y="${cy}" font-size="${fs}" text-anchor="middle" fill="${INK}" font-family="${mono}">${L}</text>`; } }
  o += `<rect x="${x0 - m}" y="${y0 - m}" width="${r2(x1 - x0 + 2 * m)}" height="${r2(y1 - y0 + 2 * m)}" fill="none" stroke="${INK}" stroke-width="${thin}"/>`;
  // centring marks
  [[W / 2, 0, W / 2, y0 - m], [W / 2, H, W / 2, y1 + m], [0, H / 2, x0 - m, H / 2], [W, H / 2, x1 + m, H / 2]].forEach(([a, b, c, d]) => { o += `<line x1="${r2(a)}" y1="${r2(b)}" x2="${r2(c)}" y2="${r2(d)}" stroke="${INK}" stroke-width="${thick}"/>`; });
  // title block, 180 mm wide (ISO 7200)
  const tw = Math.min(180 * s, x1 - x0), th = 36 * s, tx = x1 - tw, ty = y1 - th; const t = sh.title || {};
  const cell = (x: number, y: number, w: number, h: number, label: string, value: string, vs = 3.2) => `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" fill="#fff" stroke="${INK}" stroke-width="${thin}"/><text x="${r2(x + 1.2 * s)}" y="${r2(y + 2.6 * s)}" font-size="${r2(1.9 * s)}" fill="#5B6878" font-family="${mono}">${escX(label.toUpperCase())}</text><text x="${r2(x + 1.2 * s)}" y="${r2(y + h - 1.8 * s)}" font-size="${r2(vs * s)}" fill="${INK}" font-family="${ui}">${escX(value)}</text>`;
  o += `<rect x="${r2(tx)}" y="${r2(ty)}" width="${r2(tw)}" height="${r2(th)}" fill="#fff" stroke="${INK}" stroke-width="${thick}"/>`;
  const r1 = 16 * s, rr = 10 * s; const u = tw / 180;
  o += cell(tx, ty, 62 * u, r1, 'Legal owner', t.company || '', 3.6);
  o += cell(tx + 62 * u, ty, 118 * u, r1, 'Title', sh.name || '', 4.6);
  o += cell(tx, ty + r1, 30 * u, rr, 'Created by', t.drawnBy || '');
  o += cell(tx + 30 * u, ty + r1, 30 * u, rr, 'Approved by', t.checkedBy || '');
  o += cell(tx + 60 * u, ty + r1, 50 * u, rr, 'Identification no.', t.drawingNo || '');
  o += cell(tx + 110 * u, ty + r1, 14 * u, rr, 'Rev', t.rev || '');
  o += cell(tx + 124 * u, ty + r1, 30 * u, rr, 'Date of issue', t.date || '');
  o += cell(tx + 154 * u, ty + r1, 26 * u, rr, 'Sheet', `${ctx.sheetNo} / ${ctx.sheets}`);
  o += cell(tx, ty + r1 + rr, 92 * u, rr, 'Document type', sh.type === 'electric' ? 'Circuit diagram · electrical · IEC 61082' : `Circuit diagram · ${sh.type === 'pneumatic' ? 'pneumatic' : 'hydraulic'} · ISO 1219-2`, 2.8);
  o += cell(tx + 92 * u, ty + r1 + rr, 30 * u, rr, 'Project', ctx.project || '', 2.8);
  o += cell(tx + 122 * u, ty + r1 + rr, 18 * u, rr, 'Size', sh.size + (sh.orient === 'portrait' ? ' P' : ''));
  o += cell(tx + 140 * u, ty + r1 + rr, 18 * u, rr, 'Scale', scaleLabel(s));
  o += cell(tx + 158 * u, ty + r1 + rr, 22 * u, rr, 'Units', sh.type === 'electric' ? 'mm' : ctx.units || '');
  return { svg: o, tb: [tx, ty, x1, y1] };
}
