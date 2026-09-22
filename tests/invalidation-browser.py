"""Assert autonomous updates, before any forced render or pointer nudge.
Real module-worker production entries, local asset loading interception only.
"""
import json,re,time,io
from PIL import Image,ImageChops
from playwright.sync_api import sync_playwright
from threading_support import ROOT,install_assets,options,browser_executable
from verification_support import source_fingerprint
out=ROOT/'artifacts/invalidation';out.mkdir(exist_ok=True)
report={'Version':json.loads((ROOT/'package.json').read_text())['version'],'SourceFingerprint':source_fingerprint(ROOT),'Completed':False,'Tests':[],'Errors':[],'MissingAssets':[],
        'Qualification':'Chromium native Skia raster; real module workers importing production startup; asset interception only. No pointer nudge or forced render before autonomous-state/pixel assertions.'}
def save():(out/'browser-results.json').write_text(json.dumps(report,indent=2)+'\n')
def demand(ok,msg):
 if not ok:raise AssertionError(msg)
def check(name,fn):
 try:ev=fn();report['Tests'].append({'Name':name,'Passed':True,'Evidence':ev});print('PASS',name,flush=True)
 except Exception as e:report['Tests'].append({'Name':name,'Passed':False,'Error':str(e)});print('FAIL',name,str(e)[:1600],flush=True)
 save()
def invoke(page,name,value=None):return page.evaluate('([n,v])=>testInvoke(n,v)',[name,value])
def state(page):return invoke(page,'State')
def wait(page,predicate,timeout=6):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  s=state(page);demand(not s['Error'],str(s['Error']))
  if predicate(s):return s
  page.wait_for_timeout(25)
 raise AssertionError('Autonomous update timed out: '+json.dumps(s))
def image(page):return Image.open(io.BytesIO(page.locator('canvas').first.screenshot())).convert('RGBA')
def crop_view(page,img=None):
 s=state(page);r=s['ContentRect'];return (img or image(page)).crop((int(r['X']),int(r['Y']),int(r['X']+r['Width']),int(r['Y']+r['Height'])))
def assert_force_identical(page,name):
 page.wait_for_timeout(120);a=image(page);invoke(page,'Force');page.wait_for_timeout(80);b=image(page);diff=ImageChops.difference(a,b);maximum=max(v[1]for v in diff.getextrema())
 if maximum:a.save(out/(name+'-before.png'));b.save(out/(name+'-forced.png'));diff.save(out/(name+'-diff.png'))
 demand(maximum==0,f'A forced redraw changed pixels (max {maximum}); autonomous invalidation did not settle.')
 return {'MaximumChannelError':maximum,'Channels':4,'Pixels':a.width*a.height}
def load(ctx,mode):
 page=ctx.new_page();page.on('pageerror',lambda e:report['Errors'].append({'Mode':mode,'Error':str(e)}))
 handler='http://localhost:4173/tests/invalidation-custom-handler.js'
 code='''import * as A from '@wieslawsoltes/avalonia';
import {CreateInvalidationFixture} from 'http://localhost:4173/tests/invalidation-fixture.js';
try {
 const options=OPTIONS;options.HandlerModules=[HANDLER];
 if(options.ThreadingMode==='full-isolation'){
  const host=await A.StartWorkerApplicationAsync(document.getElementById('app'),{...options,ApplicationModule:'http://localhost:4173/tests/invalidation-worker.js',ApplicationOptions:{HandlerModule:HANDLER}});
  globalThis.testInvoke=(n,v)=>host.InvokeAsync(n,v);globalThis.testDispose=()=>host.Dispose();
 }else{
  const root=new A.Window(),fixture=CreateInvalidationFixture(A,root,HANDLER);
  const platform=await A.SkiaPlatform.Initialize({assetBaseUrl:new URL('../vendor/',import.meta.resolve('@wieslawsoltes/skiasharpweb/browser')).href});
  await root.Attach(document.getElementById('app'),{...options,Platform:platform});
  globalThis.testInvoke=(n,v)=>fixture.Commands[n](v);globalThis.testDispose=()=>{fixture.Dispose();platform.Dispose();};
 }
 document.getElementById('loading')?.remove();globalThis.testReady=true;
}catch(e){globalThis.testError=e.stack;console.error(e);}
'''.replace('OPTIONS',options(mode)).replace('HANDLER',json.dumps(handler))
 html=(ROOT/'samples/ControlCatalog/index.html').read_text();html=html.replace('<head>','<head><base href="http://localhost:4173/samples/ControlCatalog/">');html=html.replace('<script type="module" src="./app.js"></script>','<script type="module">'+code+'</script>')
 page.set_content(html);page.wait_for_function('globalThis.testReady||globalThis.testError',timeout=60000);demand(not page.evaluate('globalThis.testError'),str(page.evaluate('globalThis.testError')));return page
