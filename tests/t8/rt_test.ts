import { compile } from '../home/src/plc/compile';
import { Plc, standalone } from '../home/src/plc/runtime';
const sigs = [
  { id: 'plc:in1', tag: '1S1', addr: 'I0.0', dir: 'in', desc: 'start', src: 'plc' },
  { id: 'plc:es', tag: '1S0', addr: 'I0.7', dir: 'in', desc: 'estop', src: 'plc' },
  { id: 'plc:q0', tag: '1Y1', addr: 'Q0.0', dir: 'out', desc: '', src: 'plc' },
  { id: 'plc:q1', tag: '1Y2', addr: 'Q0.1', dir: 'out', desc: '', src: 'plc' },
  { id: 'pos:c1', tag: '1A1 pos', addr: '', dir: 'ain', desc: '', src: 'pos' }] as any[];
const T: any = { sigs, byId: new Map(sigs.map(s => [s.id, s])), cyls: [{ id: 'cyl:c1', tag: '1A1', desc: '', stroke: .2 }], cylById: new Map([['cyl:c1', { id: 'cyl:c1', tag: '1A1' }]]) };
const B = (type: string, fields: any = {}, inputs: any = {}, next?: any, id?: string) => ({ type, id: id || type + Math.random().toString(36).slice(2, 7), fields, inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, { block: v }])), ...(next ? { next: { block: next } } : {}) });
const chain = (...bs: any[]) => { for (let i = 0; i < bs.length - 1; i++) bs[i].next = { block: bs[i + 1] }; return bs[0]; };
const cyl = (e: string) => B('hy_cyl', { CYL: 'cyl:c1', END: e });
const num = (x: number) => B('math_number', { NUM: x });
// sequence S0 wait start → S1 A+ (activate 1Y1) until at+ and 0.5s → S2 A- until at- → S0 ; counter of cycles
const s0 = B('hy_step', { ID: 'S0', LABEL: 'Wait', GOTO: 'next' }, { T: B('hy_in', { SIG: 'plc:in1' }) });
const s1 = B('hy_step', { ID: 'S1', LABEL: 'A+', GOTO: 'next' }, { DO: B('hy_act', { SIG: 'plc:q0' }), T: B('logic_operation', { OP: 'AND' }, { A: cyl('p'), B: B('hy_for', {}, { IN: cyl('p'), PT: num(0.5) }) }) }, undefined, 'S1blk');
const s2 = B('hy_step', { ID: 'S2', LABEL: 'A-', GOTO: 'S0' }, { DO: B('hy_act', { SIG: 'plc:q1' }), T: cyl('m') });
chain(s0, s1, s2);
const seq = B('hy_seq', { NAME: 'AUTO' }, { STEPS: s0 });
const cnt = B('hy_counter', { KIND: 'CTU', NAME: 'C1' }, { UP: B('hy_step_active', { STEP: 'AUTO/S2' }), PV: num(3) });
const main = B('hy_main', {}, {}, chain(seq, cnt));
const vdone = B('hy_var_set', { VAR: 'v1' }, { V: B('hy_counter_q', { NAME: 'C1' }) }); cnt.next = { block: vdone };
const es = B('hy_estop', {}, {}, B('hy_outs_off'));
const ws = { blocks: { languageVersion: 0, blocks: [{ ...main, x: 0, y: 0 }, { ...es, x: 400, y: 0 }] } };
const prog: any = { id: 'p', name: 'P', ws, vars: [{ id: 'v1', name: 'Done', type: 'BOOL', init: 'false' }], scanMs: 10, estop: 'plc:es', estopNc: true };
const c = compile(prog, T); console.log(c.issues); if (!c.ok) { console.log(c.js); process.exit(1); }
// fake machine: cylinder moves 0.2 m in 1 s when 1Y1/1Y2 on
let x = 0; const ad: any = { name: 'fake', read(rt: any) { rt.sim['plc:es'] = true; }, write(rt: any) { const v = rt.out['plc:q0'] ? 0.2 : rt.out['plc:q1'] ? -0.2 : 0; x = Math.min(0.2, Math.max(0, x + v * rt.dt)); }, cyl: (id: string, e: string) => e === 'p' ? x >= 0.2 - 1e-9 : x <= 1e-9 };
const rt = new Plc(prog, c, T, ad); rt.start(); rt.sim['plc:in1'] = true;
for (let i = 0; i < 1000; i++) rt.scan();
console.log(rt.events.map((e:any)=>e.t.toFixed(2)+e.id.slice(-1)+(e.v?1:0)).join(" "));console.log("t", rt.t, 'seq', rt.seqs.AUTO, 'C1', rt.counters.C1, 'Done', rt.v.v1, 'events', rt.events.length);
// breakpoint at S1 step
rt.bps.add('S1blk'); let br = 0; for (let i = 0; i < 400; i++) { if (rt.scan() === 'break') { br++; break; } } console.log('break', br, rt.state, rt.bpAt, rt.seqs.AUTO.cur); rt.resume(); rt.scan(); console.log('after resume', rt.state); rt.bps.clear();
// estop
ad.read = (r: any) => { r.sim['plc:es'] = false; }; rt.scan(); console.log('estop', rt.state, rt.out, rt.alarms[0]);
console.log('reset while active', rt.reset()); ad.read = (r: any) => { r.sim['plc:es'] = true; }; rt.scan(); console.log('reset', rt.reset(), rt.state);
// fault: division by zero
const ws2 = { blocks: { blocks: [B('hy_main', {}, {}, B('hy_var_set', { VAR: 'v2' }, { V: B('math_arithmetic', { OP: 'DIVIDE' }, { A: num(1), B: num(0) }) }))] } };
const p2: any = { id: 'q', name: 'Q', ws: ws2, vars: [{ id: 'v2', name: 'X', type: 'FLOAT', init: '0' }] }; const c2 = compile(p2, T); const r2 = new Plc(p2, c2, T, ad); r2.start(); r2.scan(); console.log('fault', r2.state, r2.fault);
// timers
const ws3 = { blocks: { blocks: [B('hy_main', {}, {}, chain(B('hy_timer', { KIND: 'TON', NAME: 'T1' }, { IN: B('hy_in', { SIG: 'plc:in1' }), PT: num(1) }), B('hy_timer', { KIND: 'TOF', NAME: 'T2' }, { IN: B('hy_in', { SIG: 'plc:in1' }), PT: num(0.5) }), B('hy_timer', { KIND: 'TP', NAME: 'T3' }, { IN: B('hy_in', { SIG: 'plc:in1' }), PT: num(0.3) })))] } };
const p3: any = { id: 'r', name: 'R', ws: ws3, vars: [] }; const c3 = compile(p3, T); const r3 = new Plc(p3, c3, T, standalone); r3.start(); r3.sim['plc:in1'] = true;
const snap = () => ['T1', 'T2', 'T3'].map(n => `${n}:${+r3.timers[n].Q}/${r3.timers[n].ET.toFixed(2)}`).join(' ');
for (let i = 0; i < 50; i++) r3.scan(); console.log('0.5s', snap()); for (let i = 0; i < 60; i++) r3.scan(); console.log('1.1s', snap());
r3.sim['plc:in1'] = false; for (let i = 0; i < 30; i++) r3.scan(); console.log('off+0.3', snap()); for (let i = 0; i < 30; i++) r3.scan(); console.log('off+0.6', snap());
// wait + delay + stall
const ws4 = { blocks: { blocks: [B('hy_main', {}, {}, chain(B('hy_wait', { STALL: 2 }, { COND: B('hy_in', { SIG: 'plc:in1' }) }, undefined, 'W1'), B('hy_delay', {}, { S: num(0.2) }), B('hy_var_change', { VAR: 'n' }, { D: num(1) })))] } };
const p4: any = { id: 's', name: 'S', ws: ws4, vars: [{ id: 'n', name: 'N', type: 'INT', init: '0' }] }; const c4 = compile(p4, T); console.log(c4.issues.map(i => i.text)); const r4 = new Plc(p4, c4, T, standalone); r4.start();
for (let i = 0; i < 300; i++) r4.scan(); console.log('stall', r4.alarms.map(a => a.text), r4.v.n); r4.sim['plc:in1'] = true; for (let i = 0; i < 100; i++) r4.scan(); console.log('n after 1s', r4.v.n, r4.alarms.map(a => a.active));
