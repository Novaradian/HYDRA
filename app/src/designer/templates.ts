// Custom templates: save any selection (one valve … a whole circuit) to a library kept in this browser;
// placing one inserts an independent copy (new ids, tags renumbered) — editing it never changes the template.
import { signal } from '@preact/signals';
import * as S from '../store';
import { t } from '../i18n';
import { uid, clone, download } from '../util';
import { isAsm } from './geom';
import * as E from './elec';
import * as st from './state';

export const TPL_KEY = 'hydra.templates.v1';
export type Tpl = { id: string; name: string; folder: string; domain: 'hydraulic' | 'pneumatic' | 'electrical'; desc: string; created: string; updated: string; nParts: number; nLines: number; w: number; h: number; data: any };

const load = (): Tpl[] => { try { const a = JSON.parse(localStorage.getItem(TPL_KEY) || '[]'); return Array.isArray(a) ? a.filter(x => x && x.id && x.data) : []; } catch { return []; } };
export const templates = signal<Tpl[]>(load());
function write(a: Tpl[]) { try { localStorage.setItem(TPL_KEY, JSON.stringify(a)); } catch { S.toast(t('Could not save the template library — browser storage is full'), 'err'); return false; } templates.value = a; return true; }
window.addEventListener('storage', e => { if (e.key === TPL_KEY) templates.value = load(); });

const domainOf = (sh: any): Tpl['domain'] => E.isElec(sh) ? 'electrical' : sh.type === 'pneumatic' ? 'pneumatic' : 'hydraulic';
export function bounds(d: any) {
  let b = [1e9, 1e9, -1e9, -1e9]; const add = (x: number, y: number, r = 0) => { b = [Math.min(b[0], x - r), Math.min(b[1], y - r), Math.max(b[2], x + r), Math.max(b[3], y + r)]; };
  (d.comps || []).forEach((c: any) => add(c.x, c.y, 15)); (d.juncs || []).forEach((j: any) => add(j.x, j.y)); (d.pipes || []).forEach((p: any) => (p.pts || []).forEach((q: number[]) => add(q[0], q[1])));
  (d.texts || []).forEach((x: any) => add(x.x, x.y, 5)); (d.encl || []).forEach((e: any) => { add(e.x, e.y); add(e.x + (e.w || 0), e.y + (e.h || 0)); });
  return b[0] > b[2] ? [0, 0, 0, 0] : b;
}
function shift(d: any, dx: number, dy: number) {
  (d.comps || []).forEach((c: any) => { c.x += dx; c.y += dy; }); (d.juncs || []).forEach((j: any) => { j.x += dx; j.y += dy; });
  (d.pipes || []).forEach((p: any) => { p.pts = (p.pts || []).map((q: number[]) => [q[0] + dx, q[1] + dy]); }); (d.texts || []).forEach((x: any) => { x.x += dx; x.y += dy; }); (d.encl || []).forEach((e: any) => { e.x += dx; e.y += dy; });
}
const g5 = (v: number) => Math.round(v / 5) * 5;

/** saves the current selection of a sheet; returns the new template id */
export async function saveSelection(sheetId: string, name?: string) {
  const sh = st.sheetById(sheetId); const ids = st.selIds(sheetId); if (!sh || !ids.length) { S.toast(t('Select the parts and lines to keep as a template first'), 'warn'); return null; }
  const snap: any = st.snapshotIds(sheetId, ids); if (!snap) return null;
  const asm = snap.comps.filter((c: any) => isAsm(c.ref)).length; if (asm) { const gone = new Set(snap.comps.filter((c: any) => isAsm(c.ref)).map((c: any) => c.id)); snap.comps = snap.comps.filter((c: any) => !gone.has(c.id)); snap.pipes = snap.pipes.map((p: any) => ({ ...p, a: p.a && 'c' in p.a && gone.has(p.a.c) ? null : p.a, b: p.b && 'c' in p.b && gone.has(p.b.c) ? null : p.b })); }
  if (!snap.comps.length && !snap.pipes.length) { S.toast(t('Assemblies belong to their project — save the parts inside the assembly sheet as a template instead'), 'warn'); return null; }
  const b = bounds(snap); shift(snap, -g5(b[0]), -g5(b[1])); delete snap.from;
  const guess = snap.comps.length === 1 ? (snap.comps[0].values?.name || snap.comps[0].tag) : `${sh.name} — ${snap.comps.length} ${t('parts')}`;
  const nm = name ?? await S.promptDlg(t('Save as template'), t('Template name (shown in Parts › Templates)'), guess); if (!nm || !nm.trim()) return null;
  const now = new Date().toISOString();
  const tp: Tpl = { id: uid('tpl'), name: nm.trim(), folder: '', domain: domainOf(sh), desc: '', created: now, updated: now, nParts: snap.comps.length, nLines: snap.pipes.length, w: Math.round(b[2] - b[0]), h: Math.round(b[3] - b[1]), data: snap };
  if (!write([...templates.value, tp])) return null;
  S.toast(`${t('Saved template')} “${tp.name}” · ${tp.nParts} ${t('parts')}${tp.nLines ? `, ${tp.nLines} ${t('lines')}` : ''}${asm ? ' · ' + t('assemblies left out') : ''}`, 'ok'); return tp.id;
}

