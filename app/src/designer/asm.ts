// Assemblies: a sheet with interface ports (connectors X1, X2 …) can be placed on another sheet as an instance
// (ref "asm:<sheetId>" collapsed, "asmx:<sheetId>" expanded). Instances nest. For checks, the parts list and the
// simulation, the hierarchy is flattened into one network: an instance port joins the matching connector inside.
import * as S from '../store';
import { uid, clone } from '../util';
import { unitFor, fromBase } from '../units';
import { round } from '../util';
import { geomOf, setAsmProvider, missing, CONN_REF, CONN_TIP, isConn, isAsm, splitRef, xfPoint, xfDir, portWorld, mediumOf, INK, SW, LETTER_NAME, type Geom, type PortG } from './geom';
import { contentBB, compPorts, endKey, netsOf, livePts, pipeLen, needsNormalise, keyValues, isInfinite, r2, ENCL_DASH, type Sheet, type Comp, type Issue, type BomRow } from './model';
import { sheetBody } from './render';
import { defaults } from './fields';

const fmt = (q: string, v: number) => { if (v == null || !isFinite(v)) return '—'; const u = unitFor(S.prefs.value.unitSystem, q as any); return `${round(fromBase(q, u, v), 4)} ${u}`.trim(); };
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const EMPTY: Sheet = { id: '', type: 'hydraulic', name: '', size: 'A3', components: [], pipes: [], junctions: [], texts: [], enclosures: [] };
const sheetOf = (p: any, id: string): Sheet | null => { const c = p?.circuits?.[id]; if (!c) return null; return needsNormalise(c) ? { ...EMPTY, ...c, components: (c.components || []).filter((x: any) => x.x != null && x.id) } : c; };

// ---------- interface of an assembly sheet ----------
export type Iface = { tag: string; comp: Comp; x: number; y: number; tip: number[]; dir: number; kind: string; domain: string };
export function ifaceOf(sh: Sheet): Iface[] {
  return sh.components.filter(c => isConn(c.ref)).map(c => { const w = portWorld(c, geomOf(CONN_REF).ports[0]); const tip = xfPoint(c, CONN_TIP[0], CONN_TIP[1]);
    return { tag: c.tag, comp: c, x: w.x, y: w.y, tip, dir: xfDir(c, 0), kind: c.values?.kind || 'work', domain: sh.type === 'pneumatic' ? 'pneumatic' : 'hydraulic' }; });
}

