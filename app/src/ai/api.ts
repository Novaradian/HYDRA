// AI command API: the one typed entry point the AI panel, the MCP server and the CLI bridge all use.
// Every call is checked against a JSON schema; edits run inside ONE S.mutate (one undo step) and are logged.
// There is no command that runs scripts or touches files, settings or code — only the project data below.
import Ajv from 'ajv';
import { signal } from '@preact/signals';
import { produce } from 'immer';
import * as S from '../store';
import { D } from '../designer/state';
import { ruleCheck, allTags } from '../designer/model';
import { asmRules } from '../designer/asm';
import { isAsm } from '../designer/geom';
import type { Project } from '../store';
import { AiError, fail, readSheet, findSheet, editableSheet, sheetList, sheetJson, partJson, compByTag, type Sheet } from './core';
import { addComponent, setParam, connectNet, removeParts, moveComponent, buildCircuit, insertTemplate } from './ops';
import { searchLibrary, describePart } from './library';
import { questionTemplate, withMandatory } from './rules';
import { createFor } from './create';
import { templates as savedTemplates } from '../designer/templates';
import { simSummary } from './simrun';
import { aiSettings } from './settings';
import { setCommands, registerProvider, push } from './session';
import { demoProvider } from './demo';
import { setExec } from './providers';
import { SCHEMAS } from './schemas';
import { createPlan, applyPlan, discardPlan, getPlan, planSummary, setPlanSim, markRequested, setRunner, type Plan } from './plans';

export type Source = 'ui' | 'mcp' | 'cli' | 'api' | 'test';
export type Perm = 'read' | 'approve' | 'free';
export type Ctx = { source?: Source; perm?: Perm; label?: string };
export type Result = { ok: true; data: any; undo?: string } | { ok: false; error: string; details?: string[] };
export type Step = { cmd: string; args?: any };

// ---------- activity log (shown later in the AI log tab) ----------
export type LogRow = { t: string; source: Source; cmd: string; args: string; ok: boolean; note: string };
export const aiLog = signal<LogRow[]>([]);
function log(source: Source, cmd: string, args: any, r: Result) {
  const a = isPrivate(S.project.peek()) ? '(Private project — not logged)' : JSON.stringify(args ?? {}); const row: LogRow = { t: new Date().toISOString(), source, cmd, args: a.length > 400 ? a.slice(0, 400) + '…' : a, ok: r.ok, note: r.ok ? ((r as any).undo || '') : (r as any).error };
  aiLog.value = [...aiLog.peek().slice(-499), row];
}

