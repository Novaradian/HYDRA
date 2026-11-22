// Logic Coder: the I/O tag table — every signal a program can read or write, taken from the project's sheets.
// Each signal has a hidden permanent ID (built from the part's own ID, which never changes) and the friendly tag the
// user sees. Blocks store the hidden ID, so renaming a tag or re-addressing a PLC point never breaks a program.
//   plc:<part>          PLC digital input / output drawn on an electric sheet (address = its tag, e.g. I0.0)
//   sol:<valve>:<a|b>   valve solenoid driven straight from the program (hydraulic + PLC, no electric sheet needed)
//   drv:<motor>         pump drive motor (on / off)
//   psw:<part>          pressure / level / temperature switch on a fluid sheet
//   cyl:<cylinder>      cylinder or rotary actuator: end positions (+ / −), position and speed
//   pg:<part>           pressure gauge / transducer reading
//   prop:<valve>:<a|b>  proportional solenoid command (%)   disp:<pump> variable pump displacement (%)
import { geomOf, isConn, isAsm, type Geom } from '../designer/geom';
import * as E from '../designer/elec';

export type SigDir = 'in' | 'out' | 'ain' | 'aout';
export type Sig = { id: string; tag: string; addr: string; dir: SigDir; desc: string; unit?: string; src: string; go?: { sheet: string; comp: string }; estop?: boolean; nc?: boolean };
export type Cyl = { id: string; tag: string; desc: string; stroke: number; go?: { sheet: string; comp: string } };
export type SigTable = { sigs: Sig[]; byId: Map<string, Sig>; cyls: Cyl[]; cylById: Map<string, Cyl> };

const idOf = (g: Geom) => g.item?.id || '';
const SWITCH_RE = /pswitch|pe_switch|vacswitch|tempswitch|levelswitch/;
const GAUGE_RE = /gauge|ptrans|transduc|psensor/;
const isEstopDev = (g: Geom) => /estop|e_stop|emergency/i.test(idOf(g) + ' ' + g.name);
const short = (s: string) => s.split(',')[0];

