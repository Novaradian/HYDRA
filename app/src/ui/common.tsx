import { h, Fragment, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { computePosition, flip, shift, offset, autoUpdate } from '@floating-ui/dom';
import * as I from 'lucide-preact';
import { toasts } from '../store';
import { UNITS, convert } from '../units';
import { round } from '../util';
import { t } from '../i18n';

const MAP: Record<string, any> = { sparkles: I.Sparkles, send: I.SendHorizontal, lock: I.Lock, plug: I.Plug, bot: I.Bot, 'x-circle': I.CircleX, 'circle-alert': I.CircleAlert, 'list-checks': I.ListChecks, 'message-square': I.MessageSquare, 'move-right': I.MoveRight, 'sim-check': I.Check, 'sim-download': I.Download, 'mouse-pointer': I.MousePointer2, spline: I.Spline, 'git-commit-horizontal': I.GitCommitHorizontal, type: I.Type, 'square-dashed': I.SquareDashed, 'flip-horizontal': I.FlipHorizontal2, 'align-left': I.AlignStartVertical, 'align-right': I.AlignEndVertical, 'align-top': I.AlignStartHorizontal, 'align-bottom': I.AlignEndHorizontal, 'align-hcentre': I.AlignCenterHorizontal, 'align-vcentre': I.AlignCenterVertical, 'dist-h': I.AlignHorizontalDistributeCenter, 'dist-v': I.AlignVerticalDistributeCenter, 'corner-down-right': I.CornerDownRight, waypoints: I.Waypoints, route: I.Route, 'panel-bottom': I.PanelBottom, 'list-ordered': I.ListOrdered, tags: I.Tags, network: I.Network, 'circle-dot': I.CircleDot, replace: I.Replace, hash: I.Hash, 'triangle-alert': I.TriangleAlert, 'circle-check': I.CircleCheck, 'circle-x': I.CircleX, 'chevron-up': I.ChevronUp, 'file-code': I.FileCode, 'file-image': I.FileImage, 'file-spreadsheet': I.FileSpreadsheet, wind: I.Wind, activity: I.Activity, 'copy-plus': I.CopyPlus, 'corner-up-left': I.CornerUpLeft, eye: I.Eye, focus: I.Focus, 'panel-left-close': I.PanelLeftClose, 'panel-left-open': I.PanelLeftOpen, 'panel-right-close': I.PanelRightClose, 'panel-right-open': I.PanelRightOpen, 'square-plus': I.SquarePlus, 'step-forward': I.StepForward, 'wand-2': I.WandSparkles, 'minimize-2': I.Minimize2, 'eye-off': I.EyeOff, 'file-x': I.FileX,
  'octagon-x': I.OctagonX, variable: I.Variable, 'trending-up': I.TrendingUp, 'scroll-text': I.ScrollText, timer: I.Timer,
  'file-plus': I.FilePlus, 'folder-open': I.FolderOpen, history: I.History, save: I.Save, 'save-all': I.SaveAll, import: I.Import, 'file-json': I.FileJson, package: I.Package, 'file-down': I.FileDown, sheet: I.Sheet, printer: I.Printer, info: I.Info, 'x-square': I.SquareX, 'log-out': I.LogOut, 'undo-2': I.Undo2, 'redo-2': I.Redo2, scissors: I.Scissors, copy: I.Copy, 'clipboard-paste': I.ClipboardPaste, 'trash-2': I.Trash2, 'pencil-line': I.PencilLine, 'box-select': I.BoxSelect, group: I.Group, 'rotate-cw': I.RotateCw, star: I.Star, 'star-off': I.StarOff, pencil: I.Pencil, search: I.Search, command: I.Command, 'pen-tool': I.PenTool, 'git-fork': I.GitFork, 'library-big': I.LibraryBig, monitor: I.Monitor, 'shield-check': I.ShieldCheck, calculator: I.Calculator, ruler: I.Ruler, puzzle: I.Puzzle, droplets: I.Droplets, zap: I.Zap, binary: I.Binary, play: I.Play, pause: I.Pause, 'sliders-horizontal': I.SlidersHorizontal, magnet: I.Magnet, languages: I.Languages, keyboard: I.Keyboard, palette: I.Palette, gauge: I.Gauge, cpu: I.Cpu, 'hard-drive': I.HardDrive, contrast: I.Contrast, 'panel-left': I.PanelLeft, 'panel-right': I.PanelRight, maximize: I.Maximize, 'layout-dashboard': I.LayoutDashboard, tag: I.Tag, 'grid-3x3': I.Grid3x3, 'grid-2x2': I.Grid2x2, square: I.Square, library: I.Library, 'zoom-in': I.ZoomIn, 'zoom-out': I.ZoomOut, scan: I.Scan, 'app-window': I.AppWindow, 'book-open': I.BookOpen, shapes: I.Shapes, map: I.Map, 'refresh-cw': I.RefreshCw, bug: I.Bug, 'layout-list': I.LayoutList, component: I.Component, home: I.House, x: I.X, 'chevron-right': I.ChevronRight, 'chevron-down': I.ChevronDown, pin: I.Pin, 'pin-off': I.PinOff, bell: I.Bell, folder: I.Folder, 'folder-plus': I.FolderPlus, plus: I.Plus, more: I.Ellipsis, alert: I.TriangleAlert, 'check-circle': I.CircleCheck, list: I.List, 'layout-grid': I.LayoutGrid, upload: I.Upload, download: I.Download, minus: I.Minus, 'maximize-2': I.Maximize2, 'arrow-up': I.ArrowUp, 'arrow-down': I.ArrowDown, 'external-link': I.ExternalLink, 'rotate-ccw': I.RotateCcw, 'git-compare': I.GitCompare, wrench: I.Wrench, boxes: I.Boxes, 'file-text': I.FileText, check: I.Check, layers: I.Layers
};
export const Icon = ({ name, size = 15, class: cls }: { name: string; size?: number; class?: string }) => { const C = MAP[name] || I.Circle; return <C size={size} strokeWidth={1.75} class={'ico ' + (cls || '')} aria-hidden="true" />; };
export const iconNames = () => Object.keys(MAP);

// SVG previews are shown as images so their own styles never touch the app
export const Thumb = ({ svg, alt, class: cls }: { svg: string; alt: string; class?: string }) =>
  svg ? <img class={'thumb ' + (cls || '')} alt={alt} draggable={false} src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace(/currentColor/g, '#1B2633').replace(/var\(--acc, #0A64C2\)/g, '#0A64C2'))} /> : <span class={'thumb thumb-wait ' + (cls || '')} aria-label={alt}>…</span>;

export const Btn = (p: { icon?: string; label?: string; title?: string; onClick?: (e: any) => void; disabled?: boolean; kind?: 'primary' | 'ghost' | 'danger' | 'tb'; class?: string; children?: ComponentChildren; pressed?: boolean; id?: string }) =>
  <button id={p.id} type="button" class={`btn ${p.kind || ''} ${p.pressed ? 'on' : ''} ${p.class || ''}`} title={p.title || p.label} aria-label={p.title || p.label} aria-pressed={p.pressed} disabled={p.disabled} onClick={p.onClick}>{p.icon && <Icon name={p.icon} />}{p.label && <span>{p.label}</span>}{p.children}</button>;

// ---------- validated number field with unit dropdown ----------
export function NumField({ label, qty, value, unit, onCommit, min, max, readOnly, units, step }: { label: string; qty: string; value: number; unit: string; onCommit?: (vInUnit: number, unit: string) => void; min?: number; max?: number; readOnly?: boolean; units?: string[]; step?: number }) {
  const [u, setU] = useState(unit); const [txt, setTxt] = useState(round(value, 5)); const [err, setErr] = useState('');
  useEffect(() => { setU(unit); }, [unit]);
  useEffect(() => { setTxt(round(convert(qty, unit, u, value), 5)); setErr(''); }, [value, unit, u]);
  const list = units || Object.keys(UNITS[qty] || {});
  const commit = () => {
    if (readOnly) return; const v = parseFloat(String(txt).replace(',', '.'));
    if (!isFinite(v)) { setErr(t('Enter a number')); return; }
    const inBase = convert(qty, u, unit, v);
    if (min != null && inBase < min) { setErr(`${t('Minimum')} ${round(convert(qty, unit, u, min))} ${u}`); return; }
    if (max != null && inBase > max) { setErr(`${t('Maximum')} ${round(convert(qty, unit, u, max))} ${u}`); return; }
    setErr(''); onCommit?.(inBase, unit);
  };
  return <label class="fld"><span class="lbl">{label}</span>
    <span class={'numrow ' + (err ? 'bad' : '')} title={err}>
      <input class="in" value={txt} readOnly={readOnly} inputMode="decimal" aria-invalid={!!err} aria-label={label} step={step}
        onInput={(e: any) => setTxt(e.target.value)} onBlur={commit} onKeyDown={(e: any) => { if (e.key === 'Enter') { commit(); e.target.blur(); } if (e.key === 'Escape') { setTxt(round(convert(qty, unit, u, value), 5)); setErr(''); } }} />
      {list.length > 1 ? <select class="in unit" value={u} aria-label={label + ' unit'} onChange={(e: any) => setU(e.target.value)}>{list.map(x => <option value={x}>{x}</option>)}</select> : <span class="unitlbl">{list[0]}</span>}
    </span>{err && <span class="errmsg" role="alert">{err}</span>}</label>;
}
export function TextField({ label, value, onCommit, readOnly, required, placeholder, maxLength }: { label: string; value: string; onCommit?: (v: string) => void; readOnly?: boolean; required?: boolean; placeholder?: string; maxLength?: number }) {
  const [v, setV] = useState(value); const [err, setErr] = useState('');
  useEffect(() => { setV(value); setErr(''); }, [value]);
  const commit = () => { if (readOnly || v === value) return; if (required && !v.trim()) { setErr(t('Required')); return; } setErr(''); onCommit?.(v.trim()); };
  return <label class="fld"><span class="lbl">{label}</span><input class={'in ' + (err ? 'bad' : '')} value={v} readOnly={readOnly} placeholder={placeholder} maxLength={maxLength} aria-invalid={!!err} title={err}
    onInput={(e: any) => setV(e.target.value)} onBlur={commit} onKeyDown={(e: any) => { if (e.key === 'Enter') { commit(); e.target.blur(); } if (e.key === 'Escape') setV(value); }} />{err && <span class="errmsg" role="alert">{err}</span>}</label>;
}
export const Seg = ({ value, options, onChange, label }: { value: string; options: [string, string][]; onChange: (v: string) => void; label?: string }) =>
  <div class="seg" role="radiogroup" aria-label={label}>{options.map(([v, l]) => <button type="button" role="radio" aria-checked={value === v} class={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;

// ---------- floating popover menus & context menus ----------
export type MenuItem = { label: string; icon?: string; keys?: string; onSelect?: () => void; disabled?: boolean; reason?: string; checked?: boolean; danger?: boolean } | 'sep' | { header: string };
export const ctxMenu = signal<{ x: number; y: number; items: MenuItem[] } | null>(null);
export const openContextMenu = (e: MouseEvent, items: MenuItem[]) => { e.preventDefault(); e.stopPropagation(); ctxMenu.value = { x: e.clientX, y: e.clientY, items }; };
export function MenuList({ items, onDone, labelledBy }: { items: MenuItem[]; onDone: () => void; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const first = ref.current?.querySelector<HTMLButtonElement>('button[role=menuitem]'); first?.focus(); }, []);
  const key = (e: KeyboardEvent) => {
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button[role=menuitem]') || [])]; const i = btns.indexOf(document.activeElement as any);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(); }
  };
  return <div class="menu" role="menu" aria-labelledby={labelledBy} ref={ref} onKeyDown={key as any}>{items.map(it => it === 'sep' ? <hr /> : 'header' in it ? <div class="mhead">{it.header}</div> :
    <button role="menuitem" aria-disabled={it.disabled} class={`${it.disabled ? 'dis' : ''} ${it.danger ? 'danger' : ''}`} title={it.disabled ? it.reason : ''} onClick={() => { if (it.disabled) return; onDone(); it.onSelect?.(); }}>
      <span class="mchk">{it.checked ? <Icon name="check" size={13} /> : it.icon ? <Icon name={it.icon} size={14} /> : null}</span><span class="mlbl">{it.label}{it.disabled && it.reason ? <small>{it.reason}</small> : null}</span><kbd>{it.keys || ''}</kbd></button>)}</div>;
}
export function Popover({ anchor, onClose, children, placement = 'bottom-start' }: { anchor: HTMLElement | { x: number; y: number }; onClose: () => void; children: ComponentChildren; placement?: any }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!; const ref_: any = anchor instanceof HTMLElement ? anchor : { getBoundingClientRect: () => ({ x: (anchor as any).x, y: (anchor as any).y, left: (anchor as any).x, top: (anchor as any).y, right: (anchor as any).x, bottom: (anchor as any).y, width: 0, height: 0 }) };
    const upd = () => computePosition(ref_, el, { placement, strategy: 'fixed', middleware: [offset(4), flip(), shift({ padding: 8 })] }).then(({ x, y }) => { el.style.left = x + 'px'; el.style.top = y + 'px'; el.style.visibility = 'visible'; });
    const stop = anchor instanceof HTMLElement ? autoUpdate(ref_, el, upd) : (upd(), () => { });
    const down = (e: PointerEvent) => { if (!el.contains(e.target as any) && !(anchor instanceof HTMLElement && anchor.contains(e.target as any))) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    setTimeout(() => document.addEventListener('pointerdown', down), 0); document.addEventListener('keydown', esc, true);
    return () => { stop(); document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', esc, true); };
  }, [anchor]);
  return <div class="pop" ref={ref} style={{ position: 'fixed', left: 0, top: 0, visibility: 'hidden' }}>{children}</div>;
}
export function ContextMenuHost() {
  const c = ctxMenu.value; if (!c) return null;
  return <Popover anchor={{ x: c.x, y: c.y }} onClose={() => ctxMenu.value = null}><MenuList items={c.items} onDone={() => ctxMenu.value = null} /></Popover>;
}
export function Toasts() {
  return <div class="toasts" role="status" aria-live="polite">{toasts.value.map(x => <div class={'toast ' + x.level}><Icon name={x.level === 'err' ? 'alert' : x.level === 'warn' ? 'alert' : x.level === 'ok' ? 'check-circle' : 'info'} size={14} />{x.text}</div>)}</div>;
}
export const Empty = ({ icon, title, children }: { icon: string; title: string; children?: ComponentChildren }) => <div class="empty"><Icon name={icon} size={26} /><b>{title}</b>{children}</div>;
export const Badge = ({ kind, children }: { kind: 'ok' | 'warn' | 'err' | 'info'; children: ComponentChildren }) => <span class={'badge ' + kind}>{children}</span>;
