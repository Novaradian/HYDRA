# AI step 1 — command API (app/src/ai): schemas, guards, one undo step per change, build / validate / simulate.
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
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1440,'height':900})
    errs=[]; cons=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: cons.append(m.text) if m.type in ('warning','error') else None)
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500)
    ev=pg.evaluate; H="window.HYDRA.S"
    def call(c,a=None,ctx=None): return ev("([c,a,x])=>window.HYDRA.ai.call(c,a,x)",[c,a or {},ctx or {'source':'test'}])
    def undos(): return ev(f"{H}.histVer.value")
    def comps(): return ev(f"(()=>{{const p={H}.project.value; const s=Object.values(p.circuits).find(c=>c.name==='Clamp'); return s?s.components.length:-1}})()")
    names=ev("window.HYDRA.ai.COMMAND_NAMES")
    check('20 commands', set(names)=={'get_project_info','get_sheet','search_library','describe_part','validate','run_sim','add_component','set_param','connect','remove','move_component','build_circuit','get_plan','apply_plan','discard_plan','get_question_template','ask_user','propose_bom','insert_template','create_for'}, names)
    # schema checks
    r=call('run_script',{'js':'1'}); check('unknown command refused', not r['ok'] and 'Unknown command' in r['error'], r)
    r=call('get_sheet',{'sheet':'x','evil':1}); check('extra argument refused', not r['ok'] and 'invalid arguments' in r['error'], r)
    r=call('run_sim',{'t_end':500}); check('run_sim t_end limited to 60 s', not r['ok'] and 'invalid arguments' in r['error'], r)
    r=call('connect',{'ports':['1P1.P']}); check('connect needs two ports', not r['ok'], r)
    # no project
    r=call('get_sheet'); check('no project: refused', not r['ok'] and 'No project' in r['error'], r)
    r=call('search_library',{'query':'relief valve','limit':3}); check('library search without a project', r['ok'] and any(i['ref']=='std:h_relief' for i in r['data']['items']), r)
    r=call('describe_part',{'ref':'h_relief'}); d=r.get('data',{})
    check('describe_part: ports and values in bar', r['ok'] and [q['name'] for q in d['ports']]==['P','T'] and any(v['key']=='set' and v['default']=='160 bar' for v in d['values']), d)
    # blank project with one hydraulic sheet
    ev(f"(()=>{{const X=window.HYDRA; X.Pj.setProject(X.Pj.newProjectData({{name:'AI test',template:'blank',unitSystem:'SI-bar'}}),{{dirty:true}}); X.S.addNode('sheet', null, 'hydraulic', 'Clamp'); X.S.addNode('sheet', null, 'electric', 'Wiring');}})()"); pg.wait_for_timeout(300)
    r=call('get_project_info'); check('project info lists the sheets', r['ok'] and [s['name'] for s in r['data']['sheets']]==['Clamp','Wiring'] and r['data']['private'] is False, r)
    # atomic: a bad value anywhere leaves the project untouched
    h0=undos(); bad=json.loads(json.dumps(CLAMP)); bad['parts'][2]['values']={'q':'20 L/min'}
    r=call('build_circuit',bad); check('bad value: whole build refused with the valid keys', not r['ok'] and 'no value "q"' in r['error'] and 'vg' in ' '.join(r.get('details',[])), r)
    check('bad value: nothing changed, no undo step', comps()==0 and undos()==h0, (comps(), undos(), h0))
    # build the clamp circuit in one call = one undo step
    h0=undos(); r=call('build_circuit',CLAMP)
    check('build_circuit ok', r['ok'] and r['data']['parts']==['1A1','1V1','1P1','1M1','1V2','1Z1','1Z2','1Z3'] and r['data']['lines']==8, r)
    check('build_circuit is one undo step', undos()==h0+1 and r.get('undo')=='AI: build circuit (8 parts)', (undos(),h0,r.get('undo')))
    r=call('get_sheet',{'sheet':'Clamp'}); sh=r.get('data',{})
    nets=[sorted(n['ports']) for n in sh.get('nets',[])]
    check('get_sheet: nets as built', sorted(['1P1.P','1V1.P','1V2.P']) in nets and ['1A1.A','1V1.A'] in nets and len(nets)==6, nets)
    check('get_sheet: values in bar, only the changed ones', any(q['tag']=='1V2' and q.get('v')=={'set':'120 bar'} for q in sh.get('parts',[])) and not any(q['tag']=='1A1' and 'v' in q for q in sh.get('parts',[])), sh.get('parts'))
    r=call('validate',{'sheet':'Clamp'}); check('validate: no problems', r['ok'] and r['data']['ok'] and r['data']['problems']==[], r)
    ev(f"{H}.undo()"); pg.wait_for_timeout(100); check('Ctrl+Z removes the whole build', comps()==0, comps())
    ev(f"{H}.redo()"); pg.wait_for_timeout(100); check('Ctrl+Y brings it back', comps()==8, comps())
    # set_param: units, limits, keys
    r=call('set_param',{'tag':'1V2','key':'set','value':'1450 psi'}); v=call('get_sheet')['data']
    check('set_param converts psi', r['ok'] and any(q['tag']=='1V2' and q['v']['set']=='99.97 bar' for q in v['parts']), [q.get('v') for q in v['parts'] if q['tag']=='1V2'])
    r=call('set_param',{'tag':'1V2','values':{'set':100}}); check('set_param plain number = bar', r['ok'] and any(q['tag']=='1V2' and q['v']['set']=='100 bar' for q in call('get_sheet')['data']['parts']), r)
    r=call('set_param',{'tag':'1V2','key':'set','value':'-5 bar'}); check('set_param below minimum refused', not r['ok'] and 'minimum' in r['error'], r)
    r=call('set_param',{'tag':'1V2','key':'colour','value':'red'}); check('set_param unknown key lists keys', not r['ok'] and 'set (Setting, bar)' in ' '.join(r.get('details',[])), r)
    r=call('set_param',{'tag':'9V9','key':'set','value':1}); check('set_param unknown tag', not r['ok'] and 'No part 9V9' in r['error'], r)
    # validate finds problems
    h0=undos(); r=call('remove',{'tags':['1V2']}); check('remove ok, one undo step', r['ok'] and undos()==h0+1, r)
    r=call('validate'); probs=' | '.join(i['text'] for i in r['data']['problems'])
    check('validate: missing relief and open port found', 'no pressure-relief' in probs and 'open port' in probs, probs)
    ev(f"{H}.undo()"); pg.wait_for_timeout(100); check('relief valve back after undo', call('validate')['data']['problems']==[], call('validate')['data'])
    # tags
    r=call('add_component',{'ref':'h_gauge','tag':'1V2'}); check('duplicate tag refused', not r['ok'] and 'already used' in r['error'], r)
    r=call('add_component',{'ref':'h_gauge','tag':'gauge'}); check('non-ISO tag refused', not r['ok'] and 'ISO 1219-2' in r['error'], r)
    r=call('add_component',{'ref':'h_nothing'}); check('unknown part refused', not r['ok'] and 'search_library' in r['error'], r)
    r=call('add_component',{'ref':'e_motor3','sheet':'Clamp'}); check('electrical part refused on a fluid sheet', not r['ok'], r)
    # branch from a busy port: a junction, never two lines on one port
    r=call('add_component',{'ref':'h_gauge','x':120,'y':180}); tagg=r.get('data',{}).get('tag'); check('add_component auto tag', r['ok'] and tagg=='1Z4', r)
    r=call('connect',{'ports':['1P1.P',tagg+'.1' if tagg else 'x.1']}); check('connect to a busy port', r['ok'], r)
    probs=' | '.join(i['text'] for i in call('validate')['data']['problems'])
    check('branch made with a junction (no two lines on one port)', 'Two lines on one port' not in probs and 'open port' not in probs, probs)
    r=call('get_sheet'); check('gauge joins the pump net', any(sorted(n['ports'])==sorted(['1P1.P','1V1.P','1V2.P','1Z4.1']) for n in r['data']['nets']), r['data']['nets'])
    h0=undos(); r=call('connect',{'ports':['1A1.A','1V1.A']}); check('connecting an existing pair refused, nothing changed', not r['ok'] and 'already connected' in r['error'] and undos()==h0, r)
    r=call('move_component',{'tag':'1Z4','x':100,'y':185}); probs=' | '.join(i['text'] for i in call('validate')['data']['problems'])
    check('move_component keeps lines attached', r['ok'] and 'open end' not in probs and 'open port' not in probs, probs)
    # simulation summary
    r=call('run_sim',{'t_end':7,'events':[{'t':0.2,'tag':'1V1','pos':'a'},{'t':4,'tag':'1V1','pos':'b'}]}); s=r.get('data',{})
    a=(s.get('actuators') or [{}])[0]
    check('run_sim: cylinder extends then retracts', r['ok'] and a.get('extended_at') and a.get('retracted_at') and 2.5<a['extended_at'][0]<4<a['retracted_at'][0] and a.get('end')=='retracted', s)
    check('run_sim: peak pressure at the relief setting', r['ok'] and 95<=s['peak_bar']<=110, s.get('peak_bar'))
    check('run_sim: summary only (no time series)', len(json.dumps(s))<4000 and len(s.get('warnings',[]))==len(set(s.get('warnings',[]))), len(json.dumps(s)))
    r=call('run_sim',{'t_end':1,'events':[{'t':0,'tag':'1A1','pos':'a'}]}); check('run_sim: only valves can be switched', not r['ok'] and 'Valves: 1V1' in ' '.join(r.get('details',[])), r)
    r=call('run_sim',{'t_end':1,'events':[{'t':0,'tag':'1V1','pos':'z'}]}); check('run_sim: bad valve position', not r['ok'] and 'a, 0, b' in r['error'], r)
    check('run_sim does not touch the live simulation', ev("window.HYDRA.designer.sim.SIM===null && window.HYDRA.designer.sim.simView.value===null"))
    # batch = one undo step, all or nothing
    h0=undos(); n0=comps()
    r=ev("()=>window.HYDRA.ai.batch([{cmd:'add_component',args:{ref:'h_check',x:240,y:120}},{cmd:'set_param',args:{tag:'1V2',key:'set',value:'110 bar'}}],{source:'test'})")
    check('batch: one undo step', r['ok'] and undos()==h0+1 and comps()==n0+1, (r, undos(), h0))
    h0=undos(); n0=comps()
    r=ev("()=>window.HYDRA.ai.batch([{cmd:'add_component',args:{ref:'h_check',x:260,y:120}},{cmd:'set_param',args:{tag:'1V2',key:'set',value:'-1 bar'}}],{source:'test'})")
    check('batch: a failing step changes nothing', not r['ok'] and r['error'].startswith('Step 2') and undos()==h0 and comps()==n0, (r, comps(), n0))
    # preview leaves the live project alone
    before=ev(f"JSON.stringify({H}.project.value)")
    r=ev("()=>{const r=window.HYDRA.ai.preview([{cmd:'add_component',args:{ref:'h_check',x:280,y:120}}],{source:'test'}); return {ok:r.ok, n: r.ok ? Object.values(r.project.circuits).find(c=>c.name==='Clamp').components.length : -1}}")
    check('preview: changed copy, live project untouched', r['ok'] and r['n']==comps()+1 and ev(f"JSON.stringify({H}.project.value)")==before, r)
    # guards
    r=call('add_component',{'ref':'h_check'},{'source':'test','perm':'read'}); check('read-only permission: edit refused', not r['ok'] and 'Read-only access' in r['error'], r)
    r=call('get_sheet',None,{'source':'test','perm':'read'}); check('read-only permission: read allowed', r['ok'], r.get('error'))
    r=call('add_component',{'ref':'h_check','sheet':'Wiring'}); check('electric sheet not editable', not r['ok'] and 'only edit hydraulic and pneumatic' in r['error'], r)
    ev(f"{H}.setReadOnly(true)"); r=call('add_component',{'ref':'h_check'}); check('read-only project: edit refused', not r['ok'] and 'read-only' in r['error'], r); ev(f"{H}.setReadOnly(false)")
    ev(f"{H}.editLock.value='Simulation running'"); r=call('set_param',{'tag':'1V2','key':'set','value':100}); check('running simulation: edit refused', not r['ok'] and 'Simulation running' in r['error'], r); ev(f"{H}.editLock.value=null")
    ev(f"{H}.mutate('Private', d=>{{d.manifest.private=true}})")
    bad=[c for c in names if call(c,{'query':'x'} if c=='search_library' else {'ref':'h_relief'} if c=='describe_part' else {})['ok']]
    check('Private project: every command refused', not bad and 'Private' in call('get_sheet')['error'], bad)
    ev(f"{H}.mutate('Not private', d=>{{d.manifest.private=false}})")
    # reads never change the project, also on sheets the designer has not opened (older layout)
    ev("window.HYDRA.Pj.setProject(window.HYDRA.Pj.sampleProject('s_basic_cyl'), {dirty:false})"); pg.wait_for_timeout(300)
    before=ev(f"JSON.stringify({H}.project.value)")
    r1=call('get_sheet'); r2=call('validate'); r3=call('run_sim',{'t_end':0.5})
    check('reads on an unopened sample sheet', r1['ok'] and r2['ok'] and r3['ok'] and len(r1['data']['parts'])>5, (r1.get('error'), r2.get('error'), r3.get('error')))
    check('reads leave the project unchanged', ev(f"JSON.stringify({H}.project.value)")==before and not ev(f"{H}.dirty.value"))
    # activity log
    log=ev("window.HYDRA.ai.aiLog.value")
    check('activity log records calls', len(log)>40 and all(x['source']=='test' for x in log) and any(x['cmd']=='build_circuit' and x['ok'] for x in log), len(log))
    check('no page errors', not errs, errs)
    check('no schema warnings in the console', not [c for c in cons if 'strict mode' in c], [c for c in cons if 'strict mode' in c])
    b.close()
for r in R: print(*r)
print(sum(1 for r in R if r[0]=='PASS'),'/',len(R))
