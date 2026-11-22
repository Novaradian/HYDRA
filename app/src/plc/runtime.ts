// Logic Coder: the PLC runtime. Deterministic scan cycle: read inputs → run every stack once →
// write outputs. Time advances by exactly one scan per cycle, so a program behaves the same at any playback speed.
// Inputs come from an adapter: standalone (8a) the user sets them in the I/O table; linked to the hydraulic simulation
// (8b) the sheets supply them. Forced values win over both.
import type { Compiled, Program, Var } from './compile';
import type { SigTable } from './signals';

export type State = 'stopped' | 'running' | 'paused' | 'estop' | 'fault';
export type Ev = { scan: number; t: number; id: string; v: any };
export type Alarm = { code: string; sev: string; text: string; t: number; active: boolean; acked: boolean; cleared?: number };
export type Adapter = { name: string; read(rt: Plc): void; write(rt: Plc): void; cyl?(id: string, end: string): boolean };
type Timer = { kind: string; IN: boolean; Q: boolean; ET: number; PT: number; t0: number };
type Counter = { kind: string; CV: number; PV: number; Q: boolean; QD: boolean; up: boolean; dn: boolean };
type Seq = { cur: string; nxt: string | null; t0: number; init: string; changed: number; held?: number };
export type Pid = { i: number; pv1: number; out: number; e: number; sp: number; pv: number };
class PlcFault extends Error { constructor(msg: string, public block?: string) { super(msg); } }
const BREAK = 1;

export class Plc {
  state: State = 'stopped'; t = 0; scanNo = 0; dt = 0.01; speed = 1;
  prog: Program; c: Compiled; sigs: SigTable; adapter: Adapter;
  // process image
  sim: Record<string, any> = {};     // standalone: values the user set for inputs / analog inputs
  inp: Record<string, any> = {};     // input image of this scan (after forcing)
  force: Record<string, any> = {};   // forced inputs / outputs
  store: Record<string, boolean> = {}; nAct = new Set<string>(); out: Record<string, boolean> = {}; prevOut: Record<string, boolean> = {};
  aout: Record<string, number> = {}; cylState: Record<string, { p: boolean; m: boolean }> = {};
  v: Record<string, any> = {}; timers: Record<string, Timer> = {}; counters: Record<string, Counter> = {}; seqs: Record<string, Seq> = {};
  mem = new Map<string, any>(); // edges, TRUE FOR timers (per block)
  // 8d: arrays, records, PID, shift registers, function-block instances, machine mode, real-time clock
  arrs: Record<string, number[]> = {}; recs: Record<string, Record<string, any>> = {}; pids: Record<string, Pid> = {}; sregs: Record<string, { bits: boolean[]; clk: boolean }> = {};
  fbo: Record<string, Record<string, any>> = {}; ip = ''; mode = 'OFF'; wall0 = Date.now();
  // debug
  bps = new Set<string>(); private skip: string | null = null; bpAt: string | null = null;
  exec = new Set<string>(); lastExec = new Set<string>(); waits = new Map<string, { since: number; stall: number; stalled: boolean }>();
  writes = new Map<string, number>(); multiWrite = new Set<string>();
  events: Ev[] = []; alarms: Alarm[] = []; message = ''; fault: { text: string; block?: string; t: number } | null = null;
  trace: { t: number[]; ids: string[]; cols: Record<string, number[]> } = { t: [], ids: [], cols: {} };
  estopCmd = false; private estopWas = false;
  private gens: (Generator | null)[] = []; private startGen: Generator | null = null; private pending = -1; private loops = new Map<string, number>();
  private fns: Record<string, (() => Generator)[]> = {};
  constructor(prog: Program, c: Compiled, sigs: SigTable, adapter: Adapter) { this.prog = prog; this.c = c; this.sigs = sigs; this.adapter = adapter; this.dt = (prog.scanMs || 10) / 1000; }

