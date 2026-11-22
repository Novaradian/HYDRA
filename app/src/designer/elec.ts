// Electric Designer: electrical connectivity, wire numbers, cross-reference and the machine tag table.
// Electrical circuits are drawn, not simulated. They link to the hydraulic / pneumatic sheets and the PLC
// through shared tags: a coil tagged 1Y1 is the solenoid 1Y1 of a valve, a contact tagged 1S1 is the pressure switch
// 1S1, a PLC output Q0.0 wired to coil 1Y1 drives that solenoid.
import { geomOf, isConn, isAsm, valveRest, type Geom } from './geom';
import { ZONES, drawArea, paperOf, isInfinite, livePts, endKey, r2, type Sheet, type Comp, type Issue } from './model';

export const isElec = (sh: { type?: string } | null | undefined) => sh?.type === 'electric';
const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const idOf = (g: Geom) => g.item?.id || '';

// ---------- what each electrical part is ----------
export const COIL_IDS = new Set(['e_coil', 'e_sol', 'e_coil_ton', 'e_coil_tof']);
const CONTACT_KIND: Record<string, string> = { e_no: 'NO', e_main_no: 'NO', e_ton_no: 'NO ⏱', e_tof_no: 'NO ⏱', e_nc: 'NC', e_ton_nc: 'NC ⏱', e_tof_nc: 'NC ⏱', e_co: 'CO', e_overload_nc: 'NC' };
export const isRelayContact = (g: Geom) => !!CONTACT_KIND[idOf(g)];
export const POS_SENSORS = new Set(['e_limit', 'e_limit_nc', 'e_prox', 'e_reed', 'e_cap_sensor', 'e_photo']);
const FLUID_SWITCH: Record<string, RegExp> = { e_pswitch: /pswitch|pe_switch|vacswitch/, e_tswitch: /tempswitch|thermo|tempctrl/, e_float: /levelswitch|level/ };
const MOTOR_IDS = new Set(['e_motor3', 'e_motor_dc']);
const PASS_THROUGH = new Set(['e_terminal', 'e_plug']); // same potential on both sides
export const isPlc = (g: Geom) => g.cls === 'plc';
export const isLabel = (g: Geom) => idOf(g) === 'e_label';

// IEC 81346-2 code letters for new electrical parts (relay K, switch S, sensor B, signal H, motor M, protection F/Q, supply G …)
const ELETTER: Record<string, string> = { contact: 'K', coil: 'K', timer: 'K', pushbutton: 'S', switch: 'S', sensor: 'B', lamp: 'H', signal: 'H', motor: 'M', fuse: 'F', breaker: 'Q', overload: 'F', supply: 'G', transformer: 'T', terminal: 'X', connector: 'X', passive: 'R', load: 'E', earth: 'PE', netlabel: 'W' };
const EITEM: Record<string, string> = { e_sol: 'Y', e_isolator: 'Q', e_capacitor: 'C', e_diode: 'V', e_led: 'H', e_overload_nc: 'F' };
export const elecLetter = (it: any) => EITEM[it?.id] || ELETTER[it?.cls] || 'Z';

// ---------- project helpers ----------
export function sheetsInOrder(p: any): string[] { return Object.values(p?.nodes || {}).filter((n: any) => n.type === 'sheet').map((n: any) => n.id); }
// sheets not opened yet (or from older files) may lack arrays or positions: read them safely
const safe = (c: any): Sheet => c.components && c.pipes && c.junctions && !c.components.some((x: any) => !x.id || typeof x.x !== 'number') ? c : { ...c, components: (c.components || []).filter((x: any) => x.id && typeof x.x === 'number'), pipes: c.pipes || [], junctions: c.junctions || [], texts: c.texts || [], enclosures: c.enclosures || [] };
export const elecSheets = (p: any): Sheet[] => sheetsInOrder(p).map(id => p.circuits[id]).filter((c: any) => c && isElec(c)).map(safe);
export const fluidSheets = (p: any): Sheet[] => sheetsInOrder(p).map(id => p.circuits[id]).filter((c: any) => c && !isElec(c)).map(safe);
export const sheetName = (p: any, id: string) => p?.nodes?.[id]?.name || p?.circuits?.[id]?.name || '';
// location in the drawing set: /sheet.column (ISO 5457 zone column), as on DIN / IEC wiring diagrams
export function locOf(p: any, sh: Sheet, x: number) {
  const no = sheetsInOrder(p).indexOf(sh.id) + 1; if (isInfinite(sh)) return `/${no}`;
  const [x0, , x1] = drawArea(sh); const z = ZONES[sh.size] || ZONES.A3; const zc = sh.orient === 'portrait' ? z[1] : z[0];
  const col = Math.max(1, Math.min(zc, Math.floor((x - x0) / ((x1 - x0) / zc)) + 1)); return `/${no}.${col}`;
}

