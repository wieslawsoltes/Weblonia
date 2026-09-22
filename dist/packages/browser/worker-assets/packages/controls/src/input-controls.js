import { ScrollChrome } from './scroll-bar.js';
import { RangeBase } from './range.js';
export { RangeBase, RangeBaseValueChangedEventArgs } from './range.js';
export { ScrollBar, ScrollBarVisibility, ScrollEventType, ScrollEventArgs } from './scroll-bar.js';
import { DefineProperties, BindingMode, Size, Rect, Point, Thickness, CornerRadius, Event, Disposable, CompositeDisposable, MathUtilities } from "../../base/src/index.js";
import { Pen, TextLayout, TextLayoutCache, MeasureText, Brushes, GraphemeSegments, SnapTextPosition, PreviousTextPosition, NextTextPosition, TruncateText, GetWordRange } from "../../media/src/index.js";
import { Control, InputElement, BooleanValue, BrushValue, DefineRoutedEvent, RoutedEventArgs } from './core.js';
import { ContentControl, ScrollViewer } from './content.js';
export class Button extends ContentControl {
    constructor(content = null) {
        super();
        this._commandEnabled = true;
        this._commandLifetime = new CompositeDisposable();
        this.CommandException = new Event();
        this.Focusable = true;
        if (content != null)
            this.Content = content;
    }
    get IsEffectivelyEnabled() {
        return super.IsEffectivelyEnabled && this._commandEnabled !== false;
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'Command')
            this._ObserveCommand(e.NewValue);
        else if (e.Property.Name === 'CommandParameter' && typeof this.Command?.CanExecute === 'function')
            this._SetCommandEnabled(this.Command.CanExecute(e.NewValue));
    }
    _SetCommandEnabled(value) {
        value = !!value;
        if (this._commandEnabled === value) return;
        this._commandEnabled = value;
        this.InvalidateStyles(true);
        this.GetVisualRoot()?._InvalidateAutomation?.(this, false, true);
    }
    _ObserveCommand(command) {
        this._commandLifetime?.Clear();
        this._SetCommandEnabled(true);
        const source = command?.CanExecute;
        if (source?.subscribe)
            this._commandLifetime.Add(source.subscribe(value => {
                this._SetCommandEnabled(value);
            }));
        else if (typeof source === 'function')
            this._SetCommandEnabled(source.call(command, this.CommandParameter));
        if (command?.CanExecuteChanged?.Add)
            this._commandLifetime.Add(command.CanExecuteChanged.Add(() => {
                this._SetCommandEnabled(command.CanExecute(this.CommandParameter));
            }));
    }
    OnClick() {
        if (!this.IsEffectivelyEnabled)
            return;
        const e = this.RaiseEvent(new RoutedEventArgs(Button.ClickEvent, this));
        if (e.Handled)
            return;
        const command = this.Command;
        if (!command)
            return;
        try {
            const result = typeof command === 'function' ? command(this.CommandParameter) : command.Execute(this.CommandParameter);
            if (result?.subscribe)
                this._lifetime.Add(result.subscribe({ error: error => this.CommandException.Raise(this, { Error: error }) }));
            else if (result?.then)
                result.catch(error => this.CommandException.Raise(this, { Error: error }));
        }
        catch (error) {
            this.CommandException.Raise(this, { Error: error });
        }
    }
    OnPointerPressed(e) {
        if (!this.IsEffectivelyEnabled || e.OriginalEvent?.button > 0)
            return;
        this.Focus('Pointer');
        e.Pointer.Capture(this);
        this.IsPressed = true;
        if (this.ClickMode === 'Press')
            this.OnClick();
        e.Handled = true;
    }
    OnPointerMoved(e) {
        if (e.Pointer.Captured === this) {
            this.IsPressed = new Rect(this.Bounds.Size).Contains(e.GetPosition(this));
            e.Handled = true;
        }
    }
    OnPointerReleased(e) {
        if (e.Pointer.Captured !== this)
            return;
        const pressed = this.IsPressed && new Rect(this.Bounds.Size).Contains(e.GetPosition(this));
        e.Pointer.Capture(null);
        this.IsPressed = false;
        if (pressed && this.ClickMode === 'Release')
            this.OnClick();
        e.Handled = true;
    }
    OnPointerCaptureLost() {
        this.IsPressed = false;
    }
    OnKeyDown(e) {
        if (['Enter', 'Space'].includes(e.Key) && this.IsEffectivelyEnabled && !e.OriginalEvent?.repeat) {
            this.IsPressed = true;
            if (e.Key === 'Enter') {
                this.OnClick();
                this.IsPressed = false;
            }
            e.Handled = true;
        }
    }
    OnKeyUp(e) {
        if (e.Key === 'Space' && this.IsPressed) {
            this.IsPressed = false;
            this.OnClick();
            e.Handled = true;
        }
    }
    Render(ctx) {
        const p = this.Palette, accent = this.Classes.has('accent'), flat = this.Classes.has('flat');
        const brush = !this.IsEffectivelyEnabled ? p.SurfaceAlt : this.IsPressed ? p.Pressed : this.IsPointerOver ? p.Hover : this.Background ?? (accent ? p.Accent : flat ? null : p.Surface);
        ctx.DrawRectangle(brush, (flat || this.Classes.has('nav')) && !this.IsPointerOver ? null : new Pen(this.BorderBrush ?? (accent ? p.Accent : p.Border), 1), new Rect(this.Bounds.Size).Deflate(.5), this.CornerRadius.TopLeft);
    }
    Dispose() {
        this._commandLifetime.Dispose();
        super.Dispose();
    }
}
DefineProperties(Button, { Command: [null], CommandParameter: [null], ClickMode: ['Release'], IsDefault: [false, { Convert: BooleanValue }], IsCancel: [false, { Convert: BooleanValue }], IsPressed: [false, { Convert: BooleanValue }] });
DefineRoutedEvent(Button, 'Click');
const buttonChanged = Button.prototype.OnPropertyChanged;
Button.prototype.OnPropertyChanged = function (e) {
    buttonChanged.call(this, e);
    if (e.Property.Name === 'IsPressed')
        this.PseudoClasses.Set(':pressed', e.NewValue);
};
export class RepeatButton extends Button {
    OnPointerPressed(e) {
        super.OnPointerPressed(e);
        if (this.IsPressed) {
            this.OnClick();
            this._timer = setTimeout(() => {
                this._repeat = setInterval(() => {
                    if (this.IsPressed)
                        this.OnClick();
                }, this.Interval);
            }, this.Delay);
        }
    }
    OnPointerReleased(e) {
        this._Stop();
        const mode = this.ClickMode;
        this.ClickMode = 'Press';
        super.OnPointerReleased(e);
        this.ClickMode = mode;
    }
    OnPointerCaptureLost() {
        this._Stop();
        super.OnPointerCaptureLost();
    }
    _Stop() {
        clearTimeout(this._timer);
        clearInterval(this._repeat);
    }
    Dispose() {
        this._Stop();
        super.Dispose();
    }
}
DefineProperties(RepeatButton, { Delay: [400, { Convert: Number }], Interval: [80, { Convert: Number }] });
export class ToggleButton extends Button {
    OnClick() {
        if (!this.IsEffectivelyEnabled)
            return;
        this.OnToggle();
        super.OnClick();
    }
    OnToggle() {
        this.SetCurrentValue(ToggleButton.IsCheckedProperty, this.IsThreeState ? this.IsChecked === false ? true : this.IsChecked === true ? null : false : !this.IsChecked);
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'IsChecked') {
            this.PseudoClasses.Set(':checked', e.NewValue === true);
            this.PseudoClasses.Set(':indeterminate', e.NewValue == null);
            this.RaiseEvent(new RoutedEventArgs(ToggleButton.IsCheckedChangedEvent, this));
        }
    }
    Render(ctx) {
        if (this.IsChecked)
            ctx.DrawRectangle(this.Palette.Selection, new Pen(this.Palette.Accent, 1), new Rect(this.Bounds.Size).Deflate(.5), this.CornerRadius.TopLeft);
        else
            super.Render(ctx);
    }
}
DefineProperties(ToggleButton, { IsChecked: [false, { Convert: v => v == null || v === 'null' ? null : BooleanValue(v), DefaultBindingMode: BindingMode.TwoWay }], IsThreeState: [false, { Convert: BooleanValue }] });
DefineRoutedEvent(ToggleButton, 'IsCheckedChanged');
export class CheckBox extends ToggleButton {
    constructor(content = null) {
        super(content);
        this.Padding = new Thickness(30, 6, 0, 6);
        this.HorizontalContentAlignment = 'Left';
        this.MinWidth = 0;
        this.MinHeight = 28;
    }
    Render(ctx) {
        const p = this.Palette, y = (this.Bounds.Height - 18) / 2, r = new Rect(1, y, 18, 18);
        ctx.DrawRectangle(this.IsChecked !== false ? p.Accent : this.IsPointerOver ? p.Hover : p.Surface, new Pen(this.IsChecked !== false ? p.Accent : p.Muted, 1), r, 3);
        if (this.IsChecked === true) {
            const pen = new Pen(p.AccentText, 2);
            ctx.DrawLine(pen, new Point(5, y + 9), new Point(9, y + 13));
            ctx.DrawLine(pen, new Point(9, y + 13), new Point(15, y + 5));
        }
        else if (this.IsChecked == null)
            ctx.DrawRectangle(p.AccentText, null, new Rect(5, y + 8, 10, 2), 1);
    }
}
export class RadioButton extends CheckBox {
    OnToggle() {
        this.SetCurrentValue(ToggleButton.IsCheckedProperty, true);
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'IsChecked' && e.NewValue === true) {
            const groupRoot = this.GroupName ? this.GetVisualRoot() ?? this.Parent : this.Parent;
            for (const control of groupRoot ? [groupRoot, ...groupRoot.GetVisualDescendants()] : [])
                if (control !== this && control instanceof RadioButton && control.GroupName === this.GroupName && (this.GroupName || control.Parent === this.Parent))
                    control.SetCurrentValue(ToggleButton.IsCheckedProperty, false);
        }
    }
    Render(ctx) {
        const center = new Point(10, this.Bounds.Height / 2), p = this.Palette;
        ctx.DrawEllipse(this.IsPointerOver ? p.Hover : p.Surface, new Pen(this.IsChecked ? p.Accent : p.Muted, this.IsChecked ? 4 : 1), center, 8, 8);
        if (this.IsChecked)
            ctx.DrawEllipse(p.Surface, null, center, 3.5, 3.5);
    }
}
DefineProperties(RadioButton, { GroupName: ['', { Convert: String }] });
export class ToggleSwitch extends ToggleButton {
    constructor(content = null) {
        super(content);
        this.Padding = new Thickness(52, 5, 0, 5);
        this.HorizontalContentAlignment = 'Left';
        this.MinHeight = 32;
        this.MinWidth = 48;
    }
    Render(ctx) {
        const y = (this.Bounds.Height - 22) / 2;
        ctx.DrawRectangle(this.IsChecked ? this.Palette.Accent : this.Palette.Track, null, new Rect(0, y, 42, 22), 11);
        ctx.DrawEllipse(this.IsChecked ? this.Palette.AccentText : this.Palette.Surface, null, new Point(this.IsChecked ? 31 : 11, y + 11), 7, 7);
    }
}
export class Slider extends RangeBase {
    constructor() {
        super();
        this.Focusable = true;
        this.MinWidth = 60;
        this.MinHeight = 24;
    }
    MeasureOverride() {
        return this.Orientation === 'Horizontal' ? new Size(180, 32) : new Size(32, 180);
    }
    _SetFromPointer(e) {
        const p = e.GetPosition(this), horizontal = this.Orientation === 'Horizontal';
        let fraction = horizontal ? (p.X - 10) / Math.max(1, this.Bounds.Width - 20) : 1 - (p.Y - 10) / Math.max(1, this.Bounds.Height - 20);
        if (this.IsDirectionReversed)
            fraction = 1 - fraction;
        let value = this.Minimum + MathUtilities.Clamp(fraction, 0, 1) * (this.Maximum - this.Minimum);
        if (this.IsSnapToTickEnabled && this.TickFrequency > 0)
            value = this.Minimum + Math.round((value - this.Minimum) / this.TickFrequency) * this.TickFrequency;
        this.SetCurrentValue(RangeBase.ValueProperty, value);
    }
    OnPointerPressed(e) {
        if (!this.IsEffectivelyEnabled)
            return;
        this.Focus('Pointer');
        e.Pointer.Capture(this);
        this._SetFromPointer(e);
        e.Handled = true;
    }
    OnPointerMoved(e) {
        if (e.Pointer.Captured === this) {
            this._SetFromPointer(e);
            e.Handled = true;
        }
    }
    OnPointerReleased(e) {
        if (e.Pointer.Captured === this) {
            e.Pointer.Capture(null);
            e.Handled = true;
        }
    }
    OnKeyDown(e) {
        let delta = 0;
        if (['Left', 'Down'].includes(e.Key))
            delta = -this.SmallChange;
        if (['Right', 'Up'].includes(e.Key))
            delta = this.SmallChange;
        if (e.Key === 'PageUp')
            delta = this.LargeChange;
        if (e.Key === 'PageDown')
            delta = -this.LargeChange;
        if (delta) {
            this.SetCurrentValue(RangeBase.ValueProperty, this.Value + delta * (this.IsDirectionReversed ? -1 : 1));
            e.Handled = true;
        }
        if (e.Key === 'Home' || e.Key === 'End') {
            this.SetCurrentValue(RangeBase.ValueProperty, e.Key === 'Home' ? this.Minimum : this.Maximum);
            e.Handled = true;
        }
    }
    Render(ctx) {
        const horizontal = this.Orientation === 'Horizontal', fraction = this.IsDirectionReversed ? 1 - this.Percentage : this.Percentage, p = this.Palette;
        if (horizontal) {
            const y = this.Bounds.Height / 2, x = 10 + (this.Bounds.Width - 20) * fraction;
            ctx.DrawRectangle(p.Track, null, new Rect(10, y - 2, Math.max(0, this.Bounds.Width - 20), 4), 2);
            ctx.DrawRectangle(p.Accent, null, new Rect(10, y - 2, Math.max(0, x - 10), 4), 2);
            ctx.DrawEllipse(p.Surface, new Pen(p.Border, 1), new Point(x, y), 9, 9);
            ctx.DrawEllipse(p.Accent, null, new Point(x, y), this.IsPointerOver ? 6 : 5, this.IsPointerOver ? 6 : 5);
        }
        else {
            const x = this.Bounds.Width / 2, y = 10 + (this.Bounds.Height - 20) * (1 - fraction);
            ctx.DrawRectangle(p.Track, null, new Rect(x - 2, 10, 4, Math.max(0, this.Bounds.Height - 20)), 2);
            ctx.DrawRectangle(p.Accent, null, new Rect(x - 2, y, 4, Math.max(0, this.Bounds.Height - 10 - y)), 2);
            ctx.DrawEllipse(p.Surface, new Pen(p.Border, 1), new Point(x, y), 9, 9);
            ctx.DrawEllipse(p.Accent, null, new Point(x, y), 5, 5);
        }
    }
}
DefineProperties(Slider, { Orientation: ['Horizontal', { AffectsMeasure: true }], IsDirectionReversed: [false, { Convert: BooleanValue }], IsSnapToTickEnabled: [false, { Convert: BooleanValue }], TickFrequency: [1, { Convert: Number }], TickPlacement: ['None'] });
export class ProgressBar extends RangeBase {
    constructor() {
        super();
        this.MinHeight = 5;
        this._indeterminateStart = performance.now();
    }
    MeasureOverride() {
        return new Size(180, this.ShowProgressText ? 28 : 5);
    }
    Render(ctx) {
        const y = this.ShowProgressText ? this.Bounds.Height - 5 : (this.Bounds.Height - 5) / 2, w = this.Bounds.Width;
        ctx.DrawRectangle(this.Palette.Track, null, new Rect(0, y, w, 5), 2.5);
        if (this.IsIndeterminate) {
            const f = ((performance.now() - this._indeterminateStart) % 1800) / 1800, x = (w + w * .3) * f - w * .3;
            const clip = ctx.PushClip(new Rect(0, y, w, 5));
            try {
                ctx.DrawRectangle(this.Palette.Accent, null, new Rect(x, y, w * .3, 5), 2.5);
            }
            finally {
                clip.Dispose();
            }
            this.GetVisualRoot()?._RequestAnimationFrame?.(this);
        }
        else
            ctx.DrawRectangle(this.Palette.Accent, null, new Rect(0, y, w * this.Percentage, 5), 2.5);
        if (this.ShowProgressText)
            this.DrawText(ctx, `${Math.round(this.Percentage * 100)}%`, new Rect(0, 0, w, Math.max(0, y - 3)), { TextAlignment: 'Center', FontSize: 12 });
    }
}
DefineProperties(ProgressBar, { IsIndeterminate: [false, { Convert: BooleanValue }], ShowProgressText: [false, { Convert: BooleanValue, AffectsMeasure: true }] });
export class TextBox extends Control {
    constructor(text = '') {
        super();
        this.Focusable = true;
        this.Padding = new Thickness(10, 7);
        this.MinWidth = 80;
        this.MinHeight = 34;
        this.ClipToBounds = true;
        this.TextChanged = new Event();
        this.SelectionChanged = new Event();
        this._undo = [];
        this._redo = [];
        this._textScroll = new Point();
        this._textViewportRect = Rect.Empty; this._textExtent = Size.Empty;
        this._chrome = new ScrollChrome(this, offset => this._SetTextScroll(offset));
        this._composing = false;
        if (text)
            this.Text = text;
    }
    get SelectedText() {
        return this.Text.slice(Math.min(this.SelectionStart, this.SelectionEnd), Math.max(this.SelectionStart, this.SelectionEnd));
    }
    set SelectedText(value) {
        this.ReplaceSelection(String(value));
    }
    get CanUndo() {
        return this._undo.length > 0;
    }
    get CanRedo() {
        return this._redo.length > 0;
    }
    _Snapshot() {
        return { Text: this.Text, Start: this.SelectionStart, End: this.SelectionEnd };
    }
    _Restore(snapshot) {
        this._restoring = true;
        try {
            this.SetCurrentValue(TextBox.TextProperty, snapshot.Text);
            this.SelectionStart = snapshot.Start;
            this.SelectionEnd = snapshot.End;
            this.CaretIndex = snapshot.End;
        }
        finally {
            this._restoring = false;
        }
        this.GetVisualRoot()?._SyncTextInput?.(this);
    }
    Undo() {
        if (!this.CanUndo || this.IsReadOnly)
            return;
        this._redo.push(this._Snapshot());
        this._Restore(this._undo.pop());
    }
    Redo() {
        if (!this.CanRedo || this.IsReadOnly)
            return;
        this._undo.push(this._Snapshot());
        this._Restore(this._redo.pop());
    }
    Clear() {
        this.SelectAll();
        this.ReplaceSelection('');
    }
    SelectAll() {
        this.SelectionStart = 0;
        this.SelectionEnd = this.CaretIndex = this.Text.length;
        this.GetVisualRoot()?._SyncTextInput?.(this);
        this.InvalidateVisual();
    }
    ClearSelection() {
        this.SelectionStart = this.SelectionEnd = this.CaretIndex;
    }
    ReplaceSelection(text) {
        if (this.IsReadOnly)
            return;
        const start = SnapTextPosition(this.Text, Math.min(this.SelectionStart, this.SelectionEnd), 'Backward'), end = SnapTextPosition(this.Text, Math.max(this.SelectionStart, this.SelectionEnd), 'Forward');
        let replacement = this.AcceptsReturn ? text : text.replace(/[\r\n]/g, '');
        if (this.MaxLength > 0)
            replacement = TruncateText(replacement, Math.max(0, this.MaxLength - (this.Text.length - (end - start))));
        this.ApplyTextEdit(this.Text.slice(0, start) + replacement + this.Text.slice(end), start + replacement.length, start + replacement.length);
    }
    ApplyTextEdit(text, start, end, composing = false) {
        if (this.IsReadOnly)
            return;
        const before = this._Snapshot();
        text = this.AcceptsReturn ? String(text) : String(text).replace(/[\r\n]/g, '');
        if (this.MaxLength > 0) text = TruncateText(text, this.MaxLength);
        if (!this._restoring && this.IsUndoEnabled && !this._composing && before.Text !== text) {
            this._undo.push(before);
            if (this._undo.length > this.UndoLimit) this._undo.shift();
            this._redo.length = 0;
        }
        this._composing = composing;
        this.SetCurrentValue(TextBox.TextProperty, text);
        this.SelectionStart = composing ? MathUtilities.Clamp(start, 0, this.Text.length) : SnapTextPosition(this.Text, start);
        this.SelectionEnd = this.CaretIndex = composing ? MathUtilities.Clamp(end, 0, this.Text.length) : SnapTextPosition(this.Text, end);
        this._EnsureCaretVisible();
        this.GetVisualRoot()?._SyncTextInput?.(this);
    }
    _LayoutText(width = null) {
        const masking = this.PasswordChar && !this.RevealPassword;
        const segments = masking ? GraphemeSegments(this.Text) : null;
        const mask = masking ? GraphemeSegments(this.PasswordChar)[0]?.Text ?? '•' : '';
        const display = masking ? mask.repeat(segments.length) : this.Text;
        const layout = (this._editorLayouts ??= new TextLayoutCache(2)).GetOrCreate(display || '', this.Typeface, this.FontSize, this.Foreground, { LetterSpacing: this.LetterSpacing, MaxWidth: this.TextWrapping === 'NoWrap' ? Infinity : Math.max(1, width ?? (this._textViewportRect.Width || this.Bounds.Width - this.Padding.Horizontal)), TextWrapping: this.TextWrapping, TextAlignment: this.TextAlignment, LineHeight: this.LineHeight, FlowDirection: this.FlowDirection });
        if (masking && layout._passwordSource !== this.Text) {
            layout._passwordSource = this.Text;
            const logical = [0, ...segments.map(x => x.End)];
            const toVisual = pos => { const n = SnapTextPosition(this.Text, pos); return Math.max(0, logical.indexOf(n)) * mask.length; };
            const toLogical = pos => logical[Math.min(logical.length - 1, Math.round(pos / mask.length))];
            const [point, position, range] = layout._unmaskedMethods ??= [layout.HitTestPoint.bind(layout), layout.HitTestTextPosition.bind(layout), layout.HitTestTextRange.bind(layout)];
            layout.HitTestPoint = p => { const hit = point(p); return { ...hit, TextPosition: toLogical(hit.TextPosition) }; };
            layout.HitTestTextPosition = p => position(toVisual(p));
            layout.HitTestTextRange = (p, length) => range(toVisual(p), toVisual(p + length) - toVisual(p));
        }
        if (!masking && layout._unmaskedMethods) { [layout.HitTestPoint, layout.HitTestTextPosition, layout.HitTestTextRange] = layout._unmaskedMethods; delete layout._passwordSource; }
        return layout;
    }
    Dispose() { if (this.IsDisposed) return; this._editorLayouts?.Dispose(); this._placeholderLayouts?.Dispose(); super.Dispose(); }
    get HorizontalScrollBar() { return this._chrome.Horizontal; }
    get VerticalScrollBar() { return this._chrome.Vertical; }
    get ScrollOffset() { return this._textScroll; }
    _TextOrigin(layout = this._LayoutText()) {
        const rect = this._textViewportRect.Width > 0 ? this._textViewportRect : new Rect(this.Bounds.Size).Deflate(this.Padding);
        const free = Math.max(0, rect.Height - layout.Height);
        const align = this.VerticalContentAlignment;
        const dy = align === 'Center' ? free / 2 : align === 'Bottom' ? free : 0;
        return new Point(rect.X - this._textScroll.X, rect.Y + dy - this._textScroll.Y);
    }
    _SetTextScroll(offset) {
        const layout = this._LayoutText(), rect = this._textViewportRect.Width > 0 ? this._textViewportRect : new Rect(this.Bounds.Size).Deflate(this.Padding);
        const maxX = Math.max(0, layout.WidthIncludingTrailingWhitespace + 1.25 - rect.Width), maxY = Math.max(0, layout.Height - rect.Height);
        const next = new Point(this.TextWrapping === 'NoWrap' && this.HorizontalScrollBarVisibility !== 'Disabled' ? MathUtilities.Clamp(offset.X, 0, maxX) : 0,
            this.VerticalScrollBarVisibility !== 'Disabled' ? MathUtilities.Clamp(offset.Y, 0, maxY) : 0);
        if (next.Equals(this._textScroll)) return false;
        this._textScroll = next;
        this._SyncEditorChrome(layout);
        this.GetVisualRoot()?._SyncTextInput?.(this);
        this.InvalidateVisual(); return true;
    }
    _SyncEditorChrome(layout) {
        if (!this._chrome) return;
        this._textExtent = new Size(layout.WidthIncludingTrailingWhitespace + 1.25, layout.Height);
        this._chrome.Sync(this._textViewportRect, this._textExtent, this._textScroll, {
            Horizontal: this.TextWrapping !== 'NoWrap' ? 'Disabled' : this.AcceptsReturn ? this.HorizontalScrollBarVisibility : 'Hidden',
            Vertical: this.AcceptsReturn ? this.VerticalScrollBarVisibility : 'Hidden',
            AllowAutoHide: this.AllowAutoHide, Overlay: this.AllowAutoHide || !this.AcceptsReturn, Deferred: this.IsDeferredScrollingEnabled,
            SmallChange: new Point(16, this.FontSize * 1.4)
        });
    }
    _EnsureCaretVisible() {
        if (!this.Bounds.Width || !this.Bounds.Height) { this._ensureCaretOnArrange = true; return; }
        const layout = this._LayoutText(), caret = layout.HitTestTextPosition(this.CaretIndex);
        const rect = this._textViewportRect.Width > 0 ? this._textViewportRect : new Rect(this.Bounds.Size).Deflate(this.Padding);
        let x = this._textScroll.X, y = this._textScroll.Y;
        if (caret.X < x) x = caret.X;
        else if (caret.Right > x + rect.Width) x = caret.Right - rect.Width;
        if (caret.Y < y) y = caret.Y;
        else if (caret.Bottom > y + rect.Height) y = caret.Bottom - rect.Height;
        this._SetTextScroll(new Point(Math.max(0, x), Math.max(0, y)));
        this.InvalidateVisual();
    }
    MeasureOverride(available) {
        const width = available.Deflate(this.Padding).Width;
        const layout = this.Text ? this._LayoutText(width) : (this._placeholderLayouts ??= new TextLayoutCache(2)).GetOrCreate(
            this.Watermark || this.PlaceholderText || ' ', this.Typeface, this.FontSize, this.Foreground,
            { MaxWidth: this.TextWrapping === 'NoWrap' ? Infinity : width, TextWrapping: this.TextWrapping, LineHeight: this.LineHeight, FlowDirection: this.FlowDirection });
        return new Size(Math.max(100, Math.min(layout.Width, 320)), Math.max(layout.Height, this.FontSize * 1.4)).Inflate(this.Padding);
    }
    ArrangeOverride(size) {
        const area = new Rect(size).Deflate(this.Padding);
        let rect = area, layout = this._LayoutText(rect.Width);
        if (!this.AllowAutoHide && this.AcceptsReturn) {
            for (let i = 0; i < 3; ++i) {
                const h = this.TextWrapping === 'NoWrap' && (this.HorizontalScrollBarVisibility === 'Visible' || this.HorizontalScrollBarVisibility === 'Auto' && layout.Width + 1.25 > rect.Width);
                const v = this.VerticalScrollBarVisibility === 'Visible' || this.VerticalScrollBarVisibility === 'Auto' && layout.Height > rect.Height;
                const next = new Rect(area.X, area.Y, Math.max(0, area.Width - (v ? 16 : 0)), Math.max(0, area.Height - (h ? 16 : 0)));
                if (next.Equals(rect)) break;
                rect = next; layout = this._LayoutText(rect.Width);
            }
        }
        const changed = !rect.Equals(this._textViewportRect);
        this._textViewportRect = rect;
        this._SetTextScroll(this._textScroll); this._SyncEditorChrome(layout);
        if (this._ensureCaretOnArrange || changed && this.IsFocused) { this._ensureCaretOnArrange = false; this._EnsureCaretVisible(); }
        return size;
    }
    OnPointerWheelChanged(e) {
        const delta = e.GetPixelDelta?.(this._textViewportRect.Size, this.FontSize * 1.4) ?? new Point(-e.Delta.X * 48, -e.Delta.Y * 48);
        let x = delta.X, y = delta.Y;
        if (e.KeyModifiers & 4 && !x) { x = y; y = 0; }
        if (this._SetTextScroll(new Point(this._textScroll.X + x, this._textScroll.Y + y)) || !this.IsScrollChainingEnabled) e.Handled = true;
    }
    Render(ctx) {
        const p = this.Palette, r = new Rect(this.Bounds.Size);
        ctx.DrawRectangle(this.Background ?? p.Surface, new Pen(this.BorderBrush ?? (this.ValidationErrors?.length ? p.Error : p.Border), 1), r.Deflate(.5), 4);
        ctx.DrawRectangle(this.IsFocused ? p.Accent : p.Muted, null, new Rect(1, r.Height - (this.IsFocused ? 2 : 1), Math.max(0, r.Width - 2), this.IsFocused ? 2 : 1));
        const content = this._textViewportRect.Width > 0 ? this._textViewportRect : r.Deflate(this.Padding), clip = ctx.PushClip(content);
        try {
            if (!this.Text && !this._composing)
                this.DrawText(ctx, this.Watermark || this.PlaceholderText, content, { Foreground: p.Muted, VerticalAlignment: this.AcceptsReturn ? 'Top' : 'Center' });
            const layout = this._LayoutText(), origin = this._TextOrigin(layout);
            if (this.IsFocused)
                for (const rect of layout.HitTestTextRange(Math.min(this.SelectionStart, this.SelectionEnd), Math.abs(this.SelectionEnd - this.SelectionStart)))
                    ctx.DrawRectangle(this.SelectionBrush ?? p.Selection, null, rect.Translate(origin));
            if (this.Text)
                ctx.DrawTextLayout(layout, origin);
            if (this.IsFocused && this.SelectionStart === this.SelectionEnd) {
                const caret = layout.HitTestTextPosition(this.CaretIndex).Translate(origin);
                if (ctx.DrawCaret) ctx.DrawCaret(this.CaretBrush ?? p.Text, new Rect(caret.X, caret.Y, 1, caret.Height));
                else ctx.DrawRectangle(this.CaretBrush ?? p.Text, null, new Rect(caret.X, caret.Y, 1, caret.Height));
            }
        }
        finally {
            clip.Dispose();
        }
    }
    _IndexFromPointer(e) {
        const p = e.GetPosition(this);
        const layout = this._LayoutText(), origin = this._TextOrigin(layout);
        return layout.HitTestPoint(new Point(p.X - origin.X, p.Y - origin.Y)).TextPosition;
    }
    OnPointerPressed(e) {
        if (!this.IsEffectivelyEnabled)
            return;
        this.Focus('Pointer');
        const index = this._IndexFromPointer(e);
        this.CaretIndex = index;
        if (!(e.KeyModifiers & 4))
            this.SelectionStart = index;
        this.SelectionEnd = index;
        if (e.ClickCount > 1) {
            const word = GetWordRange(this.Text, index);
            this.SelectionStart = word.Start;
            this.SelectionEnd = this.CaretIndex = word.End;
        }
        e.Pointer.Capture(this);
        this.GetVisualRoot()?._SyncTextInput?.(this);
        this.InvalidateVisual();
        e.Handled = true;
    }
    OnPointerMoved(e) {
        if (e.Pointer.Captured === this) {
            this.SelectionEnd = this.CaretIndex = this._IndexFromPointer(e);
            this.GetVisualRoot()?._SyncTextInput?.(this);
            this._EnsureCaretVisible();
            e.Handled = true;
        }
    }
    OnPointerReleased(e) {
        if (e.Pointer.Captured === this) {
            e.Pointer.Capture(null);
            e.Handled = true;
        }
    }
    OnKeyDown(e) {
        if(e.OriginalEvent?.BrowserEditorOwned&&(e.KeyModifiers&10)&&['a','c','x','v'].includes(e.Key.toLowerCase()))return;
        const command = e.KeyModifiers & 10, key = e.Key.toLowerCase();
        if (command && key === 'a') {
            this.SelectAll();
            e.Handled = true;
            return;
        }
        if (command && (key === 'z' || key === 'y')) {
            key === 'y' || (e.KeyModifiers & 4) ? this.Redo() : this.Undo();
            e.Handled = true;
            return;
        }
        // The browser's hidden textarea owns IME, native caret navigation, clipboard and edits.
        if (this.GetVisualRoot()?._UsesNativeTextInput)
            return;
        let index = this.CaretIndex;
        if (e.Key === 'Left')
            index = PreviousTextPosition(this.Text, index);
        else if (e.Key === 'Right')
            index = NextTextPosition(this.Text, index);
        else if (e.Key === 'Home')
            index = 0;
        else if (e.Key === 'End')
            index = this.Text.length;
        else if (e.Key === 'Back' || e.Key === 'Delete') {
            if (this.SelectionStart === this.SelectionEnd) {
                if (e.Key === 'Back')
                    this.SelectionStart = PreviousTextPosition(this.Text, index);
                else
                    this.SelectionEnd = NextTextPosition(this.Text, index);
            }
            this.ReplaceSelection('');
            e.Handled = true;
            return;
        }
        else if (e.Key === 'Enter' && this.AcceptsReturn) {
            this.ReplaceSelection('\n');
            e.Handled = true;
            return;
        }
        else
            return;
        this.SelectionEnd = this.CaretIndex = index;
        if (!(e.KeyModifiers & 4))
            this.SelectionStart = index;
        this._EnsureCaretVisible();
        e.Handled = true;
    }
    OnTextInput(e) {
        this.ReplaceSelection(e.Text);
        e.Handled = true;
    }
    OnGotFocus() {
        this._EnsureCaretVisible();
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'Text') {
            this._ensureCaretOnArrange = this.IsFocused;
            this.TextChanged?.Raise(this, { OldText: e.OldValue, NewText: e.NewValue });
            this.GetVisualRoot()?._SyncTextInput?.(this);
        }
        if (e.Property.Name === 'PasswordChar' || e.Property.Name === 'RevealPassword') {
            // Mask changes can alter glyph count/metrics without changing Text.
            // Synchronize a focused native editor immediately; otherwise a live
            // plain-text input can outlast a switch to password mode.
            this._ensureCaretOnArrange = this.IsFocused;
            this.InvalidateMeasure();
            this.GetVisualRoot()?._SyncTextInput?.(this);
        } else if (e.Property.Name === 'IsReadOnly') {
            this.GetVisualRoot()?._SyncTextInput?.(this);
        }
        if (['SelectionStart', 'SelectionEnd', 'CaretIndex'].includes(e.Property.Name)) {
            this.SelectionChanged?.Raise(this, {});
            this.InvalidateVisual();
        }
    }
}
DefineProperties(TextBox, { Text: ['', { Convert: v => String(v ?? ''), AffectsMeasure: true, DefaultBindingMode: BindingMode.TwoWay }], Watermark: ['', { Convert: String }], PlaceholderText: ['', { Convert: String }], AcceptsReturn: [false, { Convert: BooleanValue, AffectsMeasure: true }], AcceptsTab: [false, { Convert: BooleanValue }], TextWrapping: ['NoWrap', { AffectsMeasure: true }], TextAlignment: ['Left'], LineHeight: [NaN, { Convert: Number, AffectsMeasure: true }], IsReadOnly: [false, { Convert: BooleanValue }], MaxLength: [0, { Convert: Number }], PasswordChar: ['', { Convert: String }], RevealPassword: [false, { Convert: BooleanValue }], SelectionStart: [0, { Convert: Number }], SelectionEnd: [0, { Convert: Number }], CaretIndex: [0, { Convert: Number }], SelectionBrush: [null, { Convert: BrushValue }], CaretBrush: [null, { Convert: BrushValue }], IsUndoEnabled: [true, { Convert: BooleanValue }], UndoLimit: [100, { Convert: Number }] });
for (const name of ['HorizontalScrollBarVisibility', 'VerticalScrollBarVisibility', 'AllowAutoHide', 'IsDeferredScrollingEnabled', 'IsScrollChainingEnabled']) {
    const property = ScrollViewer[`${name}Property`].AddOwner(TextBox, name === 'HorizontalScrollBarVisibility' ? { DefaultValue: 'Auto' } : undefined);
    TextBox[`${name}Property`] = property;
    Object.defineProperty(TextBox.prototype, name, { configurable: true, get() { return this.GetValue(property); }, set(value) { this.SetValue(property, value); } });
}
export class ButtonSpinner extends ContentControl {
    constructor(content = null) {
        super(content);
        this.Focusable = true;
        this.Padding = new Thickness(8, 4, 28, 4);
        this.MinHeight = 34;
        this.Spin = new Event();
    }
    MeasureOverride(available) {
        const size = super.MeasureOverride(available);
        return new Size(Math.max(110, size.Width), Math.max(34, size.Height));
    }
    Render(ctx) {
        ctx.DrawRectangle(this.Background ?? this.Palette.Surface, new Pen(this.Palette.Border, 1), new Rect(this.Bounds.Size).Deflate(.5), 4);
        const x = this.Bounds.Width - 15, y = this.Bounds.Height / 4, pen = new Pen(this.Foreground, 1.3);
        ctx.DrawLine(pen, new Point(x - 4, y + 2), new Point(x, y - 2));
        ctx.DrawLine(pen, new Point(x, y - 2), new Point(x + 4, y + 2));
        ctx.DrawLine(pen, new Point(x - 4, y * 3 - 2), new Point(x, y * 3 + 2));
        ctx.DrawLine(pen, new Point(x, y * 3 + 2), new Point(x + 4, y * 3 - 2));
    }
    OnPointerPressed(e) {
        if (!this.IsEffectivelyEnabled || !this.AllowSpin)
            return;
        if (e.GetPosition(this).X > this.Bounds.Width - 28) {
            this.Spin.Raise(this, { Direction: e.GetPosition(this).Y < this.Bounds.Height / 2 ? 'Increase' : 'Decrease' });
            e.Handled = true;
        }
    }
    OnKeyDown(e) {
        if (this.AllowSpin && ['Up', 'Down'].includes(e.Key)) {
            this.Spin.Raise(this, { Direction: e.Key === 'Up' ? 'Increase' : 'Decrease' });
            e.Handled = true;
        }
    }
}
DefineProperties(ButtonSpinner, { AllowSpin: [true, { Convert: BooleanValue }], ShowButtonSpinner: [true, { Convert: BooleanValue }] });
export class NumericUpDown extends ButtonSpinner {
    constructor() {
        super();
        this._editor = new TextBox('0');
        this._editor.MinWidth = 40;
        this._editor.Padding = new Thickness(8, 5);
        this._editor.BorderBrush = Brushes.Transparent;
        this.Padding = new Thickness(0, 0, 28, 0);
        this.Content = this._editor;
        this.ValueChanged = new Event();
        this._lifetime.Add(this.Spin.Add((_, e) => this.SetCurrentValue(NumericUpDown.ValueProperty, (this.Value ?? 0) + (e.Direction === 'Increase' ? this.Increment : -this.Increment))));
        this._lifetime.Add(this._editor.TextChanged.Add(() => {
            if (this._updatingEditor)
                return;
            const value = Number(this._editor.Text);
            if (this._editor.Text.trim() && Number.isFinite(value))
                this.SetCurrentValue(NumericUpDown.ValueProperty, value);
        }));
        this._lifetime.Add(this._editor.LostFocus.Add(() => this._Format()));
    }
    _Format() {
        if (!this._editor)
            return;
        this._updatingEditor = true;
        try {
            this._editor.SetCurrentValue(TextBox.TextProperty, this.Value == null ? '' : this.FormatString ? new Intl.NumberFormat(undefined, { minimumFractionDigits: Number(/\d+/.exec(this.FormatString)?.[0] ?? 0), maximumFractionDigits: Number(/\d+/.exec(this.FormatString)?.[0] ?? 2) }).format(this.Value) : String(this.Value));
        }
        finally {
            this._updatingEditor = false;
        }
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'Value') {
            this._Format();
            this.ValueChanged?.Raise(this, { OldValue: e.OldValue, NewValue: e.NewValue });
        }
        if (['Minimum', 'Maximum'].includes(e.Property.Name))
            this.CoerceValue(NumericUpDown.ValueProperty);
    }
}
DefineProperties(NumericUpDown, { Value: [0, { Convert: v => v == null ? null : Number(v), DefaultBindingMode: BindingMode.TwoWay, Coerce: (o, v) => v == null ? null : MathUtilities.Clamp(v, o.Minimum, Math.max(o.Minimum, o.Maximum)) }], Minimum: [-Infinity, { Convert: Number }], Maximum: [Infinity, { Convert: Number }], Increment: [1, { Convert: Number }], FormatString: [''], ClipValueToMinMax: [true, { Convert: BooleanValue }] });
for (const [property, value] of [[Control.PaddingProperty, new Thickness(14, 8)], [Control.CornerRadiusProperty, new CornerRadius(4)], [Control.HorizontalContentAlignmentProperty, 'Center'], [Control.VerticalContentAlignmentProperty, 'Center'], [Control.MinHeightProperty, 34], [Control.MinWidthProperty, 64]])
    property.OverrideDefaultValue(Button, value);
