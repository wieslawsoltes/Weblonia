import { Disposable, Point, Rect } from '@wieslawsoltes/avalonia-base';
import { Typeface, Brushes } from './brushes.js';
import { TextLayout } from './text.js';
import { GraphemeBoundaries, NextTextPosition, PreviousTextPosition, SnapTextPosition } from './unicode.js';

export class CharacterHit {
    constructor(firstCharacterIndex = 0, trailingLength = 0) {
        if (!Number.isInteger(firstCharacterIndex) || firstCharacterIndex < 0 || !Number.isInteger(trailingLength) || trailingLength < 0) throw new RangeError('CharacterHit requires non-negative UTF-16 indices.');
        this.FirstCharacterIndex = firstCharacterIndex; this.TrailingLength = trailingLength;
    }
    Equals(other) { return other instanceof CharacterHit && this.FirstCharacterIndex === other.FirstCharacterIndex && this.TrailingLength === other.TrailingLength; }
}
export class TextRunProperties {}
export class GenericTextRunProperties extends TextRunProperties {
    constructor(typeface = new Typeface(), fontRenderingEmSize = 12, textDecorations = null, foregroundBrush = null, backgroundBrush = null, baselineAlignment = 'Baseline', cultureInfo = null, fontFeatures = null) {
        super();
        if (!(typeface instanceof Typeface) || !Number.isFinite(fontRenderingEmSize) || fontRenderingEmSize <= 0) throw new TypeError('A Typeface and positive font size are required.');
        Object.assign(this, { Typeface: typeface, FontRenderingEmSize: fontRenderingEmSize, TextDecorations: textDecorations, ForegroundBrush: foregroundBrush, BackgroundBrush: backgroundBrush, BaselineAlignment: baselineAlignment, CultureInfo: cultureInfo, FontFeatures: fontFeatures });
    }
}
export class TextParagraphProperties {}
export class GenericTextParagraphProperties extends TextParagraphProperties {
    constructor(...args) {
        super();
        Object.assign(this, { FlowDirection: 'LeftToRight', TextAlignment: 'Left', TextWrapping: 'NoWrap', LineHeight: 0, FirstLineInParagraph: true, AlwaysCollapsible: false, Indent: 0, LetterSpacing: 0 });
        if (args[0] instanceof TextParagraphProperties) Object.assign(this, args[0]);
        else if (args[0] instanceof TextRunProperties || !args.length) {
            [this.DefaultTextRunProperties = new GenericTextRunProperties(), this.TextAlignment = 'Left', this.TextWrapping = 'NoWrap', this.LineHeight = 0, this.LetterSpacing = 0] = args;
        } else if (args.length >= 5) {
            [this.FlowDirection, this.TextAlignment, this.FirstLineInParagraph, this.AlwaysCollapsible, this.DefaultTextRunProperties, this.TextWrapping = 'NoWrap', this.LineHeight = 0, this.Indent = 0, this.LetterSpacing = 0] = args;
        } else throw new TypeError('Use TextRunProperties or the explicit paragraph-property constructor.');
        if (!(this.DefaultTextRunProperties instanceof TextRunProperties)) throw new TypeError('DefaultTextRunProperties is required.');
    }
}
export class TextRun {
    constructor(length = 0, properties = null) { this.Length = length; this.Properties = properties; }
}
export class TextCharacters extends TextRun {
    constructor(text, properties = new GenericTextRunProperties()) { const value = String(text); super(value.length, properties); this.Text = value; }
}
export class TextEndOfLine extends TextRun {
    constructor(textSourceLength = 1) { if (!Number.isInteger(textSourceLength) || textSourceLength < 0) throw new RangeError('Invalid text source length.'); super(textSourceLength); }
}
export class TextEndOfParagraph extends TextEndOfLine {}
export class TextSource { GetTextRun() { throw new Error('Override GetTextRun(textSourceIndex).'); } }
/** Convenience source for the JavaScript runtime; arbitrary sources may return styled runs. */
export class StringTextSource extends TextSource {
    constructor(text, properties = new GenericTextRunProperties()) { super(); this.Text = String(text); this.Properties = properties; }
    GetTextRun(index) { return index < this.Text.length ? new TextCharacters(this.Text.slice(index), this.Properties) : new TextEndOfParagraph(0); }
}
export class TextRunCache {
    constructor() { this.Revision = 0; this._sources = new WeakMap(); }
    GetTextRun(source, index) {
        let entries = this._sources.get(source); if (!entries) this._sources.set(source, entries = new Map());
        if (!entries.has(index)) entries.set(index, source.GetTextRun(index));
        return entries.get(index);
    }
    Invalidate(source = null, start = 0) {
        ++this.Revision;
        if (!source) this._sources = new WeakMap();
        else { const entries = this._sources.get(source); for (const [index, run] of entries ?? []) if (index + (run?.Length ?? 0) >= start) entries.delete(index); }
    }
    Clear() { this.Invalidate(); }
}
export class TextLineBreak extends Disposable {
    constructor(endOfLine = null, remainingRuns = [], flowDirection = 'LeftToRight') { super(); this.EndOfLine = endOfLine; this.RemainingRuns = remainingRuns; this.FlowDirection = flowDirection; }
}
export class TextRunBounds {
    constructor(rectangle, textSourceCharacterIndex, length, textRun = null) { this.Rectangle = rectangle; this.TextSourceCharacterIndex = textSourceCharacterIndex; this.Length = length; this.TextRun = textRun; }
}
export class TextBounds {
    constructor(rectangle, flowDirection, textRunBounds = []) { this.Rectangle = rectangle; this.FlowDirection = flowDirection; this.TextRunBounds = textRunBounds; }
}
export class TextCollapsingProperties { constructor(width, symbol, flowDirection = 'LeftToRight') { this.Width = width; this.Symbol = symbol; this.FlowDirection = flowDirection; } }
export class TextTrailingCharacterEllipsis extends TextCollapsingProperties { constructor(width, properties = new GenericTextRunProperties(), flowDirection = 'LeftToRight') { super(width, new TextCharacters('…', properties), flowDirection); } }
export class TextTrailingWordEllipsis extends TextTrailingCharacterEllipsis {}
export class JustificationProperties { constructor(width) { this.Width = width; } }
export class InterWordJustification extends JustificationProperties {}
const runStyle = (run, start, letterSpacing = 0) => ({ Start: start, Length: run.Length, Typeface: run.Properties.Typeface, FontSize: run.Properties.FontRenderingEmSize,
    Foreground: run.Properties.ForegroundBrush ?? Brushes.Black, Background: run.Properties.BackgroundBrush, TextDecorations: run.Properties.TextDecorations,
    FontFeatures: run.Properties.FontFeatures, Locale: run.Properties.CultureInfo, BaselineAlignment: run.Properties.BaselineAlignment, LetterSpacing: letterSpacing });
