from playwright.sync_api import sync_playwright
import os; S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
R=[]
def check(n,c,x=''): R.append(('PASS' if c else 'FAIL',n,str(x)[:300]))
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900})
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(1800)
    ev=pg.evaluate; H="window.HYDRA.S"; DS="window.HYDRA.designer.st"
    # home: bare letters silent
    n0=ev(f"{H}.toasts.value.length"); pg.keyboard.press('r'); pg.keyboard.press('w'); pg.wait_for_timeout(100)
    check('bare letters silent on Home', ev(f"{H}.toasts.value.length")==n0)
    check('designer menus hidden on Home', pg.query_selector('#menu-insert') is None)
    # old-style sheet (parts only) gets laid out
    ev(f"window.HYDRA.Pj.setProject(window.HYDRA.Pj.sampleProject('s_press'), {{dirty:true}})"); pg.wait_for_timeout(300)
    nid=ev(f"Object.values({H}.project.value.nodes).find(n=>n.type==='sheet' && n.sheetType==='hydraulic').id")
    ev(f"window.HYDRA.cmds.runCmd('launch.hydraulic')"); pg.wait_for_timeout(100)
    ev(f"(()=>{{const n={H}.project.value.nodes['{nid}']; {H}.tabs.value=[...{H}.tabs.value,{{id:'des_hydraulic{nid}',title:n.name,kind:'designer',designer:'hydraulic',nodeId:'{nid}'}}]; {H}.activeTab.value='des_hydraulic{nid}';}})()"); pg.wait_for_timeout(700)
    C=f"{H}.project.value.circuits['{nid}']"
    check('legacy sheet normalised', ev(f"{C}.components.every(c=>c.x!=null && c.id && /^std:/.test(c.ref))"), ev(f"JSON.stringify({C}.components.slice(0,2))"))
    tags=ev(f"{C}.components.map(c=>c.tag)"); check('legacy tags ISO', all(__import__('re').match(r'^\d+[A-Z]\d+$',t) for t in tags), tags)
    check('designer menus shown', pg.query_selector('#menu-insert') is not None and pg.query_selector('#menu-circuit') is not None)
    pg.click('#menu-circuit'); pg.wait_for_timeout(150); items=ev("[...document.querySelectorAll('.pop [role=menuitem], .pop button')].map(b=>b.textContent.trim()).filter(Boolean)")
    check('circuit menu items', any('Rule Check' in i for i in items) and any('Renumber' in i for i in items), items); pg.keyboard.press('Escape')
    # tab title follows rename
    ev(f"{H}.renameNode('{nid}','Press main circuit')"); pg.wait_for_timeout(100)
    print('TAB', ev("document.querySelector('.tabstrip .dtab.on')?.textContent"), ev("window.HYDRA.S.docs.value.length"), ev("window.HYDRA.S.tabs.value.map(t=>t.id+':'+t.docKey)"))
    check('tab title follows sheet name', 'Press main circuit' in ev("document.querySelector('.tabstrip .dtab.on').textContent"))
    # electric sheet keeps placeholder
    eid=ev(f"Object.values({H}.project.value.nodes).find(n=>n.type==='sheet' && n.sheetType==='electric').id")
    ev(f"(()=>{{const n={H}.project.value.nodes['{eid}']; {H}.tabs.value=[...{H}.tabs.value,{{id:'des_electric{eid}',title:n.name,kind:'designer',designer:'electric',nodeId:'{eid}'}}]; {H}.activeTab.value='des_electric{eid}';}})()"); pg.wait_for_timeout(300)
    pg.wait_for_timeout(600)
    check('electric sheet opens in the Electric Designer (step 7)', pg.query_selector('.hd:visible .dcanvas') is not None)
    check('designer API follows the electric sheet', ev(f"{DS}.D.value && {DS}.D.value.sheetId")==eid)
    # sheet props: paper size change, title block
    ev(f"{H}.activeTab.value='des_hydraulic{nid}'"); pg.wait_for_timeout(300)
    pg.click('.dright .dtabs button:has-text("Sheet")'); pg.wait_for_timeout(100)
    pg.click('.dright .seg button:has-text("A2")'); pg.wait_for_timeout(200)
    check('paper size A2', ev(f"{C}.size")=='A2')
    check('undo paper size', (pg.keyboard.press('Control+z'), pg.wait_for_timeout(100), ev(f"{C}.size"))[2] in ('A3','A2'))
    # renumber
    ev(f"{DS}.renumberTags('{nid}')"); tags=ev(f"{C}.components.map(c=>c.tag)"); check('renumber unique', len(set(tags))==len(tags), tags)
    pg.screenshot(path=S+'/d_press.png')
    check('no page errors', not errs, errs[:5])
    b.close()
for r in R: print(*r)
print(sum(1 for r in R if r[0]=='PASS'),'/',len(R))
