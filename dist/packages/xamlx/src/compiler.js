import { XamlXmlParser, XamlParseException, XamlAstObjectNode, XamlAstTextNode, MarkupExtensionParser, XamlNamespaces } from './parser.js';
export class XamlDiagnostic {
    constructor(code, message, node, severity = 'Error') {
        this.Code = code;
        this.Message = message;
        this.Line = node?.Line ?? 1;
        this.Position = node?.Position ?? 1;
        this.Severity = severity;
    }
}
export class XamlTypeSystem {
    constructor() {
        this._types = new Map();
        this._aliases = new Map();
        this._genericTypes = new Map();
        this._constructedTypes = new Map();
    }
    RegisterType(name, type, xmlNamespace = '', metadata = {}) {
        const descriptor = { Name: name, Type: type, XmlNamespace: xmlNamespace, ...metadata };
        this._types.set(`${xmlNamespace}|${name}`, descriptor);
        if (!this._aliases.has(name))
            this._aliases.set(name, descriptor);
        return descriptor;
    }
    FindType(name, xmlNamespace = '') {
        return this._types.get(`${xmlNamespace}|${name}`) ?? (xmlNamespace === '' ? this._aliases.get(name) : null) ?? null;
    }
    GetType(name, xmlNamespace = '') {
        const type = this.FindType(name, xmlNamespace);
        if (!type)
            throw new XamlParseException(`Type '${name}' in namespace '${xmlNamespace}' is not registered.`);
        return type;
    }
    RegisterGenericType(name, arity, factory, xmlNamespace = '', metadata = {}) {
        if (!Number.isInteger(arity) || arity < 1 || typeof factory !== 'function')
            throw new TypeError('Generic types require a positive arity and a constructor factory.');
        const descriptor = { Name: name, Arity: arity, Factory: factory, XmlNamespace: xmlNamespace, ...metadata };
        this._genericTypes.set(`${xmlNamespace}|${name}`, descriptor);
        return descriptor;
    }
    MakeGenericType(name, xmlNamespace, arguments_) {
        const definition = this._genericTypes.get(`${xmlNamespace}|${name}`);
        if (!definition || definition.Arity !== arguments_.length)
            throw new XamlParseException(`Generic type '${name}' with ${arguments_.length} argument(s) is not registered.`);
        let cache = this._constructedTypes.get(definition);
        if (!cache) this._constructedTypes.set(definition, cache = []);
        const existing = cache.find(x => x.TypeArguments.every((t, i) => t === arguments_[i]));
        if (existing) return existing;
        const type = definition.Factory(...arguments_);
        if (typeof type !== 'function') throw new XamlParseException(`Generic factory '${name}' did not return a constructor.`);
        const result = { ...definition, Type: type, TypeArguments: [...arguments_] };
        cache.push(result);
        return result;
    }
    get Types() {
        return [...this._types.values()];
    }
}
export class TransformerConfiguration {
    constructor(typeSystem = new XamlTypeSystem(), options = {}) {
        this.TypeSystem = typeSystem;
        this.Options = options;
        this.Transformers = [];
        this.CustomValueConverters = new Map();
        this.Diagnostics = [];
    }
}
export class XamlTransformContext {
    constructor(configuration, document) {
        this.Configuration = configuration;
        this.Document = document;
        this.Diagnostics = [];
        this.Parents = [];
    }
    ReportDiagnostic(diagnostic) {
        this.Diagnostics.push(diagnostic);
    }
}
export class XamlAstTransformer {
    Transform(context, node) {
        return node;
    }
    Visit(context, node) {
        let transformed = this.Transform(context, node);
        context.Parents.push(transformed);
        if (transformed.Children)
            transformed.Children = transformed.Children.map(child => this.Visit(context, child));
        context.Parents.pop();
        return transformed;
    }
}
export class XamlTypeReferenceResolver extends XamlAstTransformer {
    Transform(context, node) {
        if (node instanceof XamlAstObjectNode && !node.Type.Name.includes('.') && !node.Type.XmlNamespace.startsWith('http://schemas.microsoft.com/winfx/2006/xaml')) {
            const resolved = context.Configuration.TypeSystem.FindType(node.Type.Name, node.Type.XmlNamespace);
            if (!resolved)
                context.ReportDiagnostic(new XamlDiagnostic('XAML2001', `Unregistered type ${node.Type.Name} (${node.Type.XmlNamespace}).`, node));
        }
        return node;
    }
}
export class XamlMarkupExtensionTransformer extends XamlAstTransformer {
    Transform(context, node) {
        if (node.Attributes)
            for (const attribute of node.Attributes) {
                try {
                    attribute.CompiledValue = MarkupExtensionParser.Parse(attribute.Value);
                }
                catch (e) {
                    context.ReportDiagnostic(new XamlDiagnostic('XAML2002', e.message, attribute));
                }
            }
        return node;
    }
}
export class XamlCompiler {
    constructor(configuration = new TransformerConfiguration()) {
        this.Configuration = configuration;
        this.Transformers = [new XamlMarkupExtensionTransformer(), ...configuration.Transformers];
    }
    Parse(text, options = {}) {
        return XamlXmlParser.Parse(text, { ...this.Configuration.Options, ...options });
    }
    Transform(document) {
        const context = new XamlTransformContext(this.Configuration, document);
        for (const transformer of this.Transformers)
            document.Root = transformer.Visit ? transformer.Visit(context, document.Root) : transformer.Transform(context, document.Root);
        document.Diagnostics = context.Diagnostics;
        const errors = context.Diagnostics.filter(d => d.Severity === 'Error');
        if (errors.length)
            throw new AggregateError(errors.map(d => new XamlParseException(d.Message, d.Line, d.Position, document.SourceFile)), 'XAML transform failed.');
        return document;
    }
    Compile(source, options = {}) {
        const document = this.Transform(typeof source === 'string' ? this.Parse(source, options) : source);
        const code = new JavaScriptXamlEmitter().Emit(document, options);
        return new CompiledXaml(document, code);
    }
}
export class CompiledXaml {
    constructor(document, code) {
        this.Document = document;
        this.Ast = document.Root;
        this.JavaScript = code;
        this.Diagnostics = document.Diagnostics ?? [];
    }
    Build(context) {
        return context.Build(this.Ast);
    }
    Populate(instance, context) {
        return context.Populate(instance, this.Ast);
    }
}
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
/** AOT emits direct object-construction and member-assignment calls. No eval or Function constructor. */
export class JavaScriptXamlEmitter {
    Emit(document, options = {}) {
        let id = 0;
        const lines = [], literal = safeJson;
        const emit = (node, root = false) => {
            if ('Text' in node && !node.Type)
                return literal(node.PreserveWhitespace ? node.Text : node.Text.replace(/\s+/g, ' ').trim());
            const variable = `v${id++}`, name = node.Type.Name;
            if (['ControlTemplate', 'DataTemplate', 'TreeDataTemplate', 'ItemsPanelTemplate'].includes(name)) {
                lines.push(`  const ${variable} = ctx.CreateTemplate(${literal(node)});`);
                return variable;
            }
            if ([XamlNamespaces.Xaml2006, XamlNamespaces.Xaml2009].includes(node.Type.XmlNamespace) && ['String', 'Double', 'Single', 'Int32', 'Int64', 'Boolean', 'Null'].includes(name)) {
                lines.push(`  const ${variable} = ctx.Scalar(${literal(node)});`);
                return variable;
            }
            const directives = node.Children.filter(c => c.Type && [XamlNamespaces.Xaml2006, XamlNamespaces.Xaml2009].includes(c.Type.XmlNamespace) && c.Type.Name === 'Arguments');
            if (directives.length > 1) throw new XamlParseException('Only one x:Arguments directive is allowed.', node.Line, node.Position);
            let arguments_ = [];
            if (directives.length) {
                lines.push('  ctx.BeginArguments();');
                arguments_ = directives[0].Children.map(c => emit(c));
                lines.push('  ctx.EndArguments();');
            }
            if ([XamlNamespaces.Xaml2006, XamlNamespaces.Xaml2009].includes(node.Type.XmlNamespace) && name === 'Array') {
                const values = node.Children.map(c => emit(c));
                lines.push(`  const ${variable} = ctx.CreateArray(${literal(node)}, [${values.join(', ')}]);`);
                return variable;
            }
            lines.push(`  const ${variable} = ${root ? 'instance ?? ' : ''}ctx.Create(${literal(node.Type.Name)}, ${literal(node.Type.XmlNamespace)}, ${literal(node)}, [${arguments_.join(', ')}]);`);
            lines.push(`  ctx.Begin(${variable}, ${literal(node)});`);
            for (const attr of node.Attributes)
                lines.push(`  ctx.Attribute(${variable}, ${literal(attr)}, ${literal(node.Namespaces)});`);
            for (const child of node.Children) {
                if (directives.includes(child)) continue;
                if (child.Type?.Name.includes('.')) {
                    const values = child.Children.map(c => emit(c));
                    lines.push(`  ctx.Property(${variable}, ${literal(child.Type.Name)}, [${values.join(', ')}], ${literal(child)});`);
                }
                else {
                    const value = emit(child);
                    lines.push(`  ctx.Content(${variable}, ${value}, ${literal(child)});`);
                }
            }
            lines.push(`  ctx.End(${variable});`);
            return variable;
        };
        const root = emit(document.Root, true);
        return `// Generated by XamlX JavaScript emitter. Source: ${String(document.SourceFile ?? '').replace(/[\r\n]/g, ' ')}\nexport const SourceFile = ${literal(document.SourceFile ?? '')};\nexport function Build(services, instance = null) {\n  const ctx = services.CreateContext ? services.CreateContext() : services;\n  ctx.Options.ExistingRoot = instance;\n  try {\n${lines.join('\n')}\n  return ctx.Complete(${root});\n  } catch (error) { ctx.Abort(); throw error; }\n}\nexport function Populate(instance, services) { return Build(services, instance); }\nexport default Build;\n`;
    }
}
