# AI step 5 — HYDRA.exe --mcp as Claude Desktop sees it: spawned with pipes, MCP (JSON-RPC) over stdio.
# Usage: python tests/a5_mcp_stdio.py <path to hydra.exe> [--live]
#   default: HYDRA not running and not started (HYDRA_MCP_NO_LAUNCH) → initialize / tools/list answered, tool calls
#            get the clear "turn on AI and MCP" message.
#   --live:  HYDRA is running with AI + MCP on → tool calls reach the app (project info, a plan for a circuit).
import json, os, subprocess, sys, tempfile
sys.stdout.reconfigure(encoding='utf-8')
exe = sys.argv[1]; live = '--live' in sys.argv
R = []
def check(n, c, x=''): R.append(('PASS' if c else 'FAIL', n, str(x)[:300]))
env = dict(os.environ)
if not live: env.update({'HYDRA_MCP_NO_LAUNCH': '1', 'HYDRA_MCP_WAIT': '1', 'APPDATA': tempfile.mkdtemp(prefix='hydra-mcp-')})
p = subprocess.Popen([exe, '--mcp'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, text=True, encoding='utf-8', bufsize=1)
def rpc(i, method, params=None):
    p.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': i, 'method': method, **({'params': params} if params is not None else {})}) + '\n'); p.stdin.flush()
    return json.loads(p.stdout.readline())
def note(method): p.stdin.write(json.dumps({'jsonrpc': '2.0', 'method': method}) + '\n'); p.stdin.flush()
r = rpc(1, 'initialize', {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'test', 'version': '1'}})
check('initialize: protocol and server info', r['result']['protocolVersion'] == '2025-06-18' and r['result']['serverInfo']['name'] == 'hydra' and 'tools' in r['result']['capabilities'], r)
note('notifications/initialized')
r = rpc(2, 'tools/list'); names = [t['name'] for t in r['result']['tools']]
check('tools/list without starting HYDRA: 20 tools', len(names) == 20 and 'build_circuit' in names and all('inputSchema' in t for t in r['result']['tools']), names)
check('no script tool', not any('script' in n or 'eval' in n for n in names))
r = rpc(3, 'ping'); check('ping', r.get('result') == {}, r)
r = rpc(4, 'tools/call', {'name': 'get_project_info', 'arguments': {}}); txt = r['result']['content'][0]['text']
if not live:
    check('HYDRA off: clear message, not a crash', r['result']['isError'] is True and 'Settings' in txt and 'MCP server' in txt, txt)
else:
    check('live: project info from HYDRA', r['result']['isError'] is False and 'sheets' in json.loads(txt), txt)
    r = rpc(5, 'tools/call', {'name': 'build_circuit', 'arguments': {'parts': [{'tag': '1A1', 'ref': 'h_cyl_double', 'x': 150, 'y': 60}, {'tag': '1Z1', 'ref': 'h_tank', 'x': 150, 'y': 200}]}})
    d = json.loads(r['result']['content'][0]['text']) if not r['result']['isError'] else {}
    check('live: edit becomes a plan waiting in HYDRA', d.get('plan_id') and d.get('added') == ['1A1', '1Z1'], r['result'])
    r = rpc(6, 'tools/call', {'name': 'apply_plan', 'arguments': {'plan_id': d.get('plan_id', 'x')}})
    check('live: AI apply waits for the user', 'waiting_for_user' in r['result']['content'][0]['text'], r['result'])
r = rpc(7, 'tools/call', {'name': 'run_script', 'arguments': {}}); check('unknown tool refused', r['result']['isError'] and 'Unknown tool' in r['result']['content'][0]['text'], r)
r = rpc(8, 'resources/list'); check('unsupported method: JSON-RPC error', r['error']['code'] == -32601, r)
p.stdin.close(); p.wait(timeout=10); check('exits when the client closes stdin', p.returncode == 0, p.returncode)
for x in R: print(*x)
print(sum(1 for x in R if x[0] == 'PASS'), '/', len(R))
