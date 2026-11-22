// AI settings (Settings › AI & Connections). Everything is off by default; only values that differ from the defaults
// are stored (IndexedDB, key "ai.settings", with a schemaVersion). AI off = no AI network calls, no AI processes,
// MCP closed, launcher removed.
import { signal, computed, effect } from '@preact/signals';
import { kvGet, kvSet } from '../db';
import { ghostOn } from './plans';

export type McpPerm = 'read' | 'approve' | 'free';
export type ProviderId = 'none' | 'claude-cli' | 'codex-cli' | 'api-key' | 'demo';
export type AiSettings = {
  enabled: boolean; showLauncher: boolean; ghost: boolean; askApply: boolean; verify: boolean; sendSim: boolean;
  mcp: boolean; mcpPerm: McpPerm; cli: boolean; provider: ProviderId; apiVendor: 'anthropic' | 'openai'; apiModel: string;
};
export const AI_SCHEMA = 1;
export const AI_DEFAULTS: AiSettings = { enabled: false, showLauncher: true, ghost: true, askApply: true, verify: true, sendSim: false, mcp: false, mcpPerm: 'approve', cli: false, provider: 'none', apiVendor: 'anthropic', apiModel: '' };
/** fixed rules shown as locked switches: they are not settings */
export const LOCKED = { neverPrivate: true, frozenEdit: false };

export const aiSettings = signal<AiSettings>({ ...AI_DEFAULTS });
export const aiOn = computed(() => aiSettings.value.enabled);
/** HYDRA.exe (Tauri) — the web / HYDRA.bat build has no MCP server and no CLI bridge */
export const isDesktop = () => !!(window as any).__TAURI__;

export function overridesOf(s: AiSettings) { const o: any = {}; (Object.keys(AI_DEFAULTS) as (keyof AiSettings)[]).forEach(k => { if (s[k] !== AI_DEFAULTS[k]) o[k] = s[k]; }); return o; }
export function saveAiSettings(s: AiSettings) { aiSettings.value = { ...s }; kvSet('ai.settings', { schemaVersion: AI_SCHEMA, ...overridesOf(s) }); }
export async function loadAiSettings() {
  const raw: any = await kvGet('ai.settings', null);
  if (!raw || typeof raw !== 'object') return;
  const o: any = {}; (Object.keys(AI_DEFAULTS) as (keyof AiSettings)[]).forEach(k => { if (k in raw && typeof raw[k] === typeof AI_DEFAULTS[k]) o[k] = raw[k]; });
  aiSettings.value = { ...AI_DEFAULTS, ...o };
}
// the ghost layer follows "Show AI ghost previews" and the master switch
effect(() => { const s = aiSettings.value; ghostOn.value = s.enabled && s.ghost; });
