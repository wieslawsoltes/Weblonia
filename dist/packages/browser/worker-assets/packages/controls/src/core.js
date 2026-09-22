import { AvaloniaObject, AvaloniaProperty, DefineProperties, BindingPriority, Event, Disposable, CompositeDisposable, Classes, AvaloniaList, Size, Rect, Point, Matrix, Thickness, CornerRadius, RelativePoint, MathUtilities } from "../../base/src/index.js";
import { Brush, Brushes, Pen, Typeface, TextLayout, TextLayoutCache, TransformOperations } from "../../media/src/index.js";
import { ResourceDictionary, Styles, Styler, ThemeVariant, ResourceEnvironment, FindResource, TryFindResource } from "../../styling/src/index.js";
let visualId = 0;
let automationPeerFactory = null;
let gestureServices = null;
/** Installs the input gesture pipeline without a core-to-recognizer dependency cycle. */
export function RegisterGestureServices(services) { gestureServices = services; }

/** Browser/automation integration hook; avoids a core-to-control peer dependency cycle. */
export function RegisterAutomationPeerFactory(factory) {
    if (typeof factory !== 'function') throw new TypeError('An automation peer factory is required.');
    automationPeerFactory = factory;
}
export const BooleanValue = value => typeof value === 'string' ? value.toLowerCase() === 'true' : !!value;
export const BrushValue = value => value == null || typeof value !== 'string' ? value : Brush.Parse(value);
const finiteOrAuto = value => value == null || value === 'Auto' ? NaN : Number(value);
const finiteSize = size => new Size(Math.max(0, Number.isFinite(size.Width) ? size.Width : 0), Math.max(0, Number.isFinite(size.Height) ? size.Height : 0));
export class NameScope {
    constructor() {
        this._names = new Map();
        this.Changed = new Event();
        this.IsCompleted = false;
    }
    Register(name, element) {
        if (!name)
            return;
        if (this._names.has(name) && this._names.get(name) !== element)
            throw new Error(`Duplicate XAML name '${name}'.`);
        this._names.set(name, element);
        this.Changed.Raise(this, { Name: name, Element: element });
    }
    Unregister(name) {
        this._names.delete(name);
        this.Changed.Raise(this, { Name: name });
    }
    Find(name) {
        return this._names.get(name) ?? null;
    }
    Get(name) {
        const result = this.Find(name);
        if (!result)
            throw new Error(`Name '${name}' was not found.`);
        return result;
    }
    Complete() {
        this.IsCompleted = true;
        this.Changed.Raise(this, {});
    }
    static SetNameScope(element, scope) {
        element._nameScope = scope;
    }
    static GetNameScope(element) {
        return element._nameScope ?? null;
    }
}
export class StyledElement extends AvaloniaObject {
    constructor() {
        super();
        this.VisualId = ++visualId;
        this._parent = null;
        this._nameScope = null;
        this.Resources = new ResourceDictionary();
        this.Resources.Owner = this;
        this.Styles = new Styles();
        this.Styles.Owner = this;
        this.Classes = new Classes();
        this.PseudoClasses = new Classes();
        this.ResourcesChanged = new Event();
        this.Initialized = new Event();
        this.AttachedToLogicalTree = new Event();
        this.DetachedFromLogicalTree = new Event();
        this._stylesDirty = true;
        this._initializing = 0;
        this.IsInitialized = false;
        this._lifetime.Add(this.Classes.Changed.Add(() => this.InvalidateStyles(true)));
        this._lifetime.Add(this.PseudoClasses.Changed.Add(() => this.InvalidateStyles(true)));
        this._lifetime.Add(this.Resources.ResourcesChanged.Add((_, e) => {
            this.ResourcesChanged.Raise(this, e);
            this.InvalidateVisual?.();
        }));
    }
    get Parent() {
        return this._parent;
    }
    get StyleKey() {
        return this.constructor;
    }
    get ActualThemeVariant() {
        const requested = this.RequestedThemeVariant;
        return requested && requested.Key !== 'Default' ? requested : this.Parent?.ActualThemeVariant ?? ResourceEnvironment.Application?.ActualThemeVariant ?? ResourceEnvironment.SystemTheme;
    }
    BeginInit() {
        this._initializing++;
    }
    EndInit() {
        if (this._initializing > 0)
            this._initializing--;
        if (!this._initializing && !this.IsInitialized) {
            this.IsInitialized = true;
            this.Initialized.Raise(this, {});
        }
    }
    GetNameScope() {
        for (let n = this; n; n = n.Parent ?? n.VisualParent)
            if (n._nameScope)
                return n._nameScope;
        return null;
    }
    FindControl(name) {
        const scoped = this.GetNameScope()?.Find(name);
        if (scoped)
            return scoped;
        return this.FindDescendant(v => v.Name === name);
    }
    FindDescendant(predicate) {
        if (predicate(this))
            return this;
        for (const child of this.VisualChildren ?? []) {
            const result = child.FindDescendant(predicate);
            if (result)
                return result;
        }
        return null;
    }
    FindResource(key) {
        return FindResource(this, key);
    }
    TryFindResource(key) {
        return TryFindResource(this, key);
    }
    InvalidateStyles(descendants = false) {
        this._stylesDirty = true;
        this.InvalidateMeasure?.();
        this.InvalidateVisual?.();
        if (descendants)
            for (const c of this.VisualChildren ?? [])
                c.InvalidateStyles(true);
    }
    ApplyStyling() {
        if (this._stylesDirty && !this._applyingStyles) {
            this._applyingStyles = true;
            try {
                Styler.Current.ApplyStyles(this);
            }
            finally {
                this._applyingStyles = false;
            }
        }
    }
    OnPropertyChanged(change) {
        super.OnPropertyChanged(change);
        if (change.Property.Name === 'Name') {
            const scope = this.GetNameScope();
            if (change.OldValue)
                scope?.Unregister(change.OldValue);
            if (change.NewValue)
                scope?.Register(change.NewValue, this);
            this.InvalidateStyles();
        }
        if (change.Property.Name === 'RequestedThemeVariant' || change.Property.Name === 'Theme') {
            this.InvalidateStyles(true);
            this._NotifyThemeChanged();
        }
    }
    _NotifyThemeChanged() {
        this.ResourcesChanged?.Raise(this, { ThemeChanged: true });
        this.InvalidateVisual?.();
        for (const c of this.VisualChildren ?? [])
            c._NotifyThemeChanged();
    }
    Dispose() {
        if (this.IsDisposed)
            return;
        Styler.Current.Detach(this);
        this.Styles.Dispose?.();
        this.Resources.Dispose?.();
        super.Dispose();
    }
}
DefineProperties(StyledElement, {
    DataContext: [null, { Inherits: true, AffectsRender: false }], Name: ['', { Convert: String }],
    TemplatedParent: [null], RequestedThemeVariant: [ThemeVariant.Default, { Convert: ThemeVariant.Parse }], Theme: [null], Tag: [null],
});
export class Visual extends StyledElement {
    constructor() {
        super();
        this.VisualParent = null;
        this.VisualChildren = [];
        this.LogicalChildren = [];
        this.Bounds = Rect.Empty;
        this.AttachedToVisualTree = new Event();
        this.DetachedFromVisualTree = new Event();
        this._visualRoot = null;
        this._renderVersion = 0;
        this._renderContentVersion = 0;
        this.VisualInvalidated = new Event();
        this.Disposed = new Event();
        this._renderResources = new Map();
    }
    get IsAttachedToVisualTree() {
        return !!this._visualRoot;
    }
    get IsEffectivelyVisible() {
        return this.IsVisible && (!this.VisualParent || this.VisualParent.IsEffectivelyVisible);
    }
    GetVisualRoot() {
        return this._visualRoot ?? (this.IsTopLevel ? this : this.VisualParent?.GetVisualRoot()) ?? null;
    }
    GetVisualAncestors() {
        const result = [];
        for (let n = this.VisualParent; n; n = n.VisualParent)
            result.push(n);
        return result;
    }
    GetVisualDescendants() {
        return this.VisualChildren.flatMap(c => [c, ...c.GetVisualDescendants()]);
    }
    AddVisualChild(child, logical = true) {
        if (!(child instanceof Visual))
            throw new TypeError('A visual child must derive from Visual.');
        if (child === this || child.FindDescendant(v => v === this))
            throw new Error('Visual tree cycle.');
        if (child.VisualParent && child.VisualParent !== this)
            throw new Error('The control already has a visual parent. Remove it first.');
        if (logical && child.Parent && child.Parent !== this)
            throw new Error('The control already has a logical parent.');
        if (this.VisualChildren.includes(child))
            return child;
        child.VisualParent = this;
        this.VisualChildren.push(child);
        this._zOrderCache = null;
        if (logical) {
            child._parent = this;
            this.LogicalChildren.push(child);
            child.SetInheritanceParent(this);
            child.AttachedToLogicalTree.Raise(child, { Parent: this });
        }
        else
            child.SetInheritanceParent(child.TemplatedParent ?? this);
        if (child.Name)
            child.GetNameScope()?.Register(child.Name, child);
        child.InvalidateStyles(true);
        if (this.GetVisualRoot())
            child._Attach(this.GetVisualRoot());
        this.InvalidateMeasure?.();
        this.InvalidateVisual();
        this.GetVisualRoot()?._InvalidateAutomation?.(this, true);
        return child;
    }
    RemoveVisualChild(child) {
        const index = this.VisualChildren.indexOf(child);
        if (index < 0)
            return false;
        if (child._visualRoot)
            child._Detach();
        this.VisualChildren.splice(index, 1);
        this._zOrderCache = null;
        child.VisualParent = null;
        const logicalIndex = this.LogicalChildren.indexOf(child);
        if (logicalIndex >= 0) {
            if (child.Name)
                child.GetNameScope()?.Unregister(child.Name);
            this.LogicalChildren.splice(logicalIndex, 1);
            child._parent = null;
            child.DetachedFromLogicalTree.Raise(child, { Parent: this });
        }
        child.SetInheritanceParent(null);
        this.InvalidateMeasure?.();
        this.InvalidateVisual();
        this.GetVisualRoot()?._InvalidateAutomation?.(this, true);
        return true;
    }
    _Attach(root) {
        this._visualRoot = root;
        this.EndInit();
        this.AttachedToVisualTree.Raise(this, { Root: root });
        for (const c of this.VisualChildren)
            c._Attach(root);
    }
    _Detach() {
        const root = this._visualRoot;
        for (const c of this.VisualChildren)
            c._Detach();
        root?.FocusManager?.Remove(this);
        this._visualRoot = null;
        this.DetachedFromVisualTree.Raise(this, { Root: root });
    }
    GetLocalTransform() {
        const renderTransform = this.RenderTransform;
        if (!renderTransform && !this._compositionSelf) {
            const x = this.Bounds.X, y = this.Bounds.Y, cached = this._translationCache;
            if (cached && cached.X === x && cached.Y === y) {
                const m = cached.Matrix;
                // Matrix is a public mutable value object. Do not let a caller
                // mutating a previously returned value poison the internal cache.
                if (m.M11 === 1 && m.M12 === 0 && m.M21 === 0 && m.M22 === 1 && m.M31 === x && m.M32 === y) return m;
            }
            const matrix = x || y ? Matrix.CreateTranslation(x, y) : Matrix.Identity;
            this._translationCache = { X: x, Y: y, Matrix: matrix };
            return matrix;
        }
        const origin = this.RenderTransformOrigin.ToPixels(this.Bounds.Size), m = this.RenderTransform?.Value ?? this.RenderTransform ?? Matrix.Identity;
        const transform = Matrix.CreateTranslation(-origin.X, -origin.Y).Multiply(m).Multiply(Matrix.CreateTranslation(origin.X + this.Bounds.X, origin.Y + this.Bounds.Y));
        return this._compositionSelf ? this._compositionSelf.GetLocalTransform().Multiply(transform) : transform;
    }
    GetTransformToRoot() {
        let m = Matrix.Identity;
        for (let v = this; v; v = v.VisualParent)
            m = m.Multiply(v.GetLocalTransform());
        return m;
    }
    TransformToVisual(other) {
        const a = this.GetTransformToRoot(), b = other?.GetTransformToRoot() ?? Matrix.Identity;
        return b.HasInverse ? a.Multiply(b.Invert()) : null;
    }
    TranslatePoint(point, relativeTo) {
        return this.TransformToVisual(relativeTo)?.Transform(point) ?? null;
    }
    PointToScreen(point) {
        const p = this.TranslatePoint(point, null);
        return new Point(p.X + (this.GetVisualRoot()?.ScreenPosition?.X ?? 0), p.Y + (this.GetVisualRoot()?.ScreenPosition?.Y ?? 0));
    }
    InvalidateVisual(contentChanged = true) {
        if (contentChanged) this._renderContentVersion++;
        // Descendant changes invalidate cached ancestors, but not unrelated branches.
        if (this._invalidatingVisual) return;
        this._invalidatingVisual = true;
        try {
            for (let node = this; node; node = node.VisualParent) {
                node._renderVersion = (node._renderVersion ?? 0) + 1;
                node.VisualInvalidated?.Raise(node, { Source: this });
            }
            this.GetVisualRoot()?._RequestRender?.();
        } finally { this._invalidatingVisual = false; }
    }
    _TrackRenderResource(name, value) {
        if (!this._renderResources) return;
        this._renderResources.get(name)?.Dispose();
        this._renderResources.delete(name);
        if (!value || typeof value !== 'object') return;
        const lifetime = new CompositeDisposable();
        const visited = new Set();
        const observe = resource => {
            if (!resource || typeof resource !== 'object' || visited.has(resource)) return;
            visited.add(resource);
            const refresh = () => { this._TrackRenderResource(name, value); this.OnRenderResourceChanged?.(name); this.InvalidateVisual(); };
            if (resource.PropertyChanged?.Add) lifetime.Add(resource.PropertyChanged.Add(refresh));
            if (resource.Changed?.Add) lifetime.Add(resource.Changed.Add(() => this.InvalidateVisual()));
            if (resource.GradientStops) {
                lifetime.Add(resource.GradientStops.CollectionChanged.Add(refresh));
                for (const stop of resource.GradientStops) observe(stop);
            }
            if (resource.Source) observe(resource.Source);
            if (resource.Visual && resource.Visual !== this) lifetime.Add(resource.Visual.VisualInvalidated.Add(() => this.InvalidateVisual()));
        };
        observe(value); this._renderResources.set(name, lifetime);
    }
    Render() {
    }
    RenderAfter() {
    }
    RenderTree(context) {
        if (!this.IsVisible || this.Opacity <= 0 || this.IsDisposed || this._compositionSelf && (!this._compositionSelf._Read('IsVisible') || this._compositionSelf._Read('Opacity') <= 0))
            return;
        this.ApplyStyling();
        const states = [context.PushTransform(this.GetLocalTransform())];
        if (this._compositionSelf) states.push(this._compositionSelf._PushState(context, false));
        if (this.Opacity < 1)
            states.push(context.PushOpacity(this.Opacity));
        if (this.ClipToBounds)
            states.push(context.PushClip(new Rect(this.Bounds.Size)));
        if (this.Clip)
            states.push(context.PushGeometryClip(this.Clip));
        if (this.Effect) states.push(context.PushEffect(this.Effect));
        try {
            if (!this.CacheMode || !context.DrawVisualCache?.(this)) this._RenderContents(context);
        }
        finally {
            for (const state of states.reverse())
                state.Dispose();
        }
    }
    _RenderContents(context) {
        this.Render(context);
        for (const child of this.GetZOrderedChildren()) {
            const clip = this.GetChildClip?.(child), state = clip ? context.PushClip(clip) : null;
            try { child.RenderTree(context); } finally { state?.Dispose(); }
        }
        this._compositionChild?.Render(context);
        this.RenderAfter(context);
    }
    GetZOrderedChildren() {
        // Keep public VisualChildren mutation/reordering observable without
        // allocating and sorting on every render or pointer hit test.
        const source = this.VisualChildren, cached = this._zOrderCache;
        if (cached && cached.Source.length === source.length && source.every((c, i) => cached.Source[i] === c && Object.is(cached.Values[i], c.ZIndex))) return cached.Order;
        const snapshot = source.slice(), values = snapshot.map(c => c.ZIndex);
        const order = snapshot.map((c, i) => ({ c, i })).sort((a, b) => values[a.i] - values[b.i] || a.i - b.i).map(x => x.c);
        this._zOrderCache = { Source: snapshot, Values: values, Order: Object.freeze(order) };
        return this._zOrderCache.Order;
    }
    HitTest(point, predicate = () => true) {
        if (!this.IsVisible || !this.IsHitTestVisible || this.IsDisposed)
            return null;
        const matrix = this.GetLocalTransform();
        if (!matrix.HasInverse)
            return null;
        const local = matrix.Invert().Transform(point);
        const inside = new Rect(this.Bounds.Size).Contains(local);
        if (this.ClipToBounds && !inside)
            return null;
        const ordered = this.GetZOrderedChildren();
        for (let index = ordered.length - 1; index >= 0; --index) {
            const child = ordered[index], clip = this.GetChildClip?.(child);
            if (clip && !clip.Contains(local)) continue;
            const hit = child.HitTest(local, predicate);
            if (hit)
                return hit;
        }
        return inside && predicate(this) ? this : null;
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'RenderTransform') {
            this._transformSubscription?.Dispose();
            this._transformSubscription = e.NewValue?.Changed?.Add(() => this.InvalidateVisual(false));
        }
        const metadata = e.Property.GetMetadata(this);
        if (metadata.AffectsRender) this._TrackRenderResource(e.Property.Name, e.NewValue);
        if (metadata.AffectsMeasure)
            this.InvalidateMeasure?.();
        else if (metadata.AffectsArrange)
            this.InvalidateArrange?.();
        if (metadata.AffectsRender)
            this.InvalidateVisual(!['Opacity','IsVisible','ZIndex','Clip','ClipToBounds','RenderTransform','RenderTransformOrigin','Effect','CacheMode'].includes(e.Property.Name));
        const name = e.Property.Name;
        const structure = name === 'IsVisible' || name === 'AccessibilityView';
        if (structure || this._automationPeer)
            this.GetVisualRoot()?._InvalidateAutomation?.(this, structure, name === 'IsEnabled');
    }
    Dispose() {
        if (this.IsDisposed)
            return;
        this.VisualParent?.RemoveVisualChild(this);
        if (this._visualRoot)
            this._Detach();
        for (const child of [...this.VisualChildren]) {
            this.RemoveVisualChild(child);
            child.Dispose();
        }
        this._transformSubscription?.Dispose();
        for (const resource of this._renderResources.values()) resource.Dispose();
        this._renderResources.clear();
        this.Disposed.Raise(this, {});
        this.Disposed.Clear(); this.VisualInvalidated.Clear();
        this._zOrderCache = null; this._typefaceCache = null;
        super.Dispose();
    }
}
DefineProperties(Visual, {
    Effect: [null], CacheMode: [null],
    IsVisible: [true, { Convert: BooleanValue, AffectsMeasure: true }], IsHitTestVisible: [true, { Convert: BooleanValue }],
    Opacity: [1, { Convert: Number, Coerce: (_, v) => MathUtilities.Clamp(v, 0, 1) }], ZIndex: [0, { Convert: Number }],
    ClipToBounds: [false, { Convert: BooleanValue }], Clip: [null], RenderTransform: [null, { Convert: v => typeof v === 'string' ? TransformOperations.Parse(v) : v }],
    RenderTransformOrigin: [RelativePoint.Center, { Convert: v => v instanceof RelativePoint ? v : RelativePoint.Parse(v) }],
});
export class Layoutable extends Visual {
    constructor() {
        super();
        this.DesiredSize = Size.Empty;
        this.IsMeasureValid = false;
        this.IsArrangeValid = false;
        this.LayoutUpdated = new Event();
        this.SizeChanged = new Event();
        this._lastMeasure = null;
        this._lastArrange = null;
        this._measuring = false;
        this._arranging = false;
    }
    InvalidateMeasure() {
        if (this._measuring) this._invalidatedDuringMeasure = true;
        if (this._arranging) this._invalidatedDuringArrange = true;
        const wasValid = this.IsMeasureValid;
        this.IsMeasureValid = false;
        this.IsArrangeValid = false;
        // The first invalidation already dirtied all ancestors. Repeated leaf
        // changes in the same batch must not walk and enqueue the path again.
        if (!wasValid && !this._measuring && !this._arranging) return;
        if (this.VisualParent) this.VisualParent.InvalidateMeasure();
        else this.GetVisualRoot()?._RequestLayout?.();
    }
    InvalidateArrange() {
        if (this._arranging) this._invalidatedDuringArrange = true;
        const wasValid = this.IsArrangeValid;
        this.IsArrangeValid = false;
        if (!wasValid && !this._arranging) return;
        if (this.VisualParent) this.VisualParent.InvalidateArrange();
        else this.GetVisualRoot()?._RequestLayout?.();
    }
    Measure(availableSize) {
        if (!(availableSize instanceof Size) || Number.isNaN(availableSize.Width) || Number.isNaN(availableSize.Height) || availableSize.Width < 0 || availableSize.Height < 0)
            throw new RangeError('Measure requires a non-negative Size.');
        this.ApplyStyling();
        this.ApplyTemplate?.();
        if (this.IsMeasureValid && this._lastMeasure?.Equals(availableSize))
            return;
        if (this._measuring)
            throw new Error('Recursive Measure detected.');
        this._measuring = true;
        this._invalidatedDuringMeasure = false;
        try {
            this._lastMeasure = availableSize;
            if (!this.IsVisible)
                this.DesiredSize = Size.Empty;
            else {
                const margin = this.Margin, available = availableSize.Deflate(margin);
                const width = Number.isNaN(this.Width) ? available.Width : this.Width, height = Number.isNaN(this.Height) ? available.Height : this.Height;
                const constraint = new Size(Math.max(this.MinWidth, Math.min(this.MaxWidth, width)), Math.max(this.MinHeight, Math.min(this.MaxHeight, height)));
                const desired = finiteSize(this.MeasureOverride(constraint));
                const w = MathUtilities.Clamp(Number.isNaN(this.Width) ? desired.Width : this.Width, this.MinWidth, this.MaxWidth), h = MathUtilities.Clamp(Number.isNaN(this.Height) ? desired.Height : this.Height, this.MinHeight, this.MaxHeight);
                this._unclippedDesired = new Size(w, h);
                this.DesiredSize = new Size(w + margin.Horizontal, h + margin.Vertical).Constrain(availableSize);
            }
            this.IsMeasureValid = !this._invalidatedDuringMeasure;
            this.IsArrangeValid = false;
        }
        finally {
            this._measuring = false;
        }
    }
    Arrange(finalRect) {
        if (!(finalRect instanceof Rect) || ![finalRect.X, finalRect.Y, finalRect.Width, finalRect.Height].every(Number.isFinite) || finalRect.Width < 0 || finalRect.Height < 0)
            throw new RangeError('Arrange requires a finite non-negative Rect.');
        if (!this.IsMeasureValid)
            this.Measure(finalRect.Size);
        if (this.IsArrangeValid && this._lastArrange?.Equals(finalRect))
            return;
        if (this._arranging)
            throw new Error('Recursive Arrange detected.');
        this._arranging = true;
        this._invalidatedDuringArrange = false;
        try {
            this._lastArrange = finalRect;
            const old = this.Bounds;
            if (!this.IsVisible)
                this.Bounds = new Rect(finalRect.X, finalRect.Y, 0, 0);
            else {
                const slot = finalRect.Deflate(this.Margin), natural = this._unclippedDesired ?? this.DesiredSize;
                let width = Number.isNaN(this.Width) ? (this.HorizontalAlignment === 'Stretch' ? slot.Width : Math.min(slot.Width, natural.Width)) : Math.min(slot.Width, this.Width);
                let height = Number.isNaN(this.Height) ? (this.VerticalAlignment === 'Stretch' ? slot.Height : Math.min(slot.Height, natural.Height)) : Math.min(slot.Height, this.Height);
                width = Math.max(0, Math.min(this.MaxWidth, Math.max(this.MinWidth, width)));
                height = Math.max(0, Math.min(this.MaxHeight, Math.max(this.MinHeight, height)));
                let x = slot.X, y = slot.Y;
                if (this.HorizontalAlignment === 'Center' || (this.HorizontalAlignment === 'Stretch' && width < slot.Width))
                    x += (slot.Width - width) / 2;
                else if (this.HorizontalAlignment === 'Right')
                    x += slot.Width - width;
                if (this.VerticalAlignment === 'Center' || (this.VerticalAlignment === 'Stretch' && height < slot.Height))
                    y += (slot.Height - height) / 2;
                else if (this.VerticalAlignment === 'Bottom')
                    y += slot.Height - height;
                if (this.UseLayoutRounding) {
                    const scale = this.GetVisualRoot()?.RenderScaling ?? 1;
                    x = Math.round(x * scale) / scale;
                    y = Math.round(y * scale) / scale;
                    width = Math.round(width * scale) / scale;
                    height = Math.round(height * scale) / scale;
                }
                this.Bounds = new Rect(x, y, width, height);
                this.ArrangeOverride(this.Bounds.Size);
            }
            this.IsArrangeValid = !this._invalidatedDuringArrange && this.IsMeasureValid;
            if (!old.Equals(this.Bounds)) {
                this.SizeChanged.Raise(this, { PreviousSize: old.Size, NewSize: this.Bounds.Size });
                this.InvalidateVisual(!old.Size.Equals(this.Bounds.Size));
            }
            this.LayoutUpdated.Raise(this, {});
        }
        finally {
            this._arranging = false;
        }
    }
    MeasureOverride() {
        return Size.Empty;
    }
    ArrangeOverride(finalSize) {
        return finalSize;
    }
}
DefineProperties(Layoutable, {
    Width: [NaN, { Convert: finiteOrAuto, AffectsMeasure: true }], Height: [NaN, { Convert: finiteOrAuto, AffectsMeasure: true }],
    MinWidth: [0, { Convert: Number, AffectsMeasure: true }], MinHeight: [0, { Convert: Number, AffectsMeasure: true }], MaxWidth: [Infinity, { Convert: Number, AffectsMeasure: true }], MaxHeight: [Infinity, { Convert: Number, AffectsMeasure: true }],
    Margin: [Thickness.Empty, { Convert: Thickness.From, AffectsMeasure: true }], HorizontalAlignment: ['Stretch', { AffectsArrange: true }], VerticalAlignment: ['Stretch', { AffectsArrange: true }],
    UseLayoutRounding: [true, { Convert: BooleanValue, Inherits: true, AffectsArrange: true }], FlowDirection: ['LeftToRight', { Inherits: true, AffectsArrange: true }],
});
export const RoutingStrategies = Object.freeze({ Direct: 1, Tunnel: 2, Bubble: 4 });
export class RoutedEvent {
    constructor(owner, name, routingStrategies = RoutingStrategies.Bubble) {
        this.OwnerType = owner;
        this.Name = name;
        this.RoutingStrategies = routingStrategies;
    }
    static Register(owner, name, strategies = RoutingStrategies.Bubble) {
        return new RoutedEvent(owner, name, strategies);
    }
}
export class RoutedEventArgs {
    constructor(routedEvent = null, source = null) {
        this.RoutedEvent = routedEvent;
        this.Source = source;
        this.OriginalSource = source;
        this.Handled = false;
        this.Route = RoutingStrategies.Direct;
    }
}
class RoutedEventSubscription {
    constructor(owner, event) {
        this.Owner = owner;
        this.Event = event;
    }
    Add(handler) {
        return this.Owner.AddHandler(this.Event, handler);
    }
    Remove(handler) {
        this.Owner.RemoveHandler(this.Event, handler);
    }
    subscribe(observer) {
        return this.Add((_, e) => typeof observer === 'function' ? observer(e) : observer.next?.(e));
    }
}
export function DefineRoutedEvent(owner, name, routes = RoutingStrategies.Bubble) {
    const event = owner[`${name}Event`] = RoutedEvent.Register(owner, name, routes);
    Object.defineProperty(owner.prototype, name, { get() {
            this._eventViews ??= new Map();
            if (!this._eventViews.has(event))
                this._eventViews.set(event, new RoutedEventSubscription(this, event));
            return this._eventViews.get(event);
        } });
    return event;
}
export class Interactive extends Layoutable {
    constructor() {
        super();
        this._handlers = new Map();
    }
    AddHandler(event, handler, routes = RoutingStrategies.Direct | RoutingStrategies.Bubble, handledEventsToo = false) {
        let entries = this._handlers.get(event);
        if (!entries)
            this._handlers.set(event, entries = new Set());
        const e = { Handler: handler, Routes: routes, HandledEventsToo: handledEventsToo };
        entries.add(e);
        return Disposable.Create(() => entries.delete(e));
    }
    RemoveHandler(event, handler) {
        for (const e of this._handlers.get(event) ?? [])
            if (e.Handler === handler)
                this._handlers.get(event).delete(e);
    }
    RaiseEvent(args) {
        if (!args.RoutedEvent)
            throw new Error('RoutedEventArgs requires RoutedEvent.');
        args.Source ??= this;
        args.OriginalSource ??= args.Source;
        const chain = [this, ...this.GetVisualAncestors()];
        const invoke = (node, route) => {
            args.Route = route;
            for (const e of [...(node._handlers?.get(args.RoutedEvent) ?? [])])
                if ((e.Routes & route) && (!args.Handled || e.HandledEventsToo))
                    e.Handler(node, args);
        };
        if (args.RoutedEvent.RoutingStrategies & RoutingStrategies.Tunnel)
            for (const node of [...chain].reverse())
                invoke(node, RoutingStrategies.Tunnel);
        // Tunneling handlers may explicitly prevent gesture recognition. A winning
        // recognizer cancels element capture before ordinary release handlers run.
        const finishGesture = gestureServices?.Process(args, chain);
        try {
            if (args.RoutedEvent.RoutingStrategies & RoutingStrategies.Bubble)
                for (const node of chain)
                    invoke(node, RoutingStrategies.Bubble);
            if (args.RoutedEvent.RoutingStrategies & RoutingStrategies.Direct)
                invoke(this, RoutingStrategies.Direct);
            return args;
        } finally { finishGesture?.(); }
    }
}
export const KeyModifiers = Object.freeze({ None: 0, Alt: 1, Control: 2, Shift: 4, Meta: 8 });
export class KeyEventArgs extends RoutedEventArgs {
    constructor(event, source, key, modifiers = 0, originalEvent = null) {
        super(event, source);
        this.Key = key;
        this.KeyModifiers = modifiers;
        this.OriginalEvent = originalEvent;
        this.PhysicalKey = originalEvent?.code;
        this.KeySymbol = originalEvent?.key;
    }
}
export class Pointer {
    constructor(id, type, rootOrIsPrimary = true) {
        this.Id = id;
        this.Type = type;
        this.IsPrimary = typeof rootOrIsPrimary === 'boolean' ? rootOrIsPrimary : true;
        this._root = typeof rootOrIsPrimary === 'boolean' ? null : rootOrIsPrimary;
        this.Captured = null;
        this.CapturedGestureRecognizer = null;
        this.IsGestureRecognitionSkipped = false;
        this._captureVersion = 0;
    }
    Capture(control) { this._CaptureCore(control, null); }
    CaptureGestureRecognizer(recognizer) { this._CaptureCore(null, recognizer); }
    _CaptureCore(control, recognizer) {
        if ((this._disposed || this._cancelling) && (control || recognizer)) return;
        if (control === this.Captured && recognizer === this.CapturedGestureRecognizer) return;
        const old = this.Captured, oldRecognizer = this.CapturedGestureRecognizer;
        const version = ++this._captureVersion;
        this._captureLifetime?.Dispose();
        this._captureLifetime = null;
        this.Captured = control;
        this.CapturedGestureRecognizer = recognizer;
        if (recognizer) this._suppressTap = true;
        oldRecognizer?.PointerCaptureLostInternal(this);
        if (old && old !== control)
            old.RaiseEvent(new PointerEventArgs(InputElement.PointerCaptureLostEvent, old, this, new Point()));
        // Capture-lost handlers are permitted to recapture; do not overwrite them.
        if (this._captureVersion !== version) return;
        const target = recognizer?.Target ?? control;
        this._root?._CapturePointer?.(this, target);
        if (target) {
            this._captureLifetime = new CompositeDisposable();
            this._captureLifetime.Add(target.DetachedFromVisualTree?.Add(() => this.Cancel()));
            this._captureLifetime.Add(target.Disposed?.Add(() => this.Cancel()));
        }
    }
    Cancel() {
        if (this._cancelling) return;
        this._cancelling = true;
        try {
            this._suppressTap = true;
            const active = this.CapturedGestureRecognizer;
            const candidates = this._gestureCandidates ?? [];
            this._gestureCandidates = [];
            this._CaptureCore(null, null);
            for (const recognizer of candidates)
                if (recognizer !== active) recognizer.PointerCaptureLostInternal(this);
            this._pressTarget = null;
            this._pressPosition = null;
            this.IsGestureRecognitionSkipped = false;
        } finally { this._cancelling = false; }
    }
    Dispose() { if (this._disposed) return; this._disposed = true; this.Cancel(); }
}
export class PointerEventArgs extends RoutedEventArgs {
    constructor(event, source, pointer, position, original = null) {
        super(event, source);
        this.Pointer = pointer;
        this._position = position;
        this.OriginalEvent = original;
        this.KeyModifiers = original ? ModifiersFromDom(original) : 0;
        this.Timestamp = original?.timeStamp ?? performance.now();
    }
    GetPosition(relativeTo) {
        const matrix = relativeTo?.GetTransformToRoot() ?? Matrix.Identity;
        return matrix.HasInverse ? matrix.Invert().Transform(this._position) : new Point();
    }
    PreventGestureRecognition() { this.Pointer.IsGestureRecognitionSkipped = true; }
    GetCurrentPoint(relativeTo) {
        return { Pointer: this.Pointer, Position: this.GetPosition(relativeTo), Properties: { IsLeftButtonPressed: !!(this.OriginalEvent?.buttons & 1), IsRightButtonPressed: !!(this.OriginalEvent?.buttons & 2), IsMiddleButtonPressed: !!(this.OriginalEvent?.buttons & 4), Pressure: this.OriginalEvent?.pressure ?? 0, PointerUpdateKind: this.OriginalEvent?.type } };
    }
}
export class PointerPressedEventArgs extends PointerEventArgs {
    constructor(...args) {
        super(...args);
        this.ClickCount = this.OriginalEvent?.detail || 1;
    }
}
export class PointerReleasedEventArgs extends PointerEventArgs {
}
export class PointerWheelEventArgs extends PointerEventArgs {
    constructor(...args) {
        super(...args);
        // Read deltaMode before the values: some browser compatibility paths
        // select their units depending on whether the mode was observed first.
        this._wheelMode = this.OriginalEvent?.deltaMode ?? 0;
        this._wheelX = this.OriginalEvent?.deltaX ?? 0; this._wheelY = this.OriginalEvent?.deltaY ?? 0;
        this.Delta = new Point(-this._wheelX / 50, -this._wheelY / 50);
    }
    GetPixelDelta(viewport = new Size(800, 600), lineSize = 16) {
        const e = this.OriginalEvent;
        // Synthetic Avalonia events set Delta directly and have no DOM delta.
        if (!e || !('deltaX' in e || 'deltaY' in e)) return new Point(-this.Delta.X * lineSize, -this.Delta.Y * lineSize);
        const mode = this._wheelMode;
        const x = mode === 1 ? lineSize : mode === 2 ? viewport.Width : 1;
        const y = mode === 1 ? lineSize : mode === 2 ? viewport.Height : 1;
        return new Point(Number.isFinite(this._wheelX) ? this._wheelX * x : 0, Number.isFinite(this._wheelY) ? this._wheelY * y : 0);
    }
}
export class TextInputEventArgs extends RoutedEventArgs {
    constructor(source, text) {
        super(InputElement.TextInputEvent, source);
        this.Text = text;
    }
}
export const ModifiersFromDom = e => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.shiftKey ? 4 : 0) | (e.metaKey ? 8 : 0);
export class InputElement extends Interactive {
    constructor() {
        super();
        this.IsFocused = false;
        this.IsPointerOver = false;
        for (const name of ['PointerPressed', 'PointerReleased', 'PointerMoved', 'PointerWheelChanged', 'PointerCaptureLost', 'KeyDown', 'KeyUp', 'TextInput', 'GotFocus', 'LostFocus'])
            this.AddHandler(InputElement[`${name}Event`], (_, args) => this[`On${name}`]?.(args));
    }
    get GestureRecognizers() {
        if (!gestureServices) throw new Error('Import the controls package to register gesture services.');
        return this._gestureRecognizers ??= gestureServices.CreateCollection(this);
    }
    Dispose() {
        if (this.IsDisposed) return;
        this._gestureRecognizers?.Dispose();
        super.Dispose();
    }
    get IsEffectivelyEnabled() {
        return this.IsEnabled && (!this.VisualParent || this.VisualParent.IsEffectivelyEnabled !== false);
    }
    Focus(navigationMethod = 'Unspecified') {
        return this.GetVisualRoot()?.FocusManager?.Focus(this, navigationMethod) ?? false;
    }
    OnPointerPressed() {
    }
    OnPointerReleased() {
    }
    OnPointerMoved() {
    }
    OnPointerWheelChanged() {
    }
    OnPointerCaptureLost() {
    }
    OnKeyDown() {
    }
    OnKeyUp() {
    }
    OnTextInput() {
    }
    OnGotFocus() {
    }
    OnLostFocus() {
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'IsEnabled') {
            this.InvalidateStyles(true);
            if (!this.IsEnabled) this._gestureRecognizers?.Cancel();
            if (!this.IsEnabled && this.IsFocused)
                this.GetVisualRoot()?.FocusManager?.ClearFocus();
        }
    }
}
DefineProperties(InputElement, { IsEnabled: [true, { Convert: BooleanValue, Inherits: true }], Focusable: [false, { Convert: BooleanValue }], IsTabStop: [true, { Convert: BooleanValue }], TabIndex: [0, { Convert: Number }], Cursor: ['Default'], HotKey: [null] });
for (const name of ['PointerPressed', 'PointerReleased', 'PointerMoved', 'PointerWheelChanged', 'KeyDown', 'KeyUp', 'TextInput'])
    DefineRoutedEvent(InputElement, name, RoutingStrategies.Tunnel | RoutingStrategies.Bubble);