  // ---------- life cycle ----------
  private resetMem(keepSim = true) {
    this.t = 0; this.scanNo = 0; this.store = {}; this.nAct.clear(); this.out = {}; this.prevOut = {}; this.aout = {}; this.timers = {}; this.counters = {}; this.seqs = {}; this.mem.clear();
    this.arrs = {}; this.recs = {}; this.pids = {}; this.sregs = {}; this.fbo = {}; this.ip = ''; this.mode = 'OFF'; this.wall0 = Date.now();
    this.waits.clear(); this.exec.clear(); this.lastExec.clear(); this.events = []; this.alarms = []; this.message = ''; this.fault = null; this.bpAt = null; this.skip = null; this.pending = -1; this.multiWrite.clear();
    this.v = {}; (this.prog.vars || []).forEach(x => { this.v[x.id] = initOf(x); });
    if (!keepSim) this.sim = {}; this.trace.t = []; Object.keys(this.trace.cols).forEach(k => this.trace.cols[k] = []);
  }
  start() { // Run from stopped: fresh memory, ON START, then MAIN LOOP every scan
    if (!this.c.fn) throw new Error('The program has errors — fix them before running');
    this.resetMem(); const api = this.api(); this.fns = this.c.fn(api);
    this.gens = (this.fns.hy_main || []).map(() => null); this.startGen = this.fns.hy_start?.[0]?.() || null; this.state = 'running'; this.estopWas = false;
  }
  stop() { this.state = 'stopped'; this.allOff(); this.commitOutputs(); this.bpAt = null; this.pending = -1; this.waits.clear(); }
  pause() { if (this.state === 'running') this.state = 'paused'; }
  resume() { if (this.state === 'paused') { this.state = 'running'; if (this.bpAt) { this.skip = this.bpAt; this.bpAt = null; } } }
  /** one scan by hand (the Scan button): from stopped it starts the program first */
  stepScan() { if (this.state === 'stopped') this.start(); if (this.state === 'paused') { if (this.bpAt) { this.skip = this.bpAt; this.bpAt = null; } this.state = 'running'; const r = this.scan(); if (this.state === 'running') this.state = 'paused'; return r; } const r = this.scan(); if (this.state === 'running') this.state = 'paused'; return r; }
  /** Reset command: after an E-stop (once released) or a fault — runs ON RESET and restarts the main stacks */
  reset() {
    if (this.state === 'stopped') { this.resetMem(); return true; }
    if (this.state === 'estop' && this.estopActive()) return false;
    if (this.state === 'estop' || this.state === 'fault') { this.fault = null; this.runToEnd(this.fns.hy_reset?.[0]); this.gens = this.gens.map(() => null); this.state = 'running'; this.estopWas = this.estopActive(); return true; }
    this.runToEnd(this.fns.hy_reset?.[0]); return true;
  }
  estopActive() { const id = this.prog.estop; let a = this.estopCmd; if (id) { const v = !!this.rd(id); a = a || (this.prog.estopNc !== false ? !v : v); } return a; }

