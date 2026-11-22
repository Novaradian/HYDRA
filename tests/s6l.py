import json
from playwright.sync_api import sync_playwright
import os; S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
R=[]
def check(n,c,x=''): R.append(('PASS' if c else 'FAIL',n,str(x)[:300]))
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1500,'height':940}, accept_downloads=True); pg=ctx.new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500)
    ev=pg.evaluate; H="window.HYDRA.S"; DS="window.HYDRA.designer.st"; SIM="window.HYDRA.designer.sim"
    ev("window.HYDRA.actions.openSampleCopy('s_meter_out')"); pg.wait_for_timeout(1000)
    sh=ev(f"{DS}.D.value.sheetId")
    comps=ev(f"{DS}.sheetById('{sh}').components.map(c=>[c.id,c.tag,c.ref])"); print(comps)
    # --- 1 viscosity
    v=ev(f"(()=>{{const M={SIM}; const s=new M.Sim({H}.project.value,'{sh}',{{}}); const a=s.nu(); s.thermal.T=10; const b=s.nu(); s.thermal.T=70; const c=s.nu(); return [a,b,c]}})()")
    check('viscosity falls with temperature', v[1]>2*v[0]>2*v[2]*0.9 and v[0]>v[2], v)
    # --- run, extend
    ev(f"{DS}.D.value.simRun()"); pg.wait_for_timeout(500)
    vs=ev(f"{SIM}.SIM.els.filter(e=>e.kind==='valve').map(e=>e.key)"); act=ev(f"{SIM}.SIM.els.find(e=>e.kind==='actuator').key")
    for vk in vs: ev(f"{SIM}.simClickValve('{vk}', 0)")
    pg.wait_for_timeout(1200)
    n=ev("document.querySelectorAll('.dcanvas path.dflow').length"); check('flow arrows drawn on moving lines', n>0, n)
    d=ev("[...document.querySelectorAll('.dcanvas path.dflow')].map(p=>p.getAttribute('d').slice(0,30))")
    # tooltip
    box=ev("(()=>{const e=document.querySelector('.dcanvas [data-hit^=\"p:\"]'); if(!e) return null; const r=e.getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2]})()")
    tip=False
    if box:
        for dx,dy in [(0,0),(1,0),(0,1),(-1,0),(0,-1)]:
            pg.mouse.move(box[0]+dx,box[1]+dy); pg.wait_for_timeout(150)
            if ev("!!document.querySelector('.dlinetip')"): tip=True; break
    check('hover tooltip on a line', tip, box)
    pg.wait_for_timeout(2500)
    st=ev(f"(()=>{{const e={SIM}.SIM.el('{act}'); return {{x:e.state.x, L:e.state.L, imp:e.state.impMax, pc:e.state.pcMax, det:e.read({SIM}.SIM).detail}}}})()")
    check('end-stop impact recorded', st['imp']>0 and st['x']>0.95*st['L'], st)
    # --- live load slows the cylinder
    for vk in vs: ev(f"{SIM}.simClickValve('{vk}', 2)")
    pg.wait_for_timeout(3500)
    for vk in vs: ev(f"{SIM}.simClickValve('{vk}', 0)")
    pg.wait_for_timeout(500); v0=ev(f"{SIM}.SIM.el('{act}').state.v")
    ev(f"{SIM}.setLive('{act}','load',30000)"); pg.wait_for_timeout(500); v1=ev(f"{SIM}.SIM.el('{act}').state.v")
    check('live load slider changes the speed', abs(v1-v0)>1e-4, (v0,v1))
    # live throttle
    fk=ev(f"(()=>{{const s={SIM}.SIM; const ks=[...s.live.keys()].filter(k=>s.live.get(k).open); ks.forEach(k=>{SIM}.setLive(k,'open',0.1)); return ks[0]}})()")
    if fk:
        ev(f"{SIM}.setLive('{fk}','open',0.1)"); pg.wait_for_timeout(600); v2=ev(f"{SIM}.SIM.el('{act}').state.v")
        check('live throttle changes the speed', abs(v2-v1)>1e-4, (v1,v2,fk))
    # --- plot
    pk=ev(f"[...{SIM}.SIM.f.pipeNode.keys()].slice(0,6)")
    added=[ev(f"{SIM}.addTrace('pipe','{k}','p')") for k in pk]+[ev(f"{SIM}.addTrace('el','{act}','x')"), ev(f"{SIM}.addTrace('el','{act}','F')"), ev(f"{SIM}.addTrace('el','{act}','v')")]
    n=ev(f"{SIM}.traces.list.length"); check('plot holds max 8 signals', n==8, (n,added))
    pg.wait_for_timeout(600)
    ev("window.HYDRA.designer.st.dock.value={open:true,tab:'sim'}"); pg.wait_for_timeout(300)  # graph no longer auto-opens (UI batch)
    leg=ev("document.querySelectorAll('.dsimleg span i').length"); check('legend shows each signal', leg==8, leg)
    first=ev(f"{SIM}.traces.list[0].key"); ev(f"{SIM}.removeTrace('{first}')"); check('remove signal', ev(f"{SIM}.traces.list.length")==7)
    csv=ev(f"{SIM}.tracesCsv()"); lines=csv.split('\n'); check('CSV export', lines[0].startswith('t (s)') and len(lines)>20 and len(lines[0].split(','))==8, lines[0])
    cv=ev("(()=>{const r=document.querySelector('.dsimplot canvas').getBoundingClientRect(); return [r.x,r.y,r.width,r.height]})()")
    pg.mouse.click(cv[0]+cv[2]*0.4, cv[1]+cv[3]/2); pg.keyboard.down('Shift'); pg.mouse.click(cv[0]+cv[2]*0.8, cv[1]+cv[3]/2); pg.keyboard.up('Shift'); pg.wait_for_timeout(200)
    lg=ev("document.querySelector('.dsimleg').textContent"); check('two cursors with Δt', 'Δt' in lg and ' A ' in lg and ' B ' in lg, lg[:300])
    with pg.expect_download() as dl: pg.click('.dsimleg button:has-text("CSV")')
    check('CSV download', dl.value.suggested_filename.endswith('.csv'), dl.value.suggested_filename)
    # --- live popup via click
    ev(f"{SIM}.SIM && 0")
    # --- keep settings
    pk2=ev(f"(()=>{{const s={SIM}.SIM; return [...s.live.keys()].find(k=>s.live.get(k).set)}})()")
    if pk2: ev(f"{SIM}.setLive('{pk2}','set',123e5)")
    pg.wait_for_timeout(300)
    btn=pg.query_selector('.dsimbar button'); check('Keep these settings button', btn is not None)
    if btn: btn.click(); pg.wait_for_timeout(300)
    vals=ev(f"(()=>{{const c={DS}.sheetById('{sh}').components; return c.map(x=>[x.tag,x.values&&x.values.open,x.values&&x.values.set,x.values&&x.values.fext])}})()")
    print(vals)
    check('kept values written to parts', any(v[3]==30000 for v in vals) and (not fk or any(v[1]==10 for v in vals)) and (not pk2 or any(v[2] and abs(v[2]-123e5)<1 for v in vals)), (vals,fk,pk2))
    ev(f"{DS}.D.value.simStop()"); pg.wait_for_timeout(300)
    # undo works on kept settings
    # --- alerts: low rated pressure on the cylinder
    cid=[c[0] for c in comps if 'cyl' in c[2]][0]
    ev(f"{DS}.setComp('{sh}','{cid}','t',x=>{{x.values={{...x.values, prated:5e5}}}})")
    ev(f"{DS}.D.value.simRun()"); pg.wait_for_timeout(500)
    vs=ev(f"{SIM}.SIM.els.filter(e=>e.kind==='valve').map(e=>e.key)")
    for vk in vs: ev(f"{SIM}.simClickValve('{vk}', 0)")
    pg.wait_for_timeout(2500)
    al=ev(f"[...{SIM}.alertLog.entries()].map(([k,a])=>[k,a.text])"); print(al)
    check('rated-pressure alert', any('rated' in a[1].lower() or 'max' in a[1].lower() for a in al), al)
    halo=ev("document.querySelectorAll('.dcanvas .dalert').length"); check('orange alert highlight', halo>0, halo)
    r=pg.query_selector('.drule.warn[role=button]')
    if r: r.click(); pg.wait_for_timeout(200)
    check('click alert selects', r is not None and len(ev(f"{DS}.sel.value.ids"))>0, ev(f"{DS}.sel.value"))
    pg.screenshot(path=S+'/v52_sim.png')
    ev(f"{DS}.D.value.simStop()"); pg.wait_for_timeout(300)
    check('popups closed on stop', not ev("!!document.querySelector('.dlinetip,.dlivepop')"))
    # --- load profile spring
    ev(f"{DS}.setComp('{sh}','{cid}','t',x=>{{x.values={{...x.values, prated:undefined, lmode:'Spring', lF0:1000, lk:200}}}})")
    ev(f"{DS}.D.value.simRun()"); pg.wait_for_timeout(400)
    vs=ev(f"{SIM}.SIM.els.filter(e=>e.kind==='valve').map(e=>e.key)"); act=ev(f"{SIM}.SIM.els.find(e=>e.kind==='actuator').key")
    for vk in vs: ev(f"{SIM}.simClickValve('{vk}', 0)")
    F=[]
    for i in range(6): pg.wait_for_timeout(250); F.append(ev(f"(()=>{{const e={SIM}.SIM.el('{act}').state; return [Math.round(e.x*1000), Math.round(e.Fl)]}})()"))
    print('spring', F); check('spring load grows with stroke', F[-1][1]>F[0][1]+1000 and abs(F[0][1]-(1000+200000*F[0][0]/1000))<300, F)
    ev(f"{DS}.D.value.simStop()")
    # --- prefs tab
    ev(f"{H}.openModal('prefs',{{tab:'sim'}})"); pg.wait_for_timeout(400)
    check('Preferences › Simulation tab', ev("!!document.querySelector('.arrowprev')") and ev("document.querySelectorAll('.modal input[type=range]').length")>=5)
    pg.screenshot(path=S+'/v52_prefs.png')
    check('no page errors', not errs, errs[:3])
    b.close()
for r in R: print(*r)
print(sum(r[0]=='PASS' for r in R),'/',len(R))
