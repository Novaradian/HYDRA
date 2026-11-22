import { h, Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import Fuse from 'fuse.js';
import Sortable from 'sortablejs';
import * as S from '../store';
import { COMMANDS, cmd, runCmd, isEnabled, keysOf } from '../commands';
import { Icon, Btn, MenuList, Popover, type MenuItem, Thumb, Seg } from './common';
import { prettyKeys, fmtDate, fmtTime } from '../util';
import { t } from '../i18n';
import { STD, SAMPLES, entsToSvg } from '../symbols';
import { overlayTool, toolHtml, wireOverlayFrame, TOOL_TITLE, valveSvg } from '../tools';
import { openRecent } from '../project';
import { stdById, libById, openNode, DESIGNER_TITLE } from '../actions';
import { focusPanel } from '../layout';
import { D } from '../designer/state';
import { HydDesigner, DesignerStatus } from '../designer/Designer';
import { LogicCoder } from '../plc/LogicCoder';
import { PanelTab } from '../plc/panel/Panel';
import { AiLauncher } from '../ai/Panel';

const inDes = () => !!D.value;
const MENUS: { id: string; label: string; items: () => (string | 'sep')[]; show?: () => boolean }[] = [
  { id: 'file', label: 'File', items: () => ['file.new', 'file.open', 'file.recent', 'sep', 'file.save', 'file.saveAs', 'file.saveAll', 'sep', 'file.import', 'file.exportJson', 'file.exportLib', 'file.exportPdf', 'file.exportSvg', 'file.exportPng', 'file.exportDxf', 'file.exportBom', 'sep', 'file.print', 'file.props', 'sep', 'file.close', 'file.closeAll', 'file.exit'] },
  { id: 'edit', label: 'Edit', show: inDes, items: () => ['edit.undo', 'edit.redo', 'sep', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.delete', 'sep', 'edit.selectAll', 'edit.rotate', 'des.mirror', 'edit.group', 'sep', 'edit.palette'] },
  { id: 'insert', label: 'Insert', show: inDes, items: () => ['des.select', 'des.work', 'des.pilot', 'des.drain', 'des.junction', 'des.text', 'des.enclosure', 'sep', 'des.part', 'des.port', 'tool.valve', 'tool.symbol'] },
  { id: 'circuit', label: 'Circuit', show: inDes, items: () => ['menu.ruleCheck', 'des.renumber', 'des.netlist', 'sep', 'des.machine', 'des.sheet', 'des.dock'] },
  { id: 'sim', label: 'Simulate', show: inDes, items: () => ['sim.run', 'sim.pause', 'sim.step', 'sim.stop', 'sep', 'sim.anim', 'sim.pilot', 'sep', 'sim.prefs', 'set.solver'] },
  { id: 'menu', label: 'Menu', items: () => ['tool.symbol', 'tool.valve', 'menu.libManager', 'menu.controller', 'sep', 'menu.ruleCheck', 'sep', 'menu.calc', 'menu.units'] },
  { id: 'pref', label: 'Preference', items: () => ['pref.si', 'pref.sibar', 'pref.imp', 'sep', 'pref.snap', 'pref.lang', 'pref.keys', 'sep', 'pref.open'] },
  { id: 'settings', label: 'Settings', items: () => ['set.appearance', 'set.contrast', 'sep', 'set.solver', 'set.perf', 'set.storage'] },
  { id: 'view', label: 'View', items: () => ['view.left', 'view.right', 'des.leftPane', 'des.rightPane', 'view.pinTop', 'view.pinTools', 'sep', 'view.full', 'view.reset', 'view.ids', 'sep', 'view.tileS', 'view.tileM', 'view.tileL', 'sep', 'view.grid', 'view.snapToggle', 'des.ortho', 'des.ports', 'des.dock', 'view.zoomIn', 'view.zoomOut', 'view.zoomFit', 'view.multi'] },
  { id: 'help', label: 'Help', items: () => ['help.docs', 'help.symbols', 'help.keys', 'help.tour', 'sep', 'help.updates', 'help.about', 'help.issue'] },
  { id: 'custom', label: 'Custom Tab', items: () => [...S.prefs.value.customTab.items, 'sep', 'custom.edit'] }
];
export const cmdItems = (ids: (string | 'sep')[]): MenuItem[] => ids.map(id => { if (id === 'sep') return 'sep'; const c = cmd(id); if (!c) return 'sep'; return { label: t(c.label), icon: c.icon, keys: prettyKeys(keysOf(c)), disabled: !isEnabled(c), reason: c.reason, checked: c.checked?.(), onSelect: () => runCmd(id) }; });

export function TitleBar() {
  const [open, setOpen] = useState<string | null>(null); const refs = useRef<Record<string, HTMLButtonElement>>({});
  const p = S.project.value; const d = S.dirty.value;
  useEffect(() => { document.title = p ? `${p.manifest.name}${d ? ' •' : ''} — HYDRA` : 'HYDRA'; }, [p?.manifest.name, d]);
  const MS = MENUS.filter(m => !m.show || m.show());
  const onKey = (e: KeyboardEvent) => { if (!open) return; const i = MS.findIndex(m => m.id === open); if (e.key === 'ArrowRight') { e.preventDefault(); setOpen(MS[(i + 1) % MS.length].id); } if (e.key === 'ArrowLeft') { e.preventDefault(); setOpen(MS[(i - 1 + MS.length) % MS.length].id); } };
  return <header class="titlebar" data-tour="menubar" onKeyDown={onKey as any}>
    <div class="tb-left">
      <div class="brand"><i /><b>HYDRA</b></div>
      <span class="projname" title={p ? (S.fileHandle.value?.name || p.manifest.location || t('Not saved yet')) : ''}>{p ? <>{p.manifest.name}{d && <span class="dirtydot" title={t('Unsaved changes')} aria-label={t('Unsaved changes')}>●</span>}<small>{S.fileHandle.value?.name || (p.manifest.version ? p.manifest.location : t('not saved yet'))}</small></> : <small>{t('No project open')}</small>}</span>
      <nav class="menubar" role="menubar" aria-label={t('Main menu')}>{MS.map(m => <button role="menuitem" aria-haspopup="true" aria-expanded={open === m.id} id={'menu-' + m.id} ref={el => { if (el) refs.current[m.id] = el; }} class={open === m.id ? 'open' : ''}
        onClick={() => setOpen(open === m.id ? null : m.id)} onMouseEnter={() => open && setOpen(m.id)}>{m.id === 'custom' ? S.prefs.value.customTab.name || t('Custom Tab') : t(m.label)}</button>)}</nav>
    </div>
    <div class="tb-right">
      <AiLauncher />
      <span class="pill-dark">OFFLINE · v{S.APP_VERSION}</span>
      <button class="winbtn" disabled title={t('Minimise from the browser or taskbar')} aria-label={t('Minimise')}>–</button>
      <button class="winbtn" title={t('Full screen')} aria-label={t('Full screen')} onClick={() => runCmd('view.full')}>□</button>
      <button class="winbtn x" title={t('Exit')} aria-label={t('Exit')} onClick={() => runCmd('file.exit')}>✕</button>
    </div>
    {open && refs.current[open] && <Popover anchor={refs.current[open]} onClose={() => setOpen(null)}><MenuList labelledBy={'menu-' + open} items={cmdItems(MENUS.find(m => m.id === open)!.items())} onDone={() => setOpen(null)} /></Popover>}
  </header>;
}

const QA = ['file.new', 'file.open', 'file.save', 'edit.undo', 'edit.redo'];
export function Toolbar() {
  S.histVer.value; S.project.value; S.dirty.value; // subscribe
  const ct = S.prefs.value.customTab;
  return <div class="toolbar" role="toolbar" aria-label={t('Quick access')}>
    <div class="qa">{QA.map(id => { const c = cmd(id)!; return <Btn kind="tb" icon={c.icon} title={`${t(c.label)} ${prettyKeys(keysOf(c)) ? '(' + prettyKeys(keysOf(c)) + ')' : ''}${!isEnabled(c) ? ' — ' + c.reason : ''}`} disabled={!isEnabled(c)} onClick={() => runCmd(id)} />; })}</div>
    <span class="tsep" />
    <button class="searchbtn" onClick={() => runCmd('edit.palette')} aria-label={t('Command search')}><Icon name="search" size={14} /><span>{t('Search commands, parts, projects…')}</span><kbd>Ctrl K</kbd></button>
    <span class="tsep" />
    <div class="customtab" role="group" aria-label={ct.name}><span class="ctlabel">{ct.name}</span>{ct.items.map(id => { const c = cmd(id); if (!c) return null; return <Btn kind="tb" icon={c.icon} label={t(c.label).replace(/…$/, '').replace(/ \(.*\)$/, '')} title={t(c.label) + (!isEnabled(c) ? ' — ' + c.reason : '')} disabled={!isEnabled(c)} onClick={() => runCmd(id)} />; })}
      <Btn kind="tb" icon="plus" title={t('Customize Custom Tab…')} onClick={() => runCmd('custom.edit')} /></div>
    <div class="grow" />
    <Seg label={t('Workspace')} value={S.workspace.value} options={[['hydraulic', t('Hydraulic')], ['electrical', t('Electrical')], ['plc', t('PLC')]]} onChange={v => runCmd('ws.' + v)} />
  </div>;
}

export function TabStrip() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const s = Sortable.create(ref.current!, { animation: 150, filter: '.fixed', draggable: '.dtab', onEnd: () => { const ids = [...ref.current!.querySelectorAll<HTMLElement>('[data-tab]')].map(e => e.dataset.tab!); S.tabs.value = ids.map(id => S.tabs.value.find(x => x.id === id)!).filter(Boolean); } }); return () => s.destroy(); }, []);
  const close = (id: string) => { const i = S.tabs.value.findIndex(x => x.id === id); S.tabs.value = S.tabs.value.filter(x => x.id !== id); if (S.activeTab.value === id) S.activeTab.value = S.tabs.value[Math.max(0, i - 1)].id; };
  const multi = S.docs.value.length > 1;
  const label = (tb: S.Tab) => { const p = tb.docKey ? S.docProject(tb.docKey) : tb.nodeId ? S.project.value : null; const n = tb.nodeId ? p?.nodes[tb.nodeId] : null; const nm = n ? n.name : t(tb.title); return multi && p ? <><span class="tproj">{p.manifest.name} ›</span>{nm}</> : nm; };
  return <div class="tabstrip" role="tablist" aria-label={t('Open views')} ref={ref}>{S.tabs.value.map(tb => { const p = tb.docKey ? S.docProject(tb.docKey) : tb.nodeId ? S.project.value : null; const dirty = tb.docKey ? S.docDirty(tb.docKey) : false; return <div data-tab={tb.id} class={`dtab ${tb.id === 'home' ? 'fixed' : ''} ${S.activeTab.value === tb.id ? 'on' : ''}`}>
    <button role="tab" aria-selected={S.activeTab.value === tb.id} title={p ? p.manifest.name : ''} onClick={() => S.activeTab.value = tb.id} onAuxClick={(e: any) => e.button === 1 && tb.id !== 'home' && close(tb.id)}><Icon name={tb.id === 'home' ? 'home' : tb.designer === 'electric' ? 'zap' : tb.designer === 'logic' ? 'binary' : tb.designer === 'panel' ? 'layout-dashboard' : p?.nodes[tb.nodeId || '']?.sheetType === 'pneumatic' ? 'wind' : 'droplets'} size={13} />{label(tb)}{dirty && multi && <span class="dirtydot sm">●</span>}</button>
    {tb.id !== 'home' && <button class="tclose" aria-label={t('Close tab') + ' ' + tb.title} onClick={() => close(tb.id)}><Icon name="x" size={12} /></button>}</div>; })}</div>;
}