const cache = new WeakMap<object, SigTable>();
export function signals(p: any): SigTable {
  const k = p?.circuits; if (k && cache.has(k)) return cache.get(k)!;
  const sigs: Sig[] = []; const cyls: Cyl[] = [];
  if (p) {
    const io = E.plcIo(p); const sol = E.valveSolenoids(p);
    const viaPlc = new Set<string>(); // valve:side and motor ids already reached through a PLC output
    io.forEach(r => {
      const devs = r.devices.filter(d => d.ref.g.domain === 'electrical');
      const main = devs[0]; const dtag = main ? String(main.ref.comp.tag || '').trim() : '';
      const what = devs.map(d => { const lk = d.link; const nm = short(d.ref.g.name).toLowerCase(); return `${d.ref.comp.tag} ${lk?.text ? '→ ' + lk.text : nm}`; }).join(' · ');
      devs.forEach(d => { const id = idOf(d.ref.g); const tg = String(d.ref.comp.tag || '').trim();
        if (id === 'e_sol') sol.filter(s => s.tag === tg).forEach(s => viaPlc.add(s.valve.id + ':' + s.side));
        if (d.link?.target && /pump drive|motor/i.test(d.link.text)) viaPlc.add(d.link.target.comp); });
      const es = r.dir === 'in' && devs.some(d => isEstopDev(d.ref.g));
      sigs.push({ id: 'plc:' + r.ref.comp.id, tag: dtag || r.sym || r.addr, addr: r.addr, dir: r.dir, desc: [r.sym, what].filter(Boolean).join(' · ') || (r.dir === 'in' ? 'PLC input' : 'PLC output'), src: 'plc', go: { sheet: r.ref.sheet.id, comp: r.ref.comp.id }, estop: es || undefined, nc: es || undefined });
    });
    E.fluidSheets(p).forEach(sh => sh.components.forEach(c => {
      if (isConn(c.ref) || isAsm(c.ref)) return; const g = geomOf(c.ref); const id = idOf(g); const go = { sheet: sh.id, comp: c.id }; const tag = String(c.tag || '').trim();
      // solenoids not wired through a PLC output: the program drives them directly
      E.solenoidSides(g).forEach(s => { const prop = [...(s === 'a' ? g.valve.ops.left : g.valve.ops.right)].some((o: any) => o.type === 'proportional' || o.type === 'servo');
        const st = String(c.values?.['y' + s] || '').trim();
        if (prop) sigs.push({ id: `prop:${c.id}:${s}`, tag: (st || tag + s) + ' %', addr: '', dir: 'aout', desc: `${tag} proportional solenoid ${s}`, unit: '%', src: 'prop', go });
        else if (!viaPlc.has(c.id + ':' + s)) sigs.push({ id: `sol:${c.id}:${s}`, tag: st || `${tag}·${s}`, addr: '', dir: 'out', desc: `${tag} solenoid ${s}${st ? '' : ' (no solenoid tag yet)'}`, src: 'sol', go }); });
      if (g.cls === 'drive' && id !== 'h_engine' && !viaPlc.has(c.id)) sigs.push({ id: 'drv:' + c.id, tag, addr: '', dir: 'out', desc: `${short(g.name)} — pump drive on`, src: 'drv', go });
      if (SWITCH_RE.test(id)) sigs.push({ id: 'psw:' + c.id, tag, addr: '', dir: 'in', desc: short(g.name), src: 'psw', go });
      if (GAUGE_RE.test(id) || g.cls === 'gauge') sigs.push({ id: 'pg:' + c.id, tag: tag + ' p', addr: '', dir: 'ain', desc: `${tag} ${short(g.name).toLowerCase()}`, unit: 'bar', src: 'pg', go });
      if (g.cls === 'pump' && /var/.test(id)) sigs.push({ id: 'disp:' + c.id, tag: tag + ' disp', addr: '', dir: 'aout', desc: `${tag} displacement`, unit: '%', src: 'disp', go });
      if (g.cls === 'cylinder' || g.cls === 'rotary') {
        const stroke = +(c.values?.stroke ?? 0.2) || 0.2;
        cyls.push({ id: 'cyl:' + c.id, tag, desc: short(g.name), stroke, go });
        sigs.push({ id: 'pos:' + c.id, tag: tag + ' pos', addr: '', dir: 'ain', desc: `${tag} position`, unit: 'mm', src: 'pos', go });
        sigs.push({ id: 'vel:' + c.id, tag: tag + ' speed', addr: '', dir: 'ain', desc: `${tag} speed`, unit: 'mm/s', src: 'vel', go });
      }
    }));
  }
  const ord = (s: Sig) => (s.src === 'plc' ? 0 : 1);
  sigs.sort((a, b) => a.dir.localeCompare(b.dir) || ord(a) - ord(b) || (a.addr || a.tag).localeCompare(b.addr || b.tag, undefined, { numeric: true }));
  cyls.sort((a, b) => a.tag.localeCompare(b.tag, undefined, { numeric: true }));
  const t: SigTable = { sigs, byId: new Map(sigs.map(s => [s.id, s])), cyls, cylById: new Map(cyls.map(c => [c.id, c])) };
  if (k) cache.set(k, t); return t;
}
export const sigLabel = (s: Sig) => s.addr ? `${s.tag} · ${s.addr}` : s.tag;
// what the dropdowns of each kind list
export function options(t: SigTable, kind: 'din' | 'dout' | 'ain' | 'aout' | 'cyl'): [string, string][] {
  if (kind === 'cyl') return t.cyls.map(c => [c.tag, c.id]);
  const dir = { din: 'in', dout: 'out', ain: 'ain', aout: 'aout' }[kind];
  return t.sigs.filter(s => s.dir === dir).map(s => [sigLabel(s), s.id]);
}
