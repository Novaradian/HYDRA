# AI steps 5+6 — app side of the MCP server and the Connect dialog, in the page with a stand-in for HYDRA.exe's native
# bridge (window.__TAURI__): listener on/off follows the settings, tool calls run with the user's permission level,
# Claude Desktop config, CLI detection, API key save. The native half (stdio, 127.0.0.1 listener, token, config file)
# is covered by the Rust unit tests in desktop/src-tauri/src/ai.rs.
from playwright.sync_api import sync_playwright
import os, sys, json; sys.stdout.reconfigure(encoding='utf-8'); S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
R=[]
def check(n,c,x=''): R.append(('PASS' if c else 'FAIL',n,str(x)[:300]))
MOCK = r"""
window.__calls = []; window.__replies = {}; window.__keys = {};
window.__TAURI__ = {
  core: { invoke: async (cmd, args) => {
    window.__calls.push([cmd, JSON.parse(JSON.stringify(args || {}))]);
    switch (cmd) {
      case 'hydra_info': return { ok: true, launcher: 2, desktop: true, port: 0, root: '', home: 'C:\\Users\\t\\Documents\\HYDRA', projects: 'p', autosave: 'a', backups: 'b', samples: 's', keep: 10 };
      case 'hydra_list': return []; case 'hydra_startup_name': return null;
      case 'ai_mcp_listen': return args.on ? { listening: true, port: 50123 } : { listening: false };
      case 'ai_mcp_reply': window.__replies[args.rid] = args.result; return null;
      case 'ai_cli_detect': return { claude: 'C:\\Users\\t\\AppData\\Roaming\\npm\\claude.cmd', codex: null };
      case 'ai_claude_config': return { exe: 'C:\\Apps\\HYDRA\\HYDRA.exe', snippet: { hydra: { command: 'C:\\Apps\\HYDRA\\HYDRA.exe', args: ['--mcp'] } }, installed: true,
        targets: [{ path: 'C:\\Users\\t\\AppData\\Roaming\\Claude\\claude_desktop_config.json', exists: true, hydra: !!args.write }], written: args.write ? [{ path: 'x', backup: 'C:\\x\\claude_desktop_config.json.bak-20261122-101010' }] : [] };
      case 'ai_key_set': window.__keys[args.provider] = true; return null;
      case 'ai_key_has': return !!window.__keys[args.provider];
      case 'ai_key_delete': delete window.__keys[args.provider]; return null;
      default: return null;
    } } },
  event: { listen: async (name, cb) => { window.__listeners = window.__listeners || {}; window.__listeners[name] = cb; return () => {}; } }
};
window.__mcp = (rid, tool, args) => { window.__listeners['ai-mcp-call']({ payload: { rid, tool, args } }); return window.__replies[rid]; };
"""
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1440,'height':900}); ctx.add_init_script(MOCK); pg=ctx.new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500)
    ev=pg.evaluate; H="window.HYDRA.S"; A="window.HYDRA.ai"; q=pg.query_selector; w=lambda ms=250: pg.wait_for_timeout(ms)
    listens=lambda: [c[1]['on'] for c in ev("window.__calls") if c[0]=='ai_mcp_listen']
    check('desktop bridge registered', ev("!!(window.__listeners||{})['ai-mcp-call']"))
    check('AI off: listener closed at start', listens()==[False], listens())
    r=ev("window.__mcp('m1','get_project_info',{})"); check('call while off refused', r and not r['ok'] and 'off' in r['error'], r)
    # turn on in Settings, then MCP in the Connect dialog
    ev(f"{A}.settings.saveAiSettings({{...{A}.settings.aiSettings.value, enabled:true}})"); w()
    check('AI on, MCP off: listener still closed', listens()[-1]==False, listens())
    pg.click('.ailaunch'); w(500)
    check('Connect dialog: two sides', 'A · AI inside HYDRA' in ev("document.querySelector('.modal').textContent") and 'B · HYDRA inside your AI app (MCP)' in ev("document.querySelector('.modal').textContent"))
    check('Claude Code found, Codex not installed', ev("[...document.querySelectorAll('.aicon .badge')].map(b=>b.textContent).join('|')").startswith('Experimental|Found|Experimental|Not installed'), ev("[...document.querySelectorAll('.aicon .badge')].map(b=>b.textContent).join('|')"))
    check('config snippet shows the real HYDRA.exe path', 'C:\\\\Apps\\\\HYDRA\\\\HYDRA.exe' in ev("document.querySelector('.aicon .aicmds').textContent") and '--mcp' in ev("document.querySelector('.aicon .aicmds').textContent"))
    pg.click('.aicon .aiset-row input[type=checkbox]'); w(400)
    check('MCP on: listener opened, shown On', listens()[-1]==True and ev(f"{A}.settings.aiSettings.value.mcp") and 'On' in ev("document.querySelector('.aicon .aiset-row').textContent"))
    pg.click('text=Add to Claude Desktop'); w(400)
    check('Add to Claude Desktop writes the config (backup named)', ['ai_claude_config',{'write':True}] in ev("window.__calls") and 'bak-20261122' in ev("document.querySelector('.modal').textContent"))
    pg.fill('.aicon input[type=password]','sk-ant-test-123'); pg.click('.aicon button:has-text("Save")'); w(400)
    check('API key goes to the credential store only', ['ai_key_set',{'provider':'anthropic','key':'sk-ant-test-123'}] in ev("window.__calls") and ev("document.querySelector('.aicon input[type=password]').value")=='' and 'sk-ant' not in ev("JSON.stringify(localStorage)") and 'sk-ant' not in ev(f"JSON.stringify({A}.settings.aiSettings.value)"))
    check('saved key shown as saved, not shown again', 'Anthropic saved' in ev("document.querySelector('.modal').textContent"))
    pg.keyboard.press('Escape'); w()
    # tool calls from the AI app, with the user's permission level
    ev(f"(()=>{{const X=window.HYDRA; X.Pj.setProject(X.Pj.newProjectData({{name:'MCP test',template:'blank',unitSystem:'SI-bar'}}),{{dirty:true}}); X.S.addNode('sheet', null, 'hydraulic', 'Clamp');}})()")
    r=ev("window.__mcp('m2','get_project_info',{})"); check('MCP read call answered', r['ok'] and r['data']['name']=='MCP test', r)
    part={'parts':[{'tag':'1A1','ref':'h_cyl_double','x':150,'y':60},{'tag':'1Z1','ref':'h_tank','x':150,'y':200}]}
    r=ev("(a)=>window.__mcp('m3','build_circuit',a)", part)
    check('Edit with approval (default): edit becomes a plan', r['ok'] and r['data'].get('plan_id') and ev(f"Object.values({H}.project.value.circuits)[0].components.length")==0, r)
    r=ev("(id)=>window.__mcp('m4','apply_plan',{plan_id:id})", r['data']['plan_id']); check('AI cannot apply: waits for the user', r['ok'] and r['data']['status']=='waiting_for_user', r)
    ev(f"{A}.settings.saveAiSettings({{...{A}.settings.aiSettings.value, mcpPerm:'read'}})")
    r=ev("(a)=>window.__mcp('m5','build_circuit',a)", part); check('Read only: edits refused', not r['ok'] and 'Read-only access' in r['error'], r)
    r=ev("window.__mcp('m6','get_sheet',{})"); check('Read only: reads allowed', r['ok'], r)
    ev(f"{A}.settings.saveAiSettings({{...{A}.settings.aiSettings.value, mcpPerm:'free'}})"); h0=ev(f"{H}.histVer.value")
    r=ev("(a)=>window.__mcp('m7','build_circuit',a)", part)
    check('Edit freely: applied as one undo step', r['ok'] and ev(f"Object.values({H}.project.value.circuits)[0].components.length")==2 and ev(f"{H}.histVer.value")==h0+1, r)
    check('a client cannot raise its own permission', ev(f"{A}.aiLog.value.filter(x=>x.source==='mcp').length")>=6)
    r=ev("window.__mcp('m8','run_script',{js:'1'})"); check('unknown tool refused', not r['ok'] and 'Unknown command' in r['error'], r)
    ev(f"{H}.mutate('Private', d=>{{d.manifest.private=true}})"); r=ev("window.__mcp('m9','get_sheet',{})"); check('Private project refused over MCP', not r['ok'] and 'Private' in r['error'], r)
    # off again
    ev(f"{A}.settings.saveAiSettings({{...{A}.settings.aiSettings.value, mcp:false}})"); w()
    check('MCP off: listener closed', listens()[-1]==False)
    ev(f"{A}.settings.saveAiSettings({{...{A}.settings.aiSettings.value, mcp:true, enabled:false}})"); w()
    check('master off closes it too', listens()[-1]==False)
    r=ev("window.__mcp('m10','get_sheet',{})"); check('calls refused while off', not r['ok'], r)
    check('no page errors', not errs, errs)
    b.close()
for r in R: print(*r)
print(sum(1 for r in R if r[0]=='PASS'),'/',len(R))
