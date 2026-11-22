// Hydraulic / Pneumatic Circuit Designer: toolbar, Parts / Custom / Sheets panel, canvas,
// Properties / Sheet panel and the bottom dock (Rule check, Parts list, Connections, Tags).
import { h, Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import Fuse from 'fuse.js';
import { produce } from 'immer';
import * as S from '../store';
import { t } from '../i18n';
import { STD } from '../symbols';
import { STD_VALVES } from '../symbols';
import { openTool, valveSvg } from '../tools';
import { Icon, Btn, Thumb, NumField, TextField, Seg, Empty, Badge, Popover, MenuList, type MenuItem } from '../ui/common';
import { partSvg, libSvg } from '../ui/panels';
import { runCmd } from '../commands';
import { focusPanel } from '../layout';
import { unitFor, fromBase, toBase } from '../units';
import { round, clone } from '../util';
import { geomOf, stdItem, splitRef, NEUTRAL, posLetters, LETTER_NAME, CONN_REF, isConn, isAsm, type Geom } from './geom';
import { fieldsFor, defaults, VALVE_PRESETS, type Field } from './fields';
import { needsNormalise, normalise, ruleCheck, bom, bomGrouped, netsOf, endLabel, pipeLen, LINE, PAPER, SCALES, scaleLabel, TAG_RE, allTags, compPorts, livePts, isInfinite, fitPaper, contentBB, drawArea, shiftSheet, type Sheet, type Comp, type Issue } from './model';
import * as A from './asm';
import * as Sim from './sim';
import { thumbSvg } from './render';
import { Canvas, MiniMap, type Ctx } from './Canvas';
import { render } from 'preact';
import { PanelView } from '../plc/panel/Panel';
import * as st from './state';
import * as TP from './templates';
import * as X from './exports';
import * as E from './elec';
import { download } from '../util';
import * as LC from '../plc/state';
import { AiPanel, AiLogView } from '../ai/Panel';
import { aiOn } from '../ai/settings';
import { pinned as aiPinned, panelOpen as aiOpen } from '../ai/session';
import { MachineButton, MachineStrip } from '../plc/MachineStrip';
import { PanelDock, dockVisible } from '../plc/panel/Panel';

const isFluidSheet = (n: any) => n?.type === 'sheet' && n.sheetType !== 'electric';
const nameOfTool: Record<string, string> = { select: 'Select', work: 'Working line', pilot: 'Pilot line', drain: 'Drain line', wire: 'Wire', power: 'Power wire', pe: 'PE wire', junction: 'Junction', text: 'Text', enclosure: 'Enclosure' };

export function HydDesigner({ tab }: { tab: S.Tab }) {
  const p = S.project.value; const n = tab.nodeId ? p?.nodes[tab.nodeId] : null; const sh = n ? p?.circuits[n.id] as Sheet | undefined : undefined;
  const host = tab.ctx ? p?.circuits[tab.ctx.host] as Sheet | undefined : undefined; const inst = host?.components.find(c => c.id === tab.ctx!.inst);
  useEffect(() => { st.initDesignerState(); }, []);
  useEffect(() => { // older sheets (v0.3 samples) carry parts without positions: lay them out once, outside undo
    const pr = S.project.value; if (!pr || !n) return; const c = pr.circuits[n.id];
    if (c && needsNormalise(c)) S.project.value = produce(pr, (d: any) => { normalise(d.circuits[n.id]); }) as any;
  }, [n?.id, !!sh]);
  const etab = tab.designer === 'electric';
  if (!p) return <Chooser elec={etab} title={t('Open or create a project to draw circuits')} />;
  if (!n || !(etab ? n.type === 'sheet' && n.sheetType === 'electric' : isFluidSheet(n))) return <Chooser elec={etab} title={etab ? t('Choose an electric sheet') : t('Choose a hydraulic or pneumatic sheet')} />;
  if (!sh || needsNormalise(sh)) return <div class="hd"><div class="dempty"><Icon name="droplets" size={24} /><span>{t('Preparing sheet…')}</span></div></div>;
  return <DesignerBody sh={sh} nodeId={n.id} ghost={host && inst && !needsNormalise(host) ? { host, inst } : null} />;
}

function Chooser({ title, elec }: { title: string; elec?: boolean }) {
  const p = S.project.value; const sheets = p ? Object.values(p.nodes).filter(n => elec ? n.type === 'sheet' && n.sheetType === 'electric' : isFluidSheet(n)) : [];
  const add = (k: 'hydraulic' | 'pneumatic' | 'electric') => { const id = S.addNode('sheet', null, k); if (id) openSheet(id); };
  if (elec) return <div class="hd"><div class="dchooser">
    <div class="dhead"><Icon name="zap" size={22} /><div><h2>{t('Electric Circuit Designer')}</h2><p>{title}</p></div><div class="grow" /><Btn icon="home" label={t('Back to Home')} onClick={() => S.activeTab.value = 'home'} /></div>
    <div class="dbody">
      {p ? <><div class="row-end wrap" style={{ justifyContent: 'flex-start' }}><Btn kind="primary" icon="plus" label={t('New electric sheet')} onClick={() => add('electric')} /></div>
        <h3>{t('Electric sheets in this project')}</h3>{sheets.length ? <div class="list">{sheets.map(s => <button class="row" onClick={() => openSheet(s.id)}><Icon name="zap" />{s.name}<small>{(p.circuits[s.id]?.components || []).length} {t('parts')} · {(p.circuits[s.id]?.pipes || []).length} {t('wires')}</small></button>)}</div> : <p class="muted">{t('No electric sheets yet.')}</p>}</>
        : <div class="row-end wrap" style={{ justifyContent: 'flex-start' }}><Btn kind="primary" icon="file-plus" label={t('New Project…')} onClick={() => runCmd('file.new')} /><Btn icon="folder-open" label={t('Open Project…')} onClick={() => runCmd('file.open')} /></div>}
      <p class="muted small">{t('Electric circuits are drawn and documented, not simulated. They link to the hydraulic sheets and the PLC through shared tags: a coil tagged like a valve solenoid is that solenoid.')}</p>
    </div></div></div>;
  return <div class="hd"><div class="dchooser">
    <div class="dhead"><Icon name="droplets" size={22} /><div><h2>{t('Hydraulic / Pneumatic Designer')}</h2><p>{title}</p></div><div class="grow" /><Btn icon="home" label={t('Back to Home')} onClick={() => S.activeTab.value = 'home'} /></div>
    <div class="dbody">
      {p ? <><div class="row-end wrap" style={{ justifyContent: 'flex-start' }}><Btn kind="primary" icon="plus" label={t('New hydraulic sheet')} onClick={() => add('hydraulic')} /><Btn icon="plus" label={t('New pneumatic sheet')} onClick={() => add('pneumatic')} /></div>
        <h3>{t('Sheets in this project')}</h3>{sheets.length ? <div class="list">{sheets.map(s => <button class="row" onClick={() => openSheet(s.id)}><Icon name={s.sheetType === 'pneumatic' ? 'wind' : 'droplets'} />{s.name}<small>{s.sheetType} · {(p.circuits[s.id]?.components || []).length} {t('parts')}</small></button>)}</div> : <p class="muted">{t('No hydraulic or pneumatic sheets yet.')}</p>}</>
        : <div class="row-end wrap" style={{ justifyContent: 'flex-start' }}><Btn kind="primary" icon="file-plus" label={t('New Project…')} onClick={() => runCmd('file.new')} /><Btn icon="folder-open" label={t('Open Project…')} onClick={() => runCmd('file.open')} /></div>}
    </div></div></div>;
}
export function openSheet(id: string, ctx?: S.Tab['ctx']) { S.openSheetTab(id, ctx); }

// ======================= designer body =======================
function DesignerBody({ sh, nodeId, ghost }: { sh: Sheet; nodeId: string; ghost: { host: Sheet; inst: Comp } | null }) {
  const p = S.project.value!; const simOn = Sim.simView.value?.sheet === sh.id; const elec = E.isElec(sh);
  const sheets = Object.values(p.nodes).filter(x => x.type === 'sheet'); const sheetNo = Math.max(1, sheets.findIndex(x => x.id === nodeId) + 1);
  const ctx: Ctx = { sheetNo, sheets: sheets.length, project: p.manifest.name, units: S.prefs.value.unitSystem };
  const xctx = { ...ctx, fmt: st.fmtQ };
  const issues = useMemo(() => { const rank = { err: 0, warn: 1, info: 2, ok: 3 } as const; return (elec ? E.elecRules(sh, p) : [...ruleCheck(sh, p), ...A.asmRules(sh, p)]).sort((a, b) => rank[a.level] - rank[b.level]); }, [sh, p.circuits, S.valveSvgs.value]);
  // the command layer talks to the visible designer through this API
  useEffect(() => {
    const cur = () => st.sheetById(sh.id)!; const sel = () => st.selIds(sh.id); const issuesNow = () => E.isElec(cur()) ? E.elecRules(cur(), S.project.value) : [...ruleCheck(cur(), S.project.value), ...A.asmRules(cur(), S.project.value)];
    const api: st.Api = {
      sheetId: sh.id, hasSel: () => sel().length > 0, canPaste: () => st.hasClip.value,
      selectAll: () => { const c = cur(); st.setSel(sh.id, [...c.components, ...c.pipes, ...c.junctions, ...c.texts, ...c.enclosures].map(x => x.id)); },
      del: () => st.deleteIds(sh.id, sel()), copy: () => st.copyIds(sh.id, sel()), cut: () => { if (st.copyIds(sh.id, sel())) st.deleteIds(sh.id, sel()); }, paste: () => st.paste(sh.id),
      rotate: () => { if (st.tool.value === 'place' && st.placing.value) { st.placing.value = { ...st.placing.value, rot: (st.placing.value.rot + 90) % 360 }; return; } if (sel().length) st.rotateSel(sh.id, sel()); else S.toast(t('Select parts to rotate'), 'warn'); },
      mirror: () => { if (st.tool.value === 'place' && st.placing.value) { st.placing.value = { ...st.placing.value, mirror: !st.placing.value.mirror }; return; } if (sel().length) st.mirrorSel(sh.id, sel()); else S.toast(t('Select parts to mirror'), 'warn'); },
      group: () => { const c = cur(); const en = c.enclosures.filter(e => sel().includes(e.id)); if (en.length && en.length === sel().length) { st.deleteIds(sh.id, en.map(e => e.id)); S.toast(t('Enclosure removed')); } else st.encloseSel(sh.id, sel()); },
      setTool: (tl: st.Tool) => { if (E.isElec(cur())) tl = (({ work: 'wire', pilot: 'power', drain: 'pe' } as Record<string, st.Tool>)[tl] || tl); st.tool.value = tl; if (tl !== 'place') st.placing.value = null; },
      zoom: (k: 'in' | 'out' | 'fit') => { st.viewReq.value = { n: st.viewReq.value.n + 1, kind: k }; },
      toggle: (k: 'grid' | 'snap' | 'ortho' | 'ports') => { st.opts.value = { ...st.opts.value, [k]: !st.opts.value[k] }; st.saveOpts(); S.toast(`${k[0].toUpperCase() + k.slice(1)} ${st.opts.value[k] ? t('on') : t('off')}`); },
      ruleCheck: () => { const r = issuesNow(); st.dock.value = { open: true, tab: 'rules' }; const e = r.filter(x => x.level === 'err').length, w = r.filter(x => x.level === 'warn').length; S.toast(e || w ? `${t('Rule check')}: ${e} ${t('errors')}, ${w} ${t('warnings')}` : t('Rule check passed'), e ? 'err' : w ? 'warn' : 'ok'); },
      exportAs: async (k: string) => { const c = cur(); try { S.busy.value = { label: t('Exporting…') };
        if (k === 'pdf') await X.exportPdf(c, xctx); else if (k === 'svg') X.exportSvg(c, xctx); else if (k === 'png') await X.exportPng(c, xctx); else if (k === 'dxf') X.exportDxf(c, xctx); else if (k === 'csv') X.exportBomCsv(c, xctx); else if (k === 'xlsx') await X.exportBomXlsx(c, xctx); else if (k === 'netlist') X.exportNetlist(c, S.project.value); else if (k === 'print') X.printSheet(c, xctx);
        else if (k === 'wires' || k === 'terminals' || k === 'plcio' || k === 'tags') { const pr = S.project.value; const txt = k === 'wires' ? E.wireListCsv(pr) : k === 'terminals' ? E.terminalPlanCsv(pr) : k === 'plcio' ? E.plcIoCsv(pr) : E.machineTagsCsv(pr); const nm = { wires: 'wire-list', terminals: 'terminal-plan', plcio: 'plc-io-list', tags: 'machine-tags' }[k]; download(`${(pr?.manifest.name || 'project').replace(/[^\w.-]+/g, '_')}_${nm}.csv`, '\ufeff' + txt.replace(/\n/g, '\r\n'), 'text/csv'); S.toast(t('Exported') + ' ' + nm + '.csv', 'ok'); }
        else if (k === 'links') { const pr = S.project.value; download(`${(pr?.manifest.name || 'project').replace(/[^\w.-]+/g, '_')}_machine-links.json`, JSON.stringify(E.machineLinks(pr), null, 2), 'application/json'); S.toast(t('Machine links exported (for the PLC)'), 'ok'); }
      } catch (e: any) { S.notify(t('Export failed') + ': ' + (e?.message || e), 'err'); } finally { S.busy.value = null; } },
      renumber: () => st.renumberTags(sh.id), sheetProps: () => { st.rightTab.value = 'sheet'; }, toggleDock: () => { st.dock.value = { ...st.dock.value, open: !st.dock.value.open }; st.saveDock(); },
      focusParts: () => { leftTab.value = 'parts'; st.panes.value = { ...st.panes.value, left: true }; setTimeout(() => (document.querySelector('.dleft .searchin input') as HTMLInputElement)?.focus(), 30); },
      expand: (ids: string[], on: boolean) => A.setExpanded(sh.id, ids, on),
      editInPlace: (instId: string) => { const c = cur().components.find(x => x.id === instId); const ch = c && A.childOf(c); if (!ch) return; if (!S.project.value?.nodes[ch]) { S.toast(t('The assembly sheet is missing'), 'err'); return; } openSheet(ch, { host: sh.id, inst: instId }); },
      openSource: (instId: string) => { const c = cur().components.find(x => x.id === instId); const ch = c && A.childOf(c); if (ch && S.project.value?.nodes[ch]) openSheet(ch); },
      simRun: () => { if (E.isElec(cur())) { S.toast(t('Electric circuits are drawn, not simulated — simulate the hydraulic sheet'), 'info'); return; } if (Sim.simView.value?.sheet === sh.id) { Sim.simPause(); return; } if (Sim.simView.value) Sim.simStop(); const e = issuesNow().filter(x => x.level === 'err'); if (e.length) S.toast(`${e.length} ${t('rule-check errors — the simulation may not behave as drawn')}`, 'warn'); if (Sim.simStart(sh.id)) { st.tool.value = 'select'; st.placing.value = null; if (S.prefs.value.graphAuto) { if (S.prefs.value.graphPop) { if (!st.popWins.value.graph) st.pops.graph?.(); } else st.dock.value = { open: true, tab: 'sim' }; } } },
      simPause: () => Sim.simPause(), simStop: () => { Sim.simStop(); }, simStep: () => Sim.simStepOnce(), simReset: () => Sim.simReset(),
      placePort: () => startPlace(CONN_REF),
      togglePane: (side: 'left' | 'right') => { st.panes.value = { ...st.panes.value, [side]: !st.panes.value[side] }; st.savePanes(); }
    };
    st.D.value = api; return () => { if (st.D.value === api) st.D.value = null; };
  }, [sh.id]);
  useEffect(() => () => { if (Sim.simView.value?.sheet === sh.id && !LC.isLinked()) Sim.simStop(); }, [sh.id]); // leaving the sheet stops its simulation (not a running machine: the PLC drives it)
  useEffect(() => { if (st.sel.value.sheet !== sh.id) st.setSel(sh.id, []); }, [sh.id]);
  const pn = st.panes.value; const hostName = ghost ? p.nodes[ghost.host.id]?.name || ghost.host.name : ''; LC.tick.value; const dockOn = !elec && dockVisible(sh.id) && !(pn.right && st.rightTab.value === 'panel'); // the side Panel tab already shows it
  return <div class={'hd' + (simOn ? ' simon' : '')}>
    <AutoHide pinned={st.pins.value.tools} which="tools"><DToolbar sh={sh} issues={issues} /></AutoHide>
    {ghost && <div class="dctxbar"><Icon name="pencil" size={14} /><span>{t('Editing')} <b>{sh.name}</b> {t('in place inside')} <b>{hostName}</b> ({ghost.inst.tag}) · {t('changes apply to every use of this assembly')} ({A.usesOf(p, sh.id).length}×)</span><div class="grow" /><Btn kind="primary" icon="corner-up-left" label={t('Done — back to') + ' ' + hostName} onClick={() => { S.openSheetTab(sh.id, undefined); openSheet(ghost.host.id); }} /></div>}
    {!elec && <MachineStrip sheet={sh.id} />}
    {S.readOnly.value && <div class="dctxbar ro"><Icon name="eye" size={14} /><span>{t('Read-only project — you can view and simulate; editing is off.')}</span><div class="grow" /><Btn label={t('Allow editing')} onClick={() => S.setReadOnly(false)} /></div>}
    <div class="hdmain" style={{ gridTemplateColumns: `${pn.left ? '292px' : '30px'} minmax(0,1fr) ${dockOn ? 'min(640px,46vw)' : pn.right ? (st.rightTab.value === 'panel' ? 'min(520px,38vw)' : '326px') : '30px'}` }}>
      {pn.left ? <aside class="dleft" aria-label={t('Parts')}><LeftPanel sh={sh} /></aside> : <PaneStrip side="left" />}
      <section class="dcenter"><Canvas sh={sh} ctx={ctx} ghost={ghost} />{st.dock.value.open && (elec ? <ElecDock sh={sh} issues={issues} /> : <BottomDock sh={sh} issues={issues} />)}</section>
      {dockOn ? <PanelDock sheet={sh.id} /> : pn.right ? <aside class="dright" aria-label={t('Properties')}><RightPanel sh={sh} nodeId={nodeId} /></aside> : <PaneStrip side="right" />}
    </div>
  </div>;
}

// collapsed side pane: a thin strip, one click brings it back
function PaneStrip({ side }: { side: 'left' | 'right' }) {
  const lbl = side === 'left' ? [t('Parts'), t('Assemblies'), t('Custom'), t('Sheets')] : [t('Properties'), t('Sheet')];
  return <aside class={'dstrip ' + side} aria-label={side === 'left' ? t('Parts panel (collapsed)') : t('Properties panel (collapsed)')}>
    <button class="iconbtn" title={t('Show panel')} aria-label={t('Show panel')} onClick={() => st.D.value?.togglePane(side)}><Icon name={side === 'left' ? 'panel-left-open' : 'panel-right-open'} size={15} /></button>
    {lbl.map((l, i) => <button class="vlabel" onClick={() => { if (side === 'left') leftTab.value = (['parts', 'asm', 'custom', 'sheets'] as const)[i]; else st.rightTab.value = (['props', 'sheet'] as const)[i]; st.D.value?.togglePane(side); }}>{l}</button>)}</aside>;
}
// a bar that is always shown when pinned; unpinned it folds away and slides out while the pointer is near it
export function AutoHide({ pinned, which, children }: { pinned: boolean; which: 'top' | 'tools'; children: any }) {
  const [show, setShow] = useState(false); const tm = useRef<any>(0); const ref = useRef<HTMLDivElement>(null);
  const keep = () => !!document.querySelector('.popover') || (ref.current?.contains(document.activeElement) ?? false);
  const leave = () => { clearTimeout(tm.current); tm.current = setTimeout(() => { if (keep()) { leave(); return; } setShow(false); }, 450); };
  if (pinned) return <div class="ahwrap pinned" data-ah={which}>{children}<PinBtn which={which} /></div>;
  return <div class={'ahwrap float ' + (show ? 'show' : '')} data-ah={which} ref={ref} onMouseEnter={() => { clearTimeout(tm.current); setShow(true); }} onMouseLeave={leave} onFocusIn={() => setShow(true)}>
    <div class="ahhot" aria-hidden="true" /><div class="ahbody">{children}<PinBtn which={which} /></div></div>;
}
function PinBtn({ which }: { which: 'top' | 'tools' }) {
  const on = st.pins.value[which];
  return <button class={'pinbtn ' + (on ? 'on' : '')} title={on ? t('Unpin — the bar hides until you point at it') : t('Pin — always show this bar')} aria-pressed={on} aria-label={on ? t('Unpin bar') : t('Pin bar')} onClick={() => { st.pins.value = { ...st.pins.value, [which]: !on }; st.savePins(); }}><Icon name={on ? 'pin' : 'pin-off'} size={13} /></button>;
}

// ======================= toolbar =======================
function DToolbar({ sh, issues }: { sh: Sheet; issues: Issue[] }) {
  const tl = st.tool.value; const elec = E.isElec(sh); const o = st.opts.value; const [menu, setMenu] = useState<string | null>(null); const refs = useRef<Record<string, HTMLElement>>({});
  const errs = issues.filter(x => x.level === 'err').length, warns = issues.filter(x => x.level === 'warn').length;
  const T = (k: st.Tool, icon: string, key: string) => <Btn kind="tb" label={t(nameOfTool[k])} title={`${t(nameOfTool[k])} (${key})`} pressed={tl === k} onClick={() => st.D.value?.setTool(k)} />;
  const exportItems: MenuItem[] = [{ header: t('Drawing') }, { label: t('PDF (vector)'), icon: 'file-down', onSelect: () => st.D.value?.exportAs('pdf') }, { label: 'SVG', icon: 'file-code', onSelect: () => st.D.value?.exportAs('svg') }, { label: t('PNG (200 dpi)'), icon: 'file-image', onSelect: () => st.D.value?.exportAs('png') }, { label: t('DXF (R12, mm)'), icon: 'file-down', onSelect: () => st.D.value?.exportAs('dxf') }, 'sep', { header: t('Data') }, { label: t('Parts list — Excel'), icon: 'file-spreadsheet', onSelect: () => st.D.value?.exportAs('xlsx') }, { label: t('Parts list — CSV'), icon: 'sheet', onSelect: () => st.D.value?.exportAs('csv') }, ...(elec ? [{ label: t('Wire list — CSV'), icon: 'sheet', onSelect: () => st.D.value?.exportAs('wires') }, { label: t('Terminal plan — CSV'), icon: 'sheet', onSelect: () => st.D.value?.exportAs('terminals') }, { label: t('PLC I/O list — CSV'), icon: 'sheet', onSelect: () => st.D.value?.exportAs('plcio') }, { label: t('Machine tag table — CSV'), icon: 'sheet', onSelect: () => st.D.value?.exportAs('tags') }, { label: t('Machine links for the PLC (JSON)'), icon: 'network', onSelect: () => st.D.value?.exportAs('links') }] as MenuItem[] : [{ label: t('Simulation netlist (JSON)'), icon: 'network', onSelect: () => st.D.value?.exportAs('netlist') }] as MenuItem[]), 'sep', { label: t('Print…'), icon: 'printer', keys: 'Ctrl+P', onSelect: () => st.D.value?.exportAs('print') }];
  const alignItems: MenuItem[] = [['left', 'Align left', 'align-left'], ['hcentre', 'Align centres (vertical line)', 'align-vcentre'], ['right', 'Align right', 'align-right'], ['top', 'Align top', 'align-top'], ['vcentre', 'Align centres (horizontal line)', 'align-hcentre'], ['bottom', 'Align bottom', 'align-bottom'], ['hdist', 'Distribute horizontally', 'dist-h'], ['vdist', 'Distribute vertically', 'dist-v']].map(([k, l, ic]) => ({ label: t(l), icon: ic, onSelect: () => st.alignSel(sh.id, st.selIds(sh.id), k as any) }));
  const hasSel = st.selIds(sh.id).length > 0;
  return <div class="dtoolbar" role="toolbar" aria-label={t('Designer tools')}><div class="dtleft">
    <Btn kind="tb" icon={st.panes.value.left ? 'panel-left-close' : 'panel-left-open'} title={t('Parts panel (Ctrl+[)')} onClick={() => st.D.value?.togglePane('left')} />
    {elec ? <>{T('select', 'mouse-pointer', 'V')}{T('wire', 'route', 'W')}{T('power', 'route', 'P')}{T('pe', 'route', 'D')}{T('junction', 'git-commit-horizontal', 'J')}{T('text', 'type', 'T')}{T('enclosure', 'square-dashed', 'E')}<Btn kind="tb" label={t('Net label')} title={t('Potential / net label — joins wires of the same name, also across sheets')} pressed={tl === 'place' && st.placing.value?.ref === 'std:e_label'} onClick={() => startPlace('std:e_label')} /></>
    : <>{T('select', 'mouse-pointer', 'V')}{T('work', 'route', 'W')}{T('pilot', 'spline', 'P')}{T('drain', 'corner-down-right', 'D')}{T('junction', 'git-commit-horizontal', 'J')}{T('text', 'type', 'T')}{T('enclosure', 'square-dashed', 'E')}</>}
    {!elec && <Btn kind="tb" label={t('Port X')} title={t('Interface port — connects this sheet to the same tag on another assembly (X)')} pressed={tl === 'place' && st.placing.value?.ref === CONN_REF} onClick={() => startPlace(CONN_REF)} />}
    <span class="tsep" />
    <Btn kind="tb" label={t('Rotate')} title={t('Rotate 90° (R)')} onClick={() => runCmd('edit.rotate')} disabled={!hasSel && tl !== 'place'} />
    <Btn kind="tb" label={t('Mirror')} title={t('Mirror (M)')} onClick={() => runCmd('des.mirror')} disabled={!hasSel && tl !== 'place'} />
    <span ref={el => { if (el) refs.current.align = el; }}><Btn kind="tb" label={t('Align') + ' ▾'} disabled={st.selIds(sh.id).length < 2} onClick={() => setMenu(menu === 'align' ? null : 'align')} /></span>
    <Btn kind="tb" label={t('Delete')} title={t('Delete (Del)')} disabled={!hasSel} onClick={() => runCmd('edit.delete')} />
    <span class="tsep" />
    <Btn kind="tb" label={t('Grid')} title={t('Grid on / off (G)')} pressed={o.grid} onClick={() => st.D.value?.toggle('grid')} />
    <Btn kind="tb" label={t('Snap')} title={t('Snap to grid and ports (S)')} pressed={o.snap} onClick={() => st.D.value?.toggle('snap')} />
    <Btn kind="tb" label={t('Ortho')} title={t('Orthogonal lines (O)')} pressed={o.ortho} onClick={() => st.D.value?.toggle('ortho')} />
    <span class="tsep" />
    <Btn kind="tb" icon="minus" title={t('Zoom out (Ctrl −)')} onClick={() => runCmd('view.zoomOut')} />
    <span ref={el => { if (el) refs.current.zoom = el; }}><button class="btn tb zoompct" onClick={() => setMenu(menu === 'zoom' ? null : 'zoom')} aria-label={t('Zoom level')}>{st.zoomPct.value} %</button></span>
    <Btn kind="tb" icon="plus" title={t('Zoom in (Ctrl +)')} onClick={() => runCmd('view.zoomIn')} />
    <Btn kind="tb" label={t('Fit')} title={t('Zoom to fit (Ctrl 0)')} onClick={() => runCmd('view.zoomFit')} />
    <span class="tsep" />
    <Btn kind="tb" icon="map" title={t('Overview on / off')} pressed={st.overviewOn.value || !!st.popWins.value.overview} onClick={() => st.popWins.value.overview ? st.pops.overview?.() : st.setOverview(!st.overviewOn.value)} />
    {!elec && <Btn kind="tb" icon="activity" title={t('Graph (Simulation tab) on / off')} pressed={(st.dock.value.open && st.dock.value.tab === 'sim') || !!st.popWins.value.graph} onClick={() => { if (st.popWins.value.graph) { st.pops.graph?.(); return; } const d = st.dock.value; st.dock.value = d.open && d.tab === 'sim' ? { ...d, open: false } : { open: true, tab: 'sim' }; st.saveDock(); }} />}
    </div><div class="dtright">
    <Btn kind="tb" icon="shield-check" title={t('Run rule check (F7)')} onClick={() => runCmd('menu.ruleCheck')}><span>{t('Rule check')} · F7</span>{errs ? <b class="dcount err">{errs}</b> : warns ? <b class="dcount warn">{warns}</b> : <b class="dcount ok">✓</b>}</Btn>
    {!elec && <MachineButton sheet={sh.id} />}{!elec && <SimControls sh={sh} />}
    <span ref={el => { if (el) refs.current.export = el; }}><Btn kind="tb" label={t('Export') + ' ▾'} onClick={() => setMenu(menu === 'export' ? null : 'export')} /></span>
    <Btn kind="tb" icon={st.panes.value.right ? 'panel-right-close' : 'panel-right-open'} title={t('Properties panel (Ctrl+])')} onClick={() => st.D.value?.togglePane('right')} /></div>
    {menu === 'export' && refs.current.export && <Popover anchor={refs.current.export} placement="bottom-end" onClose={() => setMenu(null)}><MenuList items={exportItems} onDone={() => setMenu(null)} /></Popover>}
    {menu === 'align' && refs.current.align && <Popover anchor={refs.current.align} onClose={() => setMenu(null)}><MenuList items={alignItems} onDone={() => setMenu(null)} /></Popover>}
    {menu === 'zoom' && refs.current.zoom && <Popover anchor={refs.current.zoom} onClose={() => setMenu(null)}><MenuList items={[50, 100, 150, 200, 300, 400].map(z => ({ label: z + ' %', onSelect: () => { st.viewReq.value = { n: st.viewReq.value.n + 1, kind: 'pct', pct: z }; } }))} onDone={() => setMenu(null)} /></Popover>}
  </div>;
}

// The Simulate button never moves: it becomes Pause / Resume in place; the other controls open to its left
function SimControls({ sh }: { sh: Sheet }) {
  const v = Sim.simView.value; const on = v?.sheet === sh.id;
  return <span class={'dsimctl' + (on ? ' on' : '')} role="group" aria-label={t('Simulation')}>
    {on && <span class="dsimx">
      <span class="dsimt mono" aria-live="off">{v!.t.toFixed(2)} s</span>
      <select class="in sm" aria-label={t('Speed')} value={String(v!.speed)} onChange={(e: any) => Sim.simSpeed(+e.target.value)}>{[0.1, 0.25, 0.5, 1, 2, 4].map(x => <option value={String(x)}>×{x}</option>)}</select>
      <Btn kind="tb" icon="rotate-ccw" title={t('Restart from t = 0')} onClick={() => st.D.value?.simReset()} />
      <Btn kind="tb" icon="step-forward" title={t('Step 10 ms (while paused)')} onClick={() => st.D.value?.simStep()} disabled={v!.running} />
      <Btn kind="tb" icon="square" label={t('Stop')} title={t('Stop and return to editing (Shift+F5)')} onClick={() => st.D.value?.simStop()} />
    </span>}
    <Btn kind={on ? 'primary' : 'tb'} class="simbtn" icon={!on || !v!.running ? 'play' : 'pause'} label={!on ? t('Simulate') : v!.running ? t('Pause') : t('Resume')} title={!on ? t('Run the simulation of this sheet, assemblies included (F5)') : t('Pause / resume (F6)')} onClick={() => on ? st.D.value?.simPause() : st.D.value?.simRun()} />
  </span>;
}

// ======================= left: Parts / Assemblies / Custom / Sheets =======================
import { signal } from '@preact/signals';
const leftTab = signal<'parts' | 'asm' | 'custom' | 'tpl' | 'sheets'>('parts');
const CAT_ORDER = ['Contacts', 'Command devices', 'Coils & loads', 'Timers', 'Sensors', 'PLC I/O', 'Protection & supply', 'Components', 'Directional valves', 'Pressure control', 'Non-return & flow', 'Pumps & motors', 'Cylinders & actuators', 'Conditioning & measurement', 'Lines & connections', 'Supply, air preparation & logic', 'Actuators'];
function LeftPanel({ sh }: { sh: Sheet }) {
  const lt = leftTab.value;
  return <div class="panel">
    <div class="dtabs" role="tablist">{(E.isElec(sh) ? [['parts', 'Parts'], ['custom', 'Custom'], ['tpl', 'Templates'], ['sheets', 'Sheets']] as const : [['parts', 'Parts'], ['asm', 'Assemblies'], ['custom', 'Custom'], ['tpl', 'Templates'], ['sheets', 'Sheets']] as const).map(([k, l]) => <button role="tab" aria-selected={lt === k} class={lt === k ? 'on' : ''} onClick={() => leftTab.value = k}>{t(l)}</button>)}
      <div class="grow" /><button class="iconbtn" title={t('Hide panel')} aria-label={t('Hide panel')} onClick={() => st.D.value?.togglePane('left')}><Icon name="panel-left-close" size={14} /></button></div>
    {lt === 'parts' && <PartsTab sh={sh} />}{lt === 'asm' && !E.isElec(sh) && <AsmTab sh={sh} />}{lt === 'custom' && <CustomTab sh={sh} />}{lt === 'tpl' && <TplTab sh={sh} />}{lt === 'sheets' && <SheetsTab sh={sh} />}
  </div>;
}
function startPlace(ref: string) { st.placing.value = { ref, rot: 0, mirror: false }; st.tool.value = 'place'; S.toast(t('Click on the sheet to place · R rotates · M mirrors · Shift-click places several · Esc cancels')); }
function PartTile({ it, refId, svg, sel }: { it: any; refId: string; svg: string; sel: boolean }) {
  return <div class={'part ' + (sel ? 'sel' : '')} role="button" tabIndex={0} draggable aria-label={t('Place') + ' ' + it.name} title={`${it.name}\n${it.standard || ''}\n${t('Click, then click on the sheet — or drag onto the sheet')}`}
    onDragStart={(e: any) => { st.dragPart.ref = refId; e.dataTransfer.setData('application/x-hydra-part', refId); e.dataTransfer.setData('text/plain', it.name); e.dataTransfer.effectAllowed = 'copy'; }}
    onDragEnd={() => { st.dragPart.ref = ''; }}
    onClick={() => startPlace(refId)} onKeyDown={(e: any) => e.key === 'Enter' && startPlace(refId)}>
    <Thumb svg={svg} alt="" /><span class="pname">{it.name}</span></div>;
}
function PartsTab({ sh }: { sh: Sheet }) {
  const elec = E.isElec(sh); const home = elec ? 'electrical' : sh.type === 'pneumatic' ? 'pneumatic' : 'hydraulic';
  const [q, setQ] = useState(''); const [dom, setDom] = useState<string>(home); const [shut, setShut] = useState<Record<string, boolean>>({}); const inp = useRef<HTMLInputElement>(null);
  useEffect(() => { setDom(home); }, [sh.id]);
  const valves = useMemo(() => STD_VALVES.map(v => stdItem(v.id)), []);
  const all = useMemo(() => elec ? STD.filter((x: any) => x.domain === 'electrical') : [...valves, ...STD].filter((x: any) => x.domain !== 'electrical'), [valves, elec]);
  const fuse = useMemo(() => new Fuse(all, { keys: ['name', 'tags', 'category', 'cls'], threshold: 0.35, ignoreLocation: true }), [all]);
  const starred = new Set([...S.globalStars.value, ...(S.project.value?.stars || [])].filter(s => s.target_ref.startsWith('std:')).map(s => s.target_ref.slice(4)));
  let items: any[] = q.trim() ? fuse.search(q.trim()).map(r => r.item) : all;
  if (dom === 'electrical') items = items.filter(x => x.domain === 'electrical');
  else if (dom === 'hydraulic') items = items.filter(x => x.domain === 'hydraulic');
  else if (dom === 'pneumatic') items = items.filter(x => x.domain === 'pneumatic' || (x.domain === 'hydraulic' && NEUTRAL.has(x.cls) && x.category !== 'Lines & connections'));
  else if (dom === 'recent') { const rec = st.recentParts.value.filter(r => r.startsWith('std:')).map(r => r.slice(4)); items = rec.map(id => all.find((x: any) => x.id === id)).filter(Boolean); }
  if (elec && dom !== 'recent' && dom !== 'starred') items = items.filter(x => x.domain === 'electrical');
  else if (dom === 'starred') items = items.filter(x => starred.has(x.id));
  const cats: Record<string, any[]> = {}; items.forEach(x => (cats[x.category] ||= []).push(x));
  const keys = Object.keys(cats).sort((a, b) => (CAT_ORDER.indexOf(a) + 1 || 99) - (CAT_ORDER.indexOf(b) + 1 || 99));
  const pl = st.placing.value?.ref;
  return <>
    <div class="ptools"><div class="searchin"><Icon name="search" size={14} /><input ref={inp} value={q} placeholder={elec ? t('contact, coil, sensor, PLC…') : t('valve, cylinder, ISO name…')} aria-label={t('Search parts')} onInput={(e: any) => setQ(e.target.value)} onKeyDown={(e: any) => { if (e.key === 'Enter' && items[0]) startPlace('std:' + items[0].id); }} />{q && <button class="iconbtn" aria-label={t('Clear search')} onClick={() => setQ('')}><Icon name="x" size={13} /></button>}</div></div>
    <div class="chips" role="group" aria-label={t('Filter')}>{(elec ? [['electrical', 'Electrical'], ['recent', 'Recent'], ['starred', 'Starred']] as const : [['hydraulic', 'Hydraulic'], ['pneumatic', 'Pneumatic'], ['recent', 'Recent'], ['starred', 'Starred']] as const).map(([k, l]) => <button class={'chip ' + (dom === k ? 'on' : '')} aria-pressed={dom === k} onClick={() => setDom(k)}>{t(l)}</button>)}</div>
    <div class="scroll">{keys.length ? keys.map(c => <div class="cat">
      <button class="cathead" aria-expanded={!shut[c]} onClick={() => setShut({ ...shut, [c]: !shut[c] })}><Icon name={shut[c] ? 'chevron-right' : 'chevron-down'} size={13} />{t(c)}<small>{cats[c].length}</small></button>
      {!shut[c] && <div class="pgrid">{cats[c].map(it => <PartTile it={it} refId={'std:' + it.id} svg={partSvg(it)} sel={pl === 'std:' + it.id} />)}</div>}</div>)
      : <Empty icon={dom === 'recent' ? 'history' : dom === 'starred' ? 'star' : 'search'} title={dom === 'recent' ? t('No recent parts yet') : dom === 'starred' ? t('No starred parts') : t('No parts match')}><p>{dom === 'starred' ? t('Star parts on the Home tab to collect them here.') : dom === 'recent' ? t('Parts you place appear here.') : t('Try another word.')}</p></Empty>}</div>
    <div class="pfoot muted">{t('click or drag onto the sheet · R rotates while placing')}</div>
  </>;
}
function CustomTab({ sh }: { sh: Sheet }) {
  const [q, setQ] = useState('');
  const lib = S.customLib.value.filter(it => E.isElec(sh) ? (it.definition?.domain || it.domain) === 'electrical' : (it.definition?.domain || it.domain) !== 'electrical');
  const items = q.trim() ? lib.filter(it => (it.name + ' ' + (it.folder || '')).toLowerCase().includes(q.trim().toLowerCase())) : lib;
  const pl = st.placing.value?.ref;
  return <>
    <div class="ptools"><div class="searchin"><Icon name="search" size={14} /><input value={q} placeholder={t('Search custom parts')} aria-label={t('Search custom parts')} onInput={(e: any) => setQ(e.target.value)} /></div>
      <Btn kind="tb" icon="git-fork" title={t('New Valve (Valve Creator)')} onClick={() => openTool('valve')} /><Btn kind="tb" icon="pen-tool" title={t('New Symbol (Symbol Sketcher)')} onClick={() => openTool('symbol')} /></div>
    <div class="scroll">{items.length ? <div class="pgrid">{items.map(it => <PartTile it={{ ...it, standard: it.type === 'valve' ? 'Custom valve · ISO 1219-1' : 'Custom symbol' }} refId={'lib:' + it.item_id} svg={libSvg(it)} sel={pl === 'lib:' + it.item_id} />)}</div>
      : <Empty icon="package" title={t('No custom parts yet')}><p>{t('Valves from the Valve Creator and symbols from the Symbol Sketcher appear here. Placed custom parts are copied into the project file.')}</p></Empty>}</div>
    <div class="pfoot muted">{items.length} {t('custom parts')} · {t('copied into the project when placed')}</div>
  </>;
}
// custom templates: saved selections, placed as independent copies
const tplThumbs = new Map<string, string>();
function tplThumb(tp: TP.Tpl) { let x = tplThumbs.get(tp.id + tp.updated); if (x == null) { try { const d = tp.data; x = thumbSvg({ id: 'tpl', name: tp.name, type: tp.domain === 'pneumatic' ? 'pneumatic' : tp.domain === 'electrical' ? 'electric' : 'hydraulic', mode: 'infinite', grid: 5, scale: 1, size: 'A3', components: d.comps || [], pipes: d.pipes || [], junctions: d.juncs || [], texts: d.texts || [], enclosures: d.encl || [] } as any, st.fmtQ); } catch { x = ''; } tplThumbs.set(tp.id + tp.updated, x); } return x; }
function TplTab({ sh }: { sh: Sheet }) {
  const [q, setQ] = useState(''); const elec = E.isElec(sh); const fi = useRef<HTMLInputElement>(null); const nSel = st.selIds(sh.id).length;
  const all = TP.templates.value.filter(x => (x.domain === 'electrical') === elec);
  const items = q.trim() ? all.filter(x => (x.name + ' ' + x.desc).toLowerCase().includes(q.trim().toLowerCase())) : all;
  return <>
    <div class="ptools"><div class="searchin"><Icon name="search" size={14} /><input value={q} placeholder={t('Search templates')} aria-label={t('Search templates')} onInput={(e: any) => setQ(e.target.value)} /></div>
      <Btn kind="tb" icon="upload" title={t('Import templates (.json)')} onClick={() => fi.current?.click()} /><Btn kind="tb" icon="download" title={t('Export all templates (.json)')} disabled={!TP.templates.value.length} onClick={() => TP.exportTpl()} />
      <input ref={fi} type="file" accept=".json,application/json" hidden onChange={(e: any) => { const f = e.target.files?.[0]; if (f) TP.importTpl(f); e.target.value = ''; }} /></div>
    <div class="dtplsave"><Btn kind={nSel ? 'primary' : 'tb'} icon="library" label={t('Save selection as template')} disabled={!nSel || S.readOnly.value && false} title={nSel ? t('Keep the selected parts and lines — one valve or a whole circuit') : t('Select parts and lines on the sheet first (also: right-click › Save as template…)')} onClick={() => TP.saveSelection(sh.id)} />{nSel > 0 && <small class="muted">{nSel} {t('selected')}</small>}</div>
    <div class="scroll">{items.length ? <div class="pgrid tplgrid">{items.map(tp => <div class="part asm tpl" role="button" tabIndex={0} draggable title={`${tp.name}\n${tp.nParts} ${t('parts')} · ${tp.nLines} ${t('lines')}\n${t('Click: insert in the middle of the view · drag: drop where you want')}`}
        onDragStart={(e: any) => { st.dragPart.ref = 'tpl:' + tp.id; e.dataTransfer.setData('application/x-hydra-part', 'tpl:' + tp.id); e.dataTransfer.setData('text/plain', tp.name); e.dataTransfer.effectAllowed = 'copy'; }} onDragEnd={() => { st.dragPart.ref = ''; }}
        onClick={(e: any) => { if ((e.target as Element).closest('.tplact')) return; TP.placeTemplate(sh.id, tp.id); }} onKeyDown={(e: any) => e.key === 'Enter' && TP.placeTemplate(sh.id, tp.id)}>
        <span class="thumb" dangerouslySetInnerHTML={{ __html: tplThumb(tp) }} /><span class="pname">{tp.name}</span><small class="pports">{tp.nParts} {t('parts')} · {tp.nLines} {t('lines')}</small>
        <span class="tplact"><button class="iconbtn" title={t('Rename')} aria-label={t('Rename')} onClick={() => TP.renameTpl(tp.id)}><Icon name="pencil" size={12} /></button><button class="iconbtn" title={t('Duplicate')} aria-label={t('Duplicate')} onClick={() => TP.duplicateTpl(tp.id)}><Icon name="copy" size={12} /></button><button class="iconbtn" title={t('Export')} aria-label={t('Export')} onClick={() => TP.exportTpl([tp.id])}><Icon name="download" size={12} /></button><button class="iconbtn" title={t('Delete')} aria-label={t('Delete')} onClick={() => TP.deleteTpl(tp.id)}><Icon name="x" size={12} /></button></span></div>)}</div>
      : <Empty icon="library" title={all.length ? t('No templates match') : t('No templates yet')}><p>{t('Select a valve, a sub-circuit or a whole circuit and choose Save selection as template. Templates are kept in this browser for every project — placing one inserts an independent copy you can change freely.')}</p></Empty>}</div>
    <div class="pfoot muted">{all.length} {t('templates')} · {t('placed as independent copies, tags renumbered')}</div>
  </>;
}
// assemblies: sheets with interface ports, placed as instances; other open projects' sheets are imported as copies
const thumbCache = new WeakMap<object, string>();
export function sheetThumb(c: any) { if (!c || needsNormalise(c)) return ''; let x = thumbCache.get(c); if (x == null) { try { x = thumbSvg(c, st.fmtQ); } catch { x = ''; } thumbCache.set(c, x); } return x; }
function AsmTab({ sh }: { sh: Sheet }) {
  const p = S.project.value!; const [q, setQ] = useState('');
  const list = Object.values(p.nodes).filter(n => n.type === 'sheet' && n.sheetType !== 'electric' && n.id !== sh.id && (!q.trim() || n.name.toLowerCase().includes(q.trim().toLowerCase())));
  const others = S.docs.value.filter(d => d.key !== S.activeDoc.value).map(d => ({ d, p: S.docProject(d.key)! })).filter(x => x.p);
  const pl = st.placing.value?.ref;
  const Tile = ({ n, ok, why }: { n: any; ok: boolean; why?: string }) => { const c = p.circuits[n.id]; const ports = (c?.components || []).filter((x: Comp) => isConn(x.ref)).map((x: Comp) => x.tag); const ref = 'asmx:' + n.id;
    return <div class={'part asm ' + (pl === ref ? 'sel' : '') + (ok ? '' : ' dis')} role="button" tabIndex={0} draggable={ok} title={ok ? `${n.name}\n${ports.length ? t('Ports') + ': ' + ports.join(', ') : t('No interface ports yet — add Port X on that sheet')}\n${t('Click, then click on the sheet — or drag')}` : why}
      onDragStart={(e: any) => { if (!ok) return; st.dragPart.ref = ref; e.dataTransfer.setData('application/x-hydra-part', ref); e.dataTransfer.effectAllowed = 'copy'; }} onDragEnd={() => { st.dragPart.ref = ''; }}
      onClick={() => ok ? startPlace(ref) : S.toast(why || '', 'warn')} onKeyDown={(e: any) => e.key === 'Enter' && ok && startPlace(ref)}>
      <span class="thumb" dangerouslySetInnerHTML={{ __html: sheetThumb(c) }} /><span class="pname">{n.name}</span><small class="pports">{ports.length ? ports.join(' · ') : t('no ports')}</small></div>; };
  return <>
    <div class="ptools"><div class="searchin"><Icon name="search" size={14} /><input value={q} placeholder={t('Search sheets')} aria-label={t('Search assembly sheets')} onInput={(e: any) => setQ(e.target.value)} /></div></div>
    <div class="scroll">
      <div class="dasmhelp"><b>{t('Assemblies')}</b><span>{t('Give a sheet interface ports (Port X, tags like P1, T1). Place it here as an instance, then join ports with the same tag.')}</span>
        <div class="row-end wrap" style={{ justifyContent: 'flex-start' }}><Btn kind="tb" icon="square-plus" label={t('Port X')} onClick={() => startPlace(CONN_REF)} /><Btn kind="tb" icon="boxes" label={t('New machine sheet')} onClick={() => { const id = S.addNode('sheet', null, sh.type === 'pneumatic' ? 'pneumatic' : 'hydraulic', 'Machine'); if (id) { S.mutate('Infinite canvas', d => { (d.circuits[id] as any).mode = 'infinite'; }); openSheet(id); } }} /><Btn kind="tb" icon="wand-2" label={t('Build machine')} title={t('One machine sheet with every unused assembly, ports with matching tags linked')} onClick={() => { const id = A.buildMachine(); if (id) openSheet(id); }} /></div></div>
      {list.length ? <div class="pgrid">{list.map(n => { const ok = A.canPlace(p, sh.id, n.id); return <Tile n={n} ok={ok} why={t('This sheet contains the current sheet — placing it would be circular')} />; })}</div> : <p class="muted pad">{t('No other fluid sheets in this project.')}</p>}
      {others.map(({ d, p: op }) => { const ss = Object.values(op.nodes).filter(n => n.type === 'sheet' && n.sheetType !== 'electric'); if (!ss.length) return null; return <div class="cat"><div class="cathead static">{t('From')} “{op.manifest.name}”<small>{t('imported as a copy')}</small></div>
        <div class="pgrid">{ss.map(n => { const c = op.circuits[n.id]; const ports = (c?.components || []).filter((x: Comp) => isConn(x.ref)).map((x: Comp) => x.tag); return <div class="part asm" role="button" tabIndex={0} title={t('Copy into this project and place')} onClick={() => { const nid = A.importAssembly(op, n.id); if (nid) startPlace('asmx:' + nid); }}><span class="thumb" dangerouslySetInnerHTML={{ __html: sheetThumb(c) }} /><span class="pname">{n.name}</span><small class="pports">{ports.length ? ports.join(' · ') : t('no ports')}</small></div>; })}</div></div>; })}
    </div>
    <div class="pfoot muted">{t('Only equal port tags can be linked · double-click an instance to edit it in place')}</div>
  </>;
}
function SheetsTab({ sh }: { sh: Sheet }) {
  const p = S.project.value!; const list = Object.values(p.nodes).filter(x => x.type === 'sheet');
  const add = (k: 'hydraulic' | 'pneumatic' | 'electric') => { const id = S.addNode('sheet', p.nodes[sh.id]?.parent || null, k); if (id) openSheet(id); };
  return <><div class="ptools"><Btn kind="tb" icon="plus" label={t('Hydraulic')} onClick={() => add('hydraulic')} /><Btn kind="tb" icon="plus" label={t('Pneumatic')} onClick={() => add('pneumatic')} /><Btn kind="tb" icon="plus" label={t('Electric')} onClick={() => add('electric')} /></div>
    <div class="scroll"><div class="dsheets">{list.map((n, i) => { const c = p.circuits[n.id]; return <button class={'dsheet ' + (n.id === sh.id ? 'on' : '')} onClick={() => openSheet(n.id)}>
      <Icon name={n.sheetType === 'electric' ? 'zap' : n.sheetType === 'pneumatic' ? 'wind' : 'droplets'} /><span><b>{i + 1}. {n.name}</b><small>{n.sheetType} · {c?.size || n.size || 'A3'} · {(c?.components || []).length} {t('parts')} · {(c?.pipes || []).length} {t('lines')}</small></span></button>; })}</div></div>
    <div class="pfoot muted">{t('Sheets are numbered in project order for the title block')}</div></>;
}

// ======================= right: Properties / Sheet / Panel =======================
function SidePanel() {
  LC.tick.value; const p = S.project.value!; const progs = LC.programNodes(p); const [pick, setPick] = useState<string>('');
  const id = (pick && p.programs?.[pick]) ? pick : (LC.activeProgId(p) || progs[0]?.id || '');
  if (!id) return <div class="scroll"><Empty icon="layout-dashboard" title={t('No PLC program yet')}><p>{t('Create a program in the Logic Coder — its operator panel shows here, next to the circuit.')}</p></Empty></div>;
  return <div class="dsidepanel">{progs.length > 1 && <div class="ptools"><select class="in sm" aria-label={t('Program')} value={id} onChange={(e: any) => setPick(e.target.value)}>{progs.map((n: any) => <option value={n.id}>{n.name}</option>)}</select></div>}
    <div class="dsidepanel-b"><PanelView progId={id} view="side" compact /></div></div>;
}
// pop-out windows (graph, overview) — same look, own screen
function popWin(key: string, title: string, Body: () => any, size = 'width=1100,height=520') {
  const wins = (popWin as any).w ||= {} as Record<string, Window>; const old = wins[key];
  if (old && !old.closed) { old.close(); return; }
  const win = window.open('', 'hydra_' + key, size); if (!win) { S.toast(t('The browser blocked the window — allow pop-ups for HYDRA'), 'warn'); return; }
  const doc = win.document; doc.open(); doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>HYDRA · ${title}</title></head><body class="oppop dpop"><div id="r"></div></body></html>`); doc.close();
  document.querySelectorAll('style').forEach(s => doc.head.appendChild(doc.importNode(s, true)));
  const root = doc.getElementById('r')!; render(<div class="oppop-w"><div class="oppop-bar"><b>■ HYDRA</b><span>{title}</span><span class="grow" /></div><div class="dpop-b"><Body /></div></div>, root);
  wins[key] = win; st.popWins.value = { ...st.popWins.value, [key]: true };
  let gone = false; const done = () => { if (gone) return; gone = true; clearInterval(iv); try { render(null, root); } catch { } delete wins[key]; st.popWins.value = { ...st.popWins.value, [key]: false }; };
  const iv = setInterval(() => { if (win.closed) done(); }, 400);
  win.addEventListener('beforeunload', done); win.addEventListener('pagehide', done); window.addEventListener('beforeunload', () => { try { win.close(); } catch { } });
}
function GraphPop() { const v = Sim.simView.value; const id = v?.sheet || st.D.value?.sheetId; const sh = id ? st.sheetById(id) : null; return sh ? <div class="ddock dpopgraph"><SimDock sh={sh} /></div> : <p class="muted pad">{t('Open a sheet and press Simulate.')}</p>; }
function OvPop() {
  const o = st.ovState.value; const [w, setW] = useState(560); useEffect(() => { const f = () => { const r = document.querySelector('.dpopov') as HTMLElement | null; const ww = r?.ownerDocument.defaultView; if (ww) setW(Math.max(200, Math.min(ww.innerWidth - 32, (ww.innerHeight - 80) * ((o?.box[2]! - o?.box[0]!) / Math.max(1, o?.box[3]! - o?.box[1]!) || 1.4)))); }; f(); const ww = (document.querySelector('.dpopov') as any)?.ownerDocument.defaultView; ww?.addEventListener('resize', f); return () => ww?.removeEventListener('resize', f); }, [o?.sheet]);
  const sh = o ? st.sheetById(o.sheet) : null;
  return <div class="dpopov">{sh && o ? <MiniMap sh={sh} v={o.v} sz={o.sz} box={o.box} big={w} onPan={(px, py) => { st.panReq.value = { sheet: o.sheet, px, py, n: (st.panReq.value?.n || 0) + 1 }; }} /> : <p class="muted pad">{t('Open a sheet to see its overview.')}</p>}</div>;
}
st.pops.graph = () => popWin('graph', t('Simulation graph'), GraphPop);
st.pops.overview = () => popWin('overview', t('Overview'), OvPop, 'width=760,height=560');

function RightPanel({ sh, nodeId }: { sh: Sheet; nodeId: string }) {
  const aiTab = aiOn.value && aiPinned.value && aiOpen.value; const rt = (st.rightTab.value as string) === 'ai' && !aiTab ? 'props' : st.rightTab.value as string;
  return <div class="panel">
    <div class="dtabs" role="tablist">{([['props', 'Properties'], ['sheet', 'Sheet'], ['panel', 'Panel'], ...(aiTab ? [['ai', 'AI']] : [])] as [string, string][]).map(([k, l]) => <button role="tab" aria-selected={rt === k} class={rt === k ? 'on' : ''} onClick={() => st.rightTab.value = k as any}>{t(l)}</button>)}<div class="grow" /><button class="iconbtn" title={t('Hide panel')} aria-label={t('Hide panel')} onClick={() => st.D.value?.togglePane('right')}><Icon name="panel-right-close" size={14} /></button></div>
    {rt === 'ai' ? <AiPanel docked /> : rt === 'panel' ? <SidePanel /> : <div class="scroll">{rt === 'props' ? <Props sh={sh} /> : <SheetProps sh={sh} nodeId={nodeId} />}</div>}
  </div>;
}
const Sec = ({ n, title }: { n: string; title: string }) => <h4 class="dsec"><span>{n}</span> // {t(title).toUpperCase()}</h4>;
function Props({ sh }: { sh: Sheet }) {
  const ids = st.selIds(sh.id);
  if (!ids.length) return <div class="insp"><Empty icon="mouse-pointer" title={t('Nothing selected')}><p>{t('Click a part, line or junction. Drag a window to select several (right-to-left also catches parts it crosses).')}</p></Empty>
    <div class="kvgrid"><span>{t('Parts')}</span><b>{sh.components.length}</b><span>{t('Lines')}</span><b>{sh.pipes.length}</b><span>{t('Junctions')}</span><b>{sh.junctions.length}</b><span>{t('Nets')}</span><b>{netsOf(sh).length}</b></div>
    <h4>{t('Keys')}</h4><div class="dkeys">{E.isElec(sh) ? <><span><kbd>W</kbd> {t('wire')}</span><span><kbd>P</kbd> {t('power wire')}</span><span><kbd>D</kbd> {t('PE wire')}</span></> : <><span><kbd>W</kbd> {t('working line')}</span><span><kbd>P</kbd> {t('pilot line')}</span><span><kbd>D</kbd> {t('drain line')}</span></>}<span><kbd>J</kbd> {t('junction')}</span><span><kbd>R</kbd> {t('rotate')}</span><span><kbd>M</kbd> {t('mirror')}</span><span><kbd>Space</kbd> {t('drag to pan')}</span><span><kbd>Esc</kbd> {t('cancel')}</span><span><kbd>F7</kbd> {t('rule check')}</span></div></div>;
  if (ids.length > 1) return <MultiProps sh={sh} ids={ids} />;
  const id = ids[0]; const k = st.kindOf(sh, id);
  if (k === 'comp') { const c = sh.components.find(x => x.id === id)!; if (isConn(c.ref)) return <ConnProps sh={sh} c={c} />; if (isAsm(c.ref)) return <InstProps sh={sh} c={c} />; return <CompProps sh={sh} c={c} />; }
  if (k === 'pipe') return <PipeProps sh={sh} id={id} />;
  if (k === 'junc') { const j = sh.junctions.find(x => x.id === id)!; const lines = sh.pipes.filter(p => [p.a, p.b].some(e => e && 'j' in e && e.j === id)); return <div class="insp"><h3>{t('Junction')} J{sh.junctions.indexOf(j) + 1}</h3><div class="muted">{t('Connection point (ISO 1219-1: dot where three or more lines join)')}</div><div class="kvgrid"><span>{t('Position')}</span><b>{j.x} · {j.y} mm</b><span>{t('Lines')}</span><b>{lines.length}</b></div><div class="row-end"><Btn kind="danger" icon="trash-2" label={t('Delete')} onClick={() => runCmd('edit.delete')} /></div></div>; }
  if (k === 'text') { const tx = sh.texts.find(x => x.id === id)!; const set = (fn: (q: any) => void, l: string) => S.mutate(l, d => { const q = (d.circuits[sh.id] as Sheet).texts.find(x => x.id === id); if (q) fn(q); });
    return <div class="insp"><h3>{t('Text')}</h3><TextField label={t('Text')} value={tx.s} required onCommit={v => set(q => q.s = v, 'Edit text')} /><NumField label={t('Height')} qty="none" value={tx.h} unit="" units={['']} min={1} max={40} onCommit={v => set(q => q.h = v, 'Text height')} /></div>; }
  if (k === 'encl') { const en = sh.enclosures.find(x => x.id === id)!; const set = (fn: (q: any) => void, l: string) => S.mutate(l, d => { const q = (d.circuits[sh.id] as Sheet).enclosures.find(x => x.id === id); if (q) fn(q); });
    return <div class="insp"><h3>{t('Enclosure')}</h3><div class="muted">{t('Assembly boundary — chain line (ISO 1219-2)')}</div><TextField label={t('Label')} value={en.label || ''} placeholder={t('e.g. Power unit, 1Z1')} onCommit={v => set(q => q.label = v, 'Label enclosure')} />
      <div class="dfgrid"><NumField label={t('Width')} qty="none" value={en.w} unit="" units={['']} min={10} onCommit={v => set(q => q.w = v, 'Resize enclosure')} /><NumField label={t('Height')} qty="none" value={en.h} unit="" units={['']} min={10} onCommit={v => set(q => q.h = v, 'Resize enclosure')} /></div></div>; }
  return null;
}
function MultiProps({ sh, ids }: { sh: Sheet; ids: string[] }) {
  const comps = sh.components.filter(c => ids.includes(c.id)); const pipes = sh.pipes.filter(p => ids.includes(p.id));
  const A = (k: string, ic: string, l: string) => <Btn kind="tb" icon={ic} title={t(l)} onClick={() => st.alignSel(sh.id, ids, k as any)} />;
  return <div class="insp"><h3>{ids.length} {t('items selected')}</h3><div class="kvgrid"><span>{t('Parts')}</span><b>{comps.map(c => c.tag).join(', ') || '—'}</b><span>{t('Lines')}</span><b>{pipes.length}</b></div>
    <h4>{t('Align & distribute')}</h4><div class="dalign">{A('left', 'align-left', 'Align left')}{A('hcentre', 'align-vcentre', 'Align centres (vertical line)')}{A('right', 'align-right', 'Align right')}{A('top', 'align-top', 'Align top')}{A('vcentre', 'align-hcentre', 'Align centres (horizontal line)')}{A('bottom', 'align-bottom', 'Align bottom')}{A('hdist', 'dist-h', 'Distribute horizontally')}{A('vdist', 'dist-v', 'Distribute vertically')}</div>
    {pipes.length > 0 && <><h4>{t('Line type')}</h4><Seg value={pipes.every(p => p.kind === pipes[0].kind) ? pipes[0].kind : ''} options={[['work', t('Working')], ['pilot', t('Pilot')], ['drain', t('Drain')]]} onChange={k => S.mutate('Line type', d => (d.circuits[sh.id] as Sheet).pipes.forEach(p => { if (ids.includes(p.id)) p.kind = k as any; }))} /></>}
    <div class="row-end wrap"><Btn icon="rotate-cw" label={t('Rotate')} onClick={() => runCmd('edit.rotate')} /><Btn icon="square-dashed" label={t('Enclose')} onClick={() => st.encloseSel(sh.id, ids)} /><Btn kind="danger" icon="trash-2" label={t('Delete')} onClick={() => runCmd('edit.delete')} /></div></div>;
}
// small table (load profiles): rows of x / y in display units, stored in SI base
function TableField({ f, value, onSet }: { f: Field; value: any; onSet: (v: any) => void }) {
  const rows: number[][] = Array.isArray(value) ? value : f.def; const [cx, cy] = f.cols!;
  const put = (i: number, j: number, v: number) => { const r = rows.map(x => [...x]); r[i][j] = v * (j ? cy[3] : cx[2]); r.sort((a, b) => a[0] - b[0]); onSet(r); };
  return <div class="fld span2 dtbl"><span class="lbl">{t(f.label)}</span><table><thead><tr><th>{t(cx[0])} ({cx[1]})</th><th>{t(cy[0])} ({cy[1]})</th><th /></tr></thead><tbody>
    {rows.map((r, i) => <tr><td><input class="in" type="number" value={+(r[0] / cx[2]).toFixed(4)} onChange={(e: any) => put(i, 0, +e.target.value)} /></td><td><input class="in" type="number" value={+(r[1] / cy[3]).toFixed(3)} onChange={(e: any) => put(i, 1, +e.target.value)} /></td>
      <td><button class="iconbtn" aria-label={t('Remove row')} disabled={rows.length <= 2} onClick={() => onSet(rows.filter((_, k) => k !== i))}><Icon name="x" size={12} /></button></td></tr>)}</tbody></table>
    <button class="link" onClick={() => { const l = rows[rows.length - 1]; onSet([...rows.map(x => [...x]), [l[0] + (rows.length > 1 ? l[0] - rows[rows.length - 2][0] : 1), l[1]]]); }}>+ {t('Row')}</button>
    <small class="muted">{t('Linear between rows; held constant beyond the first and last row.')}</small></div>;
}
function FieldInput({ f, value, onSet }: { f: Field; value: any; onSet: (v: any) => void }) {
  if (f.qty === 'table') return <TableField f={f} value={value} onSet={onSet} />;
  if (f.qty === 'select') return <label class="fld"><span class="lbl">{t(f.label)}</span><select class="in" value={value ?? f.def} onChange={(e: any) => onSet(e.target.value)}>{f.options!.map(o => <option value={o}>{t(o)}</option>)}</select></label>;
  if (f.qty === 'text') return <TextField label={t(f.label)} value={value ?? f.def} onCommit={onSet} />;
  if (f.qty === 'none') return <NumField label={t(f.label)} qty="none" value={typeof value === 'number' ? value : f.def as number} unit={f.unit || ''} units={[f.unit || '']} min={f.min} max={f.max} onCommit={v => onSet(v)} />;
  const u = unitFor(S.prefs.value.unitSystem, f.qty as any); const base = typeof value === 'number' ? value : f.def as number;
  return <NumField label={t(f.label)} qty={f.qty} value={fromBase(f.qty, u, base)} unit={u} min={f.min != null ? fromBase(f.qty, u, f.min) : undefined} max={f.max != null ? fromBase(f.qty, u, f.max) : undefined} onCommit={(v, uu) => onSet(toBase(f.qty, uu, v))} />;
}
function CompProps({ sh, c }: { sh: Sheet; c: Comp }) {
  const g = geomOf(c.ref); const fields = fieldsFor(g); const [k, iid] = splitRef(c.ref); const [repl, setRepl] = useState(false);
  const elecPart = g.domain === 'electrical'; const tags = allTags(S.project.value); const dupe = !elecPart && tags.filter(x => x === c.tag).length > 1;
  const set = (l: string, fn: (x: Comp) => void, reroute = false) => st.setComp(sh.id, c.id, l, fn, reroute);
  const node = S.project.value?.nodes[sh.id];
  const conns = compPorts(c, g, sh.type).map(p => { const pipes = sh.pipes.filter(q => [q.a, q.b].some(e => e && 'c' in e && e.c === c.id && e.p === p.key)); return { p, list: pipes.map(q => { const other = q.a && 'c' in q.a && q.a.c === c.id && q.a.p === p.key ? q.b : q.a; return `${endLabel(sh, other)} · ${t(LINE[q.kind].label).toLowerCase()}`; }) }; });
  const v = c.values || {}; const bore = v.bore, rod = v.rod;
  const refId = 'std:' + iid; const starred = k === 'std' ? S.isStarred(refId) : S.isStarred('lib:' + iid);
  return <div class="insp">
    <h3 class="dtitle">{c.tag} · {g.name}</h3>
    <div class="muted">{k === 'lib' ? t('Custom part') : t('Standard part')} · {g.standard} · {t('placed on')} “{sh.name}”</div>
    {g.kind === 'missing' && <p class="note-i bad">{t('This library part is not available in this browser. Re-import it or replace the part.')}</p>}
    <Sec n="01" title="Identity" />
    <div class="dfgrid">
      <TextField label={t('Tag')} value={c.tag} required maxLength={12} onCommit={vv => { if (!elecPart && tags.includes(vv) && vv !== c.tag) S.toast(t('Tag already used — the rule check will flag it'), 'warn'); set('Tag', x => { x.tag = vv; }); }} />
      <label class="fld"><span class="lbl">{t('Assembly')}</span><input class="in" readOnly value={node?.parent ? S.project.value?.nodes[node.parent]?.name || '' : ''} /></label>
    </div>
    {!elecPart && (dupe || !TAG_RE.test(c.tag)) && <div class="dwarn">{dupe ? t('Tag used more than once in this project') : t('ISO 1219-2 form: circuit number, code letter, number — e.g.') + ` 1${g.letter}1 (${t(LETTER_NAME[g.letter])})`}</div>}
    <TextField label={t('Description')} value={c.desc || ''} placeholder={t('e.g. Clamp cylinder')} onCommit={vv => set('Description', x => { x.desc = vv; })} />
    <label class="fld"><span class="lbl">{t('Tag label')}</span><Seg value={c.labelPos || 'right'} options={[['right', t('Right')], ['left', t('Left')], ['top', t('Top')], ['bottom', t('Bottom')], ['hidden', t('Hidden')]]} onChange={vv => set('Label position', x => { x.labelPos = vv as any; })} /></label>
    <div class="dfgrid"><label class="fld"><span class="lbl">{t('Rotation')}</span><Seg value={String(c.rot || 0)} options={[['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']]} onChange={vv => set('Rotate', x => { x.rot = +vv; }, true)} /></label>
      <label class="fld"><span class="lbl">{t('Mirror')}</span><Seg value={c.mirror ? 'y' : 'n'} options={[['n', t('Off')], ['y', t('On')]]} onChange={vv => set('Mirror', x => { x.mirror = vv === 'y'; }, true)} /></label></div>
    {Sim.simView.value?.sheet === sh.id && <LiveBox k={c.id} />}
    <Sec n="02" title="Values on this instance" />
    {fields.filter(f => !f.sim).length ? <div class="dfgrid">{fields.filter(f => !f.sim).map(f => <FieldInput f={f} value={v[f.key]} onSet={val => set(t(f.label), x => { x.values = { ...(x.values || {}), [f.key]: val }; })} />)}</div> : <p class="muted">{t('This part has no adjustable values.')}</p>}
    {elecPart && <ElecLink sh={sh} c={c} g={g} />}
    {fields.some(f => f.sim) && <><Sec n="03" title="Simulation data" /><SimFields fields={fields.filter(f => f.sim)} values={v} onSet={(key, val, label) => set(label, x => { x.values = { ...(x.values || {}), ...(key === 'preset' && VALVE_PRESETS[val] ? VALVE_PRESETS[val] : {}), [key]: val }; })} /></>}
    {g.cls === 'cylinder' && bore > 0 ? <div class="dnote">{t('Area ratio')} φ {round(bore * bore / Math.max(1e-12, bore * bore - (rod || 0) * (rod || 0)), 4)} : 1 · {t('piston')} {st.fmtQ('area', Math.PI * bore * bore / 4)} · {t('these values feed the simulation')}</div> : fields.length && !elecPart ? <div class="dnote">{t('Pressures, flows and sizes belong to this instance, not to the library part — they feed the simulation.')}</div> : null}
    <Sec n="04" title={elecPart ? 'Terminals & wires' : 'Ports & connections'} />
    {conns.length ? <div class="dports">{conns.map(({ p, list }) => <div class={'dport ' + (p.domain === 'electrical' && !elecPart ? 'el' : list.length ? '' : 'open')}><b>{p.name}</b><span>{p.domain === 'electrical' && !elecPart ? t('electrical — wired on an electric sheet') : list.length ? '→ ' + list.join('; ') : t('open')}</span></div>)}</div> : <p class="muted">{elecPart ? t('No terminals.') : t('No fluid ports (mechanically coupled part).')}</p>}
    {g.valve && <p class="muted small">{t('Valve')} {g.valve.matrix} · {t('positions')} {posLetters(g.valve.boxes.length).join(' · ')} · {t('the definition is stored with the sheet for simulation')}</p>}
    <div class="row-end wrap">
      <Btn icon="replace" label={t('Replace part…')} pressed={repl} onClick={() => setRepl(!repl)} />
      <Btn icon="external-link" label={t('Open in library')} onClick={() => { S.selection.value = { kind: k === 'lib' ? 'custom' : 'std', ids: [iid] }; S.activeTab.value = 'home'; setTimeout(() => focusPanel(k === 'lib' ? 'custom' : 'components'), 50); }} />
      <Btn icon="star" pressed={starred} label={starred ? t('Starred') : t('Star')} onClick={() => { const r = k === 'std' ? refId : 'lib:' + iid; starred ? S.removeStar(r) : S.addStar({ type: 'library_item', target_ref: r, label: g.name, icon: g.valve ? 'git-fork' : 'component', scope: 'project' }); }} />
      {k === 'lib' && g.item && <Btn icon="pencil" label={t('Edit definition')} onClick={() => openTool(g.item.type === 'valve' ? 'valve' : 'symbol', g.item)} />}
    </div>
    {k === 'lib' && (() => { const lib = S.customLib.value.find(x => x.item_id === iid); const mine = S.project.value?.library?.find((x: any) => x.item_id === iid); if (!lib || !mine || (lib.version || 0) <= (mine.version || 0)) return mine ? <p class="muted small">{t('Project copy')} v{mine.version || 0} · {t('the sheet keeps this copy even if the library changes')}</p> : null;
      return <div class="dwarn">{t('The Custom Library has a newer version')} (v{lib.version} · {t('this project uses')} v{mine.version || 0}). <button class="link" onClick={() => S.mutate('Update part definition', d => { const i = (d.library || []).findIndex((x: any) => x.item_id === iid); if (i >= 0) d.library[i] = clone(lib); })}>{t('Update all uses')}</button></div>; })()}
    {repl && <ReplaceList sh={sh} c={c} g={g} onDone={() => setRepl(false)} />}
  </div>;
}
function SimFields({ fields, values, onSet, base }: { fields: Field[]; values: any; onSet: (key: string, val: any, label: string) => void; base?: any }) {
  return <div class="dsimf"><div class="dfgrid">{fields.filter(f => !f.when || f.when(values)).map(f => <div class={'fwrap' + (base && values[f.key] !== undefined && base[f.key] !== values[f.key] ? ' ov' : '')}><FieldInput f={f} value={values[f.key]} onSet={val => onSet(f.key, val, t(f.label))} />{f.hint && <small class="muted">{t(f.hint)}</small>}</div>)}</div>
    <p class="muted small">{t('Simulation data belongs to this placed part, never to the library part.')}</p></div>;
}
function LiveBox({ k }: { k: string }) {
  Sim.simFrame.value; const se = Sim.SIM?.el(k); const r = se?.read?.(Sim.SIM!); if (!se) return <div class="dlive muted">{t('Not simulated')}</div>;
  const ports = se.el ? Object.entries(se.el.ports).map(([kk, nn]) => `${se.el!.g.ports.find(q => q.key === kk)?.name}: ${st.fmtQ('pressure', Sim.SIM!.p[nn])}`) : [];
  return <div class="dlive"><b>{t('LIVE')}</b><span>{r?.text || '—'}</span>{r?.detail && <small>{r.detail}</small>}{ports.length > 0 && <small class="mono">{ports.join(' · ')}</small>}{se.kind === 'valve' && <small>{t('Click a box of the symbol to switch')}</small>}</div>;
}
// ---------- interface port (connector) ----------
function ConnProps({ sh, c }: { sh: Sheet; c: Comp }) {
  const p = S.project.value!; const set = (l: string, fn: (x: Comp) => void) => st.setComp(sh.id, c.id, l, fn); const v = c.values || {};
  const dupe = sh.components.filter(x => isConn(x.ref) && x.tag === c.tag).length > 1; const uses = A.usesOf(p, sh.id);
  const inside = sh.pipes.filter(q => [q.a, q.b].some(e => e && 'c' in e && e.c === c.id)).map(q => { const o = q.a && 'c' in q.a && q.a.c === c.id ? q.b : q.a; return endLabel(sh, o); });
  return <div class="insp"><h3 class="dtitle">{t('Interface port')} {c.tag}</h3>
    <div class="muted">{t('A connection point of this sheet. Where the sheet is placed as an assembly, its line joins only a port with the same tag.')}</div>
    <Sec n="01" title="Identity" />
    <div class="dfgrid"><TextField label={t('Port tag')} value={c.tag} required maxLength={12} onCommit={vv => { const tg = vv.trim().toUpperCase(); if (sh.components.some(x => x.id !== c.id && isConn(x.ref) && x.tag === tg)) S.toast(t('Another port on this sheet has that tag'), 'warn'); set('Port tag', x => { x.tag = tg; }); }} />
      <label class="fld"><span class="lbl">{t('Medium')}</span><input class="in" readOnly value={sh.type} /></label></div>
    {dupe && <div class="dwarn">{t('Port tags must be unique on an assembly sheet')}</div>}
    <label class="fld"><span class="lbl">{t('Line type')}</span><Seg value={v.kind || 'work'} options={[['work', t('Working')], ['pilot', t('Pilot')], ['drain', t('Drain')]]} onChange={k => set('Port line type', x => { x.values = { ...(x.values || {}), kind: k }; })} /></label>
    <TextField label={t('Nominal size')} value={v.size || ''} placeholder={t('e.g. DN10, G1/2')} onCommit={vv => set('Port size', x => { x.values = { ...(x.values || {}), size: vv }; })} />
    <TextField label={t('Description')} value={c.desc || ''} placeholder={t('e.g. Pressure from power unit')} onCommit={vv => set('Description', x => { x.desc = vv; })} />
    <div class="dfgrid"><label class="fld"><span class="lbl">{t('Rotation')}</span><Seg value={String(c.rot || 0)} options={[['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']]} onChange={vv => set('Rotate', x => { x.rot = +vv; })} /></label></div>
    <Sec n="02" title="Connections" />
    <div class="kvgrid"><span>{t('Inside this sheet')}</span><b>{inside.join(', ') || t('not connected')}</b><span>{t('Used as assembly')}</span><b>{uses.length ? uses.map(u => `${p.nodes[u.sheet]?.name} · ${u.comp.tag}`).join(', ') : t('not placed yet')}</b></div>
    <div class="row-end"><Btn kind="danger" icon="trash-2" label={t('Delete')} onClick={() => runCmd('edit.delete')} /></div></div>;
}
// ---------- assembly instance ----------
function InstProps({ sh, c }: { sh: Sheet; c: Comp }) {
  const p = S.project.value!; const g = geomOf(c.ref); const ch = A.childOf(c)!; const csh = p.circuits[ch] as Sheet | undefined; const exp = c.ref.startsWith('asmx:');
  const set = (l: string, fn: (x: Comp) => void, rr = false) => st.setComp(sh.id, c.id, l, fn, rr); const uses = A.usesOf(p, ch);
  const [open, setOpen] = useState<string | null>(null);
  const flat = useMemo(() => csh ? A.flatten(p, ch) : null, [csh, p.circuits]);
  const ov = c.values?.ov || {};
  const conns = g.ports.map(q => { const pipes = sh.pipes.filter(x => [x.a, x.b].some(e => e && 'c' in e && e.c === c.id && e.p === q.key)); return { q, list: pipes.map(x => { const o = x.a && 'c' in x.a && x.a.c === c.id && x.a.p === q.key ? x.b : x.a; return endLabel(sh, o); }) }; });
  return <div class="insp"><h3 class="dtitle">{c.tag} · {g.name}</h3>
    <div class="muted">{t('Assembly instance')} · {t('source sheet')} “{csh ? p.nodes[ch]?.name || csh.name : t('missing')}” · {t('used')} {uses.length}×</div>
    {g.kind === 'missing' && <p class="note-i bad">{g.name}</p>}
    {Sim.simView.value?.sheet === sh.id && <div class="dlive"><b>{t('LIVE')}</b><span>{t('Expand the instance to see and switch its valves')}</span></div>}
    <Sec n="01" title="Identity" />
    <div class="dfgrid"><TextField label={t('Instance tag')} value={c.tag} required maxLength={14} onCommit={vv => set('Instance tag', x => { x.tag = vv.trim(); })} />
      <label class="fld"><span class="lbl">{t('Show as')}</span><Seg value={exp ? 'x' : 'b'} options={[['b', t('Block')], ['x', t('Circuit')]]} onChange={vv => A.setExpanded(sh.id, [c.id], vv === 'x')} /></label></div>
    <TextField label={t('Description')} value={c.desc || ''} placeholder={t('e.g. Clamp axis 2')} onCommit={vv => set('Description', x => { x.desc = vv; })} />
    <div class="dfgrid"><label class="fld"><span class="lbl">{t('Rotation')}</span><Seg value={String(c.rot || 0)} options={[['0', '0°'], ['90', '90°'], ['180', '180°'], ['270', '270°']]} onChange={vv => set('Rotate', x => { x.rot = +vv; }, true)} /></label>
      <label class="fld"><span class="lbl">{t('Mirror')}</span><Seg value={c.mirror ? 'y' : 'n'} options={[['n', t('Off')], ['y', t('On')]]} onChange={vv => set('Mirror', x => { x.mirror = vv === 'y'; }, true)} /></label></div>
    <div class="row-end wrap" style={{ justifyContent: 'flex-start' }}><Btn icon="pencil" label={t('Edit in place')} onClick={() => st.D.value?.editInPlace(c.id)} disabled={!csh} /><Btn icon="external-link" label={t('Open sheet')} onClick={() => st.D.value?.openSource(c.id)} disabled={!csh} /><Btn icon="copy-plus" label={t('Make independent copy')} title={t('This instance gets its own copy of the sheet; other uses stay linked')} disabled={!csh || uses.length < 2} onClick={() => A.makeIndependent(sh.id, c.id)} /></div>
    <Sec n="02" title="Ports & links" />
    {conns.length ? <div class="dports">{conns.map(({ q, list }) => <div class={'dport ' + (list.length ? '' : 'open')}><b>{q.name}</b><span>{list.length ? '→ ' + list.join('; ') : t('open — link it to a port with the same tag')}</span></div>)}</div> : <p class="muted">{t('The assembly has no interface ports yet. Add “Port X” on its sheet.')}</p>}
    <Sec n="03" title="Values on this instance" />
    <p class="muted small">{t('Set pressures, flows and sizes for this use only. Unchanged values come from the assembly sheet.')}</p>
    {flat && <div class="dovlist">{flat.els.map(e => { const fs = fieldsFor(e.g); if (!fs.length) return null; const mine = ov[e.key] || {}; const n = Object.keys(mine).length; const isOpen = open === e.key;
      return <div class={'dov ' + (isOpen ? 'open' : '')}><button class="dovh" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : e.key)}><Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} /><b>{e.tag}</b><span>{e.g.name}</span>{n > 0 && <Badge kind="info">{n} {t('changed')}</Badge>}</button>
        {isOpen && <div class="dovb"><SimFields fields={fs} values={{ ...e.values, ...mine }} base={e.values} onSet={(key, val) => { if (key === 'preset' && VALVE_PRESETS[val]) Object.entries(VALVE_PRESETS[val]).forEach(([kk, vv]) => A.setOverride(sh.id, c.id, e.key, kk, vv)); A.setOverride(sh.id, c.id, e.key, key, val); }} />
          {n > 0 && <Btn kind="ghost" icon="rotate-ccw" label={t('Back to assembly values')} onClick={() => Object.keys(mine).forEach(kk => A.setOverride(sh.id, c.id, e.key, kk, undefined))} />}</div>}</div>; })}</div>}
    <div class="row-end"><Btn kind="danger" icon="trash-2" label={t('Delete')} onClick={() => runCmd('edit.delete')} /></div></div>;
}
function ReplaceList({ sh, c, g, onDone }: { sh: Sheet; c: Comp; g: Geom; onDone: () => void }) {
  const opts = useMemo(() => { const all = [...STD_VALVES.map(v => stdItem(v.id)), ...STD].filter((x: any) => x.domain !== 'electrical'); return all.filter((x: any) => { const gg = geomOf('std:' + x.id); return gg.letter === g.letter && 'std:' + x.id !== c.ref && (gg.domain === g.domain || NEUTRAL.has(gg.cls)); }).slice(0, 60); }, [c.ref]);
  const pick = (ref: string) => {
    const ng = geomOf(ref); const keys = new Set(ng.ports.map(p => p.key));
    S.mutate('Replace part', d => { const sc = d.circuits[sh.id] as Sheet; const x = sc.components.find(q => q.id === c.id); if (!x) return; x.ref = ref; x.values = { ...defaults(ng), ...Object.fromEntries(Object.entries(x.values || {}).filter(([kk]) => fieldsFor(ng).some(f => f.key === kk))) };
      sc.pipes.forEach(p => { (['a', 'b'] as const).forEach(e => { const en = p[e]; if (en && 'c' in en && en.c === c.id && !keys.has(en.p)) p[e] = null; }); if ([p.a, p.b].some(en => en && 'c' in en && en.c === c.id)) p.pts = livePts(sc, p); }); });
    S.toast(t('Part replaced — connections kept where the port names match'), 'ok'); onDone();
  };
  return <div class="dreplace"><h4>{t('Replace with')} ({t(LETTER_NAME[g.letter])})</h4><div class="pgrid">{opts.map((x: any) => <div class="part" role="button" tabIndex={0} title={x.name} onClick={() => pick('std:' + x.id)} onKeyDown={(e: any) => e.key === 'Enter' && pick('std:' + x.id)}><Thumb svg={partSvg(x)} alt="" /><span class="pname">{x.name}</span></div>)}</div></div>;
}
// electrical part ↔ the machine: coil ↔ valve solenoid, contact ↔ its coil, switch / motor ↔ fluid device, sensor ↔ cylinder, PLC address ↔ device
function ElecLink({ sh, c, g }: { sh: Sheet; c: Comp; g: Geom }) {
  const p = S.project.value!; const id = g.item?.id || ''; const setTag = (tg: string) => st.setComp(sh.id, c.id, 'Link tag', x => { x.tag = tg; });
  const setVal = (k: string, v: any) => st.setComp(sh.id, c.id, 'Link', x => { x.values = { ...(x.values || {}), [k]: v }; });
  const goto = (tg?: { sheet: string; comp: string }) => { if (!tg) return; openSheet(tg.sheet); setTimeout(() => { st.setSel(tg.sheet, [tg.comp]); st.viewReq.value = { n: st.viewReq.value.n + 1, kind: 'items', ids: [tg.comp] }; }, 80); };
  const lk = E.linkOf(p, { comp: c, g, sheet: sh }); const fl = E.fluidByTag(p);
  const Pick = ({ label, opts, value, onPick }: { label: string; opts: [string, string][]; value: string; onPick: (v: string) => void }) => <label class="fld"><span class="lbl">{label}</span><select class="in" value={value} onChange={(e: any) => onPick(e.target.value)}><option value="">{t('— choose —')}</option>{opts.map(([v, l]) => <option value={v}>{l}</option>)}</select></label>;
  let body: any = null;
  if (id === 'e_sol') { const sol = E.valveSolenoids(p); const free: [string, string][] = []; E.fluidSheets(p).forEach(fs => fs.components.forEach(v => { const gv = geomOf(v.ref); E.solenoidSides(gv).forEach(sd => free.push([`${v.id}|${sd}|${fs.id}`, `${v.tag} · solenoid ${sd}${v.values?.['y' + sd] ? ' (' + v.values['y' + sd] + ')' : ''} · ${E.sheetName(p, fs.id)}`])); }));
    const cur = sol.find(x => x.tag === c.tag); body = <><Pick label={t('This coil is the solenoid of')} opts={free} value={cur ? `${cur.valve.id}|${cur.side}|${cur.sheet.id}` : ''} onPick={v => { if (!v) return; const [vid, sd, sid] = v.split('|'); const vv = (S.project.value!.circuits[sid] as Sheet).components.find(x => x.id === vid); const tg = String(vv?.values?.['y' + sd] || '').trim() || c.tag;
      S.mutate('Link solenoid', d => { const q = (d.circuits[sid] as Sheet).components.find(x => x.id === vid); if (q) q.values = { ...(q.values || {}), ['y' + sd]: tg }; const me = (d.circuits[sh.id] as Sheet).components.find(x => x.id === c.id); if (me) me.tag = tg; }); }} />
      <p class="muted small">{t('Picking a valve sets the same tag on both: the coil here and “Solenoid a/b tag” on the valve.')}</p></>; }
  else if (E.isRelayContact(g)) { const coils = [...E.xref(p).coils.entries()].map(([tg, l]) => [tg, `${tg} · ${l[0].g.name.split(',')[0]} ${E.locOf(p, l[0].sheet, l[0].comp.x)}`] as [string, string]);
    body = <Pick label={t('Contact of coil')} opts={coils} value={coils.some(x => x[0] === c.tag) ? c.tag : ''} onPick={v => v && setTag(v)} />; }
  else if (/^e_(pswitch|tswitch|float)$/.test(id)) { const re = id === 'e_pswitch' ? /pswitch|pe_switch|vacswitch/ : id === 'e_tswitch' ? /tempswitch|thermo|tempctrl/ : /levelswitch|level/; const opts: [string, string][] = []; fl.forEach((l, tg) => l.forEach(x => { if (re.test(x.g.item?.id || '')) opts.push([tg, `${tg} · ${x.g.name.split(',')[0]} · ${E.sheetName(p, x.sheet.id)}`]); }));
    body = <Pick label={t('Contact of the device')} opts={opts} value={opts.some(o => o[0] === c.tag) ? c.tag : ''} onPick={v => v && setTag(v)} />; }
  else if (g.cls === 'motor' || id === 'e_heater') { const opts: [string, string][] = []; fl.forEach((l, tg) => l.forEach(x => { if (x.g.cls === (id === 'e_heater' ? 'heater' : 'drive')) opts.push([tg, `${tg} · ${x.g.name.split(',')[0]} · ${E.sheetName(p, x.sheet.id)}`]); }));
    body = <Pick label={id === 'e_heater' ? t('Heater on the hydraulic sheet') : t('Drives (prime mover on the hydraulic sheet)')} opts={opts} value={opts.some(o => o[0] === c.tag) ? c.tag : ''} onPick={v => v && setTag(v)} />; }
  else if (E.POS_SENSORS.has(id)) { const opts: [string, string][] = []; fl.forEach((l, tg) => l.forEach(x => { if (x.g.cls === 'cylinder' || x.g.cls === 'rotary') opts.push([tg, `${tg} · ${x.g.name.split(',')[0]} · ${E.sheetName(p, x.sheet.id)}`]); }));
    body = <Pick label={t('Watches cylinder')} opts={opts} value={opts.some(o => o[0] === c.values?.watch) ? c.values!.watch : ''} onPick={v => setVal('watch', v)} />; }
  else if (E.isPlc(g)) { const row = E.plcIo(p).find(r => r.ref.comp.id === c.id); body = <div class="kvgrid"><span>{t('Address')}</span><b>{c.tag}</b><span>{t('Wire')}</span><b>{row?.net || '—'}</b><span>{t('Wired to')}</span><b>{row?.devices.length ? row.devices.map(d => d.ref.comp.tag + (d.link ? ' → ' + d.link.text : '')).join(', ') : t('nothing yet')}</b></div>; }
  if (!body && !lk) return null;
  return <><Sec n="03" title="Machine link" />{body}
    {lk && <div class={'dlinkrow ' + (lk.ok ? 'ok' : 'bad')}><Icon name={lk.ok ? 'link' : 'unlink'} size={13} /><span>{lk.text}</span>{lk.target && <button class="link" onClick={() => goto(lk.target)}>{t('Show')}</button>}</div>}
    {(E.COIL_IDS.has(id)) && (() => { const l = E.xref(p).contacts.get(c.tag) || []; return l.length ? <div class="kvgrid">{l.map(x => <><span>{x.kind} {x.pins}</span><b>{x.loc}</b></>)}</div> : <p class="muted small">{t('No contacts with this tag yet — place a contact and pick this coil.')}</p>; })()}
  </>;
}
function PipeProps({ sh, id }: { sh: Sheet; id: string }) {
  const p = sh.pipes.find(x => x.id === id)!;
  if (E.isElec(sh)) return <WireProps sh={sh} id={id} />; const pts = livePts(sh, p); const net = netsOf(sh).find(n => n.pipes.includes(id));
  const set = (l: string, fn: (q: any) => void) => S.mutate(l, d => { const q = (d.circuits[sh.id] as Sheet).pipes.find(x => x.id === id); if (q) fn(q); });
  return <div class="insp"><h3>{t(LINE[p.kind].label)}</h3><div class="muted">ISO 1219-1 · {p.kind === 'work' ? t('solid line') : t('dashed line')}</div>
    <label class="fld"><span class="lbl">{t('Line type')}</span><Seg value={p.kind} options={[['work', t('Working')], ['pilot', t('Pilot')], ['drain', t('Drain')]]} onChange={k => set('Line type', q => { q.kind = k; })} /></label>
    <div class="dfgrid"><TextField label={t('Nominal size / hose')} value={p.size || ''} placeholder={t('e.g. DN10, 12L tube, 1/2" hose')} onCommit={v => set('Line size', q => { q.size = v; })} />
      <FieldInput f={{ key: 'len', label: 'Real length (simulation)', qty: 'length', def: 0, min: 0 }} value={p.len || 0} onSet={v => set('Line length', q => { q.len = v > 0 ? v : undefined; })} /></div>
    {Sim.simView.value?.sheet === sh.id && (() => { Sim.simFrame.value; const nn = Sim.SIM?.f.pipeNode.get('|' + id); return nn != null ? <div class="dlive"><b>{t('LIVE')}</b><span>{st.fmtQ('pressure', Sim.SIM!.p[nn])}</span><small>{Sim.SIM!.f.labels[nn].join(', ')}</small></div> : null; })()}
    <div class="kvgrid"><span>{t('From')}</span><b>{endLabel(sh, p.a)}</b><span>{t('To')}</span><b>{endLabel(sh, p.b)}</b><span>{t('Net')}</span><b>{net?.id || '—'}</b><span>{t('Drawn length')}</span><b>{Math.round(pipeLen(pts))} mm</b><span>{t('Bends')}</span><b>{Math.max(0, pts.length - 2)}</b></div>
    {(!p.a || !p.b) && <div class="dwarn">{t('Open end — connect it to a port or a junction')}</div>}
    <p class="muted small">{t('Drag a straight segment to move it; the bends follow. Right-click for line type and junctions.')}</p>
    <div class="row-end"><Btn kind="danger" icon="trash-2" label={t('Delete')} onClick={() => runCmd('edit.delete')} /></div></div>;
}
function WireProps({ sh, id }: { sh: Sheet; id: string }) {
  const w = sh.pipes.find(x => x.id === id)!; const pr = S.project.value; const no = E.wireNo(pr, sh.id, id); const pts = livePts(sh, w);
  const set = (l: string, fn: (q: any) => void) => S.mutate(l, d => { const q = (d.circuits[sh.id] as Sheet).pipes.find(x => x.id === id); if (q) fn(q); });
  return <div class="insp"><h3>{t(LINE[w.kind]?.label || 'Wire')} · {no}</h3><div class="muted">IEC 60617 · IEC 61082 · {t('wire numbers name the whole connected net')}</div>
    <label class="fld"><span class="lbl">{t('Wire type')}</span><Seg value={w.kind} options={[['wire', t('Control')], ['power', t('Power')], ['pe', 'PE']]} onChange={k => set('Wire type', q => { q.kind = k; })} /></label>
    <div class="dfgrid"><TextField label={t('Wire number (blank = automatic)')} value={w.wno || ''} placeholder={no} onCommit={v => set('Wire number', q => { q.wno = v.trim() || undefined; })} />
      <TextField label={t('Cross-section / colour')} value={w.size || ''} placeholder={t('e.g. 0.75 mm² BU')} onCommit={v => set('Wire size', q => { q.size = v; })} /></div>
    <div class="kvgrid"><span>{t('From')}</span><b>{endLabel(sh, w.a)}</b><span>{t('To')}</span><b>{endLabel(sh, w.b)}</b><span>{t('Location')}</span><b>{E.locOf(pr, sh, pts[0][0])}</b><span>{t('Drawn length')}</span><b>{Math.round(pipeLen(pts))} mm</b></div>
    {(!w.a || !w.b) && <div class="dwarn">{t('Open end — connect it to a terminal or a junction')}</div>}
    <p class="muted small">{t('Wires with the same net label name (e.g. +24V) are one potential, also across sheets.')}</p>
    <div class="row-end"><Btn kind="danger" icon="trash-2" label={t('Delete')} onClick={() => runCmd('edit.delete')} /></div></div>;
}
function SheetProps({ sh, nodeId }: { sh: Sheet; nodeId: string }) {
  const set = (l: string, fn: (c: Sheet) => void) => S.mutate(l, d => { const c = d.circuits[sh.id] as Sheet; if (c) fn(c); });
  const tb = sh.title || {}; const m = S.project.value!.manifest;
  const tf = (k: keyof NonNullable<Sheet['title']>, l: string, ph = '') => <TextField label={t(l)} value={(tb as any)[k] || ''} placeholder={ph} onCommit={v => set('Title block', c => { c.title = { ...(c.title || {}), [k]: v }; })} />;
  return <div class="insp">
    <Sec n="01" title="Sheet" />
    <TextField label={t('Sheet name (title)')} value={sh.name} required onCommit={v => S.renameNode(nodeId, v)} />
    <div class="kvgrid"><span>{t('Medium')}</span><b>{sh.type}</b><span>{t('Standard')}</span><b>{E.isElec(sh) ? 'IEC 60617 / IEC 61082 / IEC 81346' : 'ISO 1219-1 / -2'}</b></div>
    {E.isElec(sh) && <label class="fld"><span class="lbl">{t('Wire numbers on the drawing')}</span><Seg value={sh.wireNos === false ? 'off' : 'on'} options={[['on', t('Show')], ['off', t('Hide')]]} onChange={v => set('Wire numbers', c => { c.wireNos = v === 'on'; })} /></label>}
    <label class="fld"><span class="lbl">{t('Canvas')}</span><Seg value={isInfinite(sh) ? 'inf' : 'sheet'} options={[['sheet', t('Sheet (paper)')], ['inf', t('Infinite canvas')]]} onChange={v => setMode(sh, nodeId, v === 'inf')} /></label>
    {isInfinite(sh) && <p class="muted small">{t('No frame or edges. PDF and print fit the drawing onto the paper you choose; SVG, PNG and DXF export the drawing at 1:1.')}</p>}
    {!isInfinite(sh) && <><label class="fld"><span class="lbl">{t('Paper size')} (ISO 5457)</span><Seg value={sh.size} options={Object.keys(PAPER).map(k => [k, k])} onChange={v => { set('Paper size', c => { c.size = v; }); S.mutate('Paper size', d => { if (d.nodes[nodeId]) d.nodes[nodeId].size = v; }); st.views.delete(sh.id); st.viewReq.value = { n: st.viewReq.value.n + 1, kind: 'fit' }; }} /></label>
    <div class="dfgrid"><label class="fld"><span class="lbl">{t('Orientation')}</span><Seg value={sh.orient || 'landscape'} options={[['landscape', t('Landscape')], ['portrait', t('Portrait')]]} onChange={v => { set('Orientation', c => { c.orient = v as any; }); st.viewReq.value = { n: st.viewReq.value.n + 1, kind: 'fit' }; }} /></label>
      <label class="fld"><span class="lbl">{t('Drawing scale')}</span><select class="in" value={String(sh.scale || 1)} onChange={(e: any) => { set('Drawing scale', c => { c.scale = +e.target.value; }); st.viewReq.value = { n: st.viewReq.value.n + 1, kind: 'fit' }; }}>{SCALES.map(([s, l]) => <option value={String(s)}>{l}</option>)}</select></label></div>
    <div class="dfgrid"><label class="fld"><span class="lbl">{t('Grid')}</span><select class="in" value={String(sh.grid || 5)} onChange={(e: any) => set('Grid', c => { c.grid = +e.target.value; })}>{[2.5, 5, 10].map(g => <option value={String(g)}>{g} mm</option>)}</select></label>
      <NumField label={t('Circuit no. for new tags')} qty="none" value={sh.circuitNo || 1} unit="" units={['']} min={0} max={99} onCommit={v => set('Circuit number', c => { c.circuitNo = Math.round(v); })} /></div></>}
    {isInfinite(sh) && <div class="dfgrid"><label class="fld"><span class="lbl">{t('Grid')}</span><select class="in" value={String(sh.grid || 5)} onChange={(e: any) => set('Grid', c => { c.grid = +e.target.value; })}>{[2.5, 5, 10].map(g => <option value={String(g)}>{g} mm</option>)}</select></label>
      <NumField label={t('Circuit no. for new tags')} qty="none" value={sh.circuitNo || 1} unit="" units={['']} min={0} max={99} onCommit={v => set('Circuit number', c => { c.circuitNo = Math.round(v); })} /></div>}
    <Sec n="02" title="Title block (ISO 7200)" />
    {tf('company', 'Legal owner', m.company || '')}
    <div class="dfgrid">{tf('drawnBy', 'Created by', m.author || '')}{tf('checkedBy', 'Approved by')}</div>
    <div class="dfgrid">{tf('drawingNo', 'Identification no.')}{tf('rev', 'Revision')}</div>
    {tf('date', 'Date of issue', new Date().toISOString().slice(0, 10))}
    <Sec n="03" title="Tools" />
    <div class="row-end wrap" style={{ justifyContent: 'flex-start' }}><Btn icon="list-ordered" label={t('Renumber tags')} onClick={() => st.renumberTags(sh.id)} />{E.isElec(sh) ? <Btn icon="sheet" label={t('Wire list')} onClick={() => st.D.value?.exportAs('wires')} /> : <Btn icon="network" label={t('Export netlist')} onClick={() => st.D.value?.exportAs('netlist')} />}<Btn icon="printer" label={t('Print…')} onClick={() => st.D.value?.exportAs('print')} /></div>
  </div>;
}

// Sheet ⇄ Infinite. Going onto paper picks the smallest sheet and scale that hold the drawing and moves it inside the frame.
function setMode(sh: Sheet, nodeId: string, inf: boolean) {
  if (inf) { S.mutate('Infinite canvas', d => { (d.circuits[sh.id] as Sheet).mode = 'infinite'; }); st.views.delete(sh.id); st.viewReq.value = { n: st.viewReq.value.n + 1, kind: 'fit' }; S.toast(t('Infinite canvas — no frame; double-click empty space to fit the drawing')); return; }
  const fp = fitPaper(sh); const b = contentBB(sh);
  S.mutate('Put on paper', d => { const c = d.circuits[sh.id] as Sheet; c.mode = 'sheet'; c.size = fp.size; c.scale = fp.scale; c.orient = 'landscape'; if (b) { const a = drawArea(c); shiftSheet(c, Math.round((a[0] + 10 * fp.scale - b[0]) / 5) * 5, Math.round((a[1] + 10 * fp.scale - b[1]) / 5) * 5); } if (d.nodes[nodeId]) d.nodes[nodeId].size = fp.size; });
  st.views.delete(sh.id); st.viewReq.value = { n: st.viewReq.value.n + 1, kind: 'fit' }; S.toast(`${t('On paper')}: ${fp.size} · ${scaleLabel(fp.scale)}`, 'ok');
}

// ======================= bottom dock =======================
function BottomDock({ sh, issues }: { sh: Sheet; issues: Issue[] }) {
  const tab = st.dock.value.tab; const deep = sh.components.some(c => isAsm(c.ref)); const rows = deep ? A.bomDeep(sh, S.project.value, st.fmtQ) : bom(sh, st.fmtQ); const nets = useMemo(() => netsOf(sh), [sh]); const simOn = Sim.simView.value?.sheet === sh.id;
  const errs = issues.filter(x => x.level === 'err').length, warns = issues.filter(x => x.level === 'warn').length;
  const setTab = (k: any) => { st.dock.value = { ...st.dock.value, tab: k }; st.saveDock(); };
  const go = (ids?: string[]) => { if (!ids?.length) return; st.setSel(sh.id, ids); st.viewReq.value = { n: st.viewReq.value.n + 1, kind: 'items', ids }; };
  const tagCount: Record<string, number> = {}; allTags(S.project.value).forEach(x => tagCount[x] = (tagCount[x] || 0) + 1);
  return <div class="ddock">
    <div class="dtabs" role="tablist">
      <button role="tab" aria-selected={tab === 'rules'} class={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>{t('Rule check')} · {errs ? `${errs} ${t(errs > 1 ? 'errors' : 'error')}` : warns ? `${warns} ${t(warns > 1 ? 'warnings' : 'warning')}` : t('passed')}</button>
      <button role="tab" aria-selected={tab === 'bom'} class={tab === 'bom' ? 'on' : ''} onClick={() => setTab('bom')}>{t('Parts list (BOM)')} · {rows.length}</button>
      <button role="tab" aria-selected={tab === 'conn'} class={tab === 'conn' ? 'on' : ''} onClick={() => setTab('conn')}>{t('Connections')} · {sh.pipes.length}</button>
      <button role="tab" aria-selected={tab === 'tags'} class={tab === 'tags' ? 'on' : ''} onClick={() => setTab('tags')}>{t('Tags')}</button>
      <button role="tab" aria-selected={tab === 'sim'} class={tab === 'sim' ? 'on' : ''} onClick={() => setTab('sim')}>{t('Simulation')}{simOn ? ' ●' : ''}</button>
      {aiOn.value && <button role="tab" aria-selected={(tab as string) === 'ailog'} class={(tab as string) === 'ailog' ? 'on' : ''} onClick={() => setTab('ailog')}>{t('AI log')}</button>}
      <div class="grow" />
      {tab === 'bom' && <><Btn kind="tb" icon="file-spreadsheet" label="Excel" onClick={() => st.D.value?.exportAs('xlsx')} /><Btn kind="tb" icon="sheet" label="CSV" onClick={() => st.D.value?.exportAs('csv')} /></>}
      {tab === 'conn' && <Btn kind="tb" icon="network" label={t('Netlist JSON')} onClick={() => st.D.value?.exportAs('netlist')} />}
      {tab === 'tags' && <Btn kind="tb" icon="list-ordered" label={t('Renumber')} onClick={() => st.renumberTags(sh.id)} />}
      {tab === 'sim' && <Btn kind="tb" icon="external-link" label={t('Own window')} title={t('Open the graph in its own window — e.g. on a second screen')} onClick={() => st.pops.graph?.()} />}
      <Btn kind="tb" icon="chevron-down" title={t('Hide panel')} onClick={() => st.D.value?.toggleDock()} />
    </div>
    <div class="dockbody">
      {(tab as string) === 'ailog' && (aiOn.value ? <AiLogView /> : null)}
      {tab === 'rules' && <div class="drules">{issues.map(i => <button class={'drule ' + i.level} onClick={() => go(i.ids)} disabled={!i.ids?.length}><span class={'dot ' + (i.level === 'ok' ? 'ok' : i.level)} /><span>{i.text}</span></button>)}</div>}
      {tab === 'bom' && (rows.length ? <table class="dtable"><thead><tr><th>#</th><th>{t('Tag')}</th><th>{t('Part')}</th><th>{t('Values')}</th><th>{t('Standard')}</th><th>{t('Qty')}</th></tr></thead><tbody>{rows.map(r => <tr onClick={() => go([sh.components.find(c => c.tag === r.tag.split('/')[0])?.id!].filter(Boolean))}><td>{r.item}</td><td><b>{r.tag}</b></td><td>{r.name}</td><td class="mono">{r.values}</td><td>{r.standard}</td><td>{r.qty}</td></tr>)}</tbody></table> : <p class="muted pad">{t('No parts on this sheet yet.')}</p>)}
      {tab === 'conn' && (nets.length ? <table class="dtable"><thead><tr><th>{t('Net')}</th><th>{t('Line type')}</th><th>{t('Joins')}</th><th>{t('Lines')}</th></tr></thead><tbody>{nets.map(n => { const kinds = [...new Set(n.pipes.map(pid => sh.pipes.find(p => p.id === pid)?.kind))]; return <tr onClick={() => go(n.pipes)}><td><b>{n.id}</b></td><td>{kinds.map(k => t(LINE[k!]?.label || '')).join(' + ')}</td><td class="mono">{n.ports.map(q => { const c = sh.components.find(x => x.id === q.c)!; return `${c.tag}.${geomOf(c.ref).ports.find(p => p.key === q.p)?.name ?? q.p}`; }).join(', ') || '—'}</td><td>{n.pipes.length}</td></tr>; })}</tbody></table> : <p class="muted pad">{t('No lines drawn yet. Click a port to start a working line.')}</p>)}
      {tab === 'sim' && (st.popWins.value.graph ? <div class="dsimoff"><Icon name="external-link" size={18} /><div><b>{t('The graph is open in its own window')}</b><p><Btn kind="tb" label={t('Bring it back here')} onClick={() => st.pops.graph?.()} /></p></div></div> : <SimDock sh={sh} />)}
      {tab === 'bom' && deep && <p class="muted small pad0">{t('Machine parts list: assemblies are expanded; tags show the instance path (e.g. U2/1V1).')}</p>}
      {tab === 'tags' && <table class="dtable"><thead><tr><th>{t('Tag')}</th><th>{t('Group (ISO 1219-2)')}</th><th>{t('Part')}</th><th>{t('Description')}</th></tr></thead><tbody>{sh.components.slice().sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true })).map(c => { const g = geomOf(c.ref); const bad = tagCount[c.tag] > 1 || !TAG_RE.test(c.tag); return <tr class={bad ? 'bad' : ''} onClick={() => go([c.id])}><td><b>{c.tag}</b>{bad && ' ⚠'}</td><td>{g.letter} · {t(LETTER_NAME[g.letter])}</td><td>{g.name}</td><td>{c.desc || ''}</td></tr>; })}</tbody></table>}
    </div>
  </div>;
}

// electric sheets: rule check, parts list, wires, terminals, PLC I/O and the machine tag table
function ElecDock({ sh, issues }: { sh: Sheet; issues: Issue[] }) {
  const p = S.project.value!; const raw = st.dock.value.tab as string; const tab = ['rules', 'bom', 'wires', 'terms', 'plc', 'mtags'].includes(raw) ? raw : 'rules';
  const rows = bom(sh, st.fmtQ); const errs = issues.filter(x => x.level === 'err').length, warns = issues.filter(x => x.level === 'warn').length;
  const setTab = (k: any) => { st.dock.value = { ...st.dock.value, tab: k }; st.saveDock(); };
  const go = (ids?: string[]) => { if (!ids?.length) return; st.setSel(sh.id, ids); st.viewReq.value = { n: st.viewReq.value.n + 1, kind: 'items', ids }; };
  const goAny = (tg?: { sheet: string; comp: string }) => { if (!tg) return; if (tg.sheet === sh.id) { go([tg.comp]); return; } openSheet(tg.sheet); setTimeout(() => { st.setSel(tg.sheet, [tg.comp]); st.viewReq.value = { n: st.viewReq.value.n + 1, kind: 'items', ids: [tg.comp] }; }, 80); };
  const io = useMemo(() => E.plcIo(p), [p.circuits]); const mt = useMemo(() => E.machineTags(p), [p.circuits]);
  const terms = sh.components.filter(c => geomOf(c.ref).item?.id === 'e_terminal').sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }) || (+(a.values?.tno || 0) - +(b.values?.tno || 0)));
  const Tab = (k: string, l: string) => <button role="tab" aria-selected={tab === k} class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>;
  const open = mt.filter(r => r.status !== 'linked').length;
  return <div class="ddock">
    <div class="dtabs" role="tablist">
      {Tab('rules', `${t('Rule check')} · ${errs ? `${errs} ${t(errs > 1 ? 'errors' : 'error')}` : warns ? `${warns} ${t(warns > 1 ? 'warnings' : 'warning')}` : t('passed')}`)}
      {Tab('bom', `${t('Parts list (BOM)')} · ${rows.length}`)}{Tab('wires', `${t('Wires')} · ${sh.pipes.length}`)}{Tab('terms', `${t('Terminals')} · ${terms.length}`)}{Tab('plc', `${t('PLC I/O')} · ${io.length}`)}{Tab('mtags', `${t('Machine tags')}${open ? ' · ' + open + ' ' + t('open') : ''}`)}
      <div class="grow" />
      {tab === 'bom' && <><Btn kind="tb" icon="file-spreadsheet" label="Excel" onClick={() => st.D.value?.exportAs('xlsx')} /><Btn kind="tb" icon="sheet" label="CSV" onClick={() => st.D.value?.exportAs('csv')} /></>}
      {tab === 'wires' && <Btn kind="tb" icon="sheet" label="CSV" onClick={() => st.D.value?.exportAs('wires')} />}
      {tab === 'terms' && <Btn kind="tb" icon="sheet" label="CSV" onClick={() => st.D.value?.exportAs('terminals')} />}
      {tab === 'plc' && <Btn kind="tb" icon="sheet" label="CSV" onClick={() => st.D.value?.exportAs('plcio')} />}
      {tab === 'mtags' && <><Btn kind="tb" icon="sheet" label="CSV" onClick={() => st.D.value?.exportAs('tags')} /><Btn kind="tb" icon="network" label={t('Links JSON')} onClick={() => st.D.value?.exportAs('links')} /></>}
      <Btn kind="tb" icon="chevron-down" title={t('Hide panel')} onClick={() => st.D.value?.toggleDock()} />
    </div>
    <div class="dockbody">
      {tab === 'rules' && <div class="drules">{issues.map(i => <button class={'drule ' + i.level} onClick={() => go(i.ids)} disabled={!i.ids?.length}><span class={'dot ' + (i.level === 'ok' ? 'ok' : i.level)} /><span>{i.text}</span></button>)}</div>}
      {tab === 'bom' && (rows.length ? <table class="dtable"><thead><tr><th>#</th><th>{t('Tag')}</th><th>{t('Part')}</th><th>{t('Values')}</th><th>{t('Standard')}</th><th>{t('Qty')}</th></tr></thead><tbody>{rows.map(r => <tr onClick={() => go(sh.components.filter(c => c.tag === r.tag).map(c => c.id))}><td>{r.item}</td><td><b>{r.tag}</b></td><td>{r.name}</td><td class="mono">{r.values}</td><td>{r.standard}</td><td>{r.qty}</td></tr>)}</tbody></table> : <p class="muted pad">{t('No parts on this sheet yet.')}</p>)}
      {tab === 'wires' && (sh.pipes.length ? <table class="dtable"><thead><tr><th>{t('Wire no.')}</th><th>{t('From')}</th><th>{t('To')}</th><th>{t('Type')}</th><th>{t('Size')}</th><th>{t('Location')}</th></tr></thead><tbody>{sh.pipes.map(w => <tr onClick={() => go([w.id])}><td><b class="mono">{E.wireNo(p, sh.id, w.id)}</b></td><td class="mono">{endLabel(sh, w.a)}</td><td class="mono">{endLabel(sh, w.b)}</td><td>{t(LINE[w.kind]?.label || '')}</td><td>{w.size || ''}</td><td class="mono">{E.locOf(p, sh, livePts(sh, w)[0][0])}</td></tr>)}</tbody></table> : <p class="muted pad">{t('No wires drawn yet — click a terminal to start a wire.')}</p>)}
      {tab === 'terms' && (terms.length ? <table class="dtable"><thead><tr><th>{t('Strip')}</th><th>{t('Terminal')}</th><th>{t('Wire no.')}</th><th>{t('Location')}</th></tr></thead><tbody>{terms.map(c => <tr onClick={() => go([c.id])}><td><b>{c.tag}</b></td><td class="mono">{c.values?.tno ?? ''}</td><td class="mono">{E.netLabel(p, E.pinNet(p, sh.id, c.id, geomOf(c.ref).ports[0]?.key))}</td><td class="mono">{E.locOf(p, sh, c.x)}</td></tr>)}</tbody></table> : <p class="muted pad">{t('No terminals on this sheet.')}</p>)}
      {tab === 'plc' && (io.length ? <table class="dtable"><thead><tr><th>{t('Address')}</th><th>{t('Direction')}</th><th>{t('Symbol')}</th><th>{t('Wire')}</th><th>{t('Device')}</th><th>{t('Machine function')}</th></tr></thead><tbody>{io.map(r => <tr onClick={() => goAny({ sheet: r.ref.sheet.id, comp: r.ref.comp.id })}><td><b class="mono">{r.addr}</b></td><td>{r.dir === 'in' ? t('Input') : t('Output')}</td><td class="mono">{r.sym}</td><td class="mono">{r.net}</td><td>{r.devices.map(d => d.ref.comp.tag).join(', ') || '—'}</td><td>{r.devices.map(d => d.link?.text).filter(Boolean).join(', ')}</td></tr>)}</tbody></table> : <p class="muted pad">{t('No PLC inputs or outputs yet — place them from Parts › PLC I/O.')}</p>)}
      {tab === 'mtags' && (mt.length ? <table class="dtable"><thead><tr><th>{t('Tag')}</th><th>{t('Hydraulic / pneumatic')}</th><th>{t('Electrical')}</th><th>{t('PLC')}</th><th>{t('Status')}</th></tr></thead><tbody>{mt.map(r => <tr class={r.status === 'linked' ? '' : 'bad'} onClick={() => goAny(r.go)}><td><b>{r.tag}</b></td><td>{r.fluid}</td><td class="mono">{r.elec || '—'}</td><td class="mono">{r.plc}</td><td>{r.status === 'linked' ? '✓ ' + t('linked') : '⚠ ' + t(r.note)}</td></tr>)}</tbody></table>
        : <p class="muted pad">{t('No shared tags yet. Give a valve its solenoid tags (Properties › Values on the hydraulic sheet) or place a solenoid coil here and pick its valve.')}</p>)}
    </div>
  </div>;
}

function SimDock({ sh }: { sh: Sheet }) {
  const v = Sim.simView.value; const on = v?.sheet === sh.id; Sim.simFrame.value; const cv = useRef<HTMLCanvasElement>(null); const [cur, setCur] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const geo = useRef({ t0: 0, t1: 1, W: 1 });
  useEffect(() => { const c = cv.current; if (!c || !on) return; const r = c.getBoundingClientRect(); const dpr = devicePixelRatio || 1; c.width = Math.max(10, r.width * dpr); c.height = Math.max(10, r.height * dpr); const g = c.getContext('2d')!; g.scale(dpr, dpr); const W = r.width, H = r.height;
    g.clearRect(0, 0, W, H); g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); const T = Sim.traces; if (T.t.length < 2) return; const t0 = Math.max(T.t[0], T.t[T.t.length - 1] - 20), t1 = T.t[T.t.length - 1]; geo.current = { t0, t1, W }; const X = (tt: number) => 8 + (tt - t0) / Math.max(1e-6, t1 - t0) * (W - 16);
    g.strokeStyle = '#E3E9EF'; g.lineWidth = 1; for (let i = 0; i <= 4; i++) { const y = 8 + i * (H - 24) / 4; g.beginPath(); g.moveTo(8, y); g.lineTo(W - 8, y); g.stroke(); }
    g.fillStyle = '#5B6878'; g.font = '10px JetBrains Mono, monospace'; g.fillText(`${t0.toFixed(1)} s`, 8, H - 4); g.fillText(`${t1.toFixed(1)} s`, W - 50, H - 4);
    // each signal on its own scale (min…max of what is shown)
    T.list.forEach(tr => { let lo = Infinity, hi = -Infinity; T.t.forEach((tt, i) => { const y = tr.pts[i]; if (tt >= t0 && isFinite(y)) { lo = Math.min(lo, y); hi = Math.max(hi, y); } }); if (!isFinite(lo)) return; if (tr.unit === '%') { lo = Math.min(lo, 0); hi = Math.max(hi, 100); } if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
      g.strokeStyle = tr.color; g.lineWidth = 1.6; g.beginPath(); let first = true; T.t.forEach((tt, i) => { const y0 = tr.pts[i]; if (tt < t0 || !isFinite(y0)) return; const x = X(tt), y = 8 + (1 - (y0 - lo) / (hi - lo)) * (H - 24); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }); g.stroke(); });
    [['a', '#111'], ['b', '#B45309']].forEach(([k, col]) => { const tc = (cur as any)[k]; if (tc == null || tc < t0) return; const x = X(tc); g.strokeStyle = col; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x, 4); g.lineTo(x, H - 14); g.stroke(); g.setLineDash([]); g.fillStyle = col; g.fillText(k.toUpperCase(), x + 3, 12); });
  });
  if (!on) return <div class="dsimoff"><Icon name="play" size={18} /><div><b>{t('Simulation')}</b><p>{t('Press Simulate (F5). Click any box of a directional valve to switch it there — it stays until you click another box, whatever its operator (solenoid, spring, lever …). Click a throttle, pressure valve, pump or cylinder to adjust it while running. Right-click a line or part to plot it.')}</p>
    <p class="muted small">{t('Assemblies are simulated as one machine. Pressures, flows and sizes come from each placed part (Properties → Values / Simulation data). Flow arrows: Preferences › Simulation.')}</p></div></div>;
  const els = Sim.SIM?.els.filter(e => e.read && e.kind !== 'tank' && e.kind !== 'vent') || []; const S2 = Sim.SIM!;
  const issues = [...(v!.issues || []).filter(i => i.level !== 'ok'), ...v!.warns.map(w => ({ level: 'warn' as const, text: w }))];
  const at = (tc: number | null, tr: Sim.Trace) => { if (tc == null) return null; const T = Sim.traces.t; let i = T.findIndex(x => x >= tc); if (i < 0) i = T.length - 1; return tr.pts[i]; };
  const pick = (e: MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const { t0, t1, W } = geo.current; const tt = t0 + (e.clientX - r.left - 8) / Math.max(1, W - 16) * (t1 - t0); setCur(c => e.shiftKey ? { ...c, b: tt } : { ...c, a: tt }); };
  const go = (k: string) => { if (k.startsWith('|')) { st.setSel(sh.id, [k.slice(1)]); return; } const id = k.split('/')[0]; if (sh.components.some(c => c.id === id)) st.setSel(sh.id, [id]); };
  const keep = () => { const n = Sim.liveChanged.size; if (!n) return; const lockMsg = S.editLock.value; S.editLock.value = null;
    try { Sim.liveChanged.forEach((m, key) => { const se: any = Sim.SIM?.el(key); if (!se?.el) return; const vals: Record<string, any> = {};
      Object.entries(m).forEach(([k, val]) => { if (k === 'open') vals.open = val * 100; else if (k === 'disp') vals.disp = val * 100; else if (k === 'set') vals.set = val; else if (k === 'n') vals.n = val; else if (k === 'load') { if (String(se.el.values.lmode || 'Constant') === 'Constant') vals.fext = val; } });
      const parts = key.split('/'); if (parts.length === 1) st.setComp(sh.id, key, 'Keep live settings', x => { x.values = { ...(x.values || {}), ...vals }; });
      else { const inst = parts[0]; const rel = parts.slice(1).join('/'); Object.entries(vals).forEach(([k, val]) => A.setOverride(sh.id, inst, rel, k, val)); } }); }
    finally { S.editLock.value = lockMsg; } Sim.liveChanged.clear(); S.toast(`${t('Kept the live settings of')} ${n} ${t('part(s)')}`, 'ok'); };
  const al = [...Sim.alertLog.entries()];
  return <div class="dsimdock">
    <div class="dsimlist">
      <div class="dsimbar"><span class="mono">{t('Oil')} {S2.thermal.T.toFixed(1)} °C · ν {S2.nu().toFixed(1)} cSt</span><div class="grow" />{Sim.liveChanged.size > 0 && <Btn kind="tb" icon="sim-check" label={t('Keep these settings') + ` (${Sim.liveChanged.size})`} title={t('Write the values set while running back to the parts')} onClick={keep} />}</div>
      {al.length > 0 && <div class="drules">{al.slice(-8).map(([k, a]) => <div class={'drule warn ' + (S2.alerts.has(k) ? 'now' : '')} role="button" tabIndex={0} onClick={() => go(k)}><span class="dot warn" /><span>{a.text}</span><small class="mono">{a.t.toFixed(2)} s{S2.alerts.has(k) ? ' · ' + t('now') : ''}</small></div>)}</div>}
      {issues.length > 0 && <div class="drules">{issues.slice(0, 6).map(i => <div class={'drule ' + i.level}><span class={'dot ' + i.level} /><span>{i.text}</span></div>)}</div>}
      <table class="dtable"><thead><tr><th>{t('Tag')}</th><th>{t('Part')}</th><th>{t('Live')}</th></tr></thead><tbody>{els.map(e => { const r = e.read!(S2); return <tr class={(r.on ? 'onrow' : '') + (S2.alerts.has(e.key) ? ' alrow' : '')} onClick={() => go(e.key)}><td><b>{e.tag}</b></td><td>{e.el?.g.name || e.kind}</td><td class="mono">{r.text}{r.detail ? ' · ' + r.detail : ''}</td></tr>; })}</tbody></table></div>
    <div class="dsimplot">
      <div class="dsimleg">{Sim.traces.list.map(tr => { const a = at(cur.a, tr), b = at(cur.b, tr); return <span><i style={{ background: tr.color }} />{tr.label} ({tr.unit}){a != null && isFinite(a) ? <b class="mono"> A {a.toPrecision(4)}</b> : null}{b != null && isFinite(b) ? <b class="mono"> B {b.toPrecision(4)}</b> : null}<button class="x" aria-label={t('Remove from plot')} onClick={() => Sim.removeTrace(tr.key)}>×</button></span>; })}
        <div class="grow" />{cur.a != null && cur.b != null && <span class="mono">Δt {Math.abs(cur.b - cur.a).toFixed(3)} s</span>}
        <Btn kind="tb" icon="sim-download" label="CSV" title={t('Export the plotted signals')} onClick={() => { const blob = new Blob([Sim.tracesCsv()], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (sh.name || 'simulation') + ' — signals.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }} /></div>
      <canvas ref={cv} onClick={pick as any} title={t('Click: cursor A · Shift+click: cursor B')} />
      <small class="muted">{t('Right-click a line or part on the sheet to plot it (up to 8) · click the plot for cursor A, Shift+click for B')}</small></div>
  </div>;
}

// ======================= status bar segment =======================
export function DesignerStatus() {
  const d = st.D.value; const sh = d ? st.sheetById(d.sheetId) : null; if (!sh) return null; const o = st.opts.value;
  return <span class="dstatus">{t('SHEET')} {sh.name} · {sh.size} · {scaleLabel(sh.scale || 1)} · {t('GRID')} {sh.grid || 5} mm · {t('SNAP')} {o.snap ? t('on') : t('off')}{o.ortho ? ' · ORTHO' : ''} · {sh.components.length} {t('parts')} · {sh.pipes.length} {t('lines')}</span>;
}
