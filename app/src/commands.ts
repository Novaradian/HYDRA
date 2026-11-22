// One command registry: menus, toolbar, Custom Tab, command search, stars and shortcuts all call these.
import hotkeys from 'hotkeys-js';
import { t } from './i18n';
import * as S from './store';
import * as Pj from './project';
import { openTool } from './tools';
import { exportLibrary, importLibraryFiles, starSelection, editSelection, deleteSelection, openDesigner, focusPanel, toggleGroup, resetLayout, fullscreen } from './actions';
import { D, hasClip as desClip, pins, savePins } from './designer/state';
import * as LC from './plc/state';
import { simView } from './designer/sim';
import * as LXm from './launcher';
import * as AI from './ai/session';

export type Cmd = { id: string; label: string; keys?: string; icon?: string; group: string; run: () => any; enabled?: () => boolean; reason?: string; checked?: () => boolean };
const needP = () => !!S.project.value;
const nodeSel = () => S.selection.value?.kind === 'node' && S.selection.value.ids.length > 0;
// the Circuit Designer registers itself in D while its tab is shown; edit / view / export commands route to it
const des = () => D.value;
const NODES = 'Select sheets or programs in Machine Circuits';
const DES = 'Open a hydraulic or pneumatic sheet in the Circuit Designer';
const dsel = () => !!des()?.hasSel();
const exp = (k: string) => () => des()?.exportAs(k);

