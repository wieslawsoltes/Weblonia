export class XamlParseException extends SyntaxError {
    constructor(message, line = 1, column = 1, source = '') {
        super(`${source ? source + ':' : ''}${line}:${column}: ${message}`);
        this.name = 'XamlParseException';
        this.Line = line;
        this.Position = column;
        this.SourceFile = source;
        this.DiagnosticCode = 'XAML1001';
    }
}
export class XamlAstNode {
    constructor(line = 1, position = 1) {
        this.Line = line;
        this.Position = position;
    }
}
export class XamlAstXmlTypeReference extends XamlAstNode {
    constructor(xmlNamespace, name, line, position) {
        super(line, position);
        this.XmlNamespace = xmlNamespace;
        this.Name = name;
        this.GenericArguments = [];
    }
}
export class XamlAstTextNode extends XamlAstNode {
    constructor(text, line, position, preserveWhitespace = false) {
        super(line, position);
        this.Text = text;
        this.PreserveWhitespace = preserveWhitespace;
    }
}
export class XamlAstObjectNode extends XamlAstNode {
    constructor(type, line, position) {
        super(line, position);
        this.Type = type;
        this.Attributes = [];
        this.Children = [];
        this.Namespaces = {};
        this.Directives = {};
    }
}
export class XamlAstXamlPropertyValueNode extends XamlAstNode {
    constructor(owner, name, values = [], line, position) {
        super(line, position);
        this.Owner = owner;
        this.Name = name;
        this.Values = values;
    }
}
export class XamlDocument {
    constructor(root, source = '') {
        this.Root = root;
        this.SourceFile = source;
        this.NamespaceAliases = root.Namespaces;
    }
}
export const XamlNamespaces = Object.freeze({ Xaml2006: 'http://schemas.microsoft.com/winfx/2006/xaml', Xaml2009: 'http://schemas.microsoft.com/winfx/2009/xaml', Xml: 'http://www.w3.org/XML/1998/namespace', Design: 'http://schemas.microsoft.com/expression/blend/2008', Compatibility: 'http://schemas.openxmlformats.org/markup-compatibility/2006' });
/** XML parser with source locations, namespace scopes and explicit input limits. No DTD/entity fetches. */
export class XamlXmlParser {
    static Parse(text, options = {}) {
        return new XamlXmlParser(options).Parse(text);
    }
    constructor(options = {}) {
        this.Options = { MaxCharacters: 4 * 1024 * 1024, MaxDepth: 128, MaxNodes: 100000, ...options };
    }
    Parse(input) {
        const text = String(input);
        if (text.length > this.Options.MaxCharacters)
            throw new XamlParseException('XAML exceeds the configured character limit.');
        let i = 0, line = 1, column = 1, nodes = 0, root = null;
        const stack = [];
        const error = message => {
            throw new XamlParseException(message, line, column, this.Options.SourceFile);
        };
        const advance = n => {
            for (let c = 0; c < n; c++) {
                if (text[i++] === '\n') {
                    line++;
                    column = 1;
                }
                else
                    column++;
            }
        };
        const whitespace = () => {
            while (i < text.length && /\s/.test(text[i]))
                advance(1);
        };
        const name = () => {
            const match = /^[A-Za-z_\p{L}][\w.\-:\p{L}\p{N}]*/u.exec(text.slice(i));
            if (!match)
                error('Expected an XML name.');
            advance(match[0].length);
            return match[0];
        };
        const decode = value => {
            if (/&(?![^&;\s]+;)/.test(value))
                error('Unescaped ampersand in XML content.');
            return value.replace(/&([^;]+);/g, (_, entity) => {
                const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
                if (Object.hasOwn(known, entity))
                    return known[entity];
                if (/^#(?:x[0-9a-f]+|\d+)$/i.test(entity)) {
                    const cp = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
                    if (cp <= 0 || cp > 0x10FFFF || cp >= 0xD800 && cp <= 0xDFFF)
                        error('Invalid XML character reference.');
                    return String.fromCodePoint(cp);
                }
                error(`Entity '&${entity};' is not allowed.`);
            });
        };
        const appendText = (value, atLine, atColumn, cdata = false) => {
            if (!stack.length) {
                if (value.trim())
                    error('Text is not allowed outside the root element.');
                return;
            }
            const parent = stack.at(-1);
            const decoded = cdata ? value : decode(value);
            if (decoded.trim() || parent.PreserveWhitespace) {
                if (++nodes > this.Options.MaxNodes)
                    error('XAML exceeds the configured node limit.');
                parent.Node.Children.push(new XamlAstTextNode(decoded, atLine, atColumn, parent.PreserveWhitespace));
            }
        };
        while (i < text.length) {
            if (text[i] !== '<') {
                const end = text.indexOf('<', i), length = (end < 0 ? text.length : end) - i, l = line, c = column, value = text.slice(i, i + length);
                advance(length);
                appendText(value, l, c);
                continue;
            }
            if (text.startsWith('<!--', i)) {
                const end = text.indexOf('-->', i + 4);
                if (end < 0)
                    error('Unterminated XML comment.');
                if (text.slice(i + 4, end).includes('--'))
                    error('Invalid XML comment.');
                advance(end + 3 - i);
                continue;
            }
            if (text.startsWith('<![CDATA[', i)) {
                const end = text.indexOf(']]>', i + 9);
                if (end < 0)
                    error('Unterminated CDATA section.');
                const l = line, c = column, value = text.slice(i + 9, end);
                advance(end + 3 - i);
                appendText(value, l, c, true);
                continue;
            }
            if (text.startsWith('<?', i)) {
                const end = text.indexOf('?>', i + 2);
                if (end < 0)
                    error('Unterminated processing instruction.');
                advance(end + 2 - i);
                continue;
            }
            if (text.startsWith('<!', i))
                error('DOCTYPE and external entity declarations are prohibited.');
            if (text.startsWith('</', i)) {
                advance(2);
                const closeName = name();
                whitespace();
                if (text[i] !== '>')
                    error('Expected closing >.');
                advance(1);
                const current = stack.pop();
                if (!current || current.QualifiedName !== closeName)
                    error(`Mismatched closing element '${closeName}'.`);
                continue;
            }
            const atLine = line, atColumn = column;
            advance(1);
            const qualifiedName = name(), attrs = [];
            whitespace();
            const rawNames = new Set();
            while (i < text.length && text[i] !== '>' && !text.startsWith('/>', i)) {
                const l = line, c = column, qname = name();
                if (rawNames.has(qname))
                    error(`Duplicate attribute '${qname}'.`);
                rawNames.add(qname);
                whitespace();
                if (text[i] !== '=')
                    error('Expected attribute =.');
                advance(1);
                whitespace();
                const quote = text[i];
                if (quote !== '"' && quote !== "'")
                    error('XML attribute values must be quoted.');
                advance(1);
                const end = text.indexOf(quote, i);
                if (end < 0)
                    error('Unterminated attribute value.');
                const raw = text.slice(i, end);
                if (raw.includes('<'))
                    error('XML attribute values cannot contain <.');
                const value = decode(raw);
                advance(end - i + 1);
                attrs.push({ QualifiedName: qname, Value: value, Line: l, Position: c });
                whitespace();
            }
            const namespaces = { xml: XamlNamespaces.Xml, ...(stack.at(-1)?.Node.Namespaces ?? {}) };
            for (const attr of attrs)
                if (attr.QualifiedName === 'xmlns')
                    namespaces[''] = attr.Value;
                else if (attr.QualifiedName.startsWith('xmlns:'))
                    namespaces[attr.QualifiedName.slice(6)] = attr.Value;
            const resolveName = (q, attribute = false) => {
                const index = q.indexOf(':'), prefix = index < 0 ? '' : q.slice(0, index), local = index < 0 ? q : q.slice(index + 1);
                if (prefix && !Object.hasOwn(namespaces, prefix))
                    error(`Undeclared XML namespace prefix '${prefix}'.`);
                return { Namespace: attribute && !prefix ? '' : namespaces[prefix] ?? '', Name: local, Prefix: prefix };
            };
            const elementName = resolveName(qualifiedName), node = new XamlAstObjectNode(new XamlAstXmlTypeReference(elementName.Namespace, elementName.Name, atLine, atColumn), atLine, atColumn);
            node.Namespaces = namespaces;
            const expandedAttributes = new Set();
            let preserveWhitespace = stack.at(-1)?.PreserveWhitespace ?? false;
            for (const attr of attrs) {
                if (attr.QualifiedName === 'xmlns' || attr.QualifiedName.startsWith('xmlns:'))
                    continue;
                Object.assign(attr, resolveName(attr.QualifiedName, true));
                const expanded = `${attr.Namespace}|${attr.Name}`;
                if (expandedAttributes.has(expanded))
                    error(`Duplicate expanded attribute '${attr.Name}'.`);
                expandedAttributes.add(expanded);
                if (attr.Namespace === XamlNamespaces.Xml && attr.Name === 'space')
                    preserveWhitespace = attr.Value === 'preserve';
                node.Attributes.push(attr);
            }
            if (++nodes > this.Options.MaxNodes)
                error('XAML exceeds the configured node limit.');
            if (stack.length >= this.Options.MaxDepth)
                error('XAML exceeds the configured nesting limit.');
            if (stack.length)
                stack.at(-1).Node.Children.push(node);
            else {
                if (root)
                    error('XAML must have exactly one root element.');
                root = node;
            }
            if (text.startsWith('/>', i))
                advance(2);
            else if (text[i] === '>') {
                advance(1);
                stack.push({ Node: node, QualifiedName: qualifiedName, PreserveWhitespace: preserveWhitespace });
            }
            else
                error('Unterminated element.');
        }
        if (stack.length)
            error(`Unclosed element '${stack.at(-1).QualifiedName}'.`);
        if (!root)
            error('XAML has no root element.');
        return new XamlDocument(root, this.Options.SourceFile);
    }
}
export class MarkupExtensionParser {
    static Parse(value, depth = 0) {
        const s = String(value).trim();
        if (s.startsWith('{}'))
            return s.slice(2);
        if (!s.startsWith('{'))
            return value;
        if (depth > 32)
            throw new XamlParseException('Markup extension nesting exceeds 32.');
        if (!s.endsWith('}'))
            throw new XamlParseException('Unterminated markup extension.');
        const body = s.slice(1, -1).trim(), match = /^([^\s,]+)([\s\S]*)$/.exec(body);
        if (!match)
            throw new XamlParseException('Empty markup extension.');
        const result = { Kind: 'MarkupExtension', Name: match[1], PositionalArguments: [], NamedArguments: {} };
        const parts = [];
        let start = 0, braces = 0, quote = null;
        const rest = match[2].trim().replace(/^,\s*/, '');
        for (let i = 0; i <= rest.length; i++) {
            const c = rest[i];
            if (quote) {
                if (c === quote && rest[i - 1] !== '\\')
                    quote = null;
            }
            else if (c === '"' || c === "'")
                quote = c;
            else if (c === '{')
                braces++;
            else if (c === '}') {
                if (--braces < 0)
                    throw new XamlParseException('Unbalanced markup extension.');
            }
            else if ((!braces && c === ',') || i === rest.length) {
                const part = rest.slice(start, i).trim();
                if (part)
                    parts.push(part);
                start = i + 1;
            }
        }
        if (braces || quote)
            throw new XamlParseException('Unbalanced markup extension arguments.');
        const parse = raw => {
            if ((raw[0] === '"' || raw[0] === "'") && raw.at(-1) === raw[0])
                return raw.slice(1, -1);
            return raw.startsWith('{') ? this.Parse(raw, depth + 1) : raw;
        };
        for (const part of parts) {
            let equals = -1, level = 0, q = null;
            for (let i = 0; i < part.length; i++) {
                const c = part[i];
                if (q) {
                    if (c === q && part[i - 1] !== '\\')
                        q = null;
                }
                else if (c === "'" || c === '"')
                    q = c;
                else if (c === '{')
                    level++;
                else if (c === '}')
                    level--;
                else if (c === '=' && !level) {
                    equals = i;
                    break;
                }
            }
            if (equals > 0) {
                const key = part.slice(0, equals).trim();
                if (Object.hasOwn(result.NamedArguments, key))
                    throw new XamlParseException(`Duplicate markup argument '${key}'.`);
                result.NamedArguments[key] = parse(part.slice(equals + 1).trim());
            }
            else
                result.PositionalArguments.push(parse(part));
        }
        return result;
    }
}
