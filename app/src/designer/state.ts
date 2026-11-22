// Designer UI state and editing actions. Every change to a sheet goes through S.mutate, so Undo / Redo,
// dirty tracking, autosave and the recovery copy work exactly as on the Home tab.
import { signal, effect } from '@preact/signals';
import * as S from '../store';
import { uid, round, clone } from '../util';
import { unitFor, fromBase } from '../units';
import { kvGet, kvSet } from '../db';
import { geomOf, splitRef, libItem, xfBB, xfPoint, isConn, isAsm } from './geom';
import { canPlace } from './asm';
import { defaults } from './fields';
import * as E from './elec';
import { allTags, nextTag, nextLocalTag, isInfinite, livePts, simplify, segDist, renumber, drawArea, type Sheet, type Comp, type Pipe, type End } from './model';

const t_ = (s: string) => s;
export type Tool = 'select' | 'work' | 'pilot' | 'drain' | 'wire' | 'power' | 'pe' | 'junction' | 'text' | 'enclosure' | 'place';
export const LINE_TOOLS = new Set<string>(['work', 'pilot', 'drain', 'wire', 'power', 'pe']);
export const tool = signal<Tool>('select');
export const placing = signal<{ ref: string; rot: number; mirror: boolean } | null>(null);
export const sel = signal<{ sheet: string; ids: string[] }>({ sheet: '', ids: [] });
export const opts = signal({ grid: true, snap: true, ortho: true, ports: true });
export const dock = signal<{ open: boolean; tab: 'rules' | 'bom' | 'conn' | 'tags' | 'sim' }>({ open: true, tab: 'rules' });
export const rightTab = signal<'props' | 'sheet' | 'panel'>('props');
// windows around the canvas: overview on / off, the graph (Simulation tab) — each can also live in its own window
export const overviewOn = signal(true); kvGet('designer.overview', true).then((v: any) => { overviewOn.value = v !== false; });
export const setOverview = (v: boolean) => { overviewOn.value = v; kvSet('designer.overview', v); if (S.prefs.value.overview !== v) S.savePrefs({ ...S.prefs.value, overview: v }); };
effect(() => { const o = S.prefs.value.overview; if (o != null && o !== overviewOn.peek()) { overviewOn.value = o; kvSet('designer.overview', o); } });
export const ovState = signal<{ sheet: string; v: any; sz: any; box: number[] } | null>(null); // what the canvas shows (for the overview window)
export const panReq = signal<{ sheet: string; px: number; py: number; n: number } | null>(null);
export const popWins = signal<Record<string, boolean>>({}); // 'graph' | 'overview' open in their own window
// live settings pop-up: where it was dragged to (kept), collapsed
export const livePos = signal<{ x: number; y: number } | null>(null); kvGet('designer.livePos', null).then((v: any) => { if (v && typeof v.x === 'number') livePos.value = v; });
export const setLivePos = (p: { x: number; y: number } | null) => { livePos.value = p; kvSet('designer.livePos', p); };
export const liveCollapsed = signal(false);
export const pops: Record<string, () => void> = {};
export const cursorInfo = signal<{ x: number; y: number; snap: string } | null>(null);
export const zoomPct = signal(100);
export const recentParts = signal<string[]>([]);
export const viewReq = signal<{ n: number; kind: 'fit' | 'in' | 'out' | 'items' | 'pct'; ids?: string[]; pct?: number }>({ n: 0, kind: 'fit' });
export const dragPart = { ref: '' };
export const views = new Map<string, { z: number; px: number; py: number }>();
export type Api = { sheetId: string } & Record<string, any>;
export const D = signal<Api | null>(null);
// isolate: show only the chosen items, the rest ghosted (onion layer)
export const isolate = signal<{ sheet: string; ids: string[] } | null>(null);
// collapsible side panes and auto-hiding bars (pinned = always shown)
export const panes = signal({ left: true, right: true });
export const pins = signal({ top: true, tools: true });
export const savePanes = () => kvSet('designer.panes', panes.value);
export const savePins = () => kvSet('ui.pins', pins.value);
let booted = false;
export const loadPins = () => kvGet('ui.pins', null).then((v: any) => { if (v && typeof v === 'object') pins.value = { ...pins.value, ...v }; });
export function initDesignerState() {
  if (booted) return; booted = true;
  const sn = S.prefs.value.snap; opts.value = { grid: true, snap: sn.grid !== false, ortho: true, ports: true }; // fluid circuits are drawn orthogonally; the toggle is remembered once used
  kvGet('designer.recent', null).then((v: any) => { if (Array.isArray(v)) recentParts.value = v; });
  kvGet('designer.opts', null).then((v: any) => { if (v && typeof v === 'object') opts.value = { ...opts.value, ...v }; });
  kvGet('designer.dock', null).then((v: any) => { if (v && typeof v === 'object') dock.value = { ...dock.value, ...v }; });
  kvGet('designer.panes', null).then((v: any) => { if (v && typeof v === 'object') panes.value = { ...panes.value, ...v }; });
}
export const saveOpts = () => kvSet('designer.opts', opts.value);
export const saveDock = () => kvSet('designer.dock', dock.value);

