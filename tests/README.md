# Tests

End-to-end regression suites. Each one opens the built app (`dist/HYDRA/HYDRA.html`) in headless Chromium through
Playwright, drives it, and prints one line per check and a final `N / N`.

## Setup
```
cd app && npm install && node build.mjs && cd ..
pip install playwright
python -m playwright install chromium
```
Run a suite from the repository root, e.g. `python tests/s8a.py`. The suites find the build through the `HYDRA_ROOT`
environment variable, which defaults to the repository root. Some suites write screenshots next to the repository root;
`.gitignore` excludes them.

## Suites
| Suite | Covers |
|---|---|
| `htest.py` | Home tab, library, panels, samples, commands |
| `dtest4.py` | Circuit Designer basics |
| `s6a.py` … `s6n.py` | Simulation (hydraulic and pneumatic) |
| `e7test.py` | Electric Designer |
| `s8a.py` | Logic Coder: editor, compiler, runtime |
| `s8b.py` | PLC driving the simulation |
| `s8c.py`, `s8u.py` | Operator panel, docking, pop-out, UI options |
| `s8t.py` | Custom templates |
| `s8d.py` | Advanced blocks: PID, arrays, function blocks, parallel sequences, safety … |
| `s9l.py` | `HYDRA.bat` launcher. Windows only; starts the real PowerShell server |
| `s9t.py` | Themes. Set `HYDRA_REF` to a build made before a style change to check that Stitch is pixel-identical |
| `s9x.py` | App side of HYDRA.exe (desktop project folder, opening a `.hydra` file) |
| `a6.py` | AI steps 7–9: Claude Code / Codex bridge, own API key, question templates, mandatory parts, Create Electric / Logic / HMI |
| `a5_mcp_stdio.py` | `HYDRA.exe --mcp` over stdio (run by the GitHub workflow against the built exe) |
| `a1.py` | AI command API: schemas, Private and read-only guards, one undo step per change, build / validate / simulate |

`t8/` holds helper scripts that the suites load into the page.
