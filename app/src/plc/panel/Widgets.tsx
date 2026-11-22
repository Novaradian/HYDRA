// Operator panel: the 40 widgets — how each looks (IEC 60073 colours, the HYDRA panel style) and acts.
import { h, Fragment } from 'preact';
import { useRef, useState } from 'preact/hooks';
import * as S from '../../store';
import { t } from '../../i18n';
import * as L from '../state';
import { signals } from '../signals';
import { COLOURS, parseItems, parseOpts, type Widget, type Panel } from './model';
import { readSrc, write, levelOf, setLevel, sampleTrend, production, editPanel, type Ctx } from './rt';

export type WProps = { w: Widget; c: Ctx; edit: boolean; panel: Panel; goPage: (id: string) => void };
const num = (v: any, d = 1) => v == null || v === '' || !isFinite(+v) ? '—' : (+v).toFixed(d);
const col = (k: string) => (COLOURS[k] || COLOURS.green)[0];
// the binding shown small in the widget head (tag · address, variable name …)
export function tagOf(c: Ctx, s: string): string {
  if (!s) return ''; const T = signals(c.p); const i = s.indexOf(':'); const k = s.slice(0, i), a = s.slice(i + 1);
  if (k === 'in' || k === 'sig') { const g = T.byId.get(a); return g ? g.tag + (g.addr ? ' · ' + g.addr : '') : '⚠'; }
  if (k === 'var') return (c.pr.vars || []).find(v => v.id === a)?.name || '⚠';
  if (k === 'cmd') return a; if (k === 'live') { const [cid, prm] = a.split(':'); for (const sh of Object.values(c.p.circuits) as any[]) { const x = (sh.components || []).find((q: any) => q.id === cid); if (x) return `${x.tag} ${prm}`; } return '⚠'; }
  if (k === 'cyl+' || k === 'cyl-') return (T.cylById.get(a)?.tag || '?') + (k === 'cyl+' ? '+' : '−');
  if (s === 'oil') return 'oil'; if (k === 'pp' || k === 'pq') { for (const sh of Object.values(c.p.circuits) as any[]) { const x = (sh.components || []).find((q: any) => q.id === a); if (x) return x.tag + (k === 'pp' ? ' p' : ' Q'); } }
  return s.replace(/^st:/, '');
}
export function enabledOf(w: Widget, c: Ctx, panel: Panel) {
  const p = w.p; if (p.level === 'maint' && levelOf(c.progId) !== 'maint') return { ok: false, why: t('Needs MAINTENANCE access (key switch)') };
  if (p.en) { if (p.en.startsWith('mode:')) { const want = +p.en.slice(5); const cur = panel.modeVar ? +readSrc(c, 'var:' + panel.modeVar) : 0; if (cur !== want) return { ok: false, why: `${t('Only in')} ${(panel.modes || [])[want] || 'mode ' + want}` }; }
    else if (!readSrc(c, p.en)) return { ok: false, why: t('Not enabled now') }; }
  return { ok: true, why: '' };
}
// a number field that keeps what the user types while it has focus (the panel refreshes 10× a second)
export function LiveNum({ value, onCommit, ...rest }: { value: any; onCommit: (v: number) => void; [k: string]: any }) {
  const [ed, setEd] = useState<string | null>(null);
  return <input {...rest} type="number" value={ed ?? value} onFocus={() => setEd(String(value ?? ''))} onInput={(e: any) => setEd(e.target.value)} onBlur={() => { if (ed != null && ed !== '' && ed !== String(value)) onCommit(+ed); setEd(null); }} onKeyDown={(e: any) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setEd(null); e.currentTarget.blur(); } }} />;
}
const Head = ({ label, tag }: { label?: string; tag?: string }) => label || tag ? <h5 class="op-h">{label || ''}{tag ? <em>{tag}</em> : null}</h5> : null;

// press-and-hold helper: pointer and keyboard
function press(on: (v: boolean) => void, disabled: boolean) {
  const down = (e: any) => { if (disabled) return; e.preventDefault?.(); try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { } e.currentTarget.dataset.held = '1'; on(true); };
  const up = (e: any) => { if (e.currentTarget.dataset.held !== '1') return; e.currentTarget.dataset.held = ''; on(false); };
  return { onPointerDown: down, onPointerUp: up, onPointerCancel: up, onLostPointerCapture: up };
}

