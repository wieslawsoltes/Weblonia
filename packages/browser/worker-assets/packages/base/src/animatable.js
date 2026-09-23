import { AvaloniaObject, AvaloniaProperty, BindingPriority, DefineProperties, UnsetValue, DoNothing } from './properties.js';
import { AvaloniaList } from './collections.js';
import { AreValuesEqual } from './primitives.js';
import { Disposable, Event } from './disposable.js';

// The base package never imports controls, media or the animation implementation.
// Loading the animation package supplies its clock, not a second scheduling loop.
let clockProvider = null, nextClockProvider = 0;
const clockProviders = new Map();
export function RegisterTransitionClockProvider(provider) {
    if (typeof provider !== 'function') throw new TypeError('A clock provider is required.');
    const id = ++nextClockProvider; clockProviders.set(id, provider); clockProvider = provider;
    return Disposable.Create(() => {
        clockProviders.delete(id); clockProvider = null;
        // Registration/removal is rare; sampling only calls the selected provider.
        // Out-of-order disposal must never resurrect an already removed service.
        for (const candidate of clockProviders.values()) clockProvider = candidate;
    });
}
export function ResolveTransitionProperty(owner, reference) {
    let property = reference;
    if (typeof reference === 'string') {
        const parts = reference.split('.');
        property = parts.length <= 2 ? AvaloniaProperty.FindRegistered(owner, parts.at(-1)) : null;
        if (parts.length === 2 && property) {
            let match = property.OwnerType.name === parts[0];
            for (let type = owner.constructor; type && !match; type = Object.getPrototypeOf(type)) match = type.name === parts[0];
            if (!match) property = null;
        }
    }
    if (!(property instanceof AvaloniaProperty) || property.IsDirect ||
        (!property.IsAttached && !AvaloniaProperty.GetRegistered(owner).includes(property)))
        throw new TypeError(`Transition requires a registered, writable styled property: '${String(reference)}'.`);
    return property;
}

/** A reusable collection of borrowed definitions. Owners validate mutations before
 * publication. Clearing is supported as an atomic removal (the JS list uses Reset).
 * Definition subscriptions are installed only while an enabled owner uses the list.
 */
export class Transitions extends AvaloniaList {
    constructor(items = []) {
        super(items); this._owners = new Set(); this._definitions = new Map();
        this._Validate(this._items);
        this.CollectionChanged.Add(() => this._RefreshDefinitions());
    }
    get Item() { return Object.freeze(this.ToArray()); }
    _Validate(items) {
        const seen = new Set();
        for (const item of items) {
            if (!item || typeof item.Apply !== 'function' || item.IsDisposed || seen.has(item))
                throw new TypeError('Transitions require distinct transition definitions.');
            if (!(item.Property instanceof AvaloniaProperty) && (typeof item.Property !== 'string' || !item.Property))
                throw new TypeError('A transition must specify its target property before insertion.');
            seen.add(item);
        }
        for (const owner of this._owners) owner._ValidateTransitions(items);
    }
    ValidateMutation(change) {
        const items = change.Action === 'Reset' ? [...change.NewItems] : [...this._items];
        if (change.Action === 'Replace') items.splice(change.NewStartingIndex, change.OldItems.length, ...change.NewItems);
        else if (change.Action === 'Add') items.splice(change.NewStartingIndex, 0, ...change.NewItems);
        this._Validate(items);
    }
    _Attach(owner) { owner._ValidateTransitions(this); this._owners.add(owner); this._RefreshDefinitions(); }
    _Detach(owner) { this._owners.delete(owner); this._RefreshDefinitions(); }
    _ValidateTarget(item, reference) {
        if (!this._items.includes(item)) return;
        for (const owner of this._owners) ResolveTransitionProperty(owner, reference);
    }
    _RefreshDefinitions() {
        const live = this._owners.size ? new Set(this._items) : new Set();
        for (const [item, subscription] of this._definitions) if (!live.has(item)) {
            subscription?.Dispose(); item._transitionCollections?.delete(this); this._definitions.delete(item);
        }
        for (const item of live) if (!this._definitions.has(item)) {
            item._transitionCollections?.add(this);
            this._definitions.set(item, item.PropertyChanged?.Add((_s, e) => {
                if (e.Property.Name === 'Property') for (const owner of [...this._owners]) owner._ReconcileTransitions();
            }) ?? null);
        }
    }
}

