// helpers for tests/s8d.py: build Blockly JSON programs and scan them with the PLC runtime (no UI)
window.T8D = (() => {
  const blk = (type, fields = {}, inputs = {}, extra = {}) => ({ type, fields, inputs, ...extra });
  const V = b => ({ block: b });
  const n = v => V(blk('math_number', { NUM: v }));
  const tf = v => V(blk('logic_boolean', { BOOL: v ? 'TRUE' : 'FALSE' }));
  const vg = id => V(blk('hy_var_get', { VAR: id }));
  const set = (id, val) => blk('hy_var_set', { VAR: id }, { V: val });
  const chain = list => { for (let i = list.length - 2; i >= 0; i--) list[i] = { ...list[i], next: { block: list[i + 1] } }; return list[0]; };
  const hat = (type, stmts, extra = {}) => ({ ...blk(type, extra.fields || {}), x: extra.x || 0, y: extra.y || 0, ...(stmts.length ? { next: { block: chain(stmts) } } : {}) });
  const sub = stmts => stmts.length ? { block: chain(stmts) } : undefined;
  const vars = (spec) => Object.entries(spec).map(([id, type]) => ({ id, name: id, type, init: type === 'BOOL' ? 'false' : '0' }));
  const prog = (blocks, vspec = {}) => ({ id: 'tp', name: 'tp', language: 'Blocks', ws: { blocks: { languageVersion: 0, blocks } }, vars: vars(vspec), scanMs: 10, stall: 10 });
  const P = () => window.HYDRA.plc;
  const T = () => P().signals.signals(window.HYDRA.S.project.value);
  const comp = p => P().compile.compile(p, T());
  const issues = c => c.issues.filter(i => i.level === 'err').map(i => i.text);
  function run(p, scans, each) { const c = comp(p); if (!c.ok) return { err: issues(c) }; const rt = new (P().runtime.Plc)(p, c, T(), P().runtime.standalone); rt.start(); for (let i = 0; i < scans; i++) { if (each) each(rt, i); rt.scan(); } return rt; }
  const step = (id, label, goto, doStmts, cond) => blk('hy_step', { ID: id, LABEL: label || '', GOTO: goto || 'next' }, { ...(doStmts && doStmts.length ? { DO: sub(doStmts) } : {}), ...(cond ? { T: cond } : {}) });
  const seq = (name, steps) => blk('hy_seq', { NAME: name }, { STEPS: sub(steps) });
  return { blk, V, n, tf, vg, set, chain, hat, sub, prog, comp, issues, run, step, seq, T };
})();