// ---------- geometry of an instance ----------
const cacheBy = new WeakMap<object, Map<string, Geom>>(); const building = new Set<string>();
function provider(ref: string, id: string, expanded: boolean): Geom {
  const p = S.project.value; const sh = sheetOf(p, id);
  if (!sh) return { ...missing(ref, 'Assembly sheet not found — it was deleted (or lives in another project)'), letter: 'U', cls: 'assembly' };
  let m = cacheBy.get(p!.circuits); if (!m) { m = new Map(); cacheBy.set(p!.circuits, m); }
  const hit = m.get(ref); if (hit) return hit;
  if (building.has(id)) return { ...missing(ref, 'Circular assembly — a sheet cannot contain itself'), letter: 'U', cls: 'assembly' };
  building.add(id); let g: Geom;
  try { g = expanded ? buildExpanded(ref, id, sh) : buildCollapsed(ref, id, sh); } finally { building.delete(id); }
  m.set(ref, g); return g;
}
setAsmProvider(provider);
const base = (ref: string, id: string, sh: Sheet, expanded: boolean): Omit<Geom, 'inner' | 'bb' | 'ports'> => ({ ref, name: sh.name, domain: sh.type === 'pneumatic' ? 'pneumatic' : 'hydraulic', category: 'Assemblies', cls: 'assembly', standard: 'Assembly instance (ISO 1219-2 boundary)', letter: 'U', specs: [], kind: 'asm', ready: true, asm: { sheet: id, expanded } });
function buildExpanded(ref: string, id: string, sh: Sheet): Geom {
  const iface = ifaceOf(sh); const b0 = contentBB(sh) || [-20, -12, 20, 12]; const b = [b0[0] - 4, b0[1] - 4, b0[2] + 4, b0[3] + 4];
  const ports: PortG[] = iface.map(i => ({ key: i.tag, name: i.tag, x: i.tip[0], y: i.tip[1], dir: i.dir, role: i.kind === 'pilot' ? 'pilot' : i.kind === 'drain' ? 'drain' : 'work', domain: i.domain }));
  ports.forEach(p => { b[0] = Math.min(b[0], p.x); b[1] = Math.min(b[1], p.y); b[2] = Math.max(b[2], p.x); b[3] = Math.max(b[3], p.y); });
  const inner = `<rect x="${r2(b[0])}" y="${r2(b[1])}" width="${r2(b[2] - b[0])}" height="${r2(b[3] - b[1])}" fill="none" stroke="${INK}" stroke-width="${SW}" stroke-dasharray="${ENCL_DASH}"/>` + sheetBody(sh, { fmt, layers: false });
  return { ...base(ref, id, sh, true), inner, bb: b, ports };
}
function buildCollapsed(ref: string, id: string, sh: Sheet): Geom {
  const iface = ifaceOf(sh); const cb = contentBB(sh) || [-20, -12, 20, 12];
  const cx = Math.round((cb[0] + cb[2]) / 2 / 5) * 5, cy = Math.round((cb[1] + cb[3]) / 2 / 5) * 5; const hw = Math.max(1, (cb[2] - cb[0]) / 2), hh = Math.max(1, (cb[3] - cb[1]) / 2);
  const edges: Record<'l' | 'r' | 't' | 'b', Iface[]> = { l: [], r: [], t: [], b: [] };
  iface.forEach(i => { const u = (i.tip[0] - cx) / hw, v = (i.tip[1] - cy) / hh; edges[Math.abs(u) >= Math.abs(v) ? (u < 0 ? 'l' : 'r') : (v < 0 ? 't' : 'b')].push(i); });
  edges.l.sort((a, b) => a.tip[1] - b.tip[1]); edges.r.sort((a, b) => a.tip[1] - b.tip[1]); edges.t.sort((a, b) => a.tip[0] - b.tip[0]); edges.b.sort((a, b) => a.tip[0] - b.tip[0]);
  const P = 10; const w = Math.max(50, P * (Math.max(edges.t.length, edges.b.length) + 1), sh.name.length * 2.3 + 14), h = Math.max(26, P * (Math.max(edges.l.length, edges.r.length) + 1));
  const x0 = cx - Math.round(w / 2 / 5) * 5, y0 = cy - Math.round(h / 2 / 5) * 5, x1 = x0 + Math.round(w / 5) * 5, y1 = y0 + Math.round(h / 5) * 5; const L = 5;
  const ports: PortG[] = []; let o = `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#fff" stroke="${INK}" stroke-width="${SW * 1.4}"/><rect x="${x0 + 1.5}" y="${y0 + 1.5}" width="${x1 - x0 - 3}" height="${y1 - y0 - 3}" fill="none" stroke="${INK}" stroke-width="${SW * 0.6}" stroke-dasharray="${ENCL_DASH}"/>`;
  o += `<text x="${(x0 + x1) / 2}" y="${(y0 + y1) / 2 + 1.2}" font-size="3.4" font-weight="700" text-anchor="middle" fill="${INK}" font-family="IBM Plex Sans, Arial, sans-serif">${esc(sh.name)}</text>`;
  const place = (list: Iface[], side: 'l' | 'r' | 't' | 'b') => list.forEach((i, k) => {
    const n = list.length; const along = side === 'l' || side === 'r' ? y0 + (y1 - y0) * (k + 1) / (n + 1) : x0 + (x1 - x0) * (k + 1) / (n + 1); const a = Math.round(along / 2.5) * 2.5;
    const [ex, ey, px, py, dir, tx, ty, an] = side === 'l' ? [x0, a, x0 - L, a, 180, x0 + 2.5, a + 1, 'start'] : side === 'r' ? [x1, a, x1 + L, a, 0, x1 - 2.5, a + 1, 'end'] : side === 't' ? [a, y0, a, y0 - L, 270, a, y0 + 4, 'middle'] : [a, y1, a, y1 + L, 90, a, y1 - 2.2, 'middle'];
    o += `<line x1="${ex}" y1="${ey}" x2="${px}" y2="${py}" stroke="${INK}" stroke-width="${SW}" ${i.kind !== 'work' ? 'stroke-dasharray="1.5 0.9"' : ''}/><text x="${tx}" y="${ty}" font-size="2.6" text-anchor="${an}" fill="${INK}" font-family="JetBrains Mono, Consolas, monospace">${esc(i.tag)}</text>`;
    ports.push({ key: i.tag, name: i.tag, x: px as number, y: py as number, dir: dir as number, role: i.kind === 'pilot' ? 'pilot' : i.kind === 'drain' ? 'drain' : 'work', domain: i.domain });
  });
  (['l', 'r', 't', 'b'] as const).forEach(sd => place(edges[sd], sd));
  return { ...base(ref, id, sh, false), inner: o, bb: [x0 - L, y0 - L, x1 + L, y1 + L], ports };
}

