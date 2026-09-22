# Module-worker qualification. The data URL contains one static import of the
# unmodified production entry; it adds no message listener, queue, or replay.
# Only asset loading is intercepted because ordinary navigation is policy-blocked.
from pathlib import Path
from urllib.parse import urlparse,unquote
import json,mimetypes,base64,io,os
from PIL import Image
ROOT=Path(__file__).resolve().parent.parent

def browser_executable():
 candidate=Path(os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'))
 return str(candidate)if candidate.is_file()else None

def install_assets(context,missing,test_font=None):
 def asset(route):
  if urlparse(route.request.url).path=='/__thread_test_font__'and test_font is not None:
   route.fulfill(body=Path(test_font).read_bytes(),headers={'Content-Type':'application/octet-stream','Access-Control-Allow-Origin':'*'});return
  file=(ROOT/unquote(urlparse(route.request.url).path).lstrip('/')).resolve()
  if file.is_relative_to(ROOT)and file.is_file():route.fulfill(body=file.read_bytes(),headers={'Content-Type':'application/wasm'if file.suffix=='.wasm'else'text/javascript'if file.suffix in ['.js','.mjs','.cjs']else mimetypes.guess_type(str(file))[0]or'application/octet-stream','Access-Control-Allow-Origin':'*'})
  else:missing.append(str(file));route.fulfill(status=404,body='missing')
 context.route('http://localhost:4173/**',asset)
def options(mode):
 def module_entry(name):
  code='import "http://localhost:4173/packages/browser/worker-assets/'+name+'.js";'
  return '"data:text/javascript,"+encodeURIComponent('+json.dumps(code)+')'
 return '{Backend:"canvas",ThreadingMode:'+json.dumps(mode)+',RenderWorkerUrl:'+module_entry('render')+',UiWorkerUrl:'+module_entry('ui')+'}'
def load(context,mode,errors):
 page=context.new_page();page.on('pageerror',lambda e:errors.append({'Mode':mode,'Error':str(e)}))
 page.set_content((ROOT/'samples/ControlCatalog/index.html').read_text().replace('<head>','<head><base href="http://localhost:4173/samples/ControlCatalog/"><script>globalThis.AVALONIA_BOOT_OPTIONS='+options(mode)+';</script>'))
 page.wait_for_function('globalThis.catalogReady||globalThis.catalogError',timeout=60000)
 error=page.evaluate('globalThis.catalogError')
 if error:raise AssertionError(error)
 return page

def invoke(page,command,value=None):return page.evaluate('async([c,v])=>await catalogHost.InvokeAsync(c,v)',[command,value])
def png(page,fast=False):
 data=page.evaluate('''async fast=>{const bytes=await(fast?catalogHost.CaptureRenderedFrameAsync():catalogHost.CapturePngAsync());let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);}''',fast)
 return Image.open(io.BytesIO(base64.b64decode(data))).convert('RGBA')
