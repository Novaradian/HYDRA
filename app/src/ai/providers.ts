// The AIs that chat in HYDRA's panel (HYDRA.exe only):
// · claude-cli / codex-cli — the user's own Claude Code or Codex, run in the background by HYDRA.exe. Sign-in happens in
//   the CLI; HYDRA never sees passwords or tokens. The CLI reaches HYDRA only through HYDRA's MCP tools.
// · api-key — the user's own Anthropic or OpenAI key, kept in the Windows Credential Manager; HYDRA.exe adds it to the
//   request, the page never sees it. The tool loop runs here, on the same command API.
// Every edit becomes a plan that waits for Apply. No AI gets file, shell or web tools.
import { signal } from '@preact/signals';
import { uid } from '../util';
import { aiSettings } from './settings';
import { registerProvider, push, thread, type Provider, type Input, type Out, type Mode } from './session';
import { MCP_TOOLS } from './schemas';

const T = () => (window as any).__TAURI__;
export const cliInfo = signal<{ claude: string | null; codex: string | null; codexSignedIn?: boolean | null } | null>(null);
export const keysSaved = signal<Record<string, boolean>>({});
export const refreshCli = () => T().core.invoke('ai_cli_detect').then((r: any) => { cliInfo.value = r; }).catch(() => { cliInfo.value = { claude: null, codex: null }; });
export const refreshKeys = () => Promise.all(['anthropic', 'openai'].map(p => T().core.invoke('ai_key_has', { provider: p }).then((x: boolean) => [p, !!x]).catch(() => [p, false]))).then(r => { keysSaved.value = Object.fromEntries(r); });

export const SYSTEM = `You are the assistant inside HYDRA, an offline CAD and simulator for hydraulic and pneumatic circuits (ISO 1219 symbols, ISO 1219-2 tags such as 1P1 pump, 1V1 valve, 1A1 actuator, 1Z1 tank).
Work only through the hydra tools; you have no file, shell or web access. Keep replies short.
New circuit (Build): 1) get_question_template, then ask_user with the few questions that matter (each can be left to you) — then stop. 2) With the answers, use search_library / describe_part, then propose_bom (tag, part, ref, rating, one-line assumptions) — HYDRA adds its mandatory parts — then stop. 3) After approval call build_circuit ONCE with the whole circuit: parts with ref, tag, x, y in mm (A3 sheet, x 40..380, y 30..270; actuators at the top, valves in the middle, pump, motor and tank at the bottom) and nets as lists of TAG.PORT; then validate and run_sim with the plan id and fix problems (at most 3 rounds).
Edits become a plan shown in HYDRA as a faded preview; only the user applies it. Never say it is applied.
Ask: answer from get_sheet / validate. Fix errors: validate, then propose the fixes as one plan. PLC logic: create_for with domain logic and a sequence such as ["1A1+","1A1-"].`;
const MODE: Record<Mode, string> = { build: 'Build', ask: 'Ask', fix: 'Fix errors', plc: 'PLC logic' };
/** what the provider receives for one turn: typed text, the form's answers, or the approved parts list */
export function turnText(inp: Input) {
  if (inp.approvedBom) return `[Mode: Build] The user approved this parts list (locked rows are HYDRA's mandatory parts):\n${JSON.stringify(inp.approvedBom.map(r => ({ tag: r.tag, part: r.part, ref: (r as any).ref, rating: r.rating })))}\nNow build it with build_circuit (one call), then validate and run_sim on the plan.`;
  if (inp.answers) { const ai = Object.keys(inp.answers).filter(k => k.startsWith('_ai_')).map(k => k.slice(4)); const ans = Object.fromEntries(Object.entries(inp.answers).filter(([k]) => !k.startsWith('_ai_')));
    return `[Mode: Build] The user answered: ${JSON.stringify(ans)}${ai.length ? `. Decide these yourself: ${ai.join(', ')}` : ''}. Continue with propose_bom.`; }
  return `[Mode: ${MODE[inp.mode]}] ${inp.text || ''}`;
}

// ---------- CLI bridge ----------
export const cliClient = 'cli-' + uid('k') + Math.random().toString(36).slice(2, 10); // marks this HYDRA's own CLI runs on the MCP side
const sessions: Record<string, string | null> = { claude: null, codex: null };
let lastLen = 0; const resetIfCleared = () => { if (thread.peek().length < lastLen) { sessions.claude = null; sessions.codex = null; history.length = 0; } lastLen = thread.peek().length; };
let current: { run: string; done: (e?: string) => void; onLine: (l: string) => void } | null = null;
let listening = false;
async function ensureListen() {
  if (listening) return; listening = true;
  await T().event.listen('ai-cli', (e: any) => { const p = e?.payload || {}; if (!current || p.run !== current.run) return;
    if (p.kind === 'line') current.onLine(String(p.line || ''));
    else if (p.kind === 'done') { const c = current; current = null; c.done(p.code === 0 ? undefined : (p.err || `stopped (exit code ${p.code})`).trim().split('\n').slice(-4).join('\n')); } });
}
export const stopRun = () => { if (current) T().core.invoke('ai_cli_stop', { run: current.run }).catch(() => { }); };

