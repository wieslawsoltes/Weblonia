import { AvaloniaProperty } from "../../base/src/index.js";
function splitOutside(text, separator) {
    const result = [];
    let depth = 0, quote = null, start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            if (c === quote && text[i - 1] !== '\\')
                quote = null;
            continue;
        }
        if (c === '"' || c === "'")
            quote = c;
        else if (c === '(' || c === '[')
            depth++;
        else if (c === ')' || c === ']')
            depth--;
        else if (depth === 0 && c === separator) {
            result.push(text.slice(start, i).trim());
            start = i + 1;
        }
    }
    result.push(text.slice(start).trim());
    return result.filter(Boolean);
}
function parseSequence(text) {
    const parts = [];
    let buffer = '', depth = 0, quote = null, relation = null;
    const flush = () => {
        if (buffer.trim()) {
            parts.push({ Simple: buffer.trim(), Relation: relation });
            buffer = '';
            relation = ' ';
        }
    };
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            buffer += c;
            if (c === quote && text[i - 1] !== '\\')
                quote = null;
            continue;
        }
        if (c === '"' || c === "'") {
            quote = c;
            buffer += c;
            continue;
        }
        if (c === '[' || c === '(') {
            depth++;
            buffer += c;
            continue;
        }
        if (c === ']' || c === ')') {
            depth--;
            buffer += c;
            continue;
        }
        if (!depth && text.startsWith('/template/', i)) {
            flush();
            relation = '/template/';
            i += 9;
            continue;
        }
        if (!depth && c === '>') {
            flush();
            relation = '>';
            continue;
        }
        if (!depth && /\s/.test(c)) {
            flush();
            continue;
        }
        buffer += c;
    }
    flush();
    if (depth || quote)
        throw new SyntaxError(`Invalid selector '${text}'.`);
    return parts;
}
function typeMatches(control, type) {
    const name = type.split('|').at(-1).split(':').at(-1).split('.').at(-1);
    if (name === '*')
        return true;
    if (control.StyleKey?.name === name || control.StyleKey === name)
        return true;
    for (let ctor = control.constructor; ctor; ctor = Object.getPrototypeOf(ctor))
        if (ctor.name === name)
            return true;
    return false;
}
function readBalanced(s, start, open = '(', close = ')') {
    let depth = 1;
    for (let i = start + 1; i < s.length; i++) {
        if (s[i] === open)
            depth++;
        else if (s[i] === close && !--depth)
            return [s.slice(start + 1, i), i + 1];
    }
    throw new SyntaxError('Unbalanced selector.');
}
function simpleMatches(control, simple, anchor) {
    if (!control)
        return false;
    let i = 0;
    if (simple[0] === '^') {
        if (control !== anchor)
            return false;
        i++;
    }
    else {
        const type = /^[\w|*]+/.exec(simple);
        if (type && !type[0].startsWith(':')) {
            if (!typeMatches(control, type[0]))
                return false;
            i = type[0].length;
        }
    }
    while (i < simple.length) {
        const prefix = simple[i++];
        if (prefix === '.' || prefix === '#') {
            const match = /^[\w-]+/.exec(simple.slice(i));
            if (!match)
                throw new SyntaxError('Invalid class/name selector.');
            i += match[0].length;
            if (prefix === '.' ? !control.Classes?.has(match[0]) : control.Name !== match[0])
                return false;
            continue;
        }
        if (prefix === '[') {
            const end = simple.indexOf(']', i);
            if (end < 0)
                throw new SyntaxError('Unterminated selector attribute.');
            const body = simple.slice(i, end);
            i = end + 1;
            const match = /^([\w.]+)\s*(?:(=|!=)\s*(.*))?$/.exec(body.trim());
            if (!match)
                throw new SyntaxError('Invalid selector property test.');
            const value = control[match[1]], desired = match[3]?.replace(/^['"]|['"]$/g, '');
            if (!match[2]) {
                if (!value)
                    return false;
            }
            else {
                const equal = String(value).toLowerCase() === String(desired).toLowerCase();
                if (match[2] === '=' ? !equal : equal)
                    return false;
            }
            continue;
        }
        if (prefix === ':') {
            const match = /^[\w-]+/.exec(simple.slice(i));
            if (!match)
                throw new SyntaxError('Invalid pseudo-class.');
            const name = match[0];
            i += name.length;
            if (simple[i] === '(') {
                const [argument, next] = readBalanced(simple, i);
                i = next;
                if (name === 'is') {
                    if (!splitOutside(argument, ',').some(t => typeMatches(control, t)))
                        return false;
                }
                else if (name === 'not') {
                    if (new Selector(argument).Match(control, anchor))
                        return false;
                }
                else if (name === 'nth-child' || name === 'nth-last-child') {
                    const children = control.Parent?.Children?.ToArray?.() ?? control.VisualParent?.VisualChildren ?? [];
                    let n = children.indexOf(control) + 1;
                    if (name === 'nth-last-child')
                        n = children.length + 1 - n;
                    const expr = argument.replace(/\s/g, '');
                    if (expr === 'odd' ? n % 2 !== 1 : expr === 'even' ? n % 2 !== 0 : /^\d+$/.test(expr) ? n !== Number(expr) : !nthMatches(n, expr))
                        return false;
                }
                else
                    throw new SyntaxError(`Unsupported selector pseudo-class :${name}().`);
            }
            else {
                const active = name === 'disabled' ? !control.IsEffectivelyEnabled : name === 'enabled' ? control.IsEffectivelyEnabled : name === 'empty' ? !(control.VisualChildren?.length) : control.PseudoClasses?.has(`:${name}`) || control.PseudoClasses?.has(name);
                if (!active)
                    return false;
            }
            continue;
        }
        throw new SyntaxError(`Invalid selector near '${simple.slice(i - 1)}'.`);
    }
    return true;
}
function nthMatches(n, expression) {
    const match = /^([+-]?\d*)n([+-]\d+)?$/.exec(expression);
    if (!match)
        return false;
    const a = match[1] === '' || match[1] === '+' ? 1 : match[1] === '-' ? -1 : Number(match[1]), b = Number(match[2] ?? 0);
    return a === 0 ? n === b : (n - b) / a >= 0 && Number.isInteger((n - b) / a);
}
export class Selector {
    constructor(text = '*') {
        this.Text = String(text || '*');
        this._alternatives = splitOutside(this.Text, ',').map(parseSequence);
        this.IsConditional = /[.#\[:]/.test(this.Text);
    }
    Match(control, anchor = null) {
        return this._alternatives.some(parts => this._match(parts, parts.length - 1, control, anchor));
    }
    _match(parts, i, control, anchor) {
        if (i < 0)
            return true;
        if (!simpleMatches(control, parts[i].Simple, anchor))
            return false;
        if (!i)
            return true;
        const relation = parts[i].Relation;
        if (relation === '>')
            return this._match(parts, i - 1, control.Parent ?? control.VisualParent, anchor);
        if (relation === '/template/')
            return this._match(parts, i - 1, control.TemplatedParent, anchor);
        const seen = new Set();
        for (let parent = control.Parent ?? control.VisualParent; parent && !seen.has(parent); parent = parent.Parent ?? parent.VisualParent) {
            seen.add(parent);
            if (this._match(parts, i - 1, parent, anchor))
                return true;
        }
        return false;
    }
    OfType(type) {
        return new Selector(this.Text === '*' ? type.name ?? type : this.Text + (type.name ?? type));
    }
    Is(type) {
        return new Selector(`${this.Text === '*' ? '' : this.Text}:is(${type.name ?? type})`);
    }
    Class(name) {
        return new Selector(`${this.Text === '*' ? '' : this.Text}${name.startsWith(':') ? '' : '.'}${name}`);
    }
    Name(name) {
        return new Selector(`${this.Text === '*' ? '' : this.Text}#${name}`);
    }
    Child() {
        return new SelectorBuilder(this.Text + ' > ');
    }
    Descendant() {
        return new SelectorBuilder(this.Text + ' ');
    }
    Template() {
        return new SelectorBuilder(this.Text + ' /template/ ');
    }
    Not(selector) {
        return new Selector(`${this.Text}:not(${selector.Text ?? selector})`);
    }
    toString() {
        return this.Text;
    }
    static Parse(text) {
        return new Selector(text);
    }
}
class SelectorBuilder {
    constructor(text = '') {
        this.Text = text;
    }
    OfType(type) {
        return new Selector(this.Text + (type.name ?? type));
    }
    Is(type) {
        return new Selector(`${this.Text}:is(${type.name ?? type})`);
    }
}
export const Selectors = Object.freeze({ OfType: type => new Selector(type.name ?? type), Is: type => new Selector(`:is(${type.name ?? type})`), Class: name => new Selector(`.${name}`), Nesting: () => new Selector('^') });
