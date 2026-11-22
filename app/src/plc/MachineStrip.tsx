// Logic Coder: on a hydraulic sheet — start the whole machine (simulation + PLC program), and while it runs a
// strip with the program state, the active steps, the operator's buttons (hold-to-press pushbuttons, switches), E-STOP,
// Reset and Stop.
import { h } from 'preact';
import * as S from '../store';
import { t } from '../i18n';
import { Icon, Btn } from '../ui/common';
import * as L from './state';
import { signals } from './signals';
import type { SimLink } from './link';
import { dockOpen, openPanelTab } from './panel/Panel';

export function MachineButton({ sheet }: { sheet: string }) {
  const p = S.project.value; const pid = L.activeProgId(p); L.tick.value;
  if (!pid || !p?.programs[pid]?.ws) return null; const r = L.RT.value;
  if (r?.link && r.rt.state !== 'stopped') return null;
  const go = () => { const c = L.run(pid, 'auto', sheet); if (c && !c.ok) { S.toast(`${t('The program')} “${p.nodes[pid]?.name}” ${t('has errors — open it in the Logic Coder')}`, 'err'); } };
  return <Btn kind="tb" class="mbtn" icon="cpu" label={t('Machine')} title={`${t('Run this sheet with the PLC program')} “${p.nodes[pid]?.name}” — ${t('simulation + program together')}`} onClick={go} />;
}

export function MachineStrip({ sheet }: { sheet: string }) {
  const r = L.RT.value; L.tick.value; if (!r?.link || r.link.sheet !== sheet || r.rt.state === 'stopped') return null;
  const rt = r.rt; const p = S.project.value; const T = signals(p); const ad = rt.adapter as SimLink; const pname = p?.nodes[r.progId]?.name || '';
  const steps = rt.c.seqs.map(q => { const cur = rt.seqs[q.name]?.cur; const st = q.steps.find(x => x.id === cur); return st ? `${q.name}: ${st.id}${st.label ? ' ' + st.label : ''}` : ''; }).filter(Boolean);
  const manual = [...(ad.manual || new Map()).entries()].filter(([id]) => T.byId.get(id) && id !== rt.prog.estop);
  const val = (id: string) => !!rt.rd(id);
  const set = (id: string, v: boolean) => L.setInput(r.progId, id, v);
  const st = rt.state; const act = rt.alarms.filter(a => a.active);
  return <div class={'mstrip ' + st} role="region" aria-label={t('Machine')}>
    <span class={'lcstate ' + st}>{st === 'estop' ? 'E-STOP' : st}</span>
    <button class="mname" title={t('Open the program')} onClick={() => S.openSheetTab(r.progId)}><Icon name="binary" size={13} />{pname}</button>
    {steps.map(s => <span class="mstep mono">{s}</span>)}
    {rt.message && <span class="mmsg">{rt.message}</span>}
    {act.length > 0 && <span class="mal" title={act.map(a => a.text).join('\n')}><Icon name="triangle-alert" size={12} />{act[0].text}{act.length > 1 ? ` +${act.length - 1}` : ''}</span>}
    <span class="grow" />
    {manual.map(([id, m]) => { const s = T.byId.get(id)!; const on = val(id); const lbl = (m.kind === 'manual' && m.func) ? m.func : s.tag;
      return m.kind === 'manual' && m.momentary
        ? <button class={'mpb' + (on !== !!m.nc ? ' on' : '')} title={`${s.tag} · ${s.addr} — ${t('hold to press')}`} onPointerDown={(e: any) => { e.currentTarget.setPointerCapture?.(e.pointerId); set(id, !m.nc); }} onPointerUp={() => set(id, !!m.nc)} onPointerCancel={() => set(id, !!m.nc)}>{lbl}<small>{s.tag}</small></button>
        : <button class={'mpb sw' + (on ? ' on' : '')} title={`${s.tag} · ${s.addr} — ${t('click to switch')}`} onClick={() => set(id, !on)}>{lbl}<small>{s.tag} {on ? 'ON' : 'OFF'}</small></button>; })}
    <Btn kind="tb" icon="layout-dashboard" label={t('Panel')} title={t('Operator panel beside the sheet (tab and pop-out from its corner)')} pressed={dockOpen.value && !!(p?.programs[r.progId] as any)?.panel} onClick={() => { if (!(p?.programs[r.progId] as any)?.panel) { openPanelTab(r.progId); return; } dockOpen.value = !dockOpen.value; }} />
    <Btn kind="tb" class={'lcestop' + (rt.estopCmd ? ' on' : '')} icon="octagon-x" label="E-STOP" pressed={rt.estopCmd} onClick={() => L.estop()} />
    <Btn kind="tb" icon="rotate-ccw" label={t('Reset')} onClick={() => L.reset()} />
    <Btn kind="tb" icon="square" label={t('Stop machine')} onClick={() => L.stop()} />
  </div>;
}
