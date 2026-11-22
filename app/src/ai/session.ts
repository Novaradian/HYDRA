// AI panel state and the provider layer. A provider turns what the user typed into thread items (text, a question
// form, a parts list) and into commands through the command API — always as plans (Edit with approval), so nothing
// reaches the drawing before the user presses Apply. Providers: claude-cli / codex-cli / api-key arrive with the
// connections; "demo" is a scripted provider used by the tests.
import { signal, computed, effect } from '@preact/signals';
import * as S from '../store';
import { uid } from '../util';
import { kvGet, kvSet } from '../db';
import { aiSettings, aiOn, type ProviderId } from './settings';
export { aiOn };
import { plans, openPlans, getPlan } from './plans';
import { D } from '../designer/state';

export type Mode = 'build' | 'ask' | 'fix' | 'plc';
export type Question = { id: string; label: string; type: 'select' | 'number' | 'radio' | 'check' | 'text'; options?: string[]; unit?: string; value?: any; decide?: boolean };
export type BomRow = { tag: string; part: string; rating: string; locked?: boolean };
export type Item =
  | { id: string; kind: 'user'; text: string; mode: Mode }
  | { id: string; kind: 'ai'; text: string }
  | { id: string; kind: 'questions'; title: string; questions: Question[]; done?: boolean }
  | { id: string; kind: 'bom'; title: string; rows: BomRow[]; assumptions: string[]; done?: boolean }
  | { id: string; kind: 'plan'; planId: string; text?: string }
  | { id: string; kind: 'error'; text: string };
type NewItem = Item extends infer T ? T extends any ? Omit<T, 'id'> : never : never;

export const panelOpen = signal(false);
export const pinned = signal(false); kvGet('ai.panel', null).then((v: any) => { if (v && typeof v.pinned === 'boolean') pinned.value = v.pinned; });
export const setPinned = (v: boolean) => { pinned.value = v; kvSet('ai.panel', { pinned: v }); };
export const mode = signal<Mode>('build');
export const thread = signal<Item[]>([]);
export const busy = signal(false);
export const lastError = signal<string>('');
/** something the user applied in this session: offers Create Electric / Logic Code / Controller-HMI */
export const appliedOnce = signal(false);

export const push = (it: NewItem) => { const x = { ...it, id: uid('ai') } as Item; thread.value = [...thread.peek(), x]; return x; };
export const patchItem = (id: string, p: Partial<Item>) => { thread.value = thread.peek().map(x => x.id === id ? { ...x, ...p } as Item : x); };
export const clearThread = () => { thread.value = []; lastError.value = ''; };

// ---------- providers ----------
export type Out = {
  say(text: string): void; error(text: string): void;
  questions(title: string, qs: Question[]): void; bom(title: string, rows: BomRow[], assumptions: string[]): void;
  /** a read command (get_sheet, validate, run_sim …) */ read(cmd: string, args?: any): any;
  /** edits as one plan → ghost → Apply */ propose(steps: { cmd: string; args?: any }[], label?: string): string | null;
};
export type Input = { mode: Mode; text?: string; answers?: Record<string, any>; approvedBom?: BomRow[]; sheet?: string | null };
export type Provider = { id: ProviderId; label: string; detail: string; source: 'cli' | 'ui' | 'test'; status(): 'ready' | 'missing' | 'signed-out'; send(inp: Input, out: Out): Promise<void> };
const PROVIDERS = new Map<string, Provider>();
export const registerProvider = (p: Provider) => { PROVIDERS.set(p.id, p); providersVer.value++; };
export const providersVer = signal(0);
export const provider = computed(() => { providersVer.value; const id = aiSettings.value.provider; return id === 'none' ? null : PROVIDERS.get(id) || null; });
export const providerList = () => [...PROVIDERS.values()].filter(p => p.id !== 'demo');

// the command layer is injected to keep this module free of a cycle with api.ts
type Cmds = { call: (cmd: string, args: any, ctx: any) => any; propose: (steps: any[], ctx: any) => any };
let C: Cmds | null = null; export const setCommands = (c: Cmds) => { C = c; };

function outFor(p: Provider): Out {
  const ctx = { source: p.source === 'ui' ? 'ui' : p.source, perm: 'approve' as const };
  return {
    say: text => push({ kind: 'ai', text }), error: text => { lastError.value = text; push({ kind: 'error', text }); },
    questions: (title, questions) => push({ kind: 'questions', title, questions }),
    bom: (title, rows, assumptions) => push({ kind: 'bom', title, rows, assumptions }),
    read: (cmd, args = {}) => { const r = C!.call(cmd, args, ctx); if (!r.ok) throw new Error(r.error + (r.details ? ' — ' + r.details.join('; ') : '')); return r.data; },
    propose: (steps, label) => { const r = C!.propose(steps, { ...ctx, label }); if (!r.ok) { push({ kind: 'error', text: r.error + (r.details ? ' — ' + r.details.join('; ') : '') }); return null; } push({ kind: 'plan', planId: r.data.plan_id }); return r.data.plan_id; }
  };
}
/** one turn: the user's message (or form answers / approved parts list) goes to the provider */
export async function send(inp: Input) {
  const p = provider.value; if (!aiOn.value) return;
  if (!p) { push({ kind: 'error', text: 'No AI is connected — choose one in Settings › AI & Connections.' }); return; }
  if (inp.text) push({ kind: 'user', text: inp.text, mode: inp.mode });
  busy.value = true; lastError.value = '';
  try { await p.send(inp, outFor(p)); }
  catch (e: any) { lastError.value = e?.message || String(e); push({ kind: 'error', text: lastError.value }); }
  finally { busy.value = false; }
}

// ---------- launcher status: off · none (not connected) · ready · working · apply (plan waiting) · error ----------
export type Status = 'off' | 'none' | 'ready' | 'working' | 'apply' | 'error';
export const status = computed<Status>(() => {
  if (!aiOn.value) return 'off';
  if (busy.value) return 'working';
  plans.value; if (openPlans().some(p => p.status === 'ready')) return 'apply';
  if (lastError.value) return 'error';
  const p = provider.value; if (!p) return 'none';
  return p.status() === 'ready' ? 'ready' : 'none';
});
export const STATUS_TEXT: Record<Status, string> = { off: 'AI off', none: 'Not connected', ready: 'Ready', working: 'Working…', apply: 'Plan waiting for Apply', error: 'Error' };
// master switch off: the panel closes
effect(() => { if (!aiOn.value) panelOpen.value = false; });
export function togglePanel(force?: boolean) { if (!aiOn.value) return; panelOpen.value = force ?? !panelOpen.value; }
export const planOf = (id: string) => { plans.value; return getPlan(id); };
/** the sheet open in the designer: name and type, for the composer's context chip */
export const sheetInfo = () => { const id = (D.value as any)?.sheetId; const p = S.project.value; const n = id && p?.nodes[id]; return n ? { id, name: n.name, type: (p!.circuits[id] as any)?.type || n.sheetType || '' } : null; };
