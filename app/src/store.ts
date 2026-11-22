// Application state (Preact signals) + project mutations with undo/redo (Immer patches)
import { signal, computed, batch } from '@preact/signals';
import { produceWithPatches, applyPatches, enablePatches, type Patch } from 'immer';
import { uid, nowIso, clone } from './util';
import { kvGet, kvSet } from './db';
import type { UnitSystem } from './units';
import { newProgram } from './plc/compile';
enablePatches();

export const APP_VERSION = '0.8.0';
export const FORMAT_VERSION = 2;

export type NodeT = { id: string; type: 'machine' | 'assembly' | 'sheet' | 'programs' | 'program'; name: string; parent: string | null; children: string[]; sheetType?: 'hydraulic' | 'pneumatic' | 'electric'; size?: string; description?: string; created: string; language?: string };
export type Star = { star_id: string; type: 'tool' | 'command' | 'library_item' | 'circuit' | 'program' | 'template'; target_ref: string; label: string; icon: string; scope: 'global' | 'project'; order: number; created: string; custom?: boolean };
export type Project = {
  manifest: { format: string; formatVersion: number; projectId: string; name: string; version: number; created: string; modified: string; appVersion: string; unitSystem: UnitSystem; template: string; location: string; description?: string; author?: string; company?: string };
  rootId: string; nodes: Record<string, NodeT>; circuits: Record<string, any>; programs: Record<string, any>;
  library: any[]; registry: { nextId: number; tags: Record<string, any> }; stars: Star[]; thumbnails: Record<string, string>;
};
export type Prefs = { unitSystem: UnitSystem; snap: { grid: boolean; endpoint: boolean; ortho: boolean }; autosaveSec: number; sheetSize: string; lineWeight: number; confirmDelete: boolean; language: string; shortcuts: Record<string, string>; customTab: { name: string; items: string[] }; toolMode: 'popout' | 'overlay'; sim: SimPrefs; graphAuto?: boolean; graphPop?: boolean; overview?: boolean };
// simulation display: flow arrows on the lines and the hover tooltip
export type SimPrefs = { anim: boolean; len: number; width: number; size: number; count: number; speed: number; color: 'pressure' | 'ink' | 'accent' | 'white'; tooltip: boolean; alerts: boolean };
export const defaultSimPrefs: SimPrefs = { anim: true, len: 3, width: 2.4, size: 100, count: 4, speed: 100, color: 'ink', tooltip: true, alerts: true };
export type Settings = { theme: 'light' | 'contrast'; themeId?: string; paperFollow?: boolean; brightness: number; contrast: number; fontScale: number; blur: number; reduceTransparency: boolean; reduceMotion: boolean; tileSize: 'small' | 'medium' | 'large'; solver: { dt: number; tol: number; oil: string; temp: number; density: number; viscosity: number }; elecSolver: boolean; renderQuality: 'high' | 'balanced' | 'fast'; hwAccel: boolean; folderName: string; recoveryCopies: number; showIds: boolean };
export const defaultPrefs: Prefs = { unitSystem: 'SI-bar', snap: { grid: true, endpoint: true, ortho: false }, autosaveSec: 60, sheetSize: 'A3', lineWeight: 0.5, confirmDelete: true, language: 'en', shortcuts: {}, customTab: { name: 'Custom', items: ['tool.valve', 'tool.symbol', 'menu.calc'] }, toolMode: 'popout', sim: { anim: true, len: 3, width: 2.4, size: 100, count: 4, speed: 100, color: 'ink', tooltip: true, alerts: true } };
export const defaultSettings: Settings = { theme: 'light', brightness: 100, contrast: 100, fontScale: 100, blur: 20, reduceTransparency: false, reduceMotion: false, tileSize: 'medium', solver: { dt: 1, tol: 1e-6, oil: 'ISO VG 46', temp: 40, density: 870, viscosity: 46 }, elecSolver: false, renderQuality: 'high', hwAccel: true, folderName: '', recoveryCopies: 20, showIds: false };

