// Drawn sample circuits (A3, 1:1) for the fluid sheets of the sample libraries.
// Part positions are fixed; every pipe end is taken from the part's real port, so the drawings stay exact.
import { geomOf, portWorld } from './geom';
import { defaults } from './fields';
import { simplify, type Sheet, type Comp, type Pipe, type End } from './model';
import { uid } from '../util';

type P = [key: string, ref: string, x: number, y: number, rot?: number, mirror?: boolean, tag?: string, values?: Record<string, any>, label?: Comp['labelPos']];
type L = [a: string, b: string, mids?: number[][], kind?: Pipe['kind']];
type Def = { parts: P[]; junctions?: Record<string, [number, number]>; lines: L[]; enclosures?: [number, number, number, number, string][]; texts?: [number, number, string][]; shift?: number }; // shift: move the whole drawing left, clear of the title block
const VF = [180, true] as const; // vertical flip: ports that face up now face down

const DEFS: Record<string, Def> = {
  s_basic_cyl: {
    parts: [['cyl', 'std:h_cyl_double', 150, 62, ...VF, '1A1'], ['v', 'std:v_43_closed', 150, 130, 0, false, '1V1', { ya: '1Y1', yb: '1Y2' }], ['pump', 'std:h_pump_fixed', 145, 222, 0, false, '1P1'], ['mot', 'std:h_emotor', 113, 222, 0, false, '1M1', undefined, 'bottom'],
      ['rv', 'std:h_relief', 190, 192, ...VF, '1V2'], ['tk1', 'std:h_tank', 145, 262, 0, false, '1Z1'], ['tk2', 'std:h_tank', 190, 232, 0, false, '1Z2'], ['flt', 'std:h_filter', 235, 190, 0, false, '1Z3'], ['tk3', 'std:h_tank', 235, 232, 0, false, '1Z4'], ['g', 'std:h_gauge', 110, 176, 0, false, '1Z5', undefined, 'left']],
    junctions: { J1: [145, 176], J2: [145, 190] },
    lines: [['cyl.A', 'v.A', [[124, 96], [145, 96]]], ['cyl.B', 'v.B', [[176, 96], [155, 96]]], ['pump.P', 'J2'], ['J2', 'J1'], ['J1', 'v.P'], ['J1', 'rv.P'], ['J2', 'g.1'], ['rv.T', 'tk2.T'], ['pump.S', 'tk1.T'],
      ['v.T', 'flt.2', [[155, 156], [235, 156]]], ['flt.1', 'tk3.T']],
    enclosures: [[92, 160, 160, 112, 'Power unit']], shift: -25
  },
  s_meter_out: {
    parts: [['cyl', 'std:h_cyl_double', 160, 48, ...VF, '1A1'], ['f1', 'std:h_oneway', 134, 92, 0, false, '1V2'], ['f2', 'std:h_oneway', 186, 92, 0, false, '1V3'], ['v', 'std:v_43_tandem', 160, 150, 0, false, '1V1'],
      ['pump', 'std:h_pump_fixed', 155, 232, 0, false, '1P1'], ['mot', 'std:h_emotor', 123, 232, 0, false, '1M1', undefined, 'bottom'], ['rv', 'std:h_relief', 200, 206, ...VF, '1V4'], ['tk1', 'std:h_tank', 155, 272, 0, false, '1Z1'], ['tk2', 'std:h_tank', 200, 246, 0, false, '1Z2'], ['tk3', 'std:h_tank', 240, 246, 0, false, '1Z3']],
    junctions: { J1: [155, 190] },
    lines: [['cyl.A', 'f1.2'], ['cyl.B', 'f2.2'], ['f1.1', 'v.A', [[134, 120], [155, 120]]], ['f2.1', 'v.B', [[186, 120], [165, 120]]], ['pump.P', 'J1'], ['J1', 'v.P'], ['J1', 'rv.P'], ['rv.T', 'tk2.T'], ['pump.S', 'tk1.T'], ['v.T', 'tk3.T', [[165, 178], [240, 178]]]],
    texts: [[212, 92, 'Meter-out: flow controls throttle the oil leaving the cylinder']], shift: -20
  },
  s_pneu_recip: {
    parts: [['cyl', 'std:h_cyl_double', 170, 60, ...VF, '1A1'], ['v', 'std:v_p52', 170, 130, 0, false, '1V1'], ['s1', 'std:p_silencer', 138, 152, 90, false, '1Z1'], ['s2', 'std:p_silencer', 202, 152, 270, false, '1Z2'],
      ['reg', 'std:p_regulator', 170, 196, 0, false, '0Z2'], ['flt', 'std:p_filter', 120, 222, 0, false, '0Z1'], ['cmp', 'std:p_compressor', 80, 250, 0, false, '0P1']],
    lines: [['cyl.A', 'v.A', [[144, 94], [165, 94]]], ['cyl.B', 'v.B', [[196, 94], [175, 94]]], ['v.R', 's1.3', [[165, 152]]], ['v.S', 's2.3', [[175, 152]]], ['v.P', 'reg.2'], ['flt.2', 'reg.1', [[170, 222]]], ['cmp.1', 'flt.1', [[80, 222]]]],
    enclosures: [[55, 176, 150, 96, 'Air supply · 0Z']]
  },
  s_regen: { // pressure (regenerative) centre: in the centre position A and B both see the pump, rod-side oil joins the pump flow
    parts: [['cyl', 'std:h_cyl_double', 160, 48, ...VF, '1A1'], ['v', 'std:v_43_pcentre', 160, 150, 0, false, '1V1'],
      ['pump', 'std:h_pump_fixed', 155, 232, 0, false, '1P1'], ['mot', 'std:h_emotor', 123, 232, 0, false, '1M1', undefined, 'bottom'], ['rv', 'std:h_relief', 200, 206, ...VF, '1V2'], ['tk1', 'std:h_tank', 155, 272, 0, false, '1Z1'], ['tk2', 'std:h_tank', 200, 246, 0, false, '1Z2'], ['tk3', 'std:h_tank', 240, 246, 0, false, '1Z3']],
    junctions: { J1: [155, 190] },
    lines: [['cyl.A', 'v.A', [[134, 110], [155, 110]]], ['cyl.B', 'v.B', [[186, 120], [165, 120]]],
      ['pump.P', 'J1'], ['J1', 'v.P'], ['J1', 'rv.P'], ['rv.T', 'tk2.T'], ['pump.S', 'tk1.T'], ['v.T', 'tk3.T', [[165, 178], [240, 178]]]],
    texts: [[212, 92, 'Centre position: regenerative (fast) extension'], [212, 98, 'a: normal extension · b: retraction']], shift: -20
  },
  s_press: {
    parts: [['cyl', 'std:h_cyl_double', 170, 48, ...VF, '1A1'], ['v', 'std:v_43_float', 170, 140, 0, false, '1V1', { ya: '1Y1', yb: '1Y2' }], ['red', 'std:h_reducing', 165, 190, 0, false, '1V3'], ['acc', 'std:h_accu', 110, 148, 0, false, '1Z1', undefined, 'left'],
      ['pump', 'std:h_pump_var', 165, 240, 0, false, '1P1'], ['mot', 'std:h_emotor', 133, 240, 0, false, '1M1', undefined, 'bottom'], ['rv', 'std:h_relief', 210, 231, ...VF, '1V2'], ['g', 'std:h_gauge', 130, 201, 0, false, '1Z2', undefined, 'left'],
      ['clr', 'std:h_cooler', 250, 190, 0, false, '1Z3'], ['tk1', 'std:h_tank', 165, 280, 0, false, '1Z4'], ['tk2', 'std:h_tank', 210, 271, 0, false, '1Z5'], ['tk3', 'std:h_tank', 250, 229, 0, false, '1Z6']],
    junctions: { J1: [165, 215], J2: [165, 165] },
    lines: [['cyl.A', 'v.A', [[144, 100], [165, 100]]], ['cyl.B', 'v.B', [[196, 100], [175, 100]]], ['red.A', 'J2'], ['J2', 'v.P'], ['J2', 'acc.P'], ['pump.P', 'J1'], ['J1', 'red.P'], ['J1', 'rv.P'], ['J1', 'g.1'],
      ['rv.T', 'tk2.T'], ['pump.S', 'tk1.T'], ['v.T', 'clr.2', [[175, 162], [250, 162]]], ['clr.1', 'tk3.T']]
  },
  s_sequence: {
    parts: [['c1', 'std:h_cyl_double', 120, 48, ...VF, '1A1'], ['v1', 'std:v_43_closed', 120, 140, 0, false, '1V1', { ya: '1Y1', yb: '1Y2' }], ['c2', 'std:h_cyl_double', 260, 48, ...VF, '2A1'], ['v2', 'std:v_43_closed', 260, 140, 0, false, '2V1', { ya: '2Y1', yb: '2Y2' }],
      ['t1', 'std:h_tank', 150, 184, 0, false, '1Z1'], ['t2', 'std:h_tank', 290, 184, 0, false, '2Z1'],
      ['pump', 'std:h_pump_fixed', 170, 240, 0, false, '0P1'], ['mot', 'std:h_emotor', 138, 240, 0, false, '0M1', undefined, 'bottom'], ['rv', 'std:h_relief', 205, 228, ...VF, '0V1'], ['t0', 'std:h_tank', 170, 280, 0, false, '0Z1'], ['t3', 'std:h_tank', 205, 268, 0, false, '0Z2']],
    junctions: { J1: [170, 212], J2: [170, 200] },
    lines: [['c1.A', 'v1.A', [[94, 100], [115, 100]]], ['c1.B', 'v1.B', [[146, 100], [125, 100]]], ['c2.A', 'v2.A', [[234, 100], [255, 100]]], ['c2.B', 'v2.B', [[286, 100], [265, 100]]],
      ['v1.T', 't1.T', [[125, 164], [150, 164]]], ['v2.T', 't2.T', [[265, 164], [290, 164]]], ['pump.P', 'J1'], ['J1', 'J2'], ['J1', 'rv.P'], ['J2', 'v1.P', [[115, 200]]], ['J2', 'v2.P', [[255, 200]]], ['rv.T', 't3.T'], ['pump.S', 't0.T']],
    enclosures: [[100, 205, 128, 79, 'Power unit · 0']]
  }
};