  // ---------- one scan ----------
  scan(): 'done' | 'break' {
    if (this.state === 'stopped') return 'done';
    if (this.pending < 0) { // a fresh scan: read inputs
      this.exec = new Set(); this.nAct.clear(); this.writes.clear(); this.loops.clear(); this.ip = '';
      this.adapter.read(this); this.inp = { ...this.sim, ...this.force };
      const es = this.estopActive();
      if (es && !this.estopWas && this.state !== 'estop') { this.state = 'estop'; this.runToEnd(this.fns.hy_estop?.[0]); this.addAlarm('F-001', 'F', 'Emergency stop'); }
      this.estopWas = es; if (!es) this.clearAlarm('F-001');
    }
    if (this.state === 'running') {
      try {
        if (this.startGen) { const r = this.step(this.startGen); if (r === 'break') return this.brk(-2); if (r === 'done') this.startGen = null; }
        if (!this.startGen) for (let i = this.pending >= 0 ? this.pending : 0; i < this.gens.length; i++) {
          if (!this.gens[i]) this.gens[i] = this.fns.hy_main[i]();
          const r = this.step(this.gens[i]!); if (r === 'break') return this.brk(i); if (r === 'done') this.gens[i] = null;
        }
      } catch (e: any) { this.toFault(e); }
    }
    this.pending = -1;
    // GRAFCET: transitions fire at the end of the scan, the new step is active from the next scan
    Object.values(this.seqs).forEach(q => { if (q.held === this.scanNo) { q.nxt = null; return; } if (q.nxt != null && q.nxt !== q.cur) { q.cur = q.nxt; q.t0 = this.t + this.dt; q.changed = this.scanNo; } q.nxt = null; });
    this.commitOutputs(); this.lastExec = this.exec;
    this.t = +(this.t + this.dt).toFixed(9); this.scanNo++; this.sample();
    return 'done';
  }
  private brk(i: number) { this.pending = i === -2 ? 0 : i; this.state = 'paused'; return 'break' as const; }
  private step(g: Generator): 'done' | 'wait' | 'break' { const r = g.next(); if (r.done) return 'done'; return r.value === BREAK ? 'break' : 'wait'; }
  private runToEnd(f?: () => Generator) { if (!f) return; const g = f(); const bp = this.bps; this.bps = new Set(); try { for (let k = 0; k < 10000; k++) if (g.next().done) break; } catch (e: any) { this.fault = { text: e.message, block: e.block, t: this.t }; } this.bps = bp; }
  private toFault(e: any) {
    const text = e instanceof PlcFault ? e.message : 'Runtime error: ' + (e?.message || e); this.fault = { text, block: e?.block, t: this.t }; this.state = 'fault'; this.ip = '';
    this.addAlarm('F-900', 'F', text); this.runToEnd(this.fns.hy_fault?.[0]);
  }
  private commitOutputs() {
    const all = new Set([...Object.keys(this.store), ...this.nAct, ...Object.keys(this.prevOut), ...Object.keys(this.force).filter(k => this.sigs.byId.get(k)?.dir === 'out')]);
    const o: Record<string, boolean> = {};
    all.forEach(id => { if (this.sigs.byId.get(id)?.dir !== 'out') return; let v = !!this.store[id] || this.nAct.has(id); if (id in this.force) v = !!this.force[id]; o[id] = v;
      if (!!this.prevOut[id] !== v) { this.events.push({ scan: this.scanNo, t: this.t, id, v }); if (this.events.length > 4000) this.events.splice(0, 1000); } });
    this.out = o; this.prevOut = { ...o }; this.adapter.write(this);
  }
  // ---------- trend / timing trace ----------
  setTrace(ids: string[]) { this.trace.ids = ids; ids.forEach(id => { if (!this.trace.cols[id]) this.trace.cols[id] = this.trace.t.map(() => NaN); }); }
  private sample() { const tr = this.trace; if (!tr.ids.length) return; tr.t.push(this.t); tr.ids.forEach(id => (tr.cols[id] ||= []).push(+this.valueOf(id) || 0)); if (tr.t.length > 12000) { tr.t.splice(0, 2000); Object.values(tr.cols).forEach(c => c.splice(0, 2000)); } }
  valueOf(id: string): any {
    if (id.startsWith('var:')) return this.v[id.slice(4)];
    if (id.startsWith('seq:')) return this.seqs[id.slice(4)]?.cur;
    if (id === 'mode') return this.mode;
    if (id.startsWith('pid:')) return this.pids[id.slice(4)]?.out ?? 0;
    const s = this.sigs.byId.get(id); if (!s) return undefined;
    if (s.dir === 'out') return !!this.out[id]; if (s.dir === 'aout') return this.aout[id] ?? 0;
    return this.rd(id);
  }
  traceCsv() { const tr = this.trace; const lbl = (id: string) => id.startsWith('var:') ? (this.prog.vars || []).find(x => x.id === id.slice(4))?.name || id : this.sigs.byId.get(id)?.tag || id;
    const rows = [['t (s)', ...tr.ids.map(lbl)], ...tr.t.map((t, i) => [t.toFixed(3), ...tr.ids.map(id => String(tr.cols[id]?.[i] ?? ''))])]; return rows.map(r => r.join(',')).join('\n'); }
  eventsCsv() { return [['scan', 't (s)', 'tag', 'address', 'value'], ...this.events.map(e => { const s = this.sigs.byId.get(e.id); return [e.scan, e.t.toFixed(3), s?.tag || e.id, s?.addr || '', e.v ? 'ON' : 'OFF']; })].map(r => r.join(',')).join('\n'); }

  // ---------- alarms ----------
  addAlarm(code: string, sev: string, text: string) { const a = this.alarms.find(x => x.code === code && x.active); if (a) return; this.alarms.unshift({ code, sev, text, t: this.t, active: true, acked: false }); if (this.alarms.length > 300) this.alarms.length = 300; }
  clearAlarm(code: string) { this.alarms.forEach(a => { if (a.code === code && a.active) { a.active = false; a.cleared = this.t; } }); }
  ack(code?: string) { this.alarms.forEach(a => { if (!code || a.code === code) a.acked = true; }); }

