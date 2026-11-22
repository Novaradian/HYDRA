// AI command layer — edit operations. Each one changes a project DRAFT (inside S.mutate or immer produce) and
// uses the Circuit Designer's own model helpers (tags, defaults, routing, junction split), so drawings made here
// are the same as drawings made by hand. Nothing in the designer itself is changed.
import { uid, clone } from '../util';
import { geomOf, splitRef, libItem, portWorld, xfBB, isConn as isConnRef } from '../designer/geom';
import { defaults } from '../designer/fields';
import { allTags, nextTag, TAG_RE, simplify, elbow, livePts, drawArea, contentBB, type Sheet, type Comp, type Pipe, type End } from '../designer/model';
import { splitAt, cleanJunctions, GRID } from '../designer/state';
import type { Project } from '../store';
import { fail, normRef, partGeom, compByTag, parseEnd, applyValues, pipesAt } from './core';

const snap = (v: number, g: number) => Math.round(v / g) * g;
const isVert = (dir?: number) => dir === 90 || dir === 270;
const LINE_KINDS = new Set(['work', 'pilot', 'drain']);

// ---------- place ----------
export type PartSpec = { tag?: string; as?: string; ref: string; x?: number; y?: number; rot?: number; mirror?: boolean; values?: Record<string, any>; desc?: string };
function checkTag(d: Project, sh: Sheet, tag: string, taken: Set<string>) {
  if (!TAG_RE.test(tag)) fail(`Tag "${tag}" is not ISO 1219-2 (circuit · letter · number, e.g. 1V2)`);
  if (taken.has(tag) || sh.components.some(c => c.tag === tag)) fail(`Tag ${tag} is already used`, [`Used tags: ${[...taken].sort().join(', ')}`]);
}
/** free slot for a part without coordinates: actuators on top, valves in the middle, power unit at the bottom */
function autoXY(sh: Sheet, letter: string, slot: Map<string, number>, x0: number): [number, number] {
  const [ax0, ay0, , ay1] = drawArea(sh); const g = GRID(sh);
  const row = letter === 'A' ? 0 : letter === 'V' || letter === 'S' ? 1 : 2;
  const n = slot.get(String(row)) || 0; slot.set(String(row), n + 1);
  const y = row === 0 ? ay0 + 45 : row === 1 ? (ay0 + ay1) / 2 : ay1 - 40;
  return [snap(Math.max(x0, ax0 + 40) + n * 45, g), snap(y, g)];
}
export function placePart(d: Project, sh: Sheet, s: PartSpec, taken: Set<string>, slot = new Map<string, number>(), x0?: number): Comp {
  const ref = normRef(s.ref); const g = partGeom(ref);
  if (g.domain === 'electrical') fail(`${s.ref} is an electrical part — it belongs on an electric sheet`);
  const tag = s.tag ? String(s.tag).trim() : nextTag(taken, sh.circuitNo || 1, g.letter);
  if (s.tag) checkTag(d, sh, tag, taken); taken.add(tag);
  const rot = s.rot == null ? 0 : ((Math.round(s.rot / 90) * 90) % 360 + 360) % 360;
  let x = s.x, y = s.y; if (x == null || y == null) { const xy = autoXY(sh, g.letter, slot, x0 ?? drawArea(sh)[0]); x = x ?? xy[0]; y = y ?? xy[1]; }
  const c: Comp = { id: uid('c'), ref, tag, x: +x, y: +y, rot, mirror: !!s.mirror, values: defaults(g) } as Comp;
  if (s.desc) c.desc = String(s.desc);
  applyValues(c, s.values);
  sh.components.push(c);
  const [k, iid] = splitRef(ref);
  if (k === 'lib') { const it = libItem(iid); if (it) { d.library = d.library || []; const i = d.library.findIndex((q: any) => q.item_id === it.item_id); if (i < 0) d.library.push(clone(it)); else if ((d.library[i].version || 0) < (it.version || 0)) d.library[i] = clone(it); } }
  return c;
}
export function addComponent(d: Project, sh: Sheet, s: PartSpec) {
  const c = placePart(d, sh, s, new Set(allTags(d)), new Map(), nextX(sh));
  return { tag: c.tag, x: c.x, y: c.y };
}
/** right of what is already drawn, so new parts do not land on old ones */
function nextX(sh: Sheet) { const b = sh.components.length ? contentBB(sh) : null; return b ? b[2] + 30 : drawArea(sh)[0] + 40; }