export const sheetById = (id: string) => S.project.value?.circuits[id] as Sheet | undefined;
export const GRID = (sh?: Sheet) => sh?.grid || 5;
export const selIds = (sheet: string) => sel.value.sheet === sheet ? sel.value.ids : [];
export const setSel = (sheet: string, ids: string[]) => { sel.value = { sheet, ids: [...new Set(ids)] }; };
export function fmtQ(q: string, v: number) { if (v == null || !isFinite(v)) return '—'; const u = unitFor(S.prefs.value.unitSystem, q as any); return `${round(fromBase(q, u, v), 4)} ${u}`.trim(); }
export function kindOf(sh: Sheet, id: string): 'comp' | 'pipe' | 'junc' | 'text' | 'encl' | null {
  if (sh.components.some(x => x.id === id)) return 'comp'; if (sh.pipes.some(x => x.id === id)) return 'pipe'; if (sh.junctions.some(x => x.id === id)) return 'junc';
  if (sh.texts.some(x => x.id === id)) return 'text'; if (sh.enclosures.some(x => x.id === id)) return 'encl'; return null;
}
const edit = (sheetId: string, label: string, fn: (c: Sheet, d: S.Project) => void) => S.mutate(label, d => { const c = d.circuits[sheetId] as Sheet; if (c) fn(c, d); });

// ---------- place ----------
export function rememberPart(ref: string) { recentParts.value = [ref, ...recentParts.value.filter(r => r !== ref)].slice(0, 18); kvSet('designer.recent', recentParts.value); }
export function addPart(sheetId: string, ref: string, x: number, y: number, rot = 0, mirror = false) {
  const g = geomOf(ref); const sh = sheetById(sheetId); if (!sh) return null;
  if (ref.startsWith('asm:')) ref = 'asmx:' + ref.slice(4);
  const [k, iid] = splitRef(ref); const lib = k === 'lib' ? libItem(iid) : null;
  if (isAsm(ref) && !canPlace(S.project.value, sheetId, iid)) { S.toast(t_('An assembly cannot be placed inside itself (or inside a sheet it contains)'), 'warn'); return null; }
  const et = E.isElec(sh) && !isConn(ref) && !isAsm(ref) ? E.newElecTag(S.project.value, sh, g, E.projectTags(S.project.value)) : null; // electric sheets: IEC tags, PLC addresses, terminal numbers
  const tag = et ? et.tag : isConn(ref) ? nextLocalTag(sh, 'X') : isAsm(ref) ? nextLocalTag(sh, 'U') : nextTag(allTags(S.project.value), sh.circuitNo || 1, g.letter); const id = uid('c');
  // an assembly is dropped centred on the pointer (its anchor is the origin of its own sheet)
  if (isAsm(ref)) { const b = g.bb; x = Math.round((x - (b[0] + b[2]) / 2) / GRID(sh)) * GRID(sh); y = Math.round((y - (b[1] + b[3]) / 2) / GRID(sh)) * GRID(sh); }
  edit(sheetId, 'Place ' + g.name, (c, d) => {
    c.components.push({ id, ref, tag, x, y, rot, mirror, values: isConn(ref) ? { kind: 'work', size: '' } : isAsm(ref) ? { ov: {} } : { ...defaults(g), ...(et?.values || {}) }, ...(et?.labelPos ? { labelPos: et.labelPos } : {}) } as Comp);
    if (lib) { d.library = d.library || []; const i = d.library.findIndex((x: any) => x.item_id === lib.item_id); if (i < 0) d.library.push(clone(lib)); else if ((d.library[i].version || 0) < (lib.version || 0)) d.library[i] = clone(lib); }
  });
  rememberPart(ref); setSel(sheetId, [id]); return id;
}