// ---------- hierarchy queries ----------
export const childOf = (c: Comp) => isAsm(c.ref) ? splitRef(c.ref)[1] : null;
export function contains(p: any, outer: string, inner: string, seen = new Set<string>()): boolean { // does sheet `outer` (transitively) contain `inner`?
  if (seen.has(outer)) return false; seen.add(outer); const sh = p?.circuits?.[outer]; if (!sh) return false;
  return (sh.components || []).some((c: Comp) => { const ch = childOf(c); return ch && (ch === inner || contains(p, ch, inner, seen)); });
}
export const canPlace = (p: any, host: string, child: string) => host !== child && !contains(p, child, host);
export function usesOf(p: any, sheetId: string) { const out: { sheet: string; comp: Comp }[] = []; Object.values(p?.circuits || {}).forEach((c: any) => (c.components || []).forEach((x: Comp) => { if (childOf(x) === sheetId) out.push({ sheet: c.id, comp: x }); })); return out; }
export const isAssemblySheet = (sh: any) => (sh?.components || []).some((c: Comp) => isConn(c.ref));

// ---------- flatten (one network for checks, parts list and simulation) ----------
export type FlatEl = { key: string; path: string; tag: string; comp: Comp; g: Geom; values: Record<string, any>; sheet: string; medium: string; ports: Record<string, number> };
export type Flat = { els: FlatEl[]; n: number; medium: string[]; kind: string[]; vol: number[]; area: number[]; labels: string[][]; pipeNode: Map<string, number>; portNode: Map<string, number>; issues: Issue[]; deg: number[];
  // line graph (for the flow in each line): raw end keys of every pipe, zero-length links (assembly port ↔ connector), raw key of every element port
  pipeEnds: Map<string, [string, string]>; pipeArea: Map<string, number>; pipeKind: Map<string, string>; links: [string, string][]; portRaw: Map<string, string> };