// ---------- valve solenoids on the fluid sheets (their tags are set on the valve: Solenoid a / b tag) ----------
export type SolRef = { tag: string; valve: Comp; side: 'a' | 'b'; sheet: Sheet };
export function solenoidSides(g: Geom): ('a' | 'b')[] {
  const d = g.valve; if (!d) return []; const el = (o: any) => ['solenoid', 'proportional', 'servo'].includes(o.type);
  return [...(d.ops.left.some(el) ? ['a' as const] : []), ...(d.ops.right.some(el) ? ['b' as const] : [])];
}
export function valveSolenoids(p: any): SolRef[] {
  const out: SolRef[] = [];
  fluidSheets(p).forEach(sh => sh.components.forEach(c => { if (isConn(c.ref) || isAsm(c.ref)) return; const g = geomOf(c.ref); solenoidSides(g).forEach(s => { const tg = String(c.values?.['y' + s] || '').trim(); if (tg) out.push({ tag: tg, valve: c, side: s, sheet: sh }); }); }));
  return out;
}
export type FluidRef = { comp: Comp; g: Geom; sheet: Sheet };
export function fluidByTag(p: any) { const m = new Map<string, FluidRef[]>(); fluidSheets(p).forEach(sh => sh.components.forEach(c => { if (isConn(c.ref) || isAsm(c.ref) || !c.tag) return; const g = geomOf(c.ref); (m.get(c.tag) || m.set(c.tag, []).get(c.tag)!).push({ comp: c, g, sheet: sh }); })); return m; }
export type ElRef = { comp: Comp; g: Geom; sheet: Sheet };
export function elecParts(p: any): ElRef[] { const out: ElRef[] = []; elecSheets(p).forEach(sh => sh.components.forEach(c => { if (isConn(c.ref) || isAsm(c.ref)) return; out.push({ comp: c, g: geomOf(c.ref), sheet: sh }); })); return out; }

// ---------- connectivity over every electric sheet (wires, junctions, pass-through terminals, net labels by name) ----------
export type EModel = { netOf: Map<string, string>; netName: Map<string, string>; wireNet: Map<string, string>; members: Map<string, { sheet: Sheet; comp: Comp; port: string }[]> };
const cache = new WeakMap<object, EModel>();
export function emodel(p: any): EModel {
  const key = p?.circuits; if (key && cache.has(key)) return cache.get(key)!;
  const par = new Map<string, string>(); const f = (x: string): string => { let r = par.get(x) ?? x; if (r !== x) { r = f(r); par.set(x, r); } else par.set(x, x); return r; };
  const uni = (a: string, b: string) => { const ra = f(a), rb = f(b); if (ra !== rb) par.set(ra, rb); };
  const labels = new Map<string, string>(); const sheets = elecSheets(p); const pins: [string, Sheet, Comp, string][] = [];
  sheets.forEach(sh => {
    sh.components.forEach(c => { const g = geomOf(c.ref); g.ports.forEach(q => { const k = `${sh.id}|c:${c.id}:${q.key}`; f(k); pins.push([k, sh, c, q.key]); });
      if (PASS_THROUGH.has(idOf(g)) && g.ports.length >= 2) uni(`${sh.id}|c:${c.id}:${g.ports[0].key}`, `${sh.id}|c:${c.id}:${g.ports[1].key}`);
      if (isLabel(g) && g.ports[0]) { const nm = 'L:' + String(c.tag || '').trim().toUpperCase(); if (labels.has(nm)) uni(labels.get(nm)!, `${sh.id}|c:${c.id}:${g.ports[0].key}`); else labels.set(nm, `${sh.id}|c:${c.id}:${g.ports[0].key}`); } });
    sh.pipes.forEach(w => { const a = w.a ? `${sh.id}|${endKey(w.a)}` : `${sh.id}|f:${w.id}:a`, b = w.b ? `${sh.id}|${endKey(w.b)}` : `${sh.id}|f:${w.id}:b`; uni(a, b); par.set(`${sh.id}|w:${w.id}`, f(a)); });
  });
  // names: manual wire number → net label → running number in sheet / reading order
  const netName = new Map<string, string>(); const named = new Set<string>();
  sheets.forEach(sh => { sh.pipes.forEach(w => { const r = f(`${sh.id}|w:${w.id}`); if (w.wno && !netName.has(r)) { netName.set(r, String(w.wno)); named.add(r); } }); });
  sheets.forEach(sh => sh.components.forEach(c => { const g = geomOf(c.ref); if (isLabel(g) && g.ports[0]) { const r = f(`${sh.id}|c:${c.id}:${g.ports[0].key}`); if (!netName.has(r)) { netName.set(r, String(c.tag || '').trim()); named.add(r); } } }));
  let n = 0;
  sheets.forEach(sh => { const order = sh.pipes.map(w => { const pts = livePts(sh, w); return { r: f(`${sh.id}|w:${w.id}`), x: Math.min(...pts.map(q => q[0])), y: Math.min(...pts.map(q => q[1])) }; }).sort((a, b) => (a.x - b.x) || (a.y - b.y));
    order.forEach(o => { if (!netName.has(o.r)) netName.set(o.r, String(++n)); }); });
  const netOf = new Map<string, string>(), wireNet = new Map<string, string>(), members = new Map<string, { sheet: Sheet; comp: Comp; port: string }[]>();
  pins.forEach(([k, sh, c, port]) => { const r = f(k); netOf.set(k, r); (members.get(r) || members.set(r, []).get(r)!).push({ sheet: sh, comp: c, port }); });
  sheets.forEach(sh => sh.pipes.forEach(w => wireNet.set(`${sh.id}|${w.id}`, f(`${sh.id}|w:${w.id}`))));
  const m: EModel = { netOf, netName, wireNet, members }; if (key) cache.set(key, m); return m;
}
export const wireNo = (p: any, sheetId: string, wireId: string) => { const m = emodel(p); const r = m.wireNet.get(`${sheetId}|${wireId}`); return r ? m.netName.get(r) || '' : ''; };
export const pinNet = (p: any, sheetId: string, compId: string, port: string) => emodel(p).netOf.get(`${sheetId}|c:${compId}:${port}`) || '';
export const netLabel = (p: any, net: string) => emodel(p).netName.get(net) || '';