// ---------- values ----------
export function setParam(sh: Sheet, tag: string, values: Record<string, any>) {
  const c = compByTag(sh, tag); applyValues(c, values); return { tag: c.tag };
}

// ---------- lines ----------
function portPos(c: Comp, key: string) { const p = geomOf(c.ref).ports.find(q => q.key === key)!; return portWorld(c, p); }
type Pt = { x: number; y: number; dir?: number };
/** orthogonal path: Z-shape between two ports facing the same axis, else an L */
function route(a: Pt, b: Pt) {
  if (a.dir != null && b.dir != null && isVert(a.dir) === isVert(b.dir) && Math.abs(a.x - b.x) > 1e-6 && Math.abs(a.y - b.y) > 1e-6) {
    if (isVert(a.dir)) { const m = (a.y + b.y) / 2; return simplify([[a.x, a.y], [a.x, m], [b.x, m], [b.x, b.y]]); }
    const m = (a.x + b.x) / 2; return simplify([[a.x, a.y], [m, a.y], [m, b.y], [b.x, b.y]]);
  }
  return simplify([[a.x, a.y], ...elbow([a.x, a.y], [b.x, b.y], a.dir != null ? isVert(a.dir) : b.dir != null ? !isVert(b.dir) : true)]);
}
/** where a new line can attach to a port: the port itself, or — if the port already has a line — a junction on that line */
function attach(sh: Sheet, c: Comp, key: string): { end: End; x: number; y: number; dir?: number } {
  const w = portPos(c, key); const busy = pipesAt(sh, c.id, key)[0];
  if (!busy) return { end: { c: c.id, p: key }, x: w.x, y: w.y, dir: w.dir };
  const other = (busy.a && 'c' in busy.a && busy.a.c === c.id && busy.a.p === key) ? busy.b : busy.a;
  if (other && 'j' in other) { const j = sh.junctions.find(q => q.id === other.j)!; return { end: { j: j.id }, x: j.x, y: j.y }; }
  const pts = livePts(sh, busy); const atA = (busy.a && 'c' in busy.a && busy.a.c === c.id && busy.a.p === key);
  const seg = atA ? [pts[0], pts[1]] : [pts[pts.length - 1], pts[pts.length - 2]];
  const len = Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]); const t = Math.min(0.5, 10 / Math.max(len, 1e-6));
  const jx = seg[0][0] + (seg[1][0] - seg[0][0]) * t, jy = seg[0][1] + (seg[1][1] - seg[0][1]) * t;
  const j = splitAt(sh, jx, jy, 0.5); if (!j) fail(`Could not branch the line at ${c.tag}`);
  const jj = sh.junctions.find(q => q.id === j)!; return { end: { j: j! }, x: jj.x, y: jj.y };
}
/** one net: 2 ports → one line; 3 or more → a junction with a line to each port */
export function connectNet(sh: Sheet, ends: string[], kind = 'work', alias?: Map<string, string>) {
  if (!LINE_KINDS.has(kind)) fail(`Line kind "${kind}" — use work, pilot or drain`);
  if (ends.length < 2) fail('A connection needs at least two ports');
  const parsed = ends.map(s => parseEnd(sh, s, alias));
  const seen = new Set<string>(); parsed.forEach((q, i) => { const k = q.c.id + ':' + q.p.key; if (seen.has(k)) fail(`${ends[i]} is listed twice`); seen.add(k); });
  // ports already on one junction attach there once
  const at: (Pt & { end: End })[] = []; parsed.forEach(q => { const e = attach(sh, q.c, q.p.key); if (!at.some(x => JSON.stringify(x.end) === JSON.stringify(e.end))) at.push(e); });
  if (at.length < 2) fail(`${ends.join(', ')} are already connected`);
  const made: string[] = []; const pipe = (a: Pt & { end: End }, b: Pt & { end: End }) => { const id = uid('p'); sh.pipes.push({ id, kind: kind as Pipe['kind'], a: a.end, b: b.end, pts: route(a, b) }); made.push(id); };
  if (at.length === 2) pipe(at[0], at[1]);
  else {
    const g = GRID(sh); const a = at[0], b = at[1];
    // the junction sits on the first port's axis, half-way to the second port
    const j = { id: uid('j'), x: a.x, y: snap((a.y + b.y) / 2, g) }; sh.junctions.push(j);
    const J = { end: { j: j.id } as End, x: j.x, y: j.y };
    at.forEach(e => pipe(e, { ...J, dir: undefined }));
  }
  return { lines: made.length };
}

