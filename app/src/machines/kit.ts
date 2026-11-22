// Machine kit: the parts every sample machine shares — electric sheets generated from an I/O list (PLC input / output
// cards, safety circuit, motor starters) and the standard program frame (modes, homing, cycle latch, alarms, E-stop).
import { drawElec, ioSheets, type EDef, type EP, type IO, type SheetSpec, type ProgSpec } from './build';
import { signals } from '../plc/signals';
import * as P from './prog';
import type { Var } from '../plc/compile';

// ---------- I/O list → electric sheets ----------
export type In = { tag: string; dev: 'pb' | 'pbnc' | 'estop' | 'key' | 'sel' | 'limit' | 'prox' | 'psw' | 'tsw' | 'float'; func: string; watch?: string; end?: '+' | '-'; colour?: string };
export type Out = { tag: string; dev: 'sol' | 'lamp' | 'coil' | 'buzzer'; func: string; colour?: string };
export type Motor = { tag: string; kw: number; contactor: string };
const DEV: Record<string, string> = { pb: 'std:e_pb_no', pbnc: 'std:e_pb_nc', estop: 'std:e_estop', key: 'std:e_key', sel: 'std:e_selector', limit: 'std:e_limit', prox: 'std:e_prox', psw: 'std:e_pswitch', tsw: 'std:e_tswitch', float: 'std:e_float', sol: 'std:e_sol', lamp: 'std:e_lamp', coil: 'std:e_coil', buzzer: 'std:e_buzzer' };
const addr = (k: 'I' | 'Q', i: number) => `${k}${Math.floor(i / 8)}.${i % 8}`;
const sym = (s: string) => s.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '');
export function electrics(prefix: string, ins: In[], outs: Out[], motors: Motor[]): SheetSpec[] {
  const iList: IO[] = ins.map((x, i) => ({ addr: addr('I', i), sym: 'B_' + sym(x.func), dev: [DEV[x.dev], x.tag, x.dev === 'limit' || x.dev === 'prox' ? { watch: x.watch, wend: x.end === '-' ? 'Retracted (−)' : 'Extended (+)' } : { func: x.func, ...(x.colour ? { colour: x.colour } : {}) }] as EP }));
  const oList: IO[] = outs.map((x, i) => ({ addr: addr('Q', i), sym: (x.dev === 'sol' ? 'Y_' : x.dev === 'lamp' ? 'H_' : 'K_') + sym(x.func), dev: [DEV[x.dev], x.tag, x.dev === 'lamp' ? { colour: x.colour || 'Green' } : {}] as EP }));
  const power: EDef = { texts: [[22, 20, `${prefix} — power: motor starters (contactors switched by PLC outputs)`]], rungs: [],
    power: motors.map((m, i) => ({ label: 'L' + (i + 1), x: 70 + i * 90, parts: [['std:e_mpcb', m.tag.replace(/M/, 'Q'), { i: Math.round(m.kw * 2) }], ['std:e_main_no', m.contactor], ['std:e_overload', m.tag.replace(/M/, 'F'), { i: Math.round(m.kw * 1.9) }], ['std:e_motor3', m.tag, { p: m.kw * 1000 }]] as EP[] })) };
  const sheets: SheetSpec[] = [];
  if (motors.length) sheets.push({ name: 'E1 Power', type: 'electric', draw: () => drawElec(power), description: 'Main power, motor protection, contactors' });
  ioSheets(`${prefix} — PLC inputs`, iList, 'in').forEach((d, i, a) => sheets.push({ name: `E${sheets.length + 1} PLC inputs${a.length > 1 ? ' ' + (i + 1) : ''}`, type: 'electric', draw: () => drawElec(d), description: `Inputs ${iList[i * 11]?.addr} …` }));
  ioSheets(`${prefix} — PLC outputs`, oList, 'out').forEach((d, i, a) => sheets.push({ name: `E${sheets.length + 1} PLC outputs${a.length > 1 ? ' ' + (i + 1) : ''}`, type: 'electric', draw: () => drawElec(d), description: `Outputs ${oList[i * 11]?.addr} …` }));
  return sheets;
}

// ---------- find signals: PLC I/O first (electric sheets), the fluid part's own signal otherwise ----------
export function finder(p: any) {
  const f = P.sigFinder(p); const T = signals(p);
  const plc = (tag: string, dir: 'in' | 'out') => T.sigs.find(s => s.src === 'plc' && s.dir === dir && s.tag === tag)?.id;
  const need = (x: string | undefined, what: string) => { if (!x) throw new Error('No signal for ' + what); return x; };
  return { ...f, T,
    Y: (solTag: string) => plc(solTag, 'out') || need(T.sigs.find(s => s.src === 'sol' && s.tag === solTag)?.id, 'solenoid ' + solTag),
    X: (tag: string) => need(plc(tag, 'in') || T.sigs.find(s => s.src === 'psw' && s.tag === tag)?.id, 'input ' + tag),
    Q: (tag: string) => need(plc(tag, 'out'), 'output ' + tag),
    pump: (motor: string, contactor?: string) => [T.sigs.find(s => s.src === 'drv' && s.tag === motor)?.id, contactor ? plc(contactor, 'out') : undefined].filter(Boolean) as string[] };
}