export const project = signal<Project | null>(null);
export const dirty = signal(false);
export const fileHandle = signal<any>(null);
export const prefs = signal<Prefs>(clone(defaultPrefs));
export const settings = signal<Settings>(clone(defaultSettings));
export const globalStars = signal<Star[]>([]);
export const recents = signal<any[]>([]);
export const checkpoints = signal<any[]>([]);
export const customLib = signal<any[]>([]);
export const customFolders = signal<string[]>([]);
export const workspace = signal<'hydraulic' | 'electrical' | 'plc'>('hydraulic');
export type Sel = { kind: 'std' | 'custom' | 'sample' | 'node' | 'recent' | 'checkpoint'; ids: string[] } | null;
export const selection = signal<Sel>(null);
export type Tab = { id: string; title: string; kind: 'home' | 'designer'; designer?: 'hydraulic' | 'electric' | 'logic' | 'panel'; nodeId?: string; docKey?: string; ctx?: { host: string; inst: string } };
export const tabs = signal<Tab[]>([{ id: 'home', title: 'Home', kind: 'home' }]);
export const activeTab = signal('home');
export const autosaveState = signal<{ text: string; when?: string }>({ text: 'No project' });
export const busy = signal<{ label: string; pct?: number } | null>(null);
export const valveSvgs = signal<Record<string, string>>({});
export const stdValveItems = signal<any[]>([]);
export const sidebarFocus = signal<{ panel: string; n: number; search?: boolean } | null>(null);
export const sidebarVis = signal({ left: true, right: true });
export const tour = signal<number | null>(null);

// ---------------- notifications & toasts ----------------
export type Note = { id: string; level: 'info' | 'ok' | 'warn' | 'err'; text: string; date: string; read: boolean };
export const notes = signal<Note[]>([]);
export const toasts = signal<{ id: string; text: string; level: string }[]>([]);
export function toast(text: string, level: 'info' | 'ok' | 'warn' | 'err' = 'info') {
  const id = uid('t'); toasts.value = [...toasts.value, { id, text, level }].slice(-4);
  setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id); }, level === 'err' ? 5200 : 2800);
}
export function notify(text: string, level: Note['level'] = 'info', silent = false) {
  notes.value = [{ id: uid('n'), level, text, date: nowIso(), read: false }, ...notes.value].slice(0, 100);
  if (!silent) toast(text, level);
}

// ---------------- modal ----------------
export const modal = signal<{ name: string; props?: any } | null>(null);
export const openModal = (name: string, props?: any) => { modal.value = { name, props }; };
export const closeModal = () => { modal.value = null; };
export function confirmDlg(title: string, body: string, buttons: { label: string; value: string; primary?: boolean; danger?: boolean }[]): Promise<string> {
  return new Promise(res => openModal('confirm', { title, body, buttons, resolve: res }));
}
export function promptDlg(title: string, label: string, value = ''): Promise<string | null> {
  return new Promise(res => openModal('prompt', { title, label, value, resolve: res }));
}

// ---------------- undo / redo over the project ----------------
type Hist = { label: string; p: Patch[]; inv: Patch[] };
let undoStack: Hist[] = [];
let redoStack: Hist[] = [];
export const histVer = signal(0);
export const canUndo = computed(() => (histVer.value, undoStack.length > 0));
export const canRedo = computed(() => (histVer.value, redoStack.length > 0));
// simulation running on the visible sheet: editing is locked until it stops
export const editLock = signal<string | null>(null);
export function mutate(label: string, recipe: (d: Project) => void, opt?: { ignoreLock?: boolean }) {
  if (!project.value) return;
  if (readOnly.value) { toast('Read-only project — turn off Read-only on the Home tab to edit', 'warn'); return; }
  if (editLock.value && !opt?.ignoreLock) { toast(editLock.value, 'warn'); return; }
  const [next, p, inv] = produceWithPatches(project.value, recipe as any);
  if (!p.length) return;
  undoStack.push({ label, p, inv }); if (undoStack.length > 200) undoStack.shift(); redoStack.length = 0;
  batch(() => { project.value = next as Project; dirty.value = true; histVer.value++; });
}
export function undo() { const s = undoStack.pop(); if (!s || !project.value) return; redoStack.push(s); batch(() => { project.value = applyPatches(project.value!, s.inv); dirty.value = true; histVer.value++; }); toast('Undo: ' + s.label); }
export function redo() { const s = redoStack.pop(); if (!s || !project.value) return; undoStack.push(s); batch(() => { project.value = applyPatches(project.value!, s.p); dirty.value = true; histVer.value++; }); toast('Redo: ' + s.label); }
export function resetHistory() { undoStack = []; redoStack = []; histVer.value++; }

