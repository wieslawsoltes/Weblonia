import { CreateSkiaGlyphTypeface } from './glyph-backend.js';
import { RegisterGlyphTypefaceBackend } from "../../media/src/index.js";
import { GetGeometryPath, InstallGeometryBackend } from './geometry-backend.js';
import { ConfigureCanvasText, TextRasterSignature, CreateTextRasterPlan, GetDeviceTextGeometry } from './text-raster.js';
export { ConfigureCanvasText, CreateTextRasterPlan, GetDeviceTextGeometry } from './text-raster.js';
import { SkiaTextService } from './text-service.js';
import { Initialize } from "../../../vendor/skiasharpweb/dist/package/browser.js";
import { Rect, Size, Point, Matrix, Disposable, Event, CompositeDisposable } from "../../base/src/index.js";
import { DrawingContext, DrawingImage, Color, Colors, BrushColor, LinearGradientBrush, RadialGradientBrush, ConicGradientBrush, ImageBrush, VisualBrush, BlurEffect, DropShadowEffect, Bitmap, WriteableBitmap, RenderTargetBitmap, RegisterGeometryBackend, RegisterTextMetricsProvider, RegisterTextLayoutProvider, InvalidateTextServices } from "../../media/src/index.js";
import { Image } from "../../controls/src/index.js";
export class LruCache {
    constructor(maxEntries = 512, maxBytes = 64 * 1024 * 1024) {
        this.MaxEntries = maxEntries;
        this.MaxBytes = maxBytes;
        this.Bytes = 0;
        this.Hits = 0;
        this.Misses = 0;
        this._entries = new Map();
    }
    Get(key) {
        const entry = this._entries.get(key);
        if (!entry) {
            this.Misses++;
            return null;
        }
        this.Hits++;
        this._entries.delete(key);
        this._entries.set(key, entry);
        return entry.Value;
    }
    Set(key, value, bytes = 0) {
        const old = this._entries.get(key);
        if (old) {
            this.Bytes -= old.Bytes;
            old.Value.Dispose?.();
            this._entries.delete(key);
        }
        this._entries.set(key, { Value: value, Bytes: bytes });
        this.Bytes += bytes;
        while (this._entries.size > this.MaxEntries || this.Bytes > this.MaxBytes && this._entries.size > 1) {
            const [id, entry] = this._entries.entries().next().value;
            this._entries.delete(id);
            this.Bytes -= entry.Bytes;
            entry.Value.Dispose?.();
        }
        return value;
    }
    Delete(key) {
        const entry = this._entries.get(key);
        if (!entry) return false;
        this._entries.delete(key); this.Bytes -= entry.Bytes; entry.Value.Dispose?.(); return true;
    }
    Clear() {
        for (const entry of this._entries.values())
            entry.Value.Dispose?.();
        this._entries.clear();
        this.Bytes = 0;
    }
    get Count() {
        return this._entries.size;
    }
    Dispose() {
        this.Clear();
    }
}
const matrixArray = m => [m.M11, m.M21, m.M31, m.M12, m.M22, m.M32, 0, 0, 1];
const cssFont = (typeface, size) => `${String(typeface.Style).toLowerCase()} ${typeface.Weight} ${size}px ${typeface.FontFamily}`;
function createCanvas(width, height) {
    if (typeof OffscreenCanvas !== 'undefined')
        return new OffscreenCanvas(width, height);
    if (typeof document === 'undefined')
        return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}
