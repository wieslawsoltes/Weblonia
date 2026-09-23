import { Effect, IEffect } from './effects.js';
import { GlyphRun, ImmutableGlyphRunReference } from './glyph-run.js';
import { Disposable, Point, Size, Rect, Matrix, AvaloniaList, Event, AvaloniaObject, AvaloniaProperty, DefineProperties, CompositeDisposable } from '@wieslawsoltes/avalonia-base';
import { Brush, Typeface } from './brushes.js';
import { Geometry, RectangleGeometry, EllipseGeometry, LineGeometry } from './geometry.js';
import { Transform } from './transforms.js';
import { TextLayout, GetTextServiceVersion } from './text.js';

export class DrawingContext {
    constructor() {
        this._stack = [];
        this.Transform = Matrix.Identity; this.IsDisposed = false;
    }
    PushTransform(matrix) {
        return this._push('Transform', matrix.Value ?? matrix);
    }
    PushClip(rect) {
        return this._push('Clip', rect);
    }
    PushGeometryClip(geometry) {
        return this._push('GeometryClip', geometry);
    }
    PushOpacity(opacity) {
        return this._push('Opacity', opacity);
    }
    PushEffect(effect) {
        return this._push('Effect', effect);
    }
    PushOpacityMask(brush, bounds) {
        return this._push('OpacityMask', { Brush: brush, Bounds: bounds });
    }
    _push(kind, value) {
        if (this.IsDisposed) throw new Error('DrawingContext is disposed.');
        if (kind === 'Transform' && (!(value instanceof Matrix) || !['M11','M12','M21','M22','M31','M32'].every(k => Number.isFinite(value[k]))))
            throw new TypeError('Drawing transforms require a finite Matrix.');
        const state = new DrawingContextPushedState(this, kind, value, this.Transform);
        // Do not publish a scope before the backend successfully establishes it.
        this.OnPush(kind, value); this._stack.push(state);
        if (kind === 'Transform') this.Transform = value.Multiply(this.Transform);
        return state;
    }
    OnPush() {
    }
    OnPop() {
    }
    DrawRectangle() {
        throw new Error('DrawingContext.DrawRectangle is abstract.');
    }
    DrawEllipse() {
        throw new Error('DrawingContext.DrawEllipse is abstract.');
    }
    DrawLine() {
        throw new Error('DrawingContext.DrawLine is abstract.');
    }
    DrawGeometry() {
        throw new Error('DrawingContext.DrawGeometry is abstract.');
    }
    DrawImage() {
        throw new Error('DrawingContext.DrawImage is abstract.');
    }
    DrawText(formattedText, origin = new Point()) {
        this.DrawTextLayout(formattedText.TextLayout ?? formattedText, origin);
    }
    DrawGlyphRun() { throw new Error('DrawingContext.DrawGlyphRun is abstract.'); }
    DrawTextLayout() {
        throw new Error('DrawingContext.DrawTextLayout is abstract.');
    }
    DrawDrawing(drawing) {
        drawing?.Draw(this);
    }
    Custom(operation) {
        operation.Render(this);
    }
    Dispose() {
        if (this._stack.length)
            throw new Error('DrawingContext has unbalanced states.');
        this.IsDisposed = true;
    }
}
/** Unlike Disposable.Create, an out-of-order attempt does not consume the token. */
export class DrawingContextPushedState {
    constructor(context, kind, value, transform) { this.Context = context; this.Kind = kind; this.Value = value; this.PreviousTransform = transform; this.IsDisposed = false; }
    Dispose() {
        if (this.IsDisposed) return;
        const context = this.Context;
        if (context._stack.at(-1) !== this) throw new Error('DrawingContext states must be disposed in LIFO order.');
        context._stack.pop(); this.IsDisposed = true;
        try { context.OnPop(this.Kind, this.Value); }
        finally { context.Transform = this.PreviousTransform; this.Context = this.Value = null; }
    }
    unsubscribe() { this.Dispose(); }
    [Symbol.dispose]() { this.Dispose(); }
}
export class RecordingDrawingContext extends DrawingContext {
    constructor() {
        super();
        this.Commands = [];
    }
    OnPush(kind, value) {
        this.Commands.push({ Op: 'Push', Kind: kind, Value: value });
    }
    OnPop(kind) {
        this.Commands.push({ Op: 'Pop', Kind: kind });
    }
    DrawRectangle(brush, pen, rect, radiusX = 0, radiusY = radiusX, boxShadows = null) {
        this.Commands.push({ Op: 'Rectangle', Brush: brush, Pen: pen, Rect: rect, RadiusX: radiusX, RadiusY: radiusY, BoxShadows: boxShadows });
    }
    DrawEllipse(brush, pen, center, radiusX, radiusY) {
        this.Commands.push({ Op: 'Ellipse', Brush: brush, Pen: pen, Center: center, RadiusX: radiusX, RadiusY: radiusY });
    }
    DrawLine(pen, p1, p2) {
        this.Commands.push({ Op: 'Line', Pen: pen, Point1: p1, Point2: p2 });
    }
    DrawGeometry(brush, pen, geometry) {
        this.Commands.push({ Op: 'Geometry', Brush: brush, Pen: pen, Geometry: geometry });
    }
    DrawImage(source, sourceRect, destRect) {
        if (source instanceof DrawingImage) { source.Draw(this, sourceRect, destRect); return; }
        this.Commands.push({ Op: 'Image', Source: source, SourceRect: sourceRect, DestRect: destRect ?? sourceRect });
    }
    DrawGlyphRun(foreground, glyphRun) { this.Commands.push({Op:'GlyphRun',Foreground:foreground,GlyphRun:glyphRun}); }
    DrawTextLayout(layout, origin) {
        this.Commands.push({ Op: 'Text', Text: layout.Text, Layout: layout, Origin: origin });
    }
}
// Traverse only known drawing edges, not arbitrary user object properties.
function assertAcyclic(owner, candidate) {
    const visiting = new Set(), visited = new Set();
    const visit = value => {
        if (!(value instanceof Drawing || value instanceof DrawingImage)) return;
        if (value === owner || visiting.has(value)) throw new Error('Drawing graph contains a cycle.');
        if (visited.has(value)) return;
        visiting.add(value);
        if (value instanceof DrawingGroup) for (const child of value.Children) visit(child);
        if (value instanceof DrawingImage) visit(value.Drawing);
        if (value instanceof ImageDrawing) visit(value.ImageSource);
        visiting.delete(value); visited.add(value);
    };
    visit(candidate);
}
const resourceMembers = ['Brush', 'Pen', 'Geometry', 'ImageSource', 'Drawing', 'Transform', 'ClipGeometry', 'OpacityMask', 'Effect', 'Source', 'DashStyle', 'Foreground', 'Layout', 'GlyphRun'];
/** Observable rendering-resource owner. Dependents are borrowed; Dispose only
 * removes subscriptions, never disposes brushes/geometries supplied by callers. */