// ---------- links: what an electrical part stands for on the fluid side ----------
export type Link = { text: string; ok: boolean; target?: { sheet: string; comp: string } };
export function linkOf(p: any, e: ElRef, cache2?: { sol: SolRef[]; fl: Map<string, FluidRef[]> }): Link | null {
  const id = idOf(e.g); const tag = String(e.comp.tag || '').trim(); const sol = cache2?.sol || valveSolenoids(p); const fl = cache2?.fl || fluidByTag(p);
  if (id === 'e_sol') { const s = sol.filter(x => x.tag === tag); if (!s.length) return { text: 'no valve solenoid tagged ' + tag, ok: false }; return { text: `${s[0].valve.tag} solenoid ${s[0].side}`, ok: s.length === 1, target: { sheet: s[0].sheet.id, comp: s[0].valve.id } }; }
  if (FLUID_SWITCH[id]) { const d = (fl.get(tag) || []).find(x => FLUID_SWITCH[id].test(idOf(x.g))); return d ? { text: `${d.comp.tag} ${d.g.name.split(',')[0].toLowerCase()}`, ok: true, target: { sheet: d.sheet.id, comp: d.comp.id } } : null; }
  if (MOTOR_IDS.has(id)) { const d = (fl.get(tag) || []).find(x => x.g.cls === 'drive'); return d ? { text: `${d.comp.tag} pump drive`, ok: true, target: { sheet: d.sheet.id, comp: d.comp.id } } : null; }
  if (id === 'e_heater') { const d = (fl.get(tag) || []).find(x => x.g.cls === 'heater'); return d ? { text: `${d.comp.tag} heater`, ok: true, target: { sheet: d.sheet.id, comp: d.comp.id } } : null; }
  if (POS_SENSORS.has(id)) { const w = String(e.comp.values?.watch || '').trim(); if (!w) return null; const d = (fl.get(w) || []).find(x => x.g.cls === 'cylinder' || x.g.cls === 'rotary');
    const end = String(e.comp.values?.wend || 'Extended (+)'); const where = end.startsWith('At') ? ` at ${Math.round((e.comp.values?.wpos || 0) * 1000)} mm` : end.startsWith('Ret') ? '−' : '+';
    return d ? { text: `${w}${where}`, ok: true, target: { sheet: d.sheet.id, comp: d.comp.id } } : { text: `no cylinder ${w}`, ok: false }; }
  return null;
}

