// Whole-machine samples (original designs, MIT / CC-BY): declarative sheets → a complete HYDRA project.
// Fluid sheets: fixed part positions, every pipe end taken from the part's real port (as designer/samples.ts).
// Electric sheets: ladder rungs between +24V and 0V rails (net labels), PLC I/O cards, motor power circuits.
import { geomOf, portWorld, CONN_REF } from '../designer/geom';
import { defaults } from '../designer/fields';
import { simplify, type Comp, type Pipe, type End } from '../designer/model';
import { uid, nowIso } from '../util';
import { mkNode, project, APP_VERSION, FORMAT_VERSION, type Project } from '../store';
import { compile, type Var } from '../plc/compile';
import { signals } from '../plc/signals';
import { autoBuild } from '../plc/panel/model';

// ---------- fluid ----------
export type P = [key: string, ref: string, x: number, y: number, rot?: number, mirror?: boolean, tag?: string, values?: Record<string, any>, label?: Comp['labelPos']];
export type L = [a: string, b: string, mids?: number[][], kind?: Pipe['kind']];
export type FDef = { parts: P[]; junctions?: Record<string, [number, number]>; lines: L[]; enclosures?: [number, number, number, number, string][]; texts?: [number, number, string, number?][] };
export const VF = [180, true] as const; // vertical flip
// part values are stored in base SI units
export const U = { bar: (x: number) => x * 1e5, L: (x: number) => x / 1000, cc: (x: number) => x * 1e-6, kW: (x: number) => x * 1000, C: (x: number) => x + 273.15, mm: (x: number) => x / 1000, kN: (x: number) => x * 1000, Lmin: (x: number) => x / 60000 };
export const CONN = CONN_REF;
export function drawFluid(d: FDef, type: 'hydraulic' | 'pneumatic') {
  const ids: Record<string, string> = {}; const comps: Comp[] = [];
  d.parts.forEach(([k, ref, x, y, rot = 0, mirror = false, tag = '', values, label]) => { const id = uid('c'); ids[k] = id; comps.push({ id, ref, tag, x, y, rot, mirror, values: { ...defaults(geomOf(ref)), ...(values || {}) }, ...(label ? { labelPos: label } : {}) }); });
  const juncs = Object.entries(d.junctions || {}).map(([n, [x, y]]) => { const id = uid('j'); ids[n] = id; return { id, x, y }; });
  const at = (s: string): { e: End; pt: number[] } => {
    if (/^J\w*$/.test(s) && !s.includes('.')) { const j = juncs.find(q => q.id === ids[s]); if (!j) throw new Error('junction ' + s); return { e: { j: j.id }, pt: [j.x, j.y] }; }
    const [k, port] = s.split('.'); const c = comps.find(q => q.id === ids[k]); if (!c) throw new Error('part ' + k); const g = geomOf(c.ref); const p = g.ports.find(q => q.key === port || q.name === port); if (!p) throw new Error(`port ${s}`);
    const w = portWorld(c, p); return { e: { c: c.id, p: p.key }, pt: [w.x, w.y] };
  };
  const pipes: Pipe[] = d.lines.map(([a, b, mids = [], kind = 'work']) => { const A = at(a), B = at(b); if (!mids.length && Math.abs(A.pt[0] - B.pt[0]) > 0.01 && Math.abs(A.pt[1] - B.pt[1]) > 0.01) mids = [[B.pt[0], A.pt[1]]]; /* one elbow */ const size = type === 'pneumatic' ? undefined : [a, b].some(x => /\.S$/.test(x)) ? '25 mm' : kind === 'work' ? '16 mm' : undefined; return { id: uid('p'), kind, a: A.e, b: B.e, pts: simplify([A.pt, ...mids, B.pt]), ...(size ? { size } : {}) }; });
  return { components: comps, pipes, junctions: juncs, texts: (d.texts || []).map(([x, y, s, h]) => ({ id: uid('t'), x, y, s, h: h || 3 })), enclosures: (d.enclosures || []).map(([x, y, w, h, label]) => ({ id: uid('e'), x, y, w, h, label })), scale: 1, size: 'A3', circuitNo: 1, designerVersion: 1 };
}

