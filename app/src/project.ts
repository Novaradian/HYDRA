// .hydra project file: create, read, write, validate, migrate; save / open / recents / checkpoints / autosave recovery
import JSZip from 'jszip';
import { sampleCircuit } from './designer/samples';
import Ajv from 'ajv';
import { batch } from '@preact/signals';
import { uid, nowIso, clone, slug, download, pickFile, fmtTime } from './util';
import { recentsT, checkpointsT, recoveryT, kvGet, kvSet } from './db';
import { LX, srvHandle, plainHandle, liveHandle, listFiles, readFile, writeFile, deleteFile, safeName } from './launcher';
import { promptDlg, openModal } from './store';
import { project, dirty, fileHandle, prefs, settings, recents, checkpoints, autosaveState, toast, notify, confirmDlg, resetHistory, tabs, activeTab, selection, mkNode, busy, APP_VERSION, FORMAT_VERSION, docs, activeDoc, readOnly, stashActive, loadDoc, switchDoc, docProject, openSheetTab, firstFluidSheet, type Project } from './store';
import { SAMPLES } from './symbols';
import type { UnitSystem } from './units';
import { newProgram } from './plc/compile';

const ajv = new Ajv({ allErrors: true });
const validateManifest = ajv.compile({
  type: 'object', required: ['projectId', 'name', 'created', 'formatVersion'],
  properties: { projectId: { type: 'string', minLength: 1 }, name: { type: 'string' }, created: { type: 'string' }, modified: { type: 'string' }, formatVersion: { type: 'integer', minimum: 1 }, unitSystem: { enum: ['SI', 'SI-bar', 'Imperial'] }, version: { type: 'integer' } }
});
const validateNodes = ajv.compile({ type: 'object', additionalProperties: { type: 'object', required: ['id', 'type', 'name', 'children'], properties: { id: { type: 'string' }, type: { enum: ['machine', 'assembly', 'sheet', 'programs', 'program'] }, name: { type: 'string' }, children: { type: 'array', items: { type: 'string' } } } } });

export const TEMPLATES: Record<string, { label: string; sheets: { name: string; type: 'hydraulic' | 'pneumatic' | 'electric' }[]; program?: boolean }> = {
  blank: { label: 'Blank', sheets: [] },
  hydraulic: { label: 'Hydraulic machine', sheets: [{ name: 'Hydraulic 1', type: 'hydraulic' }] },
  electrohydraulic: { label: 'Electro-hydraulic (hydraulic + electric + PLC)', sheets: [{ name: 'Hydraulic 1', type: 'hydraulic' }, { name: 'Electric 1', type: 'electric' }], program: true },
  pneumatic: { label: 'Pneumatic machine', sheets: [{ name: 'Pneumatic 1', type: 'pneumatic' }] }
};

