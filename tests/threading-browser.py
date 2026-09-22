"""Real dedicated workers, native Skia, direct UI/render MessagePort, no policy changes.
Real module workers statically import the unchanged production entry. The test
entry has no queue/replay; production owns startup before asynchronous loading.
"""
from pathlib import Path
from urllib.parse import urlparse,unquote
import json,mimetypes,time,base64,io,hashlib
from PIL import Image,ImageChops
from playwright.sync_api import sync_playwright
from threading_support import browser_executable
from verification_support import source_fingerprint
root=Path(__file__).resolve().parent.parent
out=root/'artifacts/threading';out.mkdir(exist_ok=True)
report={'Version':json.loads((root/'package.json').read_text())['version'],'SourceFingerprint':source_fingerprint(root),'Completed':False,'Tests':[],'Errors':[],'MissingAssets':[],'Qualification':'Chromium native raster; real dedicated workers; real module workers importing unchanged production entries through intercepted local assets; ordinary HTTP navigation is separately tested.'}
def save(): (out/'browser-results.json').write_text(json.dumps(report,indent=2))
def check(name,action):
 try:
  value=action();report['Tests'].append({'Name':name,'Passed':True,'Evidence':value});print('PASS',name,flush=True)
 except Exception as e: report['Tests'].append({'Name':name,'Passed':False,'Error':str(e)});print('FAIL',name,str(e)[:1500],flush=True)
 save()
def demand(ok,msg):
 if not ok:raise AssertionError(msg)
from threading_support import options
def load(context,mode):
 page=context.new_page();page.on('pageerror',lambda e:report['Errors'].append({'Mode':mode,'Error':str(e)}))
 html=(root/'samples/ControlCatalog/index.html').read_text().replace('<head>','<head><base href="http://localhost:4173/samples/ControlCatalog/"><script>globalThis.AVALONIA_BOOT_OPTIONS='+options(mode)+';</script>')
 page.set_content(html);page.wait_for_function('globalThis.catalogReady||globalThis.catalogError',timeout=60000);error=page.evaluate('globalThis.catalogError');demand(not error,error);return page
async_jscode=''
def nav(page,mode,route):
 page.evaluate('async ([mode,route])=>{if(mode==="full-isolation")await catalogHost.InvokeAsync("Navigate",route);else{await catalog.Navigate(route);await catalog.Root.RenderNow();}return true}',[mode,route])
def pixels(page,mode):
 data=page.evaluate('''async mode=>{const bytes=mode==='full-isolation'?await catalogHost.CapturePngAsync():await catalog.Root.CapturePngAsync();let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);}''',mode)
 return Image.open(io.BytesIO(base64.b64decode(data))).convert('RGBA')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=browser_executable(),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 context=browser.new_context(viewport={'width':1200,'height':900})
 def asset(route):
  file=(root/unquote(urlparse(route.request.url).path).lstrip('/')).resolve()
  if file.is_relative_to(root)and file.is_file():route.fulfill(body=file.read_bytes(),headers={'Content-Type':'application/wasm' if file.suffix=='.wasm' else 'text/javascript' if file.suffix in ['.js','.mjs','.cjs'] else mimetypes.guess_type(str(file))[0]or'application/octet-stream','Access-Control-Allow-Origin':'*'})
  else:report['MissingAssets'].append(str(file));route.fulfill(status=404,body='missing')
 context.route('http://localhost:4173/**',asset)
 pages={m:load(context,m)for m in ['single','render-worker','full-isolation']}
 for mode in ['render-worker','full-isolation']:
  page=pages[mode]
  def diag():
   d=page.evaluate("async mode=>mode==='full-isolation'?await catalogHost.GetDiagnosticsAsync():await catalog.Root.Renderer.GetDiagnosticsAsync()",mode)
   renderer=d['Renderer']if mode=='full-isolation'else d
   demand(renderer['Worker']['HasDocument']==False,'Render worker must not own document')
   if mode=='full-isolation':demand(d['UI']['HasDocument']==False,'UI worker must not own document')
   demand(renderer['UI']['MaxInFlight']==1,'Only one composition transaction in flight')
   return d
  check(mode+' actual worker ownership',diag)
 for route in ['TableView','TextBlock','ScrollViewer','Image','Acrylic','Composition','BitmapCache']:
  for mode,page in pages.items():
   check(mode+' navigate '+route,lambda page=page,mode=mode:nav(page,mode,route))
  reference=pixels(pages['single'],'single').crop((0,0,1200,865))
  for mode in ['render-worker','full-isolation']:
   def compare(mode=mode):
    actual=pixels(pages[mode],mode).crop((0,0,1200,865));diff=ImageChops.difference(reference,actual);maximum=max(v[1]for v in diff.getextrema());changed=sum(1 for px in diff.getdata()if max(px)>2)
    if maximum>2:diff.save(out/(mode+'-'+route+'-difference.png'));actual.save(out/(mode+'-'+route+'.png'));reference.save(out/('reference-'+route+'.png'))
    demand(maximum<=2,f'RGBA mismatch max={maximum} pixelsAbove2={changed}')
    return{'MaximumChannelError':maximum,'PixelsAboveTolerance':changed,'Channels':4}
   check(mode+' RGBA '+route,compare)
 # A real animation must advance on the render worker while the UI worker stalls.
 page=pages['full-isolation']
 def independent():
  page.evaluate('async()=>await catalogHost.InvokeAsync("StartAnimation")')
  page.wait_for_timeout(120)
  before=page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()')
  page.evaluate('globalThis.stallTask=catalogHost.InvokeAsync("Stall",650);undefined')
  start=time.monotonic();page.evaluate('()=>{globalThis.hostResponsive=true;return true}')
  latency=(time.monotonic()-start)*1000
  page.wait_for_timeout(800)
  after=page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()')
  a=before['Renderer'];b=after['Renderer'];delta=b['Worker']['WorkerFrames']-a['Worker']['WorkerFrames'];ticks=b['Worker']['Scene']['AnimationTicks']-a['Worker']['Scene']['AnimationTicks']
  demand(delta>=5 and ticks>=5,'Committed animation did not continue independently')
  demand(latency<250,'Main browser host was blocked by UI workload')
  page.evaluate('async()=>await catalogHost.InvokeAsync("StopAnimation")')
  return{'FramesDuringAndAroundStall':delta,'AnimationTicks':ticks,'HostRoundtripMilliseconds':latency,'UIStallMilliseconds':650,'TransactionsBefore':a['UI']['SentTransactions'],'TransactionsAfter':b['UI']['SentTransactions']}
 check('three threads: animation continues through UI stall',independent)
 def editor():
  page.evaluate('async()=>await catalogHost.InvokeAsync("Navigate","TextBox")')
  # Focus by name from sample XAML; edit is delivered through the native bridge.
  names=page.evaluate('async()=>await catalogHost.InvokeAsync("GetControl","NameEditor")');return names
 check('three threads: control query',editor)
 for mode,page in pages.items():page.close()
 browser.close()
report['Completed']=True;report['Passed']=sum(t['Passed']for t in report['Tests']);report['Failed']=len(report['Tests'])-report['Passed'];report['FinalSourceFingerprint']=source_fingerprint(root);save();print(json.dumps({'Passed':report['Passed'],'Failed':report['Failed'],'Errors':report['Errors'],'Missing':report['MissingAssets']},indent=2))
raise SystemExit(1 if report['Failed']or report['Errors']or report['MissingAssets']else 0)