// ---------------- several open projects (documents) ----------------
// project / fileHandle / dirty / readOnly always describe the ACTIVE document; the others wait in docs.
export type Doc = { key: string; project: Project; handle: any; dirty: boolean; undo: Hist[]; redo: Hist[]; readOnly: boolean; sample?: boolean };
export const docs = signal<Doc[]>([]);
export const activeDoc = signal('');
export const readOnly = signal(false);
export function stashActive() {
  const k = activeDoc.peek(); if (!k || !project.peek()) return;
  docs.value = docs.peek().map(d => d.key === k ? { ...d, project: project.peek()!, handle: fileHandle.peek(), dirty: dirty.peek(), undo: undoStack, redo: redoStack, readOnly: readOnly.peek() } : d);
}
export function loadDoc(d: Doc | null) {
  batch(() => {
    activeDoc.value = d?.key || ''; project.value = d?.project || null; fileHandle.value = d?.handle || null; dirty.value = !!d?.dirty; readOnly.value = !!d?.readOnly;
    undoStack = d?.undo || []; redoStack = d?.redo || []; histVer.value++;
    selection.value = d ? { kind: 'node', ids: [d.project.rootId] } : null;
    autosaveState.value = { text: !d ? 'No project' : d.dirty ? 'Unsaved changes' : d.project.manifest.version ? 'Saved' : 'Not saved yet' };
  });
}
export function switchDoc(key: string) { if (key === activeDoc.peek()) return; const d = docs.peek().find(x => x.key === key); if (!d) return; stashActive(); loadDoc(docs.peek().find(x => x.key === key)!); }
export const docProject = (key?: string) => !key || key === activeDoc.value ? project.value : docs.value.find(d => d.key === key)?.project || null;
export const docDirty = (key: string) => key === activeDoc.value ? dirty.value : !!docs.value.find(d => d.key === key)?.dirty;
export const anyDirty = () => dirty.peek() || docs.peek().some(d => d.key !== activeDoc.peek() && d.dirty);
export function setReadOnly(v: boolean) { readOnly.value = v; stashActive(); toast(v ? 'Read-only: the project can be viewed and simulated, not changed' : 'Editing enabled'); }

// ---------------- designer tabs ----------------
export function openSheetTab(nodeId: string, ctx?: Tab['ctx']) {
  const p = project.value; const n = p?.nodes[nodeId]; if (!p || !n || (n.type !== 'sheet' && n.type !== 'program')) return;
  const kind: Tab['designer'] = n.type === 'program' ? 'logic' : n.sheetType === 'electric' ? 'electric' : 'hydraulic';
  const id = 'des_' + kind + nodeId; const ex = tabs.value.find(t => t.id === id);
  if (!ex) tabs.value = [...tabs.value, { id, title: n.name, kind: 'designer', designer: kind, nodeId, docKey: activeDoc.value, ctx }];
  else if (ctx !== undefined || ex.ctx) tabs.value = tabs.value.map(t => t.id === id ? { ...t, ctx } : t);
  activeTab.value = id;
  if (kind === 'hydraulic') kvSet('lastSheet.' + p.manifest.projectId, nodeId);
}
export const firstFluidSheet = (p: Project) => Object.values(p.nodes).find(n => n.type === 'sheet' && n.sheetType !== 'electric')?.id || null;

