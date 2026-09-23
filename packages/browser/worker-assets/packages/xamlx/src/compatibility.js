import { XamlNamespaces, XamlParseException } from './parser.js';

/** The semantic part of XamlX's CompatibleXmlReader, applied to a fully checked
 * XML tree before extension parsing, construction or emission. Only one mapping
 * step is performed, as in upstream. Prefix scopes never escape their element.
 * This is not an implementation of OpenXML AlternateContent/PreserveElements.
 */
export function ApplyXamlCompatibility(document, options = {}) {
    const source = options.CompatibleNamespaces;
    if (source != null && !(source instanceof Map) &&
        (typeof source !== 'object' || Array.isArray(source)))
        throw new TypeError('CompatibleNamespaces must be a Map or namespace dictionary.');
    const mappings = new Map(source instanceof Map ? source : Object.entries(source ?? {}));
    const reserved = new Set([XamlNamespaces.Xml, XamlNamespaces.Compatibility, 'http://www.w3.org/2000/xmlns/']);
    for (const [from, to] of mappings) {
        if (typeof from !== 'string' || typeof to !== 'string')
            throw new TypeError('CompatibleNamespaces keys and values must be strings.');
        if ((reserved.has(from) || reserved.has(to)) && from !== to)
            throw new TypeError('Reserved XML namespaces cannot be remapped.');
    }
    const known = new Set(mappings.values());
    const mapped = ns => mappings.get(ns) ?? ns;
    const fail = (message, node) => { throw new XamlParseException(message, node.Line, node.Position, document.SourceFile); };
    const visit = (node, inherited) => {
        if (!node.Type) return node;
        if (inherited.has(mapped(node.Type.XmlNamespace)) && !known.has(mapped(node.Type.XmlNamespace))) return null;
        let ignored = inherited;
        const attributes = node.Attributes ?? [];
        // Resolve Ignorable where it is declared, including aliases declared later
        // in the start tag. Store URIs, not mutable lexical prefix spellings.
        for (const attr of attributes) {
            if (attr.Namespace !== XamlNamespaces.Compatibility) continue;
            if (attr.Name !== 'Ignorable') fail(`Markup compatibility directive '${attr.Name}' is not implemented.`, attr);
            ignored = new Set(inherited);
            for (const prefix of attr.Value.split(/[ \t\r\n]+/).filter(Boolean)) {
                if (!Object.hasOwn(node.Namespaces, prefix))
                    fail(`Undeclared ignorable namespace prefix '${prefix}'.`, attr);
                ignored.add(mapped(node.Namespaces[prefix]));
            }
        }
        const skip = ns => ignored.has(mapped(ns)) && !known.has(mapped(ns));
        if (skip(node.Type.XmlNamespace)) return null;
        if (node.Type.XmlNamespace === XamlNamespaces.Compatibility)
            fail(`Markup compatibility element '${node.Type.Name}' is not implemented.`, node);
        // Most documents have no compatibility mappings. Preserve their existing
        // lexical tables and attribute arrays rather than allocating copies.
        if (mappings.size) {
            node.Type.XmlNamespace = mapped(node.Type.XmlNamespace);
            node.Namespaces = Object.fromEntries(Object.entries(node.Namespaces).map(([key, value]) => [key, mapped(value)]));
        }
        if (ignored.size || attributes.some(attr => attr.Namespace === XamlNamespaces.Compatibility))
            node.Attributes = attributes.filter(attr => attr.Namespace !== XamlNamespaces.Compatibility && !skip(attr.Namespace));
        if (mappings.size) {
            const expanded = new Set();
            for (const attr of node.Attributes) {
                attr.Namespace = mapped(attr.Namespace);
                const key = `${attr.Namespace}|${attr.Name}`;
                if (expanded.has(key)) fail(`Duplicate expanded attribute '${attr.Name}' after namespace mapping.`, attr);
                expanded.add(key);
            }
        }
        const children = node.Children; let count = 0;
        for (let index = 0; index < children.length; index++) {
            const result = visit(children[index], ignored);
            if (result) children[count++] = result;
        }
        children.length = count;
        return node;
    };
    const root = visit(document.Root, new Set());
    if (!root) fail('The XAML root element cannot be ignorable.', document.Root);
    document.Root = root;
    document.NamespaceAliases = root.Namespaces;
    return document;
}
