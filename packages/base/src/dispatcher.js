import { Event, Disposable } from './disposable.js';

// Values and relative ordering match the pinned Avalonia DispatcherPriority.
const priorityNames = ['Inactive', 'SystemIdle', 'ApplicationIdle', 'ContextIdle', 'Background', 'Input',
    'Default', 'Loaded', 'UiThreadRender', 'AfterRender', 'Render', 'BeforeRender', 'AsyncRenderTargetResize', 'DataBind', 'Normal', 'Send'];
export class DispatcherPriority {
    constructor(value = 0) {
        if (!Number.isInteger(value) || value < -7 || value > 9) throw new RangeError('Invalid DispatcherPriority value.');
        this.Value = value; Object.freeze(this);
    }
    static FromValue(value) { this.Validate(value); return this[priorityNames[Number(value) + 6]]; }
    static Validate(value) {
        const n = value instanceof DispatcherPriority ? value.Value : value;
        if (!Number.isInteger(n) || n < -6 || n > 9) throw new RangeError('Invalid DispatcherPriority value.');
    }
    Equals(other) { return other instanceof DispatcherPriority && this.Value === other.Value; }
    CompareTo(other) { DispatcherPriority.Validate(other); return Math.sign(this.Value - Number(other)); }
    ToString() { return this.Value === -7 ? 'Invalid' : priorityNames[this.Value + 6]; }
    toString() { return this.ToString(); }
    valueOf() { return this.Value; }
}
for (let i = 0; i < priorityNames.length; ++i)
    Object.defineProperty(DispatcherPriority, priorityNames[i], { value: new DispatcherPriority(i - 6), enumerable: true });
