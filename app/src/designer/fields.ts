// Per-instance values (ISO data stays in the library; pressures, flows, sizes and loads live on the placed instance).
// Numbers are stored in SI base units (Pa, m, kg, m³, N, …) so the simulation can read them without conversion.
import type { Geom } from './geom';
import { toBase, type Qty } from '../units';
import { posLetters, valvePositions, valveRest } from './geom';

export type Field = { key: string; label: string; qty: Qty | 'select' | 'text' | 'table'; def: any; options?: string[]; min?: number; max?: number; sim?: boolean; hint?: string; unit?: string; cols?: [string, string, number, number][]; when?: (v: any) => boolean };
// table field: rows of [x, y] in SI base; cols = [label, unit, factor to base x, factor to base y]
const tbl = (key: string, label: string, cols: [string, string, number, number][], def: number[][], when?: (v: any) => boolean): Field => ({ key, label, qty: 'table', def, cols, sim: true, when });
const W = (f: Field, when: (v: any) => boolean): Field => ({ ...f, when });
const S_ = (f: Field, hint = ''): Field => ({ ...f, sim: true, hint });
const num = (key: string, label: string, qty: Qty, v: number, unit: string, min = 0, max?: number): Field => ({ key, label, qty, def: toBase(qty, unit, v), min: min == null ? undefined : toBase(qty, unit, min), max: max == null ? undefined : toBase(qty, unit, max) });
const sel = (key: string, label: string, options: string[], def = options[0]): Field => ({ key, label, qty: 'select', def, options });
const txt = (key: string, label: string, def = ''): Field => ({ key, label, qty: 'text', def });
const specT = (g: Geom, k: string) => { const s = g.specs.find((x: any) => x.key === k); return s && typeof s.value === 'string' ? s.value : ''; };
const spec = (g: Geom, k: string, d: number) => { const s = g.specs.find((x: any) => x.key === k); return typeof s?.value === 'number' ? s.value : d; };

