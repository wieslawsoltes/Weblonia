"""Actual HTTP / module-worker integration; no intercepted responses or native
snapshot/render RPCs during redraw checks. A test endpoint reads the runner's
installed DejaVu font, without copying or including any font in source/artifacts.
"""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from threading import Thread
from urllib.parse import urlsplit,parse_qs
import io,json,os,time,subprocess
from PIL import Image
from playwright.sync_api import sync_playwright
from threading_support import browser_executable
from verification_support import source_fingerprint
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'artifacts/glyph-geometry';OUT.mkdir(parents=True,exist_ok=True)
# Regenerate before measuring the source fingerprint (no special runtime compiler).
subprocess.run(['node','--import','./scripts/register-loader.mjs','scripts/compile-glyph-fixture.mjs'],cwd=ROOT,check=True)
FONT=Path(os.environ.get('AVALONIA_TEST_FONT','/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
report={'Version':json.loads((ROOT/'package.json').read_text())['version'],'SourceFingerprint':source_fingerprint(ROOT),'Completed':False,'Tests':[],
        'Errors':[],'MissingAssets':[],'Interception':False,'WorkerBootstrapOverrides':False,'SnapshotForcesRender':False,
        'FontFilesDistributed':False,'PhysicalGpuQualified':False,'PixelChannelTolerance':2}
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
    def log_message(self,*a):pass
    def do_GET(self):
        url=urlsplit(self.path)
        if url.path=='/tests/system-font.ttf':
            data=FONT.read_bytes();self.send_response(200);self.send_header('Content-Type','font/ttf');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data);return
        if url.path=='/tests/glyph-geometry-entry.html':
            mode=parse_qs(url.query)['mode'][0];assert mode in ['single','render-worker','full-isolation']
            boot={'ThreadingMode':mode,'Backend':'canvas','ApplicationModule':f'http://127.0.0.1:{self.server.server_port}/tests/glyph-geometry-worker.js'}
            body=(ROOT/'samples/ControlCatalog/index.html').read_text().replace('<head>','<head><base href="/samples/ControlCatalog/"><script>globalThis.AVALONIA_BOOT_OPTIONS='+json.dumps(boot)+';</script>').encode()
            self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body);return
        super().do_GET()
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=Thread(target=server.serve_forever,daemon=True);thread.start()
origin=f'http://127.0.0.1:{server.server_port}'
before=[((45,30),(255,0,0,255)),((45,15),(255,255,255,255)),((26,90),(0,0,0,255)),((86,90),(255,255,255,255))]
after=[((45,30),(255,0,0,255)),((45,15),(0,0,0,255)),((26,90),(255,255,255,255)),((86,90),(0,0,255,255))]
def save():
    (OUT/'browser-results.json').write_text(json.dumps(report,indent=2)+'\n')
def evaluate(page,expression,argument=None,label='command'):
    # Playwright evaluate itself has no operation deadline. Bound async fixture
    # promises rather than leaving a stalled mount/teardown alive for the whole
    # job. This only observes completion; it does not request frames or retry.
    print('STAGE',mode,aot,label,flush=True)
    return page.evaluate("""async argument=>{let timer;try{return await Promise.race([
        Promise.resolve().then(()=>("""+expression+""")(argument)),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Glyph fixture timed out during '+"""+json.dumps(label)+"""+'; render error: '+globalThis.catalog?.Root?.LastRenderError?.message)),45000);})
    ]);}finally{clearTimeout(timer);}}""",argument)
