// Operator panel: the panel window (header, page tabs, widgets, footer), its own tab with Run view / Edit
// panel / Pop out, the editor (palette, canvas, inspector), the dock beside the live hydraulics and the second window.
import { h, Fragment, render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import * as S from '../../store';
import { t } from '../../i18n';
import { Icon, Btn, Empty } from '../../ui/common';
import * as L from '../state';
import { signals } from '../signals';
import { compile, topBlocks, type Program } from '../compile';
import { CATALOG, COLOURS, defOf, mkWidget, emptyPanel, autoBuild, readOptions, writeOptions, widgetIssues, pumpsOf, valvesOf, motorsOf, liveParams, parseItems, type Panel, type Widget, type Opt } from './model';
import { ctxOf, readSrc, write, levelOf, editPanel, type Ctx } from './rt';
import { WidgetBody, tagOf } from './Widgets';
import * as Sim from '../../designer/sim';

export const panelOf = (p: any, progId: string): Panel | null => (p?.programs?.[progId] as any)?.panel || null;
const pageSig = signal<Record<string, string>>({}); // current page per view (key: view + program)
const pageOf = (k: string, pn: Panel) => { const v = pageSig.value[k]; return pn.pages.some(x => x.id === v) ? v : pn.pages[0]?.id || 'main'; };
const setPage = (k: string, id: string) => { pageSig.value = { ...pageSig.value, [k]: id }; };

// ======================= the panel window =======================
export function PanelView({ progId, view, edit, sel, onSel, compact, width }: { progId: string; view: string; edit?: boolean; sel?: string | null; onSel?: (id: string | null) => void; compact?: boolean; width?: number }) {
  L.tick.value; S.project.value; Sim.simFrame.value; const c = ctxOf(progId); const ref = useRef<HTMLDivElement>(null); const [wpx, setW] = useState(width || 1200);
  useEffect(() => { if (width) { setW(width); return; } const el = ref.current; if (!el) return; const ro = new (el.ownerDocument.defaultView as any).ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth); return () => ro.disconnect(); }, [width]);
  // keyboard shortcuts of buttons (F2 …) while this panel is shown
  useEffect(() => { if (edit) return; const win = ref.current?.ownerDocument.defaultView; if (!win) return; const held = new Set<string>();
    const find = (k: string) => { const cc = ctxOf(progId); const pn = cc?.panel; return pn?.widgets.find(w => w.p.key && w.p.key.toLowerCase() === k.toLowerCase()); };
    const kd = (e: KeyboardEvent) => { const tg = (e.target as HTMLElement)?.tagName; if (/INPUT|TEXTAREA|SELECT/.test(tg) || S.modal.value) return; const w = find(e.key); if (!w) return; e.preventDefault(); e.stopPropagation(); if (held.has(e.key)) return; const cc = ctxOf(progId)!; held.add(e.key); write(cc, w.p.act, true, { momentary: true }); };
    const ku = (e: KeyboardEvent) => { if (!held.has(e.key)) return; e.stopPropagation(); held.delete(e.key); const w = find(e.key); const cc = ctxOf(progId); if (w && cc && !String(w.p.act).startsWith('cmd:')) write(cc, w.p.act, false, { momentary: true }); };
    win.addEventListener('keydown', kd, true); win.addEventListener('keyup', ku, true); return () => { win.removeEventListener('keydown', kd, true); win.removeEventListener('keyup', ku, true); }; }, [edit, progId]);
  if (!c || !c.panel) return <div class="opn"><Empty icon="layout-dashboard" title={t('No operator panel yet')} /></div>;
  const pn = c.panel; const key = view + ':' + progId; const pg = pageOf(key, pn);
  const cols = wpx < 520 ? 4 : wpx < 900 ? 6 : 12; const sp = (n: number) => cols === 12 ? Math.max(1, Math.min(12, n)) : Math.min(cols, Math.max(n <= 1 ? 1 : 2, Math.ceil(n * cols / 12))); // narrow: fewer, wider columns
  const list = pn.widgets.filter(w => w.page === pg);
  return <div class={'opn' + (compact ? ' compact' : '') + (edit ? ' edit' : '')} ref={ref}>
    <Header c={c} compact={compact || wpx < 900} />
    <div class="op-pt" role="tablist">{pn.pages.map(x => { const n = x.id === 'alarms' ? (c.rt?.alarms.filter((a: any) => a.active).length || 0) : 0; return <button role="tab" aria-selected={x.id === pg} class={x.id === pg ? 'on' : ''} onClick={() => setPage(key, x.id)}>{x.name}{n ? <span class="n">{n}</span> : null}</button>; })}</div>
    {!c.rt && !edit && <div class="op-stopped"><Icon name="info" size={14} /><span>{t('Machine stopped — the panel comes alive when the program runs.')}</span><button class="op-pb sm" style={{ background: COLOURS.green[0] }} onClick={() => write(c, 'cmd:run', true)}>▶ {t('Start machine')}</button></div>}
    <div class="op-body" style={{ gridTemplateColumns: `repeat(${cols},minmax(0,1fr))` }} onClick={e => { if (edit && e.target === e.currentTarget && Date.now() - dragEnd > 300) onSel?.(null); }}>
      {list.map(w => <WFrame key={w.id} w={w} c={c} pn={pn} edit={!!edit} sel={sel === w.id} span={sp(w.w)} cols={cols} onSel={onSel} goPage={(id: string) => setPage(key, id)} progId={progId} />)}
      {!list.length && <div class="op-empty" style={{ gridColumn: '1/-1' }}>{edit ? t('Empty page — click a widget in the palette to add it here') : t('This page is empty')}</div>}
    </div>
    <Footer c={c} />
  </div>;
}
function Header({ c, compact }: { c: Ctx; compact: boolean }) {
  const pn = c.panel; const rt = c.rt; const st = rt?.state || 'stopped'; const mode = pn.modeVar ? (pn.modes || [])[+readSrc(c, 'var:' + pn.modeVar) || 0] : '';
  const steps = rt ? rt.c.seqs.map((q: any) => { const cur = rt.seqs[q.name]?.cur; const s = q.steps.find((x: any) => x.id === cur); return s ? `${s.id}${s.label ? ' · ' + s.label : ''}` : ''; }).filter(Boolean) : [];
  const al = rt ? rt.alarms.filter((a: any) => a.active).length : 0; const lvl = levelOf(c.progId);
  return <div class="op-ph"><span class="nm">{pn.title || c.p.manifest.name}</span>{!compact && <span class="sub">{c.p.nodes[c.progId]?.name}</span>}<span class="grow" />
    {mode && <span class="op-bdg b">{mode}</span>}<span class={'op-bdg ' + (st === 'running' ? 'g' : st === 'estop' || st === 'fault' ? 'r' : st === 'paused' ? 'y' : 'k')}>{st === 'running' ? '● RUNNING' : st === 'estop' ? 'E-STOP' : st.toUpperCase()}</span>
    {steps.map(s => <span class="op-bdg k">{s}</span>)}{al > 0 && <span class="op-bdg y">⚠ {al}</span>}
    {!compact && <><span class="op-bdg k">🔑 {lvl === 'maint' ? 'MAINTENANCE' : 'OPERATOR'}</span><span class="op-bdg k mono">t {(rt?.t || 0).toFixed(1)} s</span></>}</div>;
}
function Footer({ c }: { c: Ctx }) {
  const a = c.rt?.alarms.find((x: any) => x.active && !x.acked) || c.rt?.alarms.find((x: any) => x.active);
  return <div class="op-pf">{a ? <><span class={'op-sev ' + a.sev} /><b class="mono">{a.t.toFixed(2)} s</b><span class="ell"><b>{a.code.split(':')[0]}</b> {a.text}</span>{!a.acked && <button class="op-ack" onClick={() => { a.acked = true; L.tick.value++; }}>ACK</button>}<span class="sep" /></> : null}
    <span class="ell muted">ⓘ {c.rt?.message || (c.rt ? t('Machine running') : t('Machine stopped'))}</span></div>;
}
// one widget on the grid: frame, selection and (edit) drag to move, handle to resize
let dragEnd = 0;
let drag: { id: string; mode: 'move' | 'size'; x0: number; y0: number; w0: number; h0: number; cw: number; over?: string; after?: boolean } | null = null;
function WFrame({ w, c, pn, edit, sel, span, cols, onSel, goPage, progId }: { w: Widget; c: Ctx; pn: Panel; edit: boolean; sel: boolean; span: number; cols: number; onSel?: (id: string | null) => void; goPage: (id: string) => void; progId: string }) {
  const frameless = ['group', 'divider', 'spacer', 'label', 'image', 'pagelink'].includes(w.type);
  const [ghost, setGhost0] = useState<{ w: number; h: number } | null>(null); const gref = useRef<{ w: number; h: number } | null>(null); const setGhost = (g: { w: number; h: number } | null) => { gref.current = g; setGhost0(g); };
  const down = (e: any, mode: 'move' | 'size') => {
    if (!edit) return; e.stopPropagation(); onSel?.(w.id); const body = e.currentTarget.closest('.op-body') as HTMLElement; const cw = body.clientWidth / cols;
    drag = { id: w.id, mode, x0: e.clientX, y0: e.clientY, w0: w.w, h0: w.h, cw }; const doc = e.currentTarget.ownerDocument as Document;
    const mv = (ev: PointerEvent) => { if (!drag) return; if (drag.mode === 'size') { const nw = Math.max(1, Math.min(12, Math.round(drag.w0 + (ev.clientX - drag.x0) / drag.cw * (12 / cols)))), nh = Math.max(1, Math.min(10, Math.round(drag.h0 + (ev.clientY - drag.y0) / 60))); setGhost({ w: nw, h: nh }); return; }
      if (Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 6) return; const el = (doc.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement)?.closest('[data-wid]') as HTMLElement | null;
      doc.querySelectorAll('.op-w.dropb,.op-w.dropa').forEach(x => x.classList.remove('dropb', 'dropa'));
      if (el && el.dataset.wid !== drag.id) { const r = el.getBoundingClientRect(); drag.over = el.dataset.wid; drag.after = ev.clientX > r.left + r.width / 2; el.classList.add(drag.after ? 'dropa' : 'dropb'); } else drag.over = undefined; };
    const up = () => { doc.removeEventListener('pointermove', mv); doc.removeEventListener('pointerup', up); doc.querySelectorAll('.op-w.dropb,.op-w.dropa').forEach(x => x.classList.remove('dropb', 'dropa')); const d = drag; drag = null; if (!d) return; dragEnd = Date.now();
      if (d.mode === 'size') { const g = gref.current; setGhost(null); if (g && (g.w !== d.w0 || g.h !== d.h0)) editPanel(progId, 'Resize widget', p => { const x = p.widgets.find(q => q.id === d.id); if (x) { x.w = g.w; x.h = g.h; } }); return; }
      if (d.over) editPanel(progId, 'Move widget', p => { const i = p.widgets.findIndex(q => q.id === d.id); const [x] = p.widgets.splice(i, 1); let j = p.widgets.findIndex(q => q.id === d.over); if (d.after) j++; p.widgets.splice(j, 0, x); }); };
    doc.addEventListener('pointermove', mv); doc.addEventListener('pointerup', up);
  };
  const ww = ghost ? Math.max(1, Math.min(cols, cols === 12 ? ghost.w : Math.ceil(ghost.w * cols / 12))) : span; const hh = ghost ? ghost.h : w.h;
  return <div class={'op-w t-' + w.type + (frameless ? ' bare' : '') + (sel ? ' sel' : '')} data-wid={w.id} style={{ gridColumn: `span ${ww}`, gridRow: `span ${hh}` }} onPointerDown={e => down(e, 'move')}>
    <WidgetBody w={w} c={c} edit={edit} panel={pn} goPage={goPage} />
    {edit && sel && <span class="op-handle" onPointerDown={e => down(e, 'size')} title={t('Drag to resize')} />}{edit && sel && ghost && <span class="op-size">{ghost.w} × {ghost.h}</span>}
  </div>;
}

