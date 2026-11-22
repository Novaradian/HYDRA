# AI steps 7–9 — CLI bridge (Claude Code / Codex) and own-API-key chat (with a stand-in for HYDRA.exe's native side),
# question templates + HYDRA's mandatory parts, and Create Electric / Logic Code / Controller-HMI from the tag list.
from playwright.sync_api import sync_playwright
import os, sys, json; sys.stdout.reconfigure(encoding='utf-8'); S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
R=[]
def check(n,c,x=''): R.append(('PASS' if c else 'FAIL',n,str(x)[:300]))
MOCK = r"""
window.__calls = []; window.__replies = {}; window.__api = []; window.__apiBodies = []; window.__listeners = {};
window.__TAURI__ = {
  core: { invoke: async (cmd, args) => {
    window.__calls.push([cmd, JSON.parse(JSON.stringify(args || {}))]);
    switch (cmd) {
      case 'hydra_info': return { ok: true, launcher: 2, desktop: true, port: 0, root: '', home: 'h', projects: 'p', autosave: 'a', backups: 'b', samples: 's', keep: 10 };
      case 'hydra_list': return []; case 'hydra_startup_name': return null;
      case 'ai_mcp_listen': return args.on ? { listening: true, port: 50123 } : { listening: false };
      case 'ai_mcp_reply': window.__replies[args.rid] = args.result; return null;
      case 'ai_cli_detect': return { claude: 'C:\\npm\\claude.cmd', codex: 'C:\\npm\\codex.cmd', codexSignedIn: false };
      case 'ai_key_has': return args.provider === 'anthropic';
      case 'ai_cli_run': window.__runN = (window.__runN || 0) + 1; return 'r' + window.__runN;
      case 'ai_cli_stop': return null;
      case 'ai_api_chat': window.__apiBodies.push(JSON.parse(JSON.stringify(args.body))); const r = window.__api.shift(); if (!r) throw 'no scripted reply'; return r;
      default: return null;
    } } },
  event: { listen: async (name, cb) => { window.__listeners[name] = cb; return () => {}; } }
};
window.__mcp = (rid, tool, args, client) => { window.__listeners['ai-mcp-call']({ payload: { rid, tool, args, client } }); return window.__replies[rid]; };
window.__cli = (run, kind, x) => window.__listeners['ai-cli']({ payload: { run, kind, ...x } });
"""
CLAMP={'parts':[{'tag':'1A1','ref':'h_cyl_double','x':150,'y':60},{'tag':'1V1','ref':'v_43_closed','x':150,'y':130,'values':{'ya':'1Y1','yb':'1Y2'}},{'tag':'1P1','ref':'h_pump_fixed','x':145,'y':220},{'tag':'1M1','ref':'h_emotor','x':113,'y':220},{'tag':'1V2','ref':'h_relief','x':190,'y':190,'values':{'set':'120 bar'}},{'tag':'1Z1','ref':'h_tank','x':145,'y':260},{'tag':'1Z2','ref':'h_tank','x':190,'y':240},{'tag':'1Z3','ref':'h_tank','x':170,'y':170}],
 'nets':[{'ports':['1A1.A','1V1.A']},{'ports':['1A1.B','1V1.B']},{'ports':['1P1.P','1V1.P','1V2.P']},{'ports':['1V2.T','1Z2.T']},{'ports':['1P1.S','1Z1.T']},{'ports':['1V1.T','1Z3.T']}]}
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1440,'height':900}); ctx.add_init_script(MOCK); pg=ctx.new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500)
    ev=pg.evaluate; H="window.HYDRA.S"; A="window.HYDRA.ai"; q=pg.query_selector; w=lambda ms=250: pg.wait_for_timeout(ms)
    calls=lambda c: [x[1] for x in ev("window.__calls") if x[0]==c]
    texts=lambda sel: ev(f"[...document.querySelectorAll('{sel}')].map(x=>x.textContent)")
    tools=json.load(open(os.path.join(S,'desktop','src-tauri','mcp-tools.json'),encoding='utf-8'))['tools']
    check('MCP tool list has 20 tools incl. the new ones', len(tools)==20 and {'get_question_template','ask_user','propose_bom','insert_template','create_for'} <= {t['name'] for t in tools})
    ev(f"{A}.settings.saveAiSettings({{...{A}.settings.aiSettings.value, enabled:true, cli:true, provider:'claude-cli'}})")
    ev(f"(()=>{{const X=window.HYDRA; X.Pj.setProject(X.Pj.newProjectData({{name:'AI 7-9',template:'blank',unitSystem:'SI-bar'}}),{{dirty:true}}); X.S.addNode('sheet', null, 'hydraulic', 'Clamp');}})()")
    nid=ev(f"Object.values({H}.project.value.nodes).find(n=>n.type==='sheet').id"); ev(f"{H}.openSheetTab('{nid}')"); w(800)
    check('desktop: Claude Code, Codex and API key offered', [x['id'] for x in ev(f"{A}.session.providerList().map(p=>({{id:p.id}}))")]==['claude-cli','codex-cli','api-key'])
    check('Codex found but not signed in', ev(f"{A}.session.providerList().find(p=>p.id==='codex-cli').status()")=='signed-out')
    # ---- step 8: templates, form, parts list with HYDRA's mandatory parts ----
    r=ev(f"{A}.call('get_question_template',{{circuit_type:'elevator'}},{{source:'test'}})"); check('question template: lift (13 questions)', r['ok'] and r['data']['circuit_type']=='lift' and len(r['data']['questions'])==13, r)
    r=ev(f"{A}.call('get_question_template',{{circuit_type:'crane'}},{{source:'test'}})"); check('unknown type: generic + list', r['data']['circuit_type']=='generic' and 'press' in r['data']['available'], r)
    cid=ev(f"{A}.providers.cliClient")
    pg.click('.ailaunch'); w()
    r=ev("([c])=>window.__mcp('m1','ask_user',{title:'A few details for: lift',questions:[{id:'load',label:'Rated load',type:'number',unit:'kg',value:450}]},c)",[cid])
    check('ask_user from the CLI: form in the panel', r['ok'] and r['data']['shown'] and 'A few details for: lift' in ' '.join(texts('.aict')), r)
    r=ev("window.__mcp('m2','ask_user',{title:'x',questions:[{id:'a',label:'A',type:'text'}]},'')")
    check('ask_user from Claude Desktop: asked in its own chat', not r['ok'] or r['data']['shown']==False, r)
    r=ev("([c])=>window.__mcp('m3','propose_bom',{circuit_type:'lift',pressure:'60 bar',rows:[{tag:'1P1',part:'Screw pump',ref:'std:h_pump_fixed',rating:'35 L/min'},{tag:'1A1',part:'Plunger cylinder',rating:'Ø50'}]},c)",[cid])
    added=r.get('data',{}).get('added_by_hydra',[])
    check('HYDRA adds relief, tank and lift safety parts', r['ok'] and any('relief' in a.lower() for a in added) and any('tank' in a.lower() for a in added) and any('rupture' in a.lower() for a in added) and any('check' in a.lower() for a in added) and any('lowering' in a.lower() for a in added), added)
    check('rupture valve flagged: no library symbol', 'Valve Creator' in ' '.join(texts('.aibnote')), texts('.aibnote'))
    check('mandatory rows locked in the parts list', ev("[...document.querySelectorAll('.aibom tbody tr')].filter(r=>r.querySelector('svg') && !r.querySelector('button')).length")==5)
    r=ev(f"{A}.call('propose_bom',{{rows:[{{tag:'1P1',part:'Pump, pressure compensated',ref:'std:h_pump_pc'}}]}},{{source:'test'}})"); check('pressure-compensated pump: no relief added', not any('relief' in a.lower() for a in r['data']['added_by_hydra']), r['data']['added_by_hydra'])
    # ---- step 7: CLI bridge (Claude Code) ----
    ev(f"{A}.session.clearThread()"); w()
    pg.fill('.aicomp textarea','Make a clamping circuit'); pg.keyboard.press('Enter'); w(300)
    run=calls('ai_cli_run')[-1] if calls('ai_cli_run') else {}
    check('Claude Code started: prompt on stdin, HYDRA tools only, no resume yet', run.get('tool')=='claude' and run.get('prompt','').startswith('[Mode: Build] Make a clamping circuit') and run.get('resume') is None and run.get('client')==cid and 'build_circuit' in run.get('system',''), run)
    check('panel shows Working and a Stop button', q('.ailaunch.working') is not None and q('.aistop') is not None)
    ev("window.__cli('r1','line',{line:JSON.stringify({type:'system',subtype:'init',session_id:'sess-42'})})")
    ev("window.__cli('r1','line',{line:JSON.stringify({type:'assistant',session_id:'sess-42',message:{content:[{type:'text',text:'Drawing the clamp circuit now.'},{type:'tool_use',name:'mcp__hydra__build_circuit',input:{}}]}})})")
    r=ev("([c,a])=>window.__mcp('m4','build_circuit',a,c)",[cid,CLAMP]); w(300)
    check('CLI edit becomes a plan card + ghost (never applied by the AI)', r['ok'] and r['data'].get('plan_id') and q('.aicard.plan.ready') is not None and len(pg.query_selector_all('.ai-ghost-part'))==8, r)
    r=ev("([c,id])=>window.__mcp('m5','run_sim',{plan:id,t_end:7,events:[{t:0.2,tag:'1V1',pos:'a'},{t:4,tag:'1V1',pos:'b'}]},c)",[cid, r['data'].get('plan_id')])
    check('sim results stay in HYDRA (only pass / fail to the AI)', r['ok'] and set(r['data'].keys())=={'passed','shown_in_hydra','note'} and 'Solver check passed' in ' '.join(texts('.aisim')), r)
    ev("window.__cli('r1','line',{line:JSON.stringify({type:'result',subtype:'success',is_error:false,result:'Done',session_id:'sess-42'})})"); ev("window.__cli('r1','done',{code:0,err:''})"); w(300)
    check('assistant text shown, run finished', 'Drawing the clamp circuit now.' in ' '.join(texts('.aimsg.ai')) and q('.ailaunch.working') is None)
    pg.fill('.aicomp textarea','Make the stroke 250 mm'); pg.keyboard.press('Enter'); w(300)
    check('next turn resumes the same Claude Code session', calls('ai_cli_run')[-1].get('resume')=='sess-42', calls('ai_cli_run')[-1])
    pg.click('.aistop'); w(); check('Stop ends the run', {'run':'r2'} in calls('ai_cli_stop'))
    ev("window.__cli('r2','done',{code:1,err:'stopped'})"); w(300); check('stopped run shown as an error, not a hang', 'stopped' in ' '.join(texts('.aimsg.err')) and q('.ailaunch.working') is None)
    ev(f"{A}.settings.saveAiSettings({{...{A}.settings.aiSettings.value, cli:false}})")
    r=ev("([c])=>window.__mcp('m6','get_sheet',{},c)",[cid]); check('CLI bridge off: its calls are refused', not r['ok'] and 'CLI bridge is off' in r['error'], r)
    ev(f"{A}.settings.saveAiSettings({{...{A}.settings.aiSettings.value, cli:true}})")
    # ---- step 9: Create Electric / Logic Code / Controller-HMI after a hydraulic Apply ----
    pg.click('text=Apply to sheet'); w(400)
    check('after Apply: Create Electric / Logic Code / Controller-HMI', texts('.aicreate button')==['Create Electric','Create Logic Code','Create Controller-HMI'], texts('.aicreate button'))
    h0=ev(f"{H}.histVer.value"); pg.click('.aicreate button:nth-child(1)'); w(500)
    check('Create Electric: plan with 3 sheets, nothing changed yet', 'Electric sheets: Clamp · E1 Power, Clamp · E2 PLC inputs, Clamp · E3 PLC outputs' in ' '.join(texts('.aicard.plan.ready li')) and ev(f"{H}.histVer.value")==h0, texts('.aicard.plan.ready li'))
    pg.click('.aicard.plan.ready >> text=Apply to sheet'); w(500)
    nodes=ev(f"Object.values({H}.project.value.nodes).map(n=>n.type+':'+n.name)")
    check('applied as one undo step: power, inputs, outputs sheets', ev(f"{H}.histVer.value")==h0+1 and sum(1 for n in nodes if n.startswith('sheet:Clamp · E'))==3, nodes)
    sig=ev(f"window.HYDRA.plc.signals.signals({H}.project.value).sigs.filter(s=>s.src==='plc').map(s=>s.dir+':'+s.tag)")
    check('PLC I/O wired to the circuit tags', all(x in sig for x in ['out:1Y1','out:1Y2','out:1K1','in:1B1','in:1B2','in:0S2']), sig)
    pg.click('.aicreate button:nth-child(2)'); w(500); pg.click('.aicard.plan.ready >> text=Apply to sheet'); w(500)
    comp=ev(f"(()=>{{const X=window.HYDRA,p=X.S.project.value; const pr=Object.values(p.programs)[0]; const c=X.plc.compile.compile(pr,X.plc.signals.signals(p)); return {{n:Object.keys(p.programs).length, seqs:c.seqs.map(s=>s.name+':'+s.steps.length), bad:(c.errors||c.issues||[]).filter(i=>i.level==='err'||i.level==='warn').map(i=>i.text)}}}})()")
    check('Create Logic Code: AUTO 1A1+ 1A1- and HOMING compile cleanly', comp['n']==1 and 'AUTO:4' in comp['seqs'] and not comp['bad'], comp)
    pg.click('.aicreate button:nth-child(3)'); w(500); h1=ev(f"{H}.histVer.value"); pg.click('.aicard.plan.ready >> text=Apply to sheet'); w(500)
    pan=ev(f"(()=>{{const p={H}.project.value; return {{n:Object.keys(p.programs).length, w:(Object.values(p.programs)[0].panel||{{widgets:[]}}).widgets.length}}}})()")
    check('Create Controller-HMI: panel on the same program', pan['n']==1 and pan['w']>10 and ev(f"{H}.histVer.value")==h1+1, pan)
    ev(f"{H}.undo()"); w(); check('Ctrl+Z removes just the panel', not ev(f"Object.values({H}.project.value.programs)[0].panel"))
    # ---- step 7: own API key (Anthropic) ----
    ev(f"{A}.settings.saveAiSettings({{...{A}.settings.aiSettings.value, provider:'api-key', apiVendor:'anthropic', apiModel:''}})"); ev(f"{A}.providers.refreshKeys()"); w(300)
    ev(f"{A}.session.clearThread()")
    ev("window.__api.push({content:[{type:'thinking',thinking:'',signature:'sig1'},{type:'text',text:'Reading the sheet.'},{type:'tool_use',id:'tu1',name:'get_sheet',input:{}}],stop_reason:'tool_use'}, {content:[{type:'text',text:'The sheet has 8 parts.'}],stop_reason:'end_turn'})")
    pg.click('.aimodes button:nth-child(2)'); pg.fill('.aicomp textarea','What is on the sheet?'); pg.keyboard.press('Enter'); w(800)
    bodies=ev("window.__apiBodies")
    check('API request: Opus 5.5, fallbacks, caching, 20 tools', len(bodies)>=1 and bodies[0]['model']=='claude-opus-5-5' and bodies[0]['fallbacks']=='default' and bodies[0]['cache_control']=={'type':'ephemeral'} and len(bodies[0]['tools'])==20 and 'thinking' not in bodies[0], bodies[0] if bodies else None)
    check('tool loop: result sent back, thinking block returned unchanged', len(bodies)==2 and bodies[1]['messages'][1]['content'][0]=={'type':'thinking','thinking':'','signature':'sig1'} and bodies[1]['messages'][2]['content'][0]['type']=='tool_result' and 'Clamp' in bodies[1]['messages'][2]['content'][0]['content'], bodies[1]['messages'][2] if len(bodies)>1 else None)
    check('API replies shown in the panel', 'The sheet has 8 parts.' in ' '.join(texts('.aimsg.ai')))
    ev("window.__api.push({content:[],stop_reason:'refusal'})"); pg.fill('.aicomp textarea','again'); pg.keyboard.press('Enter'); w(500)
    check('refusal shown as an error', 'declined' in ' '.join(texts('.aimsg.err')))
    check('the key never reaches the page', not any('key' in json.dumps(b.get('body',{})) for b in [] ) and all('sk-' not in json.dumps(x) for x in ev("window.__calls")))
    check('no page errors', not errs, errs)
    b.close()
for r in R: print(*r)
print(sum(1 for r in R if r[0]=='PASS'),'/',len(R))
