// Part geometry for the circuit designer.
// World units are millimetres, y pointing down (SVG). Each part is drawn about its own origin:
//  - standard / custom symbols: the Symbol Sketcher origin (entities are y-up, flipped here)
//  - valves: the centre of the normal (rest) box; ISO valve box = 20 mm (renderer unit 5 mm)
import { STD, STD_VALVES, stdValveDef, valveAsStd, entPath, type StdItem } from '../symbols';
import * as S from '../store';
import { valveSvg } from '../tools';
import { elecLetter } from './elec';

export const INK = '#1B2633', ACC = '#0A64C2', WARN = '#C2410C';
export const SW = 0.35;          // symbol line weight, mm
export const VU = 5;             // valve renderer unit → mm
const VL = 4, LEAD = 1.2;
export type PortG = { key: string; name: string; x: number; y: number; dir: number; role: string; domain: string };
export type Geom = { ref: string; name: string; domain: string; category: string; cls: string; standard: string; letter: string; inner: string; bb: number[]; ports: PortG[]; specs: any[]; valve?: any; kind: 'std' | 'valve' | 'symbol' | 'missing' | 'conn' | 'asm'; ready: boolean; item?: any;
  vparts?: { stat: string; move: string; boxes: number; rest: number; cx: number }; // valve: fixed port leads vs. the sliding box body (simulation)
  anim?: { stat: string; move: string; travel: number; s0: number; axis: 'x' };      // cylinder: barrel vs. piston + rod (simulation)
  asm?: { sheet: string; expanded: boolean; tip?: number[] } };

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const esc = (s: any) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- ISO 1219-2 component code letters ----------
const LETTER: Record<string, string> = { pump: 'P', pumpmotor: 'P', motor: 'A', cylinder: 'A', rotary: 'A', drive: 'M', valve: 'V', check: 'V', pressure: 'V', flow: 'V', shutoff: 'V', cartridge: 'V', logic: 'V', switch: 'S', sensor: 'S' };
export const LETTER_NAME: Record<string, string> = { P: 'Pumps & compressors', A: 'Actuators', M: 'Prime movers', V: 'Valves', S: 'Sensing & signal', Z: 'Other equipment', U: 'Assemblies (instances)', X: 'Interface ports' };
const TEMPLATE_LETTER: Record<string, string> = { valve: 'V', actuator: 'A', sensor: 'S', passive: 'Z', load: 'Z' };

// ---------- valve port layout (mirrors the Valve Creator) ----------
const LAYOUT: Record<number, { top: string[]; bot: string[]; fx: Record<string, number> }> = {
  2: { top: ['A'], bot: ['P'], fx: { A: .5, P: .5 } },
  3: { top: ['A'], bot: ['P', 'T'], fx: { A: .5, P: .25, T: .75 } },
  4: { top: ['A', 'B'], bot: ['P', 'T'], fx: { A: .25, B: .75, P: .25, T: .75 } },
  5: { top: ['A', 'B'], bot: ['R', 'P', 'S'], fx: { A: .25, B: .75, R: .25, P: .5, S: .75 } },
  6: { top: ['A', 'C', 'B'], bot: ['P', 'D', 'T'], fx: { A: .25, C: .5, B: .75, P: .25, D: .5, T: .75 } }
};
const NAMES: Record<string, Record<number, Record<string, string>>> = {
  hydraulic: { 2: { A: 'A', P: 'P' }, 3: { A: 'A', P: 'P', T: 'T' }, 4: { A: 'A', B: 'B', P: 'P', T: 'T' }, 5: { A: 'A', B: 'B', R: 'T', P: 'P', S: 'T1' }, 6: { A: 'A', C: 'C', B: 'B', P: 'P', D: 'D', T: 'T' } },
  pneumatic: { 2: { A: '2', P: '1' }, 3: { A: '2', P: '1', T: '3' }, 4: { A: '4', B: '2', P: '1', T: '3' }, 5: { A: '4', B: '2', R: '5', P: '1', S: '3' }, 6: { A: '4', C: '6', B: '2', P: '1', D: '5', T: '3' } }
};
const VROLE: Record<string, string> = { P: 'supply', T: 'return', R: 'return', S: 'return', A: 'work', B: 'work', C: 'work', D: 'work' };
export const valvePorts = (d: any) => +String(d.matrix).split('/')[0];
export const valvePositions = (d: any) => +String(d.matrix).split('/')[1];
export function valveRest(d: any) {
  const n = valvePositions(d); if (n === 3) return 1;
  const ls = d.ops.left.some((o: any) => o.type === 'spring'), rs = d.ops.right.some((o: any) => o.type === 'spring');
  if (n === 2) { if (rs && !ls) return 1; if (ls && !rs) return 0; }
  const r = d.restManual; return (r != null && r < n) ? r : 1;
}
const valveAlias = (d: any, id: string) => (d.aliases && d.aliases[id]) || NAMES[d.domain]?.[valvePorts(d)]?.[id] || id;
export const posLetters = (n: number) => n === 2 ? ['a', 'b'] : n === 3 ? ['a', '0', 'b'] : Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i));
export const hasSolenoid = (d: any) => [...(d?.ops?.left || []), ...(d?.ops?.right || [])].some((o: any) => o.type === 'solenoid' || o.type === 'proportional' || o.type === 'servo');