// ---------- cross-reference: relay coil ↔ its contacts ----------
export type XContact = { ref: ElRef; kind: string; pins: string; loc: string };
export function xref(p: any) {
  const parts = elecParts(p); const coils = new Map<string, ElRef[]>(); const contacts = new Map<string, XContact[]>();
  parts.forEach(e => { const id = idOf(e.g); const tg = String(e.comp.tag || '').trim(); if (!tg) return;
    if (COIL_IDS.has(id)) (coils.get(tg) || coils.set(tg, []).get(tg)!).push(e);
    else if (CONTACT_KIND[id]) (contacts.get(tg) || contacts.set(tg, []).get(tg)!).push({ ref: e, kind: CONTACT_KIND[id], pins: e.g.ports.map(q => q.name).join('-'), loc: locOf(p, e.sheet, e.comp.x) }); });
  contacts.forEach(l => l.sort((a, b) => a.loc.localeCompare(b.loc, undefined, { numeric: true })));
  return { coils, contacts, parts };
}

// ---------- PLC I/O: what each address is wired to ----------
export type PlcRow = { addr: string; dir: 'in' | 'out'; sym: string; ref: ElRef; devices: { ref: ElRef; link: Link | null }[]; net: string };
export function plcIo(p: any): PlcRow[] {
  const m = emodel(p); const parts = elecParts(p); const sol = valveSolenoids(p), fl = fluidByTag(p); const rows: PlcRow[] = [];
  parts.filter(e => isPlc(e.g)).forEach(e => { const port = e.g.ports[0]?.key; const net = port ? m.netOf.get(`${e.sheet.id}|c:${e.comp.id}:${port}`) || '' : '';
    const devs = (m.members.get(net) || []).filter(x => x.comp.id !== e.comp.id).map(x => ({ sheet: x.sheet, comp: x.comp, g: geomOf(x.comp.ref) })).filter(x => !isLabel(x.g) && !PASS_THROUGH.has(idOf(x.g)) && !isPlc(x.g));
    const seen = new Set<string>(); const devices = devs.filter(x => !seen.has(x.comp.id) && seen.add(x.comp.id)).map(x => ({ ref: x, link: linkOf(p, x, { sol, fl }) }));
    rows.push({ addr: String(e.comp.tag || ''), dir: idOf(e.g) === 'e_plc_in' ? 'in' : 'out', sym: String(e.comp.values?.sym || ''), ref: e, devices, net: m.netName.get(net) || '' }); });
  return rows.sort((a, b) => a.dir.localeCompare(b.dir) || a.addr.localeCompare(b.addr, undefined, { numeric: true }));
}

// ---------- the machine tag table (hydraulic / pneumatic ↔ electrical ↔ PLC) ----------
export type TagRow = { tag: string; fluid: string; elec: string; plc: string; status: 'linked' | 'open' | 'error'; note: string; go?: { sheet: string; comp: string } };
export function machineTags(p: any): TagRow[] {
  const sol = valveSolenoids(p), fl = fluidByTag(p), parts = elecParts(p), io = plcIo(p); const rows: TagRow[] = [];
  const plcFor = (comp: string) => io.filter(r => r.devices.some(d => d.ref.comp.id === comp)).map(r => r.addr).join(', ');
  const elecWith = (tag: string, pred: (e: ElRef) => boolean) => parts.filter(e => String(e.comp.tag).trim() === tag && pred(e));
  // valve solenoids
  sol.forEach(s => { const coils = elecWith(s.tag, e => idOf(e.g) === 'e_sol'); const go = coils[0] ? { sheet: coils[0].sheet.id, comp: coils[0].comp.id } : { sheet: s.sheet.id, comp: s.valve.id };
    rows.push({ tag: s.tag, fluid: `${s.valve.tag} solenoid ${s.side} · ${sheetName(p, s.sheet.id)}`, elec: coils.map(c => `coil ${locOf(p, c.sheet, c.comp.x)}`).join(', '), plc: coils.map(c => plcFor(c.comp.id)).filter(Boolean).join(', '),
      status: coils.length === 1 ? 'linked' : coils.length > 1 ? 'error' : 'open', note: coils.length === 1 ? '' : coils.length > 1 ? 'more than one coil' : 'no coil on an electric sheet yet', go }); });
  const solTags = new Set(sol.map(s => s.tag));
  // electrical parts that stand for a fluid device (switches, motors, heaters, position sensors) and coils without a valve
  parts.forEach(e => { const id = idOf(e.g); const tg = String(e.comp.tag || '').trim(); const lk = linkOf(p, e, { sol, fl });
    if (id === 'e_sol' && !solTags.has(tg)) rows.push({ tag: tg, fluid: '—', elec: `solenoid coil ${locOf(p, e.sheet, e.comp.x)}`, plc: plcFor(e.comp.id), status: 'open', note: 'no valve solenoid has this tag', go: { sheet: e.sheet.id, comp: e.comp.id } });
    else if (lk && id !== 'e_sol') rows.push({ tag: tg, fluid: lk.text, elec: `${e.g.name.split(',')[0]} ${locOf(p, e.sheet, e.comp.x)}`, plc: plcFor(e.comp.id), status: lk.ok ? 'linked' : 'error', note: lk.ok ? '' : lk.text, go: { sheet: e.sheet.id, comp: e.comp.id } }); });
  // fluid interface devices still waiting for their electrical side
  const done = new Set(rows.map(r => r.tag));
  fl.forEach((list, tg) => list.forEach(x => { const id = idOf(x.g); if (done.has(tg)) return; if (x.g.cls === 'drive' && id !== 'h_engine' || /pswitch|tempswitch|levelswitch|pe_switch|vacswitch/.test(id) || x.g.cls === 'heater')
    rows.push({ tag: tg, fluid: `${x.g.name.split(',')[0]} · ${sheetName(p, x.sheet.id)}`, elec: '—', plc: '', status: 'open', note: 'not on an electric sheet yet', go: { sheet: x.sheet.id, comp: x.comp.id } }); }));
  return rows.sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
}

