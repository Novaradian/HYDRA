// Logic Coder: controller state — one PLC runs at a time, independent of which tab is visible.
// Standalone (no fluid sheet, or “standalone” chosen) it runs on its own clock; as a machine (8b) it runs in lock-step
// with the hydraulic simulation: one scan each time the solver passes the next scan time.
import { signal } from '@preact/signals';
import { produce } from 'immer';
import * as S from '../store';
import * as Sim from '../designer/sim';
import { compile, type Program, type Compiled } from './compile';
import { signals } from './signals';
import { Plc, standalone } from './runtime';
import { machineSheet, simAdapter, inputDefaults, type SimLink } from './link';

export const RT = signal<{ rt: Plc; progId: string; docKey: string; link: { sheet: string; startedSim: boolean } | null } | null>(null);
export const tick = signal(0);          // UI refresh while running (about 10 per second)
export const speed = signal(1);
export const bpStore = new Map<string, Set<string>>(); // breakpoints per program (kept for the session)
export const bps = (progId: string) => bpStore.get(progId) || bpStore.set(progId, new Set()).get(progId)!;
export const simStore = new Map<string, Record<string, any>>(); // inputs set by hand, per program (kept between runs)
export const simOf = (id: string) => simStore.get(id) || simStore.set(id, {}).get(id)!;
// the open Logic Coder registers undo / redo here (Edit menu, Ctrl+Z) and the editor's own clipboard keys
export const lcApi = signal<{ undo(): void; redo(): void; progId: string } | null>(null);
// the operator-panel editor (Delete key removes the selected widget, not a project item)
export const peApi = signal<{ del(): void; dup(): void } | null>(null);

export const progOf = (p: any, id: string): Program | null => p?.programs?.[id] || null;
export const programNodes = (p: any) => Object.values(p?.nodes || {}).filter((n: any) => n.type === 'program') as S.NodeT[];
export const activeProgId = (p: any) => { const list = programNodes(p); return (list.find(n => p.programs[n.id]?.active) || list.find(n => p.programs[n.id]?.ws) || list[0])?.id || null; };
export const isActiveProg = (p: any, id: string) => { const list = programNodes(p); const act = list.find(n => p.programs[n.id]?.active); return act ? act.id === id : list[0]?.id === id; };
export const isLinked = () => !!RT.value?.link && RT.value.rt.state !== 'stopped';

// program writes skip the project undo stack: the block editor keeps its own undo (100 steps)
export function writeProg(id: string, recipe: (pr: Program, d: S.Project) => void) {
  const p = S.project.value; if (!p || !p.programs[id]) return;
  if (S.readOnly.value) { S.toast('Read-only project — turn off Read-only on the Home tab to edit', 'warn'); return; }
  S.project.value = produce(p, (d: any) => { recipe(d.programs[id], d); }) as any; S.dirty.value = true;
}