export const COMMANDS: Cmd[] = [
  // File
  { id: 'file.new', label: 'New Project…', keys: 'ctrl+n,alt+n', icon: 'file-plus', group: 'File', run: () => S.openModal('newProject') },
  { id: 'file.open', label: 'Open Project…', keys: 'ctrl+o', icon: 'folder-open', group: 'File', run: () => Pj.openProject() },
  { id: 'file.recent', label: 'Open Recent', icon: 'history', group: 'File', run: () => focusPanel('history') },
  { id: 'file.folder', label: 'Show Project Folder', icon: 'folder-open', group: 'File', run: () => LXm.reveal('projects'), enabled: () => !!LXm.LX.value, reason: 'Start HYDRA with HYDRA.bat to work in a project folder' },
  { id: 'file.install', label: 'Install HYDRA as an App', icon: 'download', group: 'File', run: () => LXm.installApp(), enabled: () => LXm.canInstall.value, reason: 'Start HYDRA with HYDRA.bat (Chrome or Edge) to install it as an app' },
  { id: 'file.save', label: 'Save', keys: 'ctrl+s', icon: 'save', group: 'File', run: () => Pj.save(), enabled: needP, reason: 'Open or create a project first' },
  { id: 'file.saveAs', label: 'Save As…', keys: 'ctrl+shift+s', icon: 'save-all', group: 'File', run: () => Pj.saveAs(), enabled: needP, reason: 'Open or create a project first' },
  { id: 'file.saveAll', label: 'Save All', icon: 'save-all', group: 'File', run: () => { Pj.save(); S.toast('Valve Creator and Symbol Sketcher save from their own windows'); }, enabled: needP, reason: 'Open or create a project first' },
  { id: 'file.import', label: 'Import…', icon: 'import', group: 'File', run: () => S.openModal('import') },
  { id: 'file.exportJson', label: 'Export Project JSON', icon: 'file-json', group: 'File', run: () => Pj.exportJson(), enabled: needP, reason: 'Open or create a project first' },
  { id: 'file.exportLib', label: 'Export Custom Library (.hydralib)', icon: 'package', group: 'File', run: () => exportLibrary(S.customLib.value), enabled: () => S.customLib.value.length > 0, reason: 'The Custom Library is empty' },
  { id: 'file.exportPdf', label: 'Export PDF (vector)', icon: 'file-down', group: 'File', run: exp('pdf'), enabled: () => !!des(), reason: DES },
  { id: 'file.exportSvg', label: 'Export SVG', icon: 'file-down', group: 'File', run: exp('svg'), enabled: () => !!des(), reason: DES },
  { id: 'file.exportPng', label: 'Export PNG', icon: 'file-down', group: 'File', run: exp('png'), enabled: () => !!des(), reason: DES },
  { id: 'file.exportDxf', label: 'Export DXF', icon: 'file-down', group: 'File', run: exp('dxf'), enabled: () => !!des(), reason: DES },
  { id: 'file.exportBom', label: 'Export BOM (CSV / XLSX)', icon: 'sheet', group: 'File', run: async () => { const r = await S.confirmDlg('Export parts list', 'Choose the file format for the parts list of this sheet.', [{ label: 'Excel (.xlsx)', value: 'xlsx', primary: true }, { label: 'CSV', value: 'csv' }, { label: 'Cancel', value: '' }]); if (r) des()?.exportAs(r); }, enabled: () => !!des(), reason: DES },
  { id: 'file.print', label: 'Print…', keys: 'ctrl+p', icon: 'printer', group: 'File', run: exp('print'), enabled: () => !!des(), reason: DES },
  { id: 'file.props', label: 'Project Properties…', icon: 'info', group: 'File', run: () => S.openModal('projectProps'), enabled: needP, reason: 'Open or create a project first' },
  { id: 'file.close', label: 'Close Project', icon: 'x-square', group: 'File', run: () => Pj.closeProject(), enabled: needP, reason: 'No project is open' },
  { id: 'file.closeAll', label: 'Close All Projects', icon: 'x-square', group: 'File', run: () => Pj.closeAll(), enabled: () => S.docs.value.length > 1, reason: 'Only one project is open' },
  { id: 'file.exit', label: 'Exit', icon: 'log-out', group: 'File', run: async () => { if (await Pj.closeAll()) { window.close(); S.toast('Close this browser tab to exit HYDRA'); } } },
  // Edit
  { id: 'edit.undo', label: 'Undo', keys: 'ctrl+z', icon: 'undo-2', group: 'Edit', run: () => LC.lcApi.value ? LC.lcApi.value.undo() : S.undo(), enabled: () => !!LC.lcApi.value || S.canUndo.value, reason: 'Nothing to undo' },
  { id: 'edit.redo', label: 'Redo', keys: 'ctrl+y,ctrl+shift+z', icon: 'redo-2', group: 'Edit', run: () => LC.lcApi.value ? LC.lcApi.value.redo() : S.redo(), enabled: () => !!LC.lcApi.value || S.canRedo.value, reason: 'Nothing to redo' },
  { id: 'edit.cut', label: 'Cut', keys: 'ctrl+x', icon: 'scissors', group: 'Edit', run: () => { if (des()) return des()!.cut(); S.copyNodes(S.selection.value!.ids); S.deleteNodes(S.selection.value!.ids); }, enabled: () => des() ? dsel() : nodeSel(), reason: NODES },
  { id: 'edit.copy', label: 'Copy', keys: 'ctrl+c', icon: 'copy', group: 'Edit', run: () => des() ? des()!.copy() : S.copyNodes(S.selection.value!.ids), enabled: () => des() ? dsel() : nodeSel(), reason: NODES },
  { id: 'edit.paste', label: 'Paste', keys: 'ctrl+v', icon: 'clipboard-paste', group: 'Edit', run: () => { if (des()) return des()!.paste(); const m = S.pasteNodes(S.selection.value?.kind === 'node' ? S.selection.value.ids[0] : null); if (m?.length) S.selection.value = { kind: 'node', ids: m }; }, enabled: () => des() ? desClip.value : needP() && S.hasClip.value, reason: 'Nothing copied yet' },
  { id: 'edit.delete', label: 'Delete', keys: 'del', icon: 'trash-2', group: 'Edit', run: () => des() ? des()!.del() : deleteSelection(), enabled: () => des() ? dsel() : ['node', 'custom', 'recent'].includes(S.selection.value?.kind || ''), reason: 'Select something to delete' },
  { id: 'edit.rename', label: 'Rename', keys: 'f2', icon: 'pencil-line', group: 'Edit', run: () => S.openModal('rename'), enabled: () => ['node', 'custom'].includes(S.selection.value?.kind || '') && S.selection.value!.ids.length === 1, reason: 'Select one sheet, program or custom part' },
  { id: 'edit.selectAll', label: 'Select All', keys: 'ctrl+a', icon: 'box-select', group: 'Edit', run: () => des()?.selectAll(), enabled: () => !!des(), reason: DES },
  { id: 'edit.group', label: 'Group / Ungroup (enclosure)', keys: 'ctrl+g', icon: 'group', group: 'Edit', run: () => des()?.group(), enabled: dsel, reason: 'Select parts on a circuit sheet' },
  { id: 'edit.rotate', label: 'Rotate Selection', keys: 'r', icon: 'rotate-cw', group: 'Edit', run: () => des()?.rotate(), enabled: () => !!des(), reason: DES },
  { id: 'des.mirror', label: 'Mirror Selection', keys: 'm', icon: 'flip-horizontal', group: 'Edit', run: () => des()?.mirror(), enabled: () => !!des(), reason: DES },
  { id: 'edit.star', label: 'Star Selected Item', keys: 'ctrl+d', icon: 'star', group: 'Edit', run: () => starSelection(), enabled: () => !!S.selection.value, reason: 'Select something to star' },
  { id: 'edit.item', label: 'Edit Selected Item', icon: 'pencil', group: 'Edit', run: () => editSelection() },
  { id: 'edit.search', label: 'Search Library', keys: 'ctrl+f', icon: 'search', group: 'Edit', run: () => focusPanel('components', true) },
  { id: 'edit.palette', label: 'Command Search', keys: 'ctrl+k', icon: 'command', group: 'Edit', run: () => S.openModal('palette') },
  // Menu (tools)
  { id: 'tool.symbol', label: 'New Symbol (Symbol Sketcher)', icon: 'pen-tool', group: 'Menu', run: () => openTool('symbol') },
  { id: 'tool.valve', label: 'New Valve (Valve Creator)', icon: 'git-fork', group: 'Menu', run: () => openTool('valve') },
  { id: 'menu.libManager', label: 'Library Manager…', icon: 'library-big', group: 'Menu', run: () => S.openModal('libManager') },
  { id: 'menu.controller', label: 'Open Controller (HMI) — operator panel', icon: 'monitor', group: 'Menu', run: () => import('./plc/panel/Panel').then(m => m.openPanelTab()), enabled: () => !!S.project.value && LC.programNodes(S.project.value).length > 0, reason: 'Add a PLC program first' },
  { id: 'menu.ruleCheck', label: 'Run Rule Check', keys: 'f7', icon: 'shield-check', group: 'Menu', run: () => des()?.ruleCheck(), enabled: () => !!des(), reason: DES },
  { id: 'menu.calc', label: 'Calculators…', icon: 'calculator', group: 'Menu', run: () => S.openModal('calc') },
  { id: 'menu.units', label: 'Unit Converter…', icon: 'ruler', group: 'Menu', run: () => S.openModal('units') },
  { id: 'ai.panel', label: 'HYDRA AI', keys: '`', icon: 'sparkles', group: 'Menu', run: () => AI.togglePanel(), enabled: () => AI.aiOn.value, reason: 'Turn on AI features in Settings › AI & Connections' },
  // Launchers
  { id: 'launch.hydraulic', label: 'Hydraulic / Pneumatic Designer', icon: 'droplets', group: 'Launch', run: () => openDesigner('hydraulic') },
  { id: 'launch.electric', label: 'Electric Circuit Designer', icon: 'zap', group: 'Launch', run: () => openDesigner('electric') },
  { id: 'launch.logic', label: 'Logic Coder', icon: 'binary', group: 'Launch', run: () => openDesigner('logic') },
  // Insert (Circuit Designer tools)
  { id: 'des.select', label: 'Select Tool', keys: 'v', icon: 'mouse-pointer', group: 'Insert', run: () => des()?.setTool('select'), enabled: () => !!des(), reason: DES },
  { id: 'des.work', label: 'Working Line', keys: 'w', icon: 'route', group: 'Insert', run: () => des()?.setTool('work'), enabled: () => !!des(), reason: DES },
  { id: 'des.pilot', label: 'Pilot Line', keys: 'p', icon: 'spline', group: 'Insert', run: () => des()?.setTool('pilot'), enabled: () => !!des(), reason: DES },
  { id: 'des.drain', label: 'Drain / Leakage Line', keys: 'd', icon: 'corner-down-right', group: 'Insert', run: () => des()?.setTool('drain'), enabled: () => !!des(), reason: DES },
  { id: 'des.junction', label: 'Junction', keys: 'j', icon: 'git-commit-horizontal', group: 'Insert', run: () => des()?.setTool('junction'), enabled: () => !!des(), reason: DES },
  { id: 'des.text', label: 'Text', keys: 't', icon: 'type', group: 'Insert', run: () => des()?.setTool('text'), enabled: () => !!des(), reason: DES },
  { id: 'des.enclosure', label: 'Enclosure (assembly boundary)', keys: 'e', icon: 'square-dashed', group: 'Insert', run: () => des()?.setTool('enclosure'), enabled: () => !!des(), reason: DES },
  { id: 'des.part', label: 'Part from Library…', keys: 'i', icon: 'component', group: 'Insert', run: () => des()?.focusParts(), enabled: () => !!des(), reason: DES },
  // Circuit
  { id: 'des.renumber', label: 'Renumber Tags (ISO 1219-2)', icon: 'list-ordered', group: 'Circuit', run: () => des()?.renumber(), enabled: () => !!des(), reason: DES },
  { id: 'des.netlist', label: 'Export Simulation Netlist (JSON)', icon: 'network', group: 'Circuit', run: exp('netlist'), enabled: () => !!des(), reason: DES },
  { id: 'des.sheet', label: 'Sheet & Title Block…', icon: 'file-text', group: 'Circuit', run: () => des()?.sheetProps(), enabled: () => !!des(), reason: DES },
  { id: 'sim.run', label: 'Run Simulation', keys: 'f5', icon: 'play', group: 'Simulation', run: () => LC.lcApi.value ? LC.run(LC.lcApi.value.progId) : des()?.simRun(), enabled: () => !!des() || !!LC.lcApi.value, reason: DES },
  { id: 'sim.pause', label: 'Pause / Resume Simulation', keys: 'f6', icon: 'pause', group: 'Simulation', run: () => { const r = LC.RT.value; if (LC.lcApi.value && r?.progId === LC.lcApi.value.progId) { r.rt.state === 'running' ? LC.pause() : LC.run(r.progId); return; } des()?.simPause(); }, enabled: () => !!simView.value || !!(LC.lcApi.value && LC.RT.value), reason: 'No simulation is running' },
  { id: 'sim.stop', label: 'Stop Simulation', keys: 'shift+f5', icon: 'square', group: 'Simulation', run: () => { if (LC.lcApi.value && LC.RT.value) { LC.stop(); return; } des()?.simStop(); }, enabled: () => !!simView.value || !!(LC.lcApi.value && LC.RT.value), reason: 'No simulation is running' },
  { id: 'sim.step', label: 'Step Simulation (10 ms)', icon: 'step-forward', group: 'Simulation', run: () => des()?.simStep(), enabled: () => !!simView.value && !simView.value.running, reason: 'Pause the simulation first' },
  { id: 'sim.pilot', label: 'Pilot Pressure Switches Valves', icon: 'gauge', group: 'Simulation', run: () => S.saveSettings({ ...S.settings.value, solver: { ...S.settings.value.solver, pilotAuto: !((S.settings.value.solver as any).pilotAuto !== false) } as any }), checked: () => (S.settings.value.solver as any).pilotAuto !== false },
  { id: 'des.machine', label: 'Build Machine from Assemblies', icon: 'wand-2', group: 'Circuit', run: async () => { const { buildMachine } = await import('./designer/asm'); const id = buildMachine(); if (id) S.openSheetTab(id); }, enabled: needP, reason: 'Open or create a project first' },
  { id: 'des.port', label: 'Interface Port (X)', keys: 'x', icon: 'square-plus', group: 'Insert', run: () => des()?.placePort?.(), enabled: () => !!des(), reason: DES },
  { id: 'des.leftPane', label: 'Designer Parts Panel', keys: 'ctrl+[', icon: 'panel-left', group: 'View', run: () => des()?.togglePane('left'), enabled: () => !!des(), reason: DES },
  { id: 'des.rightPane', label: 'Designer Properties Panel', keys: 'ctrl+]', icon: 'panel-right', group: 'View', run: () => des()?.togglePane('right'), enabled: () => !!des(), reason: DES },
  { id: 'view.pinTop', label: 'Pin Top Bars', icon: 'pin', group: 'View', run: () => { pins.value = { ...pins.value, top: !pins.value.top }; savePins(); }, checked: () => pins.value.top },
  { id: 'view.pinTools', label: 'Pin Designer Toolbar', icon: 'pin', group: 'View', run: () => { pins.value = { ...pins.value, tools: !pins.value.tools }; savePins(); }, checked: () => pins.value.tools },
  // Preference
  { id: 'sim.anim', label: 'Flow Arrows', icon: 'move-right', group: 'Simulation', run: () => { const m = S.prefs.value.sim; S.savePrefs({ ...S.prefs.value, sim: { ...m, anim: !m.anim } }); }, checked: () => !!S.prefs.value.sim?.anim },
  { id: 'sim.prefs', label: 'Simulation Preferences…', icon: 'sliders-horizontal', group: 'Simulation', run: () => S.openModal('prefs', { tab: 'sim' }) },
  { id: 'pref.open', label: 'Preferences…', icon: 'sliders-horizontal', group: 'Preference', run: () => S.openModal('prefs', { tab: 'general' }) },
  { id: 'pref.si', label: 'Units: SI (MPa)', icon: 'ruler', group: 'Preference', run: () => setUnits('SI'), checked: () => S.prefs.value.unitSystem === 'SI' },
  { id: 'pref.sibar', label: 'Units: SI-bar (bar)', icon: 'ruler', group: 'Preference', run: () => setUnits('SI-bar'), checked: () => S.prefs.value.unitSystem === 'SI-bar' },
  { id: 'pref.imp', label: 'Units: Imperial (psi)', icon: 'ruler', group: 'Preference', run: () => setUnits('Imperial'), checked: () => S.prefs.value.unitSystem === 'Imperial' },
  { id: 'pref.snap', label: 'Default Snapping…', icon: 'magnet', group: 'Preference', run: () => S.openModal('prefs', { tab: 'general' }) },
  { id: 'pref.lang', label: 'Language…', icon: 'languages', group: 'Preference', run: () => S.openModal('prefs', { tab: 'language' }) },
  { id: 'pref.keys', label: 'Keyboard Shortcuts…', icon: 'keyboard', group: 'Preference', run: () => S.openModal('prefs', { tab: 'shortcuts' }) },
  // Settings
  { id: 'set.appearance', label: 'Appearance…', icon: 'palette', group: 'Settings', run: () => S.openModal('settings', { tab: 'appearance' }) },
  { id: 'set.solver', label: 'Solver & Fluid…', icon: 'gauge', group: 'Settings', run: () => S.openModal('settings', { tab: 'solver' }) },
  { id: 'set.perf', label: 'Performance…', icon: 'cpu', group: 'Settings', run: () => S.openModal('settings', { tab: 'performance' }) },
  { id: 'set.storage', label: 'Storage & Recovery…', icon: 'hard-drive', group: 'Settings', run: () => S.openModal('settings', { tab: 'storage' }) },
  { id: 'set.contrast', label: 'High-Contrast Theme', icon: 'contrast', group: 'Settings', run: () => S.saveSettings({ ...S.settings.value, theme: S.settings.value.theme === 'contrast' ? 'light' : 'contrast' }), checked: () => S.settings.value.theme === 'contrast' },
  // View
  { id: 'view.left', label: 'Left Sidebar', icon: 'panel-left', group: 'View', run: () => toggleGroup('left'), checked: () => S.sidebarVis.value.left },
  { id: 'view.right', label: 'Inspector', icon: 'panel-right', group: 'View', run: () => toggleGroup('right'), checked: () => S.sidebarVis.value.right },
  { id: 'view.full', label: 'Full Screen', keys: 'f11', icon: 'maximize', group: 'View', run: () => fullscreen() },
  { id: 'view.reset', label: 'Reset Layout', icon: 'layout-dashboard', group: 'View', run: () => resetLayout() },
  { id: 'view.ids', label: 'Show IDs / Tags', icon: 'tag', group: 'View', run: () => S.saveSettings({ ...S.settings.value, showIds: !S.settings.value.showIds }), checked: () => S.settings.value.showIds },
  { id: 'view.tileS', label: 'Tiles: Small', icon: 'grid-3x3', group: 'View', run: () => S.saveSettings({ ...S.settings.value, tileSize: 'small' }), checked: () => S.settings.value.tileSize === 'small' },
  { id: 'view.tileM', label: 'Tiles: Medium', icon: 'grid-2x2', group: 'View', run: () => S.saveSettings({ ...S.settings.value, tileSize: 'medium' }), checked: () => S.settings.value.tileSize === 'medium' },
  { id: 'view.tileL', label: 'Tiles: Large', icon: 'square', group: 'View', run: () => S.saveSettings({ ...S.settings.value, tileSize: 'large' }), checked: () => S.settings.value.tileSize === 'large' },
  { id: 'view.samples', label: 'Sample Libraries', icon: 'library', group: 'View', run: () => focusPanel('samples') },
  { id: 'view.grid', label: 'Grid On / Off', keys: 'g', icon: 'grid-3x3', group: 'View', run: () => des()?.toggle('grid'), enabled: () => !!des(), reason: DES },
  { id: 'view.snapToggle', label: 'Snap On / Off', keys: 's', icon: 'magnet', group: 'View', run: () => des()?.toggle('snap'), enabled: () => !!des(), reason: DES },
  { id: 'des.ortho', label: 'Orthogonal Lines On / Off', keys: 'o', icon: 'corner-down-right', group: 'View', run: () => des()?.toggle('ortho'), enabled: () => !!des(), reason: DES },
  { id: 'des.ports', label: 'Show Open Ports', icon: 'circle-dot', group: 'View', run: () => des()?.toggle('ports'), enabled: () => !!des(), reason: DES },
  { id: 'des.dock', label: 'Rule Check / Parts List Panel', keys: 'ctrl+j', icon: 'panel-bottom', group: 'View', run: () => des()?.toggleDock(), enabled: () => !!des(), reason: DES },
  { id: 'view.zoomIn', label: 'Zoom In', keys: 'ctrl+=,=', icon: 'zoom-in', group: 'View', run: () => des()?.zoom('in'), enabled: () => !!des(), reason: DES },
  { id: 'view.zoomOut', label: 'Zoom Out', keys: 'ctrl+-,-', icon: 'zoom-out', group: 'View', run: () => des()?.zoom('out'), enabled: () => !!des(), reason: DES },
  { id: 'view.zoomFit', label: 'Zoom to Fit', keys: 'ctrl+0,f', icon: 'scan', group: 'View', run: () => des()?.zoom('fit'), enabled: () => !!des(), reason: DES },
  { id: 'view.multi', label: 'Multi-Window Layout (2nd monitor) — operator panel', icon: 'app-window', group: 'View', run: () => { const id = LC.activeProgId(S.project.value); if (id) import('./plc/panel/Panel').then(m => m.popOut(id)); }, enabled: () => !!LC.activeProgId(S.project.value) && !!(S.project.value?.programs[LC.activeProgId(S.project.value)!] as any)?.panel, reason: 'Build an operator panel first (Menu › Open Controller)' },
  // Workspace
  { id: 'ws.hydraulic', label: 'Workspace: Hydraulic', icon: 'droplets', group: 'Workspace', run: () => setWs('hydraulic'), checked: () => S.workspace.value === 'hydraulic' },
  { id: 'ws.electrical', label: 'Workspace: Electrical', icon: 'zap', group: 'Workspace', run: () => setWs('electrical'), checked: () => S.workspace.value === 'electrical' },
  { id: 'ws.plc', label: 'Workspace: PLC', icon: 'binary', group: 'Workspace', run: () => setWs('plc'), checked: () => S.workspace.value === 'plc' },
  // Help
  { id: 'help.docs', label: 'Documentation', keys: 'f1', icon: 'book-open', group: 'Help', run: () => S.openModal('docs') },
  { id: 'help.symbols', label: 'ISO 1219 / IEC 60617 Symbol Reference', icon: 'shapes', group: 'Help', run: () => S.openModal('symbolRef') },
  { id: 'help.keys', label: 'Keyboard Shortcuts', keys: 'shift+/', icon: 'keyboard', group: 'Help', run: () => S.openModal('keys') },
  { id: 'help.tour', label: 'Sample Project Tour', icon: 'map', group: 'Help', run: () => S.tour.value = 0 },
  { id: 'help.updates', label: 'Check for Updates', icon: 'refresh-cw', group: 'Help', run: () => S.notify(`HYDRA ${S.APP_VERSION} is an offline build. New versions arrive as zip packages; nothing is downloaded automatically.`, 'info') },
  { id: 'help.about', label: 'About HYDRA', icon: 'info', group: 'Help', run: () => S.openModal('about') },
  { id: 'help.issue', label: 'Report an Issue', icon: 'bug', group: 'Help', run: () => S.openModal('issue') },
  // Custom Tab
  { id: 'custom.edit', label: 'Customize Custom Tab…', icon: 'layout-list', group: 'Custom', run: () => S.openModal('prefs', { tab: 'custom' }) }
];
function setUnits(u: any) { S.savePrefs({ ...S.prefs.value, unitSystem: u }); S.toast(`Unit system: ${u}`); }
function setWs(w: any) { S.workspace.value = w; import('./db').then(m => m.kvSet('workspace', w)); }
export const cmd = (id: string) => COMMANDS.find(c => c.id === id);
export const isEnabled = (c: Cmd) => !c.enabled || c.enabled();
export const keysOf = (c: Cmd) => S.prefs.value.shortcuts[c.id] ?? c.keys ?? '';
export function runCmd(id: string) {
  const c = cmd(id); if (!c) return;
  if (!isEnabled(c)) { S.toast(c.reason || 'Not available', 'warn'); return; }
  try { const r = c.run(); if (r && r.catch) r.catch((e: any) => S.notify(String(e?.message || e), 'err')); } catch (e: any) { S.notify(String(e?.message || e), 'err'); }
}
export const label = (c: Cmd) => t(c.label);

