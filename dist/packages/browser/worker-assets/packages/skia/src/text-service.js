import { Rect, Point } from "../../base/src/index.js";
import { BrushColor, Color, Typeface, GraphemeSegments, SnapTextPosition } from "../../media/src/index.js";

const enumValue = value => value?.value ?? value;
const families = typeface => String(typeface.FontFamily).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
const color = brush => { const c = BrushColor(brush); return new Color(c.A * (brush?.Opacity ?? 1), c.R, c.G, c.B).ToString(); };
const tfSnapshot = tf => ({ Family: String(tf.FontFamily), Style: tf.Style, Weight: tf.Weight, Stretch: tf.Stretch ?? 5 });
const normalizeRun = (run, layout) => ({
    Start: run.Start ?? 0, Length: run.Length ?? layout.Text.length,
    Typeface: tfSnapshot(run.Typeface ?? layout.Typeface), FontSize: run.FontSize ?? layout.FontSize,
    Foreground: color(run.Foreground ?? layout.Foreground), Background: run.Background ? color(run.Background) : null,
    LetterSpacing: run.LetterSpacing ?? layout.LetterSpacing ?? 0,
    TextDecorations: run.TextDecorations ?? layout.TextDecorations ?? null,
    FontFeatures: run.FontFeatures ?? layout.FontFeatures ?? [], Locale: run.Locale ?? layout.Culture ?? '',
    Placeholder: run.InlineSize ? { Width: run.InlineSize.Width, Height: run.InlineSize.Height, Alignment: run.BaselineAlignment ?? 'Baseline' } : null
});

/** Native SkParagraph owns shaping, bidi, cluster positioning and line breaking.
 * Native paragraphs are cached, not retained by ephemeral TextLayout wrappers.
 */
