import { DefineProperties, AvaloniaProperty, Event, Size, Rect, Point, MathUtilities } from '@wieslawsoltes/avalonia-base';
import { InputElement, BooleanValue } from './core.js';
import { RangeBase } from './range.js';

export const ScrollBarVisibility = Object.freeze({ Disabled: 'Disabled', Auto: 'Auto', Hidden: 'Hidden', Visible: 'Visible' });
export const ScrollEventType = Object.freeze(Object.fromEntries(['SmallDecrement', 'SmallIncrement', 'LargeDecrement', 'LargeIncrement', 'ThumbPosition', 'ThumbTrack', 'First', 'Last', 'EndScroll'].map(x => [x, x])));
export class ScrollEventArgs {
    constructor(eventType, newValue) { this.ScrollEventType = eventType; this.NewValue = newValue; }
}
const validNonNegative = value => Number.isFinite(value) && value >= 0;
const finiteOffset = (value, minimum, maximum) => MathUtilities.Clamp(Number.isNaN(value) ? minimum : value, minimum, maximum);

/**
 * A real input surface, not a Slider with a different drawing. Value grows from
 * top/left; all interaction uses the same viewport/thumb/travel geometry.
 * The complete track remains hit-testable when its thumb is visually compact.
 */
export class ScrollBar extends RangeBase {
    constructor() {
        super();
        this.Focusable = false; this.IsTabStop = false;
        this.Scroll = new Event(); this._drag = null; this._pagePointer = null; this._isExpanded = false;
        this._lifetime.Add(this.PointerEntered.Add(() => this._ScheduleExpansion(true)));
        this._lifetime.Add(this.PointerExited.Add(() => this._ScheduleExpansion(false)));
        this._lifetime.Add(this.DetachedFromVisualTree.Add(() => this._CancelInteraction()));
        this._UpdateOrientation();
    }
    get IsExpanded() { return this._isExpanded; }
    get IsDragging() { return this._drag !== null; }
    get ScrollableRange() { return Math.max(0, this.Maximum - this.Minimum); }
    _UpdateOrientation() {
        this.PseudoClasses.Set(':horizontal', this.Orientation === 'Horizontal');
        this.PseudoClasses.Set(':vertical', this.Orientation !== 'Horizontal');
    }
    _SetExpanded(value) {
        this.SetAndRaise(ScrollBar.IsExpandedProperty, '_isExpanded', value);
        this.PseudoClasses.Set(':expanded', value);
    }
    _ScheduleExpansion(expand) {
        clearTimeout(this._visibilityTimer); this._visibilityTimer = null;
        if (!this.AllowAutoHide || this._drag || this._pagePointer) { this._SetExpanded(true); return; }
        const delay = expand ? this.ShowDelay : this.HideDelay;
        if (delay <= 0) this._SetExpanded(expand);
        else { this._visibilityTimer = setTimeout(() => { this._visibilityTimer = null; if (!this.IsDisposed) this._SetExpanded(expand); }, delay); this._visibilityTimer.unref?.(); }
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'Orientation') { this._CancelInteraction(); this._UpdateOrientation(); }
        if (['Visibility', 'Maximum', 'Minimum', 'ViewportSize'].includes(e.Property.Name)) {
            const visible = this.Visibility === 'Visible' || this.Visibility === 'Auto' && (Number.isNaN(this.ViewportSize) || this.ScrollableRange > 0);
            this.SetCurrentValue(InputElement.IsVisibleProperty, visible);
        }
        if (e.Property.Name === 'AllowAutoHide') this._ScheduleExpansion(!e.NewValue);
        if ((e.Property.Name === 'IsEnabled' || e.Property.Name === 'IsVisible') && !e.NewValue) this._CancelInteraction();
    }
    MeasureOverride(available) { return this._templateRoot ? super.MeasureOverride(available) : this.Orientation === 'Horizontal' ? new Size(100, 16) : new Size(16, 100); }
    GetTrackGeometry() {
        const horizontal = this.Orientation === 'Horizontal', length = Math.max(0, horizontal ? this.Bounds.Width : this.Bounds.Height);
        const range = this.ScrollableRange, viewport = this.ViewportSize;
        const thumbLength = Math.min(length, range <= 0 ? length : Math.max(this.MinimumThumbLength,
            Number.isFinite(viewport) && viewport > 0 ? length * (viewport / (range + viewport)) : this.MinimumThumbLength));
        const travel = Math.max(0, length - thumbLength);
        const fraction = range > 0 ? finiteOffset((this.Value - this.Minimum) / range, 0, 1) : 0;
        const start = (this.IsDirectionReversed ? 1 - fraction : fraction) * travel;
        return { Horizontal: horizontal, Length: length, ThumbLength: thumbLength, Travel: travel, Range: range, Start: start };
    }
    GetThumbBounds() {
        const g = this.GetTrackGeometry();
        return g.Horizontal ? new Rect(g.Start, 0, g.ThumbLength, this.Bounds.Height) : new Rect(0, g.Start, this.Bounds.Width, g.ThumbLength);
    }
    _Ordinate(point) { return this.Orientation === 'Horizontal' ? point.X : point.Y; }
    _SetScrollValue(value, eventType) {
        const old = this.Value;
        this.SetCurrentValue(RangeBase.ValueProperty, finiteOffset(value, this.Minimum, Math.max(this.Minimum, this.Maximum)));
        if (old !== this.Value) this.Scroll?.Raise(this, new ScrollEventArgs(eventType, this.Value));
        return old !== this.Value;
    }
    SmallDecrement() { return this._SetScrollValue(this.Value - this.SmallChange, 'SmallDecrement'); }
    SmallIncrement() { return this._SetScrollValue(this.Value + this.SmallChange, 'SmallIncrement'); }
    LargeDecrement() { return this._SetScrollValue(this.Value - this.LargeChange, 'LargeDecrement'); }
    LargeIncrement() { return this._SetScrollValue(this.Value + this.LargeChange, 'LargeIncrement'); }
    ScrollToMinimum() { return this._SetScrollValue(this.Minimum, 'First'); }
    ScrollToMaximum() { return this._SetScrollValue(this.Maximum, 'Last'); }
    _PageTowardsPointer() {
        if (!this._pagePointer || !this.IsEffectivelyEnabled || !this.IsVisible) return false;
        const g = this.GetTrackGeometry(), pos = this._Ordinate(this._pagePosition);
        if (pos >= g.Start && pos <= g.Start + g.ThumbLength) return false;
        if (!new Rect(this.Bounds.Size).Contains(this._pagePosition)) return false;
        const sign = (pos < g.Start ? -1 : 1) * (this.IsDirectionReversed ? -1 : 1);
        return this._SetScrollValue(this.Value + sign * this.LargeChange, sign < 0 ? 'LargeDecrement' : 'LargeIncrement');
    }
    _ScheduleRepeat(delay) {
        clearTimeout(this._repeatTimer);
        this._repeatTimer = setTimeout(() => {
            this._repeatTimer = null;
            if (this.IsDisposed || !this._pagePointer || this._pagePointer.Captured !== this) return;
            this._PageTowardsPointer();
            if (this._pagePointer) this._ScheduleRepeat(this.RepeatInterval);
        }, delay);
        this._repeatTimer.unref?.();
    }
    OnPointerPressed(e) {
        if (!this.IsEffectivelyEnabled || e.OriginalEvent?.button > 0 || this._drag || this._pagePointer) return;
        const g = this.GetTrackGeometry();
        if (!g.Travel || !g.Range) { e.Handled = true; e.PreventGestureRecognition(); return; }
        const point = e.GetPosition(this), pos = this._Ordinate(point);
        e.PreventGestureRecognition(); e.Pointer._suppressTap = true;
        if (this.Focusable) this.Focus('Pointer');
        else if (this._scrollOwner?.Focusable) this._scrollOwner.Focus('Pointer');
        e.Pointer.Capture(this); this._SetExpanded(true);
        if (e.Pointer.Captured !== this) return;
        if (this.GetThumbBounds().Contains(point) || this.IsMoveToPointEnabled || (e.KeyModifiers & 4)) {
            this._drag = { Pointer: e.Pointer, Grab: this.GetThumbBounds().Contains(point) ? (pos - g.Start) / Math.max(1, g.ThumbLength) : .5, InitialValue: this.Value };
            this.PseudoClasses.Set(':pressed', true);
            if (!this.GetThumbBounds().Contains(point)) this._DragTo(point);
        } else {
            this._pagePointer = e.Pointer; this._pagePosition = point;
            this._PageTowardsPointer(); this._ScheduleRepeat(this.RepeatDelay);
        }
        e.Handled = true;
    }
    _DragTo(point) {
        const g = this.GetTrackGeometry();
        if (!this._drag || !g.Travel || !g.Range) return;
        let fraction = finiteOffset((this._Ordinate(point) - this._drag.Grab * g.ThumbLength) / g.Travel, 0, 1);
        if (this.IsDirectionReversed) fraction = 1 - fraction;
        this._SetScrollValue(this.Minimum + fraction * g.Range, 'ThumbTrack');
    }
    OnPointerMoved(e) {
        if (e.Pointer.Captured !== this) return;
        if (this._drag?.Pointer === e.Pointer) this._DragTo(e.GetPosition(this));
        if (this._pagePointer === e.Pointer) this._pagePosition = e.GetPosition(this);
        e.Handled = true;
    }
    OnPointerReleased(e) {
        if (e.Pointer.Captured === this) {
            const wasDragging = !!this._drag;
            this._FinishInteraction();
            if (wasDragging) this.Scroll.Raise(this, new ScrollEventArgs('ThumbPosition', this.Value));
            this.Scroll.Raise(this, new ScrollEventArgs('EndScroll', this.Value));
            e.Pointer.Capture(null); e.Handled = true;
        }
    }
    _FinishInteraction() {
        clearTimeout(this._repeatTimer); this._repeatTimer = null;
        this._drag = null; this._pagePointer = null;
        this.PseudoClasses.Set(':pressed', false); this._ScheduleExpansion(false);
    }
    _CancelInteraction() {
        const pointer = this._drag?.Pointer ?? this._pagePointer;
        const active = !!pointer;
        this._FinishInteraction();
        clearTimeout(this._visibilityTimer); this._visibilityTimer = null;
        if (pointer?.Captured === this) pointer.Capture(null);
        if (active) this.Scroll?.Raise(this, new ScrollEventArgs('EndScroll', this.Value));
    }
    OnPointerCaptureLost() { if (this._drag || this._pagePointer) this._CancelInteraction(); }
    OnKeyDown(e) {
        let handled = true;
        const reverse = this.IsDirectionReversed;
        if (e.Key === 'Home') this.ScrollToMinimum();
        else if (e.Key === 'End') this.ScrollToMaximum();
        else if (e.Key === 'PageUp') reverse ? this.LargeIncrement() : this.LargeDecrement();
        else if (e.Key === 'PageDown') reverse ? this.LargeDecrement() : this.LargeIncrement();
        else if ((this.Orientation === 'Horizontal' && e.Key === 'Left') || (this.Orientation === 'Vertical' && e.Key === 'Up')) reverse ? this.SmallIncrement() : this.SmallDecrement();
        else if ((this.Orientation === 'Horizontal' && e.Key === 'Right') || (this.Orientation === 'Vertical' && e.Key === 'Down')) reverse ? this.SmallDecrement() : this.SmallIncrement();
        else handled = false;
        if (handled) { this.Scroll.Raise(this, new ScrollEventArgs('EndScroll', this.Value)); e.Handled = true; }
    }
    OnPointerWheelChanged(e) {
        if (this._scrollOwner && this.Orientation === 'Vertical' && (e.KeyModifiers & 4)) return; // host applies Shift-horizontal routing
        const dom = e.OriginalEvent && ('deltaX' in e.OriginalEvent || 'deltaY' in e.OriginalEvent);
        const pixels = dom ? e.GetPixelDelta(new Size(this.ViewportSize || this.LargeChange, this.ViewportSize || this.LargeChange), this.SmallChange) : null;
        const delta = pixels ? (this.Orientation === 'Horizontal' ? pixels.X || pixels.Y : pixels.Y)
            : -(this.Orientation === 'Horizontal' ? e.Delta.X || e.Delta.Y : e.Delta.Y) * this.SmallChange;
        const amount = delta * (this.IsDirectionReversed ? -1 : 1);
        if (this._SetScrollValue(this.Value + amount, amount < 0 ? 'SmallDecrement' : 'SmallIncrement')) {
            this.Scroll.Raise(this, new ScrollEventArgs('EndScroll', this.Value)); e.Handled = true;
        }
    }
    Render(context) {
        if (this._templateRoot) return;
        const expanded = !this.AllowAutoHide || this.IsExpanded || this.IsDragging;
        if (expanded) context.DrawRectangle(this.Background ?? this.Palette.SurfaceAlt, null, new Rect(this.Bounds.Size));
        const g = this.GetTrackGeometry();
        if (g.Range <= 0 || g.Length <= 0) return;
        const cross = g.Horizontal ? this.Bounds.Height : this.Bounds.Width;
        const thickness = Math.min(cross, expanded ? 8 : 4), inset = Math.max(0, (cross - thickness) / 2);
        const thumb = g.Horizontal ? new Rect(g.Start, inset, g.ThumbLength, thickness) : new Rect(inset, g.Start, thickness, g.ThumbLength);
        context.DrawRectangle(this.IsDragging ? this.Palette.Accent : expanded ? this.Palette.Muted : this.Palette.Track, null, thumb, Math.min(4, thickness / 2));
    }
    Dispose() { if (this.IsDisposed) return; this._CancelInteraction(); this.Scroll.Clear(); super.Dispose(); }
}
ScrollBar.IsExpandedProperty = AvaloniaProperty.RegisterDirect(ScrollBar, 'IsExpanded', o => o.IsExpanded);
DefineProperties(ScrollBar, {
    ViewportSize: [NaN, { Convert: Number, Validate: v => Number.isNaN(v) || validNonNegative(v) }],
    Visibility: ['Visible', { Validate: v => Object.hasOwn(ScrollBarVisibility, v) }],
    Orientation: ['Vertical', { AffectsMeasure: true, Validate: v => v === 'Horizontal' || v === 'Vertical' }],
    IsDirectionReversed: [false, { Convert: BooleanValue }], AllowAutoHide: [true, { Convert: BooleanValue }],
    HideDelay: [2000, { Convert: Number, Validate: validNonNegative }], ShowDelay: [500, { Convert: Number, Validate: validNonNegative }],
    MinimumThumbLength: [24, { Convert: Number, Validate: validNonNegative }], IsMoveToPointEnabled: [false, { Convert: BooleanValue }],
    RepeatDelay: [400, { Convert: Number, Validate: validNonNegative }], RepeatInterval: [60, { Convert: Number, Validate: v => Number.isFinite(v) && v >= 10 }]
});