// ======================= the Operator panel tab =======================
export const panelMode = signal<'run' | 'edit'>('run');
const editSel = signal<string | null>(null);
const editWidth = signal(0); // 0 = fit the canvas
const insTab = signal<'widget' | 'page' | 'panel'>('widget');
export function PanelTab({ tab }: { tab: S.Tab }) {
  useEffect(() => () => { L.peApi.value = null; }, []);
  const p = S.project.value; const progId = tab.nodeId && p?.nodes[tab.nodeId]?.type === 'program' ? tab.nodeId : L.activeProgId(p);
  if (!p) return <div class="hd"><div class="dempty"><Icon name="layout-dashboard" size={24} /><span>{t('Open a project with a PLC program')}</span></div></div>;
  if (!progId) return <div class="hd"><div class="dchooser"><div class="dhead"><Icon name="layout-dashboard" size={22} /><div><h2>{t('Operator panel')}</h2><p>{t('An operator panel belongs to a PLC program — create one first.')}</p></div><div class="grow" /><Btn icon="home" label={t('Back to Home')} onClick={() => S.activeTab.value = 'home'} /></div>
    <div class="dbody"><Btn kind="primary" icon="plus" label={t('New program')} onClick={() => { const id = S.addNode('program', null); if (id) S.openSheetTab(id); }} /></div></div></div>;
  const pn = panelOf(p, progId); const mode = panelMode.value; const pr = p.programs[progId] as Program;
  L.peApi.value = pn && mode === 'edit' ? { del: () => del(progId), dup: () => dup(progId) } : null;
  if (!pn) return <div class="hd"><div class="dchooser"><div class="dhead"><Icon name="layout-dashboard" size={22} /><div><h2>{t('Operator panel')} · {p.nodes[progId]?.name}</h2><p>{t('Buttons, lamps, gauges and screens for the operator — bound to the tags of your machine.')}</p></div><div class="grow" /><Btn icon="home" label={t('Back to Home')} onClick={() => S.activeTab.value = 'home'} /></div>
    <div class="dbody"><div class="row-end wrap" style={{ justifyContent: 'flex-start' }}><Btn kind="primary" icon="wand-2" label={t('Auto-build from project')} onClick={() => doAutoBuild(progId)} /><Btn icon="plus" label={t('Start empty')} onClick={() => { editPanel(progId, 'New operator panel', x => Object.assign(x, emptyPanel())); panelMode.value = 'edit'; }} /></div>
      <p class="muted small">{t('Auto-build makes six pages from your program and sheets: Main (E-stop, START / STOP / RESET, mode, tower light, sequence, cylinders, pressure), Manual (jog per cylinder), Setpoints (recipes, set-points, part settings), Alarms, I/O and Trends. Change anything afterwards in Edit panel.')}</p></div></div></div>;
  return <div class="hd opt">
    <div class="dtoolbar" role="toolbar"><div class="dtleft">
      <Btn kind="tb" icon="binary" label={p.nodes[progId]?.name} title={t('Open the program')} onClick={() => S.openSheetTab(progId)} />
      <span class="tsep" />
      {mode === 'edit' && <><Btn kind="tb" icon="copy" label={t('Duplicate')} disabled={!editSel.value} onClick={() => dup(progId)} /><Btn kind="tb" icon="trash-2" label={t('Delete')} disabled={!editSel.value} onClick={() => del(progId)} /><span class="tsep" />
        <label class="lcpill">{t('size')} <select class="in sm" value={String(editWidth.value)} onChange={(e: any) => editWidth.value = +e.target.value}><option value="0">{t('fit')}</option><option value="640">{t('dock')} 640</option><option value="1100">{t('tab')} 1100</option><option value="1600">{t('pop-out')} 1600</option></select></label>
        <Btn kind="tb" icon="wand-2" label={t('Auto-build from project')} onClick={async () => { if (await S.confirmDlg(t('Auto-build again?'), t('This replaces every page and widget of this panel (recipes stay). Undo brings it back.'), [{ label: t('Cancel'), value: 'no' }, { label: t('Replace'), value: 'yes', primary: true }]) === 'yes') doAutoBuild(progId); }} /></>}
      {mode === 'run' && <MachineCtl progId={progId} />}
    </div><div class="dtright">
      <Btn kind={mode === 'run' ? 'primary' : 'tb'} label={t('Run view')} onClick={() => panelMode.value = 'run'} />
      <Btn kind={mode === 'edit' ? 'primary' : 'tb'} label={t('Edit panel')} onClick={() => panelMode.value = 'edit'} />
      <Btn kind="tb" icon="app-window" label={t('Pop out')} title={t('Open the panel in its own window (second monitor)')} onClick={() => popOut(progId)} />
    </div></div>
    {mode === 'run' ? <div class="opt-run"><PanelView progId={progId} view="tab" /></div>
      : <div class="opt-edit"><aside class="dleft"><Palette progId={progId} pn={pn} /></aside>
        <section class="opt-canvas" onClick={e => { if (e.target === e.currentTarget && Date.now() - dragEnd > 300) editSel.value = null; }}><div class="opt-frame" style={{ width: editWidth.value ? editWidth.value + 'px' : '100%' }}><PanelView progId={progId} view="edit" edit sel={editSel.value} onSel={id => { editSel.value = id; if (id) insTab.value = 'widget'; }} width={editWidth.value || undefined} compact={!!editWidth.value && editWidth.value < 900} /></div></section>
        <aside class="dright"><Inspector progId={progId} pn={pn} pr={pr} /></aside></div>}
    <div class="opt-status">{t('Operator panel')} · {pn.pages.find(x => x.id === pageOf((mode === 'edit' ? 'edit:' : 'tab:') + progId, pn))?.name} · {pn.widgets.filter(w => w.page === pageOf((mode === 'edit' ? 'edit:' : 'tab:') + progId, pn)).length} {t('widgets')} · {pn.pages.length} {t('pages')} · {pn.widgets.length} {t('total')}<span class="grow" />{(() => { const n = allIssues(p, progId).length; return n ? <span class="warnc">⚠ {n} {t('binding problems')}</span> : <span>{t('all bound')} ✓</span>; })()}</div>
  </div>;
}
function MachineCtl({ progId }: { progId: string }) {
  L.tick.value; const r = L.RT.value; const mine = r && r.progId === progId && r.rt.state !== 'stopped';
  return mine ? <><span class={'lcstate ' + r!.rt.state}>{r!.rt.state}</span>{r!.link && <button class="lcpill lclink on" onClick={() => S.openSheetTab(r!.link!.sheet)}><Icon name="droplets" size={12} />{S.project.value?.nodes[r!.link.sheet]?.name}</button>}<Btn kind="tb" icon="square" label={t('Stop machine')} onClick={() => L.stop()} /></>
    : <Btn kind="primary" icon="play" label={t('Start machine')} title={t('Run the program (with its hydraulic sheet)')} onClick={() => { const c = L.run(progId); if (c && !c.ok) S.toast(t('The program has errors — open it in the Logic Coder'), 'err'); }} />;
}
function doAutoBuild(progId: string) {
  const p = S.project.value!; const pr = p.programs[progId] as Program; const T = signals(p); const c = compile(pr, T);
  const { panel, newVars } = autoBuild(p, pr, T, { seqs: c.seqs.map(q => ({ name: q.name, steps: q.steps.map(s => s.id) })), counters: c.counters });
  S.mutate('Auto-build operator panel', d => { const x: any = d.programs[progId]; const old = x.panel; x.panel = { ...panel, recipes: old?.recipes || [] }; if (newVars.length) x.vars = [...(x.vars || []), ...newVars]; }, { ignoreLock: true });
  S.toast(`${t('Operator panel built')}: ${panel.widgets.length} ${t('widgets on')} ${panel.pages.length} ${t('pages')}${newVars.length ? ` · ${newVars.length} ${t('panel variables added to the program (Mode, jog …)')}` : ''}`, 'ok');
}
const dup = (progId: string) => { const id = editSel.value; if (!id) return; let nid = ''; editPanel(progId, 'Duplicate widget', p => { const i = p.widgets.findIndex(q => q.id === id); if (i < 0) return; const x = JSON.parse(JSON.stringify(p.widgets[i])); x.id = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); nid = x.id; p.widgets.splice(i + 1, 0, x); }); if (nid) editSel.value = nid; };
const del = (progId: string) => { const id = editSel.value; if (!id) return; editPanel(progId, 'Delete widget', p => { p.widgets = p.widgets.filter(q => q.id !== id); }); editSel.value = null; };

