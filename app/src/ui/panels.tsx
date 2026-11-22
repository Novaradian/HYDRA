import { h, Fragment } from 'preact';
import { machineList, openMachine } from '../machines/index';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import Fuse from 'fuse.js';
import Sortable from 'sortablejs';
import * as S from '../store';
import { STD, SAMPLES, entsToSvg, symbolSpecSvg, type StdItem } from '../symbols';
import { valveSvg, openTool, valveChecks } from '../tools';
import { Icon, Btn, Thumb, Empty, Badge, openContextMenu, NumField, TextField, Seg, type MenuItem, Popover, MenuList } from './common';
import { cmdItems } from './shell';
import { runCmd } from '../commands';
import * as Pj from '../project';
import { sheetThumb } from '../designer/Designer';
import { stdById, libById, openNode, duplicateStdToCustom, exportLibrary, importLibraryFiles, starSelection, deleteSelection, resolveStar, starLabel, openSampleCopy, sampleToProject, editSelection } from '../actions';
import { fmtDate, pickFile, round, uid } from '../util';
import { unitFor, convert } from '../units';
import { t } from '../i18n';
import { kvSet } from '../db';

const STD_SVG: Record<string, string> = Object.fromEntries(STD.map(it => [it.id, entsToSvg(it.ents!, it.ports)]));
export const partSvg = (it: any) => it?.valve ? valveSvg(it.valve, it.id) : (STD_SVG[it?.id] || '');
export const libSvg = (it: any) => !it ? '' : it.type === 'valve' ? valveSvg(it.definition, it.item_id + '@' + it.version + '@' + (it.modified || '')) : symbolSpecSvg(it.definition);
const sel = (kind: any, id: string, e?: MouseEvent) => {
  const cur = S.selection.value;
  if (e && (e.ctrlKey || e.metaKey) && cur?.kind === kind) { const ids = cur.ids.includes(id) ? cur.ids.filter(x => x !== id) : [...cur.ids, id]; S.selection.value = ids.length ? { kind, ids } : null; }
  else S.selection.value = { kind, ids: [id] };
};
const isSel = (kind: string, id: string) => S.selection.value?.kind === kind && S.selection.value.ids.includes(id);
function useFocus(panel: string, ref: { current: HTMLInputElement | null }) { const f = S.sidebarFocus.value; useEffect(() => { if (f?.panel === panel && f.search) setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 30); }, [f?.n]); }
const StarBtn = ({ refId, label, icon, scope, type }: any) => { const on = S.isStarred(refId); return <button class={'starbtn ' + (on ? 'on' : '')} aria-pressed={on} aria-label={(on ? t('Unstar') : t('Star')) + ' ' + label} title={on ? t('Unstar') : t('Star — pin to the centre grid')} onClick={(e) => { e.stopPropagation(); on ? S.removeStar(refId) : S.addStar({ type, target_ref: refId, label, icon, scope }); }}><Icon name={on ? 'star' : 'star'} size={14} /></button>; };

// ================= History =================
export function HistoryPanel() {
  const [tab, setTab] = useState<'recent' | 'cp'>('recent'); const p = S.project.value;
  return <div class="panel">
    <div class="ptools"><Seg value={tab} options={[['recent', t('Recent projects')], ['cp', t('Checkpoints')]]} onChange={v => setTab(v as any)} /></div>
    {tab === 'recent' ? (S.recents.value.length ? <div class="list" role="listbox" aria-label={t('Recent projects')}>{S.recents.value.map(r =>
      <div role="option" tabIndex={0} aria-selected={isSel('recent', r.id)} class={'rrow ' + (isSel('recent', r.id) ? 'sel' : '')} onClick={(e: any) => sel('recent', r.id, e)} onDblClick={() => Pj.openRecent(r.id)} onKeyDown={(e: any) => e.key === 'Enter' && Pj.openRecent(r.id)}
        onContextMenu={(e: any) => openContextMenu(e, [{ label: t('Open'), icon: 'folder-open', onSelect: () => Pj.openRecent(r.id) }, { label: r.pinned ? t('Unpin') : t('Pin to keep'), icon: r.pinned ? 'pin-off' : 'pin', onSelect: () => Pj.togglePin(r.id) }, 'sep', { label: t('Remove from list'), icon: 'x', onSelect: () => Pj.removeRecent(r.id) }])}>
        <Thumb svg={r.thumb} alt="" class="rthumb" /><span class="rtxt"><b>{r.name}</b><small>{r.path}</small><small>{fmtDate(r.date)}</small></span>
        <button class={'iconbtn ' + (r.pinned ? 'on' : '')} aria-pressed={r.pinned} aria-label={r.pinned ? t('Unpin') : t('Pin')} title={r.pinned ? t('Pinned — kept beyond the last 20') : t('Pin to keep')} onClick={(e) => { e.stopPropagation(); Pj.togglePin(r.id); }}><Icon name={r.pinned ? 'pin' : 'pin-off'} size={14} /></button>
      </div>)}</div> : <Empty icon="history" title={t('No recent projects')}><p>{t('Projects you save or open appear here (last 20, pinned ones kept).')}</p><Btn icon="folder-open" label={t('Open project…')} onClick={() => runCmd('file.open')} /></Empty>)
      : !p ? <Empty icon="git-compare" title={t('No project open')}><p>{t('Checkpoints are the last saves of the open project.')}</p></Empty>
        : S.checkpoints.value.length ? <div class="list">{S.checkpoints.value.map(c => <div class={'rrow ' + (isSel('checkpoint', String(c.cid)) ? 'sel' : '')} tabIndex={0} onClick={() => S.selection.value = { kind: 'checkpoint', ids: [String(c.cid)] }}>
          <span class="vchip">v{c.version}</span><span class="rtxt"><b>{c.name}</b><small>{fmtDate(c.date)} · {c.sheets.length} {t('sheets')}</small></span>
          <button class="iconbtn" title={t('Compare with current')} aria-label={t('Compare')} onClick={(e) => { e.stopPropagation(); S.openModal('compare', { cp: c }); }}><Icon name="git-compare" size={14} /></button>
          <button class="iconbtn" title={t('Restore this version')} aria-label={t('Restore')} onClick={(e) => { e.stopPropagation(); Pj.restoreCheckpoint(c.cid); }}><Icon name="rotate-ccw" size={14} /></button>
          <button class="iconbtn" title={t('Delete checkpoint')} aria-label={t('Delete')} onClick={async (e) => { e.stopPropagation(); if ((await S.confirmDlg(t('Delete checkpoint'), t('Delete this saved version?'), [{ label: t('Cancel'), value: 'n' }, { label: t('Delete'), value: 'y', danger: true }])) === 'y') Pj.deleteCheckpoint(c.cid); }}><Icon name="trash-2" size={14} /></button>
        </div>)}</div> : <Empty icon="save" title={t('No checkpoints yet')}><p>{t('Every manual Save keeps a version here (last 20).')}</p></Empty>}
  </div>;
}

