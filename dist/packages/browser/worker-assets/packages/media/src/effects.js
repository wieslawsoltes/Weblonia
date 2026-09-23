import { Animatable, DefineProperties, Event, Thickness, UnsetValue, DoNothing } from "../../base/src/index.js";
import { Color, Colors } from './brushes.js';

const kinds = new WeakMap(), immutable = new WeakSet();
const kind = value => value != null && typeof value === 'object' ? kinds.get(value) : undefined;
const scalar = value => {
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
        throw new RangeError('Effect values must be finite native-representable numbers.');
    return value;
};
const finite = value => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(Math.fround(value));
function color(value) {
    if (typeof value === 'string' && /^\s*rgba?\(/i.test(value)) {
        const components = /^\s*rgba?\(([^()]*)\)\s*$/i.exec(value)?.[1].split(/[\s,\/]+/).filter(Boolean);
        const component = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?%?$/;
        if (!components || components.length < 3 || components.length > 4 ||
            components.some(v => !component.test(v) || !Number.isFinite(Number(v.replace(/%$/, '')))))
            throw new TypeError('Invalid or nonfinite shadow color components.');
    }
    const parsed = Color.Parse(value);
    if (!['A', 'R', 'G', 'B'].every(key => Number.isInteger(parsed[key]) && parsed[key] >= 0 && parsed[key] <= 255))
        throw new TypeError('Effect color must contain four finite byte channels.');
    return Object.isFrozen(parsed) && Object.getPrototypeOf(parsed) === Color.prototype ? parsed : Object.freeze(new Color(parsed.A, parsed.R, parsed.G, parsed.B));
}
const equals = (a, b) => {
    const ka = kind(a), kb = kind(b);
    if (!ka || !kb) return a == null && b == null;
    if (ka === 'blur' || kb === 'blur') return ka === kb && a.Radius === b.Radius;
    return a.OffsetX === b.OffsetX && a.OffsetY === b.OffsetY && a.BlurRadius === b.BlurRadius &&
        a.Opacity === b.Opacity && a.Color.Equals(b.Color);
};

// Interface identity for JavaScript reflection/instanceof. These have no native
// handle or callable service implementation; the concrete classes provide values.
export class IEffect { constructor() { throw new TypeError('IEffect is a contract, not a concrete effect.'); } static [Symbol.hasInstance](value) { return !!kind(value); } }
export class IMutableEffect { constructor() { throw new TypeError('IMutableEffect is a contract, not a concrete effect.'); } static [Symbol.hasInstance](value) { return !!kind(value) && !immutable.has(value); } }
export class IImmutableEffect { constructor() { throw new TypeError('IImmutableEffect is a contract, not a concrete effect.'); } static [Symbol.hasInstance](value) { return immutable.has(value); } }
export class IBlurEffect { constructor() { throw new TypeError('IBlurEffect is a contract, not a concrete effect.'); } static [Symbol.hasInstance](value) { return kind(value) === 'blur'; } }
export class IDropShadowEffect { constructor() { throw new TypeError('IDropShadowEffect is a contract, not a concrete effect.'); } static [Symbol.hasInstance](value) { return ['shadow', 'direction'].includes(kind(value)); } }

export class Effect extends Animatable {
    constructor() { super(); this.Invalidated = new Event(); this._immutableEffect = null; }
    OnPropertyChanged(change) {
        super.OnPropertyChanged(change);
        if (change.Property.GetMetadata(this).AffectsRender) {
            this._immutableEffect = null;
            this.Invalidated?.Raise(this, change);
        }
    }
    _SetPriorityValue(property, value, priority, key, order) {
        // SetValue and observable bindings also copy colors; not only the generated
        // JS property setter. Caller mutation cannot silently poison cached effects.
        if (property === DropShadowEffectBase.ColorProperty && value !== UnsetValue && value !== DoNothing) value = color(value);
        return super._SetPriorityValue(property, value, priority, key, order);
    }
    ToImmutable() { throw new TypeError('An effect must implement a supported immutable value.'); }
    static Parse(input) {
        if (typeof input !== 'string' || input.length > 4096) throw new TypeError('Unable to parse effect.');
        const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
        const blur = new RegExp('^\\s*blur\\s*\\(\\s*(' + number + ')\\s*\\)\\s*$').exec(input);
        if (blur) return new ImmutableBlurEffect(Number(blur[1]));
        const shadow = /^\s*drop-shadow\s*\(([\s\S]*)\)\s*$/.exec(input);
        if (!shadow) throw new TypeError(`Unable to parse effect: ${input}`);
        let rest = shadow[1].trim();
        const take = () => {
            const match = new RegExp('^(' + number + ')(?=\\s|$)').exec(rest);
            if (!match) throw new TypeError(`Unable to parse effect: ${input}`);
            rest = rest.slice(match[0].length).trimStart(); return scalar(Number(match[0]));
        };
        const x = take(), y = take(), radius = rest ? take() : 0;
        if (radius < 0) throw new TypeError('A parsed shadow blur radius cannot be negative.');
        return new ImmutableDropShadowEffect(x, y, radius, rest ? color(rest) : Colors.Black, 1);
    }
    Dispose() { if (this.IsDisposed) return; try { super.Dispose(); } finally { this._immutableEffect = null; this.Invalidated.Clear(); } }
}
export class BlurEffect extends Effect {
    constructor(radius = 5) { super(); kinds.set(this, 'blur'); this.Radius = radius; }
    ToImmutable() { this._verifyAlive(); return this._immutableEffect ??= new ImmutableBlurEffect(this.Radius); }
}
DefineProperties(BlurEffect, { Radius: [5, { Convert: Number, Validate: finite }] });
export class DropShadowEffectBase extends Effect {}
DefineProperties(DropShadowEffectBase, {
    BlurRadius: [5, { Convert: Number, Validate: finite }],
    Color: [color(Colors.Black), { Convert: color, Validate: value => value instanceof Color }],
    Opacity: [1, { Convert: Number, Validate: finite }],
});
export class DropShadowEffect extends DropShadowEffectBase {
    constructor(options = {}) { super(); kinds.set(this, 'shadow'); Object.assign(this, options); }
    ToImmutable() { this._verifyAlive(); return this._immutableEffect ??= new ImmutableDropShadowEffect(this.OffsetX, this.OffsetY, this.BlurRadius, this.Color, this.Opacity); }
}
DefineProperties(DropShadowEffect, {
    OffsetX: [3.5355, { Convert: Number, Validate: finite }], OffsetY: [3.5355, { Convert: Number, Validate: finite }],
});
export class DropShadowDirectionEffect extends DropShadowEffectBase {
    constructor(options = {}) { super(); kinds.set(this, 'direction'); Object.assign(this, options); }
    get OffsetX() { return Math.cos((this.Direction % 360) * Math.PI / 180) * this.ShadowDepth; }
    get OffsetY() { return Math.sin((this.Direction % 360) * Math.PI / 180) * this.ShadowDepth; }
    ToImmutable() {
        this._verifyAlive();
        // Use polar values, not Cartesian offsets as arguments to a polar ctor.
        return this._immutableEffect ??= new ImmutableDropShadowDirectionEffect(this.Direction, this.ShadowDepth, this.BlurRadius, this.Color, this.Opacity);
    }
}
DefineProperties(DropShadowDirectionEffect, {
    Direction: [315, { Convert: Number, Validate: finite }], ShadowDepth: [5, { Convert: Number, Validate: finite }],
});
export class ImmutableBlurEffect {
    constructor(radius) { this.Radius = scalar(radius); kinds.set(this, 'blur'); immutable.add(this); Object.freeze(this); }
    Equals(other) { return equals(this, other); }
    _EqualsValue(other) { return immutable.has(other) && equals(this, other); }
    ToImmutable() { return this; }
}
export class ImmutableDropShadowEffect {
    constructor(offsetX, offsetY, blurRadius, shadowColor, opacity) {
        this.OffsetX = scalar(offsetX); this.OffsetY = scalar(offsetY); this.BlurRadius = scalar(blurRadius);
        this.Color = color(shadowColor); this.Opacity = scalar(opacity);
        kinds.set(this, 'shadow'); immutable.add(this); Object.freeze(this);
    }
    Equals(other) { return equals(this, other); }
    _EqualsValue(other) { return immutable.has(other) && equals(this, other); }
    ToImmutable() { return this; }
}
export class ImmutableDropShadowDirectionEffect {
    constructor(direction, shadowDepth, blurRadius, shadowColor, opacity) {
        this.Direction = scalar(direction); this.ShadowDepth = scalar(shadowDepth); this.BlurRadius = scalar(blurRadius);
        this.Color = color(shadowColor); this.Opacity = scalar(opacity);
        kinds.set(this, 'direction'); immutable.add(this); Object.freeze(this);
    }
    get OffsetX() { return Math.cos((this.Direction % 360) * Math.PI / 180) * this.ShadowDepth; }
    get OffsetY() { return Math.sin((this.Direction % 360) * Math.PI / 180) * this.ShadowDepth; }
    Equals(other) { return equals(this, other); }
    _EqualsValue(other) { return immutable.has(other) && equals(this, other); }
    ToImmutable() { return this; }
}
function toImmutable(effect) {
    if (!(effect instanceof IEffect)) throw new TypeError('A supported non-null effect is required.');
    return immutable.has(effect) ? effect : effect.ToImmutable();
}
function interpolateColor(a, b, t) {
    const linear = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    const srgb = v => v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055;
    const round = v => { v = Math.max(0, Math.min(255, v)); const n = Math.floor(v); return v - n === .5 ? n + (n % 2) : Math.round(v); };
    return new Color(round(a.A + (b.A - a.A) * t), ...['R', 'G', 'B'].map(k => {
        const x = linear(a[k] / 255), y = linear(b[k] / 255); return round(srgb(x + (y - x) * t) * 255);
    }));
}
function interpolate(from, to, progress, transition = false) {
    scalar(progress);
    let a = from == null ? null : toImmutable(from), b = to == null ? null : toImmutable(to);
    if (transition && (a == null || b == null) && (a || b)) {
        const other = a ?? b, empty = kind(other) === 'blur' ? new ImmutableBlurEffect(0)
            : new ImmutableDropShadowDirectionEffect(0, 0, 0, new Color(0, 0, 0, 0), 0);
        a ??= empty; b ??= empty;
    }
    if (!a || !b) return progress >= .5 ? b : a;
    const lerp = (x, y) => x + (y - x) * progress;
    if (kind(a) === 'blur' && kind(b) === 'blur') return new ImmutableBlurEffect(lerp(a.Radius, b.Radius));
    if (a instanceof IDropShadowEffect && b instanceof IDropShadowEffect) {
        const common = [lerp(a.BlurRadius, b.BlurRadius), interpolateColor(a.Color, b.Color, progress), lerp(a.Opacity, b.Opacity)];
        return kind(a) === 'direction' && kind(b) === 'direction'
            ? new ImmutableDropShadowDirectionEffect(lerp(a.Direction, b.Direction), lerp(a.ShadowDepth, b.ShadowDepth), ...common)
            : new ImmutableDropShadowEffect(lerp(a.OffsetX, b.OffsetX), lerp(a.OffsetY, b.OffsetY), ...common);
    }
    return progress >= .5 ? b : a;
}
export const EffectExtensions = Object.freeze({
    ToImmutable: toImmutable, EffectEquals: equals, Interpolate: interpolate, GetKind: kind,
    GetEffectOutputPadding(effect) {
        if (effect == null) return new Thickness(0);
        const value = toImmutable(effect), r = Math.max(0, Math.ceil(kind(value) === 'blur' ? value.Radius : value.BlurRadius) + 1);
        const padding = (kind(value) === 'blur' ? value.Radius : value.BlurRadius) <= 0 ? 0 : r;
        return kind(value) === 'blur' ? new Thickness(padding) : new Thickness(
            Math.max(0, padding - value.OffsetX), Math.max(0, padding - value.OffsetY),
            Math.max(0, padding + value.OffsetX), Math.max(0, padding + value.OffsetY));
    },
});
export class EffectConverter {
    CanConvertFrom(type) { return type === String || type === 'string'; }
    ConvertFrom(...args) { return Effect.Parse(args.at(-1)); }
}