  // ---------- reading the process image ----------
  rd(id: string): any { if (id in this.force) return this.force[id]; if (id in this.inp) return this.inp[id]; const s = this.sigs.byId.get(id); return s?.dir === 'ain' ? 0 : false; }
  cyl(id: string, end: string) { const k = id + (end === 'p' ? '+' : '-'); if (k in this.force) return !!this.force[k]; if (this.adapter.cyl) return this.adapter.cyl(id, end); return !!this.sim[k]; }
  allOff() { Object.keys(this.store).forEach(k => this.store[k] = false); this.nAct.clear(); Object.keys(this.aout).forEach(k => this.aout[k] = 0); }

  // ---------- the API the compiled program calls ----------
  private api() {
    const rt = this; const lim = this.prog.loopLimit || 1000; const stallDef = this.prog.stall ?? 10;
    const n = (x: any) => typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 1 : 0) : (+x || 0);
    const K = (x: string) => rt.ip + x; // per function-block instance memory ('' outside function blocks)
    const W = (x: any) => Math.trunc(n(x)) & 0xFFFF;
    const ix = (A: number[], name: string, i: any, id: string) => { const k = Math.trunc(n(i)); if (k < 1 || k > A.length) throw new PlcFault(`Array ${name}: item ${k} is outside 1 … ${A.length}`, id); return k - 1; };
    return {
      get t() { return rt.t; }, get dt() { return rt.dt; }, get scanNo() { return rt.scanNo; }, v: rt.v,
      s(id: string) { rt.exec.add(id); if (rt.bps.size && rt.bps.has(id)) { if (rt.skip === id) { rt.skip = null; return false; } rt.bpAt = id; return true; } return false; },
      b: (x: any) => !!x, n,
      cmp(op: string, a: any, b: any) { if (typeof a === 'string' || typeof b === 'string') { a = String(a); b = String(b); } else { a = n(a); b = n(b); } switch (op) { case 'EQ': return a === b; case 'NEQ': return a !== b; case 'LT': return a < b; case 'LTE': return a <= b; case 'GT': return a > b; default: return a >= b; } },
      btw: (v: any, a: any, b: any) => n(v) >= n(a) && n(v) <= n(b),
      div(a: any, b: any, id: string) { if (n(b) === 0) throw new PlcFault('Division by zero', id); return n(a) / n(b); },
      mod(a: any, b: any, id: string) { if (n(b) === 0) throw new PlcFault('MOD by zero', id); return n(a) % n(b); },
      sqrt(a: number, id: string) { if (a < 0) throw new PlcFault('Square root of a negative number', id); return Math.sqrt(a); },
      scale(v: any, i0: any, i1: any, o0: any, o1: any) { const d = n(i1) - n(i0); return d ? n(o0) + (n(v) - n(i0)) * (n(o1) - n(o0)) / d : n(o0); },
      limit: (v: any, lo: any, hi: any) => Math.min(n(hi), Math.max(n(lo), n(v))),
      conv(v: any, to: string) { return to === 'INT' ? Math.trunc(n(v)) : to === 'FLOAT' ? n(v) : to === 'BOOL' ? (typeof v === 'string' ? v === 'TRUE' || v === 'true' || v === '1' : !!n(v)) : String(typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v); },
      lg(id: string) { const c = (rt.loops.get(id) || 0) + 1; rt.loops.set(id, c); if (c > lim) throw new PlcFault(`Loop limit hit (${lim} iterations in one scan)`, id); },
      wt(id: string, stall: number) { let w = rt.waits.get(id); if (!w) rt.waits.set(id, w = { since: rt.t, stall: stall > 0 ? stall : stall === 0 ? stallDef : Infinity, stalled: false });
        if (!w.stalled && rt.t - w.since >= w.stall) { w.stalled = true; rt.addAlarm('W-STALL:' + id, 'W', `Stalled ${Math.round(rt.t - w.since)} s waiting for ${rt.c.conds[id] || 'a condition'}`); } },
      wd(id: string) { const w = rt.waits.get(id); if (w?.stalled) rt.clearAlarm('W-STALL:' + id); rt.waits.delete(id); },
      stopProg(id: string) { rt.state = 'stopped'; rt.message = 'Program stopped by STOP PROGRAM'; rt.exec.add(id); },
      i: (id: string) => !!rt.rd(id), o: (id: string) => !!(rt.store[id] || rt.nAct.has(id)), a: (id: string) => n(rt.rd(id)), cyl: (id: string, end: string) => rt.cyl(id, end),
      set(id: string, v: boolean, bid: string) { const c = (rt.writes.get(id) || 0) + 1; rt.writes.set(id, c); if (c > 1 && rt.store[id] !== v && !rt.multiWrite.has(id)) { rt.multiWrite.add(id); rt.addAlarm('W-2W:' + id, 'W', `${rt.sigs.byId.get(id)?.tag || id} is written twice in one scan — the last write wins`); } rt.store[id] = v; },
      act(id: string) { rt.nAct.add(id); },
      allOff() { rt.allOff(); },
      aset(id: string, v: any) { rt.aout[id] = n(v); },
      vset(id: string, v: any) { const d = (rt.prog.vars || []).find(x => x.id === id); rt.v[id] = d ? coerce(d, v) : v; },
      latch(id: string, s: any, r: any, mode: string) { const cur = !!rt.v[id]; rt.v[id] = mode === 'RESET' ? !r && (!!s || cur) : !!s || (cur && !r); },
      timer(name: string, kind: string, IN: any, PT: any) { name = K(name); IN = !!IN; PT = Math.max(0, n(PT)); let T = rt.timers[name]; if (!T) T = rt.timers[name] = { kind, IN: false, Q: false, ET: 0, PT, t0: 0, sc: -9 } as any; T.kind = kind; T.PT = PT; if ((T as any).sc < rt.scanNo - 1) { T.IN = false; if (kind !== 'TOF') { T.Q = false; T.ET = 0; } } (T as any).sc = rt.scanNo;
        if (kind === 'TON') { if (IN && !T.IN) T.t0 = rt.t; T.ET = IN ? Math.min(rt.t - T.t0, PT) : 0; T.Q = IN && rt.t - T.t0 >= PT - 1e-9; }
        else if (kind === 'TOF') { if (IN) { T.Q = true; T.ET = 0; } else { if (T.IN) T.t0 = rt.t; T.ET = Math.min(rt.t - T.t0, PT); T.Q = T.Q && rt.t - T.t0 < PT - 1e-9; } }
        else { if (IN && !T.IN && !T.Q) { T.t0 = rt.t; T.Q = true; } if (T.Q) { T.ET = Math.min(rt.t - T.t0, PT); if (rt.t - T.t0 >= PT - 1e-9) T.Q = false; } else if (!IN) T.ET = 0; }
        T.IN = IN; },
      T: (name: string) => rt.timers[K(name)] || { Q: false, ET: 0 },
      ton(id: string, IN: any, PT: any) { id = K(id); let m = rt.mem.get(id); if (!m) rt.mem.set(id, m = { IN: false, t0: 0, sc: -9 }); IN = !!IN; if (m.sc < rt.scanNo - 1) m.IN = false; m.sc = rt.scanNo; if (IN && !m.IN) m.t0 = rt.t; m.IN = IN; return IN && rt.t - m.t0 >= n(PT) - 1e-9; },
      edge(id: string, k: string, v: any) { id = K(id); v = !!v; const p = !!rt.mem.get(id); rt.mem.set(id, v); return k === 'FALLING' ? p && !v : !p && v; },
      counter(name: string, kind: string, up: any, dn: any, rs: boolean, ld: boolean, PV: any) { name = K(name); let C = rt.counters[name]; if (!C) C = rt.counters[name] = { kind, CV: kind === 'CTD' ? Math.trunc(n(PV)) : 0, PV: 0, Q: false, QD: false, up: false, dn: false };
        C.kind = kind; C.PV = Math.trunc(n(PV)); up = !!up; dn = !!dn;
        if (rs) C.CV = 0; else if (ld) C.CV = C.PV; else { if (up && !C.up) C.CV++; if (dn && !C.dn) C.CV--; }
        C.up = up; C.dn = dn; C.QD = C.CV <= 0; C.Q = kind === 'CTD' ? C.QD : C.CV >= C.PV; },
      C: (name: string) => rt.counters[K(name)] || { Q: false, CV: 0 },
      cReset(name: string) { const C = rt.counters[K(name)]; if (C) { C.CV = 0; C.Q = C.kind === 'CTD'; } },
      seq(name: string, init: string) { name = K(name); let q = rt.seqs[name]; if (!q) q = rt.seqs[name] = { cur: init, nxt: null, t0: rt.t, init, changed: rt.scanNo }; return { cur: q.cur, go: (s: string) => { q!.nxt = s; } }; },
      isStep: (name: string, st: string) => rt.seqs[K(name)]?.cur === st,
      stepT: (name: string) => { const q = rt.seqs[K(name)]; return q ? Math.max(0, rt.t - q.t0) : 0; },
      goto(name: string, st: string) { name = K(name); const q = rt.seqs[name]; if (q) q.nxt = st; else rt.seqs[name] = { cur: st, nxt: null, t0: rt.t, init: st, changed: rt.scanNo }; },
      seqReset(name: string) { const q = rt.seqs[K(name)]; if (q) q.nxt = q.init; },
      msg(s: string) { rt.message = s; },
      alarm(code: string, sev: string, text: string, on: boolean) { if (on) rt.addAlarm(code, sev, text); else rt.clearAlarm(code); },
      // ---------- 8d ----------
      win: (v: any, c: any, tol: any) => Math.abs(n(v) - n(c)) <= Math.abs(n(tol)),
      hyst(id: string, v: any, on: any, off: any) { id = K(id); v = n(v); on = n(on); off = n(off); let q = !!rt.mem.get(id); if (on >= off) { if (v >= on) q = true; else if (v <= off) q = false; } else { if (v <= on) q = true; else if (v >= off) q = false; } rt.mem.set(id, q); return q; },
      dband: (v: any, d: any) => Math.abs(n(v)) <= Math.abs(n(d)) ? 0 : n(v),
      mux(k: any, l: any[], id: string) { const i = Math.trunc(n(k)); if (i < 0 || i > 3) throw new PlcFault(`MUX index ${i} is outside 0 … 3`, id); return l[i]; },
      bop(op: string, a: any, b: any) { const x = W(a), y = W(b); return (op === 'AND' ? x & y : op === 'OR' ? x | y : x ^ y) & 0xFFFF; },
      wnot: (a: any) => ~W(a) & 0xFFFF,
      shf(op: string, a: any, k: any) { const x = W(a); let s = Math.max(0, Math.trunc(n(k))); if (op === 'SHL') return s > 15 ? 0 : (x << s) & 0xFFFF; if (op === 'SHR') return s > 15 ? 0 : x >>> s; s %= 16; return (op === 'ROL' ? (x << s) | (x >>> (16 - s)) : (x >>> s) | (x << (16 - s))) & 0xFFFF; },
      bget: (a: any, k: any) => { const s = Math.trunc(n(k)); return s >= 0 && s < 32 && ((Math.trunc(n(a)) >>> s) & 1) === 1; },
      bset(a: any, k: any, v: boolean) { const s = Math.trunc(n(k)); const x = Math.trunc(n(a)); if (s < 0 || s > 31) return x; return (v ? x | (1 << s) : x & ~(1 << s)) >>> 0; },
      sreg(name: string, len: number, d: boolean, clk: boolean, rs: boolean) { name = K(name); let R = rt.sregs[name]; if (!R) R = rt.sregs[name] = { bits: Array(len).fill(false), clk: false }; if (R.bits.length !== len) R.bits = Array.from({ length: len }, (_, i) => !!R!.bits[i]);
        if (rs) R.bits.fill(false); else if (clk && !R.clk) { R.bits.pop(); R.bits.unshift(d); } R.clk = clk; },
      sbit: (name: string, i: any) => !!rt.sregs[K(name)]?.bits[Math.trunc(n(i))],
      decl(spec: Record<string, { size: number; init: number }>) { Object.entries(spec).forEach(([k, s]) => { rt.arrs[k] = Array(s.size).fill(s.init); }); },
      arrGet(name: string, i: any, id: string) { const A = rt.arrs[name]; if (!A) return 0; return A[ix(A, name, i, id)]; },
      arrSet(name: string, i: any, v: any, id: string) { const A = rt.arrs[name]; if (A) A[ix(A, name, i, id)] = n(v); },
      arrFill(name: string, v: any) { rt.arrs[name]?.fill(n(v)); },
      arrStat(name: string, op: string) { const A = rt.arrs[name] || []; if (!A.length) return 0; switch (op) { case 'SUM': return A.reduce((s, x) => s + x, 0); case 'AVG': return A.reduce((s, x) => s + x, 0) / A.length; case 'MIN': return Math.min(...A); case 'MAX': return Math.max(...A); default: { let k = 0; A.forEach((x, j) => { if (x > A[k]) k = j; }); return k + 1; } } },
      tbl(x: any, xs: number[], ys: number[]) { x = n(x); if (xs.length < 2) return ys[0] ?? 0; if (x <= xs[0]) return ys[0]; const L = xs.length - 1; if (x >= xs[L]) return ys[L]; let j = 1; while (x > xs[j]) j++; return ys[j - 1] + (x - xs[j - 1]) * (ys[j] - ys[j - 1]) / (xs[j] - xs[j - 1]); },
      recSet(r: string, f: string, v: any) { (rt.recs[r] ||= {})[f] = v; },
      recGet: (r: string, f: string) => rt.recs[r]?.[f] ?? 0,
      pid(name: string, pv: any, sp: any, kp: any, ti: any, td: any, lo: any, hi: any, en: boolean, dir: string) { name = K(name); pv = n(pv); sp = n(sp); kp = n(kp); ti = n(ti); td = n(td); lo = n(lo); hi = n(hi); if (lo > hi) [lo, hi] = [hi, lo];
        const P = rt.pids[name] ||= { i: 0, pv1: NaN, out: lo, e: 0, sp, pv }; P.sp = sp; P.pv = pv;
        if (!en) { P.i = 0; P.pv1 = pv; P.out = lo; P.e = 0; return; }
        const sg = dir === 'R' ? -1 : 1, e = sg * (sp - pv), dt = rt.dt; const dpv = isNaN(P.pv1) ? 0 : sg * (pv - P.pv1) / dt; P.pv1 = pv;
        let iN = ti > 0 ? P.i + kp * e * dt / ti : 0; let u = kp * e + iN - kp * td * dpv;
        if (u > hi) { u = hi; if (e > 0) iN = Math.min(P.i, iN); } else if (u < lo) { u = lo; if (e < 0) iN = Math.max(P.i, iN); } // anti-windup: no integration into a limit
        P.i = iN; P.out = u; P.e = e; },
      pidOut: (name: string) => rt.pids[K(name)]?.out ?? 0,
      ramp(id: string, v: any, r: any) { id = K(id); v = n(v); r = Math.abs(n(r)); let y = rt.mem.get(id); if (y === undefined || !(r > 0)) y = v; else { const s = r * rt.dt; y += Math.max(-s, Math.min(s, v - y)); } rt.mem.set(id, y); return y; },
      mavg(id: string, v: any, N: number) { id = K(id); let m = rt.mem.get(id); if (!m) rt.mem.set(id, m = { b: [] as number[], s: 0 }); m.b.push(n(v)); m.s += n(v); while (m.b.length > N) m.s -= m.b.shift(); return m.s / m.b.length; },
      pt1(id: string, v: any, T: any) { id = K(id); v = n(v); T = Math.max(0, n(T)); let y = rt.mem.get(id); y = y === undefined || !T ? v : y + (v - y) * rt.dt / (T + rt.dt); rt.mem.set(id, y); return y; },
      blink(on: any, off: any) { on = Math.max(0, n(on)); off = Math.max(0, n(off)); const p = on + off; return p > 0 && ((rt.t + 1e-9) % p) < on; },
      rtc(w: string) { const d = new Date(rt.wall0 + rt.t * 1000); switch (w) { case 'H': return d.getHours(); case 'M': return d.getMinutes(); case 'S': return d.getSeconds(); case 'WD': return (d.getDay() + 6) % 7 + 1; case 'D': return d.getDate(); case 'MO': return d.getMonth() + 1; default: return d.getFullYear(); } },
      rtcBtw(a: number, b: number) { const d = new Date(rt.wall0 + rt.t * 1000); const m = d.getHours() * 60 + d.getMinutes(); return a <= b ? m >= a && m < b : m >= a || m < b; },
      *fb(inst: string, f: (O: any, I: any) => Generator, I: any): Generator<any, any, any> { const p = rt.ip, key = p + inst; const O = rt.fbo[key] ||= {}; rt.ip = key + '/'; try { return yield* f(O, I); } finally { rt.ip = p; } },
      fbget: (inst: string, out: string) => rt.fbo[rt.ip + inst]?.[out] ?? 0,
      par(name: string, seqs: string[]) { const k = 'par:' + K(name); const last = rt.mem.get(k); if (last === undefined || last < rt.scanNo - 1) seqs.forEach(s => { delete rt.seqs[K(s)]; }); rt.mem.set(k, rt.scanNo); },
      parDone: (seqs: string[]) => seqs.length > 0 && seqs.every(s => rt.seqs[K(s)]?.cur === '__END'),
      seqDone: (name: string) => rt.seqs[K(name)]?.cur === '__END',
      hold(name: string, c: boolean) { const q = rt.seqs[K(name)]; if (q && c) q.held = rt.scanNo; },
      modeSel(a: boolean, m: boolean, s: boolean, h: boolean) { const was = rt.mode; if (a) rt.mode = 'AUTO'; if (m) rt.mode = 'MANUAL'; if (s) rt.mode = 'SETUP'; if (h) rt.mode = 'HOMING'; if (was !== rt.mode) rt.message = 'Mode ' + rt.mode; },
      setMode(m: string) { if (rt.mode !== m) { rt.mode = m; rt.message = 'Mode ' + m; } },
      modeIs: (m: string) => rt.mode === m,
      agrp: (p: string, w: string) => rt.alarms.some(a => a.code.startsWith(p) && (w === 'UNACK' ? !a.acked : a.active && (w !== 'FAULT' || a.sev === 'F'))),
      acount: (p: string) => rt.alarms.filter(a => a.active && a.code.startsWith(p)).length,
      aack(p: string) { rt.alarms.forEach(a => { if (a.code.startsWith(p)) a.acked = true; }); },
      twohand(id: string, a: boolean, b: boolean, win: number) { id = K(id); let m = rt.mem.get(id); if (!m) rt.mem.set(id, m = { a: false, b: false, ta: -1, tb: -1, armed: false, q: false }); // armed only after both have been seen released
        if (a && !m.a) m.ta = rt.t; if (b && !m.b) m.tb = rt.t;
        if (!a && !b) { m.armed = true; m.q = false; } else if (!a || !b) m.q = false; else if (m.armed) { m.q = Math.abs(m.ta - m.tb) <= win + 1e-9; m.armed = false; }
        m.a = a; m.b = b; return m.q; },
      dualch(id: string, a: boolean, b: boolean, d: number, code: string, text: string) { id = K(id); let m = rt.mem.get(id); if (!m) rt.mem.set(id, m = { t0: -1, lock: false });
        if (a !== b) { if (m.t0 < 0) m.t0 = rt.t; if (!m.lock && rt.t - m.t0 >= d - 1e-9) { m.lock = true; rt.addAlarm(code, 'F', text); } } else m.t0 = -1;
        if (!a && !b && m.lock) { m.lock = false; rt.clearAlarm(code); } return a && b && !m.lock; },
      wdog(id: string, v: any, T: any) { id = K(id); let m = rt.mem.get(id); if (!m) rt.mem.set(id, m = { v, t: rt.t }); if (v !== m.v) { m.v = v; m.t = rt.t; } return rt.t - m.t >= n(T) - 1e-9; }
    };
  }
}
export function initOf(x: Var): any { const s = String(x.init ?? '').trim(); switch (x.type) { case 'BOOL': return /^(true|1|on)$/i.test(s); case 'STRING': return s; case 'INT': return Math.trunc(+s || 0); default: return +s || 0; } }
export function coerce(d: Var, v: any) { switch (d.type) { case 'BOOL': return !!v; case 'STRING': return String(v); case 'INT': return Math.trunc(typeof v === 'boolean' ? +v : +v || 0); default: return typeof v === 'boolean' ? +v : +v || 0; } }

// standalone (no hydraulic link): inputs are what the user sets in the I/O table
export const standalone: Adapter = { name: 'standalone', read() { }, write() { } };