with sync_playwright()as p:
 browser=p.chromium.launch(executable_path=browser_executable(),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 report['Browser']=browser.version
 for mode in ['single','render-worker','full-isolation']:
  ctx=browser.new_context(viewport={'width':640,'height':400},device_scale_factor=1);install_assets(ctx,report['MissingAssets'])
  try:
   page=load(ctx,mode)
   def resizing():
    wait(page,lambda s:s['Table']and len(s['Table']['Cells'])>0)
    invoke(page,'ResizeLater',236)
    s=wait(page,lambda s:len(s['Table']['Cells'])>0 and all(abs(c[0]['Width']-236)<.1 and abs(c[1]['X']-236)<.1 for c in s['Table']['Cells']))
    evidence=assert_force_identical(page,mode+'-timer-resize');evidence['Width']=s['Table']['Width'];return evidence
   check(mode+' timer-driven column width without input',resizing)
   def drag():
    r=state(page)['Table']['Header'];x=r['X']+236;y=r['Y']+r['Height']/2
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+42,y,steps=4);page.mouse.up()
    s=wait(page,lambda s:s['Table']['Width']>267 and all(abs(c[0]['Width']-s['Table']['Width'])<.1 and abs(c[1]['X']-s['Table']['Width'])<.1 for c in s['Table']['Cells']))
    evidence=assert_force_identical(page,mode+'-header-drag');evidence['Width']=s['Table']['Width'];evidence['PointerStayedInHeader']=True;return evidence
   check(mode+' header-only mouse drag updates all rows',drag)
   def progress():
    invoke(page,'Mount','progress');wait(page,lambda s:s['Requests']>0);a=crop_view(page);stable=state(page)['StableCalls'];page.wait_for_timeout(170);b=crop_view(page)
    maximum=max(v[1]for v in ImageChops.difference(a,b).getextrema());demand(maximum>0,'Progress pixels frozen without input');demand(mode=='single' or state(page)['StableCalls']==stable,'Unrelated stable sibling rerecorded')
    invoke(page,'Progress',False);wait(page,lambda s:s['Requests']==0);assert_force_identical(page,mode+'-progress-stop');a=state(page);page.wait_for_timeout(130);b=state(page)
    demand(a['ContentRecords']==b['ContentRecords'],'Determinate progress kept recording');return {'MovingPixels':True,'RetainedSiblingUnchanged':None if mode=='single' else True,'StoppedContentRecords':b['ContentRecords']}
   check(mode+' progress advances naturally and stops without global rerecording',progress)
   def visibility():
    invoke(page,'Progress',True);wait(page,lambda s:s['Requests']>0);invoke(page,'Show',False);wait(page,lambda s:s['Requests']==0);invoke(page,'Show',True);wait(page,lambda s:s['Requests']>0);a=crop_view(page);page.wait_for_timeout(190);b=crop_view(page);demand(max(v[1]for v in ImageChops.difference(a,b).getextrema())>0,'Animation did not resume');invoke(page,'Progress',False);return {'Resumed':True}
   check(mode+' hidden progress resumes without input',visibility)
   def transition():
    invoke(page,'Mount','transition');invoke(page,'SetTransition','#ed512c');wait(page,lambda s:s['Transition']['Opacity']==0);invoke(page,'Advance',90)
    s=wait(page,lambda s:0<s['Transition']['Opacity']<1);mid=crop_view(page);ev=assert_force_identical(page,mode+'-transition-mid');invoke(page,'Advance',220);wait(page,lambda s:s['Transition']['Opacity']==1);end=crop_view(page);demand(max(v[1]for v in ImageChops.difference(mid,end).getextrema())>0,'Transition terminal frame stale');assert_force_identical(page,mode+'-transition-end');return ev
   check(mode+' transition intermediate and final frames without hover',transition)
   def replacing():
    invoke(page,'SetTransition','#316af0');invoke(page,'Advance',60);invoke(page,'SetTransition','#22884c');invoke(page,'Advance',260);wait(page,lambda s:s['Transition']['Opacity']==1);return assert_force_identical(page,mode+'-transition-replace')
   check(mode+' overlapping transition replacement completes latest content',replacing)
   for kind in ['reentrant','cached-reentrant']:
    def reentrant(kind=kind):
     invoke(page,'Mount',kind);s=wait(page,lambda s:s['RenderCalls']>=2);pixel=crop_view(page).getpixel((20,20));demand(pixel== (0,0,255,255),'Render-time invalidation lost: '+str(pixel));return {'RenderCalls':s['RenderCalls'],**assert_force_identical(page,mode+'-'+kind)}
    check(mode+' '+kind+' invalidation survives capture',reentrant)
   if mode!='single':
    def custom():
     invoke(page,'Mount','custom');page.wait_for_timeout(400);d=invoke(page,'Diagnostics');handlers=d['Worker']['CustomHandlers'];demand(handlers and handlers[0]['Value']['Calls']>=2,'OnRender.Invalidate did not schedule another worker frame: '+json.dumps(d));demand(crop_view(page).getpixel((20,20))==(0,0,255,255),'Custom final pixels stale');return {'HandlerRenderCalls':handlers[0]['Value']['Calls']}
    check(mode+' render-side custom invalidation survives render completion',custom)
   page.locator('canvas').first.screenshot(path=str(out/(mode+'-final.png')));page.evaluate('testDispose()');page.close()
  except Exception as e:check(mode+' bootstrap/cleanup',lambda:(_ for _ in ()).throw(e))
  finally:ctx.close()
 browser.close()
report['Completed']=True;report['Passed']=sum(t['Passed']for t in report['Tests']);report['Failed']=len(report['Tests'])-report['Passed'];report['FinalSourceFingerprint']=source_fingerprint(ROOT);save();print(json.dumps({k:report[k]for k in ['Passed','Failed','Errors','MissingAssets']},indent=2));raise SystemExit(1 if report['Failed']or report['Errors']or report['MissingAssets']else 0)
