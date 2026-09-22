"""Real-DOM correctness and no-op-work checks for incremental accessibility.

Uses the built application, local asset interception, and native Skia. This is
not a screen-reader or hardware-GPU qualification. CHROMIUM_PATH is supported.
"""
from pathlib import Path
from urllib.parse import unquote, urlparse
from datetime import datetime, timezone
import json, mimetypes, os, time
from playwright.sync_api import sync_playwright
from verification_support import source_fingerprint

root = Path(__file__).resolve().parent.parent
out = root / 'artifacts/validation-optimized'
out.mkdir(parents=True, exist_ok=True)
report = dict(Version=json.loads((root/'package.json').read_text())['version'],
    SourceFingerprint=source_fingerprint(root), Completed=False, Tests=[],
    PageErrors=[], MissingAssets=[], Mode='local-asset-interception',
    ScreenReaderQualified=False, StartedAt=datetime.now(timezone.utc).isoformat())

def save():
    report['Passed'] = sum(t['Passed'] for t in report['Tests'])
    report['Failed'] = len(report['Tests']) - report['Passed']
    (out/'automation-final.json').write_text(json.dumps(report, indent=2)+'\n')

save()
with sync_playwright() as pw:
    options = dict(headless=True, args=['--no-sandbox', '--disable-dev-shm-usage'])
    executable = os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium')
    if Path(executable).is_file(): options['executable_path'] = executable
    browser = pw.chromium.launch(**options)
    report['Browser'] = browser.version
    context = browser.new_context(viewport=dict(width=1000, height=760))
    def route(r):
        path = (root/'dist'/unquote(urlparse(r.request.url).path).lstrip('/')).resolve()
        if not path.is_relative_to(root/'dist') or not path.is_file():
            report['MissingAssets'].append(str(path)); r.fulfill(status=404, body='missing'); return
        mime = 'application/wasm' if path.suffix == '.wasm' else 'text/javascript' if path.suffix in ('.js','.mjs') else mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
        r.fulfill(body=path.read_bytes(), headers={'Content-Type':mime,'Access-Control-Allow-Origin':'*'})
    context.route('http://localhost:4173/**', route)
    page = context.new_page()
    page.on('pageerror', lambda e: report['PageErrors'].append(str(e)))
    page.set_content((root/'dist/index.html').read_text().replace('<head>', '<head><script>globalThis.AVALONIA_THREADING="single";</script><base href="http://localhost:4173/">'))
    page.wait_for_function('window.catalogReady || window.catalogError', timeout=60000)
    if not page.evaluate('!!window.catalogReady'): raise RuntimeError(page.evaluate('window.catalogError'))
    report['Backend'] = page.evaluate('catalog.Root.Renderer.Backend')
    page.evaluate('''()=>{
        window.A=catalogApi; window.r=catalog.Root;
        window.assert=(ok,message='Assertion failed')=>{if(!ok)throw new Error(message);};
        window.node=c=>r._ariaNodes.get(c);
        window.flush=async()=>{await r.RenderNow();};
        window.mount=async children=>{
            const old=r.Content,p=new A.StackPanel();
            for(const c of children)p.Children.Add(c);
            r.Content=p;old?.Dispose();await flush();return p;
        };
    }''')
    def check(name, code):
        start=time.monotonic()
        try:
            details=page.evaluate('async()=>{'+code+'}')
            report['Tests'].append(dict(Name=name, Passed=True, Details=details))
            print('PASS',name,flush=True)
        except Exception as error:
            report['Tests'].append(dict(Name=name, Passed=False, Error=str(error)))
            print('FAIL',name,str(error),flush=True)
        report['Tests'][-1]['Milliseconds']=round((time.monotonic()-start)*1000,2)
        save()

    check('warm paint does not rebuild or mutate accessibility DOM', '''
        const b=new A.Button('Action');await mount([b]);await flush();
        const before={...r._automationBridge.Statistics}, original=node(b);
        const records=[];const observer=new MutationObserver(x=>records.push(...x));
        observer.observe(r._aria,{subtree:true,attributes:true,childList:true,characterData:true});
        for(let i=0;i<25;i++){b.InvalidateVisual();await flush();}
        records.push(...observer.takeRecords());observer.disconnect();
        const after=r._automationBridge.Statistics;
        assert(after.StructurePasses===before.StructurePasses,'structure rebuilt');
        assert(after.Projections===before.Projections,'unchanged peer projected');
        assert(original===node(b),'node replaced');assert(records.length===0,'DOM mutations '+records.length);
        return {Frames:25,StructurePasses:0,Projections:0,DomMutations:0};
    ''')
    check('detached LabeledBy updates its consumer and releases replaced dependencies', '''
        const l=new A.TextBlock('External label'),b=new A.Button('Action');
        A.AutomationProperties.SetLabeledBy(b,l);await mount([b]);
        assert(node(b).getAttribute('aria-label')==='External label');
        const n=node(b);l.Text='Changed external';await flush();
        assert(node(b)===n && n.getAttribute('aria-label')==='Changed external');
        A.AutomationProperties.SetLabeledBy(b,null);await flush();
        assert(!r._automationBridge._dependencySubscriptions.has(l),'stale label observer');
        const projections=r._automationBridge.Statistics.Projections;
        l.Text='No longer linked';await flush();assert(r._automationBridge.Statistics.Projections===projections);
        l.Dispose();
    ''')
    check('transitive and cyclic label relationships converge without stale names', '''
        const a=new A.TextBlock('Alpha'),b=new A.TextBlock('Beta'),button=new A.Button('Execute');
        A.AutomationProperties.SetLabeledBy(b,a);A.AutomationProperties.SetLabeledBy(button,b);
        await mount([button]);assert(node(button).getAttribute('aria-label')==='Alpha');
        a.Text='Updated';await flush();assert(node(button).getAttribute('aria-label')==='Updated');
        A.AutomationProperties.SetLabeledBy(a,b);await flush();
        assert(node(button).getAttribute('aria-label'),'cycle lost the fallback name');
        A.AutomationProperties.SetLabeledBy(button,null);await flush();a.Dispose();b.Dispose();
    ''')
    check('Control-valued content label remains live without replacing the button node', '''
        const label=new A.TextBlock('First'),b=new A.Button();b.Content=label;
        await mount([b]);const original=node(b);assert(original.getAttribute('aria-label')==='First');
        label.Text='Second';await flush();assert(node(b)===original && original.getAttribute('aria-label')==='Second');
    ''')
    check('visibility removes and restores complete automation subtrees', '''
        const p=new A.StackPanel(),b=new A.Button('Visible');p.Children.Add(b);await mount([p]);
        assert(node(b)?.isConnected);p.IsVisible=false;await flush();assert(!node(b));
        p.IsVisible=true;await flush();assert(node(b)?.isConnected);
    ''')
    check('raw nodes flatten descendants and preserve reorder identity', '''
        const p=new A.StackPanel(),a=new A.Button('A'),b=new A.Button('B');
        A.AutomationProperties.SetAccessibilityView(p,A.AccessibilityView.Raw);
        p.Children.Add(a);p.Children.Add(b);await mount([p]);
        const an=node(a),bn=node(b);assert(!node(p));assert(an.parentNode===bn.parentNode);
        p.Children.Move(0,1);await flush();assert(node(a)===an && node(b)===bn);
        const order=[...an.parentNode.children];assert(order.indexOf(bn)<order.indexOf(an),'reorder not projected');
    ''')
    check('command availability and parameter changes update aria-disabled', '''
        const b=new A.Button('Run'),command={CanExecute:p=>p==='yes',CanExecuteChanged:new A.Event(),Execute(){}};
        b.Command=command;await mount([b]);assert(node(b).getAttribute('aria-disabled')==='true');
        b.CommandParameter='yes';await flush();assert(node(b).getAttribute('aria-disabled')!=='true');
        command.CanExecute=()=>false;command.CanExecuteChanged.Raise(command,{});await flush();
        assert(node(b).getAttribute('aria-disabled')==='true');
    ''')
    check('inherited disabling refreshes descendant semantics', '''
        const p=new A.StackPanel(),b=new A.Button('Run');p.Children.Add(b);await mount([p]);
        p.IsEnabled=false;await flush();assert(node(b).getAttribute('aria-disabled')==='true');
        p.IsEnabled=true;await flush();assert(node(b).getAttribute('aria-disabled')!=='true');
    ''')
    check('focus projects editor semantics and transfers ownership between parents', '''
        const p1=new A.StackPanel(),p2=new A.StackPanel(),a=new A.TextBox(),b=new A.TextBox();
        a.Text='One';b.Text='Two';A.AutomationProperties.SetName(a,'First editor');A.AutomationProperties.SetName(b,'Second editor');
        p1.Children.Add(a);p2.Children.Add(b);await mount([p1,p2]);
        a.Focus();await flush();const firstParent=node(a).parentNode,id=r._textInput.id;
        assert(r._textInput.getAttribute('aria-label')==='First editor');assert(node(a).getAttribute('aria-hidden')==='true');
        assert((firstParent.getAttribute('aria-owns')||'').split(' ').includes(id));
        b.Focus();await flush();assert(r._textInput.getAttribute('aria-label')==='Second editor');
        assert(!(firstParent.getAttribute('aria-owns')||'').split(' ').includes(id));
        assert((node(b).parentNode.getAttribute('aria-owns')||'').split(' ').includes(r._textInput.id));
        assert(node(a).getAttribute('aria-hidden')!=='true');
    ''')
    check('password conversion clears mirrored values and native plain-text buffers', '''
        const t=new A.TextBox();t.Text='private-regression-value';await mount([t]);t.Focus();await flush();
        t.PasswordChar='*';await flush();assert(r._textInput.type==='password');
        assert(node(t).textContent==='','password in mirror');
        assert(r._plainTextInput.value==='' && r._plainTextInput.hidden,'plain editor retained secret');
        assert(!r._aria.textContent.includes('private-regression-value'));
        await mount([new A.Button('Other')]);assert(r._passwordInput.value==='' && r._passwordInput.hidden);
    ''')
    check('recycled table rows retain accessibility nodes with updated content', '''
        const table=new A.TableView();table.Height=240;table.ItemHeight=28;
        table.Columns.Add(new A.TableViewColumn('Name','Name'));
        table.ItemsSource=Array.from({length:500},(_,i)=>({Name:'Item '+i}));await mount([table]);
        const rows=table.GetRealizedContainers(),nodes=rows.map(node);
        table._SetOffset(2800);await flush();const current=table.GetRealizedContainers();
        assert(current.some(c=>rows.includes(c)),'rows were not reused');
        for(const c of current){const index=rows.indexOf(c);if(index>=0)assert(node(c)===nodes[index],'row DOM recreated');}
        assert(current.some(c=>c.DataContext.Name==='Item 100'),'data not retargeted');
        return {Before:rows.length,After:current.length,RetainedNodes:current.filter(c=>rows.includes(c)).length};
    ''')
    check('explicit rendering consumes scheduled callbacks and settled UI stays idle', '''
        const b=new A.Button('Steady');await mount([b]);await flush();
        await new Promise(resolve=>setTimeout(resolve,100));
        b.InvalidateVisual();assert(r._frameId!=null,'missing scheduled frame');await flush();
        assert(r._frameId===null,'redundant animation callback left pending');
        const old=r.Renderer.Render;let calls=0;r.Renderer.Render=function(...args){calls++;return old.apply(this,args);};
        await new Promise(resolve=>setTimeout(resolve,180));r.Renderer.Render=old;
        assert(calls===0,'settled application redrew '+calls+' times');
    ''')
    report['Completed']=True
    browser.close()
report['FinalSourceFingerprint']=source_fingerprint(root)
if report['SourceFingerprint'] != report['FinalSourceFingerprint']:
    report['Tests'].append(dict(Name='source unchanged during qualification', Passed=False))
save()
print(json.dumps({k:report[k] for k in ['Passed','Failed','Completed','PageErrors','MissingAssets']}))
raise SystemExit(1 if report['Failed'] or report['PageErrors'] or report['MissingAssets'] else 0)
