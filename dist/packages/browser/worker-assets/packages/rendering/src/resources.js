import { Point, Vector, Size, Rect, Matrix, RelativePoint, Event } from "../../base/src/index.js";
import { Color, Brush, SolidColorBrush, ImmutableSolidColorBrush, LinearGradientBrush, RadialGradientBrush, ConicGradientBrush,
    GradientStop, ImageBrush, VisualBrush, Pen, DashStyle, BoxShadow, IBlurEffect, IDropShadowEffect, IEffect, EffectExtensions, ImmutableBlurEffect, ImmutableDropShadowEffect, ImmutableDropShadowDirectionEffect, ExperimentalAcrylicMaterial,
    GlyphTypeface, GlyphRun, GlyphInfo, ImmutableGlyphRunReference, Geometry, StreamGeometry, Typeface, FontFamily, Bitmap, WriteableBitmap, TextLayout, GetTextServiceVersion } from "../../media/src/index.js";
import { CompositionProtocolError, SameCompositionValue } from './protocol.js';

const error = message => { throw new CompositionProtocolError(message); };
const matrix = m => [m.M11, m.M12, m.M21, m.M22, m.M31, m.M32];
const number = value => { if (!Number.isFinite(value)) error('Nonfinite drawing coordinate.'); return value; };
export const MatrixValues = m => matrix(m.Value ?? m).map(number);
export const RectValues = r => [r.X, r.Y, r.Width, r.Height].map(number);
const cloneBytes = bytes => bytes instanceof ArrayBuffer ? new Uint8Array(bytes.slice(0)) : new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

/** UI-owned resources. Descriptor instances are immutable after publication.
 * Entry identity, not repeated serialization, drives transaction differencing. */