// ---------- electric sample sheets: ladder diagrams between a +24V and a 0V rail (net labels) ----------
type EP = [key: string, ref: string, tag: string, values?: Record<string, any>];
type Rung = { x: number; parts: EP[]; top?: boolean; bot?: boolean; seal?: { over: [number, number]; part: EP; dx?: number } };
type EDef = { rungs: Rung[]; power?: { label: string; x: number; parts: EP[] }[]; texts?: [number, number, string][] };
const RT = 32, RB = 226;
const EDEFS: Record<string, EDef> = {
  s_basic_cyl: { texts: [[30, 22, 'PLC outputs → valve solenoids · PLC inputs ← operator']], rungs: [
    { x: 70, top: false, parts: [['q0', 'std:e_plc_out', 'Q0.0', { sym: 'Y_Extend' }], ['y1', 'std:e_sol', '1Y1']] },
    { x: 115, top: false, parts: [['q1', 'std:e_plc_out', 'Q0.1', { sym: 'Y_Retract' }], ['y2', 'std:e_sol', '1Y2']] },
    { x: 170, bot: false, parts: [['s1', 'std:e_pb_no', '1S1', { func: 'Extend' }], ['i0', 'std:e_plc_in', 'I0.0', { sym: 'B_Extend' }]] },
    { x: 215, bot: false, parts: [['s2', 'std:e_pb_no', '1S2', { func: 'Retract' }], ['i1', 'std:e_plc_in', 'I0.1', { sym: 'B_Retract' }]] },
    { x: 270, parts: [['k1c', 'std:e_pb_no', '1S3', { func: 'Pump start' }], ['k1', 'std:e_coil', '1K1']] }],
    power: [{ label: 'L1', x: 330, parts: [['q1m', 'std:e_mpcb', '1Q1', { i: 12 }], ['k1m', 'std:e_main_no', '1K1'], ['m1', 'std:e_motor3', '1M1', { p: 5.5 }]] }] },
  s_press: { texts: [[30, 22, 'Press controls — PLC I/O']], rungs: [
    { x: 70, top: false, parts: [['q0', 'std:e_plc_out', 'Q0.0', { sym: 'Y_PressDown' }], ['y1', 'std:e_sol', '1Y1']] },
    { x: 115, top: false, parts: [['q1', 'std:e_plc_out', 'Q0.1', { sym: 'Y_PressUp' }], ['y2', 'std:e_sol', '1Y2']] },
    { x: 170, bot: false, parts: [['s1', 'std:e_pb_no', '1S1', { func: 'Two-hand start' }], ['i0', 'std:e_plc_in', 'I0.0', { sym: 'B_Start' }]] },
    { x: 215, bot: false, parts: [['b1', 'std:e_limit', '1B1', { watch: '1A1', wend: 'Extended (+)' }], ['i1', 'std:e_plc_in', 'I0.1', { sym: 'B_PressDown' }]] },
    { x: 260, bot: false, parts: [['b2', 'std:e_limit', '1B2', { watch: '1A1', wend: 'Retracted (−)' }], ['i2', 'std:e_plc_in', 'I0.2', { sym: 'B_PressUp' }]] }] },
  s_sequence: { texts: [[30, 22, 'Sequence A+ B+ A− B− — PLC I/O wiring']], rungs: [
    ...(['1Y1', '1Y2', '2Y1', '2Y2'] as const).map((y, i) => ({ x: 50 + i * 40, top: false, parts: [['q' + i, 'std:e_plc_out', `Q0.${i}`, { sym: ['Y_A_plus', 'Y_A_minus', 'Y_B_plus', 'Y_B_minus'][i] }], ['y' + i, 'std:e_sol', y]] as EP[] })),
    { x: 220, bot: false, parts: [['s1', 'std:e_pb_no', '1S1', { func: 'Start' }], ['i0', 'std:e_plc_in', 'I0.0', { sym: 'B_Start' }]] },
    ...([['1A1', 'Retracted (−)'], ['1A1', 'Extended (+)'], ['2A1', 'Retracted (−)'], ['2A1', 'Extended (+)']] as const).map(([c, e], i) => ({ x: 255 + i * 35, bot: false, parts: [['b' + i, 'std:e_limit', `${c[0]}B${e.startsWith('R') ? 1 : 2}`, { watch: c, wend: e }], ['i' + (i + 1), 'std:e_plc_in', `I0.${i + 1}`, { sym: `B_${c[0] === '1' ? 'A' : 'B'}${e.startsWith('R') ? 'minus' : 'plus'}` }]] as EP[] }))] },
  s_dol: { texts: [[30, 22, 'Pump motor starter, direct on line']], rungs: [
    { x: 80, parts: [['es', 'std:e_estop', '1S1', { func: 'Emergency stop' }], ['st', 'std:e_pb_nc', '1S2', { func: 'Stop' }], ['on', 'std:e_pb_no', '1S3', { func: 'Start' }], ['ol', 'std:e_overload_nc', '1F1'], ['k1', 'std:e_coil', '1K1']], seal: { over: [2, 2], part: ['k1s', 'std:e_no', '1K1'], dx: 22 } },
    { x: 150, parts: [['k1h', 'std:e_no', '1K1'], ['h1', 'std:e_lamp', '1H1', { colour: 'Green' }]] }],
    power: [{ label: 'L1', x: 230, parts: [['q1', 'std:e_mpcb', '1Q1', { i: 12 }], ['k1m', 'std:e_main_no', '1K1'], ['f1', 'std:e_overload', '1F1', { i: 11 }], ['m1', 'std:e_motor3', '1M1', { p: 5.5 }]] }] },
  s_interlock: { texts: [[30, 22, 'Forward / reverse interlock']], rungs: [
    { x: 80, parts: [['es', 'std:e_estop', '1S1', { func: 'Emergency stop' }], ['f', 'std:e_pb_no', '1S2', { func: 'Forward' }], ['i2', 'std:e_nc', '1K2'], ['k1', 'std:e_coil', '1K1']] },
    { x: 150, parts: [['r', 'std:e_pb_no', '1S3', { func: 'Reverse' }], ['i1', 'std:e_nc', '1K1'], ['k2', 'std:e_coil', '1K2']] }] }
};
function elecSample(sid: string): Partial<Sheet> | null {
  const d = EDEFS[sid]; if (!d) return null; const comps: Comp[] = [], pipes: Pipe[] = [], juncs: { id: string; x: number; y: number }[] = [];
  const add = ([k, ref, tag, values]: EP, x: number, y: number) => { const c: Comp = { id: uid('c'), ref, tag, x, y, rot: 0, mirror: false, values: { ...defaults(geomOf(ref)), ...(values || {}) }, ...(geomOf(ref).cls === 'earth' ? { labelPos: 'hidden' as const } : {}) }; void k; comps.push(c); return c; };
  const ends = (c: Comp) => { const g = geomOf(c.ref); const ws = g.ports.map(q => ({ q, w: portWorld(c, q) })).sort((a, b) => a.w.y - b.w.y); return { top: ws[0], bot: ws[ws.length - 1], all: ws }; };
  const wire = (a: { e: End; pt: number[] }, b: { e: End; pt: number[] }, kind: Pipe['kind'] = 'wire') => { const mids = Math.abs(a.pt[0] - b.pt[0]) > 0.01 && Math.abs(a.pt[1] - b.pt[1]) > 0.01 ? [[b.pt[0], a.pt[1]]] : []; pipes.push({ id: uid('p'), kind, a: a.e, b: b.e, pts: simplify([a.pt, ...mids, b.pt]) }); };
  const pin = (c: Comp, w: { q: any; w: any }) => ({ e: { c: c.id, p: w.q.key } as End, pt: [w.w.x, w.w.y] });
  const junc = (x: number, y: number) => { const j = { id: uid('j'), x, y }; juncs.push(j); return { e: { j: j.id } as End, pt: [x, y] }; };
  const rail: Record<'t' | 'b', { e: End; pt: number[] }[]> = { t: [], b: [] };
  d.rungs.forEach(r => { const n = r.parts.length, sp = Math.min(34, (RB - RT - 20) / n); const cs = r.parts.map((q, i) => add(q, r.x, RT + 14 + sp * i + sp / 2));
    for (let i = 0; i < n - 1; i++) { const up = ends(cs[i]).bot, dn = ends(cs[i + 1]).top;
      const seal = r.seal && i === r.seal.over[0] - 1 ? r.seal : null; const sealEnd = r.seal && i === r.seal.over[1] ? r.seal : null; void sealEnd;
      if (seal) { const ja = junc(r.x, (up.w.y + dn.w.y) / 2); wire(pin(cs[i], up), ja); wire(ja, pin(cs[i + 1], dn)); (r as any)._ja = ja; }
      else if (r.seal && i === r.seal.over[1]) { const jb = junc(r.x, (up.w.y + dn.w.y) / 2); wire(pin(cs[i], up), jb); wire(jb, pin(cs[i + 1], dn)); (r as any)._jb = jb; }
      else wire(pin(cs[i], up), pin(cs[i + 1], dn)); }
    if (r.seal && (r as any)._ja && (r as any)._jb) { const sx = r.x + (r.seal.dx || 20); const ja = (r as any)._ja, jb = (r as any)._jb; const c = add(r.seal.part, sx, (ja.pt[1] + jb.pt[1]) / 2); const e2 = ends(c); wire(ja, pin(c, e2.top)); wire(pin(c, e2.bot), jb); }
    if (r.top !== false) { const t = ends(cs[0]).top; const j = junc(r.x, RT); rail.t.push(j); wire(j, pin(cs[0], t)); }
    if (r.bot !== false) { const b = ends(cs[n - 1]).bot; const j = junc(r.x, RB); rail.b.push(j); wire(pin(cs[n - 1], b), j); } });
  ([['t', '+24V', RT], ['b', '0V', RB]] as const).forEach(([k, nm, y]) => { const js = rail[k].sort((a, b) => a.pt[0] - b.pt[0]); if (!js.length) return; const lab = add(['l' + k, 'std:e_label', nm], 30, y); const lw = ends(lab).all[0];
    wire(pin(lab, lw), js[0]); for (let i = 1; i < js.length; i++) wire(js[i - 1], js[i]); });
  (d.power || []).forEach(pw => { const lab = add(['lp', 'std:e_label', pw.label], pw.x - 18, RT); const cs = pw.parts.map((q, i) => add(q, pw.x, RT + 26 + i * 40));
    wire(pin(lab, ends(lab).all[0]), pin(cs[0], ends(cs[0]).top), 'power'); for (let i = 0; i < cs.length - 1; i++) { const e1 = ends(cs[i]).bot, e2 = ends(cs[i + 1]); const tgt = e2.all.length > 2 ? e2.all.slice().sort((a, b) => Math.abs(a.w.x - cs[i + 1].x) - Math.abs(b.w.x - cs[i + 1].x))[0] : e2.top; wire(pin(cs[i], e1), pin(cs[i + 1], tgt), 'power'); } });
  // junctions where only two wires meet become plain bends
  return { components: comps, pipes, junctions: juncs, texts: (d.texts || []).map(([x, y, s]) => ({ id: uid('t'), x, y, s, h: 3.5 })), enclosures: [], scale: 1, size: 'A3', circuitNo: 1, designerVersion: 1 };
}