// ---------- split a pipe at a point → junction (works on a draft) ----------
export function splitAt(c: Sheet, x: number, y: number, tol = 3): string | null {
  let best: { p: Pipe; i: number; q: number[]; d: number } | null = null;
  c.pipes.forEach(p => { const pts = livePts(c, p); for (let i = 0; i < pts.length - 1; i++) { const s = segDist(x, y, pts[i], pts[i + 1]); if (s.d < tol && (!best || s.d < best.d)) best = { p, i, q: [s.x, s.y], d: s.d }; } });
  if (!best) return null; const b = best as { p: Pipe; i: number; q: number[]; d: number };
  const ex = c.junctions.find(j => Math.hypot(j.x - b.q[0], j.y - b.q[1]) < 0.01); if (ex) return ex.id;
  const pts = livePts(c, b.p); const j = { id: uid('j'), x: Math.round(b.q[0] * 100) / 100, y: Math.round(b.q[1] * 100) / 100 }; c.junctions.push(j);
  const A = simplify([...pts.slice(0, b.i + 1), [j.x, j.y]]), B = simplify([[j.x, j.y], ...pts.slice(b.i + 1)]);
  const oldB = b.p.b; b.p.pts = A; b.p.b = { j: j.id };
  c.pipes.push({ id: uid('p'), kind: b.p.kind, a: { j: j.id }, b: oldB, pts: B, size: b.p.size });
  return j.id;
}
// an end that still has to be created: split a pipe at (x,y)
export type PendEnd = End | { split: [number, number] };
export function addPipe(sheetId: string, kind: Pipe['kind'], a: PendEnd, b: PendEnd, pts: number[][]) {
  let id = '';
  edit(sheetId, 'Draw ' + (kind === 'work' ? 'working' : kind) + ' line', c => {
    const res = (e: PendEnd): End => e && 'split' in e ? ((): End => { const j = splitAt(c, e.split[0], e.split[1]); return j ? { j } : null; })() : e as End;
    const A = res(a), B = res(b); id = uid('p');
    c.pipes.push({ id, kind, a: A, b: B, pts: simplify(pts) });
  });
  return id;
}
export function addJunctionOnPipe(sheetId: string, x: number, y: number) { let j: string | null = null; edit(sheetId, 'Add junction', c => { j = splitAt(c, x, y); }); return j; }

