// Machine 1 — Advanced clamping press, 400 kN (original design, HYDRA samples, MIT / CC-BY): the fluid sheets
import { VF, CONN, U, drawFluid, type FDef } from './build';
const { bar, L, cc, kW, C, mm } = U;
const TK = (k: string, x: number, y: number, tag: string, vol = 400, label?: string): any => [k, 'std:h_tank', x, y, 0, false, tag, { vol: L(vol) }, label];
const CYL = (bore: number, rod: number, stroke: number, load: number, extra: any = {}) => ({ bore: mm(bore), rod: mm(rod), stroke: mm(stroke), load, ...extra });

// ---- sheet 1: power unit 0 — pressure-compensated pump, proportional system relief, accumulator safety block, return line ----
export const POWER_UNIT: FDef = {
  parts: [
    ['pump', 'std:h_pump_pc', 80, 200, 0, false, '0P1', { vg: cc(45), n: 1480, pc: bar(250) }, 'right'], ['mot', 'std:h_emotor', 48, 200, 0, false, '0M1', { p: kW(30), n: 1480 }, 'bottom'],
    ['str', 'std:h_filter_suction', 80, 240, 0, false, '0Z1'], TK('tkL', 110, 246, '0Z11'),
    ['chk', 'std:h_check', 80, 160, 0, false, '0V1'],
    ['g1', 'std:h_gauge', 55, 126, 0, false, '0Z3', { range: bar(400) }, 'left'],
    ['rv1', 'std:h_relief_fixed', 120, 166, ...VF, '0V2', { set: bar(280) }], TK('tk1', 120, 206, '0Z12'),
    ['rv2', 'std:h_relief_prop', 160, 166, ...VF, '0V3', { set: bar(250) }], TK('tk2', 160, 206, '0Z13'),
    ['pf', 'std:h_filter_switch', 80, 110, 0, false, '0Z4', { rating: '10 µm' }],
    ['pt', 'std:h_ptransducer', 58, 66, 0, false, '0B1', { range: bar(400) }, 'left'],
    ['so', 'std:h_shutoff', 210, 104, 0, false, '0V4'], ['acc', 'std:h_accu', 245, 105, 0, false, '0Z5', { vol: L(10), pre: bar(90) }], ['ps', 'std:h_pswitch', 275, 116, 0, false, '0B2', { set: bar(140) }],
    ['dmp', 'std:v_22', 232, 152, 0, false, '0V5', { ya: '0Y5' }], TK('tk3', 232, 192, '0Z14', 400, 'left'), ['g2', 'std:h_gauge', 180, 116, 0, false, '0Z6', { range: bar(400) }, 'left'],
    ['ts', 'std:h_tempswitch', 300, 141, 0, false, '0B3', { set: C(60) }], ['clr', 'std:h_cooler_fan', 265, 183, ...VF, '0E1'], ['rf', 'std:h_filter_switch', 265, 214, ...VF, '0Z7', { rating: '25 µm' }], TK('tk4', 265, 248, '0Z15'),
    ['x1', CONN, 340, 50, 0, false, 'X1', { kind: 'work' }], ['x2', CONN, 340, 168, 0, false, 'X2', { kind: 'work' }]
  ],
  junctions: { J1: [80, 140], J3: [120, 140], J2: [80, 80], J4: [210, 80], J5: [210, 130], J6: [300, 168], J7: [245, 130] },
  lines: [
    ['pump.S', 'str.S'], ['pump.L', 'tkL.T', [[110, 216]], 'drain'], ['pump.P', 'chk.1'], ['chk.2', 'J1'], ['J1', 'g1.1', [[55, 140]]],
    ['J1', 'J3'], ['J3', 'rv1.P'], ['J3', 'rv2.P', [[160, 140]]], ['rv1.T', 'tk1.T'], ['rv2.T', 'tk2.T'],
    ['J1', 'pf.1'], ['pf.2', 'J2'], ['J2', 'pt.1', [[58, 80]]], ['J2', 'x1.X', [[80, 50]]],
    ['J2', 'J4'], ['J4', 'so.2'], ['so.1', 'J5'], ['J5', 'J7'], ['J7', 'acc.P'], ['J7', 'ps.P'], ['J5', 'g2.1'], ['J5', 'dmp.A'], ['dmp.P', 'tk3.T'],
    ['x2.X', 'J6'], ['J6', 'ts.1'], ['J6', 'clr.1', [[265, 168]]], ['clr.2', 'rf.1'], ['rf.2', 'tk4.T']
  ],
  enclosures: [[28, 36, 292, 215, 'Power unit 0 · 30 kW · 63 L/min · 250 bar · tank 400 L']],
  texts: [[150, 45, 'X1 → pressure P to the press · X2 ← return T', 2.6]]
};

