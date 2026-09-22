"""Full-isolation transport-work counters and optional baseline RGBA equivalence.

Use --baseline /path/to/untouched/AvaloniaWeb for a cross-revision comparison.
Each revision is served from its own isolated browser context. The exact same
production module worker entry and native Skia raster path run on both sides.
No font downloads, renderer substitution, or quality reduction is performed.
"""
from pathlib import Path
from urllib.parse import urlparse, unquote
import argparse, hashlib, json, mimetypes
from PIL import ImageChops
from playwright.sync_api import sync_playwright
import threading_support as support
from verification_support import source_fingerprint

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline', type=Path)
args = parser.parse_args()
out = root / 'artifacts/threading'; out.mkdir(exist_ok=True)
report = {'Version':json.loads((root/'package.json').read_text())['version'],
          'SourceFingerprint':source_fingerprint(root), 'Completed':False, 'Tests':[],
          'Errors':[], 'MissingAssets':[], 'Scale':2, 'Viewport':[562,820],
          'Qualification':'Full-isolation, real module workers, native Skia raster, locally intercepted source assets. Same Chromium, viewport and device scale for both revisions; not physical GPU FPS.'}

def save(): (out/'worker-performance-results.json').write_text(json.dumps(report,indent=2)+'\n')
def check(name, condition, evidence=None):
    report['Tests'].append({'Name':name,'Passed':bool(condition),'Evidence':evidence})
    print(('PASS 'if condition else'FAIL ')+name,flush=True); save()

def assets(context, directory):
    def asset(route):
        file=(directory/unquote(urlparse(route.request.url).path).lstrip('/')).resolve()
        if file.is_relative_to(directory) and file.is_file():
            route.fulfill(body=file.read_bytes(),headers={'Content-Type':'application/wasm'if file.suffix=='.wasm'else'text/javascript'if file.suffix in ['.js','.mjs','.cjs']else mimetypes.guess_type(str(file))[0]or'application/octet-stream','Access-Control-Allow-Origin':'*'})
        else: report['MissingAssets'].append(str(file)); route.fulfill(status=404,body='missing')
    context.route('http://localhost:4173/**',asset)

def run(browser, directory, current):
    context=browser.new_context(viewport={'width':562,'height':820},device_scale_factor=2)
    assets(context,directory)
    previous=support.ROOT; support.ROOT=directory
    try: page=support.load(context,'full-isolation',report['Errors'])
    finally: support.ROOT=previous
    snapshots={}
    scenes=[('table-initial','TableView',None),('table-vertical','TableView','vertical'),
            ('table-both-axes','TableView','both'),
            ('typography','TextBlock',None),('scrollviewer','ScrollViewer',None),('image','Image',None),('acrylic','Acrylic',None)]
    for name,route,scroll in scenes:
        support.invoke(page,'Navigate',route)
        if scroll:
            support.invoke(page,'BenchmarkFrames',{'Kind':'vertical','Frames':20})
            if scroll=='both': support.invoke(page,'BenchmarkFrames',{'Kind':'horizontal','Frames':2})
        image=support.png(page).crop((0,0,1124,1580)) # Exclude the changing version/backend/performance footer.
        image.save(out/('perf-'+('optimized-'if current else'baseline-')+name+'.png'))
        snapshots[name]=image
    if current:
        support.invoke(page,'Navigate','TableView')
        support.invoke(page,'BenchmarkFrames',{'Kind':'vertical','Frames':12})
        before=page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()')
        workloads={}
        for kind in ['vertical','horizontal']:
            value=support.invoke(page,'BenchmarkFrames',{'Kind':kind,'Frames':60})
            check(kind+' completes without render error',not value['Error'])
            workloads[kind]=value
        after=page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()')
        transport=after['Renderer']['UI']; worker=after['Renderer']['Worker']; scene=worker['Scene']
        check('UTF8 references exceed fresh encodes',transport['StringReferences']>transport['StringDefinitions']*5,
              {k:transport[k]for k in ['StringWrites','StringDefinitions','StringReferences','Utf8Bytes']})
        check('placement changes use sparse patches',transport['PatchedVisuals']>transport['ReplacedVisuals'],
              {k:transport[k]for k in ['PatchedVisuals','ReplacedVisuals','SentBytes','SentTransactions']})
        check('identical text resources are interned',transport['Resources']['InternHits']>0,transport['Resources'])
        check('server validation reuses immutable reference summaries',scene['ReferenceCacheHits']>0,scene)
        check('exact identity transforms skip native canvas operations',scene['IdentityTransformsSkipped']>0)
        check('transport retains one in-flight batch and a bounded transfer pool',transport['MaxInFlight']==1 and transport['BufferPool']['Bytes']<=16*1024*1024,transport['BufferPool'])
        support.invoke(page,'BenchmarkFrames',{'Kind':'repaint','Frames':100})
        warm=page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()')['Renderer']['UI']
        delta={k:warm[k]-transport[k]for k in ['SentBytes','SentTransactions','StringWrites','StringDefinitions']}
        check('100 warm repaint requests create no new packets or string encodes',all(v==0 for v in delta.values()),delta)
        report['DiagnosticsBefore']=before; report['DiagnosticsAfter']=after; report['Workloads']=workloads
    page.close();context.close();return snapshots

save()
try:
    with sync_playwright()as p:
        browser=p.chromium.launch(executable_path=support.browser_executable(),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        report['Browser']=browser.version
        baseline=None
        if args.baseline:
            baseline_root=args.baseline.resolve()
            report['Baseline']={'Version':json.loads((baseline_root/'package.json').read_text())['version'],'SourceFingerprint':source_fingerprint(baseline_root)}
            baseline=run(browser,baseline_root,False)
        current=run(browser,root,True)
        if baseline:
            for name,image in current.items():
                reference=baseline[name];diff=ImageChops.difference(reference,image)
                maximum=max(pair[1]for pair in diff.getextrema())
                bad=sum(1 for rgba in diff.getdata()if max(rgba)>0)
                evidence={'Channels':4,'ComparedPixels':image.width*image.height,'MaximumChannelError':maximum,'ChangedPixels':bad,
                          'BaselineRGBA256':hashlib.sha256(reference.tobytes()).hexdigest(),'OptimizedRGBA256':hashlib.sha256(image.tobytes()).hexdigest()}
                check('0.6.1 versus optimized '+name+' exact RGBA',maximum==0,evidence)
                if maximum: diff.save(out/('perf-difference-'+name+'.png'))
        browser.close()
    report['Completed']=True
except Exception as error:
    report['Errors'].append(str(error)); raise
finally:
    report['Passed']=sum(t['Passed']for t in report['Tests']);report['Failed']=len(report['Tests'])-report['Passed']
    report['FinalSourceFingerprint']=source_fingerprint(root);save()
print(json.dumps({k:report[k]for k in ['Completed','Passed','Failed','Errors','MissingAssets']},indent=2))
raise SystemExit(1 if report['Failed']or report['Errors']or report['MissingAssets']else 0)