let raf = 0, last = 0, acc = 0, lastUi = 0;
export function compileProg(p: any, id: string): Compiled | null { const pr = progOf(p, id); return pr ? compile(pr, signals(p)) : null; }
/** Run (or resume) a program. mode: 'auto' = with the machine sheet when there is one */
export function run(progId: string, mode: 'auto' | 'standalone' = 'auto', sheetOverride?: string): Compiled | null {
  const p = S.project.value; const pr = progOf(p, progId); if (!p || !pr) return null;
  const cur = RT.value;
  if (cur && cur.progId === progId && cur.rt.state === 'paused') { resume(); return cur.rt.c; }
  const T = signals(p); const c = compile(pr, T); if (!c.ok) return c;
  if (cur) stop();
  // the machine: start (or join) the hydraulic simulation of the machine sheet
  const sheet = mode === 'standalone' ? null : sheetOverride || machineSheet(p, pr); let link: { sheet: string; startedSim: boolean } | null = null;
  if (sheet) {
    const v = Sim.simView.value; let started = false;
    if (!v || v.sheet !== sheet || !Sim.SIM) { if (v) Sim.simStop(); started = Sim.simStart(sheet); }
    if (Sim.SIM && Sim.simView.value?.sheet === sheet) { link = { sheet, startedSim: started }; if (!Sim.simView.value.running) Sim.simPause(false); Sim.simSpeed(speed.value); }
    else S.toast('The hydraulic simulation could not start — the program runs on its own', 'warn');
  }
  const adapter = link ? simAdapter(p, pr, c, Sim.SIM!, T) : standalone;
  const rt = new Plc(pr, c, T, adapter); rt.bps = bps(progId); rt.speed = speed.value;
  rt.sim = { ...inputDefaults(p, T), ...simOf(progId) };
  rt.start(); RT.value = { rt, progId, docKey: S.activeDoc.value, link };
  if (link) attach(rt, adapter as SimLink); else loop();
  tick.value++; return c;
}
// lock-step: the solver calls this after every time step
let hookFn: ((s: any) => void) | null = null;
function attach(rt: Plc, ad: SimLink) {
  const sim = ad.sim; detachHook();
  hookFn = (s: any) => {
    if (rt.state !== 'running' && rt.state !== 'estop' && rt.state !== 'fault') return;
    let k = 0;
    while (ad.tBase + rt.t <= s.t + 1e-9 && k < 20) {
      const res = rt.scan(); k++;
      if (res === 'break') { s.halt = true; setTimeout(() => { Sim.simPause(true); S.toast('Breakpoint — machine paused before the marked block', 'info'); tick.value++; }); return; }
      if ((rt.state as string) === 'stopped') { setTimeout(() => stop()); return; }
    }
    const now = performance.now(); if (now - lastUi > 90) { lastUi = now; tick.value++; }
  };
  sim.hooks.push(hookFn); sim.halt = false;
}
function detachHook() { const s: any = Sim.SIM; if (s && hookFn) s.hooks = s.hooks.filter((h: any) => h !== hookFn); hookFn = null; }
export function pause() { const r = RT.value; if (!r) return; r.rt.pause(); if (r.link && Sim.simView.value?.running) Sim.simPause(true); tick.value++; }
export function resume() { const r = RT.value; if (!r) return; r.rt.resume(); if (r.link) { if (Sim.SIM) Sim.SIM.halt = false; Sim.simPause(false); } else loop(); tick.value++; }
export function stop() {
  const r = RT.value; if (!r) return; r.rt.stop(); cancelAnimationFrame(raf); raf = 0;
  if (r.link) { (r.rt.adapter as SimLink).detach?.(); detachHook(); if (Sim.SIM) Sim.SIM.halt = false; if (r.link.startedSim && Sim.simView.value?.sheet === r.link.sheet) { stopping = true; Sim.simStop(); stopping = false; } }
  tick.value++;
}
let stopping = false;
// the hydraulic simulation was stopped (sheet Stop, leaving the sheet …): the machine's PLC stops with it
Sim.stopHooks.push(() => { if (stopping) return; const r = RT.value; if (r?.link && r.rt.state !== 'stopped') { r.rt.stop(); (r.rt.adapter as SimLink).detach?.(); detachHook(); tick.value++; } });
export function scanOnce(progId: string) {
  let cur = RT.value; let r = cur?.rt;
  if (!r || cur!.progId !== progId || r.state === 'stopped') { const c = run(progId); if (!c?.ok) return c; cur = RT.value!; r = cur.rt; pause(); }
  if (cur!.link && Sim.SIM) { // one scan of machine time: run the solver for one scan period, the hook executes the scan
    const s: any = Sim.SIM; if (r.state === 'paused') { if (r.bpAt) { r.resume(); } else r.state = 'running'; }
    s.halt = false; const n0 = r.scanNo; s.run(r.dt * 0.999 + 1e-9, 2000); if (r.scanNo === n0) r.scan();
    if (r.state === 'running') r.state = 'paused'; if (Sim.simView.value?.running) Sim.simPause(true); s.measure(); Sim.simView.value = { ...Sim.simView.value!, t: s.t }; Sim.simFrame.value++;
  } else { const res = r.stepScan(); if (res === 'break') S.toast('Breakpoint', 'info'); }
  tick.value++; return r.c;
}
export function reset() { const r = RT.value?.rt; if (!r) return; if (!r.reset()) S.toast('Release the E-stop first, then Reset', 'warn'); else if (r.state === 'running' && !RT.value?.link) loop(); tick.value++; }
export function estop(on?: boolean) { const r = RT.value?.rt; if (!r) return; r.estopCmd = on ?? !r.estopCmd; tick.value++; if (!RT.value?.link && (r.state === 'running' || r.state === 'estop')) loop(); }
export function setSpeed(x: number) { speed.value = x; const r = RT.value?.rt; if (r) r.speed = x; if (RT.value?.link) Sim.simSpeed(x); }
export function unload() { stop(); RT.value = null; }
// a manual input (pushbutton, selector, E-stop) — from the I/O table, the sheet strip or the operator panel
export function setInput(progId: string, id: string, v: any) { simOf(progId)[id] = v; const r = RT.value; if (r && r.progId === progId) r.rt.sim[id] = v; tick.value++; }

function loop() {
  if (raf) return; last = performance.now(); acc = 0;
  const f = (now: number) => {
    raf = 0; const cur = RT.value; if (!cur || cur.link) return; const r = cur.rt;
    if (r.state === 'stopped' || r.state === 'paused') { tick.value++; return; }
    const dtReal = Math.min(0.25, (now - last) / 1000); last = now; acc += dtReal * r.speed;
    let n = 0; while (acc >= r.dt - 1e-12 && n < 5000) { const res = r.scan(); acc -= r.dt; n++; if (res === 'break') { S.toast('Breakpoint — the program is paused before the marked block', 'info'); tick.value++; return; } if ((r.state as string) === 'stopped') break; }
    if (now - lastUi > 90) { lastUi = now; tick.value++; }
    raf = requestAnimationFrame(f);
  };
  raf = requestAnimationFrame(f);
}
