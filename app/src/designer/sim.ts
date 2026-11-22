// Transient simulation of a fluid circuit (hydraulic and pneumatic), whole machine (assemblies flattened).
// Lumped model: every net is a node with a pressure state and a capacitance (line, chamber and accumulator volume).
// Each part is an element that sends flow between its nodes as a function of node pressures. Every time step is
// implicit Euler, solved by Newton iteration with a finite-difference Jacobian over each element's own nodes, so stiff
// oil (β ≈ 1.4 GPa) and switching valves stay stable. Hydraulic flows are volumetric (m³/s); pneumatic flows are mass
// flows (kg/s, ISO 6358 sonic conductance) on the same solver. Actuator motion is solved inside the same step (fully
// implicit coupling of piston velocity and chamber pressures). Pressures are gauge (Pa).
import { signal } from '@preact/signals';
import * as S from '../store';
import { flatten, type Flat, type FlatEl } from './asm';
import { valvePositions, valveRest, posLetters } from './geom';
import type { Issue } from './model';

const BAR = 1e5, PATM = 101325, RT = 287.05 * 293.15, KAP = 1.2, RHO0 = 1.185, G = 9.81, B_CRIT = 0.3;
const PHI_N = Math.sqrt(1 - Math.pow((6.013 / 7.013 - B_CRIT) / (1 - B_CRIT), 2)); // φ at the ISO 6358 rating point (6 bar → 5 bar g)
type Fn = (P: (i: number) => number, out: number[]) => void;
export type SimEl = { key: string; tag: string; el?: FlatEl; nodes: number[]; f: Fn; pre?: (s: Sim) => void; post?: (s: Sim, P: (i: number) => number) => void; cap?: (s: Sim, C: Float64Array) => void; read?: (s: Sim) => Readout; kind: string };
export type Readout = { text: string; detail?: string; val?: number; unit?: string; on?: boolean };

// ---------- flow laws ----------
let DPT = 0.15 * BAR; // laminar transition of the turbulent orifice law (moves with viscosity)
export const sqrtReg = (x: number) => x >= DPT ? Math.sqrt(x) : x / Math.sqrt(DPT);
export const orifice = (K: number, dp: number) => dp >= 0 ? K * sqrtReg(dp) : -K * sqrtReg(-dp);                // hydraulic, K = q/√Δp
const phi = (r: number) => { if (r <= B_CRIT) return 1; if (r >= 0.999) { const p9 = Math.sqrt(1 - Math.pow((0.999 - B_CRIT) / (1 - B_CRIT), 2)); return p9 * (1 - r) / 0.001; } return Math.sqrt(1 - Math.pow((r - B_CRIT) / (1 - B_CRIT), 2)); };
export const sonic = (C: number, p1: number, p2: number) => { const a = p1 + PATM, b = p2 + PATM; if (a >= b) return RHO0 * C * a * phi(b / Math.max(a, 1)); return -RHO0 * C * b * phi(a / Math.max(b, 1)); }; // pneumatic mass flow 1→2
export const cOfQn = (qn: number) => qn / (7.013e5 * PHI_N); // Qn (normal m³/s at 6 bar, Δp 1 bar) → sonic conductance C
const clamp01 = (x: number) => x < 0 ? 0 : x > 1 ? 1 : x;

export class Sim {
  f: Flat; n: number; p: Float64Array; pOld: Float64Array; C: Float64Array; Cb: Float64Array; hyd: boolean[]; els: SimEl[] = []; t = 0; dt: number; issues: Issue[] = [];
  dbg: any[] | null = null;
  // the PLC runs in lock-step with the solver (a hook after every time step); halt stops run() at a breakpoint
  hooks: ((s: Sim) => void)[] = []; halt = false;
  // oil viscosity: ν(T) from the grade (ν at 40 °C) — vf = ν(T) / ν40 scales laminar paths (leakage, viscous throttles)
  nu40 = 46; vf = 1; nu() { return this.nu40 * Math.exp(-0.0336 * (this.thermal.T - 40)); }
  live = new Map<string, any>(); // per-element live parameters (sliders while running)
  alerts = new Map<string, string>(); pipeQ = new Map<string, number>(); qShow = new Map<string, number>(); tMeas = 0; aSince = new Map<string, number>(); aSeen = new Map<string, number>(); aText = new Map<string, string>(); peakSeen = new Map<string, number>();
  thermal = { T: (S.settings.value.solver as any).temp ?? 40, Tamb: 25, vol: 0, kAmb: 0, Q: 0, init: false };
  beta: number; rho: number; pilotAuto: boolean; maxP = 10 * BAR; warn = new Set<string>(); steps = 0; flowInto: Float64Array; sheet: string; pmaxSeen = 0;
  constructor(p: any, sheetId: string, o: { dt?: number; beta?: number; rho?: number; pilotAuto?: boolean } = {}) {
    this.sheet = sheetId; this.f = flatten(p, sheetId); this.n = this.f.n; this.issues = [...this.f.issues];
    this.nu40 = (S.settings.value.solver as any).viscosity || 46;
    this.p = new Float64Array(this.n); this.pOld = new Float64Array(this.n); this.C = new Float64Array(this.n); this.Cb = new Float64Array(this.n); this.flowInto = new Float64Array(this.n);
    this.hyd = this.f.medium.map(m => m !== 'pneumatic'); this.beta = o.beta || 1.4e9; this.rho = o.rho || 870; this.pilotAuto = o.pilotAuto !== false;
    this.dt = o.dt || (this.n > 80 ? 1e-3 : 5e-4);
    for (let i = 0; i < this.n; i++) { const V = this.f.vol[i] + (this.hyd[i] ? 2e-5 : 4e-6); this.Cb[i] = this.hyd[i] ? V / this.beta : V / (KAP * RT); }
    this.f.els.forEach(e => { try { const se = build(this, e); if (se) this.els.push(...(Array.isArray(se) ? se : [se])); } catch (err: any) { this.issues.push({ level: 'warn', text: `${e.tag}: not simulated (${err?.message || err})` }); } });
    // unconnected ports: pneumatic exhausts vent to air; a lone pump suction draws from the tank
    this.f.els.forEach(e => Object.entries(e.ports).forEach(([k, nn]) => { if (this.f.deg[nn] > 1) return; const q = e.g.ports.find(x => x.key === k); if (!q) return;
      if (!this.hyd[nn] && (q.role === 'exhaust')) this.els.push(vent(this, nn, cOfQn(1500 / 60000), e.tag + '.' + q.name));
      if (this.hyd[nn] && (q.role === 'suction')) this.els.push(ground(this, nn, 1e-7, e.tag + '.' + q.name + ' (tank)')); }));
    const sets = this.f.els.map(e => (['pressure', 'source', 'frl'].includes(e.g.cls) ? e.values.set ?? e.values.p : e.g.cls === 'pump' ? (e.values.pc || e.values.pmax || (this.hyd[Object.values(e.ports)[0] ?? 0] ? null : null)) : null)).filter((x: any) => typeof x === 'number' && x > 0) as number[];
    this.maxP = Math.max(...sets, this.hyd.some(Boolean) ? 50 * BAR : 6 * BAR);
    this.els.forEach(e => e.pre?.(this));
  }
  // one implicit time step
  step() {
    const n = this.n, dt = this.dt; this.pOld.set(this.p);
    this.vf = Math.max(0.15, Math.min(25, Math.exp(-0.0336 * (this.thermal.T - 40)))); DPT = 0.15 * BAR * Math.max(0.1, Math.min(20, this.vf * this.vf));
    this.els.forEach(e => e.pre?.(this));
    for (let i = 0; i < n; i++) this.C[i] = this.Cb[i] * (this.hyd[i] ? 1 : 1); this.els.forEach(e => e.cap?.(this, this.C));
    const J = new Float64Array(n * n), R = new Float64Array(n); const out: number[] = [], out2: number[] = [];
    const P = this.p; const get = (i: number) => i < 0 ? 0 : P[i];
    const R2 = new Float64Array(n);
    for (let it = 0; it < 14; it++) {
      J.fill(0); R.fill(0);
      for (let i = 0; i < n; i++) { const c = this.C[i] / dt; J[i * n + i] = c; R[i] = c * (P[i] - this.pOld[i]); }
      for (const e of this.els) {
        const nd = e.nodes; out.length = nd.length; out.fill(0); e.f(get, out);
        for (let a = 0; a < nd.length; a++) if (nd[a] >= 0) R[nd[a]] -= out[a];
        for (let b = 0; b < nd.length; b++) {
          const j = nd[b]; if (j < 0) continue; if (nd.indexOf(j) !== b) continue; // a node listed twice is perturbed once
          const h = this.hyd[j] ? Math.max(200, Math.abs(P[j]) * 1e-5) : Math.max(5, Math.abs(P[j]) * 1e-5); const keep = P[j]; P[j] = keep + h;
          out2.length = nd.length; out2.fill(0); e.f(get, out2); P[j] = keep;
          for (let a = 0; a < nd.length; a++) { const i = nd[a]; if (i < 0) continue; J[i * n + j] -= (out2[a] - out[a]) / h; }
        }
      }
      const dx = solve(J, R, n);
      // damped Newton: shorten the step until the residual falls (steep valve characteristics otherwise make it cycle)
      const p0 = P.slice(), r0 = this.resid(R); let lam = 1, worst = 0;
      for (let ls = 0; ls < 6; ls++) {
        worst = 0;
        for (let i = 0; i < n; i++) { let d = -dx[i] * lam; const lim = this.hyd[i] ? 400 * BAR : 20 * BAR; if (d > lim) d = lim; if (d < -lim) d = -lim; P[i] = p0[i] + d; if (this.hyd[i]) { if (P[i] < -0.95 * BAR) P[i] = -0.95 * BAR; } else if (P[i] < -0.98 * PATM) P[i] = -0.98 * PATM; worst = Math.max(worst, Math.abs(P[i] - p0[i]) / (this.hyd[i] ? 2000 : 20)); }
        if (ls === 5 || this.resid(this.residual(get, R2)) <= r0 * (1 - 1e-4 * lam) || worst < 1) break;
        lam *= 0.5;
      }
      if (this.dbg) this.dbg.push([this.t, it, worst, Array.from(P).map(x => Math.round(x / 1e4) / 10)]);
      if (worst < 1) break;
    }
    // net throughput per node (for display) and commit element states
    this.flowInto.fill(0);
    for (const e of this.els) { const nd = e.nodes; out.length = nd.length; out.fill(0); e.f(get, out); for (let a = 0; a < nd.length; a++) if (nd[a] >= 0) this.flowInto[nd[a]] += Math.abs(out[a]); }
    this.thermal.Q = 0;
    // heat: hydraulic power lost in valves, filters, lines … (pumps and motors add their own losses in post)
    for (const e of this.els) { if (e.kind === 'pump' || e.kind === 'actuator' || e.kind === 'motor' || e.kind === 'tank' || e.kind === 'accumulator' || e.kind === 'thermal') continue; const nd = e.nodes; out.length = nd.length; out.fill(0); e.f(get, out); let w = 0; for (let a = 0; a < nd.length; a++) if (nd[a] >= 0 && this.hyd[nd[a]]) w -= out[a] * P[nd[a]]; if (w > 0) this.thermal.Q += w; }
    for (const e of this.els) e.post?.(this, get);
    if (this.thermal.vol > 0) { const th = this.thermal; const Cth = Math.max(0.02, th.vol + this.f.vol.reduce((x, y) => x + y, 0)) * this.rho * 1880; th.T += dt * (th.Q - th.kAmb * (th.T - th.Tamb)) / Cth; }
    for (let i = 0; i < n; i++) if (P[i] > this.pmaxSeen) this.pmaxSeen = P[i];
    this.t += dt; this.steps++;
    for (const h of this.hooks) h(this);
  }
  // residual of the implicit step: storage term minus net inflow, per node
  residual(get: (i: number) => number, R: Float64Array) { const n = this.n, dt = this.dt; for (let i = 0; i < n; i++) R[i] = this.C[i] / dt * (this.p[i] - this.pOld[i]); const o: number[] = [];
    for (const e of this.els) { const nd = e.nodes; o.length = nd.length; o.fill(0); e.f(get, o); for (let a = 0; a < nd.length; a++) if (nd[a] >= 0) R[nd[a]] -= o[a]; } return R; }
  resid(R: Float64Array) { let m = 0; for (let i = 0; i < this.n; i++) { const x = Math.abs(R[i]) * (this.hyd[i] ? 1 : 1 / RHO0); if (x > m) m = x; } return m; }
  run(seconds: number, budgetMs = 14) { const t0 = performance.now(); const end = this.t + seconds; let k = 0; while (this.t < end - 1e-12 && !this.halt) { this.step(); k++; if ((k & 7) === 0 && performance.now() - t0 > budgetMs) break; } return k; }
  el(key: string) { return this.els.find(e => e.key === key); }
  // flow in every line (tree solution from the flows at the ports; lines inside a closed loop stay unknown) + limit checks
  pipeV = new Map<string, number>(); nodeClass: string[] = [];
  measure() {
    const f = this.f, P = this.p; const get = (i: number) => i < 0 ? 0 : P[i];
    const byEN = new Map<string, number>(); const o: number[] = [];
    for (const e of this.els) { if (!e.el) continue; const nd = e.nodes; o.length = nd.length; o.fill(0); e.f(get, o); nd.forEach((x, a) => { if (x < 0) return; const k = e.el!.key + '|' + x; byEN.set(k, (byEN.get(k) || 0) + o[a]); }); }
    const inj = new Map<string, number>();
    f.els.forEach(e => { const cnt = new Map<number, number>(); Object.values(e.ports).forEach(n => cnt.set(n, (cnt.get(n) || 0) + 1)); Object.entries(e.ports).forEach(([k, n]) => { const q = (byEN.get(e.key + '|' + n) || 0) / cnt.get(n)!; const raw = f.portRaw.get(e.key + ':' + k); if (raw) inj.set(raw, (inj.get(raw) || 0) + q); }); });
    const adj = new Map<string, [string, string, number][]>(); const addE = (key: string, a: string, b: string) => { if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []); adj.get(a)!.push([key, b, 1]); adj.get(b)!.push([key, a, -1]); };
    f.pipeEnds.forEach(([a, b], key) => addE(key, a, b)); f.links.forEach(([a, b], i) => addE('L' + i, a, b));
    const deg = new Map<string, number>(); adj.forEach((l, v) => deg.set(v, l.length)); const done = new Set<string>(); const q: string[] = []; deg.forEach((d, v) => { if (d === 1) q.push(v); });
    this.pipeQ.clear();
    while (q.length) { const v = q.pop()!; if ((deg.get(v) || 0) !== 1) continue; const ed = adj.get(v)!.find(x => !done.has(x[0])); if (!ed) continue; const [key, u, sg] = ed; done.add(key); const qv = inj.get(v) || 0;
      if (!key.startsWith('L')) this.pipeQ.set(key, sg * qv); inj.set(u, (inj.get(u) || 0) + qv); deg.set(v, 0); deg.set(u, (deg.get(u) || 1) - 1); if (deg.get(u) === 1) q.push(u); }
    // display filter: flows shown on lines are low-passed (≈50 ms) and tiny flows read as zero, so arrows and readouts do not flicker
    { const dtm = Math.max(0, this.t - this.tMeas); this.tMeas = this.t; const al = dtm > 0 ? 1 - Math.exp(-dtm / 0.05) : 1; const nq = new Map<string, number>();
      this.pipeQ.forEach((qv, key) => { const nn = f.pipeNode.get(key)!; const prev = this.qShow.get(key); const sm = prev == null ? qv : prev + al * (qv - prev); this.qShow.set(key, sm); const dead = this.hyd[nn] ? 0.05 / 60000 : RHO0 * 1 / 60000; nq.set(key, Math.abs(sm) < dead ? 0 : sm); });
      this.pipeQ = nq; }
    // limit checks
    const raw = new Map<string, string>(); if (!this.nodeClass.length) { this.nodeClass = Array(this.n).fill('pressure'); f.els.forEach(e => Object.entries(e.ports).forEach(([k, n]) => { const r = e.g.ports.find(x => x.key === k)?.role; if (r === 'suction') this.nodeClass[n] = 'suction'; else if ((r === 'return' || e.g.cls === 'tank') && this.nodeClass[n] !== 'suction') this.nodeClass[n] = 'return'; })); }
    const lim: Record<string, number> = { pressure: 5, return: 3, suction: 1.2 };
    this.pipeV.clear(); f.pipeEnds.forEach((_, key) => { const qq = this.pipeQ.get(key); const nn = f.pipeNode.get(key)!; if (qq == null) return; const A = f.pipeArea.get(key) || 1e-4; const vol = this.hyd[nn] ? qq : qq / ((P[nn] + PATM) / RT); const vel = Math.abs(vol) / A; this.pipeV.set(key, vel);
      if (this.hyd[nn] && vel > lim[this.nodeClass[nn]]) raw.set(key, `Line ${f.labels[nn].slice(0, 2).join(' – ')}: ${vel.toFixed(1)} m/s — above ${lim[this.nodeClass[nn]]} m/s for a ${this.nodeClass[nn]} line (increase the line size)`); });
    f.els.forEach(e => { const pr = e.values?.prated; if (typeof pr === 'number' && pr > 0) { let mx = 0; Object.values(e.ports).forEach(n => { mx = Math.max(mx, P[n]); }); const se: any = this.el(e.key); if (se?.state?.pk) mx = Math.max(mx, se.state.pc || 0); if (mx > pr) raw.set(e.key, `${e.tag}: ${fmtP(mx)} — above its rated ${fmtP(pr)}`); }
      if (e.g.cls === 'pump' && this.hyd[Object.values(e.ports)[0] ?? 0]) { const sn = e.ports['S'] ?? e.ports['S1']; if (sn != null && P[sn] < -0.3 * BAR) raw.set(e.key, `${e.tag}: suction ${fmtP(P[sn])} — cavitation risk (suction line too small or too long)`); }
      if (e.g.cls === 'gauge') { const se: any = this.el(e.key); const r = se?.read?.(this); if (r?.on) raw.set(e.key, `${e.tag}: over its range`); } });
      // warnings must persist 0.1 s before they show and stay away 0.2 s before they clear (no blinking)
    raw.forEach((tx, k) => { if (!this.aSince.has(k)) this.aSince.set(k, this.t); this.aSeen.set(k, this.t); this.aText.set(k, tx); });
    this.alerts.clear(); this.aSince.forEach((t0, k) => { const seen = this.aSeen.get(k) ?? -1; if (!raw.has(k) && this.t - seen > 0.2) { this.aSince.delete(k); this.aSeen.delete(k); return; } if (this.t - t0 >= 0.1) this.alerts.set(k, this.aText.get(k)!); });
  }
  pressureAt(elKey: string, port: string) { const n = this.f.portNode.get(elKey + ':' + port); return n == null ? null : this.p[n]; }
}

