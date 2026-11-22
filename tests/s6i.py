from playwright.sync_api import sync_playwright
import os; S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500); ev=pg.evaluate
    ev("window.HYDRA.actions.openSampleCopy('s_press')"); pg.wait_for_timeout(900)
    r=ev("""(()=>{ const M=window.HYDRA.designer.sim; const p=window.HYDRA.S.project.value; const sh=Object.values(p.circuits).find(c=>c.components&&c.components.length>5);
      const s=new M.Sim(p, sh.id, {}); const v=s.els.find(e=>e.kind==='valve'); let first=-1; const pn=s.els.find(e=>e.kind==='pump').nodes[1];
      for(let i=0;i<400;i++){ if(i===200) v.command(0,s); if(i>=255 && i<=340) s.dbg=[]; else s.dbg=null; s.step(); if(s.dbg && s.dbg.length) { if(first<0 && s.p[pn]>2e7) first=i; } if(first>=0 && i>first+1) break; if(i>=255&&i<=340&&s.dbg) s.last=(s.last||[]).concat(s.dbg); }
      return {first, log:(s.last||[]).slice(-40)}; })()""")
    print(r['first']); [print(x) for x in r['log']]
    b.close()
