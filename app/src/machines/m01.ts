// Machine 1 — Advanced clamping press 400 kN: the project (sheets, program, panel). Original design, MIT / CC-BY.
import { drawFluid, type MachineSpec } from './build';
import { powerUnit, press, clamps, machineSheet } from './m01_press';
import { electrics, finder, frame, go, tidyPanel, OPERATOR, LAMPS, mode, type In, type Out } from './kit';
import * as P from './prog';
import { mkWidget } from '../plc/panel/model';

const KN_PER_BAR = Math.PI * 0.08 ** 2 * 1e5 / 1000; // Ø160 piston: 2.01 kN per bar
const INS: In[] = [...OPERATOR('0'), { tag: '0S5', dev: 'pbnc', func: 'Light curtain' }, { tag: '0S6', dev: 'pbnc', func: 'Guard door closed' },
  { tag: '1B3', dev: 'limit', func: 'Ram top', watch: '1A1', end: '-' }, { tag: '1B4', dev: 'limit', func: 'Ram bottom', watch: '1A1', end: '+' },
  { tag: '2B2', dev: 'limit', func: 'Clamp 1 open', watch: '2A1', end: '-' }, { tag: '2B3', dev: 'limit', func: 'Clamp 1 closed', watch: '2A1', end: '+' },
  { tag: '2B4', dev: 'limit', func: 'Clamp 2 open', watch: '2A2', end: '-' }, { tag: '2B5', dev: 'limit', func: 'Clamp 2 closed', watch: '2A2', end: '+' },
  { tag: '3B1', dev: 'limit', func: 'Ejector back', watch: '3A1', end: '-' }, { tag: '3B2', dev: 'limit', func: 'Ejector out', watch: '3A1', end: '+' },
  { tag: '2B1', dev: 'psw', func: 'Clamp pressure' }, { tag: '0B2', dev: 'psw', func: 'Accumulator charged' }, { tag: '0B3', dev: 'tsw', func: 'Oil hot' }, { tag: '0B4', dev: 'float', func: 'Oil level low' }];
const OUTS: Out[] = [{ tag: '0K1', dev: 'coil', func: 'Pump motor' }, { tag: '1Y3', dev: 'sol', func: 'Decompression' }, { tag: '2Y1', dev: 'sol', func: 'Clamp' }, { tag: '3Y1', dev: 'sol', func: 'Eject' }, { tag: '3Y2', dev: 'sol', func: 'Ejector back' }, { tag: '0Y5', dev: 'sol', func: 'Accumulator dump' }, ...LAMPS('0'), { tag: '0H4', dev: 'buzzer', func: 'Horn' }];

