import { h, Fragment, type ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as S from '../store';
import { COMMANDS, cmd, keysOf, bindKeys, isEnabled } from '../commands';
import { Icon, Btn, NumField, TextField, Seg, Thumb, Badge } from './common';
import { Palette } from './shell';
import { partSvg, libSvg } from './panels';
import * as Pj from '../project';
import { STD, SAMPLES } from '../symbols';
import { UNITS, convert, unitFor, SYSTEMS, toBase, fromBase } from '../units';
import { prettyKeys, round, pickFile, fmtDate, clone, download } from '../util';
import { t, languages, setLanguage } from '../i18n';
import { importLibraryFiles, exportLibrary, libById, stdById, resolveStar } from '../actions';
import { chooseFolder } from '../project';
import { kvSet } from '../db';
import * as LXm from '../launcher';
import * as TH from '../theme';
import { AiSettingsTab, AiLogView } from '../ai/Panel';
import { ConnectDlg } from '../ai/Connect';
import { aiSettings, saveAiSettings } from '../ai/settings';

export function Modal({ title, onClose, children, footer, wide, icon }: { title: string; onClose: () => void; children: ComponentChildren; footer?: ComponentChildren; wide?: boolean | 'xl'; icon?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement; const el = ref.current!;
    setTimeout(() => (el.querySelector<HTMLElement>('[autofocus], input:not([readonly]), select, textarea, .mbody button, footer button.primary') || el).focus(), 20);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') { const f = [...el.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,textarea,[tabindex="0"]')]; if (!f.length) return; const i = f.indexOf(document.activeElement as any); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
    };
    el.addEventListener('keydown', key); return () => { el.removeEventListener('keydown', key); prev?.focus?.(); };
  }, []);
  return <div class="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div class={'modal ' + (wide === 'xl' ? 'xl' : wide ? 'wide' : '')} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
      <header>{icon && <Icon name={icon} size={15} />}<span>{title}</span><button class="winbtn" aria-label={t('Close')} onClick={onClose}>✕</button></header>
      <div class="mbody">{children}</div>{footer && <footer>{footer}</footer>}
    </div></div>;
}
const close = () => S.closeModal();
const Tabs = ({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (v: string) => void }) => <div class="mtabs" role="tablist">{tabs.map(([v, l]) => <button role="tab" aria-selected={value === v} class={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;

export function ModalHost() {
  const m = S.modal.value; if (!m) return null; const P = m.props || {};
  switch (m.name) {
    case 'confirm': return <Modal title={P.title} onClose={() => { close(); P.resolve('cancel'); }} footer={P.buttons.map((b: any) => <button class={b.primary ? 'primary' : b.danger ? 'btn danger' : 'btn'} onClick={() => { close(); P.resolve(b.value); }}>{b.label}</button>)}><p>{P.body}</p></Modal>;
    case 'prompt': return <PromptDlg {...P} />;
    case 'palette': return <Palette />;
    case 'rename': return <RenameDlg />;
    case 'newProject': return <NewProjectDlg />;
    case 'projectProps': return <ProjectPropsDlg />;
    case 'nodeProps': return <RenameDlg props />;
    case 'prefs': return <PrefsDlg tab={P.tab || 'general'} />;
    case 'settings': return <SettingsDlg tab={P.tab || 'appearance'} />;
    case 'calc': return <CalcDlg />;
    case 'units': return <UnitsDlg />;
    case 'libManager': return <LibManagerDlg />;
    case 'import': return <ImportDlg />;
    case 'docs': return <DocsDlg />;
    case 'symbolRef': return <SymbolRefDlg />;
    case 'keys': return <KeysDlg />;
    case 'about': return <AboutDlg />;
    case 'aiconnect': return <ConnectDlg />;
    case 'ailog': return <Modal title={t('AI activity log')} icon="scroll-text" wide onClose={close} footer={<button class="primary" onClick={close}>{t('Close')}</button>}><AiLogView /></Modal>;
    case 'issue': return <IssueDlg />;
    case 'relink': return <RelinkDlg star={P.star} />;
    case 'compare': return <CompareDlg cp={P.cp} />;
    case 'projFolder': return <ProjFolderDlg />;
  }
  return null;
}
// HYDRA.bat: Open from the project folder (Documents\HYDRA) — projects, autosave copies, backups, samples folder
function ProjFolderDlg() {
  const [area, setArea] = useState<LXm.Area>('projects'); const [files, setFiles] = useState<LXm.SrvFile[] | null>(null); const [err, setErr] = useState(''); const [sel, setSel] = useState('');
  useEffect(() => { setFiles(null); setErr(''); setSel(''); LXm.listFiles(area).then(setFiles).catch(e => { setErr(String(e?.message || e)); setFiles([]); }); }, [area]);
  const info = LXm.LX.value; const dir = info ? (info as any)[area] : '';
  const open = (n: string) => { close(); Pj.openServerFile(area, n); };
  const kb = (n: number) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  return <Modal title={t('Open from project folder')} icon="folder-open" wide onClose={close} footer={<>
    <button class="btn" onClick={() => LXm.reveal(area)}>{t('Show in Explorer')}</button>
    <button class="btn" onClick={() => { close(); Pj.openFromDisk(); }}>{t('Other file…')}</button><span style={{ flex: 1 }} />
    <button class="btn" onClick={close}>{t('Cancel')}</button><button class="primary" disabled={!sel} onClick={() => open(sel)}>{t('Open')}</button></>}>
    <Tabs tabs={[['projects', t('Projects')], ['autosave', t('Autosave')], ['backups', t('Backups')], ['samples', t('Samples folder')]]} value={area} onChange={v => setArea(v as LXm.Area)} />
    <p class="muted mono" style={{ margin: '6px 0' }}>{dir}</p>
    {area === 'backups' && <p class="muted">{t('The previous version of a project is kept here each time it is saved (newest')} {info?.keep || 10} {t('per project). Opening one opens a copy.')}</p>}
    {area === 'autosave' && <p class="muted">{t('Unsaved changes are written here every autosave interval and removed when you save. Opening one opens a copy.')}</p>}
    {err ? <p class="errmsg">{err}</p> : !files ? <p class="muted">{t('Loading…')}</p> : !files.length ? <p class="muted">{t('No files here yet.')}</p> :
      <table class="dtable pfolder"><thead><tr><th>{t('Name')}</th><th>{t('Modified')}</th><th>{t('Size')}</th></tr></thead><tbody>
        {files.map(f => <tr class={sel === f.name ? 'sel' : ''} tabIndex={0} onClick={() => setSel(f.name)} onDblClick={() => open(f.name)} onKeyDown={(e: any) => e.key === 'Enter' && open(f.name)}><td><b>{f.name}</b></td><td>{fmtDate(f.mtime)}</td><td class="mono">{kb(f.size)}</td></tr>)}
      </tbody></table>}
  </Modal>;
}
function PromptDlg({ title, label, value, resolve }: any) {
  const [v, setV] = useState(value || ''); const done = (r: string | null) => { close(); resolve(r); };
  return <Modal title={title} onClose={() => done(null)} footer={<><button class="btn" onClick={() => done(null)}>{t('Cancel')}</button><button class="primary" onClick={() => done(v)}>{t('OK')}</button></>}>
    <label class="fld"><span class="lbl">{label}</span><input class="in" autofocus value={v} onInput={(e: any) => setV(e.target.value)} onKeyDown={(e: any) => e.key === 'Enter' && done(v)} /></label></Modal>;
}
function RenameDlg({ props }: { props?: boolean }) {
  const s = S.selection.value; const p = S.project.value; const id = s?.ids[0] || '';
  const isNode = s?.kind === 'node'; const cur = isNode ? p?.nodes[id]?.name : libById(id)?.name;
  const [v, setV] = useState(cur || ''); const [d, setD] = useState(isNode ? p?.nodes[id]?.description || '' : '');
  const ok = () => { if (!v.trim()) return; if (isNode) { S.renameNode(id, v); if (props) S.setNodeProps([id], { description: d }); } else S.libUpdate(id, { name: v.trim() }); close(); };
  return <Modal title={props ? t('Properties') : t('Rename')} onClose={close} footer={<><button class="btn" onClick={close}>{t('Cancel')}</button><button class="primary" disabled={!v.trim()} onClick={ok}>{t('Apply')}</button></>}>
    <label class="fld"><span class="lbl">{t('Name')}</span><input class={'in ' + (v.trim() ? '' : 'bad')} autofocus value={v} maxLength={80} onInput={(e: any) => setV(e.target.value)} onKeyDown={(e: any) => e.key === 'Enter' && ok()} />{!v.trim() && <span class="errmsg">{t('Required')}</span>}</label>
    {props && isNode && <label class="fld"><span class="lbl">{t('Description')}</span><input class="in" value={d} onInput={(e: any) => setD(e.target.value)} /></label>}</Modal>;
}
function NewProjectDlg() {
  const [o, setO] = useState({ name: 'New machine', template: 'hydraulic', unitSystem: S.prefs.value.unitSystem, description: '', author: '' });
  const ok = () => { if (!o.name.trim()) return; close(); Pj.createProject({ ...o, name: o.name.trim(), location: S.settings.value.folderName || '' }); };
  return <Modal title={t('New Project')} icon="file-plus" onClose={close} footer={<><button class="btn" onClick={close}>{t('Cancel')}</button><button class="primary" disabled={!o.name.trim()} onClick={ok}>{t('Create')}</button></>}>
    <label class="fld"><span class="lbl">{t('Project name')} *</span><input class={'in ' + (o.name.trim() ? '' : 'bad')} autofocus value={o.name} maxLength={80} onInput={(e: any) => setO({ ...o, name: e.target.value })} onKeyDown={(e: any) => e.key === 'Enter' && ok()} /></label>
    <label class="fld"><span class="lbl">{t('Template')}</span><div class="tpls">{Object.entries(Pj.TEMPLATES).map(([k, v]) => <button class={'tpl ' + (o.template === k ? 'on' : '')} aria-pressed={o.template === k} onClick={() => setO({ ...o, template: k })}><b>{t(v.label)}</b><small>{v.sheets.length ? v.sheets.map(s => s.name).join(' · ') : t('Empty machine')}{v.program ? ' · ' + t('Main program') : ''}</small></button>)}</div></label>
    <div class="fgrid"><label class="fld"><span class="lbl">{t('Unit system')}</span><select class="in" value={o.unitSystem} onChange={(e: any) => setO({ ...o, unitSystem: e.target.value })}><option value="SI">SI (MPa, L/min)</option><option value="SI-bar">SI-bar (bar, L/min)</option><option value="Imperial">Imperial (psi, gpm)</option></select></label>
      <label class="fld"><span class="lbl">{t('Author')}</span><input class="in" value={o.author} onInput={(e: any) => setO({ ...o, author: e.target.value })} /></label></div>
    <label class="fld"><span class="lbl">{t('Description')}</span><input class="in" value={o.description} onInput={(e: any) => setO({ ...o, description: e.target.value })} /></label>
    <label class="fld"><span class="lbl">{t('Location')}</span><input class="in" readOnly value={Pj.fsAccess() ? (S.settings.value.folderName ? t('Save dialog opens in') + ' ' + S.settings.value.folderName : t('Chosen in the Save dialog when you first save')) : t('Saved to your Downloads folder (this browser has no direct file access)')} /></label>
  </Modal>;
}
function ProjectPropsDlg() {
  const p = S.project.value; if (!p) { close(); return null; } const m = p.manifest;
  const [o, setO] = useState({ name: m.name, description: m.description || '', author: m.author || '', company: m.company || '', unitSystem: m.unitSystem, private: !!(m as any).private });
  const ok = () => { if (!o.name.trim()) return; S.mutate('Project properties', d => { Object.assign(d.manifest, { ...o, name: o.name.trim() }); d.nodes[d.rootId].name = o.name.trim(); }); close(); };
  const n = (k: string) => Object.values(p.nodes).filter(x => x.type === k).length;
  return <Modal title={t('Project Properties')} icon="info" onClose={close} footer={<><button class="btn" onClick={close}>{t('Cancel')}</button><button class="primary" onClick={ok}>{t('Apply')}</button></>}>
    <div class="fgrid"><label class="fld"><span class="lbl">{t('Name')} *</span><input class="in" value={o.name} onInput={(e: any) => setO({ ...o, name: e.target.value })} /></label>
      <label class="fld"><span class="lbl">{t('Unit system')}</span><select class="in" value={o.unitSystem} onChange={(e: any) => setO({ ...o, unitSystem: e.target.value })}><option>SI</option><option>SI-bar</option><option>Imperial</option></select></label>
      <label class="fld"><span class="lbl">{t('Author')}</span><input class="in" value={o.author} onInput={(e: any) => setO({ ...o, author: e.target.value })} /></label>
      <label class="fld"><span class="lbl">{t('Company')}</span><input class="in" value={o.company} onInput={(e: any) => setO({ ...o, company: e.target.value })} /></label></div>
    <label class="fld"><span class="lbl">{t('Description')}</span><input class="in" value={o.description} onInput={(e: any) => setO({ ...o, description: e.target.value })} /></label>
    <label class="checkrow"><input type="checkbox" checked={o.private} onChange={(e: any) => setO({ ...o, private: e.target.checked })} /><span><b>{t('Private')}</b> — {t('never sent to any AI, never in AI logs')}</span></label>
    <div class="kvgrid"><span>{t('Project ID')}</span><b>{m.projectId}</b><span>{t('Created')}</span><b>{fmtDate(m.created)}</b><span>{t('Last saved')}</span><b>{m.version ? `v${m.version} · ${fmtDate(m.modified)}` : t('not saved yet')}</b><span>{t('File')}</span><b>{S.fileHandle.value?.name || m.location || '—'}</b><span>{t('Format')}</span><b>hydra.project v{m.formatVersion} · app {m.appVersion}</b><span>{t('Contents')}</span><b>{n('assembly')} {t('assemblies')} · {n('sheet')} {t('sheets')} · {n('program')} {t('programs')} · {p.library.length} {t('project-local parts')}</b></div>
  </Modal>;
}

// ---------- Preferences › Simulation: flow arrows and tooltips ----------
function SimPrefsTab({ p, setP }: { p: S.Prefs; setP: (x: S.Prefs) => void }) {
  const m = p.sim || S.defaultSimPrefs; const set = (k: keyof S.SimPrefs, v: any) => setP({ ...p, sim: { ...m, [k]: v } });
  const R = (k: keyof S.SimPrefs, label: string, min: number, max: number, step: number, unit: string) => <label class="fld"><span class="lbl">{label}</span><div class="rangerow"><input type="range" min={min} max={max} step={step} value={m[k] as number} onInput={(e: any) => set(k, +e.target.value)} /><b class="mono">{m[k] as number}{unit}</b></div></label>;
  const sc = m.size / 100, L = m.len * sc * 6, W = m.width * sc * 6; const col = m.color === 'pressure' ? '#C0392B' : m.color === 'accent' ? '#0A64C2' : m.color === 'white' ? '#fff' : '#1B2633';
  const gap = 100 / Math.max(1, m.count) * 1.6;
  return <div class="fgrid">
    <label class="checkrow span2"><input type="checkbox" checked={!!p.graphAuto} onChange={(e: any) => setP({ ...p, graphAuto: e.target.checked })} />{t('Open the graph (Simulation tab) when a simulation starts')}</label>
    <label class="checkrow span2"><input type="checkbox" checked={!!p.graphPop} onChange={(e: any) => setP({ ...p, graphPop: e.target.checked })} />{t('…in its own window (for a second screen)')}</label>
    <label class="checkrow span2"><input type="checkbox" checked={p.overview !== false} onChange={(e: any) => setP({ ...p, overview: e.target.checked })} />{t('Show the overview (mini-map) on the sheet')}</label>
    <label class="checkrow span2"><input type="checkbox" checked={m.anim} onChange={(e: any) => set('anim', e.target.checked)} />{t('Animate flow: arrows move along each line in the direction of flow (faster with more flow)')}</label>
    {R('len', t('Arrow length (height along the line)'), 1, 8, 0.5, ' mm')}{R('width', t('Arrow width (across the line)'), 1, 6, 0.2, ' mm')}
    {R('size', t('Arrow size (overall scale)'), 50, 250, 10, ' %')}{R('count', t('Number of arrows per 100 mm of line'), 1, 12, 1, '')}
    {R('speed', t('Animation speed'), 10, 300, 10, ' %')}
    <label class="fld"><span class="lbl">{t('Arrow colour')}</span><Seg value={m.color} options={[['ink', t('Dark')], ['pressure', t('Pressure colour')], ['accent', t('Blue')], ['white', t('White')]]} onChange={v => set('color', v)} /></label>
    <div class="fld span2"><span class="lbl">{t('Preview')}</span><svg class="arrowprev" viewBox="0 0 320 40" height="40"><line x1="0" y1="20" x2="320" y2="20" stroke="#C0392B" stroke-width="3" />{[0, 1, 2, 3, 4, 5, 6, 7].map(i => { const x = 20 + i * gap; return x < 310 ? <path d={`M${x + L / 2},20 L${x - L / 2},${20 - W / 2} L${x - L / 4},20 L${x - L / 2},${20 + W / 2}Z`} fill={col} stroke={m.color === 'white' ? '#1B2633' : 'none'} stroke-width=".6" /> : null; })}</svg></div>
    <label class="checkrow span2"><input type="checkbox" checked={m.tooltip} onChange={(e: any) => set('tooltip', e.target.checked)} />{t('Show pressure, flow and velocity when pointing at a line')}</label>
    <label class="checkrow span2"><input type="checkbox" checked={m.alerts} onChange={(e: any) => set('alerts', e.target.checked)} />{t('Highlight parts and lines over their limits (orange)')}</label>
  </div>;
}

// ---------- Preferences ----------
function PrefsDlg({ tab: t0 }: { tab: string }) {
  const [tab, setTab] = useState(t0); const [p, setP] = useState(clone(S.prefs.value)); const [ai, setAi] = useState({ ...aiSettings.value }); const [cap, setCap] = useState<string | null>(null); const [q, setQ] = useState('');
  const save = () => { S.savePrefs(p); saveAiSettings(ai); bindKeys(); setLanguage(p.language); Pj.startAutosave(); close(); S.toast(t('Preferences saved'), 'ok'); };
  const conflicts = useMemo(() => { const m: Record<string, string[]> = {}; COMMANDS.forEach(c => { (p.shortcuts[c.id] ?? c.keys ?? '').split(',').filter(Boolean).forEach(k => (m[k] ||= []).push(c.id)); }); return m; }, [p.shortcuts]);
  useEffect(() => { if (!cap) return; const h_ = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); if (e.key === 'Escape') { setCap(null); return; } if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return; const k = [e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase().replace('delete', 'del')].filter(Boolean).join('+'); setP(pp => ({ ...pp, shortcuts: { ...pp.shortcuts, [cap]: k } })); setCap(null); }; window.addEventListener('keydown', h_, true); return () => window.removeEventListener('keydown', h_, true); }, [cap]);
  const ct = p.customTab;
  return <Modal title={t('Preferences')} icon="sliders-horizontal" wide onClose={close} footer={<><button class="btn" onClick={close}>{t('Cancel')}</button><button class="primary" onClick={save}>{t('Save preferences')}</button></>}>
    <Tabs value={tab} onChange={setTab} tabs={[['general', t('General')], ['sim', t('Simulation')], ['shortcuts', t('Keyboard shortcuts')], ['custom', t('Custom Tab')], ['language', t('Language')], ['ai', t('AI & Connections')]]} />
    {tab === 'ai' && <AiSettingsTab draft={ai} set={setAi} />}
    {tab === 'sim' && <SimPrefsTab p={p} setP={setP} />}
    {tab === 'general' && <div class="fgrid">
      <label class="fld"><span class="lbl">{t('Unit system')}</span><select class="in" value={p.unitSystem} onChange={(e: any) => setP({ ...p, unitSystem: e.target.value })}><option value="SI">SI (MPa, L/min, kN, mm)</option><option value="SI-bar">SI-bar (bar, L/min, kN, mm)</option><option value="Imperial">Imperial (psi, gpm, lbf, in)</option></select></label>
      <label class="fld"><span class="lbl">{t('Auto-save recovery copy every')}</span><select class="in" value={p.autosaveSec} onChange={(e: any) => setP({ ...p, autosaveSec: +e.target.value })}>{[30, 60, 120, 300, 600].map(s => <option value={s}>{s < 60 ? s + ' s' : s / 60 + ' min'}</option>)}</select></label>
      <label class="fld"><span class="lbl">{t('Default sheet size')}</span><select class="in" value={p.sheetSize} onChange={(e: any) => setP({ ...p, sheetSize: e.target.value })}>{['A4', 'A3', 'A2', 'A1', 'A0'].map(x => <option>{x}</option>)}</select></label>
      <label class="fld"><span class="lbl">{t('Default line weight')}</span><select class="in" value={p.lineWeight} onChange={(e: any) => setP({ ...p, lineWeight: +e.target.value })}>{[0.18, 0.35, 0.5, 0.7].map(x => <option value={x}>{x.toFixed(2)} mm</option>)}</select></label>
      <fieldset class="fld span2"><legend class="lbl">{t('Default snapping (designers)')}</legend><div class="checkrow">{(['grid', 'endpoint', 'ortho'] as const).map(k => <label><input type="checkbox" checked={p.snap[k]} onChange={(e: any) => setP({ ...p, snap: { ...p.snap, [k]: e.target.checked } })} />{t(k === 'grid' ? 'Grid' : k === 'endpoint' ? 'Endpoint' : 'Orthogonal')}</label>)}</div></fieldset>
      <label class="checkrow span2"><input type="checkbox" checked={p.confirmDelete} onChange={(e: any) => setP({ ...p, confirmDelete: e.target.checked })} />{t('Ask before deleting sheets and programs')}</label>
      <label class="fld span2"><span class="lbl">{t('Open Valve Creator and Symbol Sketcher')}</span><Seg value={p.toolMode} options={[['popout', t('In a pop-out window')], ['overlay', t('Inside HYDRA')]]} onChange={v => setP({ ...p, toolMode: v as any })} /></label>
    </div>}
    {tab === 'shortcuts' && <div>
      <div class="ptools"><div class="searchin"><Icon name="search" size={14} /><input value={q} placeholder={t('Filter commands')} onInput={(e: any) => setQ(e.target.value)} /></div><Btn label={t('Reset all')} onClick={() => setP({ ...p, shortcuts: {} })} /></div>
      <p class="muted">{t('Click a shortcut, then press the new key combination (Esc cancels). Ctrl+N, Ctrl+T and Ctrl+W are reserved by the browser; Alt+N also opens New Project.')}</p>
      <div class="sctable">{COMMANDS.filter(c => !q || c.label.toLowerCase().includes(q.toLowerCase())).map(c => { const k = p.shortcuts[c.id] ?? c.keys ?? ''; const clash = k.split(',').filter(Boolean).some(x => conflicts[x]?.length > 1);
        return <div class="scrow"><span><Icon name={c.icon || 'command'} size={13} />{t(c.label)}<small>{t(c.group)}</small></span><button class={'kbtn ' + (cap === c.id ? 'cap' : '') + (clash ? ' clash' : '')} title={clash ? t('Shortcut used by another command') : ''} onClick={() => setCap(c.id)}>{cap === c.id ? t('Press keys…') : prettyKeys(k) || '—'}</button>{p.shortcuts[c.id] !== undefined && <button class="iconbtn" aria-label={t('Reset')} title={t('Back to default')} onClick={() => { const s = { ...p.shortcuts }; delete s[c.id]; setP({ ...p, shortcuts: s }); }}><Icon name="rotate-ccw" size={13} /></button>}</div>; })}</div></div>}
    {tab === 'custom' && <div>
      <label class="fld"><span class="lbl">{t('Tab name')}</span><input class="in" value={ct.name} maxLength={24} onInput={(e: any) => setP({ ...p, customTab: { ...ct, name: e.target.value } })} /></label>
      <div class="twocol"><div><h4>{t('On the tab')} ({ct.items.length})</h4><div class="list bordered">{ct.items.map((id, i) => { const c = cmd(id); return c ? <div class="scrow"><span><Icon name={c.icon || 'command'} size={13} />{t(c.label)}</span><button class="iconbtn" aria-label={t('Move up')} disabled={i === 0} onClick={() => { const a = [...ct.items];[a[i - 1], a[i]] = [a[i], a[i - 1]]; setP({ ...p, customTab: { ...ct, items: a } }); }}><Icon name="arrow-up" size={13} /></button><button class="iconbtn" aria-label={t('Move down')} disabled={i === ct.items.length - 1} onClick={() => { const a = [...ct.items];[a[i + 1], a[i]] = [a[i], a[i + 1]]; setP({ ...p, customTab: { ...ct, items: a } }); }}><Icon name="arrow-down" size={13} /></button><button class="iconbtn" aria-label={t('Remove')} onClick={() => setP({ ...p, customTab: { ...ct, items: ct.items.filter(x => x !== id) } })}><Icon name="x" size={13} /></button></div> : null; })}{!ct.items.length && <div class="muted pad">{t('Empty — add commands from the right.')}</div>}</div></div>
        <div><h4>{t('Available commands')}</h4><div class="searchin"><Icon name="search" size={14} /><input value={q} placeholder={t('Filter')} onInput={(e: any) => setQ(e.target.value)} /></div><div class="list bordered tall">{COMMANDS.filter(c => !ct.items.includes(c.id) && c.id !== 'custom.edit' && (!q || c.label.toLowerCase().includes(q.toLowerCase()))).map(c => <button class="scrow btnrow" onClick={() => setP({ ...p, customTab: { ...ct, items: [...ct.items, c.id] } })}><span><Icon name={c.icon || 'command'} size={13} />{t(c.label)}<small>{t(c.group)}</small></span><Icon name="plus" size={13} /></button>)}</div></div></div>
      <div class="row-end"><Btn icon="download" label={t('Export tab (JSON)')} onClick={() => download('hydra_custom_tab.json', JSON.stringify({ format: 'hydra.customtab', ...ct }, null, 2), 'application/json')} /><Btn icon="upload" label={t('Import tab (JSON)')} onClick={async () => { const [f] = await pickFile('.json'); if (!f) return; try { const o = JSON.parse(await f.text()); if (o.format !== 'hydra.customtab') throw 0; setP({ ...p, customTab: { name: String(o.name || 'Custom').slice(0, 24), items: (o.items || []).filter((x: string) => cmd(x)) } }); S.toast(t('Custom Tab imported — save to apply'), 'ok'); } catch { S.toast(t('Not a HYDRA Custom Tab file'), 'err'); } }} /></div></div>}
    {tab === 'language' && <div><label class="fld"><span class="lbl">{t('Interface language')}</span><select class="in" value={p.language} onChange={(e: any) => setP({ ...p, language: e.target.value })}>{languages().map(l => <option value={l}>{({ en: 'English', gu: 'ગુજરાતી (Gujarati)', hi: 'हिन्दी (Hindi)' } as any)[l] || l}</option>)}</select></label>
      <p class="muted">{t('Every label is looked up in a language file. To add Gujarati or Hindi, drop lang/gu.js or lang/hi.js into the HYDRA folder (see lang/README.txt) — no code changes. Symbols and ID patterns stay language-independent.')}</p></div>}
  </Modal>;
}

// ---------- Settings › Appearance: themes ----------
function ThemePicker({ s, setS }: { s: S.Settings; setS: (x: S.Settings) => void }) {
  const [list, setList] = useState(TH.allThemes()); const [ed, setEd] = useState<TH.Theme | null>(null);
  const cur = s.themeId || (s.theme === 'contrast' ? 'contrast' : TH.STITCH);
  // live preview while the dialog is open; closing without Apply restores the saved look
  useEffect(() => { if (!ed) TH.applyTheme(cur, !!s.paperFollow); }, [cur, s.paperFollow, ed]);
  useEffect(() => () => { const v = S.settings.value; TH.applyTheme(v.themeId, !!v.paperFollow, v.theme === 'contrast'); }, []);
  useEffect(() => { if (ed) TH.previewVars({ ...TH.STITCH_VARS, ...ed.vars }); }, [ed]);
  const pick = (id: string) => { setEd(null); setS({ ...s, themeId: id, theme: id === 'contrast' ? 'contrast' : 'light' }); };
  const sw = (th: TH.Theme) => { const v = { ...TH.STITCH_VARS, ...th.vars }; return ['--title', '--bg', '--panel', '--acc', '--ink'].map(k => <i style={{ background: th.contrast ? (k === '--title' ? '#0B1118' : k === '--acc' ? '#0050A8' : k === '--ink' ? '#000' : '#fff') : v[k] }} />); };
  const customise = () => { const base = TH.themeById(cur); setEd({ id: base.builtin ? 'my_' + Date.now().toString(36) : base.id, name: base.builtin ? `My ${base.name.replace(' (default)', '')}` : base.name, vars: { ...TH.STITCH_VARS, ...base.vars } }); };
  const save = () => { if (!ed) return; const l = TH.customThemes().filter(x => x.id !== ed.id); l.push({ ...ed, name: ed.name.trim() || 'My theme' }); TH.saveCustomThemes(l); setList(TH.allThemes()); const id = ed.id; setEd(null); pick(id); S.toast(t('Theme saved'), 'ok'); };
  const del = (id: string) => { TH.saveCustomThemes(TH.customThemes().filter(x => x.id !== id)); setList(TH.allThemes()); if (cur === id) pick(TH.STITCH); };
  const imp = async () => { const [f] = await pickFile('.json'); if (!f) return; try { const th = TH.importTheme(await f.text()); TH.saveCustomThemes([...TH.customThemes(), th]); setList(TH.allThemes()); pick(th.id); S.toast(t('Theme imported'), 'ok'); } catch (e: any) { S.toast(String(e?.message || e), 'err'); } };
  return <div class="fld span2 themes"><span class="lbl">{t('Theme')}</span>
    <div class="themegrid">{list.map(th => <button class={'themecard ' + (cur === th.id && !ed ? 'on' : '')} aria-pressed={cur === th.id} onClick={() => pick(th.id)}>
      <span class="sw">{sw(th)}</span><b>{t(th.name)}</b>{!th.builtin && <span class="tdel" role="button" title={t('Delete theme')} onClick={(e: any) => { e.stopPropagation(); del(th.id); }}>✕</span>}</button>)}</div>
    <div class="row gap"><button class="btn" onClick={customise}>{t('Customise…')}</button><button class="btn" onClick={imp}>{t('Import theme…')}</button>
      <button class="btn" onClick={() => { const th = TH.themeById(cur); download(th.name.replace(/\W+/g, '_') + '.hydratheme.json', TH.exportTheme(th), 'application/json'); }}>{t('Export theme')}</button>
      <label class="checkrow"><input type="checkbox" checked={!!s.paperFollow} onChange={(e: any) => setS({ ...s, paperFollow: e.target.checked })} />{t('Sheet paper follows the theme (otherwise white)')}</label></div>
    {cur === TH.STITCH && !ed && <p class="muted">{t('Stitch is the default theme and cannot be edited — Customise makes your own copy. The operator panel keeps its own colours in every theme.')}</p>}
    {ed && <div class="themeed"><label class="fld"><span class="lbl">{t('Theme name')}</span><input class="in" value={ed.name} maxLength={40} onInput={(e: any) => setEd({ ...ed, name: e.target.value })} /></label>
      <div class="themecols">{TH.EDITABLE.map(([l, k]) => <label class="tcol"><input type="color" value={(ed.vars[k] || TH.STITCH_VARS[k] || '#ffffff').slice(0, 7)} onInput={(e: any) => setEd({ ...ed, vars: { ...ed.vars, [k]: e.target.value.toUpperCase() } })} /><span>{t(l)}</span><code>{ed.vars[k]}</code></label>)}</div>
      <div class="row gap"><button class="primary" onClick={save}>{t('Save as theme')}</button><button class="btn" onClick={() => setEd(null)}>{t('Cancel')}</button></div></div>}
  </div>;
}

// ---------- Settings ----------
function SettingsDlg({ tab: t0 }: { tab: string }) {
  const [tab, setTab] = useState(t0); const [s, setS] = useState(clone(S.settings.value)); const sv = s.solver;
  const apply = () => { S.saveSettings(s); close(); S.toast(t('Settings saved'), 'ok'); };
  const R = (label: string, k: keyof typeof s, min: number, max: number, unit = '%') => <label class="fld"><span class="lbl">{label} · {s[k] as any}{unit}</span><input type="range" min={min} max={max} value={s[k] as any} onInput={(e: any) => setS({ ...s, [k]: +e.target.value })} /></label>;
  const sys = S.prefs.value.unitSystem;
  return <Modal title={t('Settings')} icon="palette" wide onClose={close} footer={<><button class="btn" onClick={() => setS(clone(S.defaultSettings))}>{t('Restore defaults')}</button><div class="grow" /><button class="btn" onClick={close}>{t('Cancel')}</button><button class="primary" onClick={apply}>{t('Apply')}</button></>}>
    <Tabs value={tab} onChange={setTab} tabs={[['appearance', t('Appearance')], ['solver', t('Solver & fluid')], ['performance', t('Performance')], ['storage', t('Storage & recovery')]]} />
    {tab === 'appearance' && <div class="fgrid">
      <ThemePicker s={s} setS={setS} />
      <label class="fld"><span class="lbl">{t('Starred tile size')}</span><Seg value={s.tileSize} options={[['small', t('Small')], ['medium', t('Medium')], ['large', t('Large')]]} onChange={v => setS({ ...s, tileSize: v as any })} /></label>
      {R(t('Brightness'), 'brightness', 80, 110)}{R(t('Contrast'), 'contrast', 90, 130)}{R(t('Font scale'), 'fontScale', 85, 130)}{R(t('Glass blur'), 'blur', 0, 30, ' px')}
      <label class="checkrow"><input type="checkbox" checked={s.reduceTransparency} onChange={(e: any) => setS({ ...s, reduceTransparency: e.target.checked })} />{t('Reduce transparency')}</label>
      <label class="checkrow"><input type="checkbox" checked={s.reduceMotion} onChange={(e: any) => setS({ ...s, reduceMotion: e.target.checked })} />{t('Reduce motion')}</label></div>}
    {tab === 'solver' && <div><p class="muted">{t('Used by the simulation engine (Simulate · F5). Oil bulk modulus 1.4 GPa; air at 20 °C, ISO 6358 flow.')}</p><div class="fgrid">
      <label class="fld"><span class="lbl">{t('Time step')} (ms)</span><input class="in" type="number" min={0.01} step={0.1} value={sv.dt} onInput={(e: any) => setS({ ...s, solver: { ...sv, dt: Math.max(0.01, +e.target.value) } })} /></label>
      <label class="fld"><span class="lbl">{t('Tolerance')}</span><select class="in" value={sv.tol} onChange={(e: any) => setS({ ...s, solver: { ...sv, tol: +e.target.value } })}>{[1e-4, 1e-5, 1e-6, 1e-7, 1e-8].map(x => <option value={x}>{x.toExponential(0)}</option>)}</select></label>
      <label class="fld"><span class="lbl">{t('Oil')}</span><select class="in" value={sv.oil} onChange={(e: any) => { const vg = +e.target.value.replace(/\D/g, ''); setS({ ...s, solver: { ...sv, oil: e.target.value, viscosity: vg } }); }}>{['ISO VG 22', 'ISO VG 32', 'ISO VG 46', 'ISO VG 68', 'ISO VG 100'].map(x => <option>{x}</option>)}</select></label>
      <NumField label={t('Oil temperature')} qty="temperature" value={convert('temperature', '°C', unitFor(sys, 'temperature'), sv.temp)} unit={unitFor(sys, 'temperature')} min={convert('temperature', '°C', unitFor(sys, 'temperature'), -20)} max={convert('temperature', '°C', unitFor(sys, 'temperature'), 120)} onCommit={v => setS({ ...s, solver: { ...sv, temp: convert('temperature', unitFor(sys, 'temperature'), '°C', v) } })} />
      <NumField label={t('Density')} qty="density" value={sv.density} unit="kg/m³" min={600} max={1200} onCommit={v => setS({ ...s, solver: { ...sv, density: v } })} />
      <NumField label={t('Kinematic viscosity at 40 °C')} qty="viscosity" value={sv.viscosity} unit="cSt" min={1} max={1000} onCommit={v => setS({ ...s, solver: { ...sv, viscosity: v } })} />
      <label class="checkrow span2"><input type="checkbox" checked={(sv as any).pilotAuto !== false} onChange={(e: any) => setS({ ...s, solver: { ...sv, pilotAuto: e.target.checked } as any })} />{t('Pilot pressure switches pilot-operated valves (a spring returns them when the pilot drops)')}</label>
      <label class="fld"><span class="lbl">{t('Simulation step')} (ms)</span><select class="in" value={String((sv as any).simDt || 0)} onChange={(e: any) => setS({ ...s, solver: { ...sv, simDt: +e.target.value } as any })}><option value="0">{t('Automatic (0.5 / 1 ms)')}</option>{[0.2, 0.5, 1, 2].map(x => <option value={String(x)}>{x} ms</option>)}</select></label>
      <p class="muted small span2">{t('Electric circuits are drawn and documented, not simulated: when the machine runs, the hydraulics and the PLC are simulated and the electric sheets carry the links between them.')}</p></div></div>}
    {tab === 'performance' && <div class="fgrid">
      <label class="fld"><span class="lbl">{t('Render quality')}</span><Seg value={s.renderQuality} options={[['high', t('High')], ['balanced', t('Balanced')], ['fast', t('Fast')]]} onChange={v => setS({ ...s, renderQuality: v as any })} /></label>
      <label class="checkrow"><input type="checkbox" checked={s.hwAccel} onChange={(e: any) => setS({ ...s, hwAccel: e.target.checked })} />{t('Hardware acceleration (GPU) for designers')}</label>
      <p class="muted span2">{t('These take effect in the designers and simulation view; the Home tab is always light.')}</p></div>}
    {tab === 'storage' && <div class="fgrid">
      <label class="fld span2"><span class="lbl">{t('Default project folder')}</span><div class="row"><input class="in" readOnly value={s.folderName || t('Not set — the Save dialog starts in Documents')} /><Btn icon="folder-open" label={t('Choose…')} disabled={!Pj.fsAccess()} title={Pj.fsAccess() ? '' : t('Not supported by this browser')} onClick={async () => { const n = await chooseFolder(); if (n) setS({ ...s, folderName: n }); }} /></div></label>
      <label class="fld"><span class="lbl">{t('Checkpoints kept per project')}</span><select class="in" value={s.recoveryCopies} onChange={(e: any) => setS({ ...s, recoveryCopies: +e.target.value })}>{[5, 10, 20, 50].map(x => <option value={x}>{x}</option>)}</select></label>
      <p class="muted span2">{t('Libraries, history, stars and settings are kept in this browser profile. The project itself always lives in its .hydra file.')}</p></div>}
  </Modal>;
}

// ---------- Calculators ----------
function Explain({ children }: { children: ComponentChildren }) { const [o, setO] = useState(false); return <div class="explain"><button class="link" aria-expanded={o} onClick={() => setO(!o)}><Icon name={o ? 'chevron-down' : 'chevron-right'} size={12} />{t('How it is calculated')}</button>{o && <div class="ex">{children}</div>}</div>; }
function Out({ label, qty, base, unit }: { label: string; qty: string; base: number; unit: string }) { const [u, setU] = useState(unit); useEffect(() => setU(unit), [unit]); const v = fromBase(qty, u, base); return <div class="out"><span>{label}</span><b>{isFinite(v) ? round(v, 4) : '—'}</b><select class="in unit" aria-label={label + ' unit'} value={u} onChange={(e: any) => setU(e.target.value)}>{Object.keys(UNITS[qty]).map(x => <option>{x}</option>)}</select></div>; }
function CalcDlg() {
  const [tab, setTab] = useState('cyl'); const sys = S.prefs.value.unitSystem; const U = (q: any) => unitFor(sys, q);
  // all state kept in SI base units
  const [c, setC] = useState({ D: 0.063, d: 0.036, p: 100e5, Q: 20e-3 / 60, eta: 95, Vg: 16e-6, n: 1450, ev: 95, et: 85, dp: 150e5, line: 'pressure', Qp: 40e-3 / 60, ID: 0.012, Qd: 40e-3 / 60, IDd: 0.012, Ld: 5, nu: 46, rho: 870 });
  const set = (k: string) => (v: number) => setC({ ...c, [k]: v });
  const B = (k: keyof typeof c, q: string, label: string, min = 0) => <NumField label={label} qty={q} value={fromBase(q, U(q), c[k] as number)} unit={U(q)} min={fromBase(q, U(q), min)} onCommit={v => set(k as string)(toBase(q, U(q), v))} />;
  // cylinder
  const A1 = Math.PI * c.D * c.D / 4, A2 = Math.PI * (c.D * c.D - c.d * c.d) / 4, eta = c.eta / 100;
  // pump
  const Qpump = c.Vg * c.n / 60 * c.ev / 100, Pin = Qpump * c.dp / (c.et / 100), T = c.Vg * c.dp / (2 * Math.PI) / ((c.et / c.ev));
  // pipe
  const vRec: Record<string, number> = { suction: 1.0, return: 3.0, pressure: 5.0 }; const vr = vRec[c.line]; const dmin = Math.sqrt(4 * c.Qp / (Math.PI * vr)); const vAct = c.Qp / (Math.PI * c.ID * c.ID / 4);
  // pressure drop
  const v = c.Qd / (Math.PI * c.IDd * c.IDd / 4), nu = c.nu * 1e-6, Re = v * c.IDd / nu, f = Re < 2300 ? 64 / Re : 0.3164 / Math.pow(Re, 0.25), dP = f * (c.Ld / c.IDd) * c.rho * v * v / 2;
  return <Modal title={t('Calculators')} icon="calculator" wide onClose={close} footer={<button class="primary" onClick={close}>{t('Close')}</button>}>
    <Tabs value={tab} onChange={setTab} tabs={[['cyl', t('Cylinder force & speed')], ['pump', t('Pump flow & power')], ['pipe', t('Pipe sizing')], ['dp', t('Pressure drop')]]} />
    <p class="muted">{t('Inputs follow your unit system')} ({sys}); {t('every result has its own unit list.')}</p>
    {tab === 'cyl' && <div class="calc"><div class="fgrid">{B('D', 'length', t('Bore Ø'), 1e-4)}{B('d', 'length', t('Rod Ø'), 0)}{B('p', 'pressure', t('Pressure'))}{B('Q', 'flow', t('Flow'))}<label class="fld"><span class="lbl">{t('Efficiency')} · {c.eta}%</span><input type="range" min={70} max={100} value={c.eta} onInput={(e: any) => set('eta')(+e.target.value)} /></label></div>
      {c.d >= c.D ? <p class="errmsg">{t('Rod must be smaller than the bore')}</p> : <div class="outs">
        <Out label={t('Extend force')} qty="force" base={c.p * A1 * eta} unit={U('force')} /><Out label={t('Retract force')} qty="force" base={c.p * A2 * eta} unit={U('force')} />
        <Out label={t('Extend speed')} qty="speed" base={c.Q / A1} unit={U('speed')} /><Out label={t('Retract speed')} qty="speed" base={c.Q / A2} unit={U('speed')} />
        <Out label={t('Piston area')} qty="area" base={A1} unit={U('area')} /><Out label={t('Annulus area')} qty="area" base={A2} unit={U('area')} />
        <div class="out"><span>{t('Area ratio φ')}</span><b>{round(A1 / A2, 4)} : 1</b><span /></div></div>}
      <Explain><p>{t('Force is pressure pushing on an area: the full piston face when extending, the ring around the rod when retracting. Speed is how fast the incoming oil fills that area.')}</p><pre>{'F = p × A × η        v = Q ÷ A\nA (extend)  = π × D² ÷ 4\nA (retract) = π × (D² − d²) ÷ 4'}</pre><p class="muted">{t('F force · p pressure · A area · η efficiency · v speed · Q flow · D bore · d rod diameter')}</p></Explain></div>}
    {tab === 'pump' && <div class="calc"><div class="fgrid">{B('Vg', 'displacement', t('Displacement'))}<NumField label={t('Speed')} qty="rotation" value={c.n} unit="rpm" min={1} onCommit={set('n')} />{B('dp', 'pressure', t('Pressure'))}
      <label class="fld"><span class="lbl">{t('Volumetric efficiency')} · {c.ev}%</span><input type="range" min={70} max={100} value={c.ev} onInput={(e: any) => set('ev')(+e.target.value)} /></label><label class="fld"><span class="lbl">{t('Overall efficiency')} · {c.et}%</span><input type="range" min={50} max={98} value={c.et} onInput={(e: any) => set('et')(Math.min(+e.target.value, c.ev))} /></label></div>
      <div class="outs"><Out label={t('Delivered flow')} qty="flow" base={Qpump} unit={U('flow')} /><Out label={t('Input power')} qty="power" base={Pin} unit={U('power')} /><Out label={t('Drive torque')} qty="torque" base={T} unit={U('torque')} /></div>
      <Explain><p>{t('Each shaft turn moves one displacement of oil; leakage removes a little (volumetric efficiency). Power is flow times pressure, divided by the overall efficiency.')}</p><pre>{'Q = Vg × n × ηv\nP = Q × Δp ÷ ηt\nT = Vg × Δp ÷ (2π × ηhm),  ηhm = ηt ÷ ηv'}</pre><p class="muted">{t('Q flow · Vg displacement per turn · n speed · ηv volumetric, ηt overall, ηhm mechanical efficiency · Δp pressure · P power · T torque')}</p></Explain></div>}
    {tab === 'pipe' && <div class="calc"><div class="fgrid">{B('Qp', 'flow', t('Flow'))}<label class="fld"><span class="lbl">{t('Line type')}</span><select class="in" value={c.line} onChange={(e: any) => setC({ ...c, line: e.target.value })}><option value="suction">{t('Suction (≈ 1 m/s)')}</option><option value="return">{t('Return (≈ 3 m/s)')}</option><option value="pressure">{t('Pressure (≈ 5 m/s)')}</option></select></label>{B('ID', 'length', t('Check an inner Ø'), 1e-4)}</div>
      <div class="outs"><Out label={t('Minimum inner Ø')} qty="length" base={dmin} unit={U('length')} /><Out label={t('Velocity in chosen Ø')} qty="speed" base={vAct} unit="m/s" /><div class="out"><span>{t('Verdict')}</span><b class={vAct > vr * 1.15 ? 'warnc' : 'okc'}>{vAct > vr * 1.15 ? t('Too fast — choose a larger pipe') : t('Within the guideline')}</b><span /></div></div>
      <Explain><p>{t('A pipe must be wide enough that oil does not travel faster than the guideline for that line; faster oil wastes energy and makes noise.')}</p><pre>{'d = √(4 × Q ÷ (π × v))'}</pre><p class="muted">{t('d inner diameter · Q flow · v recommended velocity. Guideline velocities are typical design values, not a standard requirement.')}</p></Explain></div>}
    {tab === 'dp' && <div class="calc"><div class="fgrid">{B('Qd', 'flow', t('Flow'))}{B('IDd', 'length', t('Inner Ø'), 1e-4)}{B('Ld', 'length', t('Pipe length'), 0)}<NumField label={t('Kinematic viscosity')} qty="viscosity" value={c.nu} unit="cSt" min={0.5} onCommit={set('nu')} /><NumField label={t('Density')} qty="density" value={c.rho} unit="kg/m³" min={500} onCommit={set('rho')} /></div>
      <div class="outs"><Out label={t('Velocity')} qty="speed" base={v} unit="m/s" /><div class="out"><span>{t('Reynolds number')}</span><b>{round(Re, 4)}</b><small>{Re < 2300 ? t('laminar') : t('turbulent')}</small></div><div class="out"><span>{t('Friction factor')}</span><b>{round(f, 3)}</b><span /></div><Out label={t('Pressure drop')} qty="pressure" base={dP} unit={U('pressure')} /></div>
      <Explain><p>{t('Oil loses pressure rubbing along the pipe wall. The loss grows with length and speed, and shrinks with a wider pipe. Smooth flow (laminar) and swirling flow (turbulent) use different friction rules.')}</p><pre>{'Re = v × d ÷ ν\nf = 64 ÷ Re              (Re < 2300, laminar)\nf = 0.3164 ÷ Re^0.25     (turbulent, smooth pipe)\nΔp = f × (L ÷ d) × ρ × v² ÷ 2'}</pre><p class="muted">{t('Re Reynolds number · v velocity · d inner diameter · ν kinematic viscosity · f friction factor · L length · ρ density · Δp pressure drop')}</p></Explain></div>}
  </Modal>;
}
function UnitsDlg() {
  const qs = ['pressure', 'flow', 'force', 'length', 'volume', 'temperature', 'area', 'speed'];
  const [q, setQ] = useState('pressure'); const [from, setFrom] = useState('bar'); const [val, setVal] = useState('100');
  useEffect(() => { setFrom(Object.keys(UNITS[q])[0]); }, [q]);
  const v = parseFloat(val.replace(',', '.'));
  return <Modal title={t('Unit Converter')} icon="ruler" onClose={close} footer={<button class="primary" onClick={close}>{t('Close')}</button>}>
    <div class="chips">{qs.map(x => <button class={'chip ' + (q === x ? 'on' : '')} onClick={() => setQ(x)}>{t(x[0].toUpperCase() + x.slice(1))}</button>)}</div>
    <div class="row"><input class={'in big ' + (isFinite(v) ? '' : 'bad')} value={val} aria-label={t('Value')} onInput={(e: any) => setVal(e.target.value)} /><select class="in" value={from} aria-label={t('From unit')} onChange={(e: any) => setFrom(e.target.value)}>{Object.keys(UNITS[q]).map(u => <option>{u}</option>)}</select></div>
    <div class="convlist">{Object.keys(UNITS[q]).map(u => <div class={'out ' + (u === from ? 'self' : '')}><span>{u}</span><b>{isFinite(v) ? round(convert(q, from, u, v), 6) : '—'}</b><button class="iconbtn" title={t('Copy')} aria-label={t('Copy')} onClick={() => { navigator.clipboard?.writeText(String(round(convert(q, from, u, v), 6))); S.toast(t('Copied'), 'ok'); }}><Icon name="copy" size={13} /></button></div>)}</div>
  </Modal>;
}
function LibManagerDlg() {
  const lib = S.customLib.value; const [sel, setSel] = useState<string[]>([]);
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);
  return <Modal title={t('Library Manager')} icon="library-big" wide="xl" onClose={close} footer={<><Btn icon="upload" label={t('Import…')} onClick={async () => importLibraryFiles(await pickFile('.hydralib,.hydsym,.json', true))} /><Btn icon="download" label={sel.length ? t('Export selected') : t('Export all')} disabled={!lib.length} onClick={() => exportLibrary(sel.length ? lib.filter(x => sel.includes(x.item_id)) : lib)} /><Btn icon="trash-2" kind="danger" label={t('Delete selected')} disabled={!sel.length} onClick={async () => { if ((await S.confirmDlg(t('Delete'), `${t('Delete')} ${sel.length} ${t('items permanently?')}`, [{ label: t('Cancel'), value: 'n' }, { label: t('Delete'), value: 'y', danger: true }])) === 'y') { S.libWrite(S.libLoad().filter(x => !sel.includes(x.item_id))); setSel([]); S.openModal('libManager'); } else S.openModal('libManager'); }} /><div class="grow" /><button class="primary" onClick={close}>{t('Close')}</button></>}>
    <div class="kvgrid"><span>{t('Items')}</span><b>{lib.length} ({lib.filter(x => x.type === 'valve').length} {t('valves')}, {lib.filter(x => x.type === 'symbol').length} {t('symbols')})</b><span>{t('Needs review')}</span><b>{lib.filter(x => x.status !== 'valid').length}</b><span>{t('Folders')}</span><b>{S.customFolders.value.join(', ') || '—'}</b><span>{t('Storage')}</span><b>{t('This browser profile, shared with Valve Creator and Symbol Sketcher')} · {Math.round((localStorage.getItem(S.LIB_KEY) || '').length / 1024)} KB</b></div>
    <table class="ltab"><thead><tr><th><input type="checkbox" aria-label={t('Select all')} checked={sel.length === lib.length && lib.length > 0} onChange={(e: any) => setSel(e.target.checked ? lib.map(x => x.item_id) : [])} /></th><th></th><th>{t('Name')}</th><th>{t('Type')}</th><th>{t('Domain')}</th><th>{t('Folder')}</th><th>{t('Version')}</th><th>{t('Status')}</th><th>{t('Modified')}</th></tr></thead>
      <tbody>{lib.map(it => <tr class={sel.includes(it.item_id) ? 'sel' : ''} onClick={() => toggle(it.item_id)}><td><input type="checkbox" checked={sel.includes(it.item_id)} aria-label={it.name} onClick={(e) => e.stopPropagation()} onChange={() => toggle(it.item_id)} /></td><td><Thumb svg={libSvg(it)} alt="" class="mini" /></td><td><b>{it.name}</b></td><td>{it.type}</td><td>{it.domain}</td><td>{it.folder || '—'}</td><td>v{it.version}</td><td><Badge kind={it.status === 'valid' ? 'ok' : 'warn'}>{it.status === 'valid' ? t('Valid') : t('Needs review')}</Badge></td><td>{fmtDate(it.modified)}</td></tr>)}</tbody></table>
    {!lib.length && <p class="muted pad">{t('No custom parts yet.')}</p>}
  </Modal>;
}
function ImportDlg() {
  const go = async (accept: string, kind: string) => { const files = await pickFile(accept, kind === 'lib'); if (!files.length) return; close(); if (kind === 'lib') importLibraryFiles(files); else Pj.openBlob(files[0], files[0].name); };
  return <Modal title={t('Import')} icon="import" onClose={close} footer={<button class="btn" onClick={close}>{t('Cancel')}</button>}>
    <div class="list">
      <button class="launch" onClick={() => go('.hydra', 'proj')}><Icon name="folder-open" size={18} /><span><b>{t('HYDRA project (.hydra)')}</b><small>{t('Opens the project; older formats are upgraded with a backup.')}</small></span></button>
      <button class="launch" onClick={() => go('.json', 'proj')}><Icon name="file-json" size={18} /><span><b>{t('HYDRA project JSON')}</b><small>{t('A single-file JSON export of a project.')}</small></span></button>
      <button class="launch" onClick={() => go('.hydralib,.hydsym,.json', 'lib')}><Icon name="package" size={18} /><span><b>{t('HYDRA symbols & valves (.hydralib, .hydsym)')}</b><small>{t('Added to the Custom Library; newer versions replace older ones.')}</small></span></button>
      <button class="launch" disabled title={t('Not in this version')}><Icon name="file-down" size={18} /><span><b>{t('DXF / SVG drawings')}</b><small>{t('Circuit sheets export DXF and SVG (File › Export). To turn a drawing into a symbol, import the DXF in the Symbol Sketcher.')}</small></span></button>
    </div></Modal>;
}
function DocsDlg() {
  return <Modal title={t('Documentation')} icon="book-open" wide onClose={close} footer={<><Btn icon="map" label={t('Take the tour')} onClick={() => { close(); S.tour.value = 0; }} /><div class="grow" /><button class="primary" onClick={close}>{t('Close')}</button></>}>
    <div class="doc">
      <h4>{t('The Home tab')}</h4><p>{t('Home is where projects start and where every module is launched. It has five zones: the top strip (menus, quick access, search, workspace), the left sidebar (history, libraries, project tree, samples, launchers), the centre starred grid, the right inspector and the status bar.')}</p>
      <h4>{t('Projects')}</h4><p>{t('A project is one .hydra file — a zip holding the manifest, sheets, programs, project-local parts, the ID registry and project stars. Every Save keeps a checkpoint (History › Checkpoints). While you work, a recovery copy is written every minute; after a crash HYDRA offers to restore it.')}</p>
      <h4>{t('Libraries')}</h4><p>{t('Components holds read-only ISO 1219-1 and IEC 60617 parts. Duplicate one to the Custom Library to edit it. Custom parts are built in the Valve Creator and Symbol Sketcher, which open in pop-out windows and save straight back here.')}</p>
      <h4>{t('Stars')}</h4><p>{t('Star any tool, part, sheet, program or sample (star icon or Ctrl+D) to pin it to the centre grid. Tools and commands are starred for every project; sheets and parts are starred in the open project.')}</p>
      <h4>{t('Units')}</h4><p>{t('Choose SI, SI-bar or Imperial in Preference. Every number field has a unit list for one-off changes. Pressures and flows of placed parts are set per circuit instance, not in the library.')}</p>
      <h4>{t('Hydraulic / Pneumatic Designer')}</h4><p>{t('Double-click a hydraulic or pneumatic sheet in Machine Circuits (or use Launch) to open it as a tab. Click a part in the Parts panel and click on the sheet, or drag it in; R rotates and M mirrors while placing. Click a port to start a working line — every click adds a bend, a click on a port, junction or line finishes it, Esc cancels. P draws pilot lines and D drain lines (dashed, ISO 1219-1). J adds a junction on a line and branches from it. Drag a straight segment to move it; parts drag their lines with them.')}</p>
      <p>{t('Tags follow ISO 1219-2 (circuit number, code letter, number: 1P1 pump, 1A1 actuator, 1V1 valve, 1M1 prime mover, 1S1 sensor, 1Z1 other). Pressures, flows, bores and loads are set per placed part in Properties and stored in SI units for the simulation. F7 runs the rule check; the bottom panel also shows the parts list, the connection nets and the tags. File › Export writes vector PDF, SVG, PNG, DXF (R12, mm), the parts list (Excel, CSV) and a simulation netlist (JSON); Ctrl+P prints at the sheet size.')}</p>
      <h4>{t('Several projects at once')}</h4><p>{t('Every project you open or create gets its own chip on the Home tab and its own designer tabs (shown as Project › Sheet). Each keeps its own undo history and save state. Opening a project that is already open switches to it. Samples open as unsaved projects — Save keeps a copy; Read-only lets you view and simulate without changing anything. Copy and paste works between projects: tags are renumbered and custom parts are copied along.')}</p>
      <h4>{t('Sheet or infinite canvas')}</h4><p>{t('Sheet › Canvas switches a sheet between paper (ISO 5457 frame, title block) and an infinite canvas without edges. PDF and print of an infinite canvas fit the drawing onto the paper you choose; SVG, PNG and DXF export the drawing 1:1. Switching back to paper picks the smallest sheet and scale that hold the drawing. Double-click empty space to fit the page or the drawing.')}</p>
      <h4>{t('Assemblies and the machine')}</h4><p>{t('Add interface ports (Port X, tags such as P1, T1) to a sheet to make it an assembly. In the Assemblies panel, place it on another sheet as an instance (U1, U2 …), shown as a block or as its circuit. Instances can be moved, rotated, nested, isolated (right-click) and edited in place (double-click) — an edit changes every use; Make independent copy splits one off. Only ports with the same tag can be linked. Circuit › Build Machine places every unused assembly on one infinite machine sheet and links matching tags. Values can be overridden per instance.')}</p>
      <h4>{t('Simulation')}</h4><p>{t('Simulate (F5) runs the sheet with all its assemblies as one machine. Lines are coloured by pressure; cylinders move; the Simulation tab lists live values and plots stroke and pressure. Click any box of a directional valve to switch it there — it stays until you click another box, whatever its operators. Pilot pressure and cams (roller valves, Actuated by 1A1+) switch valves automatically. Valve data (rated flow, pressure drop, response time, overlap, leakage) is set per placed part under Simulation data. F6 pauses, Shift+F5 stops; editing is locked while it runs.')}</p>
      <h4>{t('Adjust while running')}</h4><p>{t('Click a throttle, pressure valve, regulator, pump, motor or cylinder while the simulation runs (or right-click → Adjust while running…) to change its opening, setting, speed, displacement or load with a slider. "Keep these settings" in the Simulation tab writes the changed values back to the parts (Undo reverts them).')}</p>
      <h4>{t('Plotting')}</h4><p>{t('Right-click any line or part while simulating to plot its pressure, flow, velocity, stroke, speed, force, load, temperature or viscosity — up to 8 signals, each in its own colour and on its own scale. Click the plot for cursor A, Shift+click for cursor B (values and Δt are shown); × removes a signal; CSV exports all plotted signals.')}</p>
      <h4>{t('Checks while running')}</h4><p>{t('Each part has a maximum operating pressure (Simulation data). The simulation warns when it is exceeded, when line velocity is above 5 m/s (pressure), 3 m/s (return) or 1.2 m/s (suction), when a pump suction falls below −0.3 bar, when a gauge goes over range and when a motor overspeeds. The part or line is outlined in orange; click a warning to select it. Line size comes from each line\'s Size field.')}</p>
      <h4>{t('Oil, end stops and loads')}</h4><p>{t('Viscosity follows the oil temperature (46 cSt at 40 °C), so leakage and throttle flow change as the oil warms. Cylinders hit stiff end stops — the readout shows the impact force and the cushion peak pressure. The load on a cylinder or rotary actuator can be constant, a spring (preload + rate), a table versus position or a table versus time.')}</p>
      <h4>{t('Flow arrows')}</h4><p>{t('Pointed arrows run along every line in the direction of flow, faster as the velocity rises. Their length, width, size, number per 100 mm, speed and colour are set in Preferences › Simulation, together with the line tooltip and the orange warnings. Simulate › Flow Arrows turns them on or off.')}</p>
      <h4>{t('Machine valves and parts (v0.5.3)')}</h4><p>{t('Added from real machine circuits: 4/3 valves with P→A-only position, throttled float centre and spring-less double-solenoid centre; 4/2 with spool position switch and with P→T at rest; 2/2 and 3/2 leak-free seat valves; 2/2 ball valve with position switch; proportional valve with spool feedback; push-pull shut-off; dual counterbalance sandwich; blind plate; pump with stroking/counter piston control; one-direction motor with case drain; hydraulic shuttle; logic element with shuttle cover; 3-way reducing valve; accumulator charging valve; 2-way pressure compensator; pneumatic one-way flow control and cushioned cylinder; air gun and spray gun. Every one simulates. A cylinder that reaches its end stop now seats there — it stays still until the force reverses, and lines show steady flows and warnings.')}</p>
      <h4>{t('Full space')}</h4><p>{t('Collapse the designer side panels (Ctrl+[ and Ctrl+], or the panel buttons) and unpin the top bars with their pin buttons: an unpinned bar hides and slides back in when you point at the top edge.')}</p>
      <h4>{t('Electric Designer')}</h4><p>{t('Electric sheets open in the Electric Circuit Designer: the same canvas, sheets and exports as the hydraulic designer, with the IEC 60617 library, wires (W control, P power, D protective earth), junctions, net labels (+24V, 0V … join wires by name, also across sheets), terminals with numbers, and PLC inputs / outputs whose tag is the address (I0.0, Q0.0). Wire numbers name each connected net and are drawn on the wires; type your own on a wire to override. Electric circuits are drawn and documented, not simulated.')}</p>
      <h4>{t('Cross-reference')}</h4><p>{t('A relay coil lists its contacts under it (kind, terminals, /sheet.column); each contact shows where its coil is. Contacts belong to a coil by sharing its tag — pick the coil in Properties › Machine link.')}</p>
      <h4>{t('Machine tags (linking the sheets)')}</h4><p>{t('Hydraulic, pneumatic, electrical and PLC drawings stay independent and link by tag. A valve carries its solenoid tags (Values › Solenoid a / b tag, e.g. 1Y1); a solenoid coil with that tag on an electric sheet is that solenoid. A pressure, temperature or level switch contact uses the tag of the switch on the hydraulic sheet; a motor uses the tag of the pump drive (e.g. 1M1); a position sensor names the cylinder it watches (1A1+ / 1A1−). A PLC output wired to coil 1Y1 drives that solenoid. The Machine tags tab lists every link and what is still open; Export › Machine links (JSON) hands the chain to the PLC.')}</p>
      <h4>{t('Logic Coder (PLC programs)')}</h4><p>{t('Programs live under Machine Circuits › Programs; Launch › Logic Coder opens them. A program is built from puzzle blocks. Entry points: ON START runs once at Run, MAIN LOOP every scan (10 ms by default), ON E-STOP when the E-stop goes active, ON RESET after Reset, ON FAULT on a runtime fault; TASK adds a parallel stack. WAIT UNTIL and DELAY pause only their own stack. A SEQUENCE holds GRAFCET steps: the active step runs its actions every scan and moves on when its “next when” condition is true. ACTIVATE switches an output on only while its step is active; SET OUTPUT keeps the value until written again.')}</p>
      <p>{t('I/O blocks list the tags of your sheets: PLC inputs and outputs drawn on electric sheets (with their address), valve solenoids, pump motors, pressure switches, cylinders (extended / retracted, position, speed). Blocks keep a hidden permanent ID of the part, so renaming a tag or changing an address never breaks a program; a deleted part shows “missing component” and blocks Run. Variables are typed (BOOL, INT, FLOAT, TIME, STRING) and declared in the Variables tab.')}</p>
      <p>{t('Controller: Run, Pause, Scan (one scan), Stop (all outputs off), Reset and E-STOP; scan time 1–100 ms and speed 0.1×–5×. The I/O table sets inputs by hand and forces inputs or outputs (forced rows are orange). Watch shows sequences, variables, timers and counters; Trend records chosen signals (CSV); Alarms lists faults, E-stops, stalled waits and your ALARM blocks; the Event log lists every output change. Executed blocks glow green, the active step brighter, a waiting block pulses (amber when stalled); F9 or right-click sets a breakpoint. Ctrl+Z / Ctrl+Y undo block edits.')}</p>
      <h4>{t('Operator panel (HMI)')}</h4><p>{t('Menu › Open Controller, the Operator panel button in the Logic Coder, or the Panel button on a running machine opens it. Auto-build makes six pages from your program and sheets (Main, Manual, Setpoints, Alarms, I/O, Trends). Run view operates the machine: push buttons are hold-to-press (F-key shortcuts), the E-stop mushroom latches until clicked again, selectors and the key switch set the mode and the access level, number entries, sliders and knobs write variables or live part settings, recipes load and save set-points. Edit panel: click a palette item to add one of 40 widgets, drag a widget to move it, drag its blue corner to resize, and bind it in the inspector (Acts on / Shows, Enabled when, Edit level); Checks list bindings whose part was deleted. The panel docks beside the hydraulic sheet while the machine runs, opens as its own tab, or pops out to a second monitor. Colours follow IEC 60073.')}</p>
      <h4>{t('Running the machine (program + hydraulics)')}</h4><p>{t('When the project has a fluid sheet, Run in the Logic Coder starts that sheet’s simulation and the program together (Program › Runs with chooses the sheet, or Standalone). On a hydraulic sheet, the Machine button does the same with the active program. They run in lock-step: one scan every 10 ms of machine time, so Pause, Scan, speed and breakpoints stop the hydraulics too. A PLC output wired to a solenoid coil — or a solenoid used directly when there is no electric sheet — energises that valve solenoid: the valve shifts, and springs back to its rest position when de-energised. Position sensors that watch a cylinder, pressure / temperature / level switches and cylinder end blocks read the simulation; pushbuttons, selector switches and the E-stop stay manual — the strip above the sheet has hold-to-press buttons for them. A pump motor output starts and stops the pump. Valves the program does not use behave as before (click a valve box to switch it). Stop machine, or Stop on the sheet, stops both.')}</p>
    </div></Modal>;
}
function SymbolRefDlg() {
  const [d, setD] = useState('all'); const items: any[] = [...STD, ...S.stdValveItems.value].filter(x => d === 'all' || x.domain === d);
  return <Modal title={t('Symbol Reference')} icon="shapes" wide="xl" onClose={close} footer={<button class="primary" onClick={close}>{t('Close')}</button>}>
    <Seg value={d} options={[['all', t('All')], ['hydraulic', t('Hydraulic')], ['pneumatic', t('Pneumatic')], ['electrical', t('Electrical')]]} onChange={setD} />
    <div class="refgrid">{items.map(it => <div class="refcell"><Thumb svg={partSvg(it)} alt={it.name} /><b>{it.name}</b><small>{it.standard} · {t(it.category)}</small></div>)}</div></Modal>;
}
function KeysDlg() {
  const groups: Record<string, any[]> = {}; COMMANDS.forEach(c => { const k = keysOf(c); if (k) (groups[c.group] ||= []).push(c); });
  return <Modal title={t('Keyboard Shortcuts')} icon="keyboard" wide onClose={close} footer={<><Btn label={t('Edit shortcuts…')} onClick={() => S.openModal('prefs', { tab: 'shortcuts' })} /><div class="grow" /><button class="primary" onClick={close}>{t('Close')}</button></>}>
    <div class="keycols">{Object.entries(groups).map(([g, l]) => <div><h4>{t(g)}</h4>{l.map(c => <div class={'scrow ' + (isEnabled(c) ? '' : 'dimrow')}><span>{t(c.label)}</span><kbd>{prettyKeys(keysOf(c)).replace(/,.*$/, '')}</kbd></div>)}</div>)}</div>
    <p class="muted">{t('Ctrl+N is reserved by the browser on most systems — use Alt+N for New Project.')}</p></Modal>;
}
function AboutDlg() {
  return <Modal title={t('About HYDRA')} icon="info" onClose={close} footer={<button class="primary" onClick={close}>{t('Close')}</button>}>
    <div class="about"><div class="brand big"><i /><b>HYDRA</b></div><p>{t('2D hydraulic, pneumatic and electrical circuit design and simulation.')}</p>
      <div class="kvgrid"><span>{t('Version')}</span><b>{S.APP_VERSION}</b><span>{t('Created by')}</span><b>Jigs Rathod</b><span>{t('Built-in tools')}</span><b>Valve Creator v1.0 · Symbol Sketcher v1.0</b><span>{t('Standards')}</span><b>ISO 1219-1 · ISO 5599 · IEC 60617</b><span>{t('Project format')}</span><b>hydra.project v{S.FORMAT_VERSION}</b><span>{t('Runs')}</span><b>{t('Offline, from an unzipped folder — no installation')}</b></div>
      <p class="muted">{t('Open-source libraries and their licences are listed in lib/LICENSES.txt.')}</p></div></Modal>;
}
function IssueDlg() {
  const p = S.project.value;
  const txt = [`HYDRA ${S.APP_VERSION}`, `Browser: ${navigator.userAgent}`, `File access: ${Pj.fsAccess() ? 'yes' : 'download only'}`, `Project: ${p ? `${p.manifest.name} · format v${p.manifest.formatVersion} · ${Object.keys(p.nodes).length} nodes` : 'none'}`, `Custom library: ${S.customLib.value.length} items`, `Recent notifications:`, ...S.notes.value.slice(0, 8).map(n => `  [${n.level}] ${n.text}`), '', 'What happened:', '', 'What I expected:', ''].join('\n');
  const [v, setV] = useState(txt);
  return <Modal title={t('Report an Issue')} icon="bug" wide onClose={close} footer={<><Btn icon="download" label={t('Save as text')} onClick={() => download('hydra_issue.txt', v, 'text/plain')} /><Btn icon="copy" label={t('Copy')} onClick={() => { navigator.clipboard?.writeText(v); S.toast(t('Copied'), 'ok'); }} /><div class="grow" /><button class="primary" onClick={close}>{t('Close')}</button></>}>
    <p class="muted">{t('HYDRA never sends data anywhere. Describe the problem below, then copy or save this text and pass it on.')}</p><textarea class="in area" value={v} onInput={(e: any) => setV(e.target.value)} aria-label={t('Issue report')} /></Modal>;
}
function RelinkDlg({ star }: { star: S.Star }) {
  const kind = star.target_ref.split(':')[0];
  const opts: [string, string][] = kind === 'lib' ? S.customLib.value.map(x => ['lib:' + x.item_id, x.name]) : kind === 'node' && S.project.value ? Object.values(S.project.value.nodes).filter(n => n.type === 'sheet' || n.type === 'program').map(n => ['node:' + n.id, n.name]) : kind === 'std' ? [...STD, ...S.stdValveItems.value].map((x: any) => ['std:' + x.id, x.name]) : kind === 'sample' ? SAMPLES.map(s => ['sample:' + s.id, s.name]) : [];
  const [v, setV] = useState(opts[0]?.[0] || '');
  return <Modal title={t('Relink tile')} icon="external-link" onClose={close} footer={<><button class="btn" onClick={close}>{t('Cancel')}</button><button class="primary" disabled={!v} onClick={() => { const lbl = opts.find(o => o[0] === v)?.[1] || star.label; S.updateStar(star.star_id, { target_ref: v, label: lbl }); close(); }}>{t('Relink')}</button></>}>
    <p>{t('“{{l}}” points to something that no longer exists. Pick a replacement:', { l: star.label })}</p>
    {opts.length ? <select class="in" value={v} size={8} onChange={(e: any) => setV(e.target.value)}>{opts.map(([k, l]) => <option value={k}>{l}</option>)}</select> : <p class="muted">{t('Nothing of the same kind is available.')}</p>}</Modal>;
}
function CompareDlg({ cp }: { cp: any }) {
  const p = S.project.value; const now = p ? Object.values(p.nodes).filter(n => n.type === 'sheet').map(n => n.name) : [];
  const added = now.filter(x => !cp.sheets.includes(x)), removed = cp.sheets.filter((x: string) => !now.includes(x)), same = now.filter(x => cp.sheets.includes(x));
  return <Modal title={t('Compare with checkpoint')} icon="git-compare" onClose={close} footer={<><Btn icon="rotate-ccw" label={t('Restore this checkpoint')} onClick={() => { close(); Pj.restoreCheckpoint(cp.cid); }} /><div class="grow" /><button class="primary" onClick={close}>{t('Close')}</button></>}>
    <div class="kvgrid"><span>{t('Checkpoint')}</span><b>v{cp.version} · {fmtDate(cp.date)} · “{cp.name}”</b><span>{t('Current')}</span><b>{p ? `v${p.manifest.version}${S.dirty.value ? ' + ' + t('unsaved changes') : ''} · “${p.manifest.name}”` : '—'}</b></div>
    <h4>{t('Sheets')}</h4><div class="checks">{same.map(x => <div><span class="dot info" />{x}</div>)}{added.map(x => <div><span class="dot ok" />{x} <small>{t('added since')}</small></div>)}{removed.map((x: string) => <div><span class="dot err" />{x} <small>{t('removed since')}</small></div>)}{!same.length && !added.length && !removed.length && <div class="muted">{t('No sheets in either version')}</div>}</div></Modal>;
}
