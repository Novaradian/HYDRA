// Themes: Stitch (the default, fixed) + four presets + your own colour themes. A theme only sets CSS tokens on <html>;
// Stitch sets none, so it looks exactly as before. The operator panel keeps its own colours.
export type Theme = { id: string; name: string; vars: Record<string, string>; contrast?: boolean; builtin?: boolean };
export const STITCH = 'stitch';
export const PRESETS: Theme[] = [
  { id: STITCH, name: 'Stitch (default)', vars: {}, builtin: true },
  { id: 'grey', name: 'Light Grey', builtin: true, vars: { '--title': '#343A40', '--title2': '#495057', '--bg': '#E9ECEF', '--panel': '#F8F9FA', '--hdr': '#DEE2E6', '--hdr2': '#E2E6EA', '--soft': '#F1F3F5', '--line': '#CED4DA', '--line2': '#ADB5BD', '--acc': '#3B6EA8', '--acc-d': '#2F5986', '--acc-t': '#DDE7F3', '--glass': 'rgba(241,243,245,.85)', '--desk': '#D3D8DE', '--paper': '#FCFCFC' } },
  { id: 'dark', name: 'Graphite Dark', builtin: true, vars: { '--title': '#0D1117', '--title2': '#21262D', '--bg': '#161B22', '--panel': '#1C232C', '--hdr': '#252D37', '--hdr2': '#222A34', '--soft': '#202833', '--line': '#313B47', '--line2': '#3D4856', '--ink': '#E6EDF3', '--ink2': '#C3CDD8', '--mute': '#8B98A8', '--acc': '#4493F8', '--acc-d': '#2F7BDE', '--acc-t': '#1B3250', '--glass': 'rgba(28,35,44,.88)', '--ok-t': '#14301F', '--warn-t': '#3A2A10', '--err-t': '#3A1615', '--tile': '#D9E0E8', '--desk': '#0F1419', '--paper': '#D9E0E8' } },
  { id: 'blueprint', name: 'Blueprint', builtin: true, vars: { '--title': '#0B2545', '--title2': '#13315C', '--bg': '#E3EBF5', '--panel': '#F7FAFE', '--hdr': '#D2DFEF', '--hdr2': '#DCE6F2', '--soft': '#EDF3FA', '--line': '#B3C6DD', '--line2': '#9DB4D0', '--ink': '#0B2545', '--ink2': '#1D3B63', '--mute': '#4E6584', '--acc': '#13315C', '--acc-d': '#0B2545', '--acc-t': '#D6E3F4', '--glass': 'rgba(237,243,250,.85)', '--desk': '#C7D6E8', '--paper': '#EEF4FB' } },
  { id: 'contrast', name: 'High Contrast', builtin: true, contrast: true, vars: {} }
];
/** the colours a custom theme edits (label, token) */
export const EDITABLE: [string, string][] = [['Title bar', '--title'], ['Background', '--bg'], ['Panels / boxes', '--panel'], ['Box headers', '--hdr'], ['Sheet desk', '--desk'], ['Borders', '--line'], ['Accent / buttons', '--acc'], ['Accent tint', '--acc-t'], ['Text', '--ink'], ['Muted text', '--mute'], ['Paper (when it follows the theme)', '--paper']];
export const STITCH_VARS: Record<string, string> = { '--title': '#26313E', '--bg': '#F3F6F9', '--panel': '#FFFFFF', '--hdr': '#E9EEF3', '--desk': '#DDE4EB', '--line': '#D5DEE7', '--acc': '#0A64C2', '--acc-t': '#E3EEFB', '--ink': '#1B2633', '--mute': '#5B6878', '--paper': '#FFFFFF' };
const KEY = 'hydra.themes.v1';
export function customThemes(): Theme[] { try { const l = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(l) ? l.filter(x => x && x.id && x.vars) : []; } catch { return []; } }
export function saveCustomThemes(l: Theme[]) { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { } }
export const allThemes = () => [...PRESETS, ...customThemes()];
export const themeById = (id?: string) => allThemes().find(t => t.id === id) || PRESETS[0];
/** derived tokens a custom theme does not set itself */
function derive(v: Record<string, string>): Record<string, string> {
  const o = { ...v };
  if (o['--title'] && !o['--title2']) o['--title2'] = mix(o['--title'], '#FFFFFF', 0.12);
  if (o['--acc'] && !o['--acc-d']) o['--acc-d'] = mix(o['--acc'], '#000000', 0.2);
  if (o['--hdr'] && !o['--hdr2']) o['--hdr2'] = o['--hdr'];
  if (o['--panel'] && !o['--soft']) o['--soft'] = mix(o['--panel'], o['--bg'] || '#F3F6F9', 0.5);
  if (o['--line'] && !o['--line2']) o['--line2'] = mix(o['--line'], '#000000', 0.08);
  if (o['--ink'] && !o['--ink2']) o['--ink2'] = mix(o['--ink'], o['--panel'] || '#FFFFFF', 0.2);
  if (o['--panel'] && !o['--glass']) o['--glass'] = o['--panel'];
  return o;
}
export function mix(a: string, b: string, t: number) { const p = (h: string) => { const x = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16) || 0); }; const A = p(a), B = p(b); return '#' + A.map((c, i) => Math.round(c + (B[i] - c) * t).toString(16).padStart(2, '0')).join('').toUpperCase(); }
let applied: string[] = [];
/** apply a theme to the page. Stitch removes every token override. */
export function applyTheme(id: string | undefined, paperFollow: boolean, legacyContrast = false) {
  const th = legacyContrast && (!id || id === STITCH) ? PRESETS[4] : themeById(id); const r = document.documentElement;
  applied.forEach(k => r.style.removeProperty(k)); applied = [];
  const vars = th.builtin ? th.vars : derive(th.vars);
  Object.entries(vars).forEach(([k, v]) => { r.style.setProperty(k, v); applied.push(k); });
  r.dataset.theme = th.contrast ? 'contrast' : 'light'; r.dataset.hydraTheme = th.id;
  r.classList.toggle('paper-theme', !!paperFollow && th.id !== STITCH);
  r.classList.toggle('theme-dark', th.id === 'dark' || isDark(vars['--panel']));
}
const isDark = (c?: string) => { if (!c || !/^#[0-9a-f]{6}$/i.test(c)) return false; const n = parseInt(c.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 110; };
export function exportTheme(t: Theme) { return JSON.stringify({ format: 'hydra.theme', name: t.name, vars: t.builtin ? { ...STITCH_VARS, ...t.vars } : t.vars }, null, 2); }
export function importTheme(txt: string): Theme { const o = JSON.parse(txt); if (o.format !== 'hydra.theme' || !o.vars) throw new Error('Not a HYDRA theme file'); const vars: Record<string, string> = {};
  Object.entries(o.vars).forEach(([k, v]) => { if (/^--[\w-]+$/.test(k) && /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\))$/i.test(String(v))) vars[k] = String(v); });
  return { id: 'my_' + Date.now().toString(36), name: String(o.name || 'Imported theme').slice(0, 40), vars }; }
/** live preview of colours being edited (tracked like a theme, so Stitch is restored exactly) */
export function previewVars(v: Record<string, string>) { const r = document.documentElement; applied.forEach(k => r.style.removeProperty(k)); applied = []; Object.entries(derive(v)).forEach(([k, x]) => { r.style.setProperty(k, x); applied.push(k); }); r.dataset.theme = 'light'; }
