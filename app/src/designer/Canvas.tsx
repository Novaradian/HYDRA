// Drawing canvas: sheet frame, grid, zoom / pan, snapping, placing, moving, orthogonal piping, selection.
import { h, Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import * as S from '../store';
import { t } from '../i18n';
import { geomOf, xfAttr, xfBB, INK, isConn, isAsm, invXfAttr, VU, type Geom } from './geom';
import { worldOf, drawArea, frameSvg, livePts, ptsD, LINE, ENCL_DASH, simplify, segDist, compPorts, keyValues, contentBB, isInfinite, r2, type Sheet, type Comp, type Junc } from './model';
import { labelPos, junctionDegree, sheetBody } from './render';
import { AiGhost } from '../ai/ghost';
import * as E from './elec';
import { simView, simFrame, SIM, simClickValve, simToggle, pColor, BAR_, animT, probeFields, addTrace, setLive, stopHooks } from './sim';
import { signal } from '@preact/signals';
// simulation overlays shared by every canvas: the line under the pointer and the part whose live slider is open
export const simHover = signal<{ key: string; x: number; y: number } | null>(null);
export const liveOpen = signal<{ key: string; x: number; y: number } | null>(null);
stopHooks.push(() => { simHover.value = null; liveOpen.value = null; });
import * as TP from './templates';
import * as st from './state';
import { openContextMenu, Icon, type MenuItem } from '../ui/common';
import { runCmd } from '../commands';

const SELC = '#0A64C2', HOV = '#86B7EE', PORTC = '#D9480F', PXMM = 96 / 25.4;
export type Ctx = { sheetNo: number; sheets: number; project?: string; units?: string };
type Target = { kind: 'port' | 'junc' | 'pipe'; x: number; y: number; end?: any; dir?: number; label: string; domain?: string; pipe?: string; role?: string };

export function Canvas({ sh, ctx, ghost }: { sh: Sheet; ctx: Ctx; ghost?: { host: Sheet; inst: Comp } | null }) {
  const wrap = useRef<HTMLDivElement>(null); const svgR = useRef<SVGSVGElement>(null);
  const [sz, setSz] = useState({ w: 0, h: 0 }); const [, force] = useState(0); const raf = useRef(0);
  const redraw = () => { if (raf.current) return; raf.current = requestAnimationFrame(() => { raf.current = 0; force(n => n + 1); }); };
  const I = useRef<any>({ drag: null, draw: null, space: false, ghost: null, hover: null, cur: null }).current;
  const G = st.GRID(sh); const o = st.opts.value; const tool = st.tool.value; const ids = st.selIds(sh.id); const selSet = new Set(ids);
  const inf = isInfinite(sh) || !!ghost; const [W, H] = worldOf(sh); const area = drawArea(sh);
  const sv = simView.value; const simOn = !!sv && sv.sheet === sh.id && !!SIM; simFrame.value; // subscribe to simulation frames
  const iso = st.isolate.value?.sheet === sh.id ? new Set(st.isolate.value.ids) : null;

  // ----- view -----
  const view = () => st.views.get(sh.id) || { z: 2, px: 20, py: 20 };
  const setView = (v: { z: number; px: number; py: number }) => { st.views.set(sh.id, v); st.zoomPct.value = Math.round(v.z / PXMM * 100); redraw(); };
  const fitBox = (b: number[], pad = 26) => { const w = Math.max(20, b[2] - b[0]), hh = Math.max(20, b[3] - b[1]); const z = Math.max(0.25, Math.min(40, Math.min((sz.w - 2 * pad) / w, (sz.h - 2 * pad) / hh))); setView({ z, px: (sz.w - w * z) / 2 - b[0] * z, py: (sz.h - hh * z) / 2 - b[1] * z }); };
  // Sheet: the whole page · Infinite canvas: everything drawn (an empty canvas centres on the origin)
  const fit = () => { if (!sz.w) return; if (inf) { const b = contentBB(sh); if (b) fitBox([b[0] - 10, b[1] - 10, b[2] + 10, b[3] + 10], 30); else setView({ z: 3, px: sz.w / 2, py: sz.h / 2 }); return; } fitBox([0, 0, W, H]); };
  const zoomAt = (f: number, sx = sz.w / 2, sy = sz.h / 2) => { const v = view(); const z = Math.max(0.25, Math.min(60, v.z * f)); const k = z / v.z; setView({ z, px: sx - (sx - v.px) * k, py: sy - (sy - v.py) * k }); };
  useEffect(() => { const ro = new ResizeObserver(() => { const r = wrap.current!.getBoundingClientRect(); setSz({ w: r.width, h: r.height }); }); ro.observe(wrap.current!); return () => ro.disconnect(); }, []);
  useEffect(() => { if (sz.w && !st.views.has(sh.id)) fit(); else if (st.views.has(sh.id)) st.zoomPct.value = Math.round(view().z / PXMM * 100); }, [sz.w, sz.h, sh.id]);
  const pr = st.panReq.value; useEffect(() => { if (pr && pr.sheet === sh.id) setView({ ...view(), px: pr.px, py: pr.py }); }, [pr?.n]);
  const vr = st.viewReq.value;
  useEffect(() => {
    if (!vr.n || !sz.w) return;
    if (vr.kind === 'fit') fit(); else if (vr.kind === 'in') zoomAt(1.25); else if (vr.kind === 'out') zoomAt(0.8);
    else if (vr.kind === 'pct') { const v = view(); zoomAt((vr.pct! / 100 * PXMM) / v.z); }
    else if (vr.kind === 'items' && vr.ids?.length) {
      let b = [1e9, 1e9, -1e9, -1e9]; const add = (q: number[]) => { b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]; };
      vr.ids.forEach(id => { const c = sh.components.find(x => x.id === id); if (c) add(xfBB(c, geomOf(c.ref).bb)); const p = sh.pipes.find(x => x.id === id); if (p) livePts(sh, p).forEach(q => add([q[0], q[1], q[0], q[1]])); const j = sh.junctions.find(x => x.id === id); if (j) add([j.x - 5, j.y - 5, j.x + 5, j.y + 5]); });
      if (b[0] < b[2] + 1) { const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2; const z = Math.min(view().z < 3 ? 3.5 : view().z, (sz.w - 80) / Math.max(40, b[2] - b[0]), (sz.h - 80) / Math.max(40, b[3] - b[1])); setView({ z, px: sz.w / 2 - cx * z, py: sz.h / 2 - cy * z }); }
    }
  }, [vr.n]);
  useEffect(() => {
    const el = svgR.current!; const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomAt(Math.pow(1.0016, -e.deltaY * (e.deltaMode ? 30 : 1)), e.clientX - r.left, e.clientY - r.top); else { const v = view(); setView({ ...v, px: v.px - e.deltaX }); } };
    el.addEventListener('wheel', onWheel, { passive: false }); return () => el.removeEventListener('wheel', onWheel);
  }, [sz.w, sz.h, sh.id]);
  const v = view();
  const toW = (e: { clientX: number; clientY: number }) => { const r = svgR.current!.getBoundingClientRect(); return [(e.clientX - r.left - v.px) / v.z, (e.clientY - r.top - v.py) / v.z]; };
  const snap = (x: number) => o.snap ? Math.round(x / G) * G : Math.round(x * 2) / 2;

  // ----- targets for piping (ports > junctions > pipes) -----
  const elec = E.isElec(sh); // electric sheets wire electrical ports; fluid sheets pipe fluid ports
  const ports = useMemo(() => sh.components.flatMap(c => compPorts(c, undefined, sh.type)).filter(p => elec ? p.domain === 'electrical' : p.domain !== 'electrical'), [sh.components, sh.type, S.valveSvgs.value]);
  const usedEnds = useMemo(() => { const m = new Map<string, number>(); sh.pipes.forEach(p => [p.a, p.b].forEach(e => { if (e && 'c' in e) { const k = e.c + ':' + e.p; m.set(k, (m.get(k) || 0) + 1); } })); return m; }, [sh.pipes]);
  function findTarget(w: number[], skipPipe?: string): Target | null {
    const tol = Math.max(1.2, 9 / v.z); let best: Target & { d: number } | null = null;
    if (o.snap || true) ports.forEach(p => { const d = Math.hypot(p.wx - w[0], p.wy - w[1]); if (d < tol * 1.25 && (!best || d < best.d)) best = { kind: 'port', x: p.wx, y: p.wy, end: { c: p.c, p: p.key }, dir: p.wdir, label: `${p.tag}.${p.name}`, domain: p.domain, role: p.role, d }; });
    if (best) return best;
    sh.junctions.forEach((j, i) => { const d = Math.hypot(j.x - w[0], j.y - w[1]); if (d < tol && (!best || d < best.d)) best = { kind: 'junc', x: j.x, y: j.y, end: { j: j.id }, label: `J${i + 1}`, d }; });
    if (best) return best;
    sh.pipes.forEach(p => { if (p.id === skipPipe) return; const pts = livePts(sh, p); for (let i = 0; i < pts.length - 1; i++) { const s = segDist(w[0], w[1], pts[i], pts[i + 1]); if (s.d < tol * 0.8 && (!best || s.d < best.d)) { let x = s.x, y = s.y; const a = pts[i], b = pts[i + 1]; if (o.snap) { if (Math.abs(a[1] - b[1]) < 1e-6) x = Math.max(Math.min(a[0], b[0]), Math.min(Math.max(a[0], b[0]), snap(x))); else if (Math.abs(a[0] - b[0]) < 1e-6) y = Math.max(Math.min(a[1], b[1]), Math.min(Math.max(a[1], b[1]), snap(y))); } best = { kind: 'pipe', x, y, pipe: p.id, label: LINE[p.kind].label.toLowerCase(), d: s.d }; } } });
    return best;
  }
  // ----- orthogonal route from the last fixed point to the cursor -----
  const isV = (d?: number) => d === 90 || d === 270;
  function route(draw: any, cur: number[], tgt: Target | null): number[][] {
    let last = draw.pts[draw.pts.length - 1]; const pre: number[][] = [];
    if (!o.ortho) return [cur];
    let startV: boolean | null = null;
    if (draw.pts.length === 1 && draw.startDir != null) {
      const ux = Math.round(Math.cos(draw.startDir * Math.PI / 180)), uy = Math.round(Math.sin(draw.startDir * Math.PI / 180));
      if ((cur[0] - last[0]) * ux + (cur[1] - last[1]) * uy < -1e-6) { const stub = [last[0] + ux * 5, last[1] + uy * 5]; pre.push(stub); last = stub; startV = !isV(draw.startDir); } else startV = isV(draw.startDir);
    } else if (draw.pts.length > 1) { const p0 = draw.pts[draw.pts.length - 2]; startV = !(Math.abs(p0[0] - last[0]) < 1e-6); }
    const endV: boolean | null = tgt?.kind === 'port' ? isV(tgt.dir) : null;
    if (Math.abs(last[0] - cur[0]) < 1e-6 || Math.abs(last[1] - cur[1]) < 1e-6) return [...pre, cur];
    if (startV == null) startV = endV != null ? !endV : Math.abs(cur[1] - last[1]) > Math.abs(cur[0] - last[0]);
    if (endV != null && startV === endV) {
      if (startV) { const my = snap((last[1] + cur[1]) / 2); return [...pre, [last[0], my], [cur[0], my], cur]; }
      const mx = snap((last[0] + cur[0]) / 2); return [...pre, [mx, last[1]], [mx, cur[1]], cur];
    }
    return [...pre, startV ? [last[0], cur[1]] : [cur[0], last[1]], cur];
  }

  // ----- live geometry while dragging -----
  const dg = I.drag; const moving = dg?.mode === 'move' && dg.started ? { dx: dg.dx, dy: dg.dy, ids: new Set<string>(dg.ids) } : null;
  const pos = moving ? (id: string): Comp | Junc | undefined => { const c = sh.components.find(x => x.id === id); if (c) return moving.ids.has(id) ? { ...c, x: c.x + moving.dx, y: c.y + moving.dy } : c; const j = sh.junctions.find(x => x.id === id); if (j) return moving.ids.has(id) ? { ...j, x: j.x + moving.dx, y: j.y + moving.dy } : j; return undefined; } : undefined;
  const off = (id: string) => moving && moving.ids.has(id) ? [moving.dx, moving.dy] : [0, 0];
  const pipePts = (p: any) => dg?.mode === 'seg' && dg.pipe === p.id ? dg.cur : livePts(sh, p, pos, moving || undefined);

  // ----- pointer handling -----
  function hitOf(e: any): [string, string] | null { const el = (e.target as Element).closest?.('[data-hit]') as HTMLElement | null; if (!el) return null; const [k, id] = el.dataset.hit!.split(':'); return [k, id]; }
  const setCursor = (w: number[], snapKind: string) => { st.cursorInfo.value = { x: w[0], y: w[1], snap: snapKind }; };
  function onDown(e: PointerEvent) {
    if (S.modal.value) return; const w = toW(e); (e.currentTarget as Element).setPointerCapture?.(e.pointerId); wrap.current?.focus({ preventScroll: true });
    if (e.button === 1 || (e.button === 0 && I.space)) { I.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, v0: { ...v } }; return; }
    if (e.button !== 0) return;
    if (simOn) { // simulation: click a valve box to switch it there (it stays until clicked again); click a shut-off to toggle; drag pans
      const vEl = (e.target as Element).closest?.('[data-simv]') as SVGGElement | null;
      if (vEl) { const key = vEl.dataset.simv!; const se: any = SIM!.el(key); const m = vEl.getScreenCTM(); if (se && m) { const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()); const g = se.el.g as Geom; const vp = g.vparts!; const dx = (vp.rest - se.state.target) * 4 * VU; const u = (pt.x - dx) / VU + vp.cx; simClickValve(key, Math.max(0, Math.min(vp.boxes - 1, Math.floor(u / 4)))); } return; }
      const tEl = (e.target as Element).closest?.('[data-simt]') as HTMLElement | null; if (tEl) { simToggle(tEl.dataset.simt!); return; }
      const kEl = (e.target as Element).closest?.('[data-simk]') as HTMLElement | null; const hit = hitOf(e);
      const key = kEl?.dataset.simk || (hit && hit[0] === 'c' ? hit[1] : null);
      if (hit) st.setSel(sh.id, [hit[1]]);
      if (key && SIM?.live.get(key)) { const r = (kEl || (e.target as Element).closest('[data-hit]') as Element).getBoundingClientRect(); const box = wrap.current!.getBoundingClientRect(); liveOpen.value = { key, x: r.right - box.left + 8, y: r.top - box.top }; return; }
      liveOpen.value = null; if (hit) return;
      I.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, v0: { ...v } }; return;
    }
    const tl = st.tool.value;
    if (tl === 'place' && st.placing.value) { const pl = st.placing.value; st.addPart(sh.id, pl.ref, snap(w[0]), snap(w[1]), pl.rot, pl.mirror); if (!e.shiftKey) { st.placing.value = null; st.tool.value = 'select'; } I.ghost = null; redraw(); return; }
    if (st.LINE_TOOLS.has(tl)) { drawClick(w, tl, e); return; }
    if (tl === 'junction') { const tg = findTarget(w); if (tg?.kind === 'pipe') { const jid = st.addJunctionOnPipe(sh.id, tg.x, tg.y); const pk = sh.pipes.find(p => p.id === tg.pipe)?.kind || (elec ? 'wire' : 'work'); if (jid) { st.tool.value = pk as any; I.draw = { kind: pk, start: { j: jid }, pts: [[tg.x, tg.y]] }; } } else S.toast(t('Click on a line to add a junction'), 'info'); redraw(); return; }
    if (tl === 'text') { const x = snap(w[0]), y = snap(w[1]); S.promptDlg(t('Add text'), t('Text'), '').then(s => { if (s && s.trim()) { const id = 't_' + Date.now().toString(36); S.mutate('Add text', d => { (d.circuits[sh.id] as Sheet).texts.push({ id, x, y, s: s.trim(), h: 3.5 }); }); st.setSel(sh.id, [id]); } }); return; }
    if (tl === 'enclosure') { I.drag = { mode: 'encl', w0: [snap(w[0]), snap(w[1])], w1: [snap(w[0]), snap(w[1])] }; return; }
    // select tool: a port starts a working line; an item selects / moves; empty space starts a window selection
    const hit = hitOf(e);
    const tg = findTarget(w); if (tg?.kind === 'port' && (!hit || hit[0] === 'c')) { const kd = elec ? (st.LINE_TOOLS.has(tl) ? tl : 'wire') as any : tg.role === 'pilot' ? 'pilot' : tg.role === 'drain' ? 'drain' : 'work'; st.tool.value = kd; drawClick(w, kd, e); return; }
    if (hit) {
      const [k, id] = hit; let cur = st.selIds(sh.id);
      if (e.shiftKey || e.ctrlKey || e.metaKey) { cur = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]; st.setSel(sh.id, cur); return; }
      if (!cur.includes(id)) { cur = [id]; st.setSel(sh.id, cur); }
      if (k === 'p' && cur.length === 1) { const p = sh.pipes.find(x => x.id === id)!; const pts = livePts(sh, p); let bi = -1, bd = 1e9; for (let i = 0; i < pts.length - 1; i++) { const s = segDist(w[0], w[1], pts[i], pts[i + 1]); if (s.d < bd) { bd = s.d; bi = i; } }
        const a = pts[bi], b = pts[bi + 1]; const vert = Math.abs(a[0] - b[0]) < 1e-6, hor = Math.abs(a[1] - b[1]) < 1e-6;
        if (vert || hor) { const arr = pts.map(q => q.slice()); let i = bi; if (i === 0 && p.a) { arr.unshift(arr[0].slice()); i++; } if (i === arr.length - 2 && p.b) arr.push(arr[arr.length - 1].slice()); I.drag = { mode: 'seg', pipe: id, i, vert, base: arr, cur: arr, w0: w, started: false, sx: e.clientX, sy: e.clientY }; return; } }
      I.drag = { mode: 'move', w0: w, dx: 0, dy: 0, ids: cur.slice(), started: false, sx: e.clientX, sy: e.clientY }; return;
    }
    I.drag = { mode: 'band', w0: w, w1: w, add: e.shiftKey || e.ctrlKey, started: false, sx: e.clientX, sy: e.clientY };
  }
  function drawClick(w: number[], kind: string, e: any) {
    const tg = findTarget(w); const cur = tg ? [tg.x, tg.y] : [snap(w[0]), snap(w[1])];
    if (!I.draw) {
      const start = tg ? (tg.kind === 'pipe' ? { split: [tg.x, tg.y] } : tg.end) : null;
      if (!elec && tg?.kind === 'port' && tg.domain === 'electrical') { S.toast(t('Electrical connections are wired on an electric sheet'), 'warn'); return; }
      I.draw = { kind, start, pts: [cur], startDir: tg?.dir, startDomain: tg?.domain }; redraw(); return;
    }
    const seg = route(I.draw, cur, tg);
    if (tg && !(tg.kind === 'port' && I.draw.start && 'c' in I.draw.start && I.draw.start.c === tg.end.c && I.draw.start.p === tg.end.p && I.draw.pts.length === 1)) {
      if (tg.kind === 'port' && I.draw.startDomain && tg.domain && tg.domain !== I.draw.startDomain) { S.toast(t('Hydraulic and pneumatic ports cannot be joined'), 'warn'); return; }
      finish(tg.kind === 'pipe' ? { split: [tg.x, tg.y] } : tg.end, seg); return;
    }
    I.draw.pts.push(...seg); I.draw.pts = simplify(I.draw.pts); redraw();
  }
  function finish(end: any, seg: number[][]) {
    const d = I.draw; if (!d) return; const pts = simplify([...d.pts, ...seg]); I.draw = null;
    if (pts.length < 2) { redraw(); return; }
    const id = st.addPipe(sh.id, d.kind, d.start, end, pts); st.setSel(sh.id, id ? [id] : []); redraw();
  }
  function onMove(e: PointerEvent) {
    if (simOn && !I.drag) { const pe = (e.target as Element).closest?.('[data-simp],[data-hit^="p:"]') as HTMLElement | null; const box = wrap.current!.getBoundingClientRect();
      const key = pe ? pe.dataset.simp || '|' + pe.dataset.hit!.slice(2) : null; const cur = simHover.peek();
      if (key) { if (!cur || cur.key !== key || Math.abs(cur.x - (e.clientX - box.left)) > 2 || Math.abs(cur.y - (e.clientY - box.top)) > 2) simHover.value = { key, x: e.clientX - box.left, y: e.clientY - box.top }; } else if (cur) simHover.value = null; }
    const w = toW(e); I.cur = w; const d = I.drag;
    if (d?.mode === 'pan') { setView({ ...d.v0, px: d.v0.px + e.clientX - d.sx, py: d.v0.py + e.clientY - d.sy }); return; }
    if (d && 'sx' in d && !d.started && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) d.started = true;
    if (d?.mode === 'move' && d.started) { const dx = o.snap ? Math.round((w[0] - d.w0[0]) / G) * G : w[0] - d.w0[0], dy = o.snap ? Math.round((w[1] - d.w0[1]) / G) * G : w[1] - d.w0[1]; if (dx !== d.dx || dy !== d.dy) { d.dx = dx; d.dy = dy; redraw(); } setCursor(w, 'grid'); return; }
    if (d?.mode === 'seg' && d.started) { const delta = d.vert ? w[0] - d.w0[0] : w[1] - d.w0[1]; const s = o.snap ? Math.round(delta / G) * G : delta; d.cur = d.base.map((q: number[], k: number) => k === d.i || k === d.i + 1 ? (d.vert ? [q[0] + s, q[1]] : [q[0], q[1] + s]) : q); redraw(); return; }
    if (d?.mode === 'band' || d?.mode === 'encl') { d.w1 = d.mode === 'encl' ? [snap(w[0]), snap(w[1])] : w; redraw(); return; }
    const tl = st.tool.value;
    if (tl === 'place') { I.ghost = [snap(w[0]), snap(w[1])]; setCursor(I.ghost, o.snap ? 'grid' : 'off'); redraw(); return; }
    const drawing = st.LINE_TOOLS.has(tl) || tl === 'junction';
    const tg = (drawing || tl === 'select') ? findTarget(w) : null;
    const hk = tg ? tg.kind + tg.label : '';
    if (hk !== I.hoverKey || drawing) { I.hover = tg; I.hoverKey = hk; redraw(); }
    setCursor(tg ? [tg.x, tg.y] : [snap(w[0]), snap(w[1])], tg ? (tg.kind === 'junc' ? 'junction' : tg.kind) : o.snap ? 'grid' : 'off');
  }
  function onUp(e: PointerEvent) {
    const d = I.drag; I.drag = null; if (!d) return;
    if (d.mode === 'move' && d.started) st.moveIds(sh.id, d.ids, d.dx, d.dy);
    else if (d.mode === 'seg' && d.started) S.mutate('Move line segment', dd => { const p = (dd.circuits[sh.id] as Sheet).pipes.find(x => x.id === d.pipe); if (p) p.pts = simplify(d.cur); });
    else if (d.mode === 'band') {
      if (!d.started) { if (!d.add) st.setSel(sh.id, []); redraw(); return; }
      const x0 = Math.min(d.w0[0], d.w1[0]), x1 = Math.max(d.w0[0], d.w1[0]), y0 = Math.min(d.w0[1], d.w1[1]), y1 = Math.max(d.w0[1], d.w1[1]); const crossing = d.w1[0] < d.w0[0];
      const inBox = (b: number[]) => crossing ? !(b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1) : (b[0] >= x0 && b[2] <= x1 && b[1] >= y0 && b[3] <= y1);
      const got: string[] = [];
      sh.components.forEach(c => { if (inBox(xfBB(c, geomOf(c.ref).bb))) got.push(c.id); });
      sh.pipes.forEach(p => { const pts = livePts(sh, p); const b = [Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))]; if (inBox(b)) got.push(p.id); });
      sh.junctions.forEach(j => { if (inBox([j.x, j.y, j.x, j.y])) got.push(j.id); }); sh.texts.forEach(tx => { if (inBox([tx.x, tx.y - tx.h, tx.x + tx.s.length * tx.h * .55, tx.y])) got.push(tx.id); }); sh.enclosures.forEach(en => { if (inBox([en.x, en.y, en.x + en.w, en.y + en.h])) got.push(en.id); });
      st.setSel(sh.id, d.add ? [...st.selIds(sh.id), ...got] : got);
    } else if (d.mode === 'encl') { const x = Math.min(d.w0[0], d.w1[0]), y = Math.min(d.w0[1], d.w1[1]), w = Math.abs(d.w1[0] - d.w0[0]), hh = Math.abs(d.w1[1] - d.w0[1]); if (w >= 10 && hh >= 10) { const id = 'e_' + Date.now().toString(36); S.mutate('Add enclosure', dd => { (dd.circuits[sh.id] as Sheet).enclosures.push({ id, x, y, w, h: hh, label: '' }); }); st.setSel(sh.id, [id]); st.tool.value = 'select'; } }
    redraw();
  }
  function onDbl(e: MouseEvent) {
    if (I.draw) { finish(null, []); return; } const hit = hitOf(e);
    if (!hit) { if (st.tool.value === 'select' || simOn) fit(); return; } // double-click on empty space: fit the page / the drawing
    if (simOn) return; const [k, id] = hit;
    if (k === 't') { const tx = sh.texts.find(x => x.id === id); if (tx) S.promptDlg(t('Edit text'), t('Text'), tx.s).then(s => { if (s != null && s.trim()) S.mutate('Edit text', d => { const q = (d.circuits[sh.id] as Sheet).texts.find(x => x.id === id); if (q) q.s = s.trim(); }); }); }
    if (k === 'e') { const en = sh.enclosures.find(x => x.id === id); if (en) S.promptDlg(t('Enclosure label'), t('Label (e.g. assembly name or tag)'), en.label || '').then(s => { if (s != null) S.mutate('Label enclosure', d => { const q = (d.circuits[sh.id] as Sheet).enclosures.find(x => x.id === id); if (q) q.label = s.trim(); }); }); }
    if (k === 'c') { const c = sh.components.find(x => x.id === id); if (c && isAsm(c.ref)) { st.D.value?.editInPlace?.(id); return; } st.rightTab.value = 'props'; setTimeout(() => (document.querySelector('.dright input') as HTMLInputElement)?.focus(), 30); }
  }
  function onCtx(e: MouseEvent) {
    e.preventDefault(); if (I.draw) { finish(null, []); return; }
    if (simOn) { // plot anything: right-click a line or a part
      const pe = (e.target as Element).closest?.('[data-simp],[data-hit^="p:"]') as HTMLElement | null; const kEl = (e.target as Element).closest?.('[data-simk]') as HTMLElement | null; const hit = hitOf(e);
      const target: ['pipe' | 'el', string] | null = pe ? ['pipe', pe.dataset.simp || '|' + pe.dataset.hit!.slice(2)] : kEl ? ['el', kEl.dataset.simk!] : hit && hit[0] === 'c' ? ['el', hit[1]] : null;
      if (!target) return; const fl = probeFields(target[0], target[1]); if (!fl.length) return;
      openContextMenu(e, [...fl.map(([f, l]) => ({ label: t('Plot') + ' · ' + t(l), icon: 'activity', onSelect: () => { if (addTrace(target[0], target[1], f)) { st.dock.value = { open: true, tab: 'sim' }; } } } as MenuItem)),
        ...(target[0] === 'el' && SIM?.live.get(target[1]) ? ['sep' as const, { label: t('Adjust while running…'), icon: 'sliders-horizontal', onSelect: () => { const box = wrap.current!.getBoundingClientRect(); liveOpen.value = { key: target[1], x: e.clientX - box.left + 10, y: e.clientY - box.top - 10 }; } } as MenuItem] : [])]); return;
    }
    const hit = hitOf(e); const w = toW(e); let items: MenuItem[];
    if (hit) {
      const [k, id] = hit; if (!st.selIds(sh.id).includes(id)) st.setSel(sh.id, [id]);
      const n = st.selIds(sh.id).length;
      items = [{ header: n > 1 ? `${n} ${t('items')}` : k === 'c' ? (sh.components.find(c => c.id === id)?.tag || '') : k === 'p' ? t('Line') : k === 'j' ? t('Junction') : k === 't' ? t('Text') : t('Enclosure') },
        { label: t('Rotate 90°'), icon: 'rotate-cw', keys: 'R', onSelect: () => runCmd('edit.rotate') }, { label: t('Mirror'), icon: 'flip-horizontal', keys: 'M', onSelect: () => runCmd('des.mirror') },
        'sep', { label: t('Copy'), icon: 'copy', keys: 'Ctrl+C', onSelect: () => runCmd('edit.copy') }, { label: t('Cut'), icon: 'scissors', keys: 'Ctrl+X', onSelect: () => runCmd('edit.cut') }, { label: t('Save as template…'), icon: 'library', onSelect: () => TP.saveSelection(sh.id) }, { label: t('Delete'), icon: 'trash-2', keys: 'Del', danger: true, onSelect: () => runCmd('edit.delete') }];
      if (k === 'p') { const p = sh.pipes.find(x => x.id === id)!; items.push('sep', ...((elec ? ['wire', 'power', 'pe'] : ['work', 'pilot', 'drain']) as ('work' | 'pilot' | 'drain' | 'wire' | 'power' | 'pe')[]).map(kd => ({ label: t(LINE[kd].label), checked: p.kind === kd, onSelect: () => S.mutate('Line type', d => { const q = (d.circuits[sh.id] as Sheet).pipes.find(x => x.id === id); if (q) q.kind = kd; }) })), { label: t('Add junction here'), icon: 'git-commit-horizontal', onSelect: () => st.addJunctionOnPipe(sh.id, w[0], w[1]) }); }
      if (k === 'c' && n > 1) items.push('sep', { label: t('Enclose (assembly boundary)'), icon: 'square-dashed', keys: 'Ctrl+G', onSelect: () => st.encloseSel(sh.id, st.selIds(sh.id)) });
      const c0 = k === 'c' ? sh.components.find(c => c.id === id) : null;
      if (c0 && isAsm(c0.ref)) { const exp = c0.ref.startsWith('asmx:'); items.push('sep', { label: exp ? t('Collapse to block') : t('Expand (show circuit)'), icon: exp ? 'minimize-2' : 'maximize-2', onSelect: () => st.D.value?.expand?.(st.selIds(sh.id), !exp) }, { label: t('Edit in place'), icon: 'pencil', onSelect: () => st.D.value?.editInPlace?.(id) }, { label: t('Open assembly sheet'), icon: 'external-link', onSelect: () => st.D.value?.openSource?.(id) }); }
      if (k === 'c') items.push('sep', iso ? { label: t('Show all (end isolate)'), icon: 'eye', onSelect: () => { st.isolate.value = null; } } : { label: t('Isolate (ghost the rest)'), icon: 'focus', onSelect: () => { st.isolate.value = { sheet: sh.id, ids: st.selIds(sh.id) }; } });
    } else items = [...(iso ? [{ label: t('Show all (end isolate)'), icon: 'eye', onSelect: () => { st.isolate.value = null; } } as MenuItem, 'sep' as const] : []), { label: t('Paste'), icon: 'clipboard-paste', keys: 'Ctrl+V', disabled: !st.hasClip.value, onSelect: () => runCmd('edit.paste') }, { label: t('Select All'), icon: 'box-select', keys: 'Ctrl+A', onSelect: () => runCmd('edit.selectAll') }, 'sep', { label: t('Zoom to Fit'), icon: 'scan', keys: 'Ctrl+0', onSelect: () => runCmd('view.zoomFit') }, { label: t('Run Rule Check'), icon: 'shield-check', keys: 'F7', onSelect: () => runCmd('menu.ruleCheck') }];
    openContextMenu(e, items);
  }
  // keyboard while the canvas is shown (single-letter tools are commands, see commands.ts)
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement; if (S.modal.value || /INPUT|TEXTAREA|SELECT/.test(tg?.tagName) || tg?.isContentEditable) return;
      if (e.key === ' ' && !I.space) { I.space = true; if (wrap.current) wrap.current.style.cursor = 'grab'; e.preventDefault(); }
      if (e.key === 'Escape') { if (I.draw) I.draw = null; else if (st.tool.value !== 'select') { st.tool.value = 'select'; st.placing.value = null; I.ghost = null; } else st.setSel(sh.id, []); redraw(); }
      if (e.key === 'Enter' && I.draw) finish(null, []);
      if (e.key === 'Backspace' && I.draw) { e.preventDefault(); if (I.draw.pts.length > 1) I.draw.pts.pop(); else I.draw = null; redraw(); }
      if (e.key.startsWith('Arrow') && st.selIds(sh.id).length && !I.draw) { e.preventDefault(); const s = e.shiftKey ? 1 : G; const dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, dy = e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0; st.moveIds(sh.id, st.selIds(sh.id), dx, dy, 'Nudge'); }
    };
    const ku = (e: KeyboardEvent) => { if (e.key === ' ') { I.space = false; if (wrap.current) wrap.current.style.cursor = ''; } };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, [sh.id]);
  useEffect(() => { if (!st.LINE_TOOLS.has(tool)) I.draw = null; else if (I.draw) I.draw.kind = tool; if (tool !== 'place') I.ghost = null; redraw(); }, [tool]);
  // drag from the Parts panel
  const onDragOver = (e: DragEvent) => { if (!st.dragPart.ref) return; e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; if (st.dragPart.ref.startsWith('tpl:')) return; const w = toW(e); I.ghost = [snap(w[0]), snap(w[1])]; I.dragGhost = st.dragPart.ref; redraw(); };
  const onDrop = (e: DragEvent) => { if (!st.dragPart.ref) return; e.preventDefault(); const w = toW(e); if (st.dragPart.ref.startsWith('tpl:')) TP.placeTemplate(sh.id, st.dragPart.ref.slice(4), w[0], w[1]); else st.addPart(sh.id, st.dragPart.ref, snap(w[0]), snap(w[1])); st.dragPart.ref = ''; I.ghost = null; I.dragGhost = null; redraw(); };
  const onDragLeave = () => { I.ghost = null; I.dragGhost = null; redraw(); };

  // ----- static layers -----
  const frame = useMemo(() => inf ? '' : frameSvg(sh, { sheetNo: ctx.sheetNo, sheets: ctx.sheets, project: ctx.project, units: ctx.units }).svg, [inf, sh.size, sh.orient, sh.scale, sh.name, sh.title, sh.type, ctx.sheetNo, ctx.sheets, ctx.project, ctx.units]);
  const ghostSvg = useMemo(() => ghost ? sheetBody({ ...ghost.host, components: ghost.host.components.filter(c => c.id !== ghost.inst.id) }, { fmt: st.fmtQ, layers: false }) : '', [ghost?.host, ghost?.inst.id]);
  const deg = junctionDegree(sh);
  const xover = useMemo(() => elec ? E.overlaySvg(sh, S.project.value) : '', [elec, S.project.value?.circuits]);
  const px = (n: number) => n / v.z; // screen px → world mm
  const showPorts = !simOn && (st.LINE_TOOLS.has(tool) || tool === 'junction');
  const minorOk = G * v.z >= 7; const gstep = minorOk ? G : G * 10 / (G * v.z >= 1.2 ? 2 : 1);
  const ghostRef = tool === 'place' ? st.placing.value?.ref : I.dragGhost; const gp = st.placing.value;
  const fmt = st.fmtQ;
  // visible world rectangle (infinite grid, minimap)
  const vis = [-v.px / v.z, -v.py / v.z, (sz.w - v.px) / v.z, (sz.h - v.py) / v.z];
  // simulation colouring
  const pmax = simOn ? Math.max(SIM!.maxP, 1e5) : 0;
  const pipeCol = (key: string) => { if (!simOn) return null; const nn = SIM!.f.pipeNode.get(key); if (nn == null) return null; return pColor(SIM!.p[nn], pmax); };
  const dim = (id: string) => iso && !iso.has(id) ? .16 : 1;
  // preview of the line being drawn
  let preview: number[][] | null = null; if (I.draw && I.cur) { const tg = I.hover && I.hover.kind ? I.hover : null; const cur = tg ? [tg.x, tg.y] : [snap(I.cur[0]), snap(I.cur[1])]; preview = [...I.draw.pts, ...route(I.draw, cur, tg)]; }
  const mm = inf ? (() => { const b = contentBB(sh) || [vis[0], vis[1], vis[2], vis[3]]; return [Math.min(b[0], vis[0]) - 10, Math.min(b[1], vis[1]) - 10, Math.max(b[2], vis[2]) + 10, Math.max(b[3], vis[3]) + 10]; })() : [0, 0, W, H];

  return <div class={'dcanvas' + (simOn ? ' simon' : '') + (inf ? ' inf' : '')} ref={wrap} tabIndex={0} aria-label={t('Circuit sheet') + ' ' + sh.name} data-tool={tool}
    onDragOver={onDragOver as any} onDrop={onDrop as any} onDragLeave={onDragLeave}>
    <svg ref={svgR} width={sz.w || 10} height={sz.h || 10} onPointerDown={onDown as any} onPointerMove={onMove as any} onPointerUp={onUp as any} onDblClick={onDbl as any} onContextMenu={onCtx as any}
      onPointerLeave={() => { st.cursorInfo.value = null; if (I.hover) { I.hover = null; I.hoverKey = ''; redraw(); } }}>
      <defs>
        <pattern id={'dg_' + sh.id} width={gstep} height={gstep} patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r={px(1.05)} fill="#9AA8B8" /></pattern>
        <filter id="dshadow" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy={px(2)} stdDeviation={px(3)} flood-color="#1B2633" flood-opacity=".14" /></filter>
      </defs>
      <g transform={`translate(${r2(v.px)} ${r2(v.py)}) scale(${v.z})`}>
        {!inf && <><rect x="0" y="0" width={W} height={H} fill="#fff" filter="url(#dshadow)" /><g class="dframe" dangerouslySetInnerHTML={{ __html: frame }} /></>}
        {o.grid && (inf ? <rect x={Math.floor(vis[0] / gstep) * gstep} y={Math.floor(vis[1] / gstep) * gstep} width={vis[2] - vis[0] + 2 * gstep} height={vis[3] - vis[1] + 2 * gstep} fill={`url(#dg_${sh.id})`} pointer-events="none" />
          : <rect x={area[0]} y={area[1]} width={area[2] - area[0]} height={area[3] - area[1]} fill={`url(#dg_${sh.id})`} pointer-events="none" />)}
        {inf && !ghost && <g pointer-events="none" opacity=".5"><line x1={-4} y1={0} x2={4} y2={0} stroke="#9AA8B8" stroke-width={px(1)} /><line x1={0} y1={-4} x2={0} y2={4} stroke="#9AA8B8" stroke-width={px(1)} /></g>}
        {ghost && <g transform={invXfAttr(ghost.inst)} opacity=".22" pointer-events="none" dangerouslySetInnerHTML={{ __html: ghostSvg }} />}
        <g>{sh.enclosures.map(en => { const [dx, dy] = off(en.id); const on = selSet.has(en.id); return <g data-hit={'e:' + en.id} opacity={dim(en.id)}>
          <rect x={en.x + dx} y={en.y + dy} width={en.w} height={en.h} fill="none" stroke={on ? SELC : INK} stroke-width={on ? .55 : .35} stroke-dasharray={ENCL_DASH} />
          <rect x={en.x + dx} y={en.y + dy} width={en.w} height={en.h} fill="none" stroke="transparent" stroke-width={px(8)} pointer-events="stroke" />
          {en.label && <text x={en.x + dx + 2} y={en.y + dy + 5} font-size="3" fill={INK} font-family="IBM Plex Sans, Arial">{en.label}</text>}</g>; })}</g>
        <g>{sh.pipes.map(p => { const pts = pipePts(p); const d = ptsD(pts); const L = LINE[p.kind] || LINE.work; const on = selSet.has(p.id); const sc = pipeCol('|' + p.id); return <g data-hit={'p:' + p.id} class="dpipe" opacity={dim(p.id)}>
          {simOn && SIM!.alerts.has('|' + p.id) && S.prefs.value.sim?.alerts !== false && <path d={d} fill="none" class="dalert" stroke="#F59E0B" stroke-width={L.w + 1.6} opacity=".7" />}
          <path d={d} fill="none" stroke={on ? SELC : sc || INK} stroke-width={on ? L.w + .25 : sc ? L.w + .3 : L.w} stroke-dasharray={L.dash || undefined} stroke-linejoin="miter" />
          <path d={d} fill="none" stroke="transparent" stroke-width={px(9)} pointer-events="stroke" />
          {on && !simOn && pts.map(q => <rect x={q[0] - px(3)} y={q[1] - px(3)} width={px(6)} height={px(6)} fill="#fff" stroke={SELC} stroke-width={px(1.2)} pointer-events="none" />)}
          {(!p.a || !p.b) && [!p.a ? pts[0] : null, !p.b ? pts[pts.length - 1] : null].filter(Boolean).map((q: any) => <circle cx={q[0]} cy={q[1]} r={1.2} fill="#fff" stroke={PORTC} stroke-width={.4} pointer-events="none" />)}
          {simOn && <FlowArrows pts={pts} k={'|' + p.id} />}
        </g>; })}</g>
        <g>{sh.junctions.map(j => { const [dx, dy] = off(j.id); const n = deg.get(j.id) || 0; const on = selSet.has(j.id); return <g data-hit={'j:' + j.id} opacity={dim(j.id)}>
          {n >= 3 && <circle cx={j.x + dx} cy={j.y + dy} r={1} fill={on ? SELC : INK} />}
          {(on || n < 3) && !simOn && <circle cx={j.x + dx} cy={j.y + dy} r={n < 3 ? 1.1 : 2} fill={n < 3 ? '#fff' : 'none'} stroke={on ? SELC : PORTC} stroke-width={.35} />}
          <circle cx={j.x + dx} cy={j.y + dy} r={px(7)} fill="transparent" /></g>; })}</g>
        <g>{sh.components.map(c => { const g = geomOf(c.ref); const [dx, dy] = off(c.id); const cc = dx || dy ? { ...c, x: c.x + dx, y: c.y + dy } : c; const b = xfBB(cc, g.bb); const on = selSet.has(c.id); const hov = I.hover?.end?.c === c.id;
          const lp = labelPos(cc, g); const conn = g.kind === 'conn';
          const rd = simOn && !conn ? SIM!.el(c.id)?.read?.(SIM!) : null; const kv = rd ? rd.text : conn ? '' : keyValues(c, g, fmt);
          return <g data-hit={'c:' + c.id} class={'dpart' + (g.kind === 'asm' ? ' dasm' : '')} opacity={dim(c.id)}>
            <rect x={b[0] - 1.5} y={b[1] - 1.5} width={b[2] - b[0] + 3} height={b[3] - b[1] + 3} fill="transparent" stroke={on ? SELC : hov ? HOV : 'none'} stroke-width={px(1)} stroke-dasharray={on ? `${px(4)} ${px(3)}` : undefined} />
            {simOn && SIM!.alerts.has(c.id) && S.prefs.value.sim?.alerts !== false && <rect x={b[0] - 3} y={b[1] - 3} width={b[2] - b[0] + 6} height={b[3] - b[1] + 6} class="dalert" fill="rgba(245,158,11,.14)" stroke="#F59E0B" stroke-width=".6" rx="1.5" pointer-events="none" />}
            {simOn ? <SimPart c={cc} g={g} k={c.id} path="" /> : <g transform={xfAttr(cc)} dangerouslySetInnerHTML={{ __html: g.inner }} />}
            {c.labelPos !== 'hidden' && <text x={lp.x} y={lp.y} font-size={conn ? 3 : 3.4} font-weight="700" text-anchor={lp.anchor} fill={conn ? INK : SELC} font-family="IBM Plex Sans, Arial" pointer-events="none">{c.tag}</text>}
            {c.labelPos !== 'hidden' && kv && <text x={lp.x} y={lp.y + 3.6} font-size="2.5" text-anchor={lp.anchor} fill={rd ? (rd.on ? '#15803D' : '#0A4F99') : '#5B6878'} font-weight={rd ? 600 : 400} font-family="JetBrains Mono, Consolas, monospace" pointer-events="none">{kv}</text>}
            {on && !simOn && [[b[0] - 1.5, b[1] - 1.5], [b[2] + 1.5, b[1] - 1.5], [b[0] - 1.5, b[3] + 1.5], [b[2] + 1.5, b[3] + 1.5]].map(q => <rect x={q[0] - px(3)} y={q[1] - px(3)} width={px(6)} height={px(6)} fill="#fff" stroke={SELC} stroke-width={px(1.2)} />)}
          </g>; })}</g>
        {elec && <g pointer-events="none" dangerouslySetInnerHTML={{ __html: xover }} />}
        <g>{sh.texts.map(tx => { const [dx, dy] = off(tx.id); const on = selSet.has(tx.id); return <text data-hit={'t:' + tx.id} x={tx.x + dx} y={tx.y + dy} font-size={tx.h} fill={on ? SELC : INK} opacity={dim(tx.id)} font-family="IBM Plex Sans, Arial" text-decoration={on ? 'underline' : undefined}>{tx.s}</text>; })}</g>
        {!simOn && !ghost && <AiGhost sheetId={sh.id} />}
        {/* ports: open ports always (orange), every port while piping */}
        {(o.ports || showPorts) && !moving && !simOn && <g pointer-events="none">{ports.map(p => { const used = (usedEnds.get(p.c + ':' + p.key) || 0) > 0; if (used && !showPorts) return null; return <circle cx={p.wx} cy={p.wy} r={showPorts ? px(4) : px(3.2)} fill={used ? '#fff' : '#FFF4EC'} stroke={used ? SELC : PORTC} stroke-width={px(1.3)} />; })}</g>}
        {I.hover && !simOn && (showPorts || I.hover.kind === 'port') && !I.drag && <g pointer-events="none"><circle cx={I.hover.x} cy={I.hover.y} r={px(7)} fill="none" stroke={PORTC} stroke-width={px(2)} />
          <g transform={`translate(${I.hover.x + px(12)} ${I.hover.y + px(4)}) scale(${1 / v.z})`}><rect x="0" y="-12" width={(I.hover.label.length + 7) * 6.6 + 10} height="18" fill="#fff" stroke="#C9D3DE" /><text x="6" y="1" font-size="11" font-family="JetBrains Mono, Consolas, monospace" fill={INK}>{(I.hover.kind === 'port' ? 'port ' : I.hover.kind === 'junc' ? 'junction ' : '') + I.hover.label}</text></g></g>}
        {preview && <path d={ptsD(preview)} fill="none" stroke={SELC} stroke-width={(LINE[I.draw.kind] || LINE.work).w} stroke-dasharray={(LINE[I.draw.kind] || LINE.work).dash || undefined} pointer-events="none" />}
        {preview && preview.slice(0, I.draw.pts.length).map(q => <circle cx={q[0]} cy={q[1]} r={px(2.5)} fill={SELC} pointer-events="none" />)}
        {ghostRef && I.ghost && (() => { const g = geomOf(ghostRef); const asm = isAsm(ghostRef); const c = { x: I.ghost[0] - (asm ? (g.bb[0] + g.bb[2]) / 2 : 0), y: I.ghost[1] - (asm ? (g.bb[1] + g.bb[3]) / 2 : 0), rot: gp && tool === 'place' ? gp.rot : 0, mirror: gp && tool === 'place' ? gp.mirror : false }; return <g opacity=".55" pointer-events="none"><g transform={xfAttr(c)} dangerouslySetInnerHTML={{ __html: g.inner }} /></g>; })()}
        {I.drag?.mode === 'band' && I.drag.started && (() => { const d = I.drag; const cr = d.w1[0] < d.w0[0]; return <rect x={Math.min(d.w0[0], d.w1[0])} y={Math.min(d.w0[1], d.w1[1])} width={Math.abs(d.w1[0] - d.w0[0])} height={Math.abs(d.w1[1] - d.w0[1])} fill={cr ? 'rgba(21,128,61,.06)' : 'rgba(10,100,194,.06)'} stroke={cr ? '#15803D' : SELC} stroke-width={px(1)} stroke-dasharray={cr ? `${px(5)} ${px(3)}` : undefined} pointer-events="none" />; })()}
        {I.drag?.mode === 'encl' && <rect x={Math.min(I.drag.w0[0], I.drag.w1[0])} y={Math.min(I.drag.w0[1], I.drag.w1[1])} width={Math.abs(I.drag.w1[0] - I.drag.w0[0])} height={Math.abs(I.drag.w1[1] - I.drag.w0[1])} fill="none" stroke={SELC} stroke-width=".35" stroke-dasharray={ENCL_DASH} pointer-events="none" />}
      </g>
    </svg>
    <Readout />
    {simOn && <SimLegend pmax={pmax} />}
    {simOn && <LineTip />}{simOn && <LivePopup />}
    {iso && <div class="disobar"><Icon name="focus" size={13} />{t('Isolated')} · {iso.size} {t('items')}<button class="link" onClick={() => { st.isolate.value = null; }}>{t('Show all')}</button></div>}
    <MiniMap sh={sh} v={v} sz={sz} box={mm} onPan={(px_, py_) => setView({ ...v, px: px_, py: py_ })} />{(() => { const o = st.ovState.peek(); if (!o || o.sheet !== sh.id || o.v !== v || o.sz !== sz || o.box !== mm) queueMicrotask(() => { st.ovState.value = { sheet: sh.id, v, sz, box: mm }; }); return null; })()}
    {!sh.components.length && !sh.pipes.length && tool === 'select' && !simOn && <div class="dhint"><b>{inf ? t('Empty canvas') : t('Empty sheet')}</b><span>{(elec ? t('Drag a part from the Parts panel, or click a part and then click on the sheet. Click a terminal to start a wire.') : t('Drag a part from the Parts panel, or click a part and then click on the sheet. Click a port to start a working line.'))}{inf ? ' ' + t('The canvas has no edges — double-click empty space to fit the drawing.') : ''}</span></div>}
  </div>;
}

