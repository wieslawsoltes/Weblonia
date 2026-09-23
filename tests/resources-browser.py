"""Resource creation, themes and reparenting over ordinary HTTP module workers.
No intercepted assets, input events or render/snapshot RPCs repair the observable
mutations. Pixel probes inspect the actual browser-presented canvas.
"""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import urlsplit, parse_qs
import io, json, time, subprocess
from PIL import Image
from playwright.sync_api import sync_playwright
from threading_support import browser_executable
from verification_support import source_fingerprint

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'artifacts/resources';OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--import','./scripts/register-loader.mjs','scripts/compile-resource-fixture.mjs'],cwd=ROOT,check=True)
report={'Version':json.loads((ROOT/'package.json').read_text())['version'],'SourceFingerprint':source_fingerprint(ROOT),
    'Completed':False,'Tests':[],'Errors':[],'MissingAssets':[],'Interception':False,
    'WorkerBootstrapOverrides':False,'SnapshotForcesRender':False,'PhysicalGpuQualified':False,'PixelChannelTolerance':2}
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
    def log_message(self,*a):pass
    def do_GET(self):
        parsed=urlsplit(self.path)
        if parsed.path=='/tests/resource-entry.html':
            mode=parse_qs(parsed.query).get('mode',[''])[0]
            if mode not in ['single','render-worker','full-isolation']:self.send_error(400);return
            boot={'ThreadingMode':mode,'Backend':'canvas','ApplicationModule':f'http://127.0.0.1:{self.server.server_port}/tests/resource-worker.js'}
            body=(ROOT/'samples/ControlCatalog/index.html').read_text().replace('<head>','<head><base href="/samples/ControlCatalog/"><script>globalThis.AVALONIA_BOOT_OPTIONS='+json.dumps(boot)+';</script>').encode()
            self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        else:super().do_GET()
white,red,blue,green,yellow,magenta=(255,255,255,255),(255,0,0,255),(0,0,255,255),(0,255,0,255),(255,255,0,255),(255,0,255,255)
expectations={'initial':[red,white,blue,blue],'theme':[blue,white,blue,blue],'move':[white,green,blue,blue],
    'mutate':[white,yellow,magenta,blue],'realize':[white,yellow,magenta,blue]}
def presented(page,expected):
    deadline=time.monotonic()+10
    while True:
        image=Image.open(io.BytesIO(page.locator('#app canvas').first.screenshot(timeout=10000))).convert('RGBA')
        values=[image.getpixel((32+i*96,32)) for i in range(4)]
        maximum=max(abs(a-b) for value,rgba in zip(values,expected) for a,b in zip(value,rgba))
        if maximum<=2:return image,maximum
        if time.monotonic()>=deadline:raise AssertionError({'ResourcePixels':values,'Expected':expected})
        page.wait_for_timeout(25)
def evaluate(page,expression,arg=None):
    return page.evaluate('''async arg=>{let timer;try{return await Promise.race([
        Promise.resolve().then(()=>('''+expression+''')(arg)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Resource fixture operation timeout')),45000);})
    ]);}finally{clearTimeout(timer);}}''',arg)
