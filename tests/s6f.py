import sys, os, json, time
from playwright.sync_api import sync_playwright
import os; S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
R=[]
def check(n,c,x=''): R.append(('PASS' if c else 'FAIL',n,str(x)[:300]))
exec(open(S+'/s6b.py').read().split('JS_HELP = ')[1].split('with sync_playwright')[0].join(['JS_HELP = ','']) if False else '')
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1500,'height':940}); pg=ctx.new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500)
    ev=pg.evaluate; H="window.HYDRA.S"; DS="window.HYDRA.designer.st"; SIM="window.HYDRA.designer.sim"
    ev("window.HYDRA.actions.openSampleCopy('s_basic_cyl')"); pg.wait_for_timeout(1000)
    ev(f"{DS}.D.value.selectAll()"); ev(f"{DS}.D.value.copy()")
    for i in range(9): ev(f"{DS}.D.value.paste()")
    nc=ev(f"{DS}.sheetById({DS}.D.value.sheetId).components.length")
    ev(f"{DS}.D.value.simRun()"); pg.wait_for_timeout(500)
    n=ev(f"{SIM}.SIM.n"); t0=ev(f"{SIM}.SIM.t"); w0=time.time(); pg.wait_for_timeout(3000); t1=ev(f"{SIM}.SIM.t"); w1=time.time()
    print('parts',nc,'nets',n,'sim s per wall s', (t1-t0)/(w1-w0), 'rtf', ev(f"{SIM}.simView.value.rtf"))
    check('big circuit (100 parts) runs near real time', (t1-t0)/(w1-w0)>0.5, (n,(t1-t0)/(w1-w0)))
    ev(f"{DS}.D.value.simStop()")
    # edit in place
    ev(JS:="0")
    print('errs', errs[:5]); b.close()
for r in R: print(*r)
