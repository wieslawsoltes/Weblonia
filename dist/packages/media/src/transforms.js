import { AvaloniaObject, Animatable, DefineProperties, AvaloniaList, Matrix, Event, CompositeDisposable } from '@wieslawsoltes/avalonia-base';
export class Transform extends Animatable {
    constructor() {
        super();
        this.Changed = new Event();
    }
    get Value() {
        return Matrix.Identity;
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        this.Changed?.Raise(this, { Value: this.Value });
    }
    static Parse(s) {
        return TransformOperations.Parse(s);
    }
}
export class TranslateTransform extends Transform {
    constructor(x = 0, y = 0) {
        super();
        this.X = x;
        this.Y = y;
    }
    get Value() {
        return Matrix.CreateTranslation(this.X, this.Y);
    }
}
DefineProperties(TranslateTransform, { X: [0], Y: [0] });
export class ScaleTransform extends Transform {
    constructor(x = 1, y = x) {
        super();
        this.ScaleX = x;
        this.ScaleY = y;
    }
    get Value() {
        return Matrix.CreateScale(this.ScaleX, this.ScaleY);
    }
}
DefineProperties(ScaleTransform, { ScaleX: [1], ScaleY: [1] });
export class RotateTransform extends Transform {
    constructor(angle = 0) {
        super();
        this.Angle = angle;
    }
    get Value() {
        return Matrix.CreateTranslation(-this.CenterX, -this.CenterY).Multiply(Matrix.CreateRotation(this.Angle * Math.PI / 180)).Multiply(Matrix.CreateTranslation(this.CenterX, this.CenterY));
    }
}
DefineProperties(RotateTransform, { Angle: [0], CenterX: [0], CenterY: [0] });
export class SkewTransform extends Transform {
    get Value() {
        return new Matrix(1, Math.tan(this.AngleY * Math.PI / 180), Math.tan(this.AngleX * Math.PI / 180), 1);
    }
}
DefineProperties(SkewTransform, { AngleX: [0], AngleY: [0] });
export class MatrixTransform extends Transform {
    constructor(matrix = Matrix.Identity) {
        super();
        this.Matrix = matrix;
    }
    get Value() {
        return this.Matrix;
    }
}
DefineProperties(MatrixTransform, { Matrix: [Matrix.Identity] });
export class TransformGroup extends Transform {
    constructor(children = []) {
        super();
        this.Children = new AvaloniaList(children);
        this._subscriptions = new CompositeDisposable();
        this._lifetime.Add(this.Children.CollectionChanged.Add(() => this._rewire()));
        this._lifetime.Add(this._subscriptions);
        this._rewire();
    }
    _rewire() {
        this._subscriptions.Clear();
        for (const child of this.Children)
            if (child.Changed)
                this._subscriptions.Add(child.Changed.Add(() => this.Changed.Raise(this, { Value: this.Value })));
        this.Changed.Raise(this, { Value: this.Value });
    }
    get Value() {
        return [...this.Children ?? []].reduce((matrix, child) => matrix.Multiply(child.Value ?? child), Matrix.Identity);
    }
}
export class TransformOperations extends MatrixTransform {
    static Parse(input) {
        if (input instanceof Transform)
            return input;
        if (input instanceof Matrix)
            return new MatrixTransform(input);
        const s = String(input).trim();
        if (s === 'none')
            return new TransformOperations();
        const matches = [...s.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)];
        if (!matches.length || s.replace(/([a-zA-Z]+)\s*\(([^)]*)\)/g, '').trim())
            throw new TypeError(`Invalid transform '${s}'.`);
        let matrix = Matrix.Identity;
        for (const [, op, data] of matches) {
            const raw = data.split(/[\s,]+/).filter(Boolean), a = raw.map(parseFloat);
            let next;
            const angle = i => raw[i]?.endsWith('rad') ? a[i] : a[i] * Math.PI / 180;
            switch (op.toLowerCase()) {
                case 'matrix':
                    if (a.length !== 6)
                        throw new TypeError('matrix() requires six components.');
                    next = new Matrix(...a);
                    break;
                case 'translate':
                    next = Matrix.CreateTranslation(a[0], a[1] ?? 0);
                    break;
                case 'translatex':
                    next = Matrix.CreateTranslation(a[0], 0);
                    break;
                case 'translatey':
                    next = Matrix.CreateTranslation(0, a[0]);
                    break;
                case 'scale':
                    next = Matrix.CreateScale(a[0], a[1] ?? a[0]);
                    break;
                case 'scalex':
                    next = Matrix.CreateScale(a[0], 1);
                    break;
                case 'scaley':
                    next = Matrix.CreateScale(1, a[0]);
                    break;
                case 'rotate':
                    next = Matrix.CreateRotation(angle(0));
                    break;
                case 'skew':
                    next = new Matrix(1, Math.tan(angle(1) || 0), Math.tan(angle(0)), 1);
                    break;
                case 'skewx':
                    next = new Matrix(1, 0, Math.tan(angle(0)), 1);
                    break;
                case 'skewy':
                    next = new Matrix(1, Math.tan(angle(0)), 0, 1);
                    break;
                default: throw new TypeError(`Unknown transform '${op}'.`);
            }
            if (a.some(v => !Number.isFinite(v)))
                throw new TypeError('Transform components must be finite.');
            matrix = matrix.Multiply(next);
        }
        return new TransformOperations(matrix);
    }
}