// ---------- electric (ladder) ----------
export type EP = [ref: string, tag: string, values?: Record<string, any>];
export type Rung = { x: number; parts: EP[]; top?: boolean; bot?: boolean; seal?: { over: [number, number]; part: EP; dx?: number } };
export type EDef = { rungs: Rung[]; power?: { label: string; x: number; parts: EP[] }[]; texts?: [number, number, string][]; rails?: [string, string] };
const RT = 32, RB = 226;
export function drawElec(d: EDef) {
  const comps: Comp[] = [], pipes: Pipe[] = [], juncs: { id: string; x: number; y: number }[] = [];
  const add = ([ref, tag, values]: EP, x: number, y: number) => { const c: Comp = { id: uid('c'), ref, tag, x, y, rot: 0, mirror: false, values: { ...defaults(geomOf(ref)), ...(values || {}) }, ...(geomOf(ref).cls === 'earth' ? { labelPos: 'hidden' as const } : {}) }; comps.push(c); return c; };
  const ends = (c: Comp) => { const g = geomOf(c.ref); const ws = g.ports.map(q => ({ q, w: portWorld(c, q) })).sort((a, b) => a.w.y - b.w.y); return { top: ws[0], bot: ws[ws.length - 1], all: ws }; };
  const wire = (a: { e: End; pt: number[] }, b: { e: End; pt: number[] }, kind: Pipe['kind'] = 'wire') => { const mids = Math.abs(a.pt[0] - b.pt[0]) > 0.01 && Math.abs(a.pt[1] - b.pt[1]) > 0.01 ? [[b.pt[0], a.pt[1]]] : []; pipes.push({ id: uid('p'), kind, a: a.e, b: b.e, pts: simplify([a.pt, ...mids, b.pt]) }); };
  const pin = (c: Comp, w: { q: any; w: any }) => ({ e: { c: c.id, p: w.q.key } as End, pt: [w.w.x, w.w.y] });
  const junc = (x: number, y: number) => { const j = { id: uid('j'), x, y }; juncs.push(j); return { e: { j: j.id } as End, pt: [x, y] }; };
  const rail: Record<'t' | 'b', { e: End; pt: number[] }[]> = { t: [], b: [] };
  d.rungs.forEach(r => { const n = r.parts.length, sp = Math.min(34, (RB - RT - 20) / n); const cs = r.parts.map((q, i) => add(q, r.x, RT + 14 + sp * i + sp / 2)); let ja: any = null, jb: any = null;
    for (let i = 0; i < n - 1; i++) { const up = ends(cs[i]).bot, dn = ends(cs[i + 1]).top;
      if (r.seal && i === r.seal.over[0] - 1) { ja = junc(r.x, (up.w.y + dn.w.y) / 2); wire(pin(cs[i], up), ja); wire(ja, pin(cs[i + 1], dn)); }
      else if (r.seal && i === r.seal.over[1]) { jb = junc(r.x, (up.w.y + dn.w.y) / 2); wire(pin(cs[i], up), jb); wire(jb, pin(cs[i + 1], dn)); }
      else wire(pin(cs[i], up), pin(cs[i + 1], dn)); }
    if (r.seal && ja && jb) { const c = add(r.seal.part, r.x + (r.seal.dx || 20), (ja.pt[1] + jb.pt[1]) / 2); const e2 = ends(c); wire(ja, pin(c, e2.top)); wire(pin(c, e2.bot), jb); }
    if (r.top !== false) { const t = ends(cs[0]).top; const j = junc(r.x, RT); rail.t.push(j); wire(j, pin(cs[0], t)); }
    if (r.bot !== false) { const b = ends(cs[n - 1]).bot; const j = junc(r.x, RB); rail.b.push(j); wire(pin(cs[n - 1], b), j); } });
  const [rt, rb] = d.rails || ['+24V', '0V'];
  ([['t', rt, RT], ['b', rb, RB]] as const).forEach(([k, nm, y]) => { const js = rail[k].sort((a, b) => a.pt[0] - b.pt[0]); if (!js.length) return; const lab = add(['std:e_label', nm], 22, y); wire(pin(lab, ends(lab).all[0]), js[0]); for (let i = 1; i < js.length; i++) wire(js[i - 1], js[i]); });
  (d.power || []).forEach(pw => { const lab = add(['std:e_label', pw.label], pw.x - 18, RT); const cs = pw.parts.map((q, i) => add(q, pw.x, RT + 26 + i * 40));
    wire(pin(lab, ends(lab).all[0]), pin(cs[0], ends(cs[0]).top), 'power'); for (let i = 0; i < cs.length - 1; i++) { const e1 = ends(cs[i]).bot, e2 = ends(cs[i + 1]); const tgt = e2.all.length > 2 ? e2.all.slice().sort((a, b) => Math.abs(a.w.x - cs[i + 1].x) - Math.abs(b.w.x - cs[i + 1].x))[0] : e2.top; wire(pin(cs[i], e1), pin(cs[i + 1], tgt), 'power'); } });
  return { components: comps, pipes, junctions: juncs, texts: (d.texts || []).map(([x, y, s]) => ({ id: uid('t'), x, y, s, h: 3.5 })), enclosures: [], scale: 1, size: 'A3', circuitNo: 1, designerVersion: 1 };
}
/** PLC I/O sheets: one rung per I/O point (field device + PLC card), 11 rungs per sheet */
export type IO = { addr: string; sym: string; dev: EP; extra?: EP[] };
export function ioSheets(title: string, list: IO[], dir: 'in' | 'out'): EDef[] {
  const out: EDef[] = [];
  for (let i = 0; i < list.length; i += 11) { const chunk = list.slice(i, i + 11);
    out.push({ texts: [[22, 20, `${title} ${list.length > 11 ? `(${i / 11 + 1}/${Math.ceil(list.length / 11)})` : ''}`.trim()]], rungs: chunk.map((io, k) => {
      const card: EP = [dir === 'in' ? 'std:e_plc_in' : 'std:e_plc_out', io.addr, { sym: io.sym }];
      return { x: 48 + k * 31, ...(dir === 'in' ? { bot: false } : { top: false }), parts: dir === 'in' ? [io.dev, ...(io.extra || []), card] : [card, ...(io.extra || []), io.dev] }; }) });
  }
  return out;
}

