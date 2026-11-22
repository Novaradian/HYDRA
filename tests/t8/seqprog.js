// builds the A+ B+ A− B− program for the Sequence sample from its signal table (used by tests and the screenshot)
window.mkSeqProg = (T) => {
  const sig = tag => T.sigs.find(s => s.tag === tag && s.src === 'plc').id;
  const cyl = tag => T.cyls.find(c => c.tag === tag).id;
  let n = 0; const id = () => 'b' + (++n);
  const B = (type, fields = {}, inputs = {}, next) => ({ type, id: id(), fields, inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, { block: v }])), ...(next ? { next: { block: next } } : {}) });
  const chain = (...bs) => { for (let i = 0; i < bs.length - 1; i++) bs[i].next = { block: bs[i + 1] }; return bs[0]; };
  const num = x => ({ type: 'math_number', id: id(), fields: { NUM: x } });
  const at = (c, e) => B('hy_cyl', { CYL: cyl(c), END: e });
  const step = (sid, label, out, cond) => B('hy_step', { ID: sid, LABEL: label, GOTO: 'next' }, { ...(out ? { DO: B('hy_act', { SIG: sig(out) }) } : {}), T: cond });
  const steps = chain(
    step('S0', 'Home', null, B('logic_operation', { OP: 'AND' }, { A: B('hy_in', { SIG: sig('1S1') }), B: B('hy_cyl', { CYL: cyl('1A1'), END: 'm' }) })),
    step('S1', 'A+', '1Y1', at('1A1', 'p')),
    step('S2', 'B+', '2Y1', B('logic_operation', { OP: 'AND' }, { A: at('2A1', 'p'), B: B('hy_for', {}, { IN: at('2A1', 'p'), PT: num(0.5) }) })),
    step('S3', 'A−', '1Y2', at('1A1', 'm')),
    step('S4', 'B−', '2Y2', at('2A1', 'm')));
  const seq = B('hy_seq', { NAME: 'AUTO' }, { STEPS: steps });
  const cnt = B('hy_counter', { KIND: 'CTU', NAME: 'Cycles' }, { UP: B('hy_step_active', { STEP: 'AUTO/S4' }), PV: num(1000) });
  const msg = B('hy_message', {}, { TEXT: { type: 'text', id: id(), fields: { TEXT: 'Running' } } });
  const main = { ...B('hy_main', {}, {}, chain(seq, cnt)), x: 30, y: 120 };
  const start = { ...B('hy_start', {}, {}, msg), x: 30, y: 20 };
  const es = { ...B('hy_estop', {}, {}, B('hy_outs_off')), x: 640, y: 20 };
  const rs = { ...B('hy_reset', {}, {}, B('hy_seq_reset', { SEQ: 'AUTO' })), x: 640, y: 130 };
  return { blocks: { languageVersion: 0, blocks: [start, main, es, rs] } };
};