// dense Gaussian elimination with partial pivoting: J x = R
function solve(J: Float64Array, R: Float64Array, n: number): Float64Array {
  const A = J, b = R.slice(), x = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let piv = k, mv = Math.abs(A[k * n + k]); for (let i = k + 1; i < n; i++) { const v = Math.abs(A[i * n + k]); if (v > mv) { mv = v; piv = i; } }
    if (mv < 1e-300) continue;
    if (piv !== k) { for (let j = k; j < n; j++) { const t = A[k * n + j]; A[k * n + j] = A[piv * n + j]; A[piv * n + j] = t; } const t = b[k]; b[k] = b[piv]; b[piv] = t; }
    const akk = A[k * n + k];
    for (let i = k + 1; i < n; i++) { const f = A[i * n + k] / akk; if (f === 0) continue; for (let j = k; j < n; j++) A[i * n + j] -= f * A[k * n + j]; b[i] -= f * b[k]; }
  }
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < n; j++) s -= A[i * n + j] * x[j]; const d = A[i * n + i]; x[i] = Math.abs(d) < 1e-300 ? 0 : s / d; }
  return x;
}

// ---------- element builders ----------
const node = (e: FlatEl, k: string) => e.ports[k] ?? -1;
const has = (s: Sim, e: FlatEl, k: string) => e.ports[k] != null && s.f.deg[e.ports[k]] > 1;
const fmtP = (p: number) => `${(p / BAR).toFixed(p < 10 * BAR ? 2 : 1)} bar`;
// a restriction between two nodes; hydraulic: K = q/√Δp; pneumatic: sonic conductance C
function restr(s: Sim, a: number, b: number, q: number, dp: number, nodeHyd: boolean): (pa: number, pb: number, open?: number) => number {
  if (nodeHyd) { const K = q / Math.sqrt(Math.max(dp, 1e3)); return (pa, pb, o = 1) => orifice(K * o, pa - pb); }
  const C = cOfQn(q); return (pa, pb, o = 1) => o <= 0 ? 0 : sonic(C * o, pa, pb);
}
function ground(s: Sim, nn: number, g: number, tag: string): SimEl { return { key: 'gnd:' + nn + ':' + tag, tag, nodes: [nn], kind: 'tank', f: (P, out) => { out[0] = -g * P(nn); } }; }
function vent(s: Sim, nn: number, C: number, tag: string): SimEl { return { key: 'vent:' + nn + ':' + tag, tag, nodes: [nn], kind: 'vent', f: (P, out) => { out[0] = -sonic(C, P(nn), 0); } }; }
const isH = (s: Sim, e: FlatEl) => e.medium !== 'pneumatic' && !(e.g.domain === 'pneumatic');

// value of the placed part (SI base) with a fallback
const V = (e: FlatEl, k: string, d: number) => { const x = e.values?.[k]; return typeof x === 'number' && isFinite(x) ? x : d; };
// restriction from the part's own rated point: hydraulic q at dpr, pneumatic Qn
const rated = (s: Sim, e: FlatEl, H: boolean, q: number, dp: number) => restr(s, 0, 0, V(e, 'q', q), V(e, 'dpr', dp), H);

function build(s: Sim, e: FlatEl): SimEl | SimEl[] | null {
  const g = e.g, v = e.values, id = g.item?.id || '', H = Object.values(e.ports).length ? s.hyd[Object.values(e.ports)[0]] : isH(s, e);
  const K = (k: string) => node(e, k); const base = { key: e.key, tag: e.tag, el: e };
  switch (g.cls) {
    case 'tank': return tank(s, e, H);
    case 'pump': case 'pumpmotor': return pump(s, e, H);
    case 'source': return source(s, e);
    case 'valve': return g.valve ? dcv(s, e, H) : passthrough(s, e, H, 40 / 60000, 5 * BAR);
    case 'pressure': return pressureValve(s, e, H);
    case 'check': return checkValve(s, e, H);
    case 'flow': return flowValve(s, e, H);
    case 'shutoff': { const a = K('1'), b = K('2'); const r = rated(s, e, H, H ? 300 / 60000 : 3000 / 60000, 0.5 * BAR); const st = { open: (v.state || 'Open') === 'Open', q: 0 };
      return { ...base, nodes: [a, b], kind: 'shutoff', state: st, f: (P, out) => { const q = st.open ? r(P(a), P(b)) : 0; out[0] = -q; out[1] = q; }, post: (ss, P) => { st.q = st.open ? r(P(a), P(b)) : 0; }, read: () => ({ text: (st.open ? 'open' : 'closed') + (st.open ? ' · ' + fmtQ(st.q, H) : ''), on: st.open }) } as any; }
    case 'cylinder': case 'rotary': return actuator(s, e, H);
    case 'motor': return H ? motor(s, e) : pneuMotor(s, e);
    case 'accumulator': return accumulator(s, e);
    case 'receiver': { const a = K('1'), b = K('2'); const r = rated(s, e, false, 6000 / 60000, BAR); const Vr = V(e, 'vol', 0.05); const pm = V(e, 'pmax', 11 * BAR);
      return { ...base, nodes: [a, b], kind: 'receiver', f: (P, out) => { const q = r(P(a), P(b)); out[0] = -q; out[1] = q; }, cap: (ss, C) => { if (a >= 0) C[a] += Vr / (KAP * RT); }, post: (ss) => { if (a >= 0 && ss.p[a] > pm) ss.warn.add(`Receiver ${e.tag} above its max. pressure ${fmtP(pm)}`); }, read: ss => ({ text: `${fmtP(a >= 0 ? ss.p[a] : 0)} · ${(Vr * 1000).toFixed(0)} L` }) }; }
    case 'gauge': case 'switch': case 'sensor': return sensor(s, e, H);
    case 'filter': return filter(s, e, H);
    case 'cooler': case 'heater': return thermal(s, e, H);
    case 'dryer': case 'lubricator': return passthrough(s, e, H, 2000 / 60000, 0.2 * BAR);
    case 'connection': return passthrough(s, e, H, H ? 150 / 60000 : 2000 / 60000, 0.5 * BAR);
    case 'frl': return regulator(s, e);
    case 'silencer': case 'exhaust': { const C = cOfQn(V(e, 'q', (id === 'p_silencer_thr' ? 600 : 2000) / 60000)); return Object.keys(e.ports).map((k, i) => ({ ...vent(s, K(k), C, e.tag), key: i ? e.key + ':' + k : e.key, el: e })); }
    case 'logic': return logic(s, e);
    case 'vacuum': return vacuum(s, e);
    case 'intensifier': return intensifier(s, e);
    case 'cartridge': return cartridge(s, e, H);
    case 'nozzle': { const a = K('1'); const C = cOfQn(V(e, 'q', (id === 'p_spraygun' ? 150 : 300) / 60000)); const lv = { on: String(v.trig || 'Released') === 'Pressed' ? 1 : id === 'p_spraygun' ? 1 : 0 }; const st = { q: 0 };
      s.live.set(e.key, { on: { label: id === 'p_spraygun' ? 'Nozzle open' : 'Trigger (pressed)', unit: '%', min: 0, max: 100, step: 100, scale: 100, get: () => lv.on, set: (x: number) => { lv.on = x > 0.5 ? 1 : 0; } } });
      return { ...base, nodes: [a], kind: 'nozzle', f: (P, out) => { out[0] = -sonic(C * lv.on, P(a), 0); }, post: (ss, P) => { st.q = sonic(C * lv.on, P(a), 0); }, read: ss => ({ text: lv.on ? `blowing · ${fmtQ(st.q, false)}` : `closed · ${fmtP(a >= 0 ? ss.p[a] : 0)}`, on: !!lv.on }) } as any; }
    case 'charging': return chargingValve(s, e);
    case 'compensator': return compensator(s, e, H);
    case 'drive': return null;
  }
  // custom parts: two working ports act as a plain connection, anything else is left out
  const wk = Object.keys(e.ports); if (wk.length === 2) { s.issues.push({ level: 'info', text: `${e.tag} (${g.name}): simulated as a plain connection` }); return passthrough(s, e, H, H ? 150 / 60000 : 2000 / 60000, 0.5 * BAR); }
  if (wk.length) s.issues.push({ level: 'info', text: `${e.tag} (${g.name}): no simulation model — ignored` });
  return null;
}
const fmtQ = (q: number, H: boolean) => H ? `${(q * 60000).toFixed(1)} L/min` : `${(q / RHO0 * 60000).toFixed(0)} Nl/min`;

