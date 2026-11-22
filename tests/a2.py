# AI step 2 — plans: Edit with approval → ghost preview on the canvas → user Apply (one undo step) / Discard.
from playwright.sync_api import sync_playwright
import os, sys, json; sys.stdout.reconfigure(encoding='utf-8'); S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
R=[]
def check(n,c,x=''): R.append(('PASS' if c else 'FAIL',n,str(x)[:300]))
CLAMP={'parts':[
  {'tag':'1A1','ref':'h_cyl_double','x':150,'y':60},
  {'tag':'1V1','ref':'v_43_closed','x':150,'y':130},
  {'tag':'1P1','ref':'h_pump_fixed','x':145,'y':220,'values':{'vg':'14 cm³/rev'}},
  {'tag':'1M1','ref':'h_emotor','x':113,'y':220},
  {'tag':'1V2','ref':'h_relief','x':190,'y':190,'values':{'set':'120 bar'}},
  {'tag':'1Z1','ref':'h_tank','x':145,'y':260},
  {'tag':'1Z2','ref':'h_tank','x':190,'y':240},
  {'tag':'1Z3','ref':'h_tank','x':170,'y':170}],
 'nets':[{'ports':['1A1.A','1V1.A']},{'ports':['1A1.B','1V1.B']},{'ports':['1P1.P','1V1.P','1V2.P']},{'ports':['1V2.T','1Z2.T']},{'ports':['1P1.S','1Z1.T']},{'ports':['1V1.T','1Z3.T']}]}
