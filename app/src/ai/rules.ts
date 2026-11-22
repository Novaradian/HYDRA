// Question templates (the follow-up form the AI starts from) and HYDRA's own mandatory-part rules. The rules are
// HYDRA's, not the AI's: a relief valve on every pump, a tank on every hydraulic circuit, and on lifts a rupture valve,
// a check valve and manual lowering. Symbols come from the library only; a required part with no library symbol is
// listed (locked) with a note and is not drawn.
import type { Question, BomRow } from './session';

const num = (id: string, label: string, value: number, unit?: string, decide = false): Question => ({ id, label, type: 'number', value, ...(unit ? { unit } : {}), ...(decide ? { decide } : {}) });
const sel = (id: string, label: string, options: string[], value = options[0], decide = false): Question => ({ id, label, type: 'select', options, value, ...(decide ? { decide } : {}) });
const rad = (id: string, label: string, options: string[], value = options[0]): Question => ({ id, label, type: 'radio', options, value });
const chk = (id: string, label: string, value = true): Question => ({ id, label, type: 'check', value });
const motor = () => sel('motor', 'Motor', ['2.2 kW', '4 kW', '5.5 kW', '7.5 kW', '11 kW', '15 kW', '22 kW'], '5.5 kW', true);
const oil = () => sel('oil', 'Oil grade', ['HLP VG 32', 'HLP VG 46', 'HVLP VG 32', 'HVLP VG 46', 'HFDU 46 (fire resistant)'], 'HLP VG 46', true);

export const TEMPLATES: Record<string, { title: string; questions: Question[] }> = {
  lift: { title: 'Hydraulic lift', questions: [num('load', 'Rated load', 450, 'kg'), num('persons', 'Persons', 6), num('travel', 'Travel', 3, 'm'), num('speed', 'Speed', 0.3, 'm/s'), num('starts', 'Starts per hour', 20),
    motor(), sel('pump', 'Pump type', ['Screw pump', 'Gear pump', 'Piston pump'], 'Screw pump', true), { ...oil(), value: 'HVLP VG 32' }, num('tmin', 'Min. oil temperature', -20, '°C'), num('tmax', 'Max. oil temperature', 40, '°C'),
    rad('standard', 'Safety standard', ['EN 81-20', 'ASME A17.1', 'Basic']), chk('rupture', 'Rupture valve'), chk('lowering', 'Manual lowering')] },
  press: { title: 'Hydraulic press', questions: [num('force', 'Press force', 400, 'kN'), num('stroke', 'Stroke', 300, 'mm'), num('vfast', 'Approach speed', 100, 'mm/s'), num('vpress', 'Pressing speed', 10, 'mm/s'), num('dwell', 'Dwell at force', 2, 's'),
    num('pressure', 'System pressure', 250, 'bar', true), motor(), rad('control', 'Force control', ['Relief valve', 'Proportional relief']), chk('twohand', 'Two-hand start'), oil()] },
  clamping: { title: 'Clamping circuit', questions: [num('force', 'Clamp force', 20, 'kN'), num('stroke', 'Stroke', 50, 'mm'), num('clamps', 'Number of clamps', 1), num('pressure', 'Clamp pressure', 120, 'bar', true),
    rad('sequence', 'Sequence', ['Clamp, then work', 'Independent']), chk('pswitch', 'Pressure switch (clamped)'), chk('accu', 'Accumulator to hold pressure', false), motor()] },
  power_pack: { title: 'Hydraulic power unit', questions: [num('flow', 'Flow', 30, 'L/min'), num('pressure', 'Max. pressure', 160, 'bar'), motor(), num('tank', 'Tank', 100, 'L', true),
    rad('filter', 'Filtration', ['Return filter', 'Pressure filter', 'Both']), chk('cooler', 'Oil cooler', false), chk('accu', 'Accumulator', false), oil()] },
  cylinder: { title: 'Cylinder motion', questions: [num('force', 'Force', 10, 'kN'), num('stroke', 'Stroke', 200, 'mm'), num('speed', 'Speed', 100, 'mm/s'),
    rad('centre', 'Valve centre', ['Closed centre', 'Tandem centre', 'Float centre']), rad('speedctl', 'Speed control', ['None', 'Meter-out', 'Meter-in']), num('pressure', 'Pressure', 120, 'bar', true)] },
  motor_drive: { title: 'Hydraulic motor drive', questions: [num('torque', 'Torque', 200, 'N·m'), num('rpm', 'Speed', 300, 'rpm'), rad('dir', 'Direction', ['One direction', 'Both directions']), chk('brake', 'Brake / counterbalance valve'), num('pressure', 'Pressure', 160, 'bar', true)] },
  pneumatic: { title: 'Pneumatic circuit', questions: [num('cyls', 'Cylinders', 2), num('pressure', 'Supply pressure', 6, 'bar'), rad('valves', 'Valves', ['5/2 solenoid, spring return', '5/2 double solenoid']), chk('frl', 'Air service unit (FRL)'), chk('speed', 'Exhaust flow controls')] },
};
export const TEMPLATE_NAMES = Object.keys(TEMPLATES);
export function questionTemplate(type: string) {
  const k = String(type || '').toLowerCase().replace(/[\s-]+/g, '_').replace(/power_?unit|hpu/, 'power_pack').replace(/elevator/, 'lift').replace(/clamp(ing)?/, 'clamping');
  const t = TEMPLATES[k]; return t ? { circuit_type: k, ...t } : { circuit_type: 'generic', title: 'Circuit', questions: [num('pressure', 'Pressure', 120, 'bar', true), num('flow', 'Flow', 20, 'L/min', true), num('actuators', 'Actuators', 1)], available: TEMPLATE_NAMES };
}

