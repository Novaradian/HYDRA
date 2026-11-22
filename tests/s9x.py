# HYDRA.exe (Tauri) — the app side of the desktop build, run against a stand-in for the native commands in
# desktop/src-tauri/src/lib.rs (same command names, arguments and backup rule). Checks the project folder flow and
# opening the .hydra file HYDRA.exe was started with. The native side itself is checked by the exe smoke list.
import os, json
from playwright.sync_api import sync_playwright
S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')))
R=[]
def check(n,c,x=''): R.append(('PASS' if c else 'FAIL',n,str(x)[:300])); print('..', R[-1][0], n, flush=True)
MOCK = r"""
(() => { const fs = { projects: {}, autosave: {}, backups: {}, samples: {} }; const calls = []; let n = 0; window.__mock = { fs, calls, startup: null };
  const ok = name => /^[\w][\w\-. ()+]*\.(hydra|json)$/i.test(name) && !name.includes('..');
  window.__TAURI__ = { core: { invoke: async (cmd, args, opt) => { calls.push(cmd);
    switch (cmd) {
      case 'hydra_info': return { ok: true, launcher: 2, desktop: true, home: 'C:\\Users\\me\\Documents\\HYDRA', projects: 'C:\\Users\\me\\Documents\\HYDRA\\projects', autosave: 'C:\\Users\\me\\Documents\\HYDRA\\autosave', backups: 'C:\\Users\\me\\Documents\\HYDRA\\backups', samples: '', keep: 10 };
      case 'hydra_list': return Object.entries(fs[args.area]).map(([name, f]) => ({ name, size: f.b.length, mtime: new Date(f.t).toISOString() }));
      case 'hydra_read': { const f = fs[args.area][args.name]; if (!f) throw 'missing'; return f.b.buffer.slice(0); }
      case 'hydra_write': { const { area, name } = opt.headers; if (!ok(name)) throw 'name'; if (!(args instanceof Uint8Array)) throw 'expected raw bytes';
        if (area === 'projects' && fs.projects[name]) { const base = name.replace(/\.hydra$/, ''); fs.backups[`${base}_2026010${++n}-120000.hydra`] = fs.projects[name]; }
        fs[area][name] = { b: new Uint8Array(args), t: Date.now() }; return { ok: true, path: 'C:\\x\\' + name, backup: null }; }
      case 'hydra_delete': delete fs[args.area][args.name]; return null;
      case 'hydra_reveal': return null;
      case 'hydra_startup_name': return window.__mock.startup ? window.__mock.startup.name : null;
      case 'hydra_startup_read': return window.__mock.startup.bytes.buffer.slice(0);
    } throw 'unknown ' + cmd; } } };
})();
"""
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1600,'height':960}); ctx.add_init_script(MOCK); pg=ctx.new_page(); pg.set_default_timeout(8000)
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500); ev=pg.evaluate; H='window.HYDRA'
    check('desktop detected: project folder from the native side', ev(f"{H}.launcher.isDesktop() && {H}.launcher.LX.value.desktop===true"))
    check('no service worker / manifest inside the exe', ev("!document.querySelector('link[rel=manifest]')"))
    ev(f"{H}.Pj.createProject({{name:'Rig A', template:'hydraulic', unitSystem:'SI-bar'}})"); pg.wait_for_timeout(600)
    ev(f"{H}.cmds.runCmd('file.save')"); pg.wait_for_timeout(500); pg.click('.modal footer button.primary'); pg.wait_for_timeout(1000)
    files=ev("Object.keys(window.__mock.fs.projects)"); check('Save writes Documents\\HYDRA\\projects\\Rig_A.hydra (raw bytes, headers area/name)', files==['Rig_A.hydra'], files)
    ev(f"{H}.S.mutate('e', d=>{{ d.manifest.description='2'; }})"); ev(f"{H}.cmds.runCmd('file.save')"); pg.wait_for_timeout(1000)
    check('second save keeps a backup', len(ev("Object.keys(window.__mock.fs.backups)"))==1)
    ev(f"{H}.S.savePrefs({{...{H}.S.prefs.value, autosaveSec: 15}}); {H}.Pj.startAutosave(); {H}.S.mutate('d', d=>{{ d.manifest.description='3'; }})"); pg.wait_for_timeout(16500)
    check('autosave to the autosave folder', len(ev("Object.keys(window.__mock.fs.autosave)"))==1)
    ev(f"{H}.cmds.runCmd('file.save')"); pg.wait_for_timeout(1000)
    check('saving removes the autosave file', len(ev("Object.keys(window.__mock.fs.autosave)"))==0)
    ev(f"{H}.Pj.closeAll()"); pg.wait_for_timeout(400)
    ev(f"{H}.cmds.runCmd('file.open')"); pg.wait_for_timeout(600)
    check('Open shows the project folder', 'Rig_A.hydra' in pg.inner_text('.modal'))
    pg.click('.modal tr:has-text("Rig_A.hydra")'); pg.click('.modal footer button.primary'); pg.wait_for_timeout(1200)
    check('opens from the folder', ev(f"{H}.S.project.value && {H}.S.project.value.manifest.name")=='Rig A')
    data=ev("Array.from(window.__mock.fs.projects['Rig_A.hydra'].b)")
    check('no page errors', not errs, errs)
    ctx.close()
    # started by double-clicking a .hydra file
    ctx=b.new_context(viewport={'width':1600,'height':960}); ctx.add_init_script(MOCK + f"\nwindow.__mock.startup={{name:'Rig_A.hydra', bytes:new Uint8Array({json.dumps(data)})}};"); pg=ctx.new_page()
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(3500)
    check('HYDRA.exe opened with a .hydra file opens that project', pg.evaluate(f"{H}.S.project.value && {H}.S.project.value.manifest.name")=='Rig A')
    b.close()
for r in R: print(r[0], r[1], r[2] if r[0]=='FAIL' else '')
print(f"{sum(1 for r in R if r[0]=='PASS')} / {len(R)}")
