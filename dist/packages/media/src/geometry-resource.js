import { AvaloniaObject, AvaloniaList, Event, CompositeDisposable } from '@wieslawsoltes/avalonia-base';

/** Shared observable geometry graph. Dependencies are borrowed, never disposed.
 * Every level observes its immediate children, so a leaf change reaches all DAG
 * parents without recursively resubscribing or walking the entire graph. */
export class GeometryResource extends AvaloniaObject {
    constructor() {
        super(); this.Changed = new Event(); this.Invalidated = this.Changed;
        this._resourceSubscriptions = new CompositeDisposable(); this._revision = 0;
    }
    _GetDependencies() { return []; }
    _RewireGeometry() {
        if (!this._resourceSubscriptions || this.IsDisposed) return;
        this._resourceSubscriptions.Clear();
        const seen = new Set();
        const observe = value => {
            if (!value || seen.has(value)) return; seen.add(value);
            if (value instanceof AvaloniaList) {
                this._resourceSubscriptions.Add(value.CollectionChanged.Add(() => { this._RewireGeometry(); this._InvalidateGeometry(); }));
                for (const child of value) observe(child);
            } else {
                const event = value.Invalidated ?? value.Changed ?? value.PropertyChanged;
                if (event?.Add) this._resourceSubscriptions.Add(event.Add(() => this._InvalidateGeometry()));
            }
        };
        for (const value of this._GetDependencies()) observe(value);
    }
    _InvalidateGeometry() {
        if (this.IsDisposed || this._geometryRaising) return;
        if (this._geometryUpdate) { this._geometryDirty = true; this._pathDescription = this._compiledPaths = null; return; }
        ++this._revision; this._pathDescription = this._compiledPaths = null;
        this._geometryRaising = true;
        try { this.Changed?.Raise(this, {}); } finally { this._geometryRaising = false; }
    }
    _UpdateGeometry(action) {
        this._geometryUpdate = (this._geometryUpdate ?? 0) + 1;
        try { return action(); } finally { if (--this._geometryUpdate === 0 && this._geometryDirty) { this._geometryDirty = false; this._InvalidateGeometry(); } }
    }
    OnPropertyChanged(change) { super.OnPropertyChanged(change); this._RewireGeometry(); this._InvalidateGeometry(); }
    Dispose() {
        if (this.IsDisposed) return;
        this._resourceSubscriptions.Dispose(); this.Changed.Clear(); this._pathDescription = this._compiledPaths = null; super.Dispose();
    }
}