def save():(OUT/'browser-results.json').write_text(json.dumps(report,indent=2)+'\n')
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=Thread(target=server.serve_forever,daemon=True);thread.start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=browser_executable(),headless=True,args=['--no-sandbox','--disable-dev-shm-usage']);report['Browser']=browser.version
        for mode in ['single','render-worker','full-isolation']:
            for aot in [False,True]:
                context=browser.new_context(viewport={'width':400,'height':180},device_scale_factor=1);page=context.new_page()
                errors=[];missing=[];started=time.monotonic();entry={'Mode':mode,'Aot':aot,'Passed':False}
                page.on('pageerror',lambda e:errors.append(str(e)));page.on('response',lambda r:missing.append(r.url)if r.status>=400 else None)
                try:
                    print('STAGE',mode,aot,'startup',flush=True)
                    page.goto(f'http://127.0.0.1:{server.server_port}/tests/resource-entry.html?mode={mode}')
                    page.wait_for_function('globalThis.catalogReady||globalThis.catalogError',timeout=60000);assert not page.evaluate('globalThis.catalogError')
                    print('STAGE',mode,aot,'mount',flush=True)
                    state=evaluate(page,"""async([mode,aot])=>{if(mode==='full-isolation')return await catalogHost.InvokeAsync('MountResources',aot);
                        const A=await import('@wieslawsoltes/avalonia'),{CreateResourceScene}=await import('/tests/resource-scene.js');
                        globalThis.resourceScene=await CreateResourceScene(A,catalog.Root,aot);return resourceScene.State();}""",[mode,aot])
                    assert state['Aot']==aot and state['HasDocument']==(mode!='full-isolation') and not state['RenderError'],state
                    assert state['Created']==2 and state['Deferred'] and state['Distinct'],state
                    initial,maximum=presented(page,expectations['initial']);stages=[]
                    for step in ['theme','move','mutate','realize']:
                        print('STAGE',mode,aot,step,flush=True)
                        change=evaluate(page,"async([mode,step])=>mode==='full-isolation'?await catalogHost.InvokeAsync('ChangeResources',step):await resourceScene.Change(step)",[mode,step])
                        updated,error=presented(page,expectations[step]);maximum=max(maximum,error)
                        current=evaluate(page,"async mode=>mode==='full-isolation'?await catalogHost.InvokeAsync('ResourceState'):resourceScene.State()",mode)
                        assert not current['RenderError'],current
                        if step!='realize':assert current['Frames']>change['FramesBefore'],current
                        assert current['Created']==(3 if step=='realize' else 2),current
                        stages.append({'Step':step,'State':current,'MaximumChannelError':error})
                    assert not current['Deferred'] and current['Distinct'] and current['ParentIsRight'],current
                    if mode!='single':
                        print('STAGE',mode,aot,'restart',flush=True)
                        evaluate(page,"async mode=>{if(mode==='full-isolation')await catalogHost.RestartRendererAsync();else await catalog.Root.Renderer.RestartAsync();}",mode)
                        _,error=presented(page,expectations['realize']);maximum=max(maximum,error)
                    assert not errors and not missing,{'Errors':errors,'MissingAssets':missing}
                    label=mode+('-aot'if aot else '-runtime');initial.save(OUT/(label+'-before.png'));updated.save(OUT/(label+'-after.png'))
                    if mode=='full-isolation':evaluate(page,'async()=>await catalogHost.DisposeAsync()')
                    else:evaluate(page,'()=>{resourceScene.Dispose();catalog.Root.Dispose();}')
                    entry.update(Passed=True,MaximumChannelError=maximum,ComparedChannels=4,AutonomousRedraw=True,
                        LazyCreation=True,UnsharedDistinct=True,ThemeSwitch=True,AncestorReparenting=True,OldScopeDetached=True,
                        RestartPassed=mode!='single',Stages=stages)
                except Exception as error:entry.update(Passed=False,Error=str(error))
                finally:
                    entry.update(Errors=errors,MissingAssets=missing,Milliseconds=round((time.monotonic()-started)*1000,2));report['Errors'].extend(errors);report['MissingAssets'].extend(missing);report['Tests'].append(entry);save();context.close();print('PASS'if entry['Passed']else'FAIL',mode,aot,entry.get('Error',''),flush=True)
        browser.close()
finally:server.shutdown();server.server_close();thread.join(timeout=5)
report.update(Completed=True,Passed=sum(t['Passed']for t in report['Tests']),Failed=sum(not t['Passed']for t in report['Tests']),FinalSourceFingerprint=source_fingerprint(ROOT));save()
raise SystemExit(1 if report['Failed']or report['Errors']or report['MissingAssets']else 0)
