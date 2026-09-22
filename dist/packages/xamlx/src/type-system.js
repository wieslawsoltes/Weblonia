import { XamlParseException } from './parser.js';

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

/** Splits XAML type lists without splitting nested generic arguments. */
export function SplitTypeArguments(text) {
    const result = []; let depth = 0, start = 0;
    text = String(text).trim();
    for (let i = 0; i < text.length; ++i) {
        if (text[i] === '(') ++depth;
        else if (text[i] === ')') { if (--depth < 0) throw new XamlParseException('Unbalanced generic type arguments.'); }
        else if (text[i] === ',' && !depth) { result.push(text.slice(start, i).trim()); start = i + 1; }
    }
    if (depth) throw new XamlParseException('Unbalanced generic type arguments.');
    if (text.length) result.push(text.slice(start).trim());
    if (result.some(x => !x)) throw new XamlParseException('A type argument cannot be empty.');
    return result;
}

/** Reflection metadata is explicit: no invocation of arbitrary JavaScript expressions. */
export class XamlTypeReference {
    constructor(type, options = {}) {
        this.Type = type;
        this.Name = options.Name ?? type?.name ?? 'Object';
        this.IsNullable = options.IsNullable ?? ![Number, Boolean, BigInt].includes(type);
        this.ElementType = options.ElementType ?? null;
        this.TypeArguments = Object.freeze([...(options.TypeArguments ?? [])]);
        this.Validate = options.Validate ?? null;
        this.Convert = options.Convert ?? null;
        Object.freeze(this);
    }
    Accepts(value) {
        if (value == null) return this.IsNullable;
        if (this.ElementType) return Array.isArray(value) && value.every(v => this.ElementType.Accepts(v));
        const t = this.Type;
        const valid = t === Object ? true : t === String ? typeof value === 'string'
            : t === Number ? typeof value === 'number' && Number.isFinite(value)
            : t === Boolean ? typeof value === 'boolean' : t === BigInt ? typeof value === 'bigint'
            : typeof t === 'function' && value instanceof t;
        return valid && (!this.Validate || this.Validate(value));
    }
    ToString() { return this.Name; }
}

function reference(type) { return type instanceof XamlTypeReference ? type : new XamlTypeReference(type ?? Object); }

/** A deterministic overload binder. Conversion failures never escape while considering candidates. */
export class XamlOverloadResolver {
    static Convert(value, parameter) {
        const p = typeof parameter === 'function' || parameter instanceof XamlTypeReference ? { Type: parameter } : parameter;
        const type = reference(p.Type);
        if (value == null) {
            if (p.Nullable ?? type.IsNullable) return { Value: value, Score: type.Type === Object ? 20 : 0 };
            throw new TypeError(`Null is not assignable to ${type.Name}.`);
        }
        if (type.Accepts(value)) return { Value: value, Score: type.Type === Object ? 20 : 0 };
        let converted;
        if (p.Converter ?? type.Convert) converted = (p.Converter ?? type.Convert)(value);
        else if (typeof value === 'string' && type.Type === Number && value.trim() !== '') converted = Number(value);
        else if (typeof value === 'string' && type.Type === BigInt && /^[+-]?\d+$/.test(value.trim())) converted = BigInt(value.trim());
        else if (typeof value === 'string' && type.Type === Boolean && /^(true|false)$/i.test(value.trim())) converted = value.trim().toLowerCase() === 'true';
        else if (typeof value === 'string' && typeof type.Type?.Parse === 'function') converted = type.Type.Parse(value);
        else throw new TypeError(`Cannot convert ${typeof value} to ${type.Name}.`);
        if (!type.Accepts(converted) || p.Validate && !p.Validate(converted)) throw new TypeError(`Invalid ${type.Name} argument.`);
        return { Value: converted, Score: 5 };
    }
    static Resolve(overloads, values, name = 'constructor') {
        const candidates = [];
        for (const candidate of overloads) {
            const parameters = candidate.Parameters ?? [], args = []; let score = 0, input = 0;
            try {
                for (let index = 0; index < parameters.length; ++index) {
                    const parameter = parameters[index];
                    const p = typeof parameter === 'function' || parameter instanceof XamlTypeReference ? { Type: parameter } : parameter;
                    if (p.Params) {
                        if (index !== parameters.length - 1) throw new TypeError('A variadic parameter must be last.');
                        const rest = [];
                        while (input < values.length) { const c = this.Convert(values[input++], p); rest.push(c.Value); score += c.Score; }
                        args.push(rest); score += 2;
                    } else if (input < values.length) {
                        const c = this.Convert(values[input++], p); args.push(c.Value); score += c.Score;
                    } else if (p.Optional) { args.push(p.DefaultValue); score += 1; }
                    else throw new TypeError('Missing argument.');
                }
                if (input !== values.length) continue;
                candidates.push({ Candidate: candidate, Arguments: args, Score: score });
            } catch { /* A non-applicable candidate is not a build failure. */ }
        }
        candidates.sort((a, b) => a.Score - b.Score);
        if (!candidates.length) throw new XamlParseException(`No applicable overload for ${name} with ${values.length} argument(s).`);
        if (candidates.length > 1 && candidates[0].Score === candidates[1].Score)
            throw new XamlParseException(`Ambiguous overload for ${name} with ${values.length} argument(s).`);
        return candidates[0];
    }
    static Construct(descriptor, values = [], factoryMethod = null) {
        if (factoryMethod && forbidden.has(factoryMethod)) throw new XamlParseException('Unsafe factory method.');
        const overloads = factoryMethod ? descriptor.FactoryMethods?.[factoryMethod] : descriptor.Constructors;
        if (factoryMethod && !overloads) throw new XamlParseException(`Factory '${factoryMethod}' is not registered on ${descriptor.Name}.`);
        if (!overloads) return Reflect.construct(descriptor.Type, values);
        const match = this.Resolve(Array.isArray(overloads) ? overloads : [overloads], values, `${descriptor.Name}.${factoryMethod ?? '.ctor'}`);
        if (typeof match.Candidate.Invoke !== 'function') return Reflect.construct(descriptor.Type, match.Arguments);
        return match.Candidate.Invoke(...match.Arguments);
    }
}
