exec(open('s6b.py').read().split("with sync_playwright() as p:")[0])
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1500,'height':940}); pg=ctx.new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append('console:'+m.text) if m.type in ('error','warning') else None)
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500)
    ev=pg.evaluate; H="window.HYDRA.S"; DS="window.HYDRA.designer.st"; SIM="window.HYDRA.designer.sim"
    ev("window.HYDRA.actions.openSampleCopy('s_basic_cyl')"); pg.wait_for_timeout(1200)
    ev(f"{DS}.D.value.simRun()"); pg.wait_for_timeout(500)
    for i in range(3):
        print(ev("[...document.querySelectorAll('.dcanvas text')].map(t=>t.textContent).filter(t=>/mm|position|L\\/min/.test(t)).join(' | ')"), ev(f"{SIM}.simFrame.value"))
        pg.wait_for_timeout(700)
    vk=ev(f"{SIM}.SIM.els.find(e=>e.kind==='valve').key")
    el=pg.query_selector(f'[data-simv="{vk}"]'); bb=el.bounding_box(); pg.mouse.click(bb['x']+bb['width']*0.3, bb['y']+bb['height']*0.5)
    for i in range(3):
        pg.wait_for_timeout(700); print(ev("[...document.querySelectorAll('.dcanvas text')].map(t=>t.textContent).filter(t=>/mm|position|L\\/min/.test(t)).join(' | ')"), ev(f"{SIM}.simFrame.value"))
    print(errs[:5]); b.close()
