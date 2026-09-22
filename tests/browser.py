"""Chromium integration tests. Install: python -m pip install -r tests/requirements.txt.
Default uses local asset interception (no external requests). --url tests a real HTTP server.
No browser policy is modified. Native Skia WASM and actual pointer/keyboard events are used.
"""
from pathlib import Path
from urllib.parse import urlparse, unquote
from playwright.sync_api import sync_playwright
import argparse, json, mimetypes, os, time, traceback
from datetime import datetime, timezone
from verification_support import source_fingerprint

parser = argparse.ArgumentParser()
parser.add_argument('--url', help='Actual HTTP URL of the built ControlCatalog (optional).')
parser.add_argument('--chromium', default=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'))
parser.add_argument('--extensions-only', action='store_true', help='Skip catalog sweep while debugging extended integration checks.')
parser.add_argument('--software-webgl', action='store_true', help='Qualify WebGL2 on SwiftShader, not physical hardware.')
parser.add_argument('--dist', action='store_true', help='Test the standalone distribution rather than source assets.')
args = parser.parse_args()
project = Path(__file__).resolve().parent.parent
root = project / 'dist' if args.dist else project
out = project / 'artifacts'
shots = out / 'screenshots'
shots.mkdir(parents=True, exist_ok=True)
report = {'mode': 'http-navigation' if args.url else 'local-asset-interception', 'distribution': args.dist, 'tests': [], 'pageErrors': [], 'consoleErrors': [], 'missingAssets': [], 'hardwareGPUQualified': False}
started = time.monotonic()
report.update({'version': json.loads((project/'package.json').read_text())['version'], 'startedAt': datetime.now(timezone.utc).isoformat(), 'completed': False})
report['sourceFingerprint']=source_fingerprint(project)
report_path = out / ('browser-software-webgl-results.json' if args.software_webgl else 'browser-focused-results.json' if args.extensions_only else 'browser-results.json')
def checkpoint():
    report['elapsedSeconds'] = round(time.monotonic()-started, 2)
    report['passed'] = sum(t['passed'] for t in report['tests'])
    report['skipped'] = sum(bool(t.get('skipped')) for t in report['tests'])
    report['failed'] = len(report['tests'])-report['passed']-report['skipped']
    temporary = report_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(report, indent=2)+'\n')
    temporary.replace(report_path)
checkpoint()

def check(name, action):
    start = time.monotonic()
    try:
        report['currentTest'] = name; checkpoint()
        print('RUN', name, flush=True)
        value = action()
        if value is False:
            raise AssertionError('Check returned false')
        report['tests'].append({'name': name, 'passed': True, 'milliseconds': round((time.monotonic()-start)*1000, 2)})
        print('PASS', name, flush=True)
    except Exception as e:
        report['tests'].append({'name': name, 'passed': False, 'error': str(e), 'milliseconds': round((time.monotonic()-start)*1000, 2)})
        print('FAIL', name, str(e), flush=True)
    report['currentTest'] = None; checkpoint()

def skip(name, reason):
    report['tests'].append({'name': name, 'passed': False, 'skipped': True, 'reason': reason})
    print('SKIP', name, reason, flush=True)
    checkpoint()

def require(value, message='Assertion failed'):
    if not value: raise AssertionError(message)
    return True