MCP={'source':'mcp','perm':'approve'}
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900})
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500)
    ev=pg.evaluate; H="window.HYDRA.S"; A="window.HYDRA.ai"
    def call(c,a=None,ctx=None): return ev("([c,a,x])=>window.HYDRA.ai.call(c,a,x)",[c,a or {},ctx or {'source':'test'}])
    def undos(): return ev(f"{H}.histVer.value")
    def comps(): return ev(f"(()=>{{const s=Object.values({H}.project.value.circuits).find(c=>c.name==='Clamp'); return s?s.components.length:-1}})()")
    def ghost(): pg.wait_for_timeout(150); return ev("(()=>{const g=document.querySelector('.dcanvas .ai-ghost'); return g?{parts:g.querySelectorAll('.ai-ghost-part').length, tags:[...g.querySelectorAll('.ai-ghost-part')].map(x=>x.dataset.tag), lines:g.querySelectorAll('.ai-ghost-add path').length, gone:g.querySelectorAll('.ai-ghost-gone').length, plan:g.dataset.plan}:null})()")
    ev(f"{A}.settings.saveAiSettings({{...{A}.settings.aiSettings.value, enabled:true, mcp:true}})")  # outside AI only while switched on
    ev(f"(()=>{{const X=window.HYDRA; X.Pj.setProject(X.Pj.newProjectData({{name:'AI plans',template:'blank',unitSystem:'SI-bar'}}),{{dirty:true}}); X.S.addNode('sheet', null, 'hydraulic', 'Clamp');}})()")
    nid=ev(f"Object.values({H}.project.value.nodes).find(n=>n.type==='sheet').id"); ev(f"{H}.openSheetTab('{nid}')"); pg.wait_for_timeout(800)
    check('designer open on the sheet', ev("window.HYDRA.designer.st.D.value && window.HYDRA.designer.st.D.value.sheetId")==nid)
    # Edit with approval: the build becomes a plan, nothing changes yet
    h0=undos(); r=call('build_circuit',CLAMP,MCP); d=r.get('data',{}); pid=d.get('plan_id')
    check('approve mode: build returns a plan', r['ok'] and pid and d['status']=='ready' and d.get('added')==['1A1','1V1','1P1','1M1','1V2','1Z1','1Z2','1Z3'] and d.get('new_lines')==8, d)
    check('plan rule-checked: no problems', d.get('problems')==[], d.get('problems'))
    check('plan: project unchanged, no undo step', comps()==0 and undos()==h0, (comps(), undos(), h0))
    gh=ghost(); check('ghost shows the 8 planned parts and lines', gh and gh['parts']==8 and gh['tags'][0]=='1A1' and gh['lines']>=8 and gh['gone']==0 and gh['plan']==pid, gh)
    check('ghost takes no clicks', ev("getComputedStyle(document.querySelector('.ai-ghost')).pointerEvents")=='none')
    check('empty-sheet hint hidden under the ghost', ev("(()=>{const d=document.querySelector('.dcanvas .dhint'); return !d || getComputedStyle(d).display==='none'})()"))
    # read, check and simulate the plan before it exists
    r=call('get_sheet',{'plan':pid}); check('get_sheet on the plan', r['ok'] and len(r['data']['parts'])==8, r.get('error'))
    r=call('validate',{'plan':pid}); check('validate the plan', r['ok'] and r['data']['ok'], r)
    r=call('run_sim',{'plan':pid,'t_end':7,'events':[{'t':0.2,'tag':'1V1','pos':'a'},{'t':4,'tag':'1V1','pos':'b'}]}); a=(r.get('data',{}).get('actuators') or [{}])[0]
    check('run_sim on the plan: cylinder extends and retracts', r['ok'] and a.get('extended_at') and a.get('retracted_at'), r)
    r=call('get_plan',{'plan_id':pid}); check('plan keeps the solver result', r['ok'] and r['data'].get('sim',{}).get('peak_bar',0)>100, r)
    # the AI cannot apply it: it waits for the user
    r=call('apply_plan',{'plan_id':pid},MCP); check('AI apply_plan waits for the user', r['ok'] and r['data']['status']=='waiting_for_user' and comps()==0, r)
    r=call('apply_plan',{'plan_id':pid},{'source':'mcp','perm':'read'}); check('read-only connection cannot apply', not r['ok'], r)
    # the user presses Apply: one undo step, ghost gone
    h0=undos(); r=ev(f"{A}.userApply('{pid}')")
    check('user Apply: parts on the sheet, one undo step', r['ok'] and comps()==8 and undos()==h0+1 and r['data']['undo']=='AI: build circuit (8 parts)', (r, comps(), undos(), h0))
    check('ghost gone after Apply', ghost() is None, ghost())
    check('canvas draws the applied parts', ev("document.querySelectorAll('.dcanvas .dpart').length")==8)
    r=ev(f"{A}.userApply('{pid}')"); check('a plan applies only once', not r['ok'] and 'already applied' in r['error'], r)
    ev(f"{H}.undo()"); pg.wait_for_timeout(150); check('Ctrl+Z removes the whole plan', comps()==0 and ghost() is None, (comps(), ghost()))
    ev(f"{H}.redo()"); pg.wait_for_timeout(150); check('Ctrl+Y restores it', comps()==8)
    # a multi-step plan with a removal, then Discard
    r=ev(f"{A}.propose([{{cmd:'set_param',args:{{tag:'1V2',key:'set',value:'90 bar'}}}},{{cmd:'remove',args:{{tags:['1Z3']}}}}],{{source:'mcp'}})"); pid2=r.get('data',{}).get('plan_id')
    check('propose: two edits in one plan', r['ok'] and r['data']['commands']==2 and r['data'].get('removed')==['1Z3'], r)
    gh=ghost(); check('ghost marks the part to be removed', gh and gh['gone']>=2 and gh['plan']==pid2, gh)
    h0=undos(); r=ev(f"{A}.userDiscard('{pid2}')"); check('Discard: nothing changes', r['ok'] and undos()==h0 and comps()==8 and ghost() is None, (r, ghost()))
    r=call('get_sheet'); check('relief setting untouched after Discard', any(q['tag']=='1V2' and q['v']['set']=='120 bar' for q in r['data']['parts']))
    r=ev(f"{A}.userApply('{pid2}')"); check('a discarded plan cannot be applied', not r['ok'] and 'discarded' in r['error'], r)
    # the user edits while a plan waits: the plan follows the drawing
    r=call('add_component',{'ref':'h_check','tag':'1V9','x':240,'y':120},MCP); pid3=r['data']['plan_id']
    ev(f"window.HYDRA.designer.st.addPart('{nid}','std:h_gauge',100,100)"); pg.wait_for_timeout(200)
    r=call('get_plan',{'plan_id':pid3}); gh=ghost()
    check('plan re-based on the user edit', r['ok'] and r['data']['status']=='ready' and r['data'].get('added')==['1V9'] and gh and gh['tags']==['1V9'] and gh['gone']==0, (r.get('data'), gh))
    h0=undos(); r=ev(f"{A}.userApply('{pid3}')"); check('re-based plan applies on top of the user edit', r['ok'] and comps()==10 and undos()==h0+1, (r, comps()))
    # a plan that no longer fits turns stale and cannot be applied
    r=call('add_component',{'ref':'h_check','tag':'1V8','x':240,'y':150},MCP); pid4=r['data']['plan_id']
    call('add_component',{'ref':'h_check','tag':'1V8','x':260,'y':150})
    r=call('get_plan',{'plan_id':pid4}); check('conflicting plan turns stale', r['ok'] and r['data']['status']=='stale' and 'already used' in r['data'].get('error',''), r)
    check('stale plan has no ghost', ghost() is None, ghost())
    r=ev(f"{A}.userApply('{pid4}')"); check('stale plan cannot be applied', not r['ok'] and 'no longer fits' in r['error'], r)
    r=call('validate',{'plan':pid4}); check('stale plan cannot be read as a preview', not r['ok'], r)
    # Show ghost previews off / on
    r=call('add_component',{'ref':'h_check','x':240,'y':180},MCP); pid5=r['data']['plan_id']
    ev(f"{A}.settings.saveAiSettings({{...{A}.settings.aiSettings.value, ghost:false}})"); off=ghost(); ev(f"{A}.settings.saveAiSettings({{...{A}.settings.aiSettings.value, ghost:true}})"); on=ghost()
    check('ghost previews can be switched off', off is None and on and on['parts']==1, (off, on))
    # plans belong to their project
    ev("window.HYDRA.Pj.setProject(window.HYDRA.Pj.sampleProject('s_basic_cyl'), {dirty:false})"); pg.wait_for_timeout(300)
    r=ev(f"{A}.userApply('{pid5}')"); check('plan of another project refused', not r['ok'] and 'another project' in r['error'], r)
    r=call('get_plan',{'plan_id':pid5}); check('get_plan only sees this project', not r['ok'], r)
    ev(f"{H}.mutate('Private', d=>{{d.manifest.private=true}})")
    r=call('build_circuit',CLAMP,MCP); check('Private project: no plans', not r['ok'] and 'Private' in r['error'], r)
    check('no page errors', not errs, errs)
    b.close()
for r in R: print(*r)
print(sum(1 for r in R if r[0]=='PASS'),'/',len(R))
