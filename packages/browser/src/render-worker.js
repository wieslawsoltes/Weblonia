import { DecodeCompositionBatch, ServerCompositionScene } from '@wieslawsoltes/avalonia-rendering';
import { InitializeWorkerSkia, OffscreenSkiaRenderTarget } from '@wieslawsoltes/avalonia-skia';

/** Dedicated render worker entry. The message channel directly connects to either
 * the document UI or an independent UI worker; the browser host never forwards
 * scene payloads in three-thread mode. */
let active = false;
export async function StartRenderWorker(message, startup = {}) {
    if (message?.Type !== 'initialize' || active) return;
    active = true;
    const { Port: port, InputPort: inputPort, Canvas: canvas, Options: options = {} } = message;
    let platform, target, scene, disposed = false, dirty = false, frameId = null, frameKind=null, running = false, suspended = false;
    let queue = Promise.resolve(), lastSubmitted = 0, frameCredit = true, latestFrame = null;
    const diagnostics = { DecodeMilliseconds: 0, LastDecodeMilliseconds: 0, DecodedStringDefinitions: 0, DecodedStringReferences: 0, Thread: 'composition-render-worker', InstanceId: crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4)),x=>x.toString(16)).join('-'), HasDocument: typeof document !== 'undefined', CrossOriginIsolated: self.crossOriginIsolated, WorkerFrames: 0, ReceivedBytes: 0, ReturnedBuffers: 0, Clock: typeof self.requestAnimationFrame === 'function' ? 'worker-requestAnimationFrame' : 'timer-fallback', StartedAt: performance.timeOrigin + performance.now() };
    const send = (value, transfer = []) => { if (!disposed) port.postMessage(value, transfer); };
    const report = error => send({ Type: 'error', Error: { Name: error.name, Message: error.message, Stack: error.stack } });
    const cancel = () => { if (frameId != null) { if (frameKind==='raf') self.cancelAnimationFrame(frameId); else clearTimeout(frameId); frameId = null; } };
    const publish = () => {
        if (!frameCredit || !latestFrame) return;
        frameCredit = false; send({ Type: 'frame', ...latestFrame }); latestFrame = null;
    };
    const schedule = () => {
        if (disposed || suspended || running || frameId != null || !scene?.Root || !dirty && !scene.HasAnimations) return;
        const cb = () => { frameId = null; render().catch(report); };
        try { frameKind='raf';frameId = self.requestAnimationFrame(cb); }
        catch { diagnostics.Clock = 'timer-fallback'; frameKind='timer';frameId = setTimeout(cb, 16); }
    };
    async function render() {
        if (disposed || running || !scene.Root) return;
        cancel(); running = true;
        try {
            // Consume only work known at frame entry. Custom OnRender callbacks
            // may invalidate again; clearing this bit after drawing loses that
            // request and freezes the visual until an unrelated input arrives.
            dirty = false;
            scene.Tick(performance.timeOrigin + performance.now()); target.Render(scene); ++diagnostics.WorkerFrames;
            const info = { Sequence: scene.Sequence, Generation: scene.Generation, Frame: diagnostics.WorkerFrames, Epoch: performance.timeOrigin + performance.now(), Duration: target.Diagnostics.RenderMilliseconds, Readback: scene.GetReadback(), Backend: target.Backend, RenderMode: target.Surface?.RenderMode };
            if (scene.Sequence > lastSubmitted) { lastSubmitted = scene.Sequence; send({ Type: 'submitted', ...info }); }
            latestFrame = info; publish();
        } finally { running = false; schedule(); }
    }
    function enqueue(action) { queue = queue.then(action).catch(report); }
    try {
        platform = await InitializeWorkerSkia(options, startup);
        startup.Progress?.('backend-probe');
        target = new OffscreenSkiaRenderTarget(platform, canvas, options);
        target.OnDeviceLost = info => send({ Type: 'device-lost', Info: { Message: info?.message ?? String(info) } });
        scene = new ServerCompositionScene(platform, options); scene.OnInvalidate = () => { dirty = true; schedule(); };scene.OnCallbackError=report;
        await target.SelectBackend();
        port.onmessage = event => {
            const message = event.data;
            if (message?.Type === 'frame-ack') { frameCredit = true; publish(); return; }
            if (message?.Type === 'visibility') { suspended = !message.Visible; if (suspended) cancel(); else { dirty = true; schedule(); } return; }
            enqueue(async () => {
                if (disposed) return;
                if (message?.Type === 'batch') {
                    let sequence = message.Sequence, generation = message.Generation;
                    try {
                        const decodeStarted = performance.now();
                        const batch = DecodeCompositionBatch(message.Buffer, message.ByteLength); sequence = batch.Sequence; generation = batch.Generation;
                        diagnostics.LastDecodeMilliseconds = performance.now() - decodeStarted; diagnostics.DecodeMilliseconds += diagnostics.LastDecodeMilliseconds;
                        diagnostics.DecodedStringDefinitions += batch.DecodeStatistics.StringDefinitions; diagnostics.DecodedStringReferences += batch.DecodeStatistics.StringReferences;
                        diagnostics.ReceivedBytes += message.ByteLength;
                        await scene.Apply(batch); await target.Resize(scene.Width, scene.Height, scene.Scale);
                        dirty = true;
                        send({ Type: 'processed', Sequence: sequence, Generation: generation, AnimationState:scene.GetAnimationReadback(batch.Value.Composition.Upsert.map(x=>x.Id)), Buffer: message.Buffer, Statistics: scene.Statistics }, [message.Buffer]); ++diagnostics.ReturnedBuffers;
                        schedule();
                    } catch (error) { send({ Type: 'batch-error', Sequence: sequence, Generation: generation, Buffer: message.Buffer, Error: { Name: error.name, Message: error.message, Stack: error.stack } }, message.Buffer?.byteLength ? [message.Buffer] : []); }
                } else if (message?.Type === 'redraw') { dirty = true; schedule(); }
                else if (message?.Type === 'request') {
                    try {
                        let value;
                        switch (message.Method) {
                            case 'diagnostics': value = { ...diagnostics, Scheduler:{dirty,frameId,running,suspended}, Target: target.Diagnostics, Scroll:scene.ScrollController.Readback(),Scene: scene.Statistics, Resources: scene.Resources.size, Visuals: scene.Nodes.size, CompositionObjects: scene.CompositionObjects.size, ActiveAnimations: [...scene.CompositionObjects.values()].reduce((n, o) => n + o.Animations.size, 0), Skia: platform.GetDiagnostics(),WasmHeapBytes:platform.Api.CanvasKit.HEAPU8?.byteLength??null,CustomHandlers:[...scene.CompositionObjects.values()].filter(o=>o.CustomHandler?.GetDiagnostics).map(o=>({Id:o.Id,Value:o.CustomHandler.GetDiagnostics()})),Sequence: scene.Sequence, Generation: scene.Generation }; break;
                            case 'snapshot-png': case 'snapshot-pixels': await render(); value = await target.Snapshot(message.Method === 'snapshot-pixels'); break;
                            case 'render': await render(); value = { Sequence: scene.Sequence, Frame: diagnostics.WorkerFrames }; break;
                            case 'dispose': cancel(); scene.Dispose(); await target.Dispose(); platform.Dispose(); send({ Type: 'response', Id: message.Id, Value: true }); disposed = true; inputPort?.close();port.close(); self.close(); return;
                            default: throw new Error(`Unknown render-worker request '${message.Method}'.`);
                        }
                        send({ Type: 'response', Id: message.Id, Value: value }, value?.Bytes ? [value.Bytes.buffer] : []);
                    } catch (error) { send({ Type: 'response', Id: message.Id, Error: { Name: error.name, Message: error.message, Stack: error.stack } }); }
                }
            });
        };
        if(inputPort){inputPort.onmessage=async event=>{const m=event.data;try{
            if(m?.Type==='input-wheel'){if(scene.ScrollController.Wheel(m)){dirty=true;schedule();}}
            else if(m?.Type==='fast-request'){
                let value;if(m.Method==='diagnostics')value={...diagnostics,Sequence:scene.Sequence,Scroll:scene.ScrollController.Readback(),Scene:scene.Statistics};
                else if(m.Method==='snapshot-png'){await render();value=await target.Snapshot(false);}else throw new Error('Unknown fast render request.');
                inputPort.postMessage({Type:'fast-response',Id:m.Id,Value:value},value?.Bytes?[value.Bytes.buffer]:[]);
            }
        }catch(error){inputPort.postMessage({Type:'fast-response',Id:m?.Id,Error:error.message});}};inputPort.start();}
        port.start(); send({ Type: 'ready', Backend: target.Backend, Diagnostics: diagnostics, BackendFailures: target.Diagnostics.BackendFailures });
    } catch (error) {
        try { scene?.Dispose(); await target?.Dispose(); } finally {
            platform?.Dispose(); port.close(); inputPort?.close();
        }
        throw error;
    }
}