// line parts with a rated pressure drop (hoses, couplings, dryers, custom parts)
function passthrough(s: Sim, e: FlatEl, H: boolean, q0: number, dp0: number): SimEl | null {
  const ks = Object.keys(e.ports); if (ks.length < 2) return null; const id = e.g.item?.id || '';
  if (id === 'h_qc_disc' || id === 'h_plug' || id === 'h_blind_plate') return { key: e.key, tag: e.tag, el: e, nodes: [], kind: 'blocked', f: () => { }, read: () => ({ text: 'closed (disconnected)' }) };
  const pairs: [number, number][] = []; for (let i = 1; i < ks.length; i++) pairs.push([e.ports[ks[0]], e.ports[ks[i]]]);
  const r = rated(s, e, H, q0, dp0); const nodes = [...new Set(pairs.flat())]; const st = { q: 0, dp: 0 };
  return { key: e.key, tag: e.tag, el: e, nodes, kind: 'pass', f: (P, out) => { pairs.forEach(([a, b]) => { const qq = r(P(a), P(b)); out[nodes.indexOf(a)] -= qq; out[nodes.indexOf(b)] += qq; }); },
    post: (ss, P) => { const [a, b] = pairs[0]; st.q = r(P(a), P(b)); st.dp = P(a) - P(b); }, read: () => ({ text: `${fmtQ(Math.abs(st.q), H)} · Δp ${fmtP(Math.abs(st.dp))}` }) };
}
function filter(s: Sim, e: FlatEl, H: boolean): SimEl | null {
  const a = node(e, Object.keys(e.ports)[0]), b = Object.keys(e.ports)[1] ? node(e, Object.keys(e.ports)[1]) : -1; if (b < 0 && a >= 0 && e.g.item?.id === 'h_filter_suction') return null; if (b < 0) return null;
  const id = e.g.item?.id || ''; const clog = 1 / Math.max(0.01, 1 - V(e, 'clog', 0) / 100); const r = rated(s, e, H, H ? 100 / 60000 : 1500 / 60000, (H ? 0.5 : 0.1) * BAR); const byp = V(e, 'dp', (H ? 3 : 0.5) * BAR); const hasBy = /bypass/.test(id);
  const full = restr(s, 0, 0, H ? 200 / 60000 : 3000 / 60000, BAR, H); const st = { q: 0, dp: 0 };
  const fl = (pa: number, pb: number) => { let q = r(pa, pb, 1 / Math.sqrt(clog)); if (hasBy && pa - pb > byp) q += full(pa, pb, clamp01((pa - pb - byp) / (0.5 * BAR))); return q; };
  return { key: e.key, tag: e.tag, el: e, nodes: [a, b], kind: 'pass', f: (P, out) => { const q = fl(P(a), P(b)); out[0] -= q; out[1] += q; }, post: (ss, P) => { st.q = fl(P(a), P(b)); st.dp = P(a) - P(b); },
    read: () => ({ text: `Δp ${fmtP(st.dp)} · ${fmtQ(st.q, H)}${st.dp > byp ? (hasBy ? ' · bypass open' : ' · clogged!') : ''}`, on: st.dp > byp }) };
}
function tank(s: Sim, e: FlatEl, H: boolean): SimEl[] {
  const pt = V(e, 'pt', 0); const els: SimEl[] = Object.keys(e.ports).map((k, i) => { const nn = node(e, k); return { key: i ? e.key + ':' + k : e.key, tag: e.tag, el: e, nodes: [nn], kind: 'tank', f: (P, out) => { out[0] = -1e-7 * (P(nn) - pt); } } as SimEl; });
  if (H) { s.thermal.vol += V(e, 'vol', 0.06); s.thermal.kAmb += V(e, 'kth', 15) * Math.max(0.3, V(e, 'vol', 0.06) / 0.1); if (!s.thermal.init) { s.thermal.T = V(e, 'temp', 313.15) - 273.15; s.thermal.Tamb = V(e, 'tamb', 298.15) - 273.15; s.thermal.init = true; } }
  els[0].read = () => ({ text: `${(V(e, 'vol', 0.06) * 1000).toFixed(0)} L · ${s.thermal.T.toFixed(1)} °C` });
  return els;
}
function thermal(s: Sim, e: FlatEl, H: boolean): SimEl | null {
  const ks = Object.keys(e.ports); const a = ks[0] ? node(e, ks[0]) : -1, b = ks[1] ? node(e, ks[1]) : -1; const heat = e.g.cls === 'heater'; const P0 = V(e, 'p', heat ? 2000 : 3000), tset = V(e, 'tset', (heat ? 35 : 45) + 273.15) - 273.15;
  const r = a >= 0 && b >= 0 ? rated(s, e, H, 60 / 60000, BAR) : null; const qr = V(e, 'q', 60 / 60000); const st = { q: 0, w: 0 };
  return { key: e.key, tag: e.tag, el: e, nodes: r ? [a, b] : [], kind: 'thermal', f: (P, out) => { if (!r) return; const q = r(P(a), P(b)); out[0] -= q; out[1] += q; },
    post: (ss, P) => { st.q = r ? r(P(a), P(b)) : qr; const f = r ? clamp01(Math.abs(st.q) / qr) : 1; const T = ss.thermal.T;
      st.w = heat ? (T < tset ? P0 : 0) : (T > tset ? -P0 * Math.max(0, T - ss.thermal.Tamb) / 40 * f : 0); ss.thermal.Q += st.w; },
    read: () => ({ text: `${st.w >= 0 ? (heat ? 'heating ' : '') : 'cooling '}${(Math.abs(st.w) / 1000).toFixed(2)} kW${r ? ' · ' + fmtQ(Math.abs(st.q), true) : ''}`, on: Math.abs(st.w) > 1 }) };
}

// ----- pumps and compressors -----
function pump(s: Sim, e: FlatEl, H: boolean): SimEl[] {
  const v = e.values, id = e.g.item?.id || '';
  if (!H) {
    if (id === 'p_vacpump') { const a = node(e, 'V'); const C = cOfQn(V(e, 'q', 100 / 60000)); const pv = V(e, 'pvac', -0.95 * BAR); return [{ key: e.key, tag: e.tag, el: e, nodes: [a], kind: 'vacpump', f: (P, out) => { out[0] = -Math.max(0, sonic(C, P(a), pv)); }, read: ss => ({ text: fmtP(a >= 0 ? ss.p[a] : 0) }) }]; }
    const a = node(e, '1'); const qm = RHO0 * V(e, 'q', 300 / 60000), pmax = V(e, 'pmax', 8 * BAR), band = V(e, 'band', BAR); const st = { on: true, q: 0 };
    return [{ key: e.key, tag: e.tag, el: e, nodes: [a], kind: 'compressor', state: st, pre: ss => { const p = a >= 0 ? ss.p[a] : 0; if (p >= pmax) st.on = false; else if (p <= pmax - band) st.on = true; },
      f: (P, out) => { out[0] = st.on ? qm * clamp01((pmax + 0.05 * BAR - P(a)) / (0.2 * BAR)) : 0; }, post: (ss, P) => { st.q = st.on ? qm * clamp01((pmax + 0.05 * BAR - P(a)) / (0.2 * BAR)) : 0; },
      read: ss => ({ text: `${st.on ? 'running' : 'off (cut-out)'} · ${fmtP(a >= 0 ? ss.p[a] : 0)} · ${fmtQ(st.q, false)}`, on: st.on }) } as any];
  }
  const ev = V(e, 'ev', 95) / 100, em = V(e, 'em', 90) / 100, pstall = V(e, 'pstall', 350 * BAR); const lp = { n: V(e, 'n', 1450), disp: V(e, 'disp', 100) / 100 }; const varP = /var|pc/.test(id);
  s.live.set(e.key, varP ? { disp: { label: 'Displacement', unit: '%', min: 0, max: 100, step: 1, scale: 100, get: () => lp.disp, set: (x: number) => { lp.disp = x; } } } : { n: { label: 'Drive speed', unit: 'rpm', min: 0, max: Math.max(3000, lp.n * 1.5), step: 10, scale: 1, get: () => lp.n, set: (x: number) => { lp.n = x; } } });
  const bOut = String(v.dir || 'A out').startsWith('B');
  const pairs: [string, string, number][] = id === 'h_double_pump' ? [['S1', 'P1', V(e, 'vg', 25e-6)], ['S2', 'P2', V(e, 'vg2', 8e-6)]] : e.ports['P'] != null ? [['S', 'P', V(e, 'vg', 16e-6)]] : bOut ? [['A', 'B', V(e, 'vg', 16e-6)]] : [['B', 'A', V(e, 'vg', 16e-6)]];
  const pc = id === 'h_pump_pc' || id === 'h_pump_var_ctrl' ? V(e, 'pc', 180 * BAR) : 0, pcb = V(e, 'pcb', 6 * BAR); const leakG = V(e, 'leak', 0) / (100 * BAR);
  return pairs.map(([si, so, vg], k) => {
    const a = node(e, si), b = node(e, so), l = node(e, 'L'); const st = { q: 0 };
    // leakage part of the volumetric loss follows viscosity (warm, thin oil leaks more)
    const qOf = (pb: number) => { let q = vg * lp.n / 60 * lp.disp * Math.max(0, 1 - (1 - ev) * Math.max(0, pb) / (200 * BAR) / s.vf); if (pc) q *= clamp01((pc - pb) / pcb); q *= clamp01((pstall - pb) / (0.03 * pstall + BAR)); return q; };
    return { key: k ? e.key + ':' + so : e.key, tag: e.tag, el: e, nodes: [a, b, l], kind: 'pump',
      f: (P, out) => { const pb = P(b); const q = qOf(pb); out[0] = -q; out[1] = q; if (l >= 0 && leakG) { const lk = leakG / s.vf * Math.max(0, pb - P(l)); out[1] -= lk; out[2] += lk; } },
      post: (ss, P) => { const pb = P(b); st.q = qOf(pb); if (pb > pstall * 0.98) ss.warn.add(`Pump ${e.tag} stalls at ${fmtP(pstall)} — no pressure relief on its outlet`); if (ss.hyd[b] && pb > 0) ss.thermal.Q += st.q * (pb - P(a)) * (1 / em - 1); },
      read: ss => ({ text: `${(st.q * 60000).toFixed(1)} L/min · ${fmtP(b >= 0 ? ss.p[b] : 0)}`, val: st.q, detail: `drive ${((st.q * Math.max(0, (b >= 0 ? ss.p[b] : 0))) / em / 1000).toFixed(2)} kW` }) };
  });
}
function source(s: Sim, e: FlatEl): SimEl { const a = node(e, '1'); const ps = V(e, 'p', 6 * BAR); const C = cOfQn(V(e, 'q', 5000 / 60000));
  return { key: e.key, tag: e.tag, el: e, nodes: [a], kind: 'source', f: (P, out) => { out[0] = sonic(C, ps, P(a)); }, read: ss => ({ text: fmtP(a >= 0 ? ss.p[a] : 0) }) }; }

