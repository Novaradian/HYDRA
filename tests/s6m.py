from playwright.sync_api import sync_playwright
import os; S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500); ev=pg.evaluate
    DS="window.HYDRA.designer.st"; SIM="window.HYDRA.designer.sim"; H="window.HYDRA.S"
    ref=ev("window.HYDRA.symbols.STD.map(i=>i.id).find(i=>/cyl/.test(i)&&/cush/.test(i))"); print('ref',ref)
    ev("window.HYDRA.actions.openSampleCopy('s_meter_out')"); pg.wait_for_timeout(1000)
    sh=ev(f"{DS}.D.value.sheetId"); cid=ev(f"{DS}.sheetById('{sh}').components.find(c=>c.tag==='1A1').id")
    ev(f"{DS}.setComp('{sh}','{cid}','t',x=>{{x.ref='std:{ref}'; x.values={{...x.values, cushion:'Both ends'}}}})")
    r=ev(f"(()=>{{const M={SIM}; const s=new M.Sim({H}.project.value,'{sh}',{{}}); const v=s.els.find(e=>e.kind==='valve'); v.command(0,s); for(let i=0;i<8000;i++) s.step(); const a=s.els.find(e=>e.kind==='actuator'); return [a.state.x, a.state.pcMax/1e5, a.state.impMax, a.read(s).detail, s.t]}})()")
    print(r); b.close()
