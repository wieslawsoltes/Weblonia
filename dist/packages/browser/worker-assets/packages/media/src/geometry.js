import { AvaloniaObject, DefineProperties, AvaloniaList, Point, Size, Rect, Matrix, Disposable } from "../../base/src/index.js";
let backend = null;
export function RegisterGeometryBackend(value) {
    backend = value;
}
export const FillRule = Object.freeze({ EvenOdd: 'EvenOdd', NonZero: 'NonZero' });
export const GeometryCombineMode = Object.freeze({ Union: 'Union', Intersect: 'Intersect', Xor: 'Xor', Exclude: 'Exclude' });
export class Geometry extends AvaloniaObject {
    get Bounds() {
        const bounds = backend?.GetBounds?.(this);
        return bounds ?? this._bounds ?? Rect.Empty;
    }
    get Data() {
        return '';
    }
    FillContains(point) {
        return backend?.FillContains?.(this, point) ?? this.Bounds.Contains(point);
    }
    StrokeContains(pen, point) {
        return backend?.StrokeContains?.(this, pen, point) ?? this.Bounds.Inflate(pen.Thickness / 2).Contains(point);
    }
    GetRenderBounds(pen = null) {
        return pen ? this.Bounds.Inflate(pen.Thickness / 2) : this.Bounds;
    }
    Clone() {
        const g = new StreamGeometry(this.Data);
        g.FillRule = this.FillRule;
        g.Transform = this.Transform;
        return g;
    }
    static Parse(value) {
        return value instanceof Geometry ? value : StreamGeometry.Parse(value);
    }
    static Combine(a, b, mode = 'Union', transform = null) {
        return new CombinedGeometry(mode, a, b, transform);
    }
}
DefineProperties(Geometry, { Transform: [null], FillRule: ['EvenOdd'] });
export class StreamGeometry extends Geometry {
    constructor(data = '') {
        super();
        this._data = String(data);
    }
    get Data() {
        return this._data;
    }
    set Data(v) {
        this._data = String(v);
        this._revision = (this._revision ?? 0) + 1;
    }
    static Parse(value) {
        if (value instanceof StreamGeometry)
            return value;
        const s = String(value).trim();
        if (s && !/^(F[01]\s*)?[Mm]/.test(s))
            throw new TypeError('A path must begin with a move command.');
        const g = new StreamGeometry(s.replace(/^F[01]\s*/, ''));
        if (/^F1/.test(s))
            g.FillRule = 'NonZero';
        return g;
    }
    Open() {
        return new StreamGeometryContext(this);
    }
}
export class StreamGeometryContext extends Disposable {
    constructor(geometry) {
        super();
        this._geometry = geometry;
        this._commands = [];
        this._points = [];
    }
    _point(p) {
        this._points.push(p);
        return `${p.X} ${p.Y}`;
    }
    BeginFigure(startPoint, _isFilled = true) {
        this._commands.push(`M${this._point(startPoint)}`);
    }
    LineTo(point) {
        this._commands.push(`L${this._point(point)}`);
    }
    CubicBezierTo(p1, p2, p3) {
        this._commands.push(`C${this._point(p1)} ${this._point(p2)} ${this._point(p3)}`);
    }
    QuadraticBezierTo(p1, p2) {
        this._commands.push(`Q${this._point(p1)} ${this._point(p2)}`);
    }
    ArcTo(point, size, rotationAngle = 0, isLargeArc = false, sweepDirection = 'Clockwise') {
        this._commands.push(`A${size.Width} ${size.Height} ${rotationAngle} ${isLargeArc ? 1 : 0} ${sweepDirection === 'Clockwise' ? 1 : 0} ${this._point(point)}`);
    }
    EndFigure(isClosed = false) {
        if (isClosed)
            this._commands.push('Z');
    }
    SetFillRule(rule) {
        this._geometry.FillRule = rule;
    }
    Dispose() {
        if (this.IsDisposed)
            return;
        this._geometry.Data = this._commands.join(' ');
        if (this._points.length) {
            const xs = this._points.map(p => p.X), ys = this._points.map(p => p.Y), x = Math.min(...xs), y = Math.min(...ys);
            this._geometry._bounds = new Rect(x, y, Math.max(...xs) - x, Math.max(...ys) - y);
        }
        super.Dispose();
    }
}
export class RectangleGeometry extends Geometry {
    constructor(rect = Rect.Empty) {
        super();
        this.Rect = rect;
    }
    get Data() {
        const r = this.Rect;
        return `M${r.X} ${r.Y}H${r.Right}V${r.Bottom}H${r.X}Z`;
    }
    get Bounds() {
        return this.Transform ? this.Rect.TransformToAABB(this.Transform.Value ?? this.Transform) : this.Rect;
    }
}
DefineProperties(RectangleGeometry, { Rect: [Rect.Empty], RadiusX: [0], RadiusY: [0] });
export class EllipseGeometry extends Geometry {
    constructor(rect = Rect.Empty) {
        super();
        this.Rect = rect;
    }
    get Data() {
        const r = this.Rect, cx = r.Center.X, cy = r.Center.Y, rx = r.Width / 2, ry = r.Height / 2;
        return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    get Bounds() {
        return this.Rect;
    }
}
DefineProperties(EllipseGeometry, { Rect: [Rect.Empty] });
export class LineGeometry extends Geometry {
    constructor(start = new Point(), end = new Point()) {
        super();
        this.StartPoint = start;
        this.EndPoint = end;
    }
    get Data() {
        return `M${this.StartPoint.X} ${this.StartPoint.Y}L${this.EndPoint.X} ${this.EndPoint.Y}`;
    }
    get Bounds() {
        const a = this.StartPoint, b = this.EndPoint;
        return new Rect(Math.min(a.X, b.X), Math.min(a.Y, b.Y), Math.abs(b.X - a.X), Math.abs(b.Y - a.Y));
    }
}
DefineProperties(LineGeometry, { StartPoint: [new Point()], EndPoint: [new Point()] });
export class GeometryGroup extends Geometry {
    constructor(children = []) {
        super();
        this.Children = new AvaloniaList(children);
    }
    get Data() {
        return [...this.Children].map(c => c.Data).join(' ');
    }
    get Bounds() {
        return [...this.Children].reduce((r, c) => r.Union(c.Bounds), Rect.Empty);
    }
}
export class CombinedGeometry extends Geometry {
    constructor(mode = 'Union', a = null, b = null, transform = null) {
        super();
        this.GeometryCombineMode = mode;
        this.Geometry1 = a;
        this.Geometry2 = b;
        this.Transform = transform;
    }
    get Data() {
        return backend?.Combine?.(this.Geometry1, this.Geometry2, this.GeometryCombineMode) ?? (() => {
            throw new Error('Geometry boolean operations require the Skia backend.');
        })();
    }
}
DefineProperties(CombinedGeometry, { GeometryCombineMode: ['Union'], Geometry1: [null], Geometry2: [null] });
export class PathGeometry extends Geometry {
    constructor(figures = []) {
        super();
        this.Figures = new AvaloniaList(figures);
    }
    get Data() {
        return [...this.Figures].map(f => f.Data).join(' ');
    }
}
export class PathFigure {
    constructor(startPoint = new Point(), segments = [], isClosed = false) {
        this.StartPoint = startPoint;
        this.Segments = new AvaloniaList(segments);
        this.IsClosed = isClosed;
        this.IsFilled = true;
    }
    get Data() {
        return `M${this.StartPoint.X} ${this.StartPoint.Y} ${[...this.Segments].map(s => s.Data).join(' ')}${this.IsClosed ? 'Z' : ''}`;
    }
}
export class LineSegment {
    constructor(point = new Point()) {
        this.Point = point;
    }
    get Data() {
        return `L${this.Point.X} ${this.Point.Y}`;
    }
}
export class BezierSegment {
    constructor(point1 = new Point(), point2 = new Point(), point3 = new Point()) {
        Object.assign(this, { Point1: point1, Point2: point2, Point3: point3 });
    }
    get Data() {
        return `C${this.Point1} ${this.Point2} ${this.Point3}`;
    }
}
export class QuadraticBezierSegment {
    constructor(point1 = new Point(), point2 = new Point()) {
        this.Point1 = point1;
        this.Point2 = point2;
    }
    get Data() {
        return `Q${this.Point1} ${this.Point2}`;
    }
}
export class ArcSegment {
    constructor(point = new Point(), size = new Size()) {
        this.Point = point;
        this.Size = size;
        this.RotationAngle = 0;
        this.IsLargeArc = false;
        this.SweepDirection = 'Clockwise';
    }
    get Data() {
        return `A${this.Size.Width} ${this.Size.Height} ${this.RotationAngle} ${+this.IsLargeArc} ${+(this.SweepDirection === 'Clockwise')} ${this.Point}`;
    }
}
export class PolyLineSegment {
    constructor(points = []) {
        this.Points = new AvaloniaList(points);
    }
    get Data() {
        return [...this.Points].map(p => `L${p}`).join(' ');
    }
}
