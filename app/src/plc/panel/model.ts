// Operator panel: data model, widget catalog, bindings (what a widget reads / writes) and auto-build.
// A panel belongs to a program (program.panel) and is saved with it. Widgets flow on a 12-column grid by page order;
// each has a span (w columns × h rows). Bindings are strings so they survive renames (they carry hidden IDs):
//   read:  sig:<signal id> · var:<id> · cyl+:<cyl> · cyl-:<cyl> · step:<seq>/<step> · tq:<timer> · tmr:<timer> · cq:<counter> · cnt:<counter>
//          oil · pp:<pump> (pressure) · pq:<pump> (flow) · plct · simt · st:running|estop|fault|warn|alarm|stopped|paused
//   write: in:<manual input> · var:<id> · cmd:reset|estop|ack|run|stop · live:<part>:<parameter>
import { uid } from '../../util';
import type { Program, Var } from '../compile';
import type { SigTable } from '../signals';
import { inputSources, pumpOfMotor } from '../link';
import { geomOf, isConn, isAsm } from '../../designer/geom';
import * as E from '../../designer/elec';

export type Widget = { id: string; type: string; page: string; w: number; h: number; p: Record<string, any> };
export type Page = { id: string; name: string };
export type Recipe = { id: string; name: string; values: Record<string, any> };
export type Panel = { pages: Page[]; widgets: Widget[]; recipes: Recipe[]; modeVar?: string; modes?: string[]; title?: string };