// ================= Component Library =================
const wsDomains = () => S.workspace.value === 'electrical' ? ['electrical'] : S.workspace.value === 'plc' ? ['hydraulic', 'pneumatic', 'electrical'] : ['hydraulic', 'pneumatic'];
export function ComponentsPanel() {
  const [q, setQ] = useState(''); const [tag, setTag] = useState(''); const [view, setView] = useState<'grid' | 'list'>('grid'); const [shut, setShut] = useState<Record<string, boolean>>({}); const inp = useRef<HTMLInputElement>(null);
  useFocus('components', inp);
  const all: StdItem[] = [...STD.slice(0, 16), ...S.stdValveItems.value, ...STD.slice(16)].filter(x => wsDomains().includes(x.domain));
  const fuse = useMemo(() => new Fuse(all, { keys: ['name', 'tags', 'category', 'cls'], threshold: 0.35, ignoreLocation: true }), [all.length, S.workspace.value]);
  let items = q.trim() ? fuse.search(q.trim()).map(r => r.item) : all; if (tag) items = items.filter(x => x.tags.includes(tag));
  const tagCount: Record<string, number> = {}; all.forEach(x => x.tags.forEach(tg => tagCount[tg] = (tagCount[tg] || 0) + 1));
  const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 9).map(x => x[0]);
  const cats: Record<string, StdItem[]> = {}; items.forEach(x => (cats[(x.domain === 'pneumatic' ? 'Pneumatic · ' : x.domain === 'electrical' ? '' : '') + x.category] ||= []).push(x));
  const proj = !!S.project.value;
  return <div class="panel">
    <div class="ptools"><div class="searchin"><Icon name="search" size={14} /><input ref={inp} value={q} placeholder={t('Search parts (Ctrl+F)')} aria-label={t('Search standard parts')} onInput={(e: any) => setQ(e.target.value)} />{q && <button class="iconbtn" aria-label={t('Clear search')} onClick={() => setQ('')}><Icon name="x" size={13} /></button>}</div>
      <Btn kind="tb" icon={view === 'grid' ? 'list' : 'layout-grid'} title={view === 'grid' ? t('List view') : t('Grid view')} onClick={() => setView(view === 'grid' ? 'list' : 'grid')} /></div>
    <div class="chips" role="group" aria-label={t('Filter by tag')}>{topTags.map(tg => <button class={'chip ' + (tag === tg ? 'on' : '')} aria-pressed={tag === tg} onClick={() => setTag(tag === tg ? '' : tg)}>{tg}</button>)}</div>
    <div class="scroll">{Object.keys(cats).length ? Object.entries(cats).map(([c, list]) => <div class="cat">
      <button class="cathead" aria-expanded={!shut[c]} onClick={() => setShut({ ...shut, [c]: !shut[c] })}><Icon name={shut[c] ? 'chevron-right' : 'chevron-down'} size={13} />{t(c)}<small>{list.length}</small></button>
      {!shut[c] && <div class={view === 'grid' ? 'pgrid' : 'plist'}>{list.map(it => <div class={'part ' + (isSel('std', it.id) ? 'sel' : '')} tabIndex={0} role="button" aria-label={it.name} draggable
        onDragStart={(e: any) => { e.dataTransfer.setData('application/x-hydra-part', JSON.stringify({ kind: 'std', id: it.id })); e.dataTransfer.setData('text/plain', it.name); }}
        onClick={(e: any) => sel('std', it.id, e)} onKeyDown={(e: any) => e.key === 'Enter' && sel('std', it.id)}
        onContextMenu={(e: any) => { sel('std', it.id); openContextMenu(e, [{ label: S.isStarred('std:' + it.id) ? t('Unstar') : t('Star'), icon: 'star', onSelect: () => starSelection() }, { label: t('Duplicate to Custom Library'), icon: 'copy', onSelect: () => duplicateStdToCustom(it.id) }]); }} title={`${it.name}\n${it.standard}`}>
        <Thumb svg={partSvg(it)} alt="" /><span class="pname">{it.name}{S.settings.value.showIds && <small class="pid">{it.id}</small>}</span>
        <StarBtn refId={'std:' + it.id} label={it.name} icon="component" scope={proj ? 'project' : 'global'} type="library_item" />
      </div>)}</div>}</div>) : <Empty icon="search" title={t('No parts match')}><p>{t('Try another word or clear the tag filter.')}</p></Empty>}</div>
    <div class="pfoot muted">{items.length} {t('parts')} · {S.workspace.value === 'electrical' ? 'IEC 60617' : S.workspace.value === 'plc' ? 'ISO 1219-1 · IEC 60617' : 'ISO 1219-1'} · {t('drag onto Starred to pin')}</div>
  </div>;
}

// ================= Custom Library =================
export function CustomPanel() {
  const [q, setQ] = useState(''); const [folder, setFolder] = useState('*'); const inp = useRef<HTMLInputElement>(null);
  useFocus('custom', inp);
  const lib = S.customLib.value;
  const fuse = useMemo(() => new Fuse(lib, { keys: ['name', 'tags', 'type', 'domain'], threshold: 0.35, ignoreLocation: true }), [lib]);
  let items = q.trim() ? fuse.search(q.trim()).map(r => r.item) : [...lib].sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
  if (folder === '') items = items.filter(x => !x.folder); else if (folder !== '*') items = items.filter(x => x.folder === folder);
  const folders = S.customFolders.value; const proj = !!S.project.value;
  const newFolder = async () => { const n = await S.promptDlg(t('New folder'), t('Folder name')); if (n && n.trim() && !folders.includes(n.trim())) { S.customFolders.value = [...folders, n.trim()]; kvSet('customFolders', S.customFolders.value); setFolder(n.trim()); } };
  const menuFor = (it: any): MenuItem[] => [{ label: t('Edit in') + ' ' + (it.type === 'valve' ? 'Valve Creator' : 'Symbol Sketcher'), icon: 'pencil', onSelect: () => openTool(it.type === 'valve' ? 'valve' : 'symbol', it) }, { label: t('Rename…'), icon: 'pencil-line', onSelect: () => S.openModal('rename') },
    { header: t('Move to folder') }, { label: t('(no folder)'), checked: !it.folder, onSelect: () => moveTo(null) }, ...folders.map(f => ({ label: f, icon: 'folder', checked: it.folder === f, onSelect: () => moveTo(f) })), 'sep',
    { label: S.isStarred('lib:' + it.item_id) ? t('Unstar') : t('Star'), icon: 'star', onSelect: () => starSelection() }, { label: t('Export .hydralib'), icon: 'download', onSelect: () => exportLibrary(S.selection.value!.ids.map(libById).filter(Boolean), it.name.replace(/\W+/g, '_')) }, 'sep', { label: t('Delete…'), icon: 'trash-2', danger: true, onSelect: () => deleteSelection() }];
  const moveTo = (f: string | null) => { const ids = S.selection.value?.ids || []; const arr = S.libLoad().map(x => ids.includes(x.item_id) ? { ...x, folder: f || undefined } : x); S.libWrite(arr); };
  return <div class="panel">
    <div class="ptools"><Btn kind="primary" icon="git-fork" label={t('+ New Valve')} onClick={() => runCmd('tool.valve')} /><Btn kind="primary" icon="pen-tool" label={t('+ New Symbol')} onClick={() => runCmd('tool.symbol')} /><div class="grow" />
      <Btn kind="tb" icon="upload" title={t('Import .hydralib / .hydsym')} onClick={async () => importLibraryFiles(await pickFile('.hydralib,.hydsym,.json', true))} /><Btn kind="tb" icon="download" title={t('Export library (.hydralib)')} onClick={() => exportLibrary(S.selection.value?.kind === 'custom' ? S.selection.value.ids.map(libById).filter(Boolean) : lib)} /></div>
    <div class="ptools"><div class="searchin"><Icon name="search" size={14} /><input ref={inp} value={q} placeholder={t('Search custom parts')} aria-label={t('Search custom parts')} onInput={(e: any) => setQ(e.target.value)} /></div></div>
    <div class="chips"><button class={'chip ' + (folder === '*' ? 'on' : '')} onClick={() => setFolder('*')}>{t('All')} {lib.length}</button><button class={'chip ' + (folder === '' ? 'on' : '')} onClick={() => setFolder('')}>{t('Unfiled')}</button>{folders.map(f => <button class={'chip ' + (folder === f ? 'on' : '')} onClick={() => setFolder(f)} onContextMenu={(e: any) => openContextMenu(e, [{ label: t('Delete folder (items stay)'), icon: 'trash-2', onSelect: () => { S.customFolders.value = folders.filter(x => x !== f); kvSet('customFolders', S.customFolders.value); S.libWrite(S.libLoad().map(x => x.folder === f ? { ...x, folder: undefined } : x)); setFolder('*'); } }])}><Icon name="folder" size={12} />{f}</button>)}<button class="chip" aria-label={t('New folder')} onClick={newFolder}><Icon name="folder-plus" size={12} /></button></div>
    <div class="scroll">{items.length ? <div class="list" role="listbox" aria-multiselectable="true" aria-label={t('Custom Library')}>{items.map(it =>
      <div role="option" aria-selected={isSel('custom', it.item_id)} tabIndex={0} class={'crow ' + (isSel('custom', it.item_id) ? 'sel' : '')} draggable onDragStart={(e: any) => e.dataTransfer.setData('application/x-hydra-part', JSON.stringify({ kind: 'lib', id: it.item_id }))}
        onClick={(e: any) => sel('custom', it.item_id, e)} onDblClick={() => openTool(it.type === 'valve' ? 'valve' : 'symbol', it)} onKeyDown={(e: any) => { if (e.key === 'Enter') openTool(it.type === 'valve' ? 'valve' : 'symbol', it); }}
        onContextMenu={(e: any) => { if (!isSel('custom', it.item_id)) sel('custom', it.item_id); openContextMenu(e, menuFor(it)); }}>
        <Thumb svg={libSvg(it)} alt="" /><span class="rtxt"><b>{it.name || t('(unnamed)')}</b><small>{it.type === 'valve' ? t('Valve') : t('Symbol')} · {it.domain} · v{it.version}{it.folder ? ' · ' + it.folder : ''}{S.settings.value.showIds ? ' · ' + it.item_id : ''}</small></span>
        <Badge kind={it.status === 'valid' ? 'ok' : 'warn'}>{it.status === 'valid' ? t('Valid') : t('Needs review')}</Badge>
        <StarBtn refId={'lib:' + it.item_id} label={it.name} icon={it.type === 'valve' ? 'git-fork' : 'pen-tool'} scope={proj ? 'project' : 'global'} type="library_item" />
      </div>)}</div> : <Empty icon="boxes" title={lib.length ? t('Nothing in this view') : t('Your Custom Library is empty')}><p>{t('Build a valve or symbol, or duplicate a standard part. Saved items appear here instantly.')}</p></Empty>}</div>
  </div>;
}