// ---------- the standard program frame ----------
export type Frame = {
  name: string; comment: string; vars: Var[];
  start: string; stop: string; estop?: string; // PLC input ids
  pumps: string[]; lamps?: { run?: string; fault?: string; homed?: string };
  auto: P.St[]; homing: P.St[]; manual: any[]; always?: any[]; alarms: any[]; onEstop?: any[]; onReset?: any[];
  sheet?: string; panelEdit?: ProgSpec['panelEdit'];
};
export const STD_VARS = (): Var[] => [P.vdef('v_mode', 'Mode', 'INT', '0', 'Panel mode selector: 0 AUTO, 1 MANUAL, 2 SETUP (homing)'), P.vdef('v_cycle', 'Cycle', 'BOOL', 'FALSE', 'Cycle running: set by START in AUTO, cleared by STOP (the cycle ends at S0)'), P.vdef('v_homed', 'Homed', 'BOOL', 'FALSE', 'Set by the homing sequence')];
export const mode = (k: number) => P.cmp(P.v('v_mode'), 'EQ', P.n(k));
/** AUTO S0 condition: cycle latched, homed, plus the machine's own start permissives */
export const go = (...extra: any[]) => P.and(P.v('v_cycle'), P.v('v_homed'), ...extra);
export function frame(f: Frame): ProgSpec {
  const last = f.auto[f.auto.length - 1][0];
  const main: any[] = [
    ...f.pumps.map(id => P.out(id, true)), ...(f.always || []),
    { type: 'hy_latch', fields: { VAR: 'v_cycle', MODE: 'RESET' }, inputs: { S: P.and(P.edge(P.inp(f.start)), mode(0)), R: P.or(P.not(P.inp(f.stop)), P.not(mode(0))) } },
    P.counter('Parts', P.stepIs('AUTO', last), 100000),
    P.ifElse(mode(0), [P.seq('AUTO', f.auto)], [P.seqReset('AUTO')]),
    P.ifElse(mode(2), [P.seq('HOMING', [...f.homing, ['H9', 'Homed', [P.set('v_homed', P.T), P.msg('Homed — switch to AUTO and press START')], P.F, 'END']])], [P.seqReset('HOMING')]),
    P.iff(mode(1), f.manual)];
  if (f.lamps?.run) main.push(P.iff(P.v('v_cycle'), [P.act(f.lamps.run)]));
  if (f.lamps?.homed) main.push(P.iff(P.v('v_homed'), [P.act(f.lamps.homed)]));
  if (f.lamps?.fault) main.push(P.iff(P.and(P.alarmsActive(''), P.blink()), [P.act(f.lamps.fault)]));
  main.push(...f.alarms, P.alarm('W-001', 'W', 'Not homed — run HOMING in SETUP', P.and(mode(0), P.not(P.v('v_homed')))));
  return {
    name: f.name, comment: f.comment, sheet: f.sheet, panelEdit: f.panelEdit, estop: f.estop, estopNc: true, vars: [...STD_VARS(), ...f.vars],
    ws: P.ws([
      P.hat('hy_start', 20, 20, [P.msg(`${f.name}: SETUP → START homes the machine, then AUTO → START`)]),
      P.hat('hy_main', 20, 140, main),
      P.hat('hy_estop', 900, 20, [P.allOff(), ...(f.onEstop || [])]),
      P.hat('hy_reset', 900, 200, [P.seqReset('AUTO'), P.seqReset('HOMING'), P.set('v_homed', P.F), P.set('v_cycle', P.F), ...(f.onReset || []), P.msg('Reset — home the machine in SETUP')]),
      P.hat('hy_fault', 900, 360, [P.allOff(), P.set('v_cycle', P.F)])])
  };
}
/** the panel touches every machine gets: START/STOP bound by auto-build; drop the small branch sequences from Main */
export function tidyPanel(panel: any, keepSeqs = ['AUTO', 'HOMING']) {
  panel.widgets = panel.widgets.filter((w: any) => !(['stepchain', 'steptimer'].includes(w.type) && w.page === 'main' && !keepSeqs.includes(w.p.seq)));
  const homing = panel.widgets.filter((w: any) => w.page === 'main' && w.p.seq === 'HOMING'); panel.widgets = panel.widgets.filter((w: any) => !homing.includes(w));
  panel.widgets.push(...homing);
  return panel;
}
/** standard machine I/O (operator station) */
export const OPERATOR = (n: string): In[] => [{ tag: n + 'S1', dev: 'estop', func: 'Emergency stop' }, { tag: n + 'S2', dev: 'pb', func: 'Cycle start', colour: 'Green' }, { tag: n + 'S3', dev: 'pbnc', func: 'Cycle stop' }, { tag: n + 'S4', dev: 'pb', func: 'Reset', colour: 'Blue' }];
export const LAMPS = (n: string): Out[] => [{ tag: n + 'H1', dev: 'lamp', func: 'Cycle running', colour: 'Green' }, { tag: n + 'H2', dev: 'lamp', func: 'Fault', colour: 'Red' }, { tag: n + 'H3', dev: 'lamp', func: 'Homed', colour: 'White' }];