export type WDef = { type: string; cat: 'Controls' | 'Indicators' | 'Alarms & info' | 'Layout'; name: string; icon: string; w: number; h: number; p: Record<string, any>; tip: string };
const W = (type: string, cat: WDef['cat'], name: string, icon: string, w: number, h: number, p: Record<string, any>, tip: string): WDef => ({ type, cat, name, icon, w, h, p, tip });
export const CATALOG: WDef[] = [
  W('pushbutton', 'Controls', 'Push button', '▭', 2, 2, { label: 'START', colour: 'green', act: '', mode: 'momentary', key: '' }, 'Momentary (true while pressed) or a command'),
  W('litbutton', 'Controls', 'Lit button', '◍', 2, 2, { label: 'PUMP ON', colour: 'green', act: '', lamp: '', key: '' }, 'Push button with a lamp in it (lamp shows a state)'),
  W('estop', 'Controls', 'E-stop', '◉', 3, 3, { label: 'Emergency stop', act: '' }, 'Mushroom button — latches when pressed, click again to release'),
  W('selector', 'Controls', 'Selector', '⊛', 2, 3, { label: 'Mode', act: '', opts: 'MAN=1,AUTO=0,SETUP=2' }, 'Rotary selector writing a number or ON / OFF'),
  W('keyswitch', 'Controls', 'Key switch', '⚷', 2, 3, { label: 'Access', act: '' }, 'Operator / maintenance access level'),
  W('toggle', 'Controls', 'Toggle', '⊸', 3, 1, { label: 'Option', act: '' }, 'Maintained ON / OFF switch'),
  W('twohand', 'Controls', 'Two-hand', '◐◑', 3, 2, { label: 'Two-hand start', act: '', win: 0.5 }, 'True while both buttons are held and were pressed within 0.5 s (ISO 13851)'),
  W('jog', 'Controls', 'Jog pair', '±', 3, 2, { label: 'A', act: '', act2: '', en: '' }, 'Hold-to-run + / − (normally MANUAL only)'),
  W('slider', 'Controls', 'Slider', '━●', 3, 1, { label: 'Speed', act: '', min: 0, max: 100, step: 1, unit: '%' }, 'Writes a number (variable or live part setting)'),
  W('knob', 'Controls', 'Knob', '◔', 2, 3, { label: 'Setting', act: '', min: 0, max: 100, step: 1, unit: '' }, 'Rotary set-point'),
  W('numin', 'Controls', 'Number in', '▤', 2, 1, { label: 'Set-point', act: '', min: 0, max: 1000, unit: '', dec: 1 }, 'Number entry with limits'),
  W('recipe', 'Controls', 'Recipe', '☰', 4, 2, { label: 'Recipe' }, 'Load / save a set of set-points'),
  W('lamp', 'Indicators', 'Lamp', '●', 2, 1, { label: 'RUNNING', colour: 'green', src: 'st:running' }, 'Pilot lamp (IEC 60073 colours)'),
  W('tower', 'Indicators', 'Tower light', '▮', 1, 4, { red: 'st:alarm', amber: 'st:warn', green: 'st:running', blue: '' }, 'Stack light: red fault, amber warning, green running, blue attention'),
  W('gauge', 'Indicators', 'Gauge', '◠', 2, 3, { label: 'Pressure', src: '', min: 0, max: 250, warn: 210, unit: 'bar' }, 'Dial gauge'),
  W('bar', 'Indicators', 'Bar', '▬', 3, 1, { label: 'Value', src: '', min: 0, max: 100, unit: '', colour: 'blue' }, 'Bar with value'),
  W('tank', 'Indicators', 'Tank', '⊔', 1, 3, { label: 'Tank', src: '', min: 0, max: 100, unit: '%' }, 'Level in a tank'),
  W('thermo', 'Indicators', 'Thermo', '🌡', 1, 3, { label: 'Oil', src: 'oil', max: 80, warn: 55 }, 'Thermometer (oil temperature by default)'),
  W('value', 'Indicators', 'Value', '12', 2, 1, { label: 'Value', src: '', unit: '', dec: 1 }, 'Digital value'),
  W('trend', 'Indicators', 'Trend', '∿', 4, 3, { label: 'Trend', srcs: '', span: 30 }, 'Last seconds of up to four values'),
  W('stepchain', 'Indicators', 'Step chain', 'S2', 5, 2, { label: 'Sequence', seq: '' }, 'GRAFCET steps with the active one lit'),
  W('steptimer', 'Indicators', 'Step timer', '⏱', 4, 2, { label: 'Step timer', seq: '', timeout: 5 }, 'Time in the active step against a timeout'),
  W('counter', 'Indicators', 'Counter', '#', 2, 2, { label: 'Cycles', cnt: '', preset: 0 }, 'Counter value (and preset)'),
  W('cylinder', 'Indicators', 'Cylinder', '▭━', 6, 1, { label: '', cyl: '' }, 'Live cylinder picture with end sensors'),
  W('valve', 'Indicators', 'Valve', 'a0b', 2, 1, { label: '', valve: '' }, 'Valve position a / 0 / b'),
  W('motor', 'Indicators', 'Motor', 'M', 3, 2, { label: 'Pump motor', motor: '' }, 'Motor / pump state'),
  W('ioleds', 'Indicators', 'I/O LEDs', '∷', 4, 3, { label: 'I/O', which: 'both' }, 'LED strip of the PLC inputs and outputs'),
  W('permissives', 'Indicators', 'Permissives', '✓', 3, 2, { label: 'Safety', items: '' }, 'Checklist of conditions (one per line: label = source)'),
  W('alarmline', 'Alarms & info', 'Alarm line', '⚠', 6, 1, {}, 'Newest active alarm with ACK'),
  W('alarmlist', 'Alarms & info', 'Alarm list', '≣', 8, 4, { label: 'Alarms' }, 'Active and past alarms with ACK'),
  W('eventlog', 'Alarms & info', 'Event log', '🗎', 5, 3, { label: 'Event log', n: 6 }, 'Latest output changes'),
  W('production', 'Alarms & info', 'Production', 'Σ', 3, 3, { label: 'Production', cnt: '', preset: 0 }, 'Count, cycle time, parts / h, run time'),
  W('message', 'Alarms & info', 'Message', 'ⓘ', 6, 1, {}, 'Operator message (SHOW MESSAGE block)'),
  W('clock', 'Alarms & info', 'Clock', '⏲', 2, 1, { label: 'Time', what: 'plct' }, 'Machine time or wall clock'),
  W('group', 'Layout', 'Group', '▢', 12, 1, { label: 'Section' }, 'A section title across the panel'),
  W('label', 'Layout', 'Label', 'T', 3, 1, { label: 'Text', size: 14 }, 'Free text'),
  W('divider', 'Layout', 'Divider', '—', 12, 1, {}, 'A line across the panel'),
  W('image', 'Layout', 'Image', '🖼', 2, 2, { src: '' }, 'Logo or picture (PNG / JPG / SVG)'),
  W('pagelink', 'Layout', 'Page link', '⇥', 2, 1, { label: 'Manual', page: '' }, 'Button that opens another page'),
  W('spacer', 'Layout', 'Spacer', '⬚', 1, 1, {}, 'Empty space')
];
export const defOf = (type: string) => CATALOG.find(d => d.type === type);
export const COLOURS: Record<string, [string, string]> = { green: ['#1E9E4A', 'start / on / running'], red: ['#C62828', 'stop / off / fault'], amber: ['#F5A623', 'warning / attention'], blue: ['#1565C0', 'reset / acknowledge / mandatory'], white: ['#E9EEF3', 'general'], dark: ['#2E3B4A', 'neutral'] };
export const DEFAULT_PAGES: Page[] = [{ id: 'main', name: 'Main' }, { id: 'manual', name: 'Manual' }, { id: 'setp', name: 'Setpoints' }, { id: 'alarms', name: 'Alarms' }, { id: 'io', name: 'I/O' }, { id: 'trends', name: 'Trends' }];
export const emptyPanel = (): Panel => ({ pages: DEFAULT_PAGES.map(x => ({ ...x })), widgets: [], recipes: [] });
export const mkWidget = (type: string, page: string, p: Record<string, any> = {}, w?: number, h?: number): Widget => { const d = defOf(type)!; return { id: uid('w'), type, page, w: w ?? d.w, h: h ?? d.h, p: { ...d.p, ...p } }; };

