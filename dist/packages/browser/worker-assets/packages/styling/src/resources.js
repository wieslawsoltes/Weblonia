import { AvaloniaDictionary, AvaloniaList, Event, CompositeDisposable, Disposable, UnsetValue } from "../../base/src/index.js";
import { Observable } from "../../../vendor/rxjs.js";
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
export class ResourceDictionary extends AvaloniaDictionary {
    constructor(values) {
        super(values);
        this.ResourcesChanged = new Event();
        this.MergedDictionaries = new AvaloniaList();
        this.ThemeDictionaries = new AvaloniaDictionary();
        this.Owner = null;
        this._children = new CompositeDisposable();
        this.CollectionChanged.Add(() => this._notify());
        this.MergedDictionaries.CollectionChanged.Add(() => this._rewire());
        this.ThemeDictionaries.CollectionChanged.Add(() => this._rewire());
    }
    _notify() {
        this.ResourcesChanged.Raise(this, {});
        this.Owner?.OnResourcesChanged?.();
    }
    _rewire() {
        this._children.Clear();
        for (const dictionary of [...this.MergedDictionaries, ...this.ThemeDictionaries.values()])
            if (dictionary?.ResourcesChanged)
                this._children.Add(dictionary.ResourcesChanged.Add(() => this._notify()));
        this._notify();
    }
    TryGetResource(key, theme = ThemeVariant.Default, visited = new Set()) {
        if (visited.has(this))
            return { Found: false, Value: UnsetValue };
        visited.add(this);
        if (this.has(key))
            return { Found: true, Value: this.get(key) };
        let variant = ThemeVariant.Parse(theme ?? ThemeVariant.Default);
        const variants = new Set();
        while (variant && !variants.has(variant.Key)) {
            variants.add(variant.Key);
            const dictionary = this.ThemeDictionaries.get(variant.Key) ?? this.ThemeDictionaries.get(variant);
            const result = dictionary?.TryGetResource(key, variant, visited);
            if (result?.Found)
                return result;
            variant = variant.InheritVariant;
        }
        const fallback = this.ThemeDictionaries.get('Default') ?? this.ThemeDictionaries.get(ThemeVariant.Default);
        const result = fallback?.TryGetResource(key, theme, visited);
        if (result?.Found)
            return result;
        for (const dictionary of this.MergedDictionaries.ToArray().reverse()) {
            const found = dictionary.TryGetResource(key, theme, visited);
            if (found.Found)
                return found;
        }
        return { Found: false, Value: UnsetValue };
    }
    GetResource(key, theme) {
        const result = this.TryGetResource(key, theme);
        if (!result.Found)
            throw new Error(`Resource '${String(key)}' was not found.`);
        return result.Value;
    }
    Dispose() {
        this._children.Dispose();
        this.ResourcesChanged.Clear();
    }
}
export function TryFindResource(control, key, theme = control?.ActualThemeVariant ?? ResourceEnvironment.Application?.ActualThemeVariant ?? ResourceEnvironment.SystemTheme, extra = null) {
    const extraResult = extra?.TryGetResource?.(key, theme);
    if (extraResult?.Found)
        return extraResult;
    const visited = new Set();
    for (let node = control; node && !visited.has(node); node = node.Parent ?? node.VisualParent ?? node.TemplatedParent) {
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
        const lifetime = new CompositeDisposable(), subscriptions = new CompositeDisposable();
        lifetime.Add(subscriptions);
        const emit = () => observer.next(TryFindResource(control, key, undefined, extra).Value);
        const wire = () => {
            subscriptions.Clear();
            const seen = new Set();
            const watch = owner => {
                if (!owner || seen.has(owner))
                    return;
                seen.add(owner);
                if (owner.ResourcesChanged?.Add)
                    subscriptions.Add(owner.ResourcesChanged.Add(emit));
                if (owner.Resources?.ResourcesChanged?.Add)
                    subscriptions.Add(owner.Resources.ResourcesChanged.Add(emit));
                if (owner.Styles?.ResourcesChanged?.Add)
                    subscriptions.Add(owner.Styles.ResourcesChanged.Add(emit));
                if (owner.PropertyChanged?.Add)
                    subscriptions.Add(owner.PropertyChanged.Add((_, e) => {
                        if (['ActualThemeVariant', 'RequestedThemeVariant'].includes(e.PropertyName))
                            emit();
                    }));
            };
            for (let node = control; node && !seen.has(node); node = node.Parent ?? node.VisualParent ?? node.TemplatedParent)
                watch(node);
            watch(ResourceEnvironment.Application);
            watch(extra);
            emit();
        };
        if (control.AttachedToVisualTree?.Add)
            lifetime.Add(control.AttachedToVisualTree.Add(wire));
        wire();
        return () => lifetime.Dispose();
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
