import sys, os, json
from playwright.sync_api import sync_playwright
import os; S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
R=[]
def check(n,c,x=''): R.append(('PASS' if c else 'FAIL',n,str(x)[:200]))
STUB = """
window.__files = {};
window.showSaveFilePicker = async (o) => ({ name: o.suggestedName, queryPermission: async()=> 'granted', requestPermission: async()=>'granted',
  createWritable: async () => { const parts=[]; return { write: async b => parts.push(b), close: async () => { window.__files[o.suggestedName] = new Blob(parts); } }; },
  getFile: async () => new File([window.__files[o.suggestedName]], o.suggestedName) });
"""
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1440,'height':900}, accept_downloads=True); ctx.add_init_script(STUB); pg=ctx.new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(1500)
    ev=pg.evaluate; H="window.HYDRA.S"
    def run(c): ev(f"window.HYDRA.cmds.runCmd('{c}')"); pg.wait_for_timeout(120)
    check('valve renderer ready', ev(f"{H}.stdValveItems.value.length")==110, ev(f"{H}.stdValveItems.value.length"))
    check('valve svgs', ev(f"Object.keys({H}.valveSvgs.value).length")>=11)
    # new project via dialog
    pg.keyboard.press('Alt+n'); pg.wait_for_timeout(200)
    check('new project dialog', pg.query_selector('.modal') is not None)
    pg.fill('.modal input.in', 'Test press'); pg.click('.tpl:has-text("Electro-hydraulic")'); pg.click('.modal footer .primary'); pg.wait_for_timeout(300)
    check('project created', ev(f"{H}.project.value?.manifest.name")=='Test press')
    check('template sheets', ev(f"Object.values({H}.project.value.nodes).filter(n=>n.type==='sheet').length")==2)
    check('dirty after new', ev(f"{H}.dirty.value"))
    # circuits panel: add sheet via store + undo
    ev("window.HYDRA.cmds.runCmd('file.recent')")
    root=ev(f"{H}.project.value.rootId")
    n0=ev(f"Object.keys({H}.project.value.nodes).length")
    ev(f"{H}.addNode('sheet', null, 'pneumatic')"); check('add sheet', ev(f"Object.keys({H}.project.value.nodes).length")==n0+1)
    run('edit.undo'); check('undo add', ev(f"Object.keys({H}.project.value.nodes).length")==n0)
    run('edit.redo'); check('redo add', ev(f"Object.keys({H}.project.value.nodes).length")==n0+1)
    # select a sheet, copy paste, rename, star
    sid=ev(f"Object.values({H}.project.value.nodes).find(n=>n.type==='sheet').id")
    ev(f"{H}.activeTab.value='home'"); pg.wait_for_timeout(150)
    ev(f"{H}.selection.value={{kind:'node',ids:['{sid}']}}")
    run('edit.copy'); run('edit.paste'); check('paste sheet', ev(f"Object.values({H}.project.value.nodes).filter(n=>n.type==='sheet').length")==4)
    ev(f"{H}.selection.value={{kind:'node',ids:['{sid}']}}")
    pg.keyboard.press('Control+d'); pg.wait_for_timeout(100)
    check('star sheet (project scope)', ev(f"{H}.project.value.stars.length")==1)
    run('edit.rename'); pg.fill('.modal input.in','Main hydraulics'); pg.click('.modal footer .primary'); pg.wait_for_timeout(100)
    check('rename', ev(f"{H}.project.value.nodes['{sid}'].name")=='Main hydraulics')
    # open circuits panel and screenshot
    ev("window.HYDRA.cmds.runCmd('view.samples')"); pg.wait_for_timeout(100); ev(f"{H}.activeTab.value='home'"); pg.wait_for_timeout(200)
    ev("window.HYDRA.S.activeTab.value='home'"); pg.click('.dv-tab:has-text("Circuits")'); pg.wait_for_timeout(200)
    pg.screenshot(path=S+'/h2.png')
    # save (stubbed file handle)
    pg.keyboard.press('Control+s'); pg.wait_for_timeout(800)
    check('saved via handle', ev("Object.keys(window.__files).length")==1, ev("Object.keys(window.__files)"))
    check('not dirty after save', not ev(f"{H}.dirty.value"))
    check('checkpoint stored', ev(f"{H}.checkpoints.value.length")==1)
    check('recent stored', ev(f"{H}.recents.value.length")==1)
    # modify, save again -> 2 checkpoints
    ev(f"{H}.addNode('assembly', null)"); pg.keyboard.press('Control+s'); pg.wait_for_timeout(600)
    check('2 checkpoints', ev(f"{H}.checkpoints.value.length")==2)
    # close project, reopen from recent
    run('file.close'); pg.wait_for_timeout(200); check('closed', ev(f"{H}.project.value")==None)
    rid=ev(f"{H}.recents.value[0].id")
    ev("window.HYDRA.S.activeTab.value='home'"); pg.click('.dv-tab:has-text("History")'); pg.wait_for_timeout(150)
    pg.dblclick('.rrow'); pg.wait_for_timeout(700)
    check('reopen recent', ev(f"{H}.project.value?.manifest.name")=='Test press', ev(f"{H}.project.value?.manifest.name"))
    check('reopened content', ev(f"Object.values({H}.project.value.nodes).filter(n=>n.type==='assembly').length")==2 and ev(f"{H}.project.value.nodes['{sid}']?.name")=='Main hydraulics')
    check('project star persisted', ev(f"{H}.project.value.stars.length")==1)
    # std part select + inspector + duplicate to custom
    ev("window.HYDRA.S.activeTab.value='home'"); pg.click('.dv-tab:has-text("Components")'); pg.wait_for_timeout(150)
    pg.fill('.searchin input','4/3 tandem'); pg.wait_for_timeout(200)
    pg.click('.part >> nth=0'); pg.wait_for_timeout(200)
    check('std selected', ev(f"{H}.selection.value?.kind")=='std', ev(f"{H}.selection.value"))
    pg.screenshot(path=S+'/h3.png')
    pg.click('.insp button:has-text("Duplicate to Custom Library")'); pg.wait_for_timeout(200)
    check('duplicate valve to custom', ev(f"{H}.customLib.value.length")==1 and ev(f"{H}.customLib.value[0].type")=='valve')
    pg.fill('.searchin input','cylinder double'); pg.wait_for_timeout(150); pg.click('.part >> nth=0'); pg.wait_for_timeout(100)
    pg.click('.insp button:has-text("Duplicate to Custom Library")'); pg.wait_for_timeout(200)
    check('duplicate symbol to custom', ev(f"{H}.customLib.value.length")==2 and ev(f"{H}.customLib.value[1].type")=='symbol')
    # custom panel
    ev("window.HYDRA.S.activeTab.value='home'"); pg.click('.dv-tab:has-text("Custom")'); pg.wait_for_timeout(200)
    check('custom rows', len(pg.query_selector_all('.crow'))==2)
    pg.screenshot(path=S+'/h4.png')
    # open valve creator popup with item
    with ctx.expect_page() as pi:
        pg.dblclick('.crow >> nth=1')
    pop=pi.value; pop.wait_for_timeout(1200)
    nm=pop.evaluate("window.HydraValveCreator ? window.HydraValveCreator.getDefinition().name : null") if pop.evaluate("!!window.HydraValveCreator") else pop.evaluate("window.HydraSymbolSketcher && window.HydraSymbolSketcher.getSymbol().name")
    check('tool popup loaded item', nm and 'copy' in nm, nm)
    pop.screenshot(path=S+'/h5.png')
    # save from tool -> home reload
    if pop.evaluate("!!window.HydraSymbolSketcher"):
        pop.click('#btnSave'); pop.wait_for_timeout(400)
    else:
        pop.click('#btnSave'); pop.wait_for_timeout(400)
    pg.wait_for_timeout(300)
    check('library version bumped from tool', any(x['version']>=2 for x in ev(f"{H}.customLib.value")), [x['version'] for x in ev(f"{H}.customLib.value")])
    pop.close()
    # samples open as copy
    ev(f"{H}.dirty.value=false")
    ev("window.HYDRA.S.activeTab.value='home'"); pg.click('.dv-tab:has-text("Samples")'); pg.wait_for_timeout(150)
    pg.click('.srow >> nth=0'); pg.wait_for_timeout(150)
    pg.click('.srow >> nth=0 >> button:has-text("Open as copy")'); pg.wait_for_timeout(400)
    check('sample opened', 'sample' in (ev(f"{H}.project.value?.manifest.name") or ''), ev(f"{H}.project.value?.manifest.name"))
    # open a sheet -> designer tab
    s2=ev(f"Object.values({H}.project.value.nodes).find(n=>n.type==='sheet').id")
    ev(f"{H}.selection.value={{kind:'node',ids:['{s2}']}}"); run('edit.item'); pg.wait_for_timeout(300)
    check('designer tab', ev(f"{H}.activeTab.value").startswith('des_'))
    pg.screenshot(path=S+'/h6.png')
    pg.click('.dtab.fixed button'); pg.wait_for_timeout(200)
    # palette
    pg.keyboard.press('Control+k'); pg.wait_for_timeout(200); pg.keyboard.type('calcul'); pg.wait_for_timeout(150); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
    check('palette -> calculators', pg.query_selector('.modal:has-text("Calculators")') is not None)
    pg.screenshot(path=S+'/h7.png')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
    # menus all open
    for m in ['file','menu','pref','settings','view','help','custom']:
        pg.click(f'#menu-{m}'); pg.wait_for_timeout(80); check('menu '+m, pg.query_selector('.menu') is not None); pg.keyboard.press('Escape'); pg.wait_for_timeout(60)
    pg.click('#menu-file'); pg.wait_for_timeout(100); pg.screenshot(path=S+'/h8.png'); pg.keyboard.press('Escape')
    # dialogs open without error
    for d in ['prefs','settings','units','libManager','import','docs','symbolRef','keys','about','issue','projectProps']:
        ev(f"{H}.openModal('{d}')"); pg.wait_for_timeout(120); check('dialog '+d, pg.query_selector('.modal') is not None); ev(f"{H}.closeModal()")
    ev(f"{H}.openModal('symbolRef')"); pg.wait_for_timeout(300); pg.screenshot(path=S+'/h9.png'); ev(f"{H}.closeModal()")
    # star limit & tile ops
    ev(f"{H}.removeStar('cmd:file.new')"); check('unstar', ev(f"{H}.allStars.value.length")>=1)
    # workspace switch
    pg.click('.seg button:has-text("Electrical")'); pg.wait_for_timeout(200)
    ev("window.HYDRA.S.activeTab.value='home'"); pg.click('.dv-tab:has-text("Components")'); pg.wait_for_timeout(200)
    pg.fill('[data-panel=components] .searchin input',''); pg.wait_for_timeout(150); check('electrical parts', ev("document.querySelectorAll('[data-panel=components] .part').length")==53, ev("document.querySelectorAll('[data-panel=components] .part').length"))
    pg.screenshot(path=S+'/h10.png')
    # export project json + hydralib downloads
    with pg.expect_download() as dl: run('file.exportJson')
    check('export json', dl.value.suggested_filename.endswith('.hydra.json'))
    # tour
    run('help.tour'); pg.wait_for_timeout(300); check('tour', pg.query_selector('.tourcard') is not None); pg.screenshot(path=S+'/h11.png'); ev(f"{H}.tour.value=null")
    print('errors:', errs[:10])
    b.close()
for r in R: print(*r)
print(sum(1 for r in R if r[0]=='PASS'),'/',len(R))