// ---------- rule check for an electric sheet ----------
export function elecRules(sh: Sheet, p: any): Issue[] {
  const out: Issue[] = []; const m = emodel(p); const { coils, contacts } = xref(p); const sol = valveSolenoids(p), fl = fluidByTag(p);
  const G = new Map(sh.components.map(c => [c.id, geomOf(c.ref)]));
  sh.components.forEach(c => { const g = G.get(c.id)!; if (g.kind === 'missing') out.push({ level: 'err', text: `${c.tag}: library part not found (${c.ref})`, ids: [c.id] }); else if (g.domain !== 'electrical') out.push({ level: 'warn', text: `${c.tag} is a ${g.domain} part — place it on a hydraulic or pneumatic sheet`, ids: [c.id] }); });
  // open wire ends
  const open = sh.pipes.filter(w => !w.a || !w.b); if (open.length) out.push({ level: 'warn', text: `${open.length} wire${open.length > 1 ? 's have' : ' has'} an open end`, ids: open.map(w => w.id) });
  // short circuits: two different named potentials on one net, or a supply's + and − on one net
  const nameSets = new Map<string, Set<string>>(); elecSheets(p).forEach(s2 => s2.components.forEach(c => { const g = geomOf(c.ref); if (isLabel(g) && g.ports[0]) { const r = m.netOf.get(`${s2.id}|c:${c.id}:${g.ports[0].key}`)!; (nameSets.get(r) || nameSets.set(r, new Set()).get(r)!).add(String(c.tag).trim()); } }));
  nameSets.forEach((set, r) => { if (set.size > 1 && (m.members.get(r) || []).some(x => x.sheet.id === sh.id)) out.push({ level: 'err', text: `Short circuit: one net joins ${[...set].join(' and ')}`, ids: sh.pipes.filter(w => m.wireNet.get(`${sh.id}|${w.id}`) === r).map(w => w.id) }); });
  sh.components.forEach(c => { const g = G.get(c.id)!; if (g.cls !== 'supply' || g.ports.length < 2) return; const a = m.netOf.get(`${sh.id}|c:${c.id}:${g.ports[0].key}`), b = m.netOf.get(`${sh.id}|c:${c.id}:${g.ports[1].key}`); if (a && a === b && (m.members.get(a) || []).length > 2) out.push({ level: 'err', text: `Short circuit across supply ${c.tag}`, ids: [c.id] }); });
  // coils, contacts, solenoids, sensors
  sh.components.forEach(c => { const g = G.get(c.id)!; const id = idOf(g); const tg = String(c.tag || '').trim();
    if (COIL_IDS.has(id) && (coils.get(tg) || []).length > 1) out.push({ level: 'err', text: `Coil ${tg} exists more than once — each coil needs its own tag`, ids: [c.id] });
    if (CONTACT_KIND[id] && !coils.has(tg) && id !== 'e_overload_nc') out.push({ level: 'warn', text: `Contact ${tg} (${CONTACT_KIND[id]}) has no coil with the same tag`, ids: [c.id] });
    if (id === 'e_sol') { const s = sol.filter(x => x.tag === tg); if (!s.length) out.push({ level: 'warn', text: `Solenoid ${tg}: no valve has a solenoid with this tag (set it on the valve, or pick the valve in Properties)`, ids: [c.id] }); }
    if (POS_SENSORS.has(id)) { const w = String(c.values?.watch || '').trim(); if (!w) out.push({ level: 'info', text: `${tg}: position sensor — choose the cylinder it watches (Properties)`, ids: [c.id] }); else if (!(fl.get(w) || []).some(x => x.g.cls === 'cylinder' || x.g.cls === 'rotary')) out.push({ level: 'warn', text: `${tg} watches ${w}, but there is no cylinder ${w}`, ids: [c.id] }); }
    if (isPlc(g) && !/^[IQ]\d+\.[0-7]$/i.test(tg)) out.push({ level: 'warn', text: `PLC address ${tg} — use the form ${id === 'e_plc_in' ? 'I0.0' : 'Q0.0'} (byte.bit)`, ids: [c.id] }); });
  // duplicate PLC addresses and terminal numbers across the project
  const addr = new Map<string, string[]>(); const term = new Map<string, string[]>();
  elecSheets(p).forEach(s2 => s2.components.forEach(c => { const g = geomOf(c.ref); if (isPlc(g)) (addr.get(c.tag) || addr.set(c.tag, []).get(c.tag)!).push(c.id); if (idOf(g) === 'e_terminal') { const k = `${c.tag}:${c.values?.tno ?? ''}`; (term.get(k) || term.set(k, []).get(k)!).push(c.id); } }));
  addr.forEach((ids, a) => { if (ids.length > 1 && ids.some(i => sh.components.some(c => c.id === i))) out.push({ level: 'err', text: `PLC address ${a} is used ${ids.length} times`, ids: ids.filter(i => sh.components.some(c => c.id === i)) }); });
  term.forEach((ids, k) => { if (ids.length > 1 && ids.some(i => sh.components.some(c => c.id === i))) out.push({ level: 'warn', text: `Terminal ${k} is used ${ids.length} times`, ids: ids.filter(i => sh.components.some(c => c.id === i)) }); });
  const unused = sh.components.filter(c => { const g = G.get(c.id)!; return g.domain === 'electrical' && !isLabel(g) && g.ports.length && g.ports.every(q => !(m.members.get(m.netOf.get(`${sh.id}|c:${c.id}:${q.key}`) || '') || []).some(x => x.comp.id !== c.id) && !sh.pipes.some(w => [w.a, w.b].some(e2 => e2 && 'c' in e2 && e2.c === c.id && e2.p === q.key))); });
  if (unused.length) out.push({ level: 'info', text: `${unused.length} part${unused.length > 1 ? 's are' : ' is'} not wired yet: ${unused.map(c => c.tag).slice(0, 8).join(', ')}${unused.length > 8 ? ' …' : ''}`, ids: unused.map(c => c.id) });
  if (!out.some(i => i.level === 'err' || i.level === 'warn')) out.push({ level: 'ok', text: sh.pipes.length ? 'All wires connected · tags consistent' : 'Nothing wired yet' });
  return out;
}

