import { CompileWasmAsync } from '@wieslawsoltes/skiasharpweb/wasm';

/** The host owns compiled CODE, not a CanvasKit runtime or a native heap.
 * A fresh one-shot port accompanies each original initialize message, allowing
 * worker graph imports and native code preparation to run concurrently. */
export class SkiaWasmModuleSource {
    constructor(options = {}) {
        this._ports = new Map();
        this.IsDisposed = false;
        this.Timeout = options.InitializationTimeout ?? 45000;
        if (!Number.isFinite(this.Timeout) || this.Timeout <= 0) throw new TypeError('A positive initialization timeout is required.');
        this.Statistics = { PreparationMilliseconds: 0, Deliveries: 0, CloneFallbacks: 0 };
        const started = performance.now();
        this.Promise = (options.WasmModule !== undefined ? Promise.resolve(options.WasmModule)
            : CompileWasmAsync(new URL('canvaskit.wasm', options.AssetBaseUrl)))
            .then(module => { WebAssembly.Module.exports(module); return module; });
        this.Promise.then(() => this.Statistics.PreparationMilliseconds = performance.now() - started,
            () => this.Statistics.PreparationMilliseconds = performance.now() - started);
    }
    CreatePort({ Signal } = {}) {
        Signal?.throwIfAborted();
        if (this.IsDisposed) throw new Error('Skia module source is disposed.');
        const { port1, port2 } = new MessageChannel();
        let requested = false, result, complete = false, timer;
        const abort = () => {
            try { port1.postMessage({ Type: 'skia-module-error', Message: Signal.reason?.message ?? 'Skia module delivery canceled.' }); } catch {}
            close();
        };
        const close = () => { complete = true; Signal?.removeEventListener('abort', abort); clearTimeout(timer); this._ports.delete(port1); port1.onmessage = null; port1.onmessageerror = null; port1.close(); };
        this._ports.set(port1, close);
        Signal?.addEventListener('abort', abort, { once: true });
        const send = () => {
            if (!requested || !result || complete || this.IsDisposed) return;
            complete = true;
            try {
                port1.postMessage(result);
                if (result.Type !== 'skia-module') close();
            } catch (error) {
                // Certain browser/agent-cluster configurations cannot clone a
                // module. Fall back explicitly to compilation inside that worker.
                if (error.name === 'DataCloneError') {
                    try { port1.postMessage({ Type: 'skia-module-local' }); } catch { close(); }
                } else {
                    try { port1.postMessage({ Type: 'skia-module-error', Message: error.message }); } catch {}
                    close();
                }
            }
        };
        port1.onmessage = event => {
            if (complete && event.data?.Type === 'skia-module-ack') {
                if (event.data.Shared) this.Statistics.Deliveries++; else this.Statistics.CloneFallbacks++;
                close(); return;
            }
            if (event.data?.Type !== 'skia-module-request' || requested) return;
            requested = true; send();
        };
        timer = setTimeout(() => {
            try { port1.postMessage({ Type: 'skia-module-error', Message: 'Shared Skia WASM preparation timed out.' }); } catch {}
            close();
        }, this.Timeout);
        timer.unref?.();
        port1.onmessageerror = close;
        port1.start();
        this.Promise.then(module => { result = { Type: 'skia-module', Module: module }; send(); },
            error => { result = { Type: 'skia-module-error', Message: error?.message ?? String(error) }; send(); });
        return port2;
    }
    get PendingDeliveries() { return this._ports.size; }
    Dispose() {
        if (this.IsDisposed) return;
        this.IsDisposed = true;
        for (const [port, close] of this._ports) {
            try { port.postMessage({ Type: 'skia-module-error', Message: 'Skia module source disposed during initialization.' }); } catch {}
            close();
        }
        this._ports.clear();
    }
}

export function ReceiveSkiaWasmModuleAsync(port, timeout = 45000) {
    return new Promise((resolve, reject) => {
        let settled = false, timer;
        const finish = (error, value) => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            if (!error) { try { port.postMessage({ Type: 'skia-module-ack', Shared: value != null }); } catch {} }
            if (port?.close) { port.onmessage = null; port.onmessageerror = null; port.close(); }
            if (error) reject(error); else resolve(value);
        };
        try {
            if (!port?.postMessage || !Number.isFinite(timeout) || timeout <= 0)
                throw new TypeError('A one-shot module port and positive timeout are required.');
            timer = setTimeout(() => finish(new Error('Shared Skia WASM preparation timed out.')), timeout);
            port.onmessage = ({ data }) => {
                if (data?.Type === 'skia-module') {
                    try { WebAssembly.Module.exports(data.Module); finish(null, data.Module); }
                    catch (error) { finish(error); }
                } else if (data?.Type === 'skia-module-local') finish(null, null);
                else finish(new Error(data?.Message ?? 'Invalid shared Skia module message.'));
            };
            // Cross-origin/opaque-origin agent clusters may refuse Module decoding.
            // Preserve functionality by compiling locally, never by sharing heaps.
            port.onmessageerror = () => finish(null, null);
            port.start();
            port.postMessage({ Type: 'skia-module-request' });
        } catch (error) { finish(error); }
    });
}