// ---------------- project tree operations ----------------
export const SHEET_LABEL: Record<string, string> = { hydraulic: 'Hydraulic', pneumatic: 'Pneumatic', electric: 'Electric' };
export function mkNode(type: NodeT['type'], name: string, parent: string | null, extra: Partial<NodeT> = {}): NodeT { return { id: uid(type === 'sheet' ? 'sh' : type === 'program' ? 'pg' : type === 'assembly' ? 'as' : 'nd'), type, name, parent, children: [], created: nowIso(), ...extra }; }
export function nodeAncestors(p: Project, id: string) { const out: string[] = []; let n = p.nodes[id]; while (n && n.parent) { out.push(n.parent); n = p.nodes[n.parent]; } return out; }
export function addNode(type: 'assembly' | 'sheet' | 'program', parentHint: string | null, sheetType?: 'hydraulic' | 'pneumatic' | 'electric', name?: string) {
  const p = project.value; if (!p) return null;
  let parent = parentHint && p.nodes[parentHint] ? parentHint : p.rootId;
  const pn = p.nodes[parent];
  if (type === 'sheet' && pn.type !== 'assembly') { parent = pn.type === 'sheet' ? pn.parent! : (Object.values(p.nodes).find(n => n.type === 'assembly')?.id || p.rootId); }
  if (type === 'program') parent = Object.values(p.nodes).find(n => n.type === 'programs')?.id || p.rootId;
  if (type === 'assembly') parent = p.rootId;
  const count = Object.values(p.nodes).filter(n => n.type === type && (type !== 'sheet' || n.sheetType === sheetType)).length + 1;
  const nm = name || (type === 'sheet' ? `${SHEET_LABEL[sheetType!]} ${count}` : type === 'program' ? `Program ${count}` : `Assembly ${count}`);
  const n = mkNode(type, nm, parent, type === 'sheet' ? { sheetType, size: prefs.value.sheetSize } : type === 'program' ? { language: 'Blocks' } : {});
  mutate(`New ${type}`, d => {
    d.nodes[n.id] = n; d.nodes[parent].children.push(n.id);
    if (type === 'sheet') d.circuits[n.id] = { id: n.id, type: sheetType, name: nm, size: n.size, components: [], connections: [] };
    if (type === 'program') d.programs[n.id] = newProgram(n.id, nm);
  });
  return n.id;
}
export function renameNode(id: string, name: string) { name = name.trim(); if (!name) return; mutate('Rename', d => { d.nodes[id].name = name; if (d.circuits[id]) d.circuits[id].name = name; if (d.programs[id]) d.programs[id].name = name; if (id === d.rootId) d.manifest.name = name; }); }
function collect(p: Project, id: string, acc: string[] = []) { acc.push(id); p.nodes[id].children.forEach(c => collect(p, c, acc)); return acc; }
export function deleteNodes(ids: string[]) {
  const p = project.value; if (!p) return;
  ids = ids.filter(id => id !== p.rootId && p.nodes[id] && p.nodes[id].type !== 'programs');
  if (!ids.length) return;
  mutate(ids.length > 1 ? `Delete ${ids.length} items` : 'Delete', d => {
    ids.forEach(id => { if (!d.nodes[id]) return; const all = collect(d as Project, id); const par = d.nodes[id].parent; if (par && d.nodes[par]) d.nodes[par].children = d.nodes[par].children.filter(c => c !== id); all.forEach(x => { delete d.nodes[x]; delete d.circuits[x]; delete d.programs[x]; }); d.stars = d.stars.filter(s => !all.includes(s.target_ref.split(':')[1])); });
  });
  tabs.value = tabs.value.filter(t => !t.nodeId || (t.docKey && t.docKey !== activeDoc.value) || project.value!.nodes[t.nodeId]); if (!tabs.value.find(t => t.id === activeTab.value)) activeTab.value = 'home';
}
function cloneSubtree(d: Project, src: Project, id: string, parent: string, suffix: string): string {
  const s = src.nodes[id]; const n = { ...clone(s), id: uid(s.type === 'sheet' ? 'sh' : s.type === 'program' ? 'pg' : 'as'), parent, children: [] as string[], name: s.name + suffix, created: nowIso() };
  d.nodes[n.id] = n; if (src.circuits[id]) d.circuits[n.id] = { ...clone(src.circuits[id]), id: n.id, name: n.name }; if (src.programs[id]) d.programs[n.id] = { ...clone(src.programs[id]), id: n.id, name: n.name };
  s.children.forEach(c => { const cid = cloneSubtree(d, src, c, n.id, ''); d.nodes[n.id].children.push(cid); });
  return n.id;
}
export function duplicateNodes(ids: string[]) {
  const p = project.value; if (!p) return; const made: string[] = [];
  mutate('Duplicate', d => { ids.forEach(id => { const s = p.nodes[id]; if (!s || !s.parent || s.type === 'programs') return; const nid = cloneSubtree(d as Project, p, id, s.parent, ' copy'); const sib = d.nodes[s.parent].children; sib.splice(sib.indexOf(id) + 1, 0, nid); made.push(nid); }); });
  return made;
}
let clip: { src: Project; ids: string[] } | null = null;
export const hasClip = signal(false);
export function copyNodes(ids: string[]) { const p = project.value; if (!p) return; const ok = ids.filter(id => p.nodes[id] && p.nodes[id].parent && p.nodes[id].type !== 'programs'); if (!ok.length) return; clip = { src: clone(p), ids: ok }; hasClip.value = true; toast(`Copied ${ok.length} item${ok.length > 1 ? 's' : ''}`); }
export function pasteNodes(target: string | null) {
  const p = project.value; if (!p || !clip) return; const made: string[] = [];
  mutate('Paste', d => {
    clip!.ids.forEach(id => {
      const s = clip!.src.nodes[id]; let parent = target && d.nodes[target] ? target : p.rootId;
      const pt = d.nodes[parent];
      if (s.type === 'sheet' && pt.type !== 'assembly') parent = pt.type === 'sheet' ? pt.parent! : (Object.values(d.nodes).find(n => n.type === 'assembly')?.id || p.rootId);
      if (s.type === 'program') parent = Object.values(d.nodes).find(n => n.type === 'programs')?.id || p.rootId;
      if (s.type === 'assembly') parent = p.rootId;
      const nid = cloneSubtree(d as Project, clip!.src, id, parent, ' copy'); d.nodes[parent].children.push(nid); made.push(nid);
    });
  });
  return made;
}
export function setNodeProps(ids: string[], patch: Partial<NodeT>) {
  mutate('Edit properties', d => ids.forEach(id => { const n = d.nodes[id]; if (!n) return; Object.assign(n, patch); if (d.circuits[id]) { if (patch.size) d.circuits[id].size = patch.size; if (patch.sheetType) d.circuits[id].type = patch.sheetType; } }));
}

