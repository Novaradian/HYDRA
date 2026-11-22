// Logic Coder: the HYDRA block set for Blockly (zelos renderer, HYDRA colours). Blockly itself is loaded on
// demand from lib/hydra-blockly.js the first time a program opens, so HYDRA starts as fast as before.
import { options, type SigTable } from './signals';
import { FB_IO, listOf, type Var } from './compile';

let BL: any = null; let loading: Promise<any> | null = null;
export function loadBlockly(): Promise<any> {
  if (BL) return Promise.resolve(BL); const w = window as any; if (w.HYDRA_BLOCKLY) return Promise.resolve(setup(w.HYDRA_BLOCKLY));
  if (!loading) loading = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'lib/hydra-blockly.js'; s.onload = () => w.HYDRA_BLOCKLY ? res(setup(w.HYDRA_BLOCKLY)) : rej(new Error('Blockly did not load')); s.onerror = () => { loading = null; rej(new Error('lib/hydra-blockly.js is missing — keep the HYDRA folder together')); }; document.head.appendChild(s); });
  return loading;
}
export const blockly = () => BL;

// what the dynamic dropdowns list: set by the open Logic Coder before it loads a workspace
export const ctx: { t: SigTable | null; vars: Var[]; ws: any } = { t: null, vars: [], ws: null };

export const C = { ev: '#1E2936', estop: '#C62828', reset: '#1565C0', fault: '#8E1B1B', logic: '#6D4AA8', loop: '#1D4ED8', step: '#0A64C2', math: '#0E7490', timer: '#B45309', vars: '#475569', io: '#1E7A3C', text: '#9D174D', note: '#94A3B8', my: '#7C8796' };

const MODES = [['AUTO', 'AUTO'], ['MANUAL', 'MANUAL'], ['SETUP', 'SETUP'], ['HOMING', 'HOMING'], ['OFF', 'OFF']];

