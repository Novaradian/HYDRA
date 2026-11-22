// Scripted provider for the tests (not offered in the UI): walks the panel through the whole approved flow —
// questions → parts list → plan (ghost) → solver check → Apply — using the real command API.
import type { Provider, BomRow, Input, Out } from './session';

const PARTS = (a: Record<string, any>) => [
  { tag: '1A1', ref: 'h_cyl_double', x: 150, y: 60, values: { stroke: `${a.stroke ?? 300} mm` }, part: 'Cylinder, double-acting', rating: `stroke ${a.stroke ?? 300} mm` },
  { tag: '1V1', ref: a.centre === 'Tandem centre' ? 'v_43_tandem' : 'v_43_closed', x: 150, y: 130, part: '4/3 directional valve', rating: a.centre || 'Closed centre' },
  { tag: '1P1', ref: 'h_pump_fixed', x: 145, y: 220, values: { vg: `${((a.flow ?? 20) / 1.45).toFixed(1)} cm³/rev` }, part: 'Pump, fixed', rating: `${a.flow ?? 20} L/min` },
  { tag: '1M1', ref: 'h_emotor', x: 113, y: 220, part: 'Electric motor', rating: '1450 rpm' },
  { tag: '1V2', ref: 'h_relief', x: 190, y: 190, values: { set: `${a.pressure ?? 120} bar` }, part: 'Relief valve', rating: `${a.pressure ?? 120} bar`, locked: true },
  { tag: '1Z1', ref: 'h_tank', x: 145, y: 260, part: 'Tank', rating: '—', locked: true },
  { tag: '1Z2', ref: 'h_tank', x: 190, y: 240, part: 'Tank', rating: '—', locked: true },
  { tag: '1Z3', ref: 'h_tank', x: 170, y: 170, part: 'Tank', rating: '—', locked: true },
  ...(a.gauge ? [{ tag: '1Z4', ref: 'h_gauge', x: 120, y: 185, part: 'Pressure gauge', rating: `0–${Math.ceil((a.pressure ?? 120) * 1.6 / 10) * 10} bar` }] : [])];
const NETS = [['1A1.A', '1V1.A'], ['1A1.B', '1V1.B'], ['1P1.P', '1V1.P', '1V2.P'], ['1V2.T', '1Z2.T'], ['1P1.S', '1Z1.T'], ['1V1.T', '1Z3.T']];
let answers: Record<string, any> = {};

async function build(inp: Input, out: Out) {
  if (inp.approvedBom) {
    const keep = new Set(inp.approvedBom.map(r => r.tag));
    const parts = PARTS(answers).filter(p => keep.has(p.tag)).map(({ part, rating, locked, ...p }) => p);
    const nets = [...NETS, ...(keep.has('1Z4') ? [['1Z4.1', '1P1.P']] : [])].filter(n => n.every(e => keep.has(e.split('.')[0])));
    const id = out.propose([{ cmd: 'build_circuit', args: { parts, nets: nets.map(ports => ({ ports })) } }], `build clamping circuit (${parts.length} parts)`);
    if (!id) return;
    const sim = out.read('run_sim', { plan: id, t_end: 7, events: [{ t: 0.2, tag: '1V1', pos: 'a' }, { t: 4, tag: '1V1', pos: 'b' }] });
    const a = sim.actuators?.[0];
    out.say(a?.extended_at ? `Clamp extends in ${a.extended_at[0]} s and releases by ${a.retracted_at?.[0] ?? '—'} s · max ${sim.peak_bar} bar.` : 'The cylinder did not reach its end in the test run.');
    return;
  }
  if (inp.answers) {
    answers = inp.answers;
    const rows: BomRow[] = PARTS(answers).map(p => ({ tag: p.tag, part: p.part, rating: p.rating, locked: !!(p as any).locked }));
    const decided = Object.entries(inp.answers).filter(([k]) => k.startsWith('_ai_')).map(([k]) => k.slice(4));
    out.bom(`Parts list — ${rows.length} items`, rows, [`${answers.pressure ?? 120} bar · ${answers.flow ?? 20} L/min · stroke ${answers.stroke ?? 300} mm`, ...(decided.length ? [`AI decided: ${decided.join(', ')}`] : [])]);
    return;
  }
  out.questions('A few details for: Clamping circuit', [
    { id: 'flow', label: 'Pump flow', type: 'number', unit: 'L/min', value: 20 },
    { id: 'pressure', label: 'Clamp pressure', type: 'number', unit: 'bar', value: 120 },
    { id: 'stroke', label: 'Cylinder stroke', type: 'number', unit: 'mm', value: 300 },
    { id: 'centre', label: 'Valve centre', type: 'radio', options: ['Closed centre', 'Tandem centre'], value: 'Closed centre' },
    { id: 'gauge', label: 'Pressure gauge', type: 'check', value: true }]);
}

export const demoProvider: Provider = {
  id: 'demo', label: 'Demo', detail: 'Scripted test provider', source: 'test', status: () => 'ready',
  async send(inp, out) {
    if (inp.mode === 'build') return build(inp, out);
    if (inp.mode === 'ask') { const s = out.read('get_sheet', {}); out.say(`${s.name} has ${s.parts.length} parts and ${s.nets.length} nets.`); return; }
    if (inp.mode === 'fix') { const v = out.read('validate', {}); out.say(v.problems.length ? v.problems.map((p: any) => `${p.level}: ${p.text}`).join('\n') : 'No problems found.'); return; }
    out.say('PLC logic help needs a connected AI.');
  }
};