for (const name of ['PointerEntered', 'PointerExited', 'PointerCaptureLost', 'GotFocus', 'LostFocus', 'Tapped', 'DoubleTapped'])
    DefineRoutedEvent(InputElement, name, RoutingStrategies.Bubble);
export class FocusManager {
    constructor(root) {
        this.Root = root;
        this.FocusedElement = null;
        this.FocusChanged = new Event();
    }
    Focus(element, method = 'Unspecified') {
        if (element === this.FocusedElement)
            return true;
        if (element && (!element.Focusable || !element.IsEffectivelyEnabled || !element.IsEffectivelyVisible))
            return false;
        const old = this.FocusedElement;
        this.FocusedElement = element;
        if (old) {
            old.IsFocused = false;
            old.PseudoClasses.Set(':focus', false);
            old.PseudoClasses.Set(':focus-visible', false);
            old.RaiseEvent(new RoutedEventArgs(InputElement.LostFocusEvent, old));
        }
        if (element) {
            element.IsFocused = true;
            element.PseudoClasses.Set(':focus', true);
            element.PseudoClasses.Set(':focus-visible', method === 'Tab' || method === 'Directional');
            element.RaiseEvent(new RoutedEventArgs(InputElement.GotFocusEvent, element));
        }
        this.Root._OnFocusChanged?.(element, old);
        this.FocusChanged.Raise(this, { OldElement: old, NewElement: element });
        return true;
    }
    ClearFocus() {
        this.Focus(null);
    }
    Remove(element) {
        if (this.FocusedElement === element)
            this.ClearFocus();
    }
    MoveFocus(forward = true) {
        const candidates = [this.Root, ...this.Root.GetVisualDescendants()].filter(v => v.Focusable && v.IsTabStop && v.IsEffectivelyVisible && v.IsEffectivelyEnabled).sort((a, b) => a.TabIndex - b.TabIndex);
        if (!candidates.length)
            return false;
        const index = candidates.indexOf(this.FocusedElement);
        return this.Focus(candidates[(index + (forward ? 1 : candidates.length - 1)) % candidates.length], 'Tab');
    }
}
export class Control extends InputElement {
    constructor() {
        super();
        this.DataTemplates = new AvaloniaList();
    }
    Dispose() { if (this.IsDisposed) return; this._drawTextLayouts?.Dispose(); super.Dispose(); }
    GetAutomationPeer() { return this._automationPeer ?? null; }
    GetOrCreateAutomationPeer() {
        if (this.IsDisposed) throw new Error('Cannot create an automation peer for a disposed control.');
        return this._automationPeer ??= this.OnCreateAutomationPeer();
    }
    OnCreateAutomationPeer() { return automationPeerFactory?.(this) ?? null; }
    get Typeface() {
        const family = this.FontFamily, style = this.FontStyle, weight = this.FontWeight, stretch = this.FontStretch;
        const cached = this._typefaceCache;
        // Also detect external mutation of the previously returned descriptor.
        if (!cached || String(cached.FontFamily) !== String(family) || cached.Style !== style || cached.Weight !== weight || cached.Stretch !== stretch)
            this._typefaceCache = new Typeface(family, style, weight, stretch);
        return this._typefaceCache;
    }
    get Palette() {
        return this.ActualThemeVariant?.Key === 'Dark' ? Palettes.Dark : Palettes.Light;
    }
    Render(context) {
        if (this.Background)
            context.DrawRectangle(this.Background, null, new Rect(this.Bounds.Size), this.CornerRadius.TopLeft);
    }
    RenderAfter(context) {
        if (this.IsFocused && this.PseudoClasses.has(':focus-visible'))
            context.DrawRectangle(null, new Pen(this.Palette.Accent, 2), new Rect(this.Bounds.Size).Deflate(2), 4);
    }
    DrawText(context, text, rect, options = {}) {
        const layout = (this._drawTextLayouts ??= new TextLayoutCache(8)).GetOrCreate(String(text ?? ''), this.Typeface, options.FontSize ?? this.FontSize, options.Foreground ?? this.Foreground, { FlowDirection: this.FlowDirection, LetterSpacing: this.LetterSpacing, MaxWidth: Math.max(0, rect.Width), TextWrapping: options.TextWrapping ?? 'NoWrap', TextTrimming: 'CharacterEllipsis', TextAlignment: options.TextAlignment ?? 'Left', ...options });
        const y = rect.Y + (options.VerticalAlignment === 'Top' ? 0 : Math.max(0, (rect.Height - layout.Height) / 2));
        context.DrawTextLayout(layout, new Point(rect.X, y));
        return layout;
    }
}
DefineProperties(Control, {
    Background: [null, { Convert: BrushValue }], Foreground: [Brushes.Black, { Convert: BrushValue, Inherits: true }],
    FontFamily: ['system-ui', { Inherits: true, AffectsMeasure: true }], FontSize: [14, { Convert: Number, Inherits: true, AffectsMeasure: true }], FontWeight: [400, { Convert: v => typeof v === 'number' ? v : ({ Normal: 400, SemiBold: 600, Bold: 700, Light: 300 })[v] ?? Number(v), Inherits: true, AffectsMeasure: true }], FontStyle: ['Normal', { Inherits: true, AffectsMeasure: true }], FontStretch: [5, { Convert: v => typeof v === 'number' ? v : ({ UltraCondensed: 1, ExtraCondensed: 2, Condensed: 3, SemiCondensed: 4, Normal: 5, SemiExpanded: 6, Expanded: 7, ExtraExpanded: 8, UltraExpanded: 9 })[v] ?? Number(v), Inherits: true, AffectsMeasure: true }], LetterSpacing: [0, { Convert: Number, Inherits: true, AffectsMeasure: true }],
    Padding: [Thickness.Empty, { Convert: Thickness.From, AffectsMeasure: true }], BorderBrush: [null, { Convert: BrushValue }], BorderThickness: [Thickness.Empty, { Convert: Thickness.From, AffectsMeasure: true }], CornerRadius: [new CornerRadius(), { Convert: CornerRadius.From }],
    HorizontalContentAlignment: ['Stretch', { AffectsArrange: true }], VerticalContentAlignment: ['Stretch', { AffectsArrange: true }],
});
const palette = values => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Brush.Parse(v)]));
export const Palettes = Object.freeze({
    Light: palette({ Window: '#F3F3F3', Surface: '#FFFFFF', SurfaceAlt: '#F7F7F8', Text: '#202020', Muted: '#666A73', Border: '#D5D6DC', Hover: '#EBEDF2', Pressed: '#E1E4EB', Accent: '#4261DB', AccentText: '#FFFFFF', Selection: '#E7EBFF', Error: '#C42B1C', Track: '#C5C6CE' }),
    Dark: palette({ Window: '#18191D', Surface: '#222329', SurfaceAlt: '#292A32', Text: '#F1F2F5', Muted: '#A5A7B4', Border: '#3D3F49', Hover: '#333540', Pressed: '#3D4050', Accent: '#A4B3FF', AccentText: '#18204A', Selection: '#343D61', Error: '#FF999E', Track: '#545665' }),
});
export class LayoutManager {
    constructor(root) {
        this.Root = root;
        this.LayoutPasses = 0;
        this.MaxPasses = 16;
    }
    ExecuteLayoutPass(size = this.Root.ClientSize) {
        let passes = 0;
        do {
            this.Root.Measure(size);
            this.Root.Arrange(new Rect(size));
            if (++passes > this.MaxPasses)
                throw new Error('Layout failed to converge within 16 passes.');
        } while (!this.Root.IsMeasureValid || !this.Root.IsArrangeValid);
        this.LayoutPasses += passes;
        return passes;
    }
}

// Browser extension: explicit opt-in to speculative, coverage-bounded wheel scrolling.
DefineProperties(Control,{IsCompositorScrollingEnabled:[false,{Convert:BooleanValue,AffectsRender:true}]});
