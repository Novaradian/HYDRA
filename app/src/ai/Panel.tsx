// HYDRA AI — launcher (title bar), the AI panel (floating over the canvas or pinned in the right dock), its cards,
// the AI log and Settings › AI & Connections. Built from HYDRA's own components and theme tokens.
import { h, Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import * as S from '../store';
import { t } from '../i18n';
import { Icon, Btn } from '../ui/common';
import { D, sel, rightTab } from '../designer/state';
import { aiSettings, aiOn, isDesktop, LOCKED, saveAiSettings, type AiSettings } from './settings';
import { panelOpen, pinned, setPinned, mode, thread, busy, send, status, STATUS_TEXT, togglePanel, planOf, sheetInfo, patchItem, provider, providerList, appliedOnce, push, type Item, type Question, type BomRow, type Mode } from './session';
import { aiLog, mcpLast, MCP_ACTIVE_MS, userApply, userDiscard, propose } from './api';
import { stopRun } from './providers';
import { planSummary } from './plans';

// ---------- launcher: title bar, next to the OFFLINE pill ----------
export function AiLauncher() {
  const s = aiSettings.value; if (!s.enabled || !s.showLauncher) return null;
  const st = status.value; const p = provider.value;
  const tip = `HYDRA AI · ${p && st !== 'none' ? p.label + ' · ' : ''}${t(STATUS_TEXT[st])} · \``;
  return <button class={'ailaunch ' + st} title={tip} aria-label={tip} onClick={() => st === 'none' && !panelOpen.value ? S.openModal('aiconnect') : togglePanel()}>
    <Icon name="sparkles" size={14} /><i class="aidot" /></button>;
}

// ---------- the panel: floating unless pinned into the designer's right dock ----------
export function AiHost() {
  if (!aiOn.value || !panelOpen.value) return null;
  if (pinned.value && D.value) return null; // shown as the AI tab of the right dock
  return <div class="aipanel float" role="dialog" aria-label="HYDRA AI"><AiPanel /></div>;
}
const MODES: [Mode, string][] = [['build', 'Build'], ['ask', 'Ask'], ['fix', 'Fix errors'], ['plc', 'PLC logic']];
export function AiPanel({ docked }: { docked?: boolean }) {
  const p = provider.value; const items = thread.value; const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [items.length, busy.value]);
  // an outside AI app driving HYDRA over MCP (section B of Connect) — separate from the in-panel provider above
  const [, tick] = useState(0); useEffect(() => { const i = setInterval(() => tick(x => x + 1), 15e3); return () => clearInterval(i); }, []);
  const m = mcpLast.value; const mcp = m && Date.now() - m.t < MCP_ACTIVE_MS ? m.client || t('AI app') : '';
  return <div class={'aibody' + (docked ? ' docked' : '')}>
    <header class="aihead"><Icon name="sparkles" size={14} /><b>HYDRA AI</b>
      <button class="aipill" title={t('Change AI')} onClick={() => S.openModal('aiconnect')}><i class={'aidot ' + status.value} />{p ? p.label : t('Not connected')}<Icon name="chevron-down" size={12} /></button>
      {mcp && <span class="aipill aimcp" title={`${t('Last MCP call')}: ${new Date(m!.t).toLocaleTimeString()}${m!.ok ? '' : ' · ' + t('Error')}`}><i class={'aidot ' + (m!.ok ? 'ready' : 'error')} />MCP: {mcp} · {t('active')}</span>}
      <div class="grow" />
      <button class="iconbtn" title={pinned.value ? t('Float over the canvas') : t('Pin to the right dock')} aria-label={t('Pin')} onClick={() => { const v = !pinned.value; setPinned(v); if (v && D.value) rightTab.value = 'ai' as any; else if (!v && (rightTab.value as string) === 'ai') rightTab.value = 'props'; }}><Icon name={pinned.value ? 'pin-off' : 'pin'} size={14} /></button>
      {!docked && <button class="iconbtn" title={t('Close')} aria-label={t('Close')} onClick={() => togglePanel(false)}><Icon name="x" size={14} /></button>}
    </header>
    <div class="aimodes" role="tablist">{MODES.map(([k, l]) => <button role="tab" aria-selected={mode.value === k} class={mode.value === k ? 'on' : ''} onClick={() => mode.value = k}>{t(l)}</button>)}</div>
    <div class="aithread">
      {!items.length && <div class="aiempty"><Icon name="message-square" size={22} /><p>{p ? t('Describe a circuit, ask about the sheet, or let the AI find errors.') : t('No AI is connected yet.')}</p>
        {mcp && <p class="aimcpnote">{t('{{c}} is using HYDRA over MCP. Its commands show in the AI log; plans to approve appear here.', { c: mcp })}</p>}
        {!p &&<Btn icon="plug" label={t('Connect an AI…')} onClick={() => S.openModal('aiconnect')} />}</div>}
      {items.map(it => <ItemView it={it} />)}
      {busy.value && <div class="aimsg ai busy"><span class="aidots"><i /><i /><i /></span>{p?.source === 'cli' && <button class="link aistop" onClick={stopRun}>{t('Stop')}</button>}</div>}
      <div ref={end} />
    </div>
    <Composer />
  </div>;
}
function ItemView({ it }: { it: Item }) {
  switch (it.kind) {
    case 'user': return <div class="aimsg user">{it.text}</div>;
    case 'ai': return <div class="aimsg ai">{it.text}</div>;
    case 'error': return <div class="aimsg err"><Icon name="circle-alert" size={13} />{it.text}</div>;
    case 'questions': return <QuestionsCard it={it} />;
    case 'bom': return <BomCard it={it} />;
    case 'plan': return <PlanCard planId={it.planId} />;
  }
}