// ---------- SVG pieces ----------
function Gauge({ v, mn, mx, warn, unit }: { v: number; mn: number; mx: number; warn: number; unit: string }) {
  const span = mx - mn || 1; const pt = (val: number, r: number) => { const a = (210 - 240 * (Math.min(mx, Math.max(mn, val)) - mn) / span) * Math.PI / 180; return [60 + r * Math.cos(a), 60 - r * Math.sin(a)]; };
  const arc = (a: number, b: number, r: number) => { const [x0, y0] = pt(a, r), [x1, y1] = pt(b, r); const large = (b - a) / span * 240 > 180 ? 1 : 0; return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  const ticks = Array.from({ length: 6 }, (_, i) => mn + span * i / 5); const [nx, ny] = pt(isFinite(v) ? v : mn, 44);
  return <svg viewBox="0 0 120 100" class="op-gauge"><path d={arc(mn, Math.min(warn, mx), 48)} stroke="#C9D3DE" stroke-width="8" fill="none" />{warn < mx && <path d={arc(warn, mx, 48)} stroke="#E57373" stroke-width="8" fill="none" />}
    {ticks.map(tk => { const [a, b] = pt(tk, 40), [c2, d] = pt(tk, 34), [lx, ly] = pt(tk, 26); return <g><line x1={a} y1={b} x2={c2} y2={d} stroke="#3A4757" /><text x={lx} y={ly + 3} font-size="7" text-anchor="middle" fill="#5B6878" font-family="JetBrains Mono">{Math.round(tk)}</text></g>; })}
    <line x1="60" y1="60" x2={nx} y2={ny} stroke="#C62828" stroke-width="2.4" /><circle cx="60" cy="60" r="4" fill="#1B2633" />
    <text x="60" y="96" font-size="13" font-weight="700" text-anchor="middle" font-family="JetBrains Mono" fill="#1B2633">{num(v, v >= 100 ? 0 : 1)} {unit}</text></svg>;
}
function Knob({ v, mn, mx, unit }: { v: number; mn: number; mx: number; unit: string }) {
  const f = Math.max(0, Math.min(1, (v - mn) / ((mx - mn) || 1))); const a = (225 - 270 * f) * Math.PI / 180; const ex = 50 + 40 * Math.cos(a), ey = 50 - 40 * Math.sin(a);
  return <svg viewBox="0 0 100 96" class="op-knob"><path d="M21.7 78.3 A40 40 0 1 1 78.3 78.3" stroke="#DDE3EA" stroke-width="7" fill="none" />{f > 0.001 && <path d={`M21.7 78.3 A40 40 0 ${270 * f > 180 ? 1 : 0} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`} stroke="#0A64C2" stroke-width="7" fill="none" />}
    <circle cx="50" cy="50" r="26" fill="#3A4757" /><line x1="50" y1="50" x2={50 + 22 * Math.cos(a)} y2={50 - 22 * Math.sin(a)} stroke="#fff" stroke-width="3" stroke-linecap="round" />
    <text x="50" y="94" font-size="11" font-weight="700" text-anchor="middle" font-family="JetBrains Mono">{num(v, Math.abs(mx - mn) <= 10 ? 1 : 0)} {unit}</text></svg>;
}
function Selector({ opts, cur }: { opts: [string, number][]; cur: number }) {
  const n = opts.length; const angs = n <= 1 ? [0] : opts.map((_, i) => -45 + 90 * i / (n - 1)); const ix = Math.max(0, opts.findIndex(o => o[1] === cur));
  return <svg viewBox="0 0 100 100" class="op-sel">{opts.map((o, i) => { const r = (90 - angs[i]) * Math.PI / 180; return <text x={50 + 42 * Math.cos(r)} y={55 - 42 * Math.sin(r)} font-size="8.5" font-weight="700" text-anchor="middle" font-family="IBM Plex Sans" fill={i === ix ? '#0A64C2' : '#8A97A6'}>{o[0]}</text>; })}
    <circle cx="50" cy="60" r="27" fill="#2E3B4A" /><circle cx="50" cy="60" r="22" fill="#3A4757" /><g transform={`rotate(${angs[ix] || 0} 50 60)`}><rect x="45" y="34" width="10" height="52" rx="4" fill="#1B2633" /><rect x="48.5" y="36" width="3" height="12" fill="#fff" /></g></svg>;
}
function KeySw({ maint }: { maint: boolean }) {
  return <svg viewBox="0 0 100 100" class="op-sel"><text x="22" y="20" font-size="8" font-weight="700" text-anchor="middle" fill={maint ? '#8A97A6' : '#0A64C2'} font-family="IBM Plex Sans">OPER</text><text x="78" y="20" font-size="8" font-weight="700" text-anchor="middle" fill={maint ? '#0A64C2' : '#8A97A6'} font-family="IBM Plex Sans">MAINT</text>
    <circle cx="50" cy="56" r="30" fill="#C9D3DE" /><circle cx="50" cy="56" r="24" fill="#EDF1F5" stroke="#9AA6B2" /><g transform={`rotate(${maint ? 40 : -40} 50 56)`}><rect x="47" y="36" width="6" height="40" rx="2" fill="#5B6878" /><circle cx="50" cy="36" r="7" fill="#5B6878" /><circle cx="50" cy="36" r="2.5" fill="#EDF1F5" /></g></svg>;
}
function CylPic({ frac, plus, minus }: { frac: number; plus: boolean; minus: boolean }) {
  const bx = 8, bl = 150, ext = frac * 110, px = bx + 6 + frac * (bl - 18), endx = px + 8 + bl - (px - bx) + ext;
  return <svg viewBox="0 0 300 54" class="op-cyl"><rect x={bx} y="10" width={bl} height="26" fill="#EEF4FB" stroke="#1B2633" stroke-width="1.6" /><rect x={bx + 2} y="12" width={Math.max(0, px - bx - 2)} height="22" fill="#BBD5F2" opacity=".8" />
    <rect x={px} y="11" width="8" height="24" fill="#1B2633" /><rect x={px + 8} y="20" width={Math.max(0, endx - px - 8)} height="6" fill="#5B6878" /><rect x={endx} y="15" width="6" height="16" fill="#1B2633" />
    {[[minus, bx + 10, '−'], [plus, bx + bl - 12, '+']].map(([lit, x, l]: any) => <g><circle cx={x} cy="45" r="4.5" fill={lit ? '#3BD16F' : '#DDE3EA'} stroke={lit ? '#167A38' : '#AEB9C5'} /><text x={x + 8} y="48" font-size="8" font-family="JetBrains Mono" fill="#5B6878">{l}</text></g>)}</svg>;
}
const Bar = ({ f, colour = '#0A64C2', mark }: { f: number; colour?: string; mark?: number }) => <div class="op-bw"><b style={{ width: Math.max(0, Math.min(100, f * 100)) + '%', background: colour }} />{mark != null && <span class="op-mk" style={{ left: Math.max(0, Math.min(100, mark * 100)) + '%' }} />}</div>;
const Lamp = ({ on, colour, label }: { on: boolean; colour: string; label: string }) => <div class={'op-lamp' + (on ? ' on' : '')} style={on ? { '--lc': col(colour) } as any : undefined}><i />{label}</div>;

// ======================= the widgets =======================
export function WidgetBody({ w, c, edit, panel, goPage }: WProps) {
  const p = w.p; const en = edit ? { ok: true, why: '' } : enabledOf(w, c, panel); const dis = edit || !en.ok;
  const R = (s: string) => readSrc(c, s);
  const momentary = (tgt: string) => press(v => write(c, tgt, v, { momentary: true }), dis || !tgt);
  switch (w.type) {
    case 'pushbutton': case 'litbutton': {
      const isCmd = String(p.act || '').startsWith('cmd:'); const lit = w.type === 'litbutton' ? !!R(p.lamp) : false; const ev = isCmd ? { onClick: () => !dis && write(c, p.act, true) } : momentary(p.act);
      const pressed = !isCmd && p.act?.startsWith('in:') ? !!R('sig:' + p.act.slice(3)) : false;
      return <><Head label={p.label} tag={tagOf(c, p.act)} /><button class={'op-pb' + (lit ? ' lit' : '') + (pressed ? ' down' : '') + (dis && !edit ? ' dis' : '')} style={{ background: col(p.colour), color: p.colour === 'amber' || p.colour === 'white' ? '#1B2633' : '#fff' }} title={en.why || (p.key ? `${p.label} (${p.key})` : p.label)} data-key={p.key || ''} data-act={p.act || ''} {...ev}>{p.label}{p.key ? <small>{p.key}</small> : null}</button></>;
    }
    case 'estop': {
      const tgt = p.act || 'cmd:estop'; const isIn = tgt.startsWith('in:'); const id = tgt.slice(3);
      const nc = isIn ? !!inputSources(c.p, signals(c.p)).get(id)?.nc : false; const cur = isIn ? (c.rt ? c.rt.sim[id] : L.simOf(c.progId)[id]) ?? nc : false;
      const pressed = isIn ? cur === !nc : !!c.rt?.estopCmd;
      const click = () => { if (edit) return; if (isIn) L.setInput(c.progId, id, pressed ? nc : !nc); else L.estop(!pressed); };
      return <><Head label={p.label} tag={tagOf(c, tgt)} /><div class="op-ctr"><button class={'op-estop' + (pressed ? ' on' : '')} title={pressed ? t('Pressed — click to release (twist)') : t('Press for emergency stop')} onClick={click}><span>STOP</span></button></div><div class="op-sub">{pressed ? t('PRESSED · click to release') : t('click · triggers ON E-STOP')}</div></>;
    }
    case 'selector': {
      const opts = parseOpts(p.opts); const cur = +R(p.act) || 0; const isBool = String(p.act).startsWith('in:');
      const step = (d: number) => { if (dis) return; const ix = Math.max(0, opts.findIndex(o => o[1] === (isBool ? +!!R('sig:' + p.act.slice(3)) : cur))); const nx = opts[Math.max(0, Math.min(opts.length - 1, ix + d))]; if (nx) write(c, p.act, isBool ? !!nx[1] : nx[1], { retain: true }); };
      const curV = isBool ? +!!R('sig:' + String(p.act).slice(3)) : cur;
      return <><Head label={p.label} tag={tagOf(c, p.act)} /><div class="op-ctr op-turn"><button class="op-arr" disabled={dis} onClick={() => step(-1)} aria-label={t('Turn left')}>◀</button><div onClick={() => step(1)}><Selector opts={opts} cur={curV} /></div><button class="op-arr" disabled={dis} onClick={() => step(1)} aria-label={t('Turn right')}>▶</button></div><div class="op-seg">{opts.map(o => <button class={o[1] === curV ? 'on' : ''} disabled={dis} onClick={() => write(c, p.act, isBool ? !!o[1] : o[1], { retain: true })}>{o[0]}</button>)}</div></>;
    }
    case 'keyswitch': { const m = levelOf(c.progId) === 'maint'; return <><Head label={p.label} tag="key" /><div class="op-ctr" onClick={() => { if (edit) return; setLevel(c.progId, m ? 'oper' : 'maint'); if (p.act) write(c, p.act, !m); }} title={t('Turn the key')}><KeySw maint={m} /></div><div class={'op-lamp' + (m ? ' on' : '')} style={m ? { '--lc': col('amber') } as any : undefined}><i />{m ? t('MAINTENANCE level') : t('OPERATOR level')}</div></>; }
    case 'toggle': { const v = String(p.act).startsWith('in:') ? !!R('sig:' + p.act.slice(3)) : !!R(p.act); return <div class="op-row op-tg"><span>{p.label}</span><span class="tag">{tagOf(c, p.act)}</span><button class={'op-tsw' + (v ? ' on' : '')} disabled={dis} title={en.why} onClick={() => write(c, p.act, !v, { retain: true })} aria-pressed={v} /></div>; }
    case 'twohand': return <TwoHand w={w} c={c} dis={dis} />;
    case 'jog': {
      const a = momentary(p.act), b = momentary(p.act2); const va = !!R(p.act), vb = !!R(p.act2);
      return <><Head label={`${t('Jog')} ${p.label} · ${t('hold to run')}`} tag={en.ok ? '' : en.why} /><div class="op-row"><button class={'op-jog' + (va ? ' hold' : '') + (dis ? ' dis' : '')} {...a}>{p.label}+</button><button class={'op-jog' + (vb ? ' hold' : '') + (dis ? ' dis' : '')} {...b}>{p.label}−</button></div></>;
    }
    case 'slider': { const v = +R(p.act) || 0; return <><div class="op-row sb"><span class="op-wl">{p.label}</span><span class="tag">{tagOf(c, p.act)}</span></div><div class="op-row"><input class="op-range" type="range" min={p.min} max={p.max} step={p.step || 1} value={v} disabled={dis} title={en.why} onChange={(e: any) => write(c, p.act, +e.target.value, { retain: true })} onInput={(e: any) => write(c, p.act, +e.target.value)} /><b class="op-mid">{num(v, (p.step || 1) < 1 ? 1 : 0)} {p.unit}</b></div></>; }
    case 'knob': { const v = +R(p.act) || 0; const wheel = (e: any) => { if (dis) return; e.preventDefault(); const st = +p.step || 1; write(c, p.act, Math.max(+p.min, Math.min(+p.max, v + (e.deltaY < 0 ? st : -st))), { retain: true }); };
      return <><Head label={p.label} tag={tagOf(c, p.act)} /><div class="op-ctr" onWheel={wheel} title={en.why || t('Scroll to turn, or use − / +')}><Knob v={v} mn={+p.min} mx={+p.max} unit={p.unit} /></div><div class="op-row ctr"><button class="op-mini" disabled={dis} onClick={() => write(c, p.act, Math.max(+p.min, v - (+p.step || 1)), { retain: true })}>−</button><LiveNum class="op-in sm" value={+v.toFixed(2)} disabled={dis} onCommit={x => write(c, p.act, Math.max(+p.min, Math.min(+p.max, x)), { retain: true })} /><button class="op-mini" disabled={dis} onClick={() => write(c, p.act, Math.min(+p.max, v + (+p.step || 1)), { retain: true })}>+</button></div></>; }
    case 'numin': { const v = R(p.act); return <><div class="op-row sb"><span class="op-wl">{p.label}</span><span class="tag">{tagOf(c, p.act)}</span></div><div class="op-inp"><LiveNum value={v == null ? '' : +(+v).toFixed(+p.dec || 0)} min={p.min} max={p.max} disabled={dis} title={en.why} onCommit={x => write(c, p.act, Math.max(+p.min, Math.min(+p.max, x)), { retain: true })} /><span class="u">{p.unit}</span></div><span class="tag">{p.min} – {p.max}</span></>; }
    case 'recipe': return <RecipeW w={w} c={c} panel={panel} dis={dis} />;
    case 'lamp': return <div class="op-row"><Lamp on={!!R(p.src)} colour={p.colour} label={p.label} /><span class="grow" /><span class="tag">{tagOf(c, p.src)}</span></div>;
    case 'tower': { const L4: [string, string, string][] = [['red', '#E53935', '#F7D4D4'], ['amber', '#F5A623', '#FBE7C7'], ['green', '#3BD16F', '#D3F2DE'], ['blue', '#1E88E5', '#D4E6F8']];
      return <div class="op-stl">{L4.map(([k, on, off], i) => { const lit = p[k] ? !!R(p[k]) : false; return <i title={`${k}: ${p[k] ? tagOf(c, p[k]) : '—'}`} style={{ background: lit ? on : off, boxShadow: lit ? `0 0 12px ${on}` : 'none', borderRadius: i === 0 ? '6px 6px 0 0' : 0 }} />; })}<i class="b1" /><i class="b2" /></div>; }
    case 'gauge': return <><Head label={p.label} tag={tagOf(c, p.src)} /><Gauge v={+R(p.src)} mn={+p.min || 0} mx={+p.max || 100} warn={+p.warn || +p.max} unit={p.unit} /></>;
    case 'bar': { const v = +R(p.src); return <><div class="op-row sb"><span class="op-wl">{p.label}</span><span class="op-mid">{num(v)} {p.unit}</span></div><Bar f={(v - (+p.min || 0)) / ((+p.max || 100) - (+p.min || 0))} colour={col(p.colour || 'blue')} /></>; }
    case 'tank': { const v = +R(p.src) || 0; const f = Math.max(0, Math.min(1, (v - (+p.min || 0)) / ((+p.max || 100) - (+p.min || 0)))); return <><Head label={p.label} /><svg viewBox="0 0 60 120" class="op-tank"><rect x="10" y="6" width="34" height="104" rx="3" fill="#F4F7FA" stroke="#3A4757" stroke-width="1.5" /><rect x="12" y={8 + 100 * (1 - f)} width="30" height={100 * f} fill="#7FB2E5" /><text x="27" y="119" font-size="9" font-weight="700" text-anchor="middle" font-family="JetBrains Mono">{num(v, 0)} {p.unit}</text></svg></>; }
    case 'thermo': { const v = +R(p.src || 'oil') || 0; const mx = +p.max || 80; const f = Math.max(0, Math.min(1, v / mx)); const hot = v >= (+p.warn || mx); const H = 120;
      return <><Head label={p.label} /><svg viewBox={`0 0 50 ${H}`} class="op-tank"><rect x="18" y="6" width="14" height={H - 34} rx="7" fill="#F4F7FA" stroke="#3A4757" stroke-width="1.3" /><circle cx="25" cy={H - 24} r="10" fill={hot ? '#E0A100' : '#1E9E4A'} stroke="#3A4757" stroke-width="1.3" /><rect x="21" y={6 + (H - 38) * (1 - f)} width="8" height={(H - 38) * f + 4} fill={hot ? '#E0A100' : '#1E9E4A'} />
        <line x1="33" x2="40" y1={6 + (H - 38) * (1 - (+p.warn || mx) / mx)} y2={6 + (H - 38) * (1 - (+p.warn || mx) / mx)} stroke="#E0A100" stroke-width="2" /><text x="25" y={H - 1} font-size="9" font-weight="700" text-anchor="middle" font-family="JetBrains Mono">{num(v)} °C</text></svg></>; }
    case 'value': return <div class="op-row sb"><span>{p.label} <span class="tag">{tagOf(c, p.src)}</span></span><b class="op-mid">{(() => { const v = R(p.src); return typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : typeof v === 'string' ? v : num(v, +p.dec || 0); })()} {p.unit}</b></div>;
    case 'trend': return <TrendW w={w} c={c} />;
    case 'stepchain': { const q = c.rt?.c?.seqs.find((x: any) => x.name === p.seq); const cur = c.rt?.seqs[p.seq]?.cur; const ix = q ? q.steps.findIndex((x: any) => x.id === cur) : -1;
      return <><Head label={p.label} tag="GRAFCET" />{q || !c.rt ? <div class="op-chain">{(q?.steps || stepsOf(c, p.seq)).map((s: any, i: number) => <><div class={'op-stp' + (i === ix ? ' on' : i < ix ? ' done' : '') + (i === 0 ? ' init' : '')}><b>{s.id}</b><span>{s.label}</span></div>{i < (q?.steps || stepsOf(c, p.seq)).length - 1 && <div class={'op-tr' + (i < ix ? ' done' : '')}><i /></div>}</>)}</div> : <div class="op-sub">{t('Sequence')} {p.seq} {t('not in the program')}</div>}
        {q && cur && <div class="op-sub">{t('waiting for')} <b class="mono">{q.steps[ix]?.cond}</b></div>}</>; }
    case 'steptimer': { const q = c.rt?.c?.seqs.find((x: any) => x.name === p.seq); const st = c.rt?.seqs[p.seq]; const tt = st ? Math.max(0, c.rt.t - st.t0) : 0; const to = +p.timeout || 5;
      return <><div class="op-row sb"><span class="op-wl">{p.label} · {st?.cur || '—'}</span><span class="tag">{t('timeout')} {to} s</span></div><Bar f={tt / to} colour={tt > to ? '#C62828' : '#0A64C2'} mark={1} /><div class="op-row sb"><span class="op-mid">{num(tt)} s</span><span class="op-sub">{q && st ? q.steps.find((x: any) => x.id === st.cur)?.cond : ''}</span></div></>; }
    case 'counter': { const cv = c.rt?.counters[p.cnt]?.CV ?? 0; const pv = +p.preset || c.rt?.counters[p.cnt]?.PV || 0; return <><Head label={p.label} tag={p.cnt} /><div class="op-row sb" style={{ alignItems: 'baseline' }}><span class="op-big">{String(cv).padStart(4, '0')}</span>{pv ? <span class="tag">/ {pv}</span> : null}</div>{pv ? <Bar f={cv / pv} colour="#1E9E4A" /> : null}</>; }
    case 'cylinder': { const T = signals(c.p); const cy = T.cylById.get(p.cyl); const e = ((c.sim?.els || []) as any[]).find(x => x.kind === 'actuator' && x.el?.comp?.id === String(p.cyl).slice(4)); const x = e ? e.state.x / e.state.L : 0;
      const plus = !!R('cyl+:' + p.cyl), minus = !!R('cyl-:' + p.cyl);
      return <div class="op-cylw"><b class="mono">{p.label || cy?.tag || '?'}</b><CylPic frac={x} plus={plus} minus={minus} /><div class="op-cylv"><b class="op-mid" style={{ color: e && Math.abs(e.state.v) > 1e-3 ? '#0A64C2' : undefined }}>{e ? num(e.state.x * 1000, 0) + ' mm' : '—'}</b><span class="tag">{e ? `${num(e.state.v * 1000, 0)} mm/s${plus ? ' · at +' : minus ? ' · at −' : ''}` : t('not simulated')}</span></div></div>; }
    case 'valve': { const e = ((c.sim?.els || []) as any[]).find(x => x.kind === 'valve' && x.el?.comp?.id === p.valve); const nm = p.label || findTag(c, p.valve); const L2: string[] = e?.letters || ['a', '0', 'b'];
      return <div class="op-col"><span class="tag">{nm}{e?.sol?.on ? ` · ${e.sol.a ? 'sol a' : e.sol.b ? 'sol b' : 'off'}` : ''}</span><div class="op-vs" style={{ gridTemplateColumns: `repeat(${L2.length},1fr)` }}>{L2.map((l, i) => <span class={e && e.state.pos === i ? 'on' : ''}>{l}</span>)}</div></div>; }
    case 'motor': { const pid = motorPump(c, p.motor); const pe = ((c.sim?.els || []) as any[]).find(x => x.kind === 'pump' && x.el?.comp?.id === pid); const Lv = pe && c.sim.live.get(pe.el.key); const n = Lv?.n ? Lv.n.get() : Lv?.disp ? Lv.disp.get() * 1450 : 0; const on = !!c.sim && !!pe && n > 0.5;
      return <><Head label={p.label} tag={findTag(c, p.motor)} /><div class="op-row"><svg viewBox="0 0 60 60" class="op-mot"><circle cx="30" cy="30" r="24" fill={on ? '#E8F7EE' : '#F2F4F6'} stroke={on ? '#1E9E4A' : '#9AA6B2'} stroke-width="3" /><text x="30" y="36" font-size="18" font-weight="700" text-anchor="middle" fill={on ? '#1E9E4A' : '#8A97A6'} font-family="IBM Plex Sans">M</text></svg>
        <div class="op-kv"><span>{t('State')}</span><b style={{ color: on ? '#1E9E4A' : '#8A97A6' }}>{on ? t('RUNNING') : t('OFF')}</b><span>{t('Speed')}</span><b class="mono">{num(n, 0)} rpm</b><span>{t('Flow')}</span><b class="mono">{pe ? num((pe.read?.(c.sim)?.val || 0) * 60000) + ' L/min' : '—'}</b></div></div></>; }
    case 'ioleds': { const T = signals(c.p); const ins = T.sigs.filter(s => s.dir === 'in' && s.src === 'plc'), outs = T.sigs.filter(s => s.dir === 'out' && s.src === 'plc');
      const strip = (list: any[], q: boolean) => <div class="op-leds">{list.map(s => <span class={'op-led' + (R('sig:' + s.id) ? (q ? ' qon' : ' on') : '')} title={`${s.tag} — ${s.desc}`}><i />{s.addr}</span>)}</div>;
      return <><Head label={p.label} tag="live" />{p.which !== 'out' && <><span class="op-wl">{t('Inputs')}</span>{strip(ins, false)}</>}{p.which !== 'in' && <><span class="op-wl">{t('Outputs')}</span>{strip(outs, true)}</>}{!ins.length && !outs.length && <span class="op-sub">{t('No PLC I/O drawn on an electric sheet')}</span>}</>; }
    case 'permissives': return <><Head label={p.label} />{parseItems(p.items).map(([l, s]) => { const ok = !!R(s); return <div class="op-chk"><b class={ok ? 'ok' : 'no'}>{ok ? '✓' : '✕'}</b>{l}</div>; })}</>;
    case 'alarmline': { const a = c.rt?.alarms.find((x: any) => x.active) || c.rt?.alarms[0]; return <div class="op-row op-al">{a ? <><span class={'op-sev ' + a.sev} /><b class="mono">{a.t.toFixed(2)} s</b><b>{a.code.split(':')[0]}</b><span class="grow ell">{a.text}{a.active ? '' : ' · ' + t('cleared')}</span>{!a.acked && <button class="op-ack" onClick={() => { a.acked = true; L.tick.value++; }}>ACK</button>}</> : <span class="op-sub">✓ {t('no alarms')}</span>}</div>; }
    case 'alarmlist': { const list = c.rt?.alarms || []; return <><Head label={p.label} tag={`${list.filter((a: any) => a.active).length} ${t('active')} · ${list.length} ${t('total')}`} /><div class="op-scroll"><table class="op-at"><thead><tr><th /><th>{t('Code')}</th><th>{t('Time')}</th><th>{t('Message')}</th><th>{t('State')}</th><th /></tr></thead><tbody>{list.map((a: any) => <tr class={a.active ? 'act' : ''}><td><span class={'op-sev ' + a.sev} /></td><td class="mono"><b>{a.code.split(':')[0]}</b></td><td class="mono">{a.t.toFixed(2)} s</td><td>{a.text}</td><td>{a.active ? t('active') : t('cleared')}{a.acked ? ' · ' + t('acked') : ''}</td><td>{!a.acked && <button class="op-ack" onClick={() => { a.acked = true; L.tick.value++; }}>ACK</button>}</td></tr>)}{!list.length && <tr><td colSpan={6} class="op-sub">{t('No alarms')}</td></tr>}</tbody></table></div>
        <div class="op-row"><span class="grow" /><button class="op-pb sm" style={{ background: col('blue') }} onClick={() => { c.rt?.ack(); L.tick.value++; }}>{t('ACK ALL')}</button></div></>; }
    case 'eventlog': { const T = signals(c.p); const ev = (c.rt?.events || []).slice(-(+p.n || 6)).reverse(); return <><Head label={p.label} tag={t('output changes')} />{ev.map((e: any) => <div class="op-row op-ev"><span class={'op-sev ' + (e.v ? 'I' : 'x')} /><span class="tag">{e.t.toFixed(2)} s</span><span>{T.byId.get(e.id)?.tag || e.id} {e.v ? 'ON' : 'OFF'}</span></div>)}{!ev.length && <span class="op-sub">{t('No changes yet')}</span>}</>; }
    case 'production': { const pr = production(c, p.cnt); const pv = +p.preset || c.rt?.counters[p.cnt]?.PV || 0;
      return <><Head label={p.label} tag={p.cnt || t('counter')} /><div class="op-row sb" style={{ alignItems: 'baseline' }}><span class="op-big">{String(pr.cv).padStart(4, '0')}</span>{pv ? <span class="tag">/ {pv} {t('preset')}</span> : null}</div>{pv ? <Bar f={pr.cv / pv} colour="#1E9E4A" /> : null}
        <div class="op-kv2"><div><span class="op-wl">{t('Cycle last')}</span><b class="op-mid">{num(pr.last, 2)} s</b></div><div><span class="op-wl">{t('Cycle avg')}</span><b class="op-mid">{num(pr.avg, 2)} s</b></div><div><span class="op-wl">{t('Parts / h')}</span><b class="op-mid">{num(pr.perHour, 0)}</b></div><div><span class="op-wl">{t('Run time')}</span><b class="op-mid">{num(pr.runPct, 1)} %</b></div></div></>; }
    case 'message': return <div class="op-row op-msg"><span>ⓘ</span><span class="ell">{c.rt?.message || (c.rt ? t('Machine running') : t('Machine stopped'))}</span></div>;
    case 'clock': { const v = p.what === 'wall' ? new Date().toLocaleTimeString() : p.what === 'simt' ? fmtT(c.sim?.t || 0) : fmtT(c.rt?.t || 0); return <div class="op-row sb"><span class="op-wl">{p.label}</span><b class="op-mid">{v}</b></div>; }
    case 'group': return <div class="op-grouph">{p.label}</div>;
    case 'label': return <div class="op-label" style={{ fontSize: (+p.size || 14) + 'px' }}>{p.label}</div>;
    case 'divider': return <hr class="op-hr" />;
    case 'image': return p.src ? <img class="op-img" src={p.src} alt="" /> : <div class="op-sub">{t('No image — choose one in the inspector')}</div>;
    case 'pagelink': return <button class="op-pb sm" style={{ background: col('dark') }} onClick={() => !edit && goPage(p.page)}>{p.label} ⇥</button>;
    case 'spacer': return null;
  }
  return <div class="op-sub">{w.type}</div>;
}
const fmtT = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${x.toFixed(1).padStart(4, '0')}`; };
const findTag = (c: Ctx, cid: string) => { for (const sh of Object.values(c.p.circuits) as any[]) { const x = (sh.components || []).find((q: any) => q.id === cid); if (x) return x.tag; } return '?'; };
import { pumpOfMotor, inputSources } from '../link';
const motorPump = (c: Ctx, motor: string) => motor ? pumpOfMotor(c.p, motor) : ((Object.values(c.p.circuits) as any[]).flatMap(sh => sh.components || []).find((x: any) => /pump/.test(x.ref)) || {}).id;
function stepsOf(c: Ctx, seq: string) { const out: any[] = []; const walk = (b: any) => { if (!b) return; if (b.type === 'hy_seq' && b.fields?.NAME === seq) { let s = b.inputs?.STEPS?.block; while (s) { out.push({ id: s.fields?.ID, label: s.fields?.LABEL }); s = s.next?.block; } } Object.values(b.inputs || {}).forEach((i: any) => walk(i.block)); walk(b.next?.block); }; (c.pr.ws?.blocks?.blocks || []).forEach(walk); return out; }

function TwoHand({ w, c, dis }: { w: Widget; c: Ctx; dis: boolean }) {
  const [st, setSt] = useState({ l: 0, r: 0 }); const ref = useRef({ l: 0, r: 0 }); const p = w.p; const win = (+p.win || 0.5) * 1000;
  const upd = (k: 'l' | 'r', v: number) => { const s = { ...ref.current, [k]: v }; ref.current = s; setSt(s); const ok = !!s.l && !!s.r && Math.abs(s.l - s.r) <= win; write(c, p.act, ok, { momentary: true }); };
  const hand = (k: 'l' | 'r') => ({ onPointerDown: (e: any) => { if (dis) return; try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { } upd(k, performance.now()); }, onPointerUp: () => upd(k, 0), onPointerCancel: () => upd(k, 0) });
  const ok = !!st.l && !!st.r && Math.abs(st.l - st.r) <= win;
  return <><Head label={p.label} tag={tagOf(c, p.act)} /><div class="op-row" style={{ justifyContent: 'space-around' }}><button class={'op-2h' + (st.l ? ' on' : '')} disabled={dis} {...hand('l')} aria-label={t('Left hand')} /><span class={'tag ' + (ok ? 'okc' : '')} style={{ textAlign: 'center' }}>{ok ? t('ACTIVE') : <>{t('both within')}<br />{+p.win || 0.5} s</>}</span><button class={'op-2h' + (st.r ? ' on' : '')} disabled={dis} {...hand('r')} aria-label={t('Right hand')} /></div></>;
}
function RecipeW({ w, c, panel, dis }: { w: Widget; c: Ctx; panel: Panel; dis: boolean }) {
  const [sel, setSel] = useState(panel.recipes[0]?.id || ''); const r = panel.recipes.find(x => x.id === sel) || panel.recipes[0];
  const setVars = () => panel.widgets.filter(x => x.page === 'setp' || ['numin', 'slider', 'knob', 'toggle'].includes(x.type)).map(x => x.p.act).filter((a: string) => a && (a.startsWith('var:') || a.startsWith('live:')));
  const save = async () => { const nm = (await S.promptDlg(t('Save recipe'), t('Recipe name'), r ? r.name + ' copy' : 'Recipe 1'))?.trim(); if (!nm) return; const values: Record<string, any> = {}; [...new Set(setVars())].forEach((a: string) => values[a] = readSrc(c, a));
    const id = 'r' + Date.now().toString(36); editPanel(c.progId, 'Save recipe', pn => { pn.recipes = [...(pn.recipes || []), { id, name: nm, values }]; }); setSel(id); S.toast(`${t('Recipe')} “${nm}” ${t('saved')} · ${Object.keys(values).length} ${t('values')}`, 'ok'); };
  const load = () => { if (!r) return; Object.entries(r.values).forEach(([a, v]) => write(c, a, v, { retain: true })); S.toast(`${t('Recipe')} “${r.name}” ${t('loaded')}`, 'ok'); };
  const del = () => { if (!r) return; editPanel(c.progId, 'Delete recipe', pn => { pn.recipes = pn.recipes.filter(x => x.id !== r.id); }); setSel(''); };
  return <><Head label={w.p.label} tag={`${panel.recipes.length} ${t('recipes')}`} /><select class="op-in" value={r?.id || ''} onChange={(e: any) => setSel(e.target.value)} disabled={!panel.recipes.length}>{panel.recipes.length ? panel.recipes.map(x => <option value={x.id}>{x.name}</option>) : <option>{t('— no recipes yet —')}</option>}</select>
    <div class="op-row"><button class="op-pb sm" style={{ background: col('blue') }} disabled={dis || !r} onClick={load}>{t('LOAD')}</button><button class="op-pb sm" style={{ background: col('dark') }} disabled={dis} onClick={save}>{t('SAVE AS…')}</button><button class="op-pb sm dis" disabled={dis || !r} onClick={del}>{t('DELETE')}</button></div></>;
}
const TC = ['#0A64C2', '#1E9E4A', '#C62828', '#B45309'];
function TrendW({ w, c }: { w: Widget; c: Ctx }) {
  const srcs = String(w.p.srcs || '').split(',').filter(Boolean).slice(0, 4); const span = +w.p.span || 30;
  if (!srcs.length) return <><Head label={w.p.label} /><div class="op-sub">{t('Choose up to four values')}</div></>;
  const { m, now } = sampleTrend(c, w.id, srcs, span); const W2 = 440, H2 = 110;
  const series = srcs.map((s, i) => { const ys = m.ys[i]; let lo = Infinity, hi = -Infinity; ys.forEach(y => { lo = Math.min(lo, y); hi = Math.max(hi, y); }); if (!isFinite(lo)) { lo = 0; hi = 1; } if (hi - lo < 1e-9) hi = lo + 1;
    return { d: m.t.map((tt, k) => `${k ? 'L' : 'M'}${(34 + (W2 - 44) * (tt - (now - span)) / span).toFixed(1)} ${(H2 - 18 - (H2 - 28) * (ys[k] - lo) / (hi - lo)).toFixed(1)}`).join(''), lo, hi, last: ys[ys.length - 1] }; });
  return <><Head label={w.p.label} tag={srcs.map(s => tagOf(c, s)).join(' · ')} /><svg viewBox={`0 0 ${W2} ${H2}`} class="op-trend" preserveAspectRatio="none">{[0, 0.5, 1].map(f => <line x1="34" x2={W2 - 10} y1={H2 - 18 - (H2 - 28) * f} y2={H2 - 18 - (H2 - 28) * f} stroke="#E3E8EE" />)}
    {series.map((s, i) => <path d={s.d} fill="none" stroke={TC[i]} stroke-width="1.6" vector-effect="non-scaling-stroke" />)}
    {[0, 1, 2, 3, 4].map(i => <text x={34 + (W2 - 44) * i / 4} y={H2 - 4} font-size="8" text-anchor="middle" fill="#8A97A6" font-family="JetBrains Mono">{i === 4 ? 'now' : `−${Math.round(span * (4 - i) / 4)} s`}</text>)}</svg>
    <div class="op-row op-legend">{series.map((s, i) => <span><i style={{ background: TC[i] }} />{tagOf(c, srcs[i])} <b class="mono">{num(s.last)}</b></span>)}</div></>;
}