// ----- directional valves (Valve Creator definitions) -----
function dcv(s: Sim, e: FlatEl, H: boolean): SimEl {
  const d = e.g.valve, v = e.values, n = valvePositions(d), rest = valveRest(d), L = posLetters(n);
  const startTxt = String(v.start || ''); let start = L.findIndex(x => startTxt.startsWith(x + ' ') || startTxt === x); if (start < 0) start = rest;
  const ports = Object.keys(e.ports); const nodes = ports.map(k => e.ports[k]); const ix = (k: string) => ports.indexOf(k);
  const r = restr(s, 0, 0, V(e, 'q', H ? 40 / 60000 : 800 / 60000), V(e, 'dp', H ? 5 * BAR : BAR), H);
  const paths = (pos: number) => (d.boxes[pos]?.paths || []).map((x: any) => [ix(x.a), ix(x.b), x.thr || 1, x.chk ? 1 : 0]).filter((x: number[]) => x[0] >= 0 && x[1] >= 0);
  const leakG = H && !d.seat ? V(e, 'leak', 0.05 / 60000) / (100 * BAR) : 0; const iP = ix('P'), iT = ix('T') >= 0 ? ix('T') : ix('R');
  const springL = d.ops.left.some((o: any) => o.type === 'spring'), springR = d.ops.right.some((o: any) => o.type === 'spring');
  const pilotSide = (side: 'left' | 'right') => d.ops[side].some((o: any) => o.type === 'pilot');
  const pil = e.g.ports.filter(p => p.role === 'pilot' && e.ports[p.key] != null).map(p => ({ k: p.key, side: (p.x < 0 ? 'left' : 'right') as 'left' | 'right' })).filter(p => pilotSide(p.side));
  // proportional / servo valves: a command −100…+100 % opens side a or b in proportion (slider while running)
  const prop = [...d.ops.left, ...d.ops.right].some((o: any) => o.type === 'proportional' || o.type === 'servo'); const lvv = { cmd: 0 };
  if (prop) s.live.set(e.key, { cmd: { label: 'Command (a ← 0 → b)', unit: '%', min: -100, max: 100, step: 1, scale: 100, get: () => lvv.cmd, set: (x: number) => { lvv.cmd = x; const sd = x < -0.01 ? 0 : x > 0.01 ? n - 1 : rest; se.command(sd, s); } } });
  const cam = String(v.cam || '').trim(); const st = { pos: start, target: start, tSwitch: 0, from: start, holder: '' as '' | 'L' | 'R', resp: V(e, 'resp', H ? 0.03 : 0.015), overlap: String(v.overlap || 'Zero'), q: 0 };
  const camOf = (ss: Sim) => { if (!cam) return null; const m = /^(.+?)([+\-−])$/.exec(cam.replace(/\s+/g, '')); if (!m) return null; const want = m[1], end = m[2]; const pre = e.tag.includes('/') ? e.tag.slice(0, e.tag.lastIndexOf('/') + 1) : '';
    const act = ss.els.find(x => x.kind === 'actuator' && (x.tag === want || x.tag === pre + want)) as any; if (!act) return null; const st2 = act.state; return end === '+' ? st2.x >= st2.L - 0.002 : st2.x <= 0.002; };
  const flows = (P: (i: number) => number, out: number[]) => {
    const moving = st.pos !== st.target; let ps: number[][];
    if (moving && st.overlap === 'Positive') ps = []; else if (moving && st.overlap === 'Negative') ps = [...paths(st.pos), ...paths(st.target)]; else ps = paths(st.pos);
    const o = prop ? Math.max(0.02, Math.abs(lvv.cmd)) : 1; let tot = 0; ps.forEach(([a, b, th, ck]) => { let qq = r(P(nodes[a]), P(nodes[b]), (st.pos === rest ? 1 : o) * th); if (ck) qq = P(nodes[a]) - P(nodes[b]) > 0.3 * BAR ? r(P(nodes[a]), P(nodes[b]), th * clamp01((P(nodes[a]) - P(nodes[b]) - 0.3 * BAR) / (0.5 * BAR))) : 0; out[a] -= qq; out[b] += qq; tot = Math.max(tot, Math.abs(qq)); });
    if (H && leakG && iP >= 0 && iT >= 0) { const qq = leakG / s.vf * (P(nodes[iP]) - P(nodes[iT])); out[iP] -= qq; out[iT] += qq; } return tot;
  };
  const se: any = { key: e.key, tag: e.tag, el: e, nodes, kind: 'valve', state: st, n, rest, letters: L, sol: { on: false, a: false, b: false },
    command: (pos: number, ss: Sim) => { pos = Math.max(0, Math.min(n - 1, pos)); st.holder = ''; if (pos === st.target) return; st.from = st.pos; st.target = pos; st.tSwitch = ss.t + st.resp; },
    pre: (ss: Sim) => {
      // solenoids driven by the PLC — energised side a / b shifts the valve, de-energised it springs back to rest
      // (a valve without springs keeps its position). Valves the program does not drive behave exactly as before.
      if (se.sol.on) { const a = se.sol.a, b = se.sol.b;
        if (a && !b) { if (st.target !== 0) se.command(0, ss); st.holder = 'L'; }
        else if (b && !a) { if (st.target !== n - 1) se.command(n - 1, ss); st.holder = 'R'; }
        else if (!a && !b && st.holder && (springL || springR)) se.command(rest, ss);
        if (st.pos !== st.target && ss.t >= st.tSwitch) st.pos = st.target; return; }
      let aL = false, aR = false;
      if (ss.pilotAuto) pil.forEach(p => { const pp = ss.p[e.ports[p.k]] ?? 0; if (pp > (H ? 5 * BAR : 1.5 * BAR)) { if (p.side === 'left') aL = true; else aR = true; } });
      const c = camOf(ss); if (c != null) { if (c) aL = true; }
      if (aL && !aR && st.target !== 0) { se.command(0, ss); st.holder = 'L'; }
      else if (aR && !aL && st.target !== n - 1) { se.command(n - 1, ss); st.holder = 'R'; }
      else if (!aL && !aR && st.holder && (springL || springR)) { se.command(rest, ss); }
      if (st.pos !== st.target && ss.t >= st.tSwitch) st.pos = st.target;
    },
    f: (P: (i: number) => number, out: number[]) => { flows(P, out); },
    post: (ss: Sim, P: (i: number) => number) => { const o = nodes.map(() => 0); st.q = flows(P, o); },
    read: () => ({ text: `position ${L[st.pos]}${st.pos !== st.target ? ' → ' + L[st.target] : ''}${st.pos === rest ? ' (normal)' : ''}${st.q > 1e-7 ? ' · ' + fmtQ(st.q, H) : ''}${se.sol.on ? ` · PLC: ${se.sol.a ? 'sol a ON' : se.sol.b ? 'sol b ON' : 'de-energised'}` : ''}`, ...(d.pswitch ? { detail: d.pswitch === 'lvdt' ? `spool feedback ${prop ? Math.round(lvv.cmd * 100) : (st.pos - rest) * 100} %` : `position switch ${st.pos === rest ? 'at rest' : 'actuated'}`, on: st.pos !== rest } : {}) })
  };
  return se;
}