// ======================= editor: palette =======================
function Palette({ progId, pn }: { progId: string; pn: Panel }) {
  const [tb, setTb] = useState<'w' | 'p'>('w'); const key = 'edit:' + progId; const pg = pageOf(key, pn);
  const add = (type: string) => { const w = mkWidget(type, pg); editPanel(progId, 'Add widget', p => { const i = editSel.value ? p.widgets.findIndex(q => q.id === editSel.value) : -1; if (i >= 0 && p.widgets[i].page === pg) p.widgets.splice(i + 1, 0, w); else p.widgets.push(w); }); editSel.value = w.id; insTab.value = 'widget'; };
  const cats = ['Controls', 'Indicators', 'Alarms & info', 'Layout'] as const;
  return <div class="panel"><div class="dtabs" role="tablist"><button role="tab" aria-selected={tb === 'w'} class={tb === 'w' ? 'on' : ''} onClick={() => setTb('w')}>{t('Widgets')} · {CATALOG.length}</button><button role="tab" aria-selected={tb === 'p'} class={tb === 'p' ? 'on' : ''} onClick={() => setTb('p')}>{t('Pages')} · {pn.pages.length}</button></div>
    <div class="scroll">{tb === 'w' ? cats.map(cat => <><div class="cat">{t(cat)} <span class="muted">{CATALOG.filter(d => d.cat === cat).length}</span></div><div class="op-pal">{CATALOG.filter(d => d.cat === cat).map(d => <button title={t(d.tip)} onClick={() => add(d.type)} data-type={d.type}><b>{d.icon}</b>{t(d.name)}</button>)}</div></>)
      : <div class="insp">{pn.pages.map(x => <button class={'lcentry' + (x.id === pg ? ' on' : '')} onClick={() => setPage(key, x.id)}><b>{x.name}</b><small>{pn.widgets.filter(w => w.page === x.id).length} {t('widgets')}</small></button>)}
        <Btn icon="plus" label={t('New page')} onClick={async () => { const nm = (await S.promptDlg(t('New page'), t('Page name'), ''))?.trim(); if (!nm) return; const id = 'pg' + Date.now().toString(36); editPanel(progId, 'New page', p => { p.pages.push({ id, name: nm }); }); setPage(key, id); }} /></div>}</div></div>;
}