export function StatusBar() {
  const [bell, setBell] = useState(false); const bref = useRef<HTMLButtonElement>(null); const [um, setUm] = useState(false); const uref = useRef<HTMLButtonElement>(null);
  const unread = S.notes.value.filter(n => !n.read).length; const b = S.busy.value;
  return <footer class="statusbar" data-tour="status">
    <div class="sl">
      <button ref={uref} onClick={() => setUm(!um)} title={t('Unit system')}><Icon name="ruler" size={13} />{S.prefs.value.unitSystem}</button>
      <span class="sbsep" /><span class={'autosave ' + (S.dirty.value ? 'dirty' : '')}><Icon name={S.dirty.value ? 'alert' : 'check-circle'} size={13} />{!S.project.value ? t('No project') : S.dirty.value ? (S.autosaveState.value.text.startsWith('Recovery') ? t('Unsaved changes') + ' · ' + S.autosaveState.value.text.replace('Recovery copy', t('recovery copy')) : t('Unsaved changes')) : S.autosaveState.value.text}</span>
      {D.value && <><span class="sbsep" /><DesignerStatus /></>}
      {b && <><span class="sbsep" /><span class="prog" role="progressbar" aria-label={b.label}><i style={{ width: (b.pct ?? 60) + '%' }} class={b.pct == null ? 'indet' : ''} /></span><span>{b.label}</span></>}
    </div>
    <div class="sr">
      <span>{t('Workspace')}: {t(S.workspace.value === 'plc' ? 'PLC' : S.workspace.value === 'electrical' ? 'Electrical' : 'Hydraulic')}</span><span class="sbsep" />
      <span>{S.customLib.value.length} {t('custom parts')}</span><span class="sbsep" />
      <button ref={bref} onClick={() => { setBell(!bell); }} aria-label={`${t('Notifications')} (${unread})`}><Icon name="bell" size={13} />{unread > 0 && <b class="dotcount">{unread}</b>}</button><span class="sbsep" />
      <span>HYDRA {S.APP_VERSION} · {D.value ? t('Designer') : t('Home')}</span>
    </div>
    {um && uref.current && <Popover anchor={uref.current} placement="top-start" onClose={() => setUm(false)}><MenuList items={cmdItems(['pref.si', 'pref.sibar', 'pref.imp'])} onDone={() => setUm(false)} /></Popover>}
    {bell && bref.current && <Popover anchor={bref.current} placement="top-end" onClose={() => { setBell(false); S.notes.value = S.notes.value.map(n => ({ ...n, read: true })); }}>
      <div class="notes"><div class="nhead"><b>{t('Notifications')}</b><button class="link" onClick={() => S.notes.value = []}>{t('Clear')}</button></div>
        {S.notes.value.length ? S.notes.value.slice(0, 40).map(n => <div class={'note ' + n.level + (n.read ? '' : ' unread')}><span class={'dot ' + n.level} /><span>{n.text}<small>{fmtTime(n.date)}</small></span></div>) : <div class="muted pad">{t('No notifications')}</div>}</div></Popover>}
  </footer>;
}

