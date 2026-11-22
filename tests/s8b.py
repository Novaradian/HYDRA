# Step 8b: the machine — PLC program + hydraulic simulation in lock-step
import json, time
from playwright.sync_api import sync_playwright
import os; S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
R=[]
def check(n,c,x=''): R.append(('PASS' if c else 'FAIL',n,str(x)[:300]))
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1600,'height':960}); pg=ctx.new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500); ev=pg.evaluate
    pg.add_script_tag(path=S+'/tests/t8/seqprog.js')
    H="window.HYDRA"; P="window.HYDRA.plc"; L="window.HYDRA.plc.state"; SIM="window.HYDRA.designer.sim"
    ev(f"{H}.designer.sim || ({H}.designer.sim = null)")
    has_sim=ev(f"!!{H}.designer.sim");
    if not has_sim: print('NOTE: designer.sim not exposed')
    ev(f"{H}.actions.openSampleCopy('s_sequence')"); pg.wait_for_timeout(1200)
    pid=ev(f"{H}.S.addNode('program', null, undefined, 'Auto_Cycle')")
    ev(f"(()=>{{const T={P}.signals.signals({H}.S.project.value); {L}.writeProg('{pid}', x=>{{ x.ws=mkSeqProg(T); x.active=true; }}); }})()")
    sheet=ev(f"Object.values({H}.S.project.value.nodes).find(n=>n.name==='Two-cylinder hydraulics').id")
    check('machine sheet found automatically', ev(f"{P}.link.machineSheet({H}.S.project.value, {H}.S.project.value.programs['{pid}'])")==sheet)
    ev(f"{H}.S.openSheetTab('{pid}')"); pg.wait_for_timeout(2200)
    check('toolbar says it runs with the sheet', 'with Two-cylinder hydraulics' in pg.inner_text('.hd.lc .dtoolbar'))
    pg.click('.lcrun'); pg.wait_for_timeout(400)
    r=ev(f"(()=>{{const r={L}.RT.value; return [r.rt.state, r.link&&r.link.sheet, r.link&&r.link.startedSim, r.rt.adapter.name, {SIM}.simView.value&&{SIM}.simView.value.sheet, {SIM}.simView.value&&{SIM}.simView.value.running]}})()")
    check('Run starts the machine: PLC + hydraulic simulation of the sheet', r[0]=='running' and r[1]==sheet and r[2] and r[3]=='machine' and r[4]==sheet and r[5], r)
    sig=lambda tag: ev(f"{P}.signals.signals({H}.S.project.value).sigs.find(s=>s.tag==='{tag}').id")
    rd=lambda tag: ev(f"!!{L}.RT.value.rt.rd('{sig(tag)}')")
    lk=ev(f"[...{L}.RT.value.rt.adapter.linked]"); man=ev(f"[...{L}.RT.value.rt.adapter.manual.keys()]")
    check('sensors 1B1…2B2 and cylinder ends come from the simulation; 1S1 Start stays manual', all(sig(x) in lk for x in ['1B1','1B2','2B1','2B2']) and man==[sig('1S1')], (len(lk), man))
    check('position sensors read the cylinders: 1B1 (1A1 −) TRUE, 1B2 (1A1 +) FALSE', rd('1B1') and not rd('1B2'))
    check('I/O table: simulated inputs locked, manual input clickable', ev("(()=>{const row=t=>[...document.querySelectorAll('.lcio tr')].find(r=>r.cells[0]&&r.cells[0].textContent.trim()===t); const a=row('1B1'), b=row('1S1'); return [a&&a.querySelector('.lcbool')?.disabled, b&&b.querySelector('.lcbool')?.disabled, document.querySelectorAll('.lcio tr').length]})()")==[True,False,ev("document.querySelectorAll('.lcio tr').length")])
    vpos=lambda tag: ev(f"(()=>{{const v={SIM}.SIM.els.find(e=>e.kind==='valve'&&e.tag==='{tag}'); return [v.state.pos, v.rest, v.sol.on, v.sol.a, v.sol.b]}})()")
    check('valves taken over by the PLC (solenoids de-energised → rest)', vpos('1V1')[2] and vpos('1V1')[0]==vpos('1V1')[1], vpos('1V1'))
    cur=lambda: ev(f"{L}.RT.value.rt.seqs.AUTO && {L}.RT.value.rt.seqs.AUTO.cur")
    # press Start in the I/O table
    ev("[...document.querySelectorAll('.lcio tr')].find(r=>r.cells[0]&&r.cells[0].textContent.trim()==='1S1').querySelector('.lcbool').click()"); pg.wait_for_timeout(250)
    ev(f"{L}.setInput('{pid}','{sig('1S1')}',false)")
    seen=set(); t0=time.time(); v1=v2=None; s1x=None
    while time.time()-t0<16:
        c=cur(); seen.add(c)
        if c=='S1' and v1 is None: pg.wait_for_timeout(150); v1=vpos('1V1'); s1x=ev(f"{SIM}.SIM.els.find(e=>e.kind==='actuator'&&e.tag==='1A1').state.v")
        if c=='S2' and v2 is None: pg.wait_for_timeout(150); v2=vpos('1V1')
        if c=='S0' and 'S4' in seen: break
        pg.wait_for_timeout(100)
    check('S1: solenoid 1Y1 (Q0.0) shifts 1V1 to a, 1A1 extends', v1 and v1[3] and v1[0]==0 and s1x>0.01, (v1, s1x))
    check('S2: 1Y1 off → 1V1 springs back to rest', v2 and not v2[3] and v2[0]==v2[1], v2)
    check('full cycle A+ B+ A− B− runs by itself on the hydraulics', {'S1','S2','S3','S4'}<=seen and cur()=='S0', seen)
    check('cycle counter = 1, sensors back home (1B1, 2B1)', ev(f"{L}.RT.value.rt.counters.Cycles.CV")==1 and rd('1B1') and rd('2B1'))
    tp=ev(f"[{L}.RT.value.rt.t, {SIM}.SIM.t]"); check('PLC time follows the solver time (lock-step)', abs(tp[0]-tp[1])<0.02, tp)
    # pause / scan / resume
    pg.click('.hd.lc button:has-text("Pause")'); pg.wait_for_timeout(200)
    check('Pause freezes PLC and hydraulics together', ev(f"{L}.RT.value.rt.state")=='paused' and not ev(f"{SIM}.simView.value.running"))
    a=ev(f"[{L}.RT.value.rt.scanNo, {SIM}.SIM.t]"); pg.click('.hd.lc button:has-text("Scan")'); pg.wait_for_timeout(200); bb=ev(f"[{L}.RT.value.rt.scanNo, {SIM}.SIM.t]")
    check('Scan: one PLC scan and 10 ms of hydraulics', bb[0]==a[0]+1 and 0.005<bb[1]-a[1]<0.02, (a,bb))
    pg.click('.hd.lc button:has-text("Resume")'); pg.wait_for_timeout(200)
    check('Resume runs both again', ev(f"{L}.RT.value.rt.state")=='running' and ev(f"{SIM}.simView.value.running"))
    # breakpoint on S3 halts the hydraulics too
    s3=ev(f"{L}.RT.value.rt.c.seqs[0].steps[3].block"); ev(f"{L}.bps('{pid}').add('{s3}')")
    ev(f"{L}.setInput('{pid}','{sig('1S1')}',true)"); pg.wait_for_timeout(250); ev(f"{L}.setInput('{pid}','{sig('1S1')}',false)")
    t0=time.time()
    while time.time()-t0<10 and ev(f"{L}.RT.value.rt.state")!='paused': pg.wait_for_timeout(100)
    pg.wait_for_timeout(300); st1=ev(f"{SIM}.SIM.t"); pg.wait_for_timeout(400); st2=ev(f"{SIM}.SIM.t")
    check('breakpoint pauses the machine (solver stops too)', ev(f"{L}.RT.value.rt.bpAt")==s3 and abs(st2-st1)<1e-9 and not ev(f"{SIM}.simView.value.running"), (st1,st2))
    ev(f"{L}.bps('{pid}').clear()"); pg.click('.hd.lc button:has-text("Resume")'); pg.wait_for_timeout(400)
    check('resume after breakpoint', ev(f"{L}.RT.value.rt.state")=='running' and ev(f"{SIM}.SIM.t")>st2)
    # E-stop: outputs off, valves spring to rest, cylinders stop
    pg.click('.hd.lc .lcestop'); pg.wait_for_timeout(700)
    vv=[vpos('1V1'), vpos('2V1')]; sp=ev(f"{SIM}.SIM.els.filter(e=>e.kind==='actuator').map(e=>Math.abs(e.state.v))")
    check('E-STOP: solenoids off → both valves at rest, cylinders stand still', all(v[0]==v[1] and not v[3] and not v[4] for v in vv) and max(sp)<0.002, (vv, sp))
    pg.click('.hd.lc .lcestop'); pg.click('.hd.lc button:has-text("Reset")'); pg.wait_for_timeout(300)
    check('release + Reset → running, sequence at S0', ev(f"{L}.RT.value.rt.state")=='running' and cur()=='S0')
    # the sheet: machine strip with the operator buttons; leaving tabs keeps the machine running
    ev(f"{H}.S.openSheetTab('{sheet}')"); pg.wait_for_timeout(1200)
    check('sheet shows the machine strip (program, step, Start, E-STOP, Stop machine)', all(x in pg.inner_text('.mstrip') for x in ['Auto_Cycle','AUTO: S0','Start','E-STOP','Stop machine']), pg.inner_text('.mstrip')[:200])
    check('machine keeps running while the program tab is not shown', ev(f"{L}.RT.value.rt.state")=='running' and ev(f"{SIM}.simView.value.running"))
    box=pg.query_selector('.mstrip .mpb').bounding_box(); pg.mouse.move(box['x']+20, box['y']+10); pg.mouse.down(); pg.wait_for_timeout(200)
    held=rd('1S1'); pg.mouse.up(); pg.wait_for_timeout(150); rel=rd('1S1')
    check('Start in the strip is hold-to-press (ON while held, OFF on release)', held and not rel, (held, rel))
    ev(f"{H}.S.openSheetTab('{pid}')"); pg.wait_for_timeout(1500); ev(f"{H}.S.openSheetTab('{sheet}')"); pg.wait_for_timeout(800)
    check('switching tabs back and forth does not stop the machine', ev(f"{L}.RT.value.rt.state")=='running' and ev(f"{SIM}.simView.value&&{SIM}.simView.value.running"))
    # Stop machine: PLC and the simulation it started stop together
    pg.click('.mstrip button:has-text("Stop machine")'); pg.wait_for_timeout(300)
    check('Stop machine stops PLC and simulation', ev(f"{L}.RT.value.rt.state")=='stopped' and not ev(f"{SIM}.simView.value"))
    # Machine button on the sheet
    check('sheet toolbar offers “Machine” (simulation + active program)', ev("!!document.querySelector('.btn.mbtn')"))
    pg.click('.btn.mbtn'); pg.wait_for_timeout(500)
    check('Machine button starts the active program with this sheet', ev(f"{L}.RT.value.rt.state")=='running' and ev(f"{L}.RT.value.link.sheet")==sheet and ev(f"{SIM}.simView.value.sheet")==sheet)
    # the sheet's own Stop stops the PLC too
    pg.click('.hd .dsimctl button:has-text("Stop")'); pg.wait_for_timeout(300)
    check('stopping the simulation on the sheet stops the PLC', ev(f"{L}.RT.value.rt.state")=='stopped')
    # plain simulation without PLC: valves behave exactly as before (manual click stays)
    ev(f"{H}.cmds.runCmd('sim.run')"); pg.wait_for_timeout(400)
    v=ev(f"(()=>{{const s={SIM}.SIM; const v=s.els.find(e=>e.kind==='valve'&&e.tag==='1V1'); {SIM}.simClickValve(v.key,0); return v.key}})()"); pg.wait_for_timeout(1200)
    vp=vpos('1V1'); check('simulation alone: no PLC control, a clicked valve stays where clicked (unchanged)', not vp[2] and vp[0]==0, vp)
    ev(f"{SIM}.simStop()"); pg.wait_for_timeout(200)
    # pump drive output: the program starts / stops the pump
    pid2=ev(f"{H}.S.addNode('program', null, undefined, 'Pump')")
    m=ev(f"{P}.signals.signals({H}.S.project.value).sigs.find(s=>s.src==='drv').id")
    ws={'blocks':{'blocks':[{'type':'hy_main','id':'m','x':10,'y':10,'next':{'block':{'type':'hy_out','id':'o','fields':{'SIG':m,'VAL':'1'}}}}]}}
    ev(f"{L}.writeProg('{pid2}', x=>{{ x.ws={json.dumps(ws)}; }})")
    pressure=lambda: ev(f"(()=>{{const s={SIM}.SIM; const pm=s.els.find(e=>e.kind==='pump'); return s.p[pm.nodes[1]]/1e5}})()")
    ev(f"{L}.run('{pid2}')"); pg.wait_for_timeout(1500); pon=pressure()
    ev(f"{L}.writeProg('{pid2}', x=>{{ x.ws.blocks.blocks[0].next.block.fields.VAL='0'; }})"); ev(f"{L}.stop()"); pg.wait_for_timeout(200); ev(f"{L}.run('{pid2}')"); pg.wait_for_timeout(1500); poff=pressure()
    ev(f"{L}.stop()")
    check('pump motor output: ON builds system pressure, OFF leaves it at zero', pon>50 and poff<5, (pon, poff))
    # hydraulics + PLC without any electric sheet: solenoids and cylinder ends used directly
    ev(f"{H}.actions.openSampleCopy('s_sequence')"); pg.wait_for_timeout(1200)
    el=ev(f"Object.values({H}.S.project.value.nodes).find(n=>n.type==='sheet'&&n.sheetType==='electric').id"); ev(f"{H}.S.deleteNodes(['{el}'])"); pg.wait_for_timeout(300)
    T=ev(f"(()=>{{const t={P}.signals.signals({H}.S.project.value); return [t.sigs.filter(s=>s.src==='sol').map(s=>[s.id,s.desc]), t.cyls.map(c=>[c.id,c.tag])]}})()")
    check('no electric sheet: solenoids offered directly', len(T[0])==4, T[0])
    sa=[s[0] for s in T[0] if '1V1 solenoid a' in s[1]][0]; sb=[s[0] for s in T[0] if '1V1 solenoid b' in s[1]][0]; c1=[c[0] for c in T[1] if c[1]=='1A1'][0]
    step=lambda i,lab,sg,end: {'type':'hy_step','id':'st'+i,'fields':{'ID':'S'+i,'LABEL':lab,'GOTO':'next'},'inputs':{'DO':{'block':{'type':'hy_act','id':'a'+i,'fields':{'SIG':sg}}},'T':{'block':{'type':'hy_cyl','id':'c'+i,'fields':{'CYL':c1,'END':end}}}}}
    s1=step('1','A+',sa,'p'); s2=step('2','A−',sb,'m'); s1['next']={'block':s2}
    ws={'blocks':{'blocks':[{'type':'hy_main','id':'m','x':10,'y':10,'next':{'block':{'type':'hy_seq','id':'q','fields':{'NAME':'AB'},'inputs':{'STEPS':{'block':s1}}}}}]}}
    pid3=ev(f"{H}.S.addNode('program', null, undefined, 'Direct')"); ev(f"{L}.writeProg('{pid3}', x=>{{ x.ws={json.dumps(ws)}; }})")
    c=ev(f"{L}.compileProg({H}.S.project.value,'{pid3}')"); ev(f"{L}.run('{pid3}')")
    xs=[]; t0=time.time()
    while time.time()-t0<6: xs.append(ev(f"{SIM}.SIM.els.find(e=>e.kind==='actuator'&&e.tag==='1A1').state.x")); pg.wait_for_timeout(150)
    ev(f"{L}.stop()")
    check('hydraulic + PLC only: program drives 1V1 solenoids directly, 1A1 goes out and back', max(xs)>0.29 and any(x<0.03 for x in xs[xs.index(max(xs)):]), [round(x,3) for x in xs[::5]])
    check('no page errors', not errs, errs[:5])
    b.close()
fails=[r for r in R if r[0]=='FAIL']
for r in R: print(r[0], r[1], '' if r[0]=='PASS' else r[2])
print(f'{len(R)-len(fails)}/{len(R)} passed')