// ================= Machine Circuits =================
export function CircuitsPanel() {
  const p = S.project.value; const [open, setOpen] = useState<Record<string, boolean>>({}); const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null); const tree = useRef<HTMLDivElement>(null);
  if (!p) return <div class="panel"><Empty icon="layers" title={t('No project open')}><p>{t('The machine tree shows assemblies, sheets and programs of the open project.')}</p><div class="row-c"><Btn kind="primary" icon="file-plus" label={t('New Project…')} onClick={() => runCmd('file.new')} /><Btn icon="folder-open" label={t('Open…')} onClick={() => runCmd('file.open')} /></div></Empty></div>;
  const cur = S.selection.value?.kind === 'node' ? S.selection.value.ids : [];
  const target = cur[0] || p.rootId;
  const visible: string[] = []; const walk = (id: string) => { visible.push(id); if (open[id] !== false) p.nodes[id].children.forEach(walk); }; walk(p.rootId);
  const nodeMenu = (id: string): MenuItem[] => { const n = p.nodes[id]; const leaf = n.type === 'sheet' || n.type === 'program'; return [
    ...(leaf ? [{ label: t('Open'), icon: 'external-link', onSelect: () => openNode(id) } as MenuItem, 'sep' as const] : []),
    { label: t('New hydraulic sheet'), icon: 'droplets', onSelect: () => pick(S.addNode('sheet', id, 'hydraulic')) }, { label: t('New pneumatic sheet'), icon: 'droplets', onSelect: () => pick(S.addNode('sheet', id, 'pneumatic')) }, { label: t('New electric sheet'), icon: 'zap', onSelect: () => pick(S.addNode('sheet', id, 'electric')) }, { label: t('New assembly'), icon: 'folder-plus', onSelect: () => pick(S.addNode('assembly', id)) }, { label: t('New program'), icon: 'binary', onSelect: () => pick(S.addNode('program', id)) }, 'sep',
    { label: t('Rename'), icon: 'pencil-line', keys: 'F2', onSelect: () => S.openModal('rename') }, { label: t('Duplicate'), icon: 'copy', disabled: !n.parent || n.type === 'programs', onSelect: () => { const m = S.duplicateNodes(cur.length ? cur : [id]); if (m?.length) S.selection.value = { kind: 'node', ids: m }; } },
    { label: t('Copy'), icon: 'copy', keys: 'Ctrl+C', disabled: !n.parent || n.type === 'programs', onSelect: () => runCmd('edit.copy') }, { label: t('Paste'), icon: 'clipboard-paste', keys: 'Ctrl+V', disabled: !S.hasClip.value, onSelect: () => runCmd('edit.paste') },
    { label: t('Delete'), icon: 'trash-2', keys: 'Del', danger: true, disabled: !n.parent || n.type === 'programs', onSelect: () => deleteSelection() }, 'sep',
    { label: S.isStarred('node:' + id) ? t('Unstar') : t('Star'), icon: 'star', disabled: !leaf, onSelect: () => starSelection() }, { label: t('Properties'), icon: 'info', onSelect: () => S.openModal(id === p.rootId ? 'projectProps' : 'nodeProps') }];
  };
  const pick = (id: string | null) => { if (id) { S.selection.value = { kind: 'node', ids: [id] }; const par = p.nodes[id]?.parent; if (par) setOpen(o => ({ ...o, [par]: true })); } };
  const key = (e: KeyboardEvent) => {
    const i = visible.indexOf(cur[0]); const id = cur[0]; if (!id) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); const n = visible[Math.min(visible.length - 1, i + 1)]; S.selection.value = { kind: 'node', ids: [n] }; }
    if (e.key === 'ArrowUp') { e.preventDefault(); const n = visible[Math.max(0, i - 1)]; S.selection.value = { kind: 'node', ids: [n] }; }
    if (e.key === 'ArrowRight') { e.preventDefault(); setOpen({ ...open, [id]: true }); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); if (open[id] !== false && p.nodes[id].children.length) setOpen({ ...open, [id]: false }); else if (p.nodes[id].parent) S.selection.value = { kind: 'node', ids: [p.nodes[id].parent!] }; }
    if (e.key === 'Enter') { e.preventDefault(); openNode(id); }
    if (e.key === 'F2') { e.preventDefault(); S.openModal('rename'); }
  };
  useEffect(() => { const el = tree.current?.querySelector<HTMLElement>('.tn.sel'); el?.scrollIntoView({ block: 'nearest' }); if (el && (document.activeElement === document.body || tree.current?.contains(document.activeElement))) el.focus({ preventScroll: true }); }, [cur[0]]);
  return <div class="panel">
    <div class="ptools"><Btn kind="tb" icon="plus" label={t('Sheet')} onClick={(e: any) => setAddAnchor(e.currentTarget)} /><Btn kind="tb" icon="folder-plus" label={t('Assembly')} onClick={() => pick(S.addNode('assembly', target))} /><Btn kind="tb" icon="binary" label={t('Program')} onClick={() => pick(S.addNode('program', target))} /><div class="grow" /><Btn kind="tb" icon="star" title={t('Star selected (Ctrl+D)')} onClick={() => starSelection()} /></div>
    <div class="scroll tree" role="tree" aria-label={t('Machine Circuits')} aria-multiselectable="true" ref={tree} onKeyDown={key as any} tabIndex={cur.length ? -1 : 0}><TreeNode id={p.rootId} depth={0} x={{ p, open, setOpen, cur, nodeMenu }} /></div>
    <div class="pfoot muted">{Object.values(p.nodes).filter(n => n.type === 'sheet').length} {t('sheets')} · {Object.values(p.nodes).filter(n => n.type === 'program').length} {t('programs')} · {t('right-click for actions')}</div>
    {addAnchor && <Popover anchor={addAnchor} onClose={() => setAddAnchor(null)}><MenuList onDone={() => setAddAnchor(null)} items={[{ label: t('Hydraulic sheet'), icon: 'droplets', onSelect: () => pick(S.addNode('sheet', target, 'hydraulic')) }, { label: t('Pneumatic sheet'), icon: 'droplets', onSelect: () => pick(S.addNode('sheet', target, 'pneumatic')) }, { label: t('Electric sheet'), icon: 'zap', onSelect: () => pick(S.addNode('sheet', target, 'electric')) }]} /></Popover>}
  </div>;
}