class DrawingResource extends AvaloniaObject {
    constructor() { super(); this.Invalidated = new Event(); this.Changed = this.Invalidated; this._dependencies = new CompositeDisposable(); this._revision = 0; }
    _SetPriorityValue(property, value, ...args) {
        if (property.Name === 'Drawing' || property.Name === 'ImageSource') assertAcyclic(this, value);
        return super._SetPriorityValue(property, value, ...args);
    }
    _Rewire() {
        if (!this._dependencies || this.IsDisposed) return;
        this._dependencies.Clear(); const seen = new Set([this]);
        const refresh = () => { if (!this.IsDisposed) { this._Rewire(); this.RaiseInvalidated(); } };
        const observe = value => {
            if (!value || typeof value !== 'object' || seen.has(value)) return;
            seen.add(value);
            if (value.Invalidated?.Add) { this._dependencies.Add(value.Invalidated.Add(refresh)); return; }
            const event = value.Changed ?? value.PropertyChanged;
            if (event?.Add) this._dependencies.Add(event.Add(refresh));
            if (value instanceof AvaloniaList) { this._dependencies.Add(value.CollectionChanged.Add(refresh)); for (const child of value) observe(child); }
            for (const name of resourceMembers) if (value[name]) observe(value[name]);
            for (const run of value.TextRuns ?? []) observe(run);
            for (const name of ['Children', 'GradientStops', 'Figures', 'Segments', 'Dashes']) if (value[name] instanceof AvaloniaList) observe(value[name]);
        };
        for (const name of resourceMembers) observe(this[name]);
        if (this instanceof DrawingGroup) observe(this.Children);
    }
    OnPropertyChanged(change) { super.OnPropertyChanged(change); this._Rewire(); this.RaiseInvalidated(); }
    RaiseInvalidated() {
        if (this.IsDisposed || this._raisingInvalidated) return;
        ++this._revision; this._raisingInvalidated = true;
        try { this.Invalidated?.Raise(this, {}); } finally { this._raisingInvalidated = false; }
    }
    Dispose() { if (!this.IsDisposed) { this._dependencies.Dispose(); this.Invalidated.Clear(); super.Dispose(); } }
}
export class Drawing extends DrawingResource {
    Draw(context) { if (this.IsDisposed) throw new Error('Drawing is disposed.'); this.DrawCore(context); }
    DrawCore() { }
    GetBounds() { return Rect.Empty; }
    get Bounds() { return this.GetBounds(); }
}
export class GeometryDrawing extends Drawing {
    constructor(brush = null, pen = null, geometry = null) { super(); this.Brush = brush; this.Pen = pen; this.Geometry = geometry; }
    DrawCore(context) { if (this.Geometry) context.DrawGeometry(this.Brush, this.Pen, this.Geometry); }
    GetBounds() { return this.Geometry?.GetRenderBounds(this.Pen) ?? Rect.Empty; }
}
DefineProperties(GeometryDrawing, { Brush: [null, { Convert: v => v == null ? null : Brush.Parse(v) }], Pen: [null], Geometry: [null, { Convert: v => v == null ? null : Geometry.Parse(v) }] });
export class GlyphRunDrawing extends Drawing {
    constructor(foreground = null, glyphRun = null) { super(); this.Foreground = foreground; this.GlyphRun = glyphRun; }
    DrawCore(context) { if (this.GlyphRun) context.DrawGlyphRun(this.Foreground, this.GlyphRun); }
    GetBounds() { return this.GlyphRun?.Bounds ?? Rect.Empty; }
}
DefineProperties(GlyphRunDrawing, {
    Foreground: [null, { Convert: v => v == null ? null : Brush.Parse(v) }],
    GlyphRun: [null, { Validate: v => v == null || (v instanceof GlyphRun || v instanceof ImmutableGlyphRunReference) && !v.IsDisposed }]
});
export class ImageDrawing extends Drawing {
    constructor(image = null, rect = Rect.Empty) { super(); this.ImageSource = image; this.Rect = rect; }
    DrawCore(context) { if (this.ImageSource) { if (this._sourceRect) context.DrawImage(this.ImageSource, this._sourceRect, this.Rect); else context.DrawImage(this.ImageSource, this.Rect); } }
    GetBounds() { return this.Rect; }
}
DefineProperties(ImageDrawing, { ImageSource: [null], Rect: [Rect.Empty, { Convert: v => v instanceof Rect ? v : Rect.Parse(v) }] });
export class DrawingCollection extends AvaloniaList {
    constructor(items = []) {
        super(items); this._owners = new Set();
        for (const item of this) this._ValidateItem(item);
        this.ValidateMutation = change => { for (const item of change.NewItems) this._ValidateItem(item); };
    }
    _ValidateItem(item) {
        if (!(item instanceof Drawing) || item.IsDisposed) throw new TypeError('DrawingCollection requires live Drawing objects.');
        for (const owner of this._owners) assertAcyclic(owner, item);
    }
}
function disposeDrawingStates(states, originalError = null) {
    let failures;
    while (states.length) { try { states.pop().Dispose(); } catch (error) { (failures ??= []).push(error); } }
    if (failures) { if (originalError) failures.unshift(originalError); throw failures.length === 1 ? failures[0] : new AggregateError(failures, 'Drawing scope cleanup failed.'); }
}
export class DrawingGroup extends Drawing {
    constructor(children = []) { super(); this._children = null; this._ownedDrawings = new Set(); this.Children = new DrawingCollection(children); }
    get Children() { return this._children; }
    set Children(value) {
        if (this.IsDisposed) throw new Error('DrawingGroup is disposed.');
        if (value === this._children) return;
        if (!(value instanceof DrawingCollection)) value = new DrawingCollection(value ?? []);
        for (const child of value) assertAcyclic(this, child);
        const old = this._children; old?._owners.delete(this); value._owners.add(this);
        this.SetAndRaise(DrawingGroup.ChildrenProperty, '_children', value);
    }
    GetBounds() {
        let bounds = Rect.Empty;
        for (const child of this.Children) bounds = bounds.Union(child.GetBounds());
        return this.Transform ? bounds.TransformToAABB(this.Transform.Value ?? this.Transform) : bounds;
    }
    DrawCore(context) {
        const states = []; let failure;
        try {
            states.push(context.PushTransform(this.Transform?.Value ?? this.Transform ?? Matrix.Identity));
            states.push(context.PushOpacity(this.Opacity));
            if (this.ClipGeometry) states.push(context.PushGeometryClip(this.ClipGeometry));
            let bounds = Rect.Empty;
            if (this.OpacityMask) { for (const child of this.Children) bounds = bounds.Union(child.GetBounds()); states.push(context.PushOpacityMask(this.OpacityMask, this._maskBounds ?? bounds)); }
            if (this.Effect) states.push(context.PushEffect(this.Effect));
            for (const child of this.Children) child.Draw(context);
        } catch (error) { failure = error; throw error; }
        finally { disposeDrawingStates(states, failure); }
    }
    Open() { if (this.IsDisposed) throw new Error('DrawingGroup is disposed.'); return new DrawingGroupDrawingContext(this); }
    Dispose() {
        if (this.IsDisposed) return;
        this._children?._owners.delete(this); super.Dispose();
        for (const drawing of this._ownedDrawings) drawing.Dispose(); this._ownedDrawings.clear();
    }
}
DrawingGroup.ChildrenProperty = AvaloniaProperty.RegisterDirect(DrawingGroup, 'Children', o => o.Children, (o,v) => { o.Children = v; });
DefineProperties(DrawingGroup, {
    Transform: [null, { Convert: v => v == null ? null : Transform.Parse(v) }], Opacity: [1, { Convert: Number, Validate: v => Number.isFinite(v) && v >= 0 && v <= 1 }],
    ClipGeometry: [null, { Convert: v => v == null ? null : Geometry.Parse(v) }], OpacityMask: [null, { Convert: v => v == null ? null : Brush.Parse(v) }], Effect: [null, { Convert: v => v == null || v instanceof IEffect ? v : Effect.Parse(v), Validate: v => v == null || v instanceof IEffect }],
});
export class DrawingImage extends DrawingResource {
    constructor(drawing = null) { super(); this.Drawing = drawing; }
    GetBounds() { return this.Viewbox ?? this.Drawing?.GetBounds() ?? Rect.Empty; }
    get Size() { return this.GetBounds().Size; }
    Draw(context, sourceRect, destRect) {
        if (this.IsDisposed) throw new Error('DrawingImage is disposed.');
        const bounds = this.GetBounds();
        if (!destRect) { destRect = sourceRect; sourceRect = new Rect(bounds.Size); }
        if (!this.Drawing || bounds.IsEmpty || !sourceRect || sourceRect.IsEmpty || !destRect || destRect.IsEmpty) return;
        const sx = destRect.Width / sourceRect.Width, sy = destRect.Height / sourceRect.Height;
        // Destination coordinates are in the receiving context, not pre-scaled.
        const matrix = new Matrix(sx, 0, 0, sy, destRect.X - (sourceRect.X + bounds.X) * sx, destRect.Y - (sourceRect.Y + bounds.Y) * sy);
        const states = [context.PushClip(destRect)]; let failure;
        try { states.push(context.PushTransform(matrix)); this.Drawing.Draw(context); }
        catch (error) { failure = error; throw error; }
        finally { disposeDrawingStates(states, failure); }
    }
}
DefineProperties(DrawingImage, { Drawing: [null], Viewbox: [null, { Convert: v => v == null || v instanceof Rect ? v : Rect.Parse(v) }] });