// ----- pressure valves: setting + rated flow + override (pressure rise at rated flow) -----
function pressureValve(s: Sim, e: FlatEl, H: boolean): SimEl | null {
  const v = e.values, id = e.g.item?.id || ''; const lp = { set: V(e, 'set', H ? 100 * BAR : 6 * BAR) };
  s.live.set(e.key, { set: { label: 'Setting', unit: 'bar', min: 0, max: Math.max(H ? 400 : 16, lp.set / BAR * 2), step: H ? 1 : 0.1, scale: 1 / BAR, get: () => lp.set, set: (x: number) => { lp.set = x; } } });
  const qr = V(e, 'q', H ? 120 / 60000 : 1500 / 60000), band = H ? Math.max(0.2 * BAR, V(e, 'dpr', 5 * BAR)) : V(e, 'band', 0.25 * BAR);
  const r = restr(s, 0, 0, qr, H ? band : BAR, H); const ratio = V(e, 'ratio', 3);
  const P_ = node(e, 'P'), T_ = node(e, 'T'), A_ = node(e, 'A'), X_ = node(e, 'X');
  const base = { key: e.key, tag: e.tag, el: e, kind: 'pressure' }; const st = { q: 0, open: 0 };
  if (!H) {
    if (e.ports['2'] != null) return regulator(s, e);
    const a = node(e, '1'); const C = cOfQn(qr); return { ...base, nodes: [a], f: (P, out) => { const o = clamp01((P(a) - lp.set) / band); out[0] = -sonic(C * o, P(a), 0); }, post: (ss, P) => { st.open = clamp01((P(a) - lp.set) / band); }, read: () => ({ text: st.open > 0 ? 'blowing off' : `closed (opens at ${fmtP(lp.set)})`, on: st.open > 0 }) };
  }
  const G = qr / band;
  if (/relief_cross/.test(id)) { const a = node(e, 'A'), b = node(e, 'B'), a1 = node(e, 'A1'), b1 = node(e, 'B1'); const thru = restr(s, 0, 0, 300 / 60000, 0.5 * BAR, true);
    return { ...base, nodes: [a, b, a1, b1], f: (P, out) => { const t1 = thru(P(a), P(a1)), t2 = thru(P(b), P(b1)); out[0] -= t1; out[2] += t1; out[1] -= t2; out[3] += t2; const d1 = P(a) - P(b) - lp.set, d2 = P(b) - P(a) - lp.set; const q1 = d1 > 0 ? G * d1 : 0, q2 = d2 > 0 ? G * d2 : 0; out[0] -= q1 - q2; out[1] += q1 - q2; }, read: () => ({ text: `lp.set ${fmtP(lp.set)}` }) }; }
  if (id === 'h_reducing3') { const st3 = { q: 0, rel: 0 }; const fl = (P: (i: number) => number) => { const pa = P(A_); const o = clamp01((lp.set - pa) / band); const q = Math.max(0, r(P(P_), pa, o)); const ro = clamp01((pa - lp.set - 0.3 * band) / band); const qr2 = ro > 0 && T_ >= 0 ? Math.max(0, r(pa, P(T_), ro)) : 0; return [q, qr2]; };
    return { ...base, nodes: [P_, A_, T_], f: (P, out) => { const [q, qr2] = fl(P); out[0] -= q; out[1] += q - qr2; out[2] += qr2; }, post: (ss, P) => { [st3.q, st3.rel] = fl(P); }, read: ss => ({ text: `${fmtP(A_ >= 0 ? ss.p[A_] : 0)} (set ${fmtP(lp.set)}) · ${st3.rel > 1e-7 ? 'relieving ' + fmtQ(st3.rel, true) : fmtQ(st3.q, true)}` }) }; }
  if (/reduc/.test(id)) { const chk = /check/.test(id); const fl = (pp: number, pa: number) => { const o = clamp01((lp.set - pa) / band); let q = r(pp, pa, o); if (q < 0) q = 0; if (chk && pa > pp + 0.5 * BAR) q += r(pp, pa); return q; };
    return { ...base, nodes: [P_, A_], f: (P, out) => { const q = fl(P(P_), P(A_)); out[0] -= q; out[1] += q; }, post: (ss, P) => { st.q = fl(P(P_), P(A_)); }, read: ss => ({ text: `${fmtP(A_ >= 0 ? ss.p[A_] : 0)} (set ${fmtP(lp.set)}) · ${fmtQ(st.q, true)}` }) }; }
  if (/sequence|unloading/.test(id)) { const out_ = /unloading/.test(id) ? T_ : A_; const pil = X_ >= 0 && (/ext|unloading/.test(id)) ? X_ : P_; const chk = /check/.test(id);
    const fl = (P: (i: number) => number) => { const o = clamp01((P(pil) - lp.set) / band); let q = r(P(P_), P(out_), o); if (chk && P(out_) > P(P_) + 0.5 * BAR) q += r(P(P_), P(out_)); return q; };
    return { ...base, nodes: [P_, out_, pil], f: (P, out) => { const q = fl(P); out[0] -= q; out[1] += q; }, post: (ss, P) => { st.q = fl(P); st.open = clamp01((P(pil) - lp.set) / band); }, read: () => ({ text: st.open > 0 ? `open · ${fmtQ(st.q, true)}` : `closed (opens at ${fmtP(lp.set)})`, on: st.open > 0 }) }; }
  if (id === 'h_counterbal_dual') { const a = node(e, 'A'), b = node(e, 'B'), a1 = node(e, 'A1'), b1 = node(e, 'B1');
    // two load-holding halves: free flow valve side → actuator through the checks, return flow opens by load pressure + ratio × opposite line pressure
    const half = (P: (i: number) => number, v: number, c: number, x: number) => { let q = 0; if (P(v) - P(c) > 0.5 * BAR) q += r(P(v), P(c)) * clamp01((P(v) - P(c) - 0.5 * BAR) / BAR); const o = clamp01((P(c) + ratio * P(x) - lp.set) / band); if (o > 0) q -= Math.max(0, r(P(c), P(v), o)); return q; };
    const stq = { a: 0, b: 0 };
    return { ...base, nodes: [a, b, a1, b1], f: (P, out) => { const qa = half(P, a, a1, b), qb = half(P, b, b1, a); out[0] -= qa; out[2] += qa; out[1] -= qb; out[3] += qb; }, post: (ss, P) => { stq.a = half(P, a, a1, b); stq.b = half(P, b, b1, a); },
      read: () => ({ text: `holding ${fmtP(lp.set)}${Math.abs(stq.a) + Math.abs(stq.b) > 1e-7 ? ` · A ${fmtQ(Math.abs(stq.a), true)} · B ${fmtQ(Math.abs(stq.b), true)}` : ''}` }) }; }
  if (/counterbal|overcentre/.test(id)) { const a = id === 'h_overcentre' ? node(e, 'V') : node(e, '1'), b = id === 'h_overcentre' ? node(e, 'C') : node(e, '2'); const x = id === 'h_overcentre' ? X_ : -1;
    const fl = (P: (i: number) => number) => { let q = 0; if (P(a) - P(b) > 0.5 * BAR) q += r(P(a), P(b)) * clamp01((P(a) - P(b) - 0.5 * BAR) / BAR); const o = clamp01((P(b) + (x >= 0 ? ratio * P(x) : 0) - lp.set) / band); if (o > 0) q -= Math.max(0, r(P(b), P(a), o)); return q; };
    return { ...base, nodes: [a, b, x], f: (P, out) => { const q = fl(P); out[0] -= q; out[1] += q; }, post: (ss, P) => { st.q = fl(P); }, read: () => ({ text: `holding ${fmtP(lp.set)}${Math.abs(st.q) > 1e-7 ? ' · ' + fmtQ(Math.abs(st.q), true) : ''}` }) }; }
  if (P_ < 0 && T_ < 0) return null;
  const vented = X_ >= 0 && s.f.deg[X_] > 1, ventp = V(e, 'ventp', 3 * BAR); const eff = (P: (i: number) => number) => vented ? Math.min(lp.set, P(X_) + ventp) : lp.set;
  return { ...base, nodes: [P_, T_, X_], f: (P, out) => { const d = P(P_) - P(T_) - eff(P); const q = d > 0 ? G * d : 1e-15 * (P(P_) - P(T_)); out[0] -= q; out[1] += q; },
    post: (ss, P) => { const d = P(P_) - P(T_) - eff(P); st.q = d > 0 ? G * d : 0; },
    read: () => ({ text: st.q > 1e-6 ? `relieving ${(st.q * 60000).toFixed(1)} L/min` : `closed (set ${fmtP(lp.set)})`, on: st.q > 1e-6 }) };
}
function regulator(s: Sim, e: FlatEl): SimEl { const lp = { set: V(e, 'set', 6 * BAR) }; s.live.set(e.key, { set: { label: 'Regulated pressure', unit: 'bar', min: 0, max: 16, step: 0.1, scale: 1 / BAR, get: () => lp.set, set: (x: number) => { lp.set = x; } } }); const a = node(e, '1'), b = node(e, '2'), x = node(e, '3'); const C = cOfQn(V(e, 'q', 2500 / 60000)), band = V(e, 'band', 0.25 * BAR); const st = { q: 0 };
  const fl = (P: (i: number) => number) => { const o = clamp01((lp.set - P(b)) / band); return Math.max(0, sonic(C * o, P(a), P(b))); };
  return { key: e.key, tag: e.tag, el: e, nodes: [a, b, x], kind: 'regulator', f: (P, out) => { const q = fl(P); out[0] -= q; out[1] += q; const ro = clamp01((P(b) - lp.set - 0.15 * BAR) / band); if (ro > 0) { const qx = Math.max(0, sonic(C * 0.5 * ro, P(b), x >= 0 ? P(x) : 0)); out[1] -= qx; if (x >= 0) out[2] += qx; } },
    post: (ss, P) => { st.q = fl(P); }, read: ss => ({ text: `${fmtP(b >= 0 ? ss.p[b] : 0)} (set ${fmtP(lp.set)}) · ${fmtQ(st.q, false)}` }) }; }

// accumulator charging: pump P charges A through the check until the cut-out pressure, then unloads P → T until A falls to the cut-in pressure
function chargingValve(s: Sim, e: FlatEl): SimEl { const p = node(e, 'P'), a = node(e, 'A'), t = node(e, 'T'); const pOff = V(e, 'poff', 160 * BAR), pOn = V(e, 'pon', 140 * BAR); const r = rated(s, e, true, 60 / 60000, 3 * BAR); const st = { charging: true, q: 0 };
  s.live.set(e.key, { poff: { label: 'Cut-out pressure', unit: 'bar', min: 0, max: 350, step: 1, scale: 1 / BAR, get: () => st2.off, set: (x: number) => { st2.off = x; } } }); const st2 = { off: pOff };
  const fl = (P: (i: number) => number) => { const qa = st.charging && P(p) - P(a) > 0.3 * BAR ? r(P(p), P(a), clamp01((P(p) - P(a) - 0.3 * BAR) / (0.5 * BAR))) : 0; const qt = st.charging ? 0 : t >= 0 ? r(P(p), P(t)) : 0; return [qa, qt]; };
  return { key: e.key, tag: e.tag, el: e, nodes: [p, a, t], kind: 'charging', state: st, pre: ss => { const pa = a >= 0 ? ss.p[a] : 0; if (st.charging && pa >= st2.off) st.charging = false; else if (!st.charging && pa <= Math.min(pOn, st2.off - BAR)) st.charging = true; },
    f: (P, out) => { const [qa, qt] = fl(P); out[0] -= qa + qt; out[1] += qa; out[2] += qt; }, post: (ss, P) => { const [qa, qt] = fl(P); st.q = qa + qt; },
    read: ss => ({ text: `${st.charging ? 'charging' : 'unloading P → T'} · accumulator ${fmtP(a >= 0 ? ss.p[a] : 0)}`, detail: `cut-in ${fmtP(Math.min(pOn, st2.off - BAR))} · cut-out ${fmtP(st2.off)}`, on: st.charging }) } as any; }
// 2-way pressure compensator: throttles 1 → 2 so that p2 − p3 (Δp across the downstream metering orifice) stays at the set value
function compensator(s: Sim, e: FlatEl, H: boolean): SimEl { const a = node(e, '1'), b = node(e, '2'), x = node(e, '3'); const dp = V(e, 'dpc', 10 * BAR), band = 2 * BAR; const r = rated(s, e, H, 100 / 60000, 3 * BAR); const st = { q: 0, o: 0 };
  const fl = (P: (i: number) => number) => { const o = clamp01((dp - (P(b) - (x >= 0 ? P(x) : 0))) / band); return [Math.max(0, r(P(a), P(b), o)), o]; };
  return { key: e.key, tag: e.tag, el: e, nodes: [a, b, x], kind: 'compensator', f: (P, out) => { const [q] = fl(P); out[0] -= q; out[1] += q; }, post: (ss, P) => { [st.q, st.o] = fl(P); }, read: () => ({ text: `Δp ${fmtP(dp)} · ${fmtQ(st.q, H)} · ${Math.round(st.o * 100)} % open` }) }; }

// ----- non-return valves -----
function checkValve(s: Sim, e: FlatEl, H: boolean): SimEl { const id = e.g.item?.id || ''; const crack = V(e, 'crack', H ? 0.5 * BAR : 0.1 * BAR); const ratio = V(e, 'ratio', 3);
  const r = rated(s, e, H, H ? 60 / 60000 : 1500 / 60000, (H ? 3 : 1) * BAR); const band = H ? 0.5 * BAR : 0.1 * BAR;
  if (id === 'h_dpoc') { const a = node(e, 'A'), b = node(e, 'B'), a1 = node(e, 'A1'), b1 = node(e, 'B1');
    return { key: e.key, tag: e.tag, el: e, nodes: [a, a1, b, b1], kind: 'check', f: (P, out) => { const one = (x: number, y: number, pil: number, i: number, j: number) => { const dpp = P(x) - P(y); let q = dpp > crack ? r(P(x), P(y), clamp01((dpp - crack) / band)) : 0; if (P(pil) * ratio > P(y) + crack * ratio) q = r(P(x), P(y)); out[i] -= q; out[j] += q; }; one(a, a1, b, 0, 1); one(b, b1, a, 2, 3); }, read: () => ({ text: 'holding / pilot-released' }) }; }
  const a = node(e, '1'), b = node(e, '2'), x = node(e, 'X'); const st = { q: 0 };
  const fl = (P: (i: number) => number) => { const dpp = P(a) - P(b); let q = dpp > crack ? r(P(a), P(b), clamp01((dpp - crack) / band)) : 0;
    if (id === 'h_poc' && x >= 0 && P(x) * ratio > P(b) + crack * ratio) q = r(P(a), P(b)); if (id === 'h_poc_close' && x >= 0 && P(x) * ratio > P(a)) q = 0; return q; };
  return { key: e.key, tag: e.tag, el: e, nodes: [a, b, x], kind: 'check', f: (P, out) => { const q = fl(P); out[0] -= q; out[1] += q; }, post: (ss, P) => { st.q = fl(P); },
    read: () => ({ text: Math.abs(st.q) > 1e-7 ? `open · ${fmtQ(Math.abs(st.q), H)}` : 'closed', on: Math.abs(st.q) > 1e-7 }) }; }

// ----- flow control -----
function flowValve(s: Sim, e: FlatEl, H: boolean): SimEl | null { const id = e.g.item?.id || ''; const open0 = V(e, 'open', 50) / 100, qr = V(e, 'q', H ? 20 / 60000 : 100 / 60000), dpr = V(e, 'dpr', 5 * BAR);
  const r0 = restr(s, 0, 0, qr, H ? dpr : BAR, H); const full = restr(s, 0, 0, H ? 4 * qr : 4 * qr, H ? dpr : BAR, H); const dpc = V(e, 'dpc', 6 * BAR);
  // viscosity: a long (viscous) throttle flows ∝ 1/ν, a needle throttle partly, a sharp-edged orifice not at all
  const vexp = H ? (id === 'h_throttle_fixed' ? 1 : id === 'h_throttle' || id === 'h_oneway' ? 0.5 : 0) : 0; const r = (pa: number, pb: number, o = 1) => r0(pa, pb, o * (vexp ? Math.pow(s.vf, -vexp) : 1));
  const lv = { open: V(e, 'open', 50) / 100 }; s.live.set(e.key, { open: { label: 'Opening', unit: '%', min: 0, max: 100, step: 1, scale: 100, get: () => lv.open, set: (x: number) => { lv.open = x; } } });
  const free = restr(s, 0, 0, V(e, 'qfree', H ? 60 / 60000 : 600 / 60000), H ? 3 * BAR : BAR, H); const crack = V(e, 'crack', H ? 0.3 * BAR : 0.1 * BAR); const st = { q: 0 };
  if (id === 'h_divider' || id === 'h_divcomb') { const p = node(e, 'P'), a = node(e, 'A'), b = node(e, 'B'); const sh = V(e, 'ratio', 50) / 100, acc = V(e, 'acc', 3) / 100;
    // the spool shares the inlet flow in the set ratio (within its accuracy) as long as both outlets can take it
    return { key: e.key, tag: e.tag, el: e, nodes: [p, a, b], kind: 'flow', f: (P, out) => { const qa = full(P(p), P(a)), qb = full(P(p), P(b)); const tot = qa + qb; const ta = tot * sh, tb = tot * (1 - sh); const fa = Math.abs(qa - ta) > acc * Math.abs(tot) ? ta : qa, fb = tot - fa; void tb; out[0] -= tot; out[1] += fa; out[2] += fb; }, post: (ss, P) => { st.q = full(P(p), P(a)) + full(P(p), P(b)); }, read: () => ({ text: `${fmtQ(st.q, H)} · ${Math.round(sh * 100)} : ${Math.round((1 - sh) * 100)}` }) }; }
  if (id === 'h_fcv3') { const p = node(e, 'P'), a = node(e, 'A'), t = node(e, 'T'); const qs = qr * lv.open; return { key: e.key, tag: e.tag, el: e, nodes: [p, a, t], kind: 'flow', f: (P, out) => { let qa = full(P(p), P(a)); if (qa > qs) qa = qs; const ex = clamp01((P(p) - P(a) - dpc) / (2 * BAR)); const qt = ex > 0 ? full(P(p), P(t), ex) : 0; out[0] -= qa + qt; out[1] += qa; out[2] += qt; }, read: () => ({ text: `${fmtQ(qs, true)} to A, excess to T` }) }; }
  const a = node(e, '1'), b = node(e, '2'); const comp = /fcv/.test(id); const oneway = /oneway/.test(id) || id === 'h_fcv2_check'; void open0;
  const fl = (pa: number, pb: number) => { const open = lv.open, qs = qr * open; let q: number; if (comp) { const raw = full(pa, pb); q = Math.abs(pa - pb) < dpc ? raw * Math.min(1, qs / Math.max(1e-12, Math.abs(full(dpc, 0)))) : Math.sign(raw) * Math.min(Math.abs(raw), qs); } else q = r(pa, pb, open);
    if (oneway && pa - pb > crack) q += free(pa, pb, clamp01((pa - pb - crack) / (0.5 * BAR))); return q; };
  return { key: e.key, tag: e.tag, el: e, nodes: [a, b], kind: 'flow', f: (P, out) => { const q = fl(P(a), P(b)); out[0] -= q; out[1] += q; }, post: (ss, P) => { st.q = fl(P(a), P(b)); }, read: () => ({ text: `${fmtQ(st.q, H)} · ${Math.round(lv.open * 100)} %` }) }; }