export class SkiaPlatform extends Disposable {
    static Instance = null;
    constructor(api, options = {}) {
        super();
        this.Api = api;
        this.Options = options;
        this.Paths = new LruCache(options.PathCacheEntries ?? 512, options.PathCacheBytes ?? 32 * 1024 * 1024);
        this.TextImages = new LruCache(options.TextCacheEntries ?? 768, options.TextCacheBytes ?? 48 * 1024 * 1024);
        this.TextMetrics = new LruCache(options.TextMetricsCacheEntries ?? 2048, options.TextMetricsCacheBytes ?? 4 * 1024 * 1024);
        this.SolidPaints = new LruCache(options.SolidPaintCacheEntries ?? 128);
        this._textLifetime = new CompositeDisposable();
        this.DeviceClipQueries = 0; this.TextLinesVisited = 0; this.TextTilesVisited = 0; this.TextRasterizations = 0; this.TextUploads = 0; this.TextMeasurements = 0;
        this._fontRegistrations = new Map();
        this.VisualImages = new LruCache(options.VisualCacheEntries ?? 64, options.VisualCacheBytes ?? 32 * 1024 * 1024);
        this._snapshotting = new Set();
        this.PaintCount = 0;
        this.FrameCount = 0;
        this.Errors = new Event();
        this._measureContext = createCanvas(1, 1)?.getContext('2d');
        this._nativeFonts = new Map();
        this.TextService = new SkiaTextService(this, LruCache);
        this._bitmapResources = new Set();
        this._Install();
    }
    static async Initialize(options = {}) {
        if (options.Instance)
            return options.Instance;
        const api = options.Api ?? await Initialize(options);
        return SkiaPlatform.Instance = new SkiaPlatform(api, options);
    }
    CreateCanvas() {
        const document = this.Options.Document ?? globalThis.document;
        if (!document)
            throw new Error('A browser canvas requires a document from the Skia initialization realm.');
        return document.createElement('canvas');
    }
    _Install() {
        const platform = this;
        this._textLifetime.Add(InstallGeometryBackend(platform));
        this._textLifetime.Add(RegisterGlyphTypefaceBackend((data,options)=>this.CreateGlyphTypeface(data,options)));
        this._textLifetime.Add(RegisterTextLayoutProvider(this.TextService));
        if (this._measureContext) this._textLifetime.Add(RegisterTextMetricsProvider({ SupportsSpacing: true,
            Measure: (text, typeface, size, options) => this.MeasureText(text, typeface, size, options) }));
        const fonts = (this.Options.Document ?? globalThis.document)?.fonts;
        if (fonts?.addEventListener) {
            const changed = () => this.InvalidateFonts();
            fonts.addEventListener('loadingdone', changed); fonts.addEventListener('loadingerror', changed);
            this._textLifetime.Add(Disposable.Create(() => { fonts.removeEventListener('loadingdone', changed); fonts.removeEventListener('loadingerror', changed); }));
        }
        Image.Loader = (bitmap, owner) => platform.LoadBitmap(bitmap).then(() => owner?.InvalidateMeasure());
        RenderTargetBitmap.Renderer = async (bitmap, visual) => {
            const S = platform.Api, surface = S.SKSurface.Create(new S.SKImageInfo(bitmap.PixelSize.Width, bitmap.PixelSize.Height));
            try {
                const context = new SkiaDrawingContext(platform, surface.Canvas);
                visual.RenderTree(context);
                context.Dispose();
                surface.Flush();
                bitmap._native?.Dispose();
                bitmap._native = surface.Snapshot();
                platform._bitmapResources.add(bitmap);
                bitmap.Changed.Raise(bitmap, {});
            }
            finally {
                surface.Dispose();
            }
        };
    }
    GetPath(geometry, kind = 'fill') { return GetGeometryPath(this, geometry, kind); }
    async LoadBitmap(bitmap) {
        if (!bitmap || bitmap.IsDisposed || bitmap instanceof DrawingImage || bitmap instanceof WriteableBitmap || bitmap._native)
            return bitmap;
        if (bitmap._load)
            return bitmap._load;
        bitmap._load = (async () => {
            let bytes = bitmap.Source;
            if (typeof bytes === 'string' || bytes instanceof URL) {
                const response = await fetch(bytes);
                if (!response.ok)
                    throw new Error(`Bitmap request failed (${response.status}).`);
                const length = Number(response.headers.get('content-length'));
                if (length > (this.Options.MaxImageBytes ?? 64 * 1024 * 1024))
                    throw new RangeError('Image exceeds configured byte limit.');
                bytes = new Uint8Array(await response.arrayBuffer());
            }
            else if (typeof Blob !== 'undefined' && bytes instanceof Blob)
                bytes = new Uint8Array(await bytes.arrayBuffer());
            else if (bytes instanceof ArrayBuffer)
                bytes = new Uint8Array(bytes);
            if (!ArrayBuffer.isView(bytes))
                throw new TypeError('Bitmap requires an image URL, Blob, ArrayBuffer or typed byte array.');
            if (bytes.byteLength > (this.Options.MaxImageBytes ?? 64 * 1024 * 1024))
                throw new RangeError('Image exceeds configured byte limit.');
            const image = this.Api.SKImage.FromEncodedData(bytes);
            if (!image)
                throw new Error('Skia could not decode the image.');
            if (bitmap.IsDisposed) {
                image.Dispose();
                return bitmap;
            }
            bitmap._native = image;
            bitmap.PixelSize = new Size(image.Width, image.Height);
            this._bitmapResources.add(bitmap);
            bitmap.Changed.Raise(bitmap, {});
            return bitmap;
        })();
        try {
            return await bitmap._load;
        }
        catch (error) {
            bitmap._load = null;
            this.Errors.Raise(this, { Error: error });
            throw error;
        }
    }
    GetImage(bitmap) {
        if (!bitmap)
            return null;
        if (bitmap instanceof WriteableBitmap) {
            const version = bitmap._changeVersion ?? 0;
            if (!bitmap._pixelSubscription)
                bitmap._pixelSubscription = bitmap.Changed.Add(() => {
                    bitmap._changeVersion = (bitmap._changeVersion ?? 0) + 1;
                });
            if (!bitmap._native || bitmap._uploadedVersion !== version) {
                bitmap._native?.Dispose();
                bitmap._native = this.Api.SKImage.FromPixels(new this.Api.SKImageInfo(bitmap.PixelSize.Width, bitmap.PixelSize.Height, this.Api.SKColorType.Rgba8888, this.Api.SKAlphaType.Unpremul), bitmap.Pixels);
                bitmap._uploadedVersion = version;
                this._bitmapResources.add(bitmap);
            }
        }
        else if (!bitmap._native && !bitmap._load)
            this.LoadBitmap(bitmap).catch(() => {
            });
        return bitmap._native;
    }
    GetVisualImage(visual, scale = 1, includeRoot = true) {
        if (!visual || visual.IsDisposed) return null;
        if (this._snapshotting.has(visual)) throw new Error('VisualBrush cannot recursively paint its own source.');
        if (!visual.IsArrangeValid && !visual.IsAttachedToVisualTree) {
            visual.Measure(new Size(Number.isFinite(visual.Width) ? visual.Width : 256, Number.isFinite(visual.Height) ? visual.Height : 256));
            visual.Arrange(new Rect(visual.DesiredSize));
        }
        const width = Math.ceil(visual.Bounds.Width * scale), height = Math.ceil(visual.Bounds.Height * scale);
        if (!(width > 0 && height > 0)) return null;
        const bytes = width * height * 4;
        if (bytes > this.VisualImages.MaxBytes || width > 8192 || height > 8192) return null;
        const key = `${visual.VisualId}|${scale}|${includeRoot}`;
        const cached = this.VisualImages.Get(key), capturedVersion = visual._renderVersion;
        if (cached && cached.Version === capturedVersion && cached.Width === width && cached.Height === height) return cached;
        this._snapshotting.add(visual);
        const S = this.Api, surface = S.SKSurface.Create(new S.SKImageInfo(width, height));
        let image = null;
        try {
            surface.Canvas.Clear(S.SKColors.Transparent); surface.Canvas.Scale(scale, scale);
            const context = new SkiaDrawingContext(this, surface.Canvas, scale); context.Surface = surface;
            if (includeRoot) {
                const transform = visual.GetLocalTransform();
                if (!transform.HasInverse) return null;
                const state = context.PushTransform(transform.Invert());
                try { visual.RenderTree(context); } finally { state.Dispose(); }
            } else visual._RenderContents(context);
            context.Dispose(); surface.Flush(); image = surface.Snapshot();
        } finally { surface.Dispose(); this._snapshotting.delete(visual); }
        if (!image) return null;
        let disposed = false;
        const subscription = visual.Disposed.Add(() => this.VisualImages.Delete(key));
        return this.VisualImages.Set(key, { Image: image, Version: capturedVersion, Width: width, Height: height,
            Dispose() { if (!disposed) { disposed = true; subscription.Dispose(); image.Dispose(); } }
        }, bytes);
    }
    InvalidateFonts() {
        if (this.IsDisposed) return;
        this.TextImages.Clear(); this.TextMetrics.Clear(); InvalidateTextServices();
    }
    CreateGlyphTypeface(data, options = {}) {
        if (this.IsDisposed) throw new Error('SkiaPlatform is disposed.');
        return CreateSkiaGlyphTypeface(this.Api, data, options);
    }
    RegisterTypeface(family, bytes) {
        if (this.IsDisposed) throw new Error('The Skia platform has been disposed.');
        if (typeof family !== 'string' || !family.trim()) throw new TypeError('A non-empty font family is required.');
        const face = this.Api.SKTypeface.FromData(bytes);
        if (!face) throw new Error('Invalid typeface data.');
        const key = family.trim().toLowerCase();
        let token;
        try { token = this.TextService.RegisterFont(family, bytes); }
        catch (error) { face.Dispose(); throw error; }
        const entry = { Face: face, Family: family, Token: token, IsDisposed: false, Id: this._nextFontId = (this._nextFontId ?? 0) + 1, Bytes: new Uint8Array(bytes instanceof ArrayBuffer ? bytes.slice(0) : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) };
        const entries = this._fontRegistrations.get(key) ?? [];
        entries.push(entry); this._fontRegistrations.set(key, entries);
        this._nativeFonts.set(key, face); this.InvalidateFonts();
        return Disposable.Create(() => {
            if (entry.IsDisposed) return; entry.IsDisposed = true;
            const current = this._fontRegistrations.get(key);
            if (current) {
                const index = current.indexOf(entry); if (index >= 0) current.splice(index, 1);
                if (current.length) this._nativeFonts.set(key, current.at(-1).Face);
                else { this._fontRegistrations.delete(key); this._nativeFonts.delete(key); }
            }
            if (!this.IsDisposed) { this.TextService.UnregisterFont(family, token); this.InvalidateFonts(); }
            face.Dispose();
        });
    }
    MeasureText(text, typeface, size, options = {}) {
        const key = JSON.stringify([...TextRasterSignature(typeface, size, options), text]);
        let result = this.TextMetrics.Get(key);
        if (result) return result;
        ConfigureCanvasText(this._measureContext, typeface, size, options);
        const m = this._measureContext.measureText(text); ++this.TextMeasurements;
        result = Object.freeze({ Width: m.width, Ascent: m.actualBoundingBoxAscent ?? size * .8, Descent: m.actualBoundingBoxDescent ?? size * .2,
            Left: m.actualBoundingBoxLeft ?? 0, Right: m.actualBoundingBoxRight ?? m.width,
            FontAscent: m.fontBoundingBoxAscent, FontDescent: m.fontBoundingBoxDescent });
        const cost = key.length * 2 + 128;
        return cost <= this.TextMetrics.MaxBytes ? this.TextMetrics.Set(key, result, cost) : result;
    }
    *_GetTextTiles(text, layout, geometry, isVisible = null, rasterClip = null) {
        if (!this._measureContext) throw new Error('System-font text rendering requires Canvas2D or an explicitly registered native typeface.');
        const color = BrushColor(layout.Foreground).ToCss(layout.Foreground?.Opacity ?? 1);
        const metrics = this.MeasureText(text, layout.Typeface, layout.FontSize, layout);
        const budgetTile = Math.floor(Math.sqrt(this.TextImages.MaxBytes / 4));
        const tileSize = Math.min(this.Options.TextTileSize ?? 2048, budgetTile);
        const plan = CreateTextRasterPlan(metrics, layout.FontSize, geometry, tileSize);
        const prefix = JSON.stringify([...TextRasterSignature(layout.Typeface, layout.FontSize, layout), color, geometry.ScaleX, geometry.ScaleY, geometry.PhaseX, geometry.PhaseY, text]);
        for (const tile of plan.Tiles(rasterClip)) {
            ++this.TextTilesVisited;
            if (isVisible && !isVisible(tile)) continue;
            const key = `${prefix}|${tile.Left},${tile.Top},${tile.PixelWidth},${tile.PixelHeight}`;
            let result = this.TextImages.Get(key);
            if (!result) {
                const canvas = createCanvas(tile.PixelWidth, tile.PixelHeight);
                const paint = canvas.getContext('2d', { willReadFrequently: true });
                ConfigureCanvasText(paint, layout.Typeface, layout.FontSize, layout);
                paint.setTransform(geometry.ScaleX, 0, 0, geometry.ScaleY, geometry.PhaseX - tile.Left, geometry.PhaseY - tile.Top);
                paint.fillStyle = color; paint.fillText(text, 0, 0); ++this.TextRasterizations;
                const pixels = paint.getImageData(0, 0, tile.PixelWidth, tile.PixelHeight).data;
                const image = this.Api.SKImage.FromPixels(new this.Api.SKImageInfo(tile.PixelWidth, tile.PixelHeight, this.Api.SKColorType.Rgba8888, this.Api.SKAlphaType.Unpremul), pixels);
                if (!image) throw new Error('Skia failed to upload a text tile.');
                ++this.TextUploads;
                result = { ...tile, Image: image, Dispose() { image.Dispose(); } };
                // Every tile independently fits the cache, even when the complete line does not.
                this.TextImages.Set(key, result, tile.PixelWidth * tile.PixelHeight * 4);
            }
            yield result;
        }
    }
    GetTextImage(text, layout, scale = 1) {
        // Kept for callers of the original helper. Rendering uses the tiled iterator.
        const geometry = { ScaleX: scale, ScaleY: scale, PhaseX: 0, PhaseY: 0 };
        const metrics = this.MeasureText(text, layout.Typeface, layout.FontSize, layout);
        const plan = CreateTextRasterPlan(metrics, layout.FontSize, geometry, Math.min(this.Options.TextTileSize ?? 2048, Math.floor(Math.sqrt(this.TextImages.MaxBytes / 4))));
        if (plan.Width > plan.TileSize || plan.Height > plan.TileSize) throw new RangeError('Use DrawTextLayout for text that requires multiple raster tiles.');
        return this._GetTextTiles(text, layout, geometry).next().value;
    }
    GetDiagnostics() {
        return { Renderer: 'SkiaSharpWeb', NativeRuntime: true, DeviceClipQueries: this.DeviceClipQueries, Frames: this.FrameCount, PathCache: { Count: this.Paths.Count, Hits: this.Paths.Hits, Misses: this.Paths.Misses }, TextCache: { Count: this.TextImages.Count, Bytes: this.TextImages.Bytes, Hits: this.TextImages.Hits, Misses: this.TextImages.Misses }, ParagraphCache: { Count: this.TextService.Cache.Count, EstimatedBytes: this.TextService.Cache.Bytes, KeySerializations: this.TextService.KeySerializations, Builds: this.TextService.ParagraphBuilds }, TextMetricsCache: { Count: this.TextMetrics.Count, Hits: this.TextMetrics.Hits, Misses: this.TextMetrics.Misses }, TextLinesVisited: this.TextLinesVisited, TextTilesVisited: this.TextTilesVisited, TextRasterizations: this.TextRasterizations, TextUploads: this.TextUploads, TextMeasurements: this.TextMeasurements, SolidPaintCache: { Count: this.SolidPaints.Count, Hits: this.SolidPaints.Hits, Misses: this.SolidPaints.Misses }, TextService: this._measureContext ? 'Native SkParagraph for registered fonts; browser system-font fallback' : 'Native SkParagraph with explicit registered fonts' };
    }
    Dispose() {
        if (this.IsDisposed)
            return;
        this._textLifetime.Dispose();
        this.TextMetrics.Dispose(); this.SolidPaints.Dispose();
        this.Paths.Dispose();
        this.TextImages.Dispose();
        this.TextService.Dispose();
        this.VisualImages.Dispose();
        for (const entries of this._fontRegistrations.values()) for (const entry of entries) { entry.IsDisposed = true; entry.Face.Dispose(); }
        this._fontRegistrations.clear(); this._nativeFonts.clear();
        for (const bitmap of this._bitmapResources) {
            bitmap._native?.Dispose();
            bitmap._native = null;
            bitmap._pixelSubscription?.Dispose();
        }
        this._bitmapResources.clear();
        if (SkiaPlatform.Instance === this)
            SkiaPlatform.Instance = null;
        super.Dispose();
    }
}
export class SkiaDrawingContext extends DrawingContext {
    constructor(platform, canvas, renderScaling = 1) {
        super();
        this.Platform = platform;
        this.Api = platform.Api;
        this.Canvas = canvas;
        this.RenderScaling = renderScaling;
        this._nativeStates = [];
        this.CacheDeviceClip = false; this._deviceClip = null;
    }
    /** Enable only for protocol-owned drawing. Arbitrary native canvas users must
     * invalidate this cache, or leave the default uncached behavior enabled. */
    GetDeviceClipBounds() {
        if (!this.CacheDeviceClip || !this._deviceClip) {
            ++this.Platform.DeviceClipQueries;
            const clip = this.Canvas.DeviceClipBounds;
            if (this.CacheDeviceClip) this._deviceClip = clip;
            return clip;
        }
        return this._deviceClip;
    }
    InvalidateNativeState() { this._deviceClip = null; }
    Color(color, opacity = 1) {
        const c = color instanceof Color ? color : Color.Parse(color);
        return new this.Api.SKColor(c.R, c.G, c.B, Math.round(c.A * opacity));
    }
    Rect(rect) {
        return new this.Api.SKRect(rect.Left, rect.Top, rect.Right, rect.Bottom);
    }
    _Paint(brush, pen, bounds = Rect.Empty, blend = null) {
        const S = this.Api;
        const solid = !pen && !blend && !(brush instanceof LinearGradientBrush || brush instanceof RadialGradientBrush || brush instanceof ConicGradientBrush || brush instanceof ImageBrush || brush instanceof VisualBrush);
        if (solid) {
            const c = BrushColor(brush, Colors.White), alpha = Math.round(c.A * (brush?.Opacity ?? 1));
            const key = `${c.R},${c.G},${c.B},${alpha}`;
            let paint = this.Platform.SolidPaints.Get(key);
            if (!paint) paint = this.Platform.SolidPaints.Set(key, new S.SKPaint({ Color: new S.SKColor(c.R, c.G, c.B, alpha), IsAntialias: true }));
            // Borrowed immutable paint: callers must not mutate this object.
            return { Paint: paint, Dispose() {} };
        }
        const p = new S.SKPaint({ IsAntialias: true }), disposables = [];
        let imageClip = false;
        let color = BrushColor(brush, Colors.White);
        p.Color = this.Color(color, brush?.Opacity ?? 1);
        if (blend)
            p.BlendMode = blend;
        if (pen) {
            p.Style = S.SKPaintStyle.Stroke;
            p.StrokeWidth = pen.Thickness;
            p.StrokeCap = S.SKStrokeCap[pen.LineCap === 'Flat' ? 'Butt' : pen.LineCap] ?? S.SKStrokeCap.Butt;
            p.StrokeJoin = S.SKStrokeJoin[pen.LineJoin] ?? S.SKStrokeJoin.Miter;
            p.StrokeMiter = pen.MiterLimit;
            if (pen.DashStyle?.Dashes.length) {
                const effect = S.SKPathEffect.CreateDash(pen.DashStyle.Dashes.map(v => v * pen.Thickness), pen.DashStyle.Offset * pen.Thickness);
                p.PathEffect = effect;
                disposables.push(effect);
            }
        }
        const point = relative => {
            const v = relative.ToPixels?.(bounds.Size) ?? relative;
            return new S.SKPoint(bounds.X + v.X, bounds.Y + v.Y);
        };
        if (brush instanceof LinearGradientBrush || brush instanceof RadialGradientBrush || brush instanceof ConicGradientBrush) {
            const stops = [...brush.GradientStops].sort((a, b) => a.Offset - b.Offset);
            if (stops.length) {
                const colors = stops.map(s => this.Color(s.Color)), offsets = stops.map(s => MathUtilitiesClamp(s.Offset, 0, 1)), tile = S.SKShaderTileMode[brush.SpreadMethod === 'Repeat' ? 'Repeat' : brush.SpreadMethod === 'Reflect' ? 'Mirror' : 'Clamp'];
                let shader;
                if (brush instanceof LinearGradientBrush)
                    shader = S.SKShader.CreateLinearGradient(point(brush.StartPoint), point(brush.EndPoint), colors, offsets, tile);
                else if (brush instanceof RadialGradientBrush)
                    shader = S.SKShader.CreateRadialGradient(point(brush.Center), brush.Radius * Math.max(bounds.Width, bounds.Height), colors, offsets, tile);
                else
                    shader = S.SKShader.CreateSweepGradient(point(brush.Center), colors, offsets);
                if (shader) {
                    p.Shader = shader;
                    p.Color = this.Color(Colors.White, brush.Opacity);
                    disposables.push(shader);
                }
            }
        }
        else if (brush instanceof ImageBrush || brush instanceof VisualBrush) {
            const image = brush instanceof VisualBrush ? this.Platform.GetVisualImage(brush.Visual, this.RenderScaling)?.Image : this.Platform.GetImage(brush.Source);
            if (image) {
                const sx = bounds.Width / image.Width, sy = bounds.Height / image.Height;
                const scaleX = brush.Stretch === 'None' ? 1 : brush.Stretch === 'Fill' ? sx : brush.Stretch === 'UniformToFill' ? Math.max(sx, sy) : Math.min(sx, sy);
                const scaleY = brush.Stretch === 'Fill' ? sy : scaleX;
                const alignX = brush.AlignmentX === 'Left' ? 0 : brush.AlignmentX === 'Right' ? 1 : .5;
                const alignY = brush.AlignmentY === 'Top' ? 0 : brush.AlignmentY === 'Bottom' ? 1 : .5;
                const x = bounds.X + (bounds.Width - image.Width * scaleX) * alignX, y = bounds.Y + (bounds.Height - image.Height * scaleY) * alignY;
                const tiled = brush.TileMode !== 'None';
                const tx = tiled ? ['FlipX', 'FlipXY'].includes(brush.TileMode) ? 'Mirror' : 'Repeat' : 'Clamp';
                const ty = tiled ? ['FlipY', 'FlipXY'].includes(brush.TileMode) ? 'Mirror' : 'Repeat' : 'Clamp';
                // Clamp texels at the image edge, then clip the mapped footprint. Decal
                // sampling would fade a one-pixel source over half the destination.
                if (!tiled) { this.Canvas.Save(); this.Canvas.ClipRect(new S.SKRect(x, y, x + image.Width * scaleX, y + image.Height * scaleY)); imageClip = true; }
                const shader = image.ToShader(tx, ty, null, [scaleX, 0, x, 0, scaleY, y, 0, 0, 1]);
                p.Shader = shader; p.Color = this.Color(Colors.White, brush.Opacity); disposables.push(shader);
            } else p.Color = this.Color(Colors.Transparent);
        }
        return { Paint: p, Dispose: () => {
                p.Dispose();
                for (const d of disposables)
                    d?.Dispose();
                if (imageClip) this.Canvas.Restore();
            } };
    }
    OnPush(kind, value) {
        const C = this.Canvas, state = { PreviousClip: this._deviceClip }; let count = null;
        try {
            if (kind === 'Effect') {
                if (value instanceof BlurEffect) state.Filter = this.Api.SKImageFilter.CreateBlur(value.Radius / 2, value.Radius / 2);
                else if (value instanceof DropShadowEffect) state.Filter = this.Api.SKImageFilter.CreateDropShadow(value.OffsetX, value.OffsetY, value.BlurRadius / 2, value.BlurRadius / 2, this.Color(value.Color, value.Opacity));
                else throw new TypeError(`Unsupported effect ${value?.constructor?.name}.`);
                state.Paint = new this.Api.SKPaint(); state.Paint.ImageFilter = state.Filter; count = C.SaveLayer(state.Paint);
            } else if (kind === 'Opacity') {
                state.Paint = new this.Api.SKPaint({ Color: this.Color(Colors.White, value) }); count = C.SaveLayer(state.Paint);
            } else if (kind === 'OpacityMask') { count = C.SaveLayer(); state.Mask = value; }
            else {
                count = C.Save();
                if (kind === 'Transform') C.Concat(matrixArray(value));
                else if (kind === 'Clip') C.ClipRect(this.Rect(value));
                else if (kind === 'GeometryClip') C.ClipPath(this.Platform.GetPath(value));
                else throw new TypeError(`Unsupported drawing state '${kind}'.`);
            }
            this._nativeStates.push(state);
            if (kind !== 'Transform') this._deviceClip = null;
        } catch (error) {
            try { if (count != null) C.RestoreToCount(count); }
            finally { state.Paint?.Dispose(); state.Filter?.Dispose(); }
            throw error;
        }
    }
    OnPop() {
        const state = this._nativeStates.pop();
        try {
            if (state.Mask) {
                const p = this._Paint(state.Mask.Brush, null, state.Mask.Bounds, this.Api.SKBlendMode.DstIn);
                try { this.Canvas.DrawRect(this.Rect(state.Mask.Bounds), p.Paint); }
                finally { p.Dispose(); }
            }
        } finally {
            try { this.Canvas.Restore(); }
            finally { this._deviceClip = state.PreviousClip ?? null; state.Paint?.Dispose(); state.Filter?.Dispose(); }
        }
    }
    _FillStroke(brush, pen, bounds, draw) {
        if (brush) {
            const p = this._Paint(brush, null, bounds);
            try {
                draw(p.Paint);
            }
            finally {
                p.Dispose();
            }
        }
        if (pen?.Brush && pen.Thickness > 0) {
            const p = this._Paint(pen.Brush, pen, bounds);
            try {
                draw(p.Paint);
            }
            finally {
                p.Dispose();
            }
        }
    }
    DrawRectangle(brush, pen, rect, radiusX = 0, radiusY = radiusX, shadows = null) {
        if (rect.Width <= 0 || rect.Height <= 0)
            return;
        if (shadows?.length)
            for (const shadow of shadows) {
                if (shadow.IsInset) continue; // Insets are painted over the background below.
                const p = new this.Api.SKPaint({ Color: this.Color(shadow.Color), IsAntialias: true }), filter = this.Api.SKMaskFilter.CreateBlur(this.Api.SKBlurStyle.Normal, shadow.Blur / 2);
                p.MaskFilter = filter;
                try {
                    const r = rect.Inflate(shadow.Spread).Translate(new Point(shadow.OffsetX, shadow.OffsetY));
                    this.Canvas.DrawRoundRect(this.Rect(r), radiusX, radiusY, p);
                }
                finally {
                    p.Dispose();
                    filter?.Dispose();
                }
            }
        this._FillStroke(brush, pen, rect, paint => radiusX || radiusY ? this.Canvas.DrawRoundRect(this.Rect(rect), radiusX, radiusY, paint) : this.Canvas.DrawRect(this.Rect(rect), paint));
        for (const shadow of shadows ?? []) {
            if (!shadow.IsInset) continue;
            const path = new this.Api.SKPath(), clip = new this.Api.SKPath();
            const filter = this.Api.SKMaskFilter.CreateBlur(this.Api.SKBlurStyle.Normal, Math.max(.001, shadow.Blur / 2));
            const paint = new this.Api.SKPaint({ Color: this.Color(shadow.Color), IsAntialias: true }); paint.MaskFilter = filter;
            this.Canvas.Save();
            try {
                clip.AddRoundRect(this.Rect(rect), radiusX, radiusY); this.Canvas.ClipPath(clip);
                path.FillType = this.Api.SKPathFillType.EvenOdd;
                path.AddRect(this.Rect(rect.Inflate(Math.max(rect.Width, rect.Height, shadow.Blur * 4) + Math.abs(shadow.OffsetX) + Math.abs(shadow.OffsetY))));
                const hole = rect.Deflate(Math.max(0, shadow.Spread)).Translate(new Point(shadow.OffsetX, shadow.OffsetY));
                path.AddRoundRect(this.Rect(hole), Math.max(0, radiusX - shadow.Spread), Math.max(0, radiusY - shadow.Spread));
                this.Canvas.DrawPath(path, paint);
            } finally { this.Canvas.Restore(); paint.Dispose(); filter?.Dispose(); clip.Dispose(); path.Dispose(); }
        }
    }
    DrawVisualCache(visual) {
        const scale = this.RenderScaling * (visual.CacheMode.RenderAtScale ?? 1);
        const entry = this.Platform.GetVisualImage(visual, scale, false);
        if (!entry) return false;
        this.Canvas.DrawImage(entry.Image, new this.Api.SKRect(0, 0, entry.Width, entry.Height), this.Rect(new Rect(visual.Bounds.Size)));
        return true;
    }
    DrawAcrylic(material, bounds, cornerRadius = 0) {
        const S = this.Api, C = this.Canvas;
        if (this.Surface) {
            const image = this.Surface.Snapshot(), filter = S.SKImageFilter.CreateBlur(material.BlurRadius * this.RenderScaling / 2, material.BlurRadius * this.RenderScaling / 2);
            const paint = new S.SKPaint({ Color: this.Color(Colors.White, material.MaterialOpacity) }); paint.ImageFilter = filter;
            const clip = new S.SKPath(); clip.AddRoundRect(this.Rect(bounds), cornerRadius, cornerRadius);
            C.Save();
            try { C.ClipPath(clip); C.ResetMatrix(); C.DrawImage(image, 0, 0, paint); }
            finally { C.Restore(); clip.Dispose(); paint.Dispose(); filter?.Dispose(); image.Dispose(); }
        } else this.DrawRectangle(material.FallbackColor, null, bounds, cornerRadius);
        this.DrawRectangle({ Color: material.TintColor, Opacity: material.TintOpacity * material.MaterialOpacity }, null, bounds, cornerRadius);
    }
    DrawEllipse(brush, pen, center, rx, ry) {
        const rect = center instanceof Rect ? center : new Rect(center.X - rx, center.Y - ry, rx * 2, ry * 2);
        this._FillStroke(brush, pen, rect, paint => this.Canvas.DrawOval(this.Rect(rect), paint));
    }
    DrawLine(pen, a, b) {
        if (!pen?.Brush || pen.Thickness <= 0)
            return;
        const p = this._Paint(pen.Brush, pen, new Rect(Math.min(a.X, b.X), Math.min(a.Y, b.Y), Math.abs(b.X - a.X), Math.abs(b.Y - a.Y)));
        try {
            this.Canvas.DrawLine(a.X, a.Y, b.X, b.Y, p.Paint);
        }
        finally {
            p.Dispose();
        }
    }
    DrawGeometry(brush, pen, geometry) {
        if (!geometry) return;
        const draw = (role, fill, stroke) => {
            const path = this.Platform.GetPath(geometry, role), b = path.Bounds;
            this._FillStroke(fill, stroke, new Rect(b.Left,b.Top,b.Width,b.Height), paint => this.Canvas.DrawPath(path, paint));
        };
        if (brush) draw('fill', brush, null);
        if (pen) draw('stroke', null, pen);
    }
    DrawImage(source, sourceRect, destRect) {
        if (source instanceof DrawingImage) { source.Draw(this, sourceRect, destRect); return; }
        const image = source?._native ? source._native : this.Platform.GetImage(source);
        if (!image)
            return;
        if (!destRect) {
            destRect = sourceRect;
            sourceRect = new Rect(0, 0, image.Width, image.Height);
        }
        this.Canvas.DrawImage(image, this.Rect(sourceRect), this.Rect(destRect));
    }
    /** Pixel-aligned caret retaining its nominal DIP width, at least one device pixel. */
    DrawCaret(brush, rect) {
        const m = this.Canvas.TotalMatrix.Values;
        if (m[0] > 0 && m[4] > 0 && m[1] === 0 && m[3] === 0 && m[6] === 0 && m[7] === 0 && m[8] === 1) {
            const x = (Math.round(rect.X * m[0] + m[2]) - m[2]) / m[0];
            const y = (Math.round(rect.Y * m[4] + m[5]) - m[5]) / m[4];
            const bottom = (Math.round(rect.Bottom * m[4] + m[5]) - m[5]) / m[4];
            this.DrawRectangle(brush, null, new Rect(x, y, Math.max(1, Math.round(rect.Width * m[0])) / m[0], Math.max(1 / m[4], bottom - y)));
        } else this.DrawRectangle(brush, null, rect);
    }
    DrawGlyphRun(foreground, glyphRun) {
        if (!foreground || !glyphRun) return;
        if (this.IsDisposed || this.Platform.IsDisposed) throw new Error('Drawing context or platform is disposed.');
        const native = glyphRun._GetNative(this.Platform);
        this._FillStroke(foreground, null, native.Bounds, paint => native.Draw(this.Canvas, paint));
    }
    DrawTextLayout(layout, origin = new Point()) {
        if (layout._nativeLayout) { layout._nativeLayout.Draw(this, origin); return; }
        if (layout.TextRuns?.length) {
            for (const line of layout.TextLines) {
                for (const run of layout.TextRuns) {
                    if (run.InlineSize) continue;
                    const start = Math.max(line.Start, run.Start), end = Math.min(line.Start + line.Length, run.Start + run.Length);
                    if (end <= start) continue;
                    const position = layout.HitTestTextPosition(start);
                    const text = layout.Text.slice(start, end);
                    const fragment = { ...layout, TextRuns: null, Typeface: run.Typeface ?? layout.Typeface, FontSize: run.FontSize ?? layout.FontSize, Foreground: run.Foreground ?? layout.Foreground,
                        TextLines: [{ Text: text, X: position.X, Y: line.Y, Baseline: line.Baseline }] };
                    if (run.Background) this.DrawRectangle(run.Background, null, new Rect(origin.X + position.X, origin.Y + line.Y, layout._measure(text, start), line.Height));
                    this.DrawTextLayout(fragment, origin);
                    if (run.TextDecorations) {
                        const p = this._Paint(fragment.Foreground, false, Math.max(1, fragment.FontSize / 14));
                        try { const y = origin.Y + line.Y + line.Baseline + (String(run.TextDecorations).includes('Strikethrough') ? -fragment.FontSize * .3 : 2);
                            this.Canvas.DrawLine(origin.X + position.X, y, origin.X + position.X + layout._measure(text, start), y, p.Paint); }
                        finally { p.Dispose(); }
                    }
                }
            }
            return;
        }
        const typeface = this.Platform._nativeFonts.get(String(layout.Typeface.FontFamily).trim().toLowerCase());
        if (typeface) {
            const font = new this.Api.SKFont(typeface, layout.FontSize), p = this._Paint(layout.Foreground);
            try {
                for (const line of layout.TextLines)
                    this.Canvas.DrawText(line.Text, origin.X + line.X, origin.Y + line.Y + line.Baseline, font, p.Paint);
            }
            finally {
                font.Dispose();
                p.Dispose();
            }
            return;
        }
        const matrix = this.Canvas.TotalMatrix, clip = this.GetDeviceClipBounds();
        // Native and rich text keep their own layout/drawing semantics. For the
        // system-font path, binary-search the retained line table before touching
        // raster cache keys, Canvas2D measurements or upload planning.
        const m = matrix.Values;
        const aligned = m[0] > 0 && m[4] > 0 && m[1] === 0 && m[3] === 0 && m[6] === 0 && m[7] === 0 && m[8] === 1;
        const range = aligned && layout.GetVisibleLineRange ? layout.GetVisibleLineRange(
            (clip.Top - m[5]) / m[4] - origin.Y, (clip.Bottom - m[5]) / m[4] - origin.Y, 2 / m[4]) : { Start: 0, End: layout.TextLines.length };
        for (let i = range.Start; i < range.End; ++i) {
            const line = layout.TextLines[i]; ++this.Platform.TextLinesVisited;
            if (!line.Text) continue;
            const x = origin.X + line.X, y = origin.Y + line.Y + line.Baseline;
            const geometry = GetDeviceTextGeometry(matrix, x, y, this.RenderScaling);
            const visible = geometry.AxisAligned ? tile => {
                const left = matrix.ScaleX * (x - tile.OffsetX) + matrix.TransX;
                const top = matrix.ScaleY * (y - tile.Baseline) + matrix.TransY;
                return left < clip.Right && top < clip.Bottom && left + tile.PixelWidth > clip.Left && top + tile.PixelHeight > clip.Top;
            } : null;
            const rasterClip = geometry.AxisAligned ? {
                Left: clip.Left - (matrix.ScaleX * x + matrix.TransX) + geometry.PhaseX,
                Top: clip.Top - (matrix.ScaleY * y + matrix.TransY) + geometry.PhaseY,
                Right: clip.Right - (matrix.ScaleX * x + matrix.TransX) + geometry.PhaseX,
                Bottom: clip.Bottom - (matrix.ScaleY * y + matrix.TransY) + geometry.PhaseY,
            } : null;
            for (const item of this.Platform._GetTextTiles(line.Text, layout, geometry, visible, rasterClip)) {
                this.Canvas.DrawImage(item.Image, new this.Api.SKRect(0, 0, item.PixelWidth, item.PixelHeight),
                    new this.Api.SKRect(x - item.OffsetX, y - item.Baseline, x - item.OffsetX + item.Width, y - item.Baseline + item.Height));
            }
        }
    }
}
const MathUtilitiesClamp = (v, min, max) => Math.max(min, Math.min(max, v));
export class SkiaRenderer extends Disposable {
    constructor(platform, root, canvas, options = {}) {
        super();
        this.Platform = platform;
        this.Root = root;
        this.Element = canvas;
        this.Options = options;
        this.Surface = null;
        this.FrameRendered = new Event();
        this._generation = 0;
        this._pendingSize = null;
        this._resizing = null;
        this.LastFrameMilliseconds = 0;
    }
    async Resize(width, height, scale = 1) {
        const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
        this._pendingSize = { w, h, scale };
        if (this._resizing)
            return this._resizing;
        this._resizing = (async () => {
            while (this._pendingSize && !this.IsDisposed) {
                const next = this._pendingSize;
                this._pendingSize = null;
                if (this.Surface && this.Element.width === next.w && this.Element.height === next.h) {
                    this.RenderScaling = next.scale;
                    continue;
                }
                const generation = ++this._generation;
                if (this.Surface) {
                    await this.Surface.DisposeAsync();
                    this.Surface = null;
                }
                this.Element.width = next.w;
                this.Element.height = next.h;
                // CanvasKit's DOM checks are realm-local. Initialize a detached canvas in the
                // Skia realm, including backend fallbacks, and only then adopt into a popup.
                const target = this.Element.ownerDocument?.defaultView !== globalThis.window ? this.Platform.CreateCanvas() : this.Element;
                target.width = next.w;
                target.height = next.h;
                const surface = await this.Platform.Api.SKSurface.Create(target, { backend: this.Options.Backend ?? 'auto', allowFallback: this.Options.AllowFallback !== false, onDeviceLost: info => this.Root._OnRendererLost?.(info) });
                if (this.IsDisposed || generation !== this._generation) {
                    await surface.DisposeAsync();
                    continue;
                }
                const old = this.Element;
                this.Surface = surface;
                this.Element = surface.Element ?? this.Element;
                this.Element.style.cssText = old.style.cssText;
                this.RenderScaling = next.scale;
                this.Root._OnCanvasChanged?.(this.Element, old);
            }
        })();
        try {
            await this._resizing;
        }
        finally {
            this._resizing = null;
        }
    }
    get Backend() {
        return this.Surface?.Backend ?? null;
    }
    Render() {
        if (!this.Surface || this.IsDisposed || this._resizing)
            return false;
        const start = performance.now(), C = this.Surface.Canvas, S = this.Platform.Api;
        C.Clear(S.SKColors.Transparent);
        C.Save();
        C.Scale(this.RenderScaling, this.RenderScaling);
        const context = new SkiaDrawingContext(this.Platform, C, this.RenderScaling);
        context.Surface = this.Surface;
        try {
            this.Root.RenderTree(context);
            context.Dispose();
        }
        finally {
            C.Restore();
        }
        this.Surface.Flush();
        this.LastFrameMilliseconds = performance.now() - start;
        this.Platform.FrameCount++;
        this.FrameRendered.Raise(this, { Duration: this.LastFrameMilliseconds, Backend: this.Surface.Backend, RenderMode: this.Surface.RenderMode });
        return true;
    }
    async SnapshotPng() {
        if (!this.Surface)
            throw new Error('Renderer is not initialized.');
        const image = await (this.Surface.SnapshotAsync?.() ?? this.Surface.Snapshot());
        try {
            const data = image.Encode(this.Platform.Api.SKEncodedImageFormat.Png, 100);
            try {
                return data.ToArray();
            }
            finally {
                data.Dispose();
            }
        }
        finally {
            image.Dispose();
        }
    }
    Dispose() {
        if (this.IsDisposed)
            return;
        this._generation++;
        this.Surface?.Dispose();
        this.Surface = null;
        super.Dispose();
    }
}
export { InitializeWorkerSkia, OffscreenSkiaRenderTarget } from './worker-runtime.js';
