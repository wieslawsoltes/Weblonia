"""Ordinary HTTP qualification of new core/XAML/drawing/grouped-compositor APIs.
No intercepted resources, fake workers or replacement bootstrap. A wrapper adds
three inspection commands to the production catalog factory in the UI worker.
Pixel expectations are analytic colored rectangles, not a renderer-derived image.
"""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import urlsplit,parse_qs
import base64,io,json,time
from PIL import Image
from playwright.sync_api import sync_playwright
from verification_support import source_fingerprint
from threading_support import browser_executable
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'artifacts/core-port';OUT.mkdir(parents=True,exist_ok=True)
report={'Version':json.loads((ROOT/'package.json').read_text())['version'],'SourceFingerprint':source_fingerprint(ROOT),'Completed':False,'Tests':[],'Errors':[],'MissingAssets':[],
        'Interception':False,'WorkerBootstrapOverrides':False,'PhysicalGpuQualified':False,'PixelChannelTolerance':2}
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kw):super().__init__(*args,directory=str(ROOT),**kw)
    def log_message(self,*args):pass
    def do_GET(self):
        parsed=urlsplit(self.path)
        if parsed.path=='/tests/core-entry.html':
            mode=parse_qs(parsed.query)['mode'][0];assert mode in ['single','render-worker','full-isolation']
            boot={'ThreadingMode':mode,'Backend':'canvas','ApplicationModule':f'http://127.0.0.1:{self.server.server_port}/tests/core-port-worker.js'}
            html=(ROOT/'samples/ControlCatalog/index.html').read_text().replace('<head>','<head><base href="/samples/ControlCatalog/"><script>globalThis.AVALONIA_BOOT_OPTIONS='+json.dumps(boot)+';</script>')
            body=html.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        else:super().do_GET()
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=Thread(target=server.serve_forever,daemon=True);thread.start()
def pixels(page,mode):
    data=page.evaluate('''async mode=>{const bytes=await(mode==='full-isolation'?catalogHost.CaptureRenderedFrameAsync():catalog.Root.Renderer.SnapshotPng());let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s)}''',mode)
    return Image.open(io.BytesIO(base64.b64decode(data))).convert('RGBA')
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=browser_executable(),headless=True,args=['--no-sandbox','--disable-dev-shm-usage']);report['Browser']=browser.version
        for mode in ['single','render-worker','full-isolation']:
            context=browser.new_context(viewport={'width':400,'height':240},device_scale_factor=1);page=context.new_page();errors=[];missing=[]
            page.on('pageerror',lambda e:errors.append(str(e)));page.on('response',lambda r:missing.append(r.url) if r.status>=400 else None)
            entry={'Mode':mode,'Passed':False};started=time.monotonic()
            try:
                page.goto(f'http://127.0.0.1:{server.server_port}/tests/core-entry.html?mode={mode}');page.wait_for_function('globalThis.catalogReady||globalThis.catalogError',timeout=60000);assert not page.evaluate('globalThis.catalogError')
                state=page.evaluate('''async mode=>{if(mode==='full-isolation')return await catalogHost.InvokeAsync('MountCore');
                    const A=await import('@wieslawsoltes/avalonia'),{CreateCorePortScene}=await import('/tests/core-port-scene.js');globalThis.coreScene=await CreateCorePortScene(A,catalog.Root);return coreScene.State();}''',mode)
                assert state['Services']==[{'Property':'Text','Type':'TextBlock','BaseUri':'https://example.test/core.axaml'}],state
                assert state['Dispatcher']=={'Value':17,'Status':2,'Aborted':1,'Jobs':['normal']},state
                assert state['HasDocument']==(mode!='full-isolation'),state
                before=pixels(page,mode)
                change=page.evaluate("async mode=>mode==='full-isolation'?await catalogHost.InvokeAsync('ChangeCore'):await coreScene.Change()",mode)
                page.wait_for_function("async ([mode,before])=>{const s=mode==='full-isolation'?await catalogHost.InvokeAsync('CoreState'):coreScene.State();return s.Frames>before;}",arg=[mode,change['FramesBefore']],timeout=10000)
                after=pixels(page,mode);maximum=0
                for image,expectations in [(before,[((32,32),(255,0,0,255)),((130,26),(128,128,255,255)),((100,32),(255,255,255,255))]),(after,[((32,32),(0,255,0,255)),((130,26),(191,191,255,255)),((100,32),(255,255,255,255))])]:
                    for (x,y),expected in expectations:
                        actual=image.getpixel((x,y));error=max(abs(a-b) for a,b in zip(actual,expected));assert error<=2,{'Mode':mode,'Pixel':[x,y],'Actual':actual,'Expected':expected};maximum=max(maximum,error)
                assert not errors and not missing,{'Errors':errors,'Missing':missing}
                before.save(OUT/(mode+'-before.png'));after.save(OUT/(mode+'-after.png'))
                entry.update(Passed=True,MaximumChannelError=maximum,ComparedChannels=4,AutonomousRedraw=True,WorkerCount=len(page.workers),State=state)
                if mode=='full-isolation':page.evaluate('async()=>await catalogHost.DisposeAsync()')
                else:page.evaluate('coreScene.Dispose();catalog.Root.Dispose();undefined')
            except Exception as e:entry['Error']=str(e)
            finally:
                entry.update(Errors=errors,MissingAssets=missing,Milliseconds=round((time.monotonic()-started)*1000,2));report['Errors'].extend(errors);report['MissingAssets'].extend(missing);report['Tests'].append(entry);context.close();print(('PASS' if entry['Passed'] else 'FAIL'),mode,entry.get('Error',''),flush=True)
        browser.close()
finally:server.shutdown();server.server_close();thread.join()
report.update(Completed=True,Passed=sum(t['Passed'] for t in report['Tests']),Failed=sum(not t['Passed'] for t in report['Tests']),FinalSourceFingerprint=source_fingerprint(ROOT))
(OUT/'browser-results.json').write_text(json.dumps(report,indent=2)+'\n');raise SystemExit(0 if report['Failed']==0 and not report['Errors'] and not report['MissingAssets'] else 1)
