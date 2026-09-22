import { AvaloniaProperty } from '@wieslawsoltes/avalonia-base';
import { Style } from './styles.js';

/** Sizing eligibility is independent of the container name. */
export const ContainerSizing = Object.freeze({ Normal: 0, Width: 1, Height: 2, WidthAndHeight: 3 });
export class Container {
    static NameProperty = AvaloniaProperty.RegisterAttached(Container, 'Name', null, { AffectsRender: false });
    static SizingProperty = AvaloniaProperty.RegisterAttached(Container, 'Sizing', 0, {
        Convert: value => typeof value === 'string' ? ContainerSizing[value] ?? Number(value) : value,
        Validate: value => Number.isInteger(value) && value >= 0 && value <= 3,
        AffectsRender: false,
    });
    static GetName(target) { return target.GetValue(this.NameProperty); }
    static SetName(target, value) { target.SetValue(this.NameProperty, value); }
    static GetSizing(target) { return target.GetValue(this.SizingProperty); }
    static SetSizing(target, value) { target.SetValue(this.SizingProperty, value); }
}

/** Immutable parsed query. Deliberately does not evaluate arbitrary JavaScript. */
export class StyleQuery {
    constructor(text = '') {
        this.Text = String(text).trim();
        this._node = parseQuery(this.Text);
        this.RequiredAxes = axes(this._node);
    }
    static Parse(text) { return text instanceof StyleQuery ? text : new StyleQuery(text); }
    Match(size) { return evaluate(this._node, size); }
    toString() { return this.Text; }
    And(other) { return StyleQuery.Parse(`(${this}) and (${other})`); }
    Or(other) { return StyleQuery.Parse(`(${this}) or (${other})`); }
    Not() { return StyleQuery.Parse(`not (${this})`); }
}

function parseQuery(text) {
    if (!text) return { kind: 'constant', value: true };
    // Match every input character; a malformed tail must not be silently ignored.
    const tokens = [];
    const tokenizer = /\s*(>=|<=|==|>|<|:|\(|\)|\/|\b(?:and|or|not)\b|[a-z][a-z-]*|(?:\d+(?:\.\d*)?|\.\d+)(?:px)?)/gy;
    let offset = 0;
    while (offset < text.length) {
        tokenizer.lastIndex = offset;
        const match = tokenizer.exec(text);
        if (!match) throw new SyntaxError(`Invalid container query at ${offset}: '${text.slice(offset)}'.`);
        tokens.push(match[1]); offset = tokenizer.lastIndex;
    }
    let index = 0;
    const take = expected => {
        const value = tokens[index++];
        if (expected && value !== expected) throw new SyntaxError(`Expected '${expected}' in container query.`);
        return value;
    };
    const numeric = () => {
        const value = take();
        if (!/^(?:\d+(?:\.\d*)?|\.\d+)(px)?$/.test(value ?? '')) throw new SyntaxError('Expected a non-negative query size.');
        let number = Number(value.replace(/px$/, ''));
        if (tokens[index] === '/') {
            take('/'); const denominator = numeric();
            if (!(denominator > 0)) throw new SyntaxError('Aspect ratio denominator must be positive.');
            number /= denominator;
        }
        return number;
    };
    const atom = () => {
        if (tokens[index] === 'not') { take(); return { kind: 'not', child: atom() }; }
        if (tokens[index] === '(') { take(); const child = or(); take(')'); return child; }
        let feature = take(), op = take(), value;
        const prefix = /^(min|max)-(.*)$/.exec(feature ?? '');
        if (prefix) {
            if (op !== ':') throw new SyntaxError('min-/max- query features require a colon.');
            feature = prefix[2]; op = prefix[1] === 'min' ? '>=' : '<=';
        }
        if (!['width', 'height', 'aspect-ratio', 'orientation'].includes(feature)) throw new SyntaxError(`Unknown query feature '${feature}'.`);
        if (![':', '==', '<', '>', '<=', '>='].includes(op)) throw new SyntaxError(`Unknown query operator '${op}'.`);
        if (feature === 'orientation') {
            value = take();
            if (!['portrait', 'landscape'].includes(value) || ![':', '=='].includes(op)) throw new SyntaxError('Invalid orientation query.');
        } else value = numeric();
        return { kind: 'compare', feature, op, value };
    };
    const and = () => { let node = atom(); while (tokens[index] === 'and') { take(); node = { kind: 'and', left: node, right: atom() }; } return node; };
    const or = () => { let node = and(); while (tokens[index] === 'or') { take(); node = { kind: 'or', left: node, right: and() }; } return node; };
    const node = or();
    if (index !== tokens.length) throw new SyntaxError(`Unexpected '${tokens[index]}' in container query.`);
    return node;
}
function axes(node) {
    if (node.kind === 'compare') return node.feature === 'width' ? 1 : node.feature === 'height' ? 2 : 3;
    return node.kind === 'not' ? axes(node.child) : node.left ? axes(node.left) | axes(node.right) : 0;
}
function evaluate(node, size) {
    if (node.kind === 'constant') return node.value;
    if (node.kind === 'not') return !evaluate(node.child, size);
    if (node.kind === 'and') return evaluate(node.left, size) && evaluate(node.right, size);
    if (node.kind === 'or') return evaluate(node.left, size) || evaluate(node.right, size);
    const actual = node.feature === 'width' ? size.Width : node.feature === 'height' ? size.Height : node.feature === 'aspect-ratio' ? size.Width / size.Height : size.Width > size.Height ? 'landscape' : 'portrait';
    switch (node.op) {
        case ':': case '==': return actual === node.value;
        case '>': return actual > node.value;
        case '<': return actual < node.value;
        case '>=': return actual >= node.value;
        case '<=': return actual <= node.value;
    }
    return false;
}

export class ContainerQuery extends Style {
    constructor(query = '', containerName = null) {
        super(); this.IsContainerQuery = true; this._query = StyleQuery.Parse(query); this._name = containerName;
    }
    get Query() { return this._query; }
    set Query(value) { this._query = StyleQuery.Parse(value); this._changed(); }
    get Name() { return this._name; }
    set Name(value) { if (this._name !== value) { this._name = value; this._changed(); } }
    /** Observe candidates as well as the selected container, so name/sizing/reparenting changes work. */
    Match(target, lifetime) {
        const seen = new Set();
        let selected = null;
        const invalidate = () => target.InvalidateStyles?.();
        for (let node = target.Parent ?? target.VisualParent; node && !seen.has(node); node = node.Parent ?? node.VisualParent) {
            seen.add(node);
            lifetime?.Add(node.PropertyChanged?.Add((_, change) => {
                if (change.Property === Container.NameProperty || change.Property === Container.SizingProperty) invalidate();
            }));
            lifetime?.Add(node.AttachedToLogicalTree?.Add(invalidate));
            lifetime?.Add(node.DetachedFromLogicalTree?.Add(invalidate));
            const sizing = Container.GetSizing(node);
            if (!selected && sizing !== 0 && (sizing & this.Query.RequiredAxes) === this.Query.RequiredAxes && (!this.Name || Container.GetName(node) === this.Name)) selected = node;
        }
        if (!selected) return false;
        lifetime?.Add(selected.SizeChanged?.Add(invalidate));
        return this.Query.Match(selected.Bounds.Size);
    }
}