// inline the renderer's CSS classes so the drawing survives export (svg2pdf, DXF, PNG)
export function inlineValveClasses(s: string, ink = INK) {
  return s.replace(/class="s"/g, `fill="none" stroke="${ink}" stroke-width=".075" stroke-linejoin="miter"`)
    .replace(/class="sfo"/g, `fill="#fff" stroke="${ink}" stroke-width=".075"`)
    .replace(/class="sf"/g, `fill="${ink}"`)
    .replace(/class="sd"/g, `fill="none" stroke="${ink}" stroke-width=".06" stroke-dasharray=".5 .3"`)
    .replace(/class="st"/g, `fill="${ink}" font-family="JetBrains Mono, Consolas, monospace" font-weight="500"`)
    .replace(/class="aidt?"/g, 'display="none"');
}


// features the Valve Creator does not draw (throttled paths, seat checks, leak-free seats, spool switch / feedback): drawn on top in valve units
function valveExtras(d: any, lay: { top: string[]; bot: string[]; fx: Record<string, number> }) {
  const ink = INK, sw = '.075'; let mv = '', st = '';
  const P = (i: number, id: string) => ({ x: i * VL + (lay.fx[id] ?? .5) * VL, y: lay.top.includes(id) ? 0 : VL });
  (d.boxes || []).forEach((b: any, i: number) => {
    (b.paths || []).forEach((p: any) => { if (!p.thr && !p.chk) return; const A = P(i, p.a), B = P(i, p.b); let mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      if (Math.abs(A.y - B.y) < 1e-6) my = A.y === 0 ? 1.35 : VL - 1.35;
      let ang0 = Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI;
      if (p.d === 'open') { const top = A.y === 0 ? A : B.y === 0 ? B : A; mx = top.x; my = top.y === 0 ? VL / 4 : VL * 3 / 4; ang0 = 90; } // open nets run vertically into a bus: throttle sits on the port's stem
      const ang = ang0;
      if (p.thr) mv += `<g transform="translate(${r3(mx)} ${r3(my)}) rotate(${r3(ang)})"><path d="M-.18,-.45 Q.05,0 -.18,.45 M.18,-.45 Q-.05,0 .18,.45" fill="none" stroke="${ink}" stroke-width="${sw}"/></g>`;
      if (p.chk) mv += `<g transform="translate(${r3(mx)} ${r3(my)}) rotate(${r3(ang - 90)})"><circle cx="0" cy="-.12" r=".26" fill="#fff" stroke="${ink}" stroke-width="${sw}"/><path d="M-.42,.42 L0,.12 L.42,.42" fill="none" stroke="${ink}" stroke-width="${sw}"/></g>`;
    });
    if (d.seat) (b.blocked || []).forEach((id: string) => { const q = P(i, id); const y = q.y === 0 ? .95 : VL - .95; mv += `<circle cx="${r3(q.x)}" cy="${r3(y)}" r=".22" fill="#fff" stroke="${ink}" stroke-width="${sw}"/>`; });
  });
  if (d.pswitch) { const n = (d.boxes || []).length, rest = valveRest(d); const bx = rest === 0 ? n * VL - 1.6 : .4, y0 = -2.2;
    st += `<rect x="${r3(bx)}" y="${y0}" width="1.2" height="1" fill="#fff" stroke="${ink}" stroke-width="${sw}"/>`;
    st += d.pswitch === 'lvdt' ? `<path d="M${r3(bx + .15)},${y0 + .85} L${r3(bx + 1.05)},${y0 + .15}" stroke="${ink}" stroke-width="${sw}"/><path d="M${r3(bx + .6)},${y0 + 1} L${r3(bx + .6)},0" stroke="${ink}" stroke-width="${sw}" stroke-dasharray=".25 .15"/>`
      : `<path d="M${r3(bx + .2)},${y0 + .7} L${r3(bx + .55)},${y0 + .7} L${r3(bx + .95)},${y0 + .35}" fill="none" stroke="${ink}" stroke-width="${sw}"/><path d="M${r3(bx + .6)},${y0 + 1} L${r3(bx + .6)},0" stroke="${ink}" stroke-width="${sw}" stroke-dasharray=".25 .15"/>`; }
  return { mv, st };
}
function valveGeom(ref: string, it: any, d: any, key: string): Geom {
  const np = valvePorts(d), lay = LAYOUT[np] || LAYOUT[4], rest = valveRest(d), cx = rest * VL + VL / 2, cy = VL / 2;
  const W = (u: number) => r3((u - cx) * VU), H = (v: number) => r3((v - cy) * VU);
  const ports: PortG[] = [];
  lay.top.forEach(id => ports.push({ key: id, name: valveAlias(d, id), x: W(rest * VL + lay.fx[id] * VL), y: H(-LEAD), dir: 270, role: VROLE[id], domain: d.domain }));
  lay.bot.forEach(id => ports.push({ key: id, name: valveAlias(d, id), x: W(rest * VL + lay.fx[id] * VL), y: H(VL + LEAD), dir: 90, role: d.domain === 'pneumatic' && VROLE[id] === 'return' ? 'exhaust' : VROLE[id], domain: d.domain }));
  const raw = valveSvg(d, key); let inner = '', bb = [W(0) - 4, H(-LEAD) - 2, W(valvePositions(d) * VL) + 4, H(VL + LEAD) + 2]; let vparts: Geom['vparts'];
  if (raw) {
    try {
      const doc = new DOMParser().parseFromString(raw, 'image/svg+xml'); const svg = doc.documentElement;
      const vb = (svg.getAttribute('viewBox') || '0 0 10 10').split(/\s+/).map(Number); const pad = .8;
      bb = [W(vb[0] + pad), H(Math.min(vb[1] + pad, d.pswitch ? -2.4 : 1e9)), W(vb[0] + vb[2] - pad), H(vb[1] + vb[3] - pad)];
      // pilot, external pilot (X/12-14), pilot drain (Y/82-84), leak (L) and load-sensing (LS) ports: dashed leads ending below the boxes
      const texts = [...svg.querySelectorAll('text')].map(t => ({ x: +t.getAttribute('x')!, y: +t.getAttribute('y')!, s: t.textContent || '' }));
      const used = new Set(ports.map(p => p.key));
      [...svg.querySelectorAll('line.sd')].forEach(l => {
        const x1 = +l.getAttribute('x1')!, y1 = +l.getAttribute('y1')!, x2 = +l.getAttribute('x2')!, y2 = +l.getAttribute('y2')!;
        if (Math.abs(x1 - x2) > 1e-3) return; const yb = Math.max(y1, y2); if (yb < VL + LEAD - .05) return;
        let best: any = null, bd = 2.2; texts.forEach(t => { const dd = Math.hypot(t.x - x1, t.y - yb - (yb > VL + 1.5 ? .7 : -.1)); if (dd < bd) { bd = dd; best = t; } });
        const name = best?.s || 'X'; let k = name, i = 2; while (used.has(k)) k = name + '·' + (i++); used.add(k);
        const stage = [...d.ops.left, ...d.ops.right].some((o: any) => o.type === 'servo' || ((o.type === 'solenoid' || o.type === 'proportional') && o.stage === 'pilot'));
        const role = name === 'L' ? 'drain' : (/^(Y|82\/84)$/.test(name) && stage && d.aux?.Y && !d.ops.right.some((o: any) => o.type === 'pilot')) ? 'drain' : 'pilot';
        ports.push({ key: k, name, x: W(x1), y: H(yb), dir: 90, role, domain: d.domain });
      });
      const body = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[\s\S]*?<\/title>/, '').replace(/<style>[\s\S]*?<\/style>/, '');
      const xt = valveExtras(d, lay); inner = `<g transform="scale(${VU}) translate(${r3(-cx)} ${r3(-cy)})">${inlineValveClasses(body)}${xt.mv}${xt.st}</g>`;
      // split for simulation: port leads + port letters + pilot leads stay; boxes and operators slide (ISO: the active box moves under the ports)
      try {
        const wrap = (x: string) => `<g transform="scale(${VU}) translate(${r3(-cx)} ${r3(-cy)})">${inlineValveClasses(x)}</g>`;
        const leads: number[] = []; let stat = '', move = '';
        [...svg.children].forEach(el => {
          const tag = el.tagName; const html = el.outerHTML; if (tag === 'title' || tag === 'style') return;
          if (tag === 'line') { const x1 = +el.getAttribute('x1')!, y1 = +el.getAttribute('y1')!, x2 = +el.getAttribute('x2')!, y2 = +el.getAttribute('y2')!;
            const vert = Math.abs(x1 - x2) < 1e-3, lo = Math.min(y1, y2), hi = Math.max(y1, y2);
            if (vert && ((hi <= 1e-3 && lo < -0.3) || (lo >= VL - 1e-3 && hi > VL + 0.3))) { leads.push(x1); stat += html; return; } }
          if (tag === 'text') { const x = +el.getAttribute('x')!, y = +el.getAttribute('y')!; if ((y < -0.2 || y > VL + 0.2) && leads.some(l => Math.abs(x - l - 0.22) < 0.06)) { stat += html; return; } }
          move += html;
        });
        // texts come after their lead lines in the renderer output: re-check texts once all leads are known
        const doc2 = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${move}</svg>`, 'image/svg+xml'); let mv = '';
        [...doc2.documentElement.children].forEach(el => { if (el.tagName === 'text') { const x = +el.getAttribute('x')!, y = +el.getAttribute('y')!; if ((y < -0.2 || y > VL + 0.2) && leads.some(l => Math.abs(x - l - 0.22) < 0.06)) { stat += el.outerHTML; return; } } mv += el.outerHTML; });
        vparts = { stat: wrap(stat + xt.st), move: wrap(mv + xt.mv), boxes: valvePositions(d), rest, cx };
      } catch { vparts = undefined; }
    } catch { inner = ''; }
  }
  if (!inner) inner = `<rect x="${bb[0]}" y="${H(0)}" width="${r3(bb[2] - bb[0])}" height="${VL * VU}" fill="none" stroke="${INK}" stroke-width="${SW}" stroke-dasharray="1.5 1"/>`;
  return { ref, name: it.name || d.name || 'Valve', domain: d.domain, category: it.category || 'Directional valves', cls: 'valve', standard: it.standard || ('ISO 1219-1' + (d.domain === 'pneumatic' ? ' · ISO 5599' : '')), letter: 'V', inner, bb, ports, specs: it.specs || [], valve: d, kind: 'valve', ready: !!raw, item: it, vparts };
}

// ---------- symbol entities (Sketcher format, y-up) → world SVG ----------
function entBB(e: any): number[] {
  switch (e.type) {
    case 'line': return [Math.min(e.x1, e.x2), Math.min(e.y1, e.y2), Math.max(e.x1, e.x2), Math.max(e.y1, e.y2)];
    case 'circle': case 'arc': return [e.cx - e.r, e.cy - e.r, e.cx + e.r, e.cy + e.r];
    case 'rect': return [e.x, e.y, e.x + e.w, e.y + e.h];
    case 'poly': case 'spline': { const xs = e.pts.map((p: number[]) => p[0]), ys = e.pts.map((p: number[]) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
    case 'text': return [e.x, e.y, e.x + String(e.s).length * e.h * 0.6, e.y + e.h];
  } return [0, 0, 0, 0];
}
export function entsInner(ents: any[], ink = INK) {
  const vis = ents.filter(e => !e.hidden && e.layer !== 'L3' && e.layer !== 'L4');
  let paths = '', texts = '';
  vis.forEach(e => {
    if (e.type === 'text') { texts += `<text x="${r3(e.x)}" y="${r3(-e.y)}" font-size="${e.h}" fill="${ink}" font-family="IBM Plex Sans, Arial, sans-serif">${esc(e.s)}</text>`; return; }
    const w = e.stroke ? Math.max(.2, Math.min(1, e.stroke)) : SW;
    const dash = e.line_type === 'dashed' ? ' stroke-dasharray="2 1.2"' : (e.line_type === 'chain' || e.line_type === 'center') ? ' stroke-dasharray="6 1.5 1 1.5"' : '';
    paths += `<path d="${entPath(e)}" fill="${e.fill ? ink : 'none'}" stroke="${ink}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`;
  });
  let b = [1e9, 1e9, -1e9, -1e9]; vis.forEach(e => { const q = entBB(e); b = [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[2]), Math.max(b[3], q[3])]; });
  if (b[0] > b[2]) b = [-5, -5, 5, 5];
  return { inner: `<g transform="scale(1,-1)">${paths}</g>${texts}`, bb: [b[0], -b[3], b[2], -b[1]] };
}
const flipDir = (or: number) => ((360 - (or || 0)) % 360 + 360) % 360;

