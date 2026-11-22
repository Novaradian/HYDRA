// AI command layer — runs the simulation without the UI and returns a short summary (never time series).
// The solver is built with exactly the options the Simulate button uses (designer/sim.ts simStart); it only reads.
import * as S from '../store';
import { Sim } from '../designer/sim';
import { posLetters, valvePositions, valveRest } from '../designer/geom';
import type { Project } from '../store';
import { fail, readSheet, FLUID, rn } from './core';

export type SimEvent = { t: number; tag: string; pos: string };
const BAR = 1e5;

export function simSummary(p0: Project, sheetRef: string | undefined, fallback: string | null, tEnd: number, events: SimEvent[] = [], wallMs = 8000) {
  const { p, sh } = readSheet(p0, sheetRef, fallback);
  if (!FLUID.has(sh.type)) fail(`Sheet "${sh.name}" is ${sh.type} — only hydraulic and pneumatic sheets are simulated`);
  const so = S.settings.value.solver as any;
  const sim = new Sim(p, sh.id, { beta: 1.4e9, rho: so.density || 870, pilotAuto: so.pilotAuto !== false, dt: so.simDt ? so.simDt / 1000 : undefined });
  if (!sim.els.length) fail('Nothing to simulate on this sheet');
  // valve switching events: position letter (a, 0, b …) or "rest"
  const evs = events.map(e => {
    const el: any = sim.els.find(x => x.kind === 'valve' && x.tag === e.tag);
    if (!el) fail(`${e.tag} is not a valve the simulation can switch`, [`Valves: ${sim.els.filter(x => x.kind === 'valve').map(x => x.tag).join(', ') || 'none'}`]);
    const d = el.el?.g?.valve; const n = d ? valvePositions(d) : 3; const L = posLetters(n);
    const pos = e.pos === 'rest' && d ? valveRest(d) : L.indexOf(String(e.pos));
    if (pos < 0) fail(`${e.tag}: position "${e.pos}" — use ${L.join(', ')} or rest`);
    return { t: +e.t, el, pos, tag: e.tag, label: e.pos };
  }).sort((a, b) => a.t - b.t);
  const acts = sim.els.filter(x => x.kind === 'actuator') as any[];
  // end positions: the same travel the solver uses (stroke, or swing for rotary actuators)
  const num = (v: any, d: number) => typeof v === 'number' && isFinite(v) ? v : d;
  const travel = (a: any) => a.rot ? Math.max(1, num(a.el?.values?.swing, 180)) * Math.PI / 180 : Math.max(0.002, num(a.el?.values?.stroke, 0.2));
  const endOf = (a: any) => { const x = a.state?.x || 0, L = travel(a), tol = Math.max(L * 0.01, a.rot ? 0.005 : 0.0005); return x >= L - tol ? 1 : x <= tol ? -1 : 0; };
  const track = new Map<string, { ext: number[]; ret: number[]; vmax: number; seat: number }>();
  acts.forEach(a => track.set(a.tag, { ext: [], ret: [], vmax: 0, seat: endOf(a) }));
  // warnings: one line per source (the solver re-words a warning as its value changes)
  const warns = new Map<string, string>(); sim.issues.filter(i => i.level === 'err' || i.level === 'warn').forEach(i => warns.set(i.text, i.text));
  const t0 = performance.now(); const chunk = 0.01; let k = 0, ei = 0, stopped = '';
  while (sim.t < tEnd - 1e-9) {
    while (ei < evs.length && evs[ei].t <= sim.t + 1e-9) { const e = evs[ei++]; e.el.command(e.pos, sim); }
    sim.run(Math.min(chunk, tEnd - sim.t), 1e9); k++;
    for (const a of acts) { const st = a.state || {}; const tr = track.get(a.tag)!; tr.vmax = Math.max(tr.vmax, Math.abs(st.v || 0)); const s = endOf(a); if (s !== tr.seat) { if (s > 0) tr.ext.push(rn(sim.t, 3)); else if (s < 0) tr.ret.push(rn(sim.t, 3)); tr.seat = s; } }
    if (k % 5 === 0) { sim.measure(); sim.alerts.forEach((tx, key) => warns.set(key, tx)); }
    if (performance.now() - t0 > wallMs) { stopped = `stopped at ${rn(sim.t, 2)} s (time limit)`; break; }
  }
  sim.measure(); sim.alerts.forEach((tx, key) => warns.set(key, tx));
  const hyd = sh.type !== 'pneumatic';
  return {
    sheet: sh.name, t: rn(sim.t, 3), ...(stopped ? { note: stopped } : {}),
    peak_bar: rn(sim.pmaxSeen / BAR, 1),
    actuators: acts.map(a => { const tr = track.get(a.tag)!; const st = a.state || {}; return { tag: a.tag, end: tr.seat > 0 ? 'extended' : tr.seat < 0 ? 'retracted' : 'between',
      ...(a.rot ? { pos_deg: rn((st.x || 0) * 180 / Math.PI, 1), vmax_rpm: rn(tr.vmax * 30 / Math.PI, 0) } : { pos_mm: rn((st.x || 0) * 1000, 1), vmax_mm_s: rn(tr.vmax * 1000, 0) }),
      ...(tr.ext.length ? { extended_at: tr.ext.slice(0, 5) } : {}), ...(tr.ret.length ? { retracted_at: tr.ret.slice(0, 5) } : {}) }; }),
    ...(evs.length ? { events: evs.map(e => `${e.t}s ${e.tag}→${e.label}`) } : {}),
    warnings: [...warns.values()].slice(0, 12), medium: hyd ? 'hydraulic' : 'pneumatic'
  };
}
