"""Navigate every catalog route in each dedicated-worker topology.
On capable browsers additionally verify real WebGL shader readback, worker-owned
canvas allocation, immutable bitmap transport and native presentation pixels.
"""
import base64,io,json,time
from PIL import Image
from playwright.sync_api import sync_playwright
from threading_support import browser_executable,ROOT,install_assets,load,invoke
from verification_support import source_fingerprint
path=ROOT/'artifacts/threading/catalog-results.json'
r={'Version':json.loads((ROOT/'package.json').read_text())['version'],'SourceFingerprint':source_fingerprint(ROOT),'Completed':False,'Tests':[],'Errors':[],'MissingAssets':[],'OpenGlQualified':[]}
def save():path.write_text(json.dumps(r,indent=2))
def capture(page,mode):
    encoded=page.evaluate('''async mode=>{const bytes=await(mode==='full-isolation'?catalogHost.CapturePngAsync():catalog.Root.CapturePngAsync());let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);}''',mode)
    return Image.open(io.BytesIO(base64.b64decode(encoded))).convert('RGBA')
def probe(page,mode):
    return invoke(page,'GetOpenGlProbe') if mode=='full-isolation' else page.evaluate('''async()=>{
        const {DescribeOpenGl}=await import('http://localhost:4173/tests/opengl-probe.js');return DescribeOpenGl(catalog.GlDemo,catalog.Root);
    }''')
def qualify_gl(page,mode,route):
    first=probe(page,mode)
    if not first['Available']:return {'CapabilitySkipped':True,'Reason':'WebGL2 context unavailable; no shader/pixel qualification claimed.'}
    assert first['Ready'] and not first['Error'],first
    assert first['Frames']>0 and first['Width']>0 and first['Height']>0,first
    assert not first['NativeHandleInUi'],'Worker transport must publish RGBA, not a native image handle'
    if mode=='full-isolation':assert first['WorkerCanvas'],'UI-worker GL must use OffscreenCanvas, not the semantic DOM'
    assert all(c>30 for c in first['Samples'][0]['Rgba'][:3]),'Missing colored shader pixels'
    evidence={'Before':first,'CapabilitySkipped':False}
    def pixels(state):
        image=capture(page,mode)
        # The interop example rotates and alpha-composites its triangle. The
        # two untransformed examples provide the independent exact RGBA check.
        if route=='OpenGLInterop':return None
        maximum=max(abs(a-b) for s in state['Samples'] for a,b in zip(image.getpixel((s['X'],s['Y'])),s['Rgba']))
        assert maximum<=2,{'MaximumChannelError':maximum,'Samples':state['Samples']}
        return maximum
    evidence['BeforeMaximumChannelError']=pixels(first)
    if mode=='full-isolation':invoke(page,'InvokeControl','GlRedraw')
    else:page.evaluate('async()=>{catalog.Page.FindControl("GlRedraw").OnClick();await catalog.Root.RenderNow();}')
    after=probe(page,mode)
    assert after['Ready'] and not after['Error'] and after['Frames']>first['Frames'],after
    assert after['PixelHash']!=first['PixelHash'],'Requested frame retained stale shader pixels'
    evidence['AfterMaximumChannelError']=pixels(after);evidence['After']=after
    r['OpenGlQualified'].append({'Mode':mode,'Route':route})
    return evidence
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=browser_executable(),headless=True,args=['--no-sandbox','--disable-dev-shm-usage']);ctx=b.new_context(viewport={'width':1200,'height':900});install_assets(ctx,r['MissingAssets'])
 r['Browser']=b.version
 # The wrapper forwards the unchanged catalog application and only adds a bounded
 # inspection RPC. The separate HTTP/startup suites use canonical app URLs.
 for mode in ['render-worker','full-isolation']:
  # Supply test-only inspection at the HTML insertion point, without editing source.
  if mode=='full-isolation':
   from threading_support import options
   page=ctx.new_page();page.on('pageerror',lambda e:r['Errors'].append(str(e)))
   boot=options(mode)[:-1]+',ApplicationModule:"http://localhost:4173/tests/opengl-worker-probe.js"}'
   page.set_content((ROOT/'samples/ControlCatalog/index.html').read_text().replace('<head>','<head><base href="http://localhost:4173/samples/ControlCatalog/"><script>globalThis.AVALONIA_BOOT_OPTIONS='+boot+';</script>'))
   page.wait_for_function('globalThis.catalogReady||globalThis.catalogError',timeout=60000);assert not page.evaluate('globalThis.catalogError')
  else:page=load(ctx,mode,r['Errors'])
  routes=page.evaluate('async()=> (await import("http://localhost:4173/samples/ControlCatalog/manifest.js")).Catalog.map(p=>p.Id)')
  for route in routes:
   start=time.monotonic()
   try:
    if mode=='full-isolation':state=invoke(page,'Navigate',route);assert not state['Errors'],state
    else:
     state=page.evaluate('async id=>{await catalog.Navigate(id);await catalog.Root.RenderNow();return{Errors:catalog.Errors,Last:catalog.Root.LastRenderError?.stack??null};}',route);assert not state['Errors']and not state['Last'],state
    gl=qualify_gl(page,mode,route) if route in ['OpenGL','OpenGLLease','OpenGLInterop'] else None
    r['Tests'].append({'Mode':mode,'Route':route,'Passed':True,'Milliseconds':round((time.monotonic()-start)*1000,1),**({'OpenGl':gl}if gl else {})});print('PASS',mode,route,flush=True)
   except Exception as e:r['Tests'].append({'Mode':mode,'Route':route,'Passed':False,'Error':str(e)});print('FAIL',mode,route,str(e)[:1800],flush=True)
   save()
  if mode=='full-isolation':page.evaluate('async()=>await catalogHost.DisposeAsync()')
  else:page.evaluate('catalog.Root.Dispose();undefined')
  page.close()
 b.close()
r['Completed']=True;r['Passed']=sum(x['Passed']for x in r['Tests']);r['Failed']=len(r['Tests'])-r['Passed'];r['FinalSourceFingerprint']=source_fingerprint(ROOT);save();print(json.dumps({k:r[k]for k in ['Passed','Failed','Errors','MissingAssets','OpenGlQualified']},indent=2));raise SystemExit(1 if r['Failed']or r['Errors']or r['MissingAssets']else 0)