// ---------- live part in the simulation (valves slide, cylinders move, nested assemblies show their state) ----------
function SimPart({ c, g, k, path }: { c: Comp; g: Geom; k: string; path: string }) {
  simFrame.value; // own subscription: signals skip re-rendering components whose props did not change
  const key = path + k; const se: any = SIM?.el(key);
  if (g.vparts && se?.kind === 'valve') { const vp = g.vparts; const dx = (vp.rest - se.state.pos) * 4 * VU; const bx = (vp.rest * 4 - vp.cx) * VU;
    return <g transform={xfAttr(c)} data-simv={key}><rect x={bx} y={-10} width={20} height={20} fill="rgba(10,100,194,.10)" /><g dangerouslySetInnerHTML={{ __html: vp.stat }} /><g transform={`translate(${r2(dx)} 0)`} dangerouslySetInnerHTML={{ __html: vp.move }} />
      <rect x={g.bb[0] - Math.abs(dx)} y={g.bb[1]} width={g.bb[2] - g.bb[0] + 2 * Math.abs(dx)} height={g.bb[3] - g.bb[1]} fill="transparent" /></g>; }
  if (g.anim && se?.kind === 'actuator') { const a = g.anim; const s = se.state.x / se.state.L; const dx = (s - a.s0) * a.travel;
    return <g transform={xfAttr(c)} data-simk={key} style={{ cursor: 'pointer' }}><g dangerouslySetInnerHTML={{ __html: a.stat }} /><g transform={`translate(${r2(dx)} 0)`} dangerouslySetInnerHTML={{ __html: a.move }} /></g>; }
  if (se?.kind === 'shutoff') return <g transform={xfAttr(c)} data-simt={key} style={{ cursor: 'pointer' }}><g dangerouslySetInnerHTML={{ __html: g.inner }} /><rect x={g.bb[0]} y={g.bb[1]} width={g.bb[2] - g.bb[0]} height={g.bb[3] - g.bb[1]} fill={se.state.open ? 'rgba(21,128,61,.12)' : 'rgba(194,65,12,.12)'} /></g>;
  if (g.kind === 'asm' && g.asm?.expanded) { const ch = S.project.value?.circuits[g.asm.sheet] as Sheet | undefined; if (ch) return <g transform={xfAttr(c)}><SimSheet sh={ch} path={path + k + '/'} /></g>; }
  return <g transform={xfAttr(c)} data-simk={se ? key : undefined} style={se && SIM?.live.get(key) ? { cursor: 'pointer' } : undefined}>{SIM?.alerts.has(key) && path && <rect x={g.bb[0] - 2} y={g.bb[1] - 2} width={g.bb[2] - g.bb[0] + 4} height={g.bb[3] - g.bb[1] + 4} class="dalert" fill="rgba(245,158,11,.14)" stroke="#F59E0B" stroke-width=".6" />}<g dangerouslySetInnerHTML={{ __html: g.inner }} /></g>;
}
function SimSheet({ sh, path }: { sh: Sheet; path: string }) {
  simFrame.value; const pmax = Math.max(SIM?.maxP || 1e5, 1e5); const deg = junctionDegree(sh);
  return <g pointer-events="visiblePainted">
    {sh.enclosures.map(en => <rect x={en.x} y={en.y} width={en.w} height={en.h} fill="none" stroke={INK} stroke-width=".35" stroke-dasharray={ENCL_DASH} />)}
    {sh.pipes.map(p => { const k = path + '|' + p.id; const nn = SIM?.f.pipeNode.get(k); const L = LINE[p.kind] || LINE.work; const pts = livePts(sh, p); const d = ptsD(pts); return <g data-simp={k}>
      {SIM?.alerts.has(k) && S.prefs.value.sim?.alerts !== false && <path d={d} fill="none" class="dalert" stroke="#F59E0B" stroke-width={L.w + 1.6} opacity=".7" />}
      <path d={d} fill="none" stroke={nn != null ? pColor(SIM!.p[nn], pmax) : INK} stroke-width={L.w + .3} stroke-dasharray={L.dash || undefined} />
      <path d={d} fill="none" stroke="transparent" stroke-width="3" /><FlowArrows pts={pts} k={k} /></g>; })}
    {sh.junctions.filter(j => (deg.get(j.id) || 0) >= 3).map(j => <circle cx={j.x} cy={j.y} r={1} fill={INK} />)}
    {sh.components.map(c => { const g = geomOf(c.ref); const lp = labelPos(c, g); const rd = g.kind !== 'conn' ? SIM?.el(path + c.id)?.read?.(SIM!) : null; return <g><SimPart c={c} g={g} k={c.id} path={path} />
      {c.labelPos !== 'hidden' && <text x={lp.x} y={lp.y} font-size={g.kind === 'conn' ? 3 : 3.4} font-weight="700" text-anchor={lp.anchor} fill={g.kind === 'conn' ? INK : SELC} font-family="IBM Plex Sans, Arial" pointer-events="none">{c.tag}</text>}
      {rd && <text x={lp.x} y={lp.y + 3.6} font-size="2.5" text-anchor={lp.anchor} fill={rd.on ? '#15803D' : '#0A4F99'} font-weight="600" font-family="JetBrains Mono, Consolas, monospace" pointer-events="none">{rd.text}</text>}</g>; })}
    {sh.texts.map(tx => <text x={tx.x} y={tx.y} font-size={tx.h} fill={INK} font-family="IBM Plex Sans, Arial">{tx.s}</text>)}
  </g>;
}
// moving arrows along a line in the direction of flow (Preferences › Simulation)
function FlowArrows({ pts, k }: { pts: number[][]; k: string }) {
  simFrame.value; const m = S.prefs.value.sim; if (!m?.anim || !SIM) return null; const q = SIM.pipeQ.get(k); if (q == null) return null;
  const nn = SIM.f.pipeNode.get(k)!; const H = SIM.hyd[nn]; if (Math.abs(q) < (H ? 1.5e-6 : 2e-6)) return null;
  const vel = SIM.pipeV.get(k) || 0; const sc = m.size / 100, al = m.len * sc, w = m.width * sc, gap = 100 / Math.max(1, m.count);
  const segs: number[] = []; let L = 0; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); L += l; } if (L < al * 1.5) return null;
  const speed = (6 + 14 * Math.min(vel, 6)); const ph = ((animT * speed) % gap + gap) % gap; const dir = q > 0 ? 1 : -1;
  const at = (d: number) => { let acc = 0; for (let i = 0; i < segs.length; i++) { if (d <= acc + segs[i] || i === segs.length - 1) { const t0 = segs[i] ? (d - acc) / segs[i] : 0; const a = pts[i], b = pts[i + 1]; return { x: a[0] + (b[0] - a[0]) * t0, y: a[1] + (b[1] - a[1]) * t0, ux: (b[0] - a[0]) / (segs[i] || 1), uy: (b[1] - a[1]) / (segs[i] || 1) }; } acc += segs[i]; } return null; };
  const col = m.color === 'pressure' ? pColorDark(SIM.p[nn], Math.max(SIM.maxP, 1e5)) : m.color === 'accent' ? '#0A64C2' : m.color === 'white' ? '#fff' : '#1B2633';
  let dd = ''; for (let s0 = ph + al / 2; s0 < L - al / 2; s0 += gap) { const pos = dir > 0 ? s0 : L - s0; const p = at(pos); if (!p) continue; const ux = p.ux * dir, uy = p.uy * dir, nx = -uy, ny = ux;
    const tip = [p.x + ux * al / 2, p.y + uy * al / 2], bl = [p.x - ux * al / 2 + nx * w / 2, p.y - uy * al / 2 + ny * w / 2], br = [p.x - ux * al / 2 - nx * w / 2, p.y - uy * al / 2 - ny * w / 2], nt = [p.x - ux * al / 4, p.y - uy * al / 4];
    dd += `M${r2(tip[0])},${r2(tip[1])}L${r2(bl[0])},${r2(bl[1])}L${r2(nt[0])},${r2(nt[1])}L${r2(br[0])},${r2(br[1])}Z`; }
  return dd ? <path class="dflow" d={dd} fill={col} stroke={m.color === 'white' ? '#1B2633' : 'none'} stroke-width=".15" pointer-events="none" /> : null;
}
const pColorDark = (p: number, pmax: number) => pColor(p, pmax).replace(/(\d+)%\)$/, (_, l) => `${Math.max(18, +l - 26)}%)`);
function LineTip() {
  simFrame.value; const hv = simHover.value; if (!hv || !SIM || S.prefs.value.sim?.tooltip === false) return null; const nn = SIM.f.pipeNode.get(hv.key); if (nn == null) return null; const H = SIM.hyd[nn];
  const q = SIM.pipeQ.get(hv.key), v = SIM.pipeV.get(hv.key); const al = SIM.alerts.get(hv.key);
  return <div class="dlinetip" style={{ left: hv.x + 14, top: hv.y + 12 }}><b>{st.fmtQ('pressure', SIM.p[nn])}</b>
    <span>{q == null ? t('flow: in a loop') : H ? `${st.fmtQ('flow', Math.abs(q))}` : `${(Math.abs(q) / 1.185 * 60000).toFixed(0)} Nl/min`}{v != null && H ? ` · ${v.toFixed(2)} m/s` : ''}</span>
    <small>{SIM.f.labels[nn].slice(0, 3).join(' · ')}</small>{al && <small class="al">{al}</small>}</div>;
}
// slider beside a part while running: throttle opening, valve setting, pump speed / displacement, load, proportional command
function LivePopup() {
  simFrame.value; const o = liveOpen.value; if (!o || !SIM) return null; const L = SIM.live.get(o.key); const se = SIM.el(o.key); if (!L || !se) return null;
  const lp = st.livePos.value; const col = st.liveCollapsed.value;
  const drag = (e: any) => { if ((e.target as Element).closest('button')) return; const box = (e.currentTarget.closest('.dlivepop') as HTMLElement); const host = box.offsetParent as HTMLElement; const hr = host.getBoundingClientRect(); const r = box.getBoundingClientRect(); const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const el = e.currentTarget as HTMLElement; try { el.setPointerCapture(e.pointerId); } catch { } const mv = (ev: PointerEvent) => { const x = Math.max(0, Math.min(hr.width - 60, ev.clientX - hr.left - dx)), y = Math.max(0, Math.min(hr.height - 30, ev.clientY - hr.top - dy)); st.livePos.value = { x, y }; };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); if (st.livePos.value) st.setLivePos(st.livePos.value); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); };
  const pos = lp || { x: Math.max(4, o.x), y: Math.max(4, o.y) };
  return <div class={'dlivepop' + (lp ? ' moved' : '')} style={{ left: pos.x, top: pos.y }} onPointerDown={(e: any) => e.stopPropagation()}>
    <div class="h drag" onPointerDown={drag} title={t('Drag to move — it stays there for the next part')}><Icon name="grip-vertical" size={12} /><b>{se.tag}</b><span>{se.el?.g.name}</span>
      {lp && <button class="iconbtn" title={t('Back beside the part')} aria-label={t('Back beside the part')} onClick={() => st.setLivePos(null)}><Icon name="pin-off" size={12} /></button>}
      <button class="iconbtn" title={col ? t('Expand') : t('Collapse')} aria-label={col ? t('Expand') : t('Collapse')} onClick={() => { st.liveCollapsed.value = !col; }}><Icon name={col ? 'chevron-down' : 'chevron-up'} size={12} /></button>
      <button class="iconbtn" aria-label={t('Close')} onClick={() => { liveOpen.value = null; }}><Icon name="x" size={12} /></button></div>
    {!col && Object.entries(L).map(([k, p]: [string, any]) => { const v = p.get() * p.scale; return <label class="row"><span>{t(p.label)}</span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={v} onInput={(e: any) => setLive(o.key, k, +e.target.value / p.scale)} />
      <input class="in num" type="number" min={p.min} max={p.max} step={p.step} value={+v.toFixed(2)} onChange={(e: any) => setLive(o.key, k, +e.target.value / p.scale)} /><small>{p.unit}</small></label>; })}
    {!col && <small class="muted">{t('Applies now, for this run. Keep it from the Simulation tab.')}</small>}</div>;
}
function SimLegend({ pmax }: { pmax: number }) {
  const v = simView.value!; const f = st.fmtQ;
  return <div class="dsimlegend" aria-live="off"><div class="grad" /><div class="lbl"><span>{f('pressure', 0)}</span><span>{f('pressure', pmax / 2)}</span><span>{f('pressure', pmax)}</span></div>
    <div class="st"><b>t = {v.t.toFixed(2)} s</b> · ×{v.speed}{v.running ? '' : ' · ' + t('paused')}{v.rtf < v.speed * 0.95 ? ` · ${t('real-time')} ${Math.round(v.rtf / v.speed * 100)} %` : ''}</div>
    <div class="hint">{t('Click a valve box to switch it · it stays until you click another')}</div></div>;
}

