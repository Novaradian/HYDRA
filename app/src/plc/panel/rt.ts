// Operator panel: reading and writing the machine — the PLC runtime of the program and the hydraulic simulation.
import { signal } from '@preact/signals';
import { produce } from 'immer';
import * as S from '../../store';
import * as Sim from '../../designer/sim';
import * as L from '../state';
import { coerce } from '../runtime';
import type { Program } from '../compile';
import type { Panel } from './model';

export type Ctx = { progId: string; p: any; pr: Program; panel: Panel; rt: any | null; sim: any | null };
export const ctxOf = (progId: string): Ctx | null => {
  const p = S.project.value; const pr = p?.programs?.[progId] as Program; if (!pr) return null;
  const r = L.RT.value; const rt = r && r.progId === progId && r.rt.state !== 'stopped' ? r.rt : null;
  return { progId, p, pr, panel: (pr as any).panel, rt, sim: Sim.SIM };
};
// per program: access level from the key switch
export const access = signal<Record<string, 'oper' | 'maint'>>({});
export const levelOf = (progId: string) => access.value[progId] || 'oper';
export const setLevel = (progId: string, l: 'oper' | 'maint') => { access.value = { ...access.value, [progId]: l }; };

const simEls = (c: Ctx, comp: string, kind?: string) => ((c.sim?.els || []) as any[]).filter(e => e.el?.comp?.id === comp && (!kind || e.kind === kind));
export function readSrc(c: Ctx, src: string): any {
  if (!src) return undefined; if (src.startsWith('!')) { const v = readSrc(c, src.slice(1)); return v == null ? v : !v; }
  const i = src.indexOf(':'); const k = i < 0 ? src : src.slice(0, i), a = i < 0 ? '' : src.slice(i + 1); const rt = c.rt;
  switch (k) {
    case 'st': { const s = rt?.state || 'stopped'; switch (a) { case 'running': return s === 'running'; case 'stopped': return s === 'stopped'; case 'estop': return s === 'estop'; case 'fault': return s === 'fault'; case 'paused': return s === 'paused';
      case 'alarm': return s === 'estop' || s === 'fault' || !!rt?.alarms.some((x: any) => x.active && x.sev === 'F'); case 'warn': return !!rt?.alarms.some((x: any) => x.active && x.sev === 'W'); } return false; }
    case 'sig': if (rt) return rt.valueOf(a); { const [kk, cid] = a.split(':'); const e = simEls(c, cid, 'actuator')[0]; if (e && kk === 'pos') return e.state.x * 1000; if (e && kk === 'vel') return e.state.v * 1000; return undefined; }
    case 'var': { if (rt && a in rt.v) return rt.v[a]; const v = (c.pr.vars || []).find(x => x.id === a); if (!v) return undefined; const s = String(v.init ?? ''); return v.type === 'BOOL' ? /^(true|1|on)$/i.test(s) : v.type === 'STRING' ? s : +s || 0; }
    case 'cyl+': case 'cyl-': { const end = k === 'cyl+' ? 'p' : 'm'; if (rt) return rt.cyl(a, end); const e = simEls(c, a.slice(4), 'actuator')[0]; if (!e) return undefined; return end === 'p' ? e.state.x >= e.state.L - 0.002 : e.state.x <= 0.002; }
    case 'step': { const [sq, st] = a.split('/'); return rt?.seqs[sq]?.cur === st; }
    case 'tq': return !!rt?.timers[a]?.Q; case 'tmr': return rt?.timers[a]?.ET ?? 0;
    case 'cq': return !!rt?.counters[a]?.Q; case 'cnt': return rt?.counters[a]?.CV ?? 0;
    case 'oil': return c.sim ? c.sim.thermal.T : undefined;
    case 'pp': { const e = simEls(c, a, 'pump')[0]; return e ? (c.sim.p[e.nodes[1]] ?? 0) / 1e5 : undefined; }
    case 'pq': { const e = simEls(c, a, 'pump')[0]; return e ? (e.read?.(c.sim)?.val ?? 0) * 60000 : undefined; }
    case 'plct': return rt ? rt.t : 0; case 'simt': return c.sim ? c.sim.t : 0;
    case 'live': { const [cid, prm] = a.split(':'); const e = simEls(c, cid)[0]; const Lv = e && c.sim.live.get(e.el.key)?.[prm]; if (Lv) return Lv.get() * (Lv.scale || 1); return partValue(c.p, cid, prm); }
  }
  return undefined;
}
const findComp = (p: any, cid: string) => { for (const sh of Object.values(p?.circuits || {}) as any[]) { const x = (sh.components || []).find((q: any) => q.id === cid); if (x) return { sh, x }; } return null; };
function partValue(p: any, cid: string, prm: string) { const f = findComp(p, cid); const v = f?.x.values?.[prm]; if (v == null) return prm === 'disp' || prm === 'open' ? 100 : 0; return prm === 'set' ? v / 1e5 : v; }