// ---------- drawing overlay: wire numbers + cross-reference (canvas and every export) ----------
export function overlaySvg(sh: Sheet, p: any, fonts = { ui: 'IBM Plex Sans, Arial, sans-serif', mono: 'JetBrains Mono, Consolas, monospace' }) {
  if (!p || !isElec(sh) || !p.circuits?.[sh.id]) return '';
  let o = ''; const m = emodel(p); const ink = '#1B2633', soft = '#3A4757', acc = '#0A64C2';
  // wire numbers at the middle of each wire's longest segment
  if (sh.wireNos !== false) sh.pipes.forEach(w => { const nm = m.netName.get(m.wireNet.get(`${sh.id}|${w.id}`) || ''); if (!nm) return; const pts = livePts(sh, w); let best = 0, bl = -1; for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); if (l > bl) { bl = l; best = i; } }
    if (bl < 6) return; const a = pts[best], b = pts[best + 1]; const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; const vert = Math.abs(a[0] - b[0]) < 1e-6;
    o += vert ? `<text x="${r2(mx + 0.9)}" y="${r2(my + 0.9)}" font-size="2.2" fill="${soft}" font-family="${fonts.mono}">${esc(nm)}</text>` : `<text x="${r2(mx)}" y="${r2(my - 0.9)}" font-size="2.2" text-anchor="middle" fill="${soft}" font-family="${fonts.mono}">${esc(nm)}</text>`; });
  const { coils, contacts } = xref(p); const sol = valveSolenoids(p), fl = fluidByTag(p);
  sh.components.forEach(c => { const g = geomOf(c.ref); const id = idOf(g); const tg = String(c.tag || '').trim(); const b = bbOf(c, g); if (!b) return;
    // under a coil: its contact map (kind, terminals, location)
    if (COIL_IDS.has(id)) { const list = contacts.get(tg) || []; list.slice(0, 12).forEach((x, i) => { o += `<text x="${r2(b[2] + 2.5)}" y="${r2(b[1] + 10.6 + i * 2.6)}" font-size="2.1" text-anchor="start" fill="${ink}" font-family="${fonts.mono}">${esc(x.kind)} ${esc(x.pins)} ${esc(x.loc)}</text>`; }); }
    // at a contact: where its coil is
    if (CONTACT_KIND[id]) { const co = coils.get(tg)?.[0]; if (co) o += `<text x="${r2(b[0] - 1)}" y="${r2((b[1] + b[3]) / 2 + 0.8)}" font-size="2.1" text-anchor="end" fill="${acc}" font-family="${fonts.mono}">${esc(locOf(p, co.sheet, co.comp.x))}</text>`; }
    // link to the fluid side
    const lk = linkOf(p, { comp: c, g, sheet: sh }, { sol, fl });
    if (lk) o += `<text x="${r2((b[0] + b[2]) / 2)}" y="${r2(COIL_IDS.has(id) ? b[1] - 1.4 : b[3] + 3.2)}" font-size="2.1" text-anchor="middle" fill="${lk.ok ? acc : '#B45309'}" font-family="${fonts.mono}">→ ${esc(lk.text)}</text>`; });
  return o;
}
function bbOf(c: Comp, g: Geom) { const [x0, y0, x1, y1] = g.bb; const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => { const xm = c.mirror ? -x : x; const r = (c.rot || 0) * Math.PI / 180; return [c.x + xm * Math.cos(r) - y * Math.sin(r), c.y + xm * Math.sin(r) + y * Math.cos(r)]; }); return [Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))]; }

