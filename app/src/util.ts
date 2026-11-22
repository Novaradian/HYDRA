// Small shared helpers
let _n = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${(_n++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
export const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const nowIso = () => new Date().toISOString();
export const fmtDate = (iso: string) => { try { const d = new Date(iso); return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };
export const fmtTime = (iso: string) => { try { return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };
export const slug = (s: string) => String(s || '').trim().replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'untitled';
export function round(v: number, sig = 4) { if (!isFinite(v)) return '—'; if (v === 0) return '0'; const d = Math.max(0, sig - 1 - Math.floor(Math.log10(Math.abs(v)))); return (+v.toFixed(Math.min(d, 6))).toString(); }
export function debounce<F extends (...a: any[]) => void>(fn: F, ms: number) { let t: any; return (...a: Parameters<F>) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function download(name: string, data: Blob | string, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}
export function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple; i.style.display = 'none';
    i.onchange = () => { res([...(i.files || [])]); i.remove(); };
    document.body.appendChild(i); i.click();
  });
}
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export function prettyKeys(k?: string) { if (!k) return ''; return k.split(',')[0].split('+').map(p => ({ ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', del: 'Del', delete: 'Del', '=': '=', '-': '−' }[p] || (p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)))).join('+'); }
