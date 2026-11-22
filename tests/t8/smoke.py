from playwright.sync_api import sync_playwright
import os; S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1600,'height':960}, device_scale_factor=1)
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append('console:'+m.text) if m.type in('error','warning') else None)
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500); ev=pg.evaluate
    ev("window.HYDRA.actions.openSampleCopy('s_sequence')"); pg.wait_for_timeout(1200)
    print(ev("Object.values(window.HYDRA.S.project.value.nodes).map(n=>n.type+':'+n.name)"))
    T=ev("(()=>{const t=window.HYDRA.plc.signals.signals(window.HYDRA.S.project.value); return [t.sigs.map(s=>[s.id.split(':')[0],s.tag,s.addr,s.dir,s.desc]), t.cyls.map(c=>c.tag)]})()")
    for s in T[0]: print(s)
    print('cyls',T[1])
    pid=ev("window.HYDRA.S.addNode('program', null)"); ev(f"window.HYDRA.S.openSheetTab('{pid}')"); pg.wait_for_timeout(2500)
    pg.screenshot(path=S+'/tests/t8/s1.png'); print('errs',errs[:10])
    b.close()