// ---------- schemas: ai/schemas.ts (also the MCP tool list) ----------
type Env = { p: Project; fallback: string | null; plan?: Plan | null; ctx: Ctx };
type Def = { kind: 'read' | 'edit' | 'plan' | 'panel'; schema: any; run: (args: any, env: Env) => any; label?: (args: any) => string; noProject?: boolean };
const DEFS: Record<string, Def> = {
  get_project_info: { kind: 'read', schema: SCHEMAS.get_project_info, run: (_a, { p, fallback }) => ({
    name: p.manifest.name, private: !!(p.manifest as any).private, active: fallback || null,
    sheets: sheetList(p).map(s => { const c = p.circuits[s.id] as Sheet; return { id: s.id, name: s.name, type: s.type, parts: (c.components || []).filter(x => !isAsm(x.ref)).length, lines: (c.pipes || []).length }; }),
    programs: Object.values(p.nodes).filter(n => n.type === 'program').length, tags: allTags(p).slice(0, 300) }) },
  get_sheet: { kind: 'read', schema: SCHEMAS.get_sheet, run: (a, env) => { const { sh } = readSheet(env.p, a.sheet, env.fallback); const j: any = sheetJson(sh); if (a.full) j.parts = sh.components.filter(c => !isAsm(c.ref)).map(c => partJson(c, true)); return j; } },
  search_library: { kind: 'read', schema: SCHEMAS.search_library, run: a => searchLibrary(a.query, a), noProject: true },
  describe_part: { kind: 'read', schema: SCHEMAS.describe_part, run: a => describePart(a.ref), noProject: true },
  validate: { kind: 'read', schema: SCHEMAS.validate, run: (a, { p, fallback }) => {
    const r = readSheet(p, a.sheet, fallback); const sh = r.sh; const iss = [...ruleCheck(sh, r.p), ...(sh.components.some(c => isAsm(c.ref)) ? asmRules(sh, r.p) : [])];
    const bad = iss.filter(i => i.level === 'err' || i.level === 'warn').map(i => ({ level: i.level, text: i.text }));
    return { sheet: sh.name, ok: !bad.some(i => i.level === 'err'), problems: bad };
  } },
  run_sim: { kind: 'read', schema: SCHEMAS.run_sim,
    run: (a, { p, fallback, plan, ctx }) => { const r = simSummary(p, a.sheet, fallback, a.t_end, a.events || []); if (plan) setPlanSim(plan.id, r); return forAi(r, ctx); } },
  add_component: { kind: 'edit', schema: SCHEMAS.add_component, label: a => `add ${a.tag || a.ref}`,
    run: (a, { p, fallback }) => addComponent(p, editableSheet(p, a.sheet, fallback), a) },
  set_param: { kind: 'edit', schema: SCHEMAS.set_param, label: a => `set ${a.tag}`,
    run: (a, { p, fallback }) => { const v = a.values || (a.key != null ? { [a.key]: a.value } : null); if (!v || !Object.keys(v).length) fail('Give key + value, or values'); return setParam(editableSheet(p, a.sheet, fallback), a.tag, v); } },
  connect: { kind: 'edit', schema: SCHEMAS.connect, label: a => `connect ${a.ports.join(' – ')}`,
    run: (a, { p, fallback }) => connectNet(editableSheet(p, a.sheet, fallback), a.ports, a.kind || 'work') },
  remove: { kind: 'edit', schema: SCHEMAS.remove, label: a => `remove ${a.tags.join(', ')}`,
    run: (a, { p, fallback }) => removeParts(editableSheet(p, a.sheet, fallback), a.tags) },
  move_component: { kind: 'edit', schema: SCHEMAS.move_component, label: a => `move ${a.tag}`,
    run: (a, { p, fallback }) => moveComponent(editableSheet(p, a.sheet, fallback), a.tag, a.x, a.y, a.rot) },
  build_circuit: { kind: 'edit', schema: SCHEMAS.build_circuit, label: a => `build circuit (${(a.parts || []).length} parts)`,
    run: (a, { p, fallback }) => buildCircuit(p, editableSheet(p, a.sheet, fallback), a) },
  // follow-up form and parts list: shown in HYDRA's AI panel (Claude Desktop asks in its own chat)
  get_question_template: { kind: 'read', schema: SCHEMAS.get_question_template, run: a => questionTemplate(a.circuit_type), noProject: true },
  ask_user: { kind: 'panel', schema: SCHEMAS.ask_user, run: (a, { ctx }) => {
    if (ctx.source === 'mcp') return { shown: false, note: 'Ask these questions in your own chat.', questions: a.questions };
    push({ kind: 'questions', title: a.title, questions: a.questions }); return { shown: true, note: 'Shown in HYDRA. Stop now: the answers arrive in the next message.' }; } },
  propose_bom: { kind: 'panel', schema: SCHEMAS.propose_bom, run: (a, { ctx }) => {
    const r = withMandatory(a.rows, a.circuit_type || '', a.pressure);
    if (ctx.source !== 'mcp') push({ kind: 'bom', title: a.title || `Parts list — ${r.rows.length} items`, rows: r.rows, assumptions: a.assumptions || [] });
    return { rows: r.rows, added_by_hydra: r.added, note: ctx.source === 'mcp' ? 'Show this list to the user for approval in your chat.' : 'Shown in HYDRA for approval. Stop now: the approved list arrives in the next message.' }; } },
  insert_template: { kind: 'edit', schema: SCHEMAS.insert_template, label: a => `insert template ${a.name}`, run: (a, { p, fallback }) => {
    const all = savedTemplates.peek(); const tp = all.find(x => x.name === a.name) || all.find(x => x.name.toLowerCase() === String(a.name).toLowerCase());
    if (!tp) fail(`No saved template "${a.name}"`, [`Templates: ${all.map(x => x.name).join(', ') || 'none saved'}`]);
    if (tp!.domain === 'electrical') fail('That is an electrical template');
    return insertTemplate(p, editableSheet(p, a.sheet, fallback), tp!.data, a.x ?? 40, a.y ?? 40); } },
  create_for: { kind: 'edit', schema: SCHEMAS.create_for, label: a => `create ${a.domain === 'controller' ? 'controller / HMI' : a.domain === 'logic' ? 'logic code' : 'electric'}`,
    run: (a, { p, fallback }) => createFor(p, editableSheet(p, a.sheet, fallback), a.domain, { sequence: a.sequence, name: a.name }) },
  // plans (Edit with approval): the AI proposes, the user presses Apply in HYDRA
  get_plan: { kind: 'plan', schema: SCHEMAS.get_plan, run: (a, { ctx }) => { const s = planSummary(openPlan(a.plan_id, true)); if (s.sim) s.sim = forAi(s.sim, ctx); return s; } },
  apply_plan: { kind: 'plan', schema: SCHEMAS.apply_plan, run: (a, { ctx }) => {
    const pl = openPlan(a.plan_id, false); if (ctx.perm === 'read') fail('Read-only access: this connection may not change the project');
    if (ctx.perm === 'approve') { markRequested(pl.id); return { plan_id: pl.id, status: 'waiting_for_user', message: 'Shown in HYDRA as a ghost — the user presses Apply there' }; }
    return applyPlan(pl.id, { source: ctx.source }); } },
  discard_plan: { kind: 'plan', schema: SCHEMAS.discard_plan, run: a => discardPlan(a.plan_id) },
};
/** "Send simulation results to the AI" off: an outside AI only learns pass / fail; the user sees the full result in HYDRA */
const AI_SOURCES = new Set(['mcp', 'cli', 'api']);
function forAi(r: any, ctx: Ctx) {
  if (!AI_SOURCES.has(ctx.source || '') || aiSettings.peek().sendSim) return r;
  return { passed: !(r.warnings || []).length && !(r.actuators || []).some((a: any) => a.end === 'between'), shown_in_hydra: true, note: 'The full result is shown to the user in HYDRA; sending simulation results to the AI is off.' };
}
function openPlan(id: string, any: boolean): Plan {
  const pl = getPlan(id); if (!pl || pl.projectId !== S.project.peek()?.manifest.projectId) fail(`No plan ${id} in this project`);
  if (!any && pl!.status !== 'ready' && pl!.status !== 'stale') fail(`Plan ${id} is ${pl!.status}`);
  return pl!;
}
export const COMMAND_NAMES = Object.keys(DEFS);
export const isEdit = (cmd: string) => DEFS[cmd]?.kind === 'edit';

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const checks: Record<string, any> = Object.fromEntries(Object.entries(DEFS).map(([k, d]) => [k, ajv.compile(d.schema)]));
function check(cmd: string, args: any) {
  const d = DEFS[cmd]; if (!d) fail(`Unknown command "${cmd}"`, [`Commands: ${COMMAND_NAMES.join(', ')}`]);
  const v = checks[cmd]; if (!v(args ?? {})) fail(`${cmd}: invalid arguments`, (v.errors || []).map((e: any) => `${e.instancePath || '(args)'} ${e.message}${e.params?.additionalProperty ? ` "${e.params.additionalProperty}"` : ''}`));
  return d;
}

