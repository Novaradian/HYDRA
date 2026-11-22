// HYDRA.exe only: the app side of the MCP server. The Rust listener (127.0.0.1, session token) hands each tool call
// to this page; it runs through the command API with the permission the user chose (Read only / Edit with approval /
// Edit freely) — never what the AI client asks for. The listener is open only while AI features and MCP are on.
import { signal, effect } from '@preact/signals';
import { aiSettings, isDesktop } from './settings';
import { call, mcpLast } from './api';
import { cliClient } from './providers';
import { push } from './session';

const T = () => (window as any).__TAURI__;
export const mcpState = signal<{ listening: boolean; port?: number; error?: string }>({ listening: false });
let started = false;

export async function startMcpBridge() {
  if (started || !isDesktop()) return; started = true;
  await T().event.listen('ai-mcp-call', (e: any) => {
    const { rid, tool, args, client } = e?.payload || {};
    const s = aiSettings.peek(); const a = args && typeof args === 'object' ? args : {};
    // HYDRA's own Claude Code / Codex run (CLI bridge): always Edit with approval, plans shown in the AI panel
    const fromCli = !!client && client === cliClient;
    let result: any;
    if (fromCli) { result = call(String(tool || ''), a, { source: 'cli', perm: 'approve' }); if (result.ok && result.data?.plan_id && result.data.status === 'ready') push({ kind: 'plan', planId: result.data.plan_id }); }
    else if (s.enabled && s.mcp) { result = call(String(tool || ''), a, { source: 'mcp', perm: s.mcpPerm }); mcpLast.value = { client: String(client || ''), t: Date.now(), ok: !!result.ok };
      // Edit with approval: the plan card (with Apply) goes into the AI panel so the user can approve it in HYDRA
      if (result.ok && result.data?.plan_id && result.data.status === 'ready') push({ kind: 'plan', planId: result.data.plan_id }); }
    else result = { ok: false, error: 'The MCP server is off in HYDRA (Settings › AI & Connections)' };
    T().core.invoke('ai_mcp_reply', { rid, result }).catch(() => { });
  });
  effect(() => {
    const s = aiSettings.value; const on = s.enabled && (s.mcp || s.cli); // the CLI bridge reaches HYDRA through the same listener
    T().core.invoke('ai_mcp_listen', { on }).then((r: any) => { mcpState.value = { listening: !!r?.listening, port: r?.port }; })
      .catch((err: any) => { mcpState.value = { listening: false, error: String(err) }; });
  });
}

// ---------- desktop helpers for the Connect dialog (the API key itself never comes back to the page) ----------
const inv = (cmd: string, args?: any) => isDesktop() ? T().core.invoke(cmd, args) : Promise.reject(new Error('Needs HYDRA.exe'));
export const claudeConfig = (write: boolean) => inv('ai_claude_config', { write });
export const detectCli = () => inv('ai_cli_detect');
export const keySet = (provider: string, key: string) => inv('ai_key_set', { provider, key });
export const keyHas = (provider: string) => inv('ai_key_has', { provider });
export const keyDelete = (provider: string) => inv('ai_key_delete', { provider });