// ---------- question form: every question has "Let AI decide"; plus "Decide all" ----------
function QuestionsCard({ it }: { it: Extract<Item, { kind: 'questions' }> }) {
  const [v, setV] = useState<Record<string, any>>(Object.fromEntries(it.questions.map(q => [q.id, q.value])));
  const [ai, setAi] = useState<Record<string, boolean>>(Object.fromEntries(it.questions.map(q => [q.id, !!q.decide])));
  const go = (all = false) => { if (it.done) return; patchItem(it.id, { done: true } as any);
    const ans: Record<string, any> = {}; it.questions.forEach(q => { if (all || ai[q.id]) ans['_ai_' + q.id] = true; else ans[q.id] = v[q.id]; });
    send({ mode: 'build', answers: ans }); };
  const field = (q: Question) => {
    const dis = it.done || ai[q.id]; const set = (x: any) => setV({ ...v, [q.id]: x });
    if (q.type === 'select') return <select class="in sm" disabled={dis} value={v[q.id]} onChange={(e: any) => set(e.target.value)}>{q.options!.map(o => <option>{o}</option>)}</select>;
    if (q.type === 'radio') return <span class="airadios">{q.options!.map(o => <label><input type="radio" name={it.id + q.id} disabled={dis} checked={v[q.id] === o} onChange={() => set(o)} />{o}</label>)}</span>;
    if (q.type === 'check') return <input type="checkbox" disabled={dis} checked={!!v[q.id]} onChange={(e: any) => set(e.target.checked)} />;
    return <span class="aiin"><input class="in sm" disabled={dis} type={q.type === 'number' ? 'number' : 'text'} value={v[q.id] ?? ''} onInput={(e: any) => set(q.type === 'number' ? +e.target.value : e.target.value)} />{q.unit && <small>{q.unit}</small>}</span>;
  };
  return <div class="aicard"><b class="aict">{it.title}</b>
    <div class="aiq">{it.questions.map(q => <><span class="lbl">{q.label}</span><span>{field(q)}</span><label class="aidecide"><input type="checkbox" disabled={it.done} checked={!!ai[q.id]} onChange={(e: any) => setAi({ ...ai, [q.id]: e.target.checked })} />{t('Let AI decide')}</label></>)}</div>
    {!it.done && <div class="aibtns"><Btn label={t('Decide all')} onClick={() => go(true)} /><div class="grow" /><Btn kind="primary" label={t('Continue →')} onClick={() => go()} /></div>}
  </div>;
}

