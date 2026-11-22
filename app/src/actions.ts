// Cross-cutting actions used by commands, panels, tiles and the inspector
import * as S from './store';
import { STD, stdToSketchSpec, SAMPLES } from './symbols';
import { openTool } from './tools';
import { uid, nowIso, clone, download } from './util';
import { openBlob, sampleProject, setProject, addSampleSheets } from './project';
export { focusPanel, toggleGroup, resetLayout, fullscreen } from './layout';
import { focusPanel } from './layout';

export const stdById = (id: string) => STD.find(x => x.id === id) || S.stdValveItems.value.find((x: any) => x.id === id);
export const libById = (id: string) => S.customLib.value.find(x => x.item_id === id);
export const DESIGNER_TITLE: Record<string, string> = { hydraulic: 'Hydraulic / Pneumatic Designer', electric: 'Electric Circuit Designer', logic: 'Logic Coder' };

export function openDesigner(kind: 'hydraulic' | 'electric' | 'logic', nodeId?: string) {
  if (nodeId && S.project.value?.nodes[nodeId]) { S.openSheetTab(nodeId); return; }
  const id = 'des_' + kind;
  if (!S.tabs.value.find(t => t.id === id)) S.tabs.value = [...S.tabs.value, { id, title: DESIGNER_TITLE[kind], kind: 'designer', designer: kind, docKey: S.activeDoc.value }];
  S.activeTab.value = id;
}
export function openNode(id: string) {
  const n = S.project.value?.nodes[id]; if (!n) return;
  if (n.type === 'sheet' || n.type === 'program') S.openSheetTab(id);
}
export function duplicateStdToCustom(stdId: string) {
  const it: any = stdById(stdId); if (!it) return null;
  const now = nowIso(); let rec: any;
  if (it.valve) {
    const def = { ...clone(it.valve), id: uid('valve'), name: it.name + ' (copy)' };
    rec = { item_id: def.id, type: 'valve', name: def.name, domain: it.domain, version: 1, author: '', created: now, modified: now, definition: def, ports: [], spec_profile: { matrix: def.matrix, classification: def.classification, nominalSize: def.nominalSize }, behavior_template: 'valve', tags: [...it.tags], status: 'valid', source: stdId };
  } else {
    const sid = uid('sym'); const spec = stdToSketchSpec(it, sid);
    rec = { item_id: sid, type: 'symbol', name: spec.name, domain: it.domain, version: 1, author: '', created: now, modified: now, definition: spec, ports: spec.port_nodes.map((p: any) => ({ name: p.name, domain: p.domain, direction: p.direction, x: p.x, y: p.y, orientation: p.orientation, role: p.role })), spec_profile: { module_length: 20 }, behavior_template: it.template, tags: [...it.tags], status: 'valid', source: stdId };
  }
  S.libWrite([...S.libLoad(), rec]);
  S.selection.value = { kind: 'custom', ids: [rec.item_id] };
  S.notify(`“${rec.name}” added to the Custom Library — editable copy`, 'ok');
  return rec;
}
export function exportLibrary(items: any[], name = 'hydra_custom_library') {
  if (!items.length) { S.toast('Nothing to export', 'warn'); return; }
  download(name + '.hydralib', JSON.stringify({ format: 'hydra.lib', version: 1, exported: nowIso(), items }, null, 2), 'application/json');
  S.toast(`Exported ${items.length} item${items.length > 1 ? 's' : ''}`, 'ok');
}
export async function importLibraryFiles(files: File[]) {
  let added = 0, replaced = 0, skipped = 0; const errs: string[] = [];
  const arr = S.libLoad();
  for (const f of files) {
    const lower = f.name.toLowerCase();
    if (lower.endsWith('.hydra') || (lower.endsWith('.json') && !lower.endsWith('.hydralib'))) {
      try { const txt = lower.endsWith('.json') ? await f.text() : ''; if (lower.endsWith('.json') && !txt.includes('hydra.project.json')) throw 0; await openBlob(f, f.name); continue; } catch { /* fall through to library parse */ }
    }
    try {
      const o = JSON.parse(await f.text());
      let items: any[] = o.format === 'hydra.lib' ? o.items : Array.isArray(o) ? o : [o];
      items = items.map(x => x.item_id ? x : (x.schema === 'hydra.symbol/1' || x.schema_version) ? { item_id: x.symbol_id || uid('sym'), type: 'symbol', name: x.name || 'Imported symbol', domain: x.domain || 'hydraulic', version: 1, author: '', created: nowIso(), modified: nowIso(), definition: x, ports: [], behavior_template: x.behavior_template || 'passive', tags: [], status: 'needs_review' } : x.schema === 'hydra.valve/1' ? { item_id: x.id || uid('valve'), type: 'valve', name: x.name || 'Imported valve', domain: x.domain, version: 1, author: '', created: nowIso(), modified: nowIso(), definition: x, ports: [], behavior_template: 'valve', tags: [x.matrix], status: 'needs_review' } : null).filter(Boolean);
      if (!items.length) throw new Error('no HYDRA library items found');
      items.forEach(it => { if (!it.type || !it.definition) { skipped++; return; } const i = arr.findIndex(x => x.item_id === it.item_id); if (i < 0) { arr.push(it); added++; } else if ((it.version || 0) >= (arr[i].version || 0)) { arr[i] = it; replaced++; } else skipped++; });
    } catch (e: any) { errs.push(`${f.name}: ${e?.message || 'not a HYDRA file'}`); }
  }
  if (added || replaced) S.libWrite(arr);
  if (added || replaced || skipped) S.notify(`Library import: ${added} added, ${replaced} updated${skipped ? `, ${skipped} skipped (older or invalid)` : ''}`, 'ok');
  errs.forEach(e => S.notify('Import failed — ' + e, 'err'));
}
export function starSelection() {
  const s = S.selection.value; if (!s || !s.ids.length) return;
  const id = s.ids[0]; const proj = !!S.project.value;
  if (s.kind === 'std') { const it: any = stdById(id); S.isStarred('std:' + id) ? S.removeStar('std:' + id) : S.addStar({ type: 'library_item', target_ref: 'std:' + id, label: it.name, icon: 'component', scope: proj ? 'project' : 'global' }); }
  if (s.kind === 'custom') { const it = libById(id); if (it) S.isStarred('lib:' + id) ? S.removeStar('lib:' + id) : S.addStar({ type: 'library_item', target_ref: 'lib:' + id, label: it.name, icon: it.type === 'valve' ? 'git-fork' : 'pen-tool', scope: proj ? 'project' : 'global' }); }
  if (s.kind === 'node') { const n = S.project.value?.nodes[id]; if (n && (n.type === 'sheet' || n.type === 'program')) S.isStarred('node:' + id) ? S.removeStar('node:' + id) : S.addStar({ type: n.type === 'sheet' ? 'circuit' : 'program', target_ref: 'node:' + id, label: n.name, icon: n.type === 'program' ? 'binary' : n.sheetType === 'electric' ? 'zap' : 'droplets', scope: 'project' }); else S.toast('Star sheets and programs; the machine and assemblies are containers', 'warn'); }
  if (s.kind === 'sample') { const sm = SAMPLES.find(x => x.id === id); if (sm) S.isStarred('sample:' + id) ? S.removeStar('sample:' + id) : S.addStar({ type: 'template', target_ref: 'sample:' + id, label: sm.name, icon: 'library', scope: 'global' }); }
  if (s.kind === 'recent') S.toast('Recent projects are pinned with the pin button, not starred', 'info');
}
export function editSelection() {
  const s = S.selection.value; const id = s?.ids[0];
  if (s?.kind === 'custom' && id) { const it = libById(id); if (it) { openTool(it.type === 'valve' ? 'valve' : 'symbol', it); return; } }
  if (s?.kind === 'node' && id) { openNode(id); if (S.project.value?.nodes[id]?.type === 'sheet' || S.project.value?.nodes[id]?.type === 'program') return; S.openModal('rename'); return; }
  if (s?.kind === 'std') { S.toast('Standard parts are read-only — use “Duplicate to Custom Library” to edit a copy', 'info'); return; }
  focusPanel('custom'); S.toast('Pick a custom valve or symbol to edit, or a sheet in Machine Circuits', 'info');
}
export async function deleteSelection() {
  const s = S.selection.value; if (!s || !s.ids.length) return;
  if (s.kind === 'node') {
    const p = S.project.value!; const names = s.ids.map(i => p.nodes[i]?.name).filter(Boolean);
    if (s.ids.includes(p.rootId)) { S.toast('The machine itself cannot be deleted — close the project instead', 'warn'); return; }
    if (S.prefs.value.confirmDelete) { const r = await S.confirmDlg('Delete', `Delete ${names.length > 1 ? names.length + ' items' : `“${names[0]}”`} and everything inside? You can undo this.`, [{ label: 'Cancel', value: 'no' }, { label: 'Delete', value: 'yes', danger: true }]); if (r !== 'yes') return; }
    S.deleteNodes(s.ids); S.selection.value = { kind: 'node', ids: [p.rootId] };
  }
  if (s.kind === 'custom') {
    const items = s.ids.map(libById).filter(Boolean);
    const r = await S.confirmDlg('Delete from Custom Library', `Permanently delete ${items.length > 1 ? items.length + ' items' : `“${items[0].name}”`}? Circuits that already use it keep their placed copy. This cannot be undone.`, [{ label: 'Cancel', value: 'no' }, { label: 'Delete', value: 'yes', danger: true }]);
    if (r !== 'yes') return; S.libWrite(S.libLoad().filter(x => !s.ids.includes(x.item_id))); s.ids.forEach(i => S.removeStar('lib:' + i)); S.selection.value = null; S.toast('Deleted', 'ok');
  }
  if (s.kind === 'recent') { const { removeRecent } = await import('./project'); for (const i of s.ids) await removeRecent(i); S.selection.value = null; }
}
// a sample opens as its own unsaved project next to whatever is already open — nothing has to be saved first
export async function openSampleCopy(sid: string, readOnly = false) {
  const p = sampleProject(sid); await setProject(p, { dirty: false, sample: true, readOnly });
  S.notify(`Opened sample “${p.manifest.name}” — unsaved; Save keeps a copy`, 'ok');
  const first = S.firstFluidSheet(p); if (first) S.openSheetTab(first);
}
export function sampleToProject(sid: string) { if (!S.project.value) return; S.mutate('Add sample sheets', d => addSampleSheets(d as any, sid)); S.toast('Sample sheets added to the project', 'ok'); }

