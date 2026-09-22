import { TemplatedControl } from './templated-control.js';
export { TemplatedControl } from './templated-control.js';
import { ScrollChrome, ScrollBarVisibility } from './scroll-bar.js';
import { ScrollGestureRecognizer } from './gestures.js';
import { InlineCollection, Inline, InlineUIContainer, FlattenInlines } from './documents.js';
import { DefineProperties, Size, Rect, Point, Matrix, Thickness, MathUtilities, BindingPriority, Disposable, Event, AvaloniaProperty } from '@wieslawsoltes/avalonia-base';
import { TextLayout, Pen, Brushes, Geometry, StreamGeometry, RectangleGeometry, EllipseGeometry, LineGeometry, DrawingImage, Bitmap, Typeface, TransformOperations, GetTextServiceVersion } from '@wieslawsoltes/avalonia-media';
import { Control, BooleanValue, BrushValue, NameScope, DefineRoutedEvent, RoutedEventArgs } from './core.js';
export class TextBlock extends Control {
    constructor(text = '') {
        super();
        if (text)
            this.Text = text;
        this._textLayout = null;
        this.Inlines = new InlineCollection(this);
    }
    get EffectiveText() { return this.Inlines?.Count ? FlattenInlines(this.Inlines).Text : this.Text; }
    _ResetTextLayout() { this._textLayout?.Dispose(); this._textLayout = null; }
    _InvalidateInlines() { this._ResetTextLayout(); this._SyncInlineControls(); this.InvalidateMeasure(); this.InvalidateVisual(); }
    _SyncInlineControls() {
        if (!this.Inlines || this._syncingInlines) return;
        this._syncingInlines = true;
        try {
            const controls = new Set(FlattenInlines(this.Inlines).Runs.filter(r => r.Child).map(r => r.Child));
            for (const child of this._inlineControls ?? []) if (!controls.has(child)) this.RemoveVisualChild(child);
            for (const child of controls) if (!this._inlineControls?.has(child)) this.AddVisualChild(child);
            this._inlineControls = controls;
        } finally { this._syncingInlines = false; }
    }
    Dispose() { if (this.IsDisposed) return; this._ResetTextLayout(); this.Inlines?.Dispose(); super.Dispose(); }
    InvalidateMeasure() { this._ResetTextLayout(); super.InvalidateMeasure(); }
    OnPropertyChanged(change) {
        if (['Text', 'Foreground', 'FontFamily', 'FontSize', 'FontWeight', 'FontStyle', 'FontStretch', 'LetterSpacing', 'TextWrapping', 'TextTrimming', 'TextAlignment', 'LineHeight', 'MaxLines', 'FlowDirection'].includes(change.Property.Name)) this._ResetTextLayout();
        super.OnPropertyChanged(change);
    }
    OnRenderResourceChanged(name) { if (name === 'Foreground') this._ResetTextLayout(); }
    GetTextLayout(width = Infinity) {
        width = Math.max(0, width);
        const version = GetTextServiceVersion();
        if (this._textLayout && Object.is(this._textLayoutWidth, width) && this._textServiceVersion === version) return this._textLayout;
        this._ResetTextLayout();
        this._textLayoutWidth = width; this._textServiceVersion = version;
        return this._textLayout = this.CreateTextLayout(width);
    }
    get TextLayout() { return this.GetTextLayout(Math.max(0, this.Bounds.Width - this.Padding.Horizontal)); }
    CreateTextLayout(width = Infinity) {
        const rich = this.Inlines?.Count ? FlattenInlines(this.Inlines) : null;
        for (const run of rich?.Runs ?? []) if (run.Child) { run.Child.Measure(new Size(width, Infinity)); run.InlineSize = run.Child.DesiredSize; }
        return new TextLayout(rich?.Text ?? this.Text, this.Typeface, this.FontSize, this.Foreground, { TextRuns: rich?.Runs, MaxWidth: width, TextWrapping: this.TextWrapping, TextTrimming: this.TextTrimming, TextAlignment: this.TextAlignment, LineHeight: this.LineHeight, MaxLines: this.MaxLines, FlowDirection: this.FlowDirection, LetterSpacing: this.LetterSpacing });
    }
    MeasureOverride(available) {
        this._textLayout = this.GetTextLayout(available.Deflate(this.Padding).Width);
        return this._textLayout.Size.Inflate(this.Padding);
    }
    ArrangeOverride(size) {
        this._textLayout = this.GetTextLayout(Math.max(0, size.Width - this.Padding.Horizontal));
        for (const run of this._textLayout.TextRuns ?? []) if (run.Child) {
            const bounds = this._textLayout.GetInlineBounds(run.Start);
            run.Child.Arrange(bounds.Translate(new Point(this.Padding.Left, this.Padding.Top)));
        }
        return size;
    }
    Render(context) {
        super.Render(context);
        const rect = new Rect(this.Bounds.Size).Deflate(this.Padding);
        const layout = this.GetTextLayout(rect.Width);
        context.DrawTextLayout(layout, rect.Position);
        if (this.TextDecorations) {
            for (const l of layout.TextLines) {
                const y = this.TextDecorations.includes('Strikethrough') ? l.Y + l.Baseline * .65 : l.Y + l.Baseline + 2;
                context.DrawLine(new Pen(this.Foreground, Math.max(1, this.FontSize / 14)), new Point(rect.X + l.X, rect.Y + y), new Point(rect.X + l.X + l.Width, rect.Y + y));
            }
        }
    }
}
DefineProperties(TextBlock, { Text: ['', { Convert: v => String(v ?? ''), AffectsMeasure: true }], TextWrapping: ['NoWrap', { AffectsMeasure: true }], TextTrimming: ['None', { AffectsMeasure: true }], TextAlignment: ['Left'], LineHeight: [NaN, { Convert: Number, AffectsMeasure: true }], MaxLines: [0, { Convert: Number, AffectsMeasure: true }], TextDecorations: [null] });
export class SelectableTextBlock extends TextBlock {
    constructor(text = '') {
        super(text);
        this.Focusable = true;
        this.SelectionStart = 0;
        this.SelectionEnd = 0;
    }
    get SelectedText() {
        return this.EffectiveText.slice(Math.min(this.SelectionStart, this.SelectionEnd), Math.max(this.SelectionStart, this.SelectionEnd));
    }
    SelectAll() {
        this.SelectionStart = 0;
        this.SelectionEnd = this.EffectiveText.length;
        this.InvalidateVisual();
    }
    OnPointerPressed(e) {
        this.Focus('Pointer');
        const q = e.GetPosition(this), p = new Point(q.X - this.Padding.Left, q.Y - this.Padding.Top);
        const hit = this.GetTextLayout(this.Bounds.Width - this.Padding.Horizontal).HitTestPoint(p).TextPosition;
        this.SelectionStart = this.SelectionEnd = hit;
        e.Pointer.Capture(this);
        e.Handled = true;
        this.InvalidateVisual();
    }
    OnPointerMoved(e) {
        if (e.Pointer.Captured === this) {
            const p = e.GetPosition(this);
            this.SelectionEnd = this.GetTextLayout(this.Bounds.Width - this.Padding.Horizontal).HitTestPoint(new Point(p.X - this.Padding.Left, p.Y - this.Padding.Top)).TextPosition;
            this.InvalidateVisual();
        }
    }
    OnPointerReleased(e) {
        if (e.Pointer.Captured === this)
            e.Pointer.Capture(null);
    }
    OnKeyDown(e) {
        if ((e.KeyModifiers & 10) && e.Key.toLowerCase() === 'a') {
            this.SelectAll();
            e.Handled = true;
        }
        if ((e.KeyModifiers & 10) && e.Key.toLowerCase() === 'c') {
            this.GetVisualRoot()?.Clipboard?.SetTextAsync(this.SelectedText);
            e.Handled = true;
        }
    }
    Render(ctx) {
        const layout = this.GetTextLayout(this.Bounds.Width - this.Padding.Horizontal);
        for (const r of layout.HitTestTextRange(Math.min(this.SelectionStart, this.SelectionEnd), Math.abs(this.SelectionEnd - this.SelectionStart)))
            ctx.DrawRectangle(this.Palette.Selection, null, r.Translate(new Point(this.Padding.Left, this.Padding.Top)));
        super.Render(ctx);
    }
}
export class Label extends TextBlock {
    constructor(content = '') {
        super();
        this.Content = content;
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'Content')
            this.Text = String(e.NewValue ?? '').replace(/_(.)/, '$1');
    }
    OnPointerPressed() {
        this.Target?.Focus?.();
    }
}
DefineProperties(Label, { Content: ['', { AffectsMeasure: true }], Target: [null] });
export class Decorator extends Control {
    constructor(child = null) {
        super();
        if (child)
            this.Child = child;
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'Child') {
            if (e.OldValue)
                this.RemoveVisualChild(e.OldValue);
            if (e.NewValue)
                this.AddVisualChild(e.NewValue);
        }
    }
    MeasureOverride(available) {
        if (!this.Child)
            return Size.Empty;
        this.Child.Measure(available.Deflate(this.Padding));
        return this.Child.DesiredSize.Inflate(this.Padding);
    }
    ArrangeOverride(size) {
        this.Child?.Arrange(new Rect(size).Deflate(this.Padding));
        return size;
    }
}
DefineProperties(Decorator, { Child: [null, { AffectsMeasure: true }] });
export class Border extends Decorator {
    _Inset() {
        const p = this.Padding, b = this.BorderThickness;
        return new Thickness(p.Left + b.Left, p.Top + b.Top, p.Right + b.Right, p.Bottom + b.Bottom);
    }
    MeasureOverride(available) {
        const inset = this._Inset();
        this.Child?.Measure(available.Deflate(inset));
        return (this.Child?.DesiredSize ?? Size.Empty).Inflate(inset);
    }
    ArrangeOverride(size) {
        this.Child?.Arrange(new Rect(size).Deflate(this._Inset()));
        return size;
    }
    Render(ctx) {
        const b = this.BorderThickness, r = new Rect(this.Bounds.Size);
        if (b.IsUniform) {
            const thickness = b.Left;
            ctx.DrawRectangle(this.Background, this.BorderBrush && thickness > 0 ? new Pen(this.BorderBrush, thickness) : null, r.Deflate(thickness / 2), this.CornerRadius.TopLeft);
        }
        else {
            if (this.BorderBrush)
                ctx.DrawRectangle(this.BorderBrush, null, r, this.CornerRadius.TopLeft);
            if (this.Background)
                ctx.DrawRectangle(this.Background, null, r.Deflate(b), Math.max(0, this.CornerRadius.TopLeft - Math.max(b.Left, b.Top)));
        }
    }
}
export class ControlTemplate {
    constructor(build = null) {
        this._build = build;
        this.TargetType = null;
    }
    Build(owner) {
        if (!this._build)
            throw new Error('ControlTemplate has no builder.');
        const scope = new NameScope(), control = this._build(owner, scope);
        if (!(control instanceof Control))
            throw new TypeError('A ControlTemplate must build a Control.');
        NameScope.SetNameScope(control, scope);
        for (const child of [control, ...control.GetVisualDescendants()]) {
            child.TemplatedParent = owner;
            if (child.Name)
                scope.Register(child.Name, child);
        }
        scope.Complete();
        return { Control: control, NameScope: scope };
    }
}
export class DataTemplate {
    constructor(build = null, dataType = null) {
        this._build = build;
        this.DataType = dataType;
        this.SupportsRecycling = false;
    }
    Match(data) {
        return !this.DataType || typeof this.DataType === 'function' && data instanceof this.DataType;
    }
    Build(data) {
        if (!this._build)
            throw new Error('DataTemplate has no builder.');
        const result = this._build(data);
        result.DataContext = data;
        return result;
    }
}
export class TreeDataTemplate extends DataTemplate {
    constructor(build, itemsSelector = item => item.Children) {
        super(build);
        this.ItemsSelector = itemsSelector;
    }
}
export class ItemsPanelTemplate {
    constructor(build) {
        this._build = build;
    }
    Build() {
        return this._build();
    }
}
export class ContentControl extends TemplatedControl {
    constructor(content = null) {
        super();
        this._contentChild = null;
        this._contentOwned = false; this._contentIsText = false;
        if (content != null)
            this.Content = content;
    }
    get Presenter() {
        return this._contentChild;
    }
    ApplyTemplate() {
        const changed = this.Template !== this._appliedTemplate;
        if (changed && this.Template && this._contentChild) {
            const old = this._contentChild;
            this.RemoveVisualChild(old);
            if (this._contentOwned)
                old.Dispose();
            this._contentChild = null;
            this._contentOwned = false;
        }
        const result = super.ApplyTemplate();
        if (changed && !this.Template)
            this._BuildContent();
        return result;
    }
    _BuildContent() {
        const next = this.Content;
        // Default scalar text is an owned presenter, not a template instance.
        // Update it in place rather than detaching/recreating a complete visual
        // on every command counter update or recycled list row.
        if (!this.Template && !this.ContentTemplate && this._contentIsText && this._contentChild instanceof TextBlock &&
            next != null && !(next instanceof Control) && !this._FindDataTemplate(next)) {
            this._contentChild.Text = String(next); this.InvalidateMeasure(); return;
        }
        this._contentIsText = false;
        if (this._contentChild) {
            const old = this._contentChild;
            this.RemoveVisualChild(old);
            if (this._contentOwned)
                old.Dispose();
        }
        this._contentChild = null;
        this._contentOwned = false;
        if (this.Template) {
            this.InvalidateMeasure();
            return;
        }
        const content = this.Content;
        if (content == null) {
            this.InvalidateMeasure();
            return;
        }
        if (this.ContentTemplate) {
            this._contentChild = this.ContentTemplate.Build(content);
            this._contentOwned = true;
        }
        else if (content instanceof Control)
            this._contentChild = content;
        else {
            const template = this._FindDataTemplate(content);
            this._contentChild = template ? template.Build(content) : new TextBlock(String(content));
            this._contentIsText = !template;
            this._contentOwned = true;
        }
        this.AddVisualChild(this._contentChild);
        this.InvalidateMeasure();
    }
    _FindDataTemplate(data) {
        for (let node = this; node; node = node.Parent)
            for (const template of node.DataTemplates ?? [])
                if (template.Match(data))
                    return template;
        return null;
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'Content' || e.Property.Name === 'ContentTemplate')
            this._BuildContent();
    }
    MeasureOverride(available) {
        if (this._templateRoot)
            return super.MeasureOverride(available);
        this._contentChild?.Measure(available.Deflate(this.Padding));
        return (this._contentChild?.DesiredSize ?? Size.Empty).Inflate(this.Padding);
    }
    ArrangeOverride(size) {
        if (this._templateRoot)
            return super.ArrangeOverride(size);
        if (this._contentChild) {
            const rect = new Rect(size).Deflate(this.Padding);
            let w = rect.Width, h = rect.Height, x = rect.X, y = rect.Y;
            if (this.HorizontalContentAlignment !== 'Stretch') {
                w = Math.min(w, this._contentChild.DesiredSize.Width);
                x += (rect.Width - w) * (this.HorizontalContentAlignment === 'Center' ? .5 : this.HorizontalContentAlignment === 'Right' ? 1 : 0);
            }
            if (this.VerticalContentAlignment !== 'Stretch') {
                h = Math.min(h, this._contentChild.DesiredSize.Height);
                y += (rect.Height - h) * (this.VerticalContentAlignment === 'Center' ? .5 : this.VerticalContentAlignment === 'Bottom' ? 1 : 0);
            }
            this._contentChild.Arrange(new Rect(x, y, w, h));
        }
        return size;
    }
}
DefineProperties(ContentControl, { Content: [null, { AffectsMeasure: true }], ContentTemplate: [null, { AffectsMeasure: true }] });
export class ContentPresenter extends ContentControl {
}
export class UserControl extends ContentControl {
}
export class HeaderedContentControl extends ContentControl {
    constructor() {
        super();
        this._headerChild = null;
    }
    _BuildHeader() {
        if (this._headerChild) {
            this.RemoveVisualChild(this._headerChild);
            if (this._headerOwned)
                this._headerChild.Dispose();
        }
        this._headerOwned = !(this.Header instanceof Control);
        this._headerChild = this.Header == null ? null : this.HeaderTemplate ? this.HeaderTemplate.Build(this.Header) : this.Header instanceof Control ? this.Header : new TextBlock(String(this.Header));
        if (this._headerChild)
            this.AddVisualChild(this._headerChild);
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'Header' || e.Property.Name === 'HeaderTemplate')
            this._BuildHeader();
    }
    MeasureOverride(available) {
        this._headerChild?.Measure(available);
        const content = super.MeasureOverride(available);
        return new Size(Math.max(content.Width, this._headerChild?.DesiredSize.Width ?? 0), content.Height + (this._headerChild?.DesiredSize.Height ?? 0) + (this._headerChild ? this.HeaderSpacing : 0));
    }
    ArrangeOverride(size) {
        const h = this._headerChild?.DesiredSize.Height ?? 0;
        this._headerChild?.Arrange(new Rect(0, 0, size.Width, h));
        this._contentChild?.Arrange(new Rect(0, h + (this._headerChild ? this.HeaderSpacing : 0), size.Width, Math.max(0, size.Height - h - this.HeaderSpacing)).Deflate(this.Padding));
        return size;
    }
}
DefineProperties(HeaderedContentControl, { Header: [null, { AffectsMeasure: true }], HeaderTemplate: [null, { AffectsMeasure: true }], HeaderSpacing: [8, { Convert: Number, AffectsMeasure: true }] });
export class Expander extends HeaderedContentControl {
    constructor() {
        super();
        this.Focusable = true;
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'IsExpanded') {
            if (this._contentChild)
                this._contentChild.IsVisible = e.NewValue;
            this.PseudoClasses.Set(':expanded', e.NewValue);
            this.RaiseEvent(new RoutedEventArgs(e.NewValue ? Expander.ExpandedEvent : Expander.CollapsedEvent, this));
        }
    }
    _BuildContent() {
        super._BuildContent();
        if (this._contentChild)
            this._contentChild.IsVisible = this.IsExpanded;
    }
    MeasureOverride(available) {
        const result = super.MeasureOverride(available);
        return new Size(Math.max(result.Width + 40, 160), Math.max(42, this.IsExpanded ? result.Height + 18 : 42));
    }
    ArrangeOverride(size) {
        this._headerChild?.Arrange(new Rect(34, 0, Math.max(0, size.Width - 44), 42));
        if (this.IsExpanded)
            this._contentChild?.Arrange(new Rect(12, 48, Math.max(0, size.Width - 24), Math.max(0, size.Height - 54)));
        return size;
    }
    Render(ctx) {
        ctx.DrawRectangle(this.Background ?? this.Palette.Surface, new Pen(this.Palette.Border, 1), new Rect(this.Bounds.Size).Deflate(.5), 5);
        const p = new Pen(this.Foreground, 1.5);
        if (this.IsExpanded) {
            ctx.DrawLine(p, new Point(13, 18), new Point(18, 23));
            ctx.DrawLine(p, new Point(18, 23), new Point(23, 18));
        }
        else {
            ctx.DrawLine(p, new Point(16, 15), new Point(21, 20));
            ctx.DrawLine(p, new Point(21, 20), new Point(16, 25));
        }
    }
    OnPointerPressed(e) {
        if (e.GetPosition(this).Y < 42 && this.IsEffectivelyEnabled) {
            this.Focus('Pointer');
            this.SetCurrentValue(Expander.IsExpandedProperty, !this.IsExpanded);
            e.Handled = true;
        }
    }
    OnKeyDown(e) {
        if (['Enter', 'Space'].includes(e.Key)) {
            this.SetCurrentValue(Expander.IsExpandedProperty, !this.IsExpanded);
            e.Handled = true;
        }
    }
}
DefineProperties(Expander, { IsExpanded: [false, { Convert: BooleanValue, AffectsMeasure: true, DefaultBindingMode: 'TwoWay' }], ExpandDirection: ['Down', { AffectsMeasure: true }] });
DefineRoutedEvent(Expander, 'Expanded');
DefineRoutedEvent(Expander, 'Collapsed');
export class ScrollChangedEventArgs {
    constructor(extent, viewport, offset, previous = {}) {
        this.Extent = extent; this.Viewport = viewport; this.Offset = offset;
        const e = previous.Extent ?? Size.Empty, v = previous.Viewport ?? Size.Empty, o = previous.Offset ?? new Point();
        this.ExtentDelta = new Size(extent.Width - e.Width, extent.Height - e.Height);
        this.ViewportDelta = new Size(viewport.Width - v.Width, viewport.Height - v.Height);
        this.OffsetDelta = new Point(offset.X - o.X, offset.Y - o.Y);
    }
}
export class ScrollViewer extends ContentControl {
    constructor(content = null) {
        super(content);
        this.ClipToBounds = true; this.Focusable = true; this.IsTabStop = false;
        this._extent = Size.Empty; this._viewport = Size.Empty; this._viewportRect = Rect.Empty;
        this.ScrollChanged = new Event();
        this._chrome = new ScrollChrome(this, offset => this.SetCurrentValue(ScrollViewer.OffsetProperty, this._Clamp(offset)));
        this._touchScroll = new ScrollGestureRecognizer();
        this._touchScroll.IsScrollInertiaEnabled = true;
        this.GestureRecognizers.Add(this._touchScroll);
        this._lifetime.Add(this.ScrollGesture.Add((_, e) => {
            const next = this._Clamp(new Point(this.Offset.X + e.Delta.X, this.Offset.Y + e.Delta.Y));
            if (!next.Equals(this.Offset)) { this.SetCurrentValue(ScrollViewer.OffsetProperty, next); e.Handled = true; }
            else if (this._touchScroll._gestureId === e.Id) e.ShouldEndScrollGesture = true;
        }));
        this._UpdateScrollGesture();
    }
    get Extent() { return this._extent ?? Size.Empty; }
    get Viewport() { return this._viewport ?? Size.Empty; }
    get ScrollBarMaximum() { return new Point(Math.max(0, this.Extent.Width - this.Viewport.Width), Math.max(0, this.Extent.Height - this.Viewport.Height)); }
    get SmallChange() { return new Point(16, 16); }
    get LargeChange() { return new Point(this.Viewport.Width, this.Viewport.Height); }
    get HorizontalScrollBar() { return this._chrome.Horizontal; }
    get VerticalScrollBar() { return this._chrome.Vertical; }
    GetChildClip(child) { return child === this._contentChild ? this._viewportRect : null; }
    _UpdateScrollGesture() {
        const gesture = this._touchScroll;
        if (!gesture) return;
        gesture.CanHorizontallyScroll = this.HorizontalScrollBarVisibility !== 'Disabled';
        gesture.CanVerticallyScroll = this.VerticalScrollBarVisibility !== 'Disabled';
        gesture.Offset = this.Offset; gesture.Extent = this.Extent; gesture.Viewport = this.Viewport;
    }
    _Clamp(offset) {
        const max = this.ScrollBarMaximum;
        const clamp = (n, limit) => MathUtilities.Clamp(Number.isNaN(n) ? 0 : n, 0, limit);
        return new Point(this.HorizontalScrollBarVisibility === 'Disabled' ? 0 : clamp(offset.X, max.X),
            this.VerticalScrollBarVisibility === 'Disabled' ? 0 : clamp(offset.Y, max.Y));
    }
    _MeasureViewport(available) {
        const area = available.Deflate(this.Padding), thickness = this.ScrollBarThickness, overlay = this.AllowAutoHide;
        const hMode = this.HorizontalScrollBarVisibility, vMode = this.VerticalScrollBarVisibility;
        let showH = hMode === 'Visible', showV = vMode === 'Visible', viewport = area, extent = Size.Empty;
        // Reserving one track can create overflow in the other axis. Iterate to a
        // fixed point; overlay chrome does not reduce the available content size.
        for (let i = 0; i < 4; ++i) {
            viewport = new Size(Math.max(0, area.Width - (!overlay && showV ? thickness : 0)), Math.max(0, area.Height - (!overlay && showH ? thickness : 0)));
            this._contentChild?.Measure(new Size(hMode === 'Disabled' ? viewport.Width : Infinity, vMode === 'Disabled' ? viewport.Height : Infinity));
            extent = this._contentChild?.DesiredSize ?? Size.Empty;
            const h = hMode === 'Visible' || hMode === 'Auto' && extent.Width > viewport.Width + .001;
            const v = vMode === 'Visible' || vMode === 'Auto' && extent.Height > viewport.Height + .001;
            if (h === showH && v === showV) break;
            showH = h; showV = v;
        }
        return { Viewport: viewport, Extent: extent, ReserveX: !overlay && showV ? thickness : 0, ReserveY: !overlay && showH ? thickness : 0 };
    }
    MeasureOverride(available) {
        const result = this._MeasureViewport(available);
        this.SetAndRaise(ScrollViewer.ExtentProperty, '_extent', result.Extent);
        return new Size(result.Extent.Width + result.ReserveX, result.Extent.Height + result.ReserveY).Inflate(this.Padding).Constrain(available);
    }
    ArrangeOverride(size) {
        const result = this._MeasureViewport(size);
        this.SetAndRaise(ScrollViewer.ExtentProperty, '_extent', result.Extent);
        this.SetAndRaise(ScrollViewer.ViewportProperty, '_viewport', result.Viewport);
        this._viewportRect = new Rect(this.Padding.Left, this.Padding.Top, result.Viewport.Width, result.Viewport.Height);
        const offset = this._Clamp(this.Offset);
        if (!offset.Equals(this.Offset)) this.SetCurrentValue(ScrollViewer.OffsetProperty, offset);
        this._contentChild?.Arrange(new Rect(this.Padding.Left - offset.X, this.Padding.Top - offset.Y,
            Math.max(result.Viewport.Width, this.Extent.Width), Math.max(result.Viewport.Height, this.Extent.Height)));
        this._chrome.Sync(this._viewportRect, this.Extent, offset, {
            Horizontal: this.HorizontalScrollBarVisibility, Vertical: this.VerticalScrollBarVisibility,
            AllowAutoHide: this.AllowAutoHide, Overlay: this.AllowAutoHide, Thickness: this.ScrollBarThickness,
            Deferred: this.IsDeferredScrollingEnabled, SmallChange: this.SmallChange
        });
        this._UpdateScrollGesture(); this._NotifyScrollChanged();
        return size;
    }
    _NotifyScrollChanged() {
        const now = { Extent: this.Extent, Viewport: this.Viewport, Offset: this.Offset }, prior = this._reportedScroll;
        if (!prior || !prior.Extent.Equals(now.Extent) || !prior.Viewport.Equals(now.Viewport) || !prior.Offset.Equals(now.Offset)) {
            this._reportedScroll = now;
            this.ScrollChanged?.Raise(this, new ScrollChangedEventArgs(now.Extent, now.Viewport, now.Offset, prior));
        }
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property === ScrollViewer.ExtentProperty || e.Property === ScrollViewer.ViewportProperty) {
            const extent = e.Property === ScrollViewer.ExtentProperty ? e.OldValue ?? Size.Empty : this.Extent;
            const viewport = e.Property === ScrollViewer.ViewportProperty ? e.OldValue ?? Size.Empty : this.Viewport;
            this._RaiseChange(ScrollViewer.ScrollBarMaximumProperty,
                new Point(Math.max(0,extent.Width-viewport.Width),Math.max(0,extent.Height-viewport.Height)),
                this.ScrollBarMaximum, BindingPriority.LocalValue);
            if (e.Property === ScrollViewer.ViewportProperty)
                this._RaiseChange(ScrollViewer.LargeChangeProperty,new Point(viewport.Width,viewport.Height),this.LargeChange,BindingPriority.LocalValue);
        }
        if (['Offset', 'Extent', 'Viewport', 'HorizontalScrollBarVisibility', 'VerticalScrollBarVisibility'].includes(e.Property.Name)) this._UpdateScrollGesture();
        if (e.Property.Name === 'Offset') {
            if (this._chrome) this._chrome.Offset = e.NewValue;
            this.InvalidateArrange(); this.InvalidateVisual();
        }
    }
    OnPointerWheelChanged(e) {
        const old = this.Offset, pixels = e.GetPixelDelta?.(this.Viewport, 48);
        let dx = pixels?.X ?? -e.Delta.X * 48, dy = pixels?.Y ?? -e.Delta.Y * 48;
        if (e.KeyModifiers & 4 && !dx) { dx = dy; dy = 0; }
        if (this.VerticalScrollBarVisibility === 'Disabled' && this.HorizontalScrollBarVisibility !== 'Disabled' && !dx) { dx = dy; dy = 0; }
        const next = this._Clamp(new Point(old.X + dx, old.Y + dy));
        if (!old.Equals(next)) { this.SetCurrentValue(ScrollViewer.OffsetProperty, next); e.Handled = true; }
        else if (!this.IsScrollChainingEnabled) e.Handled = true;
    }
    OnPointerPressed(e) { if (e.Source === this) this.Focus('Pointer'); }
    OnKeyDown(e) {
        let dx = 0, dy = 0;
        if (e.Key === 'Down') dy = this.SmallChange.Y;
        else if (e.Key === 'Up') dy = -this.SmallChange.Y;
        else if (e.Key === 'Right') dx = this.SmallChange.X;
        else if (e.Key === 'Left') dx = -this.SmallChange.X;
        else if (e.Key === 'PageDown') dy = this.Viewport.Height;
        else if (e.Key === 'PageUp') dy = -this.Viewport.Height;
        else if (e.Key === 'Home') { this.ScrollToHome(); e.Handled = true; return; }
        else if (e.Key === 'End') { this.ScrollToEnd(); e.Handled = true; return; }
        else return;
        const next = this._Clamp(new Point(this.Offset.X + dx, this.Offset.Y + dy));
        if (!next.Equals(this.Offset)) { this.SetCurrentValue(ScrollViewer.OffsetProperty, next); e.Handled = true; }
    }
    _VerticalThumb() { const b = this.VerticalScrollBar; return b.IsVisible ? b.GetThumbBounds().Translate(b.Bounds.Position) : null; }
    _HorizontalThumb() { const b = this.HorizontalScrollBar; return b.IsVisible ? b.GetThumbBounds().Translate(b.Bounds.Position) : null; }
    ScrollToHome() { this.SetCurrentValue(ScrollViewer.OffsetProperty, new Point()); }
    ScrollToEnd() { this.SetCurrentValue(ScrollViewer.OffsetProperty, this._Clamp(new Point(Infinity, Infinity))); }
    ScrollToHorizontalOffset(value) { this.SetCurrentValue(ScrollViewer.OffsetProperty, this._Clamp(new Point(value, this.Offset.Y))); }
    ScrollToVerticalOffset(value) { this.SetCurrentValue(ScrollViewer.OffsetProperty, this._Clamp(new Point(this.Offset.X, value))); }
    LineUp() { this.ScrollToVerticalOffset(this.Offset.Y - this.SmallChange.Y); }
    LineDown() { this.ScrollToVerticalOffset(this.Offset.Y + this.SmallChange.Y); }
    LineLeft() { this.ScrollToHorizontalOffset(this.Offset.X - this.SmallChange.X); }
    LineRight() { this.ScrollToHorizontalOffset(this.Offset.X + this.SmallChange.X); }
    PageUp() { this.ScrollToVerticalOffset(this.Offset.Y - this.Viewport.Height); }
    PageDown() { this.ScrollToVerticalOffset(this.Offset.Y + this.Viewport.Height); }
    PageLeft() { this.ScrollToHorizontalOffset(this.Offset.X - this.Viewport.Width); }
    PageRight() { this.ScrollToHorizontalOffset(this.Offset.X + this.Viewport.Width); }
    BringIntoView(control, rect = new Rect(control.Bounds.Size)) {
        if (control !== this._contentChild && !control.GetVisualAncestors().includes(this._contentChild)) return false;
        const matrix = control.TransformToVisual(this); if (!matrix) return false;
        const r = rect.TransformToAABB(matrix), v = this._viewportRect;
        const bring = (offset, a, b, low, high) => a < low ? offset + a - low : b > high ? offset + Math.min(b - high, a - low) : offset;
        const next = this._Clamp(new Point(bring(this.Offset.X, r.Left, r.Right, v.Left, v.Right), bring(this.Offset.Y, r.Top, r.Bottom, v.Top, v.Bottom)));
        if (!next.Equals(this.Offset)) this.SetCurrentValue(ScrollViewer.OffsetProperty, next);
        return true;
    }
    Dispose() { if (this.IsDisposed) return; this.ScrollChanged?.Clear(); super.Dispose(); }
}
for (const name of ['Extent', 'Viewport', 'ScrollBarMaximum', 'SmallChange', 'LargeChange'])
    ScrollViewer[`${name}Property`] = AvaloniaProperty.RegisterDirect(ScrollViewer, name, o => o[name]);
