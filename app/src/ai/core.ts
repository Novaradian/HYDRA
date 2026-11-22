// AI command layer — shared helpers: errors, sheet / part / port lookup, values in AI units, compact circuit JSON.
// Everything here reads or changes a project object (a draft inside S.mutate, or a copy); nothing touches the UI.
import { produce } from 'immer';
import { round } from '../util';
import { toBase, fromBase, unitFor, UNITS } from '../units';
import { geomOf, splitRef, isConn, isAsm, type Geom, type PortG } from '../designer/geom';
import { fieldsFor, defaults, type Field } from '../designer/fields';
import { netsOf, needsNormalise, normalise, type Sheet, type Comp, type Pipe, type End } from '../designer/model';
import type { Project } from '../store';

/** a command error the caller (panel, MCP, CLI) can show as is */
/** plain decimal rounding for numbers in JSON (util.round gives display text with significant digits) */
export const rn = (v: number, d = 2) => { const f = 10 ** d; return Math.round((+v || 0) * f) / f; };

export class AiError extends Error { details?: string[]; constructor(msg: string, details?: string[]) { super(msg); this.details = details; } }
export const fail = (msg: string, details?: string[]): never => { throw new AiError(msg, details); };

// ---------- sheets ----------
export const FLUID = new Set(['hydraulic', 'pneumatic']);
export function sheetList(p: Project) {
  return Object.values(p.nodes).filter(n => n.type === 'sheet' && p.circuits[n.id]).map(n => ({ id: n.id, name: n.name, type: (p.circuits[n.id] as Sheet).type || n.sheetType || 'hydraulic' }));
}
/** sheet by id or name (any case); default: the given fallback id, else the first fluid sheet */
export function findSheet(p: Project, ref: string | undefined, fallback?: string | null): Sheet {
  const all = sheetList(p);
  const want = (ref || '').trim();
  const hit = want ? all.find(s => s.id === want) || all.find(s => s.name.toLowerCase() === want.toLowerCase()) : all.find(s => s.id === fallback) || all.find(s => FLUID.has(s.type));
  if (!hit) fail(want ? `No sheet "${want}"` : 'The project has no hydraulic or pneumatic sheet', all.map(s => `${s.id} · ${s.name} (${s.type})`));
  return p.circuits[hit!.id] as Sheet;
}
/** a sheet for reading: sheets never opened in the designer are normalised on a copy, the project is not touched */
export function readSheet(p: Project, ref: string | undefined, fallback?: string | null): { p: Project; sh: Sheet } {
  const sh = findSheet(p, ref, fallback); if (!needsNormalise(sh)) return { p, sh };
  const p2 = produce(p, d => { normalise(d.circuits[sh.id]); }) as Project; return { p: p2, sh: p2.circuits[sh.id] as Sheet };
}
/** a sheet AI may edit: hydraulic or pneumatic, normalised (inside a draft) */
export function editableSheet(p: Project, ref: string | undefined, fallback?: string | null): Sheet {
  const sh = findSheet(p, ref, fallback);
  if (!FLUID.has(sh.type)) fail(`Sheet "${sh.name}" is ${sh.type} — AI can only edit hydraulic and pneumatic sheets`);
  if (needsNormalise(sh)) normalise(sh);
  return sh;
}

// ---------- parts and ports ----------
export function normRef(ref: string) { const r = String(ref || '').trim(); return /^(std|lib):/.test(r) ? r : 'std:' + r; }
export function partGeom(ref: string): Geom {
  const r = normRef(ref);
  if (isAsm(r) || isConn(r)) fail(`${ref}: assemblies and interface ports are placed by hand`);
  const g = geomOf(r); if (g.kind === 'missing') fail(`Unknown part "${ref}" — use search_library to find its ref`);
  return g;
}
export function compByTag(sh: Sheet, tag: string): Comp {
  const c = sh.components.find(x => x.tag === tag) || sh.components.find(x => x.tag.toLowerCase() === String(tag).toLowerCase());
  if (!c) fail(`No part ${tag} on sheet "${sh.name}"`, [`Tags on this sheet: ${sh.components.map(x => x.tag).join(', ') || 'none'}`]);
  return c!;
}
export const portLabel = (g: Geom, p: PortG) => (g.ports.filter(q => q.name === p.name).length > 1 ? p.key : p.name);
export function portOf(c: Comp, name: string): PortG {
  const g = geomOf(c.ref); const n = String(name).trim();
  const p = g.ports.find(q => q.key === n) || g.ports.find(q => q.name === n) || g.ports.find(q => q.name.toLowerCase() === n.toLowerCase() || q.key.toLowerCase() === n.toLowerCase());
  if (!p) fail(`${c.tag} has no port "${name}"`, [`Ports of ${c.tag}: ${g.ports.map(q => portLabel(g, q)).join(', ')}`]);
  return p!;
}
/** "1V1.P" → part + port */
export function parseEnd(sh: Sheet, s: string, alias?: Map<string, string>) {
  const m = /^(.+)\.([^.]+)$/.exec(String(s || '').trim()); if (!m) fail(`"${s}" is not a port — write TAG.PORT, e.g. 1V1.P`);
  const c = compByTag(sh, alias?.get(m![1]) || m![1]); const p = portOf(c, m![2]);
  return { c, p, end: { c: c.id, p: p.key } as End };
}
export const endOf = (sh: Sheet, e: End) => { if (!e) return 'open'; if ('j' in e) return 'J' + (sh.junctions.findIndex(j => j.id === e.j) + 1); const c = sh.components.find(x => x.id === e.c); if (!c) return '?'; const g = geomOf(c.ref); const p = g.ports.find(q => q.key === e.p); return `${c.tag}.${p ? portLabel(g, p) : e.p}`; };
export const pipesAt = (sh: Sheet, cid: string, key?: string) => sh.pipes.filter(p => [p.a, p.b].some(e => e && 'c' in e && e.c === cid && (key == null || e.p === key)));