// ---------- a standard hydraulic power unit sheet (pressure-compensated pump, relief, filters, accumulator, cooler) ----------
import { VF, CONN, U as UU, type FDef as FD } from './build';
export function hpu(o: { kw: number; vg: number; pc: number; relief: number; acc?: number; title: string; n?: number }): FD {
  const { bar, L, cc, kW, C } = UU; const TKp = (k: string, x: number, y: number, tag: string): any => [k, 'std:h_tank', x, y, 0, false, tag, { vol: L(250) }];
  return {
    parts: [
      ['pump', 'std:h_pump_pc', 80, 200, 0, false, '0P1', { vg: cc(o.vg), n: o.n || 1480, pc: bar(o.pc) }, 'right'], ['mot', 'std:h_emotor', 48, 200, 0, false, '0M1', { p: kW(o.kw), n: o.n || 1480 }, 'bottom'],
      ['str', 'std:h_filter_suction', 80, 240, 0, false, '0Z1'], TKp('tkL', 110, 246, '0Z11'), ['chk', 'std:h_check', 80, 160, 0, false, '0V1'],
      ['g1', 'std:h_gauge', 55, 126, 0, false, '0Z3', { range: bar(400) }, 'left'],
      ['rv1', 'std:h_relief_fixed', 120, 166, ...VF, '0V2', { set: bar(o.relief) }], TKp('tk1', 120, 206, '0Z12'),
      ['pf', 'std:h_filter_switch', 80, 110, 0, false, '0Z4', { rating: '10 µm' }], ['pt', 'std:h_ptransducer', 58, 66, 0, false, '0B1', { range: bar(400) }, 'left'],
      ['so', 'std:h_shutoff', 210, 104, 0, false, '0V4'], ['acc', 'std:h_accu', 245, 105, 0, false, '0Z5', { vol: L(o.acc || 10), pre: bar(Math.round(o.pc * 0.45)) }], ['ps', 'std:h_pswitch', 275, 116, 0, false, '0B2', { set: bar(Math.round(o.pc * 0.6)) }],
      ['g2', 'std:h_gauge', 180, 116, 0, false, '0Z6', { range: bar(400) }, 'left'],
      ['ts', 'std:h_tempswitch', 300, 141, 0, false, '0B3', { set: C(60) }], ['clr', 'std:h_cooler_fan', 265, 183, ...VF, '0E1'], ['rf', 'std:h_filter_switch', 265, 214, ...VF, '0Z7', { rating: '25 µm' }], TKp('tk4', 265, 248, '0Z15'),
      ['x1', CONN, 340, 50, 0, false, 'X1', { kind: 'work' }], ['x2', CONN, 340, 168, 0, false, 'X2', { kind: 'work' }]
    ],
    junctions: { J1: [80, 140], J2: [80, 80], J4: [210, 80], J5: [210, 130], J6: [300, 168], J7: [245, 130] },
    lines: [['pump.S', 'str.S'], ['pump.L', 'tkL.T', [[110, 216]], 'drain'], ['pump.P', 'chk.1'], ['chk.2', 'J1'], ['J1', 'g1.1', [[55, 140]]], ['J1', 'rv1.P', [[120, 140]]], ['rv1.T', 'tk1.T'],
      ['J1', 'pf.1'], ['pf.2', 'J2'], ['J2', 'pt.1', [[58, 80]]], ['J2', 'x1.X', [[80, 50]]], ['J2', 'J4'], ['J4', 'so.2'], ['so.1', 'J5'], ['J5', 'J7'], ['J7', 'acc.P'], ['J7', 'ps.P'], ['J5', 'g2.1'],
      ['x2.X', 'J6'], ['J6', 'ts.1'], ['J6', 'clr.1', [[265, 168]]], ['clr.2', 'rf.1'], ['rf.2', 'tk4.T']],
    enclosures: [[28, 36, 292, 215, o.title]]
  };
}