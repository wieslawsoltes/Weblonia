import { Disposable, Point, Size, Rect, Matrix, AvaloniaList, Event } from '@wieslawsoltes/avalonia-base';
import { Brushes, Typeface } from './brushes.js';
import { TextLayout } from './text.js';
export class DrawingContext {
    constructor() {
        this._stack = [];
        this.Transform = Matrix.Identity;
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
        const depth = this._stack.length;
        this._stack.push({ kind, value });
        this.OnPush(kind, value);
        return Disposable.Create(() => {
            if (this._stack.length !== depth + 1)
                throw new Error('DrawingContext states must be disposed in LIFO order.');
            this._stack.pop();
            this.OnPop(kind, value);
        });
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
    }
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
        this.Commands.push({ Op: 'Image', Source: source, SourceRect: sourceRect, DestRect: destRect ?? sourceRect });
    }
    DrawTextLayout(layout, origin) {
        this.Commands.push({ Op: 'Text', Text: layout.Text, Layout: layout, Origin: origin });
    }
}
export class Drawing {
    Draw() {
    }
    get Bounds() {
        return Rect.Empty;
    }
}
export class GeometryDrawing extends Drawing {
    constructor(brush = null, pen = null, geometry = null) {
        super();
        this.Brush = brush;
        this.Pen = pen;
        this.Geometry = geometry;
    }
    Draw(ctx) {
        if (this.Geometry)
            ctx.DrawGeometry(this.Brush, this.Pen, this.Geometry);
    }
    get Bounds() {
        return this.Geometry?.GetRenderBounds(this.Pen) ?? Rect.Empty;
    }
}
export class ImageDrawing extends Drawing {
    constructor(image = null, rect = Rect.Empty) {
        super();
        this.ImageSource = image;
        this.Rect = rect;
    }
    Draw(ctx) {
        ctx.DrawImage(this.ImageSource, this.Rect);
    }
    get Bounds() {
        return this.Rect;
    }
}
export class DrawingGroup extends Drawing {
    constructor(children = []) {
        super();
        this.Children = new AvaloniaList(children);
        this.Transform = Matrix.Identity;
        this.Opacity = 1;
        this.ClipGeometry = null;
    }
    Draw(ctx) {
        const states = [ctx.PushTransform(this.Transform), ctx.PushOpacity(this.Opacity)];
        if (this.ClipGeometry)
            states.push(ctx.PushGeometryClip(this.ClipGeometry));
        try {
            for (const child of this.Children)
                child.Draw(ctx);
        }
        finally {
            for (const state of states.reverse())
                state.Dispose();
        }
    }
    get Bounds() {
        return [...this.Children].reduce((r, c) => r.Union(c.Bounds), Rect.Empty);
    }
}
export class DrawingImage {
    constructor(drawing = null) {
        this.Drawing = drawing;
    }
    get Size() {
        return this.Drawing?.Bounds.Size ?? Size.Empty;
    }
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
        return { Address: this.Pixels, RowBytes: this.PixelSize.Width * 4, Size: this.PixelSize, Format: 'Rgba8888', Dispose: () => this.Changed.Raise(this, {}) };
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
