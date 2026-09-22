import { AvaloniaList, CompositeDisposable, Disposable, DefineProperties, Point, Vector } from '@wieslawsoltes/avalonia-base';
import { StyledElement, InputElement, RoutedEventArgs, DefineRoutedEvent, RegisterGestureServices, BooleanValue } from './core.js';

for (const name of ['Pinch', 'PinchEnded', 'ScrollGesture', 'ScrollGestureEnded', 'ScrollGestureInertiaStarting'])
    DefineRoutedEvent(InputElement, name);

export class PinchEventArgs extends RoutedEventArgs {
    constructor(scale, scaleOrigin, angle = 0, angleDelta = 0) {
        super(InputElement.PinchEvent);
        this.Scale = scale; this.ScaleOrigin = scaleOrigin; this.Angle = angle; this.AngleDelta = angleDelta;
    }
}
export class PinchEndedEventArgs extends RoutedEventArgs {
    constructor() { super(InputElement.PinchEndedEvent); }
}
export class ScrollGestureEventArgs extends RoutedEventArgs {
    static _nextId = 0;
    static GetNextFreeId() { return ++this._nextId; }
    constructor(id, delta) {
        super(InputElement.ScrollGestureEvent);
        this.Id = id; this.Delta = delta; this.ShouldEndScrollGesture = false;
    }
}
export class ScrollGestureEndedEventArgs extends RoutedEventArgs {
    constructor(id) { super(InputElement.ScrollGestureEndedEvent); this.Id = id; }
}
export class ScrollGestureInertiaStartingEventArgs extends RoutedEventArgs {
    constructor(id, inertia) { super(InputElement.ScrollGestureInertiaStartingEvent); this.Id = id; this.Inertia = inertia; }
}

export class GestureRecognizer extends StyledElement {
    constructor() { super(); this.Target = null; this._pointers = new Set(); }
    _Dispatch(method, e) {
        if (!this.Target || this.IsDisposed || !this.Target.IsEffectivelyEnabled) return;
        this._currentEvent = e;
        try { this[method](e); } finally { this._currentEvent = null; }
    }
    PointerPressedInternal(e) { this._pointers.add(e.Pointer); this._Dispatch('PointerPressed', e); }
    PointerMovedInternal(e) { this._Dispatch('PointerMoved', e); }
    PointerReleasedInternal(e) {
        this._pointers.delete(e.Pointer);
        this._Dispatch('PointerReleased', e);
    }
    PointerCaptureLostInternal(pointer) { this._pointers.delete(pointer); this.PointerCaptureLost(pointer); }
    PointerPressed() {}
    PointerMoved() {}
    PointerReleased() {}
    PointerCaptureLost() {}
    Capture(pointer) {
        if (!this.Target || this.IsDisposed) return;
        pointer.CaptureGestureRecognizer(this);
        this._currentEvent?.PreventGestureRecognition();
    }
    Cancel() {
        const pointers = [...this._pointers];
        this._pointers.clear();
        for (const pointer of pointers) {
            if (pointer.CapturedGestureRecognizer === this) pointer.CaptureGestureRecognizer(null);
            else this.PointerCaptureLost(pointer);
            pointer._gestureCandidates = pointer._gestureCandidates?.filter(r => r !== this);
        }
    }
    Dispose() { if (this.IsDisposed) return; this.Cancel(); this._collection?.Remove(this); super.Dispose(); }
}

/** A recognizer has one owning collection. Removal cancels contacts without disposing it. */
export class GestureRecognizerCollection extends AvaloniaList {
    constructor(owner) {
        super(); this.Owner = owner; this._attached = new Set(); this._lifetime = new CompositeDisposable();
        this.ValidateMutation = change => {
            if (this._disposed) throw new Error('Gesture collection is disposed.');
            const retained = new Set(this._items.filter(r => !change.OldItems.includes(r)));
            for (const r of change.NewItems) {
                if (!(r instanceof GestureRecognizer) || r.IsDisposed) throw new TypeError('An undisposed GestureRecognizer is required.');
                if (r._collection && r._collection !== this) throw new Error('A recognizer already belongs to another collection.');
                if (retained.has(r)) throw new Error('Duplicate gesture recognizer.');
                retained.add(r);
            }
        };
        this._lifetime.Add(owner.DetachedFromVisualTree.Add(() => this.Cancel()));
    }
    _notify(...args) {
        // Ownership changes immediately even inside BeginUpdate; notifications may batch.
        this._Synchronize();
        super._notify(...args);
    }
    _Synchronize() {
        const next = new Set(this._items);
        for (const r of this._attached) if (!next.has(r)) { r.Cancel(); r.Target = null; r._collection = null; }
        for (const r of next) { r._collection = this; r.Target = this.Owner; }
        this._attached = next;
    }
    Cancel() { for (const r of [...this._attached]) r.Cancel(); }
    Dispose() {
        if (this._disposed) return;
        this.Cancel(); this.Clear(); this._lifetime.Dispose(); this._disposed = true;
    }
}

