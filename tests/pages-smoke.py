"""Ordinary HTTP, subdirectory-hosted ControlCatalog startup; no request interception.
Run after npm run build. Requires the packages in tests/requirements.txt.
"""
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, quote
from threading import Thread
from playwright.sync_api import sync_playwright
from PIL import Image
from verification_support import source_fingerprint
import argparse
import base64
import io
import json
import os
import time

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--site-name', default='Weblonia')
args = parser.parse_args()
if not args.site_name or '/' in args.site_name or args.site_name in ('.', '..'):
    parser.error('site-name must be one path segment')
prefix = '/' + quote(args.site_name, safe='') + '/'
output = ROOT / 'artifacts/publication'
output.mkdir(parents=True, exist_ok=True)
report = {'Completed': False, 'Passed': 0, 'Failed': 0, 'Tests': [],
          'SourceFingerprint': source_fingerprint(ROOT), 'Interception': False,
          'WorkerBootstrapOverrides': False, 'IsolationHeaders': False,
          'HardwareGPUQualified': False, 'SitePrefix': prefix}

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.wasm': 'application/wasm', '.js': 'text/javascript',
                      '.mjs': 'text/javascript'}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT / 'dist'), **kw)

    def do_GET(self):
        if not urlsplit(self.path).path.startswith(prefix):
            self.send_error(404, 'Outside the project Pages prefix')
            return
        self.path = '/' + self.path[len(prefix):]
        super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
thread = Thread(target=server.serve_forever, daemon=True)
thread.start()
origin = 'http://127.0.0.1:' + str(server.server_port)
try:
    with sync_playwright() as pw:
        launch = {'headless': True, 'args': ['--disable-dev-shm-usage']}
        executable = os.environ.get('CHROMIUM_PATH')
        if executable:
            launch['executable_path'] = executable
        with pw.chromium.launch(**launch) as browser:
            report['Browser'] = browser.version
            # First case is the actual queryless default (automatic backend).
            cases = [('default', '', 'full-isolation'),
                     ('single', '?threading=single&backend=canvas', 'single'),
                     ('render-worker', '?threading=render-worker&backend=canvas', 'render-worker'),
                     ('full-isolation', '?threading=full-isolation&backend=canvas', 'full-isolation')]
            for name, query, mode in cases:
                errors, missing = [], []
                result = {'Name': name, 'ExpectedMode': mode, 'Passed': False}
                started = time.monotonic()
                context = browser.new_context(viewport={'width': 1200, 'height': 900},
                                              device_scale_factor=1.25)
                page = context.new_page()
                page.on('pageerror', lambda e: errors.append(str(e)))
                context.on('response', lambda r: missing.append(r.url)
                           if r.status >= 400 and not r.url.endswith('/favicon.ico') else None)
                try:
                    response = page.goto(origin + prefix + query, wait_until='domcontentloaded', timeout=30000)
                    assert response and response.status == 200, 'Entry document did not return HTTP 200'
                    page.wait_for_function('globalThis.catalogReady || globalThis.catalogError', timeout=90000)
                    state = page.evaluate('({Ready:!!globalThis.catalogReady, Error:globalThis.catalogError??null})')
                    assert state['Ready'] and not state['Error'], str(state)
                    expected_workers = {'single': 0, 'render-worker': 1, 'full-isolation': 2}[mode]
                    assert len(page.workers) == expected_workers, 'Incorrect dedicated-worker count'
                    for worker in page.workers:
                        assert worker.url.startswith(origin + prefix), 'Noncanonical worker URL: ' + worker.url
                    if mode == 'full-isolation':
                        diagnostics = page.evaluate('async()=>await catalogHost.GetDiagnosticsAsync()')
                        assert diagnostics['UI']['HasDocument'] is False
                        assert diagnostics['Renderer']['Worker']['HasDocument'] is False
                        page.evaluate("async()=>await catalogHost.InvokeAsync('Navigate','TableView')")
                    else:
                        page.evaluate("async()=>{await catalog.Navigate('TableView');await catalog.Root.RenderNow();}")
                        if mode == 'render-worker':
                            diagnostics = page.evaluate('async()=>await catalog.Root.Renderer.GetDiagnosticsAsync()')
                            assert diagnostics['Worker']['HasDocument'] is False
                    png = page.evaluate('''async isolated=>{
                        const bytes=await (isolated?catalogHost.CapturePngAsync():catalog.Root.CapturePngAsync());
                        let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));
                        return btoa(s);
                    }''', mode == 'full-isolation')
                    image = Image.open(io.BytesIO(base64.b64decode(png))).convert('RGBA')
                    assert any(lo != hi for lo, hi in image.getextrema()[:3]), 'Blank native frame'
                    assert not errors and not missing, str({'Errors': errors, 'Missing': missing})
                    page.screenshot(path=str(output / (name + '.png')))
                    result.update(Passed=True, Workers=expected_workers, Width=image.width, Height=image.height)
                except Exception as exc:
                    result['Error'] = str(exc)
                finally:
                    result.update(Errors=errors, MissingAssets=missing,
                                  Milliseconds=round((time.monotonic() - started) * 1000))
                    report['Tests'].append(result)
                    context.close()
                    print(('PASS ' if result['Passed'] else 'FAIL ') + name, result.get('Error', ''), flush=True)
finally:
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)
    report['Completed'] = len(report['Tests']) == 4
    report['Passed'] = sum(t['Passed'] for t in report['Tests'])
    report['Failed'] = len(report['Tests']) - report['Passed']
    report['FinalSourceFingerprint'] = source_fingerprint(ROOT)
    (output / 'pages-smoke.json').write_text(json.dumps(report, indent=2) + '\n')

if not report['Completed'] or report['Failed'] or report['SourceFingerprint'] != report['FinalSourceFingerprint']:
    raise SystemExit(1)
