from playwright.sync_api import sync_playwright
import os; S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(); pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500); ev=pg.evaluate
    ev("window.HYDRA.actions.openSampleCopy('s_press')"); pg.wait_for_timeout(900)
    print(ev("""(()=>{ const M0=window.HYDRA.designer.sim; const p0=window.HYDRA.S.project.value; const sh0=Object.values(p0.circuits).find(c=>c.components&&c.components.length>5); const s0=new M0.Sim(p0, sh0.id, {}); const vv=s0.els.find(e=>e.kind==='valve'); return {ports:vv.el.ports, boxes:vv.el.g.valve.boxes.map(b=>b.paths), gp:vv.el.g.ports.map(q=>q.key+':'+q.role)}; })()"""))
    print(ev("""(()=>{ const M=window.HYDRA.designer.sim; const p=window.HYDRA.S.project.value; const sh=Object.values(p.circuits).find(c=>c.components&&c.components.length>5);
      const s=new M.Sim(p, sh.id, {}); const pump=s.els.find(e=>e.kind==='pump'); const pn=pump.nodes[1]; const v=s.els.find(e=>e.kind==='valve'); const out=[]; let mx=0, tmx=0; const bad=new Set(); s.els.forEach(e=>{ const f0=e.f; e.f=(P,o)=>{ f0(P,o); o.forEach((x,i)=>{ if(!isFinite(x)) bad.add(e.tag+':'+e.kind+':'+i); }); }; if(e.cap){ const c0=e.cap; e.cap=(ss,C)=>{ c0(ss,C); C.forEach((x,i)=>{ if(!isFinite(x)) bad.add('cap '+e.tag); }); }; } });
      for(let i=0;i<800;i++){ if(i===200) v.command(0,s); s.step(); if(s.p[pn]>mx){mx=s.p[pn];tmx=s.t;} if(i%400===0) out.push([s.t.toFixed(2), (s.p[pn]/1e5).toFixed(1), s.els.find(e=>e.kind==='actuator').state.x.toFixed(3)]); }
      const dbg=[]; for(let i=0;i<s.n;i++) dbg.push([i,(s.p[i]/1e5).toFixed(1), s.f.labels[i].join(',')]);
      const tk=s.els.find(e=>e.kind==='tank'); const R=new Float64Array(s.n); const g=i=>i<0?0:s.p[i]; for(let i=0;i<s.n;i++) R[i]=s.C[i]/s.dt*(s.p[i]-s.pOld[i]); const contrib=[]; s.els.forEach(e=>{ const o=e.nodes.map(()=>0); e.f(g,o); e.nodes.forEach((nd,a)=>{ if(nd>=0){ R[nd]-=o[a]; if(Math.abs(o[a])>1e-4) contrib.push(e.tag+'@'+nd+':'+(o[a]*60000).toFixed(0)); } }); });
      const n=s.n, P=s.p, get=i=>i<0?0:P[i]; const J=new Float64Array(n*n), RR=new Float64Array(n); const o1=[],o2=[];
      for(let i=0;i<n;i++){ const c=s.C[i]/s.dt; J[i*n+i]=c; RR[i]=c*(P[i]-s.pOld[i]); }
      const jrows=[]; for(const e of s.els){ const nd=e.nodes; o1.length=nd.length; o1.fill(0); e.f(get,o1); nd.forEach((x,a)=>{ if(x>=0) RR[x]-=o1[a]; });
        for(let b2=0;b2<nd.length;b2++){ const j=nd[b2]; if(j<0||nd.indexOf(j)!==b2) continue; const h=Math.max(200,Math.abs(P[j])*1e-5); const k=P[j]; P[j]=k+h; o2.length=nd.length; o2.fill(0); e.f(get,o2); P[j]=k; for(let a=0;a<nd.length;a++){ const i=nd[a]; if(i<0) continue; const dJ=-(o2[a]-o1[a])/h; J[i*n+j]+=dJ; if(i===4&&Math.abs(dJ)>1e-12) jrows.push(e.tag+' d'+i+'/d'+j+'='+dJ.toExponential(2)); } } }
      return {jrows, Jrow4:Array.from(J.slice(4*n,5*n)).map(x=>x.toExponential(2)), R:Array.from(R).map(x=>(x*60000).toFixed(1)), contrib, bad:[...bad], C:Array.from(s.C), dbg, th:s.thermal, tempv: tk.el.values.temp, mx:mx/1e5, tmx, nodes:s.n, els:s.els.map(e=>e.tag+':'+e.kind+':'+(e.read?e.read(s).text:''))}; })()"""))
    b.close()
