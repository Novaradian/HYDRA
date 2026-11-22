// Unit tables: every unit converts to an SI base (Pa, m3/s, N, m, m3, K, m2, m/s, m3/rev, rpm-as-is)
export type Qty = 'pressure' | 'flow' | 'force' | 'length' | 'volume' | 'temperature' | 'area' | 'speed' | 'displacement' | 'rotation' | 'power' | 'torque' | 'viscosity' | 'density' | 'time' | 'percent' | 'voltage' | 'current' | 'mass' | 'angle' | 'none';
type U = { f?: number; to?: (v: number) => number; from?: (v: number) => number };
export const UNITS: Record<string, Record<string, U>> = {
  pressure: { Pa: { f: 1 }, kPa: { f: 1e3 }, MPa: { f: 1e6 }, bar: { f: 1e5 }, psi: { f: 6894.757293 }, atm: { f: 101325 } },
  flow: { 'L/min': { f: 1e-3 / 60 }, 'm³/s': { f: 1 }, 'm³/h': { f: 1 / 3600 }, 'cm³/s': { f: 1e-6 }, 'gpm (US)': { f: 3.785411784e-3 / 60 } },
  force: { N: { f: 1 }, kN: { f: 1e3 }, lbf: { f: 4.4482216153 }, kgf: { f: 9.80665 } },
  length: { mm: { f: 1e-3 }, cm: { f: 1e-2 }, m: { f: 1 }, in: { f: 0.0254 }, ft: { f: 0.3048 } },
  volume: { L: { f: 1e-3 }, mL: { f: 1e-6 }, 'cm³': { f: 1e-6 }, 'm³': { f: 1 }, 'gal (US)': { f: 3.785411784e-3 }, 'in³': { f: 1.6387064e-5 } },
  temperature: { '°C': { to: v => v + 273.15, from: v => v - 273.15 }, '°F': { to: v => (v - 32) * 5 / 9 + 273.15, from: v => (v - 273.15) * 9 / 5 + 32 }, K: { f: 1 } },
  area: { 'mm²': { f: 1e-6 }, 'cm²': { f: 1e-4 }, 'm²': { f: 1 }, 'in²': { f: 6.4516e-4 } },
  speed: { 'm/s': { f: 1 }, 'mm/s': { f: 1e-3 }, 'm/min': { f: 1 / 60 }, 'ft/s': { f: 0.3048 }, 'in/s': { f: 0.0254 } },
  displacement: { 'cm³/rev': { f: 1e-6 }, 'in³/rev': { f: 1.6387064e-5 } },
  rotation: { rpm: { f: 1 } },
  power: { W: { f: 1 }, kW: { f: 1e3 }, hp: { f: 745.6998716 } },
  torque: { 'N·m': { f: 1 }, 'lbf·ft': { f: 1.3558179483 } },
  viscosity: { cSt: { f: 1e-6 }, 'mm²/s': { f: 1e-6 }, 'm²/s': { f: 1 } },
  density: { 'kg/m³': { f: 1 }, 'g/cm³': { f: 1e3 }, 'lb/ft³': { f: 16.01846337 } },
  time: { s: { f: 1 }, ms: { f: 1e-3 } },
  percent: { '%': { f: 1 } }, mass: { kg: { f: 1 }, g: { f: 1e-3 }, t: { f: 1e3 }, lb: { f: 0.45359237 } }, angle: { '°': { f: 1 } }, voltage: { V: { f: 1 } }, current: { A: { f: 1 }, mA: { f: 1e-3 } }, none: { '': { f: 1 } }
};
export const toBase = (q: string, u: string, v: number) => { const x = UNITS[q]?.[u]; if (!x) return v; return x.to ? x.to(v) : v * (x.f as number); };
export const fromBase = (q: string, u: string, v: number) => { const x = UNITS[q]?.[u]; if (!x) return v; return x.from ? x.from(v) : v / (x.f as number); };
export const convert = (q: string, from: string, to: string, v: number) => fromBase(q, to, toBase(q, from, v));
export type UnitSystem = 'SI' | 'SI-bar' | 'Imperial';
export const SYSTEMS: Record<UnitSystem, Partial<Record<Qty, string>>> = {
  'SI': { pressure: 'MPa', flow: 'L/min', force: 'kN', length: 'mm', volume: 'L', temperature: '°C', area: 'cm²', speed: 'm/s', displacement: 'cm³/rev', power: 'kW', torque: 'N·m', viscosity: 'cSt', density: 'kg/m³', mass: 'kg' },
  'SI-bar': { pressure: 'bar', flow: 'L/min', force: 'kN', length: 'mm', volume: 'L', temperature: '°C', area: 'cm²', speed: 'm/s', displacement: 'cm³/rev', power: 'kW', torque: 'N·m', viscosity: 'cSt', density: 'kg/m³', mass: 'kg' },
  'Imperial': { pressure: 'psi', flow: 'gpm (US)', force: 'lbf', length: 'in', volume: 'gal (US)', temperature: '°F', area: 'in²', speed: 'in/s', displacement: 'in³/rev', power: 'hp', torque: 'lbf·ft', viscosity: 'cSt', density: 'lb/ft³', mass: 'lb' }
};
export const unitFor = (sys: UnitSystem, q: Qty) => SYSTEMS[sys]?.[q] || Object.keys(UNITS[q] || { '': 1 })[0];
