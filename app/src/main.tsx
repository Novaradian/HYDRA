import { h, render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { effect } from '@preact/signals';
import * as S from './store';
import { openDB } from './db';
import * as cmds from './commands';
import { setCmds } from './actions';
import { mountDock } from './layout';
import { TitleBar, Toolbar, TabStrip, StatusBar, DesignerTab, ToolOverlay, Tour } from './ui/shell';
import { HistoryPanel, ComponentsPanel, CustomPanel, CircuitsPanel, SamplesPanel, LaunchPanel, StarredPanel, InspectorPanel } from './ui/panels';
import { ModalHost } from './ui/dialogs';
import { AutoHide } from './designer/Designer';
import { pins } from './designer/state';
import { ContextMenuHost, Toasts } from './ui/common';
import { startValveRenderer, closeToolWindows } from './tools';
import { refreshRecents, startAutosave, checkRecovery, loadDirHandle } from './project';
import { setLanguage } from './i18n';
import { initLauncher } from './launcher';
import { applyTheme } from './theme';
import { AiHost } from './ai/Panel';
import { loadAiSettings } from './ai/settings';
import { startMcpBridge } from './ai/mcp';
import { registerDesktopProviders } from './ai/providers';
import { isDesktop } from './ai/settings';
setCmds(cmds);

const PANELS = { history: HistoryPanel, components: ComponentsPanel, custom: CustomPanel, circuits: CircuitsPanel, samples: SamplesPanel, launch: LaunchPanel, starred: StarredPanel, inspector: InspectorPanel };

function Dock() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { mountDock(ref.current!, PANELS); }, []);
  return <div class="dock" ref={ref} />;
}
function App() {
  const active = S.tabs.value.find(t => t.id === S.activeTab.value) || S.tabs.value[0];
  return <div class="app">
    <AutoHide pinned={pins.value.top} which="top"><div class="topbars"><TitleBar /><Toolbar /><TabStrip /></div></AutoHide>
    <main class="work">
      <div class="homeview" style={{ display: active.kind === 'home' ? 'block' : 'none' }} role="tabpanel" aria-label="Home"><Dock /></div>
      {active.kind === 'designer' && <DesignerTab tab={active} />}
    </main>
    <StatusBar />
    <ModalHost /><ContextMenuHost /><Toasts /><ToolOverlay /><Tour /><AiHost />
  </div>;
}

function applyAppearance() {
  const s = S.settings.value, r = document.documentElement;
  applyTheme(s.themeId, !!s.paperFollow, s.theme === 'contrast'); r.style.fontSize = (s.fontScale / 100 * 12) + 'px';
  r.style.setProperty('--blur', (s.reduceTransparency ? 0 : s.blur) + 'px');
  r.style.setProperty('--glass', s.reduceTransparency ? '#F8FAFC' : 'rgba(248,250,252,.78)');
  r.style.filter = (s.brightness !== 100 || s.contrast !== 100) ? `brightness(${s.brightness}%) contrast(${s.contrast}%)` : '';
  r.classList.toggle('reduce-motion', s.reduceMotion);
}

async function boot() {
  await initLauncher(); // HYDRA.bat: project folder + install-as-app; opened as a file this does nothing
  await openDB();
  await S.loadProfile();
  await loadAiSettings(); // AI features stay off unless the user turned them on
  startMcpBridge(); // HYDRA.exe only: opens the 127.0.0.1 listener while AI + MCP (or the CLI bridge) are on
  if (isDesktop()) registerDesktopProviders();
  await loadDirHandle();
  await (await import('./designer/state')).loadPins();
  setLanguage(S.prefs.value.language);
  effect(applyAppearance);
  render(<App />, document.getElementById('app')!);
  cmds.bindKeys();
  startValveRenderer();
  await refreshRecents();
  startAutosave();
  window.addEventListener('storage', e => { if (e.key === S.LIB_KEY) S.libReload(); });
  window.addEventListener('hydra:library-changed', (e: any) => { if (e.detail?.source !== 'home') S.libReload(); });
  window.addEventListener('beforeunload', e => { if (S.anyDirty()) { e.preventDefault(); (e as any).returnValue = ''; } });
  // a designer tab belongs to one project: showing it makes that project the active document
  effect(() => { const id = S.activeTab.value; const tb = S.tabs.peek().find(t => t.id === id); if (tb?.docKey && tb.docKey !== S.activeDoc.peek()) S.switchDoc(tb.docKey); });
  window.addEventListener('pagehide', () => closeToolWindows()); // pagehide: 'unload' is blocked on http (HYDRA.bat)
  setTimeout(checkRecovery, 400);
  import('./launcher').then(async L => { const f = await L.startupFile(); if (f) (await import('./project')).openBlob(f.blob, f.name, null); }); // HYDRA.exe opened with a .hydra file
  (window as any).HYDRA = { S, cmds, launcher: await import('./launcher'), theme: await import('./theme'), machines: await import('./machines/index'), plc: { state: await import('./plc/state'), compile: await import('./plc/compile'), signals: await import('./plc/signals'), blocks: await import('./plc/blocks'), runtime: await import('./plc/runtime'), link: await import('./plc/link'), panel: await import('./plc/panel/Panel'), pmodel: await import('./plc/panel/model'), prt: await import('./plc/panel/rt'), lc: await import('./plc/LogicCoder') }, Pj: await import('./project'), version: S.APP_VERSION, actions: await import('./actions'), symbols: await import('./symbols'), designer: { st: await import('./designer/state'), model: await import('./designer/model'), elec: await import('./designer/elec'), render: await import('./designer/render'), geom: await import('./designer/geom'), exports: await import('./designer/exports'), sim: await import('./designer/sim'), asm: await import('./designer/asm'), canvas: await import('./designer/Canvas'), tpl: await import('./designer/templates') }, ai: await import('./ai/api') };
}
boot();