// ---------- command search (Ctrl+K) ----------
type Hit = { kind: string; label: string; sub: string; icon: string; keys?: string; disabled?: boolean; run: () => void };
export function Palette() {
  const [q, setQ] = useState(''); const [i, setI] = useState(0); const inp = useRef<HTMLInputElement>(null);
  useEffect(() => { inp.current?.focus(); }, []);
  const entries: Hit[] = useMemo(() => {
    const out: Hit[] = COMMANDS.map(c => ({ kind: t('Command'), label: t(c.label), sub: t(c.group) + (isEnabled(c) ? '' : ' · ' + c.reason), icon: c.icon || 'command', keys: prettyKeys(keysOf(c)), disabled: !isEnabled(c), run: () => runCmd(c.id) }));
    [...STD, ...S.stdValveItems.value].forEach((it: any) => out.push({ kind: t('Part'), label: it.name, sub: `${it.standard} · ${it.category}`, icon: 'component', run: () => { S.selection.value = { kind: 'std', ids: [it.id] }; focusPanel('components'); } }));
    S.customLib.value.forEach(it => out.push({ kind: t('Custom'), label: it.name, sub: `${it.type} · v${it.version}`, icon: it.type === 'valve' ? 'git-fork' : 'pen-tool', run: () => { S.selection.value = { kind: 'custom', ids: [it.item_id] }; focusPanel('custom'); } }));
    S.recents.value.forEach(r => out.push({ kind: t('Recent'), label: r.name, sub: r.path, icon: 'history', run: () => openRecent(r.id) }));
    SAMPLES.forEach(s => out.push({ kind: t('Sample'), label: s.name, sub: s.category, icon: 'library', run: () => { S.selection.value = { kind: 'sample', ids: [s.id] }; focusPanel('samples'); } }));
    const p = S.project.value; if (p) Object.values(p.nodes).forEach(n => out.push({ kind: t('Project'), label: n.name, sub: n.type + (n.sheetType ? ' · ' + n.sheetType : ''), icon: n.type === 'program' ? 'binary' : n.type === 'sheet' ? 'droplets' : 'folder', run: () => { S.selection.value = { kind: 'node', ids: [n.id] }; focusPanel('circuits'); } }));
    return out;
  }, []);
  const fuse = useMemo(() => new Fuse(entries, { keys: ['label', 'sub'], threshold: 0.38, ignoreLocation: true }), [entries]);
  const res = q.trim() ? fuse.search(q.trim()).slice(0, 40).map(r => r.item) : entries.filter(e => e.kind === t('Command') && !e.disabled).slice(0, 14);
  const go = (h: Hit) => { S.closeModal(); if (h.disabled) { S.toast(h.sub, 'warn'); return; } setTimeout(h.run, 0); };
  return <div class="scrim top" onClick={(e) => e.target === e.currentTarget && S.closeModal()}>
    <div class="palette" role="dialog" aria-modal="true" aria-label={t('Command search')}>
      <div class="pin"><Icon name="search" /><input ref={inp} value={q} placeholder={t('Type a command, part, project or sample…')} aria-label={t('Search')} role="combobox" aria-expanded="true" aria-controls="palres"
        onInput={(e: any) => { setQ(e.target.value); setI(0); }} onKeyDown={(e: any) => { if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(res.length - 1, i + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(0, i - 1)); } if (e.key === 'Enter' && res[i]) go(res[i]); if (e.key === 'Escape') S.closeModal(); }} /><kbd>Esc</kbd></div>
      <div class="pres" id="palres" role="listbox">{res.length ? res.map((r, k) => <button role="option" aria-selected={k === i} class={`${k === i ? 'on' : ''} ${r.disabled ? 'dis' : ''}`} onMouseEnter={() => setI(k)} onClick={() => go(r)}><Icon name={r.icon} /><span class="pl">{r.label}<small>{r.sub}</small></span><span class="pk">{r.kind}</span>{r.keys && <kbd>{r.keys}</kbd>}</button>) : <div class="muted pad">{t('No matches')}</div>}</div>
    </div></div>;
}

