import { FormatComposite } from './formatting.js';
export { StringFormatValueConverter, StringFormatMultiValueConverter } from './formatting.js';
import { AvaloniaObject, AvaloniaProperty, DefineProperties, BindingPriority, BindingMode, UnsetValue, DoNothing, CompositeDisposable, Disposable, Event, RegisterBindingHandler, AreValuesEqual, } from "../../base/src/index.js";
import { Observable } from "../../../vendor/rxjs.js";
export { BindingMode, BindingPriority };
export const UpdateSourceTrigger = Object.freeze({ Default: 'Default', PropertyChanged: 'PropertyChanged', LostFocus: 'LostFocus', Explicit: 'Explicit' });
export const BindingErrorType = Object.freeze({ None: 'None', Error: 'Error', DataValidationError: 'DataValidationError' });
export class BindingNotification {
    constructor(value = UnsetValue, errorType = 'None', fallbackValue = UnsetValue) {
        this.ErrorType = errorType;
        this.Error = errorType === 'None' ? null : value;
        this.Value = errorType === 'None' ? value : fallbackValue;
        this.HasValue = this.Value !== UnsetValue;
    }
    get HasError() {
        return this.Error != null;
    }
    SetValue(value) {
        this.Value = value;
        this.HasValue = value !== UnsetValue;
    }
}
export class RelativeSource {
    constructor(mode = 'Self') {
        this.Mode = mode;
        this.AncestorType = null;
        this.AncestorLevel = 1;
        this.Tree = 'Visual';
    }
}
export class BindingBase {
    constructor() {
        this.Mode = BindingMode.Default;
        this.Priority = BindingPriority.LocalValue;
        this.FallbackValue = UnsetValue;
        this.TargetNullValue = UnsetValue;
        this.Converter = null;
        this.ConverterParameter = null;
        this.StringFormat = null;
        this.UpdateSourceTrigger = 'Default';
    }
}
export class Binding extends BindingBase {
    constructor(path = '', mode = BindingMode.Default) {
        super();
        this.Path = '';
        this.Source = UnsetValue;
        this.ElementName = null;
        this.RelativeSource = null;
        this.ConverterCulture = undefined;
        this.EnableDataValidation = true;
        if (path && typeof path === 'object')
            Object.assign(this, path);
        else {
            this.Path = String(path ?? '');
            this.Mode = mode;
        }
    }
}
export class ReflectionBindingExtension extends Binding {
}
export class CompiledBindingExtension extends Binding {
    constructor(path = '', mode = BindingMode.Default) {
        super(path instanceof CompiledBindingPath ? '' : path, mode);
        if (path instanceof CompiledBindingPath) this.Path = path;
        this.IsCompiled = true;
    }
}
export class TemplateBinding extends Binding {
    constructor(property = '') {
        super(typeof property === 'string' ? property : property.Name);
        this.RelativeSource = new RelativeSource('TemplatedParent');
    }
}
export class MultiBinding extends BindingBase {
    constructor(bindings = [], converter = null) {
        super();
        this.Bindings = Array.from(bindings);
        this.Converter = converter;
        this.Mode = BindingMode.OneWay;
        this.ConverterCulture = undefined;
        this.RelativeSource = null;
    }
}
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export class PropertyPath {
    constructor(path = '') {
        this.Path = String(path);
        this.Segments = PropertyPath.Parse(this.Path);
    }
    static Parse(path) {
        const s = String(path ?? '').trim();
        if (!s || s === '.')
            return [];
        const result = [];
        let i = 0;
        while (i < s.length) {
            if (s[i] === '.') {
                i++;
                continue;
            }
            if (s[i] === '[') {
                i++;
                while (/\s/.test(s[i] ?? '') && i < s.length)
                    i++;
                let value = '', quote = s[i] === '"' || s[i] === "'" ? s[i++] : null;
                if (quote) {
                    while (i < s.length && s[i] !== quote) {
                        if (s[i] === '\\')
                            i++;
                        value += s[i++];
                    }
                    if (s[i++] !== quote)
                        throw new SyntaxError('Unterminated indexer string.');
                    while (/\s/.test(s[i] ?? '') && i < s.length)
                        i++;
                }
                else {
                    while (i < s.length && s[i] !== ']')
                        value += s[i++];
                    value = value.trim();
                }
                if (s[i++] !== ']')
                    throw new SyntaxError('Unterminated indexer.');
                if (forbidden.has(value))
                    throw new SyntaxError('Unsafe binding member.');
                result.push({ Kind: 'Indexer', Name: !quote && /^-?\d+$/.test(value) ? Number(value) : value });
                continue;
            }
            if (s[i] === '(') {
                const end = s.indexOf(')', i + 1);
                if (end < 0)
                    throw new SyntaxError('Unterminated attached property.');
                const value = s.slice(i + 1, end), split = value.lastIndexOf('.');
                if (split < 0)
                    throw new SyntaxError('Attached paths require Owner.Property.');
                result.push({ Kind: 'Attached', Owner: value.slice(0, split), Name: value.slice(split + 1) });
                i = end + 1;
                continue;
            }
            const match = /^[\p{L}_$][\p{L}\p{N}_$]*/u.exec(s.slice(i));
            if (!match)
                throw new SyntaxError(`Invalid binding path near '${s.slice(i)}'.`);
            if (forbidden.has(match[0]))
                throw new SyntaxError('Unsafe binding member.');
            result.push({ Kind: 'Property', Name: match[0] });
            i += match[0].length;
            if (i < s.length && !'.[('.includes(s[i]))
                throw new SyntaxError(`Invalid binding path near '${s.slice(i)}'.`);
        }
        return result;
    }
}
export const BindingRuntime = {
    ResolveType(name) {
        const simple = String(name).split(':').at(-1).split('.').at(-1);
        return [...AvaloniaProperty.Registry.keys()].find(t => t.name === simple) ?? null;
    },
    ResolveName(anchor, name) {
        return anchor.FindControl?.(name) ?? anchor.GetNameScope?.()?.Find(name) ?? null;
    },
};
function attachedProperty(segment) {
    const owner = BindingRuntime.ResolveType(segment.Owner);
    return owner ? AvaloniaProperty.FindRegistered(owner, segment.Name) : null;
}
export function ReadMember(object, segment) {
    if (object == null || object === UnsetValue)
        return UnsetValue;
    if (segment.Kind === 'Attached') {
        const property = attachedProperty(segment);
        return property && object.GetValue ? object.GetValue(property) : UnsetValue;
    }
    const key = segment.Name;
    if (segment.Kind === 'Indexer')
        return object instanceof Map ? object.has(key) ? object.get(key) : UnsetValue : object.Get ? object.Get(key) ?? UnsetValue : key in Object(object) ? object[key] : UnsetValue;
    if (key === 'Count' && Array.isArray(object))
        return object.length;
    return key in Object(object) ? object[key] : object instanceof Map && object.has(key) ? object.get(key) : UnsetValue;
}
export function WriteMember(object, segment, value) {
    if (object == null || object === UnsetValue)
        throw new Error('The binding source is null.');
    if (forbidden.has(String(segment.Name)))
        throw new Error('Unsafe binding assignment.');
    if (segment.Kind === 'Attached') {
        const property = attachedProperty(segment);
        if (!property)
            throw new Error(`Unknown attached property ${segment.Owner}.${segment.Name}.`);
        object.SetCurrentValue(property, value);
        return;
    }
    const key = segment.Name;
    if (object instanceof Map) {
        object.set(key, value);
        return;
    }
    if (segment.Kind === 'Indexer' && object.Set) {
        object.Set(key, value);
        return;
    }
    if (!Reflect.set(object, key, value))
        throw new TypeError(`Binding member '${String(key)}' is read-only.`);
}
function observeMember(object, segment, callback) {
    if (object == null || object === UnsetValue)
        return Disposable.Empty;
    if (object instanceof AvaloniaObject) {
        const property = segment.Kind === 'Attached' ? attachedProperty(segment) : AvaloniaProperty.FindRegistered(object, segment.Name);
        if (property)
            return object.GetPropertyChangedObservable(property).subscribe(callback);
    }
    const lifetime = new CompositeDisposable();
    const changed = object.PropertyChanged ?? object.Changed;
    const handle = e => {
        const name = e?.PropertyName ?? e?.propertyName ?? e?.Property?.Name;
        if (!name || name === segment.Name || name === 'Item[]' || segment.Kind === 'Indexer' && name === 'Count')
            callback();
    };
    if (changed?.Add)
        lifetime.Add(changed.Add((_, args) => handle(args)));
    else if (changed?.subscribe)
        lifetime.Add(changed.subscribe(handle));
    if (object.CollectionChanged?.Add)
        lifetime.Add(object.CollectionChanged.Add(callback));
    return lifetime;
}
function sourceRoot(anchor, binding, path) {
    let root, remaining = String(path ?? '').trim(), negate = false;
    while (remaining.startsWith('!')) {
        negate = !negate;
        remaining = remaining.slice(1);
    }
    if (binding.Source !== UnsetValue)
        root = binding.Source;
    else if (binding.ElementName)
        root = BindingRuntime.ResolveName(anchor, binding.ElementName);
    else if (remaining.startsWith('#')) {
        const m = /^#([^.[\s]+)(?:\.)?(.*)$/.exec(remaining);
        if (!m)
            throw new SyntaxError('Invalid element-name binding.');
        root = BindingRuntime.ResolveName(anchor, m[1]);
        remaining = m[2];
    }
    else if (binding.RelativeSource?.Mode === 'Self' || remaining === '$self' || remaining.startsWith('$self.')) {
        root = anchor;
        remaining = remaining.replace(/^\$self\.?/, '');
    }
    else if (binding.RelativeSource?.Mode === 'TemplatedParent')
        root = anchor.TemplatedParent;
    else if (binding.RelativeSource?.Mode === 'FindAncestor' || remaining.startsWith('$parent')) {
        const m = /^\$parent(?:\[([^\]]+)\])?\.?/.exec(remaining);
        let type = binding.RelativeSource?.AncestorType, level = binding.RelativeSource?.AncestorLevel ?? 1;
        if (m) {
            remaining = remaining.slice(m[0].length);
            if (m[1]) {
                const a = m[1].split(';');
                type = /^\d+$/.test(a[0]) ? null : a[0];
                level = /^\d+$/.test(a[0]) ? Number(a[0]) + 1 : Number(a[1] ?? 1);
            }
        }
        let parent = binding.RelativeSource?.Tree === 'Logical' ? anchor.Parent : anchor.VisualParent ?? anchor.Parent;
        const ctor = typeof type === 'function' ? type : type ? BindingRuntime.ResolveType(type) : null;
        while (parent) {
            if ((!type || ctor && parent instanceof ctor || parent.constructor.name === String(type).split(':').at(-1)) && --level <= 0)
                break;
            parent = parent.VisualParent ?? parent.Parent;
        }
        root = parent;
    }
    else
        root = anchor.DataContext;
    return { Root: root, Path: remaining, Negate: negate };
}
export class BindingExpression {
    constructor(target, property, binding, priority = binding.Priority) {
        if (!(target instanceof AvaloniaObject) || target.IsDisposed) throw new TypeError('A live binding target is required.');
        if (binding.Converter != null && typeof binding.Converter !== 'function' && typeof binding.Converter.Convert !== 'function')
            throw new TypeError('Invalid binding converter.');
        if (binding.StringFormat != null && typeof binding.StringFormat !== 'string') throw new TypeError('Binding.StringFormat must be a string.');
        if (!Object.values(BindingMode).includes(binding.Mode)) throw new TypeError('Unsupported binding mode.');
        if (!Object.values(UpdateSourceTrigger).includes(binding.UpdateSourceTrigger)) throw new TypeError('Unsupported source update trigger.');
        // Parse before Attach clears/replaces a target binding. Missing source
        // values remain recoverable; unsafe or malformed path syntax does not.
        if (!(binding instanceof CompiledBindingExtension)) PropertyPath.Parse(sourceRoot({ DataContext: null }, binding, binding.Path).Path);
        this.Target = target;
        this.TargetProperty = property;
        this.ParentBinding = binding;
        this.Priority = priority;
        this.Mode = binding.Mode === 'Default' ? property.GetMetadata(target).DefaultBindingMode : binding.Mode;
        this._anchor = binding.Anchor ?? target.BindingAnchor ?? target;
        this._key = Symbol('Binding');
        this._lifetime = new CompositeDisposable();
        this._sourceLifetime = new CompositeDisposable();
        this.IsDisposed = false;
        this._rewiring = false;
        this._pendingRewire = false;
        this._updatingTarget = false;
        this._updatingSource = false;
        this._oneTimeDone = false;
    }
    Attach() {
        const initialTargetValue = this.Mode === 'OneWayToSource' ? this.Target.GetValue(this.TargetProperty) : UnsetValue;
        if (this.Priority === BindingPriority.LocalValue) {
            this.Target.ClearValue(this.TargetProperty);
            this.Target._bindings.set(this.TargetProperty, this);
        }
        this.Target._lifetime.Add(this);
        this._lifetime.Add(this._sourceLifetime);
        const anchor = this._anchor;
        if (anchor?.PropertyChanged?.Add)
            this._lifetime.Add(anchor.PropertyChanged.Add((_, e) => {
                if (['DataContext', 'TemplatedParent', 'Parent'].includes(e.PropertyName))
                    this.UpdateTarget();
            }));
        if (anchor?.AttachedToVisualTree?.Add)
            this._lifetime.Add(anchor.AttachedToVisualTree.Add(() => this.UpdateTarget()));
        if (anchor?.GetNameScope?.()?.Changed?.Add)
            this._lifetime.Add(anchor.GetNameScope().Changed.Add(() => this.UpdateTarget()));
        if (this.Mode === 'TwoWay' || this.Mode === 'OneWayToSource') {
            this._lifetime.Add(this.Target.GetPropertyChangedObservable(this.TargetProperty).subscribe(e => {
                if (this._updatingTarget || this.IsDisposed || this.Target._effectiveEntry(this.TargetProperty) !== this.Target._values.get(this.TargetProperty)?.get(this._key))
                    return;
                const trigger = this.ParentBinding.UpdateSourceTrigger;
                if (trigger === 'Explicit' || trigger === 'LostFocus')
                    this._pendingSource = e.NewValue;
                else
                    this.UpdateSource(e.NewValue);
            }));
            if (this.ParentBinding.UpdateSourceTrigger === 'LostFocus' && this.Target.LostFocus?.Add)
                this._lifetime.Add(this.Target.LostFocus.Add(() => this.UpdateSource(this.Target.GetValue(this.TargetProperty))));
        }
        if (this.Mode === 'OneWayToSource' && !this.TargetProperty.IsDirect) this._setTarget(initialTargetValue);
        this.UpdateTarget();
        if (this.Mode === 'OneWayToSource')
            this.UpdateSource(this.Target.GetValue(this.TargetProperty));
        return this;
    }
    UpdateTarget() {
        if (this.IsDisposed || this._oneTimeDone || this._updatingSource)
            return;
        if (this._rewiring) {
            this._pendingRewire = true;
            return;
        }
        this._rewiring = true;
        try {
            let passes = 0;
            do {
                if (++passes > 128) throw new Error('Binding did not stabilize after 128 updates.');
                this._pendingRewire = false;
                this._sourceLifetime.Clear();
                const binding = this.ParentBinding, resolved = sourceRoot(this._anchor, binding, binding.Path);
                this._negate = resolved.Negate;
                const segments = PropertyPath.Parse(resolved.Path);
                this._segments = segments;
                let current = resolved.Root;
                this._sourceParent = null;
                this._sourceMember = null;
                for (const segment of segments) {
                    this._sourceLifetime.Add(observeMember(current, segment, () => this.UpdateTarget()));
                    this._sourceParent = current;
                    this._sourceMember = segment;
                    current = ReadMember(current, segment);
                }
                const success = this.Mode !== 'OneWayToSource' && this._publish(current);
                if (this.Mode === 'OneTime' && success && !this.IsDisposed) {
                    this._oneTimeDone = true;
                    this._lifetime.Clear();
                }
            } while (this._pendingRewire && !this.IsDisposed && !this._oneTimeDone);
        }
        catch (error) {
            this._pendingRewire = false;
            this._Failure(error);
        }
        finally {
            this._rewiring = false;
        }
    }
    /** Converter -> null substitution -> display formatting -> target conversion ->
     * fallback, in that order. Literal fallback/null replacements never re-enter
     * the user converter or StringFormat. Reflected and compiled paths share this
     * publication boundary; DoNothing preserves both target and validation state. */
    _publish(value, error = null) {
        if (this.IsDisposed || this.Target.IsDisposed) return false;
        const b = this.ParentBinding;
        try {
            if (value instanceof BindingNotification) {
                if (value.HasError) error = value.Error;
                value = value.Value;
            }
            if (value !== UnsetValue && value !== DoNothing) {
                if (this._negate) value = !value;
                // Preserve the established JS function(value, parameter) adapter;
                // IValueConverter objects receive the full Avalonia signature.
                if (b.Converter) value = typeof b.Converter === 'function'
                    ? b.Converter(value, b.ConverterParameter)
                    : b.Converter.Convert(value, this.TargetProperty.PropertyType, b.ConverterParameter, b.ConverterCulture);
                if (value instanceof BindingNotification) {
                    if (value.HasError) error = value.Error;
                    value = value.Value;
                }
            }
            if (this.IsDisposed || this.Target.IsDisposed || value === DoNothing) return false;
            const nullReplacement = value == null && b.TargetNullValue !== UnsetValue;
            if (nullReplacement) value = b.TargetNullValue;
            const type = this.TargetProperty.PropertyType;
            if (value !== UnsetValue && value !== DoNothing && !nullReplacement &&
                b.StringFormat?.trim() && (type == null || type === String || type === Object)) {
                const format = b.StringFormat.includes('{') ? b.StringFormat : `{0:${b.StringFormat}}`;
                value = FormatComposite(format, [value], b.ConverterCulture);
            }
            if (this.IsDisposed || this.Target.IsDisposed || value === DoNothing) return false;
            value = this._ConvertTargetValue(value);
            const success = value !== UnsetValue && value !== DoNothing && !error;
            if (value === UnsetValue) value = this._ConvertTargetValue(b.FallbackValue);
            if (this.IsDisposed || this.Target.IsDisposed || value === DoNothing) return false;
            this._setTarget(value, true);
            this._error(error);
            return success && !this.IsDisposed;
        } catch (failure) {
            this._Failure(error ? new AggregateError([error, failure], 'Binding source and conversion failed.') : failure);
            return false;
        }
    }
    _ConvertTargetValue(value) {
        if (value === UnsetValue || value === DoNothing || this.IsDisposed || this.Target.IsDisposed) return value;
        const metadata = this.TargetProperty.GetMetadata(this.Target);
        const updatingTarget = this._updatingTarget;
        this._updatingTarget = true;
        try { return metadata.Convert ? metadata.Convert(value) : value; }
        finally { this._updatingTarget = updatingTarget; }
    }
    _Failure(error) {
        if (this.IsDisposed || this.Target.IsDisposed) return;
        try { this._setTarget(this.ParentBinding.FallbackValue); }
        catch (fallbackError) {
            error = new AggregateError([error, fallbackError], 'Binding conversion and fallback failed.');
            this._setTarget(UnsetValue, true);
        }
        this._error(error);
    }
    _setTarget(value, converted = false) {
        if (this.IsDisposed || this.Target.IsDisposed) return;
        this._updatingTarget = true;
        try {
            if (value === DoNothing)
                return;
            if (!converted && value !== UnsetValue) {
                const metadata = this.TargetProperty.GetMetadata(this.Target);
                if (metadata.Convert) value = metadata.Convert(value);
            }
            // Metadata converters are application code and can replace this binding.
            if (this.IsDisposed || this.Target.IsDisposed || value === DoNothing) return;
            if (this.TargetProperty.IsDirect) {
                if (value !== UnsetValue)
                    this.Target.SetValue(this.TargetProperty, value);
            }
            else
                this.Target._SetPriorityValue(this.TargetProperty, value, this.Priority, this._key);
        }
        finally {
            this._updatingTarget = false;
        }
    }
    SetCurrentValue(value) {
        if (this.IsDisposed || this.Target.IsDisposed) return;
        if (this.TargetProperty.IsDirect)
            this.Target.SetValue(this.TargetProperty, value);
        else
            this.Target._SetPriorityValue(this.TargetProperty, value, this.Priority, this._key);
    }
    UpdateSource(value = this.Target.GetValue(this.TargetProperty)) {
        if (this.IsDisposed || this._updatingTarget || this._updatingSource || !this._sourceMember)
            return;
        this._updatingSource = true;
        try {
            const b = this.ParentBinding;
            if (b.Converter) {
                if (typeof b.Converter.ConvertBack !== 'function')
                    throw new Error('TwoWay binding requires Converter.ConvertBack.');
                value = b.Converter.ConvertBack(value, null, b.ConverterParameter, b.ConverterCulture);
            }
            if (this._negate)
                value = !value;
            if (value !== UnsetValue && value !== DoNothing)
                WriteMember(this._sourceParent, this._sourceMember, value);
            this._error(null);
        }
        catch (error) {
            this._error(error);
        }
        finally {
            this._updatingSource = false;
        }
    }
    _error(error) {
        if (!this.IsDisposed && !this.Target.IsDisposed)
            BindingOperations.SetValidationError(this.Target, this.TargetProperty, error);
    }
    Dispose() {
        if (this.IsDisposed) return;
        this.IsDisposed = true;
        try { this._lifetime.Dispose(); }
        finally {
            try {
                if (this.Target._bindings.get(this.TargetProperty) === this)
                    this.Target._bindings.delete(this.TargetProperty);
                this.Target._RemovePriorityValue(this.TargetProperty, this._key);
                if (!this.Target._bindings.has(this.TargetProperty))
                    BindingOperations.SetValidationError(this.Target, this.TargetProperty, null);
            } finally { this.Target._lifetime.Remove(this); }
        }
    }
    unsubscribe() {
        this.Dispose();
    }
}
/** Immutable executable binding paths. Getter delegates are resolved once, not per notification. */
export class CompiledBindingPath {
    constructor(elements = [], options = {}) {
        this.Elements = Object.freeze(Array.from(elements, element => Object.freeze({ ...element })));
        this.Root = options.Root ?? null;
        this.Expression = options.Expression ?? null;
        this.Negate = !!options.Negate;
        Object.freeze(this);
    }
    static Parse(expression = '') {
        expression = String(expression);
        const parsed = sourceRoot({}, new Binding(), expression);
        const builder = new CompiledBindingPathBuilder();
        let start = 0, depth = 0, quote = null;
        const source = parsed.Path;
        const append = text => {
            for (const segment of PropertyPath.Parse(text)) builder._elements.push(executableMember(segment));
        };
        // A caret outside an indexer/quoted string unwraps an observable or Promise.
        for (let i = 0; i < source.length; ++i) {
            const ch = source[i];
            if (quote) { if (ch === '\\') ++i; else if (ch === quote) quote = null; continue; }
            if (ch === '"' || ch === "'") { quote = ch; continue; }
            if (ch === '[' || ch === '(') ++depth;
            if (ch === ']' || ch === ')') --depth;
            if (ch === '^' && depth === 0) {
                append(source.slice(start, i)); builder._elements.push({ Kind: 'Stream' }); start = i + 1;
            }
        }
        append(source.slice(start));
        return new CompiledBindingPath(builder._elements, { Expression: expression });
    }
    ToString() { return this.Expression ?? this.Elements.map(e => e.Name ?? (e.Kind.startsWith('Stream') ? '^' : '')).join('.'); }
    toString() { return this.ToString(); }
}
function checkedName(name) {
    if (typeof name !== 'string' && typeof name !== 'number') throw new TypeError('A property/indexer name is required.');
    if (forbidden.has(String(name))) throw new TypeError('Unsafe compiled binding member.');
    return name;
}
function executableMember(segment) {
    checkedName(segment.Name);
    if (segment.Kind === 'Attached') {
        const property = attachedProperty(segment);
        if (!property) throw new TypeError(`Unknown attached property ${segment.Owner}.${segment.Name}.`);
        return { ...segment, Get: source => source == null || source === UnsetValue ? UnsetValue : source.GetValue(property),
            Set: (source, value) => source.SetCurrentValue(property, value), Observe: (source, changed) => observeMember(source, segment, changed) };
    }
    return { ...segment, Get: source => ReadMember(source, segment), Set: (source, value) => WriteMember(source, segment, value),
        Observe: (source, changed) => observeMember(source, segment, changed) };
}
export class CompiledBindingPathBuilder {
    constructor() { this._elements = []; this._root = null; this._negate = false; }
    Property(info, accessorFactory = null, acceptsNull = false) {
        const name = checkedName(typeof info === 'string' ? info : info?.Name);
        const segment = { Kind: 'Property', Name: name };
        let element = executableMember(segment);
        if (info instanceof AvaloniaProperty) {
            element.Get = source => source.GetValue(info);
            element.Set = (source, value) => source.SetCurrentValue(info, value);
            element.Observe = (source, changed) => source.GetPropertyChangedObservable(info).subscribe(changed);
        } else if (typeof info === 'object') {
            if (typeof info.Get === 'function') element.Get = source => info.Get(source);
            else if (typeof info.GetValue === 'function') element.Get = source => info.GetValue(source);
            if (typeof info.Set === 'function') element.Set = (source, value) => info.Set(source, value);
            else if (typeof info.SetValue === 'function') element.Set = (source, value) => info.SetValue(source, value);
            else if (info.CanWrite === false) element.Set = null;
            if (typeof info.Observe === 'function') element.Observe = (source, changed) => info.Observe(source, changed);
        }
        if (accessorFactory && typeof accessorFactory !== 'function') throw new TypeError('Accessor factory must be callable.');
        this._elements.push({ ...element, Info: info, AccessorFactory: accessorFactory, AcceptsNull: acceptsNull }); return this;
    }
    ArrayElement(indices, elementType = null) {
        if (!Array.isArray(indices) || !indices.length || !indices.every(Number.isInteger)) throw new TypeError('ArrayElement requires integer indices.');
        for (const index of indices) this._elements.push({ ...executableMember({ Kind: 'Indexer', Name: index }), ElementType: elementType });
        return this;
    }
    Not() { this._negate = !this._negate; return this; }
    TypeCast(type) {
        if (typeof type !== 'function') throw new TypeError('TypeCast requires a constructor.');
        this._elements.push({ Kind: 'TypeCast', Get: value => {
            if (value == null || value === UnsetValue) return value;
            const valid = type === Number ? typeof value === 'number' : type === String ? typeof value === 'string' : type === Boolean ? typeof value === 'boolean' : value instanceof type;
            if (!valid) throw new TypeError(`Binding value is not a ${type.name}.`);
            return value;
        } }); return this;
    }
    StreamTask() { this._elements.push({ Kind: 'StreamTask' }); return this; }
    StreamObservable() { this._elements.push({ Kind: 'StreamObservable' }); return this; }
    _SetRoot(root) { if (this._root || this._elements.length) throw new Error('A compiled binding root must be specified first and only once.'); this._root = Object.freeze(root); return this; }
    Self() { return this._SetRoot({ Kind: 'Self' }); }
    TemplatedParent() { return this._SetRoot({ Kind: 'TemplatedParent' }); }
    ElementName(nameScope, name) { return this._SetRoot({ Kind: 'ElementName', NameScope: nameScope, Name: checkedName(name) }); }
    Ancestor(type, level = 1) { return this._Ancestor(type, level, 'Logical'); }
    VisualAncestor(type, level = 1) { return this._Ancestor(type, level, 'Visual'); }
    _Ancestor(type, level, tree) {
        if (!Number.isInteger(level) || level < 1) throw new RangeError('Ancestor level must be positive.');
        return this._SetRoot({ Kind: 'Ancestor', Type: type, Level: level, Tree: tree });
    }
    Method(method, delegateType = null, acceptsNull = false) {
        if (typeof method !== 'function' && typeof method !== 'string') throw new TypeError('Method requires a function or safe member name.');
        if (typeof method === 'string') checkedName(method);
        this._elements.push({ Kind: 'Method', Name: typeof method === 'string' ? method : method.name, AcceptsNull: acceptsNull,
            CreateValue: source => { const fn = typeof method === 'function' ? method : source[method]; if (typeof fn !== 'function') throw new TypeError('Binding method is not callable.'); return fn.bind(source); } }); return this;
    }
    Command(methodName, executeHelper, canExecuteHelper = null, dependsOnProperties = []) {
        checkedName(methodName); if (typeof executeHelper !== 'function') throw new TypeError('Command requires an execute delegate.');
        if (canExecuteHelper && typeof canExecuteHelper !== 'function') throw new TypeError('CanExecute must be callable.');
        this._elements.push({ Kind: 'Command', Name: methodName, Dependencies: Array.from(dependsOnProperties ?? [], checkedName),
            CreateValue: source => ({ CanExecuteChanged: new Event(), CanExecute: parameter => !canExecuteHelper || !!canExecuteHelper(source, parameter),
                Execute(parameter) { return this.CanExecute(parameter) ? executeHelper(source, parameter) : undefined; } }) }); return this;
    }
    Build() { return new CompiledBindingPath(this._elements, { Root: this._root, Negate: this._negate }); }
}

