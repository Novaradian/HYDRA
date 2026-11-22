# HYDRA.bat launcher: PowerShell localhost server, project folder (save / open / backups / autosave), key + origin
# checks, install-as-app (manifest + service worker), and the file:// build untouched. Windows only.
import os, sys, json, time, tempfile, shutil, subprocess, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
D=S+'/dist/HYDRA'; PORT=17299; BASE=f'http://localhost:{PORT}'
R=[]
def check(n,c,x=''): R.append(('PASS' if c else 'FAIL',n,str(x)[:300]))
def http(path, method='GET', key=None, origin=None, data=None):
    rq=urllib.request.Request(BASE+path, method=method, data=data)
    if key: rq.add_header('X-HYDRA-Key', key)
    if origin: rq.add_header('Origin', origin)
    try:
        with urllib.request.urlopen(rq, timeout=5) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()
home=tempfile.mkdtemp(prefix='hydra_l_')
check('HYDRA.bat uses CRLF line ends, server script has a UTF-8 BOM', b'\r\n' in open(D+'/HYDRA.bat','rb').read() and open(D+'/launcher/hydra-server.ps1','rb').read(3)==b'\xef\xbb\xbf')
srv=subprocess.Popen(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',D+'/launcher/hydra-server.ps1','-Port',str(PORT),'-NoBrowser','-DataDir',home,'-IdleExit','600'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
try:
    for _ in range(60):
        try:
            if http('/api/hello')[0]==200: break
        except Exception: pass
        time.sleep(0.5)
    st,b=http('/api/hello'); hello=json.loads(b) if st==200 else {}
    check('server answers on localhost and serves this folder', st==200 and hello.get('hydra') and os.path.normcase(hello.get('root',''))==os.path.normcase(os.path.abspath(D)), (st,hello))
    KEY=open(home+'/launcher.key').read().strip()
    check('project folder created: projects, autosave, backups', all(os.path.isdir(home+'/'+d) for d in ('projects','autosave','backups')))
    check('file API refuses requests without the key', http('/api/info')[0]==403 and http('/api/info', key='0'*64)[0]==403)
    check('file API refuses other web sites (Origin check)', http('/api/info', key=KEY, origin='http://evil.example')[0]==403)
    check('file API with key works', http('/api/info', key=KEY, origin=BASE)[0]==200)
    check('no path escape: ../ names refused', http('/api/file?area=projects&name=..%5Cx.hydra', 'PUT', KEY, data=b'x')[0]==400 and http('/api/file?area=projects&name=a.exe', 'PUT', KEY, data=b'x')[0]==400)
    check('samples area is read-only', http('/api/file?area=samples&name=x.hydra', 'PUT', KEY, data=b'x')[0]==403)
    check('static files: no escape from the folder, launcher not served', http('/..%2f..%2fWindows/win.ini')[0] in (400,403,404) and http('/%2e%2e/%2e%2e/Windows/win.ini')[0] in (400,403,404) and http('/launcher/hydra-server.ps1')[0]==404 and http('/HYDRA.html')[0]==200)
    st,_=http('/'); check('/ opens HYDRA.html', st==200)
    with sync_playwright() as p:
        b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1600,'height':960}); pg=ctx.new_page()
        errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
        pg.goto(f'{BASE}/HYDRA.html#k={KEY}'); pg.wait_for_timeout(3000); ev=pg.evaluate; H='window.HYDRA'
        info=ev(f"{H}.launcher.LX.value"); check('app detects the launcher (project folder known)', info and os.path.normcase(info['projects'])==os.path.normcase(os.path.join(home,'projects')), info)
        check('key removed from the address bar', '#k=' not in pg.url, pg.url)
        check('install-as-app: manifest linked, service worker active', ev("(async()=>{ const r=await navigator.serviceWorker.ready; return !!document.querySelector('link[rel=manifest]') && !!r.active })()"))
        mf=json.loads(http('/manifest.webmanifest')[1]); check('manifest: name, standalone, 192/512 icons', mf['display']=='standalone' and {'192x192','512x512'}<= {i['sizes'] for i in mf['icons']}, mf)
        # ---- save into the project folder ----
        ev(f"{H}.Pj.createProject({{name:'Press Line 1', template:'hydraulic', unitSystem:'SI-bar'}})"); pg.wait_for_timeout(800)
        ev(f"{H}.cmds.runCmd('file.save')"); pg.wait_for_timeout(500)
        dl=pg.inner_text('.modal'); check('Save asks for a name in the project folder', 'project folder' in dl.lower() and 'Press_Line_1.hydra' in pg.input_value('.modal input'), dl[:200])
        pg.click('.modal footer button.primary'); pg.wait_for_timeout(1200)
        f1=home+'/projects/Press_Line_1.hydra'; check('saved as Documents\\HYDRA\\projects\\Press_Line_1.hydra', os.path.isfile(f1) and open(f1,'rb').read(2)==b'PK')
        loc=ev(f"{H}.S.project.value.manifest.location"); check('project location shows the folder path', loc.endswith('projects\\Press_Line_1.hydra'), loc)
        ev(f"{H}.S.mutate('edit', d=>{{ d.manifest.description='rev 2'; }})"); ev(f"{H}.cmds.runCmd('file.save')"); pg.wait_for_timeout(1200)
        bk=os.listdir(home+'/backups'); check('second save keeps the previous version in backups', len(bk)==1 and bk[0].startswith('Press_Line_1_') and bk[0].endswith('.hydra'), bk)
        for i in range(11): ev(f"{H}.S.mutate('e{i}', d=>{{ d.manifest.description='rev {i}'; }})"); ev(f"{H}.cmds.runCmd('file.save')"); pg.wait_for_timeout(1100)
        bk=os.listdir(home+'/backups'); check('backups pruned to the newest 10 per project', len(bk)==10, len(bk))
        rec=ev(f"{H}.S.recents.value.map(r=>[r.name, r.handle && r.handle.srv && r.handle.srv.name])"); check('recent list remembers the folder file', ['Press Line 1','Press_Line_1.hydra'] in rec, rec)
        # ---- autosave to disk ----
        ev(f"{H}.S.savePrefs({{...{H}.S.prefs.value, autosaveSec: 15}}); {H}.Pj.startAutosave(); {H}.S.mutate('dirty', d=>{{ d.manifest.description='unsaved'; }})"); pg.wait_for_timeout(16500)
        au=os.listdir(home+'/autosave'); check('unsaved changes autosaved to Documents\\HYDRA\\autosave', len(au)==1 and au[0].startswith('Press_Line_1-'), au)
        ev(f"{H}.cmds.runCmd('file.save')"); pg.wait_for_timeout(1200)
        check('saving removes the autosave file', not os.listdir(home+'/autosave'), os.listdir(home+'/autosave'))
        # ---- open from the folder ----
        ev(f"{H}.Pj.closeAll()"); pg.wait_for_timeout(500)
        ev(f"{H}.cmds.runCmd('file.open')"); pg.wait_for_timeout(800)
        txt=pg.inner_text('.modal'); check('Open shows the project folder (Projects / Autosave / Backups / Samples)', 'Press_Line_1.hydra' in txt and all(x in txt for x in ['Projects','Autosave','Backups','Samples folder']), txt[:300])
        pg.click('.modal tr:has-text("Press_Line_1.hydra")'); pg.click('.modal footer button.primary'); pg.wait_for_timeout(1500)
        check('opens the project from the folder; Save writes back to the same file', ev(f"{H}.S.project.value && {H}.S.project.value.manifest.name")=='Press Line 1' and ev(f"{H}.S.fileHandle.value && {H}.S.fileHandle.value.srv.name")=='Press_Line_1.hydra')
        ev(f"{H}.cmds.runCmd('file.open')"); pg.wait_for_timeout(500); pg.click('.modal button[role=tab]:has-text("Backups")'); pg.wait_for_timeout(600)
        check('Backups tab lists the kept versions', pg.locator('.modal tbody tr').count()==10)
        pg.keyboard.press('Escape')
        check('File menu commands: Show Project Folder enabled', ev(f"{H}.cmds.isEnabled({H}.cmds.cmd('file.folder'))"))
        check('no page errors', not errs, errs)
        b.close()
    # ---- the same build opened as a file: launcher inactive, no console errors ----
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
        pg.goto('file://'+D+'/HYDRA.html'); pg.wait_for_timeout(2500)
        check('opened as HYDRA.html: launcher off, no manifest / service worker, no errors', pg.evaluate("window.HYDRA.launcher.LX.value===null && !document.querySelector('link[rel=manifest]')") and not errs, errs)
        b.close()
    st,_=http('/api/quit','POST',KEY); time.sleep(2.5)
    check('server stops on request (and exits by itself when HYDRA windows are gone)', srv.poll() is not None, srv.poll())
finally:
    if srv.poll() is None: srv.kill()
    shutil.rmtree(home, ignore_errors=True)
for r in R: print(r[0], r[1], r[2] if r[0]=='FAIL' else '')
print(f"{sum(1 for r in R if r[0]=='PASS')} / {len(R)}")