function setup(B: any) {
  if (BL) return BL; BL = B;
  // ---------- dropdown whose list comes from the project (signals, variables, timers, steps) ----------
  class HyField extends B.FieldDropdown {
    src: string;
    constructor(src: string) { super(() => [['—', '']]); this.src = src; }
    static fromJson(o: any) { return new HyField(o.src); }
    gen(): [string, string][] {
      const t = ctx.t; const ws = ctx.ws || this.getSourceBlock?.()?.workspace;
      const names = (type: string, f: string) => { const s = new Set<string>(); ws?.getAllBlocks?.(false).forEach((b: any) => { if (b.type === type) { const v = String(b.getFieldValue(f) || '').trim(); if (v) s.add(v); } }); return [...s].sort().map(v => [v, v] as [string, string]); };
      switch (this.src) {
        case 'din': case 'dout': case 'ain': case 'aout': case 'cyl': return t ? options(t, this.src as any) : [];
        case 'var': return ctx.vars.map(v => [`${v.name}`, v.id]);
        case 'timer': return names('hy_timer', 'NAME');
        case 'counter': return names('hy_counter', 'NAME');
        case 'seq': return names('hy_seq', 'NAME');
        case 'fb': return names('hy_fb_def', 'NAME');
        case 'sreg': return names('hy_shreg', 'NAME');
        case 'array': return names('hy_array', 'NAME');
        case 'pid': return names('hy_pid', 'NAME');
        case 'par': return names('hy_par', 'NAME');
        case 'fbout': { const defs = new Map<string, string[]>(); const out = new Map<string, string>(); const all = ws?.getAllBlocks?.(false) || [];
          all.forEach((b: any) => { if (b.type === 'hy_fb_def') defs.set(String(b.getFieldValue('NAME') || '').trim(), listOf(b.getFieldValue('OUTS'))); });
          all.forEach((b: any) => { if (b.type !== 'hy_fb_call') return; const inst = String(b.getFieldValue('INST') || '').trim(); (defs.get(b.getFieldValue('FB')) || []).forEach(o => out.set(`${inst}/${o}`, `${inst}.${o}`)); });
          return [...out].sort().map(([v, l]) => [l, v] as [string, string]); }
        case 'step': { const out: [string, string][] = []; ws?.getAllBlocks?.(false).forEach((b: any) => { if (b.type !== 'hy_step') return; const sq = b.getSurroundParent?.(); let p = sq; while (p && p.type !== 'hy_seq') p = p.getSurroundParent(); if (!p) return; const sn = p.getFieldValue('NAME'), id = b.getFieldValue('ID'); out.push([`${sn} · ${id}${b.getFieldValue('LABEL') ? ' ' + b.getFieldValue('LABEL') : ''}`, `${sn}/${id}`]); }); return out; }
      }
      return [];
    }
    getOptions(): [string, string][] {
      const o = this.gen(); const v = this.value_;
      if (v && !o.some(x => x[1] === v)) o.push([this.src === 'var' ? '⚠ deleted variable' : ['timer', 'counter', 'seq', 'step', 'fb', 'sreg', 'array', 'pid', 'par', 'fbout'].includes(this.src) ? `⚠ ${String(v).replace('/', this.src === 'fbout' ? '.' : ' · ')}` : '⚠ missing component', v]);
      return o.length ? o : [['—', '']];
    }
    doClassValidation_(v: any) { return v == null ? null : String(v); }
  }
  B.fieldRegistry.register('field_hy', HyField);
  const hy = (name: string, src: string) => ({ type: 'field_hy', name, src });
  const num = (name: string, check = 'Number') => ({ type: 'input_value', name, check });
  const bool = (name: string) => ({ type: 'input_value', name, check: 'Boolean' });
  const stmt = { previousStatement: null, nextStatement: null };
  const hat = (type: string, msg: string, colour: string, tip: string, args: any[] = []) => ({ type, message0: msg, args0: args, nextStatement: null, colour, hat: 'cap', tooltip: tip });
  const txt = (name: string, text: string) => ({ type: 'field_input', name, text });
  const fnum = (name: string, value: number, min?: number, max?: number) => ({ type: 'field_number', name, value, ...(min != null ? { min } : {}), ...(max != null ? { max } : {}) });
  const dd = (name: string, opts: string[][]) => ({ type: 'field_dropdown', name, options: opts });
  const sock = (name: string) => ({ type: 'input_value', name });
  const body = (name: string) => ({ type: 'input_statement', name });
  // CALL FUNCTION BLOCK: its input sockets take the names declared on the FUNCTION BLOCK definition
  try { B.Extensions.register('hy_fb_labels', function (this: any) {
    const upd = () => { const b = this; if (b.isDeadOrDying?.()) return; const ws = b.workspace; const def = ws?.getAllBlocks?.(false).find((x: any) => x.type === 'hy_fb_def' && x.getFieldValue('NAME') === b.getFieldValue('FB'));
      const ins = def ? listOf(def.getFieldValue('INS')) : []; let ch = false;
      for (let i = 0; i < FB_IO; i++) { const inp = b.getInput('IN' + i), lb = b.getField('L' + i); if (!inp || !lb) continue; const want = def ? i < ins.length : i === 0; if (lb.getValue() !== (ins[i] || `in ${i + 1}`)) lb.setValue(ins[i] || `in ${i + 1}`); if (inp.isVisible() !== want) { inp.setVisible(want); ch = true; } }
      if (ch && b.rendered) b.queueRender?.(); };
    this.setOnChange(upd); setTimeout(upd, 0);
  }); } catch { }
  const fbIns = Array.from({ length: FB_IO }, (_, i) => ({ [`message${i + 1}`]: '%1 %2', [`args${i + 1}`]: [{ type: 'field_label', name: 'L' + i, text: `in ${i + 1}` }, sock('IN' + i)] })).reduce((a, x) => Object.assign(a, x), {});
  B.defineBlocksWithJsonArray([
    // ===== 8d: compare / limit =====
    { type: 'hy_window', message0: '%1 WITHIN %2 ± %3', args0: [num('V'), num('C'), num('TOL')], inputsInline: true, output: 'Boolean', colour: C.logic, tooltip: 'True while |value − centre| ≤ tolerance (a window comparator)' },
    { type: 'hy_hyst', message0: '%1 HYSTERESIS on at %2 off at %3', args0: [num('V'), num('ON'), num('OFF')], inputsInline: true, output: 'Boolean', colour: C.logic, tooltip: 'Two-point switch: turns ON when the value reaches “on”, OFF when it reaches “off”, and holds in between. On > off: high switch; on < off: low switch' },
    { type: 'hy_deadband', message0: 'DEADBAND %1 ± %2', args0: [num('V'), num('D')], inputsInline: true, output: 'Number', colour: C.math, tooltip: 'Gives 0 while |value| ≤ band, otherwise the value itself (stops a valve hunting around zero)' },
    // selectors
    { type: 'hy_sel', message0: 'SELECT %1 if true %2 else %3', args0: [bool('G'), sock('A'), sock('B')], inputsInline: true, output: null, colour: C.logic, tooltip: 'IEC SEL: picks one of two values by a condition' },
    { type: 'hy_mux', message0: 'MUX %1 of 0: %2 1: %3 2: %4 3: %5', args0: [num('K'), sock('IN0'), sock('IN1'), sock('IN2'), sock('IN3')], inputsInline: true, output: null, colour: C.logic, tooltip: 'IEC MUX: picks input 0 … 3 by an index (outside 0 … 3: a fault)' },
    // ===== bits & words (16-bit WORD) =====
    { type: 'hy_bitop', message0: '%1 %2 %3', args0: [num('A'), dd('OP', [['AND', 'AND'], ['OR', 'OR'], ['XOR', 'XOR']]), num('B')], inputsInline: true, output: 'Number', colour: C.logic, tooltip: 'Bitwise logic on 16-bit words (0 … 65535)' },
    { type: 'hy_wnot', message0: 'NOT word %1', args0: [num('A')], inputsInline: true, output: 'Number', colour: C.logic, tooltip: 'Inverts every bit of a 16-bit word' },
    { type: 'hy_shift', message0: '%1 %2 by %3', args0: [num('A'), dd('OP', [['SHL shift left', 'SHL'], ['SHR shift right', 'SHR'], ['ROL rotate left', 'ROL'], ['ROR rotate right', 'ROR']]), num('N')], inputsInline: true, output: 'Number', colour: C.logic, tooltip: 'Shift or rotate a 16-bit word' },
    { type: 'hy_bit_get', message0: 'bit %1 of %2', args0: [num('N'), num('A')], inputsInline: true, output: 'Boolean', colour: C.logic, tooltip: 'Bit 0 … 15 of a word' },
    { type: 'hy_bit_set', message0: '%1 with bit %2 = %3', args0: [num('A'), num('N'), bool('V')], inputsInline: true, output: 'Number', colour: C.logic, tooltip: 'The word with one bit set or cleared' },
    { type: 'hy_shreg', message0: 'SHIFT REGISTER %1 length %2', args0: [txt('NAME', 'SR1'), fnum('LEN', 8, 1, 256)], message1: 'data in %1', args1: [bool('IN')], message2: 'shift on rising edge of %1', args2: [bool('CLK')], message3: 'clear %1', args3: [bool('RESET')], ...stmt, colour: C.logic, tooltip: 'Bit shift register (part tracking on a conveyor or index table): on every rising edge of the clock all bits move one place and “data in” enters at position 0' },
    { type: 'hy_shreg_bit', message0: 'register %1 position %2', args0: [hy('NAME', 'sreg'), num('I')], inputsInline: true, output: 'Boolean', colour: C.logic, tooltip: 'Bit at a position: 0 = newest' },
    // ===== arrays, tables, records =====
    { type: 'hy_array', message0: 'ARRAY %1 size %2 start value %3', args0: [txt('NAME', 'Recipe'), fnum('SIZE', 10, 1, 10000), fnum('INIT', 0)], ...stmt, colour: C.vars, tooltip: 'Declares a number array (items 1 … size). Put it anywhere — on its own or under ON START; it is created when the program starts' },
    { type: 'hy_arr_get', message0: 'item %1 of %2', args0: [num('I'), hy('NAME', 'array')], inputsInline: true, output: 'Number', colour: C.vars, tooltip: 'Items are numbered 1 … size; outside that range: a fault' },
    { type: 'hy_arr_set', message0: 'SET item %1 of %2 TO %3', args0: [num('I'), hy('NAME', 'array'), num('V')], inputsInline: true, ...stmt, colour: C.vars },
    { type: 'hy_arr_fill', message0: 'FILL %1 with %2', args0: [hy('NAME', 'array'), num('V')], inputsInline: true, ...stmt, colour: C.vars },
    { type: 'hy_arr_stat', message0: '%1 of %2', args0: [dd('OP', [['SUM', 'SUM'], ['AVERAGE', 'AVG'], ['MIN', 'MIN'], ['MAX', 'MAX'], ['index of MAX', 'IMAX']]), hy('NAME', 'array')], inputsInline: true, output: 'Number', colour: C.vars },
    { type: 'hy_table', message0: 'TABLE %1', args0: [num('X')], message1: 'x %1', args1: [txt('XS', '0, 50, 100')], message2: 'y %1', args2: [txt('YS', '0, 120, 250')], output: 'Number', colour: C.vars, tooltip: 'Characteristic curve: linear interpolation between the points (x rising), held flat beyond the ends' },
    { type: 'hy_rec_set', message0: 'SET %1 . %2 TO %3', args0: [txt('REC', 'Part'), txt('FIELD', 'weight'), sock('V')], inputsInline: true, ...stmt, colour: C.vars, tooltip: 'Record (struct): a named group of fields that each hold a value — e.g. Part.weight, Part.ok' },
    { type: 'hy_rec_get', message0: '%1 . %2', args0: [txt('REC', 'Part'), txt('FIELD', 'weight')], output: null, colour: C.vars, tooltip: 'A field of a record (0 if never set)' },
    // ===== control =====
    { type: 'hy_pid', message0: 'PID %1', args0: [txt('NAME', 'PID1')], message1: 'actual %1 set point %2', args1: [num('PV'), num('SP')], message2: 'Kp %1 Ti %2 s Td %3 s', args2: [num('KP'), num('TI'), num('TD')], message3: 'output %1 … %2  enable %3', args3: [num('LO'), num('HI'), bool('EN')], message4: '%1', args4: [dd('DIR', [['direct (output up when actual too low)', 'D'], ['reverse', 'R']])], ...stmt, colour: C.math, tooltip: 'PID controller with anti-windup and derivative on the measurement. Ti = 0: no integral. Disabled: output = low limit and the integral resets. Read it with “PID output”' },
    { type: 'hy_pid_out', message0: 'PID %1 output', args0: [hy('NAME', 'pid')], output: 'Number', colour: C.math },
    { type: 'hy_ramp', message0: 'RAMP to %1 at %2 per s', args0: [num('V'), num('R')], inputsInline: true, output: 'Number', colour: C.math, tooltip: 'Rate limiter: follows the target no faster than the rate (smooth valve opening, soft start)' },
    { type: 'hy_avg', message0: 'MOVING AVERAGE %1 over %2 scans', args0: [num('V'), fnum('N', 10, 1, 1000)], inputsInline: true, output: 'Number', colour: C.math },
    { type: 'hy_filter', message0: 'FILTER %1 time constant %2 s', args0: [num('V'), num('T')], inputsInline: true, output: 'Number', colour: C.math, tooltip: 'First-order low-pass (PT1) — smooths a noisy pressure or position' },
    { type: 'hy_blink', message0: 'BLINK on %1 s off %2 s', args0: [num('ON'), num('OFF')], inputsInline: true, output: 'Boolean', colour: C.timer, tooltip: 'Flasher for lamps and horns' },
    { type: 'hy_rtc', message0: 'clock %1', args0: [dd('WHAT', [['hour', 'H'], ['minute', 'M'], ['second', 'S'], ['weekday (1 = Mon)', 'WD'], ['day', 'D'], ['month', 'MO'], ['year', 'Y']])], output: 'Number', colour: C.timer, tooltip: 'Real-time clock: the computer clock at Run plus the program time' },
    { type: 'hy_rtc_between', message0: 'time of day from %1 to %2', args0: [txt('FROM', '06:00'), txt('TO', '22:00')], output: 'Boolean', colour: C.timer, tooltip: 'True between the two times (hh:mm); “22:00 to 06:00” spans midnight' },
    // ===== user function blocks =====
    { type: 'hy_fb_def', message0: 'FUNCTION BLOCK %1', args0: [txt('NAME', 'Valve_Ctl')], message1: 'inputs %1', args1: [txt('INS', 'cmd, fb_open')], message2: 'outputs %1', args2: [txt('OUTS', 'open, fault')], message3: '%1', args3: [body('STACK')], colour: C.my, tooltip: 'Your own block with named inputs and outputs. Each CALL with its own instance name keeps its own memory (timers, edges, steps, outputs). Up to 4 inputs; WAIT and DELAY are not allowed inside' },
    { type: 'hy_fb_in', message0: 'input %1', args0: [txt('NAME', 'cmd')], output: null, colour: C.my, tooltip: 'An input of the function block (inside FUNCTION BLOCK only)' },
    { type: 'hy_fb_out', message0: 'SET output %1 TO %2', args0: [txt('NAME', 'open'), sock('V')], inputsInline: true, ...stmt, colour: C.my, tooltip: 'Writes an output of the function block; it keeps its value between scans' },
    { type: 'hy_fb_call', message0: 'CALL %1 instance %2', args0: [hy('FB', 'fb'), txt('INST', 'V1')], ...fbIns, ...stmt, colour: C.my, extensions: ['hy_fb_labels'], tooltip: 'Runs one instance of a function block this scan' },
    { type: 'hy_fb_get', message0: '%1', args0: [hy('OUT', 'fbout')], output: null, colour: C.my, tooltip: 'An output of a function-block instance' },
    // ===== sequences: end, parallel branches, hold =====
    { type: 'hy_par', message0: 'PARALLEL %1', args0: [txt('NAME', 'P1')], message1: 'branch 1 %1', args1: [body('B1')], message2: 'branch 2 %1', args2: [body('B2')], message3: 'branch 3 %1', args3: [body('B3')], ...stmt, colour: C.step, tooltip: 'GRAFCET simultaneous branches: put a SEQUENCE in each branch. Every time this block starts running (e.g. its step becomes active) all branch sequences restart from their first step. End each branch with “go to END”, then wait for “all branches done”' },
    { type: 'hy_par_done', message0: 'all branches of %1 done', args0: [hy('NAME', 'par')], output: 'Boolean', colour: C.step, tooltip: 'True when every sequence inside the PARALLEL block has reached END (synchronisation)' },
    { type: 'hy_seq_done', message0: 'sequence %1 at END', args0: [hy('SEQ', 'seq')], output: 'Boolean', colour: C.step, tooltip: 'A step whose “go to” is END finishes its sequence; it stays there until RESET SEQUENCE or GO TO STEP' },
    { type: 'hy_seq_hold', message0: 'HOLD SEQUENCE %1 while %2', args0: [hy('SEQ', 'seq'), bool('COND')], inputsInline: true, ...stmt, colour: C.step, tooltip: 'Freezes the sequence on its step (actions keep running, transitions wait) — cycle stop, feed hold' },
    // ===== handshakes =====
    { type: 'hy_wait_to', message0: 'WAIT UNTIL %1 at most %2 s', args0: [bool('COND'), num('S')], message1: 'on timeout %1', args1: [body('DO')], ...stmt, colour: C.loop, tooltip: 'Like WAIT UNTIL, but gives up after the time and runs “on timeout”' },
    { type: 'hy_handshake', message0: 'HANDSHAKE request %1 acknowledge %2', args0: [hy('REQ', 'dout'), hy('ACK', 'din')], message1: 'timeout %1 s', args1: [num('S')], message2: 'on timeout %1', args2: [body('DO')], ...stmt, colour: C.loop, tooltip: 'Four-phase handshake: request ON → wait for acknowledge → request OFF → wait for acknowledge OFF. Pauses only this stack' },
    // ===== machine modes, alarm groups, safety =====
    { type: 'hy_mode_sel', message0: 'MODE SELECTOR', message1: 'AUTO %1', args1: [bool('AUTO')], message2: 'MANUAL %1', args2: [bool('MANUAL')], message3: 'SETUP %1', args3: [bool('SETUP')], message4: 'HOMING %1', args4: [bool('HOMING')], ...stmt, colour: C.reset, tooltip: 'Sets the machine mode from a selector switch: the true input chooses the mode; none true = keep the mode' },
    { type: 'hy_mode_set', message0: 'SET MODE %1', args0: [dd('MODE', MODES)], ...stmt, colour: C.reset },
    { type: 'hy_mode_is', message0: 'mode is %1', args0: [dd('MODE', MODES)], output: 'Boolean', colour: C.reset },
    { type: 'hy_alarm_group', message0: 'alarms %1 starting %2', args0: [dd('WHAT', [['any active', 'ACT'], ['any unacknowledged', 'UNACK'], ['fault active', 'FAULT']]), txt('PFX', 'F-')], output: 'Boolean', colour: C.text, tooltip: 'Alarm group by code prefix (empty = all alarms)' },
    { type: 'hy_alarm_count', message0: 'number of active alarms starting %1', args0: [txt('PFX', '')], output: 'Number', colour: C.text },
    { type: 'hy_alarm_ack', message0: 'ACKNOWLEDGE ALARMS starting %1', args0: [txt('PFX', '')], ...stmt, colour: C.text },
    { type: 'hy_twohand', message0: 'TWO-HAND %1 and %2 within %3 s', args0: [bool('A'), bool('B'), fnum('WIN', 0.5, 0.05, 5)], inputsInline: true, output: 'Boolean', colour: C.estop, tooltip: 'Two-hand control (EN ISO 13851 type III): true only while both are held after pressing them within the time; both must be released before the next start' },
    { type: 'hy_dualch', message0: 'DUAL CHANNEL %1 and %2 discrepancy %3 s', args0: [bool('A'), bool('B'), fnum('D', 0.2, 0.01, 10)], inputsInline: true, output: 'Boolean', colour: C.estop, tooltip: 'Two-channel safety input: true while both channels are true. If they disagree longer than the time it locks out (alarm F-DC) until both are false' },
    { type: 'hy_watchdog', message0: 'WATCHDOG %1 changes within %2 s', args0: [sock('V'), num('T')], inputsInline: true, output: 'Boolean', colour: C.estop, tooltip: 'True (expired) when the value has not changed for the time — heartbeat, stuck sensor, frozen encoder' },
    // ===== advanced blocks =====
    hat('hy_start', 'ON START  once at Run', C.ev, 'Runs once when Run is pressed — set start values and outputs here'),
    hat('hy_main', 'MAIN LOOP  every scan', C.ev, 'Runs every scan while the program runs (default every 10 ms)'),
    hat('hy_task', 'TASK %1  every scan', C.ev, 'A parallel stack: runs every scan after MAIN LOOP. A WAIT here pauses only this task', [{ type: 'field_input', name: 'NAME', text: 'Task 1' }]),
    hat('hy_estop', 'ON E-STOP  safe state', C.estop, 'Runs at once when the E-stop goes active; MAIN LOOP halts until Reset'),
    hat('hy_reset', 'ON RESET  after E-stop or fault', C.reset, 'Runs when Reset is given after an E-stop (released) or a fault'),
    hat('hy_fault', 'ON FAULT', C.fault, 'Runs when a runtime fault occurs (loop limit, division by zero …)'),
    { type: 'hy_comment', message0: '✎ %1', args0: [{ type: 'field_input', name: 'TEXT', text: 'note' }], ...stmt, colour: C.note, tooltip: 'A note — no effect on the program' },
    // logic
    { type: 'hy_xor', message0: '%1 XOR %2', args0: [bool('A'), bool('B')], inputsInline: true, output: 'Boolean', colour: C.logic, tooltip: 'True when exactly one side is true' },
    { type: 'hy_between', message0: '%1 BETWEEN %2 AND %3', args0: [num('V'), num('MIN'), num('MAX')], inputsInline: true, output: 'Boolean', colour: C.logic, tooltip: 'min ≤ value ≤ max' },
    // loops & waits
    { type: 'hy_wait', message0: 'WAIT UNTIL %1', args0: [bool('COND')], message1: 'stall alarm after %1 s', args1: [{ type: 'field_number', name: 'STALL', value: 0, min: 0 }], ...stmt, colour: C.loop, tooltip: 'Pauses only this stack until the condition is true (other stacks keep running). 0 s = program default' },
    { type: 'hy_delay', message0: 'DELAY %1 s', args0: [num('S')], inputsInline: true, ...stmt, colour: C.loop, tooltip: 'Pauses only this stack for the time given' },
    { type: 'hy_stop_prog', message0: 'STOP PROGRAM', previousStatement: null, colour: C.loop, tooltip: 'Stops the whole program (like the Stop button)' },
    // sequence (GRAFCET)
    { type: 'hy_seq', message0: 'SEQUENCE %1', args0: [{ type: 'field_input', name: 'NAME', text: 'AUTO' }], message1: '%1', args1: [{ type: 'input_statement', name: 'STEPS', check: 'Step' }], ...stmt, colour: C.step, tooltip: 'A GRAFCET sequence: one step active at a time; the first step is the initial step' },
    { type: 'hy_step', message0: 'STEP %1 %2', args0: [{ type: 'field_input', name: 'ID', text: 'S1' }, { type: 'field_input', name: 'LABEL', text: '' }], message1: 'do %1', args1: [{ type: 'input_statement', name: 'DO' }], message2: 'next when %1 go to %2', args2: [bool('T'), { type: 'field_input', name: 'GOTO', text: 'next' }], previousStatement: 'Step', nextStatement: 'Step', colour: C.step, tooltip: 'Its actions run every scan while the step is active. When the condition is true the sequence moves on (“next” = the step below; the last step returns to the first)' },
    { type: 'hy_step_time', message0: 'time in step (s)', output: 'Number', colour: C.step, tooltip: 'Seconds since this step became active' },
    { type: 'hy_step_active', message0: 'step %1 is active', args0: [hy('STEP', 'step')], output: 'Boolean', colour: C.step },
    { type: 'hy_goto', message0: 'GO TO STEP %1', args0: [hy('TO', 'step')], ...stmt, colour: C.step, tooltip: 'Jumps a sequence to a step (from the next scan)' },
    { type: 'hy_seq_reset', message0: 'RESET SEQUENCE %1', args0: [hy('SEQ', 'seq')], ...stmt, colour: C.step, tooltip: 'Back to the initial step' },
    // math
    { type: 'hy_mod', message0: '%1 MOD %2', args0: [num('A'), num('B')], inputsInline: true, output: 'Number', colour: C.math },
    { type: 'hy_minmax', message0: '%1 of %2 and %3', args0: [{ type: 'field_dropdown', name: 'OP', options: [['MIN', 'MIN'], ['MAX', 'MAX']] }, num('A'), num('B')], inputsInline: true, output: 'Number', colour: C.math },
    { type: 'hy_scale', message0: 'SCALE %1 from %2 … %3 to %4 … %5', args0: [num('V'), num('IMIN'), num('IMAX'), num('OMIN'), num('OMAX')], inputsInline: true, output: 'Number', colour: C.math, tooltip: 'Linear scaling, e.g. 4 … 20 mA to 0 … 250 bar' },
    { type: 'hy_limit', message0: 'LIMIT %1 between %2 and %3', args0: [num('V'), num('LO'), num('HI')], inputsInline: true, output: 'Number', colour: C.math },
    { type: 'hy_convert', message0: 'CONVERT %1 to %2', args0: [{ type: 'input_value', name: 'V' }, { type: 'field_dropdown', name: 'TO', options: [['INT', 'INT'], ['FLOAT', 'FLOAT'], ['BOOL', 'BOOL'], ['STRING', 'STRING']] }], inputsInline: true, output: null, colour: C.math },
    { type: 'hy_clock', message0: '%1', args0: [{ type: 'field_dropdown', name: 'WHAT', options: [['time since Run (s)', 'T'], ['scan time (s)', 'SCAN'], ['scan number', 'SCANNO']] }], output: 'Number', colour: C.math },
    // timers & counters
    { type: 'hy_for', message0: '%1 true for %2 s', args0: [bool('IN'), num('PT')], inputsInline: true, output: 'Boolean', colour: C.timer, tooltip: 'On-delay in one block: true once the input has been true for the time (resets when the input drops or the block stops running)' },
    { type: 'hy_timer', message0: '%1 TIMER %2', args0: [{ type: 'field_dropdown', name: 'KIND', options: [['TON on-delay', 'TON'], ['TOF off-delay', 'TOF'], ['TP pulse', 'TP']] }, { type: 'field_input', name: 'NAME', text: 'T1' }], message1: 'input %1', args1: [bool('IN')], message2: 'time %1 s', args2: [num('PT')], ...stmt, colour: C.timer, tooltip: 'IEC 61131-3 timer. Read it with “timer done (Q)” and “timer elapsed (ET)”' },
    { type: 'hy_timer_q', message0: 'timer %1 done', args0: [hy('NAME', 'timer')], output: 'Boolean', colour: C.timer },
    { type: 'hy_timer_et', message0: 'timer %1 elapsed (s)', args0: [hy('NAME', 'timer')], output: 'Number', colour: C.timer },
    { type: 'hy_counter', message0: '%1 COUNTER %2', args0: [{ type: 'field_dropdown', name: 'KIND', options: [['CTU count up', 'CTU'], ['CTD count down', 'CTD'], ['CTUD up / down', 'CTUD']] }, { type: 'field_input', name: 'NAME', text: 'C1' }], message1: 'count up %1', args1: [bool('UP')], message2: 'count down %1', args2: [bool('DOWN')], message3: 'reset %1', args3: [bool('RESET')], message4: 'load preset %1', args4: [bool('LOAD')], message5: 'preset %1', args5: [num('PV')], ...stmt, colour: C.timer, tooltip: 'Counts rising edges. CTU done when count ≥ preset; CTD done when count ≤ 0' },
    { type: 'hy_counter_q', message0: 'counter %1 done', args0: [hy('NAME', 'counter')], output: 'Boolean', colour: C.timer },
    { type: 'hy_counter_cv', message0: 'counter %1 value', args0: [hy('NAME', 'counter')], output: 'Number', colour: C.timer },
    { type: 'hy_counter_reset', message0: 'RESET COUNTER %1', args0: [hy('NAME', 'counter')], ...stmt, colour: C.timer },
    { type: 'hy_edge', message0: '%1 EDGE of %2', args0: [{ type: 'field_dropdown', name: 'EDGE', options: [['RISING', 'RISING'], ['FALLING', 'FALLING']] }, bool('IN')], inputsInline: true, output: 'Boolean', colour: C.timer, tooltip: 'True for one scan when the input changes' },
    // variables (declared in the Variables tab, typed)
    { type: 'hy_var_get', message0: '%1', args0: [hy('VAR', 'var')], output: null, colour: C.vars },
    { type: 'hy_var_set', message0: 'SET %1 TO %2', args0: [hy('VAR', 'var'), { type: 'input_value', name: 'V' }], inputsInline: true, ...stmt, colour: C.vars },
    { type: 'hy_var_change', message0: 'CHANGE %1 BY %2', args0: [hy('VAR', 'var'), num('D')], inputsInline: true, ...stmt, colour: C.vars },
    { type: 'hy_latch', message0: 'LATCH %1', args0: [hy('VAR', 'var')], message1: 'set %1', args1: [bool('S')], message2: 'reset %1', args2: [bool('R')], message3: '%1', args3: [{ type: 'field_dropdown', name: 'MODE', options: [['set wins', 'SET'], ['reset wins', 'RESET']] }], ...stmt, colour: C.vars, tooltip: 'Set / reset latch (SR / RS) on a BOOL variable' },
    // I/O (component-linked)
    { type: 'hy_in', message0: '%1', args0: [hy('SIG', 'din')], output: 'Boolean', colour: C.io, tooltip: 'A digital input: PLC input, pressure switch …' },
    { type: 'hy_cyl', message0: '%1 is %2', args0: [hy('CYL', 'cyl'), { type: 'field_dropdown', name: 'END', options: [['extended +', 'p'], ['retracted −', 'm']] }], output: 'Boolean', colour: C.io, tooltip: 'Cylinder end position, from the hydraulic simulation' },
    { type: 'hy_analog', message0: '%1', args0: [hy('SIG', 'ain')], output: 'Number', colour: C.io, tooltip: 'An analog value: position (mm), speed, pressure (bar) …' },
    { type: 'hy_out', message0: 'SET OUTPUT %1 TO %2', args0: [hy('SIG', 'dout'), { type: 'field_dropdown', name: 'VAL', options: [['ON', '1'], ['OFF', '0']] }], ...stmt, colour: C.io, tooltip: 'Writes a stored (latched) digital output — it keeps its value until written again' },
    { type: 'hy_act', message0: 'ACTIVATE %1 while here', args0: [hy('SIG', 'dout')], ...stmt, colour: C.io, tooltip: 'Output is ON only in scans where this block runs — inside a STEP: ON while the step is active (GRAFCET action)' },
    { type: 'hy_outs_off', message0: 'ALL OUTPUTS OFF', ...stmt, colour: C.io },
    { type: 'hy_out_state', message0: 'output %1 is ON', args0: [hy('SIG', 'dout')], output: 'Boolean', colour: C.io },
    { type: 'hy_aout', message0: 'SET ANALOG %1 TO %2', args0: [hy('SIG', 'aout'), num('V')], inputsInline: true, ...stmt, colour: C.io, tooltip: 'Proportional valve or pump command, 0 … 100 %' },
    // text, messages, alarms
    { type: 'hy_join', message0: 'JOIN %1 %2', args0: [{ type: 'input_value', name: 'A' }, { type: 'input_value', name: 'B' }], inputsInline: true, output: 'String', colour: C.text },
    { type: 'hy_message', message0: 'SHOW MESSAGE %1', args0: [{ type: 'input_value', name: 'TEXT' }], ...stmt, colour: C.text, tooltip: 'Operator message line (Controller and operator panel)' },
    { type: 'hy_alarm', message0: 'ALARM %1 %2 %3', args0: [{ type: 'field_input', name: 'CODE', text: 'W-101' }, { type: 'field_dropdown', name: 'SEV', options: [['warning', 'W'], ['fault', 'F'], ['info', 'I']] }, { type: 'field_input', name: 'TEXT', text: 'message' }], message1: 'while %1', args1: [bool('COND')], ...stmt, colour: C.text, tooltip: 'Active while the condition is true; logged with time in the alarm list' }
  ]);
  // HYDRA colours for Blockly's own blocks
  const st = (c: string) => ({ colourPrimary: c });
  (BL as any).hydraTheme = B.Theme.defineTheme('hydra', {
    name: 'hydra', base: B.Themes.Classic,
    blockStyles: { logic_blocks: st(C.logic), loop_blocks: st(C.loop), math_blocks: st(C.math), text_blocks: st(C.text), procedure_blocks: st(C.my), variable_blocks: st(C.my), list_blocks: st(C.my), colour_blocks: st(C.my) },
    categoryStyles: {},
    componentStyles: { workspaceBackgroundColour: '#FFFFFF', toolboxBackgroundColour: '#F7F9FB', toolboxForegroundColour: '#1B2633', flyoutBackgroundColour: '#EEF2F6', flyoutForegroundColour: '#1B2633', flyoutOpacity: 1, scrollbarColour: '#C9D3DE', scrollbarOpacity: 0.9, insertionMarkerColour: '#0A64C2', insertionMarkerOpacity: 0.35, cursorColour: '#0A64C2' },
    fontStyle: { family: "'IBM Plex Sans', Arial, sans-serif", weight: '600', size: 11 }, startHats: false
  });
  // Ctrl+Z / Ctrl+Y go through HYDRA's Edit menu (which forwards to the open program)
  try { B.ShortcutRegistry.registry.unregister('undo'); B.ShortcutRegistry.registry.unregister('redo'); } catch { }
  return BL;
}

