import { SkiaWasmModuleSource } from "../../skia/src/wasm-module-source.js";
import { BrowserThreadingMode, GetBrowserWorkerUrls } from './threading-options.js';
export { BrowserThreadingMode, GetBrowserWorkerUrls } from './threading-options.js';
import { Event, Disposable, Matrix } from "../../base/src/index.js";
import { Color } from "../../media/src/index.js";
import { CompositionBufferPool, EncodeCompositionBatch, CompositionChangeAccumulator, CompositionSceneRecorder } from "../../rendering/src/index.js";

const asError = data => { const e = new Error(data?.Message ?? String(data)); e.name = data?.Name ?? 'WorkerError'; if (data?.Stack) e.stack = data.Stack; return e; };
const deferred = () => { let Resolve, Reject; const PromiseValue = new Promise((r, j) => { Resolve = r; Reject = j; }); PromiseValue.catch(() => {}); return { Promise: PromiseValue, Resolve, Reject }; };

/** UI-owned proxy. Its only mutable graphics state is the latest desired scene.
 * Exactly one transferable delta is in flight; pending changes are coalesced
 * against the acknowledged snapshot, never by dropping dependency-bearing deltas. */
export class WorkerSkiaRenderer extends Disposable {
    constructor(platform, root, element, options = {}) {
        super(); this.Platform = platform; this.Root = root; this.Element = element; this.Options = options; this.Surface = null;
        this.Mode = BrowserThreadingMode.RenderWorker; this.Backend = null; this.LastFrameMilliseconds = 0;
        this.FrameRendered = new Event(); this.Errors = new Event(); this.Accumulator = new CompositionChangeAccumulator(); this.BufferPool = new CompositionBufferPool(options.BufferPool);
        this.Recorder = new CompositionSceneRecorder(root, platform); this.Port = null; this.Worker = null;
        this.Statistics = { EncodeMilliseconds: 0, LastEncodeMilliseconds: 0, EncodeCalls: 0, StringWrites: 0, Utf8Bytes: 0, StringDefinitions: 0, StringReferences: 0, PatchedVisuals: 0, ReplacedVisuals: 0, SentTransactions: 0, SentBytes: 0, PendingFramesCoalesced: 0, ProcessedSequence: 0, SubmittedSequence: 0, Restarts: 0, MaxInFlight: 0, LastWorkerFrame: 0 };
        this._requests = new Map(); this._nextRequest = 1; this._waiters = []; this._processedWaiters = [];this._capturedProcessedWaiters=[]; this._ready = deferred(); this._latestRevision = 0; this._preparedRevision = 0; this._preparedSequence = 0;
        this._fontSubscription = null;
        this.CompositionTransport = { RequestCommitAsync: () => { if(this.IsDisposed||this.LastError)return Promise.reject(this.LastError??new Error('Renderer disposed.'));if(this._processedWaiters.length)return this._processedWaiters[0].Promise;if(this._capturedProcessedWaiters.length>=(this.Options.MaxCommitWaiters??1024))return Promise.reject(new Error('Composition commit waiter budget exceeded.'));const d = deferred(); this._processedWaiters.push(d); this.Root._RequestRender(); return d.Promise; } };
    }
    async Initialize() {
        if (this.Options.Port) { this.Connect(this.Options.Port); return this._ready.Promise; }
        if (typeof Worker !== 'function' || typeof this.Element?.transferControlToOffscreen !== 'function') throw new Error('Render-worker mode requires dedicated workers and OffscreenCanvas transfer.');
        const urls = { ...GetBrowserWorkerUrls(), ...this.Options.WorkerUrls };
        const worker = new Worker(this.Options.RenderWorkerUrl ?? urls.RenderWorkerUrl, { type: this.Options.WorkerType ?? 'module', name: 'Avalonia.Composition.Render' }); this.Worker = worker;
        this.Startup = { Stage: 'worker-script', Url: this.Options.RenderWorkerUrl ?? urls.RenderWorkerUrl };
        worker.onmessage = event => {
            const message = event.data;
            if (message?.Type === 'startup-progress') this.Startup = message;
            else if (message?.Type === 'bootstrap-error') this._Fail(new Error(message.Error));
        };
        worker.onmessageerror = () => this._Fail(new Error('Render worker startup message could not be deserialized.'));
        worker.onerror = event => { this._Recover(new Error(`Render worker failed: ${event.message || 'could not load its entry script; check the worker URL, MIME type and CSP'}`)); };
        const channel = new MessageChannel(),input=new MessageChannel();this.FastInputPort=input.port1;this.FastInputPort.start();this.Connect(channel.port1);
        const canvas = this.Element.transferControlToOffscreen(); this._transferred = true;
        const runtime = {
            ...this.Options.WorkerOptions, Backend: this.Options.Backend ?? 'auto', AllowFallback: this.Options.AllowFallback,
            LoaderUrl: this.Options.LoaderUrl ?? urls.LoaderUrl,
            AssetBaseUrl: this.Options.AssetBaseUrl ?? new URL('../vendor/', import.meta.resolve("../../../vendor/skiasharpweb/dist/package/browser.js")).href,
            HandlerModules: this.Options.HandlerModules ?? [], PlatformOptions: this.Options.Skia ?? {},
        };
        const transfer = [canvas, channel.port2, input.port2];
        if (this.Options.ShareWasmModule !== false) {
            this._wasmSource?.Dispose();
            this._wasmSource = new SkiaWasmModuleSource({ ...runtime, WasmModule: this.Options.WasmModule ?? runtime.WasmModule, InitializationTimeout: this.Options.InitializationTimeout });
            runtime.WasmModulePort = this._wasmSource.CreatePort();
            runtime.InitializationTimeout = this.Options.InitializationTimeout ?? 45000;
            transfer.push(runtime.WasmModulePort);
        }
        worker.postMessage({ Type: 'initialize', Canvas: canvas, Port: channel.port2, InputPort:input.port2, Options: runtime }, transfer);
        return this._ready.Promise;
    }
    Connect(port) {
        if (this.Port) throw new Error('Render channel is already connected.'); this.Port = port;
        const timer = this._initializationTimer = setTimeout(() => this._Fail(new Error(`Render worker initialization timed out during ${this.Startup?.Stage ?? 'render-channel'}${this.Startup?.Url ? ' (' + this.Startup.Url + ')' : ''}.`)), this.Options.InitializationTimeout ?? 45000); timer.unref?.();
        this._ready.Promise.finally(() => clearTimeout(timer)).catch(() => {});
        port.onmessage = event => this._Message(event.data); port.onmessageerror = () => this._Fail(new Error('Render channel could not deserialize a message.')); port.start();
    }
    _Message(message) {
        if (this.IsDisposed && message?.Type !== 'response') return;
        switch (message?.Type) {
            case 'ready': this.Backend = message.Backend; this.WorkerDiagnostics = message.Diagnostics; this.BackendFailures = message.BackendFailures; this._ready.Resolve(this); this._Pump(); break;
            case 'error': this._Fail(asError(message.Error)); break;
            case 'device-lost': this._Recover(new Error(`Worker graphics device lost: ${message.Info?.Message}`)); break;
            case 'batch-error': if (message.Buffer?.byteLength) this.BufferPool.Return(message.Buffer); this._Fail(asError(message.Error)); break;
            case 'processed': {
                if (message.Generation !== this.Accumulator.Generation) {if(message.Buffer?.byteLength)this.BufferPool.Return(message.Buffer);return;}
                clearTimeout(this._batchTimer);
                if (message.Buffer?.byteLength) this.BufferPool.Return(message.Buffer);
                const flight = this.Accumulator.InFlight;
                this._AcknowledgeMessages(flight?.Snapshot);
                this.Accumulator.Acknowledge(message.Sequence, message.Generation); this.Statistics.ProcessedSequence = message.Sequence;
                for (const waiter of flight?.ProcessedWaiters ?? []) waiter.Resolve();
                this._Pump(); this._CheckWaiters(); break;
            }
            case 'submitted': case 'frame': {
                if (message.Generation !== this.Accumulator.Generation) break;
                this.Statistics.SubmittedSequence = Math.max(this.Statistics.SubmittedSequence, message.Sequence);
                this.Statistics.LastWorkerFrame = message.Frame; this.LastFrameMilliseconds = message.Duration; this.Backend = message.Backend;
                // Submission completion and the frame-credit notification can refer
                // to the SAME frame. Acknowledge both protocols, project state once.
                if (this._notifiedGeneration !== message.Generation || this._notifiedFrame !== message.Frame) {
                    this._notifiedGeneration = message.Generation; this._notifiedFrame = message.Frame;
                    this._ApplyReadback(message.Readback ?? []);
                    this.FrameRendered.Raise(this, { Duration: message.Duration, Backend: message.Backend, RenderMode: message.RenderMode, Sequence: message.Sequence, Frame: message.Frame, Worker: true });
                }
                this._CheckWaiters(); if (message.Type === 'frame') this.Port.postMessage({ Type: 'frame-ack' }); break;
            }
            case 'response': {
                const request = this._requests.get(message.Id); if (!request) return; this._requests.delete(message.Id); clearTimeout(request.Timer);
                message.Error ? request.Reject(asError(message.Error)) : request.Resolve(message.Value); break;
            }
        }
    }
    PreprocessWheel(event){
        const sequence=this.Root.LastInputSequence=(this.Root.LastInputSequence??0)+1;
        this.FastInputPort?.postMessage({Type:'input-wheel',Sequence:sequence,Event:{Position:this.Root._EventPosition(event),deltaX:event.deltaX,deltaY:event.deltaY,deltaMode:event.deltaMode,shiftKey:event.shiftKey}});
        this.Root._RequestRender();
    }
    _AcknowledgeMessages(snapshot){
        if(!snapshot?.Composition.size)return;
        const objects=new Map([...(this.Root.Compositor?._objects??[])].map(o=>[o.Id,o]));
        for(const [id,descriptor]of snapshot.Composition){const last=descriptor.Custom?.Messages.at(-1)?.Sequence,object=objects.get(id);if(last&&object?._workerMessages)object._workerMessages=object._workerMessages.filter(m=>m.Sequence>last);}
    }
    _ApplyReadback(items) {
        const objects = this.Root.Compositor?._objects; if (!objects || !items.length) return;
        const byId = new Map([...objects].map(o => [o.Id, o]));
        for (const entry of items) {
            const object = byId.get(entry.Id); if (!object || object.IsDisposed) continue;
            object._serverValues = new Map(entry.Values.map(([k, v]) => [k, v?.Matrix ? new Matrix(...v.Matrix) : v?.Color ? new Color(...v.Color) : v]));
        }
    }
    _Fail(error) {
        if (this.IsDisposed || this.LastError) return;
        this.LastError = error;clearTimeout(this._batchTimer);clearTimeout(this._initializationTimer); this._ready.Reject(error);
        // A failed bootstrap owns transferred ports/canvas: stop it immediately,
        // not after the unrelated request timeout or an automatic startup retry.
        if (!this.Backend) { this._wasmSource?.Dispose(); this.Worker?.terminate(); this.FastInputPort?.close?.(); this.Port?.close?.(); }
        for (const waiter of this._waiters.splice(0)) waiter.Reject(error);
        for (const waiter of [...this._processedWaiters.splice(0),...this._capturedProcessedWaiters.splice(0)]) waiter.Reject(error);
        for (const waiter of this.Accumulator.InFlight?.ProcessedWaiters ?? []) waiter.Reject(error);
        for (const request of this._requests.values()) { clearTimeout(request.Timer); request.Reject(error); } this._requests.clear();
        this.Root._ReportRenderError?.(error); this.Errors.Raise(this, { Error: error });
    }
    _Recover(error) {
        if(this.IsDisposed)return;
        if(!this.Backend){this._Fail(error);return;}
        if(this._restartTask)return;
        if(this.Options.AutoRecover===false||this.Statistics.Restarts>=(this.Options.MaxRestarts??1)){this._Fail(error);return;}
        this.LastRecoveryReason=error.message;
        this.RestartAsync().catch(failure=>this._Fail(failure));
    }
    RestartAsync() {
        if(this._restartTask)return this._restartTask;
        if(this.IsDisposed)return Promise.reject(new Error('Renderer disposed.'));
        return this._restartTask=this._RestartCore().finally(()=>{this._restartTask=null;});
    }
    async _RestartCore() {
        clearTimeout(this._batchTimer);
        const interrupted=new Error('Renderer restarted before completion.');
        for(const r of this._requests.values()){clearTimeout(r.Timer);r.Reject(interrupted);}this._requests.clear();
        for(const r of this.Accumulator.InFlight?.ProcessedWaiters??[])r.Reject(interrupted);
        for(const r of this._waiters.splice(0))r.Reject(interrupted);
        this.FastInputPort?.close();this.Port?.close();this.Worker?.terminate();this.Port=null;this.Worker=null;this.Backend=null;this.LastError=null;this._ready=deferred();
        this.Accumulator.Reset();this._preparedRevision=0;this._preparedSequence=0;this._hiddenSubmission=false;this.Recorder.ResetServerState();this.Accumulator.Update(this.Recorder.Capture());this.Statistics.ProcessedSequence=this.Statistics.SubmittedSequence=0;++this.Statistics.Restarts;
        if(this.Options.RestartRenderer){const result=await this.Options.RestartRenderer();this.Connect(result.Port);await this._ready.Promise;}
        else {
            if(!this.Element?.ownerDocument)throw new Error('The host must provide a replacement canvas/channel for this renderer.');
            const old=this.Element,canvas=old.ownerDocument.createElement('canvas');
            for(const attribute of [...old.attributes])if(attribute.name!=='width'&&attribute.name!=='height')canvas.setAttribute(attribute.name,attribute.value);
            old.replaceWith(canvas);this.Element=canvas;this.Root._OnCanvasChanged(canvas,old);await this.Initialize();
        }
        this.Root.LastRenderError=null;this.Render();await this.FlushAsync();return this;
    }
    _Pump() {
        if (!this.Backend || !this.Port || this.IsDisposed || this.LastError) return;
        const batch = this.Accumulator.Prepare();
        if (!batch) {
            // A composition commit with no semantic changes is already processed.
            if (!this.Accumulator.InFlight) {
                // A semantic no-op still maps this capture revision to the last
                // accepted transaction, which may not have been submitted yet.
                this._preparedRevision = this.Accumulator.Revision;
                this._preparedSequence = this.Accumulator.Sequence;
                for (const w of this._capturedProcessedWaiters.splice(0)) w.Resolve();
            }
            return;
        }
        try {
            const encodeStarted = performance.now();
            const encoded = EncodeCompositionBatch(batch.Value, batch, this.BufferPool);
            this.Statistics.LastEncodeMilliseconds = performance.now() - encodeStarted;
            this.Statistics.EncodeMilliseconds += this.Statistics.LastEncodeMilliseconds; ++this.Statistics.EncodeCalls;
            this.Statistics.StringWrites += encoded.Statistics.StringWrites; this.Statistics.Utf8Bytes += encoded.Statistics.Utf8Bytes;
            this.Statistics.StringDefinitions += encoded.Statistics.StringDefinitions; this.Statistics.StringReferences += encoded.Statistics.StringReferences;
            this.Statistics.PatchedVisuals += batch.Value.Nodes.Patch?.length ?? 0; this.Statistics.ReplacedVisuals += batch.Value.Nodes.Upsert.length;
            this.Accumulator.InFlight.ProcessedWaiters = this._capturedProcessedWaiters.splice(0);
            this._preparedRevision = this.Accumulator.InFlight.Revision;
            this._preparedSequence = batch.Sequence;
            clearTimeout(this._batchTimer);this._batchTimer=setTimeout(()=>this._Recover(new Error('Composition transaction timed out.')),this.Options.TransactionTimeout??30000);
            this.Port.postMessage({ Type: 'batch', Buffer: encoded.Buffer, ByteLength: encoded.ByteLength, Sequence: batch.Sequence, Generation: batch.Generation }, [encoded.Buffer]);
            ++this.Statistics.SentTransactions; this.Statistics.SentBytes += encoded.ByteLength; this.Statistics.MaxInFlight = Math.max(this.Statistics.MaxInFlight, 1);
        } catch (error) { this._Fail(error); }
    }
    async Resize(width, height, scale = 1) {
        if (!this.Port) await this.Initialize(); else await this._ready.Promise;
        this.RenderScaling = scale; this.Width = width; this.Height = height;
        // Pixel dimensions belong exclusively to the render worker after transfer.
    }
    Render() {
        if (this.IsDisposed || this.LastError) return false;
        const compositor = this.Root.Compositor;
        if (compositor && compositor.ServerTransport !== this.CompositionTransport) compositor.SetServerTransport(this.CompositionTransport);
        const snapshot = this.Recorder.Capture();this._capturedProcessedWaiters.push(...this._processedWaiters.splice(0)); if (this.Accumulator.InFlight) ++this.Statistics.PendingFramesCoalesced;
        this.Accumulator.Update(snapshot); this._latestRevision = this.Accumulator.Revision; this._Pump(); return true;
    }
    _CheckWaiters() {
        const pending = [];
        for (const waiter of this._waiters) {
            if (waiter.Generation !== this.Accumulator.Generation) {
                waiter.Reject(new Error('Renderer restarted before completion.'));
                continue;
            }
            // Bind once, to the first prepared snapshot which includes or
            // supersedes the requested revision. Never chase future animation.
            if (waiter.Sequence == null && this._preparedRevision >= waiter.Revision)
                waiter.Sequence = this._preparedSequence;
            if (waiter.Sequence != null && this.Statistics.SubmittedSequence >= waiter.Sequence)
                waiter.Resolve();
            else pending.push(waiter);
        }
        this._waiters = pending;
        // Explicit requests can submit once while the automatic clock is hidden.
        // Newer in-flight animation must not prevent an already processed fence
        // from requesting its submission. One RPC at a time, not a busy loop.
        if (this._visible === false && !this._hiddenSubmission && pending.some(w =>
            w.Sequence != null && this.Statistics.ProcessedSequence >= w.Sequence)) {
            this._hiddenSubmission = true;
            const generation = this.Accumulator.Generation;
            this.RequestAsync('render').catch(error => {
                if (generation === this.Accumulator.Generation) this._Fail(error);
            }).finally(() => {
                if (generation === this.Accumulator.Generation) {
                    this._hiddenSubmission = false; this._CheckWaiters();
                }
            });
        }
    }
    async FlushAsync() {
        if (this.IsDisposed) throw new Error('Renderer disposed.');
        if (this.LastError) throw this.LastError;
        const revision = this.Accumulator.Revision, generation = this.Accumulator.Generation;
        await this._ready.Promise;
        if (this.IsDisposed) throw new Error('Renderer disposed.');
        if (this.LastError) throw this.LastError;
        if (generation !== this.Accumulator.Generation) throw new Error('Renderer restarted before completion.');
        this._Pump();
        const sequence = this._preparedRevision >= revision ? this._preparedSequence : null;
        if (sequence != null && this.Statistics.SubmittedSequence >= sequence) return;
        if (this._waiters.length >= (this.Options.MaxRequests ?? 128)) throw new Error('Composition submission waiter queue is full.');
        const d = Object.assign(deferred(), { Revision: revision, Generation: generation, Sequence: sequence });
        this._waiters.push(d); this._CheckWaiters();
        const timer = setTimeout(() => {
            const i = this._waiters.indexOf(d); if (i >= 0) this._waiters.splice(i, 1);
            d.Reject(new Error('Composition submission timed out.'));
        }, this.Options.RequestTimeout ?? 30000);
        return d.Promise.finally(() => clearTimeout(timer));
    }
    async RequestAsync(method, value = null) {
        if (this.LastError) throw this.LastError; if (this.IsDisposed && method !== 'dispose') throw new Error('Renderer is disposed.');
        await this._ready.Promise;if(this._requests.size>=(this.Options.MaxRequests??128))throw new Error('Render request queue is full.');const id = this._nextRequest++, request = deferred();
        request.Timer = setTimeout(() => { this._requests.delete(id); request.Reject(new Error(`Render request '${method}' timed out.`)); }, this.Options.RequestTimeout ?? 30000); request.Timer.unref?.();
        this._requests.set(id, request); this.Port.postMessage({ Type: 'request', Id: id, Method: method, Value: value }); return request.Promise;
    }
    async SnapshotPng() { await this.FlushAsync(); return (await this.RequestAsync('snapshot-png')).Bytes; }
    async SnapshotPixels() { await this.FlushAsync(); return this.RequestAsync('snapshot-pixels'); }
    async GetDiagnosticsAsync() { const worker = await this.RequestAsync('diagnostics'); return { Mode: this.Mode, UI: { ...this.Statistics, Recorder: this.Recorder.Statistics, Resources: this.Recorder.Resources.Statistics, BufferPool: { Bytes: this.BufferPool.Bytes, Hits: this.BufferPool.Hits, Misses: this.BufferPool.Misses } }, Worker: worker }; }
    SetVisible(visible) { this._visible=!!visible; this.Port?.postMessage({ Type: 'visibility', Visible: !!visible }); }
    Dispose() {
        if (this.IsDisposed) return;
        clearTimeout(this._batchTimer);clearTimeout(this._initializationTimer);this.Root.Compositor?.SetServerTransport?.(null);
        const pendingInitialization = !this.Backend;
        if (pendingInitialization) this._ready.Reject(new Error('Renderer disposed during initialization.'));
        const done = this.LastError || pendingInitialization ? Promise.resolve() : this.RequestAsync('dispose');
        for (const w of [...this._waiters.splice(0),...this._processedWaiters.splice(0),...this._capturedProcessedWaiters.splice(0),...(this.Accumulator.InFlight?.ProcessedWaiters??[])]) w.Reject(new Error('Renderer disposed.'));
        this._wasmSource?.Dispose(); this.Recorder.Dispose(); this.BufferPool.Clear(); super.Dispose();
        const cleanup = () => { this.FastInputPort?.close();this.Port?.close(); this.Worker?.terminate(); this.Port = null; };
        done.catch(() => {}).finally(cleanup); this.FrameRendered.Clear(); this.Errors.Clear();
    }
}