export class CompiledBindingExpression extends BindingExpression {
    constructor(target, property, binding, priority = binding.Priority) {
        super(target, property, binding, priority);
        this.CompiledPath = binding.Path instanceof CompiledBindingPath ? binding.Path : binding.CompiledPath instanceof CompiledBindingPath ? binding.CompiledPath : CompiledBindingPath.Parse(binding.Path);
        this._nodes = []; this._pendingIndex = Infinity; this._processing = false;
        this.Diagnostics = { Reads: 0, Subscriptions: 0, RewiredNodes: 0, StreamValues: 0 };
        this._lifetime.Add(Disposable.Create(() => this._DropNodes(0)));
        const scope = this.CompiledPath.Root?.NameScope;
        if (scope?.Changed?.Add) this._lifetime.Add(scope.Changed.Add(() => this.UpdateTarget()));
    }
    _ResolveRoot() {
        const path = this.CompiledPath, b = this.ParentBinding, root = path.Root;
        const resolved = sourceRoot(this._anchor, b, path.Expression ?? '');
        this._negate = resolved.Negate !== path.Negate;
        if (!root) return resolved.Root;
        if (root.Kind === 'Self') return this._anchor;
        if (root.Kind === 'TemplatedParent') return this._anchor.TemplatedParent;
        if (root.Kind === 'ElementName') return root.NameScope?.Find(root.Name) ?? BindingRuntime.ResolveName(this._anchor, root.Name);
        let node = root.Tree === 'Logical' ? this._anchor.Parent : this._anchor.VisualParent;
        let remaining = root.Level;
        while (node) {
            if ((!root.Type || node instanceof root.Type) && --remaining === 0) return node;
            node = root.Tree === 'Logical' ? node.Parent : node.VisualParent;
        }
        return null;
    }
    UpdateTarget() {
        if (this.IsDisposed || this._oneTimeDone) return;
        this._root = this._ResolveRoot(); this._QueueRefresh(0);
    }
    _DropNodes(index) {
        const dropped = this._nodes.splice(index);
        for (const node of dropped) { node.Dead = true; node.Lifetime.Dispose(); node.Value?.CanExecuteChanged?.Clear?.(); }
    }
    _QueueRefresh(index) {
        if (this.IsDisposed || this._oneTimeDone) return;
        this._pendingIndex = Math.min(this._pendingIndex, index);
        if (!this._processing && !this._updatingSource) this._Drain();
    }
    _CreateNode(index, input, element) {
        const node = { Input: input, Output: UnsetValue, Element: element, Lifetime: new CompositeDisposable(), Dead: false, Error: null };
        this._nodes[index] = node; ++this.Diagnostics.RewiredNodes;
        if (input == null || input === UnsetValue) return node;
        const changed = () => { if (!node.Dead) this._QueueRefresh(index); };
        if (element.Kind.startsWith('Stream')) {
            const next = value => {
                if (node.Dead || this.IsDisposed) return;
                ++this.Diagnostics.StreamValues; node.Output = value; node.Error = null; this._QueueRefresh(index + 1);
            };
            const error = value => { if (!node.Dead && !this.IsDisposed) { node.Output = UnsetValue; node.Error = value instanceof Error ? value : new Error(String(value)); this._QueueRefresh(index + 1); } };
            if (typeof input.subscribe === 'function' && element.Kind !== 'StreamTask') node.Lifetime.Add(input.subscribe({ next, error }));
            else if (typeof input.then === 'function' && element.Kind !== 'StreamObservable') Promise.resolve(input).then(next, error);
            else throw new TypeError(`${element.Kind} requires a compatible observable or Promise.`);
            ++this.Diagnostics.Subscriptions;
        } else if (element.AccessorFactory) {
            const accessor = element.AccessorFactory(new WeakRef(Object(input)), element.Info);
            if (!accessor || typeof accessor.Subscribe !== 'function') throw new TypeError('A compiled accessor requires Subscribe(observer).');
            node.Accessor = accessor;
            node.Lifetime.Add(accessor);
            node.Lifetime.Add(accessor.Subscribe({ OnNext: value => { node.AccessorValue = value; node.Error = null; changed(); }, OnError: error => { node.Error = error; changed(); }, OnCompleted() {}, next: value => { node.AccessorValue = value; node.Error = null; changed(); } }));
            ++this.Diagnostics.Subscriptions;
        } else if (element.CreateValue) {
            node.Value = element.CreateValue(input); node.Output = node.Value;
            for (const name of element.Dependencies ?? []) node.Lifetime.Add(observeMember(input, { Kind: 'Property', Name: name }, () => node.Value.CanExecuteChanged.Raise(node.Value, {})));
        } else if (element.Observe) {
            node.Lifetime.Add(element.Observe(input, changed)); ++this.Diagnostics.Subscriptions;
        }
        return node;
    }
    _Drain() {
        if (this._processing || this.IsDisposed) return;
        this._processing = true;
        try {
            let passes = 0;
            while (this._pendingIndex !== Infinity && !this.IsDisposed && !this._oneTimeDone) {
                if (++passes > 128) { this._pendingIndex = Infinity; throw new Error('Compiled binding did not stabilize after 128 updates.'); }
                const start = this._pendingIndex; this._pendingIndex = Infinity;
                const elements = this.CompiledPath.Elements;
                for (let i = start; i < elements.length; ++i) {
                    const input = i ? (this._nodes[i - 1] ? this._nodes[i - 1].Output : UnsetValue) : this._root;
                    let node = this._nodes[i];
                    if (!node || !Object.is(node.Input, input)) { this._DropNodes(i); node = this._CreateNode(i, input, elements[i]); }
                    if (node.Input == null || node.Input === UnsetValue) node.Output = node.Element.AcceptsNull && node.Element.Get ? node.Element.Get(node.Input) : UnsetValue;
                    else if (node.Accessor) node.Output = 'Value' in node.Accessor ? node.Accessor.Value : (Object.hasOwn(node, 'AccessorValue') ? node.AccessorValue : UnsetValue);
                    else if (node.Element.Get) { ++this.Diagnostics.Reads; node.Output = node.Element.Get(node.Input); }
                }
                const value = elements.length ? (this._nodes.length ? this._nodes.at(-1).Output : UnsetValue) : this._root;
                const error = this._nodes.find(node => node.Error)?.Error ?? null;
                const success = this.Mode !== 'OneWayToSource' && this._publish(value, error);
                if (this.Mode === 'OneTime' && success && !this.IsDisposed) { this._oneTimeDone = true; this._lifetime.Clear(); }
            }
        } catch (error) { this._pendingIndex = Infinity; this._Failure(error); }
        finally { this._processing = false; }
    }
    UpdateSource(value = this.Target.GetValue(this.TargetProperty)) {
        if (this.IsDisposed || this._updatingTarget || this._updatingSource) return;
        this._updatingSource = true;
        try {
            const b = this.ParentBinding, node = this._nodes.at(-1);
            if (!node || node.Input == null || node.Input === UnsetValue) throw new Error('The compiled binding source is null.');
            if (b.Converter) {
                if (typeof b.Converter.ConvertBack !== 'function') throw new Error('TwoWay binding requires Converter.ConvertBack.');
                value = b.Converter.ConvertBack(value, null, b.ConverterParameter, b.ConverterCulture);
            }
            if (this._negate) value = !value;
            if (value !== UnsetValue && value !== DoNothing) {
                if (node.Accessor?.SetValue) { if (node.Accessor.SetValue(value, this.Priority) === false) throw new TypeError('Compiled accessor rejected the assignment.'); }
                else if (node.Element.Set) node.Element.Set(node.Input, value);
                else throw new TypeError('The compiled binding terminal is read-only.');
                this._pendingIndex = Math.min(this._pendingIndex, this._nodes.length - 1);
            }
            this._error(null);
        } catch (error) { this._error(error); }
        finally { this._updatingSource = false; if (this._pendingIndex !== Infinity) this._Drain(); }
    }
}