export class CompositionResourceRegistry {
    constructor(platform, invalidate = () => {}) {
        this.Platform = platform; this.Invalidate = invalidate; this.NextId = 1; this.Entries = new Map();
        this._objects = new WeakMap(); this._scalars = new Map(); this._interned = new Map(); this._stack = []; this._subscriptions = new Map(); this._mutations = new WeakMap();
        this.Statistics = { Created: 0, Reused: 0, TextDescriptors: 0, ImageBytes: 0, InternHits: 0, InternCandidates: 0 };
        this.Encode = this.Encode.bind(this);
    }
    Define(kind, source, revision, build, internKey = null) {
        const isObject = source !== null && typeof source === 'object';
        const map = isObject ? this._objects : this._scalars;
        let slots = map.get(source); if (!slots) { slots = new Map(); map.set(source, slots); }
        let slot = slots.get(kind);
        if (slot && Object.is(slot.Revision, revision) && this.Entries.has(slot.Entry.Id)) {
            ++this.Statistics.Reused; this._stack.at(-1)?.add(slot.Entry.Id); return { $ref: slot.Entry.Id };
        }
        if (slot?.Building) error('Cyclic rendering resource.');
        // Content-interned entries are immutable and may have several owners. A
        // revision must never overwrite the old shared ID still used elsewhere.
        const id = internKey === null ? slot?.Entry?.Id ?? this.NextId++ : this.NextId++;
        slot = { Entry: slot?.Entry, Revision: revision, Building: true }; slots.set(kind, slot);
        const dependencies = new Set(); this._stack.push(dependencies);
        let data;
        try { data = build(); } catch (e) { slots.delete(kind); throw e; } finally { this._stack.pop(); }
        if (internKey !== null) {
            for (const existing of this._interned.get(internKey) ?? []) {
                ++this.Statistics.InternCandidates;
                if (this.Entries.has(existing.Id) && existing.Kind === kind && SameCompositionValue(existing.Data, data)) {
                    slot.Entry = existing; slot.Building = false; ++this.Statistics.InternHits; ++this.Statistics.Reused;
                    this._stack.at(-1)?.add(existing.Id); return { $ref: existing.Id };
                }
            }
        }
        const entry = Object.freeze({ Id: id, Kind: kind, Data: data, Depends: [...dependencies] });
        if (internKey !== null) {
            let bucket = this._interned.get(internKey); if (!bucket) this._interned.set(internKey, bucket = []);
            // Bound collision/variant work independently of the number of labels.
            // Uninterned variants remain ordinary strongly-versioned resources.
            if (bucket.length < 32) bucket.push(entry);
        }
        slot.Entry = entry; slot.Building = false; this.Entries.set(id, entry); ++this.Statistics.Created;
        this._stack.at(-1)?.add(id); return { $ref: id };
    }
    Use(id, result) {
        if (result.has(id)) return;
        const entry = this.Entries.get(id); if (!entry) error(`Missing UI resource ${id}.`);
        result.set(id, entry); for (const child of entry.Depends) this.Use(child, result);
    }
    Sweep(used) {
        for (const id of this.Entries.keys()) if (!used.has(id)) { this.Entries.delete(id); this._subscriptions.get(id)?.Dispose(); this._subscriptions.delete(id); }
        for (const [key, bucket] of this._interned) {
            const live = bucket.filter(e => used.has(e.Id));
            if (live.length) this._interned.set(key, live); else this._interned.delete(key);
        }
        // Bound interning of string/number resources even for applications producing
        // unique colors/text continuously. Object keys remain weakly held.
        for (const [key, slots] of this._scalars) { for (const [kind, slot] of slots) if (!this.Entries.has(slot.Entry?.Id)) slots.delete(kind); if (!slots.size) this._scalars.delete(key); }
    }
    Dispose() { for (const s of this._subscriptions.values()) s.Dispose(); this._subscriptions.clear(); this.Entries.clear(); this._scalars.clear(); this._interned.clear(); }
    _Bitmap(bitmap) {
        if (!(bitmap instanceof Bitmap)) error('DrawImage requires a Bitmap resource; native SKImage handles cannot cross workers.');
        const mutation = this._mutations.get(bitmap) ?? 0;
        const revision = `${mutation}|${bitmap.PixelSize.Width},${bitmap.PixelSize.Height}|${bitmap.IsDisposed}`;
        // Native image replacement is tracked separately from the user-owned bitmap.
        let slot = this._objects.get(bitmap)?.get('Image');
        const nativeChanged = slot && slot.Native !== bitmap._native;
        const ref = this.Define('Image', bitmap, nativeChanged ? Symbol() : revision, () => {
            if (bitmap.IsDisposed) error('A disposed Bitmap cannot be recorded.');
            const native = bitmap._native;
            if (bitmap instanceof WriteableBitmap) {
                const bytes = cloneBytes(bitmap.Pixels); this.Statistics.ImageBytes += bytes.length;
                return { Pixels: bytes, Width: bitmap.PixelSize.Width, Height: bitmap.PixelSize.Height };
            }
            let bytes = bitmap.Source;
            if (!(bytes instanceof ArrayBuffer) && !ArrayBuffer.isView(bytes) && native) {
                const data = native.Encode(this.Platform.Api.SKEncodedImageFormat.Png, 100);
                try { bytes = cloneBytes(data.ToArray()); } finally { data.Dispose(); }
            }
            if (bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes)) { const data = cloneBytes(bytes); this.Statistics.ImageBytes += data.length; return { Encoded: data }; }
            if (typeof bytes === 'string' || bytes instanceof URL) return { Url: new URL(String(bytes), this.BaseUrl ?? globalThis.document?.baseURI ?? globalThis.location?.href).href };
            error('Bitmap is not loaded and has no transferable image source.');
        });
        slot = this._objects.get(bitmap).get('Image'); slot.Native = bitmap._native;
        if (!this._subscriptions.has(ref.$ref)) this._subscriptions.set(ref.$ref, bitmap.Changed.Add(() => {
            this._mutations.set(bitmap, (this._mutations.get(bitmap) ?? 0) + 1); this.Invalidate(bitmap);
        }));
        return ref;
    }
    _Brush(brush) {
        const common = { Opacity: brush.Opacity ?? 1, Transform: this.Encode(brush.Transform?.Value ?? brush.Transform), TransformOrigin: this.Encode(brush.TransformOrigin) };
        let type = brush.constructor.name, fields = {};
        if (brush instanceof SolidColorBrush || brush instanceof ImmutableSolidColorBrush) { type = 'SolidColorBrush'; fields.Color = this.Encode(brush.Color); }
        else if (brush instanceof LinearGradientBrush || brush instanceof RadialGradientBrush || brush instanceof ConicGradientBrush) {
            fields = { SpreadMethod: brush.SpreadMethod, MappingMode: brush.MappingMode, GradientStops: [...brush.GradientStops].map(s => [this.Encode(s.Color), s.Offset]) };
            for (const key of ['StartPoint', 'EndPoint', 'Center', 'GradientOrigin', 'Radius', 'RadiusX', 'RadiusY', 'Angle']) if (key in brush) fields[key] = this.Encode(brush[key]);
        } else if (brush instanceof ImageBrush || brush instanceof VisualBrush) {
            fields = { Stretch: brush.Stretch, TileMode: brush.TileMode, AlignmentX: brush.AlignmentX, AlignmentY: brush.AlignmentY };
            if (brush instanceof ImageBrush) fields.Source = brush.Source ? this._Bitmap(brush.Source) : null;
            else { if (!this.RecordVisual) error('No visual resource recorder is installed.'); fields.Visual = this.RecordVisual(brush.Visual); }
        } else error(`Unsupported brush type '${type}'.`);
        // Brush descriptors are small. Only constructed on content invalidation,
        // not per composited frame. Primitive gradients/brushes are deduplicated.
        return { $: 'Brush', Type: type, ...common, ...fields };
    }
    Encode(value) {
        if (value == null || ['number','string','boolean','undefined'].includes(typeof value)) return value;
        if (value instanceof Rect) return { $: 'Rect', V: RectValues(value) };
        if (value instanceof Size) return { $: 'Size', V: [value.Width, value.Height] };
        if (value instanceof RelativePoint) return { $: 'RelativePoint', V: [value.Point.X, value.Point.Y, value.Unit] };
        if (value instanceof Point || value instanceof Vector) return { $: 'Point', V: [value.X, value.Y] };
        if (value instanceof Matrix) return { $: 'Matrix', V: MatrixValues(value) };
        if (value instanceof Color) return { $: 'Color', V: [value.A, value.R, value.G, value.B] };
        if (value instanceof Typeface) return { $: 'Typeface', V: [String(value.FontFamily), value.Style, value.Weight, value.Stretch] };
        if (value instanceof FontFamily) return String(value);
        if (value instanceof Brush || value instanceof ImmutableSolidColorBrush) return this._Brush(value);
        if (value instanceof Pen) return { $: 'Pen', V: [this.Encode(value.Brush), value.Thickness, this.Encode(value.DashStyle), value.LineCap, value.LineJoin, value.MiterLimit] };
        if (value instanceof DashStyle) return { $: 'DashStyle', V: [Array.from(value.Dashes ?? []), value.Offset] };
        if (value instanceof BoxShadow) return { $: 'BoxShadow', V: { OffsetX: value.OffsetX, OffsetY: value.OffsetY, Blur: value.Blur, Spread: value.Spread, Color: this.Encode(value.Color), IsInset: value.IsInset } };
        if (value instanceof IEffect) {
            const effect = EffectExtensions.ToImmutable(value);
            if (effect instanceof IBlurEffect) return { $: 'BlurEffect', Radius: effect.Radius };
            if (EffectExtensions.GetKind(effect) === 'direction') return { $: 'DropShadowDirectionEffect', V: {
                Direction: effect.Direction, ShadowDepth: effect.ShadowDepth, BlurRadius: effect.BlurRadius, Color: this.Encode(effect.Color), Opacity: effect.Opacity } };
            return { $: 'DropShadowEffect', V: { OffsetX: effect.OffsetX, OffsetY: effect.OffsetY, BlurRadius: effect.BlurRadius, Color: this.Encode(effect.Color), Opacity: effect.Opacity } };
        }
        if (value instanceof ExperimentalAcrylicMaterial) return { $: 'Acrylic', V: { TintColor: this.Encode(value.TintColor), TintOpacity: value.TintOpacity, MaterialOpacity: value.MaterialOpacity, FallbackColor: this.Encode(value.FallbackColor), BlurRadius: value.BlurRadius } };
        if (value instanceof Geometry) {
            const description = value.GetPathDescription();
            const ref = this.Define('Geometry', value, value.PathSignature, () => ({ Path: description }));
            if (!this._subscriptions.has(ref.$ref)) this._subscriptions.set(ref.$ref, value.Changed.Add(() => this.Invalidate(value)));
            return ref;
        }
        if (value instanceof GlyphTypeface) {
            const descriptor = value._Descriptor();
            return this.Define('GlyphTypeface', value._Identity(), 0, () => ({Bytes:cloneBytes(descriptor.Bytes),FontIndex:descriptor.FontIndex}));
        }
        if (value instanceof GlyphRun || value instanceof ImmutableGlyphRunReference) {
            const descriptor = value._Descriptor();
            const ref = this.Define('GlyphRun', value, descriptor, () => ({...descriptor,Typeface:this.Encode(value.GlyphTypeface)}));
            if (value.Changed && !this._subscriptions.has(ref.$ref)) this._subscriptions.set(ref.$ref, value.Changed.Add(() => this.Invalidate(value)));
            return ref;
        }
        if (value instanceof Bitmap) return this._Bitmap(value);
        if (value instanceof TextLayout || value.TextLines && value.Typeface) {
            return this.Define('Text', value, GetTextServiceVersion(), () => {
                ++this.Statistics.TextDescriptors;
                const descriptor = {};
                for (const key of ['Text','Typeface','FontSize','Foreground','MaxWidth','MaxHeight','TextWrapping','TextAlignment','TextTrimming','FlowDirection','LineHeight','MaxLines','TextRuns','LetterSpacing','WordSpacing','FontKerning','TextRendering','Width','Height','WidthIncludingTrailingWhitespace','_inkAbove','_inkBelow']) {
                    // Internal ink fields have explicit wire names; no arbitrary
                    // private object state or native pointers are serialized.
                    descriptor[key === '_inkAbove' ? 'InkAbove' : key === '_inkBelow' ? 'InkBelow' : key] = this.Encode(value[key]);
                }
                descriptor.Native = !!value._nativeLayout;
                descriptor.TextLines = value.TextLines.map(line => { const result = {}; for (const [k, v] of Object.entries(line)) if (!k.startsWith('_') && (v == null || typeof v !== 'object')) result[k] = v; return result; });
                // Rich-run drawing uses layout hit testing. Preserve the authoritative
                // run start/width positions rather than reshaping in the renderer.
                descriptor.RunPositions = value.TextRuns?.map(r => ({ Start: r.Start, Bounds: this.Encode(value.HitTestTextPosition(r.Start)), Width: value._measure(value.Text.slice(r.Start, r.Start + r.Length), r.Start) }));
                return descriptor;
            }, `Text:${GetTextServiceVersion()}:${value.Text}`);
        }
        if (Array.isArray(value)) return value.map(this.Encode);
        if (ArrayBuffer.isView(value)) return cloneBytes(value);
        if (value instanceof ArrayBuffer) return value.slice(0);
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) error(`Nonportable drawing value ${value.constructor?.name}.`);
        const result = {};
        for (const [key, v] of Object.entries(value)) {
            if (['__proto__','constructor','prototype'].includes(key)) error('Unsafe drawing member.');
            result[key] = this.Encode(v);
        }
        return result;
    }
}
const brushTypes = { SolidColorBrush, LinearGradientBrush, RadialGradientBrush, ConicGradientBrush, ImageBrush, VisualBrush };
/** Worker-local reconstruction. Nothing returned here aliases UI objects. */
export class CompositionResourceResolver {
    constructor(platform, getVisual) { this.Platform = platform; this.GetVisual = getVisual; this.Entries = new Map(); this.Values = new Map(); this.Pending = new Map(); this._decoding = new Set(); }
    Decode = value => {
        if (value == null || typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
        if (Array.isArray(value)) return value.map(this.Decode);
        if (Object.hasOwn(value, '$ref')) return this.Get(value.$ref);
        switch (value.$) {
            case 'Rect': return new Rect(...value.V);
            case 'Size': return new Size(...value.V);
            case 'Point': return new Point(...value.V);
            case 'RelativePoint': return new RelativePoint(...value.V);
            case 'Matrix': return new Matrix(...value.V);
            case 'Color': return new Color(...value.V);
            case 'Typeface': return new Typeface(...value.V);
            case 'Pen': return new Pen(...value.V.map(this.Decode));
            case 'DashStyle': return new DashStyle(...value.V);
            case 'BoxShadow': return new BoxShadow(this.Decode(value.V));
            case 'BlurEffect': case 'DropShadowEffect': case 'DropShadowDirectionEffect': {
                try {
                    if (value.$ === 'BlurEffect') {
                        if (Object.keys(value).some(k => !['$', 'Radius'].includes(k))) error('Invalid blur descriptor fields.');
                        return new ImmutableBlurEffect(value.Radius);
                    }
                    if (Object.keys(value).some(k => !['$', 'V'].includes(k))) error('Invalid shadow descriptor fields.');
                    const v = value.V, direction = value.$ === 'DropShadowDirectionEffect';
                    const keys = direction ? ['Direction','ShadowDepth','BlurRadius','Color','Opacity'] : ['OffsetX','OffsetY','BlurRadius','Color','Opacity'];
                    if (!v || Array.isArray(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) error('Invalid shadow descriptor fields.');
                    const channels = v.Color?.V;
                    if (v.Color?.$ !== 'Color' || !Array.isArray(channels) || channels.length !== 4 || channels.some(c => !Number.isInteger(c) || c < 0 || c > 255)) error('Invalid shadow color.');
                    const c = new Color(...channels);
                    return direction ? new ImmutableDropShadowDirectionEffect(v.Direction, v.ShadowDepth, v.BlurRadius, c, v.Opacity)
                        : new ImmutableDropShadowEffect(v.OffsetX, v.OffsetY, v.BlurRadius, c, v.Opacity);
                } catch (failure) { error(`Invalid effect descriptor: ${failure.message}`); }
                break;
            }
            case 'Acrylic': return new ExperimentalAcrylicMaterial(this.Decode(value.V));
            case 'Brush': {
                const T = brushTypes[value.Type]; if (!T) error('Unknown brush descriptor.'); const brush = new T();
                for (const [k, v] of Object.entries(value)) {
                    if (k === '$' || k === 'Type') continue;
                    if (k === 'GradientStops') brush.GradientStops.AddRange(v.map(([color, offset]) => new GradientStop(this.Decode(color), offset)));
                    else if (k === 'Visual') brush.Visual = v == null ? null : this.GetVisual(v);
                    else brush[k] = this.Decode(v);
                }
                return brush;
            }
            case undefined: return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.Decode(v)]));
            default: error(`Unknown drawing descriptor '${value.$}'.`);
        }
    };
    Get(id) {
        if (this.Values.has(id)) return this.Values.get(id);
        const entry = this.Entries.get(id); if (!entry) error(`Unknown render resource ${id}.`);
        if (this._decoding.has(id)) error('Cyclic resource dependencies.');
        this._decoding.add(id);
        let result;
        try {
            const data = entry.Data;
            if (entry.Kind === 'Geometry') {
                if (data.Path) result = Geometry.FromPathDescription(data.Path);
                else { result = new StreamGeometry(data.Data); result.FillRule = data.FillRule; result.Transform = this.Decode(data.Transform); }
                // Reject malformed native path programs while the transaction is
                // still provisional, rather than poisoning a future render frame.
                try { for (const role of ['all','fill','stroke']) this.Platform.GetPath(result, role); }
                catch (error) { result.Dispose(); throw error; }
            }
            else if (entry.Kind === 'GlyphTypeface') {
                result = this.Platform.CreateGlyphTypeface(data.Bytes, {FontIndex:data.FontIndex});
            } else if (entry.Kind === 'GlyphRun') {
                if (!Array.isArray(data.Glyphs) || data.Glyphs.length > 1000000 ||
                    !Array.isArray(data.Baseline) || data.Baseline.length !== 2 || !data.Baseline.every(Number.isFinite) ||
                    typeof data.Characters !== 'string') error('Invalid glyph-run descriptor.');
                const infos = data.Glyphs.map(g => {
                    if (!Array.isArray(g) || g.length !== 5) error('Invalid positioned glyph descriptor.');
                    return new GlyphInfo(g[0],g[1],g[2],new Vector(g[3],g[4]));
                });
                const face = this.Decode(data.Typeface);
                if (!(face instanceof GlyphTypeface)) error('Glyph-run typeface reference has the wrong resource kind.');
                result = new GlyphRun(face,data.Size,data.Characters,infos,new Point(...data.Baseline),data.BiDiLevel);
                try { result._GetNative(this.Platform); } catch (error) { result.Dispose(); throw error; }
            } else if (entry.Kind === 'Text') {
                const d = this.Decode(data);
                if (d.Native) {
                    result = new TextLayout(d.Text, d.Typeface, d.FontSize, d.Foreground, d);
                    // Same bytes, shaping backend and settings must produce the
                    // same line table; do not silently change the UI's layout.
                    const actual = result.TextLines, expected = d.TextLines;
                    if (actual.length !== expected.length || actual.some((line, i) => ['X','Y','Width','Height','Baseline'].some(k => Math.abs((line[k] ?? 0) - (expected[i][k] ?? 0)) > .05))) { result.Dispose(); error('Native worker font metrics differ from committed UI layout.'); }
                } else {
                    result = Object.assign(Object.create(TextLayout.prototype), d, { _prefixCache: new WeakMap(), _nativeLayout: null, _inkAbove: d.InkAbove ?? 0, _inkBelow: d.InkBelow ?? 0 });
                    result.Size = new Size(d.Width ?? 0, d.Height ?? 0);
                    if (d.RunPositions?.length) {
                        const originalHit = result.HitTestTextPosition.bind(result), originalMeasure = result._measure.bind(result);
                        result.HitTestTextPosition = (index, ...args) => d.RunPositions.find(r => r.Start === index)?.Bounds ?? originalHit(index, ...args);
                        result._measure = (s, start = 0) => { const p = d.RunPositions.find(r => r.Start === start), run = d.TextRuns.find(r => r.Start === start); return p && run && s.length === run.Length ? p.Width : originalMeasure(s, start); };
                    }
                }
            } else if (entry.Kind === 'Image') {
                if (data.Pixels) { result = new WriteableBitmap(new Size(data.Width, data.Height)); result.Pixels.set(data.Pixels); this.Platform.GetImage(result); }
                else { result = new Bitmap(data.Encoded ?? data.Url); if (data.Encoded) {
                    result._native = this.Platform.Api.SKImage.FromEncodedData(data.Encoded);
                    if (!result._native) error('Worker image decoding failed.'); result.PixelSize = new Size(result._native.Width, result._native.Height);
                } else error('A URL image must be prepared before transaction application.'); }
            } else error(`Unknown resource kind '${entry.Kind}'.`);
            this.Values.set(id, result); return result;
        } finally { this._decoding.delete(id); }
    }
    DisposeValue(id) { const value = this.Values.get(id); this.Values.delete(id); value?.Dispose?.(); }
    Dispose() { for (const id of this.Values.keys()) this.DisposeValue(id); this.Entries.clear(); }
}
