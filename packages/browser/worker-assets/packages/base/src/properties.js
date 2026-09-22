import { Observable, Subject } from "../../../vendor/rxjs.js";
import { Event, Disposable, CompositeDisposable } from './disposable.js';
import { AreValuesEqual } from './primitives.js';
export const BindingPriority = Object.freeze({ Animation: -1, LocalValue: 0, StyleTrigger: 1, Template: 2, Style: 3, Inherited: 4, Unset: 2147483647 });
export const BindingMode = Object.freeze({ Default: 'Default', OneWay: 'OneWay', TwoWay: 'TwoWay', OneTime: 'OneTime', OneWayToSource: 'OneWayToSource' });
export const UnsetValue = Object.freeze({ toString: () => '(unset)' });
export const DoNothing = Object.freeze({ toString: () => '(do nothing)' });
const localKey = Symbol('LocalValue');
let propertyId = 0, entryOrder = 0;
// Registration/metadata changes are rare and invalidate lookup caches lazily.
// Weak type keys do not retain dynamically loaded application constructors.
let registryVersion = 0;
let inheritedPropertyCache = new WeakMap();
const registeredPropertyCache = new WeakMap();
let bindingHandler = null;
export function RegisterBindingHandler(handler) {
    bindingHandler = handler;
}
export class StyledPropertyMetadata {
    constructor(defaultValue, options = {}) {
        Object.assign(this, { DefaultValue: defaultValue, DefaultBindingMode: BindingMode.OneWay, Inherits: false, AffectsMeasure: false, AffectsArrange: false, AffectsRender: true, Validate: null, Coerce: null }, options);
    }
}
export class DirectPropertyMetadata extends StyledPropertyMetadata {
}
export class AvaloniaProperty {
    static UnsetValue = UnsetValue;
    static Registry = new Map();
    constructor(owner, name, defaultValue, options = {}) {
        if (typeof owner !== 'function' || !name)
            throw new TypeError('A property requires an owner constructor and a name.');
        this.Id = ++propertyId;
        this.Name = name;
        this.OwnerType = owner;
        this.PropertyType = options.Type ?? null;
        this.IsAttached = !!options.Attached;
        this.IsDirect = false;
        this.Changed = new Subject();
        this._metadata = new Map([[owner, new StyledPropertyMetadata(defaultValue, options)]]);
        this._metadataCache = new WeakMap();
        // Coercers can depend on external state or other properties. Do not memoize
        // any value for a property with a coercer (including an inherited source).
        this._hasCoercion = !!options.Coerce;
        this._register(owner);
    }
    _register(owner) {
        let properties = AvaloniaProperty.Registry.get(owner);
        if (!properties)
            AvaloniaProperty.Registry.set(owner, properties = new Map());
        if (properties.has(this.Name) && properties.get(this.Name) !== this)
            throw new Error(`${owner.name}.${this.Name} is already registered.`);
        properties.set(this.Name, this);
        ++registryVersion;
        inheritedPropertyCache = new WeakMap();
    }
    static Register(owner, name, defaultValue = null, options = {}) {
        return new StyledProperty(owner, name, defaultValue, options);
    }
    static RegisterAttached(owner, name, defaultValue = null, options = {}) {
        return new AttachedProperty(owner, name, defaultValue, { ...options, Attached: true });
    }
    static RegisterDirect(owner, name, getter, setter = null, options = {}) {
        return new DirectProperty(owner, name, getter, setter, options);
    }
    static _RegisteredMap(type) {
        const ctor = typeof type === 'function' ? type : type.constructor;
        let cached = registeredPropertyCache.get(ctor);
        if (!cached || cached.Version !== registryVersion) {
            const properties = new Map();
            for (let t = ctor; t; t = Object.getPrototypeOf(t))
                for (const [name, property] of this.Registry.get(t) ?? [])
                    if (!properties.has(name)) properties.set(name, property);
            cached = { Version: registryVersion, Properties: properties };
            registeredPropertyCache.set(ctor, cached);
        }
        return cached.Properties;
    }
    static FindRegistered(type, name) {
        return this._RegisteredMap(type).get(name) ?? null;
    }
    static GetRegistered(type) {
        return [...this._RegisteredMap(type).values()];
    }
    static _GetInherited(type) {
        const ctor = typeof type === 'function' ? type : type.constructor;
        let properties = inheritedPropertyCache.get(ctor);
        if (!properties) {
            const unique = new Set();
            for (const map of this.Registry.values())
                for (const property of map.values())
                    if (property.GetMetadata(ctor).Inherits) unique.add(property);
            inheritedPropertyCache.set(ctor, properties = [...unique]);
        }
        return properties;
    }
    GetMetadata(type) {
        const ctor = typeof type === 'function' ? type : type.constructor;
        const cached = this._metadataCache.get(ctor);
        if (cached) return cached;
        for (let t = ctor; t; t = Object.getPrototypeOf(t)) {
            const metadata = this._metadata.get(t);
            if (metadata) { this._metadataCache.set(ctor, metadata); return metadata; }
        }
        const metadata = this._metadata.get(this.OwnerType);
        this._metadataCache.set(ctor, metadata);
        return metadata;
    }
    OverrideMetadata(owner, metadata) {
        const prior = this.GetMetadata(owner);
        const updated = Object.assign(new StyledPropertyMetadata(prior.DefaultValue), prior, metadata);
        this._metadata.set(owner, updated);
        this._hasCoercion ||= !!updated.Coerce;
        this._metadataCache = new WeakMap();
        inheritedPropertyCache = new WeakMap();
        ++registryVersion;
    }
    OverrideDefaultValue(owner, value) {
        this.OverrideMetadata(owner, { DefaultValue: value });
    }
    AddOwner(owner, metadata) {
        this._register(owner);
        if (metadata)
            this.OverrideMetadata(owner, metadata);
        return this;
    }
    toString() {
        return `${this.OwnerType.name}.${this.Name}`;
    }
}
export class StyledProperty extends AvaloniaProperty {
}
export class AttachedProperty extends StyledProperty {
}
export class DirectProperty extends AvaloniaProperty {
    constructor(owner, name, getter, setter, options) {
        super(owner, name, options.DefaultValue, options);
        this.IsDirect = true;
        this.Getter = getter;
        this.Setter = setter;
        this.IsReadOnly = !setter;
    }
}
export class AvaloniaPropertyChangedEventArgs {
    constructor(sender, property, oldValue, newValue, priority) {
        Object.assign(this, { Sender: sender, Property: property, OldValue: oldValue, NewValue: newValue, Priority: priority, IsEffectiveValueChange: true, PropertyName: property.Name });
    }
    GetOldValue() {
        return this.OldValue;
    }
    GetNewValue() {
        return this.NewValue;
    }
}
export class AvaloniaObject {
    constructor() {
        this._values = new Map();
        this._effectiveValues = new Map();
        this._effectiveEntries = new Map();
        this._valueCacheVersion = registryVersion;
        this._bindings = new Map();
        this._defaults = new Map();
        this._inheritedChildren = new Set();
        this._inheritanceParent = null;
        this.PropertyChanged = new Event();
        this._propertyChanges = new Subject();
        this._lifetime = new CompositeDisposable();
        this._changeVersion = 0;
        this.IsDisposed = false;
    }
    get InheritanceParent() {
        return this._inheritanceParent;
    }
    SetInheritanceParent(parent) {
        if (parent === this._inheritanceParent)
            return;
        for (let p = parent; p; p = p.InheritanceParent)
            if (p === this)
                throw new Error('Inheritance parent cycle.');
        const properties = AvaloniaProperty._GetInherited(this.constructor);
        const old = properties.map(property => this.GetValue(property));
        this._inheritanceParent?._inheritedChildren.delete(this);
        this._inheritanceParent = parent;
        parent?._inheritedChildren.add(this);
        for (const property of properties) {
            this._effectiveValues.delete(property);
            this._InvalidateInheritedValueCache(property);
        }
        for (let i = 0; i < properties.length; ++i)
            this._RaiseChange(properties[i], old[i], this.GetValue(properties[i]), BindingPriority.Inherited);
    }
    GetValue(property) {
        this._requireProperty(property);
        if (property.IsDirect)
            return property.Getter(this);
        if (this._valueCacheVersion !== registryVersion) {
            this._effectiveValues.clear();
            this._valueCacheVersion = registryVersion;
        }
        if (!property._hasCoercion) {
            const cached = this._effectiveValues.get(property);
            if (cached !== undefined || this._effectiveValues.has(property)) return cached;
        }
        const metadata = property.GetMetadata(this), entry = this._effectiveEntry(property);
        let value;
        if (entry)
            value = entry.Value;
        else if (metadata.Inherits && this._inheritanceParent)
            value = this._inheritanceParent.GetValue(property);
        else if (metadata.DefaultValueFactory) {
            if (!this._defaults.has(property))
                this._defaults.set(property, metadata.DefaultValueFactory(this));
            value = this._defaults.get(property);
        }
        else
            value = metadata.DefaultValue;
        if (!property._hasCoercion) this._effectiveValues.set(property, value);
        return metadata.Coerce ? metadata.Coerce(this, value) : value;
    }
    GetBaseValue(property) {
        const entry = this._effectiveEntry(property, true);
        return entry ? entry.Value : UnsetValue;
    }
    IsSet(property) {
        return !!this._values.get(property)?.size;
    }
    IsAnimating(property) {
        return [...(this._values.get(property)?.values() ?? [])].some(e => e.Priority === BindingPriority.Animation);
    }
    SetValue(property, value, priority = BindingPriority.LocalValue) {
        this._requireProperty(property);
        this._verifyAlive();
        if (property.IsDirect) {
            if (!property.Setter)
                throw new TypeError(`${property} is read-only.`);
            const old = this.GetValue(property), version = this._changeVersion;
            property.Setter(this, value);
            if (version === this._changeVersion)
                this._RaiseChange(property, old, this.GetValue(property), priority);
            return Disposable.Empty;
        }
        if (priority === BindingPriority.LocalValue) {
            const binding = this._bindings.get(property);
            if (binding) {
                this._bindings.delete(property);
                binding.Dispose();
            }
        }
        const key = priority === BindingPriority.LocalValue ? localKey : Symbol(property.Name);
        return this._SetPriorityValue(property, value, priority, key);
    }
    _SetPriorityValue(property, value, priority, key, order = undefined) {
        const old = this.GetValue(property);
        const metadata = property.GetMetadata(this);
        if (value === DoNothing)
            return Disposable.Empty;
        if (value === UnsetValue) {
            this._RemovePriorityValue(property, key);
            return Disposable.Empty;
        }
        if (metadata.Validate && !metadata.Validate(value))
            throw new RangeError(`Invalid value for ${property}: ${String(value)}`);
        let entries = this._values.get(property);
        if (!entries)
            this._values.set(property, entries = new Map());
        const entry = entries.get(key) ?? { Priority: priority, Order: ++entryOrder, Value: value };
        entry.Value = value;
        entry.Priority = priority;
        if (order !== undefined)
            entry.Order = order;
        entries.set(key, entry);
        this._effectiveEntries.delete(property);
        this._effectiveValues.delete(property);
        this._RaiseChange(property, old, this.GetValue(property), this._effectiveEntry(property)?.Priority ?? BindingPriority.Unset);
        return Disposable.Create(() => {
            if (entries.get(key) === entry)
                this._RemovePriorityValue(property, key);
        });
    }
    _RemovePriorityValue(property, key) {
        const entries = this._values.get(property);
        if (!entries?.has(key))
            return;
        const old = this.GetValue(property);
        entries.delete(key);
        this._effectiveEntries.delete(property);
        this._effectiveValues.delete(property);
        if (!entries.size)
            this._values.delete(property);
        this._RaiseChange(property, old, this.GetValue(property), this._effectiveEntry(property)?.Priority ?? BindingPriority.Unset);
    }
    SetCurrentValue(property, value) {
        const binding = this._bindings.get(property);
        if (binding?.SetCurrentValue)
            return binding.SetCurrentValue(value);
        const entry = this._effectiveEntry(property);
        const key = entry ? [...this._values.get(property)].find(([, e]) => e === entry)[0] : localKey;
        return this._SetPriorityValue(property, value, entry?.Priority ?? BindingPriority.LocalValue, key);
    }
    ClearValue(property) {
        const binding = this._bindings.get(property);
        if (binding) {
            this._bindings.delete(property);
            binding.Dispose();
        }
        this._RemovePriorityValue(property, localKey);
    }
    CoerceValue(property) {
        // Coercion changes are observable even when the stored base value is unchanged.
        const old = this._lastEffective?.get(property) ?? this.GetValue(property);
        this._RaiseChange(property, old, this.GetValue(property), this._effectiveEntry(property)?.Priority ?? BindingPriority.Unset);
    }
    SetAndRaise(property, field, value) {
        const old = this[field];
        if (AreValuesEqual(old, value))
            return false;
        this[field] = value;
        this._RaiseChange(property, old, value, BindingPriority.LocalValue);
        return true;
    }
    Bind(property, source, priority = BindingPriority.LocalValue) {
        this._verifyAlive();
        if (bindingHandler && !(source && typeof source.subscribe === 'function'))
            return bindingHandler(this, property, source, priority);
        if (!source?.subscribe)
            throw new TypeError('Binding requires an observable or a Binding.');
        if (priority === BindingPriority.LocalValue) {
            this._bindings.get(property)?.Dispose();
            this._RemovePriorityValue(property, localKey);
        }
        const key = Symbol('ObservableBinding');
        let disposed = false;
        const lifetime = new CompositeDisposable();
        const expression = {
            SetCurrentValue: value => this._SetPriorityValue(property, value, priority, key),
            Dispose: () => {
                if (disposed)
                    return;
                disposed = true;
                lifetime.Dispose();
                this._RemovePriorityValue(property, key);
                if (this._bindings.get(property) === expression)
                    this._bindings.delete(property);
            },
            unsubscribe() {
                this.Dispose();
            },
        };
        if (priority === BindingPriority.LocalValue)
            this._bindings.set(property, expression);
        this._lifetime.Add(expression);
        lifetime.Add(source.subscribe({ next: v => {
                if (!disposed)
                    expression.SetCurrentValue(v);
            }, error: e => this.OnBindingError(property, e) }));
        return expression;
    }
    GetObservable(property) {
        const owner = this;
        return new Observable(observer => {
            if (owner.IsDisposed) {
                observer.complete();
                return;
            }
            observer.next(owner.GetValue(property));
            return owner._propertyChanges.subscribe({ next: e => {
                    if (e.Property === property)
                        observer.next(e.NewValue);
                }, complete: () => observer.complete(), error: e => observer.error(e) });
        });
    }
    GetPropertyChangedObservable(property) {
        return new Observable(observer => this._propertyChanges.subscribe(e => {
            if (e.Property === property)
                observer.next(e);
        }));
    }
    GetValueStoreDiagnostic() {
        return [...this._values].map(([Property, values]) => ({ Property, EffectiveValue: this.GetValue(Property), Values: [...values.values()].map(v => ({ ...v })) }));
    }
    _effectiveEntry(property, ignoreAnimation = false) {
        if (!ignoreAnimation) {
            const cached = this._effectiveEntries.get(property);
            if (cached) return cached;
        }
        const values = this._values.get(property);
        if (!values) return null;
        let best = null;
        for (const entry of values.values()) {
            if (ignoreAnimation && entry.Priority === BindingPriority.Animation)
                continue;
            if (!best || entry.Priority < best.Priority || entry.Priority === best.Priority && entry.Order > best.Order)
                best = entry;
        }
        if (!ignoreAnimation && best) this._effectiveEntries.set(property, best);
        return best;
    }
    _InvalidateInheritedValueCache(property) {
        for (const child of this._inheritedChildren) {
            if (!child._effectiveEntry(property) && property.GetMetadata(child).Inherits) {
                child._effectiveValues.delete(property);
                child._InvalidateInheritedValueCache(property);
            }
        }
    }
    _RaiseChange(property, oldValue, newValue, priority) {
        this._lastEffective ??= new Map();
        this._lastEffective.set(property, newValue);
        if (AreValuesEqual(oldValue, newValue))
            return;
        // Invalidate before notifying the parent: synchronous handlers are
        // allowed to query descendants and must see the just-written value.
        const inherits = property.GetMetadata(this).Inherits;
        if (inherits) this._InvalidateInheritedValueCache(property);
        this._changeVersion++;
        const args = new AvaloniaPropertyChangedEventArgs(this, property, oldValue, newValue, priority);
        this.OnPropertyChanged(args);
        this.PropertyChanged.Raise(this, args);
        this._propertyChanges.next(args);
        property.Changed.next(args);
        if (inherits)
            for (const child of [...this._inheritedChildren]) {
                if (!child._effectiveEntry(property) && property.GetMetadata(child).Inherits) {
                    child._effectiveValues.delete(property);
                    child._RaiseChange(property, oldValue, child.GetValue(property), BindingPriority.Inherited);
                }
            }
    }
    OnPropertyChanged(_change) {
    }
    OnBindingError(property, error) {
        this.BindingError?.Raise(this, { Property: property, Error: error });
    }
    _requireProperty(property) {
        if (!(property instanceof AvaloniaProperty))
            throw new TypeError('Expected an AvaloniaProperty.');
    }
    _verifyAlive() {
        if (this.IsDisposed)
            throw new Error(`${this.constructor.name} has been disposed.`);
    }
    Dispose() {
        if (this.IsDisposed)
            return;
        this.IsDisposed = true;
        for (const binding of [...this._bindings.values()])
            binding.Dispose();
        this._bindings.clear();
        this._lifetime.Dispose();
        this._propertyChanges.complete();
        this.PropertyChanged.Clear();
        this._inheritanceParent?._inheritedChildren.delete(this);
        this._inheritanceParent = null;
        for (const child of [...this._inheritedChildren])
            child.SetInheritanceParent(null);
        this._inheritedChildren.clear();
        this._values.clear();
        this._effectiveValues.clear();
        this._effectiveEntries.clear();
        this._defaults.clear();
        this._lastEffective?.clear();
    }
}
/** Register PascalCase JavaScript accessors and the original FooProperty fields. */
export function DefineProperties(owner, definitions) {
    for (const [name, definition] of Object.entries(definitions)) {
        const [defaultValue, options = {}] = Array.isArray(definition) ? definition : [definition];
        const property = AvaloniaProperty.Register(owner, name, defaultValue, options);
        Object.defineProperty(owner, `${name}Property`, { value: property, enumerable: true });
        Object.defineProperty(owner.prototype, name, { enumerable: true, configurable: true, get() {
                return this.GetValue(property);
            }, set(v) {
                this.SetValue(property, options.Convert ? options.Convert(v) : v);
            } });
    }
}
export function DefineAttached(owner, name, defaultValue, options = {}) {
    const property = AvaloniaProperty.RegisterAttached(owner, name, defaultValue, options);
    owner[`${name}Property`] = property;
    owner[`Get${name}`] = target => target.GetValue(property);
    owner[`Set${name}`] = (target, value) => target.SetValue(property, options.Convert ? options.Convert(value) : value);
    return property;
}
