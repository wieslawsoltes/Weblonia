"""Implicit binding/layout and grouped animations on all real worker topologies.
Uses ordinary HTTP, original bootstrap and the browser-presented canvas only.
No render/snapshot RPC or input event can repair a missing autonomous update.
"""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import urlsplit,parse_qs
import io,json,time
from PIL import Image
from playwright.sync_api import sync_playwright
from verification_support import source_fingerprint
from threading_support import browser_executable
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'artifacts/implicit-animations';OUT.mkdir(parents=True,exist_ok=True)
report={'Version':json.loads((ROOT/'package.json').read_text())['version'],'SourceFingerprint':source_fingerprint(ROOT),'Completed':False,
        'Tests':[],'Errors':[],'MissingAssets':[],'Interception':False,'WorkerBootstrapOverrides':False,'SnapshotForcesRender':False,
        'PhysicalGpuQualified':False,'PixelChannelTolerance':2}
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kw):super().__init__(*args,directory=str(ROOT),**kw)
    def log_message(self,*args):pass
    def do_GET(self):
        parsed=urlsplit(self.path)
        if parsed.path=='/tests/implicit-entry.html':
            mode=parse_qs(parsed.query)['mode'][0];assert mode in ['single','render-worker','full-isolation']
            boot={'ThreadingMode':mode,'Backend':'canvas','ApplicationModule':f'http://127.0.0.1:{self.server.server_port}/tests/implicit-animation-worker.js'}
            html=(ROOT/'samples/ControlCatalog/index.html').read_text().replace('<head>','<head><base href="/samples/ControlCatalog/"><script>globalThis.AVALONIA_BOOT_OPTIONS='+json.dumps(boot)+';</script>')
            body=html.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        else:super().do_GET()
def pixels(page):return Image.open(io.BytesIO(page.locator('#app canvas').first.screenshot(timeout=10000))).convert('RGBA')
def matches(image,expectations):
    return all(max(abs(a-b) for a,b in zip(image.getpixel(point),rgba))<=2 for point,rgba in expectations)
def settled(page,expectations):
    deadline=time.monotonic()+10
    while True:
        image=pixels(page)
        if matches(image,expectations):return image
        if time.monotonic()>=deadline:raise AssertionError({'PresentedPixelsDidNotConverge':[(p,image.getpixel(p),c) for p,c in expectations]})
        page.wait_for_timeout(25)
def red_left(image):
    xs=[x for x in range(image.width) if image.getpixel((x,24))[:3]==(255,0,0)]
    if not xs:raise AssertionError('Animated XAML control disappeared from the presented surface')
    return min(xs)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=Thread(target=server.serve_forever,daemon=True);thread.start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=browser_executable(),headless=True,args=['--no-sandbox','--disable-dev-shm-usage']);report['Browser']=browser.version
        for mode in ['single','render-worker','full-isolation']:
            context=browser.new_context(viewport={'width':320,'height':180},device_scale_factor=1);page=context.new_page();errors=[];missing=[]
            page.on('pageerror',lambda e:errors.append(str(e)));page.on('response',lambda r:missing.append(r.url) if r.status>=400 else None)
            entry={'Mode':mode,'Passed':False};started=time.monotonic()
            try:
                page.goto(f'http://127.0.0.1:{server.server_port}/tests/implicit-entry.html?mode={mode}')
                page.wait_for_function('globalThis.catalogReady||globalThis.catalogError',timeout=60000);assert not page.evaluate('globalThis.catalogError')
                state=page.evaluate('''async mode=>{if(mode==='full-isolation')return await catalogHost.InvokeAsync('MountImplicit');
                    const A=await import('@wieslawsoltes/avalonia'),{CreateImplicitAnimationScene}=await import('/tests/implicit-animation-scene.js');
                    globalThis.implicitScene=await CreateImplicitAnimationScene(A,catalog.Root);return implicitScene.State();}''',mode)
                assert state['HasDocument']==(mode!='full-isolation') and state['LayoutLeft']==16 and state['RenderError'] is None,state
                def invoke(command):return page.evaluate("async ([mode,command])=>mode==='full-isolation'?await catalogHost.InvokeAsync('Implicit'+command):await implicitScene[command]()",[mode,command])
                initial=settled(page,[((20,24),(255,0,0,255)),((20,72),(0,0,255,255))]);initial.save(OUT/(mode+'-initial.png'))
                invoke('Move');deadline=time.monotonic()+3;positions=[]
                while True:
                    middle=pixels(page);x=red_left(middle);positions.append(x)
                    if 24<x<200:break
                    if time.monotonic()>=deadline:raise AssertionError({'NoIntermediateAnimationFrame':positions})
                    page.wait_for_timeout(15)
                middle.save(OUT/(mode+'-intermediate.png'));state=invoke('State');assert state['DesiredLeft']==216 and state['LayoutLeft']==216,state
                invoke('Retarget')
                expected=[((88,24),(255,0,0,255)),((88,72),(128,128,255,255)),((20,24),(255,255,255,255)),((224,24),(255,255,255,255))]
                final=settled(page,expected);final.save(OUT/(mode+'-retargeted.png'))
                # A late unrelated value update must not reset or replay either completed animation.
                invoke('Unrelated');page.wait_for_timeout(220);stable=pixels(page);assert matches(stable,expected),'Completed animations replayed on an unrelated commit'
                invoke('Clear');cleared=settled(page,[((152,24),(255,0,0,255)),((152,72),(128,128,255,255)),((88,24),(255,255,255,255))]);cleared.save(OUT/(mode+'-cleared.png'))
                state=invoke('State');assert state['LayoutLeft']==144 and state['RenderError'] is None,state
                assert not errors and not missing,{'Errors':errors,'Missing':missing}
                maximum=max(abs(a-b) for point,rgba in expected for a,b in zip(final.getpixel(point),rgba))
                entry.update(Passed=True,AutonomousRedraw=True,BindingDrivenLayout=True,GroupedTrigger=True,Retargeted=True,CompletedRunNotReplayed=True,
                    ClearedDefinitions=True,IntermediatePositions=positions,ComparedChannels=4,MaximumChannelError=maximum,WorkerCount=len(page.workers))
                if mode=='full-isolation':page.evaluate('async()=>await catalogHost.DisposeAsync()')
                else:page.evaluate('implicitScene.Dispose();catalog.Root.Dispose();undefined')
            except Exception as error:entry['Error']=str(error)
            finally:
                entry.update(Errors=errors,MissingAssets=missing,Milliseconds=round((time.monotonic()-started)*1000,2));report['Errors'].extend(errors);report['MissingAssets'].extend(missing);report['Tests'].append(entry);context.close();print(('PASS' if entry['Passed'] else 'FAIL'),mode,entry.get('Error',''),flush=True)
        browser.close()
finally:server.shutdown();server.server_close();thread.join()
report.update(Completed=True,Passed=sum(t['Passed'] for t in report['Tests']),Failed=sum(not t['Passed'] for t in report['Tests']),FinalSourceFingerprint=source_fingerprint(ROOT))
(OUT/'browser-results.json').write_text(json.dumps(report,indent=2)+'\n');raise SystemExit(0 if report['Failed']==0 and not report['Errors'] and not report['MissingAssets'] else 1)