// ---------- new tags on an electric sheet ----------
export function newElecTag(p: any, sh: Sheet, g: Geom, taken: Set<string>): { tag: string; values?: Record<string, any>; labelPos?: Comp['labelPos'] } {
  const id = idOf(g);
  if (isPlc(g)) { const pre = id === 'e_plc_in' ? 'I' : 'Q'; for (let i = 0; i < 4096; i++) { const a = `${pre}${Math.floor(i / 8)}.${i % 8}`; if (!taken.has(a)) return { tag: a }; } }
  if (g.cls === 'earth') return { tag: 'PE', labelPos: 'hidden' };
  if (isLabel(g)) { for (const nm of ['+24V', '0V']) if (!sh.components.some(c => c.tag === nm && isLabel(geomOf(c.ref)))) return { tag: nm }; let n = 1; while (taken.has('W' + n)) n++; return { tag: 'W' + n }; }
  if (id === 'e_terminal') { const strips = elecParts(p).filter(e => idOf(e.g) === 'e_terminal'); const strip = strips.length ? String(strips[strips.length - 1].comp.tag) : 'X1'; const nos = strips.filter(e => e.comp.tag === strip).map(e => +(e.comp.values?.tno || 0)); return { tag: strip, values: { tno: String((nos.length ? Math.max(...nos) : 0) + 1) } }; }
  const L = elecLetter(g.item); const cn = sh.circuitNo || 1; let n = 1; while (taken.has(`${cn}${L}${n}`)) n++; return { tag: `${cn}${L}${n}` };
}
// renumber in reading order per code letter; contacts follow their coil, linked parts (solenoids, switches, motors) keep their tags
export function renumberElec(c: Sheet, p: any) {
  const sol = valveSolenoids(p), fl = fluidByTag(p); const cn = c.circuitNo || 1;
  const fixed = (x: Comp) => { const g = geomOf(x.ref); const id = idOf(g); return isPlc(g) || isLabel(g) || g.cls === 'earth' || id === 'e_terminal' || !!CONTACT_KIND[id] || !!linkOf(p, { comp: x, g, sheet: c }, { sol, fl }) || id === 'e_sol'; };
  const taken = projectTags({ circuits: Object.fromEntries(Object.entries(p?.circuits || {}).filter(([k]) => k !== c.id)) }); c.components.filter(fixed).forEach(x => taken.add(x.tag));
  const groups: Record<string, Comp[]> = {}; c.components.filter(x => !isConn(x.ref) && !isAsm(x.ref) && !fixed(x)).forEach(x => { const L = geomOf(x.ref).letter; (groups[L] ||= []).push(x); });
  const ren = new Map<string, string>();
  Object.entries(groups).forEach(([L, list]) => { let n = 1; list.sort((a, b) => (a.x - b.x) || (a.y - b.y)).forEach(x => { while (taken.has(`${cn}${L}${n}`)) n++; const nt = `${cn}${L}${n}`; taken.add(nt); if (COIL_IDS.has(idOf(geomOf(x.ref)))) ren.set(x.tag, nt); x.tag = nt; }); });
  c.components.forEach(x => { if (CONTACT_KIND[idOf(geomOf(x.ref))] && ren.has(x.tag)) x.tag = ren.get(x.tag)!; });
}
export const projectTags = (p: any) => { const s = new Set<string>(); Object.values(p?.circuits || {}).forEach((c: any) => (c.components || []).forEach((x: any) => x.tag && s.add(x.tag))); return s; };