// ---------- mandatory parts ----------
const low = (r: BomRow & { ref?: string }) => `${r.part} ${r.ref || ''}`.toLowerCase();
const has = (rows: any[], re: RegExp) => rows.some(r => re.test(low(r)));
function nextTag(rows: any[], circuit: string, letter: string) { let n = 1; while (rows.some(r => r.tag === `${circuit}${letter}${n}`)) n++; return `${circuit}${letter}${n}`; }
export type Row = BomRow & { ref?: string; note?: string };
/** adds HYDRA's required parts (locked) to an AI parts list; returns the full list and what was added */
export function withMandatory(rows: Row[], circuitType = '', pressure?: string): { rows: Row[]; added: string[] } {
  const out: Row[] = rows.map(r => ({ ...r })); const added: string[] = [];
  const cn = (out.find(r => /^\d+[A-Z]\d+$/.test(r.tag))?.tag.match(/^\d+/)?.[0]) || '1';
  const add = (part: string, ref: string | undefined, rating: string, letter: string, note?: string) => { const tag = nextTag(out, cn, letter); out.push({ tag, part, ref, rating, locked: true, ...(note ? { note } : {}) }); added.push(`${tag} ${part}`); };
  const hydraulic = !/pneumatic/.test(circuitType) && !has(out, /compressor|pneumatic|^p_|\bp_/);
  const pumps = out.filter(r => /pump/.test(low(r)) && !/hand pump|motor\b(?!.*pump)/.test(low(r)));
  const compensated = pumps.length > 0 && pumps.every(r => /pressure.compensated|h_pump_pc|h_pump_var_ctrl/.test(low(r)));
  if (hydraulic && pumps.length && !compensated && !has(out, /relief|safety valve/)) add('Pressure-relief valve', 'std:h_relief', pressure ? `set ${pressure}` : 'set = system pressure', 'V');
  if (hydraulic && (pumps.length || out.length) && !has(out, /tank|reservoir/)) add('Reservoir (tank)', 'std:h_tank', '—', 'Z');
  if (/lift|elevator/.test(circuitType) || has(out, /\blift\b|elevator|lift car/)) {
    if (!has(out, /rupture|pipe.?break/)) add('Rupture valve (pipe-break valve)', undefined, 'at the cylinder port', 'V', 'No library symbol — draw it with the Valve Creator, then place it at the cylinder port');
    if (!has(out, /check|non-return/)) add('Non-return (check) valve', 'std:h_check', 'on the pump line', 'V');
    if (!has(out, /manual lowering|emergency lowering|shut-?off/)) add('Manual lowering valve (shut-off, manual)', 'std:h_shutoff', 'cylinder line → tank', 'V');
  }
  return { rows: out, added };
}
