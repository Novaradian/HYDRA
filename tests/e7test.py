import json
from playwright.sync_api import sync_playwright
import os; S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
R=[]
def check(n,c,x=''): R.append(('PASS' if c else 'FAIL',n,str(x)[:300]))
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1500,'height':940}, accept_downloads=True); pg=ctx.new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500); ev=pg.evaluate
    H="window.HYDRA.S"; DS="window.HYDRA.designer.st"; E="window.HYDRA.designer.elec"
    check('elec module exposed', ev(f"!!{E}"))
    ev("window.HYDRA.Pj.createProject({name:'E7 test', template:'blank', unitSystem:'SI-bar'})"); pg.wait_for_timeout(400)
    # launch → chooser → new electric sheet
    ev("window.HYDRA.cmds.runCmd('launch.electric')"); pg.wait_for_timeout(500)
    check('Electric Designer opens (chooser)', 'Electric Circuit Designer' in pg.inner_text('.hd'), pg.inner_text('.hd')[:120])
    pg.click('.hd button:has-text("New electric sheet")'); pg.wait_for_timeout(700)
    el=ev(f"{DS}.D.value.sheetId"); check('new electric sheet opens on the canvas', ev(f"{H}.project.value.circuits['{el}'].type")=='electric' and bool(pg.query_selector('.hd .dcanvas')))
    tb=pg.inner_text('.hd .dtoolbar'); check('electric tools (Wire / Power / PE / Net label), no Simulate', all(x in tb for x in ['Wire','Power wire','PE wire','Net label']) and 'Simulate' not in tb, tb[:200])
    check('parts panel shows only electrical parts', ev("[...document.querySelectorAll('.dleft .cathead')].map(x=>x.textContent).join('|')").find('Directional')<0 and 'CONTACTS' in pg.inner_text('.dleft').upper())
    # place parts
    add=lambda ref,x,y: ev(f"{DS}.addPart('{el}','std:{ref}',{x},{y})")
    ids={k:add(r,x,y) for k,r,x,y in [('l24','e_label',40,40),('l0','e_label',40,200),('pb','e_pb_no',80,80),('k1','e_coil',80,160),('k1c','e_no',140,80),('h1','e_lamp',140,160),('q0','e_plc_out',200,80),('y1','e_sol',200,160),('q1','e_plc_out',240,80),('i0','e_plc_in',280,160),('b1','e_limit',280,90),('x1','e_terminal',320,100),('x2','e_terminal',340,100)]}
    tags=ev(f"(()=>{{const c={H}.project.value.circuits['{el}'].components; return Object.fromEntries(c.map(x=>[x.id,[x.tag,x.values&&x.values.tno]]))}})()")
    T={k:tags[v] for k,v in ids.items()}; print(T)
    check('IEC auto tags: S, K, H, Y; labels +24V / 0V', T['pb'][0]=='1S1' and T['k1'][0]=='1K1' and T['h1'][0]=='1H1' and T['y1'][0]=='1Y1' and T['l24'][0]=='+24V' and T['l0'][0]=='0V', T)
    check('PLC points get the next free address', T['q0'][0]=='Q0.0' and T['q1'][0]=='Q0.1' and T['i0'][0]=='I0.0', T)
    check('terminals continue the strip numbering', T['x1']==['X1','1'] and T['x2']==['X1','2'], T)
    # wires: port helper
    ev(f"""(()=>{{ window.EP=(cid,k)=>{{const st={DS}; const sh=st.sheetById('{el}'); const c=sh.components.find(x=>x.id===cid); const g=window.HYDRA.designer.geom.geomOf(c.ref); const q=g.ports[k]; const w=window.HYDRA.designer.geom.portWorld(c,q); return {{e:{{c:cid,p:q.key}}, pt:[w.x,w.y]}}}};
      window.WIRE=(a,b,kind)=>{{const st={DS}; return st.addPipe('{el}', kind||'wire', a.e, b.e, [a.pt,[a.pt[0],b.pt[1]],b.pt]);}}; }})()""")
    top=lambda k: f"EP('{ids[k]}',0)"
    bot=lambda k: f"EP('{ids[k]}',1)"
    # ports order: index 0 / 1 (13/14, A1/A2 …)
    wires=[(f"EP('{ids['l24']}',0)",top('pb')),(bot('pb'),top('k1')),(bot('k1'),f"EP('{ids['l0']}',0)"),(f"EP('{ids['q0']}',0)",top('y1')),(bot('y1'),f"EP('{ids['l0']}',0)"),(top('k1c'),f"EP('{ids['l24']}',0)"),(bot('k1c'),top('h1'))]
    for a,c in wires: ev(f"WIRE({a},{c})")
    pg.wait_for_timeout(300)
    nos=ev(f"(()=>{{const p={H}.project.value; const sh=p.circuits['{el}']; return sh.pipes.map(w=>{E}.wireNo(p,'{el}',w.id))}})()")
    print('wire nos', nos)
    check('wire numbers: named nets keep their label, others numbered', nos[0]=='+24V' and nos[2]=='0V' and nos[4]=='0V' and nos[5]=='+24V' and nos[1].isdigit() and nos[3].isdigit() and nos[1]!=nos[3], nos)
    svg=ev(f"window.HYDRA.designer.render.sheetSvg({H}.project.value.circuits['{el}'], {{sheetNo:1, sheets:1, fmt:{DS}.fmtQ}})")
    check('drawing carries wire numbers and the cross-reference layer', 'data-layer="XREF"' in svg and 'data-layer="WIRE"' in svg and '>+24V<' in svg, len(svg))
    # cross reference: contact 1K? → make k1c contact of coil 1K1
    ev(f"{DS}.setComp('{el}','{ids['k1c']}','t',x=>{{x.tag='1K1'}})")
    xr=ev(f"(()=>{{const x={E}.xref({H}.project.value); return (x.contacts.get('1K1')||[]).map(c=>c.kind+' '+c.pins+' '+c.loc)}})()")
    check('coil 1K1 lists its contact with terminals and /sheet.column', len(xr)==1 and xr[0].startswith('NO 13-14 /') and '.' in xr[0], xr)
    ov=ev(f"{E}.overlaySvg({H}.project.value.circuits['{el}'], {H}.project.value)")
    check('overlay: contact map under coil, coil location at contact', 'NO 13-14' in ov and ov.count('/1.')>=2, ov[:200])
    # hydraulic side + links
    hy=ev(f"{H}.addNode('sheet', null, 'hydraulic', 'Hyd')"); ev(f"{H}.openSheetTab('{hy}')"); pg.wait_for_timeout(700)
    v=ev(f"{DS}.addPart('{hy}','std:v_43_closed',150,120)"); m=ev(f"{DS}.addPart('{hy}','std:h_emotor',100,200)"); cyl=ev(f"{DS}.addPart('{hy}','std:h_cyl_double',150,50)"); ps=ev(f"{DS}.addPart('{hy}','std:h_pswitch',220,120)")
    hv=ev(f"(()=>{{const c={H}.project.value.circuits['{hy}'].components; return c.map(x=>[x.ref,x.tag,x.values])}})()"); print(hv)
    check('valve carries Solenoid a / b tag fields', 'ya' in hv[0][2] and 'yb' in hv[0][2], hv[0][2])
    ev(f"{DS}.setComp('{hy}','{v}','t',x=>{{x.values={{...x.values, ya:'1Y1', yb:'1Y2'}}}})")
    mt=ev(f"{E}.machineTags({H}.project.value).map(r=>[r.tag,r.status,r.fluid,r.elec,r.plc,r.note])"); print(mt)
    r1=[r for r in mt if r[0]=='1Y1'][0]; r2=[r for r in mt if r[0]=='1Y2'][0]
    check('valve solenoid 1Y1 ↔ coil 1Y1 ↔ PLC Q0.0 linked', r1[1]=='linked' and 'Q0.0' in r1[4], r1)
    check('solenoid 1Y2 without coil reported open', r2[1]=='open', r2)
    io=ev(f"{E}.plcIo({H}.project.value).map(r=>[r.addr,r.devices.map(d=>d.ref.comp.tag+':'+(d.link&&d.link.text)).join(',')])"); print(io)
    check('PLC I/O: Q0.0 → 1Y1 → 1V1 solenoid a', any(x[0]=='Q0.0' and '1V1 solenoid a' in x[1] for x in io), io)
    # e_sol picker links from the electric side
    ev(f"{H}.openSheetTab('{el}')"); pg.wait_for_timeout(500)
    ev(f"{DS}.setSel('{el}',['{ids['y1']}'])"); pg.wait_for_timeout(300)
    check('Properties show the machine link', 'MACHINE LINK' in pg.inner_text('.dright').upper() and '1V1 solenoid a' in pg.inner_text('.dright'))
    # motor + pressure switch + position sensor links
    mtag=hv[1][1]; ptag=hv[3][1]; ctag=hv[2][1]
    mo=add('e_motor3',380,160); sw=add('e_pswitch',380,80)
    ev(f"{DS}.setComp('{el}','{mo}','t',x=>{{x.tag='{mtag}'}})"); ev(f"{DS}.setComp('{el}','{sw}','t',x=>{{x.tag='{ptag}'}})"); ev(f"{DS}.setComp('{el}','{ids['b1']}','t',x=>{{x.values={{...x.values, watch:'{ctag}', wend:'Extended (+)'}}}})")
    mt=ev(f"{E}.machineTags({H}.project.value).map(r=>[r.tag,r.status,r.fluid])"); print(mt)
    check('motor, pressure switch and position sensor linked by tag', all(any(r[0]==tg and r[1]=='linked' for r in mt) for tg in [mtag, ptag]) and any(r[1]=='linked' and r[2].startswith(ctag+'+') for r in mt), mt)
    # hydraulic tags isolated: shared tags give no duplicate warnings on the hydraulic sheet
    hr=ev(f"window.HYDRA.designer.model.ruleCheck({H}.project.value.circuits['{hy}'], {H}.project.value).map(i=>i.level+':'+i.text)")
    check('hydraulic rule check ignores shared electric tags', not any('used' in x and ('1M1' in x or mtag in x or ptag in x) for x in hr), [x for x in hr if 'Tag' in x or 'tag' in x])
    # rules
    rr=ev(f"{E}.elecRules({H}.project.value.circuits['{el}'], {H}.project.value).map(i=>i.level+':'+i.text)"); print(rr)
    check('electric rule check: no errors on a clean sheet', not any(x.startswith('err') for x in rr), rr)
    c2=add('e_no',420,80); ev(f"{DS}.setComp('{el}','{c2}','t',x=>{{x.tag='9K9'}})")
    q9=add('e_plc_out',440,80); ev(f"{DS}.setComp('{el}','{q9}','t',x=>{{x.tag='Q0.0'}})")
    ev(f"WIRE(EP('{ids['l24']}',0), EP('{ids['l0']}',0))")
    rr=ev(f"{E}.elecRules({H}.project.value.circuits['{el}'], {H}.project.value).map(i=>i.level+':'+i.text)"); print(rr)
    check('rule check: short circuit +24V / 0V', any('Short circuit' in x and x.startswith('err') for x in rr), rr)
    check('rule check: duplicate PLC address', any('Q0.0 is used 2' in x for x in rr), rr)
    check('rule check: contact without coil', any('9K9' in x and 'no coil' in x for x in rr), rr)
    ev("window.HYDRA.cmds.runCmd('edit.undo')"); pg.wait_for_timeout(200)
    # simulate on electric: no simulation
    ev(f"{DS}.D.value.simRun()"); pg.wait_for_timeout(300)
    check('Simulate is not available on electric sheets', ev("window.HYDRA.designer.sim.simView.value")==None)
    # exports
    def dl(k):
        with pg.expect_download() as d: ev(f"{DS}.D.value.exportAs('{k}')")
        path=d.value.path(); return d.value.suggested_filename, open(path,encoding='utf-8-sig',errors='ignore').read()
    for k,needle in [('wires','Wire no.'),('terminals','Strip'),('plcio','Address'),('tags','Tag'),('links','hydra.machine-links/1')]:
        fn,txt=dl(k); check(f'export {k}', needle in txt and len(txt.splitlines())>1, (fn, txt[:120]))
    for k in ['svg','dxf','pdf','csv']:
        fn,txt=dl(k); check(f'export {k} on electric sheet', len(txt)>100, fn)
    fn,txt=dl('dxf'); check('DXF has WIRE and XREF layers', 'WIRE' in txt and 'XREF' in txt)
    # renumber keeps contacts with their coil
    ev(f"{DS}.setComp('{el}','{ids['k1']}','t',x=>{{x.tag='1K7'}})"); ev(f"{DS}.setComp('{el}','{ids['k1c']}','t',x=>{{x.tag='1K7'}})")
    ev(f"{DS}.renumberTags('{el}')"); pg.wait_for_timeout(200)
    tg=ev(f"(()=>{{const c={H}.project.value.circuits['{el}'].components; return [c.find(x=>x.id==='{ids['k1']}').tag, c.find(x=>x.id==='{ids['k1c']}').tag, c.find(x=>x.id==='{ids['y1']}').tag, c.find(x=>x.id==='{ids['q0']}').tag]}})()")
    check('renumber: coil and contact move together, linked solenoid and PLC address kept', tg[0]==tg[1] and tg[0]!='1K7' and tg[2]=='1Y1' and tg[3]=='Q0.0', tg)
    # net labels join across sheets
    el2=ev(f"{H}.addNode('sheet', null, 'electric', 'E2')"); ev(f"{H}.openSheetTab('{el2}')"); pg.wait_for_timeout(700)
    la=ev(f"{DS}.addPart('{el2}','std:e_label',40,40)"); lm=ev(f"{DS}.addPart('{el2}','std:e_lamp',80,80)")
    ev(f"{DS}.addPipe('{el2}','wire', {{c:'{la}',p:'1'}}, {{c:'{lm}',p:'X1'}}, [[30,40],[80,40],[80,70]])")
    n2=ev(f"(()=>{{const p={H}.project.value; const sh=p.circuits['{el2}']; return sh.pipes.map(w=>{E}.wireNo(p,'{el2}',w.id))}})()")
    check('net label +24V on another sheet joins the same potential', n2==['+24V'], n2)
    # Home card opens electric sheets
    ev(f"{H}.activeTab.value='home'"); pg.wait_for_timeout(400)
    check('Electric Designer launcher is ready', 'step 7' not in pg.inner_text('body'))
    # hydraulic sample unchanged: valve fields only added
    check('no page errors', not errs, errs[:3])
    b.close()
for r in R: print(*r)
print(sum(r[0]=='PASS' for r in R),'/',len(R))