function Readout() {
  const c = st.cursorInfo.value; const tl = st.tool.value;
  const TL: Record<string, string> = { select: 'Select', work: 'Working line', pilot: 'Pilot line', drain: 'Drain line', wire: 'Wire', power: 'Power wire', pe: 'PE wire', junction: 'Junction', text: 'Text', enclosure: 'Enclosure', place: 'Place part' };
  return <div class="dreadout" aria-live="off"><span>{c ? `X ${c.x.toFixed(1)} · Y ${c.y.toFixed(1)} mm` : 'X — · Y —'}</span><span>{t('snap')}: {c?.snap || (st.opts.value.snap ? 'grid' : 'off')}</span><span class="dtoolname">{t(TL[tl])}{tl === 'place' && st.placing.value ? ` · R ${t('rotate')} · M ${t('mirror')}` : st.LINE_TOOLS.has(tl) ? ` · ${t('click ports to connect')} · Esc` : ''}</span></div>;
}
export function MiniMap({ sh, v, sz, box, onPan, big }: { sh: Sheet; v: any; sz: any; box: number[]; onPan: (px: number, py: number) => void; big?: number }) {
  const W = box[2] - box[0], H = box[3] - box[1]; const mw = big || 128, mh = big ? Math.round(big * H / Math.max(1, W)) : Math.max(40, Math.min(150, Math.round(128 * H / Math.max(1, W)))); const k = Math.min(mw / W, mh / H); const drag = useRef(false);
  if (!big && st.popWins.value.overview) return null;
  if (!big && !st.overviewOn.value) return <button class="dminimap shut" onClick={() => st.setOverview(true)} title={t('Show overview')}><Icon name="chevron-up" size={12} />{t('overview')}</button>;
  const go = (e: PointerEvent) => { const r = (e.currentTarget as Element).getBoundingClientRect(); const wx = box[0] + (e.clientX - r.left) / k, wy = box[1] + (e.clientY - r.top) / k; onPan(sz.w / 2 - wx * v.z, sz.h / 2 - wy * v.z); };
  const vx = -v.px / v.z, vy = -v.py / v.z, vw = sz.w / v.z, vh = sz.h / v.z;
  return <div class="dminimap" title={t('Overview — drag to pan')}><svg width={mw} height={mh} viewBox={`${box[0]} ${box[1]} ${W} ${H}`} preserveAspectRatio="xMinYMin meet" onPointerDown={(e: any) => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); go(e); }} onPointerMove={(e: any) => drag.current && go(e)} onPointerUp={() => drag.current = false}>
    <rect x={box[0]} y={box[1]} width={W} height={H} fill="#fff" stroke="#C9D3DE" stroke-width={W / 300} />
    {sh.components.map(c => { const b = xfBB(c, geomOf(c.ref).bb); return <rect x={b[0]} y={b[1]} width={b[2] - b[0]} height={b[3] - b[1]} fill="#5B6878" />; })}
    {sh.pipes.map(p => <path d={ptsD(p.pts)} fill="none" stroke="#5B6878" stroke-width={W / 400} />)}
    <rect x={vx} y={vy} width={vw} height={vh} fill="rgba(10,100,194,.08)" stroke="#0A64C2" stroke-width={W / 200} />
  </svg>{!big && <div class="dmmbar"><button class="link" onClick={() => st.pops.overview?.()} title={t('Open the overview in its own window')}>⧉</button><button class="link" onClick={() => st.setOverview(false)} title={t('Hide overview')}>{t('overview')} ✕</button></div>}</div>;
}