// ---- sheet 2: main cylinder 1A1 — proportional valve, counterbalance, prefill from the header tank, decompression ----
export const PRESS: FDef = {
  parts: [
    ['cyl', 'std:h_cyl_double', 200, 60, ...VF, '1A1', CYL(160, 110, 500, 1800, { angle: -90 })],
    ['pre', 'std:h_poc', 90, 110, 0, false, '1V4', {}, 'left'], TK('tkH', 90, 150, '1Z1', 250),
    ['pt', 'std:h_ptransducer', 150, 82, 0, false, '1B1', { range: bar(400) }, 'left'],
    ['dec', 'std:v_22', 140, 150, 0, false, '1V3', { ya: '1Y3' }], ['thr', 'std:h_throttle', 140, 188, 0, false, '1V5', { open: 20 }], TK('tkD', 140, 226, '1Z2'),
    ['cb', 'std:h_counterbal', 226, 120, 0, false, '1V2', { set: bar(60) }, 'right'],
    ['pt2', 'std:h_ptransducer', 262, 146, 0, false, '1B2', { range: bar(400) }],
    ['v', 'std:v_43_prop', 200, 200, 0, false, '1V1', { ya: '1Y1', yb: '1Y2' }],
    ['x1', CONN, 40, 232, 180, false, 'X1', { kind: 'work' }], ['x2', CONN, 40, 244, 180, false, 'X2', { kind: 'work' }]
  ],
  junctions: { JA: [174, 96], JA2: [150, 96], JA3: [174, 130], JB: [226, 160] },
  lines: [
    ['cyl.A', 'JA'], ['JA', 'JA2'], ['JA2', 'pt.1'], ['JA2', 'pre.2', [[90, 96]]], ['tkH.T', 'pre.1'],
    ['JA', 'JA3'], ['JA3', 'dec.A', [[140, 130]]], ['dec.P', 'thr.2'], ['thr.1', 'tkD.T'], ['JA3', 'v.A', [[174, 172], [195, 172]]],
    ['cyl.B', 'cb.2'], ['cb.1', 'JB'], ['JB', 'v.B', [[205, 160]]], ['JB', 'pt2.1', [[262, 160]]],
    ['JB', 'pre.X', [[300, 160], [300, 26], [56, 26], [56, 104]], 'pilot'],
    ['x1.X', 'v.P', [[195, 232]]], ['x2.X', 'v.T', [[205, 244]]]
  ],
  enclosures: [[70, 36, 200, 70, 'Press frame · 1A1 Ø160/110 × 500 · 400 kN at 200 bar']],
  texts: [[250, 196, '1V1 proportional: fast approach (prefill 1V4 open), pressing (force PID on 1B1), return', 2.4], [250, 202, '1V3 + 1V5: decompression before return · 1V2 holds the platen', 2.4]]
};

