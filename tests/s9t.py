# Themes: Stitch stays pixel-identical (optional reference build in HYDRA_REF), four presets, custom themes
# (customise / save / export / import / delete), paper option, operator panel colours frozen, persistence.
import os, json
from playwright.sync_api import sync_playwright
S=os.environ.get('HYDRA_ROOT', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')))
REF=os.environ.get('HYDRA_REF', '')
R=[]
def check(n,c,x=''): R.append(('PASS' if c else 'FAIL',n,str(x)[:300]))
SHOTS=os.environ.get('HYDRA_SHOTS', '')
def scenes(pg, path):
    ev=pg.evaluate; out=[]
    pg.goto('file://'+path+'/HYDRA.html'); pg.wait_for_timeout(2500); out.append(pg.screenshot())
    ev("window.HYDRA.actions.openSampleCopy('s_sequence')"); pg.wait_for_timeout(3600); out.append(pg.screenshot())  # after the toast has gone
    return out
with sync_playwright() as p:
    b=p.chromium.launch()
    if REF:
        ctx=b.new_context(viewport={'width':1600,'height':960}); a=scenes(ctx.new_page(), REF); ctx.close()
        ctx=b.new_context(viewport={'width':1600,'height':960}); c=scenes(ctx.new_page(), S+'/dist/HYDRA'); ctx.close()
        import base64
        cmp=b.new_page(); DIFF="""async ([a,c])=>{ const ld=s=>new Promise(r=>{const i=new Image(); i.onload=()=>r(i); i.src='data:image/png;base64,'+s;});
          const A=await ld(a), C=await ld(c); if(A.width!==C.width||A.height!==C.height) return -1; const cv=document.createElement('canvas'); cv.width=A.width; cv.height=A.height; const x=cv.getContext('2d');
          x.drawImage(A,0,0); const da=x.getImageData(0,0,cv.width,cv.height).data; x.clearRect(0,0,cv.width,cv.height); x.drawImage(C,0,0); const dc=x.getImageData(0,0,cv.width,cv.height).data;
          let n=0; for(let k=0;k<da.length;k++) if(da[k]!==dc[k]) n++; return n; }"""
        diffs=[cmp.evaluate(DIFF, [base64.b64encode(x).decode(), base64.b64encode(y).decode()]) for x,y in zip(a,c)]; cmp.close()
        check('Stitch (default) is pixel-identical to the build before themes (Home + sheet)', diffs==[0,0], diffs)
    ctx=b.new_context(viewport={'width':1600,'height':960}); pg=ctx.new_page()
    errs=[]; pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
    pg.goto('file://'+S+'/dist/HYDRA/HYDRA.html'); pg.wait_for_timeout(2500); ev=pg.evaluate; H='window.HYDRA'
    css=lambda k: ev(f"getComputedStyle(document.documentElement).getPropertyValue('{k}').trim()")
    check('default: Stitch tokens, no overrides on <html>', css('--panel').lower() in ('#fff','#ffffff') and ev("document.documentElement.getAttribute('style')||''").find('--panel')<0)
    ev(f"{H}.S.openModal('settings',{{tab:'appearance'}})"); pg.wait_for_timeout(500)
    cards=ev("[...document.querySelectorAll('.themecard b')].map(x=>x.textContent)")
    check('Appearance lists Stitch + 4 presets', cards[:5]==['Stitch (default)','Light Grey','Graphite Dark','Blueprint','High Contrast'], cards)
    pg.click('.themecard:has-text("Graphite Dark")'); pg.wait_for_timeout(300)
    check('preview applies while choosing', css('--panel').upper()=='#1C232C')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    check('closing without Apply restores Stitch', css('--panel').lower() in ('#fff','#ffffff'), css('--panel'))
    for name,tok in [('Light Grey','#F8F9FA'),('Graphite Dark','#1C232C'),('Blueprint','#F7FAFE')]:
        ev(f"{H}.S.openModal('settings',{{tab:'appearance'}})"); pg.wait_for_timeout(300); pg.click(f'.themecard:has-text("{name}")'); pg.click('.modal footer button.primary'); pg.wait_for_timeout(300)
        check(f'{name} applied', css('--panel').upper()==tok, css('--panel'))
        if SHOTS:
            ev(f"{H}.actions.openSampleCopy('s_basic_cyl')"); pg.wait_for_timeout(1200); pg.screenshot(path=f"{SHOTS}/theme_{name.replace(' ','_').lower()}.png"); ev(f"{H}.Pj.closeAll()"); pg.wait_for_timeout(400)
    ev(f"{H}.S.openModal('settings',{{tab:'appearance'}})"); pg.wait_for_timeout(300); pg.click('.themecard:has-text("High Contrast")'); pg.click('.modal footer button.primary'); pg.wait_for_timeout(300)
    check('High Contrast uses the contrast token set', ev("document.documentElement.dataset.theme")=='contrast' and css('--ink').lower()=='#000')
    # dark theme + operator panel: frozen colours
    ev(f"{H}.S.openModal('settings',{{tab:'appearance'}})"); pg.wait_for_timeout(300); pg.click('.themecard:has-text("Graphite Dark")'); pg.click('.modal footer button.primary'); pg.wait_for_timeout(300)
    ev(f"{H}.machines.openMachine('m01_press')"); pg.wait_for_timeout(1500)
    pid=ev(f"Object.values({H}.S.project.value.nodes).find(n=>n.type==='program').id"); ev(f"{H}.plc.panel.openPanelTab('{pid}')"); pg.wait_for_timeout(1500)
    op=ev("(()=>{const e=document.querySelector('.op-ph'); return e&&getComputedStyle(e).backgroundColor})()")
    check('operator panel keeps its frozen colours in a dark theme', op=='rgb(30, 41, 54)', op)
    if SHOTS: pg.screenshot(path=f"{SHOTS}/theme_dark_panel.png")
    ev(f"{H}.Pj.closeAll()"); pg.wait_for_timeout(300)
    # custom theme
    ev(f"{H}.S.openModal('settings',{{tab:'appearance'}})"); pg.wait_for_timeout(300); pg.click('.themecard:has-text("Stitch")'); pg.click('button:has-text("Customise…")'); pg.wait_for_timeout(300)
    check('Customise opens the colour editor with 11 colours', pg.locator('.tcol').count()==11)
    pg.fill('.themeed input.in', 'Workshop'); ev("(()=>{const i=[...document.querySelectorAll('.tcol')].find(x=>x.textContent.includes('Accent / buttons')).querySelector('input'); i.value='#b5541c'; i.dispatchEvent(new Event('input',{bubbles:true}))})()"); pg.wait_for_timeout(200)
    check('editing previews live', css('--acc').upper()=='#B5541C', css('--acc'))
    pg.click('button:has-text("Save as theme")'); pg.wait_for_timeout(300); pg.click('.modal footer button.primary'); pg.wait_for_timeout(300)
    check('saved custom theme is applied and listed', css('--acc').upper()=='#B5541C' and any(t['name']=='Workshop' for t in json.loads(ev("localStorage.getItem('hydra.themes.v1')"))))
    pg.reload(); pg.wait_for_timeout(2500)
    check('theme persists after reload', css('--acc').upper()=='#B5541C')
    exp=ev(f"(()=>{{const T={H}.theme; return T.exportTheme(T.themeById({H}.S.settings.value.themeId))}})()"); imp=ev(f"(t=>{H}.theme.importTheme(t))", exp)
    check('export / import round trip', json.loads(exp)['format']=='hydra.theme' and imp['vars']['--acc'].upper()=='#B5541C')
    bad=ev(f"(()=>{{try{{ {H}.theme.importTheme(JSON.stringify({{format:'hydra.theme',vars:{{'--acc':'red;background:url(x)'}}}})); return 'ok' }}catch(e){{return 'err'}}}})()")
    check('import keeps only colour values', bad=='ok' and ev(f"Object.keys({H}.theme.importTheme(JSON.stringify({{format:'hydra.theme',vars:{{'--acc':'red;x','--bg':'#123456'}}}})).vars).join()")=='--bg')
    # paper
    ev(f"{H}.S.saveSettings({{...{H}.S.settings.value, themeId:'blueprint', paperFollow:false}})"); pg.wait_for_timeout(200)
    ev(f"{H}.actions.openSampleCopy('s_basic_cyl')"); pg.wait_for_timeout(1200)
    paper=lambda: ev("(()=>{const r=document.querySelector('.dcanvas svg rect[filter=\"url(#dshadow)\"]'); return r&&getComputedStyle(r).fill})()")
    w=paper(); ev(f"{H}.S.saveSettings({{...{H}.S.settings.value, paperFollow:true}})"); pg.wait_for_timeout(200); f=paper()
    check('paper white by default, follows the theme when chosen', w=='rgb(255, 255, 255)' and f=='rgb(238, 244, 251)', (w,f))
    ev(f"{H}.S.saveSettings({{...{H}.S.settings.value, themeId:'stitch', paperFollow:true}})"); pg.wait_for_timeout(200)
    check('Stitch: paper stays white even with the option on', paper()=='rgb(255, 255, 255)')
    # delete
    ev(f"{H}.S.openModal('settings',{{tab:'appearance'}})"); pg.wait_for_timeout(300); pg.click('.themecard:has-text("Workshop") .tdel'); pg.wait_for_timeout(200)
    check('custom theme can be deleted', 'Workshop' not in pg.inner_text('.themegrid'))
    check('no page errors', not errs, errs)
    b.close()
for r in R: print(r[0], r[1], r[2] if r[0]=='FAIL' else '')
print(f"{sum(1 for r in R if r[0]=='PASS')} / {len(R)}")
