"""Ordinary loopback HTTP startup smoke test. Does not change browser policies."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, os, socket, subprocess, sys, time, urllib.request

root = Path(__file__).resolve().parent.parent
out = root / 'artifacts'; out.mkdir(exist_ok=True)
with socket.socket() as s:
    s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
url = f'http://127.0.0.1:{port}/?threading=single'
report = {'Url': url, 'Mode': 'ordinary-http-navigation', 'Passed': False, 'PolicyChanged': False, 'PageErrors': []}
with (out / 'http-server.log').open('w') as log:
    server = subprocess.Popen(['node', 'scripts/serve.mjs', '--dist'], cwd=root, env={**os.environ, 'PORT': str(port)}, stdout=log, stderr=subprocess.STDOUT)
    try:
        for _ in range(100):
            if server.poll() is not None: raise RuntimeError('HTTP server failed to start')
            try:
                with urllib.request.urlopen(url, timeout=.25) as r:
                    report['HttpStatus'] = r.status; report['ContentType'] = r.headers.get('Content-Type'); break
            except OSError: time.sleep(.05)
        with sync_playwright() as p:
            launch = {'headless': True, 'args': ['--no-sandbox', '--disable-dev-shm-usage']}
            chromium = os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium')
            if Path(chromium).is_file(): launch['executable_path'] = chromium
            browser = p.chromium.launch(**launch)
            try:
                page = browser.new_page(viewport={'width': 1280, 'height': 900})
                page.on('pageerror', lambda e: report['PageErrors'].append(str(e)))
                response = page.goto(url, timeout=30000)
                page.wait_for_function('window.catalogReady || window.catalogError', timeout=60000)
                report['Browser'] = browser.version
                report['NavigationStatus'] = response.status
                report['CatalogError'] = page.evaluate('window.catalogError || null')
                report['Passed'] = bool(page.evaluate('!!window.catalogReady')) and not report['PageErrors']
                if report['Passed']: report['Backend'] = page.evaluate('window.catalog.Root.Renderer.Backend')
            finally: browser.close()
    except Exception as e:
        report['Error'] = str(e)
        report['BlockedByBrowserPolicy'] = 'ERR_BLOCKED_BY_ADMINISTRATOR' in str(e)
    finally:
        server.terminate()
        try: server.wait(timeout=10)
        except subprocess.TimeoutExpired: server.kill(); server.wait()
(out / 'http-smoke-results.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
sys.exit(0 if report['Passed'] else 2 if report.get('BlockedByBrowserPolicy') else 1)
