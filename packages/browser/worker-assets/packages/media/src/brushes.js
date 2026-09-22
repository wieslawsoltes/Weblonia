import { AvaloniaObject, DefineProperties, AvaloniaList, RelativePoint, Point, MathUtilities } from "../../base/src/index.js";
import { ColorNames } from './color-names.js';
const byte = v => Math.round(MathUtilities.Clamp(Number(v), 0, 255));
export class Color {
    constructor(a = 255, r = 0, g = 0, b = 0) {
        this.A = byte(a);
        this.R = byte(r);
        this.G = byte(g);
        this.B = byte(b);
    }
    static FromArgb(a, r, g, b) {
        return new Color(a, r, g, b);
    }
    static FromHsv(h, s, v, a = 1) {
        return new HsvColor(a, h, s, v).ToRgb();
    }
    static FromRgb(r, g, b) {
        return new Color(255, r, g, b);
    }
    static FromUInt32(value) {
        return new Color(value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255);
    }
    ToUInt32() {
        return ((this.A << 24) | (this.R << 16) | (this.G << 8) | this.B) >>> 0;
    }
    Equals(c) {
        return c instanceof Color && this.A === c.A && this.R === c.R && this.G === c.G && this.B === c.B;
    }
    ToCss(opacity = 1) {
        return `rgba(${this.R},${this.G},${this.B},${this.A / 255 * opacity})`;
    }
    ToHsv() {
        const r = this.R / 255, g = this.G / 255, b = this.B / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        let h = 0;
        if (d)
            h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
        return new HsvColor(this.A / 255, h, max ? d / max : 0, max);
    }
    ToString() {
        return this.toString();
    }
    toString() {
        return '#' + [this.A, this.R, this.G, this.B].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    static Parse(input) {
        if (input instanceof Color)
            return input;
        let s = String(input).trim().toLowerCase();
        if (s === 'transparent')
            return new Color(0, 255, 255, 255);
        s = ColorNames[s] ?? s;
        if (/^#[0-9a-f]+$/i.test(s)) {
            const hex = s.slice(1);
            if (hex.length === 3)
                return Color.FromRgb(...[...hex].map(c => parseInt(c + c, 16)));
            if (hex.length === 4)
                return new Color(...[...hex].map(c => parseInt(c + c, 16)));
            if (hex.length === 6)
                return Color.FromRgb(...[0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)));
            if (hex.length === 8)
                return new Color(...[0, 2, 4, 6].map(i => parseInt(hex.slice(i, i + 2), 16)));
        }
        const rgb = /^rgba?\(([^)]+)\)$/.exec(s);
        if (rgb) {
            const a = rgb[1].split(/[\s,\/]+/).filter(Boolean);
            if (a.length >= 3)
                return new Color(a[3] == null ? 255 : a[3].endsWith('%') ? parseFloat(a[3]) * 2.55 : Number(a[3]) * 255, ...a.slice(0, 3).map(v => v.endsWith('%') ? parseFloat(v) * 2.55 : Number(v)));
        }
        throw new TypeError(`Invalid color '${input}'.`);
    }
    static TryParse(s) {
        try {
            return { Success: true, Value: Color.Parse(s) };
        }
        catch {
            return { Success: false, Value: null };
        }
    }
}
export class HsvColor {
    constructor(a = 1, h = 0, s = 0, v = 0) {
        this.A = a;
        this.H = h;
        this.S = s;
        this.V = v;
    }
    ToRgb() {
        const h = ((this.H % 360) + 360) % 360 / 60, s = MathUtilities.Clamp(this.S, 0, 1), v = MathUtilities.Clamp(this.V, 0, 1), c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c;
        const q = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
        return new Color(this.A * 255, ...q.map(t => (t + m) * 255));
    }
}
export const Colors = new Proxy({ Transparent: new Color(0, 255, 255, 255) }, { get(target, p) {
        if (typeof p !== 'string')
            return target[p];
        return target[p] ??= Color.Parse(p);
    } });
export class Brush extends AvaloniaObject {
    static Parse(s) {
        return s instanceof Brush ? s : new SolidColorBrush(Color.Parse(s));
    }
    ToImmutable() {
        return this;
    }
}
DefineProperties(Brush, { Opacity: [1, { Coerce: (_, v) => MathUtilities.Clamp(v, 0, 1) }], Transform: [null], TransformOrigin: [RelativePoint.TopLeft] });
export class SolidColorBrush extends Brush {
    constructor(color = Colors.Transparent, opacity = 1) {
        super();
        this.Color = Color.Parse(color);
        this.Opacity = opacity;
    }
    ToString() {
        return this.toString();
    }
    toString() {
        return this.Color.toString();
    }
}
DefineProperties(SolidColorBrush, { Color: [Colors.Transparent, { Convert: Color.Parse }] });
export class ImmutableSolidColorBrush {
    constructor(color, opacity = 1) {
        this.Color = Color.Parse(color);
        this.Opacity = opacity;
        Object.freeze(this);
    }
    toString() {
        return this.Color.toString();
    }
}
export const Brushes = new Proxy({}, { get(target, name) {
        return typeof name === 'string' ? target[name] ??= new ImmutableSolidColorBrush(Colors[name]) : undefined;
    } });