// ---------- delete (pipes on deleted parts go too; a junction left with two lines of one kind is merged) ----------
export function cleanJunctions(c: Sheet, only?: Set<string>) {
  for (let guard = 0; guard < 50; guard++) {
    const deg = new Map<string, Pipe[]>(); c.pipes.forEach(p => [p.a, p.b].forEach(e => { if (e && 'j' in e) { const l = deg.get(e.j) || []; l.push(p); deg.set(e.j, l); } }));
    const empty = c.junctions.filter(j => !(deg.get(j.id)?.length) && (!only || only.has(j.id))); if (empty.length) { c.junctions = c.junctions.filter(j => !empty.includes(j)); continue; }
    const two = c.junctions.find(j => { if (only && !only.has(j.id)) return false; const l = deg.get(j.id)!; return l.length === 2 && l[0] !== l[1] && l[0].kind === l[1].kind; });
    if (!two) break;
    const [p, q] = deg.get(two.id)!; const pp = livePts(c, p), qp = livePts(c, q);
    const pEndAtJ = p.b && 'j' in p.b && p.b.j === two.id; const qStartAtJ = q.a && 'j' in q.a && q.a.j === two.id;
    const P1 = pEndAtJ ? pp : pp.slice().reverse(), Q1 = qStartAtJ ? qp : qp.slice().reverse();
    const aEnd = pEndAtJ ? p.a : p.b, bEnd = qStartAtJ ? q.b : q.a;
    p.a = aEnd; p.b = bEnd; p.pts = simplify([...P1, ...Q1.slice(1)]);
    c.pipes = c.pipes.filter(x => x !== q); c.junctions = c.junctions.filter(j => j !== two);
  }
}
export function deleteIds(sheetId: string, ids: string[]) {
  if (!ids.length) return; const set = new Set(ids);
  edit(sheetId, ids.length > 1 ? `Delete ${ids.length} items` : 'Delete', c => {
    const gone = new Set(c.components.filter(x => set.has(x.id)).map(x => x.id)); c.junctions.filter(j => set.has(j.id)).forEach(j => gone.add(j.id));
    c.components = c.components.filter(x => !set.has(x.id)); c.junctions = c.junctions.filter(x => !set.has(x.id));
    const touched = new Set<string>();
    c.pipes = c.pipes.filter(p => { const kill = set.has(p.id) || [p.a, p.b].some(e => e && (('c' in e && gone.has(e.c)) || ('j' in e && gone.has(e.j)))); if (kill) [p.a, p.b].forEach(e => { if (e && 'j' in e) touched.add(e.j); }); return !kill; });
    c.texts = c.texts.filter(x => !set.has(x.id)); c.enclosures = c.enclosures.filter(x => !set.has(x.id));
    cleanJunctions(c, touched);
  });
  setSel(sheetId, []);
}

