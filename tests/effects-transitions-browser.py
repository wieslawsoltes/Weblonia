"""Actual HTTP runtime/AOT effect binding, retargeting and resource invalidation.
The injected clock controls transition time only. All frames must appear through
normal invalidation and worker submission; no input or render/snapshot RPC repairs.
No font downloads, resource interception or modified worker bootstrap.
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

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT/'artifacts/effects-transitions'; OUT.mkdir(parents=True, exist_ok=True)
subprocess.run(['node', '--import', './scripts/register-loader.mjs', 'scripts/compile-effects-fixture.mjs'], cwd=ROOT, check=True)
report = {'Version': json.loads((ROOT/'package.json').read_text())['version'], 'SourceFingerprint': source_fingerprint(ROOT),
    'Completed': False, 'Tests': [], 'Errors': [], 'MissingAssets': [], 'Interception': False,
    'WorkerBootstrapOverrides': False, 'SnapshotForcesRender': False, 'PhysicalGpuQualified': False,
    'DeterministicTransitionClock': True, 'PixelChannelTolerance': 2}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kw): super().__init__(*args, directory=str(ROOT), **kw)
    def log_message(self, *args): pass
    def do_GET(self):
        parsed = urlsplit(self.path)
        if parsed.path == '/tests/effects-entry.html':
            mode = parse_qs(parsed.query)['mode'][0]
            if mode not in ['single', 'render-worker', 'full-isolation']: self.send_error(400); return
            boot = {'ThreadingMode': mode, 'Backend': 'canvas',
                'ApplicationModule': f'http://127.0.0.1:{self.server.server_port}/tests/effects-transition-worker.js'}
            body = (ROOT/'samples/ControlCatalog/index.html').read_text().replace('<head>',
                '<head><base href="/samples/ControlCatalog/"><script>globalThis.AVALONIA_BOOT_OPTIONS='+json.dumps(boot)+';</script>').encode()
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        else: super().do_GET()

WHITE, RED, BLACK = (255,255,255,255), (255,0,0,255), (0,0,0,255)
points = [(40,40),(120,40),(100,40),(80,40),(40,80),(40,100),(40,120),(240,40)]
def expectation(shadow=None): return [(p, RED if p==(40,40) else BLACK if p==shadow else WHITE) for p in points]
def presented(page, expected):
    deadline = time.monotonic()+10
    while True:
        image = Image.open(io.BytesIO(page.locator('#app canvas').first.screenshot(timeout=10000))).convert('RGBA')
        maximum = max(abs(a-b) for point, rgba in expected for a,b in zip(image.getpixel(point), rgba))
        if maximum <= 2: return image, maximum
        if time.monotonic() >= deadline:
            raise AssertionError({'PresentedEffectPixels': [(p, image.getpixel(p), c) for p,c in expected]})
        page.wait_for_timeout(25)
def evaluate(page, expression, arg=None):
    return page.evaluate('''async arg=>{let timer;try{return await Promise.race([
        Promise.resolve().then(()=>('''+expression+''')(arg)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Effect fixture operation timeout')),45000);})
    ]);}finally{clearTimeout(timer);}}''', arg)
def save(): (OUT/'browser-results.json').write_text(json.dumps(report, indent=2)+'\n')
server = ThreadingHTTPServer(('127.0.0.1',0), Handler); thread = Thread(target=server.serve_forever, daemon=True); thread.start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=browser_executable(), headless=True, args=['--no-sandbox','--disable-dev-shm-usage'])
        report['Browser'] = browser.version
        for mode in ['single', 'render-worker', 'full-isolation']:
            for aot in [False, True]:
                context = browser.new_context(viewport={'width':320,'height':200}, device_scale_factor=1)
                page = context.new_page(); errors=[]; missing=[]; started=time.monotonic(); entry={'Mode':mode,'Aot':aot,'Passed':False}
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('response', lambda response: missing.append(response.url) if response.status>=400 else None)
                try:
                    page.goto(f'http://127.0.0.1:{server.server_port}/tests/effects-entry.html?mode={mode}')
                    page.wait_for_function('globalThis.catalogReady||globalThis.catalogError', timeout=60000)
                    assert not page.evaluate('globalThis.catalogError')
                    state = evaluate(page, '''async([mode,aot])=>{if(mode==='full-isolation')return await catalogHost.InvokeAsync('MountEffects',aot);
                        const A=await import('@wieslawsoltes/avalonia'),{CreateEffectsTransitionScene}=await import('/tests/effects-transition-scene.js');
                        globalThis.effectsScene=await CreateEffectsTransitionScene(A,catalog.Root,aot);return effectsScene.State();}''', [mode,aot])
                    assert state['Aot']==aot and state['HasDocument']==(mode!='full-isolation') and not state['RenderError'], state
                    _, maximum = presented(page, expectation()); states=[]
                    for command, pixel, x, y, listeners in [
                        ('middle',(120,40),80,0,1), ('retarget',(100,40),60,0,1), ('complete',(80,40),40,0,0),
                        ('mutate',(40,80),0,40,0), ('scalar-middle',(40,100),0,60,1), ('scalar-complete',(40,120),0,80,0),
                        ('clear',None,None,None,0)]:
                        state = evaluate(page, "async([mode,command])=>mode==='full-isolation'?await catalogHost.InvokeAsync('EffectsStep',command):await effectsScene.Step(command)", [mode,command])
                        assert state['Listeners']==listeners and not state['RenderError'],state
                        for key, expected in [('OffsetX',x),('OffsetY',y)]:
                            assert state[key] is None if expected is None else abs(state[key]-expected)<1e-10,state
                        if command=='complete': assert state['MutableBaseRestored'] and not state['Active'],state
                        image, error = presented(page, expectation(pixel)); maximum=max(maximum,error); states.append({'Command':command,**state})
                        if command in ['middle','mutate','scalar-middle']: image.save(OUT/(mode+('-aot-' if aot else '-runtime-')+command+'.png'))
                        if command=='mutate' and mode!='single':
                            evaluate(page, "async mode=>{if(mode==='full-isolation')await catalogHost.RestartRendererAsync();else await catalog.Root.Renderer.RestartAsync();}",mode)
                            _,error=presented(page,expectation(pixel));maximum=max(maximum,error)
                    assert not errors and not missing, {'Errors':errors,'MissingAssets':missing}
                    if mode=='full-isolation': evaluate(page,'async()=>await catalogHost.DisposeAsync()')
                    else: evaluate(page,'()=>{effectsScene.Dispose();catalog.Root.Dispose();}')
                    entry.update(Passed=True, MaximumChannelError=maximum, ComparedChannels=4, AutonomousRedraw=True,
                        BindingRetargeted=True, MutableBaseRestored=True, ScalarResourceTransition=True, NullCompleted=True,
                        RestartPassed=mode!='single', States=states)
                except Exception as error: entry['Error']=str(error)
                finally:
                    entry.update(Errors=errors,MissingAssets=missing,Milliseconds=round((time.monotonic()-started)*1000,2))
                    report['Errors'].extend(errors);report['MissingAssets'].extend(missing);report['Tests'].append(entry);save()
                    context.close();print(('PASS' if entry['Passed'] else 'FAIL'),mode,aot,entry.get('Error',''),flush=True)
        browser.close()
finally: server.shutdown();server.server_close();thread.join(timeout=5)
report.update(Completed=True,Passed=sum(t['Passed'] for t in report['Tests']),Failed=sum(not t['Passed'] for t in report['Tests']),FinalSourceFingerprint=source_fingerprint(ROOT))
save();raise SystemExit(0 if report['Failed']==0 and not report['Errors'] and not report['MissingAssets'] else 1)