// ---------- values: AI reads and writes them in fixed units (bar, L/min, mm …) whatever the user's unit system ----------
export const aiUnit = (f: Field) => f.qty === 'none' ? (f.unit || '') : unitFor('SI-bar', f.qty as any);
export function fmtValue(f: Field, v: any): any {
  if (v == null) return null;
  if (f.qty === 'select' || f.qty === 'text') return v;
  if (f.qty === 'table') return Array.isArray(v) ? `table (${v.length} rows)` : v;
  if (typeof v !== 'number') return v;
  if (f.qty === 'none') return f.unit ? `${round(v, 4)} ${f.unit}` : round(v, 4);
  const u = aiUnit(f); return `${round(fromBase(f.qty, u, v), 4)} ${u}`;
}
export function parseValue(f: Field, v: any, tag = ''): any {
  const who = `${tag ? tag + '.' : ''}${f.key}`;
  if (f.qty === 'select') { const s = String(v); const o = f.options!.find(x => x === s) || f.options!.find(x => x.toLowerCase() === s.toLowerCase()); if (!o) fail(`${who}: "${v}" is not an option`, [`Options: ${f.options!.join(' | ')}`]); return o; }
  if (f.qty === 'text') return String(v ?? '');
  if (f.qty === 'table') return fail(`${who} is a table — set it in Properties`);
  let num: number, unit = aiUnit(f);
  if (typeof v === 'number') num = v;
  else { const m = /^\s*([-+]?\d*[.,]?\d+(?:e[-+]?\d+)?)\s*(.*?)\s*$/i.exec(String(v ?? '')); if (!m) fail(`${who}: "${v}" is not a number`); num = parseFloat(m![1].replace(',', '.')); if (m![2]) unit = m![2]; }
  if (!isFinite(num!)) fail(`${who}: "${v}" is not a number`);
  let base = num!;
  if (f.qty !== 'none') { if (!UNITS[f.qty]?.[unit]) fail(`${who}: unknown unit "${unit}"`, [`Units: ${Object.keys(UNITS[f.qty] || {}).join(', ')}`]); base = toBase(f.qty, unit, num!); }
  if (f.min != null && base < f.min - 1e-12) fail(`${who}: below the minimum ${fmtValue(f, f.min)}`);
  if (f.max != null && base > f.max + 1e-12) fail(`${who}: above the maximum ${fmtValue(f, f.max)}`);
  return base;
}
export function fieldOf(c: Comp, key: string): Field {
  const fs = fieldsFor(geomOf(c.ref)); const f = fs.find(x => x.key === key) || fs.find(x => x.key.toLowerCase() === String(key).toLowerCase() || x.label.toLowerCase() === String(key).toLowerCase());
  if (!f) fail(`${c.tag} has no value "${key}"`, [`Values of ${c.tag}: ${fs.filter(x => x.qty !== 'table').map(x => `${x.key} (${x.label}${aiUnit(x) ? ', ' + aiUnit(x) : ''})`).join('; ')}`]);
  return f!;
}
export function applyValues(c: Comp, vals: Record<string, any> | undefined) {
  if (!vals) return; c.values = c.values || defaults(geomOf(c.ref));
  for (const [k, v] of Object.entries(vals)) { const f = fieldOf(c, k); c.values[f.key] = parseValue(f, v, c.tag); }
}

// ---------- compact JSON (what the AI reads) ----------
export function partJson(c: Comp, full = false) {
  const g = geomOf(c.ref); const fs = fieldsFor(g); const d = defaults(g); const v: Record<string, any> = {};
  fs.forEach(f => { const x = c.values?.[f.key]; if (x === undefined || f.qty === 'table') return; if (!full && JSON.stringify(x) === JSON.stringify(d[f.key])) return; v[f.key] = fmtValue(f, x); });
  const o: any = { tag: c.tag, ref: c.ref, name: g.name, x: rn(c.x), y: rn(c.y) };
  if (c.rot) o.rot = c.rot; if (c.mirror) o.mirror = true; if (Object.keys(v).length) o.v = v; if (c.desc) o.desc = c.desc;
  return o;
}
export function sheetJson(sh: Sheet) {
  const nets = netsOf(sh).map(n => {
    const kinds = [...new Set(n.pipes.map(id => sh.pipes.find(p => p.id === id)?.kind).filter(Boolean))];
    const ports = n.ports.map(q => { const c = sh.components.find(x => x.id === q.c); if (!c) return '?'; const g = geomOf(c.ref); const p = g.ports.find(x => x.key === q.p); return `${c.tag}.${p ? portLabel(g, p) : q.p}`; });
    return { kind: kinds.join('/') || 'work', ports };
  }).filter(n => n.ports.length);
  const open = sh.pipes.filter(p => !p.a || !p.b).length;
  return { sheet: sh.id, name: sh.name, type: sh.type, parts: sh.components.filter(c => !isAsm(c.ref) && !isConn(c.ref)).map(c => partJson(c)),
    ...(sh.components.some(c => isAsm(c.ref) || isConn(c.ref)) ? { other: sh.components.filter(c => isAsm(c.ref) || isConn(c.ref)).map(c => ({ tag: c.tag, ref: c.ref })) } : {}),
    nets, ...(open ? { openLines: open } : {}) };
}
export const refId = (ref: string) => splitRef(ref)[1];
export type { Sheet, Comp, Pipe, End };