class BindingProxy extends AvaloniaObject {
}
DefineProperties(BindingProxy, { Value: [UnsetValue] });
/** Capture an acyclic definition graph before replacing a target's old binding.
 * Binding objects are reusable definitions, not live state. Sources/converters
 * remain borrowed; child paths and scalar settings are snapshotted per attach. */
function snapshotMultiBinding(binding, ancestors = new Set(), budget = { Count: 0 }) {
    if (!(binding instanceof Binding) && !(binding instanceof MultiBinding)) throw new TypeError('MultiBinding children must be Binding or MultiBinding definitions.');
    if (++budget.Count > 4096 || ancestors.size >= 64) throw new RangeError('MultiBinding graph exceeds its size/depth budget.');
    if (ancestors.has(binding)) throw new TypeError('MultiBinding definition cycle.');
    const result = Object.assign(Object.create(Object.getPrototypeOf(binding)), binding);
    if (binding.RelativeSource) result.RelativeSource = { ...binding.RelativeSource };
    if (binding instanceof MultiBinding) {
        if (!['Default', 'OneWay', 'OneTime'].includes(binding.Mode)) throw new TypeError('MultiBinding supports OneWay and OneTime modes.');
        if (binding.Converter != null && typeof binding.Converter !== 'function' && typeof binding.Converter.Convert !== 'function') throw new TypeError('Invalid MultiBinding converter.');
        if (!binding.Bindings || typeof binding.Bindings[Symbol.iterator] !== 'function') throw new TypeError('MultiBinding.Bindings must be iterable.');
        ancestors.add(binding);
        try {
            result.Bindings = [];
            for (const child of binding.Bindings) result.Bindings.push(snapshotMultiBinding(child, ancestors, budget));
        } finally { ancestors.delete(binding); }
    } else {
        // A child can only feed the aggregate, never write back through a proxy.
        result.Mode = binding.Mode === BindingMode.OneTime ? BindingMode.OneTime : BindingMode.OneWay;
        if (result instanceof CompiledBindingExtension) {
            result.CompiledPath = binding.Path instanceof CompiledBindingPath ? binding.Path : binding.CompiledPath instanceof CompiledBindingPath
                ? binding.CompiledPath : CompiledBindingPath.Parse(binding.Path);
        } else PropertyPath.Parse(sourceRoot({ DataContext: null }, result, result.Path).Path);
    }
    return result;
}
/** Internal value sink observes publications, not GetObservable's initial default.
 * Therefore the first UnsetValue is a real initialized child value, while a child
 * returning DoNothing does not manufacture a value. No phantom initial converter
 * call or source-to-source writeback is possible. */