export const m01 = (): MachineSpec => ({
  id: 'm01_press', name: 'Advanced clamping press 400 kN', licence: 'original design, HYDRA samples, MIT / CC-BY',
  description: 'Fast approach with prefill valve, force-controlled pressing (PID), dwell, decompression, return, clamps and ejector',
  asm: [
    { name: 'Machine', sheets: [{ name: '0 Machine', type: 'hydraulic', late: true, draw: ids => drawFluid(machineSheet(ids), 'hydraulic'), description: 'The whole machine: power unit + press + clamps/ejector. Simulate and run the PLC here' }] },
    { name: 'Hydraulics', sheets: [
      { name: '1 Power unit', type: 'hydraulic', draw: powerUnit, description: 'HPU 30 kW, pressure-compensated pump, accumulator safety block' },
      { name: '2 Press cylinder', type: 'hydraulic', draw: press, description: 'Main cylinder 1A1 with prefill, counterbalance, decompression' },
      { name: '3 Clamps and ejector', type: 'hydraulic', draw: clamps, description: 'Clamps 2A1/2A2 at reduced pressure, ejector 3A1' }] },
    { name: 'Electrical', sheets: electrics('Clamping press', INS, OUTS, [{ tag: '0M1', kw: 30, contactor: '0K1' }]) }
  ],
  programs: p => {
    const s = finder(p);
    const Y = { down: s.prop('1V1', 'a'), up: s.prop('1V1', 'b'), dec: s.Y('1Y3'), clamp: s.Y('2Y1'), ejOut: s.Y('3Y1'), ejIn: s.Y('3Y2'), dump: s.Y('0Y5'), horn: s.Q('0H4') };
    const X = (t: string) => P.inp(s.X(t));
    const force = P.ain(s.pg('1B1')), pos = P.ain(s.pos('1A1')), sys = P.ain(s.pg('0B1'));
    const home = P.and(X('1B3'), X('2B2'), X('2B4'), X('3B1'));
    const guard = P.and(X('0S5'), X('0S6'));
    const vars = [P.vdef('v_force', 'Force_kN', 'FLOAT', '300', 'Pressing force set point (kN)'), P.vdef('v_dwell', 'Dwell_s', 'FLOAT', '1.5', 'Hold time at force (s)'), P.vdef('v_sp', 'SP_bar', 'FLOAT', '0', 'Force set point as cap-side pressure (bar)'),
      P.vdef('v_j1p', 'Jog_1A1_plus', 'BOOL', 'FALSE', 'Panel jog 1A1 + (MANUAL)'), P.vdef('v_j1m', 'Jog_1A1_minus', 'BOOL', 'FALSE', 'Panel jog 1A1 − (MANUAL)'), P.vdef('v_j2p', 'Jog_2A1_plus', 'BOOL', 'FALSE', 'Panel jog clamps + (MANUAL)'),
      P.vdef('v_j3p', 'Jog_3A1_plus', 'BOOL', 'FALSE', 'Panel jog ejector + (MANUAL)'), P.vdef('v_j3m', 'Jog_3A1_minus', 'BOOL', 'FALSE', 'Panel jog ejector − (MANUAL)')];
    const c = (k: string) => P.act(k);
    return [frame({
      name: 'Press control', comment: 'AUTO 13 steps + parallel unclamp / eject · SETUP homing · MANUAL jog · force PID on 1B1', sheet: '0 Machine', vars,
      start: s.X('0S2'), stop: s.X('0S3'), estop: s.X('0S1'), pumps: s.pump('0M1', '0K1'), lamps: { run: s.Q('0H1'), fault: s.Q('0H2'), homed: s.Q('0H3') },
      always: [P.aout(Y.down, P.n(0)), P.aout(Y.up, P.n(0)), P.set('v_sp', P.div(P.v('v_force'), P.n(KN_PER_BAR))),
        P.pid('FORCE', force, P.v('v_sp'), 0.35, 0.6, 0, 0, 100, P.or(P.stepIs('AUTO', 'S6'), P.stepIs('AUTO', 'S7')))],
      auto: [
        ['S0', 'Idle', [P.msg('AUTO — press START')], go(home, guard)],
        ['S1', 'Checks', [], P.and(X('0B2'), P.not(X('0B3')), P.not(X('0B4')), P.cmp(sys, 'GTE', P.n(150)))],
        ['S2', 'Clamp', [c(Y.clamp)], P.and(X('2B3'), X('2B5'))],
        ['S3', 'Clamp pressure', [c(Y.clamp)], P.forS(X('2B1'), 0.3)],
        ['S4', 'Fast approach', [c(Y.clamp), P.aout(Y.down, P.n(100))], P.cmp(pos, 'GTE', P.n(420))],
        ['S5', 'Slow down', [c(Y.clamp), P.aout(Y.down, P.ramp(P.n(30), 200))], P.or(P.cmp(force, 'GTE', P.n(20)), X('1B4'))],
        ['S6', 'Press build-up', [c(Y.clamp), P.aout(Y.down, P.pidOut('FORCE'))], P.forS(P.within(force, P.v('v_sp'), P.n(5)), 0.3)],
        ['S7', 'Dwell at force', [c(Y.clamp), P.aout(Y.down, P.pidOut('FORCE'))], P.cmp(P.stepT(), 'GTE', P.v('v_dwell'))],
        ['S8', 'Decompress', [c(Y.clamp), c(Y.dec)], P.cmp(force, 'LTE', P.n(10))],
        ['S9', 'Return fast', [c(Y.clamp), P.aout(Y.up, P.n(100))], P.cmp(pos, 'LTE', P.n(60))],
        ['S10', 'Return slow', [c(Y.clamp), P.aout(Y.up, P.n(25))], X('1B3')],
        ['S11', 'Unclamp + eject', [P.par('UNLOAD', [
          [P.seq('UNCLAMP', [['U1', 'Clamps open', [], P.and(X('2B2'), X('2B4')), 'END']])],
          [P.seq('EJECT', [['E1', 'Eject', [c(Y.ejOut)], X('3B2')], ['E2', 'Ejector back', [c(Y.ejIn)], X('3B1'), 'END']])]])], P.parDone('UNLOAD')],
        ['S12', 'Cycle end', [], P.T, 'S0']],
      homing: [
        ['H0', 'Wait', [P.msg('SETUP — press START to home the press')], P.edge(X('0S2'))],
        ['H1', 'Ram up', [P.aout(Y.up, P.n(25))], X('1B3')],
        ['H2', 'Clamps open', [], P.and(X('2B2'), X('2B4'))],
        ['H3', 'Ejector back', [c(Y.ejIn)], X('3B1')]],
      manual: [P.iff(P.v('v_j1p'), [P.aout(Y.down, P.n(20))]), P.iff(P.v('v_j1m'), [P.aout(Y.up, P.n(20))]), P.iff(P.v('v_j2p'), [c(Y.clamp)]), P.iff(P.v('v_j3p'), [c(Y.ejOut)]), P.iff(P.v('v_j3m'), [c(Y.ejIn)])],
      alarms: [P.alarm('F-101', 'F', 'Oil temperature high (0B3)', X('0B3')), P.alarm('F-102', 'F', 'Oil level low (0B4)', X('0B4')),
        P.alarm('W-103', 'W', 'Accumulator not charged (0B2)', P.forS(P.not(X('0B2')), 5)),
        P.alarm('W-104', 'W', 'Press force above set point + 10 %', P.cmp(force, 'GT', P.mul(P.v('v_sp'), P.n(1.1)))),
        P.alarm('W-105', 'W', 'Guard open or light curtain interrupted', P.and(mode(0), P.not(guard))),
        P.iff(P.and(P.alarmsActive('F-'), P.blink(1, 1)), [P.act(Y.horn)])],
      onEstop: [P.out(Y.dump, true), P.msg('E-STOP — accumulator dumped')], onReset: [P.out(Y.dump, false)],
      panelEdit: panel => { tidyPanel(panel);
        panel.widgets.forEach((w: any) => { if (w.type === 'gauge') w.p.max = 300; if (w.type === 'steptimer' && w.p.seq === 'AUTO') w.p.timeout = 8; });
        const i = panel.widgets.findIndex((w: any) => w.type === 'group' && w.p.label === 'Hydraulics');
        panel.widgets.splice(i + 1, 0, mkWidget('gauge', 'main', { label: 'Press force 1B1', src: 'sig:' + s.pg('1B1'), min: 0, max: 250, warn: 200, unit: 'bar' }, 3, 3),
          mkWidget('numin', 'main', { label: 'Force set point', act: 'var:v_force', min: 20, max: 400, unit: 'kN', dec: 0 }, 2, 1), mkWidget('numin', 'main', { label: 'Dwell', act: 'var:v_dwell', min: 0, max: 30, unit: 's', dec: 1 }, 2, 1),
          mkWidget('value', 'main', { label: 'Ram position', src: 'sig:' + s.pos('1A1'), unit: 'mm', dec: 0 }, 2, 1),
          mkWidget('trend', 'main', { label: 'Force vs set point · 30 s', srcs: ['sig:' + s.pg('1B1'), 'var:v_sp'].join(','), span: 30 }, 5, 3)); }
    })];
  }
});