// ---------- keyboard ----------
const INPUT_OK = new Set(['file.save', 'file.saveAs', 'file.open', 'edit.palette', 'help.docs', 'sim.run', 'sim.pause', 'sim.stop', 'menu.ruleCheck', 'file.new']);
export function bindKeys() {
  hotkeys.unbind();
  hotkeys.filter = () => true;
  COMMANDS.forEach(c => {
    const k = keysOf(c); if (!k) return;
    hotkeys(k, (e) => {
      const tag = (e.target as HTMLElement)?.tagName; const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target as HTMLElement)?.isContentEditable;
      if (S.modal.value && c.id !== 'edit.palette') return;
      if (typing && !INPUT_OK.has(c.id) && !e.altKey && !/^F\d+$/.test(e.key)) return;
      if (c.id === 'view.full') return; // leave F11 to the browser
      if (LC.lcApi.value && /^edit\.(cut|copy|paste|delete|selectAll|rotate|group)$|^des\./.test(c.id) && !typing) return; // the block editor handles its own clipboard keys
      if (LC.peApi.value && /^edit\.(cut|copy|paste|delete|selectAll|rotate|group)$|^des\./.test(c.id)) { if (typing) return; e.preventDefault(); if (c.id === 'edit.delete') LC.peApi.value.del(); return; }
      if (!isEnabled(c) && !e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d+$/.test(e.key)) return; // bare letters stay quiet outside the designer
      e.preventDefault(); runCmd(c.id);
    });
  });
}