export function newProjectData(o: { name: string; template: string; unitSystem: UnitSystem; location?: string; description?: string; author?: string }): Project {
  const pid = uid('prj'), now = nowIso();
  const root = mkNode('machine', o.name, null), asm = mkNode('assembly', 'Assembly 1', root.id), progs = mkNode('programs', 'Programs', root.id);
  root.children = [asm.id, progs.id];
  const p: Project = { manifest: { format: 'hydra.project', formatVersion: FORMAT_VERSION, projectId: pid, name: o.name, version: 0, created: now, modified: now, appVersion: APP_VERSION, unitSystem: o.unitSystem, template: o.template, location: o.location || '', description: o.description || '', author: o.author || '' },
    rootId: root.id, nodes: { [root.id]: root, [asm.id]: asm, [progs.id]: progs }, circuits: {}, programs: {}, library: [], registry: { nextId: 1, tags: {} }, stars: [], thumbnails: {} };
  const t = TEMPLATES[o.template] || TEMPLATES.blank;
  t.sheets.forEach(s => { const n = mkNode('sheet', s.name, asm.id, { sheetType: s.type, size: prefs.value.sheetSize }); p.nodes[n.id] = n; asm.children.push(n.id); p.circuits[n.id] = { id: n.id, type: s.type, name: s.name, size: n.size, components: [], connections: [] }; });
  if (t.program) { const n = mkNode('program', 'Main program', progs.id, { language: 'Blocks' }); p.nodes[n.id] = n; progs.children.push(n.id); p.programs[n.id] = newProgram(n.id, n.name); }
  return p;
}
export function sampleProject(sid: string): Project {
  const s = SAMPLES.find(x => x.id === sid)!;
  const p = newProjectData({ name: s.name + ' (sample)', template: 'blank', unitSystem: prefs.value.unitSystem, description: s.description });
  addSampleSheets(p, sid);
  return p;
}
export function addSampleSheets(p: Project, sid: string) {
  const s = SAMPLES.find(x => x.id === sid)!; const asm = Object.values(p.nodes).find(n => n.type === 'assembly') || p.nodes[p.rootId]; const progs = Object.values(p.nodes).find(n => n.type === 'programs')!;
  s.sheets.forEach(sh => { const n = mkNode('sheet', sh.name, asm.id, { sheetType: sh.type as any, size: prefs.value.sheetSize, description: `From sample: ${s.name}` }); p.nodes[n.id] = n; p.nodes[asm.id].children.push(n.id); const drawn = sampleCircuit(s.id, sh.type); p.circuits[n.id] = drawn ? { id: n.id, type: sh.type, name: sh.name, connections: [], sample: s.id, ...drawn, size: drawn.size || 'A3' } : { id: n.id, type: sh.type, name: sh.name, size: n.size, components: s.parts.map((pid, i) => ({ ref: pid, tag: `${pid}-${i + 1}` })), connections: [], sample: s.id }; if (drawn) p.nodes[n.id].size = drawn.size || 'A3'; });
  (s.programs || []).forEach(pg => { const n = mkNode('program', pg.name, progs.id, { language: 'ST' }); p.nodes[n.id] = n; p.nodes[progs.id].children.push(n.id); p.programs[n.id] = { id: n.id, name: pg.name, language: 'ST', code: pg.code }; });
}

