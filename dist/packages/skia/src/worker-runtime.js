import { CompileWasmAsync, InstantiateWasmAsync } from '@wieslawsoltes/skiasharpweb/wasm';
import { ReceiveSkiaWasmModuleAsync } from './wasm-module-source.js';
import { Initialize } from '@wieslawsoltes/skiasharpweb/browser';
import { SkiaPlatform, SkiaDrawingContext } from './index.js';
/** Explicit worker bootstrap for the pinned native engine. The generated ESM
 * loader is byte-for-byte upstream loader source plus one export statement.
 * No eval, importScripts, document shim, font download or modified WASM binary. */
export async function InitializeWorkerSkia(options = {}, startup = {}) {
    if (typeof WorkerGlobalScope === 'undefined' || !(globalThis instanceof WorkerGlobalScope)) throw new Error('InitializeWorkerSkia must run inside a dedicated worker.');
    if (!options.LoaderUrl || !options.AssetBaseUrl) throw new TypeError('Worker Skia requires explicit LoaderUrl and AssetBaseUrl.');
    startup.Progress?.('runtime-loader', options.LoaderUrl);
    const wasmUrl = new URL('canvaskit.wasm', options.AssetBaseUrl);
    const preparation = options.WasmModulePort
        ? ReceiveSkiaWasmModuleAsync(options.WasmModulePort, options.InitializationTimeout ?? 45000)
            .then(module => module ?? CompileWasmAsync(wasmUrl))
        : options.WasmModule !== undefined ? Promise.resolve(options.WasmModule) : CompileWasmAsync(wasmUrl);
    const [loader, module] = await Promise.all([import(options.LoaderUrl), preparation]);
    const factory = loader.default;
    if (typeof factory !== 'function') throw new TypeError('The Skia worker loader must export a default initialization factory.');
    startup.Progress?.('wasm-initialization', wasmUrl);
    const CanvasKit = await InstantiateWasmAsync(factory, module, { locateFile: name => new URL(name, options.AssetBaseUrl).href });
    startup.Progress?.('skia-platform');
    const api = await Initialize({ CanvasKit, fonts: false, assetBaseUrl: options.AssetBaseUrl });
    return SkiaPlatform.Instance = new SkiaPlatform(api, options.PlatformOptions ?? {});
}
export class OffscreenSkiaRenderTarget {
    constructor(platform, canvas, options = {}) {
        if (!(canvas instanceof OffscreenCanvas)) throw new TypeError('An owned OffscreenCanvas is required.');
        this.Platform = platform; this.Canvas = canvas; this.Options = options; this.Surface = null; this.Backend = null; this.Scale = 1; this.Generation = 0;
        this.Diagnostics = { Frames: 0, RenderMilliseconds: 0, ResizeCount: 0, SelectedBackend: null, BackendFailures: [], Width: 0, Height: 0 };
    }
    async SelectBackend() {
        const requested = this.Options.Backend ?? 'auto', candidates = requested === 'auto' ? ['webgpu','webgl','canvas'] : this.Options.AllowFallback === false ? [requested] : [requested,...['webgpu','webgl','canvas'].filter(x => x !== requested)];
        for (const backend of candidates) {
            const probe = new OffscreenCanvas(1, 1); let surface;
            try {
                surface = await this.Platform.Api.SKSurface.Create(probe, { backend, allowFallback: false });
                if (surface.Element && surface.Element !== probe) throw new Error('Backend probe changed canvas ownership.');
                this.Backend = surface.Backend; this.Diagnostics.SelectedBackend = this.Backend; return;
            } catch (error) { this.Diagnostics.BackendFailures.push({ Backend: backend, Error: error.message }); }
            finally { if (surface) await (surface.DisposeAsync?.() ?? surface.Dispose()); }
        }
        throw new Error('No worker Skia backend passed the surface probe.');
    }
    async Resize(width, height, scale) {
        const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
        if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w > 16384 || h > 16384 || w * h > (this.Options.MaxSurfacePixels ?? 32 * 1024 * 1024)) throw new RangeError('Worker surface exceeds its dimension/pixel budget.');
        this.Scale = scale;
        if (this.Surface && this.Canvas.width === w && this.Canvas.height === h) return;
        if (!this.Backend) await this.SelectBackend();
        if (this.Surface) { await (this.Surface.DisposeAsync?.() ?? this.Surface.Dispose()); this.Surface = null; }
        this.Canvas.width = w; this.Canvas.height = h;
        const surface = await this.Platform.Api.SKSurface.Create(this.Canvas, { backend: this.Backend, allowFallback: false, onDeviceLost: info => this.OnDeviceLost?.(info) });
        if (surface.Element && surface.Element !== this.Canvas) { surface.Dispose(); throw new Error('Worker renderer refused a detached fallback canvas. The host must replace and retransfer the presentation canvas.'); }
        this.Surface = surface; ++this.Generation; ++this.Diagnostics.ResizeCount; this.Diagnostics.Width = w; this.Diagnostics.Height = h;
    }
    Render(scene) {
        if (!this.Surface) return;
        const start = performance.now(), canvas = this.Surface.Canvas;
        canvas.Clear(this.Platform.Api.SKColors.Transparent); canvas.Save(); canvas.Scale(this.Scale, this.Scale);
        const context = new SkiaDrawingContext(this.Platform, canvas, this.Scale); context.Surface = this.Surface; context.CacheDeviceClip = true;
        try { scene.Render(context); } finally { try { context.Dispose(); } finally { canvas.Restore(); } }
        this.Surface.Flush(); ++this.Diagnostics.Frames; ++this.Platform.FrameCount; this.Diagnostics.RenderMilliseconds = performance.now() - start;
    }
    async Snapshot(pixels = false) {
        if (!this.Surface) throw new Error('Worker render target is not initialized.');
        const image = await (this.Surface.SnapshotAsync?.() ?? this.Surface.Snapshot());
        try {
            if (pixels) return { Bytes: new Uint8Array(image.ReadPixels()), Width: image.Width, Height: image.Height };
            const data = image.Encode(this.Platform.Api.SKEncodedImageFormat.Png, 100);
            try { return { Bytes: new Uint8Array(data.ToArray()), Width: image.Width, Height: image.Height }; } finally { data.Dispose(); }
        } finally { image.Dispose(); }
    }
    async Dispose() { if (this.Surface) await (this.Surface.DisposeAsync?.() ?? this.Surface.Dispose()); this.Surface = null; }
}
