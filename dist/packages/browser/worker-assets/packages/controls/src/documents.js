import { AvaloniaList, DefineProperties, Event, CompositeDisposable, Disposable, BindingPriority } from "../../base/src/index.js";
import { Typeface } from "../../media/src/index.js";
import { StyledElement, Control } from './core.js';

/** Text properties share the control property identities, so normal inheritance and bindings work. */
export class TextElement extends StyledElement {
    constructor() { super(); this.Invalidated = new Event(); }
    OnPropertyChanged(change) { super.OnPropertyChanged(change); this.Invalidated?.Raise(this, change); }
    Dispose() { if (this.IsDisposed) return; this.Invalidated.Clear(); super.Dispose(); }
}
for (const name of ['Background', 'Foreground', 'FontFamily', 'FontSize', 'FontWeight', 'FontStyle']) {
    const property = Control[`${name}Property`].AddOwner(TextElement);
    TextElement[`${name}Property`] = property;
    Object.defineProperty(TextElement.prototype, name, { get() { return this.GetValue(property); }, set(value) { this.SetValue(property, property.GetMetadata(this).Convert?.(value) ?? value); } });
    TextElement[`Get${name}`] = element => element.GetValue(property);
    TextElement[`Set${name}`] = (element, value) => element.SetValue(property, property.GetMetadata(element).Convert?.(value) ?? value);
}
DefineProperties(TextElement, {
    LetterSpacing: [0, { Convert: Number, Inherits: true }],
    FontFeatures: [null, { Inherits: true }], FontStretch: [5, { Convert: Number, Inherits: true }],
    TextDecorations: [null, { Inherits: true }], BaselineAlignment: ['Baseline', { Inherits: true }]
});
export class Inline extends TextElement {}
export class Run extends Inline { constructor(text = '') { super(); this.Text = text; } }
DefineProperties(Run, { Text: ['', { Convert: v => String(v ?? '') }] });
export class LineBreak extends Inline {}

/** Single-parent inline ownership with validation before mutation and deterministic teardown. */
export class InlineCollection extends AvaloniaList {
    constructor(owner) { super(); this.Owner = owner; this._subscriptions = new Map(); }
    _Value(value) { if (typeof value === 'string') return new Run(value); if (!(value instanceof Inline)) throw new TypeError('Inlines must be Inline objects or text.'); return value; }
    _Validate(value, replacing = null) {
        if (value === this.Owner) throw new Error('An inline cannot contain itself.');
        for (let p = this.Owner; p; p = p.Parent) if (p === value) throw new Error('Inline ownership cycle.');
        if (value.Parent && value !== replacing) throw new Error('An inline already has an owner.');
        if (value.IsDisposed) throw new Error('A disposed inline cannot be attached.');
    }
    _Attach(value) {
        value._parent = this.Owner; value.SetInheritanceParent(this.Owner);
        this._subscriptions.set(value, value.Invalidated.Add(() => this.Owner._InvalidateInlines?.()));
    }
    _Detach(value) { this._subscriptions.get(value)?.Dispose(); this._subscriptions.delete(value); value._parent = null; value.SetInheritanceParent(null); }
    Add(value) { value = this._Value(value); this._Validate(value); this._Attach(value); const index = super.Add(value); this.Owner._InvalidateInlines?.(); return index; }
    Insert(index, value) { this._check(index, true); value = this._Value(value); this._Validate(value); this._Attach(value); super.Insert(index, value); this.Owner._InvalidateInlines?.(); }
    Set(index, value) { this._check(index); value = this._Value(value); const old = this.Get(index); if (old === value) return; this._Validate(value); this._Detach(old); this._Attach(value); super.Set(index, value); this.Owner._InvalidateInlines?.(); }
    AddRange(values) { const items = Array.from(values, v => this._Value(v)); if (new Set(items).size !== items.length) throw new Error('Duplicate inline.'); for (const v of items) this._Validate(v); const batch = this.BeginUpdate(); try { for (const v of items) this.Add(v); } finally { batch.Dispose(); } }
    InsertRange(index, values) { const items = Array.from(values, v => this._Value(v)); this._check(index, true); if (new Set(items).size !== items.length) throw new Error('Duplicate inline.'); for (const v of items) this._Validate(v); const batch = this.BeginUpdate(); try { for (const v of items) this.Insert(index++, v); } finally { batch.Dispose(); } }
    RemoveAt(index) { this._check(index); const value = this.Get(index); this._Detach(value); super.RemoveAt(index); this.Owner._InvalidateInlines?.(); }
    RemoveRange(index, count) { if (!Number.isInteger(count) || count < 0 || index < 0 || index + count > this.Count) throw new RangeError('Invalid inline range.'); const batch = this.BeginUpdate(); try { while (count--) this.RemoveAt(index); } finally { batch.Dispose(); } }
    Clear() { const old = this.ToArray(); for (const value of old) this._Detach(value); super.Clear(); this.Owner._InvalidateInlines?.(); }
    ReplaceAll(values) { const items = Array.from(values, v => this._Value(v)); if (new Set(items).size !== items.length) throw new Error('Duplicate inline.'); for (const value of items) { if (value.Parent !== this.Owner) this._Validate(value); } const batch = this.BeginUpdate(); try { this.Clear(); this.AddRange(items); } finally { batch.Dispose(); } }
    Dispose() { const old = this.ToArray(); this.Clear(); for (const value of old) value.Dispose(); this.CollectionChanged.Clear(); this.PropertyChanged.Clear(); }
}
export class Span extends Inline {
    constructor(...inlines) { super(); this.Inlines = new InlineCollection(this); if (inlines.length) this.Inlines.AddRange(inlines.flat()); }
    _InvalidateInlines() { this.Invalidated.Raise(this, {}); }
    Dispose() { if (this.IsDisposed) return; this.Inlines.Dispose(); super.Dispose(); }
}
export class Bold extends Span { constructor(...inlines) { super(...inlines); this.FontWeight = 700; } }
export class Italic extends Span { constructor(...inlines) { super(...inlines); this.FontStyle = 'Italic'; } }
export class Underline extends Span { constructor(...inlines) { super(...inlines); this.TextDecorations = 'Underline'; } }
export class InlineUIContainer extends Inline {
    constructor(child = null) { super(); this.Child = child; }
}
DefineProperties(InlineUIContainer, { Child: [null, { Validate: v => v == null || v instanceof Control }] });

export function FlattenInlines(inlines) {
    const runs = []; let text = '';
    const visit = inline => {
        if (inline instanceof Span) { for (const child of inline.Inlines) visit(child); return; }
        const value = inline instanceof Run ? inline.Text : inline instanceof LineBreak ? '\n' : inline instanceof InlineUIContainer ? '\ufffc' : '';
        const start = text.length; text += value;
        runs.push({ Start: start, Length: value.length, Typeface: new Typeface(inline.FontFamily, inline.FontStyle, inline.FontWeight, inline.FontStretch),
            FontSize: inline.FontSize, Foreground: inline.Foreground, Background: inline.Background, LetterSpacing: inline.LetterSpacing,
            FontFeatures: inline.FontFeatures ?? [], TextDecorations: inline.TextDecorations, BaselineAlignment: inline.BaselineAlignment,
            Inline: inline, Child: inline instanceof InlineUIContainer ? inline.Child : null });
    };
    for (const inline of inlines) visit(inline);
    return { Text: text, Runs: runs };
}