// ---------- what can be bound (for the inspector lists and the checks) ----------
export type Opt = [string, string]; // [label, value]
export function readOptions(T: SigTable, pr: Program, kind: 'bool' | 'num' | 'any', extra: { seqs: string[][]; timers: string[]; counters: string[]; pumps: Opt[] }): Opt[] {
  const o: Opt[] = []; const vars = pr.vars || [];
  if (kind !== 'num') { o.push(['Machine running', 'st:running'], ['Machine stopped', 'st:stopped'], ['E-stop active', 'st:estop'], ['Fault', 'st:fault'], ['Any active alarm', 'st:alarm'], ['Active warning', 'st:warn'], ['Paused', 'st:paused']);
    T.sigs.filter(s => s.dir === 'in' || s.dir === 'out').forEach(s => o.push([`${s.tag}${s.addr ? ' · ' + s.addr : ''} — ${s.desc}`, 'sig:' + s.id]));
    T.cyls.forEach(c => { o.push([`${c.tag} extended (+)`, 'cyl+:' + c.id], [`${c.tag} retracted (−)`, 'cyl-:' + c.id]); });
    vars.filter(v => v.type === 'BOOL').forEach(v => o.push([`${v.name} (variable)`, 'var:' + v.id]));
    extra.seqs.forEach(([sq, st]) => o.push([`step ${sq} · ${st} active`, `step:${sq}/${st}`]));
    extra.timers.forEach(n => o.push([`timer ${n} done`, 'tq:' + n])); extra.counters.forEach(n => o.push([`counter ${n} done`, 'cq:' + n])); }
  if (kind !== 'bool') { T.sigs.filter(s => s.dir === 'ain' || s.dir === 'aout').forEach(s => o.push([`${s.tag} (${s.unit || ''})`, 'sig:' + s.id]));
    vars.filter(v => v.type !== 'BOOL' && v.type !== 'STRING').forEach(v => o.push([`${v.name} (variable)`, 'var:' + v.id]));
    extra.pumps.forEach(([l, id]) => o.push([`${l} pressure (bar)`, 'pp:' + id], [`${l} flow (L/min)`, 'pq:' + id]));
    o.push(['Oil temperature (°C)', 'oil'], ['Machine time (s)', 'plct'], ['Simulation time (s)', 'simt']);
    extra.timers.forEach(n => o.push([`timer ${n} elapsed (s)`, 'tmr:' + n])); extra.counters.forEach(n => o.push([`counter ${n} value`, 'cnt:' + n])); }
  return o;
}
export function writeOptions(p: any, T: SigTable, pr: Program, kind: 'bool' | 'num'): Opt[] {
  const o: Opt[] = []; const src = inputSources(p, T); const vars = pr.vars || [];
  if (kind === 'bool') {
    src.forEach((s, id) => { if (s.kind !== 'manual') return; const sg = T.byId.get(id); if (sg) o.push([`${sg.tag} · ${sg.addr} — ${s.func || sg.desc}`, 'in:' + id]); });
    vars.filter(v => v.type === 'BOOL').forEach(v => o.push([`${v.name} (variable)`, 'var:' + v.id]));
    o.push(['Command: Reset (after E-stop / fault)', 'cmd:reset'], ['Command: E-stop', 'cmd:estop'], ['Command: acknowledge alarms', 'cmd:ack'], ['Command: start machine (Run)', 'cmd:run'], ['Command: stop machine', 'cmd:stop']);
  } else {
    vars.filter(v => v.type === 'INT' || v.type === 'FLOAT' || v.type === 'TIME').forEach(v => o.push([`${v.name} (${v.type} variable)`, 'var:' + v.id]));
    liveParams(p).forEach(([l, v]) => o.push([l, v]));
  }
  return o;
}
// live part settings a panel may change while the machine runs (same as the Properties panel)
export function liveParams(p: any): Opt[] {
  const o: Opt[] = [];
  E.fluidSheets(p).forEach(sh => sh.components.forEach(c => { if (isConn(c.ref) || isAsm(c.ref)) return; const g = geomOf(c.ref); const id = g.item?.id || '';
    if (g.cls === 'pressure') o.push([`${c.tag} setting (bar) — part`, `live:${c.id}:set`]);
    if (g.cls === 'pump') o.push(/var|pc/.test(id) ? [`${c.tag} displacement (%) — part`, `live:${c.id}:disp`] : [`${c.tag} drive speed (rpm) — part`, `live:${c.id}:n`]);
    if (/throttle|flowctrl|needle|flow_ctrl|fcv/.test(id) || g.cls === 'flow') o.push([`${c.tag} opening (%) — part`, `live:${c.id}:open`]);
  }));
  return o;
}
export const pumpsOf = (p: any): Opt[] => { const o: Opt[] = []; E.fluidSheets(p).forEach(sh => sh.components.forEach(c => { if (isConn(c.ref) || isAsm(c.ref)) return; if (geomOf(c.ref).cls === 'pump') o.push([c.tag, c.id]); })); return o; };
export const valvesOf = (p: any): Opt[] => { const o: Opt[] = []; E.fluidSheets(p).forEach(sh => sh.components.forEach(c => { if (isConn(c.ref) || isAsm(c.ref)) return; const g = geomOf(c.ref); if (g.valve) o.push([c.tag + (E.solenoidSides(g).length ? ' (solenoid)' : ''), c.id]); })); return o; };
export const motorsOf = (p: any): Opt[] => { const o: Opt[] = []; E.fluidSheets(p).forEach(sh => sh.components.forEach(c => { if (isConn(c.ref) || isAsm(c.ref)) return; if (geomOf(c.ref).cls === 'drive') o.push([c.tag, c.id]); })); return o; };