// writes; retain = set-points: also kept as the variable's start value
export function write(c: Ctx, tgt: string, v: any, o: { retain?: boolean; momentary?: boolean } = {}) {
  if (!tgt) return; if (o.momentary && !c.rt && tgt.startsWith('var:')) return; const i = tgt.indexOf(':'); const k = tgt.slice(0, i), a = tgt.slice(i + 1); const rt = c.rt;
  switch (k) {
    case 'in': L.setInput(c.progId, a, !!v); return;
    case 'var': { const d = (c.pr.vars || []).find(x => x.id === a); if (!d) return; const val = coerce(d, v); if (rt) rt.v[a] = val;
      if (o.retain || !rt) L.writeProg(c.progId, x => { const q = x.vars?.find(y => y.id === a); if (q) q.init = d.type === 'BOOL' ? (val ? 'TRUE' : 'FALSE') : String(val); });
      L.tick.value++; return; }
    case 'cmd': switch (a) { case 'reset': if (v) L.reset(); return; case 'estop': L.estop(!!v); return; case 'ack': if (v) { rt?.ack(); L.tick.value++; } return; case 'run': if (v && !rt) L.run(c.progId); else if (v && rt?.state === 'paused') L.resume(); return; case 'stop': if (v) L.stop(); return; } return;
    case 'live': { const [cid, prm] = a.split(':'); const els = simEls(c, cid); let done = false;
      els.forEach(e => { const Lv = c.sim.live.get(e.el.key)?.[prm]; if (Lv) { Sim.setLive(e.el.key, prm, +v / (Lv.scale || 1)); done = true; } });
      if (!done && !c.sim) { const f = findComp(c.p, cid); if (f) S.mutate('Panel setting', d => { const x = (d.circuits[f.sh.id] as any).components.find((q: any) => q.id === cid); x.values = { ...(x.values || {}), [prm]: prm === 'set' ? +v * 1e5 : +v }; }); }
      return; }
  }
}
// panel edits go through project undo; they are allowed while the machine runs (the circuit stays locked)
export function editPanel(progId: string, label: string, f: (pn: Panel) => void) {
  S.mutate(label, d => { const pr: any = d.programs[progId]; if (!pr) return; if (!pr.panel) pr.panel = { pages: [], widgets: [], recipes: [] }; f(pr.panel); }, { ignoreLock: true });
}
export function setPanelQuiet(progId: string, f: (pn: Panel) => void) { const p = S.project.value; if (!p?.programs[progId]) return; S.project.value = produce(p, (d: any) => { f(d.programs[progId].panel); }) as any; S.dirty.value = true; }

// ---------- memories sampled while the panel is shown: trends and production figures ----------
export const trendMem = new Map<string, { t: number[]; ys: number[][]; key: string }>();
export function sampleTrend(c: Ctx, id: string, srcs: string[], span: number) {
  const now = c.rt ? c.rt.t : c.sim ? c.sim.t : 0; const key = srcs.join(',') + '|' + c.progId; let m = trendMem.get(id);
  if (!m || m.key !== key || (m.t.length && now < m.t[m.t.length - 1] - 1e-6)) { m = { t: [], ys: srcs.map(() => []), key }; trendMem.set(id, m); }
  if (!m.t.length || now - m.t[m.t.length - 1] >= 0.05) { m.t.push(now); srcs.forEach((s, i) => { const v = readSrc(c, s); m!.ys[i].push(typeof v === 'boolean' ? +v : +v || 0); }); }
  while (m.t.length > 2 && m.t[0] < now - span * 1.2) { m.t.shift(); m.ys.forEach(y => y.shift()); }
  return { m, now };
}
export const prodMem = new Map<string, { cv: number; tLast: number; times: number[]; run: number; tot: number; tPrev: number }>();
export function production(c: Ctx, cnt: string) {
  const key = c.progId + '|' + cnt; const rt = c.rt; let m = prodMem.get(key); const t = rt ? rt.t : 0; const cv = rt?.counters[cnt]?.CV ?? 0;
  if (!m || (rt && t < m.tPrev - 1e-6)) { m = { cv, tLast: t, times: [], run: 0, tot: 0, tPrev: t }; prodMem.set(key, m); }
  if (rt) { const dt = t - m.tPrev; if (dt > 0) { m.tot += dt; if (rt.state === 'running') m.run += dt; } m.tPrev = t;
    if (cv > m.cv) { m.times.push(t - m.tLast); if (m.times.length > 20) m.times.shift(); m.tLast = t; } if (cv !== m.cv) m.cv = cv; }
  const last = m.times[m.times.length - 1] || 0; const avg = m.times.length ? m.times.reduce((a, b) => a + b, 0) / m.times.length : 0;
  return { cv, last, avg, perHour: avg ? 3600 / avg : 0, runPct: m.tot ? 100 * m.run / m.tot : 0 };
}
