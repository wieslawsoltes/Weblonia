"""Repeatable table workloads against an arbitrary extracted source tree.

CPU timings include JS, native Skia raster, and accessibility projection. They
exclude hardware-GPU qualification and must not be compared to another machine's
uploaded trace as an end-to-end speedup. Instrumented operation counts and
uninstrumented timings use separate runs. No browser policy is modified.
"""
import argparse,json,mimetypes,os,time
from pathlib import Path
from urllib.parse import unquote,urlparse
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parent.parent);parser.add_argument('--out',type=Path,required=True);parser.add_argument('--frames',type=int,default=60)
args=parser.parse_args();root=args.root.resolve();args.out.parent.mkdir(parents=True,exist_ok=True)
report={'Version':json.loads((root/'package.json').read_text())['version'],'Completed':False,'PageErrors':[],'MissingAssets':[],'FramesPerTrial':args.frames,'Mode':'local-asset-interception','HardwareGpuQualified':False}
with sync_playwright() as pw:
    options={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
    executable=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium')
    if Path(executable).is_file():options['executable_path']=executable
    print('Launching',flush=True);browser=pw.chromium.launch(**options);print('Launched',flush=True);report['Browser']=browser.version
    context=browser.new_context(viewport={'width':562,'height':820},device_scale_factor=2)
    def serve(r):
        p=(root/unquote(urlparse(r.request.url).path).lstrip('/')).resolve()
        if not p.is_relative_to(root) or not p.is_file():report['MissingAssets'].append(str(p));r.fulfill(status=404,body='missing');return
        mime='application/wasm' if p.suffix=='.wasm' else 'text/javascript' if p.suffix in ('.js','.mjs') else mimetypes.guess_type(str(p))[0] or 'application/octet-stream'
        r.fulfill(body=p.read_bytes(),headers={'Content-Type':mime,'Access-Control-Allow-Origin':'*'})
    context.route('http://localhost:4173/**',serve)
    page=context.new_page();page.on('pageerror',lambda e:report['PageErrors'].append(str(e)))
    print('Loading catalog',flush=True);page.set_content((root/'samples/ControlCatalog/index.html').read_text().replace('<head>','<head><script>globalThis.AVALONIA_THREADING="single";</script><base href="http://localhost:4173/samples/ControlCatalog/">'))
    page.wait_for_function('window.catalogReady || window.catalogError',timeout=60000)
    if not page.evaluate('!!window.catalogReady'):raise RuntimeError(page.evaluate('window.catalogError'))
    print('Navigating',flush=True);page.evaluate('async()=>{await catalog.Navigate("TableView");await catalog.Root.RenderNow();}')
    page.wait_for_timeout(300)
    page.evaluate('''()=>{
        const root=catalog.Root,A=catalogApi,table=root.FindDescendant(v=>v instanceof A.TableView);
        window.perfFixture={root,A,table};
        window.perfWork=async function(kind,n){
            const f=perfFixture; let maxRows=0; const times=[];
            for(let i=0;i<n;i++){
                const start=performance.now();
                if(kind==='scroll') f.table._SetOffset((i*3 % Math.max(4,f.table.ItemCount-20))*f.table.ItemHeight);
                else if(kind==='horizontal') f.table._SetHorizontalOffset(i%2?120:0);
                await f.root.RenderNow(); times.push(performance.now()-start);
                maxRows=Math.max(maxRows,f.table.RealizedRowCount);
            }
            return {times,maxRows,error:f.root.LastRenderError?.stack??null};
        };
    }''')
    report['Backend']=page.evaluate('catalog.Root.Renderer.Backend')
    report['Scene']=page.evaluate('({width:catalog.Root.ClientSize.Width,height:catalog.Root.ClientSize.Height,scale:catalog.Root.RenderScaling,visuals:catalog.Root.GetVisualDescendants().length,items:perfFixture.table.ItemCount,columns:perfFixture.table.Columns.Count})')
    print('Mounted',flush=True)
    # Warm native resources before timing without wrappers or DOM observers.
    page.evaluate('()=>perfWork("scroll",20)')
    report['TimingTrials']={}
    for kind in ('repaint','scroll','horizontal'):
        print('Timing',kind,flush=True);report['TimingTrials'][kind]=[page.evaluate('([k,n])=>perfWork(k,n)',[kind,args.frames]) for _ in range(3)]
    # Instrument separate workloads, preserving virtual dispatch and arguments.
    page.evaluate('''()=>{
        const f=perfFixture, A=f.A; window.perfCounts={};window.perfUndo=[];
        function wrap(o,key,name,condition=null){const old=o[key];o[key]=function(...args){if(!condition||condition(this,args))perfCounts[name]=(perfCounts[name]??0)+1;return old.apply(this,args);};perfUndo.push(()=>o[key]=old);}
        wrap(A.AvaloniaObject.prototype,'GetValue','propertyReads');
        wrap(A.AvaloniaProperty.prototype,'GetMetadata','metadataCalls');
        wrap(A.AvaloniaObject.prototype,'_effectiveEntry','priorityLookups');
        wrap(A.AvaloniaObject.prototype,'SetInheritanceParent','inheritanceChanges',(o,a)=>o.InheritanceParent!==a[0]);
        wrap(A.Visual.prototype,'AddVisualChild','visualAttachments',(o,a)=>a[0].VisualParent!==o);
        wrap(A.Visual.prototype,'RemoveVisualChild','visualDetachments',(o,a)=>a[0].VisualParent===o);
        wrap(A.TableViewCell.prototype,'Prepare','cellPrepares');
        wrap(f.root.LayoutManager,'ExecuteLayoutPass','layoutExecutions');
        wrap(f.root.Renderer,'Render','renders');
        wrap(f.root,'_UpdateAccessibility','accessibilityCalls');
        wrap(f.root._container,'getBoundingClientRect','hostBoundsReads');
        wrap(A.ControlAutomationPeer.prototype,'GetName','accessibilityNames');
        const observe=records=>{for(const r of records){const k=r.type==='attributes'?'ariaAttributeMutations':r.type==='childList'?'ariaChildListMutations':'ariaTextMutations';perfCounts[k]=(perfCounts[k]??0)+1;}};
        const observer=new MutationObserver(observe);observer.observe(f.root._aria,{subtree:true,childList:true,attributes:true,characterData:true});
        window.perfReset=()=>{observer.takeRecords();window.perfCounts={};};
        window.perfRead=()=>{observe(observer.takeRecords());return {...perfCounts};};
    }''')
    report['Operations']={}
    for kind in ('repaint','scroll','horizontal'):
        print('Operations',kind,flush=True);page.evaluate('perfReset()');page.evaluate('([k,n])=>perfWork(k,n)',[kind,args.frames]);report['Operations'][kind]=page.evaluate('perfRead()')
    page.wait_for_timeout(300);page.evaluate('perfReset()');page.wait_for_timeout(600);report['Operations']['idle600ms']=page.evaluate('perfRead()')
    # Stable scenes retained for independent baseline/current pixel equality.
    report['Screenshots']=[]
    for i,(vertical,horizontal) in enumerate(((0,0),(680,0),(680,100))):
        page.evaluate('async([y,x])=>{perfFixture.table._SetOffset(y);perfFixture.table._SetHorizontalOffset(x);await catalog.Root.RenderNow();}',[vertical,horizontal])
        page.wait_for_timeout(100);p=args.out.with_name(args.out.stem+f'-scene-{i}.png');page.locator('canvas').first.screenshot(path=str(p));report['Screenshots'].append(p.name)
    report['Completed']=True;browser.close()
report['TimingSummary']={}
for kind,trials in report['TimingTrials'].items():
    values=sorted(v for t in trials for v in t['times']);p=lambda a:values[round((len(values)-1)*a)]
    report['TimingSummary'][kind]={'medianMs':round(p(.5),3),'p95Ms':round(p(.95),3),'maxMs':round(values[-1],3),'meanMs':round(sum(values)/len(values),3)}
args.out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ('Version','Backend','Scene','TimingSummary','Operations','PageErrors','MissingAssets','Completed')},indent=2))
if report['PageErrors'] or report['MissingAssets'] or any(t['error'] for ts in report['TimingTrials'].values() for t in ts):raise SystemExit(1)
