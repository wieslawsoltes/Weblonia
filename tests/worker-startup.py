"""Production-entry startup regression for both thread modes.

Default: a real module Worker whose entire data-URL entry is one static import of
our unmodified production entry. No test queue, delayed initialize, fake Worker,
message replay, or runtime shim. Source, dist and nested deployment paths are
served as local intercepted assets under the browser's existing policies.

--http: run the actual development and dist HTTP servers, ordinary page.goto,
canonical worker URLs, and zero interception. Exit 2 explicitly records a browser
policy block; it must never be reported as a successful HTTP qualification.
"""
from pathlib import Path
from urllib.parse import unquote, urlparse
from playwright.sync_api import sync_playwright
from threading_support import browser_executable
from verification_support import source_fingerprint
import argparse, base64, hashlib, io, json, mimetypes, os, socket, subprocess, time, urllib.request
from PIL import Image

ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--http',action='store_true')
parser.add_argument('--filter',default='')
args=parser.parse_args()
OUT=ROOT/'artifacts/threading';OUT.mkdir(exist_ok=True,parents=True)
REPORT=OUT/('http-startup-results.json' if args.http else 'startup-results.json')
r={'Version':json.loads((ROOT/'package.json').read_text())['version'], 'SourceFingerprint':source_fingerprint(ROOT),
   'Completed':False,'Tests':[],'Errors':[],'MissingAssets':[],'ExpectedFailureCases':[],
   'WorkerType':'module','TestMessageQueue':False,'InitializationReplay':False,'PoliciesChanged':False,
   'Transport':'ordinary-http' if args.http else 'intercepted-local-assets; data module imports unchanged production entry'}
def save(): REPORT.write_text(json.dumps(r,indent=2)+'\n')
def check(name,action):
 if args.filter and args.filter not in name:return
 start=time.monotonic()
 try:
  evidence=action();r['Tests'].append({'Name':name,'Passed':True,'Milliseconds':round((time.monotonic()-start)*1000,2),'Evidence':evidence});print('PASS',name,flush=True)
 except Exception as e:
  r['Tests'].append({'Name':name,'Passed':False,'Error':str(e)});print('FAIL',name,str(e)[:1200],flush=True)
 save()
def demand(ok,message):
 if not ok: raise AssertionError(message)

def options(mode,origin,prefix,extra):
 entries={name:'import '+json.dumps(origin+prefix+'packages/browser/worker-assets/'+name+'.js')+';' for name in ['render','ui']}
 return '{'+','.join([f'ThreadingMode:{json.dumps(mode)}','Backend:"canvas"','InitializationTimeout:10000',
  'RenderWorkerUrl:"data:text/javascript,"+encodeURIComponent('+json.dumps(entries['render'])+')',
  'UiWorkerUrl:"data:text/javascript,"+encodeURIComponent('+json.dumps(entries['ui'])+')',
  *(json.dumps(k)+':'+json.dumps(v) for k,v in extra.items())])+'}'

