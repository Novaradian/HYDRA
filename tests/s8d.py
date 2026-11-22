# Step 8d: the 48 new Logic Coder blocks — compare/select, bits & words, shift register, arrays/tables/records,
# PID/ramp/filter/average, clock, function blocks, END / parallel / hold sequences, handshakes, modes, alarm groups, safety
import json, os
from playwright.sync_api import sync_playwright
S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..' if os.path.basename(os.path.dirname(os.path.abspath(__file__)))=='tests' else '../..')))
R=[]
def check(n,c,x=''): R.append(('PASS' if c else 'FAIL',n,str(x)[:300]))
NEW=['hy_window','hy_hyst','hy_deadband','hy_sel','hy_mux','hy_bitop','hy_wnot','hy_shift','hy_bit_get','hy_bit_set','hy_shreg','hy_shreg_bit',
     'hy_array','hy_arr_get','hy_arr_set','hy_arr_fill','hy_arr_stat','hy_table','hy_rec_set','hy_rec_get','hy_pid','hy_pid_out','hy_ramp','hy_avg','hy_filter',
     'hy_blink','hy_rtc','hy_rtc_between','hy_fb_def','hy_fb_in','hy_fb_out','hy_fb_call','hy_fb_get','hy_par','hy_par_done','hy_seq_done','hy_seq_hold',
     'hy_wait_to','hy_handshake','hy_mode_sel','hy_mode_set','hy_mode_is','hy_alarm_group','hy_alarm_count','hy_alarm_ack','hy_twohand','hy_dualch','hy_watchdog']
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1600,'height':960}); pg=ctx.new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500); ev=pg.evaluate
    pg.add_script_tag(path=S+'/tests/t8/s8d_lib.js')
    H="window.HYDRA"
    def js(body): return ev("(()=>{const {blk,V,n,tf,vg,set,hat,sub,prog,comp,issues,run,step,seq,T}=T8D;\n"+body+"\n})()")
    # ---------- editor: every new block is in the toolbox and renders ----------
    ev(f"{H}.actions.openSampleCopy('s_sequence')"); pg.wait_for_timeout(1200)
    pid=ev(f"{H}.S.addNode('program', null, undefined, 'T8d')"); ev(f"{H}.S.openSheetTab('{pid}')"); pg.wait_for_timeout(2500)
    tb=pg.inner_text('.hd.lc .blocklyToolboxDiv')
    check('toolbox: new categories', all(x in tb for x in ['Control','Bits & Words','Arrays & Tables','Modes & Safety','Function Blocks']) and 'My Blocks' in tb, tb)
    inbox=ev("""(()=>{const out=new Set(); const w=c=>(c.contents||[]).forEach(x=>{ if(x.kind==='block') out.add(x.type); if(x.contents) w(x); }); w(window.HYDRA.plc.blocks.toolbox()); return [...out]; })()""")
    miss=[t for t in NEW if t not in inbox]; check(f'all {len(NEW)} new block types are in the toolbox', not miss, miss)
    bad=ev("""(()=>{const B=window.HYDRA_BLOCKLY; const ws=B.getMainWorkspace(); const out=[]; const w=c=>(c.contents||[]).forEach(x=>{ if(x.kind==='block'){ try{ const b=B.serialization.blocks.append(x, ws); b.dispose(false);}catch(e){ out.push(x.type+': '+e.message) } } if(x.contents) w(x); }); w(window.HYDRA.plc.blocks.toolbox()); return out; })()""")
    check('every toolbox block creates and renders', not bad, bad)
    hum=ev(f"Object.keys({H}.plc.compile.HUMAN)"); check('every new block has a readable name', all(t in hum for t in NEW), [t for t in NEW if t not in hum])
    lab=ev("""(async()=>{const B=window.HYDRA_BLOCKLY; const ws=B.getMainWorkspace();
      const d=B.serialization.blocks.append({type:'hy_fb_def', fields:{NAME:'Gate', INS:'open, close, hold', OUTS:'q'}}, ws);
      const c=B.serialization.blocks.append({type:'hy_fb_call', fields:{FB:'Gate', INST:'G1'}}, ws); await new Promise(r=>setTimeout(r,200));
      const r=[0,1,2,3].map(i=>[c.getField('L'+i).getValue(), c.getInput('IN'+i).isVisible()]); c.dispose(false); d.dispose(false); return r; })()""")
    check('CALL shows the input names of its FUNCTION BLOCK and hides unused sockets', lab==[['open',True],['close',True],['hold',True],['in 4',False]], lab)
    # ---------- compare / select ----------
    r=js("""const rt=run(prog([hat('hy_main',[
      set('w',V(blk('hy_window',{},{V:n(103),C:n(100),TOL:n(5)}))), set('w2',V(blk('hy_window',{},{V:n(94),C:n(100),TOL:n(5)}))),
      set('db',V(blk('hy_deadband',{},{V:n(0.4),D:n(1)}))), set('db2',V(blk('hy_deadband',{},{V:n(-3),D:n(1)}))),
      set('s',V(blk('hy_sel',{},{G:tf(true),A:n(7),B:n(9)}))), set('m',V(blk('hy_mux',{},{K:n(2),IN0:n(10),IN1:n(11),IN2:n(12),IN3:n(13)})))])],{w:'BOOL',w2:'BOOL',db:'FLOAT',db2:'FLOAT',s:'FLOAT',m:'FLOAT'}),1);
      return rt.err||rt.v""")
    check('WITHIN ± / DEADBAND / SELECT / MUX', r=={'w':True,'w2':False,'db':0,'db2':-3,'s':7,'m':12}, r)
    r=js("""const vals=[150,170,185,170,165,150,170]; const out=[];
      const rt=run(prog([hat('hy_main',[set('q',V(blk('hy_hyst',{},{V:vg('pv'),ON:n(180),OFF:n(160)})))])],{pv:'FLOAT',q:'BOOL'}),vals.length,(rt,i)=>{ if(i) out.push(rt.v.q); rt.v.pv=vals[i]; }); rt.scan(); out.push(rt.v.q); return rt.err||out""")
    check('HYSTERESIS: on at 180, holds, off at 160', r==[False,False,True,True,True,False,False], r)
    r=js("const rt=run(prog([hat('hy_main',[set('m',V(blk('hy_mux',{},{K:n(5)})))])],{m:'FLOAT'}),2); return rt.err||[rt.state, rt.fault&&rt.fault.text]")
    check('MUX index out of range → fault', r[0]=='fault' and 'outside 0' in (r[1] or ''), r)
    # ---------- bits & words ----------
    r=js("""const rt=run(prog([hat('hy_main',[
      set('a',V(blk('hy_bitop',{OP:'AND'},{A:n(0xF0F0),B:n(0xFF00)}))), set('o',V(blk('hy_bitop',{OP:'OR'},{A:n(1),B:n(4)}))), set('x',V(blk('hy_bitop',{OP:'XOR'},{A:n(0xFFFF),B:n(0x00FF)}))),
      set('nt',V(blk('hy_wnot',{},{A:n(0)}))), set('rl',V(blk('hy_shift',{OP:'ROL'},{A:n(0x8001),N:n(1)}))), set('rr',V(blk('hy_shift',{OP:'ROR'},{A:n(1),N:n(1)}))),
      set('sl',V(blk('hy_shift',{OP:'SHL'},{A:n(0x8001),N:n(1)}))), set('sr',V(blk('hy_shift',{OP:'SHR'},{A:n(8),N:n(3)}))),
      set('bg',V(blk('hy_bit_get',{},{N:n(3),A:n(8)}))), set('bs',V(blk('hy_bit_set',{},{A:n(1),N:n(4),V:tf(true)}))), set('bc',V(blk('hy_bit_set',{},{A:n(255),N:n(0),V:tf(false)})))])],
      {a:'INT',o:'INT',x:'INT',nt:'INT',rl:'INT',rr:'INT',sl:'INT',sr:'INT',bg:'BOOL',bs:'INT',bc:'INT'}),1); return rt.err||rt.v""")
    check('word AND/OR/XOR, NOT, SHL/SHR/ROL/ROR, bit get/set (16-bit)', r=={'a':0xF000,'o':5,'x':0xFF00,'nt':65535,'rl':3,'rr':0x8000,'sl':2,'sr':1,'bg':True,'bs':17,'bc':254}, r)
    r=js("""const rt=run(prog([hat('hy_main',[blk('hy_shreg',{NAME:'SR',LEN:4},{IN:vg('d'),CLK:vg('c'),RESET:vg('r')}),
      set('b0',V(blk('hy_shreg_bit',{NAME:'SR'},{I:n(0)}))), set('b2',V(blk('hy_shreg_bit',{NAME:'SR'},{I:n(2)})))])],{d:'BOOL',c:'BOOL',r:'BOOL',b0:'BOOL',b2:'BOOL'}),0);
      const seqv=[[1,1],[1,0],[0,1],[0,0],[0,1],[0,0]]; seqv.forEach(([d,c])=>{ rt.v.d=!!d; rt.v.c=!!c; rt.scan(); });
      const bits=rt.sregs.SR.bits.map(x=>x?1:0).join(''); const b2=rt.v.b2; rt.v.r=true; rt.scan(); return [bits,b2,rt.sregs.SR.bits.some(x=>x)]""")
    check('SHIFT REGISTER: shifts on rising clock edges, position 0 newest, clear', r==['0010',True,False], r)
    # ---------- arrays, tables, records ----------
    r=js("""const rt=run(prog([blk('hy_array',{NAME:'A',SIZE:5,INIT:2},{},{x:0,y:0}), hat('hy_main',[blk('hy_arr_set',{NAME:'A'},{I:n(3),V:n(10)}),
      set('s',V(blk('hy_arr_stat',{OP:'SUM',NAME:'A'}))), set('av',V(blk('hy_arr_stat',{OP:'AVG',NAME:'A'}))), set('im',V(blk('hy_arr_stat',{OP:'IMAX',NAME:'A'}))), set('g',V(blk('hy_arr_get',{NAME:'A'},{I:n(3)}))),
      set('t1',V(blk('hy_table',{XS:'0, 50, 100',YS:'0, 120, 250'},{X:n(25)}))), set('t2',V(blk('hy_table',{XS:'0, 50, 100',YS:'0, 120, 250'},{X:n(75)}))), set('t3',V(blk('hy_table',{XS:'0, 50, 100',YS:'0, 120, 250'},{X:n(300)}))),
      blk('hy_rec_set',{REC:'Part',FIELD:'w'},{V:n(4.5)}), set('rg',V(blk('hy_rec_get',{REC:'Part',FIELD:'w'}))), set('rn',V(blk('hy_rec_get',{REC:'Part',FIELD:'none'})))],{y:100})],
      {s:'FLOAT',av:'FLOAT',im:'INT',g:'FLOAT',t1:'FLOAT',t2:'FLOAT',t3:'FLOAT',rg:'FLOAT',rn:'FLOAT'}),1); return rt.err||rt.v""")
    check('ARRAY set/get/SUM/AVG/index of MAX, TABLE interpolation + clamp, records', r=={'s':18,'av':3.6,'im':3,'g':10,'t1':60,'t2':185,'t3':250,'rg':4.5,'rn':0}, r)
    r=js("const rt=run(prog([blk('hy_array',{NAME:'A',SIZE:3,INIT:0},{},{x:0,y:0}),hat('hy_main',[set('g',V(blk('hy_arr_get',{NAME:'A'},{I:n(4)})))],{y:100})],{g:'FLOAT'}),2); return rt.err||[rt.state,rt.fault&&rt.fault.text]")
    check('array index outside 1 … size → fault', r[0]=='fault' and 'outside 1' in r[1], r)
    r=js("const c=comp(prog([hat('hy_main',[set('g',V(blk('hy_arr_get',{NAME:'Nope'},{I:n(1)}))), set('t',V(blk('hy_table',{XS:'0, 10',YS:'1'},{X:n(1)}))), set('k',V(blk('hy_rtc_between',{FROM:'25:00',TO:'06:00'})))])],{g:'FLOAT',t:'FLOAT',k:'BOOL'})); return issues(c)")
    check('rule check: unknown array, bad TABLE, bad time of day', len(r)==3 and 'Array Nope' in r[0] and 'TABLE' in r[1] and 'hh:mm' in r[2], r)
    # ---------- control ----------
    r=js("""let pv=20; const tr=[]; const rt=run(prog([hat('hy_main',[blk('hy_pid',{NAME:'PC',DIR:'D'},{PV:vg('pv'),SP:n(50),KP:n(2),TI:n(1),TD:n(0),LO:n(0),HI:n(100),EN:tf(true)}), set('u',V(blk('hy_pid_out',{NAME:'PC'})))])],{pv:'FLOAT',u:'FLOAT'}),1500,(rt,i)=>{ if(i){ pv+=(rt.v.u-pv)*0.01/0.5; } rt.v.pv=pv; tr.push(rt.v.u); });
      return rt.err||[+pv.toFixed(2), Math.max(...tr), Math.min(...tr)]""")
    check('PID (PI) drives a first-order plant to the set point, output within limits', abs(r[0]-50)<0.5 and r[1]<=100 and r[2]>=0, r)
    r=js("""const rt=run(prog([hat('hy_main',[blk('hy_pid',{NAME:'PC',DIR:'D'},{PV:n(0),SP:n(50),KP:n(1),TI:n(1),LO:n(0),HI:n(100),EN:vg('en')}), set('u',V(blk('hy_pid_out',{NAME:'PC'})))])],{en:'BOOL',u:'FLOAT'}),500,(rt)=>{rt.v.en=true;});
      const sat=rt.pids.PC.i; rt.v.en=false; rt.scan(); return [+sat.toFixed(2), rt.pids.PC.out, rt.pids.PC.i]""")
    check('PID anti-windup (integral held at the limit) and disable → low limit, integral reset', r[0]<=100 and r[1]==0 and r[2]==0, r)
    r=js("""const rt=run(prog([hat('hy_main',[set('r',V(blk('hy_ramp',{},{V:vg('tg'),R:n(10)}))), set('f',V(blk('hy_filter',{},{V:vg('tg'),T:n(1)}))), set('a',V(blk('hy_avg',{N:4},{V:vg('tg')})))])],{tg:'FLOAT',r:'FLOAT',f:'FLOAT',a:'FLOAT'}),101,(rt,i)=>{ rt.v.tg = i===0?0:100; });
      return [+rt.v.r.toFixed(3), +rt.v.f.toFixed(1), rt.v.a]""")
    check('RAMP 10/s (≈10 after 1 s), FILTER T=1 s (≈63 %), MOVING AVERAGE', abs(r[0]-10)<0.2 and 60<r[1]<66 and r[2]==100, r)
    r=js("""const o=[]; const rt=run(prog([hat('hy_main',[set('k',V(blk('hy_blink',{},{ON:n(0.5),OFF:n(0.5)}))), set('h',V(blk('hy_rtc',{WHAT:'H'}))), set('y',V(blk('hy_rtc',{WHAT:'Y'}))), set('wd',V(blk('hy_rtc',{WHAT:'WD'}))), set('all',V(blk('hy_rtc_between',{FROM:'00:00',TO:'24:00'})))])],{k:'BOOL',h:'INT',y:'INT',wd:'INT',all:'BOOL'}),100,(rt,i)=>{ if(i===20||i===70) o.push(rt.v.k); });
      const d=new Date(); return [o, rt.v.h===d.getHours()||rt.v.h===(d.getHours()+23)%24, rt.v.y===d.getFullYear(), rt.v.wd>=1&&rt.v.wd<=7, rt.v.all]""")
    check('BLINK, real-time clock (hour, year, weekday), time-of-day window', r==[[True,False],True,True,True,True], r)
    # ---------- function blocks ----------
    FB="""const def=()=>({type:'hy_fb_def',x:400,y:0,fields:{NAME:'Hold',INS:'s, r',OUTS:'q, late'},inputs:{STACK:sub([
        blk('controls_if',{},{IF0:V(blk('hy_fb_in',{NAME:'s'})),DO0:sub([blk('hy_fb_out',{NAME:'q'},{V:tf(true)})])}),
        blk('controls_if',{},{IF0:V(blk('hy_fb_in',{NAME:'r'})),DO0:sub([blk('hy_fb_out',{NAME:'q'},{V:tf(false)})])}),
        blk('hy_fb_out',{NAME:'late'},{V:V(blk('hy_for',{},{IN:V(blk('hy_fb_in',{NAME:'s'})),PT:n(0.1)}))})])}});"""
    r=js(FB+"""const rt=run(prog([def(),hat('hy_main',[blk('hy_fb_call',{FB:'Hold',INST:'A'},{IN0:vg('sa'),IN1:tf(false)}), blk('hy_fb_call',{FB:'Hold',INST:'B'},{IN0:vg('sb'),IN1:vg('rb')}),
      set('qa',V(blk('hy_fb_get',{OUT:'A/q'}))), set('la',V(blk('hy_fb_get',{OUT:'A/late'}))), set('lb',V(blk('hy_fb_get',{OUT:'B/late'})))])],{sa:'BOOL',sb:'BOOL',rb:'BOOL',qa:'BOOL',la:'BOOL',lb:'BOOL'}),30,(rt,i)=>{ rt.v.sa=true; rt.v.sb=i<3; rt.v.rb=i>=5; });
      return rt.err||[rt.v.qa, rt.v.la, rt.v.lb, rt.fbo.A.q, rt.fbo.B.q, Object.keys(rt.mem).length>=0]""")
    check('FUNCTION BLOCK: two instances, own outputs and own timer memory', r==[True,True,False,True,False,True], r)
    r=js(FB+"""const bad={type:'hy_fb_def',x:400,y:300,fields:{NAME:'Bad',INS:'a',OUTS:'y'},inputs:{STACK:sub([blk('hy_wait',{STALL:0},{COND:tf(true)}), blk('hy_fb_out',{NAME:'zz'},{V:n(1)}), blk('hy_fb_out',{NAME:'y'},{V:V(blk('hy_fb_in',{NAME:'nope'}))})])}};
      const c=comp(prog([def(),bad,hat('hy_main',[blk('hy_fb_call',{FB:'Missing',INST:'X'}), blk('hy_fb_out',{NAME:'q'},{V:n(1)})])])); return issues(c)""")
    check('rule check: WAIT inside FB, unknown output/input, missing FB, output outside FB', len(r)==5 and 'not allowed inside a FUNCTION BLOCK' in r[0] and 'no output zz' in r[1] and 'no input nope' in r[2] and 'Missing does not exist' in r[3] and 'inside a FUNCTION BLOCK' in r[4], r)
    # ---------- sequences: END, parallel branches, hold ----------
    PAR="""const cv=c=>V(blk('logic_compare',{OP:'GTE'},{A:V(blk('hy_step_time')),B:n(c)}));
      const main=seq('M',[step('S0','idle','next',[],vg('go')),
        step('S1','branches','next',[blk('hy_par',{NAME:'P'},{B1:sub([seq('BA',[step('A1','','next',[],cv(0.1)),step('A2','','END',[],cv(0.1))])]), B2:sub([seq('BB',[step('B1','','END',[],cv(0.5))])])})], V(blk('hy_par_done',{NAME:'P'}))),
        step('S2','count','S0',[blk('hy_var_change',{VAR:'n'},{D:n(1)})],tf(true))]);
      const p=prog([hat('hy_main',[main, blk('hy_seq_hold',{SEQ:'M'},{COND:vg('hold')}), set('ba',V(blk('hy_seq_done',{SEQ:'BA'})))])],{go:'BOOL',n:'INT',hold:'BOOL',ba:'BOOL'});"""
    r=js(PAR+"""const log=[]; let last=''; const rt=run(p,200,(rt,i)=>{ rt.v.go=i<120; const c=rt.seqs.M&&rt.seqs.M.cur; if(c && c!==last){ log.push(c+'@'+rt.t.toFixed(2)); last=c; } }); return rt.err||[rt.v.n, log.slice(0,4), rt.c.seqs.map(s=>s.name+':'+s.steps.map(x=>x.id+'>'+x.next).join(' '))]""")
    check('PARALLEL: both branches run, sync waits for the slower one (≈0.5 s), branches restart every cycle', r[0]>=2 and r[1][0].startswith('S1') and r[1][1].startswith('S2') and r[1][2].startswith('S0') and r[1][3].startswith('S1') and 0.5<=float(r[1][1].split('@')[1])-float(r[1][0].split('@')[1])<=0.6, r)
    check('END shown as next step; nested sequences compiled', any('A2>END' in s for s in r[2]) and any(s.startswith('BB:') for s in r[2]), r[2])
    r=js(PAR+"""const rt=run(p,100,(rt,i)=>{ rt.v.go=true; rt.v.hold=i>=1; }); return rt.err||[rt.seqs.M.cur, rt.v.n]""")
    check('HOLD SEQUENCE freezes the sequence on its step', r==['S1',0] or r==['S0',0], r)
    # ---------- handshakes and WAIT with timeout ----------
    sig=lambda tag: ev(f"window.HYDRA.plc.signals.signals(window.HYDRA.S.project.value).sigs.find(s=>s.tag==='{tag}').id")
    Q,I=sig('1Y1'),sig('1S1')
    r=js(f"""const p=prog([hat('hy_main',[blk('hy_handshake',{{REQ:'{Q}',ACK:'{I}'}},{{S:n(1),DO:sub([set('to',tf(true))])}}), blk('hy_var_change',{{VAR:'k'}},{{D:n(1)}}), blk('hy_wait',{{STALL:0}},{{COND:tf(false)}})])],{{to:'BOOL',k:'INT'}});
      const rt=run(p,2); const a=[rt.out['{Q}'], rt.v.k]; rt.sim['{I}']=true; rt.scan(); rt.scan(); const b=[rt.out['{Q}'], rt.v.k]; rt.sim['{I}']=false; rt.scan(); rt.scan(); return rt.err||[a,b,[rt.out['{Q}'], rt.v.k, rt.v.to]]""")
    check('HANDSHAKE: request ON → ack → request OFF → ack OFF → continue', r==[[True,0],[False,0],[False,1,False]], r)
    r=js(f"""const p=prog([hat('hy_main',[blk('hy_handshake',{{REQ:'{Q}',ACK:'{I}'}},{{S:n(0.3),DO:sub([set('to',tf(true))])}}), blk('hy_wait',{{STALL:0}},{{COND:tf(false)}})])],{{to:'BOOL'}});
      const rt=run(p,50); return rt.err||[rt.v.to, rt.out['{Q}'], rt.alarms.filter(a=>a.active).map(a=>a.code)]""")
    check('HANDSHAKE timeout: alarm W-HS:1Y1, request dropped, on-timeout runs', r[0]==True and r[1]==False and 'W-HS:1Y1' in r[2], r)
    r=js("""const rt=run(prog([hat('hy_main',[blk('hy_wait_to',{},{COND:vg('c'),S:n(0.2),DO:sub([set('to',tf(true))])}), set('done',tf(true)), blk('hy_wait',{STALL:0},{COND:tf(false)})])],{c:'BOOL',to:'BOOL',done:'BOOL'}),10); const a=[rt.v.to,rt.v.done]; for(let i=0;i<20;i++) rt.scan(); return [a,[rt.v.to,rt.v.done]]""")
    check('WAIT UNTIL … at most: waits, then runs on-timeout and continues', r==[[False,False],[True,True]], r)
    # ---------- modes, alarm groups ----------
    r=js("""const rt=run(prog([hat('hy_main',[blk('hy_mode_sel',{},{AUTO:vg('a'),MANUAL:vg('m')}), set('ia',V(blk('hy_mode_is',{MODE:'AUTO'}))), blk('controls_if',{},{IF0:vg('h'),DO0:sub([blk('hy_mode_set',{MODE:'HOMING'})])})])],{a:'BOOL',m:'BOOL',h:'BOOL',ia:'BOOL'}),1);
      const o=[rt.mode]; rt.v.a=true; rt.scan(); rt.scan(); o.push(rt.mode, rt.v.ia); rt.v.a=false; rt.scan(); o.push(rt.mode); rt.v.m=true; rt.scan(); o.push(rt.mode); rt.v.m=false; rt.v.h=true; rt.scan(); o.push(rt.mode, rt.valueOf('mode')); return o""")
    check('MODE SELECTOR / SET MODE / mode is (selector keeps mode when released)', r==['OFF','AUTO',True,'AUTO','MANUAL','HOMING','HOMING'], r)
    r=js("""const rt=run(prog([hat('hy_main',[blk('hy_alarm',{CODE:'F-201',SEV:'F',TEXT:'oil hot'},{COND:vg('x')}), blk('hy_alarm',{CODE:'W-301',SEV:'W',TEXT:'filter'},{COND:vg('y')}),
      set('f',V(blk('hy_alarm_group',{WHAT:'FAULT',PFX:''}))), set('u',V(blk('hy_alarm_group',{WHAT:'UNACK',PFX:'W-3'}))), set('c',V(blk('hy_alarm_count',{PFX:''}))), blk('controls_if',{},{IF0:vg('ack'),DO0:sub([blk('hy_alarm_ack',{PFX:'W-'})])})])],
      {x:'BOOL',y:'BOOL',ack:'BOOL',f:'BOOL',u:'BOOL',c:'INT'}),1); rt.v.y=true; rt.scan(); rt.scan(); const a=[rt.v.f,rt.v.u,rt.v.c]; rt.v.x=true; rt.v.ack=true; rt.scan(); rt.scan(); return [a,[rt.v.f,rt.v.u,rt.v.c]]""")
    check('alarm groups: fault active, unacknowledged by prefix, count, acknowledge by prefix', r==[[False,True,1],[True,False,2]], r)
    # ---------- safety ----------
    r=js("""const p=prog([hat('hy_main',[set('q',V(blk('hy_twohand',{WIN:0.5},{A:vg('a'),B:vg('b')})))])],{a:'BOOL',b:'BOOL',q:'BOOL'}); const o=[];
      let rt=run(p,0); rt.v.a=true; rt.v.b=true; rt.scan(); rt.scan(); o.push(rt.v.q);           // held at start: not armed
      rt.v.a=false; rt.v.b=false; rt.scan(); rt.v.a=true; rt.scan(); rt.v.b=true; rt.scan(); rt.scan(); o.push(rt.v.q); // both within 0.5 s
      rt.v.b=false; rt.scan(); rt.v.b=true; rt.scan(); rt.scan(); o.push(rt.v.q);               // release one hand: no restart
      rt.v.a=false; rt.v.b=false; rt.scan(); rt.v.a=true; for(let i=0;i<80;i++) rt.scan(); rt.v.b=true; rt.scan(); rt.scan(); o.push(rt.v.q); // 0.8 s apart
      return o""")
    check('TWO-HAND: not armed at start, both within 0.5 s, no restart with one hand, too slow refused', r==[False,True,False,False], r)
    r=js("""const p=prog([hat('hy_main',[set('q',V(blk('hy_dualch',{D:0.2},{A:vg('a'),B:vg('b')})))])],{a:'BOOL',b:'BOOL',q:'BOOL'}); const o=[];
      const rt=run(p,0); rt.v.a=true; rt.v.b=true; rt.scan(); rt.scan(); o.push(rt.v.q); rt.v.b=false; for(let i=0;i<30;i++) rt.scan(); rt.v.b=true; rt.scan(); rt.scan(); o.push(rt.v.q, rt.alarms.some(a=>a.active&&a.code==='F-DC1'));
      rt.v.a=false; rt.v.b=false; rt.scan(); rt.v.a=true; rt.v.b=true; rt.scan(); rt.scan(); o.push(rt.v.q, rt.alarms.some(a=>a.active&&a.code==='F-DC1')); return o""")
    check('DUAL CHANNEL: OK, discrepancy > 0.2 s locks out (F-DC1) until both off', r==[True,False,True,True,False], r)
    r=js("""const rt=run(prog([hat('hy_main',[set('e',V(blk('hy_watchdog',{},{V:vg('hb'),T:n(0.3)})))])],{hb:'INT',e:'BOOL'}),100,(rt,i)=>{ rt.v.hb=Math.floor(i/10); }); const a=rt.v.e; for(let i=0;i<40;i++) rt.scan(); return [a, rt.v.e]""")
    check('WATCHDOG: changing value OK, stuck for 0.3 s → expired', r==[False,True], r)
    # ---------- the editor still works with a program using the new blocks ----------
    pid=ev(f"{H}.S.addNode('program', null, undefined, 'T8d_par')")
    ok=js(PAR+f"""window.HYDRA.plc.state.writeProg('{pid}', x=>{{ x.ws=p.ws; x.vars=p.vars; x.sheet='none'; }}); return true""")
    ev(f"{H}.S.openSheetTab('{pid}')"); pg.wait_for_timeout(2000)
    c=ev(f"(()=>{{const c=window.HYDRA.plc.state.compileProg({H}.S.project.value,'{pid}'); return [c.ok, c.issues.filter(i=>i.level==='err').map(i=>i.text)]}})()")
    check('program with PARALLEL / END / HOLD loads in the editor and compiles', c[0], c)
    pg.click('.lcrun'); pg.wait_for_timeout(400); pg.click('.lcdock button:has-text("Watch")'); pg.wait_for_timeout(300)
    w=pg.inner_text('.lcdock'); check('Watch lists the sequences', 'M' in w and 'S0' in w, w[:200])
    pg.click('.hd.lc button:has-text("Stop")'); pg.wait_for_timeout(200)
    check('no page errors', not errs, errs)
    b.close()
for r in R: print(r[0], r[1], r[2] if r[0]=='FAIL' else '')
print(f"{sum(1 for r in R if r[0]=='PASS')} / {len(R)}")