// ---------- the project ----------
/** draw(ids): ids maps sheet name → sheet id, so a machine sheet can place the other sheets as assembly instances ('asm:' + id) */
export type SheetSpec = { name: string; type: 'hydraulic' | 'pneumatic' | 'electric'; draw: (ids: Record<string, string>) => any; description?: string; late?: boolean };
export type ProgSpec = { name: string; ws: any; vars: Var[]; estop?: string; estopNc?: boolean; scanMs?: number; panel?: any; sheet?: string; comment?: string; panelEdit?: (panel: any, p: Project, pr: any) => void };
export type MachineSpec = { id: string; name: string; description: string; licence: string; asm: { name: string; sheets: SheetSpec[] }[]; programs: (p: Project, ids: Record<string, string>) => ProgSpec[] };
export function machineProject(m: MachineSpec): Project {
  const pid = uid('prj'), now = nowIso();
  const root = mkNode('machine', m.name, null), progs = mkNode('programs', 'Programs', root.id);
  const p: Project = { manifest: { format: 'hydra.project', formatVersion: FORMAT_VERSION, projectId: pid, name: m.name, version: 0, created: now, modified: now, appVersion: APP_VERSION, unitSystem: 'SI-bar', template: 'machine-sample', location: '', description: m.description + ' — ' + m.licence, author: 'HYDRA samples' } as any,
    rootId: root.id, nodes: { [root.id]: root, [progs.id]: progs }, circuits: {}, programs: {}, library: [], registry: { nextId: 1, tags: {} }, stars: [], thumbnails: {} };
  const ids: Record<string, string> = {}; const todo: [SheetSpec, string][] = [];
  m.asm.forEach(a => { const an = mkNode('assembly', a.name, root.id); p.nodes[an.id] = an; root.children.push(an.id);
    a.sheets.forEach(s => { const n = mkNode('sheet', s.name, an.id, { sheetType: s.type, size: 'A3', description: s.description || '' }); p.nodes[n.id] = n; an.children.push(n.id); ids[s.name] = n.id; todo.push([s, n.id]); }); });
  const put = ([s, id]: [SheetSpec, string]) => { p.circuits[id] = { id, type: s.type, name: s.name, connections: [], sample: m.id, ...s.draw(ids), size: 'A3' }; };
  todo.filter(([s]) => !s.late).forEach(put);
  // machine sheets place the other sheets as assembly instances: their geometry is read from this project
  const was = project.peek(); try { project.value = p; todo.filter(([s]) => s.late).forEach(put); } finally { project.value = was; }
  root.children.push(progs.id);
  m.programs(p, ids).forEach((pg, i) => { const n = mkNode('program', pg.name, progs.id, { language: 'Blocks' }); p.nodes[n.id] = n; progs.children.push(n.id);
    const pr: any = { id: n.id, name: pg.name, language: 'Blocks', ws: pg.ws, vars: pg.vars, scanMs: pg.scanMs || 10, active: i === 0, estop: pg.estop, estopNc: pg.estopNc, stall: 15, comment: pg.comment || '', ...(pg.sheet ? { sheet: ids[pg.sheet] } : {}) };
    p.programs[n.id] = pr;
    if (pg.panel) pr.panel = pg.panel;
    else { // the operator panel: auto-built from the project, then adjusted by the machine
      const T = signals(p); const c = compile(pr, T);
      const { panel, newVars } = autoBuild(p, pr, T, { seqs: c.seqs.map(q => ({ name: q.name, steps: q.steps.map(s => s.id) })), counters: c.counters });
      pg.panelEdit?.(panel, p, pr);
      // auto-build adds a jog pair per cylinder: keep only the ones the program actually reads
      const wsTxt = JSON.stringify(pr.ws); const unused = new Set(newVars.filter(v => !wsTxt.includes(JSON.stringify(v.id))).map(v => v.id));
      panel.widgets = panel.widgets.filter((w: any) => ![w.p.act, w.p.act2].some((a: any) => typeof a === 'string' && unused.has(a.replace(/^var:/, ''))));
      pr.vars = [...pr.vars, ...newVars.filter(v => !unused.has(v.id))]; pr.panel = panel; }
  });
  return p;
}