/** inserts a copy centred at (x, y) — or in the middle of the view — and selects it */
export function placeTemplate(sheetId: string, id: string, x?: number, y?: number) {
  const tp = templates.value.find(q => q.id === id); const sh = st.sheetById(sheetId); if (!tp || !sh) return [];
  if (S.readOnly.value || S.editLock.value) { S.toast(S.editLock.value || t('Read-only project'), 'warn'); return []; }
  const dom = domainOf(sh); if ((tp.domain === 'electrical') !== (dom === 'electrical')) { S.toast(tp.domain === 'electrical' ? t('This is an electrical template — open an electric sheet to place it') : t('This is a fluid-power template — open a hydraulic or pneumatic sheet to place it'), 'warn'); return []; }
  if (x == null || y == null) { const o = st.ovState.peek(); if (o && o.sheet === sheetId) { x = (o.sz.w / 2 - o.v.px) / o.v.z; y = (o.sz.h / 2 - o.v.py) / o.v.z; } else { x = 100; y = 100; } }
  const ids = st.insertClip(sheetId, clone(tp.data), g5(x - tp.w / 2), g5(y - tp.h / 2), `Insert template “${tp.name}”`, true);
  if (ids.length) S.toast(`${t('Inserted')} “${tp.name}” — ${t('an independent copy: change its values freely, the saved template stays as it is')}`, 'ok');
  return ids;
}
export async function renameTpl(id: string) { const tp = templates.value.find(q => q.id === id); if (!tp) return; const nm = await S.promptDlg(t('Rename template'), t('Name'), tp.name); if (nm && nm.trim()) write(templates.value.map(q => q.id === id ? { ...q, name: nm.trim(), updated: new Date().toISOString() } : q)); }
export function duplicateTpl(id: string) { const tp = templates.value.find(q => q.id === id); if (tp) write([...templates.value, { ...clone(tp), id: uid('tpl'), name: tp.name + ' ' + t('(copy)') }]); }
export async function deleteTpl(id: string) { const tp = templates.value.find(q => q.id === id); if (!tp) return; const r = await S.confirmDlg(t('Delete template'), `“${tp.name}” ${t('is removed from the library. Circuits where it was placed keep their copies.')}`, [{ label: t('Cancel'), value: 'no' }, { label: t('Delete'), value: 'yes', danger: true, primary: true }]); if (r === 'yes') write(templates.value.filter(q => q.id !== id)); }
export function exportTpl(ids?: string[]) { const list = templates.value.filter(q => !ids || ids.includes(q.id)); if (!list.length) return; download((list.length === 1 ? list[0].name : 'HYDRA templates') + '.hydra-templates.json', JSON.stringify({ format: 'hydra-templates', version: 1, templates: list }, null, 1), 'application/json'); }
export async function importTpl(file: File) {
  try { const j = JSON.parse(await file.text()); const arr: any[] = Array.isArray(j) ? j : j.templates; if (!Array.isArray(arr)) throw 0;
    const ok = arr.filter(x => x && x.data && Array.isArray(x.data.comps) && x.name).map(x => ({ ...x, id: uid('tpl'), folder: x.folder || '', domain: x.domain || 'hydraulic', nParts: x.data.comps.length, nLines: (x.data.pipes || []).length })) as Tpl[];
    if (!ok.length) throw 0; write([...templates.value, ...ok]); S.toast(`${t('Imported')} ${ok.length} ${t('template(s)')}`, 'ok'); }
  catch { S.toast(t('Not a HYDRA template file'), 'err'); }
}