// cylinder symbols: the piston (narrow full-height rect) and the rod (lines on the axis) move; everything else is the barrel
function cylAnim(ents: any[]): Geom['anim'] {
  const vis = ents.filter(e => !e.hidden && e.layer !== 'L3' && e.layer !== 'L4');
  const rects = vis.filter(e => e.type === 'rect'); if (!rects.length) return undefined;
  const barrel = rects.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  const piston = rects.find(r => r !== barrel && r.w < 4 && Math.abs(r.h - barrel.h) < 0.6 && r.x > barrel.x - 0.1 && r.x + r.w < barrel.x + barrel.w + 0.1);
  if (!piston) return undefined;
  const cy = barrel.y + barrel.h / 2, half = Math.max(2.2, barrel.h * 0.14);
  const isRod = (e: any) => e === piston || (e.type === 'line' && Math.abs(e.y1 - cy) <= half && Math.abs(e.y2 - cy) <= half && (Math.abs(e.y1 - e.y2) < 1e-6 ? Math.max(e.x1, e.x2) > piston.x : Math.min(e.x1, e.x2) >= barrel.x + barrel.w - 0.01 || Math.max(e.x1, e.x2) <= barrel.x + 0.01));
  const mv = vis.filter(isRod), st = vis.filter(e => !isRod(e)); if (mv.length < 2) return undefined;
  const travel = Math.round(barrel.w * 0.7 * 10) / 10, s0 = Math.max(0, Math.min(1, (piston.x - (barrel.x + 8)) / travel));
  return { stat: entsInner(st).inner, move: entsInner(mv).inner, travel, s0, axis: 'x' };
}
function stdGeom(ref: string, it: StdItem): Geom {
  const { inner, bb } = entsInner(it.ents || []);
  const seen = new Set<string>();
  const ports = it.ports.map(p => { let k = p.name, i = 2; while (seen.has(k)) k = p.name + '·' + (i++); seen.add(k); return { key: k, name: p.name, x: p.x, y: -p.y, dir: flipDir(p.or), role: p.role, domain: p.domain }; });
  ports.forEach(p => { bb[0] = Math.min(bb[0], p.x); bb[1] = Math.min(bb[1], p.y); bb[2] = Math.max(bb[2], p.x); bb[3] = Math.max(bb[3], p.y); });
  return { ref, name: it.name, domain: it.domain, category: it.category, cls: it.cls, standard: it.standard, letter: it.domain === 'electrical' ? elecLetter(it) : LETTER[it.cls] || 'Z', inner, bb, ports, specs: it.specs, kind: 'std', ready: true, item: it, anim: it.cls === 'cylinder' ? cylAnim(it.ents || []) : undefined };
}
function symbolGeom(ref: string, it: any): Geom {
  const d = it.definition || {}; const ents = [...(d.geometry_static || []), ...((d.geometry_dynamic || []).flatMap((g: any) => g.entities || []))];
  const { inner, bb } = entsInner(ents);
  const ports = (d.port_nodes || []).map((p: any, i: number) => ({ key: p.name || 'p' + i, name: p.name || 'p' + i, x: p.x, y: -p.y, dir: flipDir(p.orientation), role: p.role || 'work', domain: p.domain || d.domain || 'hydraulic' }));
  ports.forEach((p: any) => { bb[0] = Math.min(bb[0], p.x); bb[1] = Math.min(bb[1], p.y); bb[2] = Math.max(bb[2], p.x); bb[3] = Math.max(bb[3], p.y); });
  return { ref, name: it.name || d.name || 'Custom symbol', domain: d.domain || it.domain || 'hydraulic', category: 'Custom', cls: d.behavior_template || 'passive', standard: 'Custom (ISO 1219-1 style)', letter: TEMPLATE_LETTER[d.behavior_template] || 'Z', inner, bb, ports, specs: [], kind: 'symbol', ready: true, item: it };
}
export function missing(ref: string, why = ''): Geom {
  return { ref, name: why || 'Missing part (' + ref + ')', domain: 'hydraulic', category: '—', cls: 'missing', standard: '—', letter: 'Z', inner: `<rect x="-10" y="-10" width="20" height="20" fill="#FDE8E7" stroke="${WARN}" stroke-width=".5" stroke-dasharray="2 1"/><text x="0" y="2" font-size="6" text-anchor="middle" fill="${WARN}" font-family="IBM Plex Sans, Arial">?</text>`, bb: [-10, -10, 10, 10], ports: [], specs: [], kind: 'missing', ready: true };
}

