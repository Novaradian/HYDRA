// AI plans: a proposed change shown as a ghost on the canvas until the user presses Apply (one undo step) or Discard.
// A plan is a list of edit commands plus a preview copy of the project. If the user edits the project meanwhile, the
// plan is re-run on the new version; if it no longer fits it turns "stale" and cannot be applied.
import { signal, effect } from '@preact/signals';
import * as S from '../store';
import { uid } from '../util';
import type { Project } from '../store';
import { geomOf } from '../designer/geom';
import { ruleCheck } from '../designer/model';
import type { Sheet } from '../designer/model';
import { AiError, fail } from './core';

export type PlanStatus = 'ready' | 'stale' | 'applied' | 'discarded';
export type Plan = {
  id: string; label: string; source: string; steps: { cmd: string; args?: any }[]; created: string;
  projectId: string; baseVer: number; project: Project | null; data: any[]; status: PlanStatus; error?: string;
  sheets: string[]; problems: { sheet: string; level: string; text: string }[]; sim?: any; requested?: boolean;
};
export const plans = signal<Plan[]>([]);
/** "Show ghost previews" (Settings › AI & Connections) */
export const ghostOn = signal(true);

// the command layer registers itself here (avoids a module cycle with api.ts)
type Runner = { preview: (steps: any[], ctx: any) => any; batch: (steps: any[], ctx: any) => any };
let R: Runner | null = null; export const setRunner = (r: Runner) => { R = r; };

const live = () => S.project.peek();
const upd = (id: string, patch: Partial<Plan>) => { plans.value = plans.peek().map(p => p.id === id ? { ...p, ...patch } : p); };
export const getPlan = (id: string) => plans.peek().find(p => p.id === id) || null;
export const openPlans = () => plans.value.filter(p => (p.status === 'ready' || p.status === 'stale') && p.projectId === S.project.value?.manifest.projectId);

/** a sheet with all its lists (sheets never opened in the designer may lack some) */
const lists = (c: any): Sheet => ({ ...(c || {}), components: c?.components || [], pipes: c?.pipes || [], junctions: c?.junctions || [], texts: c?.texts || [], enclosures: c?.enclosures || [] });
/** the sheets a plan changes (by reference: immer keeps unchanged sheets identical) */
function changedSheets(base: Project, next: Project) { return Object.keys(next.circuits).filter(k => next.circuits[k] !== base.circuits[k]); }
function problemsOf(next: Project, sheets: string[]) {
  return sheets.flatMap(id => { const sh = next.circuits[id] as Sheet; if (!sh?.components || (sh.type !== 'hydraulic' && sh.type !== 'pneumatic')) return []; return ruleCheck(sh, next).filter(i => i.level === 'err' || i.level === 'warn').map(i => ({ sheet: sh.name, level: i.level, text: i.text })); });
}
function compute(steps: any[], ctx: any) {
  const base = live()!; const r = R!.preview(steps, ctx);
  if (!r.ok) return { ok: false as const, error: r.error as string, details: r.details as string[] | undefined };
  const sheets = changedSheets(base, r.project);
  return { ok: true as const, project: r.project as Project, data: r.data, sheets, problems: problemsOf(r.project, sheets) };
}

export function createPlan(steps: any[], ctx: { source?: string; label?: string } = {}) {
  const p = live(); if (!p) fail('No project is open in HYDRA');
  const c = compute(steps, ctx); if (!c.ok) throw new AiError(c.error, c.details);
  const plan: Plan = { id: uid('plan'), label: ctx.label || 'AI change', source: ctx.source || 'ui', steps, created: new Date().toISOString(), projectId: p!.manifest.projectId,
    baseVer: S.histVer.peek(), project: c.project, data: c.data, status: 'ready', sheets: c.sheets, problems: c.problems };
  // applied / discarded plans stay listed (their project copy is dropped) so their cards remain in the conversation
  plans.value = [...plans.peek(), plan].slice(-60);
  return plan;
}
/** what the AI and the panel see about a plan */
export function planSummary(pl: Plan) {
  const base = live(); const out: any = { plan_id: pl.id, status: pl.status, label: pl.label, commands: pl.steps.length };
  if (pl.error) out.error = pl.error;
  if (base && pl.project) {
    const added: string[] = [], removed: string[] = []; let lines = 0;
    pl.sheets.forEach(id => { const a = lists(base.circuits[id]), b = lists(pl.project!.circuits[id]);
      const ai = new Set(a.components.map(c => c.id)), bi = new Set(b.components.map(c => c.id));
      b.components.forEach(c => { if (!ai.has(c.id)) added.push(c.tag); }); a.components.forEach(c => { if (!bi.has(c.id)) removed.push(c.tag); });
      const ap = new Set(a.pipes.map(q => q.id)); lines += b.pipes.filter(q => !ap.has(q.id)).length; });
    if (added.length) out.added = added; if (removed.length) out.removed = removed; if (lines) out.new_lines = lines;
  }
  out.problems = pl.problems.map(q => `${q.level}: ${q.text}`);
  if (pl.sim) out.sim = pl.sim;
  return out;
}

