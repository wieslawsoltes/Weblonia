"""Actual Chromium mouse/keyboard/wheel/capture tests of the built Skia application.
Uses local asset interception, not direct calls to Pointer event handlers.
"""
from pathlib import Path
from urllib.parse import unquote, urlparse
from playwright.sync_api import sync_playwright
from datetime import datetime, timezone
from verification_support import source_fingerprint
import argparse, json, mimetypes, os, time
parser=argparse.ArgumentParser();parser.add_argument('--scale',type=float,default=1);args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;out=root/'artifacts';out.mkdir(exist_ok=True)
path=out/f'scrollbar-browser-{args.scale:g}.json'
report={'version':json.loads((root/'package.json').read_text())['version'],'deviceScale':args.scale,'mode':'local-asset-interception','hardwareQualified':False,'completed':False,'startedAt':datetime.now(timezone.utc).isoformat(),'tests':[],'pageErrors':[],'missingAssets':[]}
report['sourceFingerprint']=source_fingerprint(root)
def save():
    report['passed']=sum(t['passed'] for t in report['tests']);report['failed']=len(report['tests'])-report['passed'];path.write_text(json.dumps(report,indent=2)+'\n')
def require(v,m='Assertion failed'):
    if not v:raise AssertionError(m)
def near(a,b,tol=.02):require(abs(a-b)<tol,f'{a} != {b}')
def check(name,action):
    save();start=time.monotonic()
    try:
        action();report['tests'].append({'name':name,'passed':True,'milliseconds':round((time.monotonic()-start)*1000,1)});print('PASS',name,flush=True)
    except Exception as e:
        report['tests'].append({'name':name,'passed':False,'error':str(e)});print('FAIL',name,str(e),flush=True)
    save()
