// Persistent browser storage (IndexedDB through Dexie). Falls back to localStorage + memory if IndexedDB is blocked.
import Dexie from 'dexie';

class HydraDB extends Dexie {
  kv!: Dexie.Table<{ key: string; value: any }, string>;
  recents!: Dexie.Table<any, string>;
  checkpoints!: Dexie.Table<any, number>;
  recovery!: Dexie.Table<any, string>;
  constructor() {
    super('hydra-home');
    this.version(1).stores({ kv: 'key', recents: 'id, date', checkpoints: '++cid, projectId, date', recovery: 'key' });
  }
}
let db: HydraDB | null = null;
let ok = false;
const mem: Record<string, any> = {};
const LS = 'hydra.kv.';

export async function openDB() {
  try { db = new HydraDB(); await db.open(); ok = true; } catch (e) { console.warn('IndexedDB unavailable, using localStorage', e); ok = false; }
  return ok;
}
export const dbOk = () => ok;
export async function kvGet<T = any>(key: string, def: T): Promise<T> {
  if (ok) { try { const r = await db!.kv.get(key); return r ? r.value : def; } catch { } }
  try { const s = localStorage.getItem(LS + key); return s ? JSON.parse(s) : (key in mem ? mem[key] : def); } catch { return key in mem ? mem[key] : def; }
}
export async function kvSet(key: string, value: any) {
  if (ok) { try { await db!.kv.put({ key, value }); return; } catch { } }
  mem[key] = value; try { localStorage.setItem(LS + key, JSON.stringify(value)); } catch { }
}
// tables that only exist with IndexedDB degrade to in-memory arrays
const memT: Record<string, any[]> = { recents: [], checkpoints: [], recovery: [] };
export const recentsT = {
  all: async () => ok ? (await db!.recents.toArray()) : memT.recents.slice(),
  put: async (r: any) => { if (ok) await db!.recents.put(r); else { memT.recents = memT.recents.filter(x => x.id !== r.id); memT.recents.push(r); } },
  del: async (id: string) => { if (ok) await db!.recents.delete(id); else memT.recents = memT.recents.filter(x => x.id !== id); }
};
export const checkpointsT = {
  of: async (pid: string) => ok ? (await db!.checkpoints.where('projectId').equals(pid).toArray()) : memT.checkpoints.filter(x => x.projectId === pid),
  add: async (c: any) => { if (ok) await db!.checkpoints.add(c); else { c.cid = Date.now(); memT.checkpoints.push(c); } },
  del: async (cid: number) => { if (ok) await db!.checkpoints.delete(cid); else memT.checkpoints = memT.checkpoints.filter(x => x.cid !== cid); },
  get: async (cid: number) => ok ? db!.checkpoints.get(cid) : memT.checkpoints.find(x => x.cid === cid)
};
// one recovery copy per open project (key = projectId)
export const recoveryT = {
  all: async (): Promise<any[]> => ok ? db!.recovery.toArray() : memT.recovery.slice(),
  put: async (r: any) => { r.key = r.projectId || 'current'; if (ok) await db!.recovery.put(r); else { memT.recovery = memT.recovery.filter(x => x.key !== r.key); memT.recovery.push(r); } },
  del: async (key: string) => { if (ok) await db!.recovery.delete(key); else memT.recovery = memT.recovery.filter(x => x.key !== key); },
  clear: async () => { if (ok) await db!.recovery.clear(); else memT.recovery = []; }
};
