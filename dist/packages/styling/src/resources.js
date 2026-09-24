import { AvaloniaDictionary, AvaloniaList, Event, CompositeDisposable, Disposable, UnsetValue } from '@wieslawsoltes/avalonia-base';
import { Observable } from 'rxjs';
export class ThemeVariant {
    constructor(key, inheritVariant = null) {
        this.Key = key;
        this.InheritVariant = inheritVariant;
    }
    Equals(other) {
        return other instanceof ThemeVariant && other.Key === this.Key;
    }
    ToString() {
        return this.toString();
    }
    toString() {
        return String(this.Key);
    }
    static Default = Object.freeze(new ThemeVariant('Default'));
    static Light = Object.freeze(new ThemeVariant('Light'));
    static Dark = Object.freeze(new ThemeVariant('Dark'));
    static Parse(value) {
        if (value instanceof ThemeVariant)
            return value;
        return ThemeVariant[String(value)] ?? new ThemeVariant(String(value));
    }
}
export const ResourceEnvironment = { Application: null, SystemTheme: ThemeVariant.Light };
// Deferred entries are private wrappers, never inferred from an ordinary resource's
// Build method (DataTemplate, for example, is a value, not a deferred factory).
class DeferredResource {
    constructor(content, shared) {
        if (typeof content !== 'function' && typeof content?.Build !== 'function')
            throw new TypeError('Deferred resources require a synchronous factory or a Build provider.');
        this.Content = content; this.Shared = shared;
    }
    Build() { return typeof this.Content === 'function' ? this.Content(null) : this.Content.Build(null); }
}
let deferredDepth = 0;
const notFound = () => ({ Found: false, Value: UnsetValue });
function provider(value) {
    if (!value || typeof value.TryGetResource !== 'function')
        throw new TypeError('A resource provider must implement TryGetResource.');
    if (value.IsDisposed) throw new Error('A disposed resource dictionary cannot be attached.');
    return value;
}
function themeKey(key) { return key instanceof ThemeVariant ? key.Key : key; }
function validateEdge(owner, value) {
    provider(value);
    const seen = new Set(), pending = [value];
    while (pending.length) {
        const current = pending.pop();
        if (current === owner) throw new Error('Resource dictionary cycle.');
        if (seen.has(current)) continue;
        seen.add(current);
        if (current instanceof ResourceDictionary) {
            for (const child of current.MergedDictionaries) pending.push(child);
            for (const child of current.ThemeDictionaries.values()) pending.push(child);
        }
    }
}
class ThemeResourceDictionary extends AvaloniaDictionary {
    constructor(owner) { super(); this._owner = owner; }
    set(key, value) { this._owner._VerifyAlive(); validateEdge(this._owner, value); return super.set(themeKey(key), value); }
    get(key) { return super.get(themeKey(key)); }
    has(key) { return super.has(themeKey(key)); }
    delete(key) { return super.delete(themeKey(key)); }
}

/** Resource values are borrowed. Deferred factories are synchronous, retryable
 * on failure and never realized by replacement, deletion or enumeration. */