// ---------------- stars ----------------
export const STAR_LIMIT = 60;
export const DEFAULT_STARS = (): Star[] => [
  { star_id: uid('star'), type: 'command', target_ref: 'cmd:file.new', label: 'New', icon: 'file-plus', scope: 'global', order: 0, created: nowIso() },
  { star_id: uid('star'), type: 'command', target_ref: 'cmd:file.open', label: 'Open', icon: 'folder-open', scope: 'global', order: 1, created: nowIso() },
  { star_id: uid('star'), type: 'command', target_ref: 'cmd:edit.item', label: 'Edit', icon: 'pencil', scope: 'global', order: 2, created: nowIso() },
  { star_id: uid('star'), type: 'command', target_ref: 'cmd:view.samples', label: 'Samples', icon: 'library', scope: 'global', order: 3, created: nowIso() }
];
export const allStars = computed(() => [...globalStars.value, ...(project.value?.stars || [])].sort((a, b) => a.order - b.order));
export const isStarred = (ref: string) => allStars.value.some(s => s.target_ref === ref);
export function addStar(s: Omit<Star, 'star_id' | 'order' | 'created'>) {
  if (isStarred(s.target_ref)) return false;
  if (allStars.value.length >= STAR_LIMIT) { toast(`Star limit reached (${STAR_LIMIT}). Unstar something first.`, 'warn'); return false; }
  const order = (allStars.value.at(-1)?.order ?? -1) + 1;
  const star: Star = { ...s, star_id: uid('star'), order, created: nowIso() };
  if (s.scope === 'project' && project.value) mutate('Star', d => { d.stars.push(star); });
  else { globalStars.value = [...globalStars.value, { ...star, scope: 'global' }]; saveGlobalStars(); }
  toast(`Starred “${s.label}”`, 'ok'); return true;
}
export function removeStar(ref: string) {
  const s = allStars.value.find(x => x.target_ref === ref); if (!s) return;
  if (s.scope === 'project' && project.value?.stars.some(x => x.star_id === s.star_id)) mutate('Unstar', d => { d.stars = d.stars.filter(x => x.star_id !== s.star_id); });
  else { globalStars.value = globalStars.value.filter(x => x.star_id !== s.star_id); saveGlobalStars(); }
}
export function updateStar(star_id: string, patch: Partial<Star>) {
  if (globalStars.value.some(s => s.star_id === star_id)) { globalStars.value = globalStars.value.map(s => s.star_id === star_id ? { ...s, ...patch } : s); saveGlobalStars(); }
  else mutate('Edit star', d => { const s = d.stars.find(x => x.star_id === star_id); if (s) Object.assign(s, patch); });
}
export function reorderStars(idsInOrder: string[]) {
  const ord = new Map(idsInOrder.map((id, i) => [id, i]));
  globalStars.value = globalStars.value.map(s => ({ ...s, order: ord.get(s.star_id) ?? s.order })); saveGlobalStars();
  if (project.value && project.value.stars.length) { const p = project.value; project.value = { ...p, stars: p.stars.map(s => ({ ...s, order: ord.get(s.star_id) ?? s.order })) }; dirty.value = true; }
}
export const saveGlobalStars = () => kvSet('globalStars', globalStars.value);