export function flatten(p: any, sheetId: string): Flat {
  const parent = new Map<string, string>(); const find = (k: string): string => { let r = k; while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!; let x = k; while (parent.has(x) && parent.get(x) !== r) { const nx = parent.get(x)!; parent.set(x, r); x = nx; } if (!parent.has(r)) parent.set(r, r); return r; };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  const links: [string, string][] = [];
  const els: { e: Omit<FlatEl, 'ports'>; pk: [string, string, string][] }[] = []; const pipes: { key: string; end: string; kb: string; len: number; area: number; kind: string; medium: string }[] = []; const issues: Issue[] = [];
  const visit = (id: string, path: string, pre: string, ovs: { obj: any; pre: string }[], stack: string[]) => {
    const sh = sheetOf(p, id); if (!sh) { issues.push({ level: 'err', text: `Assembly sheet ${id} is missing` }); return; }
    const med = sh.type === 'pneumatic' ? 'pneumatic' : 'hydraulic';
    sh.pipes.forEach(pp => { const ka = path + '|' + (pp.a ? endKey(pp.a) : `f:${pp.id}:a`), kb = path + '|' + (pp.b ? endKey(pp.b) : `f:${pp.id}:b`); union(ka, kb);
      const d = pipeBore(pp.size, med); pipes.push({ key: path + '|' + pp.id, end: ka, kb, len: pp.len && pp.len > 0 ? pp.len : Math.max(0.3, pipeLen(livePts(sh, pp)) / 1000 * 4), area: Math.PI * d * d / 4, kind: pp.kind, medium: med }); });
    sh.components.forEach(c => {
      const g = geomOf(c.ref);
      if (g.kind === 'conn') return;
      if (g.kind === 'asm') {
        const ch = g.asm!.sheet; if (stack.includes(ch)) { issues.push({ level: 'err', text: `${pre}${c.tag}: circular assembly`, ids: [c.id] }); return; }
        const csh = sheetOf(p, ch); if (!csh) { issues.push({ level: 'err', text: `${pre}${c.tag}: assembly sheet not found`, ids: [c.id] }); return; }
        const cpath = path + c.id + '/';
        csh.components.filter(x => isConn(x.ref)).forEach(x => { union(path + '|c:' + c.id + ':' + x.tag, cpath + '|c:' + x.id + ':X'); links.push([path + '|c:' + c.id + ':' + x.tag, cpath + '|c:' + x.id + ':X']); });
        visit(ch, cpath, pre + c.tag + '/', [...ovs.map(o => ({ obj: o.obj, pre: o.pre + c.id + '/' })), { obj: c.values?.ov || {}, pre: '' }], [...stack, ch]); return;
      }
      if (g.kind === 'missing') { issues.push({ level: 'err', text: `${pre}${c.tag}: library part not found`, ids: [c.id] }); return; }
      const values = { ...defaults(g), ...(c.values || {}) }; ovs.forEach(o => Object.assign(values, o.obj?.[o.pre + c.id] || {}));
      const pk = compPorts(c, g, sh.type).filter(q => q.domain !== 'electrical').map(q => [q.key, path + '|c:' + c.id + ':' + q.key, q.domain] as [string, string, string]); pk.forEach(([, k]) => find(k));
      els.push({ e: { key: path + c.id, path, tag: pre + c.tag, comp: c, g, values, sheet: id, medium: med }, pk });
    });
  };
  visit(sheetId, '', '', [], [sheetId]);
  const idx = new Map<string, number>(); const nodeOf = (k: string) => { const r = find(k); let i = idx.get(r); if (i == null) { i = idx.size; idx.set(r, i); } return i; };
  const portNode = new Map<string, number>(), portRaw = new Map<string, string>(); const out: FlatEl[] = els.map(({ e, pk }) => { const ports: Record<string, number> = {}; pk.forEach(([key, k]) => { const n = nodeOf(k); ports[key] = n; portNode.set(e.key + ':' + key, n); portRaw.set(e.key + ':' + key, k); }); return { ...e, ports }; });
  const pipeEnds = new Map<string, [string, string]>(), pipeArea = new Map<string, number>(), pipeKind = new Map<string, string>(); pipes.forEach(q => { pipeEnds.set(q.key, [q.end, q.kb]); pipeArea.set(q.key, q.area); pipeKind.set(q.key, q.kind); });
  const pipeNode = new Map<string, number>(); pipes.forEach(q => pipeNode.set(q.key, nodeOf(q.end)));
  const n = idx.size; const medium = Array(n).fill(''), kind = Array(n).fill(''), vol = Array(n).fill(0), area = Array(n).fill(0), labels: string[][] = Array.from({ length: n }, () => []), deg = Array(n).fill(0);
  out.forEach(e => Object.entries(e.ports).forEach(([key, nn]) => { const q = e.g.ports.find(x => x.key === key)!; const m = mediumOf(e.g, q.domain, e.medium); if (!medium[nn] && (m === 'hydraulic' || m === 'pneumatic')) medium[nn] = m; labels[nn].push(`${e.tag}.${q.name}`); deg[nn]++; }));
  pipes.forEach(q => { const nn = pipeNode.get(q.key)!; vol[nn] += q.len * q.area; area[nn] = Math.max(area[nn], q.area); if (!medium[nn]) medium[nn] = q.medium; if (!kind[nn] || q.kind === 'work') kind[nn] = q.kind; deg[nn]++; });
  for (let i = 0; i < n; i++) if (!medium[i]) medium[i] = 'hydraulic';
  // mixed media in one net
  const mix = new Map<number, Set<string>>(); out.forEach(e => Object.entries(e.ports).forEach(([key, nn]) => { const q = e.g.ports.find(x => x.key === key)!; const m = mediumOf(e.g, q.domain, e.medium); if (m === 'hydraulic' || m === 'pneumatic') { const s = mix.get(nn) || new Set(); s.add(m); mix.set(nn, s); } }));
  mix.forEach((s, nn) => { if (s.size > 1) issues.push({ level: 'err', text: `A line joins hydraulic and pneumatic ports: ${labels[nn].slice(0, 6).join(', ')}` }); });
  return { els: out, n, medium, kind, vol, area, labels, pipeNode, portNode, issues, deg, pipeEnds, pipeArea, pipeKind, links, portRaw };
}
export function pipeBore(size: string | undefined, medium: string) { const m = /(\d+(?:[.,]\d+)?)/.exec(size || ''); let d = m ? parseFloat(m[1].replace(',', '.')) : medium === 'pneumatic' ? 6 : 10; if (/"|inch|in\b/.test(size || '')) d *= 25.4; return Math.max(1, Math.min(200, d)) / 1000; }

// ---------- assembly rules for one sheet ----------
export function asmRules(sh: Sheet, p: any): Issue[] {
  const out: Issue[] = [];
  const conns = sh.components.filter(c => isConn(c.ref));
  const seen: Record<string, string[]> = {}; conns.forEach(c => (seen[c.tag] ||= []).push(c.id));
  Object.entries(seen).filter(([, v]) => v.length > 1).forEach(([tg, v]) => out.push({ level: 'err', text: `Interface port ${tg} is used ${v.length} times — interface tags must be unique on an assembly sheet`, ids: v }));
  if (conns.length) { const uses = usesOf(p, sh.id); out.push({ level: 'info', text: `Assembly sheet · ${conns.length} interface port${conns.length > 1 ? 's' : ''} (${conns.map(c => c.tag).join(', ')}) · used ${uses.length}×` }); }
  const insts = sh.components.filter(c => isAsm(c.ref));
  // only equal tags may be linked; links to removed ports
  const tagOf = (q: { c: string; p: string }) => { const c = sh.components.find(x => x.id === q.c); if (!c) return null; if (isConn(c.ref)) return c.tag; if (isAsm(c.ref)) return q.p; return null; };
  netsOf(sh).forEach(n => { const tags = [...new Set(n.ports.map(tagOf).filter(Boolean))]; if (tags.length > 1) out.push({ level: 'err', text: `Interface ports with different tags are linked (${tags.join(' ↔ ')}) — only the same tag may be connected`, ids: n.pipes }); });
  sh.pipes.forEach(pp => [pp.a, pp.b].forEach(e => { if (!e || !('c' in e)) return; const c = sh.components.find(x => x.id === e.c); if (!c || !isAsm(c.ref)) return; const g = geomOf(c.ref); if (g.kind === 'asm' && !g.ports.some(q => q.key === e.p)) out.push({ level: 'err', text: `Link to ${c.tag}.${e.p} lost — the assembly “${g.name}” no longer has port ${e.p}`, ids: [pp.id, c.id] }); }));
  insts.forEach(c => { if (p && !canPlace(p, sh.id, childOf(c)!)) out.push({ level: 'err', text: `${c.tag}: circular assembly — “${geomOf(c.ref).name}” contains this sheet`, ids: [c.id] }); });
  if (insts.length) { const f = flatten(p, sh.id); out.push(...f.issues); out.push({ level: 'info', text: `Machine: ${insts.length} assembl${insts.length > 1 ? 'ies' : 'y'} · ${f.els.length} parts in total · ${f.n} nets after flattening` }); }
  return out;
}

// ---------- parts list over the hierarchy ----------
export function bomDeep(sh: Sheet, p: any, fm: (q: string, v: number) => string): BomRow[] {
  const f = flatten(p, sh.id); const order = 'PMAVSZ';
  return f.els.map(e => ({ item: 0, tag: e.tag, name: e.g.name, standard: e.g.standard, letter: e.g.letter, group: LETTER_NAME[e.g.letter] || '', values: keyValues({ ...e.comp, values: e.values }, e.g, fm), ref: e.comp.ref, qty: 1, desc: e.comp.desc || '' }))
    .sort((a, b) => (order.indexOf(a.letter) - order.indexOf(b.letter)) || a.tag.localeCompare(b.tag, undefined, { numeric: true })).map((r, i) => ({ ...r, item: i + 1 }));
}

// ---------- simulation netlist v2 (whole machine, path tags) ----------
export function netlist2(sh: Sheet, p: any) {
  const f = flatten(p, sh.id);
  return { schema: 'hydra.netlist/2', sheet: sh.id, name: sh.name, project: p?.manifest?.name, generated: new Date().toISOString(),
    components: f.els.map(e => ({ path: e.key, tag: e.tag, ref: e.comp.ref, cls: e.g.cls, letter: e.g.letter, sheet: e.sheet, values: e.values, valve: e.g.valve ? JSON.parse(JSON.stringify(e.g.valve)) : undefined, ports: Object.entries(e.ports).map(([k, n]) => ({ key: k, name: e.g.ports.find(q => q.key === k)?.name, net: 'N' + (n + 1) })) })),
    nets: Array.from({ length: f.n }, (_, i) => ({ id: 'N' + (i + 1), medium: f.medium[i], kind: f.kind[i] || 'none', ports: f.labels[i], volume_l: Math.round(f.vol[i] * 1e6) / 1000 })), issues: f.issues.map(i => i.text) };
}

// ---------- actions ----------
const edit = (sheetId: string, label: string, fn: (c: Sheet, d: S.Project) => void) => S.mutate(label, d => { const c = d.circuits[sheetId] as Sheet; if (c) fn(c, d); });
export function setExpanded(sheetId: string, ids: string[], on: boolean) {
  edit(sheetId, on ? 'Expand assembly' : 'Collapse assembly', c => c.components.forEach(x => { if (ids.includes(x.id) && isAsm(x.ref)) x.ref = (on ? 'asmx:' : 'asm:') + splitRef(x.ref)[1]; }));
}
export function setOverride(sheetId: string, instId: string, rel: string, key: string, val: any) {
  edit(sheetId, 'Instance value', c => { const x = c.components.find(q => q.id === instId); if (!x) return; const v = x.values = { ...(x.values || {}) }; const ov = v.ov = { ...(v.ov || {}) }; if (val === undefined) { const o = { ...(ov[rel] || {}) }; delete o[key]; if (Object.keys(o).length) ov[rel] = o; else delete ov[rel]; } else ov[rel] = { ...(ov[rel] || {}), [key]: val }; });
}
// copy an assembly sheet (and everything it nests) from another open project into this one
export function importAssembly(src: S.Project, sheetId: string): string | null {
  const dst = S.project.value; if (!dst) return null;
  const need: string[] = []; const walk = (id: string) => { if (need.includes(id)) return; need.push(id); (src.circuits[id]?.components || []).forEach((c: Comp) => { const ch = childOf(c); if (ch) walk(ch); }); }; walk(sheetId);
  const map: Record<string, string> = {}; need.forEach(id => map[id] = uid('sh'));
  const libs = new Set<string>(); need.forEach(id => (src.circuits[id]?.components || []).forEach((c: Comp) => { const [k, i] = splitRef(c.ref); if (k === 'lib') libs.add(i); }));
  S.mutate('Import assembly', d => {
    let folder = Object.values(d.nodes).find(n => n.type === 'assembly' && n.name === 'Imported assemblies');
    if (!folder) { folder = S.mkNode('assembly', 'Imported assemblies', d.rootId); d.nodes[folder.id] = folder; d.nodes[d.rootId].children.push(folder.id); }
    need.forEach(id => { const sn = src.nodes[id], sc = clone(src.circuits[id]); const nid = map[id];
      sc.id = nid; (sc.components || []).forEach((c: Comp) => { const ch = childOf(c); if (ch && map[ch]) c.ref = c.ref.slice(0, c.ref.indexOf(':') + 1) + map[ch]; });
      d.nodes[nid] = { ...S.mkNode('sheet', (sn?.name || sc.name) + (id === sheetId ? '' : ''), folder!.id, { sheetType: sc.type, size: sc.size, description: `Imported from “${src.manifest.name}”` }), id: nid }; d.nodes[folder!.id].children.push(nid); d.circuits[nid] = sc; });
    libs.forEach(i => { const it = src.library.find((x: any) => x.item_id === i); if (it && !d.library.some((x: any) => x.item_id === i)) d.library.push(clone(it)); });
  });
  S.toast(`Imported “${src.nodes[sheetId]?.name}” (${need.length} sheet${need.length > 1 ? 's' : ''}) from “${src.manifest.name}”`, 'ok');
  return map[sheetId];
}
// give one instance its own copy of the assembly sheet
export function makeIndependent(hostId: string, instId: string) {
  const p = S.project.value!; const c = (p.circuits[hostId] as Sheet).components.find(x => x.id === instId); if (!c) return; const ch = childOf(c)!;
  const made = S.duplicateNodes([ch]); const nid = made?.[0]; if (!nid) return;
  edit(hostId, 'Make independent copy', cc => { const x = cc.components.find(q => q.id === instId); if (x) x.ref = x.ref.slice(0, x.ref.indexOf(':') + 1) + nid; });
  S.toast(`${c.tag} now uses its own copy “${S.project.value!.nodes[nid]?.name}”`, 'ok');
}
// a machine sheet with one instance per assembly sheet; ports whose tag appears on exactly two instances are linked
export function buildMachine(): string | null {
  const p = S.project.value; if (!p) return null;
  const asms = Object.values(p.nodes).filter(n => n.type === 'sheet' && n.sheetType !== 'electric' && isAssemblySheet(p.circuits[n.id]) && !usesOf(p, n.id).length);
  if (!asms.length) { S.toast('No assembly sheets yet — add interface ports (X) to the sheets you want to combine', 'warn'); return null; }
  const id = S.addNode('sheet', null, (asms[0].sheetType as any) || 'hydraulic', 'Machine'); if (!id) return null;
  // full circuits side by side (60 mm apart); every assembly keeps its own drawing, the links run below them
  let x = 0; const placed: Comp[] = []; let top = 1e9, bottom = -1e9;
  asms.forEach(n => { const g = geomOf('asmx:' + n.id); top = Math.min(top, g.bb[1]); bottom = Math.max(bottom, g.bb[3]); });
  asms.forEach(n => { const g = geomOf('asmx:' + n.id); const w = g.bb[2] - g.bb[0]; placed.push({ id: uid('c'), ref: 'asmx:' + n.id, tag: 'U' + (placed.length + 1), x: Math.round((x - g.bb[0]) / 5) * 5, y: Math.round(-top / 5) * 5, rot: 0, values: { ov: {} } }); x += w + 60; });
  const ports = placed.flatMap(c => geomOf(c.ref).ports.map(q => ({ c, q, w: portWorld(c, q) })));
  const byTag: Record<string, typeof ports> = {}; ports.forEach(o => (byTag[o.q.key] ||= []).push(o));
  const lane0 = Math.round((bottom - top + 25) / 5) * 5; let k = 0;
  const step = (o: typeof ports[0]) => { const d = ((o.q.dir % 360) + 360) % 360; const L = 8; return d === 0 ? [o.w.x + L, o.w.y] : d === 180 ? [o.w.x - L, o.w.y] : d === 90 ? [o.w.x, o.w.y + L] : [o.w.x, o.w.y - L]; };
  const pipes = Object.values(byTag).filter(l => l.length === 2 && l[0].c !== l[1].c).sort((p1, p2) => Math.abs(p1[0].w.x - p1[1].w.x) - Math.abs(p2[0].w.x - p2[1].w.x)).map(([a, b]) => {
    const lane = lane0 + 10 * (k++); const sa = step(a), sb = step(b);
    const pts = [[a.w.x, a.w.y], sa, [sa[0], lane], [sb[0], lane], sb, [b.w.x, b.w.y]].map(q => [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]);
    return { id: uid('p'), kind: (a.q.role === 'pilot' ? 'pilot' : a.q.role === 'drain' ? 'drain' : 'work') as any, a: { c: a.c.id, p: a.q.key }, b: { c: b.c.id, p: b.q.key }, pts }; });
  S.mutate('Build machine', d => { const c = d.circuits[id] as any; c.mode = 'infinite'; c.components = placed; c.pipes = pipes; c.junctions = []; c.texts = []; c.enclosures = []; c.scale = 1; c.circuitNo = 0; c.designerVersion = 1; });
  S.toast(`Machine sheet: ${placed.length} assemblies, ${pipes.length} link${pipes.length === 1 ? '' : 's'} made by matching tags`, 'ok');
  return id;
}
export { isInfinite };
