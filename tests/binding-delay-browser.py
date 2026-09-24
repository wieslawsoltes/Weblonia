"""Real HTTP runtime/AOT × all UI/renderer topologies. Observe browser-presented
pixels after natural DispatcherTimer delivery. No input injection, HTTP interception,
clock override, or forced render/snapshot RPC is used to repair invalidation.
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
OUT=ROOT/'artifacts/binding-delay';OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['node','--import','./scripts/register-loader.mjs','scripts/compile-delay-fixture.mjs'],cwd=ROOT,check=True)
report={'Version':json.loads((ROOT/'package.json').read_text())['version'],'SourceFingerprint':source_fingerprint(ROOT),
    'Completed':False,'Tests':[],'Errors':[],'MissingAssets':[],'Interception':False,'WorkerBootstrapOverrides':False,
    'SnapshotForcesRender':False,'ClockOverrides':False,'BindingDelay':True,'PixelChannelTolerance':2,'PhysicalGpuQualified':False}
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kw):super().__init__(*args,directory=str(ROOT),**kw)
    def log_message(self,*args):pass
    def do_GET(self):
        parsed=urlsplit(self.path)
        if parsed.path=='/tests/binding-delay-entry.html':
            mode=parse_qs(parsed.query).get('mode',[''])[0]
            if mode not in ['single','render-worker','full-isolation']:self.send_error(400);return
            boot={'ThreadingMode':mode,'Backend':'canvas','ApplicationModule':f'http://127.0.0.1:{self.server.server_port}/tests/binding-delay-worker.js'}
            body=(ROOT/'samples/ControlCatalog/index.html').read_text().replace('<head>','<head><base href="/samples/ControlCatalog/"><script>globalThis.AVALONIA_BOOT_OPTIONS='+json.dumps(boot)+';</script>').encode()
            self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        else:super().do_GET()
WHITE,RED,BLUE=(255,255,255,255),(255,0,0,255),(0,0,255,255)
before=[((24,24),RED),((88,24),WHITE),((24,64),BLUE),((152,64),WHITE)]
after=[((24,24),WHITE),((88,24),RED),((24,64),WHITE),((152,64),BLUE)]
def presented(page,expected):
    deadline=time.monotonic()+10
    while True:
        image=Image.open(io.BytesIO(page.locator('#app canvas').first.screenshot(timeout=10000))).convert('RGBA')
        error=max(abs(a-b)for xy,rgba in expected for a,b in zip(image.getpixel(xy),rgba))
        if error<=2:return image,error
        if time.monotonic()>=deadline:raise AssertionError({'DelayPixels':[(p,image.getpixel(p),c)for p,c in expected]})
        page.wait_for_timeout(25)
def evaluate(page,expression,arg=None):
    return page.evaluate('''async arg=>{let timer;try{return await Promise.race([
        Promise.resolve().then(()=>('''+expression+''')(arg)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Binding Delay operation timeout')),45000);})
    ]);}finally{clearTimeout(timer);}}''',arg)
def command(page,mode,name):
    return evaluate(page,"async([mode,name])=>mode==='full-isolation'?await catalogHost.InvokeAsync(({State:'BindingDelayState',Queue:'QueueBindingDelay',Flush:'FlushBindingDelay',ReleasePending:'ReleaseBindingDelay'})[name]):await delayScene[name]()",[mode,name])
def save():(OUT/'browser-results.json').write_text(json.dumps(report,indent=2)+'\n')
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=Thread(target=server.serve_forever,daemon=True);thread.start()
try:
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=browser_executable(),headless=True,args=['--no-sandbox','--disable-dev-shm-usage']);report['Browser']=browser.version
        for mode in ['single','render-worker','full-isolation']:
            for aot in [False,True]:
                context=browser.new_context(viewport={'width':320,'height':220},device_scale_factor=1);page=context.new_page()
                errors=[];missing=[];started=time.monotonic();entry={'Mode':mode,'Aot':aot,'Passed':False}
                page.on('pageerror',lambda e:errors.append(str(e)));page.on('response',lambda r:missing.append(r.url)if r.status>=400 else None)
                try:
                    print('STAGE',mode,aot,'navigate',flush=True)
                    page.goto(f'http://127.0.0.1:{server.server_port}/tests/binding-delay-entry.html?mode={mode}');page.wait_for_function('globalThis.catalogReady||globalThis.catalogError',timeout=60000)
                    assert not page.evaluate('globalThis.catalogError')
                    state=evaluate(page,"""async([mode,aot])=>{if(mode==='full-isolation')return await catalogHost.InvokeAsync('MountBindingDelay',aot);
                        const A=await import('@wieslawsoltes/avalonia'),{CreateBindingDelayScene}=await import('/tests/binding-delay-scene.js');
                        globalThis.delayScene=await CreateBindingDelayScene(A,catalog.Root,aot);return delayScene.State();}""",[mode,aot])
                    assert state['Aot']==aot and state['HasDocument']==(mode!='full-isolation') and state['Writes']==[0,0] and not state['RenderError'],state
                    initial,error1=presented(page,before)
                    queued=command(page,mode,'Queue');assert queued['Writes']==[0,0] and queued['Pending']==2 and queued['Values']==['initial','initial'],queued
                    # Waiting for screenshots/State only observes delivery; the real owner
                    # realm's timer writes the source and requests its own new frame.
                    matured,error2=presented(page,after);current=command(page,mode,'State')
                    assert current['Writes']==[1,1] and current['Pending']==0 and current['Values']==['final','final'],current
                    assert current['Frames']>queued['FramesBefore'] and not current['RenderError'],current
                    if mode!='single':
                        evaluate(page,"async mode=>{if(mode==='full-isolation')await catalogHost.RestartRendererAsync();else await catalog.Root.Renderer.RestartAsync();}",mode)
                        _,error3=presented(page,after)
                    else:error3=0
                    flushed=command(page,mode,'Flush');assert flushed['Writes']==[2,2] and flushed['Pending']==0 and flushed['Values']==['reset','reset'],flushed
                    _,error4=presented(page,before)
                    released=command(page,mode,'ReleasePending');assert released['Subscriptions']==0 and released['Pending']==0 and released['Writes']==[2,2],released
                    page.wait_for_timeout(300);final=command(page,mode,'State');assert final['Writes']==[2,2] and final['Pending']==0 and final['Subscriptions']==0,final
                    assert not errors and not missing,{'Errors':errors,'MissingAssets':missing}
                    label=mode+('-aot'if aot else '-runtime');initial.save(OUT/(label+'-before.png'));matured.save(OUT/(label+'-after.png'))
                    entry.update(Passed=True,ComparedChannels=4,MaximumChannelError=max(error1,error2,error3,error4),AutonomousRedraw=True,
                        ImmediatePublicationSuppressed=True,CoalescedWrites=True,ExplicitFlush=True,PendingDisposal=True,RemainingSubscriptions=0,RestartPassed=mode!='single',State=current)
                    if mode=='full-isolation':evaluate(page,'async()=>{await catalogHost.DisposeAsync();}')
                    else:evaluate(page,'()=>{delayScene.Dispose();catalog.Root.Dispose();}')
                except Exception as error:entry.update(Passed=False,Error=str(error))
                finally:
                    entry.update(Errors=errors,MissingAssets=missing,Milliseconds=round((time.monotonic()-started)*1000,2));report['Tests'].append(entry)
                    report['Errors'].extend(errors);report['MissingAssets'].extend(missing);save();context.close();print('PASS'if entry['Passed']else 'FAIL',mode,aot,entry.get('Error',''),flush=True)
        browser.close()
finally:server.shutdown();server.server_close();thread.join(timeout=5)
report.update(Completed=True,Passed=sum(t['Passed']for t in report['Tests']),Failed=sum(not t['Passed']for t in report['Tests']),FinalSourceFingerprint=source_fingerprint(ROOT));save()
raise SystemExit(1 if report['Failed']or report['Errors']or report['MissingAssets']else 0)