const isContact = pointer => pointer.Type === 'Touch' || pointer.Type === 'Pen';
const distance = (a, b) => Math.hypot(a.X - b.X, a.Y - b.Y);
const angle = (a, b) => (Math.atan2(a.X - b.X, b.Y - a.Y) * 180 / Math.PI + 180) % 360;
const angleDelta = (a, b) => ((a - b + 540) % 360) - 180;
export class PinchGestureRecognizer extends GestureRecognizer {
    constructor() { super(); this._contacts = new Map(); this._pinching = false; }
    PointerPressed(e) {
        if (!isContact(e.Pointer) || this._contacts.has(e.Pointer) || this._contacts.size >= 2) return;
        this._contacts.set(e.Pointer, e.GetPosition(this.Target));
        if (this._contacts.size !== 2) return;
        const [a, b] = this._contacts.values();
        this._initialDistance = distance(a, b);
        this._origin = new Point((a.X + b.X) / 2, (a.Y + b.Y) / 2);
        this._previousAngle = angle(a, b); this._pinching = true;
        for (const pointer of this._contacts.keys()) this.Capture(pointer);
        e.Handled = true;
    }
    _ObservePosition(e) { if (this._contacts.has(e.Pointer)) this._contacts.set(e.Pointer, e.GetPosition(this.Target)); }
    PointerMoved(e) {
        this._ObservePosition(e);
        if (!this._pinching || !this._contacts.has(e.Pointer)) return;
        const [a, b] = this._contacts.values(), length = distance(a, b);
        // Coincident initial contacts establish their baseline on the first separation.
        if (this._initialDistance < 1e-6) this._initialDistance = length;
        const degrees = angle(a, b), scale = this._initialDistance < 1e-6 ? 1 : length / this._initialDistance;
        const args = new PinchEventArgs(scale, this._origin, degrees, angleDelta(this._previousAngle, degrees));
        this._previousAngle = degrees;
        this.Target.RaiseEvent(args); e.Handled = true; e.PreventGestureRecognition();
    }
    _Remove(pointer) {
        if (!this._contacts.delete(pointer)) return;
        const ended = this._pinching; this._pinching = false;
        if (pointer.CapturedGestureRecognizer === this) pointer.CaptureGestureRecognizer(null);
        if (ended) this.Target?.RaiseEvent(new PinchEndedEventArgs());
    }
    PointerReleased(e) { const active = this._pinching; this._Remove(e.Pointer); if (active) e.Handled = true; }
    PointerCaptureLost(pointer) { this._Remove(pointer); }
    Cancel() { super.Cancel(); this._contacts.clear(); this._pinching = false; }
}