// ---------- parts list for approval: edit ratings, remove rows; 🔒 = mandatory part added by HYDRA rules ----------
function BomCard({ it }: { it: Extract<Item, { kind: 'bom' }> }) {
  const [rows, setRows] = useState<BomRow[]>(it.rows);
  const ok = () => { if (it.done) return; patchItem(it.id, { done: true } as any); send({ mode: 'build', approvedBom: rows }); };
  return <div class="aicard"><b class="aict">{it.title.replace(/\d+ items/, `${rows.length} items`)}</b>
    <table class="dtable aibom"><thead><tr><th>{t('Tag')}</th><th>{t('Part')}</th><th>{t('Rating')}</th><th /></tr></thead>
      <tbody>{rows.map((r, i) => <tr><td class="mono">{r.tag}</td><td>{r.part}{(r as any).note && <small class="aiwarn aibnote">{(r as any).note}</small>}</td>
        <td>{it.done ? r.rating : <input class="in sm" value={r.rating} onInput={(e: any) => setRows(rows.map((x, j) => j === i ? { ...x, rating: e.target.value } : x))} />}</td>
        <td>{r.locked ? <span title={t('Required by HYDRA rules')}><Icon name="lock" size={12} /></span> : !it.done && <button class="iconbtn" title={t('Remove')} aria-label={t('Remove') + ' ' + r.tag} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>}</td></tr>)}</tbody></table>
    {it.assumptions.length > 0 && <p class="muted small">{t('Assumptions')}: {it.assumptions.join(' · ')}</p>}
    {!it.done && <div class="aibtns"><div class="grow" /><Btn kind="primary" label={t('Approve & build')} onClick={ok} /></div>}
  </div>;
}

// ---------- plan card: commands, rule check, solver check, Apply / Edit plan / Discard ----------
function cmdLines(steps: { cmd: string; args?: any }[]) {
  const out: string[] = [];
  steps.forEach(s => { const a = s.args || {};
    if (s.cmd === 'build_circuit') { (a.parts || []).forEach((p: any) => out.push(`add_component ${p.ref} ${p.tag || ''}${p.values ? ' ' + Object.entries(p.values).map(([k, v]) => `${k}=${v}`).join(' ') : ''}`.trim())); if ((a.nets || []).length) out.push(`connect ×${a.nets.length} nets (auto-route)`); }
    else out.push(`${s.cmd} ${Object.entries(a).filter(([k]) => k !== 'sheet').map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')}`.trim()); });
  return out;
}
function PlanCard({ planId }: { planId: string }) {
  const pl = planOf(planId); if (!pl) return null;
  const sum = pl.project ? planSummary(pl) : null; const lines = cmdLines(pl.steps); const errs = pl.problems.filter(x => x.level === 'err');
  const simOk = pl.sim && !pl.sim.warnings?.some((w: string) => /cavitation|above its rated/.test(w));
  // the solver check is for changes to the fluid drawing; generated electric sheets, programs and panels have nothing to simulate
  const needSim = pl.steps.some(s => s.cmd !== 'create_for');
  const verify = aiSettings.value.verify && needSim; const canApply = pl.status === 'ready' && !errs.length && (!verify || !!pl.sim);
  const apply = () => { const r = userApply(planId); if (r.ok) appliedOnce.value = true; else S.toast((r as any).error, 'warn'); };
  return <div class={'aicard plan ' + pl.status}>
    <b class="aict">{pl.status === 'applied' ? t('Applied') : pl.status === 'discarded' ? t('Discarded') : pl.status === 'stale' ? t('Plan no longer fits the drawing') : `${t('Plan ready')} — ${lines.length} ${t('commands')}. ${aiSettings.value.ghost ? t('Previewed as ghost.') : ''}`}</b>
    <pre class="aicmds">{lines.slice(0, 14).join('\n')}{lines.length > 14 ? `\n… ${lines.length - 14} more` : ''}</pre>
    {pl.status === 'stale' && <p class="aiwarn">{pl.error}</p>}
    {(pl.status === 'ready' || pl.status === 'stale') && <>
      {pl.problems.length > 0 && <ul class="aiprob">{pl.problems.slice(0, 6).map(q => <li class={q.level}>{q.text}</li>)}</ul>}
      {pl.sim ? <div class={'aisim ' + (simOk ? 'ok' : 'bad')}><Icon name={simOk ? 'check-circle' : 'x-circle'} size={14} />{simOk ? t('Solver check passed') : t('Solver check found problems')} · max {pl.sim.peak_bar} bar{pl.sim.actuators?.[0]?.extended_at ? ` · ${pl.sim.actuators[0].extended_at[0]} s` : ''}</div>
        : verify ? <div class="aisim wait"><Icon name="activity" size={14} />{t('Waiting for the solver check')}</div> : null}
      <div class="aibtns"><Btn kind="primary" label={t('Apply to sheet')} disabled={!canApply} title={canApply ? '' : errs.length ? t('Fix the errors first') : t('Waiting for the solver check')} onClick={apply} />
        <Btn label={t('Edit plan')} onClick={() => { userDiscard(planId); draft.value = t('Change the plan: '); }} /><Btn label={t('Discard')} onClick={() => userDiscard(planId)} /></div>
      <p class="muted small">{t('Applies as one undo step (Ctrl+Z).')}{pl.requested ? ' ' + t('The AI asked to apply it.') : ''}</p></>}
    {sum && sum.added && pl.status === 'ready' && pl.steps[0]?.cmd !== 'create_for' && <p class="muted small">{t('Adds')} {sum.added.join(', ')}{sum.removed ? ` · ${t('removes')} ${sum.removed.join(', ')}` : ''}</p>}
    {pl.steps[0]?.cmd === 'create_for' && pl.data?.[0] && <CreateSummary d={pl.data[0]} />}
    {pl.status === 'applied' && pl.steps.some(s => s.cmd === 'build_circuit' || s.cmd === 'add_component' || s.cmd === 'insert_template') && <CreateButtons sheet={pl.steps[0].args?.sheet} />}
  </div>;
}

