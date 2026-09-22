"""Pixel-level browser text qualification; uses no network or redistributed fonts."""
from pathlib import Path
from urllib.parse import unquote, urlparse
from playwright.sync_api import sync_playwright
import json, mimetypes, os, re, sys
from verification_support import source_fingerprint

root = Path(__file__).resolve().parent.parent
out = root / 'artifacts'
(out / 'screenshots').mkdir(parents=True, exist_ok=True)
html = (root / 'dist/index.html').read_text()
imports = re.search(r'<script type="importmap">(.*?)</script>', html, re.S).group(1)
errors, missing = [], []
fingerprint=source_fingerprint(root)
(out/"text-quality-results.json").write_text(json.dumps({"Completed":False,"Version":json.loads((root/"package.json").read_text())["version"],"SourceFingerprint":fingerprint}))
with sync_playwright() as p:
    launch = {'headless': True, 'args': ['--no-sandbox', '--disable-dev-shm-usage']}
    chromium = os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium')
    if Path(chromium).is_file(): launch['executable_path'] = chromium
    browser = p.chromium.launch(**launch)
    context = browser.new_context(viewport={'width': 1020, 'height': 900})
    def asset(route):
        name = unquote(urlparse(route.request.url).path).lstrip('/')
        path = (root / ('tests/' + name.removeprefix('tests/') if name.startswith('tests/') else 'dist/' + name)).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            missing.append(name); route.fulfill(status=404, body='Not found'); return
        mime = 'application/wasm' if path.suffix == '.wasm' else 'text/javascript' if path.suffix in ('.js', '.mjs') else mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
        route.fulfill(body=path.read_bytes(), headers={'Access-Control-Allow-Origin': '*', 'Content-Type': mime})
    context.route('http://localhost:4173/**', asset)
    page = context.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content('''<!doctype html><html><head><base href="http://localhost:4173/">
        <style>body{font-family:system-ui;margin:32px;background:#f5f6fa;color:#171b26}h1{font-size:26px}p{font-size:14px;color:#5b6172}section{background:white;margin:18px 0;padding:16px;border:1px solid #dce0ea;border-radius:10px}h2{font-size:14px;margin:0 0 8px}canvas{display:block}</style>
        <script type="importmap">''' + imports + '''</script></head><body>
        <h1>AvaloniaWeb · Text quality verification</h1><p>Actual native Skia output · device-aligned browser-font rasterization · 128px tiles</p>
        <div id="gallery"></div><script type="module">
        import { RunTextQuality } from './tests/text-quality.js';
        try { window.report = await RunTextQuality(); } catch(error) { window.fatal = error.stack; }
        </script></body></html>''')
    page.wait_for_function('window.report || window.fatal', timeout=90000)
    fatal = page.evaluate('window.fatal')
    report = page.evaluate('window.report') or {'Passed': 0, 'Failed': 1, 'Fatal': fatal, 'Tests': []}
    report.update({'Browser': browser.version, 'Mode': 'local-asset-interception', 'PageErrors': errors, 'MissingAssets': missing})
    page.screenshot(path=str(out / 'screenshots/text-quality.png'), full_page=True)
    browser.close()
report.update({'Completed':True,'Version':json.loads((root/'package.json').read_text())['version'],'SourceFingerprint':fingerprint,'FinalSourceFingerprint':source_fingerprint(root)})
if report['SourceFingerprint']!=report['FinalSourceFingerprint']:report['Failed']+=1;report['SourceChanged']=True
(out / 'text-quality-results.json').write_text(json.dumps(report, indent=2) + '\n')
for case in report['Tests']: print('PASS' if case['Passed'] else 'FAIL', case['Name'], case.get('Error', ''))
print(json.dumps({k: report[k] for k in ('Passed', 'Failed', 'PageErrors', 'MissingAssets')}))
sys.exit(1 if report['Failed'] or errors or missing else 0)
