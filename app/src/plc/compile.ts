// Logic Coder: compiles a Blockly workspace (its saved JSON, so no Blockly is needed here) into a PLC program.
// Every top-level stack becomes a generator: WAIT UNTIL and DELAY yield, which pauses only that stack until a later
// scan (non-blocking). Before every statement the program calls $.s(id) — that records live highlighting and
// stops at breakpoints. The same walk produces the rule check.
import type { SigTable } from './signals';
export const FB_IO = 4; // inputs per function block
export const listOf = (s: any) => String(s ?? '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);

export type Var = { id: string; name: string; type: 'BOOL' | 'INT' | 'FLOAT' | 'TIME' | 'STRING'; init: string; comment?: string };
export type Program = { id: string; name: string; language?: string; ws?: any; sheet?: string; vars?: Var[]; scanMs?: number; active?: boolean; estop?: string; estopNc?: boolean; loopLimit?: number; stall?: number; comment?: string; code?: string };
export type PIssue = { level: 'err' | 'warn' | 'info' | 'ok'; text: string; block?: string };
export type Compiled = { ok: boolean; issues: PIssue[]; js: string; fn: ((rt: any) => any) | null; hats: Record<string, string[]>; conds: Record<string, string>; seqs: SeqInfo[]; timers: string[]; counters: string[]; used: Set<string>; stmts: number };
export type SeqInfo = { name: string; block: string; steps: { id: string; label: string; block: string; next: string; cond: string }[] };

export const HATS: Record<string, string> = { hy_start: 'ON START', hy_main: 'MAIN LOOP', hy_task: 'TASK', hy_estop: 'ON E-STOP', hy_reset: 'ON RESET', hy_fault: 'ON FAULT' };
export const ENTRY_ORDER = ['hy_start', 'hy_main', 'hy_estop', 'hy_reset', 'hy_fault'];
const Q = JSON.stringify;
const syn = new WeakMap<object, string>(); let synN = 0;
const ID = (b: any): string => b?.id || syn.get(b) || (syn.set(b, 'g' + (++synN)), syn.get(b)!);
const kid = (b: any, name: string) => b?.inputs?.[name]?.block || b?.inputs?.[name]?.shadow || null;
const fld = (b: any, name: string) => { const v = b?.fields?.[name]; return v && typeof v === 'object' ? v.id ?? v.name : v; };
export const topBlocks = (ws: any): any[] => ws?.blocks?.blocks || [];
export function walk(b: any, f: (b: any) => void) { if (!b) return; f(b); Object.values(b.inputs || {}).forEach((i: any) => { walk(i.block, f); if (i.shadow && !i.block) walk(i.shadow, f); }); walk(b.next?.block, f); }

export function compile(prog: Program, t: SigTable): Compiled {
  const issues: PIssue[] = []; const used = new Set<string>(); const conds: Record<string, string> = {}; const seqs: SeqInfo[] = [];
  const err = (text: string, block?: string) => issues.push({ level: 'err', text, block });
  const warn = (text: string, block?: string) => issues.push({ level: 'warn', text, block });
  const vars = new Map((prog.vars || []).map(v => [v.id, v])); const varUsed = new Set<string>();
  const tops = topBlocks(prog.ws); const bvars = new Map<string, string>((prog.ws?.variables || []).map((v: any) => [v.id, v.name]));
  // names declared by timer / counter blocks, step ids per sequence
  const timers = new Set<string>(), counters = new Set<string>(); const seqSteps = new Map<string, Set<string>>();
  const arrays = new Map<string, { size: number; init: number }>(), sregs = new Set<string>(), pids = new Set<string>(), pars = new Map<string, string[]>();
  const fbs = new Map<string, { ins: string[]; outs: string[]; block: any }>(), fbInst = new Map<string, string>();
  tops.forEach(tb => walk(tb, b => {
    if (b.type === 'hy_timer') { const n = String(fld(b, 'NAME') || '').trim(); if (timers.has(n)) err(`Timer ${n} is declared twice — give each timer its own name`, ID(b)); timers.add(n); }
    if (b.type === 'hy_counter') { const n = String(fld(b, 'NAME') || '').trim(); if (counters.has(n)) err(`Counter ${n} is declared twice`, ID(b)); counters.add(n); }
    if (b.type === 'hy_seq') { const n = String(fld(b, 'NAME') || '').trim(); const s = new Set<string>(); let st = kid(b, 'STEPS'); while (st) { if (st.type === 'hy_step') { const id = String(fld(st, 'ID') || '').trim(); if (s.has(id)) err(`Sequence ${n}: step ${id} exists twice`, st.id); if (id.toUpperCase() === 'END') err(`Sequence ${n}: END is reserved — give the step another name`, st.id); s.add(id); } st = st.next?.block; } if (seqSteps.has(n)) err(`Two sequences are called ${n}`, ID(b)); seqSteps.set(n, s); }
    if (b.type === 'hy_array') { const n = String(fld(b, 'NAME') || '').trim(); if (!n) err('Array: give it a name', ID(b)); else if (arrays.has(n)) err(`Two arrays are called ${n}`, ID(b)); arrays.set(n, { size: Math.max(1, Math.min(10000, Math.trunc(+fld(b, 'SIZE') || 1))), init: +fld(b, 'INIT') || 0 }); }
    if (b.type === 'hy_shreg') { const n = String(fld(b, 'NAME') || '').trim(); if (sregs.has(n)) err(`Two shift registers are called ${n}`, ID(b)); sregs.add(n); }
    if (b.type === 'hy_pid') { const n = String(fld(b, 'NAME') || '').trim(); if (pids.has(n)) err(`Two PID blocks are called ${n}`, ID(b)); pids.add(n); }
    if (b.type === 'hy_par') { const n = String(fld(b, 'NAME') || '').trim(); if (pars.has(n)) err(`Two PARALLEL blocks are called ${n}`, ID(b)); const l: string[] = []; ['B1', 'B2', 'B3'].forEach(k => walk(kid(b, k), x => { if (x.type === 'hy_seq') l.push(String(fld(x, 'NAME') || '').trim()); })); pars.set(n, l); }
    if (b.type === 'hy_fb_call') { const inst = String(fld(b, 'INST') || '').trim(), f = String(fld(b, 'FB') || ''); const was = fbInst.get(inst); if (was && was !== f) err(`Instance ${inst} is used for two different function blocks (${was}, ${f})`, ID(b)); fbInst.set(inst, f); }
  }));
  tops.filter(b => b.type === 'hy_fb_def').forEach(b => { const nm = String(fld(b, 'NAME') || '').trim(); if (!/^[A-Za-z_]\w*$/.test(nm)) err(`Function block name “${nm}”: letters, digits and _ only`, ID(b)); if (fbs.has(nm)) err(`Two function blocks are called ${nm}`, ID(b));
    const ins = listOf(fld(b, 'INS')), outs = listOf(fld(b, 'OUTS')); if (ins.length > FB_IO) err(`Function block ${nm}: at most ${FB_IO} inputs`, ID(b)); if (new Set([...ins, ...outs]).size < ins.length + outs.length) err(`Function block ${nm}: an input or output name is used twice`, ID(b));
    fbs.set(nm, { ins: ins.slice(0, FB_IO), outs, block: b }); });
  let stmts = 0, loopN = 0, hatN = 0, dcN = 0; let curSeq: string | null = null; let procArgs: string[] = []; let curFb: { name: string; ins: string[]; outs: string[] } | null = null;
  const noWaitInFb = (b: any) => { if (curFb) err(`${HUMAN[b.type]}: not allowed inside a FUNCTION BLOCK (it must finish in one scan)`, ID(b)); };
  const named = (b: any, f: string, set: { has(k: string): boolean }, what: string) => { const n = String(fld(b, f) || '').trim(); if (!set.has(n)) err(`${what} ${n || '?'} does not exist`, ID(b)); return n; };
  const hhmm = (s: string, b: any) => { const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(s || '').trim()); if (!m || +m[1] > 24 || +m[2] > 59) { err(`Time of day “${s}”: write hh:mm, e.g. 06:30`, ID(b)); return 0; } return +m[1] * 60 + +m[2]; };
  const sigOk = (id: string, dir: string[], b: any, what: string) => {
    if (!id) { err(`${what}: choose a signal`, ID(b)); return false; }
    const s = t.byId.get(id); if (!s) { err(`${what}: missing component (the part was deleted or its sheet removed) — pick a replacement`, ID(b)); return false; }
    if (!dir.includes(s.dir)) { err(`${what}: ${s.tag} is ${s.dir === 'in' || s.dir === 'ain' ? 'an input — a program cannot write to it' : 'an output'}`, ID(b)); return false; }
    used.add(id); return true;
  };
  const cylOk = (id: string, b: any) => { if (!t.cylById.get(id)) { err(id ? 'Cylinder: missing component — pick a replacement' : 'Cylinder: choose one', ID(b)); return false; } used.add(id); return true; };
  const varOf = (id: string, b: any) => { const v = vars.get(id); if (!v) { err(id ? 'Variable no longer exists — pick another' : 'Choose a variable', ID(b)); return null; } varUsed.add(id); return v; };
  const empty = (b: any, name: string, def: string, what = 'socket') => { warn(`${HUMAN[b.type] || b.type}: empty ${what} (${name.toLowerCase()}) — uses ${def}`, ID(b)); return def; };

  // ---------- expressions ----------
  const V = (b: any, name: string, def: 'b' | 'n' | 's' = 'n'): string => { const c = kid(b, name); if (!c) return empty(b, name, def === 'b' ? 'false' : def === 's' ? '""' : '0'); return X(c); };
  const X = (b: any): string => {
    switch (b.type) {
      case 'logic_boolean': return fld(b, 'BOOL') === 'TRUE' ? 'true' : 'false';
      case 'logic_negate': return `!$.b(${V(b, 'BOOL', 'b')})`;
      case 'logic_operation': return `($.b(${V(b, 'A', 'b')}) ${fld(b, 'OP') === 'OR' ? '||' : '&&'} $.b(${V(b, 'B', 'b')}))`;
      case 'hy_xor': return `($.b(${V(b, 'A', 'b')}) !== $.b(${V(b, 'B', 'b')}))`;
      case 'logic_compare': return `$.cmp(${Q(fld(b, 'OP'))}, ${V(b, 'A')}, ${V(b, 'B')})`;
      case 'hy_between': return `$.btw(${V(b, 'V')}, ${V(b, 'MIN')}, ${V(b, 'MAX')})`;
      case 'math_number': return String(+fld(b, 'NUM') || 0);
      case 'math_arithmetic': { const op = fld(b, 'OP'); const a = V(b, 'A'), c = V(b, 'B'); return op === 'DIVIDE' ? `$.div(${a}, ${c}, ${Q(ID(b))})` : op === 'POWER' ? `Math.pow($.n(${a}), $.n(${c}))` : `($.n(${a}) ${({ ADD: '+', MINUS: '-', MULTIPLY: '*' } as any)[op]} $.n(${c}))`; }
      case 'math_single': { const a = `$.n(${V(b, 'NUM')})`; return ({ ROOT: `$.sqrt(${a}, ${Q(ID(b))})`, ABS: `Math.abs(${a})`, NEG: `(-${a})`, LN: `Math.log(${a})`, LOG10: `Math.log10(${a})`, EXP: `Math.exp(${a})`, POW10: `Math.pow(10, ${a})` } as any)[fld(b, 'OP')] || a; }
      case 'math_round': { const a = `$.n(${V(b, 'NUM')})`; return ({ ROUND: `Math.round(${a})`, ROUNDUP: `Math.ceil(${a})`, ROUNDDOWN: `Math.floor(${a})` } as any)[fld(b, 'OP')] || a; }
      case 'hy_mod': return `$.mod(${V(b, 'A')}, ${V(b, 'B')}, ${Q(ID(b))})`;
      case 'hy_minmax': return `Math.${fld(b, 'OP') === 'MAX' ? 'max' : 'min'}($.n(${V(b, 'A')}), $.n(${V(b, 'B')}))`;
      case 'hy_scale': return `$.scale(${V(b, 'V')}, ${V(b, 'IMIN')}, ${V(b, 'IMAX')}, ${V(b, 'OMIN')}, ${V(b, 'OMAX')})`;
      case 'hy_limit': return `$.limit(${V(b, 'V')}, ${V(b, 'LO')}, ${V(b, 'HI')})`;
      case 'hy_convert': return `$.conv(${V(b, 'V')}, ${Q(fld(b, 'TO'))})`;
      case 'text': return Q(String(fld(b, 'TEXT') ?? ''));
      case 'hy_join': return `(String(${V(b, 'A', 's')}) + String(${V(b, 'B', 's')}))`;
      case 'hy_var_get': { const v = varOf(fld(b, 'VAR'), b); return v ? `$.v[${Q(v.id)}]` : '0'; }
      case 'variables_get': { const nm = bvars.get(fld(b, 'VAR')) || ''; if (!procArgs.includes(nm)) { err(`“${nm}” is a function argument — use it inside its function only`, ID(b)); return '0'; } return 'A_' + safeId(nm); }
      case 'hy_in': { const id = fld(b, 'SIG'); return sigOk(id, ['in'], b, 'Read input') ? `$.i(${Q(id)})` : 'false'; }
      case 'hy_out_state': { const id = fld(b, 'SIG'); return sigOk(id, ['out'], b, 'Output state') ? `$.o(${Q(id)})` : 'false'; }
      case 'hy_cyl': { const id = fld(b, 'CYL'); return cylOk(id, b) ? `$.cyl(${Q(id)}, ${Q(fld(b, 'END'))})` : 'false'; }
      case 'hy_analog': { const id = fld(b, 'SIG'); return sigOk(id, ['ain'], b, 'Read analog') ? `$.a(${Q(id)})` : '0'; }
      case 'hy_timer_q': case 'hy_timer_et': { const n = String(fld(b, 'NAME') || ''); if (!timers.has(n)) err(`Timer ${n || '?'} is not declared — add a TIMER block with this name`, ID(b)); return `$.T(${Q(n)}).${b.type === 'hy_timer_q' ? 'Q' : 'ET'}`; }
      case 'hy_counter_q': case 'hy_counter_cv': { const n = String(fld(b, 'NAME') || ''); if (!counters.has(n)) err(`Counter ${n || '?'} is not declared — add a COUNTER block with this name`, ID(b)); return `$.C(${Q(n)}).${b.type === 'hy_counter_q' ? 'Q' : 'CV'}`; }
      case 'hy_for': return `$.ton(${Q(ID(b))}, ${V(b, 'IN', 'b')}, ${V(b, 'PT')})`;
      case 'hy_edge': return `$.edge(${Q(ID(b))}, ${Q(fld(b, 'EDGE'))}, ${V(b, 'IN', 'b')})`;
      case 'hy_step_active': { const [sq, st] = String(fld(b, 'STEP') || '/').split('/'); if (!seqSteps.get(sq)?.has(st)) err(`Step ${st || '?'} of sequence ${sq || '?'} does not exist`, ID(b)); return `$.isStep(${Q(sq)}, ${Q(st)})`; }
      case 'hy_step_time': if (!curSeq) { warn('Time in step: only works inside a STEP (gives 0 here)', ID(b)); return '0'; } return `$.stepT(${Q(curSeq)})`;
      case 'hy_clock': return fld(b, 'WHAT') === 'SCAN' ? '$.dt' : fld(b, 'WHAT') === 'SCANNO' ? '$.scanNo' : '$.t';
      case 'procedures_callreturn': return `(yield* ${callProc(b)})`;
      // ----- 8d -----
      case 'hy_window': return `$.win(${V(b, 'V')}, ${V(b, 'C')}, ${V(b, 'TOL')})`;
      case 'hy_hyst': return `$.hyst(${Q(ID(b))}, ${V(b, 'V')}, ${V(b, 'ON')}, ${V(b, 'OFF')})`;
      case 'hy_deadband': return `$.dband(${V(b, 'V')}, ${V(b, 'D')})`;
      case 'hy_sel': return `($.b(${V(b, 'G', 'b')}) ? ${V(b, 'A')} : ${V(b, 'B')})`;
      case 'hy_mux': return `$.mux(${V(b, 'K')}, [${[0, 1, 2, 3].map(i => kid(b, 'IN' + i) ? X(kid(b, 'IN' + i)) : '0').join(', ')}], ${Q(ID(b))})`;
      case 'hy_bitop': return `$.bop(${Q(fld(b, 'OP'))}, ${V(b, 'A')}, ${V(b, 'B')})`;
      case 'hy_wnot': return `$.wnot(${V(b, 'A')})`;
      case 'hy_shift': return `$.shf(${Q(fld(b, 'OP'))}, ${V(b, 'A')}, ${V(b, 'N')})`;
      case 'hy_bit_get': return `$.bget(${V(b, 'A')}, ${V(b, 'N')})`;
      case 'hy_bit_set': return `$.bset(${V(b, 'A')}, ${V(b, 'N')}, $.b(${V(b, 'V', 'b')}))`;
      case 'hy_shreg_bit': return `$.sbit(${Q(named(b, 'NAME', sregs, 'Shift register'))}, ${V(b, 'I')})`;
      case 'hy_arr_get': return `$.arrGet(${Q(named(b, 'NAME', arrays, 'Array'))}, ${V(b, 'I')}, ${Q(ID(b))})`;
      case 'hy_arr_stat': return `$.arrStat(${Q(named(b, 'NAME', arrays, 'Array'))}, ${Q(fld(b, 'OP'))})`;
      case 'hy_table': { const xs = listOf(fld(b, 'XS')).map(Number), ys = listOf(fld(b, 'YS')).map(Number);
        if (xs.length < 2 || xs.length !== ys.length || xs.some(isNaN) || ys.some(isNaN)) err('TABLE: give the same number (2 or more) of x and y values, separated by commas', ID(b));
        else if (xs.some((x, i) => i && x <= xs[i - 1])) err('TABLE: x values must rise from left to right', ID(b));
        return `$.tbl(${V(b, 'X')}, ${Q(xs)}, ${Q(ys)})`; }
      case 'hy_rec_get': return `$.recGet(${Q(String(fld(b, 'REC') || '').trim())}, ${Q(String(fld(b, 'FIELD') || '').trim())})`;
      case 'hy_pid_out': return `$.pidOut(${Q(named(b, 'NAME', pids, 'PID'))})`;
      case 'hy_ramp': return `$.ramp(${Q(ID(b))}, ${V(b, 'V')}, ${V(b, 'R')})`;
      case 'hy_avg': return `$.mavg(${Q(ID(b))}, ${V(b, 'V')}, ${Math.max(1, Math.min(1000, Math.trunc(+fld(b, 'N') || 1)))})`;
      case 'hy_filter': return `$.pt1(${Q(ID(b))}, ${V(b, 'V')}, ${V(b, 'T')})`;
      case 'hy_blink': return `$.blink(${V(b, 'ON')}, ${V(b, 'OFF')})`;
      case 'hy_rtc': return `$.rtc(${Q(fld(b, 'WHAT'))})`;
      case 'hy_rtc_between': return `$.rtcBtw(${hhmm(fld(b, 'FROM'), b)}, ${hhmm(fld(b, 'TO'), b)})`;
      case 'hy_fb_in': { const nm = String(fld(b, 'NAME') || '').trim(); if (!curFb) { err('Function-block input: use it inside a FUNCTION BLOCK', ID(b)); return '0'; } if (!curFb.ins.includes(nm)) err(`${curFb.name} has no input ${nm || '?'} (inputs: ${curFb.ins.join(', ') || 'none'})`, ID(b)); return `(I[${Q(nm)}] ?? 0)`; }
      case 'hy_fb_get': { const [inst, out] = String(fld(b, 'OUT') || '/').split('/'); const f = fbInst.get(inst); if (!f) err(`Function-block instance ${inst || '?'} is not called anywhere`, ID(b)); else if (!fbs.get(f)?.outs.includes(out)) err(`${f} has no output ${out || '?'}`, ID(b)); return `$.fbget(${Q(inst)}, ${Q(out)})`; }
      case 'hy_par_done': { const n = String(fld(b, 'NAME') || '').trim(); if (!pars.has(n)) err(`PARALLEL ${n || '?'} does not exist`, ID(b)); else if (!pars.get(n)!.length) warn(`PARALLEL ${n} has no SEQUENCE in its branches`, ID(b)); return `$.parDone(${Q(pars.get(n) || [])})`; }
      case 'hy_seq_done': return `$.seqDone(${Q(named(b, 'SEQ', seqSteps, 'Sequence'))})`;
      case 'hy_mode_is': return `$.modeIs(${Q(fld(b, 'MODE'))})`;
      case 'hy_alarm_group': return `$.agrp(${Q(String(fld(b, 'PFX') ?? '').trim())}, ${Q(fld(b, 'WHAT'))})`;
      case 'hy_alarm_count': return `$.acount(${Q(String(fld(b, 'PFX') ?? '').trim())})`;
      case 'hy_twohand': return `$.twohand(${Q(ID(b))}, $.b(${V(b, 'A', 'b')}), $.b(${V(b, 'B', 'b')}), ${+fld(b, 'WIN') || 0.5})`;
      case 'hy_dualch': { const code = 'F-DC' + (++dcN); return `$.dualch(${Q(ID(b))}, $.b(${V(b, 'A', 'b')}), $.b(${V(b, 'B', 'b')}), ${+fld(b, 'D') || 0.2}, ${Q(code)}, ${Q(`Dual-channel discrepancy: ${desc(kid(b, 'A'))} / ${desc(kid(b, 'B'))}`)})`; }
      case 'hy_watchdog': return `$.wdog(${Q(ID(b))}, ${V(b, 'V')}, ${V(b, 'T')})`;
      default: err(`Unknown block ${b.type}`, ID(b)); return '0';
    }
  };
  const safeId = (s: string) => String(s).replace(/[^\w]/g, '_');
  const procs = new Map<string, any>(); tops.filter(b => b.type === 'procedures_defnoreturn' || b.type === 'procedures_defreturn').forEach(b => { const nm = String(fld(b, 'NAME')); if (procs.has(nm)) err(`Two functions are called ${nm}`, ID(b)); procs.set(nm, b); });
  const callProc = (b: any) => { const nm = b.extraState?.name || ''; if (!procs.has(nm)) err(`Function ${nm} does not exist`, ID(b)); const n = (b.extraState?.params || []).length; const args = Array.from({ length: n }, (_, i) => kid(b, 'ARG' + i) ? X(kid(b, 'ARG' + i)) : empty(b, 'ARG' + i, '0', 'argument')); return `P_${safeId(nm)}(${args.join(', ')})`; };
  const desc = (b: any): string => { // human text of a condition — shown while a stack waits or a step's transition is pending
    if (!b) return 'TRUE';
    const lbl = (id: string) => t.byId.get(id)?.tag || t.cylById.get(id)?.tag || '?';
    switch (b.type) {
      case 'hy_in': return lbl(fld(b, 'SIG')); case 'hy_out_state': return lbl(fld(b, 'SIG')) + ' is ON';
      case 'hy_cyl': return `${lbl(fld(b, 'CYL'))} ${fld(b, 'END') === 'p' ? 'at +' : 'at −'}`;
      case 'logic_negate': return 'NOT ' + desc(kid(b, 'BOOL'));
      case 'logic_operation': return `${desc(kid(b, 'A'))} ${fld(b, 'OP')} ${desc(kid(b, 'B'))}`;
      case 'logic_boolean': return fld(b, 'BOOL');
      case 'hy_timer_q': return `${fld(b, 'NAME')} done`; case 'hy_counter_q': return `${fld(b, 'NAME')} done`;
      case 'hy_for': return `${desc(kid(b, 'IN'))} for ${kid(b, 'PT')?.fields?.NUM ?? '?'} s`;
      case 'hy_step_time': return `time in step ≥ …`;
      case 'logic_compare': { const op = ({ EQ: '=', NEQ: '≠', LT: '<', LTE: '≤', GT: '>', GTE: '≥' } as any)[fld(b, 'OP')]; const side = (x: any) => x?.type === 'math_number' ? x.fields.NUM : x?.type === 'hy_analog' ? lbl(fld(x, 'SIG')) : x?.type === 'hy_var_get' ? vars.get(fld(x, 'VAR'))?.name || '?' : x?.type === 'hy_step_time' ? 'time in step' : x?.type === 'hy_counter_cv' ? fld(x, 'NAME') : '…'; return `${side(kid(b, 'A'))} ${op} ${side(kid(b, 'B'))}`; }
      case 'hy_var_get': return vars.get(fld(b, 'VAR'))?.name || '?';
      case 'hy_mode_is': return 'mode ' + fld(b, 'MODE');
      case 'hy_seq_done': return `${fld(b, 'SEQ')} at END`; case 'hy_par_done': return `${fld(b, 'NAME')} branches done`;
      case 'hy_twohand': return 'two-hand ' + desc(kid(b, 'A')) + ' + ' + desc(kid(b, 'B'));
      default: return HUMAN[b.type] || '…';
    }
  };

  // ---------- statements ----------
  const ST = (b: any, ind: string): string => { let out = ''; while (b) { out += ST1(b, ind); b = b.next?.block; } return out; };
  const body = (b: any, name: string, ind: string) => ST(kid(b, name), ind + '  ');
  const ST1 = (b: any, ind: string): string => {
    stmts++; const h = `${ind}if ($.s(${Q(ID(b))})) yield 1;\n`;
    switch (b.type) {
      case 'controls_if': { const n = b.extraState?.elseIfCount || 0; let s = h; for (let i = 0; i <= n; i++) s += `${ind}${i ? '} else ' : ''}if ($.b(${V(b, 'IF' + i, 'b')})) {\n${body(b, 'DO' + i, ind)}`; if (b.extraState?.hasElse) s += `${ind}} else {\n${body(b, 'ELSE', ind)}`; return s + `${ind}}\n`; }
      case 'controls_repeat_ext': { const iv = 'i' + (++loopN); return h + `${ind}for (let ${iv} = 0, ${iv}n = $.n(${V(b, 'TIMES')}); ${iv} < ${iv}n; ${iv}++) { $.lg(${Q(ID(b))});\n${body(b, 'DO', ind)}${ind}}\n`; }
      case 'controls_whileUntil': { const c = V(b, 'BOOL', 'b'); if (c === 'true' && fld(b, 'MODE') === 'WHILE' || c === 'false' && fld(b, 'MODE') === 'UNTIL') warn('Loop with no exit condition — it will hit the loop limit and fault', ID(b)); return h + `${ind}while (${fld(b, 'MODE') === 'UNTIL' ? '!' : ''}$.b(${c})) { $.lg(${Q(ID(b))});\n${body(b, 'DO', ind)}${ind}}\n`; }
      case 'hy_wait': { noWaitInFb(b); const c = kid(b, 'COND'); conds[ID(b)] = desc(c); const st = +fld(b, 'STALL') || 0; return h + `${ind}while (!$.b(${V(b, 'COND', 'b')})) { $.wt(${Q(ID(b))}, ${st}); yield 0; }\n${ind}$.wd(${Q(ID(b))});\n`; }
      case 'hy_delay': { noWaitInFb(b); conds[ID(b)] = 'delay'; return h + `${ind}{ const t0 = $.t, d = $.n(${V(b, 'S')}); while ($.t - t0 < d - 1e-9) { $.wt(${Q(ID(b))}, -1); yield 0; } $.wd(${Q(ID(b))}); }\n`; }
      case 'hy_stop_prog': return h + `${ind}$.stopProg(${Q(ID(b))}); return;\n`;
      case 'hy_out': { const id = fld(b, 'SIG'); return sigOk(id, ['out'], b, 'Set output') ? h + `${ind}$.set(${Q(id)}, ${fld(b, 'VAL') === '1'}, ${Q(ID(b))});\n` : h; }
      case 'hy_act': { const id = fld(b, 'SIG'); return sigOk(id, ['out'], b, 'Activate') ? h + `${ind}$.act(${Q(id)});\n` : h; }
      case 'hy_outs_off': return h + `${ind}$.allOff();\n`;
      case 'hy_aout': { const id = fld(b, 'SIG'); return sigOk(id, ['aout'], b, 'Set analog') ? h + `${ind}$.aset(${Q(id)}, ${V(b, 'V')});\n` : h; }
      case 'hy_var_set': { const v = varOf(fld(b, 'VAR'), b); return v ? h + `${ind}$.vset(${Q(v.id)}, ${V(b, 'V', v.type === 'BOOL' ? 'b' : v.type === 'STRING' ? 's' : 'n')});\n` : h; }
      case 'hy_var_change': { const v = varOf(fld(b, 'VAR'), b); if (v && (v.type === 'BOOL' || v.type === 'STRING')) err(`CHANGE BY needs a number variable (${v.name} is ${v.type})`, ID(b)); return v ? h + `${ind}$.vset(${Q(v.id)}, $.n($.v[${Q(v.id)}]) + $.n(${V(b, 'D')}));\n` : h; }
      case 'hy_latch': { const v = varOf(fld(b, 'VAR'), b); if (v && v.type !== 'BOOL') err(`LATCH needs a BOOL variable (${v.name} is ${v.type})`, ID(b)); return v ? h + `${ind}$.latch(${Q(v.id)}, ${V(b, 'S', 'b')}, ${V(b, 'R', 'b')}, ${Q(fld(b, 'MODE'))});\n` : h; }
      case 'hy_timer': return h + `${ind}$.timer(${Q(String(fld(b, 'NAME') || ''))}, ${Q(fld(b, 'KIND'))}, ${V(b, 'IN', 'b')}, ${V(b, 'PT')});\n`;
      case 'hy_counter': { const k = fld(b, 'KIND'); const up = k !== 'CTD' ? V(b, 'UP', 'b') : 'false', dn = k !== 'CTU' ? V(b, 'DOWN', 'b') : 'false'; const rs = kid(b, 'RESET') ? X(kid(b, 'RESET')) : 'false', ld = kid(b, 'LOAD') ? X(kid(b, 'LOAD')) : 'false'; return h + `${ind}$.counter(${Q(String(fld(b, 'NAME') || ''))}, ${Q(k)}, ${up}, ${dn}, $.b(${rs}), $.b(${ld}), ${V(b, 'PV')});\n`; }
      case 'hy_counter_reset': { const n = String(fld(b, 'NAME') || ''); if (!counters.has(n)) err(`Counter ${n || '?'} is not declared`, ID(b)); return h + `${ind}$.cReset(${Q(n)});\n`; }
      case 'hy_seq': {
        const nm = String(fld(b, 'NAME') || '').trim() || 'SEQ'; const list: any[] = []; let st = kid(b, 'STEPS'); while (st) { if (st.type === 'hy_step') list.push(st); st = st.next?.block; }
        if (!list.length) { warn(`Sequence ${nm} has no steps`, ID(b)); return h; }
        const info: SeqInfo = { name: nm, block: ID(b), steps: [] }; seqs.push(info);
        let s = h + `${ind}{ const q = $.seq(${Q(nm)}, ${Q(list[0] ? String(fld(list[0], 'ID')) : '')}); switch (q.cur) {\n`;
        const outerSeq = curSeq;
        list.forEach((sb, i) => { const id = String(fld(sb, 'ID') || '').trim(); let nx = String(fld(sb, 'GOTO') || 'next').trim(); if (!nx || nx === 'next') nx = String(fld(list[(i + 1) % list.length], 'ID')); else if (nx.toUpperCase() === 'END') nx = '__END'; else if (!seqSteps.get(nm)?.has(nx)) err(`Step ${id}: goes to ${nx}, which is not a step of ${nm}`, ID(sb));
          curSeq = nm; const c = kid(sb, 'T'); if (!c) warn(`Step ${id}: no transition condition — the sequence stays here`, ID(sb)); const cs = c ? X(c) : 'false'; const acts = body(sb, 'DO', ind + '  '); curSeq = outerSeq;
          info.steps.push({ id, label: String(fld(sb, 'LABEL') || ''), block: ID(sb), next: nx === '__END' ? 'END' : nx, cond: desc(c) }); stmts++;
          s += `${ind}  case ${Q(id)}: { if ($.s(${Q(ID(sb))})) yield 1;\n${acts}${ind}    if ($.b(${cs})) q.go(${Q(nx)}); break; }\n`; });
        return s + `${ind}  case "__END": break;\n${ind}  default: q.go(${Q(String(fld(list[0], 'ID')))});\n${ind}} }\n`;
      }
      case 'hy_step': err('A STEP only works inside a SEQUENCE', ID(b)); return '';
      case 'hy_goto': { const [sq, stp] = String(fld(b, 'TO') || '/').split('/'); if (!seqSteps.get(sq)?.has(stp)) err(`Go to step: ${stp} is not a step of ${sq || '?'}`, ID(b)); return h + `${ind}$.goto(${Q(sq)}, ${Q(stp)});\n`; }
      case 'hy_seq_reset': { const sq = String(fld(b, 'SEQ') || ''); if (!seqSteps.has(sq)) err(`Reset sequence: ${sq || '?'} does not exist`, ID(b)); return h + `${ind}$.seqReset(${Q(sq)});\n`; }
      case 'hy_message': return h + `${ind}$.msg(String(${V(b, 'TEXT', 's')}));\n`;
      case 'hy_alarm': return h + `${ind}$.alarm(${Q(String(fld(b, 'CODE') || ''))}, ${Q(fld(b, 'SEV'))}, ${Q(String(fld(b, 'TEXT') || ''))}, $.b(${V(b, 'COND', 'b')}));\n`;
      case 'hy_comment': stmts--; return '';
      // ----- 8d -----
      case 'hy_shreg': { const n = String(fld(b, 'NAME') || '').trim(); return h + `${ind}$.sreg(${Q(n)}, ${Math.max(1, Math.min(256, Math.trunc(+fld(b, 'LEN') || 8)))}, $.b(${V(b, 'IN', 'b')}), $.b(${V(b, 'CLK', 'b')}), $.b(${kid(b, 'RESET') ? X(kid(b, 'RESET')) : 'false'}));\n`; }
      case 'hy_array': stmts--; return ''; // a declaration: created at Run
      case 'hy_arr_set': return h + `${ind}$.arrSet(${Q(named(b, 'NAME', arrays, 'Array'))}, ${V(b, 'I')}, ${V(b, 'V')}, ${Q(ID(b))});\n`;
      case 'hy_arr_fill': return h + `${ind}$.arrFill(${Q(named(b, 'NAME', arrays, 'Array'))}, ${V(b, 'V')});\n`;
      case 'hy_rec_set': { const r = String(fld(b, 'REC') || '').trim(), f = String(fld(b, 'FIELD') || '').trim(); if (!r || !f) err('Record: give the record and the field a name', ID(b)); return h + `${ind}$.recSet(${Q(r)}, ${Q(f)}, ${V(b, 'V')});\n`; }
      case 'hy_pid': { const en = kid(b, 'EN') ? X(kid(b, 'EN')) : 'true'; return h + `${ind}$.pid(${Q(String(fld(b, 'NAME') || '').trim())}, ${V(b, 'PV')}, ${V(b, 'SP')}, ${V(b, 'KP')}, ${kid(b, 'TI') ? X(kid(b, 'TI')) : '0'}, ${kid(b, 'TD') ? X(kid(b, 'TD')) : '0'}, ${V(b, 'LO')}, ${kid(b, 'HI') ? X(kid(b, 'HI')) : '100'}, $.b(${en}), ${Q(fld(b, 'DIR'))});\n`; }
      case 'hy_fb_out': { const nm = String(fld(b, 'NAME') || '').trim(); if (!curFb) { err('SET function-block output: use it inside a FUNCTION BLOCK', ID(b)); return h; } if (!curFb.outs.includes(nm)) err(`${curFb.name} has no output ${nm || '?'} (outputs: ${curFb.outs.join(', ') || 'none'})`, ID(b)); return h + `${ind}O[${Q(nm)}] = ${V(b, 'V')};\n`; }
      case 'hy_fb_call': { const nm = String(fld(b, 'FB') || ''), inst = String(fld(b, 'INST') || '').trim(); const d = fbs.get(nm);
        if (!d) { err(nm ? `Function block ${nm} does not exist` : 'CALL: choose a function block', ID(b)); return h; }
        if (!/^[A-Za-z_]\w*$/.test(inst)) err(`Instance name “${inst}”: letters, digits and _ only`, ID(b)); if (curFb?.name === nm) err(`${nm} calls itself`, ID(b));
        const args = d.ins.map((x, i) => `${Q(x)}: ${kid(b, 'IN' + i) ? X(kid(b, 'IN' + i)) : empty(b, x, '0', 'input')}`).join(', ');
        return h + `${ind}yield* $.fb(${Q(inst)}, F_${safeId(nm)}, { ${args} });\n`; }
      case 'hy_par': { const n = String(fld(b, 'NAME') || '').trim(); return h + `${ind}$.par(${Q(n)}, ${Q(pars.get(n) || [])});\n${body(b, 'B1', ind)}${body(b, 'B2', ind)}${body(b, 'B3', ind)}`; }
      case 'hy_seq_hold': return h + `${ind}$.hold(${Q(named(b, 'SEQ', seqSteps, 'Sequence'))}, $.b(${V(b, 'COND', 'b')}));\n`;
      case 'hy_wait_to': { noWaitInFb(b); const c = kid(b, 'COND'); conds[ID(b)] = desc(c) + ' (with timeout)'; const id = Q(ID(b));
        return h + `${ind}{ const t0 = $.t, d = $.n(${V(b, 'S')}); let to = false; while (!$.b(${V(b, 'COND', 'b')})) { if ($.t - t0 >= d - 1e-9) { to = true; break; } $.wt(${id}, -1); yield 0; } $.wd(${id});\n${ind}  if (to) {\n${body(b, 'DO', ind + '  ')}${ind}  } }\n`; }
      case 'hy_handshake': { noWaitInFb(b); const rq = fld(b, 'REQ'), ak = fld(b, 'ACK'); if (!sigOk(rq, ['out'], b, 'Handshake request') || !sigOk(ak, ['in'], b, 'Handshake acknowledge')) return h;
        const id = Q(ID(b)), R = Q(rq), A = Q(ak), tag = t.byId.get(rq)?.tag || rq; conds[ID(b)] = `${t.byId.get(ak)?.tag || '?'} (handshake)`; const code = Q('W-HS:' + tag);
        return h + `${ind}{ const d = $.n(${V(b, 'S')}); let to = false, t0 = $.t; $.set(${R}, true, ${id});\n`
          + `${ind}  while (true) { $.wt(${id}, -1); yield 0; if ($.i(${A})) break; if ($.t - t0 >= d - 1e-9) { to = true; break; } }\n`
          + `${ind}  $.set(${R}, false, ${id});\n${ind}  if (!to) { t0 = $.t; while ($.i(${A})) { if ($.t - t0 >= d - 1e-9) { to = true; break; } $.wt(${id}, -1); yield 0; } }\n`
          + `${ind}  $.wd(${id}); $.alarm(${code}, "W", ${Q(`Handshake ${tag}: no acknowledge within the timeout`)}, to);\n${ind}  if (to) {\n${body(b, 'DO', ind + '  ')}${ind}  } }\n`; }
      case 'hy_mode_sel': { const g = (k: string) => kid(b, k) ? `$.b(${X(kid(b, k))})` : 'false'; return h + `${ind}$.modeSel(${g('AUTO')}, ${g('MANUAL')}, ${g('SETUP')}, ${g('HOMING')});\n`; }
      case 'hy_mode_set': return h + `${ind}$.setMode(${Q(fld(b, 'MODE'))});\n`;
      case 'hy_alarm_ack': return h + `${ind}$.aack(${Q(String(fld(b, 'PFX') ?? '').trim())});\n`;
      case 'procedures_callnoreturn': return h + `${ind}yield* ${callProc(b)};\n`;
      case 'procedures_ifreturn': return h + `${ind}if ($.b(${V(b, 'CONDITION', 'b')})) return ${b.extraState?.hasValue === false || !kid(b, 'VALUE') ? '' : X(kid(b, 'VALUE'))};\n`;
      default: err(`Block ${HUMAN[b.type] || b.type} cannot be used as a statement here`, ID(b)); return '';
    }
  };

  // ---------- program ----------
  const hats: Record<string, string[]> = {}; let js = '';
  const counts: Record<string, number> = {};
  tops.forEach(b => { if (HATS[b.type]) counts[b.type] = (counts[b.type] || 0) + 1; });
  Object.entries(counts).forEach(([k, n]) => { if (n > 1 && k !== 'hy_task') tops.filter(b => b.type === k).slice(1).forEach(b => err(`Two ${HATS[k]} entry points — keep one (add a TASK for parallel stacks)`, ID(b))); });
  if (!counts.hy_main && !counts.hy_task) warn('No MAIN LOOP — the program does nothing while running');
  const sorted = [...tops].sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
  procs.forEach((b, nm) => { const params: string[] = (b.extraState?.params || []).map((x: any) => x.name); procArgs = params; const ret = b.type === 'procedures_defreturn' ? (kid(b, 'RETURN') ? X(kid(b, 'RETURN')) : 'undefined') : '';
    js += `function* P_${safeId(nm)}(${params.map(x => 'A_' + safeId(x)).join(', ')}) {\n${ST(kid(b, 'STACK'), '  ')}${ret ? `  return ${ret};\n` : ''}}\n`; procArgs = []; });
  fbs.forEach((d, nm) => { curFb = { name: nm, ins: d.ins, outs: d.outs }; stmts++; js += `function* F_${safeId(nm)}(O, I) {\n  if ($.s(${Q(ID(d.block))})) yield 1;\n${ST(kid(d.block, 'STACK'), '  ')}}\n`; curFb = null; });
  if (arrays.size) js = `$.decl(${Q(Object.fromEntries(arrays))});\n` + js;
  sorted.forEach(b => {
    if (procs.get(String(fld(b, 'NAME'))) === b) return;
    if (b.type === 'hy_fb_def') return;
    if (b.type === 'hy_array') { let x = b.next?.block; while (x && (x.type === 'hy_array' || x.type === 'hy_comment')) x = x.next?.block; if (x) warn(`${HUMAN[x.type] || x.type} is not under an entry point — it never runs`, ID(x)); return; }
    if (!HATS[b.type]) { if (b.type !== 'hy_comment') warn(`${HUMAN[b.type] || b.type} is not under an entry point — it never runs`, ID(b)); return; }
    if (counts[b.type] > 1 && b.type !== 'hy_task' && sorted.filter(x => x.type === b.type)[0] !== b) return;
    const key = b.type === 'hy_task' ? 'hy_main' : b.type; const fn = `H_${++hatN}`;
    (hats[key] ||= []).push(fn); stmts++;
    js += `function* ${fn}() {\n  if ($.s(${Q(ID(b))})) yield 1;\n${ST(b.next?.block, '  ')}}\n`;
  });
  js += `return { ${Object.entries(hats).map(([k, l]) => `${k}: [${l.join(', ')}]`).join(', ')} };`;
  // unused variables and signals
  (prog.vars || []).forEach(v => { if (!varUsed.has(v.id)) issues.push({ level: 'warn', text: `Variable ${v.name} is not used` }); });
  const unusedIo = t.sigs.filter(s => !used.has(s.id) && (s.dir === 'in' || s.dir === 'out')); if (unusedIo.length) issues.push({ level: 'info', text: `${unusedIo.length} I/O signal${unusedIo.length > 1 ? 's are' : ' is'} not used by this program: ${unusedIo.slice(0, 8).map(s => s.tag).join(', ')}${unusedIo.length > 8 ? ' …' : ''}` });
  let fn: any = null; const ok = !issues.some(i => i.level === 'err');
  try { fn = new Function('$', js); } catch (e: any) { issues.push({ level: 'err', text: 'Internal compile error: ' + e.message }); }
  if (!issues.some(i => i.level === 'err' || i.level === 'warn')) issues.push({ level: 'ok', text: `${stmts} blocks checked · no errors` });
  return { ok: ok && !!fn, issues, js, fn, hats, conds, seqs, timers: [...timers], counters: [...counters], used, stmts };
}