// ---------- lookup ----------
const vItems = new Map<string, any>();
export const stdItem = (id: string): any => STD.find(x => x.id === id) || S.stdValveItems.value.find((x: any) => x.id === id) || (() => {
  let it = vItems.get(id); if (it) return it; const v = STD_VALVES.find(x => x.id === id); if (!v) return undefined;
  it = valveAsStd(v, stdValveDef(v)); vItems.set(id, it); return it;
})();
export function libItem(id: string): any {
  const p = S.project.value; return p?.library?.find((x: any) => x.item_id === id) || S.customLib.value.find(x => x.item_id === id);
}
export const refOf = (kind: 'std' | 'lib', id: string) => kind + ':' + id;
export function itemOf(ref: string): any { const [k, id] = splitRef(ref); return k === 'lib' ? libItem(id) : stdItem(id); }
export function splitRef(ref: string): [string, string] { const i = ref.indexOf(':'); return i < 0 ? ['std', ref] : [ref.slice(0, i), ref.slice(i + 1)]; }

// ---------- interface port (off-sheet connector) ----------
// The internal pipe joins at X (left, 0/0). Seen from outside an assembly, the line joins at the flag tip.
export const CONN_REF = 'sys:conn';
export const CONN_TIP = [19, 0];
const CONN: Geom = { ref: CONN_REF, name: 'Interface port (connector)', domain: 'hydraulic', category: 'Lines & connections', cls: 'connector', standard: 'ISO 1219-2 · interface point', letter: 'X',
  inner: `<path d="M0,0H3M3,-3.5H15L19,0L15,3.5H3Z" fill="#fff" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="miter"/>`, bb: [0, -3.5, 19, 3.5],
  ports: [{ key: 'X', name: 'X', x: 0, y: 0, dir: 180, role: 'work', domain: 'hydraulic' }], specs: [], kind: 'conn', ready: true };
