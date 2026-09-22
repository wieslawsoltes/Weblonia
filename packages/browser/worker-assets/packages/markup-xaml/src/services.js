/** Interface tokens preserve Avalonia's service names without pretending that
 * JavaScript has CLR interface identity or reflection PropertyInfo objects. */
export const IServiceProvider = Symbol.for('System.IServiceProvider');
export const IProvideValueTarget = Symbol.for('Avalonia.Markup.Xaml.IProvideValueTarget');
export const IRootObjectProvider = Symbol.for('Avalonia.Markup.Xaml.IRootObjectProvider');
export const IUriContext = Symbol.for('Avalonia.Markup.Xaml.IUriContext');
export const IXamlTypeResolver = Symbol.for('Avalonia.Markup.Xaml.IXamlTypeResolver');
export const IAvaloniaXamlIlParentStackProvider = Symbol.for('Avalonia.Markup.Xaml.XamlIl.Runtime.IAvaloniaXamlIlParentStackProvider');
export const IAvaloniaXamlIlEagerParentStackProvider = Symbol.for('Avalonia.Markup.Xaml.XamlIl.Runtime.IAvaloniaXamlIlEagerParentStackProvider');
const services = new Map(Object.entries({ IServiceProvider, IProvideValueTarget, IRootObjectProvider, IUriContext,
    IXamlTypeResolver, IAvaloniaXamlIlParentStackProvider, IAvaloniaXamlIlEagerParentStackProvider }));
const tokens = new Set(services.values());

/** A per-call snapshot, safe to retain while siblings/templates are constructed.
 * Parents is nearest-first; DirectParentsStack is outermost-first, like XamlX.
 * Unknown services delegate to the caller, never to ambient application state. */
export class XamlServiceProvider {
    constructor(context, target, property, namespaces) {
        this.TargetObject = target; this.TargetProperty = property;
        this.RootObject = context.Options.RootObject ?? context.RootObject;
        this.IntermediateRootObject = context.RootObject;
        this.NameScope = context.Scope; this.Registry = context.Registry;
        this.BaseUri = context._baseUris.at(-1) ?? context.Options.BaseUri ?? context.Options.SourceFile ?? null;
        this.ParentProvider = context.Options.ParentProvider ?? null;
        const stack = context._parents.slice();
        if (target != null && stack.at(-1) !== target) stack.push(target);
        this.DirectParentsStack = Object.freeze(stack);
        const parents = [...stack].reverse();
        if (this.ParentProvider) parents.push(...this.ParentProvider.Parents);
        this.Parents = Object.freeze(parents);
        this.XmlNamespaces = Object.freeze({ ...namespaces });
        this._fallback = context.Options.ServiceProvider ?? null;
        this._services = context.Options.Services ?? null;
    }
    GetService(type) {
        if (tokens.has(type) || typeof type === 'string' && (services.has(type) || tokens.has(Symbol.for(type)))) return this;
        if (type === this.NameScope?.constructor || type === 'INameScope' || type === 'Avalonia.Controls.INameScope') return this.NameScope;
        if (this._services instanceof Map && this._services.has(type)) return this._services.get(type);
        return this._fallback?.GetService?.(type) ?? null;
    }
    Resolve(qualifiedTypeName) { return this.Registry.ResolveType(qualifiedTypeName, this.XmlNamespaces); }
}