export class SkiaTextService {
    constructor(platform, CacheType) {
        this.Platform = platform;
        this.Api = platform.Api;
        this.Cache = new CacheType(platform.Options.ParagraphCacheEntries ?? 128, platform.Options.ParagraphCacheBytes ?? 8 * 1024 * 1024);
        this._fonts = new Map();
        this._manager = null;
        this._generation = 0;
        this.IsDisposed = false;
        this._descriptorKeys = new WeakMap(); this.KeySerializations = 0; this.ParagraphBuilds = 0;
    }
    RegisterFont(family, bytes) {
        if (this.IsDisposed) throw new Error('The text service has been disposed.');
        const key = family.trim().toLowerCase(), token = {};
        const values = this._fonts.get(key) ?? [];
        values.push({ Family: key, Token: token, Bytes: new Uint8Array(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength ?? bytes.length).slice() });
        this._fonts.set(key, values); this._ResetFonts(); return token;
    }
    UnregisterFont(family, token = null) {
        const key = family.trim().toLowerCase(), values = this._fonts.get(key);
        if (!values) return;
        if (token) { const index = values.findIndex(v => v.Token === token); if (index < 0) return; values.splice(index, 1); }
        else values.length = 0;
        if (!values.length) this._fonts.delete(key);
        this._ResetFonts();
    }
    _ResetFonts() {
        this.Cache.Clear(); this._manager?.Dispose(); this._manager = null; ++this._generation;
    }
    _GetManager() {
        if (!this._manager) {
            const manager = new this.Api.SKFontManager();
            try { for (const values of this._fonts.values()) for (const entry of values) manager.RegisterFont(entry.Bytes, entry.Family).Dispose(); }
            catch (error) { manager.Dispose(); throw error; }
            this._manager = manager;
        }
        return this._manager;
    }
    CanLayout(layout) {
        return !this.IsDisposed && [layout, ...(layout.TextRuns ?? [])].every(r => families(r.Typeface ?? layout.Typeface).some(f => this._fonts.has(f.toLowerCase())));
    }
    Create(layout) {
        if (!this.CanLayout(layout)) return null;
        return new NativeTextLayout(this, layout);
    }
    _Descriptor(layout) {
        const runs = [normalizeRun({ Start: 0, Length: layout.Text.length }, layout)];
        if (layout.TextRuns?.length) {
            // Fill uncovered source ranges with default style; reject overlapping runs.
            const sorted = layout.TextRuns.slice().sort((a, b) => a.Start - b.Start); let cursor = 0;
            runs.length = 0;
            for (const run of sorted) {
                if (!Number.isInteger(run.Start) || !Number.isInteger(run.Length) || run.Start < cursor || run.Length < 0 || run.Start + run.Length > layout.Text.length)
                    throw new RangeError('Text runs must be non-overlapping UTF-16 ranges within the text.');
                if (run.Start > cursor) runs.push(normalizeRun({ Start: cursor, Length: run.Start - cursor }, layout));
                runs.push(normalizeRun(run, layout)); cursor = run.Start + run.Length;
            }
            if (cursor < layout.Text.length) runs.push(normalizeRun({ Start: cursor, Length: layout.Text.length - cursor }, layout));
        }
        return {
            Text: layout.Text, Runs: runs, Default: normalizeRun({}, layout),
            Width: Number.isFinite(layout.MaxWidth) ? Math.max(0, layout.MaxWidth) : null,
            Height: Number.isFinite(layout.MaxHeight) ? Math.max(0, layout.MaxHeight) : null,
            Wrapping: layout.TextWrapping, Trimming: layout.TextTrimming, Alignment: layout.TextAlignment,
            Direction: layout.FlowDirection, MaxLines: layout.MaxLines, LineHeight: Number.isFinite(layout.LineHeight) ? layout.LineHeight : null
        };
    }
    _Style(run, lineHeight) {
        const style = {
            FontFamilies: run.Typeface.Family.split(',').map(x => { const name = x.trim().replace(/^['"]|['"]$/g, ''); return this._fonts.has(name.toLowerCase()) ? name.toLowerCase() : name; }),
            FontSize: run.FontSize,
            FontStyle: { Weight: run.Typeface.Weight, Width: run.Typeface.Stretch, Slant: run.Typeface.Style === 'Italic' ? 1 : run.Typeface.Style === 'Oblique' ? 2 : 0 },
            Color: this.Api.SKColor.Parse(run.Foreground), LetterSpacing: run.LetterSpacing,
            FontFeatures: run.FontFeatures, Locale: String(run.Locale)
        };
        if (run.Background) style.BackgroundColor = this.Api.SKColor.Parse(run.Background);
        if (lineHeight > 0) { style.HeightMultiplier = lineHeight / run.FontSize; style.HalfLeading = true; }
        const decorations = String(run.TextDecorations ?? '');
        style.Decoration = (decorations.includes('Underline') ? 1 : 0) | (decorations.includes('Overline') ? 2 : 0) | (decorations.includes('Strikethrough') ? 4 : 0);
        return style;
    }
    _GetEntry(descriptor) {
        if (this.IsDisposed) throw new Error('The text service has been disposed.');
        let cachedKey = this._descriptorKeys.get(descriptor);
        if (!cachedKey || cachedKey.Generation !== this._generation) {
            cachedKey = { Generation: this._generation, Key: this._generation + '|' + JSON.stringify(descriptor) };
            ++this.KeySerializations; this._descriptorKeys.set(descriptor, cachedKey);
        }
        const key = cachedKey.Key;
        let entry = this.Cache.Get(key);
        if (entry) return entry;
        ++this.ParagraphBuilds;
        const parts = [], lines = [];
        let top = 0, pendingParagraph = null;
        const wrapping = descriptor.Wrapping !== 'NoWrap', maxLines = descriptor.MaxLines > 0 ? descriptor.MaxLines : Infinity;
        let chunks = [{ Text: descriptor.Text, Start: 0, NewLineLength: 0 }];
        if (!wrapping) {
            chunks = (function* () {
                for (const m of descriptor.Text.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)) {
                    if (m.index === descriptor.Text.length && descriptor.Text.length && !/[\r\n]$/.test(descriptor.Text)) break;
                    yield { Text: m[1], Start: m.index, NewLineLength: m[2].length };
                }
            })();
        }
        try {
            for (const chunk of chunks) {
                if (lines.length >= maxLines || descriptor.Height !== null && top >= descriptor.Height && lines.length) break;
                const alignment = descriptor.Alignment === 'Start' ? descriptor.Direction === 'RightToLeft' ? 'Right' : 'Left'
                    : descriptor.Alignment === 'End' ? descriptor.Direction === 'RightToLeft' ? 'Left' : 'Right' : descriptor.Alignment;
                const finite = descriptor.Width !== null;
                const trim = descriptor.Trimming !== 'None' && finite;
                const constrained = wrapping || trim;
                const settings = {
                    TextStyle: this._Style(descriptor.Default, descriptor.LineHeight),
                    TextDirection: descriptor.Direction === 'RightToLeft' ? 'RTL' : 'LTR',
                    TextAlign: constrained ? alignment : 'Left',
                    MaxLines: !wrapping ? 1 : Number.isFinite(maxLines) ? maxLines : undefined
                };
                if (trim) settings.Ellipsis = '…';
                const builder = new this.Api.SKParagraphBuilder(settings, this._GetManager());
                let paragraph;
                try {
                    for (const run of descriptor.Runs) {
                        const start = Math.max(run.Start, chunk.Start), end = Math.min(run.Start + run.Length, chunk.Start + chunk.Text.length);
                        if (end <= start) continue;
                        builder.PushStyle(this._Style(run, descriptor.LineHeight));
                        if (run.Placeholder) {
                            const q = run.Placeholder;
                            const alignment = ['Top', 'Bottom', 'Middle'].includes(q.Alignment) ? q.Alignment : q.Alignment === 'Center' ? 'Middle' : 'Baseline';
                            builder.AddPlaceholder(q.Width, q.Height, this.Api.SKPlaceholderAlignment[alignment], this.Api.SKTextBaseline.Alphabetic, q.Height);
                        } else builder.AddText(descriptor.Text.slice(start, end)); builder.Pop();
                    }
                    // Empty paragraphs still have font-derived line metrics.
                    if (!chunk.Text) builder.AddText('');
                    paragraph = pendingParagraph = builder.Build(); paragraph.Layout(constrained && finite ? Math.max(.001, descriptor.Width) : 1e7);
                } finally { builder.Dispose(); }
                let metrics = paragraph.GetLineMetrics();
                if (wrapping && descriptor.Height !== null && metrics.length > 1) {
                    let fit = 0, sum = 0;
                    for (const m of metrics) { if (fit && sum + m.Height > descriptor.Height) break; sum += m.Height; ++fit; }
                    if (fit < metrics.length) {
                        // Rebuild with the actual native line-height budget, not an em approximation.
                        paragraph.Dispose(); pendingParagraph = null;
                        const limited = new this.Api.SKParagraphBuilder({ ...settings, MaxLines: Math.max(1, fit) }, this._GetManager());
                        try {
                            for (const run of descriptor.Runs) { limited.PushStyle(this._Style(run, descriptor.LineHeight)); if (run.Placeholder) limited.AddPlaceholder(run.Placeholder.Width, run.Placeholder.Height, this.Api.SKPlaceholderAlignment.Baseline, this.Api.SKTextBaseline.Alphabetic, run.Placeholder.Height); else limited.AddText(descriptor.Text.slice(run.Start, run.Start + run.Length)); limited.Pop(); }
                            paragraph = pendingParagraph = limited.Build(); paragraph.Layout(finite ? Math.max(.001, descriptor.Width) : 1e7);
                        } finally { limited.Dispose(); }
                        metrics = paragraph.GetLineMetrics();
                    }
                }
                const dx = !constrained && finite ? Math.max(0, descriptor.Width - paragraph.LongestLine) * (alignment === 'Right' ? 1 : alignment === 'Center' ? .5 : 0) : 0;
                const part = { Paragraph: paragraph, Start: chunk.Start, TextLength: chunk.Text.length, NewLineLength: chunk.NewLineLength, X: dx, Y: top, Height: paragraph.Height, Lines: [] };
                parts.push(part); pendingParagraph = null;
                const placeholders = paragraph.GetRectsForPlaceholders();
                part.Placeholders = descriptor.Runs.filter(r => r.Placeholder && r.Start >= chunk.Start && r.Start < chunk.Start + chunk.Text.length).map((r, i) => ({ Start: r.Start, Rect: placeholders[i]?.Rect }));
                let lineTop = top;
                if (!metrics.length) metrics = [{ StartIndex: 0, EndIndex: 0, EndIncludingNewline: 0, Width: 0, Left: 0, Baseline: descriptor.Default.FontSize, Height: descriptor.Default.FontSize * 1.4 }];
                for (const m of metrics) {
                    const start = chunk.Start + m.StartIndex, end = chunk.Start + m.EndIndex;
                    const contentEnd = descriptor.Text.slice(start, end).replace(/[\r\n]+$/g, '').length + start;
                    const line = {
                        Text: descriptor.Text.slice(start, contentEnd), Start: start, Length: contentEnd - start,
                        Width: m.Width, X: m.Left + dx, Y: lineTop, Height: m.Height,
                        Baseline: top + m.Baseline - lineTop, NewLineLength: wrapping ? m.EndIncludingNewline - (contentEnd - chunk.Start) : chunk.NewLineLength,
                        IsCollapsed: paragraph.DidExceedMaxLines, NativeMetrics: m
                    };
                    lines.push(line); part.Lines.push(line); lineTop += m.Height;
                }
                top += Math.max(paragraph.Height, part.Lines.reduce((sum, l) => sum + l.Height, 0));
                part.Height = top - part.Y;
            }
            entry = { Parts: parts, TextLines: lines, Height: top, Dispose() { for (const part of parts) part.Paragraph.Dispose(); } };
            return this.Cache.Set(key, entry, Math.max(512, descriptor.Text.length * 48 + parts.length * 256));
        } catch (error) { pendingParagraph?.Dispose(); for (const part of parts) part.Paragraph.Dispose(); throw error; }
    }
    Dispose() { if (this.IsDisposed) return; this.IsDisposed = true; this.Cache.Dispose(); this._manager?.Dispose(); this._fonts.clear(); }
}

class NativeTextLayout {
    constructor(service, layout) {
        this.Service = service; this.Descriptor = service._Descriptor(layout);
        const entry = service._GetEntry(this.Descriptor);
        this.TextLines = entry.TextLines; this.Height = entry.Height;
    }
    _Entry() { return this.Service._GetEntry(this.Descriptor); }
    Draw(context, origin = new Point()) {
        for (const part of this._Entry().Parts) part.Paragraph.Paint(context.Canvas, origin.X + part.X, origin.Y + part.Y);
    }
    _LowerBound(items, value, end, inclusive = false) {
        let lo = 0, hi = items.length;
        while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2), edge = end(items[mid]);
            if (edge < value || !inclusive && edge === value) lo = mid + 1; else hi = mid;
        }
        return lo;
    }
    _PartAt(position) {
        const parts = this._Entry().Parts;
        return parts[this._LowerBound(parts, position, p => p.Start + p.TextLength + p.NewLineLength)] ?? parts.at(-1);
    }
    HitTestPoint(point) {
        const entry = this._Entry(), part = entry.Parts[this._LowerBound(entry.Parts, point.Y, p => p.Y + p.Height)] ?? entry.Parts.at(-1);
        if (!part) return { TextPosition: 0, IsInside: false, IsTrailing: false };
        const hit = part.Paragraph.GetGlyphPositionAtCoordinate(point.X - part.X, point.Y - part.Y);
        const position = part.Start + SnapTextPosition(this.Descriptor.Text.slice(part.Start, part.Start + part.TextLength), hit.Pos);
        const line = part.Lines[this._LowerBound(part.Lines, point.Y, l => l.Y + l.Height)] ?? part.Lines.at(-1);
        return { TextPosition: position, IsInside: point.Y >= 0 && point.Y < entry.Height && point.X >= line.X && point.X <= line.X + line.Width, IsTrailing: enumValue(hit.Affinity) === 0 };
    }
    HitTestTextPosition(position) {
        position = Math.max(0, Math.min(this.Descriptor.Text.length, Number.isFinite(position) ? Math.trunc(position) : 0));
        const part = this._PartAt(position);
        if (!part) return Rect.Empty;
        const local = SnapTextPosition(this.Descriptor.Text.slice(part.Start, part.Start + part.TextLength), position - part.Start);
        position = part.Start + local;
        const info = local < part.TextLength ? part.Paragraph.GetGlyphInfoAt(local) : local ? part.Paragraph.GetGlyphInfoAt(local - 1) : null;
        const line = part.Lines[this._LowerBound(part.Lines, position, l => l.Start + l.Length + (l.NewLineLength ?? 0), true)] ?? part.Lines.at(-1);
        if (!info) return new Rect(line.X, line.Y, 1, line.Height);
        const bounds = info.GraphemeLayoutBounds, rtl = enumValue(info.Dir) === enumValue(this.Service.Api.SKTextDirection.RTL);
        const trailing = local >= info.GraphemeClusterTextRange.end;
        const x = bounds[rtl !== trailing ? 2 : 0] + part.X;
        return new Rect(x, line.Y, 1, line.Height);
    }
    GetInlineBounds(position) {
        for (const part of this._Entry().Parts) {
            const found = part.Placeholders.find(p => p.Start === position)?.Rect;
            if (found) return new Rect(found.Left + part.X, found.Top + part.Y, found.Width, found.Height);
        }
        return Rect.Empty;
    }
    HitTestTextRange(start, length) {
        const text = this.Descriptor.Text, end = SnapTextPosition(text, start + Math.max(0, length), 'Forward');
        start = SnapTextPosition(text, start, 'Backward');
        const result = [];
        for (const part of this._Entry().Parts) {
            const a = Math.max(0, start - part.Start), b = Math.min(part.TextLength, end - part.Start);
            if (b <= a) continue;
            for (const { Rect: r } of part.Paragraph.GetRectsForRange(a, b)) result.push(new Rect(part.X + r.Left, part.Y + r.Top, r.Width, r.Height));
        }
        return result;
    }
}