// ---------- guards ----------
export const isPrivate = (p: Project | null) => !!(p?.manifest as any)?.private;
function guard(edit: boolean, ctx: Ctx, noProject = false) {
  const p = S.project.peek(); if (!p) { if (noProject) return null as any; fail('No project is open in HYDRA'); }
  if (isPrivate(p)) fail('This project is marked Private — AI tools are off for it');
  // outside AI apps and CLIs only get in while the owner has switched them on
  if ((ctx.source === 'mcp' || ctx.source === 'cli' || ctx.source === 'api') && !aiSettings.peek().enabled) fail('AI features are off in HYDRA (Settings › AI & Connections)');
  if (ctx.source === 'cli' && !aiSettings.peek().cli) fail('The CLI bridge is off in HYDRA (Settings › AI & Connections)');
  if (ctx.source === 'mcp' && !aiSettings.peek().mcp) fail('The MCP server is off in HYDRA (Settings › AI & Connections)');
  if (edit) {
    if (ctx.perm === 'read') fail('Read-only access: this connection may not change the project');
    if (S.readOnly.peek()) fail('The project is open read-only');
    if (S.editLock.peek()) fail(S.editLock.peek()!);
  }
  return p!;
}
const fallbackSheet = () => (D.peek() as any)?.sheetId || null;
const asResult = (e: any): Result => e instanceof AiError ? { ok: false, error: e.message, ...(e.details?.length ? { details: e.details } : {}) } : { ok: false, error: 'Internal error: ' + (e?.message || String(e)) };

