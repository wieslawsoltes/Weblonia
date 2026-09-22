import { Size, Point, Rect, FlowDirection, Event, Disposable } from "../../base/src/index.js";
import { Typeface, Brushes, BrushColor } from './brushes.js';
import { GraphemeSegments, GraphemeBoundaries, SnapTextPosition, TruncateText } from './unicode.js';
let layoutProvider = null;
const layoutProviders = [], metricsProviders = [];
let serviceVersion = 0, layoutCount = 0, prefixMeasurements = 0, lineSearchComparisons = 0;
export const TextServicesChanged = new Event();
export function GetTextServiceVersion() { return serviceVersion; }
export function GetTextLayoutStatistics() { return { Created: layoutCount, PrefixMeasurements: prefixMeasurements, LineSearchComparisons: lineSearchComparisons }; }
export function InvalidateTextServices() { ++serviceVersion; TextServicesChanged.Raise(null, { Version: serviceVersion }); }
function registerProvider(list, provider, apply) {
    if (!provider || typeof provider !== 'object') throw new TypeError('A text provider is required.');
    const entry = { Provider: provider }; list.push(entry); apply(provider); InvalidateTextServices();
    return Disposable.Create(() => {
        const index = list.indexOf(entry); if (index < 0) return;
        const wasCurrent = index === list.length - 1; list.splice(index, 1);
        if (wasCurrent) { apply(list.at(-1)?.Provider ?? null); InvalidateTextServices(); }
    });
}
export function RegisterTextLayoutProvider(provider) { return registerProvider(layoutProviders, provider, value => { layoutProvider = value; }); }
const fallbackMetrics = {
    Measure(text, typeface, size) {
        return { Width: [...String(text)].reduce((s, c) => s + (/[il.,'! ]/.test(c) ? .3 : /[MW]/.test(c) ? .85 : .56) * size, 0), Ascent: size * .8, Descent: size * .2 };
    },
};
let metrics = fallbackMetrics;
export function RegisterTextMetricsProvider(provider) {
    return registerProvider(metricsProviders, provider, value => { metrics = value ?? fallbackMetrics; });
}
export function MeasureText(text, typeface = new Typeface(), size = 14, options = {}) {
    text = String(text);
    const result = metrics.Measure(text, typeface, size, options);
    if (metrics.SupportsSpacing || !(options.LetterSpacing || options.WordSpacing)) return result;
    return { ...result, Width: result.Width + (options.LetterSpacing ?? 0) * GraphemeSegments(text).length + (options.WordSpacing ?? 0) * (text.match(/ /g)?.length ?? 0) };
}
export class TextLayout {
    constructor(text = '', typeface = new Typeface(), fontSize = 14, foreground = Brushes.Black, options = {}) {
        Object.assign(this, { Text: String(text ?? ''), Typeface: typeface, FontSize: fontSize, Foreground: foreground, MaxWidth: Infinity, MaxHeight: Infinity, TextWrapping: 'NoWrap', TextAlignment: 'Left', TextTrimming: 'None', FlowDirection: 'LeftToRight', LineHeight: NaN, MaxLines: 0 }, options);
        if (!(Number.isFinite(this.FontSize) && this.FontSize > 0)) throw new RangeError('FontSize must be positive and finite.');
        ++layoutCount;
        this._prefixCache = new WeakMap();
        this._nativeLayout = layoutProvider?.Create?.(this) ?? null;
        this.TextLines = this._nativeLayout?.TextLines ?? this._format();
        // Do not spread document-sized arrays into function arguments (engine limit).
        this.Width = 0; this._inkAbove = this._inkBelow = 0;
        for (const line of this.TextLines) {
            this.Width = Math.max(this.Width, line.Width);
            this._inkAbove = Math.max(this._inkAbove, -(line.InkTop ?? 0));
            this._inkBelow = Math.max(this._inkBelow, (line.InkBottom ?? line.Height) - line.Height);
        }
        this.WidthIncludingTrailingWhitespace = this.Width;
        this.Height = this._nativeLayout?.Height ?? this.TextLines.reduce((h, l) => Math.max(h, l.Y + l.Height), 0);
        this.Size = new Size(this.Width, this.Height);
    }
    _lineHeight() {
        return Number.isFinite(this.LineHeight) && this.LineHeight > 0 ? this.LineHeight : this.FontSize * 1.4;
    }
    _measure(s, start = 0) {
        if (!this.TextRuns?.length) return MeasureText(s, this.Typeface, this.FontSize, this).Width;
        const end = start + s.length; let cursor = start, width = 0;
        for (const run of this.TextRuns) {
            const a = Math.max(cursor, run.Start), b = Math.min(end, run.Start + run.Length);
            if (b <= a) continue;
            if (a > cursor) width += MeasureText(s.slice(cursor - start, a - start), this.Typeface, this.FontSize, this).Width;
            width += run.InlineSize?.Width ?? MeasureText(s.slice(a - start, b - start), run.Typeface ?? this.Typeface, run.FontSize ?? this.FontSize, { ...this, ...run }).Width;
            cursor = b;
        }
        if (cursor < end) width += MeasureText(s.slice(cursor - start), this.Typeface, this.FontSize, this).Width;
        return width;
    }
    _format() {
        const lines = [];
        const wrap = this.TextWrapping !== 'NoWrap' && Number.isFinite(this.MaxWidth);
        let globalIndex = 0;
        const heightLimit = Number.isFinite(this.MaxHeight) ? Math.max(1, Math.floor(this.MaxHeight / this._lineHeight())) : Infinity;
        const limit = Math.min(this.MaxLines > 0 ? this.MaxLines : Infinity, heightLimit);
        // One extra line is sufficient to detect ellipsis without shaping the
        // remainder of a large document whose consumer requested MaxLines.
        const paragraphs = this.Text.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g);
        for (const match of paragraphs) {
            if (match.index === this.Text.length && this.Text.length && !/[\r\n]$/.test(this.Text)) break;
            const paragraph = match[1], newlineLength = match[2].length;
            globalIndex = match.index;
            if (!wrap || !paragraph.length) {
                lines.push({ Text: paragraph, Start: globalIndex, Length: paragraph.length, Width: this._measure(paragraph, globalIndex) });
            }
            else {
                for (const line of this._wrapParagraph(paragraph, globalIndex, limit + 1 - lines.length)) lines.push(line);
            }
            if (lines.length) lines.at(-1).NewLineLength = newlineLength;
            if (lines.length > limit) break;
        }
        const trimmed = lines.slice(0, limit);
        for (let i = 0; i < trimmed.length; i++) {
            const line = trimmed[i];
            if (this.TextTrimming !== 'None' && (line.Width > this.MaxWidth || i === trimmed.length - 1 && trimmed.length < lines.length)) {
                const boundaries = GraphemeBoundaries(line.Text);
                let lo = 0, hi = boundaries.length - 1;
                while (lo < hi) {
                    const mid = Math.ceil((lo + hi) / 2);
                    if (this._measure(line.Text.slice(0, boundaries[mid]) + '…', line.Start) <= this.MaxWidth) lo = mid;
                    else hi = mid - 1;
                }
                let s = line.Text.slice(0, boundaries[lo]);
                if (this.TextTrimming === 'WordEllipsis' && s.length < line.Text.length) {
                    const wordBreak = s.search(/\s+\S*$/u); if (wordBreak > 0) s = s.slice(0, wordBreak);
                }
                line.Text = s + '…';
                line.Width = this._measure(line.Text, line.Start);
                line.IsCollapsed = true;
            }
            const align = this.TextAlignment === 'Start' ? this.FlowDirection === 'RightToLeft' ? 'Right' : 'Left' : this.TextAlignment === 'End' ? this.FlowDirection === 'RightToLeft' ? 'Left' : 'Right' : this.TextAlignment;
            line.X = Number.isFinite(this.MaxWidth) ? Math.max(0, this.MaxWidth - line.Width) * (align === 'Center' ? .5 : align === 'Right' ? 1 : 0) : 0;
            const maximumSize = Math.max(this.FontSize, ...(this.TextRuns ?? []).filter(r => r.Start < line.Start + line.Length && r.Start + r.Length > line.Start).map(r => r.FontSize ?? this.FontSize));
            line.Y = i ? trimmed[i - 1].Y + trimmed[i - 1].Height : 0;
            line.Height = Number.isFinite(this.LineHeight) && this.LineHeight > 0 ? this.LineHeight : Math.max(maximumSize * 1.4, ...(this.TextRuns ?? []).filter(r => r.Start >= line.Start && r.Start < line.Start + line.Length).map(r => r.InlineSize?.Height ?? 0));
            line.Baseline = maximumSize * 1.05;
            if (!this.TextRuns?.length) {
                // Font metrics define a stable baseline, ink metrics only bound this
                // specific line. Combining marks must not move adjacent baselines.
                const ink = MeasureText(line.Text, this.Typeface, this.FontSize, this);
                if (Number.isFinite(ink.FontAscent) && Number.isFinite(ink.FontDescent))
                    line.Baseline = (line.Height - ink.FontAscent - ink.FontDescent) / 2 + ink.FontAscent;
                line.InkTop = line.Baseline - (Number.isFinite(ink.Ascent) ? ink.Ascent : maximumSize * .8);
                line.InkBottom = line.Baseline + (Number.isFinite(ink.Descent) ? ink.Descent : maximumSize * .2);
            }
        }
        return trimmed;
    }
    _wrapParagraph(paragraph, globalIndex, maxLines = Infinity) {
        const boundaries = GraphemeBoundaries(paragraph), segments = GraphemeSegments(paragraph);
        const breaks = new Uint32Array(boundaries.length);
        for (let i = 1; i < boundaries.length; ++i) breaks[i] = /[\s-]/u.test(segments[i - 1].Text) ? i : breaks[i - 1];
        const result = [], last = boundaries.length - 1;
        const nonMonotonic = (this.LetterSpacing ?? 0) < 0 || this.TextRuns?.some(r => (r.LetterSpacing ?? 0) < 0);
        let start = 0;
        while (start < last && result.length < maxLines) {
            const measurements = new Map([[start, 0]]);
            const widthAt = end => {
                if (!measurements.has(end)) measurements.set(end, this._measure(paragraph.slice(boundaries[start], boundaries[end]), globalIndex + boundaries[start]));
                return measurements.get(end);
            };
            let lo = start, hi = start + 1;
            if (nonMonotonic) {
                while (hi <= last && widthAt(hi) <= this.MaxWidth) { lo = hi; ++hi; }
            } else {
                // Exponential bracketing avoids scanning every glyph in wide paragraphs.
                while (hi < last && widthAt(hi) <= this.MaxWidth) { lo = hi; hi = Math.min(last, start + 2 * (hi - start)); }
                if (widthAt(hi) <= this.MaxWidth) lo = hi;
                else while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (widthAt(mid) <= this.MaxWidth) lo = mid; else hi = mid; }
            }
            let end = Math.max(start + 1, lo);
            if (end < last && breaks[end] > start) end = breaks[end];
            else if (end < last && this.TextWrapping === 'WrapWithOverflow') {
                while (end < last && breaks[end] <= start) ++end;
            }
            const text = paragraph.slice(boundaries[start], boundaries[end]);
            result.push({ Text: text, Start: globalIndex + boundaries[start], Length: text.length, Width: widthAt(end) });
            start = end;
        }
        return result;
    }
    Draw(context, origin = new Point()) {
        context.DrawTextLayout(this, origin);
    }
    _prefixWidth(line, position) {
        let cache = this._prefixCache.get(line);
        if (!cache) { cache = new Map([[0, 0]]); this._prefixCache.set(line, cache); }
        if (cache.has(position)) return cache.get(position);
        ++prefixMeasurements;
        const width = this._measure(line.Text.slice(0, position), line.Start);
        cache.set(position, width);
        return width;
    }
    _LowerBoundLine(value, field) {
        let lo = 0, hi = this.TextLines.length;
        while (lo < hi) {
            ++lineSearchComparisons;
            const mid = Math.floor((lo + hi) / 2), line = this.TextLines[mid];
            const end = field === 'position' ? line.Start + line.Length : line.Y + line.Height;
            if (end < value || field !== 'position' && end === value) lo = mid + 1; else hi = mid;
        }
        return lo;
    }
    /** Conservative ink-aware [Start, End) range for a local vertical viewport.
     * Antialias padding is supplied in logical pixels by the renderer. */
    GetVisibleLineRange(top, bottom, padding = 0) {
        if (!(bottom > top)) return { Start: 0, End: 0 };
        const start = this._LowerBoundLine(top - this._inkBelow - padding, 'y');
        let lo = start, hi = this.TextLines.length;
        const edge = bottom + this._inkAbove + padding;
        while (lo < hi) {
            ++lineSearchComparisons;
            const mid = Math.floor((lo + hi) / 2);
            if (this.TextLines[mid].Y < edge) lo = mid + 1; else hi = mid;
        }
        return { Start: start, End: lo };
    }
    HitTestPoint(point) {
        if (this._nativeLayout) return this._nativeLayout.HitTestPoint(point);
        const line = this.TextLines[this._LowerBoundLine(point.Y, 'y')] ?? this.TextLines.at(-1);
        if (!line)
            return { TextPosition: 0, IsInside: false };
        const stops = GraphemeBoundaries(line.Text);
        const x = point.X - line.X;
        let best = 0;
        // Native paragraphs own bidi caret geometry. This fallback retains the existing
        // logical-prefix model; non-positive spacing can make advances non-monotonic.
        if ((this.LetterSpacing ?? 0) < 0 || this.TextRuns?.some(r => (r.LetterSpacing ?? 0) < 0)) {
            let distance = Infinity;
            for (const i of stops) { const d = Math.abs(this._prefixWidth(line, i) - x); if (d < distance) { distance = d; best = i; } }
        } else {
            let lo = 0, hi = stops.length - 1;
            while (lo < hi) { const mid = (lo + hi) >>> 1; if (this._prefixWidth(line, stops[mid]) < x) lo = mid + 1; else hi = mid; }
            const right = stops[lo], left = stops[Math.max(0, lo - 1)];
            best = Math.abs(this._prefixWidth(line, left) - x) <= Math.abs(this._prefixWidth(line, right) - x) ? left : right;
        }
        return { TextPosition: Math.min(this.Text.length, line.Start + best), IsInside: point.X >= line.X && point.X <= line.X + line.Width && point.Y >= 0 && point.Y < this.Height, IsTrailing: best === line.Text.length };
    }
    HitTestTextPosition(position) {
        if (this._nativeLayout) return this._nativeLayout.HitTestTextPosition(position);
        position = Math.max(0, Math.min(this.Text.length, Number.isFinite(position) ? Math.trunc(position) : 0));
        let index = Math.min(this.TextLines.length - 1, this._LowerBoundLine(position, 'position'));
        let line = this.TextLines[index];
        // A CRLF is one grapheme, but it lives between line text spans. Preserve
        // nearest/backward tie affinity without segmenting the entire document.
        if (index > 0 && position < line.Start) {
            const previous = this.TextLines[index - 1], end = previous.Start + previous.Length;
            if (position - end <= line.Start - position) line = previous;
        }
        if (!line) return Rect.Empty;
        const local = SnapTextPosition(this.Text.slice(line.Start, line.Start + line.Length), position - line.Start);
        return new Rect(line.X + this._prefixWidth(line, Math.min(line.Text.length, local)), line.Y, 1, line.Height);
    }
    HitTestTextRange(start, length) {
        if (this._nativeLayout) return this._nativeLayout.HitTestTextRange(start, length);
        const end = start + length, result = [];
        for (let i = this._LowerBoundLine(start, 'position'); i < this.TextLines.length; ++i) {
            const line = this.TextLines[i];
            if (line.Start >= end) break;
            const a = Math.max(start, line.Start), b = Math.min(end, line.Start + line.Length);
            if (b <= a)
                continue;
            const x = this._prefixWidth(line, a - line.Start), right = this._prefixWidth(line, b - line.Start);
            result.push(new Rect(line.X + x, line.Y, right - x, line.Height));
        }
        return result;
    }
    GetInlineBounds(position) {
        if (this._nativeLayout) return this._nativeLayout.GetInlineBounds(position);
        const run = this.TextRuns?.find(r => r.Start === position && r.InlineSize);
        if (!run) return Rect.Empty;
        const caret = this.HitTestTextPosition(position);
        return new Rect(caret.X, caret.Y + Math.max(0, caret.Height - run.InlineSize.Height), run.InlineSize.Width, run.InlineSize.Height);
    }
    Dispose() {
        if (this.IsDisposed) return;
        this.IsDisposed = true;
        this._nativeLayout?.Dispose?.();
        this._nativeLayout = null;
        this._prefixCache = new WeakMap();
    }
}
export class FormattedText {
    constructor(text = '', culture = undefined, flowDirection = FlowDirection.LeftToRight, typeface = new Typeface(), fontSize = 14, foreground = Brushes.Black) {
        Object.assign(this, { Text: String(text), Culture: culture, FlowDirection: flowDirection, Typeface: typeface, FontSize: fontSize, Foreground: foreground, MaxTextWidth: Infinity, MaxTextHeight: Infinity, TextAlignment: 'Left', Trimming: 'None', MaxLineCount: 0 });
    }
    /** Borrowed layout, owned by this FormattedText. Dispose the owner, not this value. */
    get TextLayout() {
        if (this.IsDisposed) throw new Error('FormattedText has been disposed.');
        const color = BrushColor(this.Foreground), t = this.Typeface;
        const key = [GetTextServiceVersion(), this.Text, String(t.FontFamily), t.Style, t.Weight, t.Stretch,
            this.FontSize, this.Foreground, color.A, color.R, color.G, color.B, this.Foreground?.Opacity ?? 1,
            this.MaxTextWidth, this.MaxTextHeight, this.FlowDirection, this.TextAlignment, this.Trimming, this.MaxLineCount, this.Culture];
        if (!this._layout || this._layout.IsDisposed || !key.every((v, i) => Object.is(v, this._layoutKey[i]))) {
            const next = new TextLayout(this.Text, this.Typeface, this.FontSize, this.Foreground, { Culture: this.Culture, MaxWidth: this.MaxTextWidth, MaxHeight: this.MaxTextHeight, FlowDirection: this.FlowDirection, TextAlignment: this.TextAlignment, TextTrimming: this.Trimming, MaxLines: this.MaxLineCount, TextWrapping: Number.isFinite(this.MaxTextWidth) ? 'Wrap' : 'NoWrap' });
            this._layout?.Dispose(); this._layout = next; this._layoutKey = key;
        }
        return this._layout;
    }
    Dispose() { if (this.IsDisposed) return; this.IsDisposed = true; this._layout?.Dispose(); this._layout = null; this._layoutKey = null; }
    get Width() {
        return this.TextLayout.Width;
    }
    get Height() {
        return this.TextLayout.Height;
    }
    SetForegroundBrush(brush) {
        this.Foreground = brush;
    }
    SetFontSize(size) {
        this.FontSize = size;
    }
}