// ---------------- custom library (shared with the Valve Creator and Symbol Sketcher via localStorage) ----------------
export const LIB_KEY = 'hydra.customLibrary.v1';
export function libLoad(): any[] { try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); } catch { return []; } }
export function libReload() { customLib.value = libLoad(); if (selection.value?.kind === 'custom') { const ids = selection.value.ids.filter(i => customLib.value.some(x => x.item_id === i)); selection.value = ids.length ? { kind: 'custom', ids } : null; } }
export function libWrite(arr: any[]) { try { localStorage.setItem(LIB_KEY, JSON.stringify(arr)); customLib.value = arr; if (selection.value?.kind === 'custom') { const ids = selection.value.ids.filter(i => arr.some(x => x.item_id === i)); selection.value = ids.length ? { kind: 'custom', ids } : null; } window.dispatchEvent(new CustomEvent('hydra:library-changed', { detail: { source: 'home' } })); return true; } catch (e) { toast('Could not write the Custom Library (browser storage blocked)', 'err'); return false; } }
export function libUpdate(id: string, patch: any, bump = true) {
  const arr = libLoad(); const i = arr.findIndex(x => x.item_id === id); if (i < 0) return;
  const it = { ...arr[i], ...patch, modified: nowIso() }; if (bump) it.version = (arr[i].version || 0) + 1;
  if (patch.name && it.definition) it.definition = { ...it.definition, name: patch.name };
  arr[i] = it; libWrite(arr);
}

// ---------------- persisted user profile ----------------
export async function loadProfile() {
  const pp: any = await kvGet('prefs', {}); prefs.value = { ...clone(defaultPrefs), ...pp, sim: { ...defaultPrefs.sim, ...(pp.sim || {}) } };
  const s = await kvGet('settings', {} as any); settings.value = { ...clone(defaultSettings), ...s, solver: { ...defaultSettings.solver, ...(s.solver || {}) } };
  const gs = await kvGet<Star[] | null>('globalStars', null); globalStars.value = gs ?? DEFAULT_STARS(); if (!gs) saveGlobalStars();
  customFolders.value = await kvGet('customFolders', []);
  workspace.value = await kvGet('workspace', 'hydraulic');
  libReload();
}
export const savePrefs = (p: Prefs) => { prefs.value = p; kvSet('prefs', p); };
export const saveSettings = (s: Settings) => { settings.value = s; kvSet('settings', s); };