// ---------- after a hydraulic Apply: electric, logic and controller from the tag list (HYDRA generates them) ----------
function CreateSummary({ d }: { d: any }) {
  return <ul class="aiprob ok">{d.sheets && <li>{t('Electric sheets')}: {d.sheets.join(', ')} ({d.io?.inputs} {t('inputs')}, {d.io?.outputs} {t('outputs')})</li>}
    {d.program && <li>{t('PLC program')}: {d.program}{d.sequence ? ` · AUTO ${d.sequence.join(' ')}` : ''}</li>}{d.panel && <li>{t('Operator panel')}: {d.panel.widgets} {t('widgets')}</li>}
    {(d.notes || []).map((n: string) => <li class="muted">{n}</li>)}</ul>;
}
function CreateButtons({ sheet }: { sheet?: string }) {
  const go = (domain: 'electric' | 'logic' | 'controller', label: string) => { const r = propose([{ cmd: 'create_for', args: { domain, ...(sheet ? { sheet } : {}) } }], { source: 'ui', label }); if (r.ok) push({ kind: 'plan', planId: (r as any).data.plan_id }); else S.toast((r as any).error, 'warn'); };
  return <div class="aibtns aicreate"><Btn icon="zap" label={t('Create Electric')} onClick={() => go('electric', 'create electric')} /><Btn icon="binary" label={t('Create Logic Code')} onClick={() => go('logic', 'create logic code')} /><Btn icon="monitor" label={t('Create Controller-HMI')} onClick={() => go('controller', 'create controller / HMI')} /></div>;
}

// ---------- composer ----------
const draft = signal('');
function Composer() {
  const si = sheetInfo(); const n = si && sel.value.sheet === si.id ? sel.value.ids.length : 0; const s = aiSettings.value;
  const go = () => { const x = draft.value.trim(); if (!x || busy.value) return; draft.value = ''; send({ mode: mode.value, text: x }); };
  return <div class="aicomp">
    <div class="aichips"><span class="aichip">@ {si ? `${si.name} · ${si.type}` : t('no sheet open')}</span><span class="aichip">{t('Selection')}: {n || t('none')}</span>
      <span class="grow" /><small class="muted">{t('Sends')}: {s.sendSim ? t('circuit JSON + simulation results') : t('circuit JSON only')}</small></div>
    <div class="airow"><textarea class="in" rows={2} placeholder={t('Describe a circuit, ask, or fix…')} value={draft.value} disabled={!provider.value}
      onInput={(e: any) => draft.value = e.target.value} onKeyDown={(e: any) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } }} />
      <button class="primary aisend" title={t('Send (Enter)')} aria-label={t('Send')} disabled={busy.value || !provider.value || !draft.value.trim()} onClick={go}><Icon name="send" size={14} /></button></div>
  </div>;
}