def run_case(browser,mode,variant='source',failure=None,slow=False,backend='canvas'):
 site=ROOT if variant=='source' else ROOT/'dist';prefix='/nested/app/' if variant=='nested' else '/'
 app='samples/ControlCatalog/' if variant=='source' else ''
 origin='http://localhost:4173';context=browser.new_context(viewport={'width':1200,'height':900},device_scale_factor=1.25)
 errors=[];missing=[];expected=[];requests=[];extra={'Backend':backend};started=time.monotonic()
 if failure=='loader':extra['LoaderUrl']=origin+prefix+'__missing_loader__.mjs'
 if failure=='pending':extra.update(LoaderUrl=origin+prefix+'__pending_loader__.mjs',InitializationTimeout=2000)
 if failure=='application':extra['ApplicationModule']=origin+prefix+'__missing_application__.js'
 def asset(route):
  relative=unquote(urlparse(route.request.url).path)
  if not relative.startswith(prefix):missing.append(relative);route.fulfill(status=404,body='outside deployment');return
  relative=relative[len(prefix):];file=(site/relative).resolve();requests.append(relative)
  if relative=='__pending_loader__.mjs':route.fulfill(body='export default () => new Promise(() => {});',content_type='text/javascript',headers={'Access-Control-Allow-Origin':'*'});return
  fail=(relative in ['__missing_loader__.mjs','__missing_application__.js'] or failure=='graph' and relative=='packages/browser/worker-assets/packages/browser/src/render-worker.js')
  if fail:expected.append(relative);route.fulfill(status=404,body='deliberate missing asset',headers={'Access-Control-Allow-Origin':'*'});return
  if file.is_relative_to(site) and file.is_file():
   body=file.read_bytes()
   if slow and '/worker-assets/' in '/'+relative and relative.endswith('/font-instance.js'):
    body=b'await new Promise(resolve => setTimeout(resolve, 250));\n'+body
   route.fulfill(body=body,headers={'Content-Type':'application/wasm' if file.suffix=='.wasm' else 'text/javascript' if file.suffix in ['.js','.mjs','.cjs'] else mimetypes.guess_type(str(file))[0] or 'application/octet-stream','Access-Control-Allow-Origin':'*'})
  else:missing.append(relative);route.fulfill(status=404,body='missing',headers={'Access-Control-Allow-Origin':'*'})
 context.route(origin+'/**',asset);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 try:
  html=(site/app/'index.html').read_text().replace('<head>','<head><base href="'+origin+prefix+app+'"><script>globalThis.AVALONIA_BOOT_OPTIONS='+options(mode,origin,prefix,extra)+';</script>')
  page.set_content(html);page.wait_for_function('globalThis.catalogReady||globalThis.catalogError',timeout=20000)
  state=page.evaluate('({Ready:!!globalThis.catalogReady,Error:globalThis.catalogError??null})')
  if failure:
   demand(not state['Ready'] and state['Error'],'Failure was not surfaced')
   if failure=='pending':demand('timed out' in state['Error'] and 'wasm-initialization' in state['Error'],state['Error'])
   else:demand('timed out' not in state['Error'] and 'startup failed' in state['Error'],state['Error'])
   page.wait_for_timeout(200);demand(not page.workers,'Failed startup leaked a worker')
   r['ExpectedFailureCases'].append({'Mode':mode,'Failure':failure,'Error':state['Error'],'Expected404':expected})
   return {'ReportedImmediately':failure!='pending','DetailedTimeoutStage':failure=='pending','LiveWorkersAfterFailure':len(page.workers),'Error':state['Error']}
  demand(state['Ready'] and not state['Error'],state['Error'])
  elapsed=round((time.monotonic()-started)*1000,2)
  expected_workers=2 if mode=='full-isolation' else 1;demand(len(page.workers)==expected_workers,'Incorrect worker count')
  diagnostics=page.evaluate("async mode=>mode==='full-isolation'?await catalogHost.GetDiagnosticsAsync():await catalog.Root.Renderer.GetDiagnosticsAsync()",mode)
  render=diagnostics['Renderer'] if mode=='full-isolation' else diagnostics
  demand(render['Worker']['HasDocument']==False,'Rendering did not run on a worker')
  if mode=='full-isolation':demand(diagnostics['UI']['HasDocument']==False,'UI did not run on a worker')
  page.evaluate("async mode=>{if(mode==='full-isolation')await catalogHost.InvokeAsync('Navigate','TableView');else{await catalog.Navigate('TableView');await catalog.Root.RenderNow();}}",mode)
  encoded=page.evaluate("""async mode=>{const a=mode==='full-isolation'?await catalogHost.CapturePngAsync():await catalog.Root.CapturePngAsync();let s='';for(let i=0;i<a.length;i+=16384)s+=String.fromCharCode(...a.subarray(i,i+16384));return btoa(s)}""",mode)
  data=base64.b64decode(encoded);image=Image.open(io.BytesIO(data)).convert('RGBA');demand(any(lo!=hi for lo,hi in image.getextrema()[:3]),'Presented frame is blank')
  if variant=='source' and not slow and backend=='canvas':page.screenshot(path=str(OUT/(mode+'-startup-fixed.png')))
  phase=page.evaluate("mode=>mode==='full-isolation'?catalogHost.Startup:catalog.Root.Renderer.Startup",mode)
  if mode=='full-isolation':demand(phase['ui']['Stage']=='ready' and phase['render']['Stage']=='ready',str(phase))
  else:demand(phase['Stage']=='ready',str(phase))
  # Restart exercises the same real module entry with a new canvas/port generation.
  page.evaluate("async mode=>{if(mode==='full-isolation')await catalogHost.RestartRendererAsync();else await catalog.Root.Renderer.RestartAsync();}",mode)
  demand(not missing,'Unexpected assets missing: '+str(missing));demand(not errors,str(errors))
  return {'StartupMilliseconds':elapsed,'WorkerCount':expected_workers,'RequestedBackend':backend,'SelectedBackend':render['Worker']['Target']['SelectedBackend'],
          'Width':image.width,'Height':image.height,'PngSha256':hashlib.sha256(data).hexdigest(),'RestartPassed':True,'Startup':phase,
          'EntryRequests':[p for p in requests if p.endswith('/worker-assets/render.js') or p.endswith('/worker-assets/ui.js')], 'DelayedDependencyMilliseconds':250 if slow else 0}
 finally:
  r['Errors'].extend(errors);r['MissingAssets'].extend(missing);context.close()

