import json
from playwright.sync_api import sync_playwright
import os; S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
R=[]
def check(n,c,x=''): R.append(('PASS' if c else 'FAIL',n,str(x)[:300]))
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1500,'height':940}); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(3000); ev=pg.evaluate
    ev("window.HYDRA.Pj.createProject({name:'New parts', template:'blank', unitSystem:'SI-bar'})"); pg.wait_for_timeout(400)
    ev("""(()=>{ window.T2 = (ref)=>{ const H=window.HYDRA, S=H.S, st=H.designer.st, M=H.designer.sim, G=H.designer.geom; const g=G.geomOf('std:'+ref);
      window._sh = window._sh || {}; const dom=g.domain==='pneumatic'?'pneumatic':'hydraulic'; if(!window._sh[dom]) window._sh[dom]=S.addNode('sheet', null, dom, 'T '+dom); const sh=window._sh[dom];
      S.mutate('clear', d=>{ const c=d.circuits[sh]; c.components=[]; c.pipes=[]; c.junctions=[]; c.texts=[]; c.enclosures=[]; c.designerVersion=1; });
      st.addPart(sh, 'std:'+ref, 100, 100); const s=new M.Sim(S.project.value, sh, {}); const e=s.els.find(x=>x.el && x.el.comp.ref==='std:'+ref); return {s,e,g}; };
    window.F2 = (e, pr)=>{ const P=i=>{ const k=e.nodes.indexOf(i); return pr[k]??0 }; const out=e.nodes.map(()=>0); e.f(P,out); return out.map(x=>x*60000); }; })()""")
    B=1e5
    def run(js): return ev("(()=>{"+js+"})()")
    # seat 2/2
    r=run("const {s,e}=T2('v_22_seat'); const ports=Object.keys(e.el.ports); const iP=ports.indexOf('P'), iA=ports.indexOf('A'); const pr=[0,0]; pr[iP]=100e5; const closedPA=F2(e,pr); const pr2=[0,0]; pr2[iA]=100e5; const closedAP=F2(e,pr2); e.command(0,s); s.t=1; e.pre(s); const openPA=F2(e,pr); return {ports, closedPA, closedAP, openPA, rest:e.rest};")
    print('seat',r); iA=r['ports'].index('A'); iP=r['ports'].index('P')
    check('2/2 seat valve: closed is leak-free P→A', abs(r['closedPA'][iA])<1e-9, r)
    check('2/2 seat valve: closed opens A→P (check)', r['closedAP'][iP]>1, r)
    check('2/2 seat valve: open P→A', r['openPA'][iA]>1, r)
    # 3/2 seat no leakage
    r=run("const {s,e}=T2('v_32_seat'); const ports=Object.keys(e.el.ports); const pr=ports.map(k=>k==='P'?200e5:0); const o=F2(e,pr); return {ports,o};")
    check('3/2 seat valve: rest leak-free (no P flow)', abs(r['o'][r['ports'].index('P')])<1e-9, r)
    # throttled float centre vs plain float
    r=run("const a=T2('v_43_float_thr'); const ports=Object.keys(a.e.el.ports); const pr=ports.map(k=>k==='A'?50e5:0); const qt=F2(a.e,pr)[ports.indexOf('T')]; const b=T2('v_43_float'); const ports2=Object.keys(b.e.el.ports); const qf=F2(b.e,ports2.map(k=>k==='A'?50e5:0))[ports2.indexOf('T')]; return {qt,qf,ratio:qt/qf};")
    check('4/3 throttled float centre ≈ 15 % of plain float', 0.1<r['ratio']<0.2, r)
    r=run("const {s,e}=T2('v_43_float_pa'); const ports=Object.keys(e.el.ports); e.command(0,s); s.t=1; e.pre(s); const o1=F2(e,ports.map(k=>k==='B'?50e5:0)); const o2=F2(e,ports.map(k=>k==='P'?50e5:0)); return {ports,o1,o2};")
    pt=r['ports']; check('4/3 position a: B→T blocked, P→A open', abs(r['o1'][pt.index('T')])<1e-9 and r['o2'][pt.index('A')]>1, r)
    r=run("const {s,e}=T2('v_42_pt'); const ports=Object.keys(e.el.ports); const o=F2(e,ports.map(k=>k==='P'?50e5:k==='A'?20e5:0)); return {ports,o,rest:e.rest,det:e.read(s)};")
    pt=r['ports']; check('4/2 rest: P→T open, A blocked', r['o'][pt.index('T')]>1 and abs(r['o'][pt.index('A')])<1e-6, r)
    r=run("const {s,e}=T2('v_43_dsol_bt'); const ports=Object.keys(e.el.ports); const o=F2(e,ports.map(k=>k==='B'?50e5:k==='P'?50e5:0)); return {ports,o,rest:e.rest};")
    pt=r['ports']; check('4/3 no-spring centre: B→T open, P, A blocked', r['o'][pt.index('T')]>1 and abs(r['o'][pt.index('A')])<1e-6 and r['rest']==1, r)
    r=run("const {s,e}=T2('v_42_switch'); const a=e.read(s).detail; e.command(0,s); s.t=1; e.pre(s); return [a, e.read(s).detail];")
    check('4/2 spool position switch readout', 'rest' in r[0] and 'actuated' in r[1], r)
    r=run("const {s,e}=T2('v_22_ball'); return e.read(s).detail;"); check('ball valve position switch', 'position switch' in (r or ''), r)
    # accumulator charging valve
    r=run("""const {s,e}=T2('h_accu_charge'); const [p,a,t]=e.nodes; const res=[]; const P=(pa)=>{ s.p[a]=pa; s.p[p]=pa+5e5; s.p[t]=0; e.pre(s); const pr=e.nodes.map(n=>s.p[n]); return {ch:e.state.charging, q:F2(e,pr)}; };
      res.push(P(100e5)); res.push(P(165e5)); res.push(P(150e5)); res.push(P(135e5)); return res;""")
    check('accumulator charging: charges, unloads at cut-out, holds unloaded until cut-in', [x['ch'] for x in r]==[True,False,False,True] and r[1]['q'][2]>1 and r[0]['q'][1]>0, r)
    r=run("const {s,e}=T2('h_pcomp2'); const a=F2(e,[100e5,5e5,0]); const b=F2(e,[100e5,12e5,0]); return [a[1],b[1]];")
    check('pressure compensator: open below Δp, closed above', r[0]>1 and abs(r[1])<1e-9, r)
    r=run("const {s,e}=T2('h_reducing3'); const ports=['P','A','T']; const set=e.el.values.set; const pr=[200e5,set+10e5,0]; const o=F2(e,pr); return {o,set};")
    check('3-way reducing valve relieves A → T above setting', r['o'][2]>0.5, r)
    r=run("""const {s,e}=T2('h_counterbal_dual'); const set=e.el.values.set; const hold=F2(e,[0,0,set*0.8,0]); const rel=F2(e,[0,set*0.5,set*0.8,0]); const free=F2(e,[100e5,0,0,0]); return {hold,rel,free,set};""")
    check('dual counterbalance: holds load, releases with opposite-line pilot, free flow in', abs(r['hold'][2])<1e-6 and r['rel'][2]<-1 and r['free'][2]>1, r)
    r=run("const {s,e}=T2('h_shuttle'); return F2(e,[50e5,10e5,0]);")
    check('hydraulic shuttle passes the higher inlet', r[0]<-1 and abs(r[1])<1e-9 and r[2]>1, r)
    r=run("const {s,e}=T2('h_cartridge_sh'); const open=F2(e,[100e5,0,0,0]); const shut=F2(e,[100e5,0,0,150e5]); return [open[1],shut[1]];")
    check('logic element with shuttle cover: Z1 pilot closes it', r[0]>1 and abs(r[1])<1e-9, r)
    r=run("const {s,e}=T2('p_airgun'); const off=F2(e,[6e5]); s.live.get(e.key).on.set(1); const on=F2(e,[6e5]); return [off[0],on[0]];")
    check('air gun: blows only with trigger pressed', abs(r[0])<1e-12 and r[1]<0, r)
    r=run("const {s,e}=T2('h_blind_plate'); return e.kind;"); check('blind plate blocks all ports', r=='blocked', r)
    r=run("const {s,e}=T2('h_pump_var_ctrl'); const pc=e.el.values.pc; const lo=F2(e,[0,50e5,0]); const hi=F2(e,[0,pc+1e5,0]); return [lo[1],hi[1],pc];")
    check('controlled pump: delivers below, zero at compensator setting', r[0]>1 and abs(r[1])<0.05, r)
    r=run("const {s,e}=T2('p_oneway'); const fw=F2(e,[6e5,5e5]); const rv=F2(e,[5e5,6e5]); return [fw[1], rv[0]];")
    check('pneumatic one-way flow control: free 1→2, throttled 2→1', abs(r[0])>abs(r[1])>0, r)
    r=run("const {s,e}=T2('p_cyl_cush_adj'); return [e.kind, e.el.values.cushion];"); check('pneumatic cushioned cylinder', r[0]=='actuator' and r[1]=='Both ends', r)
    r=run("const {s,e}=T2('h_motor_drain1'); return [e.kind, e.nodes.length];"); check('motor one direction with drain', r[0]=='motor', r)
    # end-stop hold: 10 s at full stroke, no oscillation
    ev("window.HYDRA.actions.openSampleCopy('s_meter_out')"); pg.wait_for_timeout(900)
    r=ev("""(()=>{const H=window.HYDRA, st=H.designer.st, M=H.designer.sim; const sh=st.D.value.sheetId; const s=new M.Sim(H.S.project.value, sh, {}); const v=s.els.find(e=>e.kind==='valve'); v.command(0,s); const a=s.els.find(e=>e.kind==='actuator');
      for(let i=0;i<8000;i++) s.step(); const vs=[], ps=[], sg=new Set(); for(let i=0;i<20000;i++){ s.step(); if(i%50==0){ s.measure(); vs.push(a.state.v); ps.push([...s.p]); s.pipeQ.forEach((q,k)=>{ if(q!==0) sg.add(k+(q>0?'+':'-')); }); } }
      const spread=ps[0].map((_,j)=>Math.max(...ps.map(x=>x[j]))-Math.min(...ps.map(x=>x[j]))); const flips=[...sg].filter(k=>sg.has(k.slice(0,-1)+(k.endsWith('+')?'-':'+'))).length;
      return {x:a.state.x, vmax:Math.max(...vs.map(Math.abs)), pspread:Math.max(...spread)/1e5, flips, seat:a.state.seat, t:s.t};})()""")
    check('cylinder held at end stop 10 s: speed exactly 0, steady pressure, no flow reversals', r['vmax']==0 and r['pspread']<0.5 and r['flips']==0, r)
    # leaves the stop when reversed
    r=ev("""(()=>{const H=window.HYDRA, st=H.designer.st, M=H.designer.sim; const sh=st.D.value.sheetId; const s=new M.Sim(H.S.project.value, sh, {}); const v=s.els.find(e=>e.kind==='valve'); const a=s.els.find(e=>e.kind==='actuator'); v.command(0,s); for(let i=0;i<8000;i++) s.step(); const x1=a.state.x; v.command(2,s); for(let i=0;i<2000;i++) s.step(); return [x1,a.state.x,a.state.seat];})()""")
    check('cylinder leaves the end stop when the valve reverses', r[1]<r[0]-0.02, r)
    # gallery of new symbols
    ids=['v_43_float_pa','v_43_float_thr','v_43_dsol_bt','v_42_switch','v_42_pt','v_22_seat','v_32_seat','v_22_ball','v_43_prop_fb','v_p32_pushpull','h_counterbal_dual','h_blind_plate','p_airgun','p_spraygun','h_pump_var_ctrl','h_motor_drain1','h_cartridge_sh','h_reducing3','h_accu_charge','h_pcomp2','p_oneway','h_shuttle','p_cyl_cush_adj']
    pg.wait_for_timeout(1500)
    html=ev(f"""(()=>{{const G=window.HYDRA.designer.geom; return {json.dumps(ids)}.map(id=>{{const g=G.geomOf('std:'+id); const bb=g.bb; const w=bb[2]-bb[0]+16,h=bb[3]-bb[1]+22; return `<div style="display:inline-block;width:230px;height:190px;border:1px solid #ccc;margin:4px;vertical-align:top;font:11px sans-serif"><svg viewBox="${{bb[0]-8}} ${{bb[1]-8}} ${{w}} ${{h}}" width="230" height="150">${{g.inner}}${{g.ports.map(p=>`<circle cx="${{p.x}}" cy="${{p.y}}" r="0.9" fill="#0A64C2"/><text x="${{p.x+1.2}}" y="${{p.y-1}}" font-size="3" fill="#0A64C2">${{p.name}}</text>`).join('')}}</svg><div style="padding:2px">${{g.name}}</div></div>`}}).join('')}})()""")
    pg2=b.new_page(viewport={'width':1460,'height':1000}); pg2.set_content('<body style="margin:6px;background:#fff">'+html+'</body>'); pg2.wait_for_timeout(300); pg2.screenshot(path=S+'/v53_symbols.png', full_page=True)
    check('no page errors', not errs, errs[:3])
    b.close()
for r in R: print(*r)
print(sum(r[0]=='PASS' for r in R),'/',len(R))
