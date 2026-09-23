import { IBlurEffect, IDropShadowEffect, IEffect, EffectExtensions } from '@wieslawsoltes/avalonia-media';

// Preserve the pinned Avalonia Skia float32 operation order, not radius / 2.
export function SkBlurRadiusToSigma(radius) {
    return radius <= 0 ? 0 : Math.fround(Math.fround(Math.fround(.288675) * Math.fround(radius)) + .5);
}
const empty = Object.freeze({ Filter: null, Dispose() {} });
/** Bounded native filter cache. An active SaveLayer lease pins its filter even
 * when an LRU eviction or platform disposal removes the cache's ownership.
 * Keys describe actual native scalar/color values; no UI objects are retained.
 */
export class SkiaEffectCache {
    constructor(api, capacity = 128) {
        if (!Number.isInteger(capacity) || capacity < 0 || capacity > 4096) throw new RangeError('EffectCacheEntries must be an integer from 0 to 4096.');
        this.Api = api; this.Capacity = capacity; this.IsDisposed = false;
        this._entries = new Map(); this._keys = new WeakMap();
        this.Hits = 0; this.Misses = 0; this.NativeCreated = 0; this.NativeDisposed = 0; this.ActiveLeases = 0; this.NoOps = 0;
    }
    _Description(effect) {
        if (!(effect instanceof IEffect)) throw new TypeError('Unsupported effect.');
        const value = EffectExtensions.ToImmutable(effect), cached = this._keys.get(value);
        if (cached) return cached;
        let description;
        if (value instanceof IBlurEffect) {
            const sigma = SkBlurRadiusToSigma(value.Radius);
            description = { Key: `b:${sigma}`, Sigma: sigma, NoOp: sigma === 0, Shadow: false };
        } else if (value instanceof IDropShadowEffect) {
            const c = value.Color, alpha = Math.trunc(Math.max(0, Math.min(255, c.A * value.Opacity)));
            const x = Math.fround(value.OffsetX), y = Math.fround(value.OffsetY), sigma = SkBlurRadiusToSigma(value.BlurRadius);
            description = { Key: `s:${x},${y},${sigma},${c.R},${c.G},${c.B},${alpha}`, X: x, Y: y, Sigma: sigma,
                R: c.R, G: c.G, B: c.B, A: alpha, Shadow: true, NoOp: alpha === 0 };
        } else throw new TypeError('Unsupported native effect.');
        this._keys.set(value, description); return description;
    }
    Acquire(effect) {
        if (this.IsDisposed) throw new Error('Native effect cache is disposed.');
        const d = this._Description(effect);
        if (d.NoOp) { ++this.NoOps; return empty; }
        let entry = this._entries.get(d.Key);
        if (entry) { ++this.Hits; this._entries.delete(d.Key); this._entries.set(d.Key, entry); }
        else {
            ++this.Misses;
            const S = this.Api, filter = d.Shadow
                ? S.SKImageFilter.CreateDropShadow(d.X, d.Y, d.Sigma, d.Sigma, new S.SKColor(d.R, d.G, d.B, d.A))
                : S.SKImageFilter.CreateBlur(d.Sigma, d.Sigma);
            if (!filter) throw new Error('Native effect filter creation failed.');
            entry = { Filter: filter, References: 0, Cached: this.Capacity > 0 }; ++this.NativeCreated;
            if (entry.Cached) this._entries.set(d.Key, entry);
        }
        ++entry.References; ++this.ActiveLeases;
        try {
            while (this._entries.size > this.Capacity) {
                const [key, old] = this._entries.entries().next().value;
                this._entries.delete(key); old.Cached = false; this._ReleaseUnowned(old);
            }
        } catch (error) { --entry.References; --this.ActiveLeases; this._ReleaseUnowned(entry); throw error; }
        let released = false;
        return { Filter: entry.Filter, Dispose: () => {
            if (released) return; released = true; --entry.References; --this.ActiveLeases; this._ReleaseUnowned(entry);
        } };
    }
    _ReleaseUnowned(entry) {
        if (entry.Cached || entry.References || !entry.Filter) return;
        const filter = entry.Filter; entry.Filter = null;
        try { filter.Dispose(); } finally { ++this.NativeDisposed; }
    }
    Clear() {
        const entries = [...this._entries.values()]; this._entries.clear(); this._keys = new WeakMap();
        const errors = [];
        for (const entry of entries) { entry.Cached = false; try { this._ReleaseUnowned(entry); } catch (error) { errors.push(error); } }
        if (errors.length) throw new AggregateError(errors, 'Native effect cache cleanup failed.');
    }
    get Count() { return this._entries.size; }
    GetDiagnostics() { return { Count: this.Count, Capacity: this.Capacity, Hits: this.Hits, Misses: this.Misses,
        NativeCreated: this.NativeCreated, NativeDisposed: this.NativeDisposed, ActiveLeases: this.ActiveLeases, NoOps: this.NoOps }; }
    Dispose() { if (!this.IsDisposed) { this.IsDisposed = true; this.Clear(); } }
}