export const isConn = (ref: string) => ref === CONN_REF;
export const isAsm = (ref: string) => ref.startsWith('asm:') || ref.startsWith('asmx:');
let asmProvider: ((ref: string, id: string, expanded: boolean) => Geom) | null = null;
export const setAsmProvider = (f: typeof asmProvider) => { asmProvider = f; };

const cache = new Map<string, Geom>();
export function geomOf(ref: string, snap?: any): Geom {
  const [k, id] = splitRef(ref);
  if (k === 'sys') return id === 'conn' ? CONN : missing(ref);
  if (k === 'asm' || k === 'asmx') return asmProvider ? asmProvider(ref, id, k === 'asmx') : missing(ref);
  if (k === 'std') {
    const it = stdItem(id); if (!it) return missing(ref);
    if (it.valve) { const ck = ref + '|' + (S.valveSvgs.value[it.id] ? 1 : 0); let g = cache.get(ck); if (!g) { g = valveGeom(ref, it, it.valve, it.id); cache.set(ck, g); } return g; }
    let g = cache.get(ref); if (!g) { g = stdGeom(ref, it); cache.set(ref, g); } return g;
  }
  const it = libItem(id) || snap; if (!it) return missing(ref);
  const vkey = it.item_id + '@' + it.version + '@' + (it.modified || '');
  if (it.type === 'valve') { const ck = ref + '|' + vkey + '|' + (S.valveSvgs.value[vkey] ? 1 : 0); let g = cache.get(ck); if (!g) { g = valveGeom(ref, { name: it.name, category: 'Custom valves', specs: [] }, it.definition, vkey); cache.set(ck, g); } return g; }
  const ck = ref + '|' + vkey; let g = cache.get(ck); if (!g) { g = symbolGeom(ref, it); cache.set(ck, g); } return g;
}