// ---------- checks: is every binding still valid? ----------
export function widgetIssues(w: Widget, ctx: { read: Set<string>; write: Set<string>; pages: Set<string>; seqs: Set<string>; counters: Set<string>; cyls: Set<string>; valves: Set<string>; motors: Set<string> }): string[] {
  const out: string[] = []; const p = w.p; const chkR = (k: string, v: string) => { if (v && !ctx.read.has(v.replace(/^!/, ''))) out.push(`${k}: the bound value no longer exists`); };
  const chkW = (k: string, v: string, need = false) => { if (!v) { if (need) out.push(`${k}: not bound yet`); return; } if (!ctx.write.has(v)) out.push(`${k}: the bound target no longer exists (or is not writable)`); };
  switch (w.type) {
    case 'pushbutton': case 'litbutton': case 'twohand': case 'toggle': chkW('Acts on', p.act, true); if (w.type === 'litbutton') chkR('Lamp', p.lamp); break;
    case 'estop': chkW('Acts on', p.act); break;
    case 'selector': case 'slider': case 'knob': case 'numin': chkW('Acts on', p.act, true); break;
    case 'jog': chkW('+ acts on', p.act, true); chkW('− acts on', p.act2, true); break;
    case 'lamp': case 'gauge': case 'bar': case 'tank': case 'value': chkR('Shows', p.src); if (!p.src) out.push('Shows: not bound yet'); break;
    case 'thermo': chkR('Shows', p.src); break;
    case 'tower': ['red', 'amber', 'green', 'blue'].forEach(k => chkR(k, p[k])); break;
    case 'stepchain': case 'steptimer': if (!ctx.seqs.has(p.seq)) out.push(p.seq ? `Sequence ${p.seq} no longer exists` : 'Sequence: choose one'); break;
    case 'counter': case 'production': if (p.cnt && !ctx.counters.has(p.cnt)) out.push(`Counter ${p.cnt} no longer exists`); if (w.type === 'counter' && !p.cnt) out.push('Counter: choose one'); break;
    case 'cylinder': if (!ctx.cyls.has(p.cyl)) out.push(p.cyl ? 'Cylinder: missing component' : 'Cylinder: choose one'); break;
    case 'valve': if (!ctx.valves.has(p.valve)) out.push(p.valve ? 'Valve: missing component' : 'Valve: choose one'); break;
    case 'motor': if (p.motor && !ctx.motors.has(p.motor)) out.push('Motor: missing component'); break;
    case 'pagelink': if (!ctx.pages.has(p.page)) out.push('Page: choose one'); break;
    case 'trend': String(p.srcs || '').split(',').filter(Boolean).forEach((s: string) => chkR('Trend', s)); break;
    case 'permissives': parseItems(p.items).forEach(([, s]) => chkR('Item', s)); break;
  }
  if (p.en && !p.en.startsWith('mode:')) chkR('Enabled when', p.en);
  return out;
}
export const parseItems = (s: string): [string, string][] => String(s || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const i = l.lastIndexOf('='); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] as [string, string] : [l, ''] as [string, string]; });
export const parseOpts = (s: string): [string, number][] => String(s || '').split(',').map(x => x.trim()).filter(Boolean).map((x, i) => { const [l, v] = x.split('='); return [l.trim(), v != null && v.trim() !== '' ? +v : i] as [string, number]; });

