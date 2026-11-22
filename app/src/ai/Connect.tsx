// "Connect an AI" — A: AI inside HYDRA (Claude Code / Codex CLI, own API key) · B: HYDRA inside your AI app (MCP).
// Sign-in always happens in the official CLI or app; HYDRA never sees passwords or tokens. API keys go to the Windows
// Credential Manager and are never shown again.
import { h, Fragment } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import * as S from '../store';
import { t } from '../i18n';
import { Icon, Btn, Badge } from '../ui/common';
import { Modal } from '../ui/dialogs';
import { aiSettings, saveAiSettings, isDesktop, type AiSettings } from './settings';
import { providerList } from './session';
import { mcpState, claudeConfig, detectCli, keySet, keyHas, keyDelete } from './mcp';
import { refreshCli, refreshKeys } from './providers';

const close = () => S.closeModal();
const copy = (x: string) => { navigator.clipboard?.writeText(x); S.toast(t('Copied'), 'ok'); };
/** a command the user pastes into PowerShell, with a Copy button */
const Cmd = ({ c }: { c: string }) => <span class="aicmd"><code>{c}</code><button class="link" onClick={() => copy(c)}>{t('Copy')}</button></span>;
/** plain-language setup for people who have never used a command line; open by default until the tool is found */
export function CliSteps({ tool, found }: { tool: 'claude' | 'codex'; found: boolean }) {
  const ps = <li>{t('Open PowerShell: press the Windows key, type PowerShell and press Enter.')}</li>;
  return <details class="aisteps" open={!found}><summary>{found ? t('First time? How to sign in') : t('How to set up (about 5 minutes)')}</summary>
    {tool === 'claude' ? <>
      {!found && <><b>{t('1. Install Claude Code')}</b><ol>{ps}
        <li>{t('Paste this line and press Enter:')} <Cmd c="irm https://claude.ai/install.ps1 | iex" /></li>
        <li>{t('Wait until it says the installation is complete, then close PowerShell.')}</li>
        <li>{t('Close HYDRA and start it again, then press Scan again.')}</li></ol></>}
      <b>{found ? t('Sign in once') : t('2. Sign in once')}</b><ol>{ps}
        <li>{t('Type this and press Enter:')} <Cmd c="claude" /></li>
        <li>{t('Press Enter to accept the colour style.')}</li>
        <li>{t('Choose "Claude account with subscription". Your browser opens: sign in and press Authorize. If the browser shows a code, paste it into PowerShell and press Enter.')}</li>
        <li>{t('When you see the > prompt, type /exit and press Enter. Done — you never need to do this again.')}</li></ol>
      <b>{found ? t('Then') : t('3. Use it')}</b><ol><li>{t('Press Use Claude below, then chat in HYDRA’s AI panel.')}</li></ol>
      <p class="muted small">{t('Needs a paid Claude plan (Pro or Max) or Claude Console credit. "Not logged in" in the AI panel means the sign-in above is not done yet.')}</p>
    </> : <>
      {!found && <><b>{t('1. Install Codex')}</b><ol>
        <li>{t('Install Node.js (LTS) from nodejs.org, using the default options.')}</li>{ps}
        <li>{t('Paste this line and press Enter:')} <Cmd c="npm install -g @openai/codex" /></li>
        <li>{t('Close HYDRA and start it again, then press Scan again.')}</li></ol></>}
      <b>{found ? t('Sign in once') : t('2. Sign in once')}</b><ol>{ps}
        <li>{t('Type this and press Enter:')} <Cmd c="codex login" /></li>
        <li>{t('Your browser opens: sign in with your ChatGPT account and allow access. Then close PowerShell.')}</li></ol>
      <b>{found ? t('Then') : t('3. Use it')}</b><ol><li>{t('Press Use ChatGPT below, then chat in HYDRA’s AI panel.')}</li></ol>
    </>}
  </details>;
}
export function ConnectDlg() {
  const s = aiSettings.value; const desk = isDesktop();
  const set = (p: Partial<AiSettings>) => saveAiSettings({ ...aiSettings.peek(), ...p });
  const [cli, setCli] = useState<{ claude: string | null; codex: string | null; codexSignedIn?: boolean | null } | null>(null);
  const [cfg, setCfg] = useState<any>(null); const [keyProv, setKeyProv] = useState('anthropic'); const [key, setKey] = useState(''); const [has, setHas] = useState<Record<string, boolean>>({});
  const scan = () => detectCli().then((r: any) => { setCli(r); refreshCli(); }).catch(() => setCli({ claude: null, codex: null }));
  const loadKeys = () => Promise.all(['anthropic', 'openai'].map(p => keyHas(p).then((x: boolean) => [p, !!x]).catch(() => [p, false]))).then(r => setHas(Object.fromEntries(r)));
  useEffect(() => { if (!desk) return; scan(); loadKeys(); claudeConfig(false).then(setCfg).catch((e: any) => setCfg({ error: String(e) })); }, []);
  const snippet = cfg?.snippet ? JSON.stringify(cfg.snippet, null, 2) : '"hydra": { "command": "HYDRA.exe", "args": ["--mcp"] }';
  const addClaude = () => claudeConfig(true).then((r: any) => { setCfg(r); if (aiSettings.peek().enabled && !aiSettings.peek().mcp) set({ mcp: true }); S.toast(t('Added to Claude Desktop — restart Claude Desktop to load HYDRA'), 'ok'); }).catch((e: any) => S.toast(String(e), 'err'));
  const saveKey = () => keySet(keyProv, key).then(() => { setKey(''); loadKeys(); refreshKeys(); S.toast(t('API key saved in Windows Credential Manager'), 'ok'); }).catch((e: any) => S.toast(String(e), 'err'));
  const use = (id: any) => set({ provider: id, ...(id.endsWith('-cli') ? { cli: true } : {}) });
  const prov = (id: string) => providerList().find(p => p.id === id);
  const found = (x: string | null | undefined) => x ? <Badge kind="ok">{t('Found')}</Badge> : <Badge kind="warn">{t('Not installed')}</Badge>;
  return <Modal title={t('Connect an AI')} icon="plug" wide="xl" onClose={close} footer={<><span class="aiset-foot"><Icon name="shield-check" size={13} />{t('Projects marked Private are never sent to any AI. Only circuit data is sent.')}</span><div class="grow" /><button class="primary" onClick={close}>{t('Close')}</button></>}>
    <p class="muted">{t('Optional. HYDRA works fully without any of this.')}</p>
    {!s.enabled && <p class="aiwarn">{t('AI features are off.')} <button class="link" onClick={() => set({ enabled: true })}>{t('Turn them on')}</button></p>}
    {!desk ? <p class="muted">{t('Connecting Claude Code, Codex or Claude Desktop needs the desktop app, HYDRA.exe. This copy runs in the browser.')}</p> :
    <div class="aicon">
      <section><h4>{t('A · AI inside HYDRA')}</h4><p class="muted small">{t('Chat in HYDRA’s AI panel.')}</p>
        <div class="aicard"><div class="aicon-h"><b>Claude</b><span class="muted">{t('via Claude Code CLI')}</span><Badge kind="info">{t('Experimental')}</Badge><div class="grow" />{cli && found(cli.claude)}</div>
          <p class="muted small">{t('Sign-in happens in Claude Code. HYDRA never sees your password or token. Check that your Claude plan allows use through other apps.')}</p>
          {cli && <CliSteps tool="claude" found={!!cli.claude} />}
          <div class="aibtns">{prov('claude-cli') && cli?.claude && <Btn kind={s.provider === 'claude-cli' ? 'primary' : undefined} label={s.provider === 'claude-cli' ? t('In use') : t('Use Claude')} onClick={() => use('claude-cli')} />}<Btn label={t('Scan again')} onClick={scan} /></div></div>
        <div class="aicard"><div class="aicon-h"><b>ChatGPT</b><span class="muted">{t('via Codex CLI')}</span><Badge kind="info">{t('Experimental')}</Badge><div class="grow" />{cli && found(cli.codex)}</div>
          {cli?.codex && cli.codexSignedIn === false && <p class="aiwarn small">{t('Codex is not signed in — follow “Sign in once” below.')}</p>}
          {cli && <CliSteps tool="codex" found={!!cli.codex} />}
          <div class="aibtns">{prov('codex-cli') && cli?.codex && <Btn kind={s.provider === 'codex-cli' ? 'primary' : undefined} label={s.provider === 'codex-cli' ? t('In use') : t('Use ChatGPT')} onClick={() => use('codex-cli')} />}<Btn label={t('Scan again')} onClick={scan} /></div></div>
        <div class="aicard"><div class="aicon-h"><b>{t('Own API key')}</b><div class="grow" />{(has.anthropic || has.openai) && <Badge kind="ok">{[has.anthropic && 'Anthropic', has.openai && 'OpenAI'].filter(Boolean).join(' · ')} {t('saved')}</Badge>}</div>
          <div class="airow"><select class="in sm" value={keyProv} onChange={(e: any) => setKeyProv(e.target.value)}><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select>
            <input class="in sm" type="password" autocomplete="off" placeholder={has[keyProv] ? '••••••••  ' + t('saved') : 'sk-…'} value={key} onInput={(e: any) => setKey(e.target.value)} />
            <Btn label={t('Save')} disabled={!key.trim()} onClick={saveKey} />{has[keyProv] && <Btn label={t('Remove')} onClick={() => keyDelete(keyProv).then(() => { loadKeys(); refreshKeys(); })} />}</div>
          <div class="airow"><label class="fld"><span class="lbl">{t('Model')}</span><input class="in sm" placeholder={keyProv === 'anthropic' ? 'claude-opus-5-5' : 'gpt-5'} value={s.apiVendor === keyProv ? s.apiModel : ''} onChange={(e: any) => set({ apiVendor: keyProv as any, apiModel: e.target.value.trim() })} /></label>
            {has[keyProv] && <Btn kind={s.provider === 'api-key' && s.apiVendor === keyProv ? 'primary' : undefined} label={s.provider === 'api-key' && s.apiVendor === keyProv ? t('In use') : t('Use this key')} onClick={() => set({ provider: 'api-key', apiVendor: keyProv as any })} />}</div>
          <p class="muted small">{t('Saved in the Windows Credential Manager, never in a file. HYDRA does not show it again.')}</p></div>
      </section>
      <section><h4>{t('B · HYDRA inside your AI app (MCP)')}</h4><p class="muted small">{t('Chat in Claude Desktop; it uses HYDRA’s tools.')}</p>
        <div class="aicard"><label class="aiset-row"><span><b>{t('MCP server')}</b><small>{t('Listens only on 127.0.0.1 (this PC).')}</small></span><span class="aiset-ctl">{s.mcp && s.enabled && (mcpState.value.listening ? <Badge kind="ok">{t('On')}</Badge> : <Badge kind="warn">{mcpState.value.error || t('Starting…')}</Badge>)}<input type="checkbox" checked={s.mcp} disabled={!s.enabled} onChange={(e: any) => set({ mcp: e.target.checked })} /></span></label>
          <pre class="aicmds">{snippet}</pre>
          <div class="aibtns"><Btn kind="primary" icon="plug" label={t('Add to Claude Desktop')} disabled={!cfg || !!cfg.error} onClick={addClaude} /><Btn icon="copy" label={t('Copy config')} onClick={() => { navigator.clipboard?.writeText(snippet); S.toast(t('Copied'), 'ok'); }} /></div>
          {cfg?.targets?.some((x: any) => x.hydra) && <p class="muted small"><Icon name="check" size={12} /> {t('Claude Desktop already lists HYDRA. Restart Claude Desktop after changes.')}</p>}
          {cfg?.written?.length > 0 && cfg.written[0].backup && <p class="muted small">{t('Previous config kept as')} <code>{String(cfg.written[0].backup).split(/[\\/]/).pop()}</code></p>}
          {cfg && !cfg.error && !cfg.installed && <p class="muted small">{t('Claude Desktop was not found on this PC; the config is created for it.')}</p>}</div>
        <div class="aicard"><b class="aict">{t('What the AI app may do')}</b><div class="aiset-radios">
          {([['read', 'Read only'], ['approve', 'Edit — waits for Apply in HYDRA'], ['free', 'Edit freely — one undo step per change']] as const).map(([k, l]) => <label><input type="radio" name="mcpperm2" checked={s.mcpPerm === k} onChange={() => set({ mcpPerm: k })} />{t(l)}</label>)}</div></div>
        <p class="muted small">{t('The ChatGPT app cannot connect to HYDRA: it needs a public web address, and HYDRA stays offline.')}</p>
      </section>
    </div>}
  </Modal>;
}
