// A compact way to write Logic Coder programs (Blockly JSON) for the machine samples, and to find a part's signal by tag.
import type { Var } from '../plc/compile';
import { geomOf, isConn, isAsm } from '../designer/geom';

type B = any;
const blk = (type: string, fields: Record<string, any> = {}, inputs: Record<string, any> = {}): B => ({ type, fields, inputs });
const V = (b: B) => ({ block: b });
export const chain = (list: B[]): B => { const l = list.filter(Boolean); for (let i = l.length - 2; i >= 0; i--) l[i] = { ...l[i], next: { block: l[i + 1] } }; return l[0]; };
const sub = (l: B[]) => (l.filter(Boolean).length ? { block: chain(l) } : undefined);
const clean = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// ---- expressions ----
export const n = (v: number) => V(blk('math_number', { NUM: v }));
export const T = V(blk('logic_boolean', { BOOL: 'TRUE' })), F = V(blk('logic_boolean', { BOOL: 'FALSE' }));
export const v = (id: string) => V(blk('hy_var_get', { VAR: id }));
export const inp = (id: string) => V(blk('hy_in', { SIG: id }));
export const ain = (id: string) => V(blk('hy_analog', { SIG: id }));
export const at = (cyl: string, end: '+' | '-') => V(blk('hy_cyl', { CYL: cyl, END: end === '+' ? 'p' : 'm' }));
export const not = (a: any) => V(blk('logic_negate', {}, { BOOL: a }));
export const and = (...l: any[]) => l.reduce((a, b) => V(blk('logic_operation', { OP: 'AND' }, { A: a, B: b })));
export const or = (...l: any[]) => l.reduce((a, b) => V(blk('logic_operation', { OP: 'OR' }, { A: a, B: b })));
export const cmp = (a: any, op: 'EQ' | 'NEQ' | 'LT' | 'LTE' | 'GT' | 'GTE', b: any) => V(blk('logic_compare', { OP: op }, { A: a, B: b }));
export const mul = (a: any, b: any) => V(blk('math_arithmetic', { OP: 'MULTIPLY' }, { A: a, B: b }));
export const div = (a: any, b: any) => V(blk('math_arithmetic', { OP: 'DIVIDE' }, { A: a, B: b }));
export const forS = (c: any, s: number) => V(blk('hy_for', {}, { IN: c, PT: n(s) }));
export const stepT = () => V(blk('hy_step_time'));
export const inStep = (s: number) => cmp(stepT(), 'GTE', n(s));
export const stepIs = (seq: string, id: string) => V(blk('hy_step_active', { STEP: `${seq}/${id}` }));
export const within = (x: any, c: any, tol: any) => V(blk('hy_window', {}, { V: x, C: c, TOL: tol }));
export const pidOut = (name: string) => V(blk('hy_pid_out', { NAME: name }));
export const ramp = (x: any, rate: number) => V(blk('hy_ramp', {}, { V: x, R: n(rate) }));
export const parDone = (name: string) => V(blk('hy_par_done', { NAME: name }));
export const seqDone = (name: string) => V(blk('hy_seq_done', { SEQ: name }));
export const edge = (x: any) => V(blk('hy_edge', { EDGE: 'RISING' }, { IN: x }));
export const blink = (on = 0.5, off = 0.5) => V(blk('hy_blink', {}, { ON: n(on), OFF: n(off) }));
export const cnt = (name: string) => V(blk('hy_counter_cv', { NAME: name }));
export const alarmsActive = (pfx = '') => V(blk('hy_alarm_group', { WHAT: 'ACT', PFX: pfx }));
export const txt = (s: string) => V(blk('text', { TEXT: s }));

