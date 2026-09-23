import { AvaloniaObject, AvaloniaProperty, BindingPriority, ResolveTransitionProperty, RegisterTransitionClockProvider } from "../../base/src/index.js";
import { IEffect, Effect, EffectExtensions, Color } from "../../media/src/index.js";
import { Clock, LinearEasing, ParseDuration, Interpolate } from './index.js';
export { Animatable, Transitions } from "../../base/src/index.js";

/** One bounded animation-priority slot, subscription and lifetime per application.
 * Completed instances release endpoints/owner/clock. No per-tick subscription,
 * control-lifetime growth, or polling is used. The definition remains caller-owned.
 */
export class TransitionInstance {
    constructor(control, property, clock, from, to, duration, delay, easing, interpolate, signal = null) {
        this.Property = property; this.IsDisposed = false; this.IsCompleted = false; this.IsCanceled = false; this.Error = null;
        this._control = control; this._key = Symbol('Transition'); this._subscription = null; this._abort = null;
        this._from = from; this._to = to; this._interpolate = interpolate; this._easing = easing;
        this._duration = duration; this._delay = delay; this._start = clock.Now();
        if (!Number.isFinite(this._start)) throw new RangeError('Transition clock returned an invalid time.');
        this.Completion = new Promise((resolve, reject) => { this._resolve = resolve; this._reject = reject; });
        this.Completion.catch(() => {});
        control._lifetime.Add(this);
        if (signal?.aborted || signal?.IsCancellationRequested) { this.Dispose(); return; }
        try {
            if (signal?.Register) this._abort = signal.Register(() => this.Dispose());
            else if (signal?.addEventListener) {
                const cancel = () => this.Dispose(); signal.addEventListener('abort', cancel, { once: true });
                this._abort = { Dispose() { signal.removeEventListener('abort', cancel); } };
            }
            this._Tick(this._start);
            if (!this.IsDisposed) {
                // A synchronous clock can complete while Subscribe is executing.
                const subscription = clock.Subscribe(now => this._Tick(now));
                if (!subscription || typeof subscription.Dispose !== 'function') throw new TypeError('The clock must return a disposable subscription.');
                if (this.IsDisposed) subscription.Dispose(); else this._subscription = subscription;
            }
        } catch (error) { this._Finish(error, false); }
    }
    _Tick(now) {
        if (this.IsDisposed) return;
        try {
            if (!Number.isFinite(now)) throw new RangeError('Transition clock returned an invalid time.');
            const elapsed = now - this._start - this._delay;
            const progress = elapsed < 0 ? 0 : this._duration === 0 ? 1 : Math.min(1, Math.max(0, elapsed / this._duration));
            const eased = this._easing.Ease(progress);
            if (!Number.isFinite(eased)) throw new RangeError('Transition easing returned a nonfinite value.');
            const value = this._interpolate(this._from, this._to, eased);
            this._control._SetPriorityValue(this.Property, value, BindingPriority.Animation, this._key);
            if (!this.IsDisposed && elapsed >= this._duration) { this.IsCompleted = true; this._Finish(null, false); }
        } catch (error) { this._Finish(error, false); }
    }
    _Finish(error, canceled) {
        if (this.IsDisposed) return;
        this.IsDisposed = true; this.IsCanceled = canceled;
        const owner = this._control, errors = error ? [error] : [];
        for (const cleanup of [() => this._subscription?.Dispose(), () => this._abort?.Dispose(),
            () => owner?._RemovePriorityValue(this.Property, this._key), () => owner?._lifetime.Remove(this)])
            try { cleanup(); } catch (failure) { errors.push(failure); }
        this._control = this._subscription = this._abort = this._from = this._to = this._interpolate = this._easing = null;
        this.Error = errors.length > 1 ? new AggregateError(errors, 'Transition failed or could not clean up.') : errors[0] ?? null;
        if (this.Error) { this.IsCompleted = false; this._reject(this.Error); owner?.OnBindingError(this.Property, this.Error); owner?._transitionErrors?.Raise(owner, { Property: this.Property, Error: this.Error }); }
        else this._resolve();
        this._resolve = this._reject = null;
    }
    Dispose() { this._Finish(null, true); }
}
export class ITransition {
    constructor() { throw new TypeError('ITransition is a contract, not a concrete transition.'); }
    static [Symbol.hasInstance](value) { return value instanceof TransitionBase; }
}
export class TransitionBase extends AvaloniaObject {
    constructor() {
        super(); this._transitionCollections = new Set();
        this._property = null; this._duration = 0; this._delay = 0; this._easing = new LinearEasing();
    }
    Apply() { throw new TypeError('A concrete transition must implement Apply.'); }
    Dispose() {
        if (this._transitionCollections.size) throw new Error('Remove a transition from its enabled owners before disposing its definition.');
        super.Dispose();
    }
}
for (const [name, field, convert, validate] of [
    ['Property', '_property', value => value, value => value == null || value instanceof AvaloniaProperty || typeof value === 'string'],
    ['Duration', '_duration', ParseDuration, value => Number.isFinite(value) && value >= 0],
    ['Delay', '_delay', ParseDuration, value => Number.isFinite(value) && value >= 0],
    ['Easing', '_easing', value => value, value => value != null && typeof value.Ease === 'function'],
]) {
    const property = AvaloniaProperty.RegisterDirect(TransitionBase, name, owner => owner[field], (owner, value) => { owner[name] = value; }, { AffectsRender: false, Convert: convert });
    Object.defineProperty(TransitionBase, name + 'Property', { value: property, enumerable: true });
    Object.defineProperty(TransitionBase.prototype, name, { enumerable: true,
        get() { return this[field]; }, set(value) {
            this._verifyAlive(); value = convert(value);
            if (!validate(value)) throw new TypeError(`Invalid transition ${name}.`);
            if (name === 'Property') for (const collection of this._transitionCollections) collection._ValidateTarget(this, value);
            this.SetAndRaise(property, field, value);
        }
    });
}
export class Transition extends TransitionBase {
    constructor(property = null, duration = property == null ? 0 : 200) {
        super(); this.Property = property; this.Duration = duration;
    }
    Snapshot(value) {
        if (value instanceof IEffect) return EffectExtensions.ToImmutable(value);
        if (value instanceof Color) return Object.freeze(new Color(value.A, value.R, value.G, value.B));
        return value;
    }
    Interpolate(oldValue, newValue, progress) { return Interpolate(oldValue, newValue, progress); }
    Apply(control, ...args) {
        const explicitClock = typeof args[0]?.Now === 'function' && typeof args[0]?.Subscribe === 'function';
        try {
            this._verifyAlive(); control._verifyAlive();
            const [clock, oldValue, newValue, signal] = explicitClock ? args : [control.Clock ?? Clock.GlobalClock, ...args];
            const property = ResolveTransitionProperty(control, this.Property), from = this.Snapshot(oldValue), to = this.Snapshot(newValue);
            const duration = ParseDuration(this.Duration), delay = ParseDuration(this.Delay), easing = this.Easing;
            if (!Number.isFinite(duration) || duration < 0 || !Number.isFinite(delay) || delay < 0 || !easing || typeof easing.Ease !== 'function')
                throw new TypeError('Transition duration, delay or easing is invalid.');
            // Capture the selected interpolation implementation: later replacement
            // of a reusable definition does not change an already running instance.
            const interpolation = this.Interpolate;
            const instance = new TransitionInstance(control, property, clock, from, to, duration, delay, easing,
                (a, b, t) => interpolation.call(this, a, b, t), signal);
            return explicitClock ? instance : instance.Completion;
        } catch (error) { if (explicitClock) throw error; return Promise.reject(error); }
    }
}
export class DoubleTransition extends Transition {
    Snapshot(value) { if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('DoubleTransition requires finite numbers.'); return value; }
}
export class ColorTransition extends Transition {}
export class BrushTransition extends Transition {}
export class ThicknessTransition extends Transition {}
export class EffectTransition extends Transition {
    Snapshot(value) { return value == null ? null : EffectExtensions.ToImmutable(typeof value === 'string' ? Effect.Parse(value) : value); }
    Interpolate(from, to, progress) { return EffectExtensions.Interpolate(from, to, progress, true); }
}
RegisterTransitionClockProvider(() => Clock.GlobalClock);