const signature = p => [p.FlowDirection, p.TextAlignment, p.TextWrapping, p.LineHeight, p.Indent, p.FirstLineInParagraph, p.LetterSpacing,
    p.DefaultTextRunProperties.FontRenderingEmSize, String(p.DefaultTextRunProperties.Typeface.FontFamily), p.DefaultTextRunProperties.Typeface.Weight, p.DefaultTextRunProperties.Typeface.Style].join('|');
const sliceRuns = (runs, start, length) => runs.flatMap(run => { const a = Math.max(start, run.Start), b = Math.min(start + length, run.Start + run.Length); return b > a ? [{ ...run, Start: a - start, Length: b - a }] : []; });

/** A line view retains a paragraph descriptor, never a dangling native paragraph handle. */
export class TextLine extends Disposable {
    constructor(paragraph, index) { super(); this._paragraph = paragraph; this._index = index; this._AssignMetrics(); }
    _Verify() { if (this.IsDisposed) throw new Error('TextLine has been disposed.'); }
    _AssignMetrics() {
        const p = this._paragraph, line = p.Layout.TextLines[this._index]; this._line = line;
        this.Text = line.Text; this.FirstTextSourceIndex = p.Start + line.Start; this.NewLineLength = this._index === p.Layout.TextLines.length - 1 ? p.NewLineLength : 0;
        this.Length = line.Length + this.NewLineLength; this.Start = line.X + p.Indent; this.Baseline = line.Baseline; this.Height = line.Height; this.Extent = line.Height;
        this.HasCollapsed = !!line.IsCollapsed; this.HasOverflowed = line.Width > p.Width; this.OverhangAfter = this.OverhangLeading = this.OverhangTrailing = 0;
        this.TrailingWhitespaceLength = line.Text.length - line.Text.trimEnd().length;
        this.Width = line.NativeMetrics ? line.Width : this.TrailingWhitespaceLength ? p.Layout._measure(line.Text.trimEnd(), line.Start) : line.Width;
        const rectangles = p.Layout._nativeLayout ? p.Layout.HitTestTextRange(line.Start, line.Length) : [];
        this.WidthIncludingTrailingWhitespace = rectangles.length ? Math.max(this.Width, Math.max(...rectangles.map(r => r.Right)) - Math.min(...rectangles.map(r => r.Left))) : p.Layout._measure(line.Text, line.Start);
        this._styleRuns = sliceRuns(p.Runs, line.Start, line.Length);
        this.TextRuns = this._styleRuns.map(r => new TextCharacters(line.Text.slice(r.Start, r.Start + r.Length), new GenericTextRunProperties(r.Typeface, r.FontSize, r.TextDecorations, r.Foreground, r.Background, r.BaselineAlignment, r.Locale, r.FontFeatures)));
        const next = new TextLineBreak(this._index === p.Layout.TextLines.length - 1 ? p.EndOfLine : null, this.TextRuns, p.Properties.FlowDirection);
        next._paragraph = p; next._nextLine = this._index + 1; next.NextTextSourceIndex = this.FirstTextSourceIndex + this.Length;
        next.HasRemaining = next._nextLine < p.Layout.TextLines.length; this.TextLineBreak = next;
    }
    Draw(context, lineOrigin = new Point()) {
        this._Verify(); const p = this._paragraph, clip = context.PushClip(new Rect(lineOrigin.X, lineOrigin.Y, Math.max(this.Start + this.WidthIncludingTrailingWhitespace + 4, Number.isFinite(p.Width) ? p.Width : 0), this.Height));
        try { p.Layout.Draw(context, new Point(lineOrigin.X + p.Indent, lineOrigin.Y - this._line.Y)); } finally { clip.Dispose(); }
    }
    GetCharacterHitFromDistance(distance) {
        this._Verify(); const hit = this._paragraph.Layout.HitTestPoint(new Point(distance - this._paragraph.Indent, this._line.Y + this.Height / 2));
        const position = Math.max(this.FirstTextSourceIndex, Math.min(this.FirstTextSourceIndex + this._line.Length, this._paragraph.Start + hit.TextPosition));
        if (hit.IsTrailing && position > this.FirstTextSourceIndex) { const prior = PreviousTextPosition(this.Text, position - this.FirstTextSourceIndex) + this.FirstTextSourceIndex; return new CharacterHit(prior, position - prior); }
        return new CharacterHit(position);
    }
    GetDistanceFromCharacterHit(hit) { this._Verify(); return this._paragraph.Layout.HitTestTextPosition(hit.FirstCharacterIndex + hit.TrailingLength - this._paragraph.Start).X + this._paragraph.Indent; }
    GetNextCaretCharacterHit(hit) { this._Verify(); return new CharacterHit(this.FirstTextSourceIndex + NextTextPosition(this.Text, hit.FirstCharacterIndex + hit.TrailingLength - this.FirstTextSourceIndex)); }
    GetPreviousCaretCharacterHit(hit) { this._Verify(); return new CharacterHit(this.FirstTextSourceIndex + PreviousTextPosition(this.Text, hit.FirstCharacterIndex + hit.TrailingLength - this.FirstTextSourceIndex)); }
    GetBackspaceCaretCharacterHit(hit) { return this.GetPreviousCaretCharacterHit(hit); }
    GetTextBounds(start, length) {
        this._Verify(); const p = this._paragraph, first = Math.max(start, this.FirstTextSourceIndex), end = Math.min(start + length, this.FirstTextSourceIndex + this._line.Length);
        if (end <= first) return [];
        return p.Layout.HitTestTextRange(first - p.Start, end - first).filter(r => r.Y < this._line.Y + this.Height && r.Bottom > this._line.Y).map(r => {
            const rect = r.Translate(new Point(p.Indent, -this._line.Y)); return new TextBounds(rect, p.Properties.FlowDirection, [new TextRunBounds(rect, first, end - first)]);
        });
    }
    Collapse(...properties) {
        this._Verify(); const option = properties.flat().find(p => p != null); if (!option || this.Width <= option.Width && !this._paragraph.Properties.AlwaysCollapsible) return this;
        if (option.Symbol?.Text !== '…') throw new TypeError('This renderer currently supports ellipsis collapse symbols.');
        let text = this.Text, runs = this._styleRuns;
        if (option instanceof TextTrailingWordEllipsis) {
            const words = [...text.matchAll(/\s+/g)];
            while (words.length && new TextLayout(text + '…', this._paragraph.Layout.Typeface, this._paragraph.Layout.FontSize).Width > option.Width) { text = text.slice(0, words.pop().index); }
            runs = sliceRuns(runs, 0, text.length);
        }
        const paragraph = this._Rebuild(text, runs, { MaxWidth: option.Width, TextTrimming: 'CharacterEllipsis' });
        const result = new TextLine(paragraph, 0); result.Length = this.Length; result.NewLineLength = this.NewLineLength; result.HasCollapsed = true; return result;
    }
    _Rebuild(text, runs, options = {}) {
        const p = this._paragraph, rp = p.Properties.DefaultTextRunProperties;
        const layout = new TextLayout(text, rp.Typeface, rp.FontRenderingEmSize, rp.ForegroundBrush ?? Brushes.Black, { TextRuns: runs, MaxWidth: p.Width, TextWrapping: 'NoWrap', FlowDirection: p.Properties.FlowDirection, TextAlignment: p.Properties.TextAlignment, ...options });
        return { ...p, Start: this.FirstTextSourceIndex, Text: text, Runs: runs, Layout: layout, Indent: 0 };
    }
    Justify(properties) {
        this._Verify(); if (!(properties instanceof InterWordJustification)) throw new TypeError('InterWordJustification is required.');
        const count = [...this.Text.trimEnd().matchAll(/\s/g)].length, extra = properties.Width - this.Width;
        if (!count || extra <= 0) return;
        const runs = this._styleRuns.flatMap(run => [...this.Text.slice(run.Start, run.Start + run.Length).matchAll(/\s+|\S+/g)].map(m => ({ ...run, Start: run.Start + m.index, Length: m[0].length, LetterSpacing: (run.LetterSpacing ?? 0) + (/^\s/.test(m[0]) ? extra / count : 0) })));
        this._paragraph = this._Rebuild(this.Text, runs, { MaxWidth: properties.Width }); this._index = 0; this._AssignMetrics();
    }
    Dispose() { if (this.IsDisposed) return; super.Dispose(); }
}