// ---------- stars → targets ----------
export function starLabel(st: S.Star & { custom?: boolean }) {
  if (st.custom) return st.label; const ref = st.target_ref; const id = ref.slice(ref.indexOf(':') + 1);
  if (ref.startsWith('node:')) return S.project.value?.nodes[id]?.name || st.label;
  if (ref.startsWith('lib:')) return libById(id)?.name || st.label;
  return st.label;
}
export function resolveStar(st: S.Star): { ok: boolean; open: () => void } {
  const [kind, id] = [st.target_ref.slice(0, st.target_ref.indexOf(':')), st.target_ref.slice(st.target_ref.indexOf(':') + 1)];
  if (kind === 'cmd') { const { runCmd, cmd } = require_cmds(); const c = cmd(id); return { ok: !!c, open: () => runCmd(id) }; }
  if (kind === 'std') { const it = stdById(id); return { ok: !!it || id.startsWith('v_'), open: () => { S.selection.value = { kind: 'std', ids: [id] }; focusPanel('components'); } }; }
  if (kind === 'lib') { const it = libById(id); return { ok: !!it, open: () => { S.selection.value = { kind: 'custom', ids: [id] }; if (it) openTool(it.type === 'valve' ? 'valve' : 'symbol', it); } }; }
  if (kind === 'node') { const n = S.project.value?.nodes[id]; return { ok: !!n, open: () => { S.selection.value = { kind: 'node', ids: [id] }; openNode(id); } }; }
  if (kind === 'sample') { const sm = SAMPLES.find(x => x.id === id); return { ok: !!sm, open: () => { S.selection.value = { kind: 'sample', ids: [id] }; focusPanel('samples'); } }; }
  return { ok: false, open: () => { } };
}
let _cmds: any = null; export const setCmds = (m: any) => { _cmds = m; }; const require_cmds = () => _cmds;