/** Automatic transitions observe the underlying non-animation value, even when
 * an animation currently masks it. State is allocated only for opted-in owners.
 * Re-targeting changes the animation-priority entry without exposing a temporary
 * jump to the new base value through PropertyChanged or inherited properties.
 */
export class Animatable extends AvaloniaObject {
    constructor() {
        super(); this._transitionsEnabled = true; this._transitionStates = null;
        this._transitionGuard = null; this._transitionCollection = null; this._transitionSubscription = null;
    }
    get TransitionError() { return this._transitionErrors ??= new Event(); }
    _ValidateTransitions(items) { for (const transition of items ?? []) ResolveTransitionProperty(this, transition.Property); }
    _SetPriorityValue(property, value, priority, key, order) {
        if (property === Animatable.TransitionsProperty && value !== UnsetValue && value !== DoNothing && value != null) {
            if (!(value instanceof Transitions)) throw new TypeError('Transitions must be a Transitions collection or null.');
            this._ValidateTransitions(value);
        }
        return super._SetPriorityValue(property, value, priority, key, order);
    }
    SetCurrentValue(property, value) {
        if (this._transitionStates?.get(property)?.Instance && !this._bindings.has(property)) {
            const entry = this._effectiveEntry(property, true);
            if (!entry) return this.SetValue(property, value);
            const key = [...this._values.get(property)].find(([, current]) => current === entry)[0];
            return this._SetPriorityValue(property, value, entry.Priority, key);
        }
        return super.SetCurrentValue(property, value);
    }
    _GetAnimationBaseValue(property) {
        let value = this.GetBaseValue(property);
        if (value !== UnsetValue) {
            const metadata = property.GetMetadata(this);
            return metadata.Coerce ? metadata.Coerce(this, value) : value;
        }
        if (!this.IsAnimating(property)) return this.GetValue(property);
        const metadata = property.GetMetadata(this);
        if (metadata.DefaultValueFactory && !this._defaults.has(property)) this._defaults.set(property, metadata.DefaultValueFactory(this));
        value = metadata.Inherits && this.InheritanceParent ? this.InheritanceParent.GetValue(property)
            : metadata.DefaultValueFactory ? this._defaults.get(property) : metadata.DefaultValue;
        return metadata.Coerce ? metadata.Coerce(this, value) : value;
    }
    _WatchTransitions(collection) {
        if (collection === this._transitionCollection) return;
        // Attach/validate the replacement before disconnecting the old collection.
        if (collection) collection._Attach(this);
        this._transitionSubscription?.Dispose(); this._transitionCollection?._Detach(this);
        this._transitionCollection = collection;
        this._transitionSubscription = collection?.CollectionChanged.Add(() => this._ReconcileTransitions()) ?? null;
    }
    _ReconcileTransitions() {
        if (!this._transitionsEnabled || this.IsDisposed) return;
        const definitions = this.Transitions;
        this._ValidateTransitions(definitions);
        this._WatchTransitions(definitions);
        const previous = this._transitionStates, next = new Map();
        for (const definition of definitions ?? []) {
            const property = ResolveTransitionProperty(this, definition.Property), old = previous?.get(property);
            next.set(property, old?.Definition === definition ? old : {
                Definition: definition, BaseValue: this._GetAnimationBaseValue(property), Instance: null, Epoch: 0,
            });
        }
        // Publish first: disposal can synchronously raise property notifications.
        this._transitionStates = next.size ? next : null;
        for (const [property, state] of previous ?? []) if (next.get(property) !== state) this._StopTransition(property, state);
    }
    _StopTransition(property, state) {
        const instance = state.Instance; state.Instance = null; ++state.Epoch;
        if (!instance) return;
        const old = this.GetValue(property), guards = this._transitionGuard ??= new Set(), nested = guards.has(property);
        guards.add(property);
        try { instance.Dispose(); }
        finally {
            if (!nested) {
                guards.delete(property);
                super._RaiseChange(property, old, this.GetValue(property), this._effectiveEntry(property)?.Priority ?? BindingPriority.Unset);
            }
        }
    }
    EnableTransitions() {
        if (this.IsDisposed) return;
        if (!this._transitionsEnabled) { this._transitionsEnabled = true; this._ReconcileTransitions(); }
    }
    DisableTransitions() {
        if (!this._transitionsEnabled) return;
        this._transitionsEnabled = false;
        this._WatchTransitions(null);
        const states = this._transitionStates; this._transitionStates = null;
        const errors = [];
        for (const [property, state] of states ?? []) try { this._StopTransition(property, state); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, 'Transition cleanup failed.');
    }
    _RaiseChange(property, oldValue, newValue, priority) {
        if (this._transitionGuard?.has(property)) return;
        if (property === Animatable.TransitionsProperty && this._transitionsEnabled) this._ReconcileTransitions();
        const state = this._transitionStates?.get(property);
        if (state && !property.IsDirect && !this.IsDisposed) {
            const base = this._GetAnimationBaseValue(property);
            if (!AreValuesEqual(base, state.BaseValue)) {
                state.BaseValue = base;
                const epoch = ++state.Epoch, guards = this._transitionGuard ??= new Set(); guards.add(property);
                let instance;
                try {
                    state.Instance?.Dispose(); state.Instance = null;
                    if (!AreValuesEqual(oldValue, base)) {
                        const clock = this.Clock ?? clockProvider?.();
                        if (!clock) throw new Error('An animation clock is required to run a transition.');
                        instance = state.Definition.Apply(this, clock, oldValue, base);
                        if (!instance || typeof instance.Dispose !== 'function') throw new TypeError('Transition.Apply must return a disposable instance.');
                        if (this.IsDisposed || !this._transitionsEnabled || this._transitionStates?.get(property) !== state || state.Epoch !== epoch)
                            instance.Dispose();
                        else state.Instance = instance;
                    }
                    // A user-defined Apply may synchronously change its own base.
                    // Do not hide that reentrant assignment beneath a stale animation.
                    const latest = this._GetAnimationBaseValue(property);
                    if (!AreValuesEqual(latest, base)) { state.BaseValue = latest; state.Instance?.Dispose(); state.Instance = null; }
                } catch (error) {
                    instance?.Dispose?.(); state.Instance = null;
                    this.OnBindingError(property, error);
                    this._transitionErrors?.Raise(this, { Property: property, Error: error });
                } finally { guards.delete(property); }
                newValue = this.GetValue(property);
                priority = this._effectiveEntry(property)?.Priority ?? BindingPriority.Unset;
            }
        }
        super._RaiseChange(property, oldValue, newValue, priority);
    }
    TryGetTransitionInstance(transition) {
        for (const state of this._transitionStates?.values() ?? [])
            if (state.Definition === transition && !state.Instance?.IsDisposed) return state.Instance;
        return null;
    }
    Dispose() {
        if (this.IsDisposed) return;
        try { this.DisableTransitions(); }
        finally { this._transitionGuard?.clear(); this._transitionErrors?.Clear(); super.Dispose(); }
    }
}
DefineProperties(Animatable, {
    Transitions: [null, { AffectsRender: false, Validate: value => value == null || value instanceof Transitions }],
    Clock: [null, { Inherits: true, AffectsRender: false, Validate: value => value == null || typeof value.Now === 'function' && typeof value.Subscribe === 'function' }],
});
