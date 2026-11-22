# Building HYDRA.exe (Windows, Tauri 2)

HYDRA.exe is the same offline web build (`dist/HYDRA`) in a native WebView2 window. Nothing in the UI is forked.

## What the exe adds
- Its own window, Start-menu entry, and an uninstaller (NSIS, per-user: no admin rights).
- A real project folder, `Documents\HYDRA`, or the folder in `HYDRA_HOME`. Save and Open use it exactly like HYDRA.bat:
  - every save keeps the previous version in `backups` (newest 10 per project);
  - unsaved work is written to `autosave` and removed again when you save.
- `.hydra` file association: double-clicking a project opens it in HYDRA.
- Works offline. The installer embeds the WebView2 bootstrapper for Windows 10 PCs that lack WebView2 (Windows 11 has it).

## Easiest: GitHub Actions (free, nothing to install)
1. Push this repository to GitHub.
2. **Actions** tab → **Build HYDRA (Windows)** → **Run workflow**.
3. When it finishes (about 15 minutes the first time, faster later), download **HYDRA-windows** from the run page:
   the portable exe, the installer, the MSI and the browser build zip.
4. Push a tag such as `v0.8.0` to publish the same files as a GitHub Release.

The workflow (`.github/workflows/desktop.yml`) also runs the AI bridge unit tests and checks `HYDRA.exe --mcp` over
stdio, as Claude Desktop starts it.

## Building on your own PC
### One-time toolchain (about 6–8 GB, mostly on C:)
1. Visual Studio 2022 **Build Tools**, workload "Desktop development with C++" (MSVC + Windows SDK).
2. Rust: install with rustup (stable, `x86_64-pc-windows-msvc`).
   - To keep Rust on another drive, set `RUSTUP_HOME` and `CARGO_HOME` (e.g. `D:\rust\rustup`, `D:\rust\cargo`) before running the installer.
3. Node 18+ (already used for the web build).

## Build
Run these in the `desktop` folder:
```
npm install          # @tauri-apps/cli
npm run icons        # icons from app/assets/icons/hydra-512.png (needed once)
npm run build        # web build + HYDRA.exe + installers
```
The first build compiles about 400 crates and takes 5–15 minutes. Later builds take under a minute.

## Output (`desktop/src-tauri/target/release/`)
| File | Use |
|---|---|
| `bundle/nsis/HYDRA_0.8.0_x64-setup.exe` | Installer (per-user) |
| `bundle/msi/HYDRA_0.8.0_x64_en-US.msi` | MSI for IT deployment |
| `hydra.exe` | Portable exe: copy it anywhere. It needs WebView2, which Windows 11 has. |

## Code signing
The exe is unsigned unless you sign it with your certificate:
```
signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /f cert.pfx /p <password> HYDRA_0.8.0_x64-setup.exe
```
Unsigned, Windows SmartScreen shows "Windows protected your PC" the first time. Click **More info → Run anyway**.

## Smoke checklist for each release
- [ ] Launch; Home shows; no console errors (F12 works in debug builds: `npm run dev`).
- [ ] Open a sample; simulate (F5).
- [ ] Logic Coder opens: Blockly loads from `lib/hydra-blockly.js`.
- [ ] Operator panel, graph and overview pop-outs open as windows.
- [ ] Save → `Documents\HYDRA\projects`. Save again → `backups`. File › Open lists both.
- [ ] Double-click a `.hydra` in Explorer → it opens in HYDRA.
- [ ] Settings › Appearance: the themes switch, and Stitch is unchanged.
- [ ] Wi-Fi off: everything above still works.