// ---------- clipboard ----------
let clip: { comps: Comp[]; pipes: Pipe[]; juncs: any[]; texts: any[]; encl: any[]; libs: any[]; from: string } | null = null; let pasteN = 0;
export const hasClip = signal(false);
export function snapshotIds(sheetId: string, ids: string[]) {
  const sh = sheetById(sheetId); if (!sh || !ids.length) return null; const set = new Set(ids);
  const comps = sh.components.filter(x => set.has(x.id)); const juncs = sh.junctions.filter(x => set.has(x.id)); const inside = new Set([...comps.map(c => c.id), ...juncs.map(j => j.id)]);
  const endIn = (e: End) => !!e && ('c' in e ? inside.has(e.c) : inside.has(e.j));
  const pipes = sh.pipes.filter(p => (set.has(p.id) || (endIn(p.a) && endIn(p.b)))).map(p => ({ ...clone(p), pts: livePts(sh, p), a: endIn(p.a) ? clone(p.a) : null, b: endIn(p.b) ? clone(p.b) : null }));
  const libs = (S.project.value?.library || []).filter((it: any) => comps.some(c => c.ref === 'lib:' + it.item_id));
  return clone({ comps, pipes, juncs, texts: sh.texts.filter(x => set.has(x.id)), encl: sh.enclosures.filter(x => set.has(x.id)), libs, from: S.project.value?.manifest.projectId || '' });
}
export function copyIds(sheetId: string, ids: string[]) {
  const sh = sheetById(sheetId); if (!sh || !ids.length) return false; const set = new Set(ids);
  const comps = sh.components.filter(x => set.has(x.id)); const juncs = sh.junctions.filter(x => set.has(x.id)); const inside = new Set([...comps.map(c => c.id), ...juncs.map(j => j.id)]);
  const endIn = (e: End) => !!e && ('c' in e ? inside.has(e.c) : inside.has(e.j));
  const pipes = sh.pipes.filter(p => (set.has(p.id) || (endIn(p.a) && endIn(p.b)))).map(p => ({ ...clone(p), pts: livePts(sh, p), a: endIn(p.a) ? clone(p.a) : null, b: endIn(p.b) ? clone(p.b) : null }));
  const libs = (S.project.value?.library || []).filter((it: any) => comps.some(c => c.ref === 'lib:' + it.item_id));
  clip = clone({ comps, pipes, juncs, texts: sh.texts.filter(x => set.has(x.id)), encl: sh.enclosures.filter(x => set.has(x.id)), libs, from: S.project.value?.manifest.projectId || '' }); pasteN = 0; hasClip.value = true;
  S.toast(`Copied ${comps.length} part${comps.length === 1 ? '' : 's'}${pipes.length ? `, ${pipes.length} line${pipes.length === 1 ? '' : 's'}` : ''}`); return true;
}
export function paste(sheetId: string) { if (!clip) return; pasteN++; insertClip(sheetId, clip, 10 * pasteN, 10 * pasteN, 'Paste'); }
/** inserts an independent copy (new ids, tags renumbered) of a snapshot, shifted by dx, dy; returns the new ids */
export function insertClip(sheetId: string, src: any, dx: number, dy: number, label: string, quiet = false) {
  const sh = sheetById(sheetId); if (!sh) return []; const offX = dx, offY = dy;
  const map = new Map<string, string>(); const taken = new Set(allTags(S.project.value)); const newIds: string[] = [];
  const cl = clone(src); cl.juncs ||= []; cl.texts ||= []; cl.encl ||= []; cl.libs ||= []; const pr = S.project.value!; let skipped = 0;
  // assemblies only travel inside one project (import other projects' assemblies from the Assemblies panel)
  cl.comps = cl.comps.filter(x => { if (!isAsm(x.ref)) return true; const ch = splitRef(x.ref)[1]; const ok = !!pr.circuits[ch] && canPlace(pr, sheetId, ch); if (!ok) skipped++; return ok; });
  const keep = new Set(cl.comps.map(x => x.id)); cl.pipes = cl.pipes.map(p => ({ ...p, a: p.a && 'c' in p.a && !keep.has(p.a.c) ? null : p.a, b: p.b && 'c' in p.b && !keep.has(p.b.c) ? null : p.b }));
  edit(sheetId, label, (c, d) => {
    const local = new Set(c.components.map(x => x.tag));
    cl.comps.forEach(x => { const id = uid('c'); map.set(x.id, id); const g = geomOf(x.ref);
      const tag = isConn(x.ref) || isAsm(x.ref) ? (local.has(x.tag) ? nextLocalTag({ ...c, components: [...c.components] } as Sheet, isConn(x.ref) ? 'X' : 'U') : x.tag) : nextTag(taken, c.circuitNo || 1, g.letter);
      taken.add(tag); local.add(tag); c.components.push({ ...x, id, tag, x: x.x + offX, y: x.y + offY }); newIds.push(id); });
    cl.libs.forEach(it => { d.library = d.library || []; if (!d.library.some((q: any) => q.item_id === it.item_id)) d.library.push(it); });
    cl.juncs.forEach(j => { const id = uid('j'); map.set(j.id, id); c.junctions.push({ id, x: j.x + offX, y: j.y + offY }); newIds.push(id); });
    const me = (e: End): End => !e ? null : 'c' in e ? { c: map.get(e.c)!, p: e.p } : { j: map.get(e.j)! };
    cl.pipes.forEach(p => { const id = uid('p'); c.pipes.push({ ...p, id, a: me(p.a), b: me(p.b), pts: p.pts.map(q => [q[0] + offX, q[1] + offY]) }); newIds.push(id); });
    cl.texts.forEach(t => { const id = uid('t'); c.texts.push({ ...t, id, x: t.x + offX, y: t.y + offY }); newIds.push(id); });
    cl.encl.forEach(e => { const id = uid('e'); c.enclosures.push({ ...e, id, x: e.x + offX, y: e.y + offY }); newIds.push(id); });
  });
  setSel(sheetId, newIds);
  if (quiet) return newIds;
  if (skipped) S.toast(`${skipped} assembl${skipped > 1 ? 'ies were' : 'y was'} left out — it belongs to another project or would contain itself. Import it from the Assemblies panel.`, 'warn');
  else if (cl.from && cl.from !== pr.manifest.projectId) S.toast('Pasted from another project — tags renumbered, custom parts copied into this project', 'ok');
  return newIds;
}