// ---------- remove / move ----------
export function removeParts(sh: Sheet, tags: string[]) {
  const ids = new Set(tags.map(t => compByTag(sh, t).id)); const touched = new Set<string>();
  sh.components = sh.components.filter(c => !ids.has(c.id));
  sh.pipes = sh.pipes.filter(p => { const kill = [p.a, p.b].some(e => e && 'c' in e && ids.has(e.c)); if (kill) [p.a, p.b].forEach(e => { if (e && 'j' in e) touched.add(e.j); }); return !kill; });
  cleanJunctions(sh, touched);
  return { removed: ids.size };
}
export function moveComponent(sh: Sheet, tag: string, x: number, y: number, rot?: number) {
  const c = compByTag(sh, tag); c.x = +x; c.y = +y; if (rot != null) c.rot = ((Math.round(rot / 90) * 90) % 360 + 360) % 360;
  sh.pipes.forEach(p => { if ([p.a, p.b].some(e => e && 'c' in e && e.c === c.id)) p.pts = simplify(livePts(sh, p)); });
  return { tag: c.tag, x: c.x, y: c.y };
}

// ---------- saved template (Parts › Templates) ----------
export function insertTemplate(d: Project, sh: Sheet, data: any, dx: number, dy: number) {
  const cl = clone(data); const taken = new Set(allTags(d)); const map = new Map<string, string>(); const tags: string[] = [];
  const comps = (cl.comps || []).filter((x: any) => !isConnRef(x.ref) && !String(x.ref).startsWith('asm'));
  comps.forEach((x: any) => { const id = uid('c'); map.set(x.id, id); const tag = nextTag(taken, sh.circuitNo || 1, geomOf(x.ref).letter); taken.add(tag); tags.push(tag); sh.components.push({ ...x, id, tag, x: x.x + dx, y: x.y + dy }); });
  (cl.libs || []).forEach((it: any) => { d.library = d.library || []; if (!d.library.some((q: any) => q.item_id === it.item_id)) d.library.push(it); });
  (cl.juncs || []).forEach((j: any) => { const id = uid('j'); map.set(j.id, id); sh.junctions.push({ id, x: j.x + dx, y: j.y + dy }); });
  const me = (e: End): End => !e ? null : 'c' in e ? (map.has(e.c) ? { c: map.get(e.c)!, p: e.p } : null) : (map.has(e.j) ? { j: map.get(e.j)! } : null);
  (cl.pipes || []).forEach((p: any) => { const a = me(p.a), b = me(p.b); if ((p.a && !a) || (p.b && !b)) return; sh.pipes.push({ ...p, id: uid('p'), a, b, pts: (p.pts || []).map((q: number[]) => [q[0] + dx, q[1] + dy]) }); });
  (cl.texts || []).forEach((t: any) => sh.texts.push({ ...t, id: uid('t'), x: t.x + dx, y: t.y + dy }));
  return { parts: tags };
}

// ---------- whole circuit in one call ----------
export type CircuitSpec = { parts?: PartSpec[]; nets?: { kind?: string; ports: string[] }[]; replace?: boolean };
export function buildCircuit(d: Project, sh: Sheet, spec: CircuitSpec) {
  if (spec.replace) { sh.components = []; sh.pipes = []; sh.junctions = []; }
  const taken = new Set(allTags(d, sh.id).concat(spec.replace ? [] : sh.components.map(c => c.tag)));
  const alias = new Map<string, string>(); const slot = new Map<string, number>(); const x0 = nextX(sh); const tags: string[] = [];
  (spec.parts || []).forEach(s => { const c = placePart(d, sh, s, taken, slot, x0); tags.push(c.tag); if (s.as) { if (alias.has(s.as)) fail(`Alias "${s.as}" is used twice`); alias.set(s.as, c.tag); } });
  let lines = 0; (spec.nets || []).forEach(n => { lines += connectNet(sh, n.ports, n.kind || 'work', alias).lines; });
  // parts placed without coordinates may overlap old ones: report it, the rule check names them
  const overlaps = sh.components.length > 1 ? countOverlaps(sh) : 0;
  return { parts: tags, aliases: Object.fromEntries(alias), lines, ...(overlaps ? { overlaps } : {}) };
}
function countOverlaps(sh: Sheet) { const b = sh.components.map(c => xfBB(c, geomOf(c.ref).bb)); let n = 0; for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) { const ix = Math.min(b[i][2], b[j][2]) - Math.max(b[i][0], b[j][0]), iy = Math.min(b[i][3], b[j][3]) - Math.max(b[i][1], b[j][1]); if (ix > 3 && iy > 3) n++; } return n; }