with sync_playwright() as pw:
    launch={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
    executable=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium')
    if Path(executable).is_file():launch['executable_path']=executable
    browser=pw.chromium.launch(**launch)
    report['browser']=browser.version
    context=browser.new_context(viewport={'width':1120,'height':820},device_scale_factor=args.scale)
    def route(r):
        name=unquote(urlparse(r.request.url).path).lstrip('/')
        p=(root/name if name.startswith('tests/') else root/'dist'/name).resolve()
        if not p.is_relative_to(root) or not p.is_file():report['missingAssets'].append(name);r.fulfill(status=404,body='Missing');return
        mime='application/wasm' if p.suffix=='.wasm' else 'text/javascript' if p.suffix in ('.js','.mjs') else mimetypes.guess_type(str(p))[0] or 'application/octet-stream'
        r.fulfill(body=p.read_bytes(),headers={'Content-Type':mime,'Access-Control-Allow-Origin':'*'})
    context.route('http://localhost:4173/**',route);page=context.new_page()
    page.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
    html=(root/'dist/index.html').read_text().replace('<head>','<head><script>globalThis.AVALONIA_THREADING="single";</script><base href="http://localhost:4173/">')
    page.set_content(html);page.wait_for_function('window.catalogReady || window.catalogError',timeout=60000)
    require(page.evaluate('!!window.catalogReady'),page.evaluate('window.catalogError || "startup"'))
    report['backend']=page.evaluate('window.catalog.Root.Renderer.Backend')
    page.evaluate("async()=>Object.assign(window,await import('./tests/scrollbars.fixture.js'))")
    def mount(kind,options=None):
        page.evaluate('([k,o])=>MountScrollFixture(k,o)',[kind,options or {}]);page.wait_for_timeout(90)
    def geometry(o='Vertical'):return page.evaluate('o=>ScrollGeometry(o)',o)
    def send_wheel(x,y):
        # CDP scales injected wheel values on some device-scale configurations.
        # Assert against the actual browser-delivered CSS delta, not the injector.
        page.evaluate("""()=>{window.__observedWheel=null;catalog.Root._canvas.addEventListener('wheel',e=>{const mode=e.deltaMode;window.__observedWheel={mode,x:e.deltaX,y:e.deltaY};},{capture:true,once:true});}""")
        page.mouse.wheel(x,y);page.wait_for_function('window.__observedWheel!==null');page.wait_for_timeout(80)
        delivered=page.evaluate('window.__observedWheel');require(delivered['mode']==0,str(delivered))
        report.setdefault('wheelEvidence',[]).append({'requested':[x,y],'deliveredCss':delivered})
        return delivered

    def state():
        result=page.evaluate('ScrollState()');require(not result['error'],result['error']);return result
    def drag(o,delta,release=True):
        g=geometry(o);require(g['visible'] and g['travel']>0,str(g));page.mouse.move(g['x'],g['y']);page.mouse.down()
        page.mouse.move(g['x']+(delta if o=='Horizontal' else 0),g['y']+(delta if o=='Vertical' else 0),steps=8)
        if release:page.mouse.up()
        page.wait_for_timeout(90)
    for kind in ['ScrollViewer','ListBox','TreeView','TableView','TextBox']:
        def vertical(k=kind):
            mount(k);g=geometry();drag('Vertical',g['travel']*.6);s=state()
            require(s['y']>g['maximum']*.5,str(s));require(not s['dragging']);require(s['clicks']==0);require(s['selected'] in (None,-1))
            if k=='TextBox':require(s['textUnchanged']);require((s['selectedStart'],s['selectedEnd'],s['caret'])==(1,4,4))
            if k in ('ListBox','TreeView','TableView'):require(len(s['realized'])<30,str(s['realized']))
        check(kind+' thumb receives actual mouse drag without selecting or clicking content',vertical)
    for kind in ['ScrollViewer','ListBox','TableView','TextBox']:
        def horizontal(k=kind):
            mount(k);g=geometry('Horizontal');drag('Horizontal',g['travel']*.55);s=state();require(s['x']>g['maximum']*.45,str(s))
            if k=='TableView':near(s['headerX'],round(-s['x']*args.scale)/args.scale)
            if k=='TextBox':require(s['textUnchanged'])
        check(kind+' horizontal thumb pans content and retains header/editor state',horizontal)
    def outside():
        mount('ScrollViewer');g=geometry();page.mouse.move(g['x'],g['y']);page.mouse.down();page.mouse.move(g['x']+200,700,steps=10);page.mouse.up();page.wait_for_timeout(70)
        near(state()['y'],g['maximum']);require(not state()['dragging'])
    check('capture continues outside viewport and releases at the maximum',outside)
    def paging():
        mount('ScrollViewer');g=geometry();page.mouse.click(g['trackX'],80+220);page.wait_for_timeout(70)
        near(state()['y'],264);require(state()['clicks']==0)
    check('track click advances one viewport instead of teleporting the thumb',paging)
    def deferred():
        mount('ScrollViewer');page.evaluate('scrollFixture.Control.IsDeferredScrollingEnabled=true');g=geometry();drag('Vertical',70,False)
        near(state()['y'],0);require(geometry()['value']>100);page.mouse.up();page.wait_for_timeout(80);require(state()['y']>100)
    check('deferred drag previews only the thumb and commits on release',deferred)
    def wheel():
        mount('ScrollViewer');page.mouse.move(150,150);d=send_wheel(0,83);near(state()['y'],d['y'])
        page.keyboard.down('Shift');d=send_wheel(0,61);page.keyboard.up('Shift');near(state()['x'],d['x'] or d['y'])
    check('DOM wheel pixels and Shift-wheel horizontal scrolling retain exact deltas',wheel)
    def track_wheel():
        mount('ScrollViewer');g=geometry();page.mouse.move(g['trackX'],g['trackY']);d=send_wheel(0,71);near(state()['y'],d['y'])
        g=geometry('Horizontal');page.mouse.move(g['trackX'],g['trackY']);d=send_wheel(0,51);near(state()['x'],d['x'] or d['y'])
    check('wheel over either scrollbar uses the same pixel units as its content',track_wheel)
    def keyboard():
        mount('ScrollViewer');g=geometry();page.mouse.click(g['x'],g['y']);page.keyboard.press('PageDown');page.wait_for_timeout(80);near(state()['y'],264)
        page.keyboard.press('Home');page.wait_for_timeout(70);near(state()['y'],0)
        g=geometry();node=page.locator(f'#avalonia-peer-{g["id"]}');node.focus();page.keyboard.press('End');page.wait_for_timeout(70);near(state()['y'],g['maximum'])
        require(node.get_attribute('aria-controls')==page.evaluate('`avalonia-peer-${scrollFixture.Control.VisualId}`'))
    check('mouse scrollbar focus and accessibility range keyboard commands scroll the host',keyboard)
    def hidden():
        mount('ScrollViewer');page.evaluate("scrollFixture.Control.VerticalScrollBarVisibility='Hidden'");page.wait_for_timeout(50);require(not geometry()['visible'])
        page.mouse.move(150,150);d=send_wheel(0,80);near(state()['y'],d['y'])
        page.evaluate("scrollFixture.Control.VerticalScrollBarVisibility='Disabled'");page.wait_for_timeout(70);near(state()['y'],0);page.mouse.wheel(0,90);page.wait_for_timeout(70);near(state()['y'],0)
    check('Hidden still scrolls while Disabled rejects wheel input and clears offset',hidden)
    def resize():
        mount('TextBox');drag('Vertical',180);page.evaluate("scrollFixture.Control.Text='short'");page.wait_for_timeout(100);near(state()['x'],0);near(state()['y'],0);require(not geometry()['visible'])
    check('editor content shrink clamps offsets and removes obsolete tracks',resize)
    def disabled():
        mount('ScrollViewer');g=geometry();drag('Vertical',50,False);page.evaluate('scrollFixture.Control.IsEnabled=false');page.wait_for_timeout(60);before=state()['y']
        page.mouse.move(g['x'],g['y']+180);page.mouse.up();page.wait_for_timeout(70);near(state()['y'],before);require(not state()['dragging'])
    check('disabling the scroll host during drag releases capture safely',disabled)
    def overlay():
        mount('ScrollViewer',{'overlay':True});g=geometry();drag('Vertical',80);require(state()['y']>500);require(state()['clicks']==0)
        page.screenshot(path=str(out/'screenshots'/f'scrollbars-{args.scale:g}x.png'))
    check('compact overlay thumb stays interactive above a full-size Button',overlay)
    def ax():
        mount('ScrollViewer');g=geometry();node=page.locator(f'#avalonia-peer-{g["id"]}')
        require(node.get_attribute('role')=='scrollbar');require(node.get_attribute('aria-orientation')=='vertical')
        page.evaluate('scrollFixture.Control.VerticalScrollBar.GetOrCreateAutomationPeer().SetValue(321)');page.wait_for_timeout(80);near(state()['y'],321);near(float(node.get_attribute('aria-valuenow')),321)
    check('browser accessibility projection exposes a live scrollbar range',ax)
    report['finalSourceFingerprint']=source_fingerprint(root)
    require(report['sourceFingerprint']==report['finalSourceFingerprint'],'Source changed during browser qualification')
    report['completed']=True;save();browser.close()
print(json.dumps({k:report[k] for k in ['passed','failed','pageErrors','missingAssets','completed']}))
raise SystemExit(1 if report['failed'] or report['pageErrors'] or report['missingAssets'] else 0)