class MultiBindingSink extends BindingProxy {
    constructor(anchor, receive) { super(); this.BindingAnchor = anchor; this._receive = receive; }
    _SetPriorityValue(property, value, priority, key, order) {
        const result = super._SetPriorityValue(property, value, priority, key, order);
        if (property === BindingProxy.ValueProperty && value !== DoNothing && !this.IsDisposed) this._receive?.(value);
        return result;
    }
    Dispose() { this._receive = null; super.Dispose(); }
}
export class MultiBindingExpression {
    constructor(target, property, binding, priority = binding.Priority) {
        if (!(target instanceof AvaloniaObject) || target.IsDisposed) throw new TypeError('A live binding target is required.');
        if (property.IsDirect && !property.Setter) throw new TypeError('The binding target property is read-only.');
        this._binding = snapshotMultiBinding(binding);
        Object.assign(this, { Target: target, TargetProperty: property, ParentBinding: binding, Priority: priority, IsDisposed: false });
        this.Mode = this._binding.Mode === BindingMode.Default ? BindingMode.OneWay : this._binding.Mode;
        this._anchor = binding.Anchor ?? target.BindingAnchor ?? target;
        this._key = Symbol('MultiBinding'); this._sources = new CompositeDisposable(); this._expressions = [];
        this._values = Array(this._binding.Bindings.length).fill(UnsetValue);
        this._initialized = new Uint8Array(this._values.length); this._remaining = this._values.length;
        this._ready = false; this._pending = false; this._publishing = false; this._oneTimeDone = false;
    }
    Attach() {
        if (this.IsDisposed || this._attached) throw new Error('MultiBinding expression is already attached or disposed.');
        this._attached = true;
        try {
            if (this.Priority === BindingPriority.LocalValue) {
                this.Target.ClearValue(this.TargetProperty);
                this.Target._bindings.set(this.TargetProperty, this);
            }
            this.Target._lifetime.Add(this);
            for (let i = 0; i < this._binding.Bindings.length && !this.IsDisposed; i++) {
                const proxy = new MultiBindingSink(this._anchor, value => this._Changed(i, value));
                this._sources.Add(proxy);
                this._expressions.push(BindingOperations.Apply(proxy, BindingProxy.ValueProperty, this._binding.Bindings[i], BindingPriority.LocalValue));
            }
            this._ready = true; this._pending = true; this._Drain();
            return this;
        } catch (error) { this.Dispose(); throw error; }
    }
    _Changed(index, value) {
        if (this.IsDisposed || this._oneTimeDone) return;
        if (this._initialized[index] && AreValuesEqual(this._values[index], value)) return;
        if (!this._initialized[index]) { this._initialized[index] = 1; this._remaining--; }
        this._values[index] = value; this._pending = true; this._Drain();
    }
    UpdateTarget() {
        if (this.IsDisposed || this._oneTimeDone) return;
        const ready = this._ready; this._ready = false;
        try { for (const expression of this._expressions) { if (this.IsDisposed) break; expression.UpdateTarget(); } }
        finally { this._ready = ready; }
        this._pending = true; this._Drain();
    }
    _Drain() {
        if (!this._ready || this._remaining || this._publishing || this.IsDisposed || this._oneTimeDone) return;
        this._publishing = true; let passes = 0;
        try {
            while (this._pending && !this.IsDisposed && !this._oneTimeDone) {
                this._pending = false;
                if (++passes > 64) throw new Error('MultiBinding reentrant conversion did not converge within 64 updates.');
                this._Publish();
            }
        } catch (error) { this._pending = false; this._Failure(error); }
        finally { this._publishing = false; }
    }
    _Publish() {
        const b = this._binding, values = Object.freeze(this._values.slice());
        try {
            let value = b.Converter ? typeof b.Converter === 'function'
                ? b.Converter(values, this.TargetProperty.PropertyType, b.ConverterParameter, b.ConverterCulture)
                : b.Converter.Convert(values, this.TargetProperty.PropertyType, b.ConverterParameter, b.ConverterCulture) : values;
            if (this.IsDisposed) return; // A converter can replace/dispose its own target binding.
            let error = null;
            if (value instanceof BindingNotification) { error = value.Error; value = value.Value; }
            if (value === DoNothing) return;
            const type = this.TargetProperty.PropertyType;
            if (b.StringFormat?.trim() && (type == null || type === String || type === Object) && value !== UnsetValue) {
                value = FormatComposite(b.StringFormat, b.Converter ? [value] : values, b.ConverterCulture);
            }
            if (value == null && b.TargetNullValue !== UnsetValue) value = b.TargetNullValue;
            const success = value !== UnsetValue && !error;
            if (value === UnsetValue) value = b.FallbackValue;
            this._setTarget(value);
            if (this.IsDisposed) return;
            BindingOperations.SetValidationError(this.Target, this.TargetProperty, error);
            if (this.Mode === BindingMode.OneTime && success) { this._oneTimeDone = true; this._DetachSources(); }
        } catch (error) { this._Failure(error); }
    }
    _Failure(error) {
        if (this.IsDisposed) return;
        try { this._setTarget(this._binding.FallbackValue); }
        catch (fallbackError) { error = new AggregateError([error, fallbackError], 'MultiBinding conversion and fallback failed.'); }
        if (!this.IsDisposed) BindingOperations.SetValidationError(this.Target, this.TargetProperty, error);
    }
    _setTarget(value) { if (!this.IsDisposed) BindingExpression.prototype._setTarget.call(this, value); }
    SetCurrentValue(value) { this._setTarget(value); }
    _DetachSources() { this._expressions.length = 0; this._sources.Dispose(); }
    Dispose() {
        if (this.IsDisposed) return;
        this.IsDisposed = true;
        try { this._DetachSources(); }
        finally {
            this._values.length = 0; this._initialized = null;
            if (this.Target._bindings.get(this.TargetProperty) === this) this.Target._bindings.delete(this.TargetProperty);
            this.Target._RemovePriorityValue(this.TargetProperty, this._key);
            if (!this.Target._bindings.has(this.TargetProperty)) BindingOperations.SetValidationError(this.Target, this.TargetProperty, null);
            this.Target._lifetime.Remove(this);
        }
    }
    unsubscribe() { this.Dispose(); }
}
export class BindingOperations {
    static DoNothing = DoNothing;
    static ValidationChanged = new Event();
    static Apply(target, property, binding, priority = binding.Priority ?? BindingPriority.LocalValue) {
        if (typeof property === 'string')
            property = AvaloniaProperty.FindRegistered(target, property);
        if (!property)
            throw new Error('Binding target property is not registered.');
        if (binding?.subscribe)
            return target.Bind(property, binding, priority);
        if (!(binding instanceof BindingBase))
            binding = new Binding(binding);
        return binding instanceof MultiBinding ? new MultiBindingExpression(target, property, binding, priority).Attach() : binding instanceof CompiledBindingExtension ? new CompiledBindingExpression(target, property, binding, priority).Attach() : new BindingExpression(target, property, binding, priority).Attach();
    }
    static SetBinding(target, property, binding) {
        return this.Apply(target, property, binding);
    }
    static ClearBinding(target, property) {
        target._bindings.get(property)?.Dispose();
    }
    static GetBindingExpressionBase(target, property) {
        return target._bindings.get(property) ?? null;
    }
    static SetValidationError(target, property, error) {
        target._bindingErrors ??= new Map();
        const old = target._bindingErrors.get(property);
        if (old === error || !old && !error)
            return;
        if (error)
            target._bindingErrors.set(property, error);
        else
            target._bindingErrors.delete(property);
        this.ValidationChanged.Raise(target, { Target: target, Property: property, Error: error, Errors: [...target._bindingErrors.values()] });
        if (error)
            target.OnBindingError(property, error);
    }
}
RegisterBindingHandler((target, property, binding, priority) => BindingOperations.Apply(target, property, binding, priority));
export class ExpressionObserver {
    static Create(source, path = '') {
        return new Observable(observer => {
            const proxy = new BindingProxy();
            const binding = new Binding(path);
            binding.Source = source;
            const subscription = proxy.GetObservable(BindingProxy.ValueProperty).subscribe(observer);
            const expression = BindingOperations.Apply(proxy, BindingProxy.ValueProperty, binding);
            return () => {
                subscription.unsubscribe();
                expression.Dispose();
                proxy.Dispose();
            };
        });
    }
}
export const BoolConverters = Object.freeze({
    Not: { Convert: v => !v, ConvertBack: v => !v },
    And: { Convert: values => values.every(v => v !== UnsetValue && !!v) },
    Or: { Convert: values => values.some(v => v !== UnsetValue && !!v) },
});
export const ObjectConverters = Object.freeze({ IsNull: { Convert: v => v == null }, IsNotNull: { Convert: v => v != null }, AreAllEqual: { Convert: values => values.length > 0 && values.every(v => v !== UnsetValue && AreValuesEqual(v, values[0])) } });
export const StringConverters = Object.freeze({ IsNullOrEmpty: { Convert: v => v == null || String(v).length === 0 }, IsNotNullOrEmpty: { Convert: v => v != null && String(v).length > 0 } });
