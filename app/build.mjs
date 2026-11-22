import * as esbuild from 'esbuild';
import fs from 'fs'; import path from 'path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..'); // repository root
const OUT = process.env.HYDRA_OUT || path.join(ROOT, 'dist', 'HYDRA');
const LIBS = ['preact', 'preact/hooks', '@preact/signals', 'dockview-core', 'fuse.js', 'hotkeys-js', 'dexie', 'jszip', 'i18next', '@floating-ui/dom', 'sortablejs', 'immer', 'ajv', 'jspdf', 'svg2pdf.js', 'exceljs', 'graphology', 'graphology-components'];
fs.rmSync(OUT, { recursive: true, force: true }); for (const d of ['app', 'lib', 'lang', 'tools']) fs.mkdirSync(OUT + '/' + d, { recursive: true });
await esbuild.build({ entryPoints: ['vendor-entry.js'], bundle: true, format: 'iife', target: 'es2020', minify: true, outfile: OUT + '/lib/hydra-vendor.js', legalComments: 'none', define: { 'process.env.NODE_ENV': '"production"' } });
const shim = { name: 'hydra-lib', setup(b) {
  b.onResolve({ filter: new RegExp('^(' + LIBS.map(l => l.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|') + ')$') }, a => ({ path: a.path, namespace: 'hydra-lib' }));
  b.onLoad({ filter: /.*/, namespace: 'hydra-lib' }, a => ({ contents: `var m = window.HYDRA_LIB[${JSON.stringify(a.path)}]; if(!m) throw new Error('HYDRA library missing: ${a.path} (lib/hydra-vendor.js not loaded)'); module.exports = m.__esModule ? m : Object.assign({ __esModule: true }, m);`, loader: 'js' }));
} };
await esbuild.build({ entryPoints: ['blockly-entry.js'], bundle: true, format: 'iife', target: 'es2020', minify: true, outfile: OUT + '/lib/hydra-blockly.js', legalComments: 'none' });
fs.cpSync('node_modules/blockly/media', OUT + '/lib/blockly-media', { recursive: true });
await esbuild.build({ entryPoints: ['src/main.tsx'], bundle: true, format: 'iife', target: 'es2020', minify: true, outfile: OUT + '/app/hydra-home.js', jsxFactory: 'h', jsxFragment: 'Fragment', loader: { '.html': 'text' }, plugins: [shim], legalComments: 'none', define: { 'process.env.NODE_ENV': '"production"' } });
const fonts = fs.readFileSync('assets/fonts.css', 'utf8'), css = fs.readFileSync('src/styles.css', 'utf8');
fs.writeFileSync(OUT + '/HYDRA.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>HYDRA</title><link rel="icon" type="image/svg+xml" href="icons/hydra.svg"><meta name="description" content="HYDRA — 2D hydraulic, pneumatic and electrical circuit design (offline build)">
<style>${fonts}\n${css}</style></head>
<body><div id="app"></div>
<noscript>HYDRA needs JavaScript. Open this file in Chrome or Edge.</noscript>
<script src="lang/en.js"></script><script src="lang/gu.js"></script><script src="lang/hi.js"></script>
<script src="lib/hydra-vendor.js"></script>
<script src="app/hydra-home.js"></script>
</body></html>`);
for (const f of ['HYDRA_Valve_Creator.html', 'HYDRA_Symbol_Sketcher.html']) fs.copyFileSync('assets/tools/' + f, OUT + '/tools/' + f);
// ---- HYDRA.bat launcher (localhost server, project folder, install-as-app) ----
const crlf = s => s.replace(/\r?\n/g, '\r\n');
fs.mkdirSync(OUT + '/launcher', { recursive: true }); fs.mkdirSync(OUT + '/icons', { recursive: true }); fs.mkdirSync(OUT + '/samples', { recursive: true });
fs.writeFileSync(OUT + '/HYDRA.bat', crlf(fs.readFileSync('launcher/HYDRA.bat', 'utf8')));
fs.writeFileSync(OUT + '/launcher/hydra-server.ps1', '﻿' + crlf(fs.readFileSync('launcher/hydra-server.ps1', 'utf8'))); // BOM: Windows PowerShell 5.1 reads it as UTF-8
for (const f of fs.readdirSync('assets/icons')) fs.copyFileSync('assets/icons/' + f, OUT + '/icons/' + f);
if (fs.existsSync('samples')) for (const f of fs.readdirSync('samples')) fs.cpSync('samples/' + f, OUT + '/samples/' + f, { recursive: true });
fs.writeFileSync(OUT + '/manifest.webmanifest', JSON.stringify({ name: 'HYDRA', short_name: 'HYDRA', description: 'Offline 2D hydraulic, pneumatic and electrical circuit design and simulation', start_url: 'HYDRA.html', scope: './', display: 'standalone', background_color: '#1E2936', theme_color: '#1E2936',
  icons: [{ src: 'icons/hydra-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icons/hydra-512.png', sizes: '512x512', type: 'image/png' }, { src: 'icons/hydra-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }, { src: 'icons/hydra.svg', sizes: 'any', type: 'image/svg+xml' }],
  file_handlers: [{ action: 'HYDRA.html', accept: { 'application/zip': ['.hydra'] } }] }, null, 1));
{ // service worker: the installed app opens even when HYDRA.bat is not running (network first, cached copy as fallback)
  const list = []; const walk = d => fs.readdirSync(OUT + '/' + d, { withFileTypes: true }).forEach(e => { const r = (d ? d + '/' : '') + e.name; if (e.isDirectory()) { if (r !== 'launcher') walk(r); } else if (!/\.(bat|txt|hydra)$/i.test(e.name) && r !== 'sw.js') list.push(r); }); walk('');
  const h = (await import('crypto')).createHash('sha256'); list.sort().forEach(f => h.update(f + fs.statSync(OUT + '/' + f).size)); h.update(fs.readFileSync(OUT + '/app/hydra-home.js'));
  fs.writeFileSync(OUT + '/sw.js', `// HYDRA service worker (generated by build.mjs). Only active when HYDRA is served by HYDRA.bat.
const CACHE = 'hydra-${h.digest('hex').slice(0, 12)}';
const FILES = ${JSON.stringify(list)};
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('hydra-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url); if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === 'navigate' ? caches.match('HYDRA.html') : Response.error()))));
});
`); }
const langTpl = (code, name) => `// ${name} translation for HYDRA. Keys are the English labels; values are the translation.\n// Uncomment the line below and add entries, e.g. "New Project…": "…". No code changes are needed.\n// window.HYDRA_LANGS = Object.assign(window.HYDRA_LANGS || {}, { ${code}: { "New Project…": "" } });\n`;
fs.writeFileSync(OUT + '/lang/en.js', '// English is built in. This file is a template for other languages.\nwindow.HYDRA_LANGS = window.HYDRA_LANGS || {};\n');
fs.writeFileSync(OUT + '/lang/gu.js', langTpl('gu', 'Gujarati')); fs.writeFileSync(OUT + '/lang/hi.js', langTpl('hi', 'Hindi'));
fs.writeFileSync(OUT + '/lang/README.txt', 'Language files\n==============\nEach file registers translations in window.HYDRA_LANGS["<code>"] = { "English label": "translation" }.\nLabels without a translation fall back to English. After editing gu.js or hi.js, reload HYDRA and choose\nPreference > Language.\n');
// licences + versions
const pkgs = ['preact', '@preact/signals', '@preact/signals-core', 'dockview-core', 'fuse.js', 'hotkeys-js', 'dexie', 'jszip', 'i18next', '@floating-ui/dom', '@floating-ui/core', '@floating-ui/utils', 'sortablejs', 'immer', 'ajv', 'lucide-preact', 'jspdf', 'svg2pdf.js', 'exceljs', 'graphology', 'graphology-components', 'blockly'];
let lic = 'Third-party libraries bundled in HYDRA (lib/hydra-vendor.js and app/hydra-home.js)\n' + '='.repeat(78) + '\n\n', ver = 'Library versions (pinned)\n\n';
for (const p of pkgs) { const dir = 'node_modules/' + p; if (!fs.existsSync(dir)) continue; const pj = JSON.parse(fs.readFileSync(dir + '/package.json', 'utf8')); ver += `${p.padEnd(24)} ${pj.version.padEnd(10)} ${pj.license || ''}\n`;
  const lf = fs.readdirSync(dir).find(f => /^(licen[cs]e|copying)/i.test(f)); lic += `---- ${p} ${pj.version} (${pj.license || 'see file'}) ----\n${lf ? fs.readFileSync(dir + '/' + lf, 'utf8').trim() : '(licence: ' + (pj.license || 'n/a') + ')'}\n\n`; }
lic += '---- Fonts: IBM Plex Sans, JetBrains Mono (OFL-1.1) ----\n' + fs.readFileSync('assets/OFL.txt', 'utf8') + '\n';
fs.writeFileSync(OUT + '/lib/LICENSES.txt', lic); fs.writeFileSync(OUT + '/lib/VERSIONS.txt', ver);
fs.writeFileSync(OUT + '/README.txt', `HYDRA ${JSON.parse(fs.readFileSync('package.json', 'utf8')).version} — offline hydraulic, pneumatic and electrical circuit design and simulation
Created by Jigs Rathod
=================================================
Open:  double-click HYDRA.html (Chrome or Edge). No installation, no admin rights, no internet.
  or:  double-click HYDRA.bat — starts a small server for this folder on http://localhost:17171 (only this computer
       can reach it) and opens HYDRA in its own window. Then:
         · Save / Open work in a real project folder: Documents\\HYDRA\\projects (File › Open shows it)
         · every save keeps the previous version in Documents\\HYDRA\\backups (newest 10 per project)
         · unsaved changes are written to Documents\\HYDRA\\autosave and removed when you save
         · File › Install HYDRA as an App adds HYDRA to the Start menu; it opens even when HYDRA.bat is not running
         · settings and libraries are kept separately from the HYDRA.html (file) copy
       The black window is the server: keep it open while you work; it closes by itself after the last HYDRA window.
       If PowerShell is blocked on your PC, HYDRA.bat simply opens HYDRA.html. Set HYDRA_HOME to use another folder.

Folder
  HYDRA.html            the app (fonts and styles inside)
  HYDRA.bat             optional launcher (launcher/hydra-server.ps1): project folder, autosave, backups, install-as-app
  manifest.webmanifest, sw.js, icons/   install-as-app files (used only when started with HYDRA.bat)
  app/hydra-home.js     HYDRA application code (includes the Valve Creator and Symbol Sketcher)
  lib/hydra-vendor.js   open-source libraries, one file — see lib/VERSIONS.txt and lib/LICENSES.txt
  lib/hydra-blockly.js  Blockly (block editor of the Logic Coder) — loaded when a program opens; lib/blockly-media its icons
  lang/                 translation files (Gujarati, Hindi templates)
  tools/                Valve Creator v1.0 and Symbol Sketcher v1.0 as standalone files

Circuit Designer
  Open a hydraulic or pneumatic sheet from Machine Circuits or Launch. Place ISO 1219-1 parts, draw working, pilot and
  drain lines port to port, tag to ISO 1219-2, set values per placed part, run the rule check (F7), and export vector
  PDF, SVG, PNG, DXF (R12, mm), the parts list (Excel / CSV) and a simulation netlist. Help > Documentation explains it.
  The six fluid sample circuits (Samples panel) open as finished drawings — as their own unsaved projects.

Workspace and simulation
  Several projects open at once (chips on Home, tabs Project › Sheet), sheet cards on Home, collapsible panels and
  auto-hiding bars, infinite canvas, interface ports + assemblies + machine sheets, and the simulation (F5): click a
  valve box to switch it; pressure colours, moving cylinders, live values and plots. Help > Documentation explains it.

Logic Coder
  Programs (Machine Circuits › Programs, or Launch › Logic Coder) are built from puzzle blocks: entry points ON START,
  MAIN LOOP, ON E-STOP, ON RESET, ON FAULT; GRAFCET sequences with steps and transitions; timers, counters, latches,
  edges; I/O blocks that list the tags of your sheets. Run / Pause / Scan / Stop / Reset / E-STOP run the program
  scan by scan (10 ms); the I/O table lets you set inputs and force values; watch, trend, alarms and the event log
  show what happens. With a fluid sheet, Run (or the Machine button on the sheet) runs the program and the hydraulic
  simulation together: solenoids shift the valves, sensors and cylinder ends feed the inputs. Menu > Open Controller
  opens the operator panel (auto-built from the project, 40 widgets, docked, own tab or second window). Help > Docs.

AI assistant (optional, off by default)
  Turn it on in Settings > AI & Connections. With the desktop app (HYDRA.exe) the AI panel chats through your own
  Claude Code or Codex CLI, or your own Anthropic / OpenAI API key; Claude Desktop can also use HYDRA's tools (MCP).
  The AI asks a few questions, proposes a parts list (HYDRA adds required parts such as the relief valve), and draws
  the circuit as a faded preview that the solver checks. Nothing changes until you press Apply (one undo step).
  After that, Create Electric / Logic Code / Controller-HMI build the PLC I/O sheets, program and operator panel.
  Projects marked Private are never sent to any AI. The browser version (this HTML file) has no AI connections.

Projects are saved as .hydra files where you choose (Chrome / Edge ask once for permission).
Your libraries, stars, history and settings stay in this browser profile.
Keep the folder together: HYDRA.html loads the app and lib folders next to it.
`);
// MCP tool list for HYDRA.exe --mcp (compiled into the exe): the AI command schemas, one source (src/ai/schemas.ts)
{ const r = await esbuild.build({ entryPoints: ['src/ai/schemas.ts'], bundle: true, format: 'esm', write: false, logLevel: 'silent' });
  const { MCP_TOOLS } = await import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
  if (fs.existsSync(ROOT + '/desktop/src-tauri')) fs.writeFileSync(ROOT + '/desktop/src-tauri/mcp-tools.json', JSON.stringify({ tools: MCP_TOOLS }, null, 1)); }
const sz = f => (fs.statSync(OUT + '/' + f).size / 1024).toFixed(0) + ' KB';
console.log('built', ['HYDRA.html', 'app/hydra-home.js', 'lib/hydra-vendor.js'].map(f => f + ' ' + sz(f)).join(' · '));