def wait_pixels(page,expected):
    deadline=time.monotonic()+10
    print('STAGE',mode,aot,'presented pixels',flush=True)
    while True:
        # Locator screenshots capture the already-presented canvas, never call the renderer.
        image=Image.open(io.BytesIO(page.locator('#app canvas').first.screenshot(timeout=10000))).convert('RGBA')
        maximum=max(abs(a-b) for xy,rgba in expected for a,b in zip(image.getpixel(xy),rgba))
        if maximum<=2:return image,maximum
        if time.monotonic()>=deadline:raise AssertionError({'PixelError':maximum,'Pixels':[(xy,image.getpixel(xy),rgba)for xy,rgba in expected]})
        page.wait_for_timeout(25)
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=browser_executable(),headless=True,args=['--no-sandbox','--disable-dev-shm-usage']);report['Browser']=browser.version
        for mode in ['single','render-worker','full-isolation']:
            for aot in [False,True]:
                context=browser.new_context(viewport={'width':400,'height':240},device_scale_factor=1);page=context.new_page();errors=[];missing=[];fonts=[]
                page.on('pageerror',lambda e:errors.append(str(e)));page.on('response',lambda r:missing.append(r.url) if r.status>=400 else None)
                page.on('request',lambda r:fonts.append(r.url) if r.url.endswith('/system-font.ttf') else None)
                entry={'Mode':mode,'Aot':aot,'Passed':False};started=time.monotonic()
                try:
                    print('STAGE',mode,aot,'navigation',flush=True)
                    page.goto(origin+'/tests/glyph-geometry-entry.html?mode='+mode);page.wait_for_function('globalThis.catalogReady||globalThis.catalogError',timeout=60000);assert not page.evaluate('globalThis.catalogError')
                    state=evaluate(page,'''async([mode,url,aot])=>{
                        if(mode==='full-isolation')return await catalogHost.InvokeAsync('MountGlyphGeometry',url,aot);
                        const A=await import('@wieslawsoltes/avalonia'),{CreateGlyphGeometryScene}=await import('/tests/glyph-geometry-scene.js');
                        globalThis.glyphGeometry=await CreateGlyphGeometryScene(A,catalog.Root,url,aot);return glyphGeometry.State();
                    }''',[mode,origin+'/tests/system-font.ttf',aot],label='mount')
                    assert state['Aot']==aot and state['HasDocument']==(mode!='full-isolation') and not state['RenderError'],state
                    initial,error1=wait_pixels(page,before)
                    change=evaluate(page,"async mode=>mode==='full-isolation'?await catalogHost.InvokeAsync('ChangeGlyphGeometry'):await glyphGeometry.Change()",mode)
                    updated,error2=wait_pixels(page,after)
                    current=evaluate(page,"async mode=>mode==='full-isolation'?await catalogHost.InvokeAsync('GlyphGeometryState'):glyphGeometry.State()",mode)
                    assert current['Frames']>change['FramesBefore'] and not current['RenderError'],current
                    if mode!='single':
                        evaluate(page,"async mode=>{if(mode==='full-isolation')await catalogHost.RestartRendererAsync();else await catalog.Root.Renderer.RestartAsync();}",mode,label='restart')
                        _,error3=wait_pixels(page,after)
                    else:error3=0
                    assert len(fonts)==1,fonts
                    assert not errors and not missing,{'Errors':errors,'MissingAssets':missing}
                    label=mode+('-aot' if aot else '-runtime');initial.save(OUT/(label+'-before.png'));updated.save(OUT/(label+'-after.png'))
                    entry.update(Passed=True,MaximumChannelError=max(error1,error2,error3),ComparedChannels=4,AutonomousRedraw=True,RestartPassed=mode!='single',FontRequests=len(fonts),WorkerCount=len(page.workers),State=current)
                    if mode=='full-isolation':evaluate(page,'async()=>await catalogHost.DisposeAsync()',label='dispose')
                    else:evaluate(page,'()=>{glyphGeometry.Dispose();catalog.Root.Dispose();}',label='dispose')
                except Exception as e:entry.update(Passed=False,Error=str(e))
                finally:
                    entry.update(Errors=errors,MissingAssets=missing,Milliseconds=round((time.monotonic()-started)*1000,2));report['Errors'].extend(errors);report['MissingAssets'].extend(missing);report['Tests'].append(entry);save();context.close();print(('PASS' if entry['Passed'] else 'FAIL'),mode,aot,entry.get('Error',''),flush=True)
        browser.close()
finally:
    print('STAGE HTTP server shutdown',flush=True)
    server.shutdown();server.server_close();thread.join(timeout=5)
report.update(Completed=True,Passed=sum(t['Passed']for t in report['Tests']),Failed=sum(not t['Passed']for t in report['Tests']),FinalSourceFingerprint=source_fingerprint(ROOT))
save();raise SystemExit(1 if report['Failed'] or report['Errors'] or report['MissingAssets'] else 0)
