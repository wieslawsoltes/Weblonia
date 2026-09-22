"""Real catalog HTTP hosting for integration tests; no route interception or
worker/application URL overrides. The intercepted mode remains an explicit local
fallback for administrator-managed browsers that forbid ordinary navigation.
"""
from contextlib import contextmanager
from pathlib import Path
import os, socket, subprocess, time, urllib.request
from threading_support import ROOT

@contextmanager
def catalog_http_server():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    log_path = ROOT/'artifacts/threading/integration-http-server.log'
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open('w') as log:
        server = subprocess.Popen(['node', 'scripts/serve.mjs'], cwd=ROOT,
            env={**os.environ, 'PORT': str(port)}, stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 10
            while True:
                if server.poll() is not None: raise RuntimeError('Catalog HTTP server stopped; inspect '+str(log_path))
                try:
                    with urllib.request.urlopen(origin+'/', timeout=.5) as response:
                        if response.status == 200: break
                except OSError:
                    if time.monotonic() >= deadline: raise RuntimeError('Catalog HTTP server did not become ready')
                    time.sleep(.03)
            yield origin
        finally:
            server.terminate()
            try: server.wait(timeout=5)
            except subprocess.TimeoutExpired: server.kill(); server.wait()

def load_http_catalog(context, origin, errors, missing):
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('response', lambda response: missing.append(response.url) if response.status >= 400 else None)
    response = page.goto(origin+'/?threading=full-isolation&backend=canvas', timeout=15000)
    if response.status != 200: raise AssertionError('Catalog HTTP navigation failed')
    page.wait_for_function('globalThis.catalogReady||globalThis.catalogError', timeout=60000)
    error = page.evaluate('globalThis.catalogError')
    if error: raise AssertionError(error)
    urls = [worker.url for worker in page.workers]
    if len(urls) != 2 or not all(url.startswith(origin+'/packages/browser/worker-assets/') for url in urls):
        raise AssertionError({'NoncanonicalWorkerUrls': urls})
    return page

def wait_window_open(page, invoke, timeout=30):
    """Wait for observable lifecycle, not an assumed 150 ms permission prompt.
    Preserve the same finite startup budget and expose child bootstrap stages on
    failure. Do not retry workers, inject a render call or accept partial startup.
    """
    deadline = time.monotonic()+timeout
    state = None
    children = []
    while time.monotonic() < deadline:
        permit = page.locator('dialog[open] button', has_text='Continue')
        if permit.count(): permit.first.click()
        state = invoke(page, 'GetWindowState')
        if state['Opened'] or state['Error']: return state
        children = page.evaluate('''()=>[...catalogHost.Children].filter(h=>!h.IsDisposed).map(h=>({
            Closed:h.Window.closed,Error:h.LastError?.message??null,Stages:h.StartupEvents,
            NativePreparation:{...h._wasmSource?.Statistics,Pending:h._wasmSource?.PendingDeliveries}}))''')
        if any(child['Error'] for child in children):
            raise AssertionError({'State':state,'ChildHosts':children})
        page.wait_for_timeout(100)
    raise AssertionError({'WindowStartupTimedOut':True,'State':state,'ChildHosts':children})
