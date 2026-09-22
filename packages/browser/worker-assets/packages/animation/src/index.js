import { AvaloniaList, AvaloniaProperty, BindingPriority, Disposable, CompositeDisposable, Point, Size, Rect, Thickness, CornerRadius, Matrix, MathUtilities } from "../../base/src/index.js";
import { Color, SolidColorBrush } from "../../media/src/index.js";
import { ContentControl } from "../../controls/src/index.js";
export class Easing {
    Ease(progress) {
        return progress;
    }
}
export class LinearEasing extends Easing {
}
export class QuadraticEaseIn extends Easing {
    Ease(t) {
        return t * t;
    }
}
export class QuadraticEaseOut extends Easing {
    Ease(t) {
        return t * (2 - t);
    }
}
export class QuadraticEaseInOut extends Easing {
    Ease(t) {
        return t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    }
}
export class CubicEaseIn extends Easing {
    Ease(t) {
        return t ** 3;
    }
}
export class CubicEaseOut extends Easing {
    Ease(t) {
        return 1 - (1 - t) ** 3;
    }
}
export class CubicEaseInOut extends Easing {
    Ease(t) {
        return t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    }
}
export class SineEaseInOut extends Easing {
    Ease(t) {
        return -(Math.cos(Math.PI * t) - 1) / 2;
    }
}
export class BounceEaseOut extends Easing {
    Ease(t) {
        const n = 7.5625, d = 2.75;
        if (t < 1 / d)
            return n * t * t;
        if (t < 2 / d)
            return n * (t -= 1.5 / d) * t + .75;
        if (t < 2.5 / d)
            return n * (t -= 2.25 / d) * t + .9375;
        return n * (t -= 2.625 / d) * t + .984375;
    }
}
export class SpringEasing extends Easing {
    constructor() {
        super();
        this.Oscillations = 3;
        this.Springiness = 3;
    }
    Ease(t) {
        if (t === 0 || t === 1)
            return t;
        return 1 - Math.exp(-Math.max(.01, this.Springiness) * t) * Math.cos((this.Oscillations * 2 + .5) * Math.PI * t);
    }
}
export class SplineEasing extends Easing {
    constructor(x1 = .25, y1 = .1, x2 = .25, y2 = 1) {
        super();
        Object.assign(this, { X1: x1, Y1: y1, X2: x2, Y2: y2 });
    }
    Ease(x) {
        const bezier = (t, a, b) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
        let lo = 0, hi = 1;
        for (let i = 0; i < 24; i++) {
            const mid = (lo + hi) / 2;
            if (bezier(mid, this.X1, this.X2) < x)
                lo = mid;
            else
                hi = mid;
        }
        return bezier((lo + hi) / 2, this.Y1, this.Y2);
    }
}
export class Cue {
    constructor(value = 0) {
        this.CueValue = MathUtilities.Clamp(Number(value), 0, 1);
    }
    static Parse(value) {
        return new Cue(String(value).endsWith('%') ? parseFloat(value) / 100 : Number(value));
    }
}
export class KeyFrame {
    constructor(cue = 0, setters = []) {
        this.Cue = cue instanceof Cue ? cue : new Cue(cue);
        this.Setters = new AvaloniaList(setters);
        this.KeySpline = null;
    }
}
export class IterationCount {
    constructor(value = 1) {
        this.Value = value;
    }
    static Infinite = new IterationCount(Infinity);
    static Parse(value) {
        return value === 'Infinite' ? this.Infinite : new IterationCount(Number(value));
    }
}
export function ParseDuration(value) {
    if (typeof value === 'number')
        return value;
    if (value?.TotalMilliseconds !== undefined)
        return value.TotalMilliseconds;
    const parts = String(value).split(':').map(Number);
    return parts.length === 3 ? (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000 : Number(value);
}
export class Clock {
    Now() {
        return globalThis.performance?.now() ?? Date.now();
    }
    Subscribe(callback) {
        let active = true, id = null, kind = null;
        const schedule = () => {
            if (!active) return;
            // Presence of worker requestAnimationFrame does not guarantee that
            // this worker has an associated owner window. Match TopLevel's
            // timer fallback and cancel using the scheduler that actually ran.
            if (typeof globalThis.requestAnimationFrame === 'function') {
                try { kind = 'raf'; id = globalThis.requestAnimationFrame(frame); return; }
                catch (error) { if (error?.name !== 'NotSupportedError') throw error; }
            }
            kind = 'timer'; id = setTimeout(() => frame(this.Now()), 16);
        };
        const frame = time => {
            id = null;
            if (!active) return;
            callback(time);
            schedule();
        };
        schedule();
        return new Disposable(() => {
            active = false;
            if (id !== null) {
                if (kind === 'raf') globalThis.cancelAnimationFrame(id);
                else clearTimeout(id);
                id = null;
            }
        });
    }
    static GlobalClock = new Clock();
}
export class ManualClock extends Clock {
    constructor() {
        super();
        this.Time = 0;
        this._listeners = new Set();
    }
    Now() {
        return this.Time;
    }
    Subscribe(callback) {
        this._listeners.add(callback);
        return new Disposable(() => this._listeners.delete(callback));
    }
    Advance(milliseconds) {
        if (milliseconds < 0)
            throw new RangeError('Clock cannot go backwards.');
        this.Time += milliseconds;
        for (const callback of [...this._listeners])
            callback(this.Time);
    }
}
export function Interpolate(a, b, t) {
    const lerp = (x, y) => x + (y - x) * t;
    if (typeof a === 'number' && typeof b === 'number')
        return lerp(a, b);
    if (a instanceof Color && b instanceof Color)
        return new Color(...['A', 'R', 'G', 'B'].map(k => lerp(a[k], b[k])));
    if (a instanceof SolidColorBrush && b instanceof SolidColorBrush)
        return new SolidColorBrush(Interpolate(a.Color, b.Color, t), lerp(a.Opacity, b.Opacity));
    for (const [type, fields] of [[Thickness, ['Left', 'Top', 'Right', 'Bottom']], [CornerRadius, ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft']], [Point, ['X', 'Y']], [Size, ['Width', 'Height']], [Rect, ['X', 'Y', 'Width', 'Height']], [Matrix, ['M11', 'M12', 'M21', 'M22', 'M31', 'M32']]])
        if (a instanceof type && b instanceof type)
            return new type(...fields.map(k => lerp(a[k], b[k])));
    return t < 1 ? a : b;
}
export class Animation {
    constructor() {
        this.Duration = 300;
        this.Delay = 0;
        this.DelayBetweenIterations = 0;
        this.IterationCount = new IterationCount(1);
        this.PlaybackDirection = 'Normal';
        this.FillMode = 'None';
        this.Easing = new LinearEasing();
        this.Children = new AvaloniaList();
        this.Clock = null;
    }
    RunAsync(control, cancellationToken = null) {
        const duration = ParseDuration(this.Duration), delay = ParseDuration(this.Delay), gap = ParseDuration(this.DelayBetweenIterations), count = Number(this.IterationCount?.Value ?? this.IterationCount), clock = this.Clock ?? Clock.GlobalClock;
        if (!(duration >= 0) || !(delay >= 0) || !(gap >= 0) || !(count > 0))
            return Promise.reject(new RangeError('Animation duration/delay/count is invalid.'));
        const tracks = new Map();
        for (const keyFrame of this.Children)
            for (const setter of keyFrame.Setters) {
                const p = setter.Property instanceof AvaloniaProperty ? setter.Property : AvaloniaProperty.FindRegistered(control, setter.Property);
                if (!p)
                    return Promise.reject(new Error(`Unknown animated property '${setter.Property}'.`));
                if (!tracks.has(p))
                    tracks.set(p, []);
                const convert = p.GetMetadata(control).Convert;
                tracks.get(p).push({ Cue: keyFrame.Cue instanceof Cue ? keyFrame.Cue.CueValue : Cue.Parse(keyFrame.Cue).CueValue, Value: convert ? convert(setter.Value) : setter.Value, Easing: keyFrame.KeySpline });
            }
        for (const [p, keys] of tracks) {
            keys.sort((a, b) => a.Cue - b.Cue);
            if (!keys.length || keys[0].Cue > 0)
                keys.unshift({ Cue: 0, Value: control.GetValue(p) });
            if (keys.at(-1).Cue < 1)
                keys.push({ Cue: 1, Value: control.GetValue(p) });
        }
        const key = Symbol('Animation'), start = clock.Now(), lifetime = new CompositeDisposable();
        let finished = false;
        return new Promise((resolve, reject) => {
            const clear = () => {
                for (const p of tracks.keys())
                    control._RemovePriorityValue(p, key);
            };
            const finish = (error = null, canceled = false) => {
                if (finished)
                    return;
                finished = true;
                lifetime.Dispose();
                if (error || canceled || !['Forward', 'Both'].includes(this.FillMode))
                    clear();
                if (error)
                    reject(error);
                else
                    resolve();
            };
            const update = progress => {
                const t = this.Easing.Ease(progress);
                for (const [p, keys] of tracks) {
                    let i = 1;
                    while (i < keys.length - 1 && keys[i].Cue < t)
                        i++;
                    const a = keys[i - 1], b = keys[i] ?? a;
                    let local = b.Cue === a.Cue ? 1 : MathUtilities.Clamp((t - a.Cue) / (b.Cue - a.Cue), 0, 1);
                    if (b.Easing)
                        local = b.Easing.Ease(local);
                    control._SetPriorityValue(p, Interpolate(a.Value, b.Value, local), BindingPriority.Animation, key);
                }
            };
            const tick = now => {
                if (finished)
                    return;
                if (control.IsDisposed) {
                    finish(null, true);
                    return;
                }
                const elapsed = now - start - delay;
                if (elapsed < 0) {
                    if (['Backward', 'Both'].includes(this.FillMode))
                        update(0);
                    return;
                }
                const cycle = duration + gap;
                let index = cycle > 0 ? Math.floor(elapsed / cycle) : 0, t = duration > 0 ? Math.min(1, (elapsed - index * cycle) / duration) : 1;
                const done = count !== Infinity && (duration === 0 || elapsed >= count * duration + Math.max(0, count - 1) * gap);
                if (done) {
                    index = Math.max(0, Math.ceil(count) - 1);
                    t = count % 1 || 1;
                }
                const reverse = this.PlaybackDirection === 'Reverse' || this.PlaybackDirection === 'Alternate' && index % 2 === 1 || this.PlaybackDirection === 'AlternateReverse' && index % 2 === 0;
                try {
                    update(reverse ? 1 - t : t);
                    if (done)
                        finish();
                }
                catch (error) {
                    finish(error);
                }
            };
            const cancel = () => finish(null, true);
            if (cancellationToken?.IsCancellationRequested || cancellationToken?.aborted) {
                cancel();
                return;
            }
            if (cancellationToken?.Register)
                lifetime.Add(cancellationToken.Register(cancel));
            else if (cancellationToken?.addEventListener) {
                cancellationToken.addEventListener('abort', cancel, { once: true });
                lifetime.Add(new Disposable(() => cancellationToken.removeEventListener('abort', cancel)));
            }
            lifetime.Add(clock.Subscribe(tick));
            control._lifetime.Add(new Disposable(() => {
                cancel();
                clear();
            }));
            tick(start);
        });
    }
}
export class Transition {
    constructor(property = null, duration = 200) {
        this.Property = property;
        this.Duration = duration;
        this.Delay = 0;
        this.Easing = new CubicEaseOut();
    }
    async Apply(control, oldValue, newValue, cancellationToken) {
        const animation = new Animation();
        animation.Duration = this.Duration;
        animation.Delay = this.Delay;
        animation.Easing = this.Easing;
        animation.Children.Add(new KeyFrame(0, [{ Property: this.Property, Value: oldValue }]));
        animation.Children.Add(new KeyFrame(1, [{ Property: this.Property, Value: newValue }]));
        await animation.RunAsync(control, cancellationToken);
    }
}
export class DoubleTransition extends Transition {
}
export class ColorTransition extends Transition {
}
export class BrushTransition extends Transition {
}
export class ThicknessTransition extends Transition {
}
export class Transitions extends AvaloniaList {
}
export class TransitioningContentControl extends ContentControl {
    constructor() {
        super();
        this.TransitionDuration = 200;
    }
    _BuildContent() {
        super._BuildContent();
        if (this._contentChild && this.IsAttachedToVisualTree) {
            this._animationAbort?.abort();
            this._animationAbort = new AbortController();
            const animation = new Animation();
            animation.Duration = this.TransitionDuration;
            animation.Children.Add(new KeyFrame(0, [{ Property: 'Opacity', Value: 0 }]));
            animation.Children.Add(new KeyFrame(1, [{ Property: 'Opacity', Value: 1 }]));
            animation.RunAsync(this._contentChild, this._animationAbort.signal).catch(error => this.OnBindingError?.(null, error));
        }
    }
    Dispose() {
        this._animationAbort?.abort();
        super.Dispose();
    }
}