// ---------- designer tabs ----------
export function DesignerTab({ tab }: { tab: S.Tab }) {
  if (tab.designer === 'hydraulic' || tab.designer === 'electric') return <HydDesigner tab={tab} />;
  if (tab.designer === 'logic') return <LogicCoder tab={tab} />;
  if (tab.designer === 'panel') return <PanelTab tab={tab} />;
  const p = S.project.value; const n = tab.nodeId ? p?.nodes[tab.nodeId] : null;
  const circuit = n && p?.circuits[n.id]; const prog = n && p?.programs[n.id];
  const sheets = p ? Object.values(p.nodes).filter(x => (tab.designer === 'logic' ? x.type === 'program' : x.type === 'sheet' && (tab.designer === 'electric' ? x.sheetType === 'electric' : x.sheetType !== 'electric'))) : [];
  return <div class="designer">
    <div class="dhead"><Icon name={tab.designer === 'logic' ? 'binary' : 'droplets'} size={22} /><div><h2>{t(DESIGNER_TITLE[tab.designer!])}</h2><p>{n ? <>{t('Sheet')}: <b>{n.name}</b>{n.size ? ` · ${n.size}` : ''}{n.sheetType ? ` · ${n.sheetType}` : ''}</> : t('No sheet selected')}</p></div><div class="grow" /><Btn icon="home" label={t('Back to Home')} onClick={() => S.activeTab.value = 'home'} /></div>
    <div class="dbody">
      <div class="dnote"><Icon name="info" size={18} /><div><b>{t('No designer for this item')}</b><p>{t('It is kept in the project file with its name, type, size and parts.')}</p></div></div>
      {circuit?.components?.length ? <div><h3>{t('Parts on this sheet')} ({circuit.components.length})</h3><div class="partgrid">{circuit.components.map((c: any) => { const it: any = stdById(c.ref); if (!it) return null; return <div class="partcell"><Thumb svg={it.valve ? valveSvg(it.valve, it.id) : entsToSvg(it.ents, it.ports)} alt={it.name} /><span>{it.name}</span><small>{c.tag}</small></div>; })}</div></div> : null}
      {prog ? <div><h3>{t('Program')} · {prog.language}</h3><pre class="code">{prog.code || t('(empty program)')}</pre></div> : null}
      {!n && <div><h3>{t('Sheets in this project')}</h3>{sheets.length ? <div class="list">{sheets.map(s => <button class="row" onClick={() => openNode(s.id)}><Icon name={s.type === 'program' ? 'binary' : 'droplets'} />{s.name}<small>{s.sheetType || s.language}</small></button>)}</div> : <p class="muted">{p ? t('No matching sheets yet — add one in Machine Circuits.') : t('Open or create a project to add sheets.')}</p>}</div>}
    </div></div>;
}