// ======================= editor: inspector =======================
const F = ({ label, children }: { label: string; children: any }) => <label class="fld"><span class="lbl">{t(label)}</span>{children}</label>;
const Sel = ({ value, opts, onChange, empty }: { value: string; opts: Opt[]; onChange: (v: string) => void; empty?: string }) => <select class="in" value={value || ''} onChange={(e: any) => onChange(e.target.value)}>{empty != null && <option value="">{empty}</option>}{value && !opts.some(o => o[1] === value) && <option value={value}>⚠ {t('missing')} ({value.split(':')[0]})</option>}{opts.map(([l, v]) => <option value={v}>{l}</option>)}</select>;
function extraOf(p: any, pr: Program) { const c = compile(pr, signals(p)); return { seqs: c.seqs.flatMap(q => q.steps.map(s => [q.name, s.id])), timers: c.timers, counters: c.counters, pumps: pumpsOf(p), seqNames: c.seqs.map(q => q.name) }; }
function issuesCtx(p: any, pr: Program, pn: Panel) { const T = signals(p); const x = extraOf(p, pr); return { read: new Set(readOptions(T, pr, 'any', x).map(o => o[1])), write: new Set([...writeOptions(p, T, pr, 'bool'), ...writeOptions(p, T, pr, 'num')].map(o => o[1])), pages: new Set(pn.pages.map(q => q.id)), seqs: new Set(x.seqNames), counters: new Set(x.counters), cyls: new Set(T.cyls.map(c => c.id)), valves: new Set(valvesOf(p).map(o => o[1])), motors: new Set(motorsOf(p).map(o => o[1])) }; }
export function allIssues(p: any, progId: string) { const pr = p.programs[progId] as Program; const pn = panelOf(p, progId); if (!pn) return []; const cx = issuesCtx(p, pr, pn); return pn.widgets.flatMap(w => widgetIssues(w, cx).map(x => ({ w, text: x }))); }
function Inspector({ progId, pn, pr }: { progId: string; pn: Panel; pr: Program }) {
  const p = S.project.value!; const it = insTab.value; const w = pn.widgets.find(x => x.id === editSel.value);
  return <div class="panel"><div class="dtabs" role="tablist">{([['widget', 'Widget'], ['page', 'Page'], ['panel', 'Panel']] as const).map(([k, l]) => <button role="tab" aria-selected={it === k} class={it === k ? 'on' : ''} onClick={() => insTab.value = k}>{t(l)}</button>)}</div>
    <div class="scroll">{it === 'widget' ? (w ? <WidgetInsp p={p} progId={progId} pn={pn} pr={pr} w={w} /> : <div class="insp"><Empty icon="mouse-pointer" title={t('No widget selected')}><p>{t('Click a widget on the panel. Drag it to move it, drag the blue corner to resize. Click a palette item to add one.')}</p></Empty></div>)
      : it === 'page' ? <PageInsp progId={progId} pn={pn} /> : <PanelInsp p={p} progId={progId} pn={pn} pr={pr} />}</div></div>;
}
const Sec = ({ n, title }: { n: string; title: string }) => <h4 class="dsec"><span>{n}</span> // {t(title).toUpperCase()}</h4>;
function WidgetInsp({ p, progId, pn, pr, w }: { p: any; progId: string; pn: Panel; pr: Program; w: Widget }) {
  const d = defOf(w.type)!; const T = signals(p); const x = useMemo(() => extraOf(p, pr), [p.circuits, pr.ws, pr.vars]);
  const set = (k: string, v: any) => editPanel(progId, 'Edit widget', q => { const y = q.widgets.find(z => z.id === w.id); if (y) y.p = { ...y.p, [k]: v }; });
  const setW = (k: 'w' | 'h' | 'page', v: any) => editPanel(progId, 'Edit widget', q => { const y: any = q.widgets.find(z => z.id === w.id); if (y) y[k] = v; });
  const wb = writeOptions(p, T, pr, 'bool'), wn = writeOptions(p, T, pr, 'num'), rb = readOptions(T, pr, 'bool', x), rn = readOptions(T, pr, 'num', x), ra = readOptions(T, pr, 'any', x);
  const pp = w.p; const has = (k: string) => k in d.p || k in pp; const txt = (k: string, label: string) => has(k) && <F label={label}><input class="in" value={pp[k] ?? ''} onChange={(e: any) => set(k, e.target.value)} /></F>;
  const nm = (k: string, label: string) => has(k) && <F label={label}><input class="in" type="number" value={pp[k] ?? 0} onChange={(e: any) => set(k, +e.target.value)} /></F>;
  const actOpts = ['slider', 'knob', 'numin'].includes(w.type) ? wn : w.type === 'selector' ? [...wn.filter(o => o[1].startsWith('var:')), ...wb.filter(o => o[1].startsWith('in:'))] : w.type === 'keyswitch' ? wb.filter(o => o[1].startsWith('var:')) : wb;
  const srcOpts = w.type === 'lamp' ? rb : w.type === 'value' ? ra : rn;
  const iss = widgetIssues(w, issuesCtx(p, pr, pn));
  const modeOpts: Opt[] = [...(pn.modeVar ? (pn.modes || []).map((m, i) => [`${t('Mode')} = ${m}`, 'mode:' + i] as Opt) : []), ...rb];
  return <div class="insp">
    <h3>{t(d.name)}</h3><div class="muted">{t(d.cat)} · {t(d.tip)}</div>
    <Sec n="01" title="Look" />
    {txt('label', 'Label')}
    {has('colour') && <F label="Colour (IEC 60073)"><select class="in" value={pp.colour} onChange={(e: any) => set('colour', e.target.value)}>{Object.entries(COLOURS).map(([k, [, m]]) => <option value={k}>{k.toUpperCase()} — {t(m)}</option>)}</select></F>}
    <div class="op-2c"><F label="Width (of 12)"><input class="in" type="number" min={1} max={12} value={w.w} onChange={(e: any) => setW('w', Math.max(1, Math.min(12, +e.target.value || 1)))} /></F><F label="Height (rows)"><input class="in" type="number" min={1} max={10} value={w.h} onChange={(e: any) => setW('h', Math.max(1, Math.min(10, +e.target.value || 1)))} /></F></div>
    <F label="Page"><select class="in" value={w.page} onChange={(e: any) => setW('page', e.target.value)}>{pn.pages.map(q => <option value={q.id}>{q.name}</option>)}</select></F>
    {has('size') && nm('size', 'Text size (px)')}
    {w.type === 'image' && <F label="Picture"><input class="in" type="file" accept="image/*" onChange={(e: any) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 400000) { S.toast(t('Use a picture under 400 KB'), 'warn'); return; } const r = new FileReader(); r.onload = () => set('src', r.result); r.readAsDataURL(f); }} /></F>}
    {(['pushbutton', 'litbutton', 'estop', 'selector', 'keyswitch', 'toggle', 'twohand', 'jog', 'slider', 'knob', 'numin'].includes(w.type)) && <><Sec n="02" title="Binding" />
      <F label={w.type === 'jog' ? '+ acts on' : w.type === 'keyswitch' ? 'Also sets (optional)' : 'Acts on'}><Sel value={pp.act} opts={actOpts} onChange={v => set('act', v)} empty={w.type === 'estop' ? t('E-STOP command of the PLC') : w.type === 'keyswitch' ? t('— only the access level —') : t('— choose —')} /></F>
      {w.type === 'jog' && <F label="− acts on"><Sel value={pp.act2} opts={wb} onChange={v => set('act2', v)} empty={t('— choose —')} /></F>}
      {w.type === 'litbutton' && <F label="Lamp shows"><Sel value={pp.lamp} opts={rb} onChange={v => set('lamp', v)} empty={t('— nothing —')} /></F>}
      {pp.act && String(pp.act).startsWith('in:') && <div class="link"><Icon name="external-link" size={12} />{tagOf(ctxOf(progId)!, pp.act)} · {t('operator input wired to the PLC')}</div>}
      {pp.act && String(pp.act).startsWith('var:') && <div class="link"><Icon name="variable" size={12} />{t('program variable')} {tagOf(ctxOf(progId)!, pp.act)} · {t('read it in your blocks')}</div>}
      {w.type === 'selector' && txt('opts', 'Positions (label=value, …)')}
      {['slider', 'knob', 'numin'].includes(w.type) && <div class="op-2c">{nm('min', 'Min')}{nm('max', 'Max')}{has('step') && nm('step', 'Step')}{has('dec') && nm('dec', 'Decimals')}{txt('unit', 'Unit')}</div>}
      {w.type === 'twohand' && nm('win', 'Both within (s)')}
      {['pushbutton', 'litbutton'].includes(w.type) && txt('key', 'Keyboard shortcut (e.g. F2)')}</>}
    {['lamp', 'gauge', 'bar', 'tank', 'thermo', 'value'].includes(w.type) && <><Sec n="02" title="Binding" /><F label="Shows"><Sel value={pp.src} opts={srcOpts} onChange={v => set('src', v)} empty={t('— choose —')} /></F>
      {['gauge', 'bar', 'tank'].includes(w.type) && <div class="op-2c">{nm('min', 'Min')}{nm('max', 'Max')}{has('warn') && nm('warn', 'Red zone from')}{txt('unit', 'Unit')}</div>}{w.type === 'thermo' && <div class="op-2c">{nm('max', 'Max')}{nm('warn', 'Warning from')}</div>}{w.type === 'value' && <div class="op-2c">{txt('unit', 'Unit')}{nm('dec', 'Decimals')}</div>}</>}
    {w.type === 'tower' && <><Sec n="02" title="Binding" />{(['red', 'amber', 'green', 'blue'] as const).map(k => <F label={k.toUpperCase()}><Sel value={pp[k]} opts={rb} onChange={v => set(k, v)} empty={t('— off —')} /></F>)}</>}
    {['stepchain', 'steptimer'].includes(w.type) && <><Sec n="02" title="Binding" /><F label="Sequence"><Sel value={pp.seq} opts={x.seqNames.map(n => [n, n] as Opt)} onChange={v => set('seq', v)} empty={t('— choose —')} /></F>{w.type === 'steptimer' && nm('timeout', 'Timeout (s)')}</>}
    {['counter', 'production'].includes(w.type) && <><Sec n="02" title="Binding" /><F label="Counter"><Sel value={pp.cnt} opts={x.counters.map(n => [n, n] as Opt)} onChange={v => set('cnt', v)} empty={t('— choose —')} /></F>{nm('preset', 'Preset shown (0 = from the block)')}</>}
    {w.type === 'cylinder' && <><Sec n="02" title="Binding" /><F label="Cylinder"><Sel value={pp.cyl} opts={T.cyls.map(c => [c.tag + ' — ' + c.desc, c.id] as Opt)} onChange={v => set('cyl', v)} empty={t('— choose —')} /></F></>}
    {w.type === 'valve' && <><Sec n="02" title="Binding" /><F label="Valve"><Sel value={pp.valve} opts={valvesOf(p)} onChange={v => set('valve', v)} empty={t('— choose —')} /></F></>}
    {w.type === 'motor' && <><Sec n="02" title="Binding" /><F label="Drive motor"><Sel value={pp.motor} opts={motorsOf(p)} onChange={v => set('motor', v)} empty={t('— first pump —')} /></F></>}
    {w.type === 'ioleds' && <><Sec n="02" title="Binding" /><F label="Show"><select class="in" value={pp.which} onChange={(e: any) => set('which', e.target.value)}><option value="both">{t('Inputs and outputs')}</option><option value="in">{t('Inputs')}</option><option value="out">{t('Outputs')}</option></select></F></>}
    {w.type === 'clock' && <><Sec n="02" title="Binding" /><F label="Time"><select class="in" value={pp.what} onChange={(e: any) => set('what', e.target.value)}><option value="plct">{t('Machine time')}</option><option value="simt">{t('Simulation time')}</option><option value="wall">{t('Wall clock')}</option></select></F></>}
    {w.type === 'pagelink' && <><Sec n="02" title="Binding" /><F label="Opens page"><Sel value={pp.page} opts={pn.pages.map(q => [q.name, q.id] as Opt)} onChange={v => set('page', v)} empty={t('— choose —')} /></F></>}
    {w.type === 'eventlog' && <><Sec n="02" title="Binding" />{nm('n', 'Rows')}</>}
    {w.type === 'trend' && <><Sec n="02" title="Binding" />{[0, 1, 2, 3].map(i => { const a = String(pp.srcs || '').split(',').filter(Boolean); return <F label={`${t('Value')} ${i + 1}`}><Sel value={a[i] || ''} opts={ra} onChange={v => { const b = [0, 1, 2, 3].map(j => j === i ? v : a[j] || '').filter(Boolean); set('srcs', b.join(',')); }} empty={t('— none —')} /></F>; })}{nm('span', 'Time span (s)')}</>}
    {w.type === 'permissives' && <><Sec n="02" title="Binding" /><F label="Items (label = value, one per line; ! = NOT)"><textarea class="in" rows={5} value={pp.items} onChange={(e: any) => set('items', e.target.value)} /></F>
      <F label="Add an item"><Sel value="" opts={rb} onChange={v => { if (!v) return; const lbl = rb.find(o => o[1] === v)?.[0] || v; set('items', (pp.items ? pp.items + '\n' : '') + `${lbl.split(' — ')[0]} = ${v}`); }} empty={t('— pick a condition —')} /></F>
      <div class="muted small">{parseItems(pp.items).length} {t('items')}</div></>}
    {!['group', 'divider', 'spacer', 'label', 'image', 'alarmline', 'alarmlist', 'eventlog', 'message', 'clock', 'tower', 'lamp', 'gauge', 'bar', 'tank', 'thermo', 'value', 'trend', 'stepchain', 'steptimer', 'counter', 'cylinder', 'valve', 'motor', 'ioleds', 'permissives', 'production'].includes(w.type) && <><Sec n="03" title="Access" />
      <F label="Enabled when"><Sel value={pp.en || ''} opts={modeOpts} onChange={v => set('en', v)} empty={t('Always')} /></F>
      <F label="Edit level"><select class="in" value={pp.level || 'oper'} onChange={(e: any) => set('level', e.target.value)}><option value="oper">{t('Operator')}</option><option value="maint">{t('Maintenance (key switch)')}</option></select></F></>}
    <Sec n="04" title="Checks" />
    {iss.length ? iss.map(m => <div class="drule warn"><span class="dot warn" /><span>{m}</span></div>) : <div class="muted">{t('All bindings exist')} ✓</div>}
    <div class="row-c" style={{ marginTop: '10px' }}><Btn icon="copy" label={t('Duplicate')} onClick={() => dup(progId)} /><Btn icon="trash-2" label={t('Delete')} onClick={() => del(progId)} /></div>
  </div>;
}
function PageInsp({ progId, pn }: { progId: string; pn: Panel }) {
  const key = 'edit:' + progId; const pg = pageOf(key, pn); const page = pn.pages.find(x => x.id === pg)!; const i = pn.pages.indexOf(page);
  return <div class="insp"><h3>{t('Page')} · {page.name}</h3>
    <F label="Name"><input class="in" value={page.name} onChange={(e: any) => editPanel(progId, 'Rename page', p => { const x = p.pages.find(q => q.id === pg); if (x && e.target.value.trim()) x.name = e.target.value.trim(); })} /></F>
    <div class="row-c"><Btn icon="arrow-up" label={t('Earlier')} disabled={i === 0} onClick={() => editPanel(progId, 'Move page', p => { const [x] = p.pages.splice(i, 1); p.pages.splice(i - 1, 0, x); })} /><Btn icon="arrow-down" label={t('Later')} disabled={i === pn.pages.length - 1} onClick={() => editPanel(progId, 'Move page', p => { const [x] = p.pages.splice(i, 1); p.pages.splice(i + 1, 0, x); })} /></div>
    <div class="row-c"><Btn icon="trash-2" label={t('Delete page')} disabled={pn.pages.length < 2} onClick={() => { editPanel(progId, 'Delete page', p => { p.pages = p.pages.filter(q => q.id !== pg); const first = p.pages[0].id; p.widgets.forEach(w => { if (w.page === pg) w.page = first; }); }); }} /></div>
    <p class="muted small">{t('Deleting a page moves its widgets to the first page.')}</p></div>;
}
function PanelInsp({ p, progId, pn, pr }: { p: any; progId: string; pn: Panel; pr: Program }) {
  const vars = (pr.vars || []).filter(v => v.type === 'INT'); const iss = allIssues(p, progId);
  return <div class="insp"><h3>{t('Panel')}</h3>
    <F label="Title in the header"><input class="in" value={pn.title || ''} placeholder={p.manifest.name} onChange={(e: any) => editPanel(progId, 'Panel title', x => { x.title = e.target.value; })} /></F>
    <F label="Mode variable (header badge, “enabled when”)"><select class="in" value={pn.modeVar || ''} onChange={(e: any) => editPanel(progId, 'Mode variable', x => { x.modeVar = e.target.value || undefined; })}><option value="">{t('— none —')}</option>{vars.map(v => <option value={v.id}>{v.name}</option>)}</select></F>
    {pn.modeVar && <F label="Mode names (value 0, 1, 2 …)"><input class="in" value={(pn.modes || []).join(', ')} onChange={(e: any) => editPanel(progId, 'Mode names', x => { x.modes = e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean); })} /></F>}
    <Sec n="01" title="Recipes" />{pn.recipes.length ? pn.recipes.map(r => <div class="lcentry"><b>{r.name}</b><small>{Object.keys(r.values).length} {t('values')} <button class="linkbtn small" onClick={() => editPanel(progId, 'Delete recipe', x => { x.recipes = x.recipes.filter(q => q.id !== r.id); })}>{t('delete')}</button></small></div>) : <p class="muted small">{t('Save recipes with the Recipe widget while the machine runs.')}</p>}
    <Sec n="02" title="Checks" />{iss.length ? iss.slice(0, 30).map(x => <button class="drule warn" onClick={() => { editSel.value = x.w.id; setPage('edit:' + progId, x.w.page); insTab.value = 'widget'; }}><span class="dot warn" /><span>{defOf(x.w.type)?.name}: {x.text}</span></button>) : <div class="muted">{t('Every widget is bound')} ✓</div>}
  </div>;
}