/** Bounded least-squares velocity estimator. Timestamps are milliseconds, result pixels/second. */
export class VelocityTracker {
    constructor() { this._samples = []; }
    AddPosition(timestamp, position) {
        if (!Number.isFinite(timestamp) || !Number.isFinite(position.X) || !Number.isFinite(position.Y)) return;
        const last = this._samples.at(-1);
        if (last && timestamp < last.t) return;
        if (last && timestamp === last.t) this._samples.pop();
        this._samples.push({ t: timestamp, x: position.X, y: position.Y });
        while (this._samples.length > 20 || (this._samples.length > 1 && this._samples[0].t < timestamp - 100)) this._samples.shift();
    }
    GetVelocity(now = this._samples.at(-1)?.t ?? 0) {
        if (this._samples.length < 2 || now - this._samples.at(-1).t > 100) return new Vector();
        const n = this._samples.length, origin = this._samples[0].t;
        let t = 0, x = 0, y = 0;
        for (const s of this._samples) { t += s.t - origin; x += s.x; y += s.y; }
        t /= n; x /= n; y /= n;
        let variance = 0, vx = 0, vy = 0;
        for (const s of this._samples) { const dt = s.t - origin - t; variance += dt * dt; vx += dt * (s.x - x); vy += dt * (s.y - y); }
        return variance > 1e-6 ? new Vector(Math.max(-20000, Math.min(20000, vx / variance * 1000)), Math.max(-20000, Math.min(20000, vy / variance * 1000))) : new Vector();
    }
}
const defaultClock = Object.freeze({
    Now: () => performance.now(),
    Request(callback) {
        if (typeof requestAnimationFrame === 'function') {
            const id = requestAnimationFrame(callback); return Disposable.Create(() => cancelAnimationFrame(id));
        }
        const id = setTimeout(() => callback(performance.now()), 16); id.unref?.(); return Disposable.Create(() => clearTimeout(id));
    }
});

export class ScrollGestureRecognizer extends GestureRecognizer {
    static InertialResistance = .15;
    static InertialScrollSpeedEnd = 5;
    /** Optional frame clock is a JavaScript testing/embedding extension. */
    constructor(clock = defaultClock) {
        super(); this._clock = clock; this._tracking = null; this._scrolling = false; this._gestureId = null;
        this.Offset = null; this.Extent = null; this.Viewport = null;
    }
    PointerPressed(e) {
        if (!isContact(e.Pointer) || this._tracking) return;
        this.EndGesture();
        this._tracking = e.Pointer; this._start = this._last = e.GetPosition(null);
        this._velocity = new VelocityTracker(); this._velocity.AddPosition(e.Timestamp, new Point());
    }
    _CanMove(delta) {
        return (!this.Offset || !this.Extent || !this.Viewport) ||
            (delta.X !== 0 && (delta.X > 0 ? this.Offset.X + this.Viewport.Width < this.Extent.Width : this.Offset.X > 0)) ||
            (delta.Y !== 0 && (delta.Y > 0 ? this.Offset.Y + this.Viewport.Height < this.Extent.Height : this.Offset.Y > 0));
    }
    PointerMoved(e) {
        if (e.Pointer !== this._tracking) return;
        const point = e.GetPosition(null);
        const total = new Vector(this.CanHorizontallyScroll ? this._start.X - point.X : 0, this.CanVerticallyScroll ? this._start.Y - point.Y : 0);
        this._velocity.AddPosition(e.Timestamp, total);
        let delta = new Vector(this.CanHorizontallyScroll ? this._last.X - point.X : 0, this.CanVerticallyScroll ? this._last.Y - point.Y : 0);
        if (!this._scrolling) {
            if (Math.max(Math.abs(total.X), Math.abs(total.Y)) <= this.ScrollStartDistance || !this._CanMove(total)) return;
            delta = new Vector(Math.sign(total.X) * Math.max(0, Math.abs(total.X) - this.ScrollStartDistance), Math.sign(total.Y) * Math.max(0, Math.abs(total.Y) - this.ScrollStartDistance));
        }
        if (!delta.X && !delta.Y) return;
        const id = this._gestureId ??= ScrollGestureEventArgs.GetNextFreeId();
        const args = new ScrollGestureEventArgs(id, delta);
        this.Target.RaiseEvent(args);
        this._last = point;
        if (args.Handled && this.Target && this._tracking === e.Pointer) {
            this._scrolling = true; this.Capture(e.Pointer); e.Handled = true;
        }
        if (args.ShouldEndScrollGesture) this.EndGesture();
    }
    PointerReleased(e) {
        if (e.Pointer !== this._tracking) return;
        const wasScrolling = this._scrolling, velocity = this._velocity?.GetVelocity(e.Timestamp) ?? new Vector();
        this._tracking = null;
        // Release without ending the independently scheduled inertia lifetime.
        this._releasing = true;
        try { if (e.Pointer.CapturedGestureRecognizer === this) e.Pointer.CaptureGestureRecognizer(null); }
        finally { this._releasing = false; }
        if (wasScrolling) e.Handled = true;
        if (wasScrolling && this.IsScrollInertiaEnabled && velocity.Length > ScrollGestureRecognizer.InertialScrollSpeedEnd && this.Target) {
            const id = this._gestureId;
            this.Target.RaiseEvent(new ScrollGestureInertiaStartingEventArgs(id, velocity));
            if (this._gestureId !== id || !this.Target) return;
            this._inertiaVelocity = velocity; this._inertiaStart = this._clock.Now(); this._inertiaPrevious = 0;
            this._ScheduleInertia(id);
        } else this.EndGesture();
    }
    _ScheduleInertia(id) {
        this._frame = this._clock.Request(now => {
            this._frame = null;
            if (this._gestureId !== id || !this.Target || !this.Target.IsEffectivelyEnabled) { this.EndGesture(); return; }
            const elapsed = Math.max(this._inertiaPrevious, (now - this._inertiaStart) / 1000);
            const k = -Math.log(ScrollGestureRecognizer.InertialResistance) / .25;
            // Analytic integration is invariant to frame duration; cap at stop time.
            const stop = Math.log(this._inertiaVelocity.Length / ScrollGestureRecognizer.InertialScrollSpeedEnd) / k;
            const end = Math.min(elapsed, stop), start = this._inertiaPrevious;
            const integral = (Math.exp(-k * start) - Math.exp(-k * end)) / k;
            this._inertiaPrevious = end;
            const args = new ScrollGestureEventArgs(id, this._inertiaVelocity.Multiply(integral));
            if (integral > 0) this.Target.RaiseEvent(args);
            if (this._gestureId !== id) return;
            if (args.ShouldEndScrollGesture || !args.Handled || elapsed >= stop) this.EndGesture();
            else this._ScheduleInertia(id);
        });
    }
    PointerCaptureLost(pointer) { if (!this._releasing && (pointer === this._tracking || this._scrolling)) this.EndGesture(); }
    EndGesture() {
        const id = this._gestureId, tracking = this._tracking;
        this._gestureId = null; this._tracking = null; this._scrolling = false;
        this._frame?.Dispose(); this._frame = null; this._velocity = null;
        if (tracking?.CapturedGestureRecognizer === this) tracking.CaptureGestureRecognizer(null);
        if (id != null) this.Target?.RaiseEvent(new ScrollGestureEndedEventArgs(id));
    }
    Cancel() { this.EndGesture(); super.Cancel(); }
}
DefineProperties(ScrollGestureRecognizer, {
    CanHorizontallyScroll: [false, { Convert: BooleanValue }], CanVerticallyScroll: [false, { Convert: BooleanValue }],
    IsScrollInertiaEnabled: [false, { Convert: BooleanValue }],
    ScrollStartDistance: [5, { Convert: value => { const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new RangeError('ScrollStartDistance must be nonnegative and finite.'); return n; } }]
});