// ---------- entry points ----------
/** one command; an edit becomes one undo step */
export function call(cmd: string, args: any = {}, ctx: Ctx = {}): Result {
  const src = ctx.source || 'ui'; let r: Result;
  try {
    const d = check(cmd, args); const p = guard(d.kind === 'edit', ctx, d.noProject); const fb = fallbackSheet();
    if (d.kind === 'read') {
      let plan: Plan | null = null, pp = p;
      if (args.plan) { plan = openPlan(args.plan, false); if (plan.status !== 'ready' || !plan.project) fail(`Plan ${plan.id} no longer fits the drawing: ${plan.error}`); pp = plan.project; }
      r = { ok: true, data: d.run(args, { p: pp, fallback: fb, plan, ctx }) };
    }
    else if (d.kind === 'plan' || d.kind === 'panel') r = { ok: true, data: d.run(args, { p, fallback: fb, ctx }) };
    else if (ctx.perm === 'approve') r = { ok: true, data: proposeInner([{ cmd, args }], ctx) };
    else { const label = 'AI: ' + (ctx.label || d.label?.(args) || cmd); let out: any; S.mutate(label, dr => { out = d.run(args, { p: dr as Project, fallback: fb, ctx }); }); r = { ok: true, data: out, undo: label }; }
  } catch (e) { r = asResult(e); }
  log(src, cmd, args, r); return r;
}
/** several edits applied together as ONE undo step; nothing changes if any step fails */
export function batch(steps: Step[], ctx: Ctx = {}): Result {
  const src = ctx.source || 'ui'; let r: Result;
  try {
    if (!Array.isArray(steps) || !steps.length) fail('Nothing to do');
    const defs = steps.map((s, i) => { try { return check(s.cmd, s.args); } catch (e: any) { throw new AiError(`Step ${i + 1}: ${e.message}`, e.details); } });
    if (defs.some(d => d.kind !== 'edit')) fail('A batch holds edit commands only');
    guard(true, ctx); const fb = fallbackSheet();
    const label = 'AI: ' + (ctx.label || (steps.length === 1 ? defs[0].label?.(steps[0].args) || steps[0].cmd : `${steps.length} changes`));
    const outs: any[] = [];
    S.mutate(label, dr => { steps.forEach((s, i) => { try { outs.push(defs[i].run(s.args ?? {}, { p: dr as Project, fallback: fb, ctx })); } catch (e: any) { throw e instanceof AiError ? new AiError(`Step ${i + 1} (${s.cmd}): ${e.message}`, e.details) : e; } }); });
    r = { ok: true, data: outs, undo: label };
  } catch (e) { r = asResult(e); }
  log(src, 'batch', steps, r); return r;
}
/** the project as it would be after these edits — the live project is not touched (plans, ghost preview, sim check) */
export function preview(steps: Step[], ctx: Ctx = {}): { ok: true; project: Project; data: any[] } | { ok: false; error: string; details?: string[] } {
  try {
    const defs = steps.map((s, i) => { try { return check(s.cmd, s.args); } catch (e: any) { throw new AiError(`Step ${i + 1}: ${e.message}`, e.details); } });
    if (defs.some(d => d.kind !== 'edit')) fail('A plan holds edit commands only');
    const p = guard(false, ctx); const fb = fallbackSheet(); const outs: any[] = [];
    const next = produce(p as Project, (dr: any) => { steps.forEach((s, i) => { try { outs.push(defs[i].run(s.args ?? {}, { p: dr as Project, fallback: fb, ctx })); } catch (e: any) { throw e instanceof AiError ? new AiError(`Step ${i + 1} (${s.cmd}): ${e.message}`, e.details) : e; } }); });
    return { ok: true, project: next as unknown as Project, data: outs };
  } catch (e) { return asResult(e) as any; }
}
/** edits proposed as a plan: previewed as a ghost, rule-checked, waiting for the user's Apply */
function proposeInner(steps: Step[], ctx: Ctx) {
  if (!Array.isArray(steps) || !steps.length) fail('Nothing to do');
  const defs = steps.map((s, i) => { try { return check(s.cmd, s.args); } catch (e: any) { throw new AiError(`Step ${i + 1}: ${e.message}`, e.details); } });
  if (defs.some(d => d.kind !== 'edit')) fail('A plan holds edit commands only');
  const p = guard(false, ctx); const fb = fallbackSheet();
  // pin the sheet now, so the plan means the same sheet whichever tab is open when it is applied
  const pinned = steps.map(s => ({ cmd: s.cmd, args: { ...(s.args || {}), sheet: findSheet(p, s.args?.sheet, fb).id } }));
  const label = 'AI: ' + (ctx.label || (steps.length === 1 ? defs[0].label?.(steps[0].args) || steps[0].cmd : `${steps.length} changes`));
  return planSummary(createPlan(pinned, { source: ctx.source || 'ui', label }));
}
export function propose(steps: Step[], ctx: Ctx = {}): Result {
  let r: Result; try { r = { ok: true, data: proposeInner(steps, ctx) }; } catch (e) { r = asResult(e); }
  log(ctx.source || 'ui', 'propose', steps, r); return r;
}
/** the user's Apply / Discard buttons */
export function userApply(planId: string): Result { let r: Result; try { r = { ok: true, data: applyPlan(planId, { source: 'ui' }) }; } catch (e) { r = asResult(e); } log('ui', 'apply_plan', { plan_id: planId }, r); return r; }
export function userDiscard(planId: string): Result { let r: Result; try { r = { ok: true, data: discardPlan(planId) }; } catch (e) { r = asResult(e); } log('ui', 'discard_plan', { plan_id: planId }, r); return r; }
setRunner({ preview, batch });
setCommands({ call, propose });
// the API-key provider's tool loop runs edits as plans and shows them in the panel
setExec((name, input) => { const r = call(name, input, { source: 'api', perm: 'approve' }); if (r.ok && r.data?.plan_id && r.data.status === 'ready') push({ kind: 'plan', planId: r.data.plan_id }); return r as any; });
/** tests: switch to the scripted provider (never offered in the UI) */
export function useDemoProvider() { registerProvider(demoProvider); aiSettings.value = { ...aiSettings.peek(), enabled: true, provider: 'demo' }; }
export * as settings from './settings';
export * as session from './session';
export * as providers from './providers';
export * as plans from './plans';
export { compByTag };