/** Transactional retained drawing builder. Existing content stays visible until
 * Dispose commits; Abort discards new owned records. DrawDrawing borrows inputs. */
export class DrawingGroupDrawingContext extends DrawingContext {
    constructor(group) { super(); this._group = group; this._root = new DrawingGroup(); this._current = this._root; this._groups = []; this._owned = new Set([this._root]); }
    _Add(drawing, owned = true) {
        if (this.IsDisposed) throw new Error('DrawingContext is disposed.');
        assertAcyclic(this._group, drawing);
        this._current.Children.Add(drawing); if (owned) this._owned.add(drawing); return drawing;
    }
    OnPush(kind, value) {
        const group = new DrawingGroup(); this._owned.add(group);
        if (kind === 'Transform') group.Transform = value;
        else if (kind === 'Opacity') group.Opacity = value;
        else if (kind === 'Clip') { group.ClipGeometry = new RectangleGeometry(value); group._lifetime.Add(group.ClipGeometry); }
        else if (kind === 'GeometryClip') group.ClipGeometry = value;
        else if (kind === 'Effect') group.Effect = value;
        else if (kind === 'OpacityMask') { group.OpacityMask = value.Brush; group._maskBounds = value.Bounds; }
        else throw new TypeError(`Unsupported drawing state '${kind}'.`);
        this._current.Children.Add(group); this._groups.push(this._current); this._current = group;
    }
    OnPop() { this._current = this._groups.pop(); }
    DrawDrawing(drawing) { if (drawing) this._Add(drawing, false); }
    DrawGeometry(brush, pen, geometry) { this._Add(new GeometryDrawing(brush, pen, geometry)); }
    DrawRectangle(brush, pen, rect, radiusX = 0, radiusY = radiusX, shadows = null) {
        if (shadows?.length) throw new TypeError('DrawingGroup.Open rectangle shadows require an explicit Effect drawing.');
        const geometry = new RectangleGeometry(rect); geometry.RadiusX = radiusX; geometry.RadiusY = radiusY;
        const drawing = this._Add(new GeometryDrawing(brush, pen, geometry)); drawing._lifetime.Add(geometry);
    }
    DrawEllipse(brush, pen, center, radiusX, radiusY = radiusX) {
        const geometry = new EllipseGeometry(new Rect(center.X-radiusX, center.Y-radiusY, radiusX*2, radiusY*2));
        const drawing = this._Add(new GeometryDrawing(brush, pen, geometry)); drawing._lifetime.Add(geometry);
    }
    DrawLine(pen, p1, p2) { const geometry = new LineGeometry(p1,p2); const drawing = this._Add(new GeometryDrawing(null,pen,geometry)); drawing._lifetime.Add(geometry); }
    DrawImage(image, sourceRect, destRect) {
        if (image instanceof DrawingImage) { image.Draw(this, sourceRect, destRect); return; }
        if (destRect) {
            const drawing = new ImageDrawing(image, destRect); drawing._sourceRect = sourceRect;
            this._Add(drawing);
        } else this._Add(new ImageDrawing(image, sourceRect));
    }
    DrawGlyphRun(foreground, glyphRun) {
        if (!glyphRun || !foreground) return;
        const retained = glyphRun.TryCreateImmutableGlyphRunReference();
        const drawing = new GlyphRunDrawing(foreground, retained);
        drawing._lifetime.Add(retained);
        try { this._Add(drawing); } catch (error) { drawing.Dispose(); throw error; }
    }
    DrawTextLayout(layout, origin = new Point()) {
        if (layout.IsDisposed) throw new Error('Cannot record a disposed TextLayout.');
        const retained = cloneTextLayout(layout);
        const drawing = new TextLayoutDrawing(retained, new Point(origin.X, origin.Y));
        try { this._Add(drawing); } catch (error) { drawing.Dispose(); throw error; }
    }
    Abort() {
        if (this.IsDisposed) return;
        this.IsDisposed = true;
        while (this._stack.length) this._stack.at(-1).Dispose();
        for (const drawing of this._owned) drawing.Dispose(); this._owned.clear(); this._group = this._root = this._current = null;
    }
    Dispose() {
        if (this.IsDisposed) return;
        while (this._stack.length) this._stack.at(-1).Dispose();
        const group = this._group, next = new DrawingCollection(this._root.Children), previousOwned = group._ownedDrawings;
        try { group.Children = next; }
        catch (error) { this.Abort(); throw error; }
        const reachable = new Set();
        const visit = drawing => { if (!drawing || reachable.has(drawing)) return; reachable.add(drawing);
            if (drawing instanceof DrawingGroup) for (const child of drawing.Children) visit(child);
            if (drawing instanceof ImageDrawing && drawing.ImageSource instanceof DrawingImage) visit(drawing.ImageSource.Drawing); };
        for (const drawing of next) visit(drawing);
        this._root.Dispose(); this._owned.delete(this._root);
        for (const drawing of previousOwned) if (reachable.has(drawing)) this._owned.add(drawing);
        group._ownedDrawings = this._owned; this._owned = new Set();
        this.IsDisposed = true; this._group = this._root = this._current = null;
        for (const drawing of previousOwned) if (!reachable.has(drawing)) drawing.Dispose();
    }
}
function cloneTextLayout(layout) {
        const options = {};
        for (const key of ['MaxWidth','MaxHeight','TextWrapping','TextAlignment','TextTrimming','FlowDirection','LineHeight','MaxLines','LetterSpacing','WordSpacing','FontKerning','TextRendering','Culture','FontFeatures'])
            if (key in layout) options[key] = layout[key];
        if (layout.TextRuns) options.TextRuns = layout.TextRuns.map(run => ({...run, Typeface: run.Typeface ? new Typeface(run.Typeface.FontFamily, run.Typeface.Style, run.Typeface.Weight, run.Typeface.Stretch) : undefined}));
        const typeface = new Typeface(layout.Typeface.FontFamily, layout.Typeface.Style, layout.Typeface.Weight, layout.Typeface.Stretch);
        return new TextLayout(layout.Text, typeface, layout.FontSize, layout.Foreground, options);
}
// Browser text is retained through the existing shaping service; it is not
// presented as a CLR GlyphRun or a native-pointer-compatible object.
class TextLayoutDrawing extends Drawing {
    constructor(layout, origin) { super(); this.Layout = layout; this.Origin = origin; this._Rewire(); this._layoutRevision = this._revision; this._fontVersion = GetTextServiceVersion(); }
    DrawCore(context) {
        const version=GetTextServiceVersion();
        if(this._layoutRevision!==this._revision||this._fontVersion!==version) {
            const next=cloneTextLayout(this.Layout);this.Layout.Dispose();this.Layout=next;this._Rewire();this._layoutRevision=this._revision;this._fontVersion=version;
        }
        context.DrawTextLayout(this.Layout, this.Origin);
    }
    GetBounds() { return new Rect(this.Origin, this.Layout.Size); }
    Dispose() { if (!this.IsDisposed) { this.Layout.Dispose(); super.Dispose(); } }
}
export class Bitmap extends Disposable {
    constructor(source) {
        super();
        this.Source = source;
        this.PixelSize = Size.Empty;
        this.Dpi = new Point(96, 96);
        this.Changed = new Event();
        this._native = null;
        this._load = null;
    }
    get Size() {
        return new Size(this.PixelSize.Width * 96 / this.Dpi.X, this.PixelSize.Height * 96 / this.Dpi.Y);
    }
    Dispose() {
        this._native?.Dispose();
        this._native = null;
        this.Changed.Clear();
        super.Dispose();
    }
}
export class WriteableBitmap extends Bitmap {
    constructor(pixelSize, dpi = new Point(96, 96)) {
        super(null);
        this.PixelSize = pixelSize;
        this.Dpi = dpi;
        this.Pixels = new Uint8Array(pixelSize.Width * pixelSize.Height * 4);
    }
    Lock() {
        if (this.IsDisposed) throw new Error('Bitmap is disposed.');
        const lease = Disposable.Create(() => { if (this.IsDisposed) return; this._native?.Dispose(); this._native = null; this.Changed.Raise(this, {}); });
        return Object.assign(lease, { Address: this.Pixels, RowBytes: this.PixelSize.Width * 4, Size: this.PixelSize, Format: 'Rgba8888' });
    }
}
export class RenderTargetBitmap extends Bitmap {
    constructor(pixelSize, dpi = new Point(96, 96)) {
        super(null);
        this.PixelSize = pixelSize;
        this.Dpi = dpi;
    }
    async Render(visual) {
        if (!RenderTargetBitmap.Renderer)
            throw new Error('RenderTargetBitmap requires an initialized rendering backend.');
        await RenderTargetBitmap.Renderer(this, visual);
    }
}
