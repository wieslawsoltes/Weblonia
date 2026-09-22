"""Navigate every catalog route in each dedicated-worker topology."""
import json,time
from playwright.sync_api import sync_playwright
from threading_support import browser_executable,ROOT,install_assets,load,invoke
from verification_support import source_fingerprint
path=ROOT/'artifacts/threading/catalog-results.json'
r={'Version':json.loads((ROOT/'package.json').read_text())['version'],'SourceFingerprint':source_fingerprint(ROOT),'Completed':False,'Tests':[],'Errors':[],'MissingAssets':[]}
def save():path.write_text(json.dumps(r,indent=2))
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=browser_executable(),headless=True,args=['--no-sandbox','--disable-dev-shm-usage']);ctx=b.new_context(viewport={'width':1200,'height':900});install_assets(ctx,r['MissingAssets'])
 for mode in ['render-worker','full-isolation']:
  page=load(ctx,mode,r['Errors']);routes=page.evaluate('async()=> (await import("http://localhost:4173/samples/ControlCatalog/manifest.js")).Catalog.map(p=>p.Id)')
  for route in routes:
   start=time.monotonic()
   try:
    if mode=='full-isolation':state=invoke(page,'Navigate',route);assert not state['Errors'],state
    else:
     state=page.evaluate('async id=>{await catalog.Navigate(id);await catalog.Root.RenderNow();return{Errors:catalog.Errors,Last:catalog.Root.LastRenderError?.stack??null};}',route);assert not state['Errors']and not state['Last'],state
    r['Tests'].append({'Mode':mode,'Route':route,'Passed':True,'Milliseconds':round((time.monotonic()-start)*1000,1)});print('PASS',mode,route,flush=True)
   except Exception as e:r['Tests'].append({'Mode':mode,'Route':route,'Passed':False,'Error':str(e)});print('FAIL',mode,route,str(e)[:1800],flush=True)
   save()
  if mode=='full-isolation':page.evaluate('async()=>await catalogHost.DisposeAsync()')
  else:page.evaluate('catalog.Root.Dispose();undefined')
  page.close()
 b.close()
r['Completed']=True;r['Passed']=sum(x['Passed']for x in r['Tests']);r['Failed']=len(r['Tests'])-r['Passed'];r['FinalSourceFingerprint']=source_fingerprint(ROOT);save();print(json.dumps({k:r[k]for k in ['Passed','Failed','Errors','MissingAssets']},indent=2));raise SystemExit(1 if r['Failed']or r['Errors']or r['MissingAssets']else 0)