/** Internal shared chrome for scroll presenters. No drawing or input duplication. */
export class ScrollChrome {
    constructor(owner, setOffset) {
        this.Owner = owner; this.SetOffset = setOffset; this._syncing = false;
        this.Horizontal = new ScrollBar(); this.Horizontal.Orientation = 'Horizontal';
        this.Vertical = new ScrollBar();
        for (const bar of [this.Horizontal, this.Vertical]) {
            bar.ZIndex = 2147483647; bar.Visibility = 'Hidden'; bar._scrollOwner = owner;
            owner.AddVisualChild(bar, false);
            owner._lifetime.Add(bar.ValueChanged.Add((_, e) => {
                e.Handled = true;
                if (!this._syncing && (!bar.IsDragging || !this.Deferred)) this._Commit(bar);
            }));
            owner._lifetime.Add(bar.Scroll.Add((_, e) => { if (!this._syncing && e.ScrollEventType === 'EndScroll' && this.Deferred) this._Commit(bar); }));
        }
    }
    get Deferred() { return !!(this.Owner.IsDeferredScrollingEnabled ?? this._deferred); }
    set Deferred(value) { this._deferred = value; }
    _Commit(bar) {
        const next = bar === this.Horizontal ? new Point(bar.Value, this.Offset.Y) : new Point(this.Offset.X, bar.Value);
        this.SetOffset(next);
    }
    Sync(bounds, extent, offset, options = {}) {
        this._syncing = true;
        try {
            this.Offset = offset; this.Deferred = !!options.Deferred;
            const h = this.Horizontal, v = this.Vertical, thickness = Math.max(0, options.Thickness ?? 16);
            for (const [bar, mode, maximum, viewport, value, small] of [
                [h, options.Horizontal ?? 'Disabled', Math.max(0, extent.Width - bounds.Width), bounds.Width, offset.X, options.SmallChange?.X ?? 16],
                [v, options.Vertical ?? 'Auto', Math.max(0, extent.Height - bounds.Height), bounds.Height, offset.Y, options.SmallChange?.Y ?? 16]
            ]) {
                bar.Minimum = 0; bar.Maximum = maximum; bar.ViewportSize = viewport;
                bar.AllowAutoHide = options.AllowAutoHide ?? true; bar.SmallChange = small; bar.LargeChange = viewport;
                // A deferred thumb owns its preview value until release, even if the host renders.
                if (!(this.Deferred && bar.IsDragging)) bar.SetCurrentValue(RangeBase.ValueProperty, value);
                bar.Visibility = mode;
            }
            const overlay = options.Overlay ?? true;
            const hrect = new Rect(bounds.X, overlay ? bounds.Bottom - Math.min(thickness, bounds.Height) : bounds.Bottom, Math.max(0, bounds.Width - (overlay && v.IsVisible ? thickness : 0)), Math.min(thickness, bounds.Height));
            const vrect = new Rect(overlay ? bounds.Right - Math.min(thickness, bounds.Width) : bounds.Right, bounds.Y, Math.min(thickness, bounds.Width), Math.max(0, bounds.Height - (overlay && h.IsVisible ? thickness : 0)));
            h.Measure(hrect.Size); h.Arrange(hrect); v.Measure(vrect.Size); v.Arrange(vrect);
        } finally { this._syncing = false; }
    }
}
