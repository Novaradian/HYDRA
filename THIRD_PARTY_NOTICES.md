# Third-party notices

The built app (`dist/HYDRA`, the release zip) bundles the open-source components below. The full licence texts are in
`lib/LICENSES.txt` inside the built app, which `app/build.mjs` writes from each package at build time.

## Libraries (in `lib/hydra-vendor.js`, `lib/hydra-blockly.js` and `app/hydra-home.js`)
| Package | Licence |
|---|---|
| preact, @preact/signals, @preact/signals-core | MIT |
| dockview-core | MIT |
| fuse.js | Apache-2.0 |
| hotkeys-js | MIT |
| dexie | Apache-2.0 |
| jszip | MIT or GPL-3.0-or-later (used under MIT) |
| i18next | MIT |
| @floating-ui/dom, core, utils | MIT |
| sortablejs | MIT |
| immer | MIT |
| ajv | MIT |
| lucide-preact (icons) | ISC |
| jspdf, svg2pdf.js | MIT |
| exceljs | MIT |
| graphology, graphology-components | MIT |
| blockly (and its media files in `lib/blockly-media`) | Apache-2.0 |

Exact versions: `lib/VERSIONS.txt` in the built app.

## Fonts (embedded in `HYDRA.html` and the two tools)
| Font | Licence |
|---|---|
| IBM Plex Sans | SIL Open Font License 1.1 |
| JetBrains Mono | SIL Open Font License 1.1 |

The OFL lets you embed and redistribute these fonts with software. It does not let you sell the fonts on their own.
The licence text is included in `lib/LICENSES.txt`.

## Desktop build (`desktop/`)
HYDRA.exe is built with [Tauri 2](https://tauri.app) (MIT / Apache-2.0) and runs in Microsoft Edge WebView2. The Rust
crates it pulls in are listed in `desktop/src-tauri/Cargo.lock`.