// ---------- the toolbox (left edge of the canvas) ----------
const blk = (type: string, extra: any = {}) => ({ kind: 'block', type, ...extra });
const N = (v: number) => ({ shadow: { type: 'math_number', fields: { NUM: v } } });
export function toolbox() {
  const cat = (name: string, colour: string, contents: any[], extra: any = {}) => ({ kind: 'category', name, colour, contents, ...extra });
  const step = (id: string, label: string) => ({ type: 'hy_step', fields: { ID: id, LABEL: label, GOTO: 'next' } });
  return {
    kind: 'categoryToolbox', contents: [
      cat('Program', C.ev, [blk('hy_main'), blk('hy_start'), blk('hy_estop', { next: { block: { type: 'hy_outs_off' } } }), blk('hy_reset'), blk('hy_fault'), blk('hy_task'), blk('hy_comment')]),
      cat('Logic', C.logic, [blk('controls_if'), blk('controls_if', { extraState: { hasElse: true } }), blk('logic_compare', { inputs: { A: N(0), B: N(0) } }), blk('logic_operation'), blk('logic_negate'), blk('logic_boolean'), blk('hy_xor'), blk('hy_between', { inputs: { V: N(0), MIN: N(0), MAX: N(10) } }),
        { kind: 'label', text: 'Compare & select' }, blk('hy_window', { inputs: { C: N(100), TOL: N(5) } }), blk('hy_hyst', { inputs: { ON: N(180), OFF: N(160) } }), blk('hy_sel'), blk('hy_mux', { inputs: { K: N(0) } })]),
      cat('Loops & Waits', C.loop, [blk('hy_wait'), blk('hy_delay', { inputs: { S: N(1) } }), blk('controls_repeat_ext', { inputs: { TIMES: N(3) } }), blk('controls_whileUntil', { fields: { MODE: 'UNTIL' } }), blk('hy_stop_prog'),
        { kind: 'label', text: 'Handshakes' }, blk('hy_wait_to', { inputs: { S: N(5) } }), blk('hy_handshake', { inputs: { S: N(5) } })]),
      cat('Sequence Steps', C.step, [blk('hy_seq', { inputs: { STEPS: { block: { ...step('S0', 'Home'), next: { block: step('S1', '') } } } } }), blk('hy_step', { fields: { ID: 'S2', LABEL: '', GOTO: 'next' } }), blk('hy_step', { fields: { ID: 'S9', LABEL: 'done', GOTO: 'END' } }), blk('hy_step_time'), blk('logic_compare', { fields: { OP: 'GTE' }, inputs: { A: { block: { type: 'hy_step_time' } }, B: N(2) } }), blk('hy_step_active'), blk('hy_goto'), blk('hy_seq_reset'),
        { kind: 'label', text: 'Nested & parallel' }, blk('hy_par'), blk('hy_par_done'), blk('hy_seq_done'), blk('hy_seq_hold')]),
      cat('Timers & Counters', C.timer, [blk('hy_for', { inputs: { PT: N(2) } }), blk('hy_timer', { inputs: { PT: N(2) } }), blk('hy_timer_q'), blk('hy_timer_et'), blk('hy_counter', { inputs: { PV: N(10) } }), blk('hy_counter_q'), blk('hy_counter_cv'), blk('hy_counter_reset'), blk('hy_edge'),
        { kind: 'label', text: 'Clock' }, blk('hy_blink', { inputs: { ON: N(0.5), OFF: N(0.5) } }), blk('hy_rtc'), blk('hy_rtc_between')]),
      cat('Math', C.math, [blk('math_number'), blk('math_arithmetic', { inputs: { A: N(1), B: N(1) } }), blk('math_single'), blk('math_round'), blk('hy_mod'), blk('hy_minmax'), blk('hy_scale', { inputs: { IMIN: N(4), IMAX: N(20), OMIN: N(0), OMAX: N(250) } }), blk('hy_limit', { inputs: { LO: N(0), HI: N(100) } }), blk('hy_convert'), blk('hy_clock')]),
      cat('Control', C.math, [blk('hy_pid', { inputs: { SP: N(100), KP: N(1), TI: N(2), TD: N(0), LO: N(0), HI: N(100), EN: { shadow: { type: 'logic_boolean', fields: { BOOL: 'TRUE' } } } } }), blk('hy_pid_out'), blk('hy_ramp', { inputs: { R: N(10) } }), blk('hy_filter', { inputs: { T: N(0.5) } }), blk('hy_avg'), blk('hy_deadband', { inputs: { D: N(1) } })]),
      cat('Bits & Words', C.logic, [blk('hy_bitop', { inputs: { A: N(0), B: N(255) } }), blk('hy_wnot', { inputs: { A: N(0) } }), blk('hy_shift', { inputs: { A: N(1), N: N(1) } }), blk('hy_bit_get', { inputs: { N: N(0) } }), blk('hy_bit_set', { inputs: { A: N(0), N: N(0) } }), { kind: 'label', text: 'Shift register' }, blk('hy_shreg'), blk('hy_shreg_bit', { inputs: { I: N(0) } })]),
      cat('Arrays & Tables', C.vars, [blk('hy_array'), blk('hy_arr_get', { inputs: { I: N(1) } }), blk('hy_arr_set', { inputs: { I: N(1), V: N(0) } }), blk('hy_arr_fill', { inputs: { V: N(0) } }), blk('hy_arr_stat'), blk('hy_table'), { kind: 'label', text: 'Records (structs)' }, blk('hy_rec_set'), blk('hy_rec_get')]),
      cat('Variables', C.vars, [{ kind: 'button', text: 'New variable…', callbackKey: 'hyNewVar' }, blk('hy_var_get'), blk('hy_var_set'), blk('hy_var_change', { inputs: { D: N(1) } }), blk('hy_latch')]),
      cat('I/O', C.io, [{ kind: 'label', text: 'Inputs' }, blk('hy_in'), blk('hy_cyl'), blk('hy_analog'), { kind: 'label', text: 'Outputs' }, blk('hy_out'), blk('hy_act'), blk('hy_outs_off'), blk('hy_out_state'), blk('hy_aout', { inputs: { V: N(50) } })]),
      cat('Modes & Safety', C.reset, [blk('hy_mode_sel'), blk('hy_mode_set'), blk('hy_mode_is'), { kind: 'label', text: 'Safety' }, blk('hy_twohand'), blk('hy_dualch'), blk('hy_watchdog', { inputs: { T: N(2) } })]),
      cat('Text & Alarms', C.text, [blk('text'), blk('hy_join'), blk('hy_message', { inputs: { TEXT: { shadow: { type: 'text', fields: { TEXT: 'Press START' } } } } }), blk('hy_alarm'), { kind: 'label', text: 'Alarm groups' }, blk('hy_alarm_group'), blk('hy_alarm_count'), blk('hy_alarm_ack')]),
      cat('Function Blocks', C.my, [blk('hy_fb_def', { inputs: { STACK: { block: { type: 'hy_fb_out', fields: { NAME: 'open' }, inputs: { V: { block: { type: 'hy_fb_in', fields: { NAME: 'cmd' } } } } } } } }), blk('hy_fb_in'), blk('hy_fb_out'), blk('hy_fb_call'), blk('hy_fb_get')]),
      cat('My Blocks', C.my, [], { custom: 'PROCEDURE' })
    ]
  };
}

export { defaultWorkspace } from './compile';