// ---------- zip read / write ----------
export function thumbSvg(p: Project) {
  const sheets = Object.values(p.nodes).filter(n => n.type === 'sheet');
  const col: Record<string, string> = { hydraulic: '#0A64C2', pneumatic: '#15803D', electric: '#B45309' };
  const bars = sheets.slice(0, 6).map((s, i) => `<rect x="${10 + i * 22}" y="40" width="18" height="26" rx="2" fill="${col[s.sheetType!] || '#5B6878'}" opacity=".85"/>`).join('');
  const initials = p.manifest.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase().replace(/[<&]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 80"><rect width="160" height="80" fill="#F3F6F9"/><text x="10" y="28" font-family="IBM Plex Sans,Arial" font-weight="700" font-size="20" fill="#26313E">${initials}</text><text x="150" y="28" text-anchor="end" font-family="JetBrains Mono,monospace" font-size="10" fill="#5B6878">${sheets.length} sh</text>${bars}</svg>`;
}
export async function toZip(p: Project): Promise<Blob> {
  const z = new JSZip();
  z.file('manifest.json', JSON.stringify(p.manifest, null, 2));
  z.file('structure.json', JSON.stringify({ rootId: p.rootId, nodes: p.nodes }, null, 2));
  Object.values(p.circuits).forEach((c: any) => z.file(`circuits/${c.id}.json`, JSON.stringify(c, null, 2)));
  Object.values(p.programs).forEach((c: any) => z.file(`programs/${c.id}.json`, JSON.stringify(c, null, 2)));
  p.library.forEach((it: any) => z.file(`library/${it.item_id}.json`, JSON.stringify(it, null, 2)));
  z.file('registry.json', JSON.stringify(p.registry, null, 2));
  z.file('stars.json', JSON.stringify(p.stars, null, 2));
  z.file('thumbnails/project.svg', thumbSvg(p));
  return z.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/zip' });
}
async function readJson(z: JSZip, path: string, def: any) { const f = z.file(path); if (!f) return def; return JSON.parse(await f.async('string')); }
export async function fromZip(data: Blob | ArrayBuffer): Promise<{ p: Project; migrated: boolean }> {
  const z = await JSZip.loadAsync(data);
  const manifest = await readJson(z, 'manifest.json', null); if (!manifest) throw new Error('manifest.json missing — not a HYDRA project');
  const circuits: any = {}, programs: any = {}, library: any[] = [];
  for (const f of Object.values(z.files)) {
    if (f.dir) continue;
    if (f.name.startsWith('circuits/') && f.name.endsWith('.json')) { const c = JSON.parse(await f.async('string')); circuits[c.id] = c; }
    if (f.name.startsWith('programs/') && f.name.endsWith('.json')) { const c = JSON.parse(await f.async('string')); programs[c.id] = c; }
    if (f.name.startsWith('library/') && f.name.endsWith('.json')) library.push(JSON.parse(await f.async('string')));
  }
  const structure = await readJson(z, 'structure.json', null);
  const raw = { manifest, structure, circuits, programs, library, registry: await readJson(z, 'registry.json', { nextId: 1, tags: {} }), stars: await readJson(z, 'stars.json', []) };
  return migrate(raw);
}
// v1 files (earlier HYDRA packages) have no structure.json: rebuild the tree from circuits/programs
function migrate(raw: any): { p: Project; migrated: boolean } {
  const m = raw.manifest; let migrated = false;
  if (!m.formatVersion) m.formatVersion = 1;
  if (!m.projectId) m.projectId = uid('prj');
  if (!m.created) m.created = nowIso();
  if (!(validateManifest as any)(m)) throw new Error('Invalid manifest: ' + ajv.errorsText(validateManifest.errors));
  let rootId: string, nodes: any;
  if (m.formatVersion < 2 || !raw.structure) {
    migrated = true; const root = mkNode('machine', m.name || 'Machine', null), asm = mkNode('assembly', 'Assembly 1', root.id), progs = mkNode('programs', 'Programs', root.id);
    root.children = [asm.id, progs.id]; nodes = { [root.id]: root, [asm.id]: asm, [progs.id]: progs }; rootId = root.id;
    Object.values(raw.circuits).forEach((c: any) => { const n = { ...mkNode('sheet', c.name || 'Sheet', asm.id, { sheetType: c.type === 'electric' || c.type === 'pneumatic' ? c.type : 'hydraulic', size: c.size || 'A3' }), id: c.id }; nodes[n.id] = n; asm.children.push(n.id); });
    Object.values(raw.programs).forEach((c: any) => { const n = { ...mkNode('program', c.name || 'Program', progs.id, { language: c.language || 'ST' }), id: c.id }; nodes[n.id] = n; progs.children.push(n.id); });
    m.formatVersion = FORMAT_VERSION;
  } else { rootId = raw.structure.rootId; nodes = raw.structure.nodes; if (!(validateNodes as any)(nodes) || !nodes[rootId]) throw new Error('Invalid project structure: ' + ajv.errorsText(validateNodes.errors)); }
  const p: Project = { manifest: { format: 'hydra.project', version: 0, modified: m.created, appVersion: APP_VERSION, unitSystem: 'SI-bar', template: 'blank', location: '', ...m }, rootId, nodes, circuits: raw.circuits, programs: raw.programs, library: raw.library, registry: raw.registry, stars: raw.stars || [], thumbnails: {} };
  return { p, migrated };
}
// a single-JSON export of the whole project
export const toJson = (p: Project) => JSON.stringify({ format: 'hydra.project.json', ...p }, null, 2);
export function fromJson(txt: string) { const o = JSON.parse(txt); if (o.format !== 'hydra.project.json' || !o.manifest) throw new Error('Not a HYDRA project JSON'); delete o.format; return migrate({ manifest: o.manifest, structure: { rootId: o.rootId, nodes: o.nodes }, circuits: o.circuits || {}, programs: o.programs || {}, library: o.library || [], registry: o.registry || { nextId: 1, tags: {} }, stars: o.stars || [] }); }

// ---------- lifecycle ----------
const FS = typeof (window as any).showSaveFilePicker === 'function';
export const fsAccess = () => FS;
let dirHandle: any = null;
export async function loadDirHandle() { dirHandle = await kvGet('dirHandle', null); }
export async function chooseFolder() {
  if (!(window as any).showDirectoryPicker) { toast('Folder picking is not supported in this browser; files go to Downloads.', 'warn'); return; }
  try { dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' }); await kvSet('dirHandle', dirHandle); return dirHandle.name; } catch { return null; }
}

// Opening never closes another project: each project is its own document (tab group). Opening a project that is
// already open switches to it. replace: swap the content of the active document (checkpoint restore).
export async function setProject(p: Project, opts: { handle?: any; dirty?: boolean; fromRecent?: boolean; replace?: boolean; sample?: boolean; readOnly?: boolean } = {}) {
  const same = docs.value.find(d => docProject(d.key)?.manifest.projectId === p.manifest.projectId);
  if (same && !opts.replace) { switchDoc(same.key); activeTab.value = 'home'; toast(`“${p.manifest.name}” is already open`, 'info'); return false; }
  if (opts.replace && (same || activeDoc.value)) {
    const key = same?.key || activeDoc.value; if (key !== activeDoc.value) switchDoc(key);
    batch(() => { project.value = p; if (opts.handle !== undefined) fileHandle.value = opts.handle; dirty.value = !!opts.dirty; selection.value = { kind: 'node', ids: [p.rootId] }; tabs.value = tabs.value.filter(t => !t.docKey || t.docKey !== key || !!p.nodes[t.nodeId || '']); });
    resetHistory(); stashActive();
  } else {
    stashActive();
    const d = { key: 'doc_' + uid(''), project: p, handle: opts.handle || null, dirty: !!opts.dirty, undo: [], redo: [], readOnly: !!opts.readOnly, sample: !!opts.sample };
    docs.value = [...docs.value, d]; loadDoc(d); activeTab.value = 'home';
  }
  await refreshCheckpoints(); autosaveState.value = { text: opts.dirty ? 'Unsaved changes' : p.manifest.version ? 'Saved' : 'Not saved yet' };
  return true;
}
export async function guardDirty(): Promise<boolean> {
  if (!project.value || !dirty.value) return true;
  const r = await confirmDlg('Unsaved changes', `Save changes to “${project.value.manifest.name}” before closing it?`, [{ label: 'Cancel', value: 'cancel' }, { label: 'Discard', value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }]);
  if (r === 'cancel') return false;
  if (r === 'save') return await save();
  await recoveryT.del(project.value.manifest.projectId); return true;
}
export async function createProject(o: Parameters<typeof newProjectData>[0]) {
  const p = newProjectData(o); await setProject(p, { dirty: true });
  notify(`New project “${o.name}” created — save it to choose where it lives`, 'ok');
  const first = firstFluidSheet(p); if (first) openSheetTab(first);
}
// closes the ACTIVE project only; the next open project becomes active
export async function closeProject() {
  if (!project.value) return true;
  if (!(await guardDirty())) return false;
  const key = activeDoc.value; await recoveryT.del(project.value.manifest.projectId);
  const rest = docs.value.filter(d => d.key !== key);
  batch(() => { docs.value = rest; tabs.value = tabs.value.filter(t => t.kind === 'home' || (t.docKey && t.docKey !== key)); activeTab.value = 'home'; });
  loadDoc(rest.length ? rest[rest.length - 1] : null);
  if (!rest.length) { checkpoints.value = []; autosaveState.value = { text: 'No project' }; } else await refreshCheckpoints();
  return true;
}
export async function closeDoc(key: string) { if (key !== activeDoc.value) switchDoc(key); return closeProject(); }
export async function closeAll() { while (docs.value.length) { if (!(await closeProject())) return false; } return true; }

async function writeHandle(h: any, blob: Blob) { if (h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') { if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Permission to write the file was refused'); } const w = await h.createWritable(); await w.write(blob); await w.close(); }
export async function save(): Promise<boolean> { if (!project.value) return false; if (!fileHandle.value) return saveAs(); return doSave(fileHandle.value); }
export async function saveAs(): Promise<boolean> {
  const p = project.value; if (!p) return false;
  if (LX.value) { // HYDRA.bat: save into Documents\HYDRA\projects
    const nm = await promptDlg('Save to project folder', `File name — saved in ${LX.value.projects}`, safeName(slug(p.manifest.name) + '.hydra')); if (nm == null) return false;
    const name = safeName(nm);
    try { if ((await listFiles('projects')).some(f => f.name.toLowerCase() === name.toLowerCase()) && (await confirmDlg('File exists', `${name} already exists in the project folder. Replace it? (The old file is kept in backups.)`, [{ label: 'Cancel', value: 'no' }, { label: 'Replace', value: 'yes', primary: true }])) !== 'yes') return false; }
    catch (e: any) { notify('Project folder not reachable: ' + (e?.message || e), 'err'); return false; }
    const h = srvHandle('projects', name); fileHandle.value = h; return doSave(h);
  }
  if (FS) {
    try { const h = await (window as any).showSaveFilePicker({ suggestedName: slug(p.manifest.name) + '.hydra', startIn: dirHandle || 'documents', types: [{ description: 'HYDRA project', accept: { 'application/zip': ['.hydra'] } }] }); fileHandle.value = h; return doSave(h); }
    catch (e: any) { if (e?.name === 'AbortError') return false; console.warn(e); }
  }
  return doSave(null);
}
async function doSave(h: any): Promise<boolean> {
  const p0 = project.value!; busy.value = { label: 'Saving…' };
  try {
    const p: Project = { ...p0, manifest: { ...p0.manifest, version: (p0.manifest.version || 0) + 1, modified: nowIso(), appVersion: APP_VERSION, location: h?.srv && LX.value ? `${LX.value.projects}\\${h.name}` : h?.name || slug(p0.manifest.name) + '.hydra (Downloads)' } };
    const blob = await toZip(p);
    if (h) await writeHandle(h, blob); else download(slug(p.manifest.name) + '.hydra', blob);
    batch(() => { project.value = p; dirty.value = false; }); stashActive();
    await recoveryT.del(p.manifest.projectId); if (LX.value) deleteFile('autosave', autosaveName(p)).catch(() => { });
    await checkpointsT.add({ projectId: p.manifest.projectId, date: p.manifest.modified, version: p.manifest.version, name: p.manifest.name, sheets: Object.values(p.nodes).filter(n => n.type === 'sheet').map(n => n.name), blob });
    const cps = (await checkpointsT.of(p.manifest.projectId)).sort((a, b) => a.date.localeCompare(b.date));
    const keep = Math.max(1, settings.value.recoveryCopies || 20); for (const c of cps.slice(0, Math.max(0, cps.length - keep))) await checkpointsT.del(c.cid);
    await addRecent(p, blob, h);
    await refreshCheckpoints();
    autosaveState.value = { text: `Saved ${fmtTime(p.manifest.modified)}`, when: p.manifest.modified };
    notify(h ? `Saved “${p.manifest.name}” (v${p.manifest.version})` : `Downloaded ${slug(p.manifest.name)}.hydra (v${p.manifest.version}) — this browser has no direct file access`, 'ok');
    return true;
  } catch (e: any) { notify('Save failed: ' + (e?.message || e), 'err'); return false; }
  finally { busy.value = null; }
}
export async function addRecent(p: Project, blob: Blob, handle: any) {
  const ex = recents.value.find(r => r.id === p.manifest.projectId);
  const r = { id: p.manifest.projectId, name: p.manifest.name, path: handle?.srv ? p.manifest.location || handle.name : handle?.name || p.manifest.location || slug(p.manifest.name) + '.hydra', date: nowIso(), thumb: thumbSvg(p), pinned: ex?.pinned || false, handle: plainHandle(handle || ex?.handle || null), blob };
  try { await recentsT.put(r); } catch { await recentsT.put({ ...r, handle: null }); }
  await refreshRecents();
}
export async function refreshRecents() {
  let all = (await recentsT.all()).sort((a, b) => (Number(b.pinned) - Number(a.pinned)) || b.date.localeCompare(a.date));
  const unpinned = all.filter(r => !r.pinned); for (const r of unpinned.slice(20)) await recentsT.del(r.id);
  recents.value = all.filter(r => r.pinned || unpinned.slice(0, 20).includes(r));
}
export async function refreshCheckpoints() { const p = project.value; checkpoints.value = p ? (await checkpointsT.of(p.manifest.projectId)).sort((a, b) => b.date.localeCompare(a.date)) : []; }
export async function togglePin(id: string) { const r = recents.value.find(x => x.id === id); if (!r) return; await recentsT.put({ ...r, pinned: !r.pinned }); await refreshRecents(); }
export async function removeRecent(id: string) { await recentsT.del(id); await refreshRecents(); }

export async function openBlob(blob: Blob | ArrayBuffer, name: string, handle: any = null) {
  busy.value = { label: 'Opening…' };
  try {
    let res: { p: Project; migrated: boolean };
    if (name.toLowerCase().endsWith('.json')) res = fromJson(await (blob instanceof Blob ? blob.text() : new TextDecoder().decode(blob)));
    else res = await fromZip(blob);
    if (res.migrated) { const b = blob instanceof Blob ? blob : new Blob([blob]); await checkpointsT.add({ projectId: res.p.manifest.projectId, date: nowIso(), version: res.p.manifest.version, name: res.p.manifest.name + ' (backup before upgrade)', sheets: [], blob: b }); }
    if (!(await setProject(res.p, { handle, dirty: res.migrated }))) return;
    if (handle || !name.toLowerCase().endsWith('.json')) await addRecent(res.p, blob instanceof Blob ? blob : new Blob([blob]), handle);
    notify(res.migrated ? `Opened “${res.p.manifest.name}” — upgraded from an older format (backup kept in Checkpoints)` : `Opened “${res.p.manifest.name}”`, res.migrated ? 'warn' : 'ok');
    const last = await kvGet<string | null>('lastSheet.' + res.p.manifest.projectId, null); if (last && project.value?.nodes[last]) openSheetTab(last);
  } catch (e: any) { notify(`Could not open ${name}: ${e?.message || e}`, 'err'); }
  finally { busy.value = null; }
}
export async function openProject() {
  if (LX.value) { openModal('projFolder'); return; }
  return openFromDisk();
}
export async function openFromDisk() {
  if ((window as any).showOpenFilePicker) {
    try { const [h] = await (window as any).showOpenFilePicker({ startIn: dirHandle || 'documents', types: [{ description: 'HYDRA project', accept: { 'application/zip': ['.hydra'], 'application/json': ['.json'] } }] }); const f = await h.getFile(); return openBlob(f, f.name, h); }
    catch (e: any) { if (e?.name === 'AbortError') return; }
  }
  const [f] = await pickFile('.hydra,.json'); if (f) await openBlob(f, f.name, null);
}
export async function openRecent(id: string) {
  const r = recents.value.find(x => x.id === id); if (!r) return;
  const open = docs.value.find(d => docProject(d.key)?.manifest.projectId === id); if (open) { switchDoc(open.key); activeTab.value = 'home'; return; }
  const hd = liveHandle(r.handle); if (hd?.srv && !LX.value) { /* saved through HYDRA.bat; not running now → use the copy */ }
  else if (hd) { try { if ((await hd.queryPermission?.({ mode: 'read' })) !== 'granted') await hd.requestPermission?.({ mode: 'read' }); const f = await hd.getFile(); return openBlob(f, f.name, hd); } catch { } }
  if (r.blob) { await openBlob(r.blob, r.path, null); toast('Opened from the copy kept at last save (original file not reachable)', 'warn'); return; }
  toast('This project can no longer be reached — open it from its file', 'err');
}
export async function restoreCheckpoint(cid: number) {
  const c = await checkpointsT.get(cid); if (!c) return; if (!(await guardDirty())) return;
  const { p } = await fromZip(c.blob); const h = fileHandle.value; await setProject(p, { handle: h, dirty: true, replace: true }); notify(`Restored checkpoint v${c.version} from ${new Date(c.date).toLocaleString()} — save to keep it`, 'warn');
}
export async function deleteCheckpoint(cid: number) { await checkpointsT.del(cid); await refreshCheckpoints(); }
export async function exportJson() { const p = project.value; if (!p) return; download(slug(p.manifest.name) + '.hydra.json', toJson(p), 'application/json'); toast('Exported project JSON', 'ok'); }

// ---------- autosave recovery ----------
let timer: any = null;
export function startAutosave() {
  clearInterval(timer);
  timer = setInterval(async () => {
    stashActive();
    for (const d of docs.value) {
      if (!d.dirty) continue;
      try { const blob = await toZip(d.project); await recoveryT.put({ projectId: d.project.manifest.projectId, name: d.project.manifest.name, date: nowIso(), blob });
        let where = 'Recovery copy'; if (LX.value && !d.readOnly) { try { await writeFile('autosave', autosaveName(d.project), blob); where = 'Autosaved'; } catch { } }
        if (d.key === activeDoc.value) autosaveState.value = { text: `${where} ${fmtTime(nowIso())}`, when: nowIso() }; } catch (e) { console.warn(e); }
    }
  }, Math.max(15, prefs.value.autosaveSec) * 1000);
}
/** HYDRA.bat: the autosave file of a project in Documents\HYDRA\autosave */
export const autosaveName = (p: Project) => safeName(`${slug(p.manifest.name)}-${String(p.manifest.projectId).replace(/\W/g, '').slice(-6)}.hydra`);
/** open a file from the project folder (projects / autosave / backups / samples) */
export async function openServerFile(area: 'projects' | 'autosave' | 'backups' | 'samples', name: string) {
  const h = area === 'projects' ? srvHandle(area, name) : null; // backups, autosave and samples open as copies: Save asks for a name
  try { const b = await readFile(area, name); await openBlob(b, name, h); } catch (e: any) { notify(`Could not open ${name}: ${e?.message || e}`, 'err'); }
}
export async function checkRecovery() {
  const all = await recoveryT.all(); if (!all.length) return;
  for (const r of all) {
    const a = await confirmDlg('Recover unsaved work?', `HYDRA closed with unsaved changes to “${r.name}”. A recovery copy from ${new Date(r.date).toLocaleString()} is available.`, [{ label: 'Discard', value: 'discard', danger: true }, { label: 'Recover', value: 'recover', primary: true }]);
    if (a === 'recover') { const { p } = await fromZip(r.blob); const rec = recents.value.find(x => x.id === p.manifest.projectId); await setProject(p, { dirty: true, handle: rec?.handle || null, replace: !!docs.value.find(d => docProject(d.key)?.manifest.projectId === p.manifest.projectId) }); notify(`Recovered “${p.manifest.name}” — save to keep it`, 'warn'); }
    else await recoveryT.del(r.key);
  }
}