export function sampleCircuit(sid: string, type: string): Partial<Sheet> | null {
  if (type === 'electric') return elecSample(sid);
  const d0 = DEFS[sid]; if (!d0) return null; const dx = d0.shift || 0;
  const d: Def = { ...d0, parts: d0.parts.map(q => { const r = q.slice() as P; r[2] += dx; return r; }), junctions: Object.fromEntries(Object.entries(d0.junctions || {}).map(([k, v]) => [k, [v[0] + dx, v[1]] as [number, number]])), lines: d0.lines.map(([a, b, mids, kind]) => [a, b, (mids || []).map(m => [m[0] + dx, m[1]]), kind] as L), enclosures: (d0.enclosures || []).map(e => [e[0] + dx, e[1], e[2], e[3], e[4]] as [number, number, number, number, string]), texts: (d0.texts || []).map(t => [t[0] + dx, t[1], t[2]] as [number, number, string]) };
  if ((sid === 's_pneu_recip') !== (type === 'pneumatic')) return null;
  const ids: Record<string, string> = {}; const comps: Comp[] = [];
  d.parts.forEach(([k, ref, x, y, rot = 0, mirror = false, tag = '', values, label]) => { const id = uid('c'); ids[k] = id; comps.push({ id, ref, tag, x, y, rot, mirror, values: { ...defaults(geomOf(ref)), ...(values || {}) }, ...(label ? { labelPos: label } : {}) }); });
  const juncs = Object.entries(d.junctions || {}).map(([n, [x, y]]) => { const id = uid('j'); ids[n] = id; return { id, x, y }; });
  const at = (s: string): { e: End; pt: number[] } => {
    if (/^J\d+$/.test(s)) { const j = juncs.find(q => q.id === ids[s])!; return { e: { j: j.id }, pt: [j.x, j.y] }; }
    const [k, port] = s.split('.'); const c = comps.find(q => q.id === ids[k])!; const g = geomOf(c.ref); const p = g.ports.find(q => q.key === port || q.name === port)!;
    const w = portWorld(c, p); return { e: { c: c.id, p: p.key }, pt: [w.x, w.y] };
  };
  const pipes: Pipe[] = d.lines.map(([a, b, mids = [], kind = 'work']) => { const A = at(a), B = at(b); const size = type === 'pneumatic' ? undefined : [a, b].some(x => /\.S$/.test(x)) ? '25 mm' : kind === 'work' ? '16 mm' : undefined; return { id: uid('p'), kind, a: A.e, b: B.e, pts: simplify([A.pt, ...mids, B.pt]), ...(size ? { size } : {}) }; });
  return { components: comps, pipes, junctions: juncs, texts: (d.texts || []).map(([x, y, s]) => ({ id: uid('t'), x, y, s, h: 3 })), enclosures: (d.enclosures || []).map(([x, y, w, h, label]) => ({ id: uid('e'), x, y, w, h, label })), scale: 1, size: 'A3', circuitNo: 1, designerVersion: 1 };
}