// ---------- AI log (designer bottom dock and Settings › Open log) ----------
export function AiLogView() {
  const rows = aiLog.value.slice().reverse();
  if (!rows.length) return <p class="muted pad0">{t('No AI activity yet.')}</p>;
  return <table class="dtable ailog"><thead><tr><th>{t('Time')}</th><th>{t('From')}</th><th>{t('Command')}</th><th>{t('Result')}</th></tr></thead>
    <tbody>{rows.slice(0, 300).map(r => <tr class={r.ok ? '' : 'bad'}><td class="mono">{r.t.slice(11, 19)}</td><td><span class="aitag">ai</span> {r.source}</td><td class="mono" title={r.args}>{r.cmd}</td><td>{r.ok ? (r.note || 'ok') : r.note}</td></tr>)}</tbody></table>;
}

// ---------- Settings › AI & Connections ----------
const Row = ({ on, set, label, note, locked }: { on: boolean; set?: (v: boolean) => void; label: string; note?: string; locked?: boolean }) =>
  <label class="aiset-row"><span><b>{t(label)}</b>{note && <small>{t(note)}</small>}</span><span class="aiset-ctl">{locked && <Icon name="lock" size={12} />}<input type="checkbox" checked={on} disabled={locked} onChange={(e: any) => set?.(e.target.checked)} /></span></label>;
export function AiSettingsTab({ draft: d, set }: { draft: AiSettings; set: (s: AiSettings) => void }) {
  const u = (k: keyof AiSettings) => (v: any) => set({ ...d, [k]: v }); const desk = isDesktop();
  return <div class="aiset">
    <p class="muted">{t('Everything here is off by default. HYDRA works fully without it.')}</p>
    <div class="aiset-master"><Row on={d.enabled} set={u('enabled')} label="AI features" note="Off = no AI calls, no AI programs, MCP closed." /></div>
    {d.enabled && <>
      <h4>{t('Appearance')}</h4>
      <Row on={d.showLauncher} set={u('showLauncher')} label="Show AI launcher" note="Title bar icon · shortcut ` (backtick)" />
      <Row on={d.ghost} set={u('ghost')} label="Show AI ghost previews on the canvas" />
      <h4>{t('Connections')}</h4>
      <div class="aiset-row"><span><b>{t('Claude Code, Codex, API key, Claude Desktop')}</b><small>{t('Save these settings first, then open:')}</small></span><Btn icon="plug" label={t('Manage connections…')} onClick={() => { saveAiSettings(d); S.openModal('aiconnect'); }} /></div>
      {desk ? <>
        <label class="fld"><span class="lbl">{t('Default AI')}</span><select class="in" value={d.provider} onChange={(e: any) => set({ ...d, provider: e.target.value })}><option value="none">{t('None')}</option>{providerList().map(p => <option value={p.id}>{p.label}</option>)}</select></label>
        <Row on={d.cli} set={u('cli')} label="CLI bridge (experimental)" note="Runs your own Claude Code or Codex CLI. Check your AI provider's terms." />
        <Row on={d.mcp} set={u('mcp')} label="MCP server for Claude Desktop" note="Listens on 127.0.0.1 only (this PC)." />
        {d.mcp && <div class="aiset-radios"><span class="lbl">{t('What the AI app may do')}</span>
          {([['read', 'Read only'], ['approve', 'Edit — waits for Apply'], ['free', 'Edit freely — one undo step per change']] as const).map(([k, l]) => <label><input type="radio" name="mcpperm" checked={d.mcpPerm === k} onChange={() => set({ ...d, mcpPerm: k })} />{t(l)}</label>)}</div>}
      </> : <p class="muted small">{t('Connecting Claude Code, Codex or Claude Desktop needs the desktop app, HYDRA.exe. This copy runs in the browser.')}</p>}
      <h4>{t('Privacy & safety')}</h4>
      <Row on={d.askApply} set={u('askApply')} label="Ask before every Apply" />
      <Row on={d.verify} set={u('verify')} label="Verify with the solver before Apply" />
      <Row on={d.sendSim} set={u('sendSim')} label="Send simulation results to the AI" note="Off: the AI only learns pass / fail; you see the full result in HYDRA." />
      <Row on={LOCKED.neverPrivate} locked label="Never send Private projects" />
      <Row on={LOCKED.frozenEdit} locked label="Allow AI to edit frozen modules" />
      <div class="aiset-row"><span><b>{t('AI activity log')}</b></span><Btn icon="scroll-text" label={t('Open log')} onClick={() => S.openModal('ailog')} /></div>
    </>}
    <p class="aiset-foot"><Icon name="shield-check" size={13} />{t('Projects marked Private are never sent to any AI. Only circuit data is sent.')}</p>
  </div>;
}