// ----- actuators: cylinders, semi-rotary (implicit piston / shaft motion) -----
// End stops are stiff contacts (steel cap + oil film): reaching one produces a real impact force instead of a jump to zero.
// Cushions throttle the closing chamber over the cushion length: the braking pressure shows as the cushion pressure.
function actuator(s: Sim, e: FlatEl, H: boolean): SimEl {
  const v = e.values, id = e.g.item?.id || '', rot = e.g.cls === 'rotary';
  let Ac: number, Ar: number, Lmax: number, mass: number, fric: number;
  if (rot) { const D = V(e, 'disp', H ? 125e-6 : 38e-6) / (2 * Math.PI); Ac = D; Ar = D; Lmax = Math.max(1, V(e, 'swing', 180)) * Math.PI / 180; mass = Math.max(1e-3, V(e, 'inertia', 2) * 0.01); fric = V(e, 'friction', H ? 10 : 0.3); }
  else { const D = V(e, 'bore', 0.063), d = id === 'h_ram' || id === 'p_rodless' ? 0 : Math.min(V(e, 'rod', 0), D * 0.95); Ac = Math.PI * D * D / 4; Ar = Math.PI * (D * D - d * d) / 4; Lmax = Math.max(0.002, V(e, 'stroke', 0.2)); mass = Math.max(0.01, V(e, 'load', 0) + V(e, 'mpist', H ? 2 : 0.2)); fric = V(e, 'friction', H ? 400 : 30); }
  const through = /through|rodless/.test(id); if (through) { const A = id === 'p_rodless' ? Ac : Ar; Ac = A; Ar = A; }
  const ch: { k: string; A: number }[] = []; const add = (k: string, A: number) => { if (e.ports[k] != null) ch.push({ k, A }); };
  add('A', Ac); add('B', -Ar); add('A1', Ac); add('B1', -Ar); add('A2', Ac); add('B2', -Ar);
  const spring = /h_cyl_single$|p_diaphragm|p_bellows|p_cyl_spring_ext|tele_single/.test(id) && !/load/.test(id) ? (id === 'p_cyl_spring_ext' ? 1 : -1) : 0;
  const F0 = V(e, 'F0', H ? 300 : 25), ks = V(e, 'ks', H ? 3 : 0.4) * 1000; const bvisc = V(e, 'vis', rot ? 0.5 : H ? 2500 : 60);
  const grav = rot ? 0 : -(V(e, 'load', 0) + V(e, 'mpist', 0)) * G * Math.sin(V(e, 'angle', 0) * Math.PI / 180);
  const cush = String(v.cushion || 'None'); const cushCap = /cush/.test(id) && (cush === 'Both ends' || cush === 'Cap end'), cushRod = /cush/.test(id) && (cush === 'Both ends' || cush === 'Rod end'); const cushL = V(e, 'cushL', 0.025), cushB = V(e, 'cushB', 2e5);
  const lockX = id === 'h_cyl_lock' ? node(e, 'X') : -1, unlock = V(e, 'unlock', 5 * BAR); const leakG = V(e, 'leakP', 0) / (100 * BAR); const iA = ch.findIndex(c => c.A > 0), iB = ch.findIndex(c => c.A < 0);
  const nodes = ch.map(c => e.ports[c.k]); const dead = V(e, 'dead', H ? 3e-5 : 4e-6);
  // load profile (positive = against extension / forward rotation)
  const mode = String(v.lmode || 'Constant'); const tab = (x: any) => Array.isArray(x) && x.length ? x as number[][] : null; const tp = tab(v.ltab), tt = tab(v.ltabt);
  const interp = (t: number[][], x: number) => { if (x <= t[0][0]) return t[0][1]; for (let i = 1; i < t.length; i++) if (x <= t[i][0]) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; return x1 === x0 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0); } return t[t.length - 1][1]; };
  const lv = { F: V(e, 'fext', rot ? V(e, 'torque', 0) : 0), scale: 1 };
  const posX = (x: number) => rot ? x * 180 / Math.PI * (Math.PI / 180) : x; void posX;
  const loadF = (x: number, t: number) => (mode === 'Spring' ? V(e, 'lF0', 0) + V(e, 'lk', 50) * 1000 * (rot ? 1 / 1000 * 180 / Math.PI : 1) * x : mode === 'Versus position' && tp ? interp(tp, rot ? x * 180 / Math.PI : x) : mode === 'Versus time' && tt ? interp(tt, t) : lv.F) * lv.scale;
  s.live.set(e.key, { load: { label: mode === 'Constant' ? (rot ? 'Load torque' : 'Load force') : 'Load (× profile)', unit: mode === 'Constant' ? (rot ? 'N·m' : 'kN') : '%', min: mode === 'Constant' ? (rot ? -500 : -200) : 0, max: mode === 'Constant' ? (rot ? 2000 : 500) : 300, step: mode === 'Constant' ? (rot ? 1 : 0.5) : 5, scale: mode === 'Constant' ? (rot ? 1 : 1e-3) : 100,
    get: () => mode === 'Constant' ? lv.F : lv.scale, set: (x: number) => { if (mode === 'Constant') lv.F = x; else lv.scale = x; } } });
  // stiff end stops: contact stiffness and damping (about 30 % of critical)
  const kStop = rot ? (H ? 5e4 : 5e3) : (H ? 2e8 : 2e7), cStop = 0.6 * Math.sqrt(kStop * mass);
  const st = { x: (String(v.start || '').startsWith('Ext') || String(v.start || '') === 'End' ? Lmax : 0), v: 0, L: Lmax, F: 0, imp: 0, impMax: 0, pc: 0, pcMax: 0, pk: 0, contact: 0, Fl: 0, vPrev: 0, impV: 0, impE: 0, seat: 0 };
  const springF = () => spring ? -spring * (F0 + ks * (spring < 0 ? st.x : (Lmax - st.x))) : 0;
  const drive = (P: (i: number) => number) => { let D = grav + springF() - loadF(st.x, s.t); ch.forEach(c => { D += c.A * P(e.ports[c.k]); }); return D; };
  const pen = () => st.x < 0 ? st.x : st.x > Lmax ? st.x - Lmax : 0;
  const inCush = () => (cushCap && st.x < cushL && st.v < 0) || (cushRod && st.x > Lmax - cushL && st.v > 0);
  const vel = (P: (i: number) => number) => {
    const D = drive(P);
    if (lockX >= 0 && P(lockX) < unlock) return 0;
    // seated on an end stop: held still while the net force presses it into the stop; it leaves only when the force reverses past friction
    if (st.seat && D * st.seat > -fric) return 0;
    let b = bvisc; if (inCush()) b += rot ? 0 : cushB;
    const p0 = pen(); const kc = p0 !== 0 ? kStop : 0, cc = p0 !== 0 ? cStop : 0;
    const Fc = fric; const Dn = D - kc * p0;
    if (Math.abs(st.v) < 1e-5 && Math.abs(Dn) <= Fc && p0 === 0) return 0;
    const sg = st.v !== 0 ? Math.sign(st.v) : Math.sign(Dn);
    let vn = (st.v + s.dt / mass * (Dn - sg * Fc)) / (1 + s.dt * (b + cc + kc * s.dt) / mass);
    if (st.v !== 0 && Math.sign(vn) !== Math.sign(st.v) && Math.abs(Dn) <= Fc && p0 === 0) vn = 0;
    return vn;
  };
  return { key: e.key, tag: e.tag, el: e, nodes, kind: 'actuator', state: st, rot,
    cap: (ss, C) => ch.forEach(c => { const nn = e.ports[c.k]; const xx = Math.max(0, Math.min(Lmax, st.x)); const Vc = dead + Math.abs(c.A) * (c.A > 0 ? xx : Lmax - xx); C[nn] += ss.hyd[nn] ? Vc / ss.beta : Vc / (KAP * RT); }),
    f: (P, out) => { const vn = vel(P); ch.forEach((c, i) => { const nn = e.ports[c.k]; const k = s.hyd[nn] ? 1 : (P(nn) + PATM) / (KAP * RT); out[i] -= k * c.A * vn; }); if (leakG && iA >= 0 && iB >= 0) { const q = leakG / s.vf * (P(nodes[iA]) - P(nodes[iB])); out[iA] -= q; out[iB] += q; } },
    post: (ss, P) => {
      const vn = vel(P); const cu = inCush(); st.vPrev = st.v; st.v = vn; st.x += vn * ss.dt;
      const p0 = pen(); if (p0 !== 0 && !st.contact) { const vi = Math.abs(st.vPrev); if (vi > 0.002) { st.impV = vi; st.impE = 0.5 * mass * vi * vi; if (st.impE > st.impMax) st.impMax = st.impE; } } // impact: speed and kinetic energy the moving mass brings into the stop
      st.contact = p0 !== 0 ? 1 : 0;
      if (st.seat) { if (drive(P) * st.seat <= -fric) st.seat = 0; else { st.v = 0; st.x = st.seat > 0 ? Lmax : 0; } }
      else if (p0 !== 0 && Math.abs(vn) < 0.005 && drive(P) * Math.sign(p0) >= 0) { st.seat = Math.sign(p0); st.v = 0; st.x = st.seat > 0 ? Lmax : 0; }
      if (Math.abs(st.x) < 1e-7 && st.v === 0) st.x = 0;
      // cushion: the braking force acts on the closing chamber — shown as its pressure
      const Aclose = st.v > 0 ? Ar : Ac; st.pc = cu && !rot ? (cushB * Math.abs(vn)) / Math.max(1e-6, Aclose) : 0; if (st.pc > st.pcMax) st.pcMax = st.pc;
      let pk = 0; ch.forEach(c => { pk = Math.max(pk, P(e.ports[c.k])); }); pk = Math.max(pk, st.pc); if (pk > st.pk) st.pk = pk;
      st.F = drive(P); st.Fl = loadF(st.x, s.t);
    },
    read: () => {
      const x = Math.max(0, Math.min(Lmax, st.x)); const imp = st.impMax > 0 ? ` · last impact ${rot ? (st.impV * 30 / Math.PI).toFixed(0) + ' rpm' : (st.impV * 1000).toFixed(0) + ' mm/s'}, ${st.impE < 10 ? st.impE.toFixed(2) : st.impE.toFixed(0)} J (max ${st.impMax < 10 ? st.impMax.toFixed(2) : st.impMax.toFixed(0)} J)` : '';
      return rot ? { text: `${Math.round(x * 180 / Math.PI)}° · ${(st.v * 30 / Math.PI).toFixed(1)} rpm`, val: x / Lmax, detail: `torque ${st.F.toFixed(1)} N·m${imp}` }
        : { text: `${(x * 1000).toFixed(1)} mm · ${(st.v * 1000).toFixed(0)} mm/s`, val: x / Lmax, detail: `force ${(st.F / 1000).toFixed(2)} kN${st.Fl ? ` · load ${(st.Fl / 1000).toFixed(2)} kN` : ''}${imp}${st.pcMax > 0 ? ` · cushion peak ${(st.pcMax / BAR).toFixed(0)} bar` : ''}` }; }
  } as any;
}
function motor(s: Sim, e: FlatEl): SimEl {
  const lp = { disp: V(e, 'disp', 100) / 100 }; if (/var/.test(e.g.item?.id || '')) s.live.set(e.key, { disp: { label: 'Displacement', unit: '%', min: 5, max: 100, step: 1, scale: 100, get: () => lp.disp, set: (x: number) => { lp.disp = x; } } });
  const ev = V(e, 'ev', 96) / 100, em = V(e, 'em', 92) / 100; const vg0 = V(e, 'vg', 25e-6); let k0 = vg0 * lp.disp / (2 * Math.PI), k = k0 / ev; const J = Math.max(0.002, V(e, 'inertia', 10) * 0.01); const Tl = V(e, 'torque', 50); const b = 0.02; const wmax = V(e, 'nmax', 3000) * 2 * Math.PI / 60;
  const a = node(e, 'A'), bb = node(e, 'B'), l = node(e, 'L'); const leakG = V(e, 'leak', /motor_drain/.test(e.g.item?.id || '') ? 0.5 / 60000 : 0) / (100 * BAR); const st = { w: 0, ang: 0 };
  const vel = (P: (i: number) => number) => { k0 = vg0 * lp.disp / (2 * Math.PI); k = k0 / (1 - (1 - ev) / s.vf); const D = k0 * em * (P(a) - P(bb)); if (Math.abs(st.w) < 1e-3 && Math.abs(D) <= Tl) return 0; const sg = st.w !== 0 ? Math.sign(st.w) : Math.sign(D); let wn = (st.w + s.dt / J * (D - sg * Tl)) / (1 + s.dt * b / J); if (st.w !== 0 && Math.sign(wn) !== Math.sign(st.w) && Math.abs(D) <= Tl) wn = 0; return wn; };
  return { key: e.key, tag: e.tag, el: e, nodes: [a, bb, l], kind: 'motor', state: st, f: (P, out) => { const wn = vel(P); out[0] -= k * wn; out[1] += k * wn; if (l >= 0 && leakG) { const lk = leakG / s.vf * Math.max(0, P(a) - P(l)); out[0] -= lk; out[2] += lk; } },
    post: (ss, P) => { st.w = vel(P); st.ang += st.w * ss.dt; if (Math.abs(st.w) > wmax) ss.warn.add(`Motor ${e.tag} over its max. speed ${Math.round(wmax * 60 / (2 * Math.PI))} rpm`); ss.thermal.Q += Math.abs(k * st.w * (P(a) - P(bb))) * (1 - em * ev); }, read: () => ({ text: `${(st.w * 60 / (2 * Math.PI)).toFixed(0)} rpm`, val: st.w }) } as any;
}
function pneuMotor(s: Sim, e: FlatEl): SimEl { const ks = Object.keys(e.ports); const a = node(e, ks[0]), b = ks[1] ? node(e, ks[1]) : -1; const qr = V(e, 'q', 200 / 60000), nr = V(e, 'nr', 6000); const C = cOfQn(qr); const st = { q: 0 };
  return { key: e.key, tag: e.tag, el: e, nodes: [a, b], kind: 'motor', f: (P, out) => { const q = sonic(C, P(a), P(b)); out[0] -= q; out[1] += q; }, post: (ss, P) => { st.q = sonic(C, P(a), P(b)); }, read: () => ({ text: `${Math.round(nr * Math.max(0, st.q / RHO0) / qr)} rpm · ${fmtQ(st.q, false)}` }) }; }
