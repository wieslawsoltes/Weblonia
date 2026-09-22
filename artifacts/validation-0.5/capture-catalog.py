"""Capture the built runtime after actual scrollbar dragging, without network assets."""
from pathlib import Path
from urllib.parse import unquote,urlparse
from playwright.sync_api import sync_playwright
import json,mimetypes,os
root=Path(__file__).resolve().parents[2];dist=root/'dist';shots=root/'artifacts/screenshots';errors=[];missing=[];results=[]
with sync_playwright() as p:
    kwargs={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
    executable=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium')
    if Path(executable).is_file():kwargs['executable_path']=executable
    browser=p.chromium.launch(**kwargs);context=browser.new_context(viewport={'width':1440,'height':1050},device_scale_factor=1.25)
    def asset(route):
        f=(dist/unquote(urlparse(route.request.url).path).lstrip('/')).resolve()
        if not f.is_relative_to(dist) or not f.is_file():missing.append(str(f));route.fulfill(status=404,body='Missing');return
        mime='application/wasm' if f.suffix=='.wasm' else 'text/javascript' if f.suffix in ('.js','.mjs') else mimetypes.guess_type(str(f))[0] or 'application/octet-stream'
        route.fulfill(body=f.read_bytes(),headers={'Content-Type':mime,'Access-Control-Allow-Origin':'*'})
    context.route('http://localhost:4173/**',asset);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content((dist/'index.html').read_text().replace('<head>','<head><base href="http://localhost:4173/">'))
    page.wait_for_function('window.catalogReady || window.catalogError',timeout=60000)
    assert page.evaluate('!!catalogReady'),page.evaluate('window.catalogError')
    for route,name,file in [('ScrollViewer','DemoScrollViewer','scrollviewer-interactive'),('TextBox','LongDocumentEditor','multiline-editor-scrolled')]:
        page.evaluate('async id=>{await catalog.Navigate(id);return true;}',route);page.wait_for_timeout(150)
        page.evaluate('''async name=>{const c=catalog.Page.FindControl(name),parent=c.GetVisualAncestors().find(x=>x instanceof catalogApi.ScrollViewer);parent?.BringIntoView(c);await catalog.Root.RenderNow();return true;}''',name);page.wait_for_timeout(100)
        for orientation in ['Vertical','Horizontal']:
            g=page.evaluate('''([name,o])=>{const A=catalogApi,c=catalog.Page.FindControl(name),b=c[o+'ScrollBar'],t=b.GetThumbBounds(),p=b.GetTransformToRoot().Transform(new A.Point(t.X+t.Width/2,t.Y+t.Height/2));return {x:p.X,y:p.Y,travel:b.GetTrackGeometry().Travel,visible:b.IsVisible};}''',[name,orientation])
            if g['visible'] and g['travel']>0:
                page.mouse.move(g['x'],g['y']);page.mouse.down();page.mouse.move(g['x']+(g['travel']*.35 if orientation=='Horizontal' else 0),g['y']+(g['travel']*.45 if orientation=='Vertical' else 0),steps=9);page.mouse.up();page.wait_for_timeout(120)
        state=page.evaluate('''name=>{const c=catalog.Page.FindControl(name),o=c.Offset??c.ScrollOffset;return {Offset:{X:o.X,Y:o.Y},Vertical:c.VerticalScrollBar.IsVisible,Horizontal:c.HorizontalScrollBar.IsVisible,RenderError:String(catalog.Root.LastRenderError??'')};}''',name)
        assert not state['RenderError'],state
        page.screenshot(path=str(shots/(file+'.png')));results.append({'Page':route,**state})
    page.evaluate('catalog.Root.Dispose()');browser.close()
assert not errors and not missing,(errors,missing)
report={'Version':json.loads((root/'package.json').read_text())['version'],'Mode':'local-asset-interception','DeviceScale':1.25,'PageErrors':errors,'MissingAssets':missing,'Pages':results}
(root/'artifacts/validation-0.5/capture-catalog.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