// ISO 1219-1 symbols that are the same for oil and air: on a pneumatic sheet their ports carry air
export const NEUTRAL = new Set(['cylinder', 'rotary', 'check', 'flow', 'shutoff', 'gauge', 'connection', 'connector']);
export function mediumOf(g: Geom, domain: string, sheetType?: string) {
  if (sheetType && (g.kind === 'std' || g.kind === 'conn') && NEUTRAL.has(g.cls) && (domain === 'hydraulic' || domain === 'pneumatic')) return sheetType === 'pneumatic' ? 'pneumatic' : 'hydraulic';
  return domain;
}
// ---------- instance transforms ----------
export type Xf = { x: number; y: number; rot: number; mirror?: boolean };
export function xfPoint(c: Xf, px: number, py: number): [number, number] {
  let x = c.mirror ? -px : px, y = py; const r = ((c.rot || 0) % 360 + 360) % 360;
  if (r === 90) [x, y] = [-y, x]; else if (r === 180) [x, y] = [-x, -y]; else if (r === 270) [x, y] = [y, -x];
  return [r3(c.x + x), r3(c.y + y)];
}
export const xfDir = (c: Xf, dir: number) => (((c.mirror ? 180 - dir : dir) + (c.rot || 0)) % 360 + 360) % 360;
export const xfAttr = (c: Xf) => `translate(${r3(c.x)} ${r3(c.y)})${c.rot ? ` rotate(${c.rot})` : ''}${c.mirror ? ' scale(-1 1)' : ''}`;
export function xfBB(c: Xf, bb: number[]) {
  const pts = [xfPoint(c, bb[0], bb[1]), xfPoint(c, bb[2], bb[1]), xfPoint(c, bb[2], bb[3]), xfPoint(c, bb[0], bb[3])];
  return [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
}
export function portWorld(c: Xf, p: PortG) { const [x, y] = xfPoint(c, p.x, p.y); return { x, y, dir: xfDir(c, p.dir) }; }
// world point → instance-local point (inverse of xfPoint)
export function invXf(c: Xf, wx: number, wy: number): [number, number] {
  let x = wx - c.x, y = wy - c.y; const r = ((c.rot || 0) % 360 + 360) % 360;
  if (r === 90) [x, y] = [y, -x]; else if (r === 180) [x, y] = [-x, -y]; else if (r === 270) [x, y] = [-y, x];
  return [c.mirror ? -x : x, y];
}
export const invXfAttr = (c: Xf) => `${c.mirror ? 'scale(-1 1) ' : ''}${c.rot ? `rotate(${-c.rot}) ` : ''}translate(${r3(-c.x)} ${r3(-c.y)})`;