DefineProperties(ScrollViewer, {
    Offset: [new Point(), { Convert: v => v instanceof Point ? v : Point.Parse(v), Validate: v => !Number.isNaN(v.X) && !Number.isNaN(v.Y), AffectsArrange: true, DefaultBindingMode: 'TwoWay' }],
    HorizontalScrollBarVisibility: ['Disabled', { Validate: v => Object.hasOwn(ScrollBarVisibility, v), AffectsMeasure: true }],
    VerticalScrollBarVisibility: ['Auto', { Validate: v => Object.hasOwn(ScrollBarVisibility, v), AffectsMeasure: true }],
    AllowAutoHide: [true, { Convert: BooleanValue, AffectsMeasure: true }],
    IsDeferredScrollingEnabled: [false, { Convert: BooleanValue }], IsScrollChainingEnabled: [true, { Convert: BooleanValue }],
    ScrollBarThickness: [16, { Convert: Number, Validate: v => Number.isFinite(v) && v >= 0, AffectsMeasure: true }]
});
for (const name of ['HorizontalScrollBarVisibility', 'VerticalScrollBarVisibility', 'AllowAutoHide', 'IsDeferredScrollingEnabled', 'IsScrollChainingEnabled']) {
    ScrollViewer[`Get${name}`] = target => target.GetValue(ScrollViewer[`${name}Property`]);
    ScrollViewer[`Set${name}`] = (target, value) => target.SetValue(ScrollViewer[`${name}Property`], value);
    ScrollViewer[`${name}Property`].IsAttached = true;
}
export class Viewbox extends Decorator {
    MeasureOverride(available) {
        this.Child?.Measure(Size.Infinity);
        const natural = this.Child?.DesiredSize ?? Size.Empty, scale = this._Scale(available, natural);
        return new Size(natural.Width * scale.X, natural.Height * scale.Y);
    }
    _Scale(available, natural) {
        let x = natural.Width ? available.Width / natural.Width : 1, y = natural.Height ? available.Height / natural.Height : 1;
        if (!Number.isFinite(x))
            x = y;
        if (!Number.isFinite(y))
            y = x;
        if (!Number.isFinite(x) || !Number.isFinite(y))
            x = y = 1;
        if (this.Stretch === 'None')
            x = y = 1;
        else if (this.Stretch === 'Uniform')
            x = y = Math.min(x, y);
        else if (this.Stretch === 'UniformToFill')
            x = y = Math.max(x, y);
        if (this.StretchDirection === 'UpOnly') {
            x = Math.max(1, x);
            y = Math.max(1, y);
        }
        if (this.StretchDirection === 'DownOnly') {
            x = Math.min(1, x);
            y = Math.min(1, y);
        }
        return new Point(x, y);
    }
    ArrangeOverride(size) {
        if (this.Child) {
            const n = this.Child.DesiredSize, s = this._Scale(size, n);
            this.Child.RenderTransformOrigin = new (this.Child.RenderTransformOrigin.constructor)(0, 0);
            this.Child.RenderTransform = Matrix.CreateScale(s.X, s.Y);
            this.Child.Arrange(new Rect((size.Width - n.Width * s.X) / 2, (size.Height - n.Height * s.Y) / 2, n.Width, n.Height));
        }
        return size;
    }
}
DefineProperties(Viewbox, { Stretch: ['Uniform', { AffectsMeasure: true }], StretchDirection: ['Both', { AffectsMeasure: true }] });
export class LayoutTransformControl extends Decorator {
    MeasureOverride(available) {
        this.Child?.Measure(available);
        const rect = new Rect(this.Child?.DesiredSize ?? Size.Empty).TransformToAABB(this.LayoutTransform?.Value ?? this.LayoutTransform ?? Matrix.Identity);
        return rect.Size;
    }
    ArrangeOverride(size) {
        if (this.Child) {
            const m = this.LayoutTransform?.Value ?? this.LayoutTransform ?? Matrix.Identity, n = this.Child.DesiredSize, r = new Rect(n).TransformToAABB(m);
            this.Child.RenderTransformOrigin = new (this.Child.RenderTransformOrigin.constructor)(0, 0);
            this.Child.RenderTransform = m;
            this.Child.Arrange(new Rect(-r.X, -r.Y, n.Width, n.Height));
        }
        return size;
    }
}
DefineProperties(LayoutTransformControl, { LayoutTransform: [null, { Convert: v => typeof v === 'string' ? TransformOperations.Parse(v) : v, AffectsMeasure: true }] });
export class Shape extends Control {
    get RenderedGeometry() {
        return this.DefiningGeometry;
    }
    get DefiningGeometry() {
        return null;
    }
    MeasureOverride() {
        const bounds = this.DefiningGeometry?.Bounds ?? Rect.Empty;
        return new Size(Math.max(0, bounds.Right) + this.StrokeThickness, Math.max(0, bounds.Bottom) + this.StrokeThickness);
    }
    Render(ctx) {
        const geometry = this.DefiningGeometry;
        if (!geometry)
            return;
        const bounds = geometry.Bounds;
        let state = null;
        if (this.Stretch !== 'None' && bounds.Width && bounds.Height) {
            const available = new Rect(this.Bounds.Size).Deflate(this.StrokeThickness / 2);
            let x = available.Width / bounds.Width, y = available.Height / bounds.Height;
            if (this.Stretch === 'Uniform')
                x = y = Math.min(x, y);
            if (this.Stretch === 'UniformToFill')
                x = y = Math.max(x, y);
            state = ctx.PushTransform(Matrix.CreateTranslation(-bounds.X, -bounds.Y).Multiply(Matrix.CreateScale(x, y)).Multiply(Matrix.CreateTranslation(available.X + (available.Width - bounds.Width * x) / 2, available.Y + (available.Height - bounds.Height * y) / 2)));
        }
        try {
            ctx.DrawGeometry(this.Fill, this.Stroke ? new Pen(this.Stroke, this.StrokeThickness) : null, geometry);
        }
        finally {
            state?.Dispose();
        }
    }
}
DefineProperties(Shape, { Fill: [null, { Convert: BrushValue }], Stroke: [null, { Convert: BrushValue }], StrokeThickness: [1, { Convert: Number, AffectsMeasure: true }], Stretch: ['None', { AffectsMeasure: true }] });
export class Path extends Shape {
    get DefiningGeometry() {
        return this.Data;
    }
}
DefineProperties(Path, { Data: [null, { Convert: v => typeof v === 'string' ? Geometry.Parse(v) : v, AffectsMeasure: true }] });
export class Rectangle extends Shape {
    MeasureOverride() {
        return new Size(this.StrokeThickness, this.StrokeThickness);
    }
    get DefiningGeometry() {
        return new RectangleGeometry(new Rect(this.Bounds.Size).Deflate(this.StrokeThickness / 2));
    }
    Render(ctx) {
        ctx.DrawRectangle(this.Fill, this.Stroke ? new Pen(this.Stroke, this.StrokeThickness) : null, new Rect(this.Bounds.Size).Deflate(this.StrokeThickness / 2), this.RadiusX, this.RadiusY);
    }
}
DefineProperties(Rectangle, { RadiusX: [0, { Convert: Number }], RadiusY: [0, { Convert: Number }] });
export class Ellipse extends Shape {
    MeasureOverride() {
        return new Size(this.StrokeThickness, this.StrokeThickness);
    }
    get DefiningGeometry() {
        return new EllipseGeometry(new Rect(this.Bounds.Size).Deflate(this.StrokeThickness / 2));
    }
}
export class Line extends Shape {
    get DefiningGeometry() {
        return new LineGeometry(this.StartPoint, this.EndPoint);
    }
}
DefineProperties(Line, { StartPoint: [new Point(), { Convert: v => v instanceof Point ? v : Point.Parse(v), AffectsMeasure: true }], EndPoint: [new Point(100, 100), { Convert: v => v instanceof Point ? v : Point.Parse(v), AffectsMeasure: true }] });
export class Polyline extends Shape {
    get DefiningGeometry() {
        return new StreamGeometry(this.Points.map((p, i) => `${i ? 'L' : 'M'} ${p.X} ${p.Y}`).join(' '));
    }
}
DefineProperties(Polyline, { Points: [[], { Convert: v => typeof v === 'string' ? (v.match(/[-+\d.e]+\s*[, ]\s*[-+\d.e]+/g) ?? []).map(Point.Parse) : v, AffectsMeasure: true }] });
export class Polygon extends Polyline {
    get DefiningGeometry() {
        return new StreamGeometry(super.DefiningGeometry.Data + ' Z');
    }
}
export class PathIcon extends Path {
    constructor() {
        super();
        this.Stretch = 'Uniform';
        this.Width = 16;
        this.Height = 16;
    }
    Render(ctx) {
        const old = this.GetValue(Shape.FillProperty);
        if (!old) {
            const token = this.SetValue(Shape.FillProperty, this.Foreground, BindingPriority.Style);
            try {
                super.Render(ctx);
            }
            finally {
                token.Dispose();
            }
        }
        else
            super.Render(ctx);
    }
}
export class Image extends Control {
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'Source') {
            this._imageSubscription?.Dispose();
            this._imageSubscription = e.NewValue?.Changed?.Add(() => {
                this.InvalidateMeasure();
                this.InvalidateVisual();
            });
            Image.Loader?.(e.NewValue, this).catch(error => {
                this.LoadError = error;
                this.InvalidateVisual();
            });
        }
    }
    MeasureOverride(available) {
        const sourceSize = this.Source?.Size ?? this.Source?.PixelSize ?? Size.Empty;
        if (!sourceSize.Width || !sourceSize.Height)
            return Size.Empty;
        const scale = Math.min(available.Width / sourceSize.Width, available.Height / sourceSize.Height);
        return this.Stretch === 'None' || !Number.isFinite(scale) ? sourceSize : new Size(sourceSize.Width * Math.min(1, scale), sourceSize.Height * Math.min(1, scale));
    }
    Render(ctx) {
        super.Render(ctx);
        if (!this.Source)
            return;
        if (this.Source instanceof DrawingImage) {
            const size = this.Source.Size;
            if (!size.Width || !size.Height) return;
            ctx.DrawImage(this.Source, new Rect(size), this._Destination(size));
        }
        else {
            const size = this.Source.PixelSize ?? this.Source.Size;
            if (size?.Width)
                ctx.DrawImage(this.Source, new Rect(size), this._Destination(size));
        }
    }
    _Destination(n) {
        let x = this.Bounds.Width / n.Width, y = this.Bounds.Height / n.Height;
        if (this.Stretch === 'None')
            x = y = 1;
        if (this.Stretch === 'Uniform')
            x = y = Math.min(x, y);
        if (this.Stretch === 'UniformToFill')
            x = y = Math.max(x, y);
        return new Rect((this.Bounds.Width - n.Width * x) / 2, (this.Bounds.Height - n.Height * y) / 2, n.Width * x, n.Height * y);
    }
    Dispose() {
        this._imageSubscription?.Dispose();
        super.Dispose();
    }
}
DefineProperties(Image, { Source: [null, { Convert: v => typeof v === 'string' ? new Bitmap(v) : v, AffectsMeasure: true }], Stretch: ['Uniform', { AffectsMeasure: true }] });
export class Separator extends Control {
    MeasureOverride() {
        return new Size(1, 1);
    }
    Render(ctx) {
        ctx.DrawRectangle(this.Background ?? this.Palette.Border, null, new Rect(0, Math.floor(this.Bounds.Height / 2), this.Bounds.Width, 1));
    }
}