def http_case(browser,mode,dist):
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 url=f'http://127.0.0.1:{port}/?threading={mode}&backend=canvas'
 server=subprocess.Popen(['node','scripts/serve.mjs']+(['--dist']if dist else []),cwd=ROOT,env={**os.environ,'PORT':str(port)},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 page=None
 try:
  for _ in range(100):
   if server.poll() is not None:raise RuntimeError('HTTP server stopped')
   try:
    with urllib.request.urlopen(url,timeout=.5)as response:status=response.status;break
   except OSError:time.sleep(.03)
  else:raise RuntimeError('HTTP server not responding')
  page=browser.new_page();page.on('pageerror',lambda e:r['Errors'].append(str(e)));response=page.goto(url,timeout=15000)
  page.wait_for_function('globalThis.catalogReady||globalThis.catalogError',timeout=60000)
  state=page.evaluate('({Ready:!!globalThis.catalogReady,Error:globalThis.catalogError??null})');demand(state['Ready'] and not state['Error'],str(state))
  return {'Url':url,'HttpStatus':status,'NavigationStatus':response.status,'Interception':False,'CanonicalWorkerUrls':[w.url for w in page.workers]}
 finally:
  if page:page.close()
  server.terminate()
  try:server.wait(timeout=5)
  except subprocess.TimeoutExpired:server.kill();server.wait()

save()
with sync_playwright()as p:
 browser=p.chromium.launch(executable_path=browser_executable(),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 r['Browser']=browser.version
 try:
  if args.http:
   for dist in [False,True]:
    for mode in ['render-worker','full-isolation']:check(('dist'if dist else'source')+' HTTP '+mode,lambda mode=mode,dist=dist:http_case(browser,mode,dist))
  else:
   for variant in ['source','dist','nested']:
    for mode in ['render-worker','full-isolation']:check(variant+' module startup, nonblank TableView and restart '+mode,lambda mode=mode,variant=variant:run_case(browser,mode,variant))
   for mode in ['render-worker','full-isolation']:
    check('delayed top-level-await dependency '+mode,lambda mode=mode:run_case(browser,mode,slow=True))
    check('automatic backend selection '+mode,lambda mode=mode:run_case(browser,mode,backend='auto'))
    for failure in ['loader','graph','pending']:
     check('fail fast and release workers: '+mode+'/'+failure,lambda mode=mode,failure=failure:run_case(browser,mode,failure=failure))
   check('invalid isolated application import releases both workers',lambda:run_case(browser,'full-isolation',failure='application'))
 finally:browser.close()
r['Completed']=True;r['Passed']=sum(t['Passed']for t in r['Tests']);r['Failed']=len(r['Tests'])-r['Passed'];r['FinalSourceFingerprint']=source_fingerprint(ROOT)
r['BlockedByBrowserPolicy']=args.http and any('ERR_BLOCKED_BY_ADMINISTRATOR'in t.get('Error','')for t in r['Tests'])
save();print(json.dumps({k:r[k]for k in ['Passed','Failed','Errors','MissingAssets','BlockedByBrowserPolicy']},indent=2))
raise SystemExit(2 if r['BlockedByBrowserPolicy'] else 1 if r['Failed']or r['Errors']or r['MissingAssets']else 0)
