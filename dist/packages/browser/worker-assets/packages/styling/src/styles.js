import { AvaloniaList, AvaloniaProperty, BindingPriority, CompositeDisposable, Disposable, Event, UnsetValue } from "../../base/src/index.js";
import { BindingBase, BindingOperations } from "../../data/src/index.js";
import { Selector, Selectors } from './selectors.js';
import { ResourceDictionary, ResourceEnvironment, StaticResourceExtension, DynamicResourceExtension, FindResource } from './resources.js';
let styleId = 0;
export class Setter {
    constructor(property = null, value = null) {
        this.Property = property;
        this.Value = value;
    }
    Apply(target, priority, resources = null, order = undefined) {
        let property = this.Property instanceof AvaloniaProperty ? this.Property : AvaloniaProperty.FindRegistered(target, String(this.Property));
        if (!property && typeof this.Property === 'string' && this.Property.includes('.')) {
            const [owner, name] = this.Property.split('.');
            for (const [type, properties] of AvaloniaProperty.Registry)
                if (type.name === owner) {
                    property = properties.get(name);
                    break;
                }
        }
        if (!property)
            throw new Error(`Style setter '${String(this.Property)}' is not registered on ${target.constructor.name}.`);
        let value = this.Value;
        if (value instanceof DynamicResourceExtension)
            return value.BindTo(target, property, priority, resources, order);
        if (value instanceof StaticResourceExtension)
            value = FindResource(target, value.ResourceKey, undefined, resources);
        if (value instanceof BindingBase) {
            const clone = Object.assign(Object.create(Object.getPrototypeOf(value)), value);
            clone.Priority = priority;
            return BindingOperations.Apply(target, property, clone, priority);
        }
        const metadata = property.GetMetadata(target);
        if (metadata.Convert && value !== UnsetValue)
            value = metadata.Convert(value);
        if (property.IsDirect) {
            target.SetValue(property, value);
            return Disposable.Empty;
        }
        return target._SetPriorityValue(property, value, priority, Symbol('Setter'), order);
    }
}
export class Style {
    constructor(selector = null) {
        this.Id = ++styleId;
        this.Version = 0;
        this.Selector = typeof selector === 'function' ? selector(Selectors) : selector instanceof Selector ? selector : selector ? new Selector(selector) : null;
        this.Setters = new AvaloniaList();
        this.Children = new AvaloniaList();
        this.Resources = new ResourceDictionary();
        this.Changed = new Event();
        this.Setters.CollectionChanged.Add(() => this._changed());
        this.Children.CollectionChanged.Add(() => this._changed());
        this.Resources.ResourcesChanged.Add(() => this._changed());
    }
    _changed() {
        this.Version++;
        this.Changed.Raise(this, {});
    }
    TryGetResource(key, theme) {
        return this.Resources.TryGetResource(key, theme);
    }
}
export class Styles extends AvaloniaList {
    constructor(items = []) {
        super(items);
        this.Resources = new ResourceDictionary();
        this.ResourcesChanged = new Event();
        this.Owner = null;
        this.Version = 0;
        this._subscriptions = new CompositeDisposable();
        this.Resources.ResourcesChanged.Add(() => this._stylesChanged());
        this.CollectionChanged.Add(() => this._rewire());
        this._rewire();
    }
    _stylesChanged() {
        this.Version++;
        this.ResourcesChanged.Raise(this, {});
        this.Owner?.InvalidateStyles?.(true);
    }
    _rewire() {
        this._subscriptions.Clear();
        for (const style of this)
            if (style.Changed)
                this._subscriptions.Add(style.Changed.Add(() => this._stylesChanged()));
        this._stylesChanged();
    }
    TryGetResource(key, theme) {
        const own = this.Resources.TryGetResource(key, theme);
        if (own.Found)
            return own;
        for (const style of this.ToArray().reverse()) {
            const result = style.TryGetResource?.(key, theme);
            if (result?.Found)
                return result;
        }
        return { Found: false, Value: UnsetValue };
    }
    Dispose() {
        this._subscriptions.Dispose();
        this.Resources.Dispose();
        this.ResourcesChanged.Clear();
    }
}
export class ControlTheme extends Style {
    constructor(targetType = null) {
        super();
        this.TargetType = targetType;
        this.BasedOn = null;
    }
}
function appendStyle(result, style, owner, prefix = null, conditions = []) {
    if (style.IsContainerQuery) {
        for (const child of style.Children) appendStyle(result, child, owner, prefix, [...conditions, style]);
        return;
    }
    if (style instanceof Styles) {
        for (const child of style)
            appendStyle(result, child, owner, prefix, conditions);
        return;
    }
    let selector = style.Selector;
    if (prefix && selector)
        selector = new Selector(selector.Text.includes('^') ? selector.Text.replaceAll('^', prefix.Text) : `${prefix.Text} ${selector.Text}`);
    result.push({ Style: style, Owner: owner, Selector: selector, Conditions: conditions });
    for (const child of style.Children ?? [])
        appendStyle(result, child, owner, selector, conditions);
}
function appendTheme(result, theme, owner, seen = new Set()) {
    if (!theme || seen.has(theme))
        return;
    seen.add(theme);
    appendTheme(result, theme.BasedOn, owner, seen);
    result.push({ Style: theme, Owner: owner, Selector: null, OnlyOwner: true });
    for (const child of theme.Children)
        appendStyle(result, child, owner);
}
export class Styler {
    static Current = new Styler();
    ApplyStyles(control) {
        control._containerQueryLifetime?.Dispose();
        control._containerQueryLifetime = new CompositeDisposable();
        const queryMatches = new Map();
        const rules = [];
        const app = ResourceEnvironment.Application;
        if (app?.Styles)
            for (const style of app.Styles)
                appendStyle(rules, style, null);
        const ancestors = [];
        const seen = new Set();
        for (let node = control; node && !seen.has(node); node = node.Parent ?? node.VisualParent) {
            seen.add(node);
            ancestors.push(node);
        }
        for (const node of ancestors.reverse()) {
            if (node.Theme)
                appendTheme(rules, node.Theme, node);
            if (node.Styles)
                for (const style of node.Styles)
                    appendStyle(rules, style, node);
        }
        control._styleAttachments ??= new Map();
        const alive = new Set();
        let ordinal = 0;
        for (const rule of rules) {
            const { Style: style, Owner: owner, Selector: selector } = rule;
            const key = `${style.Id}:${owner?.VisualId ?? 0}`;
            alive.add(key);
            ordinal++;
            let matches = rule.OnlyOwner ? control === owner : selector ? selector.Match(control, owner) : true;
            for (const query of rule.Conditions ?? []) {
                if (!queryMatches.has(query)) queryMatches.set(query, query.Match(control, control._containerQueryLifetime));
                matches = matches && queryMatches.get(query);
            }
            const previous = control._styleAttachments.get(key);
            if (previous && previous.Active === matches && previous.Version === style.Version && previous.Order === ordinal)
                continue;
            previous?.Lifetime.Dispose();
            control._styleAttachments.delete(key);
            const attachment = { Active: matches, Version: style.Version, Order: ordinal, Lifetime: new CompositeDisposable() };
            control._styleAttachments.set(key, attachment);
            if (matches) {
                const priority = selector?.IsConditional || rule.Conditions?.length ? BindingPriority.StyleTrigger : BindingPriority.Style;
                let setterIndex = 0;
                for (const setter of style.Setters)
                    attachment.Lifetime.Add(setter.Apply(control, priority, style.Resources, ordinal * 10000 + setterIndex++));
            }
        }
        for (const [key, attachment] of control._styleAttachments)
            if (!alive.has(key)) {
                attachment.Lifetime.Dispose();
                control._styleAttachments.delete(key);
            }
        control._stylesDirty = false;
    }
    Detach(control) {
        control._containerQueryLifetime?.Dispose();
        control._containerQueryLifetime = null;
        for (const attachment of control._styleAttachments?.values() ?? [])
            attachment.Lifetime.Dispose();
        control._styleAttachments?.clear();
    }
}