// ---------- tools in-app (pop-up blocked, or chosen in Preferences) ----------
export function ToolOverlay() {
  const o = overlayTool.value; const ref = useRef<HTMLIFrameElement>(null);
  if (!o) return null;
  const close = () => { overlayTool.value = null; };
  return <div class="tooloverlay" role="dialog" aria-modal="true" aria-label={TOOL_TITLE[o.kind]}>
    <div class="tohead"><b>{t(TOOL_TITLE[o.kind])}</b><span class="muted">{t('Saves go straight to the Custom Library')}</span><div class="grow" /><Btn icon="x" label={t('Close')} onClick={close} /></div>
    <iframe ref={ref} title={TOOL_TITLE[o.kind]} srcdoc={toolHtml(o.kind)} onLoad={() => ref.current && wireOverlayFrame(ref.current, o.kind, o.item, close)} />
  </div>;
}

// ---------- guided tour ----------
const TOUR = [
  { sel: '[data-tour=menubar]', title: 'Top strip', text: 'Title bar, the seven menus, quick-access buttons and the workspace selector. Ctrl+K searches every command.' },
  { sel: '[data-panel=components]', title: 'Left sidebar', text: 'History, standard ISO / IEC parts, your Custom Library, the project tree and sample circuits. The Launch panel opens the designers and tools.' },
  { sel: '[data-panel=starred]', title: 'Starred grid', text: 'Anything you star appears here as a tile. Drag tiles to reorder; right-click for more.' },
  { sel: '[data-panel=inspector]', title: 'Inspector', text: 'Shows the specs of whatever you select. Standard parts are read-only; custom parts and project sheets are editable.' },
  { sel: '[data-tour=status]', title: 'Status bar', text: 'Unit system, save and recovery state, notifications and the version.' }
];
export function Tour() {
  const i = S.tour.value; const [r, setR] = useState<DOMRect | null>(null);
  useEffect(() => { if (i == null) return; const el = document.querySelector(TOUR[i].sel) as HTMLElement; if (i === 1) focusPanel('components'); setTimeout(() => setR((document.querySelector(TOUR[i].sel) as HTMLElement)?.getBoundingClientRect() || null), 60); }, [i]);
  if (i == null || !r) return null; const st = TOUR[i];
  const below = r.bottom + 180 < innerHeight; const left = Math.min(Math.max(12, r.left), innerWidth - 352);
  return <div class="tour" role="dialog" aria-label={t('Tour')}>
    <div class="tourhole" style={{ left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 }} />
    <div class="tourcard" style={{ left, top: below ? r.bottom + 12 : Math.max(12, r.top - 170) }}>
      <small>{i + 1} / {TOUR.length}</small><b>{t(st.title)}</b><p>{t(st.text)}</p>
      <div class="row-end"><Btn label={t('Skip')} kind="ghost" onClick={() => S.tour.value = null} />{i > 0 && <Btn label={t('Back')} onClick={() => S.tour.value = i - 1} />}<Btn kind="primary" label={i < TOUR.length - 1 ? t('Next') : t('Done')} onClick={() => S.tour.value = i < TOUR.length - 1 ? i + 1 : null} /></div>
    </div></div>;
}