export class TextFormatter {
    static Current = new TextFormatter();
    constructor(options = {}) { this.MaxParagraphCharacters = options.MaxParagraphCharacters ?? 1024 * 1024; }
    FormatLine(source, firstTextSourceIndex, paragraphWidth, paragraphProperties, previousLineBreak = null, textRunCache = null) {
        // Retain the first release's small string overload while exposing the source-based contract.
        if (typeof source === 'string') {
            const text = source, typeface = firstTextSourceIndex ?? new Typeface(), size = paragraphWidth ?? 14, width = paragraphProperties ?? Infinity;
            source = new StringTextSource(text, new GenericTextRunProperties(typeface, size)); firstTextSourceIndex = 0; paragraphWidth = width;
            paragraphProperties = new GenericTextParagraphProperties(source.Properties, 'Left', 'Wrap');
        }
        if (typeof source?.GetTextRun !== 'function' || !(paragraphProperties instanceof TextParagraphProperties)) throw new TypeError('An ITextSource and TextParagraphProperties are required.');
        if (!Number.isInteger(firstTextSourceIndex) || firstTextSourceIndex < 0 || !(paragraphWidth >= 0)) throw new RangeError('Invalid source index or paragraph width.');
        const key = signature(paragraphProperties), prior = previousLineBreak?._paragraph;
        if (prior && !previousLineBreak.IsDisposed && previousLineBreak.HasRemaining && previousLineBreak.NextTextSourceIndex === firstTextSourceIndex && prior.Source === source && prior.RequestedWidth === paragraphWidth && prior.Signature === key && prior.SourceVersion === source.Version && prior.CacheRevision === (textRunCache?.Revision ?? 0)) return new TextLine(prior, previousLineBreak._nextLine);
        let text = '', index = firstTextSourceIndex, ending = null, newline = 0; const runs = [];
        while (true) {
            const run = textRunCache ? textRunCache.GetTextRun(source, index) : source.GetTextRun(index);
            if (run == null) break;
            if (run instanceof TextEndOfLine) { ending = run; newline = run.Length; break; }
            if (!(run instanceof TextCharacters) || run.Length <= 0 || run.Text.length !== run.Length) throw new TypeError('Text sources must return advancing TextCharacters or an end-of-line marker.');
            const match = /\r\n|\r|\n/.exec(run.Text), part = match ? run.Text.slice(0, match.index) : run.Text;
            if (text.length + part.length > this.MaxParagraphCharacters) throw new RangeError('Paragraph exceeds the formatter character budget.');
            if (part.length) runs.push(runStyle(new TextCharacters(part, run.Properties ?? paragraphProperties.DefaultTextRunProperties), text.length, paragraphProperties.LetterSpacing));
            text += part; index += part.length;
            if (match) { newline = match[0].length; ending = new TextEndOfLine(newline); break; }
        }
        if (!text.length && !newline && firstTextSourceIndex > 0) return null;
        const rp = paragraphProperties.DefaultTextRunProperties, indent = paragraphProperties.FirstLineInParagraph ? Math.max(0, paragraphProperties.Indent) : 0, width = Math.max(0, paragraphWidth - indent);
        const layout = new TextLayout(text, rp.Typeface, rp.FontRenderingEmSize, rp.ForegroundBrush ?? Brushes.Black, { TextRuns: runs, MaxWidth: width, TextWrapping: paragraphProperties.TextWrapping, TextAlignment: paragraphProperties.TextAlignment, FlowDirection: paragraphProperties.FlowDirection, LineHeight: paragraphProperties.LineHeight > 0 ? paragraphProperties.LineHeight : NaN });
        return new TextLine({ Source: source, SourceVersion: source.Version, CacheRevision: textRunCache?.Revision ?? 0, Signature: key, RequestedWidth: paragraphWidth, Width: width, Start: firstTextSourceIndex, Text: text, Runs: runs, EndOfLine: ending, NewLineLength: newline, Layout: layout, Indent: indent, Properties: paragraphProperties }, 0);
    }
}
