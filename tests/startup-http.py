"""Cold-process ControlCatalog startup over ordinary HTTP, optionally versus a checkout.
No intercepted requests, worker overrides, isolation headers, or timing gates.
Each trial launches a fresh browser; counters and time-to-ready are reported separately.
"""
import argparse, json, os, statistics, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread, Lock
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
from verification_support import source_fingerprint

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline', type=Path)
parser.add_argument('--trials', type=int, default=3)
parser.add_argument('--out', type=Path, default=ROOT/'artifacts/startup/http-comparison.json')
args = parser.parse_args()
if not 1 <= args.trials <= 20: parser.error('trials must be between 1 and 20')
report = {'Completed':False,'Passed':False,'SourceFingerprint':source_fingerprint(ROOT),
          'Interception':False,'WorkerOverrides':False,'ColdBrowserPerTrial':True,
          'IsolationHeaders':False,'PhysicalGpuQualified':False,'Trials':[]}
def run(pw, checkout, label, trial):
    hits, mutex = [], Lock()
    class Handler(SimpleHTTPRequestHandler):
        extensions_map = {**SimpleHTTPRequestHandler.extensions_map,'.wasm':'application/wasm','.mjs':'text/javascript'}
        def __init__(self,*a,**k): super().__init__(*a,directory=str(checkout/'dist'),**k)
        def do_GET(self):
            if not self.path.startswith('/Weblonia/'): self.send_error(404);return
            with mutex: hits.append(self.path)
            self.path='/' + self.path[len('/Weblonia/'):]
            super().do_GET()
        def log_message(self,*a): pass
        def end_headers(self):
            self.send_header('Cache-Control','no-store');super().end_headers()
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    errors=[];result={'Variant':label,'Trial':trial,'Passed':False}
    try:
        launch={'headless':True,'args':['--disable-dev-shm-usage']}
        if os.environ.get('CHROMIUM_PATH'): launch['executable_path']=os.environ['CHROMIUM_PATH']
        with pw.chromium.launch(**launch) as browser:
            with browser.new_context(viewport={'width':1200,'height':900},device_scale_factor=1.25) as context:
                page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
                start=time.perf_counter()
                page.goto(f'http://127.0.0.1:{server.server_port}/Weblonia/?backend=canvas',wait_until='domcontentloaded')
                page.wait_for_function('globalThis.catalogReady||globalThis.catalogError',timeout=90000)
                result['ReadyMilliseconds']=(time.perf_counter()-start)*1000
                assert page.evaluate('!!globalThis.catalogReady && !globalThis.catalogError'),page.evaluate('globalThis.catalogError')
                with mutex: initial=list(hits)
                result['Requests']=len(initial)
                result['WasmRequests']=sum(urlsplit(p).path.endswith('/canvaskit.wasm') for p in initial)
                result['AotBuilderRequests']=sum('/compiled/' in p and p.endswith('.g.js') for p in initial)
                result['MainResources']=len(page.evaluate("performance.getEntriesByType('resource')"))
                result['Diagnostics']=page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()')
                result['Browser']=browser.version
                if label=='optimized':
                    assert result['WasmRequests']==1,result['WasmRequests']
                    assert result['Diagnostics']['Host']['NativePreparation']['Deliveries']==2
                    assert result['AotBuilderRequests']==1,result['AotBuilderRequests']
                else: assert result['WasmRequests']>=1
                assert not errors,errors
                result['PngBytes']=page.evaluate('async()=> (await catalogHost.CapturePngAsync()).length')
                assert result['PngBytes']>256
                result['Passed']=True
    except Exception as error: result['Error']=str(error)
    finally: server.shutdown();server.server_close();thread.join(timeout=5)
    result['Errors']=errors
    print(json.dumps({k:v for k,v in result.items() if k!='Diagnostics'}),flush=True)
    return result
try:
    with sync_playwright() as pw:
        for trial in range(args.trials):
            variants=[(ROOT,'optimized')]
            if args.baseline: variants.append((args.baseline.resolve(),'baseline'))
            if trial%2: variants.reverse()
            for checkout,label in variants: report['Trials'].append(run(pw,checkout,label,trial))
    report['Completed']=True
    report['Passed']=all(t['Passed'] for t in report['Trials'])
    report['Summary']={}
    for label in sorted({t['Variant'] for t in report['Trials']}):
        rows=[t for t in report['Trials'] if t['Variant']==label and t['Passed']]
        if rows: report['Summary'][label]={k:statistics.median(t[k] for t in rows) for k in ['ReadyMilliseconds','Requests','WasmRequests','AotBuilderRequests','MainResources']}
finally:
    report['FinalSourceFingerprint']=source_fingerprint(ROOT)
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(report,indent=2)+'\n')
if not report['Passed'] or report['FinalSourceFingerprint']!=report['SourceFingerprint']: raise SystemExit(1)