// ---- statements ----
export const act = (id: string) => blk('hy_act', { SIG: id });
export const out = (id: string, on: boolean) => blk('hy_out', { SIG: id, VAL: on ? '1' : '0' });
export const aout = (id: string, x: any) => blk('hy_aout', { SIG: id }, { V: x });
export const set = (id: string, x: any) => blk('hy_var_set', { VAR: id }, { V: x });
export const msg = (s: string) => blk('hy_message', {}, { TEXT: txt(s) });
export const alarm = (code: string, sev: 'W' | 'F' | 'I', text: string, c: any) => blk('hy_alarm', { CODE: code, SEV: sev, TEXT: text }, { COND: c });
export const iff = (c: any, then: B[], els?: B[]) => blk('controls_if', {}, clean({ IF0: c, DO0: sub(then), ELSE: els ? sub(els) : undefined }), );
export const ifElse = (c: any, then: B[], els: B[]) => ({ ...iff(c, then, els), extraState: { hasElse: true } });
export const pid = (name: string, pv: any, sp: any, kp: number, ti: number, td: number, lo: number, hi: number, en: any) => blk('hy_pid', { NAME: name, DIR: 'D' }, { PV: pv, SP: sp, KP: n(kp), TI: n(ti), TD: n(td), LO: n(lo), HI: n(hi), EN: en });
export const counter = (name: string, up: any, pv: number) => blk('hy_counter', { KIND: 'CTU', NAME: name }, { UP: up, PV: n(pv) });
export const seqReset = (name: string) => blk('hy_seq_reset', { SEQ: name });
export const allOff = () => blk('hy_outs_off');
export const note = (s: string) => blk('hy_comment', { TEXT: s });
export const par = (name: string, branches: B[][]) => blk('hy_par', { NAME: name }, clean({ B1: sub(branches[0] || []), B2: sub(branches[1] || []), B3: sub(branches[2] || []) }));
export type St = [id: string, label: string, acts: B[], cond: any, goto?: string];
export const seq = (name: string, steps: St[]) => blk('hy_seq', { NAME: name }, { STEPS: sub(steps.map(([id, label, acts, cond, goto]) => blk('hy_step', { ID: id, LABEL: label, GOTO: goto || 'next' }, clean({ DO: sub(acts), T: cond })))) });
export const hat = (type: string, x: number, y: number, body: B[], fields: Record<string, any> = {}) => ({ type, x, y, fields, ...(body.length ? { next: { block: chain(body) } } : {}) });
export const ws = (tops: B[]) => ({ blocks: { languageVersion: 0, blocks: tops } });
export const vdef = (id: string, name: string, type: Var['type'], init: string, comment = ''): Var => ({ id, name, type, init, comment });

// ---- find a part's signal by its tag (fluid sheets) ----
export function sigFinder(p: any) {
  const comps = new Map<string, any>();
  Object.values(p.circuits).forEach((c: any) => { if (c.type === 'electric') return; (c.components || []).forEach((x: any) => { if (!isConn(x.ref) && !isAsm(x.ref) && x.tag) comps.set(x.tag, x); }); });
  const id = (tag: string) => { const c = comps.get(tag); if (!c) throw new Error('No part tagged ' + tag); return c.id; };
  return {
    sol: (valve: string, side: 'a' | 'b') => `sol:${id(valve)}:${side}`, prop: (valve: string, side: 'a' | 'b') => `prop:${id(valve)}:${side}`,
    psw: (tag: string) => 'psw:' + id(tag), pg: (tag: string) => 'pg:' + id(tag), cyl: (tag: string) => 'cyl:' + id(tag), pos: (tag: string) => 'pos:' + id(tag),
    drv: (tag: string) => 'drv:' + id(tag), disp: (tag: string) => 'disp:' + id(tag), ref: (tag: string) => geomOf(comps.get(tag)?.ref || '')
  };
}
export const max = (a: any, b: any) => V(blk('hy_minmax', { OP: 'MAX' }, { A: a, B: b }));
export const neg = (a: any) => V(blk('math_single', { OP: 'NEG' }, { NUM: a }));
export const add = (a: any, b: any) => V(blk('math_arithmetic', { OP: 'ADD' }, { A: a, B: b }));
export const sub2 = (a: any, b: any) => V(blk('math_arithmetic', { OP: 'MINUS' }, { A: a, B: b }));
export const change = (id: string, d: any) => blk('hy_var_change', { VAR: id }, { D: d });
export const hyst = (x: any, on: number, off: number) => V(blk('hy_hyst', {}, { V: x, ON: n(on), OFF: n(off) }));
export const limit = (x: any, lo: number, hi: number) => V(blk('hy_limit', {}, { V: x, LO: n(lo), HI: n(hi) }));
