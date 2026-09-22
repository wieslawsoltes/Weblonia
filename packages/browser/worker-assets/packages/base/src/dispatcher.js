import { Event, Disposable } from './disposable.js';
export const DispatcherPriority = Object.freeze({ Inactive: 0, SystemIdle: 1, ApplicationIdle: 2, ContextIdle: 3, Background: 4, Input: 5, Loaded: 6, Render: 7, BeforeRender: 8, Normal: 9, Send: 10 });
let queueOrder = 0;
export class Dispatcher {
    static UIThread = new Dispatcher();
    constructor() {
        this._queue = [];
        this._scheduled = false;
        this._running = false;
        this.UnhandledException = new Event();
    }
    CheckAccess() {
        return true;
    }
    VerifyAccess() {
        if (!this.CheckAccess())
            throw new Error('Invalid dispatcher access.');
    }
    Post(action, priority = DispatcherPriority.Normal) {
        if (typeof action !== 'function')
            throw new TypeError('Dispatcher action must be callable.');
        const item = { action, priority, order: ++queueOrder, canceled: false };
        this._queue.push(item);
        this._schedule();
        return Disposable.Create(() => {
            item.canceled = true;
        });
    }
    InvokeAsync(action, priority = DispatcherPriority.Normal, cancellationToken) {
        return new Promise((resolve, reject) => {
            if (cancellationToken?.aborted)
                return reject(cancellationToken.reason);
            let subscription;
            const canceled = () => {
                subscription?.Dispose();
                reject(cancellationToken.reason);
            };
            cancellationToken?.addEventListener('abort', canceled, { once: true });
            subscription = this.Post(() => {
                cancellationToken?.removeEventListener('abort', canceled);
                try {
                    resolve(action());
                }
                catch (e) {
                    reject(e);
                }
            }, priority);
        });
    }
    RunJobs(minPriority = DispatcherPriority.Inactive) {
        if (this._running)
            return;
        this._running = true;
        try {
            let count = 0;
            while (true) {
                this._queue.sort((a, b) => b.priority - a.priority || a.order - b.order);
                const index = this._queue.findIndex(i => i.priority >= minPriority);
                if (index < 0)
                    break;
                if (++count > 100000)
                    throw new Error('Dispatcher work failed to converge.');
                const [job] = this._queue.splice(index, 1);
                if (job.canceled)
                    continue;
                try {
                    job.action();
                }
                catch (error) {
                    const args = { Exception: error, Handled: false };
                    this.UnhandledException.Raise(this, args);
                    if (!args.Handled)
                        throw error;
                }
            }
        }
        finally {
            this._running = false;
        }
    }
    _schedule() {
        if (this._scheduled)
            return;
        this._scheduled = true;
        queueMicrotask(() => {
            this._scheduled = false;
            this.RunJobs();
        });
    }
}
export class DispatcherTimer extends Disposable {
    constructor(interval = 1000, priority = DispatcherPriority.Normal, callback = null, dispatcher = Dispatcher.UIThread) {
        super();
        this.Interval = interval;
        this.Priority = priority;
        this.Dispatcher = dispatcher;
        this.Tick = new Event();
        this.IsEnabled = false;
        this._timer = null;
        if (callback)
            this.Tick.Add(callback);
    }
    Start() {
        if (this.IsDisposed)
            throw new Error('Timer is disposed.');
        if (this.IsEnabled)
            return;
        this.IsEnabled = true;
        this._schedule();
    }
    Stop() {
        this.IsEnabled = false;
        clearTimeout(this._timer);
        this._timer = null;
    }
    _schedule() {
        this._timer = setTimeout(() => {
            if (!this.IsEnabled)
                return;
            this.Dispatcher.Post(() => {
                if (this.IsEnabled)
                    this.Tick.Raise(this, {});
            }, this.Priority);
            this._schedule();
        }, Math.max(1, Number(this.Interval)));
        this._timer?.unref?.();
    }
    Dispose() {
        this.Stop();
        this.Tick.Clear();
        super.Dispose();
    }
    static Run(action, interval) {
        const timer = new DispatcherTimer(interval);
        timer.Tick.Add(() => {
            if (action() === false)
                timer.Dispose();
        });
        timer.Start();
        return timer;
    }
    static RunOnce(action, interval = 0) {
        let timer;
        timer = DispatcherTimer.Run(() => {
            action();
            return false;
        }, interval);
        return timer;
    }
}
