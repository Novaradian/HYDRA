// Logic Coder: the machine link — the PLC program and the hydraulic simulation run together.
// Inputs:  position sensors (electric sheet, “watches” a cylinder) and cylinder end blocks read the actuators;
//          pressure / temperature / level switches read their fluid parts; analog values read positions, speeds, gauges.
//          Operator devices (pushbuttons, selector switches, E-stop) stay manual: I/O table, sheet strip, operator panel.
// Outputs: a PLC output wired to a solenoid coil (or a solenoid used directly) energises that valve solenoid — the valve
//          shifts, and springs back when de-energised; a pump motor output starts / stops the pump; proportional and
//          displacement outputs set the live command. Only parts the program actually uses are taken over.
import { geomOf, isConn, isAsm } from '../designer/geom';
import * as E from '../designer/elec';
import * as A from '../designer/asm';
import type { Sim } from '../designer/sim';
import type { SigTable } from './signals';
import type { Adapter, Plc } from './runtime';
import type { Compiled, Program } from './compile';

const idOf = (g: any) => g?.item?.id || '';
const FLUID_SWITCH: Record<string, RegExp> = { e_pswitch: /pswitch|pe_switch|vacswitch/, e_tswitch: /tempswitch|thermo|tempctrl/, e_float: /levelswitch|level/ };
export type InSrc = { kind: 'pos'; watch: string; end: string; wpos: number; nc: boolean } | { kind: 'fsw'; tag: string; re: RegExp; nc: boolean } | { kind: 'manual'; momentary: boolean; nc: boolean; dev: string; func: string };

// what drives each PLC input (from the devices wired to it on the electric sheets)
export function inputSources(p: any, T: SigTable): Map<string, InSrc> {
  const out = new Map<string, InSrc>(); if (!p) return out;
  E.plcIo(p).filter(r => r.dir === 'in').forEach(r => {
    const id = 'plc:' + r.ref.comp.id; let src: InSrc | null = null;
    for (const d of r.devices) { const did = idOf(d.ref.g); const v = d.ref.comp.values || {};
      if (E.POS_SENSORS.has(did) && String(v.watch || '').trim()) { src = { kind: 'pos', watch: String(v.watch).trim(), end: String(v.wend || 'Extended (+)'), wpos: +v.wpos || 0, nc: /_nc$/.test(did) }; break; }
      if (FLUID_SWITCH[did]) { src = { kind: 'fsw', tag: String(d.ref.comp.tag || '').trim(), re: FLUID_SWITCH[did], nc: /_nc$/.test(did) }; break; } }
    if (!src) { const d = r.devices.find(x => x.ref.g.domain === 'electrical'); const did = d ? idOf(d.ref.g) : ''; const cls = d?.ref.g.cls || '';
      src = { kind: 'manual', momentary: cls === 'pushbutton' || /estop|_pb|foot/.test(did), nc: /_nc$|estop/.test(did), dev: d ? String(d.ref.comp.tag || '') : '', func: d ? String(d.ref.comp.values?.func || d.ref.g.name.split(',')[0]) : '' }; }
    out.set(id, src);
  });
  T.sigs.filter(s => s.dir === 'in' && s.src === 'psw').forEach(s => out.set(s.id, { kind: 'fsw', tag: '', re: /./, nc: false }));
  return out;
}
// NC devices (stop buttons, E-stop) read TRUE while not pressed
export function inputDefaults(p: any, T: SigTable): Record<string, boolean> {
  const d: Record<string, boolean> = {}; inputSources(p, T).forEach((s, id) => { if (s.nc && s.kind === 'manual') d[id] = true; }); return d;
}

// the sheet the machine runs on: the program's choice, else the top-level fluid sheet with the most solenoid valves / assemblies
export function machineSheet(p: any, pr: Program): string | null {
  if (!p || pr.sheet === 'none') return null;
  const fluid = E.fluidSheets(p).filter(s => (s.components || []).length);
  if (pr.sheet && fluid.some(s => s.id === pr.sheet)) return pr.sheet;
  const top = fluid.filter(s => !A.usesOf(p, s.id).length); const list = top.length ? top : fluid; if (!list.length) return null;
  const score = (s: any) => s.components.reduce((n: number, c: any) => { if (isAsm(c.ref)) return n + 3; if (isConn(c.ref)) return n; const g = geomOf(c.ref); return n + (E.solenoidSides(g).length ? 2 : 0) + (g.cls === 'cylinder' ? 1 : 0); }, 0);
  return [...list].sort((a, b) => score(b) - score(a))[0].id;
}