export const HUMAN: Record<string, string> = {
  hy_start: 'ON START', hy_main: 'MAIN LOOP', hy_task: 'TASK', hy_estop: 'ON E-STOP', hy_reset: 'ON RESET', hy_fault: 'ON FAULT',
  controls_if: 'IF', logic_compare: 'Compare', logic_operation: 'AND / OR', logic_negate: 'NOT', logic_boolean: 'TRUE / FALSE', hy_xor: 'XOR', hy_between: 'BETWEEN',
  controls_repeat_ext: 'REPEAT n TIMES', controls_whileUntil: 'REPEAT WHILE / UNTIL', hy_wait: 'WAIT UNTIL', hy_delay: 'DELAY', hy_stop_prog: 'STOP PROGRAM',
  math_number: 'Number', math_arithmetic: 'Arithmetic', math_single: 'Function', math_round: 'ROUND', hy_mod: 'MOD', hy_minmax: 'MIN / MAX', hy_scale: 'SCALE', hy_limit: 'LIMIT', hy_convert: 'CONVERT',
  text: 'Text', hy_join: 'JOIN', hy_var_get: 'Get variable', hy_var_set: 'SET variable', hy_var_change: 'CHANGE variable', hy_latch: 'SET / RESET LATCH', hy_edge: 'EDGE',
  hy_in: 'Read input', hy_out: 'SET OUTPUT', hy_act: 'ACTIVATE', hy_outs_off: 'ALL OUTPUTS OFF', hy_out_state: 'Output state', hy_cyl: 'Cylinder position', hy_analog: 'Read analog', hy_aout: 'SET ANALOG',
  hy_timer: 'TIMER', hy_timer_q: 'Timer done', hy_timer_et: 'Timer elapsed', hy_for: 'TRUE FOR', hy_counter: 'COUNTER', hy_counter_q: 'Counter done', hy_counter_cv: 'Counter value', hy_counter_reset: 'RESET COUNTER',
  hy_seq: 'SEQUENCE', hy_step: 'STEP', hy_step_active: 'Step active', hy_step_time: 'Time in step', hy_goto: 'GO TO STEP', hy_seq_reset: 'RESET SEQUENCE', hy_clock: 'Clock',
  hy_window: 'WITHIN ±', hy_hyst: 'HYSTERESIS', hy_deadband: 'DEADBAND', hy_sel: 'SELECT', hy_mux: 'MUX',
  hy_bitop: 'Word AND / OR / XOR', hy_wnot: 'NOT word', hy_shift: 'SHIFT / ROTATE', hy_bit_get: 'Bit of word', hy_bit_set: 'Set bit of word', hy_shreg: 'SHIFT REGISTER', hy_shreg_bit: 'Register bit',
  hy_array: 'ARRAY', hy_arr_get: 'Array item', hy_arr_set: 'SET array item', hy_arr_fill: 'FILL array', hy_arr_stat: 'Array SUM / AVG / MIN / MAX', hy_table: 'TABLE', hy_rec_set: 'SET record field', hy_rec_get: 'Record field',
  hy_pid: 'PID', hy_pid_out: 'PID output', hy_ramp: 'RAMP', hy_avg: 'MOVING AVERAGE', hy_filter: 'FILTER', hy_blink: 'BLINK', hy_rtc: 'Clock (RTC)', hy_rtc_between: 'Time of day',
  hy_fb_def: 'FUNCTION BLOCK', hy_fb_in: 'Function-block input', hy_fb_out: 'SET function-block output', hy_fb_call: 'CALL function block', hy_fb_get: 'Function-block output',
  hy_par: 'PARALLEL', hy_par_done: 'All branches done', hy_seq_done: 'Sequence at END', hy_seq_hold: 'HOLD SEQUENCE', hy_wait_to: 'WAIT UNTIL … at most', hy_handshake: 'HANDSHAKE',
  hy_mode_sel: 'MODE SELECTOR', hy_mode_set: 'SET MODE', hy_mode_is: 'Mode is', hy_alarm_group: 'Alarm group', hy_alarm_count: 'Number of alarms', hy_alarm_ack: 'ACKNOWLEDGE ALARMS',
  hy_twohand: 'TWO-HAND', hy_dualch: 'DUAL CHANNEL', hy_watchdog: 'WATCHDOG',
  hy_message: 'SHOW MESSAGE', hy_alarm: 'ALARM', hy_comment: 'COMMENT', procedures_defnoreturn: 'Function', procedures_defreturn: 'Function with result', procedures_callnoreturn: 'Call function', procedures_callreturn: 'Call function'
};

// a new program: the five entry points, laid out, E-stop switching everything off
export function defaultWorkspace() {
  const h = (type: string, x: number, y: number, next?: any) => ({ type, x, y, ...(next ? { next: { block: next } } : {}) });
  return { blocks: { languageVersion: 0, blocks: [h('hy_start', 20, 20), h('hy_main', 20, 110), h('hy_estop', 460, 20, { type: 'hy_outs_off' }), h('hy_reset', 460, 140), h('hy_fault', 460, 230)] } };
}
export const newProgram = (id: string, name: string): Program => ({ id, name, language: 'Blocks', ws: defaultWorkspace(), vars: [], scanMs: 10 });