// ---- sheet 3: clamps 2A1 / 2A2 (reduced pressure, held by double pilot check) and ejector 3A1 ----
export const CLAMPS: FDef = {
  parts: [
    ['c1', 'std:h_cyl_double', 80, 50, ...VF, '2A1', CYL(63, 36, 60, 20)], ['c2', 'std:h_cyl_double', 180, 50, ...VF, '2A2', CYL(63, 36, 60, 20)],
    ['dp', 'std:h_dpoc', 120, 125, 0, false, '2V3'],
    ['v2', 'std:v_42', 120, 165, 0, false, '2V1', { ya: '2Y1' }],
    ['red', 'std:h_reducing', 80, 210, 0, false, '2V2', { set: bar(80) }, 'left'], ['ps', 'std:h_pswitch', 52, 174, 0, false, '2B1', { set: bar(60) }, 'left'],
    ['ej', 'std:h_cyl_double', 300, 60, ...VF, '3A1', CYL(50, 28, 150, 15)], ['fc', 'std:h_oneway', 274, 110, 0, false, '3V2', { open: 40 }, 'left'],
    ['v3', 'std:v_43_closed', 300, 170, 0, false, '3V1', { ya: '3Y1', yb: '3Y2' }],
    ['x1', CONN, 40, 232, 180, false, 'X1', { kind: 'work' }], ['x2', CONN, 40, 244, 180, false, 'X2', { kind: 'work' }]
  ],
  junctions: { JC1: [112, 76], JC2: [128, 90], J20: [80, 232], J21: [125, 244], J22: [80, 188] },
  lines: [
    ['x1.X', 'J20'], ['J20', 'red.P'], ['red.A', 'J22'], ['J22', 'ps.P'], ['J22', 'v2.P', [[115, 188]]],
    ['v2.A', 'dp.A', [[115, 145], [112, 145]]], ['v2.B', 'dp.B', [[125, 145], [128, 145]]],
    ['dp.A1', 'JC1'], ['JC1', 'c1.A', [[54, 76]]], ['JC1', 'c2.A', [[154, 76]]], ['dp.B1', 'JC2'], ['JC2', 'c1.B', [[106, 90]]], ['JC2', 'c2.B', [[206, 90]]],
    ['x2.X', 'J21'], ['J21', 'v2.T'],
    ['ej.A', 'fc.2'], ['fc.1', 'v3.A', [[274, 140], [295, 140]]], ['ej.B', 'v3.B', [[326, 140], [305, 140]]],
    ['J20', 'v3.P', [[295, 232]]], ['J21', 'v3.T', [[305, 244]]]
  ],
  enclosures: [[30, 30, 200, 66, 'Clamps 2A1 / 2A2 · Ø63/36 × 60 · 80 bar'], [250, 36, 100, 82, 'Ejector 3A1 · Ø50/28 × 150']]
};

// ---- sheet 0: the machine — the three sheets as assemblies, joined by the P and T headers (the simulation runs here) ----
export const machineSheet = (ids: Record<string, string>): FDef => ({
  parts: [
    ['pu', 'asm:' + ids['1 Power unit'], -85, 5, 0, false, '=0'],
    ['pr', 'asm:' + ids['2 Press cylinder'], 85, -40, 0, false, '=1'],
    ['cl', 'asm:' + ids['3 Clamps and ejector'], 95, 60, 0, false, '=2']
  ],
  junctions: { JP: [180, 145], JT: [200, 155] },
  lines: [['pu.X1', 'JP'], ['JP', 'pr.X1', [[180, 95]]], ['JP', 'cl.X1', [[180, 195]]], ['pu.X2', 'JT'], ['JT', 'pr.X2', [[200, 105]]], ['JT', 'cl.X2', [[200, 205]]]], texts: [[30, 24, 'Advanced clamping press 400 kN — machine sheet: run the simulation and the PLC program here', 3]]
});
export const powerUnit = () => drawFluid(POWER_UNIT, 'hydraulic');
export const press = () => drawFluid(PRESS, 'hydraulic');
export const clamps = () => drawFluid(CLAMPS, 'hydraulic');
