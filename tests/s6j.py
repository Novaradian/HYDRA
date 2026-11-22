import sys, os, json
from playwright.sync_api import sync_playwright
import os; S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
R=[]
def check(n,c,x=''): R.append(('PASS' if c else 'FAIL',n,str(x)[:300]))
JS_HELP = r"""
window.T = {
  port(sh, cid, key){ const H=window.HYDRA; const c=H.S.project.value.circuits[sh].components.find(x=>x.id===cid); const g=H.designer.geom.geomOf(c.ref); const p=g.ports.find(q=>q.key===key)||g.ports.find(q=>q.name===key); if(!p) throw new Error('no port '+key+' on '+c.ref+' have '+g.ports.map(q=>q.key)); const w=H.designer.geom.portWorld(c,p); return {e:{c:cid,p:p.key}, pt:[w.x,w.y]}; },
  part(sh, ref, x, y, rot=0, mirror=false){ return window.HYDRA.designer.st.addPart(sh, ref, x, y, rot, mirror); },
  pipe(sh, A, B, kind='work'){ const a=T.port(sh, A[0], A[1]), b=T.port(sh, B[0], B[1]); return window.HYDRA.designer.st.addPipe(sh, kind, a.e, b.e, [a.pt, [a.pt[0], (a.pt[1]+b.pt[1])/2], [b.pt[0], (a.pt[1]+b.pt[1])/2], b.pt]); },
  setTag(sh, cid, tag){ window.HYDRA.designer.st.setComp(sh, cid, 'tag', x=>{x.tag=tag}); }
};
"""
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1500,'height':940}, accept_downloads=True); pg=ctx.new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500)
    ev=pg.evaluate; H="window.HYDRA.S"; DS="window.HYDRA.designer.st"; SIM="window.HYDRA.designer.sim"
    ev(JS_HELP)
    ev("window.HYDRA.Pj.createProject({name:'Machine test', template:'blank', unitSystem:'SI-bar'})"); pg.wait_for_timeout(400)
    pu=ev(f"{H}.addNode('sheet', null, 'hydraulic', 'Power unit')"); ax=ev(f"{H}.addNode('sheet', null, 'hydraulic', 'Axis')")
    ev(f"{H}.openSheetTab('{pu}')"); pg.wait_for_timeout(500)
    ids=ev(f"""(()=>{{ const s='{pu}';
      const pump=T.part(s,'std:h_pump_fixed',100,150), tk=T.part(s,'std:h_tank',100,190), rv=T.part(s,'std:h_relief',150,150,180,true), tk2=T.part(s,'std:h_tank',150,190), tk3=T.part(s,'std:h_tank',200,190);
      const p1=T.part(s,'sys:conn',100,90,270), t1=T.part(s,'sys:conn',200,90,270);
      T.setTag(s,p1,'P1'); T.setTag(s,t1,'T1');
      T.pipe(s,[pump,'P'],[p1,'X']); T.pipe(s,[pump,'S'],[tk,'T']); T.pipe(s,[rv,'P'],[pump,'P']); T.pipe(s,[rv,'T'],[tk2,'T']); T.pipe(s,[t1,'X'],[tk3,'T']);
      return {{pump, rv, p1, t1}}; }})()""")
    ev(f"{H}.openSheetTab('{ax}')"); pg.wait_for_timeout(400)
    ids2=ev(f"""(()=>{{ const s='{ax}';
      const cyl=T.part(s,'std:h_cyl_double',100,60,180,true), v=T.part(s,'std:v_43_closed',100,130);
      const p1=T.part(s,'sys:conn',95,190,90), t1=T.part(s,'sys:conn',105,190,90);
      T.setTag(s,p1,'P1'); T.setTag(s,t1,'T1');
      T.pipe(s,[cyl,'A'],[v,'A']); T.pipe(s,[cyl,'B'],[v,'B']); T.pipe(s,[v,'P'],[p1,'X']); T.pipe(s,[v,'T'],[t1,'X']);
      return {{cyl, v, p1, t1}}; }})()""")
    print(ids, ids2)
    rules=ev(f"window.HYDRA.designer.asm.asmRules({H}.project.value.circuits['{ax}'], {H}.project.value).map(i=>i.level+':'+i.text)")
    print('axis rules', rules)
    mid=ev("window.HYDRA.designer.asm.buildMachine()"); pg.wait_for_timeout(300)
    check('machine built', bool(mid))
    m=ev(f"(()=>{{const c={H}.project.value.circuits['{mid}']; return {{mode:c.mode, comps:c.components.map(x=>x.tag+':'+x.ref.split(':')[0]), pipes:c.pipes.length}}}})()")
    print('machine', m)
    check('machine has 2 instances, 2 links, infinite', len(m['comps'])==2 and m['pipes']==2 and m['mode']=='infinite', m)
    ev(f"{H}.openSheetTab('{mid}')"); pg.wait_for_timeout(800)
    pg.screenshot(path=S+'/v5_machine.png')
    fl=ev(f"(()=>{{const f=window.HYDRA.designer.asm.flatten({H}.project.value,'{mid}'); return {{els:f.els.map(e=>e.tag), n:f.n, issues:f.issues.map(i=>i.text)}}}})()")
    print('flat', fl)
    check('flatten has 7 parts', len(fl['els'])==7, fl)
    rules=ev(f"[...window.HYDRA.designer.model.ruleCheck({H}.project.value.circuits['{mid}'], {H}.project.value), ...window.HYDRA.designer.asm.asmRules({H}.project.value.circuits['{mid}'], {H}.project.value)].map(i=>i.level+':'+i.text)")
    print('machine rules', rules)
    pg.wait_for_timeout(300); ev(f"{DS}.viewReq.value = {{n: {DS}.viewReq.value.n+1, kind:'fit'}}"); pg.wait_for_timeout(400)
    check('instances placed as full circuits', ev(f"{H}.project.value.circuits['{mid}'].components.every(c=>c.ref.startsWith('asmx:'))"))
    pg.screenshot(path=S+'/v5b_machine.png')
    btn=pg.query_selector('.hd:visible .dsimctl .btn'); b0=btn.bounding_box()
    ev(f"{DS}.D.value.simRun()"); pg.wait_for_timeout(800)
    btns=pg.query_selector_all('.hd:visible .dsimctl .btn'); b1=btns[-1].bounding_box(); lbl=btns[-1].inner_text()
    print('sim button', b0, b1, lbl)
    check('Simulate becomes Pause in the same place', abs(b0['x']-b1['x'])<3 and abs(b0['y']-b1['y'])<3 and 'Pause' in lbl, (b0,b1,lbl))
    vk=ev(f"{SIM}.SIM.els.find(e=>e.kind==='valve').key"); el=pg.query_selector(f'[data-simv="{vk}"]'); bb=el.bounding_box(); pg.mouse.click(bb['x']+bb['width']*0.25, bb['y']+bb['height']*0.5); pg.wait_for_timeout(3500)
    cyl=ev(f"{SIM}.SIM.els.find(e=>e.kind==='actuator').state.x"); check('machine cylinder extends', cyl>0.25, cyl)
    pg.screenshot(path=S+'/v5b_machine_sim.png')
    pg.click('.dsimctl .btn:has-text("Pause")'); pg.wait_for_timeout(200)
    b2=pg.query_selector_all('.hd:visible .dsimctl .btn')[-1].bounding_box(); check('Resume still in place', abs(b0['x']-b2['x'])<3)
    ev(f"{DS}.D.value.simStop()"); pg.wait_for_timeout(300)
    b3=pg.query_selector('.hd:visible .dsimctl .btn').bounding_box(); check('Simulate back in place', abs(b0['x']-b3['x'])<3)
    # fields on parts
    ev(f"{H}.openSheetTab('{pu}')"); pg.wait_for_timeout(500)
    ev(f"{DS}.setSel('{pu}', ['{ids['rv']}'])"); pg.wait_for_timeout(300)
    print('ACTIVE', ev(f"{H}.activeTab.value"), ev(f"{DS}.D.value && {DS}.D.value.sheetId"), '{pu}', ev(f"JSON.stringify({DS}.sel.value)")[:200], ev(f"{DS}.rightTab.value")); pg.screenshot(path=S+'/v5b_props.png')
    txt=ev("[...document.querySelectorAll('.dright')].map(e=>e.textContent).join(' ')"); check('relief shows Simulation data', 'Simulation data' in txt and 'Rated flow' in txt and 'Override' in txt, txt[:300])
    ev(f"{DS}.setSel('{pu}', ['{ids['pump']}'])"); pg.wait_for_timeout(300)
    txt=ev("[...document.querySelectorAll('.dright')].map(e=>e.textContent+' '+[...e.querySelectorAll('input')].map(i=>i.value).join(' ')).join(' ')"); check('pump shows library displacement 16 + sim data', '16' in txt and 'efficiency' in txt.lower(), txt[:600])
    print('errs', errs[:8])
    b.close()
for r in R: print(*r)
