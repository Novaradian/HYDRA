# custom templates
import json
from playwright.sync_api import sync_playwright
import os; S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
R=[]
def check(n,c,x=''): R.append(('PASS' if c else 'FAIL',n,str(x)[:300]))
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1600,'height':960}, accept_downloads=True); pg=ctx.new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500); ev=pg.evaluate
    H="window.HYDRA"; DS="window.HYDRA.designer.st"; TP="window.HYDRA.designer.tpl"
    ev(f"{H}.actions.openSampleCopy('s_basic_cyl')"); pg.wait_for_timeout(1200)
    sid=ev(f"{DS}.D.value.sheetId"); sh=lambda: ev(f"(()=>{{const s={DS}.sheetById('{sid}'); return {{n:s.components.length, p:s.pipes.length, tags:s.components.map(c=>c.tag)}}}})()")
    s0=sh()
    pg.click('.dleft .dtabs button:has-text("Templates")'); pg.wait_for_timeout(200)
    check('Templates tab with empty state', 'No templates yet' in pg.inner_text('.dleft'))
    check('Save button disabled without a selection', pg.query_selector('.dtplsave button').is_disabled())
    # select the whole circuit
    ev(f"(()=>{{const s={DS}.sheetById('{sid}'); {DS}.setSel('{sid}', [...s.components.map(c=>c.id), ...s.pipes.map(p=>p.id), ...s.junctions.map(j=>j.id)]);}})()"); pg.wait_for_timeout(200)
    pg.click('.dtplsave button'); pg.wait_for_timeout(300)
    pg.fill('.scrim input', 'Cylinder circuit'); pg.click('.scrim button.primary'); pg.wait_for_timeout(400)
    tp=ev(f"{TP}.templates.value.map(t=>[t.name,t.nParts,t.nLines,t.domain])")
    check('whole circuit saved as a template', len(tp)==1 and tp[0][0]=='Cylinder circuit' and tp[0][1]==s0['n'] and tp[0][2]==s0['p'] and tp[0][3]=='hydraulic', (tp, s0))
    check('template tile with thumbnail', pg.query_selector('.dleft .part.tpl .thumb svg') is not None)
    check('saved in browser storage (every project)', 'Cylinder circuit' in ev("localStorage.getItem('hydra.templates.v1')||''"))
    # single valve via context menu
    vid=ev(f"{DS}.sheetById('{sid}').components.find(c=>c.ref.includes('v_43')).id")
    ev(f"{DS}.setSel('{sid}',['{vid}'])"); pg.wait_for_timeout(100)
    tid=ev(f"{TP}.saveSelection('{sid}','Tandem valve 4/3')"); pg.wait_for_timeout(200)
    check('single valve saved as a template', ev(f"{TP}.templates.value.length")==2)
    # place: click → copy in view centre, tags renumbered
    pg.click('.dleft .part.tpl:has-text("Cylinder circuit") .pname'); pg.wait_for_timeout(400)
    s1=sh(); check('click inserts a copy: parts and lines doubled', s1['n']==2*s0['n'] and s1['p']==2*s0['p'], (s0,s1))
    check('copy gets new tags (no duplicates)', len(set(s1['tags']))==len(s1['tags']), s1['tags'])
    check('inserted copy is selected', len(ev(f"{DS}.selIds('{sid}')"))>=s0['n'])
    # independence
    newv=ev(f"(()=>{{const s={DS}.sheetById('{sid}'); const ids=new Set({DS}.selIds('{sid}')); return s.components.find(c=>ids.has(c.id)&&c.ref.includes('h_relief')).id}})()")
    ev(f"{DS}.setComp('{sid}','{newv}','Set', x=>{{ x.values={{...(x.values||{{}}), set:222}}; }})"); pg.wait_for_timeout(100)
    tset=ev(f"(()=>{{const t={TP}.templates.value.find(t=>t.name==='Cylinder circuit'); return t.data.comps.find(c=>c.ref.includes('h_relief')).values?.set}})()")
    check('changing the placed copy leaves the template unchanged', tset!=222, tset)
    ev(f"{H}.cmds.runCmd('edit.undo')"); pg.wait_for_timeout(100); ev(f"{H}.cmds.runCmd('edit.undo')"); pg.wait_for_timeout(200)
    check('insert is one undo step', sh()['n']==s0['n'], sh())
    # drag and drop
    src=pg.query_selector('.dleft .part.tpl:has-text("Tandem valve")'); cv=pg.query_selector('.dcanvas').bounding_box()
    pg.locator('.dleft .part.tpl:has-text("Tandem valve")').drag_to(pg.locator('.dcanvas'), target_position={'x':cv['width']*0.8,'y':cv['height']*0.3}); pg.wait_for_timeout(400)
    check('drag a template onto the sheet places it', sh()['n']==s0['n']+1, sh())
    # into another project
    ev(f"{H}.actions.openSampleCopy('s_sequence')"); pg.wait_for_timeout(1200); sid2=ev(f"{DS}.D.value.sheetId"); n2=ev(f"{DS}.sheetById('{sid2}').components.length")
    ids=ev(f"{TP}.placeTemplate('{sid2}','{tid}')"); pg.wait_for_timeout(200)
    check('templates are available in another project', len(ids)==1 and ev(f"{DS}.sheetById('{sid2}').components.length")==n2+1)
    # wrong domain
    el=ev(f"{H}.S.addNode('sheet', null, 'electric')"); ev(f"{H}.S.openSheetTab('{el}')"); pg.wait_for_timeout(700)
    ids=ev(f"{TP}.placeTemplate('{el}','{tid}')")
    check('fluid template refused on an electric sheet', ids==[])
    pg.click('.dleft .dtabs button:has-text("Templates")'); pg.wait_for_timeout(200)
    check('electric sheet lists only electrical templates', pg.query_selector('.dleft .part.tpl') is None)
    ev(f"{H}.S.openSheetTab('{sid2}')"); pg.wait_for_timeout(600)
    # rename, export, import, delete
    pg.click('.dleft .dtabs button:has-text("Templates")'); pg.wait_for_timeout(200)
    pg.hover('.dleft .part.tpl:has-text("Tandem valve")'); pg.click('.dleft .part.tpl:has-text("Tandem valve") button[title="Rename"]'); pg.wait_for_timeout(200)
    pg.fill('.scrim input','Tandem centre valve'); pg.click('.scrim button.primary'); pg.wait_for_timeout(200)
    check('rename', 'Tandem centre valve' in [t[0] for t in ev(f"{TP}.templates.value.map(t=>[t.name])")])
    with pg.expect_download() as di: pg.click('.dleft .ptools button[title="Export all templates (.json)"]')
    path=S+'/tpl_export.json'; di.value.save_as(path); j=json.load(open(path))
    check('export all → .json with both templates', j.get('format')=='hydra-templates' and len(j['templates'])==2)
    pg.hover('.dleft .part.tpl:has-text("Cylinder circuit")'); pg.click('.dleft .part.tpl:has-text("Cylinder circuit") button[title="Delete"]'); pg.wait_for_timeout(200)
    pg.click('.scrim button:has-text("Delete")'); pg.wait_for_timeout(200)
    check('delete (with confirmation)', ev(f"{TP}.templates.value.length")==1)
    pg.set_input_files('.dleft .ptools input[type=file]', path); pg.wait_for_timeout(400)
    check('import adds them back', ev(f"{TP}.templates.value.length")==3)
    pg.screenshot(path=S+'/ui_templates.png')
    check('no page errors', not [e for e in errs if 'favicon' not in e], errs[:5])
    b.close()
for r in R: print(*r)
print(sum(1 for r in R if r[0]=='PASS'),'/',len(R))
