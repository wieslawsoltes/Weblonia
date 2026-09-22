/** Deterministic ownership for subscriptions, timers, native handles and visual lifetimes. */
export class Disposable {
    static Empty = Object.freeze({ Dispose() {
        }, unsubscribe() {
        } });
    static Create(action) {
        return new Disposable(action);
    }
    constructor(action = () => {
    }) {
        this._action = action;
        this.IsDisposed = false;
    }
    Dispose() {
        if (this.IsDisposed)
            return;
        this.IsDisposed = true;
        const action = this._action;
        this._action = null;
        action?.();
    }
    unsubscribe() {
        this.Dispose();
    }
    [Symbol.dispose]() {
        this.Dispose();
    }
}
export function Dispose(value) {
    if (!value)
        return;
    if (typeof value === 'function')
        value();
    else if (typeof value.Dispose === 'function')
        value.Dispose();
    else
        value.unsubscribe?.();
}
export class CompositeDisposable extends Disposable {
    constructor(...items) {
        super();
        this._items = new Set(items.flat());
    }
    get Count() {
        return this._items.size;
    }
    Add(item) {
        if (this.IsDisposed)
            Dispose(item);
        else if (item)
            this._items.add(item);
        return item;
    }
    add(item) {
        return this.Add(item);
    }
    Remove(item) {
        if (!this._items.delete(item))
            return false;
        Dispose(item);
        return true;
    }
    Clear() {
        const items = [...this._items];
        this._items.clear();
        const errors = [];
        for (const item of items) {
            try {
                Dispose(item);
            }
            catch (e) {
                errors.push(e);
            }
        }
        if (errors.length)
            throw new AggregateError(errors, 'One or more disposals failed.');
    }
    Dispose() {
        if (!this.IsDisposed) {
            this.IsDisposed = true;
            this.Clear();
        }
    }
}
export class SerialDisposable extends Disposable {
    constructor() {
        super();
        this._current = null;
    }
    get Disposable() {
        return this._current;
    }
    set Disposable(value) {
        if (value === this._current)
            return;
        const old = this._current;
        this._current = this.IsDisposed ? null : value;
        Dispose(old);
        if (this.IsDisposed)
            Dispose(value);
    }
    Dispose() {
        if (!this.IsDisposed) {
            this.IsDisposed = true;
            Dispose(this._current);
            this._current = null;
        }
    }
}
/** .NET-style multicast event, with Rx-compatible disposable subscriptions. */
export class Event {
    constructor() {
        this._handlers = new Set();
    }
    get Count() {
        return this._handlers.size;
    }
    Add(handler) {
        if (typeof handler !== 'function')
            throw new TypeError('An event handler must be a function.');
        const entry = { handler, active: true };
        this._handlers.add(entry);
        return Disposable.Create(() => {
            entry.active = false;
            this._handlers.delete(entry);
        });
    }
    add(handler) {
        return this.Add(handler);
    }
    Remove(handler) {
        for (const e of this._handlers)
            if (e.handler === handler) {
                e.active = false;
                this._handlers.delete(e);
            }
    }
    remove(handler) {
        this.Remove(handler);
    }
    Raise(sender, args = {}) {
        for (const entry of [...this._handlers])
            if (entry.active)
                entry.handler(sender, args);
    }
    Subscribe(observer) {
        return this.Add((_, args) => typeof observer === 'function' ? observer(args) : observer.next?.(args));
    }
    subscribe(observer) {
        return this.Subscribe(observer);
    }
    Clear() {
        for (const entry of this._handlers)
            entry.active = false;
        this._handlers.clear();
    }
}
export class CancellationTokenSource extends Disposable {
    constructor() {
        super();
        this._controller = new AbortController();
    }
    get Token() {
        return this._controller.signal;
    }
    get IsCancellationRequested() {
        return this.Token.aborted;
    }
    Cancel(reason = new DOMException('Operation canceled.', 'AbortError')) {
        this._controller.abort(reason);
    }
    Dispose() {
        if (!this.IsDisposed) {
            this.Cancel();
            super.Dispose();
        }
    }
}