// ---------- documents ----------
const csv = (rows: (string | number)[][]) => rows.map(r => r.map(x => { const s = String(x ?? ''); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
const pinName = (c: Comp, port: string) => geomOf(c.ref).ports.find(q => q.key === port)?.name ?? port;
const endTxt = (sh: Sheet, e: any) => { if (!e) return '(open)'; if ('j' in e) return 'junction'; const c = sh.components.find(x => x.id === e.c); if (!c) return '?'; const g = geomOf(c.ref); return idOf(g) === 'e_terminal' ? `${c.tag}:${c.values?.tno ?? ''}` : `${c.tag}:${pinName(c, e.p)}`; };
export function wireListCsv(p: any) {
  const rows: (string | number)[][] = [['Wire no.', 'Sheet', 'From', 'To', 'Type', 'Location']];
  elecSheets(p).forEach(sh => sh.pipes.forEach(w => { const pts = livePts(sh, w); rows.push([wireNo(p, sh.id, w.id), sheetName(p, sh.id), endTxt(sh, w.a), endTxt(sh, w.b), w.kind === 'power' ? 'Power' : w.kind === 'pe' ? 'PE' : 'Control', locOf(p, sh, pts[0][0])]); }));
  return csv(rows);
}
export function terminalPlanCsv(p: any) {
  const m = emodel(p); const rows: (string | number)[][] = [['Strip', 'Terminal', 'Wire no.', 'Inside (top)', 'Outside (bottom)', 'Location']];
  const list = elecParts(p).filter(e => idOf(e.g) === 'e_terminal').sort((a, b) => String(a.comp.tag).localeCompare(String(b.comp.tag), undefined, { numeric: true }) || (+(a.comp.values?.tno || 0) - +(b.comp.values?.tno || 0)));
  const side = (e: ElRef, port: string) => { const sh = e.sheet; const w = sh.pipes.filter(x => [x.a, x.b].some(q => q && 'c' in q && q.c === e.comp.id && q.p === port)); return w.map(x => { const other = x.a && 'c' in x.a && x.a.c === e.comp.id ? x.b : x.a; return endTxt(sh, other); }).join(' / '); };
  list.forEach(e => { const k1 = e.g.ports[0]?.key, k2 = e.g.ports[1]?.key; rows.push([e.comp.tag, e.comp.values?.tno ?? '', m.netName.get(m.netOf.get(`${e.sheet.id}|c:${e.comp.id}:${k1}`) || '') || '', side(e, k1), side(e, k2), locOf(p, e.sheet, e.comp.x)]); });
  return csv(rows);
}
export function plcIoCsv(p: any) { const rows: (string | number)[][] = [['Address', 'Direction', 'Symbol', 'Wire no.', 'Device', 'Machine function', 'Location']];
  plcIo(p).forEach(r => rows.push([r.addr, r.dir === 'in' ? 'Input' : 'Output', r.sym, r.net, r.devices.map(d => d.ref.comp.tag).join(' / '), r.devices.map(d => d.link?.text || '').filter(Boolean).join(' / '), locOf(p, r.ref.sheet, r.ref.comp.x)])); return csv(rows); }
export function machineTagsCsv(p: any) { const rows: (string | number)[][] = [['Tag', 'Hydraulic / pneumatic', 'Electrical', 'PLC', 'Status', 'Note']]; machineTags(p).forEach(r => rows.push([r.tag, r.fluid, r.elec, r.plc, r.status, r.note])); return csv(rows); }
// machine tag table as data for the PLC / controller: address → device → machine function
export function machineLinks(p: any) {
  return { schema: 'hydra.machine-links/1', generated: new Date().toISOString(),
    io: plcIo(p).map(r => ({ address: r.addr, dir: r.dir, symbol: r.sym, wire: r.net, devices: r.devices.map(d => ({ tag: d.ref.comp.tag, part: d.ref.g.item?.id, link: d.link?.target ? { sheet: d.link.target.sheet, comp: d.link.target.comp, text: d.link.text } : null })) })),
    solenoids: valveSolenoids(p).map(s => ({ tag: s.tag, valve: s.valve.tag, side: s.side, sheet: s.sheet.id, rest: valveRest(geomOf(s.valve.ref).valve) })),
    tags: machineTags(p) };
}
export { paperOf };
