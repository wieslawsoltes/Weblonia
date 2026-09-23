import { XamlServiceProvider } from './services.js';
export * from './services.js';
import * as Base from "../../base/src/index.js";
import * as Media from "../../media/src/index.js";
import * as Controls from "../../controls/src/index.js";
import * as Data from "../../data/src/index.js";
import * as Styling from "../../styling/src/index.js";
import { XamlCompiler, XamlTypeSystem, TransformerConfiguration, XamlParseException, XamlNamespaces, MarkupExtensionParser, XamlOverloadResolver, XamlTypeReference, SplitTypeArguments } from "../../xamlx/src/index.js";
const avaloniaNamespaces = ['', 'https://github.com/avaloniaui', 'http://schemas.avaloniaui.net'];
const prohibited = new Set(['__proto__', 'prototype', 'constructor']);
const isXamlNamespace = ns => ns === XamlNamespaces.Xaml2006 || ns === XamlNamespaces.Xaml2009;
const isText = node => !node.Type && Object.hasOwn(node, 'Text');
const metadata = new WeakMap();
export class XamlTypeRegistry extends XamlTypeSystem {
    static Default = null;
    constructor() {
        super();
        this.Statics = new Map();
        this.Models = new Map();
        const primitives = { String: String, Object: Object, Double: Number, Single: Number, Int32: Number, Int64: BigInt, Boolean: Boolean };
        this._primitiveReferences = new Map();
        for (const [name, type] of Object.entries(primitives)) {
            const options = { Name: name, Validate: name === 'Int32' ? v => Number.isInteger(v) && v >= -2147483648 && v <= 2147483647 : null };
            const reference = new XamlTypeReference(type, options);
            this._primitiveReferences.set(name, reference);
            for (const ns of [XamlNamespaces.Xaml2006, XamlNamespaces.Xaml2009]) this.RegisterType(name, type, ns, { Reference: reference });
        }
    }
    RegisterAssembly(exports, xmlNamespaces = avaloniaNamespaces) {
        if (typeof xmlNamespaces === 'string')
            xmlNamespaces = [xmlNamespaces];
        for (const [name, value] of Object.entries(exports)) {
            if (typeof value === 'function' && /^[A-Z]/.test(name))
                for (const ns of xmlNamespaces)
                    this.RegisterType(name, value, ns);
            else if (value && typeof value === 'object' && /^[A-Z]/.test(name))
                this.Statics.set(name, value);
        }
        return this;
    }
    RegisterModel(name, properties, namespace = '') {
        this.Models.set(`${namespace}|${name}`, { Name: name, Properties: properties });
        return this;
    }
    ResolveName(qname, namespaces = {}, fallbackNamespace = '') {
        const index = qname.indexOf(':'), name = index < 0 ? qname : qname.slice(index + 1), ns = index < 0 ? namespaces[''] ?? fallbackNamespace : namespaces[qname.slice(0, index)];
        if (index >= 0 && ns == null)
            throw new XamlParseException(`Unknown namespace prefix in '${qname}'.`);
        return { Name: name, Namespace: ns ?? '' };
    }
    ResolveTypeReference(qname, namespaces = {}) {
        qname = String(qname).trim();
        if (qname.endsWith('?')) {
            const base = this.ResolveTypeReference(qname.slice(0, -1), namespaces);
            return new XamlTypeReference(base.Type, { ...base, Name: qname, IsNullable: true });
        }
        if (qname.endsWith('[]')) {
            const element = this.ResolveTypeReference(qname.slice(0, -2), namespaces);
            return new XamlTypeReference(Array, { Name: qname, ElementType: element });
        }
        const start = qname.indexOf('(');
        if (start >= 0) {
            if (!qname.endsWith(')')) throw new XamlParseException('Unbalanced generic type reference.');
            const { Name, Namespace } = this.ResolveName(qname.slice(0, start), namespaces);
            const arguments_ = SplitTypeArguments(qname.slice(start + 1, -1)).map(x => this.ResolveType(x, namespaces));
            const type = this.MakeGenericType(Name, Namespace, arguments_);
            return new XamlTypeReference(type.Type, { Name: qname, TypeArguments: arguments_ });
        }
        const { Name, Namespace } = this.ResolveName(qname, namespaces), descriptor = this.GetType(Name, Namespace);
        return descriptor.Reference ?? new XamlTypeReference(descriptor.Type, { Name });
    }
    ResolveType(qname, namespaces = {}) { return this.ResolveTypeReference(qname, namespaces).Type; }
    ResolveStatic(qname, namespaces = {}) {
        const dot = qname.lastIndexOf('.');
        if (dot < 0)
            throw new XamlParseException('x:Static requires Type.Member.');
        const typename = qname.slice(0, dot), member = qname.slice(dot + 1);
        if (prohibited.has(member))
            throw new XamlParseException('Unsafe static member.');
        const { Name, Namespace } = this.ResolveName(typename, namespaces);
        const type = this.FindType(Name, Namespace)?.Type ?? this.Statics.get(Name);
        if (!type || !(member in type))
            throw new XamlParseException(`Static member '${qname}' was not found.`);
        return type[member];
    }
}
XamlTypeRegistry.Default = new XamlTypeRegistry().RegisterAssembly(Base).RegisterAssembly(Media).RegisterAssembly(Controls).RegisterAssembly(Data).RegisterAssembly(Styling);
Data.BindingRuntime.ResolveType = name => {
    try {
        return XamlTypeRegistry.Default.ResolveType(name);
    }
    catch {
        return null;
    }
};
class ReferenceExtension {
    constructor(name) {
        this.Name = name;
    }
}
class TypeExtension {
    constructor(name) {
        this.Name = name;
    }
}
class StaticExtension {
    constructor(member) {
        this.Member = member;
    }
}
class XamlPrimitive {
    constructor(value) {
        this.Value = value;
    }
}
class XamlScalar {
    constructor(type) {
        this.Type = type;
        this.Text = '';
    }
}
function getProperty(target, name, registry, namespaces) {
    if (prohibited.has(name))
        throw new XamlParseException(`Property '${name}' is prohibited.`);
    if (name.includes('.')) {
        const dot = name.lastIndexOf('.'), typeName = name.slice(0, dot), member = name.slice(dot + 1), owner = registry.ResolveType(typeName, namespaces);
        const property = owner[`${member}Property`] ?? Base.AvaloniaProperty.FindRegistered(owner, member);
        if (property?.IsAttached || property && target instanceof owner)
            return { Property: property, Name: member };
        if (target instanceof owner)
            return { Property: Base.AvaloniaProperty.FindRegistered(target, member), Name: member };
        if (owner[`Set${member}`])
            return { Setter: value => owner[`Set${member}`](target, value), Name: member };
        throw new XamlParseException(`Attached property '${name}' is not registered.`);
    }
    return { Property: target instanceof Base.AvaloniaObject ? Base.AvaloniaProperty.FindRegistered(target, name) : null, Name: name };
}
export class XamlRuntimeContext {
    constructor(options = {}) {
        this.Options = options;
        this.Registry = options.Registry ?? XamlTypeRegistry.Default;
        this.Scope = options.NameScope ?? new Controls.NameScope();
        this.RootObject = null;
        this._pendingValues = [];
        this._pendingBindings = [];
        this._pendingEvents = [];
        this._objects = [];
        this._disposed = false;
        this._argumentDepth = 0;
        this._parents = []; this._baseUris = []; this._extensionDepth = 0;
    }
    BeginArguments() { ++this._argumentDepth; }
    EndArguments() { if (--this._argumentDepth < 0) throw new Error('Unbalanced argument scope.'); }
    Create(typeName, xmlNamespace, node, arguments_ = []) {
        const directive = name => node?.Attributes?.find(a => isXamlNamespace(a.Namespace) && a.Name === name)?.Value;
        const typeArguments = directive('TypeArguments');
        const descriptor = typeArguments
            ? this.Registry.MakeGenericType(typeName, xmlNamespace, SplitTypeArguments(typeArguments).map(x => this.Registry.ResolveType(x, node.Namespaces)))
            : this.Registry.FindType(typeName, xmlNamespace);
        if (!descriptor)
            throw new XamlParseException(`Type '${typeName}' in namespace '${xmlNamespace}' is not registered.`, node?.Line, node?.Position, this.Options.SourceFile);
        const scalarTypes = [Base.Thickness, Base.CornerRadius, Base.Point, Base.Size, Base.Rect, Base.Matrix, Base.RelativePoint, Media.Color, Controls.GridLength];
        if (scalarTypes.includes(descriptor.Type) && !arguments_.length && !directive('FactoryMethod'))
            return new XamlScalar(descriptor.Type);
        let object;
        try {
            object = XamlOverloadResolver.Construct(descriptor, arguments_.map(x => this._ResolveReference(this._ScalarValue(x), this.RootObject)), directive('FactoryMethod'));
            if ((typeof object !== 'object' || object === null) && typeof object !== 'function')
                throw new TypeError('An object constructor/factory must return an object.');
        }
        catch (e) {
            throw new XamlParseException(`Cannot construct '${typeName}': ${e.message}`, node?.Line, node?.Position);
        }
        metadata.set(object, { Descriptor: descriptor, Namespaces: node?.Namespaces ?? {}, Node: node, Key: Base.UnsetValue });
        return object;
    }
    Begin(object, node) {
        if (!metadata.has(object))
            metadata.set(object, { Namespaces: node.Namespaces, Node: node, Key: Base.UnsetValue });
        this._objects.push(object);
        const meta = metadata.get(object);
        for (const attribute of node.Attributes ?? []) {
            if (isXamlNamespace(attribute.Namespace) && attribute.Name === 'CompileBindings')
                meta.CompileBindings = Controls.BooleanValue(attribute.Value);
            if (isXamlNamespace(attribute.Namespace) && attribute.Name === 'DataType') meta.DataType = attribute.Value;
        }
        let baseUri = this._baseUris.at(-1) ?? this.Options.BaseUri ?? this.Options.SourceFile ?? null;
        const xmlBase = node.Attributes?.find(a => a.Namespace === XamlNamespaces.Xml && a.Name === 'base');
        if (xmlBase) {
            try { baseUri = new URL(xmlBase.Value, baseUri ?? undefined).href; }
            catch { throw new XamlParseException('xml:base requires a valid URI and an absolute base URI.', xmlBase.Line, xmlBase.Position); }
        }
        meta.BaseUri = baseUri;
        meta.DataTypeContext = meta.DataType ? { Name: meta.DataType, Namespaces: node.Namespaces }
            : metadata.get(this._parents.at(-1))?.DataTypeContext ?? this.Options.DataTypeContext ?? null;
        this._parents.push(object); this._baseUris.push(baseUri);
        if (!this.RootObject && !this._argumentDepth) {
            this.RootObject = object;
            if (object instanceof Controls.Control) {
                Controls.NameScope.SetNameScope(object, this.Scope);
                if (Object.hasOwn(this.Options, 'DataContext'))
                    object.DataContext = this.Options.DataContext;
                if (this.Options.ResourceParent)
                    object.SetInheritanceParent(this.Options.ResourceParent);
            }
        }
        object.BeginInit?.();
    }
    End(object) {
        if (this._parents.at(-1) !== object) throw new Error('Unbalanced XAML object construction.');
        try { object.EndInit?.(); }
        finally { this._parents.pop(); this._baseUris.pop(); }
    }
    _TargetProperty(target, name, namespaces) {
        const member = getProperty(target, name, this.Registry, namespaces);
        return member.Property ?? Object.freeze({ Name: member.Name, DeclaringType: target.constructor });
    }
    CreateServiceProvider(target, property = null, namespaces = {}) {
        return new XamlServiceProvider(this, target, property, namespaces);
    }
    _ProvideValue(extension, target, property, namespaces) {
        if (++this._extensionDepth > (this.Options.MaxMarkupExtensionDepth ?? 64)) {
            --this._extensionDepth; throw new XamlParseException('Markup extension recursion limit exceeded.');
        }
        try {
            const provider = this.CreateServiceProvider(target, property, namespaces);
            if (metadata.has(extension)) provider.BaseUri = metadata.get(extension).BaseUri ?? provider.BaseUri;
            const result = extension.ProvideValue(provider);
            if (typeof result?.then === 'function') {
                Promise.resolve(result).catch(() => {});
                throw new XamlParseException('ProvideValue must return synchronously.');
            }
            return result;
        } finally { --this._extensionDepth; }
    }
    _UseCompiledBindings(target) {
        if (metadata.get(target)?.CompileBindings != null) return metadata.get(target).CompileBindings;
        for (let i = this._parents.length - 1; i >= 0; --i) {
            const value = metadata.get(this._parents[i])?.CompileBindings;
            if (value != null) return value;
        }
        return this.Options.CompileBindings ?? false;
    }
    Attribute(object, attribute, namespaces) {
        const ns = attribute.Namespace, name = attribute.Name, raw = attribute.CompiledValue ?? MarkupExtensionParser.Parse(attribute.Value);
        if ([XamlNamespaces.Design, XamlNamespaces.Compatibility, XamlNamespaces.Xml].includes(ns))
            return;
        if (isXamlNamespace(ns)) {
            if (['TypeArguments', 'FactoryMethod'].includes(name)) return;
            if (name === 'Key') {
                metadata.get(object).Key = this.Value(raw, object, namespaces);
                return;
            }
            if (name === 'Name') {
                object.Name = attribute.Value;
                this.Scope.Register(attribute.Value, object);
                return;
            }
            if (name === 'Class') {
                metadata.get(object).Class = attribute.Value;
                return;
            }
            if (name === 'DataType') {
                metadata.get(object).DataType = attribute.Value;
                return;
            }
            if (name === 'CompileBindings') {
                metadata.get(object).CompileBindings = Controls.BooleanValue(attribute.Value);
                return;
            }
            throw new XamlParseException(`XAML directive 'x:${name}' is not implemented.`, attribute.Line, attribute.Position);
        }
        if (name === 'Classes') {
            object.Classes.Replace(attribute.Value);
            return;
        }
        if (name === 'Name' && object instanceof Controls.StyledElement)
            this.Scope.Register(attribute.Value, object);
        const event = this._FindEvent(object, name);
        if (event) {
            this._pendingEvents.push({ Object: object, Event: event, Handler: attribute.Value });
            return;
        }
        this.Set(object, name, this.Value(raw, object, namespaces, this._TargetProperty(object, name, namespaces)), namespaces, attribute);
    }
    _FindEvent(object, name) {
        const attached = name.includes('.'), member = attached ? name.split('.').at(-1) : name;
        if (prohibited.has(member))
            return null;
        let type = object.constructor;
        if (attached) {
            try {
                type = this.Registry.ResolveType(name.slice(0, name.lastIndexOf('.')), metadata.get(object)?.Namespaces);
            }
            catch {
                return null;
            }
        }
        for (let t = type; t; t = Object.getPrototypeOf(t))
            if (Object.hasOwn(t, `${member}Event`))
                return t[`${member}Event`];
        const value = object[member];
        // An arithmetic Point.Add (or a collection Add) is not an event.
        // Custom event adapters must provide the full subscription/raise contract.
        return value instanceof Base.Event || value && typeof value.Add === 'function' && typeof value.Remove === 'function' && typeof value.Raise === 'function' ? value : null;
    }
    Value(value, target, namespaces = metadata.get(target)?.Namespaces ?? {}, property = null) {
        if (!value || typeof value !== 'object' || value.Kind !== 'MarkupExtension') return value;
        const resolved = this.Registry.ResolveName(value.Name, namespaces);
        const name = resolved.Name, builtin = avaloniaNamespaces.includes(resolved.Namespace) || isXamlNamespace(resolved.Namespace);
        const positional = value.PositionalArguments.map(v => this.Value(v, target, namespaces, property));
        const named = value.NamedArguments;
        const argument = key => this.Value(named[key], target, namespaces, property);
        if (builtin) {
            if (name === 'Null') return null;
            if (name === 'Type') return this.Registry.ResolveType(positional[0] ?? argument('TypeName'), namespaces);
            if (name === 'Static') return this.Registry.ResolveStatic(positional[0] ?? argument('Member'), namespaces);
            if (name === 'Reference') return new ReferenceExtension(positional[0] ?? argument('Name'));
            if (name === 'StaticResource') return new Styling.StaticResourceExtension(positional[0] ?? argument('ResourceKey'));
            if (name === 'DynamicResource') return new Styling.DynamicResourceExtension(positional[0] ?? argument('ResourceKey'));
            if (['Binding', 'CompiledBinding', 'ReflectionBinding', 'TemplateBinding'].includes(name)) {
                const compiled = name === 'CompiledBinding' || name === 'Binding' && this._UseCompiledBindings(target);
                const Ctor = compiled ? Data.CompiledBindingExtension : name === 'ReflectionBinding' ? Data.ReflectionBindingExtension : name === 'TemplateBinding' ? Data.TemplateBinding : Data.Binding;
                const binding = new Ctor(positional[0] ?? argument('Path') ?? '');
                for (const [key, val] of Object.entries(named)) {
                    if (prohibited.has(key) || !(key in binding)) throw new XamlParseException(`Unknown ${name} argument '${key}'.`);
                    binding[key] = this.Value(val, binding, namespaces, this._TargetProperty(binding, key, namespaces));
                }
                if (binding.IsCompiled) Data.CompiledBindingPath.Parse(binding.Path); else Data.PropertyPath.Parse(binding.Path);
                return binding;
            }
            if (name === 'RelativeSource') {
                const relative = new Data.RelativeSource(positional[0] ?? argument('Mode') ?? (named.AncestorType ? 'FindAncestor' : 'Self'));
                for (const [key, raw] of Object.entries(named)) {
                    if (prohibited.has(key) || !(key in relative)) throw new XamlParseException(`Unknown RelativeSource argument '${key}'.`);
                    const val = this.Value(raw, relative, namespaces, this._TargetProperty(relative, key, namespaces));
                    relative[key] = key === 'AncestorType' && typeof val === 'string' ? this.Registry.ResolveType(val, namespaces) : key === 'AncestorLevel' ? Number(val) : val;
                }
                return relative;
            }
        }
        const descriptor = this.Registry.FindType(name, resolved.Namespace) ?? this.Registry.FindType(name + 'Extension', resolved.Namespace);
        if (!descriptor) throw new XamlParseException(`Markup extension '${value.Name}' is not registered.`);
        const extension = XamlOverloadResolver.Construct(descriptor, positional);
        this._objects.push(extension);
        // The outer extension must exist before evaluating its named arguments.
        // Inner extensions see the real immediate target, not the final control.
        for (const [key, val] of Object.entries(named)) {
            if (prohibited.has(key) || !(key in extension)) throw new XamlParseException(`Unknown extension argument '${key}'.`);
            extension[key] = this.Value(val, extension, namespaces, this._TargetProperty(extension, key, namespaces));
        }
        if (typeof extension.ProvideValue !== 'function') throw new XamlParseException(`${name} does not implement ProvideValue.`);
        return this._ProvideValue(extension, target, property, namespaces);
    }
    _ResolveReference(value, target) {
        if (value instanceof ReferenceExtension)
            return this.Scope.Get(value.Name);
        if (value instanceof Styling.StaticResourceExtension && !(value instanceof Styling.DynamicResourceExtension))
            return Styling.FindResource(target instanceof Controls.Control ? target : this.RootObject, value.ResourceKey, undefined, this.Options.ResourceParent);
        return value;
    }
    Set(target, name, value, namespaces = metadata.get(target)?.Namespaces ?? {}, node = null) {
        if (target instanceof XamlScalar) {
            if (name !== 'Text')
                throw new XamlParseException('Scalar object properties are not supported.');
            target.Text = value;
            return;
        }
        const member = getProperty(target, name, this.Registry, namespaces);
        if (metadata.has(value) && typeof value.ProvideValue === 'function' && !(value instanceof Styling.StaticResourceExtension))
            value = this._ProvideValue(value, target, member.Property ?? this._TargetProperty(target, name, namespaces), namespaces);
        if (target instanceof Styling.Setter && member.Name === 'Value') {
            target.Value = value;
            return;
        }
        if (value instanceof Styling.DynamicResourceExtension) {
            if (!member.Property)
                throw new XamlParseException(`DynamicResource requires an Avalonia property: ${name}.`);
            this._pendingBindings.push(() => target._lifetime.Add(target.Bind(member.Property, Styling.GetResourceObservable(target, value.ResourceKey, this.Options.ResourceParent))));
            return;
        }
        if (value instanceof Styling.StaticResourceExtension || value instanceof ReferenceExtension) {
            this._pendingValues.push(() => this.Set(target, name, this._ResolveReference(value, target), namespaces, node));
            return;
        }
        if (value instanceof Data.BindingBase && !(target instanceof Data.BindingBase) && !member.Property?.GetMetadata(target).AssignBinding) {
            if (!member.Property)
                throw new XamlParseException(`Binding target '${name}' is not an Avalonia property.`, node?.Line, node?.Position);
            this._pendingBindings.push(() => {
                for (const key of ['Source', 'Converter', 'ConverterParameter', 'FallbackValue', 'TargetNullValue'])
                    if (key in value)
                        value[key] = this._ResolveReference(value[key], target);
                this._ValidateCompiledBinding(target, value, namespaces);
                Data.BindingOperations.Apply(target, member.Property, value);
            });
            return;
        }
        if (member.Setter) {
            member.Setter(value);
            return;
        }
        if (member.Property) {
            const convert = member.Property.GetMetadata(target).Convert;
            target.SetValue(member.Property, convert && value != null && value !== Base.UnsetValue ? convert(value) : value);
            return;
        }
        if (member.Name === 'Selector' && target instanceof Styling.Style)
            value = value instanceof Styling.Selector ? value : Styling.Selector.Parse(value);
        else if (member.Name === 'TargetType' && typeof value === 'string' && target instanceof Styling.ControlTheme)
            value = this.Registry.ResolveType(value, namespaces);
        else if (member.Name === 'Property' && target instanceof Styling.Setter)
            value = String(value);
        else if (member.Name === 'ItemsSource' && target instanceof Controls.TreeDataTemplate) {
            const binding = value;
            target.ItemsSelector = data => Data.PropertyPath.Parse(binding.Path).reduce((o, s) => Data.ReadMember(o, s), data);
            return;
        }
        if (!(member.Name in target))
            throw new XamlParseException(`Property '${member.Name}' does not exist on ${target.constructor.name}.`, node?.Line, node?.Position, this.Options.SourceFile);
        const current = target[member.Name];
        if (Array.isArray(current) && Array.isArray(value))
            current.push(...value);
        else if (typeof current === 'number' && typeof value === 'string')
            target[member.Name] = Number(value);
        else if (typeof current === 'boolean' && typeof value === 'string')
            target[member.Name] = Controls.BooleanValue(value);
        else
            target[member.Name] = value;
    }
    _ValidateCompiledBinding(target, binding, namespaces) {
        if (!binding.IsCompiled)
            return;
        const typeContext = metadata.get(target)?.DataTypeContext ?? this.Options.DataTypeContext;
        const typeName = typeContext?.Name;
        namespaces = typeContext?.Namespaces ?? namespaces;
        binding.CompiledPath = Data.CompiledBindingPath.Parse(binding.Path);
        const path = binding.CompiledPath.Elements;
        if (!typeName)
            return;
        const resolved = this.Registry.ResolveName(typeName, namespaces), model = this.Registry.Models.get(`${resolved.Namespace}|${resolved.Name}`);
        if (!model)
            throw new XamlParseException(`Compiled binding model schema '${typeName}' is not registered.`);
        let properties = model.Properties;
        for (const segment of path) {
            if (segment.Kind !== 'Property')
                continue;
            if (!properties || !Object.hasOwn(properties, segment.Name))
                throw new XamlParseException(`Compiled binding member '${segment.Name}' does not exist on model '${typeName}'.`);
            const next = properties[segment.Name];
            properties = typeof next === 'object' ? next.Properties ?? next : null;
        }
    }
    _ScalarValue(value) {
        return value instanceof XamlPrimitive ? value.Value : value instanceof XamlScalar ? value.Type.Parse(value.Text.trim()) : value;
    }
    _AddToCollection(collection, values, target) {
        for (let value of values) {
            if (value == null)
                continue;
            const meta = typeof value === 'object' ? metadata.get(value) : null;
            value = this._ScalarValue(value);
            if (collection instanceof Map) {
                const key = meta?.Key;
                if (key === undefined || key === Base.UnsetValue)
                    throw new XamlParseException('A resource dictionary entry requires x:Key.');
                collection.Add ? collection.Add(this._ResolveReference(key, target), value) : collection.set(key, value);
            }
            else if (collection.Add)
                collection.Add(value);
            else if (Array.isArray(collection))
                collection.push(value);
            else
                throw new XamlParseException('Property is not a collection.');
        }
    }
    Property(target, qualifiedName, values, node) {
        const name = qualifiedName.slice(qualifiedName.lastIndexOf('.') + 1);
        if (qualifiedName.startsWith('Design.'))
            return;
        const member = getProperty(target, qualifiedName, this.Registry, node?.Namespaces), current = target[member.Name];
        if (member.Property === Base.Animatable.TransitionsProperty) {
            const transitions = values.length === 1 && values[0] instanceof Base.Transitions ? values[0] : new Base.Transitions(values);
            this.Set(target, qualifiedName, transitions, node.Namespaces, node);
            return;
        }
        if (current instanceof Styling.ResourceDictionary && values.length === 1 && values[0] instanceof Styling.ResourceDictionary) {
            const other = values[0];
            for (const [key, value] of other)
                current.set(key, value);
            current.MergedDictionaries.AddRange(other.MergedDictionaries);
            for (const [key, value] of other.ThemeDictionaries)
                current.ThemeDictionaries.set(key, value);
            return;
        }
        if (current instanceof Base.AvaloniaList || current instanceof Map || Array.isArray(current)) {
            this._AddToCollection(current, values, target);
            return;
        }
        if (values.length !== 1)
            throw new XamlParseException(`Property '${name}' requires exactly one value.`, node.Line, node.Position);
        this.Set(target, qualifiedName, this._ScalarValue(values[0]), node.Namespaces, node);
    }
    Content(target, value, node = null) {
        if (value == null)
            return;
        if (target instanceof XamlScalar) {
            target.Text += value;
            return;
        }
        if (target instanceof Base.AvaloniaList || target instanceof Map || Array.isArray(target)) {
            this._AddToCollection(target, [value], target);
            return;
        }
        value = this._ScalarValue(value);
        const contentProperty = metadata.get(target)?.Descriptor?.ContentProperty;
        if (contentProperty) {
            const collection = target[contentProperty];
            if (collection?.Add || Array.isArray(collection) || collection instanceof Map) this._AddToCollection(collection, [value], target);
            else this.Set(target, contentProperty, value);
            return;
        }
        if (target instanceof Media.DrawingImage) { this.Set(target, 'Drawing', value); return; }
        if (target instanceof Media.GeometryDrawing && value instanceof Media.Geometry) { this.Set(target, 'Geometry', value); return; }
        if (target instanceof Styling.Style) {
            if (value instanceof Styling.Setter)
                target.Setters.Add(value);
            else if (value instanceof Styling.Style)
                target.Children.Add(value);
            else
                throw new XamlParseException('Style content must be a Setter or child Style.');
            return;
        }
        if (target instanceof Data.MultiBinding) {
            if (!(value instanceof Data.BindingBase))
                throw new XamlParseException('MultiBinding children must be bindings.');
            target.Bindings.push(value);
            return;
        }
        if (target instanceof Controls.Panel) {
            target.Children.Add(value);
            return;
        }
        if (target instanceof Controls.ItemsControl) {
            target.Items.Add(value);
            return;
        }
        if (target instanceof Controls.Decorator) {
            if (target.Child)
                throw new XamlParseException(`${target.constructor.name} can only have one child.`);
            target.Child = value;
            return;
        }
        if (target instanceof Controls.ContentControl) {
            if (target.Content != null)
                throw new XamlParseException(`${target.constructor.name} can only have one content value.`);
            target.Content = value;
            return;
        }
        if (target instanceof Controls.TextBlock) {
            if (value instanceof Controls.Inline || target.Inlines.Count) {
                if (!target.Inlines.Count && target.Text) { target.Inlines.Add(target.Text); target.Text = ''; }
                target.Inlines.Add(value);
            } else target.Text += String(value);
            return;
        }
        if (target instanceof Controls.InlineUIContainer) { if (target.Child) throw new XamlParseException('InlineUIContainer accepts one child.'); target.Child = value; return; }
        if (target instanceof Controls.Span) { target.Inlines.Add(value); return; }
        if (target instanceof Controls.Run) { target.Text += String(value); return; }
        if (target instanceof Media.GradientBrush) {
            target.GradientStops.Add(value);
            return;
        }
        if (target instanceof Styling.Setter) {
            target.Value = value;
            return;
        }
        for (const member of ['Children', 'Figures', 'Segments', 'Points', 'Items', 'GradientStops'])
            if (target[member]?.Add) {
                target[member].Add(value);
                return;
            }
        throw new XamlParseException(`Type '${target.constructor.name}' has no registered content property.`, node?.Line, node?.Position);
    }
    CreateArray(node, values) {
        const attribute = node.Attributes.find(a => a.Name === 'Type');
        if (!attribute) throw new XamlParseException('x:Array requires an element Type.', node.Line, node.Position);
        const raw = attribute.CompiledValue ?? MarkupExtensionParser.Parse(attribute.Value);
        const name = typeof raw === 'string' ? raw : raw.Name?.split(':').at(-1) === 'Type' ? raw.PositionalArguments[0] : null;
        if (typeof name !== 'string') throw new XamlParseException('x:Array Type must be a type name or x:Type extension.');
        const reference = this.Registry.ResolveTypeReference(name, node.Namespaces);
        const result = values.map(v => this._ScalarValue(v));
        for (const value of result) if (!reference.Accepts(value)) throw new XamlParseException(`Array item is not assignable to '${reference.Name}'.`, node.Line, node.Position);
        const key = node.Attributes.find(a => isXamlNamespace(a.Namespace) && a.Name === 'Key');
        metadata.set(result, { Namespaces: node.Namespaces, Node: node, Key: key ? this.Value(key.CompiledValue ?? MarkupExtensionParser.Parse(key.Value), this.RootObject, node.Namespaces) : Base.UnsetValue });
        return result;
    }
    Scalar(node) {
        const text = node.Children.filter(isText).map(c => c.Text).join(''), name = node.Type.Name;
        let value;
        if (name === 'Null')
            value = null;
        else if (name === 'String')
            value = text;
        else if (name === 'Boolean')
            value = Controls.BooleanValue(text.trim());
        else if (name === 'Int64')
            value = BigInt(text.trim());
        else {
            value = Number(text.trim());
            if (!Number.isFinite(value) || name === 'Int32' && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647))
                throw new XamlParseException(`Invalid ${name} literal.`);
        }
        const result = new XamlPrimitive(value), key = node.Attributes.find(a => isXamlNamespace(a.Namespace) && a.Name === 'Key');
        metadata.set(result, { Namespaces: node.Namespaces, Node: node, Key: key ? this.Value(key.CompiledValue ?? MarkupExtensionParser.Parse(key.Value), this.RootObject, node.Namespaces) : Base.UnsetValue });
        return result;
    }
    CreateTemplate(node) {
        const children = node.Children.filter(c => !isText(c));
        if (children.length !== 1)
            throw new XamlParseException(`${node.Type.Name} requires one root object.`, node.Line, node.Position);
        const templateType = node.Type.Name;
        const compilation = node.Attributes.find(a => isXamlNamespace(a.Namespace) && a.Name === 'CompileBindings');
        const dataType = node.Attributes.find(a => a.Name === 'DataType')?.Value;
        let baseUri = this._baseUris.at(-1) ?? this.Options.BaseUri ?? this.Options.SourceFile;
        const xmlBase = node.Attributes.find(a => a.Namespace === XamlNamespaces.Xml && a.Name === 'base');
        if (xmlBase) {
            try { baseUri = new URL(xmlBase.Value, baseUri ?? undefined).href; }
            catch { throw new XamlParseException('xml:base requires a valid URI and an absolute base URI.', xmlBase.Line, xmlBase.Position); }
        }
        const parentOptions = { ...this.Options,
            RootObject: this.Options.RootObject ?? this.RootObject,
            CompileBindings: compilation ? Controls.BooleanValue(compilation.Value) : this._UseCompiledBindings(this._parents.at(-1)),
            DataTypeContext: dataType ? {Name:dataType,Namespaces:node.Namespaces} : metadata.get(this._parents.at(-1))?.DataTypeContext ?? this.Options.DataTypeContext,
            BaseUri: baseUri, ParentProvider: this.CreateServiceProvider(this._parents.at(-1), null, node.Namespaces),
        }, resourceParent = this.RootObject;
        const build = (data, scope) => {
            const context = new XamlRuntimeContext({ ...parentOptions, NameScope: scope ?? new Controls.NameScope(), DataContext: data, ResourceParent: resourceParent });
            return context.Build(children[0]);
        };
        let template;
        if (templateType === 'ControlTemplate')
            template = new Controls.ControlTemplate((owner, scope) => {
                const context = new XamlRuntimeContext({ ...parentOptions, NameScope: scope, DataContext: owner.DataContext, ResourceParent: owner });
                try {
                    const result = context._BuildNode(children[0]);
                    for (const v of [result, ...result.GetVisualDescendants()]) v.TemplatedParent = owner;
                    return context.Complete(result);
                } catch (error) { context.Abort(); throw error; }
            });
        else if (templateType === 'ItemsPanelTemplate')
            template = new Controls.ItemsPanelTemplate(() => build(undefined));
        else if (templateType === 'TreeDataTemplate') {
            const attr = node.Attributes.find(a => a.Name === 'ItemsSource');
            const binding = attr ? this.Value(attr.CompiledValue ?? MarkupExtensionParser.Parse(attr.Value), this.RootObject, node.Namespaces) : new Data.Binding('Children');
            template = new Controls.TreeDataTemplate(data => build(data), data => Data.PropertyPath.Parse(binding.Path).reduce((o, s) => Data.ReadMember(o, s), data));
        }
        else
            template = new Controls.DataTemplate(data => build(data));
        metadata.set(template, { Namespaces: node.Namespaces, Node: node, Key: Base.UnsetValue });
        if (dataType) {
            const { Name, Namespace } = this.Registry.ResolveName(dataType, node.Namespaces);
            template.DataType = this.Registry.FindType(Name, Namespace)?.Type ?? null;
        }
        const key = node.Attributes.find(a => isXamlNamespace(a.Namespace) && a.Name === 'Key');
        if (key)
            metadata.get(template).Key = this.Value(key.CompiledValue ?? MarkupExtensionParser.Parse(key.Value), this.RootObject, node.Namespaces);
        return template;
    }
    _BuildNode(node, instance = null) {
        if (isText(node))
            return node.PreserveWhitespace ? node.Text : node.Text.replace(/\s+/g, ' ').trim();
        if (avaloniaNamespaces.includes(node.Type.XmlNamespace) && ['ControlTemplate', 'DataTemplate', 'TreeDataTemplate', 'ItemsPanelTemplate'].includes(node.Type.Name))
            return this.CreateTemplate(node);
        if (isXamlNamespace(node.Type.XmlNamespace) && ['String', 'Double', 'Single', 'Int32', 'Int64', 'Boolean', 'Null'].includes(node.Type.Name))
            return this.Scalar(node);
        if (isXamlNamespace(node.Type.XmlNamespace) && node.Type.Name === 'Array')
            return this.CreateArray(node, node.Children.map(c => this._BuildNode(c)));
        const directives = node.Children.filter(c => c.Type && isXamlNamespace(c.Type.XmlNamespace) && c.Type.Name === 'Arguments');
        if (directives.length > 1) throw new XamlParseException('Only one x:Arguments directive is allowed.', node.Line, node.Position);
        let arguments_ = [];
        if (directives.length) {
            this.BeginArguments();
            try { arguments_ = directives[0].Children.map(c => this._BuildNode(c)); }
            finally { this.EndArguments(); }
        }
        const object = instance ?? this.Create(node.Type.Name, node.Type.XmlNamespace, node, arguments_);
        this.Begin(object, node);
        for (const attribute of node.Attributes)
            this.Attribute(object, attribute, node.Namespaces);
        for (const child of node.Children) {
            if (directives.includes(child)) continue;
            if (child.Type?.Name.includes('.')) {
                if (child.Type.Name.startsWith('Design.'))
                    continue;
                const values = child.Children.map(c => this._BuildNode(c));
                this.Property(object, child.Type.Name, values, child);
            }
            else
                this.Content(object, this._BuildNode(child), child);
        }
        this.End(object);
        return object;
    }
    Complete(root) {
        if (this._disposed)
            throw new Error('A XAML context can only be completed once.');
        let pending = this._pendingValues.splice(0), errors = [];
        for (let pass = 0; pending.length && pass <= this._objects.length; pass++) {
            const next = [];
            errors = [];
            let progress = false;
            for (const action of pending)
                try {
                    action();
                    progress = true;
                }
                catch (e) {
                    next.push(action);
                    errors.push(e);
                }
            pending = next.concat(this._pendingValues.splice(0));
            if (!progress)
                break;
        }
        if (pending.length) {
            this._CleanupFailedBuild();
            throw new AggregateError(errors, 'One or more XAML references could not be resolved.');
        }
        this.Scope.Complete();
        try {
            for (const action of this._pendingBindings)
                action();
            for (const event of this._pendingEvents) {
                const codeBehind = this.Options.CodeBehind ?? root, handler = codeBehind?.[event.Handler];
                if (prohibited.has(event.Handler) || typeof handler !== 'function')
                    throw new XamlParseException(`Code-behind handler '${event.Handler}' was not provided.`);
                const lifetime = event.Event instanceof Controls.RoutedEvent ? event.Object.AddHandler(event.Event, (sender, args) => handler.call(codeBehind, sender, args)) : event.Event.Add((sender, args) => handler.call(codeBehind, sender, args));
                event.Object._lifetime?.Add(lifetime);
            }
        }
        catch (e) {
            this._CleanupFailedBuild();
            throw e;
        }
        const result = this._ScalarValue(root);
        this._disposed = true;
        this._objects.length = this._parents.length = this._baseUris.length = 0;
        this._pendingBindings.length = this._pendingEvents.length = 0;
        return result;
    }
    Abort() { this._CleanupFailedBuild(); }
    _CleanupFailedBuild() {
        const errors = [];
        for (const object of this._objects.splice(0).reverse())
            if (object !== this.Options.ExistingRoot) {
                try { object.Dispose?.(); } catch (error) { errors.push(error); }
            }
        this._pendingBindings.length = this._pendingEvents.length = this._pendingValues.length = 0;
        this._argumentDepth = 0;
        this._parents.length = this._baseUris.length = 0;
        this._disposed = true;
        this.Options.OnCleanupErrors?.(errors);
    }
    Build(ast) {
        try {
            return this.Complete(this._BuildNode(ast));
        }
        catch (e) {
            this._CleanupFailedBuild();
            throw e;
        }
    }
    Populate(instance, ast) {
        this.Options.ExistingRoot = instance;
        try { return this.Complete(this._BuildNode(ast, instance)); }
        catch (error) { this.Abort(); throw error; }
    }
}
export class AvaloniaXamlServices {
    constructor(options = {}) {
        this.Options = options;
    }
    CreateContext() {
        return new XamlRuntimeContext(this.Options);
    }
    Build(ast) {
        return this.CreateContext().Build(ast);
    }
    Populate(instance, ast) {
        return this.CreateContext().Populate(instance, ast);
    }
}
export class AvaloniaXamlCompiler extends XamlCompiler {
    constructor(options = {}) {
        super(new TransformerConfiguration(options.Registry ?? XamlTypeRegistry.Default, options));
        this.Options = options;
    }
    Compile(source, options = {}) {
        const compiled = super.Compile(source, { ...this.Options, ...options });
        const services = new AvaloniaXamlServices({ ...this.Options, ...options });
        compiled.Build = extra => services.Options ? new AvaloniaXamlServices({ ...services.Options, ...extra }).Build(compiled.Ast) : services.Build(compiled.Ast);
        compiled.Populate = (instance, extra) => new AvaloniaXamlServices({ ...services.Options, ...extra }).Populate(instance, compiled.Ast);
        return compiled;
    }
}
export class AvaloniaXamlLoader {
    static Load(xamlOrInstance, options = {}) {
        if (typeof xamlOrInstance !== 'string') {
            if (!options.Xaml)
                throw new TypeError('Load(instance) requires { Xaml } in the JavaScript runtime.');
            return new AvaloniaXamlCompiler(options).Compile(options.Xaml).Populate(xamlOrInstance, options);
        }
        return new AvaloniaXamlCompiler(options).Compile(xamlOrInstance).Build(options);
    }
    static Parse(xaml, options = {}) {
        return this.Load(xaml, options);
    }
    static async LoadAsync(url, options = {}) {
        const response = await fetch(url, { signal: options.Signal });
        if (!response.ok)
            throw new Error(`XAML request failed (${response.status}).`);
        return this.Load(await response.text(), { ...options, SourceFile: String(url) });
    }
}
export const AvaloniaRuntimeXamlLoader = AvaloniaXamlLoader;
