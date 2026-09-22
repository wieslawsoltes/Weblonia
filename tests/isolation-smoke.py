from pathlib import Path
from urllib.parse import urlparse,unquote
import json,mimetypes
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 context=b.new_context(viewport={'width':1200,'height':900});page=context.new_page()
 page.on('console',lambda m:print(m.type,m.text[:900],flush=True) if m.type in ['error','warning'] else None)
 page.on('pageerror',lambda e:print('PAGEERROR',e,flush=True))
 missing=[]
 def asset(route):
  path=(root/unquote(urlparse(route.request.url).path).lstrip('/')).resolve()
  if path.is_relative_to(root) and path.is_file():route.fulfill(body=path.read_bytes(),headers={'Content-Type':'application/wasm' if path.suffix=='.wasm' else 'text/javascript' if path.suffix in ['.js','.mjs','.cjs'] else mimetypes.guess_type(str(path))[0] or 'application/octet-stream','Access-Control-Allow-Origin':'*'})
  else:missing.append(str(path));route.fulfill(status=404,body='missing')
 context.route('http://localhost:4173/**',asset)
 inject='''<script>globalThis.AVALONIA_BOOT_OPTIONS={InitializationTimeout:20000,Backend:'canvas',ThreadingMode:'full-isolation',UiWorkerType:'classic',UiWorkerUrl:URL.createObjectURL(new Blob(['let q=[];self.onmessage=e=>q.push(e);import("http://localhost:4173/packages/browser/worker-assets/ui.js").then(()=>{for(const e of q)self.onmessage(e);}).catch(e=>self.postMessage({Type:"bootstrap-error",Error:e.stack}));'],{type:'text/javascript'})),WorkerType:'classic',RenderWorkerUrl:URL.createObjectURL(new Blob(['let q=[];self.onmessage=e=>q.push(e);import("http://localhost:4173/packages/browser/worker-assets/render.js").then(()=>{for(const e of q)self.onmessage(e);}).catch(e=>self.postMessage({Type:"bootstrap-error",Error:e.stack}));'],{type:'text/javascript'}))};</script>'''
 html=(root/'samples/ControlCatalog/index.html').read_text().replace('<head>','<head><base href="http://localhost:4173/samples/ControlCatalog/">'+inject)
 page.set_content(html)
 try:
  page.wait_for_function('window.catalogReady || window.catalogError',timeout=30000)
  print('STATE',page.evaluate('({ready:window.catalogReady,error:window.catalogError})'),flush=True)
  if page.evaluate('!!window.catalogReady'):
   print('DIAG',json.dumps(page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()'),indent=2),flush=True)
   page.wait_for_timeout(2000)
   print('DIAG2',json.dumps(page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()'),indent=2),flush=True)
   print('STATE',page.evaluate('async()=>await catalogHost.InvokeAsync("GetState")'),flush=True)
   page.screenshot(path=str(root/'artifacts/threading/isolation-overview.png'))
   page.evaluate('async()=>{await Promise.race([catalogHost.InvokeAsync("Navigate","TableView"),new Promise((r,j)=>setTimeout(()=>j(Error("navigate timeout")),6000))]);return true}');print('TABLE',json.dumps(page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()'),indent=2),flush=True)
   page.screenshot(path=str(root/'artifacts/threading/isolation-table.png'))
 except Exception as e:print('ERROR',e,flush=True)
 print('MISSING',missing,flush=True)
 b.close()