// ---------- transforms ----------
function selCentre(sh: Sheet, ids: Set<string>) {
  const comps = sh.components.filter(c => ids.has(c.id));
  if (comps.length === 1 && ids.size === 1 && !isAsm(comps[0].ref)) return [comps[0].x, comps[0].y];
  let b = [1e9, 1e9, -1e9, -1e9]; const add = (x0: number, y0: number, x1: number, y1: number) => { b = [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)]; };
  comps.forEach(c => { const q = xfBB(c, geomOf(c.ref).bb); add(q[0], q[1], q[2], q[3]); });
  sh.junctions.filter(j => ids.has(j.id)).forEach(j => add(j.x, j.y, j.x, j.y)); sh.texts.filter(t => ids.has(t.id)).forEach(t => add(t.x, t.y, t.x, t.y));
  const g = GRID(sh); return [Math.round((b[0] + b[2]) / 2 / g) * g, Math.round((b[1] + b[3]) / 2 / g) * g];
}
function transformSel(sheetId: string, ids: string[], label: string, fp: (x: number, y: number) => number[], fc: (c: Comp) => void) {
  const sh = sheetById(sheetId); if (!sh || !ids.length) return; const set = new Set(ids);
  edit(sheetId, label, c => {
    const inside = new Set<string>();
    c.components.forEach(x => { if (!set.has(x.id)) return; const [nx, ny] = fp(x.x, x.y); x.x = nx; x.y = ny; fc(x); inside.add(x.id); });
    c.junctions.forEach(j => { if (!set.has(j.id)) return; const [nx, ny] = fp(j.x, j.y); j.x = nx; j.y = ny; inside.add(j.id); });
    c.texts.forEach(t => { if (!set.has(t.id)) return; const [nx, ny] = fp(t.x, t.y); t.x = nx; t.y = ny; });
    const endIn = (e: End) => !!e && ('c' in e ? inside.has(e.c) : inside.has(e.j));
    c.pipes.forEach(p => { if (endIn(p.a) && endIn(p.b) || set.has(p.id)) p.pts = simplify(p.pts.map(q => fp(q[0], q[1]))); });
    c.pipes.forEach(p => { if (endIn(p.a) || endIn(p.b)) p.pts = simplify(livePts(c, p)); });
  });
}
export function rotateSel(sheetId: string, ids: string[]) {
  const sh = sheetById(sheetId); if (!sh) return; const set = new Set(ids); const [cx, cy] = selCentre(sh, set);
  transformSel(sheetId, ids, 'Rotate', (x, y) => [cx - (y - cy), cy + (x - cx)], c => { c.rot = ((c.rot || 0) + 90) % 360; });
}
export function mirrorSel(sheetId: string, ids: string[]) {
  const sh = sheetById(sheetId); if (!sh) return; const set = new Set(ids); const [cx] = selCentre(sh, set);
  transformSel(sheetId, ids, 'Mirror', (x, y) => [2 * cx - x, y], c => { c.rot = (360 - (c.rot || 0)) % 360; c.mirror = !c.mirror; });
}
export function moveIds(sheetId: string, ids: string[], dx: number, dy: number, label = 'Move') {
  if (!dx && !dy) return; const set = new Set(ids);
  edit(sheetId, label, c => {
    const moved = new Set<string>();
    c.components.forEach(x => { if (set.has(x.id)) { x.x = Math.round((x.x + dx) * 100) / 100; x.y = Math.round((x.y + dy) * 100) / 100; moved.add(x.id); } });
    c.junctions.forEach(j => { if (set.has(j.id)) { j.x += dx; j.y += dy; moved.add(j.id); } });
    c.texts.forEach(t => { if (set.has(t.id)) { t.x += dx; t.y += dy; } });
    c.enclosures.forEach(e => { if (set.has(e.id)) { e.x += dx; e.y += dy; } });
    const endIn = (e: End) => !!e && ('c' in e ? moved.has(e.c) : moved.has(e.j));
    c.pipes.forEach(p => { if (set.has(p.id) || (endIn(p.a) && endIn(p.b))) p.pts = p.pts.map(q => [q[0] + dx, q[1] + dy]); });
    c.pipes.forEach(p => { if (endIn(p.a) || endIn(p.b) || set.has(p.id)) p.pts = simplify(livePts(c, p)); });
  });
}
export function alignSel(sheetId: string, ids: string[], how: 'left' | 'right' | 'top' | 'bottom' | 'hcentre' | 'vcentre' | 'hdist' | 'vdist') {
  const sh = sheetById(sheetId); if (!sh) return; const comps = sh.components.filter(c => ids.includes(c.id)); if (comps.length < 2) { S.toast('Select two or more parts to align', 'warn'); return; }
  const bb = new Map(comps.map(c => [c.id, xfBB(c, geomOf(c.ref).bb)]));
  const target: Record<string, number> = { left: Math.min(...comps.map(c => bb.get(c.id)![0])), right: Math.max(...comps.map(c => bb.get(c.id)![2])), top: Math.min(...comps.map(c => bb.get(c.id)![1])), bottom: Math.max(...comps.map(c => bb.get(c.id)![3])), hcentre: comps[0].x, vcentre: comps[0].y };
  const g = GRID(sh); const delta = new Map<string, number[]>();
  if (how === 'hdist' || how === 'vdist') {
    const ax = how === 'hdist' ? 'x' : 'y'; const sorted = comps.slice().sort((a, b) => a[ax] - b[ax]); const a0 = sorted[0][ax], a1 = sorted[sorted.length - 1][ax];
    sorted.forEach((c, i) => { const v = Math.round((a0 + (a1 - a0) * i / (sorted.length - 1)) / g) * g; delta.set(c.id, ax === 'x' ? [v - c.x, 0] : [0, v - c.y]); });
  } else comps.forEach(c => { const b = bb.get(c.id)!; const d = how === 'left' ? [target.left - b[0], 0] : how === 'right' ? [target.right - b[2], 0] : how === 'top' ? [0, target.top - b[1]] : how === 'bottom' ? [0, target.bottom - b[3]] : how === 'hcentre' ? [0, target.vcentre - c.y] : [target.hcentre - c.x, 0]; delta.set(c.id, d); });
  edit(sheetId, 'Align', c => {
    const moved = new Set<string>(); c.components.forEach(x => { const d = delta.get(x.id); if (d && (d[0] || d[1])) { x.x += d[0]; x.y += d[1]; moved.add(x.id); } });
    c.pipes.forEach(p => { if ([p.a, p.b].some(e => e && 'c' in e && moved.has(e.c))) p.pts = simplify(livePts(c, p)); });
  });
}
export function renumberTags(sheetId: string) { if (E.isElec(sheetById(sheetId))) { const pr = S.project.value; edit(sheetId, 'Renumber tags', c => E.renumberElec(c, pr)); S.toast('Tags renumbered — contacts follow their coil; linked parts keep their tags', 'ok'); return; } edit(sheetId, 'Renumber tags', c => renumber(c)); S.toast('Tags renumbered (ISO 1219-2: circuit · code letter · number)', 'ok'); }
export function encloseSel(sheetId: string, ids: string[], label = '') {
  const sh = sheetById(sheetId); if (!sh) return; const comps = sh.components.filter(c => ids.includes(c.id)); if (!comps.length) { S.toast('Select the parts to enclose', 'warn'); return; }
  let b = [1e9, 1e9, -1e9, -1e9]; comps.forEach(c => { const q = xfBB(c, geomOf(c.ref).bb); b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]; });
  const g = GRID(sh); const x0 = Math.floor((b[0] - 6) / g) * g, y0 = Math.floor((b[1] - 8) / g) * g, x1 = Math.ceil((b[2] + 6) / g) * g, y1 = Math.ceil((b[3] + 6) / g) * g;
  const id = uid('e'); edit(sheetId, 'Enclose', c => { c.enclosures.push({ id, x: x0, y: y0, w: x1 - x0, h: y1 - y0, label }); }); setSel(sheetId, [id]);
  S.toast('Enclosure (assembly boundary, chain line) added', 'ok');
}
export function setComp(sheetId: string, id: string, label: string, fn: (c: Comp) => void, reroute = false) {
  edit(sheetId, label, c => { const x = c.components.find(q => q.id === id); if (!x) return; fn(x); if (reroute) c.pipes.forEach(p => { if ([p.a, p.b].some(e => e && 'c' in e && e.c === id)) p.pts = simplify(livePts(c, p)); }); });
}
export function inFrame(sh: Sheet, x: number, y: number) { if (isInfinite(sh)) return true; const [x0, y0, x1, y1] = drawArea(sh); return x >= x0 && y >= y0 && x <= x1 && y <= y1; }
export { xfPoint };