function claudeLine(l: string, out: Out, said: Set<string>) {
  let o: any; try { o = JSON.parse(l); } catch { return; }
  if (o.session_id) sessions.claude = o.session_id;
  if (o.type === 'assistant' && Array.isArray(o.message?.content)) o.message.content.forEach((b: any) => { if (b.type === 'text' && b.text?.trim() && !said.has(b.text)) { said.add(b.text); out.say(b.text.trim()); } });
  if (o.type === 'result' && o.is_error) out.error(String(o.result || o.subtype || 'Claude Code stopped with an error'));
}
function codexLine(l: string, out: Out) {
  let o: any; try { o = JSON.parse(l); } catch { return; }
  if (o.type === 'thread.started' && o.thread_id) sessions.codex = o.thread_id;
  if (o.type === 'item.completed' && o.item?.type === 'agent_message' && o.item.text?.trim()) out.say(o.item.text.trim());
  if (o.type === 'turn.failed' || o.type === 'error') out.error(String(o.error?.message || o.message || 'Codex stopped with an error'));
}
function cliProvider(id: 'claude-cli' | 'codex-cli', label: string, detail: string): Provider {
  const tool = id === 'claude-cli' ? 'claude' : 'codex';
  return { id, label, detail, source: 'cli',
    status: () => { const c = cliInfo.value; if (!c) return 'missing'; if (!(c as any)[tool]) return 'missing'; if (tool === 'codex' && c.codexSignedIn === false) return 'signed-out'; return 'ready'; },
    async send(inp, out) {
      if (!aiSettings.peek().cli) throw new Error('The CLI bridge is off — turn it on in Settings › AI & Connections');
      resetIfCleared(); await ensureListen();
      const first = !sessions[tool]; const said = new Set<string>();
      const prompt = (tool === 'codex' && first ? SYSTEM + '\n\n' : '') + turnText(inp);
      const run: string = await T().core.invoke('ai_cli_run', { tool, prompt, resume: sessions[tool], system: SYSTEM, client: cliClient });
      await new Promise<void>((res, rej) => { current = { run, onLine: l => tool === 'claude' ? claudeLine(l, out, said) : codexLine(l, out), done: e => e ? rej(new Error(e)) : res() }; });
      lastLen = thread.peek().length;
    } };
}

// ---------- own API key (Anthropic Messages API / OpenAI Chat Completions), tool loop here ----------
const history: any[] = [];
const DEFAULT_MODEL: Record<string, string> = { anthropic: 'claude-opus-5-5', openai: 'gpt-5' };
type Exec = (name: string, input: any) => { ok: boolean; data?: any; error?: string; details?: string[] };
let exec: Exec | null = null; export const setExec = (f: Exec) => { exec = f; };
const toolResult = (r: ReturnType<Exec>) => JSON.stringify(r.ok ? r.data : { error: r.error, details: r.details });
const apiProvider: Provider = { id: 'api-key', label: 'API key', detail: 'Your own Anthropic or OpenAI key', source: 'ui' as any,
  status: () => keysSaved.value[aiSettings.value.apiVendor] ? 'ready' : 'missing',
  async send(inp, out) {
    resetIfCleared();
    const vendor = aiSettings.peek().apiVendor; const model = aiSettings.peek().apiModel.trim() || DEFAULT_MODEL[vendor];
    history.push(vendor === 'anthropic' ? { role: 'user', content: turnText(inp) } : { role: 'user', content: turnText(inp) });
    for (let turn = 0; turn < 16; turn++) {
      if (vendor === 'anthropic') {
        const body = { model, max_tokens: 16000, system: SYSTEM, messages: history, output_config: { effort: 'medium' }, fallbacks: 'default', cache_control: { type: 'ephemeral' },
          tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) };
        const r: any = await T().core.invoke('ai_api_chat', { provider: 'anthropic', body });
        history.push({ role: 'assistant', content: r.content }); // thinking blocks go back unchanged
        (r.content || []).forEach((b: any) => { if (b.type === 'text' && b.text?.trim()) out.say(b.text.trim()); });
        if (r.stop_reason === 'refusal') { out.error('The model declined this request.'); return; }
        if (r.stop_reason !== 'tool_use') { if (r.stop_reason === 'max_tokens') out.say('(The answer was cut off — ask to continue.)'); lastLen = thread.peek().length; return; }
        const results = (r.content || []).filter((b: any) => b.type === 'tool_use').map((b: any) => { const x = exec!(b.name, b.input || {}); return { type: 'tool_result', tool_use_id: b.id, content: toolResult(x), ...(x.ok ? {} : { is_error: true }) }; });
        history.push({ role: 'user', content: results });
      } else {
        const body = { model, messages: [{ role: 'system', content: SYSTEM }, ...history], tools: MCP_TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) };
        const r: any = await T().core.invoke('ai_api_chat', { provider: 'openai', body });
        const m = r.choices?.[0]?.message; if (!m) throw new Error('Empty answer from OpenAI');
        history.push(m); if (m.content?.trim()) out.say(m.content.trim());
        if (!m.tool_calls?.length) { lastLen = thread.peek().length; return; }
        m.tool_calls.forEach((c: any) => { let a: any = {}; try { a = JSON.parse(c.function?.arguments || '{}'); } catch { } const x = exec!(c.function?.name, a); history.push({ role: 'tool', tool_call_id: c.id, content: toolResult(x) }); });
      }
    }
    out.say('(Stopped after 16 tool rounds.)');
  } };

export function registerDesktopProviders() {
  registerProvider(cliProvider('claude-cli', 'Claude · Claude Code CLI', 'Your own Claude Code (experimental)'));
  registerProvider(cliProvider('codex-cli', 'ChatGPT · Codex CLI', 'Your own Codex CLI (experimental)'));
  registerProvider(apiProvider);
  refreshCli(); refreshKeys();
}
export { push };
