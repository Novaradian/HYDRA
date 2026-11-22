import json
from playwright.sync_api import sync_playwright
import os; S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(3000); ev=pg.evaluate
    ev("window.HYDRA.Pj.createProject({name:'Sweep', template:'blank', unitSystem:'SI-bar'})"); pg.wait_for_timeout(400)
    r=ev("""(()=>{ const H=window.HYDRA, S=H.S, st=H.designer.st, M=H.designer.sim, G=H.designer.geom; const fl=H.designer;
      const out={noModel:[], err:[], noFields:[], nan:[], ok:0, total:0};
      const items=[...H.symbols.STD.filter(i=>i.domain!=='electrical').map(i=>'std:'+i.id), ...H.symbols.STD_VALVES.map(v=>'std:'+v.id)];
      const sid=S.addNode('sheet', null, 'hydraulic', 'Sweep H'), pid=S.addNode('sheet', null, 'pneumatic', 'Sweep P');
      for (const ref of items) { const g=G.geomOf(ref); const sh=g.domain==='pneumatic'?pid:sid; out.total++;
        S.mutate('clear', d=>{ const c=d.circuits[sh]; c.components=[]; c.pipes=[]; c.junctions=[]; c.texts=[]; c.enclosures=[]; c.designerVersion=1; });
        st.addPart(sh, ref, 100, 100);
        try { const s=new M.Sim(S.project.value, sh, {}); const els=s.els.filter(e=>e.el && e.el.comp.ref===ref);
          if (g.cls!=='drive' && !els.length) out.noModel.push(g.item?.id+' ('+g.cls+')');
          for (let i=0;i<200;i++) s.step(); if ([...s.p].some(x=>!isFinite(x))) out.nan.push(g.item?.id);
          els.forEach(e=>{ try { e.read && e.read(s); } catch(x){ out.err.push(g.item?.id+' read '+x.message); } });
          s.issues.filter(i=>/not simulated/.test(i.text)).forEach(i=>out.err.push(i.text));
          out.ok++; } catch(x){ out.err.push(g.item?.id+': '+x.message); }
      }
      return out; })()""")
    print(json.dumps(r, indent=1)); print('errs', errs[:5])
    b.close()
