// Logic Coder: Blockly program editor + the controller (Run / Pause / Scan / Stop / Reset / E-STOP), watch,
// I/O table with simulate and force, trend, alarms, event log and the rule check.
import { h, Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { produce } from 'immer';
import * as S from '../store';
import { t } from '../i18n';
import { Icon, Btn, Empty, Popover, MenuList, type MenuItem } from '../ui/common';
import { uid, download } from '../util';
import * as L from './state';
import { signals, sigLabel, type Sig, type SigTable } from './signals';
import { compile, HUMAN, HATS, ENTRY_ORDER, topBlocks, type Program, type Var, type PIssue } from './compile';
import { loadBlockly, blockly, ctx, toolbox, defaultWorkspace } from './blocks';
import * as dst from '../designer/state';
import { machineSheet } from './link';
import { LiveNum } from './panel/Widgets';

const leftTab = signal<'progs' | 'vars'>('progs');
const rightTab = signal<'block' | 'prog'>('block');
const dock = signal<{ open: boolean; tab: 'watch' | 'io' | 'trend' | 'alarms' | 'events' | 'rules' }>({ open: true, tab: 'io' });
const panes = signal({ left: true, right: true });
const selBlock = signal<string | null>(null);
const issuesSig = signal<{ prog: string; list: PIssue[]; ok: boolean }>({ prog: '', list: [], ok: true });
const trendIds = signal<string[]>([]);
const simOf = L.simOf;
let WS: any = null; // the visible Blockly workspace

export function LogicCoder({ tab }: { tab: S.Tab }) {
  const p = S.project.value; const n = tab.nodeId ? p?.nodes[tab.nodeId] : null; const pr = n ? L.progOf(p, n.id) : null;
  useEffect(() => { // programs from older files (or just created) get the five entry points; outside undo
    const pp = S.project.value; if (!pp || !n || n.type !== 'program') return; const x = pp.programs[n.id];
    if (!x) S.project.value = produce(pp, (d: any) => { d.programs[n.id] = { id: n.id, name: n.name, language: 'Blocks', ws: defaultWorkspace(), vars: [], scanMs: 10 }; }) as any;
    else if (!x.ws) S.project.value = produce(pp, (d: any) => { const q = d.programs[n.id]; q.ws = defaultWorkspace(); q.vars ||= []; q.scanMs ||= 10; q.language = 'Blocks'; d.nodes[n.id].language = 'Blocks'; }) as any;
  }, [n?.id, !!pr?.ws]);
  if (!p) return <Chooser title={t('Open or create a project to write PLC programs')} />;
  if (!n || n.type !== 'program') return <Chooser title={t('Choose a program')} />;
  if (!pr?.ws) return <div class="hd"><div class="dempty"><Icon name="binary" size={24} /><span>{t('Preparing program…')}</span></div></div>;
  return <LCBody progId={n.id} />;
}

function Chooser({ title }: { title: string }) {
  const p = S.project.value; const list = L.programNodes(p);
  const add = () => { const id = S.addNode('program', null); if (id) S.openSheetTab(id); };
  return <div class="hd"><div class="dchooser">
    <div class="dhead"><Icon name="binary" size={22} /><div><h2>{t('Logic Coder')}</h2><p>{title}</p></div><div class="grow" /><Btn icon="home" label={t('Back to Home')} onClick={() => S.activeTab.value = 'home'} /></div>
    <div class="dbody">{p ? <><div class="row-end wrap" style={{ justifyContent: 'flex-start' }}><Btn kind="primary" icon="plus" label={t('New program')} onClick={add} /></div>
      <h3>{t('Programs in this project')}</h3>{list.length ? <div class="list">{list.map(x => <button class="row" onClick={() => S.openSheetTab(x.id)}><Icon name="binary" />{x.name}<small>{L.isActiveProg(p, x.id) ? t('active') : ''} · {p.programs[x.id]?.ws ? `${countBlocks(p.programs[x.id])} ${t('blocks')}` : (p.programs[x.id]?.language || '')}</small></button>)}</div> : <p class="muted">{t('No programs yet.')}</p>}
      <p class="muted small">{t('A program reads the machine’s inputs and drives its outputs every scan (10 ms). Its blocks use the tags of your sheets: valve solenoids, PLC addresses, cylinders and switches.')}</p></>
      : <div class="row-end wrap" style={{ justifyContent: 'flex-start' }}><Btn kind="primary" icon="file-plus" label={t('New Project…')} onClick={() => import('../commands').then(m => m.runCmd('file.new'))} /></div>}</div></div></div>;
}
const countBlocks = (pr: Program) => { let n = 0; const w = (b: any) => { if (!b) return; n++; Object.values(b.inputs || {}).forEach((i: any) => w(i.block)); w(b.next?.block); }; topBlocks(pr.ws).forEach(w); return n; };

// ======================= body =======================
function LCBody({ progId }: { progId: string }) {
  const p = S.project.value!; const pr = p.programs[progId] as Program; const T = signals(p);
  const run = L.RT.value; const mine = run && run.progId === progId ? run.rt : null; L.tick.value;
  const iss = issuesSig.value.prog === progId ? issuesSig.value : { list: [], ok: true };
  const stale = mine && mine.prog.ws !== pr.ws && mine.state !== 'stopped';
  const pn = panes.value;
  return <div class="hd lc">
    <LCToolbar progId={progId} pr={pr} T={T} />
    {S.readOnly.value && <div class="dctxbar ro"><Icon name="eye" size={14} /><span>{t('Read-only project — you can run the program; editing is off.')}</span><div class="grow" /><Btn label={t('Allow editing')} onClick={() => S.setReadOnly(false)} /></div>}
    {mine?.state === 'estop' && <div class="dctxbar lcbar err"><Icon name="octagon-x" size={14} /><span><b>E-STOP</b> · {t('outputs in safe state, MAIN LOOP halted.')} {mine.estopActive() ? t('Release the E-stop, then press Reset.') : t('E-stop released — press Reset to continue.')}</span></div>}
    {mine?.state === 'fault' && <div class="dctxbar lcbar err"><Icon name="triangle-alert" size={14} /><span><b>{t('FAULT')}</b> · {mine.fault?.text} · {t('fix the cause, then press Reset')}</span><div class="grow" />{mine.fault?.block && <Btn label={t('Show block')} onClick={() => focusBlock(mine.fault!.block!)} />}</div>}
    {stale && <div class="dctxbar"><Icon name="info" size={14} /><span>{t('The program was edited while running — Stop and Run again to use the changes.')}</span></div>}
    {mine?.message && mine.state !== 'stopped' && <div class="dctxbar lcmsg"><Icon name="info" size={14} /><span>{mine.message}</span></div>}
    <div class="hdmain" style={{ gridTemplateColumns: `${pn.left ? '268px' : '30px'} minmax(0,1fr) ${pn.right ? '318px' : '30px'}` }}>
      {pn.left ? <aside class="dleft"><LeftPanel progId={progId} pr={pr} /></aside> : <Strip side="left" />}
      <section class="dcenter"><BlocklyHost key={progId + (S.readOnly.value ? ':ro' : '')} progId={progId} />{dock.value.open && <Dock progId={progId} pr={pr} T={T} issues={iss.list} />}</section>
      {pn.right ? <aside class="dright"><RightPanel progId={progId} pr={pr} T={T} issues={iss.list} /></aside> : <Strip side="right" />}
    </div>
  </div>;
}
function Strip({ side }: { side: 'left' | 'right' }) {
  return <aside class={'dstrip ' + side}><button class="iconbtn" title={t('Show panel')} onClick={() => panes.value = { ...panes.value, [side]: true }}><Icon name={side === 'left' ? 'panel-left-open' : 'panel-right-open'} size={15} /></button>
    {(side === 'left' ? [['progs', 'Programs'], ['vars', 'Variables']] : [['block', 'Block'], ['prog', 'Program']]).map(([k, l]) => <button class="vlabel" onClick={() => { if (side === 'left') leftTab.value = k as any; else rightTab.value = k as any; panes.value = { ...panes.value, [side]: true }; }}>{t(l)}</button>)}</aside>;
}

// ======================= toolbar (controller) =======================
const STATE_TXT: Record<string, string> = { stopped: 'stopped', running: 'running', paused: 'paused', estop: 'E-STOP', fault: 'FAULT' };
function LCToolbar({ progId, pr, T }: { progId: string; pr: Program; T: SigTable }) {
  L.tick.value; const run = L.RT.value; const mine = run && run.progId === progId ? run.rt : null; const other = run && run.progId !== progId && run.rt.state !== 'stopped' ? run : null;
  const st = mine?.state || 'stopped'; const iss = issuesSig.value.prog === progId ? issuesSig.value.list : [];
  const errs = iss.filter(i => i.level === 'err').length, warns = iss.filter(i => i.level === 'warn').length;
  const [menu, setMenu] = useState(false); const ref = useRef<HTMLSpanElement>(null);
  const doRun = () => { const c = L.run(progId); if (c && !c.ok) { dock.value = { open: true, tab: 'rules' }; S.toast(`${c.issues.filter(i => i.level === 'err').length} ${t('errors — the program cannot run yet')}`, 'err'); } };
  const exportItems: MenuItem[] = [{ header: t('Program') }, { label: t('Program (JSON)'), icon: 'file-json', onSelect: () => exportJson(pr) }, { label: t('Import program (JSON)…'), icon: 'import', onSelect: () => importJson(progId) },
    { header: t('Tables') }, { label: t('I/O table (CSV)'), icon: 'sheet', onSelect: () => download(`${fname(pr.name)}_io.csv`, ioCsv(T), 'text/csv') },
    { label: t('Event log (CSV)'), icon: 'sheet', disabled: !mine, onSelect: () => mine && download(`${fname(pr.name)}_events.csv`, mine.eventsCsv(), 'text/csv') },
    { label: t('Timing trace (CSV)'), icon: 'sheet', disabled: !mine || !mine.trace.t.length, onSelect: () => mine && download(`${fname(pr.name)}_trace.csv`, mine.traceCsv(), 'text/csv') }];
  return <div class="dtoolbar" role="toolbar" aria-label={t('Controller')}><div class="dtleft">
    <Btn kind="tb" icon={panes.value.left ? 'panel-left-close' : 'panel-left-open'} title={t('Programs / variables panel')} onClick={() => panes.value = { ...panes.value, left: !panes.value.left }} />
    {st === 'running' ? <Btn kind="primary" icon="pause" label={t('Pause')} title={t('Pause (F6)')} onClick={() => L.pause()} /> : <Btn kind="primary" class="lcrun" icon="play" label={st === 'paused' ? t('Resume') : t('Run')} title={t('Run the program (F5)')} onClick={doRun} />}
    <Btn kind="tb" icon="step-forward" label={t('Scan')} title={t('Execute one scan cycle')} disabled={st === 'running'} onClick={() => { const c = L.scanOnce(progId); if (c && !c.ok) dock.value = { open: true, tab: 'rules' }; }} />
    <Btn kind="tb" icon="square" label={t('Stop')} title={t('Stop — all outputs off')} disabled={st === 'stopped'} onClick={() => L.stop()} />
    <Btn kind="tb" icon="rotate-ccw" label={t('Reset')} title={t('Reset after an E-stop or a fault (runs ON RESET)')} disabled={!mine} onClick={() => L.reset()} />
    <Btn kind="tb" class={'lcestop' + (mine?.estopCmd ? ' on' : '')} icon="octagon-x" label="E-STOP" title={t('Emergency stop — press again to release')} pressed={!!mine?.estopCmd} disabled={!mine || st === 'stopped'} onClick={() => L.estop()} />
    <span class="tsep" />
    <label class="lcpill" title={t('Scan time')}>{t('scan')} <select class="in sm" value={String(pr.scanMs || 10)} disabled={st !== 'stopped'} onChange={(e: any) => L.writeProg(progId, x => { x.scanMs = +e.target.value; })}>{[1, 2, 5, 10, 20, 50, 100].map(v => <option value={String(v)}>{v} ms</option>)}</select></label>
    <label class="lcpill" title={t('Playback speed')}>{t('speed')} <select class="in sm" value={String(L.speed.value)} onChange={(e: any) => L.setSpeed(+e.target.value)}>{[0.1, 0.5, 1, 2, 5].map(v => <option value={String(v)}>{v}×</option>)}</select></label>
    <span class="lcpill mono">t {(mine?.t || 0).toFixed(2)} s</span><span class="lcpill mono">#{mine?.scanNo || 0}</span>
    <span class={'lcstate ' + st}>{t(STATE_TXT[st])}</span>
    {(() => { const p = S.project.value; const lk = mine && mine.state !== 'stopped' ? run!.link : null; const ms = lk ? lk.sheet : machineSheet(p, pr); const nm = ms ? p?.nodes[ms]?.name || '?' : '';
      return <button class={'lcpill lclink' + (lk ? ' on' : '')} title={lk ? t('Running with the hydraulic simulation of this sheet — click to show it') : ms ? t('Run starts this sheet’s hydraulic simulation with the program (change in Program › Runs with)') : t('Runs on its own — inputs are set by hand')} onClick={() => { if (ms && lk) S.openSheetTab(ms); else { rightTab.value = 'prog'; panes.value = { ...panes.value, right: true }; } }}><Icon name={ms ? 'droplets' : 'binary'} size={12} />{ms ? (lk ? t('machine') + ': ' : t('with') + ' ') + nm : t('standalone')}</button>; })()}
    {other && <span class="muted small">{t('Running:')} {S.project.value?.nodes[other.progId]?.name}</span>}
  </div><div class="dtright">
    <Btn kind="tb" icon="layout-dashboard" label={t('Operator panel')} title={t('Buttons, lamps and gauges for the operator (opens as a tab)')} onClick={() => import('./panel/Panel').then(m => m.openPanelTab(progId))} />
    <Btn kind="tb" icon="shield-check" title={t('Rule check')} onClick={() => { dock.value = { open: true, tab: 'rules' }; }}><span>{t('Rule check')}</span>{errs ? <b class="dcount err">{errs}</b> : warns ? <b class="dcount warn">{warns}</b> : <b class="dcount ok">✓</b>}</Btn>
    <span ref={ref}><Btn kind="tb" label={t('Export') + ' ▾'} onClick={() => setMenu(!menu)} /></span>
    <Btn kind="tb" icon={dock.value.open ? 'chevron-down' : 'panel-bottom'} title={t('Controller panel')} onClick={() => dock.value = { ...dock.value, open: !dock.value.open }} />
    <Btn kind="tb" icon={panes.value.right ? 'panel-right-close' : 'panel-right-open'} title={t('Block / program panel')} onClick={() => panes.value = { ...panes.value, right: !panes.value.right }} />
  </div>{menu && ref.current && <Popover anchor={ref.current} placement="bottom-end" onClose={() => setMenu(false)}><MenuList items={exportItems} onDone={() => setMenu(false)} /></Popover>}</div>;
}
const fname = (s: string) => (s || 'program').replace(/[^\w.-]+/g, '_');
function exportJson(pr: Program) { download(`${fname(pr.name)}.hydraprog.json`, JSON.stringify({ format: 'hydra.program', version: 1, name: pr.name, scanMs: pr.scanMs, vars: pr.vars, workspace: pr.ws, estop: pr.estop, estopNc: pr.estopNc }, null, 2), 'application/json'); S.toast(t('Program exported'), 'ok'); }
function importJson(progId: string) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; try { const o = JSON.parse(await f.text()); if (o.format !== 'hydra.program' || !o.workspace) throw new Error(t('Not a HYDRA program file'));
    L.writeProg(progId, x => { x.ws = o.workspace; x.vars = o.vars || []; if (o.scanMs) x.scanMs = o.scanMs; if (o.estop) { x.estop = o.estop; x.estopNc = o.estopNc; } });
    if (WS) { const B = blockly(); ctx.vars = o.vars || []; B.Events.disable(); try { WS.clear(); B.serialization.workspaces.load(o.workspace, WS); } finally { B.Events.enable(); } }
    S.toast(t('Program imported — blocks that refer to parts of another project show “missing component”'), 'ok'); } catch (e: any) { S.toast(e.message, 'err'); } };
  inp.click();
}
function ioCsv(T: SigTable) { const rows = [['Tag', 'Address', 'Direction', 'Machine', 'Unit', 'ID'], ...T.sigs.map(s => [s.tag, s.addr || 'direct', s.dir, s.desc, s.unit || '', s.id]), ...T.cyls.map(c => [c.tag, 'direct', 'cylinder', c.desc, 'end positions', c.id])]; return rows.map(r => r.map(v => /[,"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\n'); }

// ======================= Blockly host =======================
let menusDone = false;
function focusBlock(id: string) { if (!WS) return; const b = WS.getBlockById(id); if (!b) return; b.select(); WS.centerOnBlock(id); selBlock.value = id; }
function toggleBp(progId: string, id: string) { const s = L.bps(progId); if (s.has(id)) s.delete(id); else s.add(id); L.tick.value++; }
function recheck(progId: string) {
  const p = S.project.value; const pr = L.progOf(p, progId); if (!pr) return; const c = compile(pr, signals(p));
  issuesSig.value = { prog: progId, list: c.issues, ok: c.ok };
  if (!WS) return; const byB = new Map<string, string[]>(); c.issues.forEach(i => { if (i.block && (i.level === 'err' || i.level === 'warn')) (byB.get(i.block) || byB.set(i.block, []).get(i.block)!).push((i.level === 'err' ? '⛔ ' : '⚠ ') + i.text); });
  const B = blockly(); B.Events.disable(); try { WS.getAllBlocks(false).forEach((b: any) => { const w = byB.get(b.id); const cur = b.warning ? 1 : 0; if (w) b.setWarningText(w.join('\n')); else if (cur || b.getIcon?.('warning')) b.setWarningText(null); }); } finally { B.Events.enable(); }
}
function refreshFields() { if (!WS) return; WS.getAllBlocks(false).forEach((b: any) => b.inputList.forEach((inp: any) => inp.fieldRow.forEach((f: any) => { if (f.src) { try { f.doValueUpdate_(f.getValue()); f.forceRerender(); } catch { } } }))); }

function BlocklyHost({ progId }: { progId: string }) {
  const ref = useRef<HTMLDivElement>(null); const [err, setErr] = useState(''); const [ready, setReady] = useState(false);
  useEffect(() => {
    let ws: any = null, gone = false, saveT: any = 0, ro: ResizeObserver | null = null;
    const save = () => { clearTimeout(saveT); saveT = 0; if (!ws || S.readOnly.value) return; const B = blockly(); const json = B.serialization.workspaces.save(ws); const pr = L.progOf(S.project.value, progId); if (!pr) return; if (JSON.stringify(json) === JSON.stringify(pr.ws)) return; L.writeProg(progId, x => { x.ws = json; }); recheck(progId); };
    loadBlockly().then(B => {
      if (gone || !ref.current) return; const p = S.project.value; const pr = L.progOf(p, progId)!; ctx.t = signals(p); ctx.vars = pr.vars || [];
      if (!menusDone) { menusDone = true; registerMenus(B); }
      ws = B.inject(ref.current, { toolbox: toolbox(), renderer: 'zelos', theme: B.hydraTheme, media: 'lib/blockly-media/', sounds: false, readOnly: S.readOnly.value, comments: true, collapse: true, disable: true, trashcan: true, maxTrashcanContents: 32,
        grid: { spacing: 24, length: 2, colour: '#DCE3EA', snap: true }, zoom: { controls: true, wheel: false, startScale: 0.8, maxScale: 2.2, minScale: 0.3, scaleSpeed: 1.15, pinch: true }, move: { scrollbars: true, drag: true, wheel: true } });
      WS = ws; ctx.ws = ws;
      B.Events.disable(); try { B.serialization.workspaces.load(pr.ws || defaultWorkspace(), ws); } catch (e: any) { S.notify(t('Some blocks could not be loaded') + ': ' + e.message, 'warn'); } finally { B.Events.enable(); }
      ws.clearUndo();
      ws.registerButtonCallback('hyNewVar', () => newVar(progId));
      ws.addChangeListener((e: any) => { if (e.isUiEvent) { const sb = B.common?.getSelected?.(); const sid = sb && sb.id && ws.getBlockById(sb.id) ? sb.id : null; if (selBlock.value !== sid) selBlock.value = sid; return; } if (!saveT) saveT = setTimeout(save, 300); });
      ro = new ResizeObserver(() => { try { B.svgResize(ws); } catch { } }); ro.observe(ref.current);
      L.lcApi.value = { progId, undo: () => ws.undo(false), redo: () => ws.undo(true) };
      recheck(progId); setReady(true); applyLive(progId, true);
    }).catch(e => setErr(e.message || String(e)));
    return () => { gone = true; if (saveT) save(); ro?.disconnect(); if (ws) { ws.dispose(); } if (WS === ws) { WS = null; ctx.ws = null; } live.clear(); if (L.lcApi.value?.progId === progId) L.lcApi.value = null; };
  }, [progId]);
  // sheets or variables changed: dropdown texts follow the new tags; rule check again
  const p = S.project.value; const pr = p?.programs[progId] as Program | undefined;
  useEffect(() => { if (!ready || !WS) return; ctx.t = signals(p); refreshFields(); recheck(progId); }, [ready, p?.circuits]);
  useEffect(() => { if (!ready || !WS) return; ctx.vars = pr?.vars || []; refreshFields(); recheck(progId); }, [ready, pr?.vars]);
  useEffect(() => { if (ready) applyLive(progId); }, [ready, L.tick.value]);
  return <div class="lc-wsw">{err ? <div class="dempty"><Icon name="triangle-alert" size={24} /><span>{err}</span></div> : !ready && <div class="dempty"><Icon name="binary" size={24} /><span>{t('Loading the block editor…')}</span></div>}<div class="lc-ws" ref={ref} /></div>;
}
// live highlighting: executed blocks glow, waiting blocks pulse (amber when stalled), breakpoints red
const live = new Map<string, string>();
function applyLive(progId: string, force = false) {
  if (!WS) return; const run = L.RT.value; const rt = run && run.progId === progId && run.rt.state !== 'stopped' ? run.rt : null; const want = new Map<string, string>();
  if (rt) { const skip = new Set<string>(); rt.c.seqs.forEach((q: any) => { skip.add(q.block); const cur = rt.seqs[q.name]?.cur; q.steps.forEach((st: any) => { skip.add(st.block); if (st.id === cur) want.set(st.block, 'hy-step'); }); });
    rt.lastExec.forEach(id => { if (!skip.has(id) && !HATS[WS.getBlockById(id)?.type]) want.set(id, 'hy-exec'); }); rt.waits.forEach((w, id) => want.set(id, w.stalled ? 'hy-stall' : 'hy-wait')); if (rt.bpAt) want.set(rt.bpAt, 'hy-at'); if (rt.fault?.block) want.set(rt.fault.block, 'hy-at'); }
  L.bps(progId).forEach(id => { const c = want.get(id); want.set(id, (c ? c + ' ' : '') + 'hy-bp'); });
  const set = (id: string, cls: string | undefined) => { const b = WS.getBlockById(id); const el = b?.getSvgRoot?.(); if (!el) return; el.classList.remove('hy-exec', 'hy-step', 'hy-wait', 'hy-stall', 'hy-at', 'hy-bp'); if (cls) cls.split(' ').forEach(c => el.classList.add(c)); };
  live.forEach((c, id) => { if (want.get(id) !== c) set(id, want.get(id)); });
  want.forEach((c, id) => { if (force || live.get(id) !== c) set(id, c); });
  live.clear(); want.forEach((c, id) => live.set(id, c));
}
function registerMenus(B: any) {
  const R = B.ContextMenuRegistry.registry;
  R.register({ id: 'hy_bp', scopeType: B.ContextMenuRegistry.ScopeType.BLOCK, weight: 0,
    displayText: (s: any) => L.lcApi.value && L.bps(L.lcApi.value.progId).has(s.block.id) ? t('Remove breakpoint') + ' (F9)' : t('Set breakpoint') + ' (F9)',
    preconditionFn: (s: any) => s.block.previousConnection || HATS[s.block.type] ? 'enabled' : 'hidden', callback: (s: any) => L.lcApi.value && toggleBp(L.lcApi.value.progId, s.block.id) });
  R.register({ id: 'hy_show', scopeType: B.ContextMenuRegistry.ScopeType.BLOCK, weight: 1, displayText: () => t('Show the part on its sheet'),
    preconditionFn: (s: any) => goOf(s.block) ? 'enabled' : 'hidden', callback: (s: any) => { const g = goOf(s.block); if (g) showPart(g); } });
  try { const SR = B.ShortcutRegistry.registry; SR.register({ name: 'hy_bp', preconditionFn: (w: any) => !!L.lcApi.value, callback: () => { const id = selBlock.value; if (id && L.lcApi.value) { toggleBp(L.lcApi.value.progId, id); return true; } return false; } }); SR.addKeyMapping(SR.createSerializedKey(120, null), 'hy_bp'); } catch { }
}
const goOf = (b: any) => { const id = b.getFieldValue?.('SIG') || b.getFieldValue?.('CYL'); if (!id || !ctx.t) return null; return ctx.t.byId.get(id)?.go || ctx.t.cylById.get(id)?.go || null; };
function showPart(go: { sheet: string; comp: string }) { S.openSheetTab(go.sheet); setTimeout(() => { dst.setSel(go.sheet, [go.comp]); dst.viewReq.value = { n: dst.viewReq.value.n + 1, kind: 'items', ids: [go.comp] }; }, 60); }

// ======================= variables =======================
async function newVar(progId: string) {
  const nm = (await S.promptDlg(t('New variable'), t('Name (letters, digits, _)'), ''))?.trim(); if (!nm) return;
  if (!/^[A-Za-z_]\w*$/.test(nm)) { S.toast(t('Use letters, digits and _ (start with a letter)'), 'warn'); return; }
  const pr = L.progOf(S.project.value, progId); if (pr?.vars?.some(v => v.name === nm)) { S.toast(t('That name is taken'), 'warn'); return; }
  L.writeProg(progId, x => { (x.vars ||= []).push({ id: uid('v'), name: nm, type: 'BOOL', init: 'FALSE' }); }); leftTab.value = 'vars'; panes.value = { ...panes.value, left: true };
}
function LeftPanel({ progId, pr }: { progId: string; pr: Program }) {
  const lt = leftTab.value;
  return <div class="panel">
    <div class="dtabs" role="tablist">{([['progs', 'Programs'], ['vars', 'Variables']] as const).map(([k, l]) => <button role="tab" aria-selected={lt === k} class={lt === k ? 'on' : ''} onClick={() => leftTab.value = k}>{t(l)}{k === 'vars' ? ` · ${(pr.vars || []).length}` : ''}</button>)}<div class="grow" /><button class="iconbtn" title={t('Hide panel')} onClick={() => panes.value = { ...panes.value, left: false }}><Icon name="panel-left-close" size={14} /></button></div>
    <div class="scroll">{lt === 'progs' ? <Programs progId={progId} pr={pr} /> : <Vars progId={progId} pr={pr} />}</div>
  </div>;
}
function Programs({ progId, pr }: { progId: string; pr: Program }) {
  L.tick.value; const p = S.project.value!; const list = L.programNodes(p); const tops = topBlocks(pr.ws);
  const add = () => { const id = S.addNode('program', null); if (id) S.openSheetTab(id); };
  const setActive = (id: string) => S.mutate('Active program', d => { Object.values(d.programs).forEach((x: any) => { x.active = x.id === id; }); });
  return <div class="insp">
    <h4 class="dsec"><span>01</span> // {t('PROGRAMS OF THIS MACHINE')}</h4>
    <div class="lcprogs">{list.map(n => { const act = L.isActiveProg(p, n.id); const run = L.RT.value?.progId === n.id && L.RT.value.rt.state !== 'stopped';
      return <div class={'lcprog' + (n.id === progId ? ' on' : '')}><button class="lcpn" onClick={() => S.openSheetTab(n.id)}><Icon name="binary" size={14} /><span>{n.name}</span>{run && <span class="lcdot" title={t('running')} />}</button>{act ? <span class="pill">{t('active')}</span> : <button class="linkbtn small" title={t('Make this the program the machine runs')} onClick={() => setActive(n.id)}>{t('set active')}</button>}</div>; })}</div>
    <Btn icon="plus" label={t('New program')} onClick={add} />
    <h4 class="dsec"><span>02</span> // {t('ENTRY POINTS')}</h4>
    <div class="lcentries">{ENTRY_ORDER.concat(['hy_task']).map(k => { const bs = tops.filter((b: any) => b.type === k); if (!bs.length && k === 'hy_task') return null;
      return bs.length ? bs.map((b: any) => <button class="lcentry" onClick={() => focusBlock(b.id)}><b>{HATS[k]}{k === 'hy_task' ? ' ' + (b.fields?.NAME || '') : ''}</b><small>{countChain(b)} {t('blocks')}</small></button>) : <div class="lcentry none"><b>{HATS[k]}</b><small>{t('not used — drag it from Program')}</small></div>; })}</div>
    <p class="muted small">{t('ON START runs once at Run, MAIN LOOP every scan. WAIT and DELAY pause only their own stack. ON E-STOP runs when the E-stop goes active; ON RESET after Reset.')}</p>
  </div>;
}
const countChain = (b: any) => { let n = -1; const w = (x: any) => { if (!x) return; n++; Object.values(x.inputs || {}).forEach((i: any) => w(i.block)); w(x.next?.block); }; w(b); return Math.max(0, n); };
const TYPES: Var['type'][] = ['BOOL', 'INT', 'FLOAT', 'TIME', 'STRING'];
function Vars({ progId, pr }: { progId: string; pr: Program }) {
  const vars = pr.vars || []; const rt = L.RT.value?.progId === progId ? L.RT.value.rt : null; L.tick.value;
  const upd = (id: string, patch: Partial<Var>) => L.writeProg(progId, x => { const v = x.vars!.find(q => q.id === id); if (v) Object.assign(v, patch); });
  const del = (v: Var) => L.writeProg(progId, x => { x.vars = x.vars!.filter(q => q.id !== v.id); });
  return <div class="insp">
    <div class="row-c"><Btn icon="plus" label={t('New variable…')} onClick={() => newVar(progId)} /></div>
    {vars.length ? <div class="lcvars">{vars.map(v => <div class="lcvar">
      <input class="in sm mono" value={v.name} aria-label={t('Name')} onChange={(e: any) => { const nm = e.target.value.trim(); if (/^[A-Za-z_]\w*$/.test(nm) && !vars.some(q => q.name === nm && q.id !== v.id)) upd(v.id, { name: nm }); else { e.target.value = v.name; S.toast(t('Invalid or duplicate name'), 'warn'); } }} />
      <select class="in sm" value={v.type} aria-label={t('Type')} onChange={(e: any) => upd(v.id, { type: e.target.value, init: e.target.value === 'BOOL' ? 'FALSE' : e.target.value === 'STRING' ? '' : '0' })}>{TYPES.map(x => <option>{x}</option>)}</select>
      {v.type === 'BOOL' ? <select class="in sm" value={/^(true|1|on)$/i.test(v.init) ? 'TRUE' : 'FALSE'} aria-label={t('Initial value')} onChange={(e: any) => upd(v.id, { init: e.target.value })}><option>FALSE</option><option>TRUE</option></select>
        : <input class="in sm mono" value={v.init} aria-label={t('Initial value')} title={t('Initial value')} onChange={(e: any) => upd(v.id, { init: e.target.value })} />}
      <button class="iconbtn" title={t('Delete variable')} onClick={() => del(v)}><Icon name="trash-2" size={13} /></button>
      {rt && <span class="lcvarv mono">= {fmtV(rt.v[v.id])}</span>}
      <input class="in sm lcvarc" placeholder={t('comment')} value={v.comment || ''} onChange={(e: any) => upd(v.id, { comment: e.target.value })} />
    </div>)}</div> : <p class="muted small">{t('Variables hold values between scans: flags, set-points, counts. TIME is in seconds.')}</p>}
  </div>;
}
const fmtV = (v: any) => typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : v == null ? '—' : String(v);

// ======================= right: block inspector + program settings =======================
function RightPanel({ progId, pr, T, issues }: { progId: string; pr: Program; T: SigTable; issues: PIssue[] }) {
  const rt = rightTab.value;
  return <div class="panel">
    <div class="dtabs" role="tablist">{([['block', 'Block'], ['prog', 'Program']] as const).map(([k, l]) => <button role="tab" aria-selected={rt === k} class={rt === k ? 'on' : ''} onClick={() => rightTab.value = k}>{t(l)}</button>)}<div class="grow" /><button class="iconbtn" title={t('Hide panel')} onClick={() => panes.value = { ...panes.value, right: false }}><Icon name="panel-right-close" size={14} /></button></div>
    <div class="scroll">{rt === 'block' ? <BlockInsp progId={progId} T={T} issues={issues} /> : <ProgInsp progId={progId} pr={pr} T={T} />}</div>
  </div>;
}
const Sec = ({ n, title }: { n: string; title: string }) => <h4 class="dsec"><span>{n}</span> // {t(title).toUpperCase()}</h4>;
function BlockInsp({ progId, T, issues }: { progId: string; T: SigTable; issues: PIssue[] }) {
  const id = selBlock.value; const b = id && WS ? WS.getBlockById(id) : null; L.tick.value; const [, force] = useState(0);
  if (!b) return <div class="insp"><Empty icon="mouse-pointer" title={t('No block selected')}><p>{t('Click a block to see what it does, the part it is linked to and its checks. Right-click a block for a breakpoint.')}</p></Empty>
    <div class="dkeys"><span><kbd>F9</kbd> {t('breakpoint')}</span><span><kbd>Ctrl</kbd>+<kbd>Z</kbd> {t('undo')}</span><span><kbd>Del</kbd> {t('delete')}</span><span><kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>V</kbd> {t('copy / paste')}</span></div></div>;
  const sigId = b.getFieldValue?.('SIG') || b.getFieldValue?.('CYL'); const sig: Sig | undefined = sigId ? T.byId.get(sigId) : undefined; const cyl = sigId ? T.cylById.get(sigId) : undefined;
  const mine = issues.filter(i => i.block === b.id); const bp = L.bps(progId).has(b.id);
  const run = L.RT.value; const rt = run && run.progId === progId ? run.rt : null; const wait = rt?.waits.get(b.id);
  const tip = typeof b.tooltip === 'function' ? b.tooltip() : b.tooltip;
  return <div class="insp">
    <h3>{HUMAN[b.type] || b.type}</h3>{tip && <div class="muted">{tip}</div>}
    {sigId && <><Sec n="01" title="Linked part" />
      {sig || cyl ? <><div class="kvgrid"><span>{t('Tag')}</span><b>{sig?.tag || cyl!.tag}</b><span>{t('Address')}</span><b>{sig?.addr || t('direct (no PLC address)')}</b><span>{t('Kind')}</span><b>{sig ? ({ in: t('digital input'), out: t('digital output'), ain: t('analog input'), aout: t('analog output') } as any)[sig.dir] : t('cylinder end positions')}</b>{sig?.unit && <><span>{t('Unit')}</span><b>{sig.unit}</b></>}</div>
        <button class="dlinkrow" onClick={() => { const g = sig?.go || cyl?.go; if (g) showPart(g); }}><Icon name="external-link" size={13} /><span>{sig?.desc || cyl!.desc}</span></button>
        {rt && <div class="kvgrid"><span>{t('Live value')}</span><b class="mono">{sig ? fmtV(rt.valueOf(sig.id)) : `+ ${fmtV(rt.cyl(cyl!.id, 'p'))} · − ${fmtV(rt.cyl(cyl!.id, 'm'))}`}</b></div>}</>
        : <div class="drule err"><span class="dot err" /><span>{t('Missing component — the part was deleted or renamed away. Pick a replacement in the block’s list.')}</span></div>}</>}
    {wait && <><Sec n="02" title="Waiting" /><div class={'drule ' + (wait.stalled ? 'warn' : 'info')}><span class={'dot ' + (wait.stalled ? 'warn' : 'info')} /><span>{t('waiting')} {((rt!.t - wait.since)).toFixed(1)} s {t('for')} {rt!.c.conds[b.id] || ''}</span></div></>}
    <Sec n={sigId ? '03' : '01'} title="Checks" />
    {mine.length ? mine.map(i => <div class={'drule ' + i.level}><span class={'dot ' + i.level} /><span>{i.text}</span></div>) : <div class="muted">{t('No problems with this block')} ✓</div>}
    <Sec n={sigId ? '04' : '02'} title="Debug" />
    <div class="row-c"><Btn icon="circle-dot" label={bp ? t('Remove breakpoint') : t('Set breakpoint')} pressed={bp} onClick={() => toggleBp(progId, b.id)} /></div>
    <Sec n={sigId ? '05' : '03'} title="Comment" />
    <textarea class="in" rows={3} value={b.getCommentText?.() || ''} placeholder={t('Shown as a note on the block')} disabled={S.readOnly.value} onChange={(e: any) => { b.setCommentText(e.target.value || null); force(x => x + 1); }} />
  </div>;
}
function ProgInsp({ progId, pr, T }: { progId: string; pr: Program; T: SigTable }) {
  const p = S.project.value!; const n = p.nodes[progId]; const ins = T.sigs.filter(s => s.dir === 'in');
  const w = (f: (x: Program) => void) => L.writeProg(progId, f);
  return <div class="insp">
    <Sec n="01" title="Program" />
    <label class="fld"><span class="lbl">{t('Name')}</span><input class="in" value={n?.name || pr.name} onChange={(e: any) => S.renameNode(progId, e.target.value)} /></label>
    <label class="checkrow"><input type="checkbox" checked={L.isActiveProg(p, progId)} onChange={(e: any) => S.mutate('Active program', d => { Object.values(d.programs).forEach((x: any) => { x.active = e.target.checked ? x.id === progId : false; }); })} />{t('Active — the program the machine runs')}</label>
    <label class="fld"><span class="lbl">{t('Description')}</span><textarea class="in" rows={2} value={pr.comment || ''} onChange={(e: any) => w(x => { x.comment = e.target.value; })} /></label>
    <label class="fld"><span class="lbl">{t('Runs with')}</span><select class="in" value={pr.sheet || ''} onChange={(e: any) => w(x => { x.sheet = e.target.value || undefined; })}><option value="">{t('Machine sheet (automatic)')}{(() => { const ms = machineSheet(p, { ...pr, sheet: undefined }); return ms ? ' · ' + (p.nodes[ms]?.name || '') : ''; })()}</option>{Object.values(p.nodes).filter((x: any) => x.type === 'sheet' && x.sheetType !== 'electric').map((x: any) => <option value={x.id}>{x.name}</option>)}<option value="none">{t('Standalone — no hydraulics')}</option></select></label>
    <p class="muted small">{t('With a sheet, Run starts its hydraulic simulation and the program drives the machine: solenoids shift the valves (spring return when de-energised), sensors and cylinder ends feed the inputs.')}</p>
    <Sec n="02" title="Scan" />
    <label class="fld"><span class="lbl">{t('Scan time')}</span><select class="in" value={String(pr.scanMs || 10)} onChange={(e: any) => w(x => { x.scanMs = +e.target.value; })}>{[1, 2, 5, 10, 20, 50, 100].map(v => <option value={String(v)}>{v} ms</option>)}</select></label>
    <label class="fld"><span class="lbl">{t('Loop limit per scan')}</span><input class="in" type="number" min={1} max={100000} value={pr.loopLimit || 1000} onChange={(e: any) => w(x => { x.loopLimit = Math.max(1, +e.target.value || 1000); })} /></label>
    <label class="fld"><span class="lbl">{t('Stall alarm after (s) — default for WAIT UNTIL')}</span><input class="in" type="number" min={0} value={pr.stall ?? 10} onChange={(e: any) => w(x => { x.stall = Math.max(0, +e.target.value); })} /></label>
    <Sec n="03" title="E-stop" />
    <label class="fld"><span class="lbl">{t('E-stop input')}</span><select class="in" value={pr.estop || ''} onChange={(e: any) => w(x => { x.estop = e.target.value || undefined; x.estopNc = T.byId.get(e.target.value)?.nc ?? true; })}><option value="">{t('— only the E-STOP button —')}</option>{ins.map(s => <option value={s.id}>{sigLabel(s)}{s.estop ? ' · E-stop' : ''}</option>)}</select></label>
    {pr.estop && <label class="checkrow"><input type="checkbox" checked={pr.estopNc !== false} onChange={(e: any) => w(x => { x.estopNc = e.target.checked; })} />{t('NC contact — E-stop is active when the input is OFF (safe on wire break)')}</label>}
    {!pr.estop && ins.some(s => s.estop) && <button class="linkbtn small" onClick={() => { const s = ins.find(x => x.estop)!; w(x => { x.estop = s.id; x.estopNc = true; }); }}>{t('Use')} {sigLabel(ins.find(x => x.estop)!)} {t('(E-stop on the electric sheet)')}</button>}
    <Sec n="04" title="Contents" />
    <div class="kvgrid"><span>{t('Blocks')}</span><b>{countBlocks(pr)}</b><span>{t('Variables')}</span><b>{(pr.vars || []).length}</b><span>{t('I/O signals in project')}</span><b>{T.sigs.length} · {T.cyls.length} {t('cylinders')}</b></div>
    {pr.code ? <><Sec n="05" title="Structured Text (older file)" /><p class="muted small">{t('Kept as text from an earlier HYDRA version; it does not run. Rebuild it with blocks.')}</p><pre class="code">{pr.code}</pre></> : null}
  </div>;
}

// ======================= bottom: controller panel =======================
function Dock({ progId, pr, T, issues }: { progId: string; pr: Program; T: SigTable; issues: PIssue[] }) {
  const tab = dock.value.tab; const run = L.RT.value; const rt = run && run.progId === progId ? run.rt : null; L.tick.value;
  const errs = issues.filter(x => x.level === 'err').length, warns = issues.filter(x => x.level === 'warn').length;
  const act = rt ? rt.alarms.filter(a => a.active).length : 0;
  const setTab = (k: any) => dock.value = { ...dock.value, tab: k };
  const B = (k: string, l: string) => <button role="tab" aria-selected={tab === k} class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>;
  return <div class="ddock lcdock">
    <div class="dtabs" role="tablist">{B('io', `${t('I/O table')} · ${T.sigs.length + T.cyls.length}`)}{B('watch', t('Watch'))}{B('trend', `${t('Trend')}${trendIds.value.length ? ' · ' + trendIds.value.length : ''}`)}{B('alarms', `${t('Alarms')} · ${act}`)}{B('events', `${t('Event log')}${rt ? ' · ' + rt.events.length : ''}`)}{B('rules', `${t('Rule check')} · ${errs ? `${errs} ${t(errs > 1 ? 'errors' : 'error')}` : warns ? `${warns} ${t(warns > 1 ? 'warnings' : 'warning')}` : t('passed')}`)}
      <div class="grow" />
      {tab === 'alarms' && rt && <Btn kind="tb" label={t('Acknowledge all')} onClick={() => { rt.ack(); L.tick.value++; }} />}
      {tab === 'events' && rt && <Btn kind="tb" icon="sheet" label="CSV" onClick={() => download(`${fname(pr.name)}_events.csv`, rt.eventsCsv(), 'text/csv')} />}
      {tab === 'trend' && rt && <Btn kind="tb" icon="sheet" label="CSV" onClick={() => download(`${fname(pr.name)}_trace.csv`, rt.traceCsv(), 'text/csv')} />}
      <Btn kind="tb" icon="chevron-down" title={t('Hide panel')} onClick={() => dock.value = { ...dock.value, open: false }} />
    </div>
    <div class="dockbody">
      {tab === 'io' && <IoTable progId={progId} T={T} rt={rt} />}
      {tab === 'watch' && <Watch progId={progId} pr={pr} rt={rt} />}
      {tab === 'trend' && <Trend rt={rt} T={T} pr={pr} />}
      {tab === 'alarms' && (rt && rt.alarms.length ? <table class="dtable"><thead><tr><th></th><th>{t('Code')}</th><th>{t('Time')}</th><th>{t('Message')}</th><th>{t('State')}</th><th></th></tr></thead><tbody>{rt.alarms.map(a => <tr class={a.active ? 'lcact' : ''}><td><span class={'dot ' + (a.sev === 'F' ? 'err' : a.sev === 'W' ? 'warn' : 'info')} /></td><td class="mono">{a.code.split(':')[0]}</td><td class="mono">{a.t.toFixed(2)} s</td><td>{a.text}</td><td>{a.active ? t('active') : `${t('cleared')} ${a.cleared?.toFixed(2)} s`}{a.acked ? ' · ' + t('acked') : ''}</td><td>{!a.acked && <button class="linkbtn small" onClick={() => { a.acked = true; L.tick.value++; }}>{t('ACK')}</button>}</td></tr>)}</tbody></table> : <p class="muted pad0">{t('No alarms. Faults, E-stops, stalled waits, double writes and your own ALARM blocks are listed here with their time.')}</p>)}
      {tab === 'events' && (rt && rt.events.length ? <table class="dtable"><thead><tr><th>{t('Scan')}</th><th>{t('Time')}</th><th>{t('Tag')}</th><th>{t('Address')}</th><th>{t('Value')}</th></tr></thead><tbody>{rt.events.slice(-300).reverse().map(e => { const s = T.byId.get(e.id); return <tr><td class="mono">{e.scan}</td><td class="mono">{e.t.toFixed(3)} s</td><td>{s?.tag || e.id}</td><td class="mono">{s?.addr || '—'}</td><td class={'mono ' + (e.v ? 'on1' : 'off')}>{e.v ? 'ON' : 'OFF'}</td></tr>; })}</tbody></table> : <p class="muted pad0">{t('Every output change is logged here with its scan number and time.')}</p>)}
      {tab === 'rules' && <div class="drules">{issues.map(i => <button class={'drule ' + i.level} onClick={() => i.block && focusBlock(i.block)} disabled={!i.block}><span class={'dot ' + (i.level === 'ok' ? 'ok' : i.level)} /><span>{i.text}</span></button>)}</div>}
    </div></div>;
}
const trendBtn = (id: string) => { const on = trendIds.value.includes(id); return <button class={'iconbtn lctr' + (on ? ' on' : '')} title={on ? t('Remove from trend') : t('Add to trend')} onClick={() => { trendIds.value = on ? trendIds.value.filter(x => x !== id) : [...trendIds.value, id].slice(-8); const r = L.RT.value?.rt; if (r) r.setTrace(trendIds.value); }}><Icon name="trending-up" size={13} /></button>; };
const setSim = L.setInput;
function setForce(progId: string, key: string, v: string) { const r = L.RT.value; if (!r || r.progId !== progId) { S.toast(t('Run the program to force values'), 'warn'); return; } if (v === '') delete r.rt.force[key]; else r.rt.force[key] = v === 'ON' ? true : v === 'OFF' ? false : +v; L.tick.value++; }
function IoTable({ progId, T, rt }: { progId: string; T: SigTable; rt: any }) {
  L.tick.value; const sim = rt ? rt.sim : simOf(progId); const lset: Set<string> | null = rt && rt.state !== 'stopped' && (rt.adapter as any)?.linked || null; const machine = !!lset;
  const dirTxt: Record<string, string> = { in: 'DI', out: 'DO', ain: 'AI', aout: 'AO' };
  const fsel = (key: string, analog = false) => <select class={'in sm' + (rt && key in rt.force ? ' lcforced' : '')} aria-label={t('Force')} value={rt && key in rt.force ? (analog ? String(rt.force[key]) : rt.force[key] ? 'ON' : 'OFF') : ''} onChange={(e: any) => setForce(progId, key, e.target.value)}><option value="">—</option>{analog ? null : <><option value="ON">{t('force ON')}</option><option value="OFF">{t('force OFF')}</option></>}</select>;
  const inCell = (key: string, analog: boolean) => { const v = rt ? (key.startsWith('cyl:') ? rt.cyl(key.slice(0, -1), key.endsWith('+') ? 'p' : 'm') : rt.rd(key)) : sim[key];
    const linked = !!lset?.has(key); if (analog) return linked ? <span class="mono lclive">{(+v).toFixed(1)}</span> : <LiveNum class="in sm mono lcnum" value={sim[key] ?? 0} title={t('Set the value by hand')} onCommit={x => setSim(progId, key, x)} />;
    return <button class={'lcbool ' + (v ? 'on' : '') + (linked ? ' lk' : '')} disabled={linked} title={linked ? t('Supplied by the hydraulic simulation') : t('Click to switch this input')} onClick={() => setSim(progId, key, !sim[key])}>{v ? 'ON' : 'OFF'}</button>; };
  if (!T.sigs.length && !T.cyls.length) return <p class="muted pad0">{t('No I/O yet. Valve solenoids, cylinders, pressure switches and pump motors of the fluid sheets — and PLC inputs / outputs drawn on electric sheets — appear here automatically.')}</p>;
  return <table class="dtable lcio"><thead><tr><th>{t('Tag')}</th><th>{t('Address')}</th><th>{t('Type')}</th><th>{t('Machine')}</th><th>{t('Value')}</th><th>{t('Force')}</th><th></th></tr></thead><tbody>
    {T.sigs.map(s => { const out = s.dir === 'out' || s.dir === 'aout'; const forced = rt && s.id in rt.force;
      return <tr class={forced ? 'forced' : ''}><td><b>{s.tag}</b></td><td class="mono">{s.addr || <span class="muted">{t('direct')}</span>}</td><td class="mono">{dirTxt[s.dir]}</td><td class="lcdesc" title={s.desc}>{s.desc}</td>
        <td>{out ? <span class={'mono ' + (rt && rt.valueOf(s.id) ? 'on1' : 'off')}>{rt ? (s.dir === 'aout' ? `${fmtV(rt.valueOf(s.id))} ${s.unit || ''}` : rt.valueOf(s.id) ? 'ON' : 'OFF') : '—'}</span> : inCell(s.id, s.dir === 'ain')}{s.dir === 'ain' && s.unit ? <span class="muted small"> {s.unit}</span> : null}</td>
        <td>{s.dir === 'in' || s.dir === 'out' ? fsel(s.id) : null}</td><td>{trendBtn(s.id)}</td></tr>; })}
    {T.cyls.map(c => (['+', '-'] as const).map(e => <tr class={rt && c.id + e in rt.force ? 'forced' : ''}><td><b>{c.tag} {e === '+' ? '+' : '−'}</b></td><td class="mono"><span class="muted">{t('direct')}</span></td><td class="mono">DI</td><td class="lcdesc">{c.desc} · {e === '+' ? t('extended end') : t('retracted end')}</td><td>{inCell(c.id + e, false)}</td><td>{fsel(c.id + e)}</td><td /></tr>))}
  </tbody><caption class="muted small">{machine ? t('Machine run: sensors, switches and cylinder ends come from the hydraulic simulation (grey). Operator devices stay manual — click to switch. Force overrides any value (orange).') : t('Standalone run: click an input to switch it, or type an analog value. Force overrides any value (orange) while the program runs.')}</caption></table>;
}
function Watch({ progId, pr, rt }: { progId: string; pr: Program; rt: any }) {
  L.tick.value;
  if (!rt) return <p class="muted pad0">{t('Run the program to watch sequences, variables, timers and counters live.')}</p>;
  const seqs = rt.c.seqs as any[];
  return <table class="dtable"><thead><tr><th>{t('Name')}</th><th>{t('Kind')}</th><th>{t('Value')}</th><th>{t('Detail')}</th><th></th></tr></thead><tbody>
    {seqs.map(sq => { const q = rt.seqs[sq.name]; const stp = sq.steps.find((x: any) => x.id === q?.cur); return <tr><td><b>{sq.name}</b></td><td>{t('sequence')}</td><td class="mono on1">{q ? `${q.cur}${stp?.label ? ' · ' + stp.label : ''}` : '—'}</td><td class="muted">{q && stp ? `${(rt.t - q.t0).toFixed(1)} s · ${t('waiting for')} ${stp.cond}` : ''}</td><td><button class="linkbtn small" onClick={() => stp && focusBlock(stp.block)}>{t('show')}</button></td></tr>; })}
    {(pr.vars || []).map(v => <tr><td><b>{v.name}</b></td><td>{v.type}</td><td class="mono">{v.type === 'BOOL' ? <button class={'lcbool ' + (rt.v[v.id] ? 'on' : '')} title={t('Click to change')} onClick={() => { rt.v[v.id] = !rt.v[v.id]; L.tick.value++; }}>{fmtV(rt.v[v.id])}</button> : v.type === 'STRING' ? <input class="in sm mono lcnum" value={fmtV(rt.v[v.id])} onChange={(e: any) => { rt.v[v.id] = e.target.value; L.tick.value++; }} /> : <LiveNum class="in sm mono lcnum" value={rt.v[v.id]} onCommit={x => { rt.v[v.id] = v.type === 'INT' ? Math.trunc(x) : x; L.tick.value++; }} />}</td><td class="muted">{v.comment || ''}</td><td>{trendBtn('var:' + v.id)}</td></tr>)}
    {Object.entries(rt.timers).map(([k, x]: any) => <tr><td><b>{k}</b></td><td>{x.kind}</td><td class={'mono ' + (x.Q ? 'on1' : 'off')}>{x.Q ? 'Q' : '—'}</td><td class="mono">ET {x.ET.toFixed(2)} / {x.PT.toFixed(2)} s</td><td /></tr>)}
    {Object.entries(rt.counters).map(([k, x]: any) => <tr><td><b>{k}</b></td><td>{x.kind}</td><td class="mono">{x.CV}</td><td class="mono">{t('preset')} {x.PV}{x.Q ? ' · Q' : ''}</td><td /></tr>)}
    {rt.mode !== 'OFF' && <tr><td><b>{t('Mode')}</b></td><td>{t('machine')}</td><td class="mono on1">{rt.mode}</td><td /><td /></tr>}
    {Object.entries(rt.pids || {}).map(([k, x]: any) => <tr><td><b>{k}</b></td><td>PID</td><td class="mono">{x.out.toFixed(2)}</td><td class="mono">SP {x.sp.toFixed(2)} · PV {x.pv.toFixed(2)} · e {x.e.toFixed(2)}</td><td>{trendBtn('pid:' + k)}</td></tr>)}
    {Object.entries(rt.arrs || {}).map(([k, a]: any) => <tr><td><b>{k}</b></td><td>{t('array')} [{a.length}]</td><td class="mono" colSpan={2}>{a.slice(0, 12).map((x: number) => +x.toFixed(3)).join(', ')}{a.length > 12 ? ' …' : ''}</td><td /></tr>)}
    {Object.entries(rt.sregs || {}).map(([k, r]: any) => <tr><td><b>{k}</b></td><td>{t('shift register')}</td><td class="mono" colSpan={2}>{r.bits.map((x: boolean) => x ? '1' : '0').join('')}</td><td /></tr>)}
    {Object.entries(rt.fbo || {}).map(([k, o]: any) => <tr><td><b>{k}</b></td><td>{t('function block')}</td><td class="mono" colSpan={2}>{Object.entries(o).map(([n, v]) => `${n}=${fmtV(v)}`).join('  ')}</td><td /></tr>)}
    {!seqs.length && !(pr.vars || []).length && !Object.keys(rt.timers).length && !Object.keys(rt.counters).length && <tr><td colSpan={5} class="muted">{t('Nothing to watch yet — add a SEQUENCE, a variable, a timer or a counter.')}</td></tr>}
  </tbody></table>;
}
const COLS = ['#0A64C2', '#1E9E4A', '#C62828', '#B45309', '#6D4AA8', '#0E7490', '#9D174D', '#475569'];
function Trend({ rt, T, pr }: { rt: any; T: SigTable; pr: Program }) {
  L.tick.value; const ids = trendIds.value; useEffect(() => { if (rt) rt.setTrace(ids); }, [rt, ids.join()]);
  if (!ids.length) return <p class="muted pad0">{t('Add signals or variables with the')} <Icon name="trending-up" size={12} /> {t('button in the I/O table or Watch.')}</p>;
  if (!rt || !rt.trace.t.length) return <p class="muted pad0">{t('Run the program to record the trend.')}</p>;
  const tr = rt.trace; const tEnd = tr.t[tr.t.length - 1], span = 20; const i0 = Math.max(0, tr.t.findIndex((x: number) => x >= tEnd - span)); const W = 1000, lane = 34;
  const label = (id: string) => id.startsWith('var:') ? (pr.vars || []).find(v => v.id === id.slice(4))?.name || id : T.byId.get(id)?.tag || id;
  const H = ids.length * lane + 18; const step = Math.max(1, Math.floor((tr.t.length - i0) / 800));
  return <svg class="lctrend" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H + 'px' }}>
    {ids.map((id, k) => { const col = tr.cols[id] || []; let lo = Infinity, hi = -Infinity; for (let i = i0; i < col.length; i++) { lo = Math.min(lo, col[i]); hi = Math.max(hi, col[i]); } if (!isFinite(lo)) { lo = 0; hi = 1; } if (hi - lo < 1e-9) { hi = lo + 1; }
      const y0 = k * lane + 4, y1 = y0 + lane - 10; let d = ''; for (let i = i0; i < col.length; i += step) { const x = 120 + (W - 130) * (tr.t[i] - (tEnd - span)) / span; const y = y1 - (y1 - y0) * (col[i] - lo) / (hi - lo); d += (d ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }
      return <g><text x="4" y={y0 + 14} class="lctl">{label(id)}</text><text x="4" y={y0 + 26} class="lctv">{fmtV(rt.valueOf(id))}</text><line x1="120" x2={W - 10} y1={y1} y2={y1} class="lctb" /><path d={d} fill="none" stroke={COLS[k % COLS.length]} stroke-width="1.6" vector-effect="non-scaling-stroke" /></g>; })}
    <text x={W - 10} y={H - 2} text-anchor="end" class="lctv">t {tEnd.toFixed(1)} s · {t('last')} {span} s</text>
  </svg>;
}