export class ResourceDictionary extends AvaloniaDictionary {
    constructor(values) {
        super(values);
        this.IsDisposed = false;
        this.ResourcesChanged = new Event();
        this.MergedDictionaries = new AvaloniaList();
        this.ThemeDictionaries = new ThemeResourceDictionary(this);
        this.Owner = null;
        this._building = new Set();
        this._children = new Map();
        this._events = new CompositeDisposable();
        this.MergedDictionaries.ValidateMutation = change => {
            this._VerifyAlive();
            for (const value of change.NewItems) validateEdge(this, value);
        };
        this._events.Add(this.CollectionChanged.Add(() => this._notify()));
        this._events.Add(this.MergedDictionaries.CollectionChanged.Add(() => this._rewire()));
        this._events.Add(this.ThemeDictionaries.CollectionChanged.Add(() => this._rewire()));
    }
    _VerifyAlive() { if (this.IsDisposed) throw new Error('ResourceDictionary is disposed.'); }
    get Keys() { return [...Map.prototype.keys.call(this)]; }
    get Values() { return [...Map.prototype.values.call(this)]; }
    get HasResources() {
        if (this.size) return true;
        // Match the pinned IResourceProvider contract: theme-only entries are not
        // included by HasResources, although TryGetResource still searches them.
        for (const value of this.MergedDictionaries) if (value.HasResources) return true;
        return false;
    }
    EnsureCapacity(capacity) {
        this._VerifyAlive();
        if (!Number.isSafeInteger(capacity) || capacity < 0) throw new RangeError('Capacity must be a nonnegative integer.');
        // JavaScript Map does not expose capacity reservation.
    }
    AddDeferred(key, content) { this.Add(key, new DeferredResource(content, true)); }
    AddNotSharedDeferred(key, content) { this.Add(key, new DeferredResource(content, false)); }
    ContainsDeferredKey(key) { return Map.prototype.get.call(this, key) instanceof DeferredResource; }
    TryGetValue(key) {
        if (!this.has(key) || this.IsDisposed) return notFound();
        const stored = Map.prototype.get.call(this, key);
        if (!(stored instanceof DeferredResource)) return { Found: true, Value: stored };
        // An in-progress key may fall through to a theme/merged/outer definition.
        // Track ALL active keys, not just the last one (A -> B -> A is finite).
        if (this._building.has(key)) return notFound();
        if (deferredDepth >= 128) throw new RangeError('Deferred resource nesting limit exceeded.');
        this._building.add(key); ++deferredDepth;
        try {
            const value = stored.Build();
            if (typeof value?.then === 'function') {
                Promise.resolve(value).catch(() => {});
                throw new TypeError('Deferred resource factories must return synchronously.');
            }
            // A factory can replace/remove its own entry or dispose the dictionary.
            // Never overwrite a newer mutation with the old factory's result.
            if (stored.Shared && !this.IsDisposed && Map.prototype.get.call(this, key) === stored)
                Map.prototype.set.call(this, key, value);
            return { Found: true, Value: value };
        } finally { --deferredDepth; this._building.delete(key); }
    }
    get(key) { const result = this.TryGetValue(key); return result.Found ? result.Value : undefined; }
    set(key, value) {
        this._VerifyAlive();
        const had = this.has(key), old = Map.prototype.get.call(this, key);
        Map.prototype.set.call(this, key, value);
        this.CollectionChanged.Raise(this, { Action: had ? 'Replace' : 'Add', Key: key, OldValue: old, NewValue: value });
        return this;
    }
    delete(key) {
        this._VerifyAlive(); if (!this.has(key)) return false;
        const old = Map.prototype.get.call(this, key);
        Map.prototype.delete.call(this, key);
        this.CollectionChanged.Raise(this, { Action: 'Remove', Key: key, OldValue: old }); return true;
    }
    clear() {
        this._VerifyAlive(); if (!this.size) return;
        Map.prototype.clear.call(this); this.CollectionChanged.Raise(this, { Action: 'Reset' });
    }
    SetItems(values) {
        this._VerifyAlive();
        const entries = Array.from(values, item => {
            if (!Array.isArray(item) || item.length !== 2) throw new TypeError('SetItems expects [key, value] entries.');
            return [item[0], item[1]];
        });
        if (!entries.length) return;
        for (const [key, value] of entries) Map.prototype.set.call(this, key, value);
        this.CollectionChanged.Raise(this, { Action: 'Reset' });
    }
    _notify(change = {}) {
        if (this.IsDisposed) return;
        // A diamond of borrowed dictionaries observes one change once. Cycles
        // are rejected before mutation, but the token also bounds external raises.
        const visited = change._ResourceChangeVisited ?? new Set();
        if (visited.has(this)) return;
        visited.add(this);
        this.ResourcesChanged.Raise(this, { ...change, _ResourceChangeVisited: visited });
        this.Owner?.OnResourcesChanged?.();
    }
    _rewire() {
        if (this.IsDisposed) return;
        const providers = new Set([...this.MergedDictionaries, ...this.ThemeDictionaries.values()]);
        for (const [value, subscription] of this._children) if (!providers.has(value)) {
            subscription.Dispose(); this._children.delete(value);
        }
        for (const value of providers) if (!this._children.has(value) && value.ResourcesChanged?.Add)
            this._children.set(value, value.ResourcesChanged.Add((_, change) => this._notify(change)));
        this._notify();
    }
    TryGetResource(key, theme = ThemeVariant.Default, visited = new Set()) {
        if (this.IsDisposed || visited.has(this)) return notFound();
        visited.add(this);
        const own = this.TryGetValue(key);
        if (own.Found) return own;
        let variant = ThemeVariant.Parse(theme ?? ThemeVariant.Default);
        const variants = new Set();
        while (variant && !variants.has(variant.Key) && variant.Key !== ThemeVariant.Default.Key) {
            variants.add(variant.Key);
            // Pass the originally requested theme to nested dictionaries, not the
            // inherited variant used to locate this fallback dictionary.
            const result = this.ThemeDictionaries.get(variant)?.TryGetResource(key, theme, visited);
            if (result?.Found) return result;
            variant = variant.InheritVariant;
        }
        const fallback = this.ThemeDictionaries.get(ThemeVariant.Default)?.TryGetResource(key, theme, visited);
        if (fallback?.Found) return fallback;
        // No reversed array allocation on each hot lookup.
        for (let i = this.MergedDictionaries.Count - 1; i >= 0; --i) {
            const found = this.MergedDictionaries.Get(i).TryGetResource(key, theme, visited);
            if (found.Found) return found;
        }
        return notFound();
    }
    GetResource(key, theme) {
        const result = this.TryGetResource(key, theme);
        if (!result.Found) throw new Error(`Resource '${String(key)}' was not found.`);
        return result.Value;
    }
    Dispose() {
        if (this.IsDisposed) return;
        this.IsDisposed = true;
        this._events.Dispose();
        for (const subscription of this._children.values()) subscription.Dispose();
        this._children.clear(); this._building.clear(); this.Owner = null;
        // Drop factories/values without disposing borrowed resource objects.
        Map.prototype.clear.call(this);
        this.MergedDictionaries.Clear(); this.ThemeDictionaries.clear();
        this.ResourcesChanged.Clear(); this.CollectionChanged.Clear();
    }
}
const parentOf = node => node.Parent ?? node.VisualParent ?? node.TemplatedParent ?? node.InheritanceParent;
const extras = extra => extra == null ? [] : Array.isArray(extra) ? extra : [extra];
export function TryFindResource(control, key, theme = control?.ActualThemeVariant ?? ResourceEnvironment.Application?.ActualThemeVariant ?? ResourceEnvironment.SystemTheme, extra = null) {
    for (const scope of extras(extra)) {
        const result = scope?.TryGetResource?.(key, theme);
        if (result?.Found) return result;
    }
    const visited = new Set();
    for (let node = control; node && !visited.has(node); node = parentOf(node)) {
        visited.add(node);
        const direct = node.Resources?.TryGetResource(key, theme);
        if (direct?.Found)
            return direct;
        const style = node.Styles?.TryGetResource?.(key, theme);
        if (style?.Found)
            return style;
    }
    const app = ResourceEnvironment.Application;
    const found = app?.Resources?.TryGetResource(key, theme);
    if (found?.Found)
        return found;
    return app?.Styles?.TryGetResource?.(key, theme) ?? { Found: false, Value: UnsetValue };
}
export function FindResource(control, key, theme, extra) {
    const result = TryFindResource(control, key, theme, extra);
    if (!result.Found)
        throw new Error(`Resource '${String(key)}' was not found.`);
    return result.Value;
}
export function GetResourceObservable(control, key, extra = null) {
    return new Observable(observer => {
        const subscriptions = new CompositeDisposable();
        let stopped = false, wiring = false, rewire = false, emitting = false, emitAgain = false;
        const sentinel = {}; let last = sentinel;
        const emit = () => {
            if (stopped || observer.closed) return;
            if (emitting) { emitAgain = true; return; }
            emitting = true;
            try {
                let iterations = 0;
                do {
                    if (++iterations > 128) throw new RangeError('Resource notification reentrancy limit exceeded.');
                    emitAgain = false;
                    const value = TryFindResource(control, key, undefined, extra).Value;
                    if (last === sentinel || !Object.is(last, value)) { last = value; observer.next(value); }
                } while (emitAgain && !stopped && !observer.closed);
            } catch (error) { observer.error(error); }
            finally { emitting = false; }
        };
        const wire = () => {
            if (stopped || observer.closed) return;
            if (wiring) { rewire = true; return; }
            wiring = true;
            try {
                do {
                    rewire = false; subscriptions.Clear();
                    const seen = new Set(), events = new Set();
                    const add = (event, action) => {
                        if (event?.Add && !events.has(event)) { events.add(event); subscriptions.Add(event.Add(action)); }
                    };
                    const watch = owner => {
                        if (!owner || seen.has(owner)) return;
                        seen.add(owner);
                        add(owner.ResourcesChanged, emit);
                        add(owner.Resources?.ResourcesChanged, emit);
                        add(owner.Styles?.ResourcesChanged, emit);
                        add(owner.PropertyChanged, (_, e) => {
                            if (['ActualThemeVariant', 'RequestedThemeVariant'].includes(e.PropertyName)) emit();
                            else if (['Parent', 'TemplatedParent', 'Resources', 'Styles'].includes(e.PropertyName)) wire();
                        });
                        // Watch ancestors too: moving a whole subtree does not
                        // necessarily raise logical attach on each descendant.
                        for (const name of ['AttachedToLogicalTree', 'DetachedFromLogicalTree', 'AttachedToVisualTree', 'DetachedFromVisualTree']) add(owner[name], wire);
                    };
                    for (let node = control; node && !seen.has(node); node = parentOf(node)) watch(node);
                    watch(ResourceEnvironment.Application);
                    for (const scope of extras(extra)) watch(scope);
                    emit();
                } while (rewire && !stopped && !observer.closed);
            } catch (error) { observer.error(error); }
            finally { wiring = false; }
        };
        wire();
        return () => { stopped = true; subscriptions.Dispose(); };
    });
}
export class StaticResourceExtension {
    constructor(key = '') {
        this.ResourceKey = key;
    }
    ProvideValue(context) {
        return FindResource(context.TargetObject ?? context.RootObject, this.ResourceKey, undefined, context.Resources);
    }
}
export class DynamicResourceExtension extends StaticResourceExtension {
    BindTo(target, property, priority, extra = null, order = undefined) {
        const key = Symbol('DynamicResource');
        const subscription = GetResourceObservable(target, this.ResourceKey, extra).subscribe(value => target._SetPriorityValue(property, value, priority, key, order));
        return Disposable.Create(() => {
            subscription.unsubscribe();
            target._RemovePriorityValue(property, key);
        });
    }
    ProvideValue() {
        return this;
    }
}
