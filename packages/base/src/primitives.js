export const MathUtilities = Object.freeze({
    Clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    AreClose: (a, b, epsilon = 1e-6) => a === b || Math.abs(a - b) <= epsilon * Math.max(1, Math.abs(a), Math.abs(b)),
});
export const AreValuesEqual = (a, b) => Object.is(a, b) || (a != null && typeof a.Equals === 'function' && a.Equals(b));
function numbers(value, allowed) {
    const a = String(value).trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (!allowed.includes(a.length) || a.some(v => !Number.isFinite(v)))
        throw new TypeError(`Invalid numeric value '${value}'.`);
    return a;
}
export class Point {
    constructor(x = 0, y = 0) {
        this.X = x;
        this.Y = y;
    }
    static Parse(s) {
        return new Point(...numbers(s, [2]));
    }
    Equals(p) {
        return p instanceof Point && this.X === p.X && this.Y === p.Y;
    }
    Add(v) {
        return new Point(this.X + v.X, this.Y + v.Y);
    }
    Subtract(p) {
        return new Vector(this.X - p.X, this.Y - p.Y);
    }
    Transform(matrix) {
        return matrix.Transform(this);
    }
    ToString() {
        return this.toString();
    }
    toString() {
        return `${this.X},${this.Y}`;
    }
}
export class Vector extends Point {
    get Length() {
        return Math.hypot(this.X, this.Y);
    }
    get SquaredLength() {
        return this.X * this.X + this.Y * this.Y;
    }
    Normalize() {
        const l = this.Length;
        return l ? new Vector(this.X / l, this.Y / l) : new Vector();
    }
    Multiply(n) {
        return new Vector(this.X * n, this.Y * n);
    }
    static Parse(s) {
        return new Vector(...numbers(s, [2]));
    }
}
export class Size {
    static Empty = Object.freeze(new Size());
    static Infinity = Object.freeze(new Size(Infinity, Infinity));
    constructor(width = 0, height = 0) {
        this.Width = width;
        this.Height = height;
    }
    static Parse(s) {
        return new Size(...numbers(s, [2]));
    }
    get AspectRatio() {
        return this.Width / this.Height;
    }
    Equals(v) {
        return v instanceof Size && this.Width === v.Width && this.Height === v.Height;
    }
    Constrain(v) {
        return new Size(Math.min(this.Width, v.Width), Math.min(this.Height, v.Height));
    }
    Deflate(t) {
        t = Thickness.From(t);
        return new Size(Math.max(0, this.Width - t.Horizontal), Math.max(0, this.Height - t.Vertical));
    }
    Inflate(t) {
        t = Thickness.From(t);
        return new Size(this.Width + t.Horizontal, this.Height + t.Vertical);
    }
    WithWidth(w) {
        return new Size(w, this.Height);
    }
    WithHeight(h) {
        return new Size(this.Width, h);
    }
    ToString() {
        return this.toString();
    }
    toString() {
        return `${this.Width},${this.Height}`;
    }
}
export class PixelSize extends Size {
}
export class PixelPoint extends Point {
}
export class Rect {
    static Empty = Object.freeze(new Rect());
    constructor(x = 0, y = 0, width = 0, height = 0) {
        if (x instanceof Size) {
            this.X = 0;
            this.Y = 0;
            this.Width = x.Width;
            this.Height = x.Height;
        }
        else if (x instanceof Point && y instanceof Size) {
            this.X = x.X;
            this.Y = x.Y;
            this.Width = y.Width;
            this.Height = y.Height;
        }
        else {
            this.X = x;
            this.Y = y;
            this.Width = width;
            this.Height = height;
        }
    }
    get Left() {
        return this.X;
    }
    get Top() {
        return this.Y;
    }
    get Right() {
        return this.X + this.Width;
    }
    get Bottom() {
        return this.Y + this.Height;
    }
    get Center() {
        return new Point(this.X + this.Width / 2, this.Y + this.Height / 2);
    }
    get Position() {
        return new Point(this.X, this.Y);
    }
    get Size() {
        return new Size(this.Width, this.Height);
    }
    get TopLeft() {
        return this.Position;
    }
    get BottomRight() {
        return new Point(this.Right, this.Bottom);
    }
    get IsEmpty() {
        return this.Width <= 0 || this.Height <= 0;
    }
    Contains(p) {
        return p.X >= this.Left && p.Y >= this.Top && p.X <= this.Right && p.Y <= this.Bottom;
    }
    Intersects(r) {
        return r.Right > this.Left && r.Left < this.Right && r.Bottom > this.Top && r.Top < this.Bottom;
    }
    Intersect(r) {
        const x = Math.max(this.X, r.X), y = Math.max(this.Y, r.Y);
        return new Rect(x, y, Math.max(0, Math.min(this.Right, r.Right) - x), Math.max(0, Math.min(this.Bottom, r.Bottom) - y));
    }
    Union(r) {
        if (this.IsEmpty)
            return r;
        if (r.IsEmpty)
            return this;
        const x = Math.min(this.X, r.X), y = Math.min(this.Y, r.Y);
        return new Rect(x, y, Math.max(this.Right, r.Right) - x, Math.max(this.Bottom, r.Bottom) - y);
    }
    Translate(p) {
        return new Rect(this.X + p.X, this.Y + p.Y, this.Width, this.Height);
    }
    Deflate(t) {
        t = Thickness.From(t);
        return new Rect(this.X + t.Left, this.Y + t.Top, Math.max(0, this.Width - t.Horizontal), Math.max(0, this.Height - t.Vertical));
    }
    Inflate(t) {
        t = Thickness.From(t);
        return new Rect(this.X - t.Left, this.Y - t.Top, this.Width + t.Horizontal, this.Height + t.Vertical);
    }
    TransformToAABB(m) {
        const a = [this.TopLeft, new Point(this.Right, this.Top), this.BottomRight, new Point(this.Left, this.Bottom)].map(p => m.Transform(p));
        const xs = a.map(p => p.X), ys = a.map(p => p.Y);
        const x = Math.min(...xs), y = Math.min(...ys);
        return new Rect(x, y, Math.max(...xs) - x, Math.max(...ys) - y);
    }
    Equals(r) {
        return r instanceof Rect && r.X === this.X && r.Y === this.Y && r.Width === this.Width && r.Height === this.Height;
    }
    static Parse(s) {
        return new Rect(...numbers(s, [4]));
    }
    ToString() {
        return this.toString();
    }
    toString() {
        return `${this.X},${this.Y},${this.Width},${this.Height}`;
    }
}
export class PixelRect extends Rect {
}
export class Thickness {
    static Empty = Object.freeze(new Thickness());
    constructor(left = 0, top = left, right = left, bottom = top) {
        this.Left = left;
        this.Top = top;
        this.Right = right;
        this.Bottom = bottom;
    }
    get Horizontal() {
        return this.Left + this.Right;
    }
    get Vertical() {
        return this.Top + this.Bottom;
    }
    get IsUniform() {
        return this.Left === this.Top && this.Left === this.Right && this.Left === this.Bottom;
    }
    Equals(t) {
        return t instanceof Thickness && t.Left === this.Left && t.Top === this.Top && t.Right === this.Right && t.Bottom === this.Bottom;
    }
    static Parse(s) {
        return new Thickness(...numbers(s, [1, 2, 4]));
    }
    static From(v) {
        return v instanceof Thickness ? v : typeof v === 'number' ? new Thickness(v) : Thickness.Parse(v ?? 0);
    }
    ToString() {
        return this.toString();
    }
    toString() {
        return `${this.Left},${this.Top},${this.Right},${this.Bottom}`;
    }
}
export class CornerRadius {
    constructor(topLeft = 0, topRight = topLeft, bottomRight = topLeft, bottomLeft = topRight) {
        this.TopLeft = topLeft;
        this.TopRight = topRight;
        this.BottomRight = bottomRight;
        this.BottomLeft = bottomLeft;
    }
    static Parse(s) {
        return new CornerRadius(...numbers(s, [1, 4]));
    }
    static From(v) {
        return v instanceof CornerRadius ? v : typeof v === 'number' ? new CornerRadius(v) : CornerRadius.Parse(v ?? 0);
    }
    Equals(r) {
        return r instanceof CornerRadius && ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].every(k => this[k] === r[k]);
    }
}
/** Avalonia's row-vector affine convention: p' = p M. */
export class Matrix {
    static Identity = Object.freeze(new Matrix());
    constructor(m11 = 1, m12 = 0, m21 = 0, m22 = 1, m31 = 0, m32 = 0) {
        Object.assign(this, { M11: m11, M12: m12, M21: m21, M22: m22, M31: m31, M32: m32 });
    }
    get HasInverse() {
        return Math.abs(this.M11 * this.M22 - this.M12 * this.M21) > 1e-14;
    }
    get IsIdentity() {
        return this.Equals(Matrix.Identity);
    }
    Transform(p) {
        return new Point(p.X * this.M11 + p.Y * this.M21 + this.M31, p.X * this.M12 + p.Y * this.M22 + this.M32);
    }
    Multiply(b) {
        const a = this;
        return new Matrix(a.M11 * b.M11 + a.M12 * b.M21, a.M11 * b.M12 + a.M12 * b.M22, a.M21 * b.M11 + a.M22 * b.M21, a.M21 * b.M12 + a.M22 * b.M22, a.M31 * b.M11 + a.M32 * b.M21 + b.M31, a.M31 * b.M12 + a.M32 * b.M22 + b.M32);
    }
    Append(m) {
        return this.Multiply(m);
    }
    Prepend(m) {
        return m.Multiply(this);
    }
    Invert() {
        const d = this.M11 * this.M22 - this.M12 * this.M21;
        if (Math.abs(d) <= 1e-14)
            throw new RangeError('Matrix is singular.');
        return new Matrix(this.M22 / d, -this.M12 / d, -this.M21 / d, this.M11 / d, (this.M21 * this.M32 - this.M22 * this.M31) / d, (this.M12 * this.M31 - this.M11 * this.M32) / d);
    }
    Equals(m) {
        return m instanceof Matrix && ['M11', 'M12', 'M21', 'M22', 'M31', 'M32'].every(k => this[k] === m[k]);
    }
    static CreateTranslation(x, y = 0) {
        return x instanceof Point ? new Matrix(1, 0, 0, 1, x.X, x.Y) : new Matrix(1, 0, 0, 1, x, y);
    }
    static CreateScale(x, y = x) {
        return new Matrix(x, 0, 0, y);
    }
    static CreateRotation(radians) {
        const c = Math.cos(radians), s = Math.sin(radians);
        return new Matrix(c, s, -s, c);
    }
    static Parse(s) {
        return new Matrix(...numbers(String(s).replace(/^matrix\(|\)$/g, ''), [6]));
    }
    ToString() {
        return this.toString();
    }
    toString() {
        return `${this.M11},${this.M12},${this.M21},${this.M22},${this.M31},${this.M32}`;
    }
}
export class RelativePoint {
    static TopLeft = Object.freeze(new RelativePoint(0, 0));
    static Center = Object.freeze(new RelativePoint(.5, .5));
    constructor(x = 0, y = 0, unit = 'Relative') {
        this.Point = new Point(x, y);
        this.Unit = unit;
    }
    ToPixels(size) {
        return this.Unit === 'Relative' ? new Point(this.Point.X * size.Width, this.Point.Y * size.Height) : this.Point;
    }
    static Parse(s) {
        const a = String(s).split(/[, ]+/);
        return a.some(v => v.endsWith('%')) ? new RelativePoint(parseFloat(a[0]) / 100, parseFloat(a[1]) / 100) : new RelativePoint(...a.map(Number), 'Absolute');
    }
}
export const HorizontalAlignment = Object.freeze({ Left: 'Left', Center: 'Center', Right: 'Right', Stretch: 'Stretch' });
export const VerticalAlignment = Object.freeze({ Top: 'Top', Center: 'Center', Bottom: 'Bottom', Stretch: 'Stretch' });
export const Orientation = Object.freeze({ Horizontal: 'Horizontal', Vertical: 'Vertical' });
export const FlowDirection = Object.freeze({ LeftToRight: 'LeftToRight', RightToLeft: 'RightToLeft' });
export const Dock = Object.freeze({ Left: 'Left', Top: 'Top', Right: 'Right', Bottom: 'Bottom' });
export const Stretch = Object.freeze({ None: 'None', Fill: 'Fill', Uniform: 'Uniform', UniformToFill: 'UniformToFill' });
export const TextWrapping = Object.freeze({ NoWrap: 'NoWrap', Wrap: 'Wrap', WrapWithOverflow: 'WrapWithOverflow' });
export const TextAlignment = Object.freeze({ Left: 'Left', Center: 'Center', Right: 'Right', Justify: 'Justify', Start: 'Start', End: 'End' });
export class NotSupportedException extends Error {
    constructor(message) {
        super(message);
        this.name = 'NotSupportedException';
    }
}
