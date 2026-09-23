/** Secondary-window bootstrap observers. They only observe lifecycle; no worker
 * retry, source rewriting, input injection or forced rendering is performed. */
function observe({ Signal, Timeout = 30000 } = {}, install) {
    return new Promise((resolve, reject) => {
        const cleanup = [];
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            for (const dispose of cleanup.splice(0)) dispose();
            error ? reject(error) : resolve();
        };
        const listen = (target, type, callback) => {
            target.addEventListener(type, callback);
            cleanup.push(() => target.removeEventListener(type, callback));
        };
        try {
            if (!Number.isFinite(Timeout) || Timeout <= 0) throw new RangeError('Secondary-window startup deadline expired.');
            Signal?.throwIfAborted();
            if (Signal) listen(Signal, 'abort', () => finish(Signal.reason ?? new Error('Secondary-window startup canceled.')));
            const timer = setTimeout(() => finish(new Error('Secondary-window startup timed out.')), Timeout);
            cleanup.push(() => clearTimeout(timer));
            install(listen, finish);
        } catch (error) { finish(error); }
    });
}

/** Do not create a Worker against a newly opened, still-loading document. */
export function WaitForWindowDocumentAsync(window, options) {
    return observe(options, (listen, finish) => {
        const document = window.document;
        const check = () => {
            if (window.closed || window.document !== document) finish(new Error('Secondary window closed or navigated during startup.'));
            else if (document.readyState === 'complete') finish();
        };
        listen(window, 'load', check);
        listen(window, 'pagehide', () => finish(new Error('Secondary window navigated during startup.')));
        check();
    });
}

export function SecondaryWorkerError(event, url) {
    const detail = event?.message || 'entry script failed before reporting a bootstrap stage';
    const location = event?.filename ? ` at ${event.filename}:${event.lineno ?? 0}:${event.colno ?? 0}` : '';
    return new Error(`Secondary render worker failed (${String(url)}): ${detail}${location}`);
}

/** Observe the bootstrap's final native-ready notification without consuming
 * the render channel. Its queued ready message still belongs to the UI worker. */
export function WaitForSecondaryRendererAsync(worker, url, start, options) {
    return observe(options, (listen, finish) => {
        listen(worker, 'message', ({ data }) => {
            if (data?.Role !== 'render') return;
            if (data.Type === 'bootstrap-error') finish(new Error(data.Error || 'Secondary render bootstrap failed.'));
            else if (data.Type === 'startup-progress' && data.Stage === 'ready') finish();
        });
        listen(worker, 'error', event => finish(SecondaryWorkerError(event, url)));
        listen(worker, 'messageerror', () => finish(new Error('Secondary render worker startup message could not be deserialized.')));
        start();
    });
}

/** Give the secondary worker a committed same-origin owner Document. A fresh
 * WindowProxy can initially expose a complete about:blank document even when a
 * navigation is pending. Readiness is acknowledged by the actual host page,
 * correlated by both WindowProxy identity and an unguessable fragment token.
 * No worker retry or elapsed-time readiness heuristic is involved.
 */
export async function OpenSecondaryDocumentAsync(owner, url, features, options = {}) {
    const target = new URL(url, owner.location.href);
    if (target.origin !== owner.location.origin || !['http:', 'https:'].includes(target.protocol))
        throw new TypeError('Secondary window host must be an HTTP(S) document on the application origin.');
    if (target.username || target.password) throw new TypeError('Secondary window host cannot include credentials.');
    const token = owner.crypto.randomUUID();
    target.hash = 'avalonia-window=' + token;
    let popup;
    try {
        await observe(options, (listen, finish) => {
            listen(owner, 'message', event => {
                if (event.source !== popup || event.origin !== target.origin ||
                    event.data?.Type !== 'avalonia-secondary-document-ready' || event.data.Token !== token) return;
                try {
                    if (popup.closed || popup.location.href !== target.href || popup.document.readyState !== 'complete')
                        throw new Error('Secondary host document changed before readiness acknowledgement.');
                    finish();
                } catch (error) { finish(error); }
            });
            // All listeners are installed before the synchronously activated open.
            popup = owner.open(target.href, '_blank', features);
            if (!popup) throw new Error('The browser blocked this popup.');
        });
        return popup;
    } catch (error) {
        try { popup?.close(); } catch { /* preserve the original failure */ }
        throw error;
    }
}