function accumulator(s: Sim, e: FlatEl): SimEl { const id = e.g.item?.id || ''; const nn = node(e, Object.keys(e.ports)[0]); const V0 = V(e, 'vol', 0.004), p0 = V(e, 'pre', 90 * BAR) + PATM; const st = { oil: 0 };
  const gas = id !== 'h_accu_spring' && id !== 'h_accu_weight'; const n = String(e.values.poly || '').startsWith('Iso') ? 1.0 : 1.4; const pf = V(e, 'pfull', 130 * BAR) + PATM;
  const init = String(e.values.init || 'Empty'); if (nn >= 0 && init !== 'Empty') s.p[nn] = init === 'Full' ? (gas ? (p0 - PATM) * 2.5 : pf - PATM) : p0 - PATM;
  return { key: e.key, tag: e.tag, el: e, nodes: [], kind: 'accumulator', f: () => { }, cap: (ss, C) => { if (nn < 0) return; const pa = ss.p[nn] + PATM; if (gas) { if (pa > p0) C[nn] += V0 * Math.pow(p0, 1 / n) / n * Math.pow(pa, -1 / n - 1); } else if (pa > p0 && pa < pf) C[nn] += V0 / Math.max(BAR, pf - p0); },
    post: (ss) => { const pa = ss.p[nn] + PATM; st.oil = gas ? (pa > p0 ? V0 * (1 - Math.pow(p0 / pa, 1 / n)) : 0) : Math.max(0, Math.min(V0, V0 * (pa - p0) / Math.max(BAR, pf - p0))); }, read: ss => ({ text: `${(st.oil * 1000).toFixed(2)} L oil · ${fmtP(nn >= 0 ? ss.p[nn] : 0)}`, val: st.oil / V0 }) }; }
function sensor(s: Sim, e: FlatEl, H: boolean): SimEl | null { const v = e.values, id = e.g.item?.id || ''; const ks = Object.keys(e.ports);
  if (/flowmeter|flowind|contam/.test(id) && ks.length === 2) return passthrough(s, e, H, 100 / 60000, 0.3 * BAR);
  const a = ks.length ? node(e, ks[0]) : -1, b = ks[1] ? node(e, ks[1]) : -1; const rg = V(e, 'range', 0); const damp = V(e, 'damp', 0); const hyst = V(e, 'hyst', 5) / 100; const st = { disp: 0, on: false };
  return { key: e.key, tag: e.tag, el: e, nodes: [], kind: e.g.cls,
    post: (ss) => { const raw = (a >= 0 ? ss.p[a] : 0); st.disp = damp > 0 ? st.disp + (raw - st.disp) * Math.min(1, ss.dt / damp) : raw;
      if (typeof v.set === 'number') { const val = /temp/.test(id) ? ss.thermal.T + 273.15 : raw; const sp = v.set, hy = /temp/.test(id) ? Math.max(0.5, (sp - 273.15) * hyst) : Math.abs(sp) * hyst + 0.05 * BAR; if (/vac/.test(id)) { if (val < sp) st.on = true; else if (val > sp + hy) st.on = false; } else { if (val >= sp) st.on = true; else if (val < sp - hy) st.on = false; } } },
    f: () => { }, read: ss => {
    const pa = a >= 0 ? ss.p[a] : 0, pb = b >= 0 ? ss.p[b] : 0;
    if (/thermo/.test(id)) return { text: `${ss.thermal.T.toFixed(1)} °C`, val: ss.thermal.T };
    if (/tacho/.test(id)) return { text: '' };
    if (/dpgauge/.test(id)) return { text: `Δp ${fmtP(pa - pb)}`, val: pa - pb };
    if (e.g.cls === 'gauge') return a >= 0 ? { text: fmtP(st.disp) + (rg && st.disp > rg ? ' · OVER RANGE' : ''), val: st.disp, on: !!rg && st.disp > rg } : { text: '' };
    if (id === 'h_ptransducer') return { text: `${fmtP(pa)} → ${(4 + 16 * clamp01(pa / Math.max(rg || 250 * BAR, 1))).toFixed(1)} mA` };
    if (typeof v.set === 'number') return { text: st.on ? 'switched' : 'off', on: st.on, val: pa };
    return { text: fmtP(pa), val: pa }; } }; }
function logic(s: Sim, e: FlatEl): SimEl | null { const id = e.g.item?.id || ''; const C = cOfQn(V(e, 'q', 400 / 60000));
  if (id === 'h_shuttle') { const i1 = node(e, '1'), i2 = node(e, '1·2'), o = node(e, '2'); const r = rated(s, e, true, 60 / 60000, 3 * BAR); const st = { src: 0 };
    return { key: e.key, tag: e.tag, el: e, nodes: [i1, i2, o], kind: 'logic', f: (P, out) => { const src = P(i1) >= P(i2) ? 0 : 1; const nn = src ? i2 : i1; const q = r(P(nn), P(o)); out[src] -= q; out[2] += q; }, post: (ss, P) => { st.src = P(i1) >= P(i2) ? 0 : 1; }, read: ss => ({ text: `${fmtP(o >= 0 ? ss.p[o] : 0)} · from ${st.src ? 'right' : 'left'} inlet` }) }; }
  if (id === 'p_shuttle' || id === 'p_and') { const i1 = node(e, '1'), i2 = node(e, '1·2'), o = node(e, '2');
    return { key: e.key, tag: e.tag, el: e, nodes: [i1, i2, o], kind: 'logic', f: (P, out) => { if (id === 'p_shuttle') { const src = P(i1) >= P(i2) ? 0 : 1; const nn = src ? i2 : i1; const q = sonic(C, P(nn), P(o)); out[src] -= q; out[2] += q; } else { const lo = P(i1) <= P(i2) ? 0 : 1; const nn = lo ? i2 : i1; const q = sonic(C, P(nn), P(o)); out[lo] -= q; out[2] += q; } }, read: ss => ({ text: fmtP(o >= 0 ? ss.p[o] : 0) }) }; }
  if (id === 'p_quickexh') { const a = node(e, '1'), b = node(e, '2'), x = node(e, '3'); const Cx = cOfQn(V(e, 'qx', 1500 / 60000));
    return { key: e.key, tag: e.tag, el: e, nodes: [a, b, x], kind: 'logic', f: (P, out) => { if (P(a) >= P(b) - 0.05 * BAR) { const q = sonic(C, P(a), P(b)); out[0] -= q; out[1] += q; } else { const q = sonic(Cx, P(b), x >= 0 ? P(x) : 0); out[1] -= q; if (x >= 0) out[2] += q; } } }; }
  if (id === 'p_timer') { const pl = node(e, '12'), a = node(e, '1'), b = node(e, '2'); const st = { since: -1, on: false }; const delay = V(e, 'delay', 2);
    return { key: e.key, tag: e.tag, el: e, nodes: [a, b], kind: 'logic', pre: ss => { const sig = pl >= 0 && ss.p[pl] > 1.5 * BAR; if (sig) { if (st.since < 0) st.since = ss.t; st.on = ss.t - st.since >= delay; } else { st.since = -1; st.on = false; } },
      f: (P, out) => { if (st.on) { const q = sonic(C, P(a), P(b)); out[0] -= q; out[1] += q; } else { const q = sonic(C, P(b), 0); out[1] -= q; } }, read: ss => ({ text: st.on ? 'timed out — open' : st.since >= 0 ? `${Math.max(0, delay - (ss.t - st.since)).toFixed(1)} s` : 'idle', on: st.on }) }; }
  return null; }
function vacuum(s: Sim, e: FlatEl): SimEl | null { const id = e.g.item?.id || '';
  if (id === 'p_ejector') { const a = node(e, '1'), vv = node(e, 'V'); const C = cOfQn(V(e, 'q', 150 / 60000)), Cv = cOfQn(V(e, 'qv', 80 / 60000)); const pv = V(e, 'pvac', -0.85 * BAR);
    return { key: e.key, tag: e.tag, el: e, nodes: [a, vv], kind: 'vacuum', f: (P, out) => { const q = sonic(C, P(a), 0); out[0] -= q; const on = clamp01(P(a) / (4 * BAR)); if (vv >= 0 && on > 0) out[1] -= Math.max(0, sonic(Cv * on, P(vv), pv * on)); }, read: ss => ({ text: vv >= 0 ? fmtP(ss.p[vv]) : '' }) }; }
  if (id === 'p_suction_cup') { const vv = node(e, 'V'); const d = V(e, 'd', 0.04), m = V(e, 'load', 1), sf = V(e, 'sf', 2), Vc = V(e, 'vol', 2e-5); const A = Math.PI * d * d / 4;
    return { key: e.key, tag: e.tag, el: e, nodes: [], kind: 'vacuum', f: () => { }, cap: (ss, Cc) => { if (vv >= 0) Cc[vv] += Vc / (KAP * RT); },
      read: ss => { const pv = vv >= 0 ? ss.p[vv] : 0; const F = Math.max(0, -pv) * A; const ok = F >= m * G * sf; return { text: ok ? `holding ${(F).toFixed(0)} N (needs ${(m * G * sf).toFixed(0)} N)` : pv < -0.05 * BAR ? `too weak: ${F.toFixed(0)} N` : 'released', on: ok }; } }; }
  return null; }