// ---------- auto-build: a working panel from the project in one click ----------
export function autoBuild(p: any, pr: Program, T: SigTable, info: { seqs: { name: string; steps: string[] }[]; counters: string[] }): { panel: Panel; newVars: Var[] } {
  const panel = emptyPanel(); const add = (pg: string, type: string, props: Record<string, any> = {}, w?: number, h?: number) => { const x = mkWidget(type, pg, props, w, h); panel.widgets.push(x); return x; };
  const vars = [...(pr.vars || [])]; const newVars: Var[] = [];
  const ensureVar = (name: string, type: Var['type'], init: string, comment: string) => { let v = vars.find(x => x.name === name); if (!v) { v = { id: uid('v'), name, type, init, comment }; vars.push(v); newVars.push(v); } return v; };
  const src = inputSources(p, T); const manual = [...src.entries()].filter(([, s]) => s.kind === 'manual') as [string, any][];
  const isStart = (s: any, id: string) => /start|run|cycle/i.test(s.func + ' ' + (T.byId.get(id)?.desc || ''));
  const isStop = (s: any) => s.nc && !/estop|emergency/i.test(s.func) || /stop/i.test(s.func) && !/emergency/i.test(s.func);
  const isEstop = (s: any, id: string) => /estop|emergency/i.test(s.func) || id === pr.estop;
  const mode = vars.find(v => /^(hmi_)?mode$/i.test(v.name)) || ensureVar('Mode', 'INT', '0', 'Panel mode selector: 0 AUTO, 1 MANUAL, 2 SETUP');
  panel.modeVar = mode.id; panel.modes = ['AUTO', 'MANUAL', 'SETUP'];
  // ---- Main ----
  add('main', 'group', { label: 'Safety and commands' });
  const es = manual.find(([id, s]) => isEstop(s, id));
  add('main', 'estop', { label: 'Emergency stop', act: es ? 'in:' + es[0] : 'cmd:estop' }, 2, 3);
  add('main', 'permissives', { label: 'Safety', items: [`No E-stop = !st:estop`, `No fault = !st:fault`, ...T.cyls.slice(0, 2).map(c => `${c.tag} at home (−) = cyl-:${c.id}`)].join('\n') }, 3, 3);
  const st = manual.find(([id, s]) => isStart(s, id) && !s.nc); const sp = manual.find(([, s]) => isStop(s));
  add('main', 'pushbutton', { label: 'START', colour: 'green', act: st ? 'in:' + st[0] : 'cmd:run', key: 'F2', en: 'mode:0' }, 2, 2);
  add('main', 'pushbutton', { label: 'STOP', colour: 'red', act: sp ? 'in:' + sp[0] : 'cmd:stop', key: 'F3' }, 2, 2);
  add('main', 'pushbutton', { label: 'RESET', colour: 'blue', act: 'cmd:reset', key: 'F4' }, 2, 2);
  manual.filter(([id, s]) => s !== es?.[1] && s !== st?.[1] && s !== sp?.[1]).slice(0, 4).forEach(([id, s]) => add('main', s.momentary ? 'pushbutton' : 'toggle', { label: (s.func || T.byId.get(id)?.tag || '').toUpperCase(), colour: 'dark', act: 'in:' + id }, 2, s.momentary ? 2 : 1));
  add('main', 'selector', { label: 'Mode', act: 'var:' + mode.id, opts: 'MAN=1,AUTO=0,SETUP=2' }, 2, 3);
  add('main', 'tower', {}, 1, 3);
  info.counters.length && add('main', 'production', { label: 'Production', cnt: info.counters[0] }, 3, 3);
  info.seqs.forEach(sq => { add('main', 'stepchain', { label: 'Sequence ' + sq.name, seq: sq.name }, 6, 2); add('main', 'steptimer', { label: 'Step timer', seq: sq.name, timeout: 10 }, 6, 2); });
  if (T.cyls.length) { add('main', 'group', { label: 'Machine' }); T.cyls.forEach(c => add('main', 'cylinder', { cyl: c.id }, 6, 1)); }
  const vlist = valvesOf(p).filter(([l]) => /solenoid/.test(l)); vlist.slice(0, 6).forEach(([, id]) => add('main', 'valve', { valve: id }, 2, 1));
  const pumps = pumpsOf(p); const motors = motorsOf(p);
  add('main', 'group', { label: 'Hydraulics' });
  if (pumps.length) add('main', 'gauge', { label: 'System pressure', src: 'pp:' + pumps[0][1], min: 0, max: 250, warn: 210, unit: 'bar' }, 3, 3);
  if (pumps.length) add('main', 'trend', { label: 'Pressure · 30 s', srcs: 'pp:' + pumps[0][1], span: 30 }, 5, 3);
  add('main', 'thermo', { label: 'Oil', src: 'oil', max: 80, warn: 55 }, 1, 3);
  if (motors.length) add('main', 'motor', { label: 'Pump motor', motor: motors[0][1] }, 3, 3);
  add('main', 'alarmline', {}, 12, 1);
  // ---- Manual: one card per cylinder (jog bound to variables your program reads in MANUAL) ----
  add('manual', 'group', { label: 'Manual mode — hold to jog' });
  add('manual', 'selector', { label: 'Mode', act: 'var:' + mode.id, opts: 'MAN=1,AUTO=0,SETUP=2' }, 2, 3);
  if (motors.length) add('manual', 'motor', { label: 'Pump motor', motor: motors[0][1] }, 3, 3);
  add('manual', 'twohand', { label: 'Single step (two-hand)', act: 'var:' + ensureVar('HMI_Step', 'BOOL', 'FALSE', 'Two-hand single step from the panel').id }, 3, 2);
  T.cyls.forEach(c => { const plus = ensureVar(`Jog_${c.tag}_plus`, 'BOOL', 'FALSE', `Panel jog ${c.tag} + (use it in MANUAL mode)`), minus = ensureVar(`Jog_${c.tag}_minus`, 'BOOL', 'FALSE', `Panel jog ${c.tag} − (use it in MANUAL mode)`);
    add('manual', 'cylinder', { cyl: c.id }, 7, 2); add('manual', 'jog', { label: c.tag, act: 'var:' + plus.id, act2: 'var:' + minus.id, en: 'mode:1' }, 5, 2); });
  add('manual', 'ioleds', { label: 'I/O', which: 'both' }, 12, 3);
  // ---- Setpoints ----
  add('setp', 'recipe', { label: 'Recipe' }, 4, 2); add('setp', 'keyswitch', { label: 'Access' }, 2, 3);
  vars.filter(v => !/^(Mode|HMI_|Jog_)/.test(v.name)).forEach(v => { if (v.type === 'BOOL') add('setp', 'toggle', { label: v.name, act: 'var:' + v.id, level: 'maint' }, 3, 1); else if (v.type !== 'STRING') add('setp', 'numin', { label: v.name, act: 'var:' + v.id, min: 0, max: 100000, unit: v.type === 'TIME' ? 's' : '', dec: v.type === 'INT' ? 0 : 2, level: 'maint' }, 2, 1); });
  liveParams(p).filter(([, v]) => /:set$|:disp$|:n$/.test(v)).slice(0, 4).forEach(([l, v]) => add('setp', 'knob', { label: l.replace(' — part', ''), act: v, min: 0, max: /:set$/.test(v) ? 250 : /:n$/.test(v) ? 3000 : 100, step: /:n$/.test(v) ? 10 : 1, unit: /:set$/.test(v) ? 'bar' : /:n$/.test(v) ? 'rpm' : '%', level: 'maint' }, 2, 3));
  T.sigs.filter(s => s.dir === 'aout').forEach(s => add('setp', 'bar', { label: s.tag, src: 'sig:' + s.id, unit: '%' }, 3, 1));
  // ---- Alarms, I/O, Trends ----
  add('alarms', 'alarmlist', { label: 'Alarms · active and history' }, 12, 5); add('alarms', 'eventlog', { label: 'Event log', n: 10 }, 12, 4);
  add('io', 'ioleds', { label: 'PLC I/O', which: 'both' }, 12, 3);
  T.sigs.filter(s => s.dir === 'ain').forEach(s => add('io', 'value', { label: s.tag, src: 'sig:' + s.id, unit: s.unit || '', dec: 1 }, 3, 1));
  const tr = [...T.cyls.map(c => 'sig:pos:' + c.id.slice(4)), ...(pumps.length ? ['pp:' + pumps[0][1]] : [])].slice(0, 4);
  add('trends', 'trend', { label: 'Positions and pressure · 60 s', srcs: tr.join(','), span: 60 }, 12, 5);
  return { panel, newVars };
}