function TreeNode({ id, depth, x }: { id: string; depth: number; x: any }) {
  const { p, open, setOpen, cur, nodeMenu } = x;
    const n = p.nodes[id]; if (!n) return null; const kids = n.children; const isOpen = open[id] !== false; const s = cur.includes(id);
    const ic = n.type === 'machine' ? 'boxes' : n.type === 'assembly' ? 'folder' : n.type === 'programs' ? 'folder' : n.type === 'program' ? 'binary' : n.sheetType === 'electric' ? 'zap' : 'droplets';
    return <>
      <div role="treeitem" aria-level={depth + 1} aria-selected={s} aria-expanded={kids.length ? isOpen : undefined} tabIndex={s ? 0 : -1} class={'tn ' + (s ? 'sel' : '')} style={{ paddingLeft: 6 + depth * 14 }}
        onClick={(e: any) => sel('node', id, e)} onDblClick={() => n.type === 'sheet' || n.type === 'program' ? openNode(id) : setOpen({ ...open, [id]: !isOpen })} onContextMenu={(e: any) => { if (!cur.includes(id)) sel('node', id); openContextMenu(e, nodeMenu(id)); }}>
        <button class="twisty" tabIndex={-1} aria-hidden="true" style={{ visibility: kids.length ? 'visible' : 'hidden' }} onClick={(e) => { e.stopPropagation(); setOpen({ ...open, [id]: !isOpen }); }}><Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} /></button>
        <Icon name={ic} size={14} class={'t-' + (n.sheetType || n.type)} /><span class="tname">{n.name}</span>
        {S.isStarred('node:' + id) && <Icon name="star" size={11} class="starmark" />}
        <small class="tmeta">{n.type === 'sheet' ? (n.size || '') : n.type === 'program' ? (n.language || 'ST') : kids.length || ''}{S.settings.value.showIds ? ' · ' + id : ''}</small>
      </div>
      {isOpen && kids.map(c => <TreeNode key={c} id={c} depth={depth + 1} x={x} />)}</>;
}

// ================= Samples =================
export function SamplesPanel() {
  const [all, setAll] = useState(false);
  const ws = S.workspace.value; const match = (d: string) => ws === 'electrical' ? d === 'electrical' : ws === 'plc' ? d === 'plc' : d === 'hydraulic' || d === 'pneumatic';
  const list = all ? SAMPLES : SAMPLES.filter(s => match(s.domain));
  const cats: Record<string, typeof SAMPLES> = {}; list.forEach(s => (cats[s.category] ||= []).push(s));
  return <div class="panel">
    <div class="ptools"><Seg value={all ? 'all' : 'ws'} options={[['ws', t('This workspace')], ['all', t('All samples')]]} onChange={v => setAll(v === 'all')} /></div>
    <div class="scroll"><div class="cat"><div class="cathead static">{t('Whole machines')}<small>{machineList().length}</small></div>{machineList().map(m =>
      <div class="srow" tabIndex={0} onDblClick={() => openMachine(m.id)} onKeyDown={(e: any) => e.key === 'Enter' && openMachine(m.id)}>
        <span class="rtxt"><b>{m.name}</b><small>{m.description}</small></span><div class="row-end"><Badge kind="info">{t('machine')}</Badge><Btn kind="tb" icon="copy" label={t('Open as copy')} onClick={(e: any) => { e.stopPropagation(); openMachine(m.id); }} /></div>
      </div>)}</div>
      {Object.entries(cats).map(([c, l]) => <div class="cat"><div class="cathead static">{t(c)}<small>{l.length}</small></div>{l.map(s =>
      <div class={'srow ' + (isSel('sample', s.id) ? 'sel' : '')} tabIndex={0} onClick={() => sel('sample', s.id)} onDblClick={() => openSampleCopy(s.id)} onKeyDown={(e: any) => e.key === 'Enter' && openSampleCopy(s.id)}>
        <span class="rtxt"><b>{s.name}</b><small>{s.description}</small></span><div class="row-end"><Badge kind="info">{s.domain}</Badge><Btn kind="tb" icon="copy" label={t('Open as copy')} onClick={(e: any) => { e.stopPropagation(); openSampleCopy(s.id); }} /></div>
      </div>)}</div>)}{!list.length && <Empty icon="library" title={t('No samples for this workspace')}><Btn label={t('Show all samples')} onClick={() => setAll(true)} /></Empty>}</div>
  </div>;
}

// ================= Launchers =================
export function LaunchPanel() {
  const ws = S.workspace.value;
  const L = (id: string, icon: string, title: string, sub: string, badge: string, hot: boolean) => <button class={'launch ' + (hot ? 'hot' : '')} onClick={() => runCmd(id)}><Icon name={icon} size={18} /><span><b>{t(title)}</b><small>{t(sub)}</small></span><span class="lbadge">{badge}</span></button>;
  return <div class="panel launchp">
    {L('launch.hydraulic', 'droplets', 'Hydraulic / Pneumatic Designer', 'Opens as a tab', t('ready'), ws === 'hydraulic')}
    {L('launch.electric', 'zap', 'Electric Circuit Designer', 'Opens as a tab', t('ready'), ws === 'electrical')}
    {L('launch.logic', 'binary', 'Logic Coder', 'Opens as a tab', t('ready'), ws === 'plc')}
    <div class="lsep">{t('Custom part tools')}</div>
    {L('tool.valve', 'git-fork', 'Valve Creator', 'Pop-out window', 'v1.0', false)}
    {L('tool.symbol', 'pen-tool', 'Symbol Sketcher', 'Pop-out window', 'v1.0', false)}
  </div>;
}

