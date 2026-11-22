// HYDRA launcher (HYDRA.bat → launcher/hydra-server.ps1): when HYDRA is served from http://localhost the app gets a
// real project folder (Documents\HYDRA\projects, autosave, backups), the samples folder, install-as-app (PWA) and its
// own browser storage. Opened as a file (HYDRA.html) nothing here is active and everything works as before.
import { signal } from '@preact/signals';

export type SrvInfo = { ok: boolean; launcher: number; port: number; root: string; home: string; projects: string; autosave: string; backups: string; samples: string; keep: number };
export type SrvFile = { name: string; size: number; mtime: string };
export type Area = 'projects' | 'autosave' | 'backups' | 'samples';
export const LX = signal<SrvInfo | null>(null);
export const served = () => /^https?:$/.test(location.protocol);
const KEY = 'hydra.launcherKey';
let key = '';

// HYDRA.exe (Tauri): the same project-folder API, answered by native commands instead of the PowerShell server
const tauri = (): any => (window as any).__TAURI__?.core;
export const isDesktop = () => !!tauri();
const bytesBlob = (x: any) => new Blob([x instanceof ArrayBuffer ? x : new Uint8Array(x)]);

export async function initLauncher(): Promise<boolean> {
  if (tauri()) { try { LX.value = await tauri().invoke('hydra_info'); } catch (e) { console.warn('HYDRA desktop: ' + e); return false; } return true; }
  if (!served()) return false;
  try { const m = /[#&]k=([0-9a-f]{32,})/i.exec(location.hash); if (m) { key = m[1]; localStorage.setItem(KEY, key); history.replaceState(null, '', location.pathname + location.search); } else key = localStorage.getItem(KEY) || ''; } catch { }
  registerPwa();
  if (!key) return false;
  try { const r = await api('/api/info'); if (!r.ok) return false; LX.value = await r.json(); } catch { return false; }
  setInterval(() => { api('/api/ping', { method: 'POST' }).catch(() => { }); }, 15000);
  return true;
}
function api(path: string, init: RequestInit = {}) { return fetch(path, { ...init, cache: 'no-store', headers: { ...(init.headers || {}), 'X-HYDRA-Key': key } }); }
const q = (area: Area, name?: string) => `area=${encodeURIComponent(area)}${name ? '&name=' + encodeURIComponent(name) : ''}`;
async function ok(r: Response) { if (!r.ok) { let e = r.statusText; try { e = (await r.json()).error || e; } catch { } throw new Error(`HYDRA server: ${e} (${r.status})`); } return r; }

export async function listFiles(area: Area): Promise<SrvFile[]> { if (tauri()) return tauri().invoke('hydra_list', { area }); const r = await ok(await api('/api/list?' + q(area))); return (await r.json()).files || []; }
export async function readFile(area: Area, name: string): Promise<Blob> { if (tauri()) return bytesBlob(await tauri().invoke('hydra_read', { area, name })); return (await ok(await api('/api/file?' + q(area, name)))).blob(); }
export async function writeFile(area: Area, name: string, blob: Blob): Promise<{ path: string; backup: string | null }> {
  if (tauri()) return tauri().invoke('hydra_write', new Uint8Array(await blob.arrayBuffer()), { headers: { area, name } });
  const r = await ok(await api('/api/file?' + q(area, name), { method: 'PUT', body: blob })); return r.json(); }
export async function deleteFile(area: Area, name: string) { if (tauri()) return tauri().invoke('hydra_delete', { area, name }); await ok(await api('/api/file?' + q(area, name), { method: 'DELETE' })); }
export async function reveal(area: Area) { if (tauri()) return tauri().invoke('hydra_reveal', { area }); await api('/api/reveal?' + q(area), { method: 'POST' }); }
/** HYDRA.exe started by double-clicking a .hydra file: that file */
export async function startupFile(): Promise<{ name: string; blob: Blob } | null> {
  if (!tauri()) return null; try { const name = await tauri().invoke('hydra_startup_name'); if (!name) return null; return { name, blob: bytesBlob(await tauri().invoke('hydra_startup_read')) }; } catch { return null; } }
export const safeName = (s: string) => { let n = String(s || '').trim().replace(/[^\w\-. ()+]+/g, '_').replace(/\.{2,}/g, '.').replace(/^[^\w]+/, ''); if (!n) n = 'project'; if (!/\.(hydra|json)$/i.test(n)) n += '.hydra'; return n.slice(0, 140); };

// a file in the project folder that behaves like a File System Access handle, so save / open / recents need no changes
export function srvHandle(area: Area, name: string): any {
  return {
    kind: 'file', name, srv: { area, name },
    getFile: async () => new File([await readFile(area, name)], name),
    createWritable: async () => { const parts: BlobPart[] = []; return { write: async (b: BlobPart) => { parts.push(b); }, close: async () => { await writeFile(area, name, new Blob(parts, { type: 'application/zip' })); } }; },
    queryPermission: async () => 'granted', requestPermission: async () => 'granted'
  };
}
export const isSrvHandle = (h: any) => !!h?.srv;
/** recents keep the handle in IndexedDB: store the plain reference, rebuild the handle when it is used */
export const plainHandle = (h: any) => h?.srv ? { srv: { ...h.srv }, name: h.name } : h;
export const liveHandle = (h: any) => h?.srv && !h.getFile ? srvHandle(h.srv.area, h.srv.name) : h;

// ---------- install as app ----------
function registerPwa() {
  try {
    if (!document.querySelector('link[rel=manifest]')) { const l = document.createElement('link'); l.rel = 'manifest'; l.href = 'manifest.webmanifest'; document.head.appendChild(l); }
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
  } catch { }
}
let deferred: any = null;
export const canInstall = signal(false);
if (typeof window !== 'undefined') window.addEventListener('beforeinstallprompt', (e: any) => { e.preventDefault(); deferred = e; canInstall.value = true; });
export async function installApp() { if (!deferred) return false; deferred.prompt(); const r = await deferred.userChoice.catch(() => null); deferred = null; canInstall.value = false; return r?.outcome === 'accepted'; }