RegisterGestureServices({
    CreateCollection: owner => new GestureRecognizerCollection(owner),
    Process(e, chain) {
        const name = e.RoutedEvent.Name;
        if (!e.Pointer || !['PointerPressed', 'PointerMoved', 'PointerReleased'].includes(name) || e._gestureProcessed) return null;
        e._gestureProcessed = true;
        const pointer = e.Pointer;
        if (name === 'PointerPressed') {
            pointer._suppressTap = false;
            pointer._gestureCandidates = chain.flatMap(node => node._gestureRecognizers?.ToArray() ?? []);
        }
        const active = pointer.CapturedGestureRecognizer;
        const candidates = pointer._gestureCandidates ?? [];
        if (active) {
            for (const r of candidates) if (r !== active) r._ObservePosition?.(e);
            active[`${name}Internal`](e);
            e.Handled = true;
        } else if (!pointer.IsGestureRecognitionSkipped) {
            for (const r of candidates) {
                r[`${name}Internal`](e);
                if (pointer.CapturedGestureRecognizer || pointer.IsGestureRecognitionSkipped) break;
            }
        }
        if (name === 'PointerReleased') return () => {
            for (const r of candidates) {
                r._pointers.delete(pointer);
                if (r !== active) r.PointerCaptureLostInternal(pointer);
            }
            pointer._gestureCandidates = [];
            if (pointer.CapturedGestureRecognizer) pointer.CaptureGestureRecognizer(null);
            pointer.IsGestureRecognitionSkipped = false;
        };
        return null;
    }
});