/** user pressed Apply (or the AI may apply freely): the plan's commands run on the live project as ONE undo step */
export function applyPlan(id: string, ctx: { source?: string } = {}) {
  const pl = getPlan(id); if (!pl) fail(`No plan ${id}`);
  if (pl!.status === 'applied') fail('This plan was already applied'); if (pl!.status === 'discarded') fail('This plan was discarded');
  if (pl!.projectId !== live()?.manifest.projectId) fail('This plan belongs to another project');
  refresh(pl!); const cur = getPlan(id)!;
  if (cur.status === 'stale') fail(`The plan no longer fits the drawing: ${cur.error}`);
  const r = R!.batch(cur.steps, { source: ctx.source || 'ui', label: cur.label.replace(/^AI: /, '') });
  if (!r.ok) { upd(id, { status: 'stale', error: r.error }); throw new AiError(r.error, r.details); }
  upd(id, { status: 'applied', project: null });
  return { plan_id: id, applied: true, undo: r.undo };
}
export function discardPlan(id: string) {
  const pl = getPlan(id); if (!pl) fail(`No plan ${id}`);
  if (pl!.status === 'applied') fail('This plan was already applied — use Undo');
  upd(id, { status: 'discarded', project: null }); return { plan_id: id, discarded: true };
}
export function setPlanSim(id: string, sim: any) { upd(id, { sim }); }
export function markRequested(id: string) { upd(id, { requested: true }); }

/** re-run a plan on the current project when it changed since the plan was made */
function refresh(pl: Plan) {
  if (pl.status !== 'ready' && pl.status !== 'stale') return;
  const p = live(); if (!p || p.manifest.projectId !== pl.projectId || pl.baseVer === S.histVer.peek()) return;
  const c = compute(pl.steps, { source: pl.source });
  if (!c.ok) upd(pl.id, { status: 'stale', error: c.error, baseVer: S.histVer.peek() });
  else upd(pl.id, { status: 'ready', error: undefined, project: c.project, data: c.data, sheets: c.sheets, problems: c.problems, baseVer: S.histVer.peek(), sim: undefined });
}
// keep open plans in step with the drawing (edits, undo, redo)
effect(() => { S.histVer.value; S.project.value; if (!R) return; plans.peek().forEach(pl => { try { refresh(pl); } catch { } }); });

/** for the ghost: added / changed / removed items of one sheet in the newest open plan that touches it */
export function ghostOf(sheetId: string) {
  if (!ghostOn.value) return null;
  const pl = [...openPlans()].reverse().find(p => p.status === 'ready' && p.project && p.sheets.includes(sheetId)); if (!pl) return null;
  if (!S.project.value?.circuits[sheetId] || !pl.project!.circuits[sheetId]) return null;
  const a = lists(S.project.value.circuits[sheetId]), b = lists(pl.project!.circuits[sheetId]);
  const same = (x: any, y: any) => JSON.stringify(x) === JSON.stringify(y);
  const am = new Map(a.pipes.map(q => [q.id, q])), bc = new Set(b.components.map(c => c.id)), bp = new Set(b.pipes.map(q => q.id));
  const ac = new Set(a.components.map(c => c.id)), aj = new Set(a.junctions.map(j => j.id));
  return { plan: pl, sheet: b, base: a,
    comps: b.components.filter(c => !ac.has(c.id)),
    pipes: b.pipes.filter(q => !am.has(q.id) || !same(am.get(q.id), q)),
    juncs: b.junctions.filter(j => !aj.has(j.id)),
    goneComps: a.components.filter(c => !bc.has(c.id)).map(c => ({ c, g: geomOf(c.ref) })),
    gonePipes: a.pipes.filter(q => !bp.has(q.id)) };
}