/** machine sheet: the power unit on the left, the other sheets stacked on the right, joined by the P (X1) and T (X2) headers.
 *  Runs inside machineProject's late pass, so the instance geometry of the other sheets can be read. */
export function machineOf(ids: Record<string, string>, title: string, pu: string, others: string[], type: 'hydraulic' | 'pneumatic' = 'hydraulic'): FDef {
  const parts: P[] = []; const lines: L[] = []; const junctions: Record<string, [number, number]> = {};
  const at = (name: string, key: string, cx: number, cy: number) => { const m = geomOf('asm:' + ids[name]); const bx = (m.bb[0] + m.bb[2]) / 2, by = (m.bb[1] + m.bb[3]) / 2; const x = Math.round(cx - bx), y = Math.round(cy - by);
    parts.push([key, 'asm:' + ids[name], x, y, 0, false, '=' + key.slice(1)]); const port = (k: string) => { const q = m.ports.find(z => z.key === k); return q ? [x + q.x, y + q.y] : null; }; return { x1: port('X1'), x2: port('X2') }; };
  const p0 = at(pu, 'u0', 110, 150);
  const ys = others.map((_, i) => others.length === 1 ? 150 : 70 + i * (140 / (others.length - 1)));
  const os = others.map((n, i) => at(n, 'u' + (i + 1), 290, ys[i]));
  junctions.JP = [190, p0.x1![1]]; lines.push(['u0.X1', 'JP']); if (p0.x2) { junctions.JT = [205, p0.x2[1]]; lines.push(['u0.X2', 'JT']); }
  os.forEach((o, i) => { if (o.x1) lines.push(['JP', `u${i + 1}.X1`, [[190, o.x1[1]]]]); if (o.x2 && p0.x2) lines.push(['JT', `u${i + 1}.X2`, [[205, o.x2[1]]]]); });
  void type; return { parts, junctions, lines, texts: [[30, 24, title + ' — machine sheet: run the simulation and the PLC program here', 3]] };
}