function intensifier(s: Sim, e: FlatEl): SimEl { const i = node(e, 'IN'), o = node(e, 'OUT'), r = node(e, 'R'); const rr = V(e, 'ratio', 400); const ratio = rr > 10 ? rr / 100 : rr; const Kc = V(e, 'q', 3 / 60000) / Math.sqrt(5 * BAR);
  return { key: e.key, tag: e.tag, el: e, nodes: [i, o, r], kind: 'intensifier', f: (P, out) => { const d = ratio * P(i) - P(o); const qo = d > 0 ? orifice(Kc, d) : 0; out[1] += qo; out[0] -= ratio * qo; out[2] += ratio * qo; }, read: ss => ({ text: o >= 0 ? fmtP(ss.p[o]) : '' }) }; }
function cartridge(s: Sim, e: FlatEl, H: boolean): SimEl { const a = node(e, 'A'), b = node(e, 'B'), x0 = node(e, 'X'), z = node(e, 'Z1'); const x = x0; const r = rated(s, e, H, 200 / 60000, 3 * BAR); const spring = V(e, 'set', 2 * BAR), ar = V(e, 'area', 1); const st = { open: false };
  const pil = (P: (i: number) => number) => Math.max(x >= 0 ? P(x) : 0, z >= 0 ? P(z) : 0); const op = (P: (i: number) => number) => Math.max(P(a), P(b)) > ar * pil(P) + spring;
  return { key: e.key, tag: e.tag, el: e, nodes: [a, b, x, z], kind: 'cartridge', f: (P, out) => { const q = op(P) ? r(P(a), P(b)) : 0; out[0] -= q; out[1] += q; }, post: (ss, P) => { st.open = op(P); }, read: () => ({ text: st.open ? 'open' : 'closed', on: st.open }) }; }

// ===================== session (UI side) =====================
export type SimView = { sheet: string; t: number; running: boolean; speed: number; rtf: number; issues: Issue[]; warns: string[] };
export const simView = signal<SimView | null>(null);
export const simFrame = signal(0);
export let SIM: Sim | null = null;
export type Trace = { key: string; label: string; unit: string; color: string; pts: number[]; get: () => number };
export const traces: { t: number[]; list: Trace[] } = { t: [], list: [] };
let raf = 0, last = 0, frames = 0; export let animT = 0;
// alert history (first time each limit was crossed) for the Simulation tab
export const alertLog = new Map<string, { t: number; text: string }>();
const COLORS = ['#0A64C2', '#C2410C', '#15803D', '#7C3AED', '#B45309', '#0E7490', '#BE185D', '#4D7C0F'];

export function simStart(sheetId: string) {
  const p = S.project.value; if (!p) return false;
  const so = S.settings.value.solver as any;
  try { SIM = new Sim(p, sheetId, { beta: 1.4e9, rho: so.density || 870, pilotAuto: so.pilotAuto !== false, dt: so.simDt ? so.simDt / 1000 : undefined }); }
  catch (e: any) { S.notify('Simulation could not start: ' + (e?.message || e), 'err'); return false; }
  if (!SIM.els.length) { S.toast('Nothing to simulate on this sheet', 'warn'); SIM = null; return false; }
  traces.t = []; traces.list = []; liveChanged.clear();
  alertLog.clear();
  SIM.els.filter(e => e.kind === 'actuator').slice(0, 3).forEach(e => addTrace('el', e.key, 'x'));
  SIM.els.filter(e => e.kind === 'pump' || e.kind === 'compressor').slice(0, 2).forEach(e => addTrace('el', e.key, 'p'));
  S.editLock.value = 'Simulation running — stop it (Shift+F5) to edit the circuit';
  simView.value = { sheet: sheetId, t: 0, running: true, speed: simView.value?.speed || 1, rtf: 1, issues: SIM.issues, warns: [] };
  if (SIM.issues.some(i => i.level === 'err')) S.toast('Simulation started with problems — see the Simulation tab', 'warn');
  last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); return true;
}
export const stopHooks: (() => void)[] = [];
export function simStop() { stopHooks.forEach(f => { try { f(); } catch {} }); cancelAnimationFrame(raf); SIM = null; simView.value = null; S.editLock.value = null; simFrame.value++; }
export function simPause(on?: boolean) { const v = simView.value; if (!v) return; const run = on == null ? !v.running : !on; simView.value = { ...v, running: run }; if (run) { last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); } }
export function simReset() { const v = simView.value; if (!v) return; const sp = v.speed; simStop(); simStart(v.sheet); if (simView.value) simView.value = { ...simView.value, speed: sp }; }
export function simSpeed(x: number) { const v = simView.value; if (v) simView.value = { ...v, speed: x }; }
export function simStepOnce() { if (!SIM) return; SIM.run(0.01, 200); SIM.measure(); sample(); simView.value = { ...simView.value!, t: SIM.t, running: false }; simFrame.value++; }
function sample() { if (!SIM) return; traces.t.push(SIM.t); traces.list.forEach(tr => { let y = 0; try { y = tr.get(); } catch { y = 0; } tr.pts.push(isFinite(y) ? y : 0); });
  if (traces.t.length > 6000) { traces.t.splice(0, 2000); traces.list.forEach(tr => tr.pts.splice(0, 2000)); } }
// what can be plotted for a line or a part
export function probeFields(kind: 'pipe' | 'el', key: string): [string, string][] {
  if (!SIM) return []; if (kind === 'pipe') return [['p', 'Pressure'], ['q', 'Flow'], ['v', 'Velocity']];
  const e: any = SIM.el(key); if (!e) return []; const out: [string, string][] = [];
  if (e.kind === 'actuator') out.push(['x', e.rot ? 'Angle (% of swing)' : 'Stroke (% of stroke)'], ['v', 'Speed'], ['F', e.rot ? 'Net torque' : 'Net force'], ['L', e.rot ? 'Load torque' : 'Load']);
  if (e.kind === 'valve') out.push(['pos', 'Valve position (box)']);
  if (e.kind === 'pump' || e.kind === 'compressor') out.push(['p', 'Outlet pressure'], ['q', 'Delivery']);
  if (e.kind === 'motor') out.push(['w', 'Speed (rpm)']);
  if (e.kind === 'tank' || e.kind === 'thermal' || /thermo/.test(e.el?.g.item?.id || '')) out.push(['T', 'Oil temperature'], ['nu', 'Viscosity']);
  if (e.el && Object.keys(e.el.ports).length && !out.some(x => x[0] === 'p')) out.push(['pp', 'Pressure at ' + e.el.g.ports.find((q: any) => e.el.ports[q.key] != null)?.name]);
  return out;
}
export function addTrace(kind: 'pipe' | 'el', key: string, field: string) {
  if (!SIM) return false; const id = kind + ':' + key + ':' + field; if (traces.list.some(t => t.key === id)) return false;
  if (traces.list.length >= 8) { S.toast('Up to 8 signals can be plotted — remove one first', 'warn'); return false; }
  const s = SIM; let label = '', unit = '', get: () => number = () => 0;
  if (kind === 'pipe') { const nn = s.f.pipeNode.get(key)!; const nm = s.f.labels[nn].slice(0, 2).join('–') || 'line'; const H = s.hyd[nn];
    if (field === 'p') { label = nm + ' p'; unit = 'bar'; get = () => s.p[nn] / BAR; } else if (field === 'q') { label = nm + ' Q'; unit = H ? 'L/min' : 'Nl/min'; get = () => (s.pipeQ.get(key) ?? 0) * 60000 / (H ? 1 : RHO0); } else { label = nm + ' v'; unit = 'm/s'; get = () => s.pipeV.get(key) ?? 0; } }
  else { const e: any = s.el(key); if (!e) return false; const tg = e.tag;
    const m: Record<string, [string, string, () => number]> = {
      x: [tg + (e.rot ? ' angle' : ' stroke'), '%', () => Math.max(0, Math.min(1, e.state.x / e.state.L)) * 100], v: [tg + ' speed', e.rot ? 'rpm' : 'mm/s', () => e.rot ? e.state.v * 30 / Math.PI : e.state.v * 1000], F: [tg + (e.rot ? ' torque' : ' force'), e.rot ? 'N·m' : 'kN', () => e.rot ? e.state.F : e.state.F / 1000], L: [tg + (e.rot ? ' load torque' : ' load'), e.rot ? 'N·m' : 'kN', () => e.rot ? e.state.Fl : e.state.Fl / 1000],
      pos: [tg + ' position', 'box', () => e.state.pos], p: [tg + ' p', 'bar', () => (s.p[e.nodes[1] ?? e.nodes[0]] ?? 0) / BAR], q: [tg + ' Q', e.kind === 'pump' ? 'L/min' : 'Nl/min', () => (e.read?.(s)?.val ?? 0) * 60000],
      w: [tg + ' speed', 'rpm', () => e.state.w * 60 / (2 * Math.PI)], T: ['Oil temperature', '°C', () => s.thermal.T], nu: ['Oil viscosity', 'cSt', () => s.nu()],
      pp: [tg + ' p', 'bar', () => { const n0 = Object.values(e.el.ports)[0] as number; return (s.p[n0] ?? 0) / BAR; }] };
    const d = m[field]; if (!d) return false; [label, unit, get] = d; }
  const used = new Set(traces.list.map(t => t.color)); const color = COLORS.find(c => !used.has(c)) || COLORS[traces.list.length % COLORS.length];
  traces.list.push({ key: id, label, unit, color, pts: traces.t.map(() => NaN), get }); return true;
}
export function removeTrace(id: string) { traces.list = traces.list.filter(t => t.key !== id); simFrame.value++; }
export function tracesCsv() { const head = ['t (s)', ...traces.list.map(t => `${t.label} (${t.unit})`)]; const rows = traces.t.map((tt, i) => [tt.toFixed(4), ...traces.list.map(t => isFinite(t.pts[i]) ? t.pts[i].toPrecision(6) : '')].join(','));
  return [head.join(','), ...rows].join('\n'); }
// live parameters ("Keep these settings" writes them back to the parts)
export const liveChanged = new Map<string, Record<string, number>>();
export function setLive(key: string, prm: string, v: number) { const L = SIM?.live.get(key)?.[prm]; if (!L) return; L.set(v); const m = liveChanged.get(key) || {}; m[prm] = v; liveChanged.set(key, m); simFrame.value++; }

function loop(now: number) {
  const v = simView.value; if (!SIM || !v || !v.running) return;
  const wall = Math.min(0.05, (now - last) / 1000); last = now; const want = wall * v.speed; const t0 = SIM.t;
  SIM.run(want, 18); SIM.alerts.forEach((tx, k) => { if (!alertLog.has(k)) alertLog.set(k, { t: SIM!.t, text: tx }); }); const got = SIM.t - t0; frames++; SIM.measure(); animT += wall * (S.prefs.value.sim?.speed ?? 100) / 100;
  sample();
  if (frames % 3 === 0 || got < want * 0.9) simView.value = { ...v, t: SIM.t, rtf: want > 0 ? Math.min(1, got / want) * v.speed : v.speed, warns: [...SIM.warn] };
  simFrame.value++;
  raf = requestAnimationFrame(loop);
}
export function simClickValve(key: string, box: number) { const e = SIM?.el(key) as any; if (!e || e.kind !== 'valve') return; e.command(box, SIM!); simFrame.value++; }
export function simToggle(key: string) { const e = SIM?.el(key) as any; if (!e) return; if (e.kind === 'shutoff') { e.state.open = !e.state.open; simFrame.value++; } }
// pressure → colour (ISO-style: light blue at rest, through blue to red at the highest setting)
export function pColor(p: number, pmax: number) {
  const r = Math.max(0, Math.min(1, p / Math.max(pmax, 1e3)));
  if (p < 0) return '#7C3AED'; // vacuum
  const hue = 210 - 210 * r, light = 62 - 22 * Math.min(1, r * 3);
  return `hsl(${hue.toFixed(0)} ${(55 + 30 * r).toFixed(0)}% ${light.toFixed(0)}%)`;
}
export const BAR_ = BAR;