Object.defineProperties(DispatcherPriority, { Invalid: { value: new DispatcherPriority(-7) }, MaxValue: { value: DispatcherPriority.Send } });
export const DispatcherOperationStatus = Object.freeze({ Pending: 0, Aborted: 1, Completed: 2, Executing: 3 });
const Status = DispatcherOperationStatus;
const canceled = () => new DOMException('Dispatcher operation aborted.', 'AbortError');
const duration = value => {
    const n = value?.TotalMilliseconds ?? value;
    if (!Number.isFinite(n) || n < 0 || n > 2147483647) throw new RangeError('Interval must be in [0, 2147483647] milliseconds.');
    return n;
};
const validateSignal = signal => {
    if (signal != null && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function' || typeof signal.aborted !== 'boolean'))
        throw new TypeError('Cancellation requires an AbortSignal.');
};

/** Awaitable operation. Status describes callback invocation, not the lifetime of
 * an asynchronous value returned by the callback. GetTask follows JS Promise
 * assimilation; a returned Promise is unwrapped without blocking the dispatcher. */
export class DispatcherOperation extends Disposable {
    constructor(dispatcher, priority, callback, throwOnUiThread = false) {
        super();
        if (!(dispatcher instanceof Dispatcher) || typeof callback !== 'function') throw new TypeError('A dispatcher and callback are required.');
        this.Dispatcher = dispatcher; this._priority = DispatcherPriority.FromValue(priority);
        this._status = Status.Pending; this._callback = callback; this._index = -1; this._order = 0;
        this._throwOnUiThread = throwOnUiThread; this.Completed = new Event(); this.Aborted = new Event();
        // Lazily allocate a Promise: ordinary Post/Timer traffic needs no task.
        this._task = null; this._result = undefined; this._error = null; this._faulted = false;
    }
    get Status() { return this._status; }
    get Priority() { return this._priority; }
    set Priority(value) {
        const priority = DispatcherPriority.FromValue(value);
        if (priority === this._priority) return;
        this._priority = priority;
        if (this._index >= 0) { this.Dispatcher._Repair(this._index); this.Dispatcher._Schedule(); }
    }
    get Result() {
        if (this.Status === Status.Pending || this.Status === Status.Executing) throw new Error('The operation has not completed. Await GetTask().');
        if (this._faulted || this.Status === Status.Aborted) throw this._error;
        return this._result;
    }
    GetTask() {
        if (!this._task) {
            this._task = new Promise((resolve, reject) => { this._resolve = resolve; this._reject = reject; });
            this._task.catch(() => {}); // Observed here; still rejects for explicit consumers.
            if (this.Status === Status.Aborted || this._faulted) this._reject(this._error);
            else if (this.Status === Status.Completed) this._resolve(this._result);
        }
        return this._task;
    }
    then(resolve, reject) { return this.GetTask().then(resolve, reject); }
    catch(reject) { return this.GetTask().catch(reject); }
    finally(action) { return this.GetTask().finally(action); }
    Abort(reason = canceled()) {
        if (this.Status !== Status.Pending) return false;
        if (this._index >= 0) this.Dispatcher._Remove(this);
        this._status = Status.Aborted; this._callback = null; this._error = reason;
        this._DetachCancellation(); this._reject?.(reason);
        this.Aborted.Raise(this, {}); return true;
    }
    _DetachCancellation() {
        this._signal?.removeEventListener('abort', this._onAbort);
        this._signal = this._onAbort = null;
    }
    _Execute() {
        this._status = Status.Executing; this._DetachCancellation();
        const callback = this._callback; this._callback = null;
        let failure = false, error;
        try {
            this._result = callback();
            if (this._result === this) throw new TypeError('A dispatcher callback cannot return its own operation.');
            if (this._result != null && typeof this._result.then === 'function') {
                this._result = Promise.resolve(this._result);
                this._result.catch(e => { if (this._throwOnUiThread) this.Dispatcher._ReportAsync(e); });
            }
        } catch (e) { failure = true; error = e; this._faulted = true; this._error = e; }
        this._status = Status.Completed;
        if (failure) this._reject?.(error); else this._resolve?.(this._result);
        try { this.Completed.Raise(this, {}); }
        finally { if (failure && this._throwOnUiThread) this.Dispatcher._Report(error); }
    }
    Dispose() { if (!this.IsDisposed) { try { this.Abort(); } finally { super.Dispose(); } } }
}

/** Realm-local dispatcher. Stable indexed heap: O(log n) enqueue, abort and
 * reprioritization, preserving original FIFO order across priority changes.
 * Automatic execution yields after a budget; RunJobs explicitly drains work. */
export class Dispatcher {
    static UIThread = new Dispatcher();
    constructor(options = {}) {
        this._queue = []; this._order = 0; this._scheduled = false; this._running = false; this._disabled = 0;
        this._maxJobs = options.MaxJobsPerTurn ?? 512; this._budget = options.TimeBudgetMilliseconds ?? 4;
        if (!Number.isInteger(this._maxJobs) || this._maxJobs < 1 || !Number.isFinite(this._budget) || this._budget <= 0)
            throw new RangeError('Dispatcher execution budgets must be positive.');
        this._now = options.Now ?? (() => globalThis.performance?.now() ?? Date.now());
        this._enqueueMicrotask = options.QueueMicrotask ?? queueMicrotask;
        this._enqueueTask = options.QueueTask ?? (callback => setTimeout(callback, 0));
        this.UnhandledException = new Event(); this.UnhandledExceptionFilter = new Event();
        this.ShutdownStarted = new Event(); this.ShutdownFinished = new Event();
        this.HasShutdownStarted = false; this.HasShutdownFinished = false;
    }
    get SupportsRunLoops() { return false; } // No nested browser event loops or blocking cross-worker Invoke.
    CheckAccess() { return true; } // Each JS realm owns its own instance; objects cannot be shared between workers.
    VerifyAccess() { if (!this.CheckAccess()) throw new Error('Invalid dispatcher access.'); }
    get PendingJobs() { return this._queue.length; }
    Post(action, priority = DispatcherPriority.Normal) { return this._Enqueue(action, priority, null, true); }
    InvokeAsync(action, priority = DispatcherPriority.Normal, signal = null) { return this._Enqueue(action, priority, signal, false); }
    Invoke(action, priority = DispatcherPriority.Send, signal = null) {
        DispatcherPriority.Validate(priority); validateSignal(signal); this.VerifyAccess();
        if (typeof action !== 'function') throw new TypeError('Dispatcher action must be callable.');
        if (signal?.aborted) throw signal.reason ?? canceled();
        if (this.HasShutdownStarted) throw new Error('Dispatcher has shut down.');
        if (Number(priority) !== Number(DispatcherPriority.Send))
            throw new DOMException('Synchronous queued Invoke requires a nested event loop. Use InvokeAsync.', 'NotSupportedError');
        return action();
    }
    AwaitWithPriority(task, priority = DispatcherPriority.Normal) {
        DispatcherPriority.Validate(priority);
        return Promise.resolve(task).then(value => this.InvokeAsync(() => value, priority).GetTask(),
            error => this.InvokeAsync(() => { throw error; }, priority).GetTask());
    }
    _Enqueue(action, priority, signal, throwOnUiThread) {
        validateSignal(signal);
        const operation = new DispatcherOperation(this, priority, action, throwOnUiThread);
        if (signal?.aborted || this.HasShutdownStarted) { operation.Abort(signal?.reason ?? canceled()); return operation; }
        if (signal) {
            operation._signal = signal; operation._onAbort = () => operation.Abort(signal.reason ?? canceled());
            signal.addEventListener('abort', operation._onAbort, { once: true });
        }
        operation._order = ++this._order; operation._index = this._queue.length; this._queue.push(operation);
        this._Up(operation._index); this._Schedule(); return operation;
    }
    _Higher(a, b) { return Number(a.Priority) > Number(b.Priority) || a.Priority === b.Priority && a._order < b._order; }
    _Swap(a, b) { const q = this._queue; [q[a], q[b]] = [q[b], q[a]]; q[a]._index = a; q[b]._index = b; }
    _Up(i) { while (i > 0) { const p = (i - 1) >> 1; if (!this._Higher(this._queue[i], this._queue[p])) break; this._Swap(i, p); i = p; } return i; }
    _Repair(i) {
        const q = this._queue; if (this._Up(i) !== i) return;
        for (;;) { let best = i, left = i * 2 + 1, right = left + 1;
            if (left < q.length && this._Higher(q[left], q[best])) best = left;
            if (right < q.length && this._Higher(q[right], q[best])) best = right;
            if (best === i) break; this._Swap(i, best); i = best;
        }
    }
    _Remove(operation) {
        const i = operation._index, last = this._queue.pop(); operation._index = -1;
        if (last !== operation) { this._queue[i] = last; last._index = i; this._Repair(i); }
    }
    HasJobsWithPriority(priority) { DispatcherPriority.Validate(priority); return !!this._queue.length && this._queue[0].Priority >= priority; }
    DisableProcessing() { return new DispatcherProcessingDisabled(this); }
    RunJobs(minPriority = DispatcherPriority.SystemIdle) {
        DispatcherPriority.Validate(minPriority);
        if (this._disabled) throw new Error('Cannot run jobs while dispatcher processing is suspended.');
        return this._Drain(Math.max(Number(minPriority), Number(DispatcherPriority.SystemIdle)), false);
    }
    _Drain(minPriority, automatic) {
        if (this._running || this._disabled || this.HasShutdownFinished) return 0;
        this._running = true; let count = 0; const started = this._now();
        try {
            while (!this._disabled && this.HasJobsWithPriority(minPriority) && !this.HasShutdownStarted) {
                if (automatic && count > 0 && (count >= this._maxJobs || this._now() - started >= this._budget)) break;
                if (!automatic && count >= 100000) throw new Error('Dispatcher work failed to converge.');
                const operation = this._queue[0]; this._Remove(operation); ++count; operation._Execute();
            }
        } finally { this._running = false; this._Schedule(automatic); }
        return count;
    }
    _Schedule(yieldToHost = false) {
        if (this._scheduled || this._running || this._disabled || this.HasShutdownStarted || !this.HasJobsWithPriority(DispatcherPriority.SystemIdle)) return;
        this._scheduled = true;
        (yieldToHost ? this._enqueueTask : this._enqueueMicrotask)(() => {
            this._scheduled = false;
            if (!this._disabled) this._Drain(Number(DispatcherPriority.SystemIdle), true);
        });
    }
    _Report(error) {
        const filter = { Exception: error, RequestCatch: true }; this.UnhandledExceptionFilter.Raise(this, filter);
        if (filter.RequestCatch) { const args = { Exception: error, Handled: false }; this.UnhandledException.Raise(this, args); if (args.Handled) return; }
        throw error;
    }
    _ReportAsync(error) { this._enqueueTask(() => this._Report(error)); }
    BeginInvokeShutdown(priority = DispatcherPriority.Normal) { return this.Post(() => this.InvokeShutdown(), priority); }
    InvokeShutdown() {
        if (this.HasShutdownStarted) return;
        this.HasShutdownStarted = true; const errors = [];
        try { this.ShutdownStarted.Raise(this, {}); } catch (error) { errors.push(error); }
        while (this._queue.length) { try { this._queue[0].Abort(); } catch (error) { errors.push(error); } }
        this.HasShutdownFinished = true;
        try { this.ShutdownFinished.Raise(this, {}); } catch (error) { errors.push(error); }
        if (errors.length) this._Report(new AggregateError(errors, 'Dispatcher shutdown callbacks failed.'));
    }
}
export class DispatcherProcessingDisabled extends Disposable {
    constructor(dispatcher) {
        if (!(dispatcher instanceof Dispatcher)) throw new TypeError('A dispatcher is required.');
        super(() => { --dispatcher._disabled; dispatcher._Schedule(); }); this.Dispatcher = dispatcher; ++dispatcher._disabled;
    }
}

/** One pending tick per timer; re-arm only after delivery, not while its
 * dispatcher is blocked. A generation prevents Stop/Start from reviving a tick. */
export class DispatcherTimer extends Disposable {
    constructor(interval = 1000, priority = DispatcherPriority.Normal, callback = null, dispatcher = Dispatcher.UIThread) {
        super();
        if (!(dispatcher instanceof Dispatcher)) throw new TypeError('A dispatcher is required.');
        this.Dispatcher = dispatcher; this._interval = duration(interval); this.Priority = DispatcherPriority.FromValue(priority);
        this.Tick = new Event(); this.Tag = null; this._enabled = false; this._timer = null; this._operation = null; this._generation = 0;
        if (callback) this.Tick.Add(callback);
        this._shutdown = null;
    }
    get Priority() { return this._priority; }
    set Priority(value) { this._priority = DispatcherPriority.FromValue(value); if (this._operation) this._operation.Priority = this._priority; }
    get Interval() { return this._interval; }
    set Interval(value) { this._interval = duration(value); if (this.IsEnabled) { this.Stop(); this.Start(); } }
    get IsEnabled() { return this._enabled; }
    set IsEnabled(value) { value ? this.Start() : this.Stop(); }
    Start() {
        if (this.IsDisposed) throw new Error('Timer is disposed.');
        if (this.Dispatcher.HasShutdownStarted) throw new Error('Dispatcher has shut down.');
        if (this._enabled) return; this._enabled = true; ++this._generation;
        this._shutdown = this.Dispatcher.ShutdownStarted.Add(() => this.Stop()); this._Schedule();
    }
    Stop() {
        this._enabled = false; ++this._generation; clearTimeout(this._timer); this._timer = null;
        this._operation?.Abort(); this._operation = null; this._shutdown?.Dispose(); this._shutdown = null;
    }
    _Schedule() {
        const generation = this._generation;
        this._timer = setTimeout(() => {
            this._timer = null;
            if (!this._enabled || generation !== this._generation) return;
            this._operation = this.Dispatcher.Post(() => {
                this._operation = null;
                if (!this._enabled || generation !== this._generation) return;
                try { this.Tick.Raise(this, {}); }
                finally { if (this._enabled && generation === this._generation) this._Schedule(); }
            }, this.Priority);
        }, Math.max(1, this._interval));
        this._timer.unref?.();
    }
    Dispose() { if (!this.IsDisposed) { this.Stop(); this.Tick.Clear(); super.Dispose(); } }
    static Run(action, interval, priority = DispatcherPriority.Normal, dispatcher = Dispatcher.UIThread) {
        if (typeof action !== 'function') throw new TypeError('Timer action must be callable.');
        const timer = new DispatcherTimer(interval, priority, null, dispatcher);
        timer.Tick.Add(() => { if (action() === false) timer.Dispose(); }); timer.Start(); return timer;
    }
    static RunOnce(action, interval = 0, priority = DispatcherPriority.Normal, dispatcher = Dispatcher.UIThread) {
        if (typeof action !== 'function') throw new TypeError('Timer action must be callable.');
        let timer; timer = DispatcherTimer.Run(() => { try { action(); } finally { timer.Dispose(); } return false; }, interval, priority, dispatcher); return timer;
    }
}