// ======================= dock beside the live hydraulics =======================
export const dockOpen = signal(true);
export const dockVisible = (sheet: string) => { const r = L.RT.value; return !!(r?.link && r.link.sheet === sheet && r.rt.state !== 'stopped' && dockOpen.value && panelOf(S.project.value, r.progId)); };
export function PanelDock({ sheet }: { sheet: string }) {
  const r = L.RT.value; L.tick.value; if (!dockVisible(sheet) || !r) return null;
  return <aside class="opdock" aria-label={t('Operator panel')}><div class="opdock-h"><b>{t('Operator panel')}</b><span class="grow" /><button class="iconbtn" title={t('Open as a tab')} onClick={() => openPanelTab(r.progId)}><Icon name="maximize-2" size={13} /></button><button class="iconbtn" title={t('Pop out (second monitor)')} onClick={() => popOut(r.progId)}><Icon name="app-window" size={13} /></button><button class="iconbtn" title={t('Hide')} onClick={() => dockOpen.value = false}><Icon name="x" size={13} /></button></div><PanelView progId={r.progId} view="dock" compact /></aside>;
}
export function openPanelTab(progId?: string) {
  const p = S.project.value; const id = progId || L.activeProgId(p); if (!p) return; const tid = 'panel_' + (id || 'none');
  if (!S.tabs.value.find(x => x.id === tid)) S.tabs.value = [...S.tabs.value, { id: tid, title: t('Operator panel'), kind: 'designer', designer: 'panel', nodeId: id || undefined, docKey: S.activeDoc.value }];
  S.activeTab.value = tid;
}

// ======================= second window (pop out) =======================
const pops = new Map<string, Window>();
export function popOut(progId: string) {
  const old = pops.get(progId); if (old && !old.closed) { old.focus(); return; }
  const win = window.open('', 'hydra_panel_' + progId, 'width=1600,height=960'); if (!win) { S.toast(t('The browser blocked the window — allow pop-ups for HYDRA'), 'warn'); return; }
  const doc = win.document; doc.open(); doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>HYDRA · ${t('Operator panel')}</title></head><body class="oppop"><div id="op"></div></body></html>`); doc.close();
  document.querySelectorAll('style').forEach(s => doc.head.appendChild(doc.importNode(s, true)));
  const root = doc.getElementById('op')!; render(<PopRoot progId={progId} />, root); pops.set(progId, win);
  win.addEventListener('beforeunload', () => { render(null, root); pops.delete(progId); });
}
function PopRoot({ progId }: { progId: string }) {
  const p = S.project.value;
  return <div class="oppop-w"><div class="oppop-bar"><b>■ HYDRA</b><span>{t('Operator panel')} — {p?.manifest.name} · {p?.nodes[progId]?.name}</span><span class="grow" /><MachineCtl progId={progId} /></div><PanelView progId={progId} view="pop" /></div>;
}
