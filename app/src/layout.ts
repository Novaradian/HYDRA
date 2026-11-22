// Dockable layout (dockview): left browsers, launchers, centre starred grid, right inspector. Layout is remembered.
import { createDockview, themeLight, type DockviewApi } from 'dockview-core';
import { h, render } from 'preact';
import { kvGet, kvSet } from './db';
import { debounce } from './util';
import { sidebarVis, sidebarFocus } from './store';
import { t } from './i18n';

export let dv: DockviewApi | null = null;
const LEFT = ['history', 'components', 'custom', 'circuits', 'samples'];
export const PANEL_TITLES: Record<string, string> = { history: 'History', components: 'Components', custom: 'Custom', circuits: 'Circuits', samples: 'Samples', launch: 'Launch', starred: 'Starred', inspector: 'Inspector' };

export function defaultLayout(api: DockviewApi) {
  api.clear();
  api.addPanel({ id: 'starred', component: 'starred', title: t(PANEL_TITLES.starred) });
  api.addPanel({ id: 'components', component: 'components', title: t('Components'), position: { referencePanel: 'starred', direction: 'left' }, initialWidth: 372 });
  ['custom', 'circuits', 'samples'].forEach(id => api.addPanel({ id, component: id, title: t(PANEL_TITLES[id]), position: { referencePanel: 'components', direction: 'within' } }));
  api.addPanel({ id: 'launch', component: 'launch', title: t('Launch'), position: { referencePanel: 'components', direction: 'below' }, initialHeight: 250 });
  api.addPanel({ id: 'history', component: 'history', title: t('History'), position: { referencePanel: 'launch', direction: 'within' } });
  api.getPanel('launch')?.api.setActive();
  api.addPanel({ id: 'inspector', component: 'inspector', title: t('Inspector'), position: { referencePanel: 'starred', direction: 'right' }, initialWidth: 350 });
  api.getPanel('components')?.api.setActive();
}
export async function mountDock(el: HTMLElement, panels: Record<string, any>) {
  const api = createDockview(el, {
    theme: themeLight,
    createComponent: (o: any) => {
      const element = document.createElement('div'); element.className = 'dvp'; element.dataset.panel = o.name;
      return { element, init: () => render(h(panels[o.name] || (() => h('div', null, o.name)), {}), element), dispose: () => render(null, element) } as any;
    }
  } as any);
  dv = api;
  const saved = await kvGet<any>('layout', null);
  let ok = false;
  if (saved) { try { api.fromJSON(saved); ok = [...LEFT, 'starred', 'inspector', 'launch'].every(id => api.getPanel(id)); } catch (e) { console.warn('layout restore failed', e); } }
  if (!ok) defaultLayout(api);
  const persist = debounce(() => { try { kvSet('layout', api.toJSON()); } catch { } }, 500);
  api.onDidLayoutChange(() => { persist(); syncVis(); });
  syncVis();
  return api;
}
function syncVis() { if (!dv) return; const l = dv.getPanel('components')?.group, r = dv.getPanel('inspector')?.group; sidebarVis.value = { left: !!l && (l.api as any).isVisible !== false, right: !!r && (r.api as any).isVisible !== false }; }
export function toggleGroup(side: 'left' | 'right') {
  if (!dv) return;
  const ids = side === 'left' ? [...LEFT, 'launch'] : ['inspector'];
  const present = ids.map(id => dv!.getPanel(id)).filter(Boolean) as any[];
  if (!present.length) { defaultLayout(dv); syncVis(); return; }
  const groups = [...new Set(present.map(p => p.group))];
  const vis = groups.some(g => g.api.isVisible !== false);
  groups.forEach(g => { try { g.api.setVisible(!vis); } catch { } });
  syncVis();
}
export function resetLayout() { if (dv) { defaultLayout(dv); kvSet('layout', null); syncVis(); } }
export function focusPanel(id: string, search = false) {
  if (!dv) return; let p = dv.getPanel(id);
  if (!p) { defaultLayout(dv); p = dv.getPanel(id); }
  const g: any = p?.group; if (g && g.api.isVisible === false) g.api.setVisible(true);
  p?.api.setActive(); syncVis();
  sidebarFocus.value = { panel: id, n: Date.now(), search };
}
export function fullscreen() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => { }); }