with sync_playwright() as pw:
    launch = {'headless': True, 'args': ['--no-sandbox', '--disable-dev-shm-usage']}
    if args.software_webgl:
        launch['args'] += ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    report['softwareWebGLRequested'] = args.software_webgl
    report['catalogSweepSkipped'] = args.extensions_only
    if Path(args.chromium).is_file(): launch['executable_path'] = args.chromium
    browser = pw.chromium.launch(**launch)
    context = browser.new_context(viewport={'width': 1440, 'height': 1050})
    page = context.new_page()
    page.on('pageerror', lambda e: report['pageErrors'].append(str(e)))
    page.on('console', lambda m: report['consoleErrors'].append(m.text) if m.type == 'error' else None)
    def asset(route):
        path = (root / unquote(urlparse(route.request.url).path).lstrip('/')).resolve()
        if path.is_relative_to(root) and path.is_file():
            mime = 'application/wasm' if path.suffix == '.wasm' else 'text/javascript' if path.suffix in ('.js', '.mjs') else mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
            route.fulfill(body=path.read_bytes(), headers={'Access-Control-Allow-Origin': '*', 'Content-Type': mime})
        else:
            report['missingAssets'].append(str(path)); route.fulfill(status=404, body='Not found')
    if args.url:
        page.add_init_script("globalThis.AVALONIA_THREADING = 'single';")
        page.goto(args.url)
    else:
        context.route('http://localhost:4173/**', asset)
        entry = 'index.html' if args.dist else 'samples/ControlCatalog/index.html'
        base = 'http://localhost:4173/' if args.dist else 'http://localhost:4173/samples/ControlCatalog/'
        page.set_content((root/entry).read_text().replace('<head>', f'<head><script>globalThis.AVALONIA_THREADING="single";</script><base href="{base}">'))
    page.wait_for_function('window.catalogReady || window.catalogError', timeout=60000)
    check('native Skia catalog startup', lambda: require(page.evaluate('!!window.catalogReady'), page.evaluate('window.catalogError || "startup failed"')))
    if page.evaluate('!!window.catalogReady'):
        report['browser'] = browser.version
        report['backend'] = page.evaluate('window.catalog.Root.Renderer.Backend')
        report['facadeExports'] = page.evaluate('Object.keys(window.catalogApi).length')
        def go(id):
            page.evaluate('async id => { await window.catalog.Navigate(id); return true; }', id)
            page.wait_for_timeout(70)
            require(page.evaluate('!window.catalog.Root.LastRenderError'), page.evaluate('window.catalog.Root.LastRenderError?.stack || "render error"'))
        def coords(name, x=.5, y=.5, shell=False):
            return page.evaluate('args => { const [name,x,y,shell] = args, A=window.catalogApi, c=shell ? window.catalog.Find(name) : window.catalog.Page.FindControl(name); if (!c) throw new Error(`Missing control ${name}`); const p=c.GetTransformToRoot().Transform(new A.Point(c.Bounds.Width*x,c.Bounds.Height*y)); return {x:p.X,y:p.Y}; }', [name,x,y,shell])
        def click(name, x=.5, y=.5, shell=False):
            p=coords(name,x,y,shell); page.mouse.click(p['x'],p['y']); page.wait_for_timeout(100)
        def snapshot(name): page.screenshot(path=str(shots/f'{name}.png'))
        page.wait_for_timeout(150); snapshot('overview-light')
        for entry in ([] if args.extensions_only else json.loads((project/'samples/ControlCatalog/catalog.json').read_text())):
            check('catalog route '+entry['Id'], lambda id=entry['Id']: go(id))
        def button_test():
            go('Buttons'); click('PrimaryButton'); click('PrimaryButton')
            require(page.evaluate('window.catalog.PageModel.Counter === 2'))
            require(page.evaluate('window.catalog.Page.FindControl("CounterText").Text === "Executed 2 times"'))
            snapshot('buttons-light')
        check('pointer clicks execute genuine ReactiveWeb commands and update binding', button_test)
        def text_test():
            go('TextBox'); click('NameEditor'); page.keyboard.press('Control+A'); page.keyboard.type('Grace Hopper')
            require(page.evaluate('window.catalog.PageModel.Name === "Grace Hopper"'))
            require(page.evaluate('window.catalog.Page.FindControl("NamePreview").Text === "Hello, Grace Hopper"'))
            page.evaluate('window.catalog.PageModel.Name = "Katherine Johnson"')
            require(page.evaluate('window.catalog.Page.FindControl("NameEditor").Text === "Katherine Johnson"'))
            snapshot('text-binding')
        check('browser textarea input, selection and two-way ReactiveWeb binding', text_test)
        def slider_test():
            go('Slider'); click('Range', .8)
            value=page.evaluate('window.catalog.PageModel.Value'); require(value > 70 and value < 90)
            require(page.evaluate('window.catalog.Page.FindControl("Progress").Value === window.catalog.PageModel.Value'))
        check('pointer slider updates progress and numeric binding', slider_test)
        def virtual_test():
            go('ListBox'); click('VirtualList', .5, .1); page.keyboard.press('End'); page.wait_for_timeout(100)
            require(page.evaluate('window.catalog.Page.FindControl("VirtualList").SelectedIndex === 9999'))
            require(page.evaluate('window.catalog.Page.FindControl("VirtualList").GetRealizedContainers().length < 20'))
            require(page.evaluate('!!window.catalog.Page.FindControl("VirtualList").ContainerFromIndex(9999)'))
            snapshot('virtual-list')
        check('10,000-item ListBox keyboard selection and bounded realization', virtual_test)
        def combo_test():
            go('ComboBox'); click('Combo'); require(page.evaluate('window.catalog.Root._popupEntries.length === 1'))
            p=page.evaluate('()=>{const A=window.catalogApi,c=window.catalog.Root._popupEntries[0].Control,p=c.GetTransformToRoot().Transform(new A.Point(25,15));return {x:p.X,y:p.Y};}')
            page.mouse.click(p['x'],p['y']); page.wait_for_timeout(100)
            require(page.evaluate('window.catalog.Page.FindControl("Combo").SelectedIndex === 0')); require(page.evaluate('window.catalog.Root._popupEntries.length === 0'))
        check('retained ComboBox popup selection and dismissal', combo_test)
        def calendar_test():
            go('Calendar'); click('Calendar', .4, .55); require(page.evaluate('window.catalog.Page.FindControl("Calendar").SelectedDate instanceof Date'))
            before=page.evaluate('+window.catalog.Page.FindControl("Calendar").SelectedDate'); page.keyboard.press('ArrowRight')
            after=page.evaluate('+window.catalog.Page.FindControl("Calendar").SelectedDate'); require(after > before)
        check('calendar native painting and keyboard date navigation', calendar_test)
        def table_test():
            go('TableView'); click('Table', .05, .04)
            require(page.evaluate('window.catalog.Page.FindControl("Table").Columns.Get(0).SortDirection === "Ascending"'))
            click('Table', .15, .22); require(page.evaluate('window.catalog.Page.FindControl("Table").SelectedItem != null'))
            snapshot('table')
        check('TableView header sorting and pointer row selection', table_test)
        def flyout_test():
            go('Flyouts'); click('FlyoutTarget'); require(page.evaluate('window.catalog.Root._popupEntries.length === 1')); page.mouse.click(1400,100); page.wait_for_timeout(100); require(page.evaluate('window.catalog.Root._popupEntries.length === 0'))
        check('flyout light dismissal releases retained popup', flyout_test)
        def theme_test():
            go('Buttons'); click('ThemeButton',shell=True)
            require(page.evaluate('window.catalogApi.Application.Current.ActualThemeVariant.Key === "Dark"'))
            snapshot('buttons-dark'); click('ThemeButton',shell=True)
        check('theme change propagates dynamic resources', theme_test)
        def source_test():
            go('Buttons'); click('SourceButton',shell=True)
            source='<StackPanel xmlns="https://github.com/avaloniaui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><TextBlock x:Name="CompiledLabel" Text="Live compiler test"/></StackPanel>'
            page.evaluate('source => {window.catalog.Find("SourceEditor").Text=source;}',source); click('ApplyXamlButton',shell=True)
            require(page.evaluate('window.catalog.Page.FindControl("CompiledLabel").Text === "Live compiler test"')); click('SourceButton',shell=True)
        check('live XAML compiler produces and instantiates a changed view', source_test)
        def navigation_test():
            go('NavigationPage'); page.evaluate('()=>{window.catalog.PushPage();}'); page.wait_for_timeout(100)
            require(page.evaluate('window.catalog.Page.FindControl("Navigator").NavigationStack.length === 2'))
            page.evaluate('()=>{window.catalog.PopPage();}'); page.wait_for_timeout(100); require(page.evaluate('window.catalog.Page.FindControl("Navigator").NavigationStack.length === 1'))
        check('NavigationPage push and pop retain correct stack', navigation_test)
        def popup_test():
            with page.expect_popup() as opened: click('WindowButton',shell=True)
            popup=opened.value
            page.evaluate('async()=>{await window.catalog.LastWindow.WhenOpened;return true;}')
            require(page.evaluate('window.catalog.LastWindow.IsAttachedToVisualTree && !!window.catalog.LastWindow.Renderer.Surface'))
            page.evaluate('()=>{window.catalog.LastWindow.Close();}'); popup.wait_for_event('close',timeout=5000) if not popup.is_closed() else None
        check('trusted click opens a real browser window with its own Skia surface', popup_test)
        def modal_test():
            go('Dialogs')
            with page.expect_popup() as opened: click('DialogButton')
            popup=opened.value; page.evaluate('async()=>{await window.catalog.LastDialog.WhenOpened;return true;}')
            require(page.evaluate('window.catalog.Root.IsEnabled === false'))
            page.evaluate('()=>{window.catalog.LastDialog.Close(true);}'); page.wait_for_timeout(100)
            require(page.evaluate('window.catalog.Root.IsEnabled === true'))
            require(page.evaluate('window.catalog.Page.FindControl("DialogResult").Text === "Dialog returned: true"'))
        check('browser modal owner disabling and result delivery', modal_test)
        def search_test():
            click('SearchBox',shell=True); page.keyboard.press('Control+A'); page.keyboard.type('Slider'); page.wait_for_timeout(250)
            require(page.evaluate('window.catalog._nav.size === 1')); page.keyboard.press('Control+A'); page.keyboard.press('Backspace'); page.wait_for_timeout(250)
            require(page.evaluate('window.catalog._nav.size === 74'))
        check('RxJS-debounced catalog navigation filter', search_test)

        def query_test():
            go('ContainerQueries'); click('ContainerWidth', .05); page.wait_for_timeout(100)
            require(page.evaluate('window.catalog.Page.FindControl("ResponsiveText").FontSize === 18'))
            click('ContainerWidth', .9); page.wait_for_timeout(100)
            require(page.evaluate('window.catalog.Page.FindControl("ResponsiveText").FontSize === 34'))
            snapshot('container-queries')
        check('container query style activation and removal through real slider input', query_test)
        def cache_test():
            go('BitmapCache'); p=coords('RedrawCache'); page.mouse.move(p['x'],p['y']); page.wait_for_timeout(100); page.evaluate('async()=>{await catalog.Root.RenderNow();window.__cacheCounts=[catalog.CacheDemo.Cached.DrawCount,catalog.CacheDemo.Direct.DrawCount];}');
            click('RedrawCache'); page.evaluate('async()=>{await catalog.Root.RenderNow();}')
            require(page.evaluate('catalog.CacheDemo.Cached.DrawCount === __cacheCounts[0] && catalog.CacheDemo.Direct.DrawCount > __cacheCounts[1]'))
            click('InvalidateCache'); require(page.evaluate('catalog.CacheDemo.Cached.DrawCount > __cacheCounts[0]'))
            snapshot('bitmap-cache')
        check('native visual bitmap cache reuse and geometry invalidation', cache_test)
        def acrylic_test():
            go('Acrylic'); click('AcrylicBlur', .8); click('AcrylicTint', .2)
            require(page.evaluate('catalog.AcrylicMaterial.BlurRadius > 20 && catalog.AcrylicMaterial.TintOpacity < .3'))
            require(page.evaluate('!catalog.Root.LastRenderError')); snapshot('acrylic')
        check('acrylic native rendering and live material property invalidation', acrylic_test)
        def composition_test():
            go('Composition'); page.evaluate('()=>{window.__composition=catalog.CompositionDemo;window.__compositionHost=catalog.Page.FindControl("CompositionHost");}')
            click('AnimateComposition'); page.wait_for_timeout(250)
            require(page.evaluate('__composition.Tile._Read("Offset").X > 24 && __composition.Compositor._animatedObjects.size === 2'))
            snapshot('composition'); click('StopComposition');
            require(page.evaluate('__composition.Tile._Read("Offset").X === 24 && !__composition.Compositor._clock'))
            click('AnimateComposition'); go('Buttons')
            require(page.evaluate('__composition.Tile.IsDisposed && __composition.Group.IsDisposed && !__composition.Compositor._animatedObjects.size && !__composition.Compositor._attachments.has(__compositionHost)'))
        check('composition clocks, expression animation, cancellation and route disposal', composition_test)
        def native_test():
            go('NativeEmbed'); field=page.locator('#native-demo-input'); field.fill('Native browser edit')
            require(page.evaluate('catalog.PageModel.Name === "Native browser edit"'))
            page.evaluate('catalog.PageModel.Name="Reactive change"'); require(field.input_value() == 'Reactive change')
            require(field.is_visible()); require(page.evaluate('catalog.NativeDemo._wrapper.style.clipPath.startsWith("polygon(")'))
            field.focus(); page.keyboard.press('Tab'); page.wait_for_timeout(100)
            require(page.evaluate('catalog.Root.FocusManager.FocusedElement === catalog.Page.FindControl("NativeModelEditor")'))
            snapshot('native-host'); page.evaluate('()=>{window.__nativeHost=catalog.NativeDemo;}'); go('Buttons')
            require(page.locator('#native-demo-input').count() == 0); require(page.evaluate('__nativeHost.IsDisposed && !catalog.Root._nativeHosts.size'))
        check('native HTML input binding, focus traversal, clipping and deterministic removal', native_test)
        def grapheme_test():
            go('TextBox'); page.evaluate('catalog.Page.FindControl("NameEditor").Text="A👩‍💻é"'); click('NameEditor')
            page.keyboard.press('End'); page.keyboard.press('Backspace'); page.wait_for_timeout(100)
            require(page.evaluate('catalog.Page.FindControl("NameEditor").Text === "A👩‍💻"'))
            page.keyboard.press('Backspace'); page.wait_for_timeout(100)
            require(page.evaluate('catalog.Page.FindControl("NameEditor").Text === "A"'))
        check('browser editing preserves emoji ZWJ and combining grapheme boundaries', grapheme_test)
        def ime_test():
            go('TextBox'); click('NameEditor'); page.evaluate('''() => {
                const c=catalog.Page.FindControl('NameEditor'), t=catalog.Root._textInput;
                c.Text='A'; c._undo.length=0; t.dispatchEvent(new CompositionEvent('compositionstart',{data:''}));
                t.value='Aに';t.setSelectionRange(2,2);t.dispatchEvent(new InputEvent('input',{data:'に',inputType:'insertCompositionText',isComposing:true}));
                t.value='A日本';t.setSelectionRange(3,3);t.dispatchEvent(new InputEvent('input',{data:'日本',inputType:'insertCompositionText',isComposing:true}));
                t.dispatchEvent(new CompositionEvent('compositionend',{data:'日本'}));
            }''')
            require(page.evaluate('catalog.Page.FindControl("NameEditor").Text === "A日本"'))
            page.evaluate('catalog.Page.FindControl("NameEditor").Undo()'); require(page.evaluate('catalog.Page.FindControl("NameEditor").Text === "A"'))
        check('browser composition-event bridge groups preedit into one undo transaction (synthetic IME)', ime_test)
        def table_recycle_test():
            go('TableView'); page.evaluate('''async()=>{
                const t=catalog.Page.FindControl('Table');t.ItemsSource=Array.from({length:10000},(_,i)=>({Name:'row-'+i,Index:i}));
                t.ScrollIntoView(9000);await catalog.Root.RenderNow();
            }''');
            require(page.evaluate('catalog.Page.FindControl("Table").GetRealizedContainers().length < 40'))
            require(page.evaluate('!!catalog.Page.FindControl("Table").ContainerFromIndex(9000)'))
            snapshot('table-virtualized')
        check('read-only TableView realizes bounded real row and cell controls', table_recycle_test)
        def touch_session():
            session = context.new_cdp_session(page)
            session.send('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 5})
            return session
        def touch_point(x, y, id=0):
            return {'x': x, 'y': y, 'id': id, 'radiusX': 1, 'radiusY': 1, 'force': 1}
        def touch_send(session, kind, points):
            session.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': points})
        def touch_finish(session):
            session.send('Emulation.setTouchEmulationEnabled', {'enabled': False})
            session.detach()
        def pinch_test():
            go('Gestures'); session = touch_session()
            try:
                a = coords('PointerArea', .35, .5); b = coords('PointerArea', .65, .5)
                c = coords('PointerArea', .15, .5); d = coords('PointerArea', .85, .5)
                touch_send(session, 'touchStart', [touch_point(a['x'], a['y'])])
                touch_send(session, 'touchStart', [touch_point(a['x'], a['y']), touch_point(b['x'], b['y'], 1)])
                touch_send(session, 'touchMove', [touch_point(c['x'], c['y']), touch_point(d['x'], d['y'], 1)])
                touch_send(session, 'touchEnd', [])
                page.wait_for_timeout(100)
                require(page.evaluate('parseFloat(catalog.Page.FindControl("PointerText").Text.slice(6)) > 2'), page.evaluate('catalog.Page.FindControl("PointerText").Text'))
                require(page.evaluate('catalog.Page.FindControl("PointerArea").GestureRecognizers.Get(0)._contacts.size === 0'))
                snapshot('touch-pinch')
            finally: touch_finish(session)
        check('CDP two-contact touch input drives pinch scale and releases capture', pinch_test)
        def touch_scroll_test():
            go('Gestures'); session = touch_session()
            try:
                a=coords('GestureScroll',.5,.65); b=coords('GestureScroll',.5,.2)
                touch_send(session,'touchStart',[touch_point(a['x'],a['y'])])
                for i in range(1,5):
                    touch_send(session,'touchMove',[touch_point(a['x'],a['y']+(b['y']-a['y'])*i/4)])
                    page.wait_for_timeout(15)
                touch_send(session,'touchEnd',[]); page.wait_for_timeout(100)
                require(page.evaluate('catalog.Page.FindControl("GestureScroll").Offset.Y > 50'), page.evaluate('JSON.stringify({offset:catalog.Page.FindControl("GestureScroll").Offset.Y,status:catalog.Page.FindControl("GestureStatus").Text})'))
                require(page.evaluate('catalog.Page.FindControl("GestureStatus").Text.startsWith("Taps: 0")'))
                require(page.evaluate('[...catalog.Root._pointers.values()].every(p=>p.Type!=="Touch")'), page.evaluate('JSON.stringify([...catalog.Root._pointers.values()].map(p=>({id:p.Id,type:p.Type,capture:p.Captured?.constructor.name,gesture:p.CapturedGestureRecognizer?.constructor.name})))'))
                snapshot('touch-scroll')
            finally: touch_finish(session)
        check('CDP touch drag scrolls real ScrollViewer without clicking child buttons', touch_scroll_test)
        def independent_touch_test():
            go('Gestures'); session=touch_session()
            try:
                positions=page.evaluate('''()=>{const A=catalogApi,items=catalog.Page.FindControl('GestureItems');return [0,1].map(i=>{const c=items.Children.Get(i),p=c.GetTransformToRoot().Transform(new A.Point(c.Bounds.Width/2,c.Bounds.Height/2));return {x:p.X,y:p.Y};});}''')
                a,b=positions
                touch_send(session,'touchStart',[touch_point(a['x'],a['y'])])
                touch_send(session,'touchStart',[touch_point(a['x'],a['y']),touch_point(b['x'],b['y'],1)])
                touch_send(session,'touchEnd',[touch_point(b['x'],b['y'],1)])
                touch_send(session,'touchEnd',[]);page.wait_for_timeout(100)
                require(page.evaluate('catalog.Page.FindControl("GestureStatus").Text.startsWith("Taps: 2")'),page.evaluate('catalog.Page.FindControl("GestureStatus").Text'))
            finally: touch_finish(session)
        check('CDP simultaneous contacts preserve independent button press and release', independent_touch_test)
        def touch_cancel_test():
            go('Gestures');session=touch_session()
            try:
                a=coords('GestureScroll',.5,.1)
                touch_send(session,'touchStart',[touch_point(a['x'],a['y'])])
                touch_send(session,'touchCancel',[]);page.wait_for_timeout(50)
                require(page.evaluate('catalog.Page.FindControl("GestureStatus").Text.startsWith("Taps: 0")'))
                require(page.evaluate('catalog.Page.FindControl("GestureItems").Children.ToArray().every(b=>!b.IsPressed)'))
                require(page.evaluate('[...catalog.Root._pointers.values()].every(p=>p.Type!=="Touch")'), page.evaluate('JSON.stringify([...catalog.Root._pointers.values()].map(p=>({id:p.Id,type:p.Type,capture:p.Captured?.constructor.name,gesture:p.CapturedGestureRecognizer?.constructor.name})))'))
            finally:touch_finish(session)
        check('CDP touch cancellation clears capture and pressed state without activation', touch_cancel_test)
        go('OpenGL')
        report['webGL2Available'] = page.evaluate('!!catalog.GlDemo')
        if report['webGL2Available']:
            def gl_test():
                require(page.evaluate('catalog.GlDemo.IsInitializedSuccessfully && catalog.GlDemo.FrameCount > 0'))
                # Test colored shader pixels, not just a non-null WebGL context.
                require(page.evaluate('''()=>{const d=catalog.GlDemo,w=d.Context.Canvas.width,h=d.Context.Canvas.height,p=d._pixels,i=(Math.floor(h/2)*w+Math.floor(w/2))*4;return p[i]>30&&p[i+1]>30&&p[i+2]>30&&p[i+3]===255;}'''))
                click('GlRedraw'); require(page.evaluate('catalog.GlDemo.FrameCount >= 2'))
                snapshot('webgl-skia')
            check('real WebGL2 shader pixels transfer into native Skia', gl_test)
            def lease_test():
                click('GlLease'); require(page.evaluate('catalog.Page.FindControl("GlStatus").Text.startsWith("Lease restored")'))
                require(page.evaluate('''()=>{const c=catalog.GlDemo.Context,d=c.MakeCurrent();try{let caught=false;try{c.MakeCurrent();}catch{caught=true;}return caught;}finally{d.Dispose();}}'''))
            check('WebGL leases restore state and reject simultaneous ownership', lease_test)
            def gl_loss_test():
                page.evaluate('window.__glDemo=catalog.GlDemo;window.__loseGL=__glDemo.Context.Gl.getExtension("WEBGL_lose_context");__loseGL.loseContext()')
                page.wait_for_function('__glDemo.LostCount > 0'); page.wait_for_timeout(120)
                page.evaluate('__loseGL.restoreContext()'); page.wait_for_function('__glDemo.IsInitializedSuccessfully && __glDemo.InitCount === 2',timeout=10000)
                require(page.evaluate('__glDemo.FrameCount >= 3'))
                go('Buttons'); require(page.evaluate('__glDemo.IsDisposed && __glDemo.Context === null && __glDemo.DeinitCount === 1'))
            check('WebGL context loss, restoration and disposal lifecycle', gl_loss_test)
        else:
            for name in ['real WebGL2 shader pixels transfer into native Skia', 'WebGL leases restore state and reject simultaneous ownership', 'WebGL context loss, restoration and disposal lifecycle']:
                skip(name, 'No WebGL2 context available in this Chromium run.')
        def automation_grid_test():
            go('TableView')
            require(page.evaluate('''()=>{const t=catalog.Page.FindControl('Table'), r=catalog.Root, grid=r._ariaNodes.get(t), header=r._ariaNodes.get(t.HeadersPresenter), row=t.GetRealizedContainers()[0], cell=row.CellsPresenter.Children.Get(0); return grid.getAttribute('role')==='grid' && header.parentElement===grid && header.getAttribute('role')==='row' && r._ariaNodes.get(row).parentElement===grid && r._ariaNodes.get(cell).parentElement===r._ariaNodes.get(row) && r._ariaNodes.get(cell).getAttribute('aria-colindex')==='1';}'''))
            cdp = context.new_cdp_session(page)
            try:
                nodes = cdp.send('Accessibility.getFullAXTree')['nodes']
                roles = [n.get('role',{}).get('value') for n in nodes if not n.get('ignored')]
                require('grid' in roles and 'row' in roles and 'gridcell' in roles and 'columnheader' in roles, repr(set(roles)))
            finally: cdp.detach()
        check('Chromium accessibility tree exposes table hierarchy and actual grid cells', automation_grid_test)
        def automation_actions_test():
            go('Buttons')
            page.evaluate('''()=>{const b=catalog.Page.FindControl('PrimaryButton');catalog.Root._ariaNodes.get(b).click();}''')
            require(page.evaluate('catalog.PageModel.Counter === 1'))
            page.evaluate('''async()=>{const b=catalog.Page.FindControl('PrimaryButton');b.IsEnabled=false;await catalog.Root.RenderNow();catalog.Root._ariaNodes.get(b).click();}''')
            require(page.evaluate('''()=>{const b=catalog.Page.FindControl('PrimaryButton');return catalog.PageModel.Counter===1 && catalog.Root._ariaNodes.get(b).getAttribute('aria-disabled')==='true';}'''))
            page.evaluate('()=>{window.__oldAriaNode=catalog.Root._ariaNodes.get(catalog.Page.FindControl("PrimaryButton"));}')
            go('TextBox'); require(page.evaluate('!__oldAriaNode.isConnected'))
        check('accessibility activation respects enabled state and disposes old page nodes', automation_actions_test)
        def automation_password_test():
            go('TextBox')
            page.evaluate('''async()=>{const t=catalog.Page.FindControl('NameEditor');t.PasswordChar='*';t.Text='test-secret-never-expose';catalogApi.AutomationProperties.SetName(t,'Secure account');await catalog.Root.RenderNow();}''')
            require(page.evaluate('''()=>{const t=catalog.Page.FindControl('NameEditor'),node=catalog.Root._ariaNodes.get(t);return node.getAttribute('aria-label')==='Secure account' && node.textContent==='';}'''))
            # The sample also binds the same text into a separate preview; clear that intentionally public label.
            page.evaluate('''async()=>{catalog.Page.FindControl('NamePreview').Text='';await catalog.Root.RenderNow();}''')
            cdp = context.new_cdp_session(page)
            try: require('test-secret-never-expose' not in json.dumps(cdp.send('Accessibility.getFullAXTree')))
            finally: cdp.detach()
        check('automation password mirrors withhold values and preserve explicit accessible names', automation_password_test)
        def focused_password_test():
            go('TextBox')
            page.evaluate('''()=>{const t=catalog.Page.FindControl('NameEditor');t.PasswordChar='*';catalogApi.AutomationProperties.SetName(t,'Secure account');}''')
            click('NameEditor'); page.keyboard.press('Control+A'); page.keyboard.type('private-input-567')
            require(page.evaluate('''()=>{const root=catalog.Root,t=catalog.Page.FindControl('NameEditor');return root._textInput.type==='password' && root._textInput===document.activeElement && t.Text==='private-input-567' && root._plainTextInput.hidden && root._plainTextInput.value==='';}'''))
            page.evaluate('''async()=>{catalog.Page.FindControl('NamePreview').Text='';await catalog.Root.RenderNow();}''')
            cdp = context.new_cdp_session(page)
            try: require('private-input-567' not in json.dumps(cdp.send('Accessibility.getFullAXTree')))
            finally: cdp.detach()
            go('Buttons'); require(page.evaluate('catalog.Root._passwordInput.hidden && catalog.Root._passwordInput.value===""'))
        check('focused password editing uses a protected native input and clears inactive buffers', focused_password_test)
        def teardown_test():
            go('TextBox'); page.evaluate('()=>{window.__oldPage=window.catalog.Page;}'); go('Buttons')
            require(page.evaluate('window.__oldPage.IsDisposed && window.__oldPage.VisualChildren.length === 0'))
            require(page.evaluate('window.catalog.Root._popupEntries.length === 0'))
        check('navigation disposes prior page tree and leaves no popups', teardown_test)
        check('no JavaScript page errors', lambda: require(not report['pageErrors'], repr(report['pageErrors'])))
        check('no missing local assets', lambda: require(not report['missingAssets'], repr(report['missingAssets'])))
        check('no rendering errors during catalog sweep', lambda: require(page.evaluate('window.catalog.Errors.length === 0'), page.evaluate('JSON.stringify(window.catalog.Errors)')))
        report['finalizationStage'] = 'home'; checkpoint(); print('FINALIZE home', flush=True)
        page.evaluate('async()=>{await window.catalog.Home();return true;}'); page.wait_for_timeout(150)
        report['finalizationStage'] = 'screenshot'; checkpoint(); print('FINALIZE screenshot', flush=True)
        snapshot('overview-light')
        report['finalizationStage'] = 'dispose'; checkpoint(); print('FINALIZE dispose', flush=True)
        page.evaluate('()=>{window.catalog.Root.Dispose();}')
    report['finalizationStage'] = 'close-context'; checkpoint(); print('FINALIZE context', flush=True)
    context.close()
    report['finalizationStage'] = 'close-browser'; checkpoint(); print('FINALIZE browser', flush=True)
    browser.close()
    report['finalizationStage'] = 'complete'

report['finalSourceFingerprint']=source_fingerprint(project)
require(report['sourceFingerprint']==report['finalSourceFingerprint'],'Source changed during browser qualification')
report['completed'] = True
checkpoint()
print(json.dumps({k:report[k] for k in ('passed','failed','skipped','elapsedSeconds')}),flush=True)
raise SystemExit(1 if report['failed'] else 0)