export type SimLink = Adapter & { linked: Set<string>; detach(): void; sim: Sim; tBase: number; manual: Map<string, InSrc> };
export function simAdapter(p: any, pr: Program, c: Compiled, sim: Sim, T: SigTable): SimLink {
  const els = sim.els as any[]; const used = c.used;
  const byComp = (cid: string) => els.filter(e => e.el?.comp?.id === cid);
  const acts = els.filter(e => e.kind === 'actuator');
  const actByTag = (tag: string) => acts.filter(e => e.tag === tag || e.tag.endsWith('/' + tag));
  const atEnd = (a: any, end: string, wpos = 0) => { const st = a.state; const tol = a.rot ? 0.02 : 0.002; return end.startsWith('Ret') || end === 'm' ? st.x <= tol : end.startsWith('At') ? Math.abs(st.x - wpos) <= tol : st.x >= st.L - tol; };
  const ins = new Map<string, () => any>(); const linked = new Set<string>(); const src = inputSources(p, T); const manual = new Map<string, InSrc>();
  // ---- inputs ----
  src.forEach((s, id) => {
    if (s.kind === 'pos') { const a = actByTag(s.watch); if (a.length) { ins.set(id, () => { const v = atEnd(a[0], s.end, s.wpos); return s.nc ? !v : v; }); linked.add(id); return; } }
    if (s.kind === 'fsw') { const cid = id.startsWith('psw:') ? id.slice(4) : null; const f = cid ? byComp(cid) : els.filter(e => e.el && (e.tag === s.tag || e.tag.endsWith('/' + s.tag)) && s.re.test(idOf(e.el.g)));
      if (f.length) { ins.set(id, () => { const v = !!f[0].read?.(sim)?.on; return s.nc ? !v : v; }); linked.add(id); return; } }
    manual.set(id, s);
  });
  T.sigs.forEach(s => {
    if (s.dir !== 'ain') return; const cid = s.id.split(':')[1]; const e = byComp(cid)[0]; if (!e) return;
    if (s.src === 'pos') { ins.set(s.id, () => e.rot ? e.state.x * 180 / Math.PI : e.state.x * 1000); linked.add(s.id); }
    else if (s.src === 'vel') { ins.set(s.id, () => e.rot ? e.state.v * 30 / Math.PI : e.state.v * 1000); linked.add(s.id); }
    else if (s.src === 'pg') { ins.set(s.id, () => { const r = e.read?.(sim); if (typeof r?.val === 'number') return r.val / 1e5; const n0 = Object.values(e.el.ports)[0] as number; return (sim.p[n0] ?? 0) / 1e5; }); linked.add(s.id); }
  });
  T.cyls.forEach(cy => { if (byComp(cy.id.slice(4)).some(e => e.kind === 'actuator')) { linked.add(cy.id + '+'); linked.add(cy.id + '-'); } });
  // ---- outputs ----
  type Tgt = { valve?: any; side?: 'a' | 'b'; pumps?: any[] };
  const outs = new Map<string, Tgt[]>(); const valvesTouched = new Set<any>(); const pumpOrig = new Map<any, [string, number]>();
  const solByTag = E.valveSolenoids(p);
  const valvesFor = (valveComp: string, side: 'a' | 'b') => byComp(valveComp).filter(e => e.kind === 'valve').map(v => ({ valve: v, side }));
  const pumpsNear = (motorComp: string): any[] => pumpsOfMotor(p, sim, motorComp);
  const add = (id: string, t: Tgt) => { (outs.get(id) || outs.set(id, []).get(id)!).push(t); };
  E.plcIo(p).filter(r => r.dir === 'out').forEach(r => { const id = 'plc:' + r.ref.comp.id; if (!used.has(id)) return;
    r.devices.forEach(d => { const did = idOf(d.ref.g); const tg = String(d.ref.comp.tag || '').trim();
      if (did === 'e_sol') solByTag.filter(s => s.tag === tg).forEach(s => valvesFor(s.valve.id, s.side).forEach(t => add(id, t)));
      if (d.link?.target && /pump drive/.test(d.link.text)) { const pm = pumpsNear(d.link.target.comp); if (pm.length) add(id, { pumps: pm }); } }); });
  T.sigs.forEach(s => { if (!used.has(s.id)) return; const [k, cid, side] = s.id.split(':');
    if (k === 'sol') valvesFor(cid, side as 'a' | 'b').forEach(t => add(s.id, t));
    if (k === 'drv') { const pm = pumpsNear(cid); if (pm.length) add(s.id, { pumps: pm }); } });
  outs.forEach(list => list.forEach(t => { if (t.valve) { t.valve.sol.on = true; valvesTouched.add(t.valve); } (t.pumps || []).forEach(pm => { const L = sim.live.get(pm.el.key); const k = L?.n ? 'n' : L?.disp ? 'disp' : ''; if (k && !pumpOrig.has(pm)) pumpOrig.set(pm, [k, L[k].get()]); }); }));
  const props = new Map<string, { a?: string; b?: string }>(); const disps = new Map<string, string>();
  T.sigs.forEach(s => { if (!used.has(s.id)) return; const [k, cid, side] = s.id.split(':'); if (k === 'prop') { const m = props.get(cid) || {}; (m as any)[side] = s.id; props.set(cid, m); } if (k === 'disp') disps.set(cid, s.id); });
  const lastLive = new Map<string, number>();
  const setLive = (key: string, prm: string, v: number) => { const k = key + '|' + prm; if (lastLive.get(k) === v) return; lastLive.set(k, v); sim.live.get(key)?.[prm]?.set(v); };
  const ad: SimLink = {
    name: 'machine', sim, tBase: sim.t, linked, manual,
    read(rt: Plc) { ins.forEach((f, id) => { try { rt.sim[id] = f(); } catch { } }); },
    write(rt: Plc) {
      outs.forEach((list, id) => { const on = !!rt.out[id]; list.forEach(t => { if (t.valve) t.valve.sol[t.side!] = on;
        (t.pumps || []).forEach(pm => { const o = pumpOrig.get(pm); if (o) setLive(pm.el.key, o[0], on ? o[1] : 0); }); }); });
      props.forEach((m, cid) => byComp(cid).filter(e => e.kind === 'valve').forEach(v => { const a = m.a ? rt.aout[m.a] || 0 : 0, b = m.b ? rt.aout[m.b] || 0 : 0; setLive(v.el.key, 'cmd', Math.max(-1, Math.min(1, (b - a) / 100))); }));
      disps.forEach((id, cid) => byComp(cid).filter(e => e.kind === 'pump').forEach(pm => setLive(pm.el.key, 'disp', Math.max(0, Math.min(1, (rt.aout[id] || 0) / 100)))));
    },
    cyl(id: string, end: string) { const a = byComp(id.slice(4)).find(e => e.kind === 'actuator'); return a ? atEnd(a, end) : false; },
    detach() { valvesTouched.forEach(v => { v.sol.on = false; v.sol.a = false; v.sol.b = false; }); pumpOrig.forEach(([k, v], pm) => sim.live.get(pm.el.key)?.[k]?.set(v)); }
  };
  return ad;
}

// the pump on the same sheet nearest to a drive motor (the shaft is drawn, not connected) — its simulation elements
export function pumpOfMotor(p: any, motorComp: string): string | null {
  for (const sh of E.fluidSheets(p)) { const m = sh.components.find(x => x.id === motorComp); if (!m) continue;
    const pumps = sh.components.filter(x => !isConn(x.ref) && !isAsm(x.ref) && geomOf(x.ref).cls === 'pump').sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y));
    return pumps[0]?.id || null; } return null;
}
export function pumpsOfMotor(p: any, sim: Sim, motorComp: string): any[] { const id = pumpOfMotor(p, motorComp); return id ? (sim.els as any[]).filter(e => e.kind === 'pump' && e.el?.comp?.id === id) : []; }
