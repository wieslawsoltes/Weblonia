import { BrushColor } from './brushes.js';
import { TextLayout, GetTextServiceVersion } from './text.js';

/** Small owner-scoped cache. Never keys only on object identity for mutable brushes.
 * Rich runs and mutable features bypass reuse but remain owned and bounded.
 * Layouts returned by GetOrCreate are borrowed and owned by this cache.
 */
export class TextLayoutCache {
    constructor(maxEntries = 4) {
        if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError('maxEntries must be a positive integer.');
        this.MaxEntries = maxEntries; this.Hits = this.Misses = 0; this._entries = [];
    }
    GetOrCreate(text, typeface, fontSize, foreground, options = {}) {
        const cacheable = !options.TextRuns?.length && !options.FontFeatures?.length;
        const color = BrushColor(foreground);
        const signature = [GetTextServiceVersion(), String(text ?? ''), String(typeface.FontFamily), typeface.Style, typeface.Weight, typeface.Stretch,
            fontSize, foreground, color.A, color.R, color.G, color.B, foreground?.Opacity ?? 1,
            options.MaxWidth ?? Infinity, options.MaxHeight ?? Infinity, options.TextWrapping ?? 'NoWrap', options.TextAlignment ?? 'Left',
            options.TextTrimming ?? 'None', options.FlowDirection ?? 'LeftToRight', options.LineHeight ?? NaN, options.MaxLines ?? 0,
            options.LetterSpacing ?? 0, options.WordSpacing ?? 0, options.FontKerning ?? 'auto', options.TextRendering ?? 'auto',
            options.FontFeatures, options.Culture, options.BaselinePixelAlignment];
        // Feature collections are mutable and uncommon. Bypass rather than reuse a stale shape.
        const index = cacheable ? this._entries.findIndex(e => !e.Layout.IsDisposed && e.Signature && signature.every((v, i) => Object.is(v, e.Signature[i]))) : -1;
        if (index >= 0) { ++this.Hits; const [entry] = this._entries.splice(index, 1); this._entries.push(entry); return entry.Layout; }
        ++this.Misses;
        const layout = new TextLayout(text, typeface, fontSize, foreground, options);
        this._entries.push({ Signature: cacheable ? signature : null, Layout: layout });
        while (this._entries.length > this.MaxEntries) this._entries.shift().Layout.Dispose();
        return layout;
    }
    get Count() { return this._entries.length; }
    Clear() { for (const entry of this._entries) entry.Layout.Dispose(); this._entries.length = 0; }
    Dispose() { this.Clear(); }
}
