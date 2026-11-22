// Opens the Valve Creator / Symbol Sketcher (v1.0) in pop-out windows or an in-app overlay,
// and runs a hidden Valve Creator instance as the ISO valve renderer for library previews.
// A window opened as about:blank and written from this page shares its origin, so the tools' own
// localStorage library, events and host API (window.HydraValveCreator / HydraSymbolSketcher) are reachable.
import VALVE_HTML from '../assets/tools/HYDRA_Valve_Creator.html';
import SKETCH_HTML from '../assets/tools/HYDRA_Symbol_Sketcher.html';
import { signal } from '@preact/signals';
import { libReload, prefs, toast, notify, valveSvgs, stdValveItems } from './store';
import { STD_VALVES, stdValveDef, valveAsStd } from './symbols';

type Kind = 'valve' | 'symbol';
const wins: Record<Kind, Window | null> = { valve: null, symbol: null };
export const overlayTool = signal<{ kind: Kind; item?: any } | null>(null);
export const TOOL_TITLE: Record<Kind, string> = { valve: 'Valve Creator', symbol: 'Symbol Sketcher' };
const API = (w: any, k: Kind) => k === 'valve' ? w?.HydraValveCreator : w?.HydraSymbolSketcher;

function wire(w: Window, k: Kind, close: () => void) {
  w.addEventListener('hydra:library-changed', () => { libReload(); notify(`${TOOL_TITLE[k]} saved to the Custom Library`, 'ok', true); });
  w.addEventListener('hydra:close', () => close());
  w.addEventListener('hydra:window', (e: any) => {
    const a = e.detail?.action;
    if (a === 'max') { try { w.moveTo(0, 0); w.resizeTo(screen.availWidth, screen.availHeight); } catch { } }
    if (a === 'min') { try { w.blur(); window.focus(); } catch { } }
  });
}
function loadInto(w: any, k: Kind, item?: any, blank?: boolean) {
  let n = 0;
  const t = setInterval(() => {
    const api = API(w, k);
    if (api || n++ > 100) {
      clearInterval(t); if (!api) { toast(`${TOOL_TITLE[k]} did not start`, 'err'); return; }
      try {
        if (item) api.load(item.definition);
        else if (blank && k === 'symbol') api.load({ schema: 'hydra.symbol/1', name: '', domain: 'hydraulic' });
      } catch (e: any) { toast(`Could not load “${item?.name}”: ${e?.message || e}`, 'err'); }
    }
  }, 50);
}
export function openTool(k: Kind, item?: any) {
  const html = k === 'valve' ? VALVE_HTML : SKETCH_HTML;
  if (prefs.value.toolMode === 'overlay') { overlayTool.value = { kind: k, item }; return; }
  const cur = wins[k];
  if (cur && !cur.closed) { cur.focus(); if (item) loadInto(cur, k, item); return; }
  const w = window.open('', 'hydra-' + k, `popup,width=${Math.min(1440, screen.availWidth)},height=${Math.min(900, screen.availHeight)}`);
  if (!w) { toast('Pop-up blocked — opening inside HYDRA instead', 'warn'); overlayTool.value = { kind: k, item }; return; }
  w.document.open(); w.document.write(html); w.document.close();
  wins[k] = w; wire(w, k, () => { try { w.close(); } catch { } });
  loadInto(w, k, item, !item);
}
export function wireOverlayFrame(f: HTMLIFrameElement, k: Kind, item: any, close: () => void) {
  const w = f.contentWindow!; wire(w, k, close); loadInto(w, k, item, !item);
}
export const toolHtml = (k: Kind) => k === 'valve' ? VALVE_HTML : SKETCH_HTML;
export function closeToolWindows() { (Object.keys(wins) as Kind[]).forEach(k => { try { wins[k]?.close(); } catch { } }); }

// ---------- hidden ISO valve renderer ----------
let renderer: any = null; const queue: ((r: any) => void)[] = [];
export function startValveRenderer() {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
  f.style.cssText = 'position:fixed;left:-20000px;top:0;width:1200px;height:800px;border:0;visibility:hidden;pointer-events:none';
  f.srcdoc = VALVE_HTML;
  f.onload = () => {
    let n = 0; const t = setInterval(() => {
      const api = (f.contentWindow as any)?.HydraValveCreator;
      if (api || n++ > 100) {
        clearInterval(t); if (!api) { console.warn('valve renderer failed'); return; }
        renderer = api;
        const items = STD_VALVES.map(v => { const d = stdValveDef(v, api.newDefinition); return valveAsStd(v, d); });
        const svgs: Record<string, string> = {};
        items.forEach(it => { try { svgs[it.id] = cleanSvg(api.svgOf(it.valve)); } catch (e) { console.warn(e); } });
        stdValveItems.value = items; valveSvgs.value = { ...valveSvgs.value, ...svgs };
        queue.splice(0).forEach(fn => fn(api));
      }
    }, 50);
  };
  document.body.appendChild(f);
}
export function cleanSvg(s: string) { return String(s || '').replace(/<\?xml[^>]*>/, '').replace(/\swidth="[^"]*mm"/, '').replace(/\sheight="[^"]*mm"/, ''); }
export function valveSvg(def: any, key: string): string {
  const have = valveSvgs.value[key]; if (have) return have;
  if (renderer) { try { const s = cleanSvg(renderer.svgOf(def)); valveSvgs.value = { ...valveSvgs.value, [key]: s }; return s; } catch { return ''; } }
  queue.push(api => { try { valveSvgs.value = { ...valveSvgs.value, [key]: cleanSvg(api.svgOf(def)) }; } catch { } });
  return '';
}
export const valveChecks = (def: any) => { try { return renderer ? renderer.checksOf(def) : []; } catch { return []; } };