// Values the library carries (displacement, speed, bore, stroke, volumes, power, angles, vacuum …) are the defaults of
// the placed part; pressures and flows are set per instance. Fields marked sim (S_) are the simulation data of the part.
const nn = (key: string, label: string, v: number, unit: string, min = 0, max?: number): Field => ({ key, label, qty: 'none', def: v, min, max, unit });
// the load an actuator works against (positive = against extension / forward rotation), gravity comes on top
function loadFields(F: number, qty: Qty, u: string, xl: string, xu: string, xf: number): Field[] {
  const m = (x: string) => (v: any) => (v?.lmode || 'Constant') === x;
  return [S_(sel('lmode', 'Load profile', ['Constant', 'Spring', 'Versus position', 'Versus time'])),
    W(S_(num('fext', qty === 'force' ? 'Load force (against extension)' : 'Load torque', qty, qty === 'torque' ? F : 0, u, -1e7)), m('Constant')),
    W(S_(num('lF0', 'Spring preload', qty, 0, u, -1e7)), m('Spring')), W(S_(nn('lk', 'Spring rate', qty === 'force' ? 50 : 1, qty === 'force' ? 'N/mm' : 'N·m/°')), m('Spring')),
    tbl('ltab', 'Load versus ' + xl.toLowerCase(), [[xl, xu, xf, 1], [qty === 'force' ? 'Force' : 'Torque', u, 1, 1]], [[0, 0], [xf === 1 ? 90 : 0.2, 0], [xf === 1 ? 180 : 0.3, F]], m('Versus position')),
    tbl('ltabt', 'Load versus time', [['Time', 's', 1, 1], [qty === 'force' ? 'Force' : 'Torque', u, 1, 1]], [[0, 0], [2, F], [4, 0]], m('Versus time'))];
}
// rated (max. operating) pressure of the part: the simulation flags it when exceeded
const RATED: Record<string, number> = { valve: 315, pressure: 315, check: 315, flow: 315, shutoff: 315, cartridge: 350, pump: 280, pumpmotor: 280, motor: 250, cylinder: 160, rotary: 160, accumulator: 330, filter: 210, cooler: 16, heater: 16, connection: 250, intensifier: 400, charging: 315, compensator: 350, logic: 315 };
export function fieldsFor(g: Geom): Field[] {
  const f = baseFields(g); const pn = g.domain === 'pneumatic'; const r = RATED[g.cls];
  if (r && !(g.cls === 'pump' && pn) && !f.some(x => x.key === 'prated')) f.push(S_(num('prated', 'Max. operating pressure (rated)', 'pressure', pn ? (g.cls === 'cylinder' ? 10 : 16) : g.item?.id?.includes('cyl') && /cush_adj|tele|ram/.test(g.item.id) ? 250 : r, 'bar', 0.1), 'A warning appears when the simulation exceeds it'));
  return f;
}
function baseFields(g: Geom): Field[] {
  const pn = g.domain === 'pneumatic', id = g.item?.id || '';
  if (g.domain === 'electrical') return elecFields(g);
  const flowPair = (q: number, dp: number, qLabel = 'Rated flow', dpLabel = 'Pressure drop at rated flow') => pn ? [S_(num('q', qLabel + ' (Qn)', 'flow', q, 'L/min', 1), 'ISO 6358 standard nominal flow, 6 → 5 bar')] : [S_(num('q', qLabel, 'flow', q, 'L/min', 0.1)), S_(num('dpr', dpLabel, 'pressure', dp, 'bar', 0.01))];
  switch (g.cls) {
    case 'cylinder': {
      const spring = /h_cyl_single$|p_diaphragm|p_bellows|p_cyl_spring_ext|tele_single/.test(id) && !/load/.test(id), ram = id === 'h_ram', cush = /cush/.test(id);
      const bore = ram ? spec(g, 'ram', 80) : spec(g, 'bore', pn ? 32 : id === 'p_diaphragm' ? 60 : id === 'p_bellows' ? 80 : 63);
      return [num('bore', ram ? 'Plunger Ø' : 'Bore Ø', 'length', bore, 'mm', 1), ...(ram || id === 'p_rodless' ? [] : [num('rod', 'Rod Ø', 'length', spec(g, 'rod', pn ? 12 : 36), 'mm', 0)]), num('stroke', 'Stroke', 'length', spec(g, 'stroke', pn ? 100 : 300), 'mm', 1),
        num('angle', 'Mounting angle (90° = rod up)', 'angle', ram ? 90 : 0, '°', -180, 180), num('load', 'Load mass', 'mass', pn ? 10 : 120, 'kg'), num('friction', 'Friction', 'force', pn ? 30 : 400, 'N'), sel('start', 'Start position', ['Retracted', 'Extended']),
        ...loadFields(pn ? 200 : 5000, 'force', 'N', 'Position', 'mm', 0.001),
        ...(cush ? [sel('cushion', 'Cushioning', ['None', 'Cap end', 'Rod end', 'Both ends'], id === 'h_cyl_cush_one' ? 'Cap end' : 'Both ends'), S_(num('cushL', 'Cushion length', 'length', 25, 'mm', 1)), S_(nn('cushB', 'Cushion damping', 2e5, 'N·s/m'))] : []),
        ...(spring ? [S_(num('F0', 'Spring preload', 'force', pn ? 25 : 300, 'N')), S_(nn('ks', 'Spring rate', pn ? 0.4 : 3, 'N/mm'))] : []),
        ...(id === 'h_cyl_lock' ? [S_(num('unlock', 'Lock release pressure (X)', 'pressure', 5, 'bar', 0.1))] : []),
        S_(num('mpist', 'Piston + rod mass', 'mass', pn ? 0.2 : 2, 'kg', 0.01)), S_(nn('vis', 'Viscous damping', pn ? 60 : 2500, 'N·s/m')), S_(num('dead', 'Dead volume per chamber', 'volume', pn ? 0.004 : 0.03, 'L', 0)), S_(num('leakP', 'Piston leakage at 100 bar', 'flow', 0, 'L/min', 0))];
    }
    case 'rotary': return [num('swing', 'Swing angle', 'angle', spec(g, 'angle', 180), '°', 1, 360), ...loadFields(pn ? 5 : 200, 'torque', 'N·m', 'Angle', '°', 1), num('inertia', 'Load mass (at 0.1 m)', 'mass', pn ? 2 : 20, 'kg'),
      S_(num('disp', 'Displacement per 360°', 'displacement', pn ? 38 : 125, 'cm³/rev', 0.1)), S_(num('friction', 'Friction torque', 'torque', pn ? 0.3 : 10, 'N·m')), sel('start', 'Start position', ['Start', 'End'])];
    case 'pump': case 'pumpmotor':
      if (pn) return id === 'p_vacpump' ? [num('q', 'Suction flow', 'flow', 100, 'L/min'), num('pvac', 'Vacuum level', 'pressure', spec(g, 'vac', -0.95), 'bar', -1, 0)]
        : [num('q', 'Free air delivery', 'flow', spec(g, 'fad', 300), 'L/min'), num('pmax', 'Cut-out pressure', 'pressure', 8, 'bar'), S_(num('band', 'Cut-in / cut-out band', 'pressure', 1, 'bar', 0.05))];
      if (id === 'h_double_pump') return [num('vg', 'Displacement P1', 'displacement', spec(g, 'vg1', 25), 'cm³/rev', 0.1), num('vg2', 'Displacement P2', 'displacement', spec(g, 'vg2', 8), 'cm³/rev', 0.1), num('n', 'Drive speed', 'rotation', 1450, 'rpm', 1), num('ev', 'Volumetric efficiency', 'percent', 95, '%', 1, 100), S_(num('em', 'Mechanical efficiency', 'percent', 90, '%', 1, 100)), S_(num('pstall', 'Max. pressure (drive stalls)', 'pressure', 350, 'bar', 1))];
      return [num('vg', id === 'h_hand_pump' ? 'Displacement per stroke' : 'Displacement', 'displacement', spec(g, 'vg', id === 'h_hand_pump' ? 10 : 16), 'cm³/rev', 0.1), num('n', id === 'h_hand_pump' ? 'Strokes per minute' : 'Drive speed', 'rotation', spec(g, 'n', id === 'h_hand_pump' ? 40 : 1450), 'rpm', 1), num('ev', 'Volumetric efficiency', 'percent', spec(g, 'ev', 95), '%', 1, 100),
        ...(/var|pc/.test(id) ? [num('disp', 'Displacement setting', 'percent', 100, '%', 0, 100)] : []), ...(/2dir|var2|pumpmotor/.test(id) ? [sel('dir', 'Delivery direction', ['A out', 'B out'])] : []),
        ...(id === 'h_pump_pc' || id === 'h_pump_var_ctrl' ? [S_(num('pc', 'Compensator setting', 'pressure', 180, 'bar', 1, 700), 'Delivery falls to zero at this pressure'), S_(num('pcb', 'Compensator band', 'pressure', 6, 'bar', 0.5))] : []),
        S_(num('em', 'Mechanical efficiency', 'percent', 90, '%', 1, 100), 'Losses heat the oil'), S_(num('pstall', 'Max. pressure (drive stalls)', 'pressure', 350, 'bar', 1)), ...(id === 'h_pump_drain' ? [S_(num('leak', 'Case drain at 100 bar', 'flow', 0.5, 'L/min', 0))] : [])];
    case 'motor': return pn ? [num('q', 'Air consumption at 6 bar', 'flow', 200, 'L/min'), num('torque', 'Load torque', 'torque', 2, 'N·m'), S_(num('nr', 'Free speed at 6 bar', 'rotation', spec(g, 'n', 6000), 'rpm', 1))]
      : [num('vg', 'Displacement', 'displacement', spec(g, 'vg', 25), 'cm³/rev', 0.1), ...(/var/.test(id) ? [num('disp', 'Displacement setting', 'percent', 100, '%', 1, 100)] : []), num('torque', 'Load torque', 'torque', 50, 'N·m'), num('inertia', 'Load mass (inertia, at 0.1 m)', 'mass', 10, 'kg'),
        S_(num('nmax', 'Max. speed', 'rotation', spec(g, 'nmax', 3000), 'rpm', 1)), S_(num('em', 'Mechanical efficiency', 'percent', 92, '%', 1, 100)), S_(num('ev', 'Volumetric efficiency', 'percent', 96, '%', 1, 100)), ...(/motor_drain/.test(id) ? [S_(num('leak', 'Case drain at 100 bar', 'flow', 0.5, 'L/min', 0))] : [])];
    case 'nozzle': return [sel('trig', id === 'p_spraygun' ? 'Nozzle at start' : 'Trigger at start', id === 'p_spraygun' ? ['Pressed', 'Released'] : ['Released', 'Pressed']), S_(num('q', 'Air consumption (Qn)', 'flow', id === 'p_spraygun' ? 150 : 300, 'L/min', 1), 'ISO 6358 nominal flow of the nozzle')];
    case 'charging': return [num('pon', 'Cut-in pressure (charging starts)', 'pressure', 140, 'bar', 1), num('poff', 'Cut-out pressure (pump unloads)', 'pressure', 160, 'bar', 1), ...flowPair(60, 3)];
    case 'compensator': return [num('dpc', 'Control Δp (spring)', 'pressure', 10, 'bar', 1), ...flowPair(100, 3)];
    case 'drive': return [num('p', 'Rated power', 'power', spec(g, 'p', 5.5), 'kW'), num('n', 'Speed', 'rotation', spec(g, 'n', 1450), 'rpm', 1)];
    case 'intensifier': return [num('ratio', 'Area ratio', 'percent', 400, '%', 100), S_(num('q', 'Rated output flow', 'flow', 3, 'L/min', 0.01))];
    case 'pressure': {
      if (pn) { const reg = id === 'p_regulator' || id === 'p_reg_prop';
        return [num('set', id.includes('relief') ? 'Opening pressure' : id === 'p_softstart' ? 'Full-open pressure' : 'Set pressure', 'pressure', id === 'p_relief' ? 7 : 6, 'bar', 0, 16), ...flowPair(reg ? 2500 : 1500, 1), ...(reg ? [S_(num('band', 'Regulation band', 'pressure', 0.25, 'bar', 0.01))] : [])]; }
      const reduce = /reduc|sequence|counter|brake|unload|overcentre/.exec(id)?.[0];
      return [num('set', reduce === 'reduc' ? 'Reduced pressure' : reduce === 'sequence' ? 'Sequence pressure' : reduce === 'unload' ? 'Unloading pressure' : reduce ? 'Holding pressure' : 'Setting', 'pressure', reduce === 'reduc' ? 80 : reduce ? 120 : 160, 'bar', 0, 700),
        ...flowPair(120, 5, 'Rated flow', 'Override (rise at rated flow)'), ...(/counterbal|overcentre/.test(id) ? [S_(nn('ratio', 'Pilot ratio', 3, ': 1', 0.1))] : []), ...(/vent|solvent/.test(id) ? [S_(num('ventp', 'Vented (unloaded) pressure', 'pressure', 3, 'bar', 0))] : [])];
    }
    case 'flow': {
      const comp = /fcv/.test(id), div = /div/.test(id);
      if (div) return [num('ratio', 'Share to A', 'percent', +(/^(\d+)/.exec(specT(g, 'ratio'))?.[1] || 50), '%', 1, 99), ...flowPair(60, 5), S_(num('acc', 'Dividing accuracy', 'percent', 3, '%', 0, 20))];
      return [num('open', comp ? 'Flow setting (of rated)' : 'Opening', 'percent', 50, '%', 0, 100), ...flowPair(pn ? 100 : 20, 5, 'Rated flow (100 % open)'), ...(comp ? [S_(num('dpc', 'Compensator Δp', 'pressure', 6, 'bar', 0.5))] : []),
        ...(/oneway|check/.test(id) ? [S_(num('qfree', 'Free-flow check: rated flow', 'flow', pn ? 600 : 60, 'L/min', 0.1)), S_(num('crack', 'Check cracking pressure', 'pressure', pn ? 0.1 : 0.3, 'bar'))] : [])];
    }
    case 'check': return [S_(num('crack', 'Cracking pressure', 'pressure', pn ? 0.1 : 0.5, 'bar')), ...flowPair(pn ? 1500 : 60, pn ? 1 : 3), ...(/poc|dpoc/.test(id) ? [S_(nn('ratio', 'Pilot ratio (opening)', 3, ': 1', 0.1))] : [])];
    case 'shutoff': return [sel('state', 'Initial state', ['Open', 'Closed']), ...flowPair(pn ? 3000 : 300, 0.5)];
    case 'cartridge': return [num('set', 'Spring (opening Δp)', 'pressure', 2, 'bar'), S_(nn('area', 'Area ratio A : X', 1, ': 1', 0.1)), ...flowPair(200, 3)];
    case 'filter': return [txt('rating', 'Filter rating', specT(g, 'beta') || specT(g, 'grade') || specT(g, 'mesh') || (pn ? '40 µm' : '10 µm')), num('dp', /bypass/.test(id) ? 'Bypass opening Δp' : 'Clogging indicator Δp', 'pressure', pn ? 0.5 : 3, 'bar'),
      ...flowPair(pn ? 1500 : 100, pn ? 0.1 : 0.5, 'Rated flow', 'Clean Δp at rated flow'), S_(num('clog', 'Clogging (raises Δp)', 'percent', 0, '%', 0, 99))];
    case 'accumulator': return [num('vol', 'Volume', 'volume', spec(g, 'v', 4), 'L', 0.01), num('pre', id === 'h_accu_spring' || id === 'h_accu_weight' ? 'Opening pressure' : 'Gas pre-charge', 'pressure', 90, 'bar'),
      ...(id === 'h_accu_spring' || id === 'h_accu_weight' ? [S_(num('pfull', 'Pressure when full', 'pressure', id === 'h_accu_weight' ? 90 : 130, 'bar'))] : [S_(sel('poly', 'Gas compression', ['Adiabatic (n = 1.4)', 'Isothermal (n = 1.0)']))]), sel('init', 'Start charged', ['Empty', 'Pre-charged only', 'Full'])];
    case 'tank': return [num('vol', 'Volume', 'volume', spec(g, 'v', 100), 'L', 0.1), num('temp', 'Oil temperature at start', 'temperature', 40, '°C', -40, 150), ...(id === 'h_tank_press' ? [num('pt', 'Tank pressure', 'pressure', 0.5, 'bar', 0, 10)] : []),
      S_(num('tamb', 'Ambient temperature', 'temperature', 25, '°C', -40, 60)), S_(nn('kth', 'Heat loss to ambient', 15, 'W/K', 0))];
    case 'gauge':
      if (/thermo/.test(id)) return [num('range', 'Range (max)', 'temperature', 120, '°C')];
      if (/flow/.test(id)) return [num('range', 'Range (max)', 'flow', 60, 'L/min'), ...flowPair(100, 0.3)];
      if (/level/.test(id)) return [txt('range', 'Range', '0–100 %')];
      if (/tacho/.test(id)) return [num('range', 'Range (max)', 'rotation', 3000, 'rpm')];
      return [num('range', 'Range (max)', 'pressure', pn ? 16 : 250, 'bar'), S_(num('damp', 'Needle damping', 'time', 0.1, 's', 0))];
    case 'switch': case 'sensor':
      if (/temp/.test(id)) return [num('set', 'Switch point', 'temperature', spec(g, 'set', 60), '°C'), S_(num('hyst', 'Hysteresis', 'percent', 5, '%', 0, 50))];
      if (/level|contam|pe_/.test(id) && !/pe_/.test(id)) return [txt('set', 'Switch point', '')];
      if (/vac/.test(id)) return [num('set', 'Switch point', 'pressure', spec(g, 'set', -0.6), 'bar', -1, 0), S_(num('hyst', 'Hysteresis', 'percent', 5, '%', 0, 50))];
      if (id === 'h_ptransducer') return [num('range', 'Range (max)', 'pressure', 250, 'bar'), txt('out', 'Output', '4–20 mA')];
      return [num('set', 'Switch point', 'pressure', pn ? 4 : 100, 'bar', -1), sel('contact', 'Contact', ['NO', 'NC', 'Changeover']), S_(num('hyst', 'Hysteresis', 'percent', 5, '%', 0, 50))];
    case 'cooler': return [num('p', 'Cooling power (at 40 K)', 'power', spec(g, 'q', 3), 'kW'), num('tset', 'Thermostat (opens above)', 'temperature', 45, '°C', -40, 150), ...flowPair(60, 1)];
    case 'heater': return [num('p', 'Heating power', 'power', spec(g, 'p', 2), 'kW'), num('tset', 'Thermostat (heats below)', 'temperature', spec(g, 't', 35), '°C', -40, 150), ...(id === 'h_tempctrl' ? flowPair(60, 0.5) : [])];
    case 'source': return [num('p', 'Supply pressure', 'pressure', 6, 'bar', 0, 40), S_(num('q', 'Supply capacity', 'flow', 5000, 'L/min', 1))];
    case 'receiver': return [num('vol', 'Volume', 'volume', spec(g, 'v', 50), 'L', 0.1), num('pmax', 'Max. pressure', 'pressure', 11, 'bar'), ...flowPair(6000, 1)];
    case 'frl': return [num('set', 'Regulated pressure', 'pressure', 6, 'bar', 0, 16), txt('rating', 'Filter rating', '40 µm'), ...flowPair(2500, 1), S_(num('band', 'Regulation band', 'pressure', 0.25, 'bar', 0.01))];
    case 'dryer': return [num('dew', 'Pressure dew point', 'temperature', spec(g, 'dew', 3), '°C', -70, 20), ...flowPair(2000, 0.2)];
    case 'lubricator': return [...flowPair(2000, 0.2)];
    case 'silencer': case 'exhaust': return [...flowPair(id === 'p_silencer_thr' ? 600 : 2000, 1, 'Exhaust capacity')];
    case 'logic': return id === 'h_shuttle' ? [...flowPair(60, 3)] : id === 'p_timer' ? [num('delay', 'Delay', 'time', 2, 's'), ...flowPair(400, 1)] : id === 'p_quickexh' ? [...flowPair(800, 1, 'Supply flow 1 → 2'), S_(num('qx', 'Exhaust capacity 2 → 3', 'flow', 1500, 'L/min'))] : [...flowPair(400, 1)];
    case 'vacuum': return id === 'p_ejector' ? [num('pvac', 'Max. vacuum', 'pressure', spec(g, 'vac', -0.85), 'bar', -1, 0), S_(num('q', 'Air consumption at 6 bar', 'flow', 150, 'L/min')), S_(num('qv', 'Suction flow', 'flow', 80, 'L/min'))]
      : id === 'p_suction_cup' ? [num('d', 'Cup Ø', 'length', spec(g, 'd', 40), 'mm', 1), num('load', 'Load mass', 'mass', 1, 'kg'), S_(num('vol', 'Cup volume', 'volume', 0.02, 'L', 0)), S_(nn('sf', 'Safety factor', 2, '×', 1))] : [];
    case 'connection': return /qc_conn|hose|rotary_joint/.test(id) ? [txt('size', 'Size / thread', ''), ...flowPair(pn ? 2000 : 150, 0.5)] : [txt('size', 'Size / thread', '')];
    case 'valve': {
      const d = g.valve; if (!d) return [];
      const n = valvePositions(d), L = posLetters(n), rest = valveRest(d);
      const pn2 = g.domain === 'pneumatic'; const sol = [...d.ops.left, ...d.ops.right].some((o: any) => ['solenoid', 'proportional', 'servo'].includes(o.type)); const cam = [...d.ops.left, ...d.ops.right].some((o: any) => o.type === 'manual' && /roller|plunger/.test(o.kind || ''));
      return [txt('size', 'Nominal size', d.nominalSize || ''), sel('start', 'Start position', L.map((x, i) => i === rest ? `${x} (normal)` : x), `${L[rest]} (normal)`),
        S_(sel('preset', 'Datasheet preset', pn2 ? ['Custom', 'G1/8 · 500 Nl/min', 'G1/4 · 1200 Nl/min', 'G3/8 · 2000 Nl/min', 'G1/2 · 3500 Nl/min'] : ['Custom', 'NG6 / CETOP 03 · 60 L/min', 'NG10 / CETOP 05 · 120 L/min', 'NG16 / CETOP 07 · 300 L/min', 'NG25 / CETOP 08 · 650 L/min']), 'Fills rated flow, pressure drop, response and leakage'),
        S_(num('q', pn2 ? 'Nominal flow Qn (6 → 5 bar)' : 'Rated flow (Kv point)', 'flow', pn2 ? 800 : 40, 'L/min'), pn2 ? 'ISO 6358 standard nominal flow' : 'Flow at the rated pressure drop, per path'),
        ...(pn2 ? [] : [S_(num('dp', 'Pressure drop at rated flow', 'pressure', 5, 'bar', 0.1))]),
        S_(num('resp', 'Response time (switching)', 'time', pn2 ? 15 : 30, 'ms', 0)),
        S_(sel('overlap', 'Spool overlap in transition', ['Zero', 'Positive', 'Negative']), 'Positive: all ports blocked while switching · Negative: briefly all connected'),
        ...(pn2 ? [] : [S_(num('leak', 'Internal leakage at 100 bar', 'flow', 0.05, 'L/min', 0))]),
        ...(sol ? [S_(sel('coil', 'Coil voltage', ['24 V DC', '12 V DC', '110 V AC', '230 V AC'])), S_(num('coilW', 'Coil power', 'power', pn2 ? 2.5 : 30, 'W', 0))] : []),
        ...(['a', 'b'] as const).filter(sd => (sd === 'a' ? d.ops.left : d.ops.right).some((o: any) => ['solenoid', 'proportional', 'servo'].includes(o.type))).map(sd => ({ ...txt('y' + sd, `Solenoid ${sd} tag (electric sheet)`), hint: 'The coil with this tag on an electric sheet is this solenoid, e.g. 1Y1' })),
        ...(cam ? [S_(txt('cam', 'Actuated by (cam)', ''), 'Cylinder tag and end, e.g. 1A1+ (extended) or 1A1− (retracted)')] : [])];
    }
  }
  return [];
}
// electrical parts: drawing data only (electric circuits are documented, not simulated); links to the machine go through tags
function elecFields(g: Geom): Field[] {
  const id = g.item?.id || ''; const U = ['24 V DC', '12 V DC', '48 V DC', '110 V AC', '230 V AC', '400 V AC'];
  if (g.cls === 'coil') return [sel('u', 'Coil voltage', U), ...(id === 'e_coil_ton' || id === 'e_coil_tof' ? [num('delay', id === 'e_coil_ton' ? 'On-delay' : 'Off-delay', 'time', 2, 's', 0)] : [])];
  if (['e_limit', 'e_limit_nc', 'e_prox', 'e_reed', 'e_cap_sensor', 'e_photo'].includes(id)) return [txt('watch', 'Watches cylinder (tag)'), sel('wend', 'Switches at', ['Extended (+)', 'Retracted (−)', 'At position']), W(num('wpos', 'Position from retracted', 'length', 50, 'mm', 0), v => String(v?.wend || '').startsWith('At')), ...(id === 'e_prox' || id === 'e_cap_sensor' || id === 'e_photo' ? [sel('out', 'Output', ['PNP, NO', 'PNP, NC', 'NPN, NO', 'NPN, NC'])] : [])];
  if (g.cls === 'pushbutton' || g.cls === 'switch') return [txt('func', 'Function', ''), ...(g.cls === 'pushbutton' ? [sel('colour', 'Colour', id === 'e_estop' ? ['Red'] : id === 'e_pb_nc' ? ['Red', 'Black'] : ['Green', 'Black', 'White', 'Yellow', 'Blue'])] : [])];
  if (g.cls === 'lamp') return [sel('colour', 'Colour', ['Green', 'Red', 'Yellow', 'White', 'Blue']), sel('u', 'Voltage', U)];
  if (g.cls === 'motor') return [num('p', 'Rated power', 'power', spec(g, 'p', 5.5), 'kW', 0), sel('u', 'Voltage', id === 'e_motor_dc' ? ['24 V DC', '48 V DC'] : ['400 V AC', '230 V AC', '690 V AC']), num('i', 'Rated current', 'current', 11, 'A', 0)];
  if (g.cls === 'fuse' || g.cls === 'breaker' || g.cls === 'overload') return [num('i', g.cls === 'overload' ? 'Setting' : 'Rated current', 'current', spec(g, 'i', g.cls === 'fuse' ? 4 : 10), 'A', 0), ...(id === 'e_mcb' ? [sel('char', 'Characteristic', ['C', 'B', 'D'])] : [])];
  if (g.cls === 'supply') return [sel('u', 'Voltage', id === 'e_ac' ? ['230 V AC', '400 V AC', '110 V AC'] : ['24 V DC', '12 V DC', '48 V DC'])];
  if (id === 'e_terminal') return [txt('tno', 'Terminal number', '1'), txt('xsec', 'Wire cross-section', '0.75 mm²')];
  if (g.cls === 'plc') return [txt('sym', 'Symbol (name in the PLC program)', '')];
  return [];
}
export const defaults = (g: Geom) => Object.fromEntries(fieldsFor(g).map(f => [f.key, Array.isArray(f.def) ? f.def.map((r: any) => [...r]) : f.def]));

// datasheet presets for directional valves (generic sizes, ISO 4401 / ISO 15407 interfaces)
export const VALVE_PRESETS: Record<string, Record<string, number>> = {
  'NG6 / CETOP 03 · 60 L/min': { q: 60 / 60000, dp: 6e5, resp: 0.03, leak: 0.05 / 60000 }, 'NG10 / CETOP 05 · 120 L/min': { q: 120 / 60000, dp: 6e5, resp: 0.045, leak: 0.1 / 60000 },
  'NG16 / CETOP 07 · 300 L/min': { q: 300 / 60000, dp: 7e5, resp: 0.07, leak: 0.25 / 60000 }, 'NG25 / CETOP 08 · 650 L/min': { q: 650 / 60000, dp: 8e5, resp: 0.1, leak: 0.5 / 60000 },
  'G1/8 · 500 Nl/min': { q: 500 / 60000, resp: 0.012 }, 'G1/4 · 1200 Nl/min': { q: 1200 / 60000, resp: 0.018 }, 'G3/8 · 2000 Nl/min': { q: 2000 / 60000, resp: 0.025 }, 'G1/2 · 3500 Nl/min': { q: 3500 / 60000, resp: 0.035 }
};