export class GradientStop extends AvaloniaObject {
    constructor(color = Colors.Transparent, offset = 0) {
        super();
        this.Color = Color.Parse(color);
        this.Offset = offset;
    }
}
DefineProperties(GradientStop, { Color: [Colors.Transparent, { Convert: Color.Parse }], Offset: [0] });
export class GradientStops extends AvaloniaList {
}
export class GradientBrush extends Brush {
    constructor(stops = []) {
        super();
        this.GradientStops = new GradientStops(stops);
    }
}
DefineProperties(GradientBrush, { SpreadMethod: ['Pad'], MappingMode: ['RelativeToBoundingBox'] });
export class LinearGradientBrush extends GradientBrush {
    constructor(stops = [], start = new RelativePoint(0, 0), end = new RelativePoint(1, 1)) {
        super(stops);
        this.StartPoint = start;
        this.EndPoint = end;
    }
}
DefineProperties(LinearGradientBrush, { StartPoint: [new RelativePoint(0, 0)], EndPoint: [new RelativePoint(1, 1)] });
export class RadialGradientBrush extends GradientBrush {
}
DefineProperties(RadialGradientBrush, { Center: [RelativePoint.Center], GradientOrigin: [RelativePoint.Center], Radius: [.5], RadiusX: [.5], RadiusY: [.5] });
export class ConicGradientBrush extends GradientBrush {
}
DefineProperties(ConicGradientBrush, { Center: [RelativePoint.Center], Angle: [0] });
export class ImageBrush extends Brush {
    constructor(source = null) {
        super();
        this.Source = source;
    }
}
DefineProperties(ImageBrush, { Source: [null], Stretch: ['Uniform'], TileMode: ['None'], AlignmentX: ['Center'], AlignmentY: ['Center'] });
export class VisualBrush extends Brush {
    constructor(visual = null) {
        super();
        this.Visual = visual;
    }
}
DefineProperties(VisualBrush, { Visual: [null], Stretch: ['Uniform'], TileMode: ['None'], AlignmentX: ['Center'], AlignmentY: ['Center'] });
export class Pen {
    constructor(brush = Brushes.Black, thickness = 1, dashStyle = null, lineCap = 'Flat', lineJoin = 'Miter', miterLimit = 10) {
        this.Brush = brush;
        this.Thickness = thickness;
        this.DashStyle = dashStyle;
        this.LineCap = lineCap;
        this.LineJoin = lineJoin;
        this.MiterLimit = miterLimit;
    }
}
export class DashStyle {
    constructor(dashes = [], offset = 0) {
        this.Dashes = Array.from(dashes);
        this.Offset = offset;
    }
    static Dash = new DashStyle([2, 2]);
    static Dot = new DashStyle([0, 2]);
}
export class BoxShadow {
    constructor({ OffsetX = 0, OffsetY = 0, Blur = 0, Spread = 0, Color: color = Colors.Black, IsInset = false } = {}) {
        Object.assign(this, { OffsetX, OffsetY, Blur, Spread, Color: Color.Parse(color), IsInset });
    }
}
export class BlurEffect extends AvaloniaObject {
    constructor(radius = 5) { super(); this.Radius = radius; }
}
DefineProperties(BlurEffect, { Radius: [5, { Convert: Number, Validate: value => Number.isFinite(value) && value >= 0 }] });
export class DropShadowEffect extends AvaloniaObject {
    constructor(options = {}) { super(); Object.assign(this, options); }
}
DefineProperties(DropShadowEffect, {
    OffsetX: [0, { Convert: Number }], OffsetY: [0, { Convert: Number }],
    BlurRadius: [5, { Convert: Number }], Color: [Colors.Black, { Convert: Color.Parse }], Opacity: [1, { Convert: Number }],
});
export class BitmapCache extends AvaloniaObject {
    constructor(renderAtScale = 1) { super(); this.RenderAtScale = renderAtScale; }
}
DefineProperties(BitmapCache, { RenderAtScale: [1, { Convert: Number, Validate: value => Number.isFinite(value) && value > 0 }] });
export class ExperimentalAcrylicMaterial extends AvaloniaObject {
    constructor(options = {}) { super(); Object.assign(this, options); }
}
DefineProperties(ExperimentalAcrylicMaterial, {
    TintColor: [Colors.White, { Convert: Color.Parse }], TintOpacity: [.65, { Convert: Number }],
    MaterialOpacity: [1, { Convert: Number }], FallbackColor: [Colors.LightGray, { Convert: Color.Parse }],
    BlurRadius: [18, { Convert: Number, Validate: value => Number.isFinite(value) && value >= 0 }],
});
export const FontWeight = Object.freeze({ Thin: 100, ExtraLight: 200, Light: 300, Normal: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Black: 900 });
export const FontStyle = Object.freeze({ Normal: 'Normal', Italic: 'Italic', Oblique: 'Oblique' });
export const FontStretch = Object.freeze({ Normal: 5, Condensed: 3, Expanded: 7 });
export class FontFamily {
    constructor(name = 'system-ui') {
        this.Name = String(name);
    }
    toString() {
        return this.Name;
    }
    static Default = new FontFamily('system-ui');
}
export class Typeface {
    constructor(fontFamily = FontFamily.Default, style = 'Normal', weight = 400, stretch = 5) {
        this.FontFamily = fontFamily instanceof FontFamily ? fontFamily : new FontFamily(fontFamily);
        this.Style = style;
        this.Weight = weight;
        this.Stretch = stretch;
    }
}
export function BrushColor(brush, fallback = Colors.Transparent) {
    if (brush == null)
        return fallback;
    return brush instanceof Color ? brush : typeof brush === 'string' ? Color.Parse(brush) : brush.Color ?? fallback;
}