// ================= Starred grid =================
export function StarredPanel() {
  const grid = useRef<HTMLDivElement>(null); const stars = S.allStars.value; const p = S.project.value; const [over, setOver] = useState(false);
  useEffect(() => { if (!grid.current) return; const s = Sortable.create(grid.current, { animation: S.settings.value.reduceMotion ? 0 : 150, draggable: '.tile', onEnd: () => S.reorderStars([...grid.current!.querySelectorAll<HTMLElement>('.tile')].map(e => e.dataset.star!)) }); return () => s.destroy(); }, [stars.length, S.settings.value.reduceMotion]);
  const tileMenu = (st: S.Star, r: any): MenuItem[] => [{ label: t('Open'), icon: 'external-link', disabled: !r.ok, onSelect: r.open }, { label: t('Rename label…'), icon: 'pencil-line', onSelect: async () => { const n = await S.promptDlg(t('Rename tile'), t('Label'), st.label); if (n && n.trim()) S.updateStar(st.star_id, { label: n.trim(), custom: true } as any); } }, { label: t('Move to front'), icon: 'arrow-up', onSelect: () => S.reorderStars([st.star_id, ...stars.filter(x => x.star_id !== st.star_id).map(x => x.star_id)]) }, 'sep', { label: t('Unstar'), icon: 'star-off', onSelect: () => S.removeStar(st.target_ref) }];
  const drop = (e: DragEvent) => {
    e.preventDefault(); setOver(false); const raw = e.dataTransfer?.getData('application/x-hydra-part'); if (!raw) return; const d = JSON.parse(raw);
    if (d.kind === 'std') { const it: any = stdById(d.id); if (it) S.addStar({ type: 'library_item', target_ref: 'std:' + d.id, label: it.name, icon: 'component', scope: p ? 'project' : 'global' }); }
    if (d.kind === 'lib') { const it = libById(d.id); if (it) S.addStar({ type: 'library_item', target_ref: 'lib:' + d.id, label: it.name, icon: it.type === 'valve' ? 'git-fork' : 'pen-tool', scope: p ? 'project' : 'global' }); }
  };
  const tileIcon = (st: S.Star) => { const ref = st.target_ref; if (ref.startsWith('std:')) { const it = stdById(ref.slice(4)); if (it) return <Thumb svg={partSvg(it)} alt="" class="tthumb" />; } if (ref.startsWith('lib:')) { const it = libById(ref.slice(4)); if (it) return <Thumb svg={libSvg(it)} alt="" class="tthumb" />; } return <Icon name={st.icon} size={26} />; };
  const sheets = p ? Object.values(p.nodes).filter(n => n.type === 'sheet').length : 0;
  return <div class={'panel starred size-' + S.settings.value.tileSize}>
    {S.docs.value.length > 0 && <ProjectChips />}
    <div class="hero">{p ? <>
      <div class="htxt"><small>{t('Open project')}{S.readOnly.value ? ' · ' + t('read-only') : ''}</small><h1>{p.manifest.name}{S.dirty.value && <span class="dirtydot">●</span>}</h1><p>{sheets} {t('sheets')} · {Object.values(p.nodes).filter(n => n.type === 'program').length} {t('programs')} · {p.manifest.unitSystem} · {p.manifest.version ? `v${p.manifest.version} · ${t('saved')} ${fmtDate(p.manifest.modified)}` : t('not saved yet')}</p></div>
      <div class="row-end"><Btn kind="primary" icon="droplets" label={t('Open Designer')} title={t('Open the last sheet you worked on (or the first one)')} onClick={() => openDesignerHere(p)} /><Btn icon="save" label={t('Save')} onClick={() => runCmd('file.save')} /><Btn icon={S.readOnly.value ? 'eye' : 'pencil'} pressed={S.readOnly.value} label={t('Read-only')} title={t('View and simulate without changing the project')} onClick={() => S.setReadOnly(!S.readOnly.value)} /><Btn icon="info" label={t('Properties')} onClick={() => runCmd('file.props')} /><Btn icon="x-square" label={t('Close')} onClick={() => runCmd('file.close')} /></div></> : <>
      <div class="htxt"><small>{t('Welcome to HYDRA')}</small><h1>{t('Start a machine')}</h1><p>{t('Create a project, open a .hydra file, or start from a sample circuit.')}</p></div>
      <div class="row-end"><Btn kind="primary" icon="file-plus" label={t('New Project…')} onClick={() => runCmd('file.new')} /><Btn icon="folder-open" label={t('Open…')} onClick={() => runCmd('file.open')} />{S.recents.value.slice(0, 2).map(r => <Btn icon="history" label={r.name} title={t('Open') + ' ' + r.path} onClick={() => Pj.openRecent(r.id)} />)}</div></>}
    </div>
    {p && <SheetCards p={p} />}
    <div class={'glass ' + (over ? 'over' : '')} onDragOver={(e: any) => { if ([...e.dataTransfer.types].includes('application/x-hydra-part')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)} onDrop={drop as any}>
      <div class="ghead"><b>{t('Starred')}</b><span class="muted">{stars.length} / {S.STAR_LIMIT} · {t('drag to reorder, right-click for options')}</span></div>
      {stars.length ? <div class="tiles" ref={grid} role="list">{stars.map(st => { const r = resolveStar(st); return <div class={'tile ' + (r.ok ? '' : 'broken')} data-star={st.star_id} role="listitem" tabIndex={0} title={r.ok ? st.label : t('Target no longer exists')}
        onClick={() => r.ok ? r.open() : null} onKeyDown={(e: any) => { if (e.key === 'Enter' && r.ok) r.open(); if (e.key === 'Delete') S.removeStar(st.target_ref); }} onContextMenu={(e: any) => openContextMenu(e, tileMenu(st, r))}>
        <button class="tstar" aria-label={t('Unstar') + ' ' + st.label} title={t('Unstar')} onClick={(e) => { e.stopPropagation(); S.removeStar(st.target_ref); }}><Icon name="star" size={13} /></button>
        <span class="tico">{tileIcon(st)}</span><span class="tlabel">{starLabel(st)}</span><small class="tscope">{st.scope === 'project' ? t('project') : t(st.type === 'command' || st.type === 'tool' ? 'tool' : st.type.replace('_', ' '))}</small>
        {!r.ok && <div class="tbroken"><Icon name="alert" size={13} />{t('Missing')}<button class="link" onClick={(e) => { e.stopPropagation(); S.removeStar(st.target_ref); }}>{t('Remove')}</button><button class="link" onClick={(e) => { e.stopPropagation(); S.openModal('relink', { star: st }); }}>{t('Relink')}</button></div>}
      </div>; })}</div>
        : <div class="tiles ghosted">{S.DEFAULT_STARS().map(st => <div class="tile dim"><span class="tico"><Icon name={st.icon} size={26} /></span><span class="tlabel">{t(st.label)}</span></div>)}
          <div class="emptymsg"><b>{t('Star any tool or file to pin it here')}</b><Btn kind="primary" icon="rotate-ccw" label={t('Reset defaults')} onClick={() => { S.globalStars.value = S.DEFAULT_STARS(); S.saveGlobalStars(); }} /></div></div>}
    </div>
  </div>;
}

// ----- open projects (one chip each) -----
function ProjectChips() {
  return <div class="pchips" role="tablist" aria-label={t('Open projects')}>{S.docs.value.map(d => { const p = S.docProject(d.key); if (!p) return null; const on = d.key === S.activeDoc.value; const dirty = S.docDirty(d.key);
    return <div class={'pchip ' + (on ? 'on' : '')} role="tab" aria-selected={on}><button onClick={() => { S.switchDoc(d.key); S.activeTab.value = 'home'; }} title={p.manifest.location || t('not saved yet')}><Icon name={d.sample ? 'library' : 'boxes'} size={13} />{p.manifest.name}{dirty && <span class="dirtydot sm">●</span>}{(on ? S.readOnly.value : d.readOnly) && <Icon name="eye" size={11} />}</button>
      <button class="x" aria-label={t('Close project') + ' ' + p.manifest.name} title={t('Close project')} onClick={() => Pj.closeDoc(d.key)}><Icon name="x" size={11} /></button></div>; })}
    <Btn kind="tb" icon="plus" title={t('New project')} onClick={() => runCmd('file.new')} /><Btn kind="tb" icon="folder-open" title={t('Open project')} onClick={() => runCmd('file.open')} /></div>;
}
async function openDesignerHere(p: S.Project) { const { kvGet } = await import('../db'); const last = await kvGet<string | null>('lastSheet.' + p.manifest.projectId, null); const id = last && p.nodes[last] ? last : S.firstFluidSheet(p); if (id) S.openSheetTab(id); else { const nid = S.addNode('sheet', null, 'hydraulic'); if (nid) S.openSheetTab(nid); } }
// ----- the project's sheets as cards: a single click opens the sheet in its designer -----
function SheetCards({ p }: { p: S.Project }) {
  const list = Object.values(p.nodes).filter(n => n.type === 'sheet'); const [all, setAll] = useState(false);
  const menu = (n: S.NodeT): MenuItem[] => [{ label: t('Open'), icon: 'external-link', onSelect: () => S.openSheetTab(n.id) }, { label: t('Rename'), icon: 'pencil-line', onSelect: () => { S.selection.value = { kind: 'node', ids: [n.id] }; S.openModal('rename'); } }, { label: t('Duplicate'), icon: 'copy', onSelect: () => S.duplicateNodes([n.id]) },
    { label: S.isStarred('node:' + n.id) ? t('Unstar') : t('Star'), icon: 'star', onSelect: () => { S.selection.value = { kind: 'node', ids: [n.id] }; starSelection(); } }, 'sep', { label: t('Delete'), icon: 'trash-2', danger: true, onSelect: () => { S.selection.value = { kind: 'node', ids: [n.id] }; deleteSelection(); } }];
  const shown = all ? list : list.slice(0, 12);
  return <div class="sheetcards"><div class="ghead"><b>{t('Sheets')}</b><span class="muted">{list.length} · {t('click to open')}</span><div class="grow" />
    <Btn kind="tb" icon="plus" label={t('Hydraulic')} onClick={() => { const id = S.addNode('sheet', null, 'hydraulic'); if (id) S.openSheetTab(id); }} /><Btn kind="tb" icon="plus" label={t('Pneumatic')} onClick={() => { const id = S.addNode('sheet', null, 'pneumatic'); if (id) S.openSheetTab(id); }} /></div>
    {list.length ? <div class="scards">{shown.map(n => { const c = p.circuits[n.id]; const el = n.sheetType === 'electric'; const parent = n.parent ? p.nodes[n.parent]?.name : '';
      const ports = (c?.components || []).filter((x: any) => x.ref === 'sys:conn').length, insts = (c?.components || []).filter((x: any) => /^asmx?:/.test(x.ref)).length;
      return <button class={'scard ' + (el ? 'el' : '')} title={t('Open') + ' ' + n.name + (el ? ' — ' + t('Electric Designer') : '')} onClick={() => S.openSheetTab(n.id)} onContextMenu={(e: any) => openContextMenu(e, menu(n))}>
        <span class="sthumb">{el && !(c?.components || []).length ? <Icon name="zap" size={26} /> : <span dangerouslySetInnerHTML={{ __html: sheetThumb(c) }} />}</span>
        <span class="smeta"><b>{n.name}{S.isStarred('node:' + n.id) && <Icon name="star" size={11} class="starmark" />}</b><small>{n.sheetType} · {c?.mode === 'infinite' ? t('infinite') : (c?.size || n.size || 'A3')} · {(c?.components || []).length} {t('parts')}{insts ? ` · ${insts} ${t('assemblies')}` : ''}{ports ? ` · ${ports} ${t('ports')}` : ''}</small>{parent && <small class="muted">{parent}</small>}</span></button>; })}
      {list.length > 12 && !all && <button class="scard more" onClick={() => setAll(true)}>+{list.length - 12} {t('more')}</button>}</div>
      : <div class="muted pad">{t('No sheets yet — add a hydraulic or pneumatic sheet.')}</div>}</div>;
}

// ================= Inspector =================
const Row = ({ k, v }: { k: string; v: any }) => <div class="kv"><span>{k}</span><b>{v}</b></div>;
function PortTable({ ports }: { ports: any[] }) { if (!ports?.length) return null; return <table class="ptab"><thead><tr><th>{t('Port')}</th><th>{t('Role')}</th><th>{t('Dir')}</th><th>{t('Domain')}</th></tr></thead><tbody>{ports.map(p => <tr><td><b>{p.name}</b></td><td>{p.role}</td><td>{p.dir || p.direction || p.side || ''}</td><td>{p.domain || ''}</td></tr>)}</tbody></table>; }
function SpecFields({ specs }: { specs: any[] }) {
  const sys = S.prefs.value.unitSystem;
  return <><div class="fgrid">{specs.filter(s => !(s.qty === 'none' || typeof s.value !== 'number')).map(s => <NumField label={t(s.label)} qty={s.qty} value={['rotation', 'percent', 'voltage', 'current', 'power'].includes(s.qty) ? s.value as number : convert(s.qty, s.unit, unitFor(sys, s.qty), s.value as number)} unit={['rotation', 'percent', 'voltage', 'current', 'power'].includes(s.qty) ? s.unit : unitFor(sys, s.qty)} readOnly />)}</div>
    {specs.filter(s => s.qty === 'none' || typeof s.value !== 'number').map(s => <Row k={t(s.label)} v={String(s.value)} />)}</>;
}
export function InspectorPanel() {
  const s = S.selection.value; const p = S.project.value;
  let body: any;
  if (!s || !s.ids.length) body = <Empty icon="info" title={t('Nothing selected')}><p>{t('Select a part, custom item, sheet, sample or recent project to see its details here.')}</p></Empty>;
  else if (s.kind === 'std') body = <StdInspector it={stdById(s.ids[0]) as any} />;
  else if (s.kind === 'custom') body = s.ids.length > 1 ? <MultiCustom ids={s.ids} /> : <CustomInspector it={libById(s.ids[0])} />;
  else if (s.kind === 'sample') body = <SampleInspector sm={SAMPLES.find(x => x.id === s.ids[0])} />;
  else if (s.kind === 'node' && p) body = s.ids.length > 1 ? <MultiNode ids={s.ids} /> : <NodeInspector id={s.ids[0]} />;
  else if (s.kind === 'recent') { const r = S.recents.value.find(x => x.id === s.ids[0]); body = r ? <div class="insp"><Thumb svg={r.thumb} alt="" class="big" /><h3>{r.name}</h3><Row k={t('File')} v={r.path} /><Row k={t('Last opened')} v={fmtDate(r.date)} /><Row k={t('Pinned')} v={r.pinned ? t('Yes') : t('No')} /><Row k={t('Reopen from')} v={r.handle ? t('original file') : t('copy kept at last save')} /><div class="row-end wrap"><Btn kind="primary" icon="folder-open" label={t('Open')} onClick={() => Pj.openRecent(r.id)} /><Btn icon={r.pinned ? 'pin-off' : 'pin'} label={r.pinned ? t('Unpin') : t('Pin')} onClick={() => Pj.togglePin(r.id)} /><Btn icon="x" label={t('Remove')} onClick={() => Pj.removeRecent(r.id)} /></div></div> : null; }
  else if (s.kind === 'checkpoint') { const c = S.checkpoints.value.find(x => String(x.cid) === s.ids[0]); body = c ? <div class="insp"><h3>{c.name}</h3><Row k={t('Version')} v={'v' + c.version} /><Row k={t('Saved')} v={fmtDate(c.date)} /><Row k={t('Sheets')} v={c.sheets.join(', ') || '—'} /><div class="row-end wrap"><Btn kind="primary" icon="rotate-ccw" label={t('Restore')} onClick={() => Pj.restoreCheckpoint(c.cid)} /><Btn icon="git-compare" label={t('Compare')} onClick={() => S.openModal('compare', { cp: c })} /></div></div> : null; }
  return <div class="panel"><div class="scroll">{body || <Empty icon="info" title={t('Nothing selected')} />}</div></div>;
}
function StdInspector({ it }: { it: StdItem | undefined }) {
  if (!it) return <Empty icon="alert" title={t('Part not found')} />;
  const proj = !!S.project.value; const ref = 'std:' + it.id; const st = S.isStarred(ref);
  const bore = it.specs.find(x => x.key === 'bore')?.value as number, rod = it.specs.find(x => x.key === 'rod')?.value as number;
  return <div class="insp">
    <div class="bigthumb"><Thumb svg={partSvg(it)} alt={it.name} /></div>
    <h3>{it.name}</h3><div class="muted">{it.standard} · {t(it.category)} · <Badge kind="info">{t('Read-only')}</Badge></div>
    <div class="row-end wrap"><Btn kind="primary" icon="copy" label={t('Duplicate to Custom Library')} onClick={() => duplicateStdToCustom(it.id)} /><Btn icon="star" pressed={st} label={st ? t('Starred') : t('Star')} onClick={() => st ? S.removeStar(ref) : S.addStar({ type: 'library_item', target_ref: ref, label: it.name, icon: 'component', scope: proj ? 'project' : 'global' })} /></div>
    {it.note && <p class="note-i">{t(it.note)}</p>}
    <h4>{t('Specifications')}</h4><SpecFields specs={it.specs} />
    {bore && rod ? <div class="derived"><Row k={t('Piston area')} v={`${round(Math.PI * bore * bore / 400, 4)} cm²`} /><Row k={t('Annulus area')} v={`${round(Math.PI * (bore * bore - rod * rod) / 400, 4)} cm²`} /><Row k={t('Area ratio φ')} v={`${round(bore * bore / (bore * bore - rod * rod), 3)} : 1`} /></div> : null}
    {it.valve && <><h4>{t('Valve')}</h4><Row k={t('Matrix')} v={it.valve.matrix} /><Row k={t('Classification')} v={it.valve.classification} /><Row k={t('Positions')} v={it.valve.boxes.length} /></>}
    {it.ports.length ? <><h4>{t('Ports')}</h4><PortTable ports={it.ports} /></> : null}
    <h4>{t('Tags')}</h4><div class="chips">{it.tags.map(x => <span class="chip static">{x}</span>)}</div>
  </div>;
}
function CustomInspector({ it }: { it: any }) {
  if (!it) return <Empty icon="alert" title={t('Item not found')} />;
  const ref = 'lib:' + it.item_id; const st = S.isStarred(ref); const proj = !!S.project.value;
  const checks = it.type === 'valve' ? valveChecks(it.definition) : [];
  return <div class="insp">
    <div class="bigthumb"><Thumb svg={libSvg(it)} alt={it.name} /></div>
    <TextField label={t('Name')} value={it.name} required maxLength={80} onCommit={v => S.libUpdate(it.item_id, { name: v })} />
    <div class="muted">{it.type === 'valve' ? t('Valve') : t('Symbol')} · {it.domain} · v{it.version} · <Badge kind={it.status === 'valid' ? 'ok' : 'warn'}>{it.status === 'valid' ? t('Valid') : t('Needs review')}</Badge></div>
    <div class="row-end wrap"><Btn kind="primary" icon="pencil" label={t('Edit geometry')} onClick={() => openTool(it.type === 'valve' ? 'valve' : 'symbol', it)} /><Btn icon="star" pressed={st} label={st ? t('Starred') : t('Star')} onClick={() => st ? S.removeStar(ref) : S.addStar({ type: 'library_item', target_ref: ref, label: it.name, icon: it.type === 'valve' ? 'git-fork' : 'pen-tool', scope: proj ? 'project' : 'global' })} /><Btn icon="download" label=".hydralib" onClick={() => exportLibrary([it], it.name.replace(/\W+/g, '_'))} /><Btn icon="trash-2" kind="danger" label={t('Delete')} onClick={() => deleteSelection()} /></div>
    <div class="fgrid">
      <TextField label={t('Author')} value={it.author || ''} onCommit={v => S.libUpdate(it.item_id, { author: v })} />
      <label class="fld"><span class="lbl">{t('Folder')}</span><select class="in" value={it.folder || ''} onChange={(e: any) => S.libUpdate(it.item_id, { folder: e.target.value || undefined }, false)}><option value="">{t('(no folder)')}</option>{S.customFolders.value.map(f => <option>{f}</option>)}</select></label>
      <TextField label={t('Tags (comma separated)')} value={(it.tags || []).join(', ')} onCommit={v => S.libUpdate(it.item_id, { tags: v.split(',').map(x => x.trim()).filter(Boolean) })} />
      <label class="fld"><span class="lbl">{t('Behaviour template')}</span><input class="in" readOnly value={it.behavior_template || ''} /></label>
    </div>
    <Row k={t('Created')} v={fmtDate(it.created)} /><Row k={t('Modified')} v={fmtDate(it.modified)} />{S.settings.value.showIds && <Row k="ID" v={it.item_id} />}
    {it.type === 'valve' && it.definition && <><Row k={t('Matrix')} v={it.definition.matrix} /><Row k={t('Nominal size')} v={it.definition.nominalSize || '—'} /><Row k={t('Manufacturer')} v={it.definition.manufacturer || '—'} /></>}
    {checks.length ? <><h4>{t('Checks')}</h4><div class="checks">{checks.map((c: any) => <div><span class={'dot ' + c.l} />{c.t}</div>)}</div></> : null}
    <h4>{t('Ports')}</h4><PortTable ports={(it.ports || []).map((p: any) => ({ ...p, domain: p.domain || it.domain }))} />
    <p class="note-i">{t('Edits to name, author and tags bump the version. Geometry is edited in the tool that made the item.')}</p>
  </div>;
}
function MultiCustom({ ids }: { ids: string[] }) {
  const items = ids.map(libById).filter(Boolean);
  return <div class="insp"><h3>{items.length} {t('custom items selected')}</h3><Row k={t('Valves')} v={items.filter(x => x.type === 'valve').length} /><Row k={t('Symbols')} v={items.filter(x => x.type === 'symbol').length} /><Row k={t('Needs review')} v={items.filter(x => x.status !== 'valid').length} />
    <label class="fld"><span class="lbl">{t('Move all to folder')}</span><select class="in" onChange={(e: any) => { const f = e.target.value; S.libWrite(S.libLoad().map(x => ids.includes(x.item_id) ? { ...x, folder: f || undefined } : x)); }}><option value="">{t('(no folder)')}</option>{S.customFolders.value.map(f => <option>{f}</option>)}</select></label>
    <TextField label={t('Add tag to all')} value="" onCommit={v => { if (!v) return; S.libWrite(S.libLoad().map(x => ids.includes(x.item_id) ? { ...x, tags: [...new Set([...(x.tags || []), v])] } : x)); }} />
    <div class="row-end wrap"><Btn icon="download" label={t('Export selected')} onClick={() => exportLibrary(items)} /><Btn icon="trash-2" kind="danger" label={t('Delete selected')} onClick={() => deleteSelection()} /></div></div>;
}
function SampleInspector({ sm }: { sm: any }) {
  if (!sm) return null; const ref = 'sample:' + sm.id; const st = S.isStarred(ref);
  return <div class="insp"><h3>{sm.name}</h3><div class="muted">{t(sm.category)} · <Badge kind="info">{sm.domain}</Badge> · <Badge kind="info">{t('Read-only')}</Badge></div><p>{sm.description}</p>
    <div class="row-end wrap"><Btn kind="primary" icon="copy" label={t('Open (unsaved copy)')} onClick={() => openSampleCopy(sm.id)} /><Btn icon="eye" label={t('View read-only')} onClick={() => openSampleCopy(sm.id, true)} /><Btn icon="plus" label={t('Save copy to project')} disabled={!S.project.value} title={S.project.value ? t('Add these sheets to the open project') : t('Open a project first')} onClick={() => sampleToProject(sm.id)} /><Btn icon="star" pressed={st} label={st ? t('Starred') : t('Star')} onClick={() => st ? S.removeStar(ref) : S.addStar({ type: 'template', target_ref: ref, label: sm.name, icon: 'library', scope: 'global' })} /></div>
    <h4>{t('Sheets')}</h4>{sm.sheets.map((x: any) => <Row k={x.name} v={x.type} />)}
    <h4>{t('Parts')} ({sm.parts.length})</h4><div class="partgrid small">{sm.parts.map((pid: string) => { const it: any = stdById(pid); return it ? <div class="partcell" title={it.name}><Thumb svg={partSvg(it)} alt={it.name} /><span>{it.name}</span></div> : null; })}</div>
    {sm.programs?.length ? <><h4>{t('Program')}</h4><pre class="code">{sm.programs[0].code}</pre></> : null}</div>;
}
function NodeInspector({ id }: { id: string }) {
  const p = S.project.value!; const n = p.nodes[id]; if (!n) return <Empty icon="alert" title={t('Item not found')} />;
  const leaf = n.type === 'sheet' || n.type === 'program'; const st = S.isStarred('node:' + id);
  if (n.type === 'machine') return <div class="insp"><div class="muted">{t('Machine (project root)')}</div>
    <TextField label={t('Project name')} value={p.manifest.name} required onCommit={v => S.renameNode(id, v)} />
    <TextField label={t('Description')} value={p.manifest.description || ''} onCommit={v => S.mutate('Edit description', d => { d.manifest.description = v; })} />
    <TextField label={t('Author')} value={p.manifest.author || ''} onCommit={v => S.mutate('Edit author', d => { d.manifest.author = v; })} />
    <label class="fld"><span class="lbl">{t('Project unit system')}</span><select class="in" value={p.manifest.unitSystem} onChange={(e: any) => S.mutate('Unit system', d => { d.manifest.unitSystem = e.target.value; })}><option>SI</option><option>SI-bar</option><option>Imperial</option></select></label>
    <Row k={t('Assemblies')} v={Object.values(p.nodes).filter(x => x.type === 'assembly').length} /><Row k={t('Sheets')} v={Object.values(p.nodes).filter(x => x.type === 'sheet').length} /><Row k={t('Programs')} v={Object.values(p.nodes).filter(x => x.type === 'program').length} />
    <Row k={t('Created')} v={fmtDate(p.manifest.created)} /><Row k={t('Format')} v={`hydra.project v${p.manifest.formatVersion}`} /><Row k={t('File')} v={S.fileHandle.value?.name || p.manifest.location || t('not saved yet')} />
    <div class="row-end wrap"><Btn icon="info" label={t('Project Properties…')} onClick={() => runCmd('file.props')} /></div></div>;
  const circuit = p.circuits[id], prog = p.programs[id];
  return <div class="insp"><div class="muted">{n.type === 'sheet' ? `${t('Sheet')} · ${n.sheetType}` : n.type === 'program' ? t('Program') : t('Assembly')}</div>
    <TextField label={t('Name')} value={n.name} required maxLength={80} onCommit={v => S.renameNode(id, v)} />
    {n.type === 'sheet' && <div class="fgrid"><label class="fld"><span class="lbl">{t('Sheet type')}</span><select class="in" value={n.sheetType} onChange={(e: any) => S.setNodeProps([id], { sheetType: e.target.value })}><option value="hydraulic">{t('Hydraulic')}</option><option value="pneumatic">{t('Pneumatic')}</option><option value="electric">{t('Electric')}</option></select></label>
      <label class="fld"><span class="lbl">{t('Sheet size')}</span><select class="in" value={n.size} onChange={(e: any) => S.setNodeProps([id], { size: e.target.value })}>{['A4', 'A3', 'A2', 'A1', 'A0'].map(x => <option>{x}</option>)}</select></label></div>}
    {n.type === 'program' && <label class="fld"><span class="lbl">{t('Language')}</span><select class="in" value={n.language || 'Blocks'} disabled><option value="Blocks">{t('Blocks (Logic Coder)')}</option><option value="ST">{t('Structured Text (older file)')}</option></select></label>}
    <TextField label={t('Description')} value={n.description || ''} onCommit={v => S.setNodeProps([id], { description: v })} />
    <Row k={t('Created')} v={fmtDate(n.created)} />{circuit && <Row k={t('Parts on sheet')} v={circuit.components?.length || 0} />}{prog && <Row k={t('Program lines')} v={(prog.code || '').split('\n').filter(Boolean).length} />}{n.type === 'assembly' && <Row k={t('Items')} v={n.children.length} />}{S.settings.value.showIds && <Row k="ID" v={id} />}
    <div class="row-end wrap">{leaf && <Btn kind="primary" icon="external-link" label={t('Open')} onClick={() => openNode(id)} />}{leaf && <Btn icon="star" pressed={st} label={st ? t('Starred') : t('Star')} onClick={() => starSelection()} />}<Btn icon="copy" label={t('Duplicate')} onClick={() => { const m = S.duplicateNodes([id]); if (m?.length) S.selection.value = { kind: 'node', ids: m }; }} /><Btn icon="trash-2" kind="danger" label={t('Delete')} onClick={() => deleteSelection()} /></div></div>;
}
function MultiNode({ ids }: { ids: string[] }) {
  const p = S.project.value!; const ns = ids.map(i => p.nodes[i]).filter(Boolean); const sheets = ns.every(n => n.type === 'sheet');
  const same = (k: string) => ns.every(n => (n as any)[k] === (ns[0] as any)[k]) ? (ns[0] as any)[k] : '';
  return <div class="insp"><h3>{ns.length} {t('items selected')}</h3><p class="muted">{t('Only shared fields are shown; changes apply to all.')}</p>
    {sheets ? <div class="fgrid"><label class="fld"><span class="lbl">{t('Sheet type')}</span><select class="in" value={same('sheetType')} onChange={(e: any) => S.setNodeProps(ids, { sheetType: e.target.value })}><option value="">{t('— mixed —')}</option><option value="hydraulic">{t('Hydraulic')}</option><option value="pneumatic">{t('Pneumatic')}</option><option value="electric">{t('Electric')}</option></select></label>
      <label class="fld"><span class="lbl">{t('Sheet size')}</span><select class="in" value={same('size')} onChange={(e: any) => S.setNodeProps(ids, { size: e.target.value })}><option value="">{t('— mixed —')}</option>{['A4', 'A3', 'A2', 'A1', 'A0'].map(x => <option>{x}</option>)}</select></label></div> : null}
    <TextField label={t('Description')} value={same('description') || ''} onCommit={v => S.setNodeProps(ids, { description: v })} />
    <div class="row-end wrap"><Btn icon="copy" label={t('Duplicate')} onClick={() => { const m = S.duplicateNodes(ids); if (m?.length) S.selection.value = { kind: 'node', ids: m }; }} /><Btn icon="trash-2" kind="danger" label={t('Delete')} onClick={() => deleteSelection()} /></div></div>;
}
