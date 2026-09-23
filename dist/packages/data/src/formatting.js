/** Bounded, non-evaluating composite-format parser shared by binding converters.
 * Numeric formatting uses Intl for the selected locale; this is not CLR custom
 * numeric/date formatting. Unsupported specifiers fail rather than misformat. */
import { UnsetValue, DoNothing } from '@wieslawsoltes/avalonia-base';
const MAX_FORMAT = 65536, MAX_RESULT = 1048576, MAX_WIDTH = 65536;
const plans = new Map(), numberFormats = new Map();
function numberFormat(culture, kind, digits) {
    // Resolve only strings/locale arrays, never cache caller-owned option objects.
    const locales = culture == null || culture === '' ? undefined : culture;
    const canonical = locales === undefined ? '' : Intl.getCanonicalLocales(locales).join(',');
    const key = `${canonical}|${kind}|${digits}`;
    let result = numberFormats.get(key);
    if (result) { numberFormats.delete(key); numberFormats.set(key, result); return result; }
    result = new Intl.NumberFormat(locales, { minimumFractionDigits: digits, maximumFractionDigits: digits,
        useGrouping: kind === 'n', ...(kind === 'p' ? { style: 'percent' } : {}) });
    numberFormats.set(key, result);
    if (numberFormats.size > 64) numberFormats.delete(numberFormats.keys().next().value);
    return result;
}
function plan(format) {
    if (typeof format !== 'string') throw new TypeError('A string format is required.');
    if (format.length > MAX_FORMAT) throw new RangeError('Composite format exceeds its length budget.');
    let result = plans.get(format);
    if (result) { plans.delete(format); plans.set(format, result); return result; }
    result = []; let literal = '';
    const flush = () => { if (literal) { result.push(literal); literal = ''; } };
    for (let i = 0; i < format.length;) {
        const char = format[i++];
        if ((char === '{' || char === '}') && format[i] === char) { literal += char; i++; continue; }
        if (char === '}') throw new SyntaxError('Unescaped closing brace in composite format.');
        if (char !== '{') { literal += char; continue; }
        flush(); const end = format.indexOf('}', i);
        if (end < 0) throw new SyntaxError('Unterminated composite format item.');
        const part = format.slice(i, end), match = /^(\d+)\s*(?:,\s*(-?\d+)\s*)?(?::([^{}]*))?$/.exec(part);
        if (!match) throw new SyntaxError(`Invalid composite format item '{${part}}'.`);
        const index = Number(match[1]), width = Number(match[2] ?? 0);
        if (!Number.isSafeInteger(index) || index > 4095 || !Number.isSafeInteger(width) || Math.abs(width) > MAX_WIDTH)
            throw new RangeError('Composite format index/alignment exceeds its budget.');
        result.push(Object.freeze({ Index: index, Width: width, Specifier: match[3] ?? '' })); i = end + 1;
    }
    flush(); Object.freeze(result); plans.set(format, result);
    if (plans.size > 128) plans.delete(plans.keys().next().value);
    return result;
}
function scalar(value, specifier, culture) {
    if (value == null) return '';
    if (value === UnsetValue || value === DoNothing) return String(value);
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    if (!specifier) return String(value);
    if (typeof value !== 'number' && typeof value !== 'bigint') {
        if (typeof value.ToString === 'function') return String(value.ToString(specifier, culture));
        return String(value);
    }
    const match = /^([dDxXfFnNpPeEgGrR])(\d{1,2})?$/.exec(specifier);
    if (!match) throw new RangeError(`Unsupported numeric format '${specifier}'.`);
    const code = match[1], kind = code.toLowerCase(), precision = match[2] == null ? null : Number(match[2]);
    if (kind === 'd' || kind === 'x') {
        if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new RangeError('Integer formatting requires an exact integer.');
        if (kind === 'x' && value < 0) throw new RangeError('Negative hexadecimal values require an explicit CLR bit width.');
        let text = (value < 0 ? -value : value).toString(kind === 'd' ? 10 : 16).padStart(precision ?? 1, '0');
        if (code === 'X') text = text.toUpperCase();
        return (value < 0 ? '-' : '') + text;
    }
    if (kind === 'g' || kind === 'r' || kind === 'e') {
        if (typeof value === 'bigint') {
            if (kind !== 'e' && precision == null) return value.toString();
            throw new RangeError('BigInt scientific/precision formatting is not supported.');
        }
        let text = kind === 'e' ? value.toExponential(precision ?? 6) : precision && kind === 'g' ? value.toPrecision(precision) : String(value);
        if (code === code.toUpperCase()) text = text.replace('e', 'E');
        return text;
    }
    const digits = precision ?? 2;
    return numberFormat(culture, kind, digits).format(value);
}
export function FormatComposite(format, values, culture) {
    if (!Array.isArray(values)) throw new TypeError('Composite values must be an array.');
    let result = '';
    for (const item of plan(format)) {
        let text;
        if (typeof item === 'string') text = item;
        else {
            if (item.Index >= values.length) throw new RangeError(`Composite format index ${item.Index} has no argument.`);
            text = scalar(values[item.Index], item.Specifier, culture);
            if (Math.abs(item.Width) > text.length) text = item.Width < 0 ? text.padEnd(-item.Width) : text.padStart(item.Width);
        }
        if (result.length + text.length > MAX_RESULT) throw new RangeError('Formatted output exceeds its length budget.');
        result += text;
    }
    return result;
}
/** Constructor/method names follow Avalonia; JavaScript functions are supported
 * in addition to objects implementing Convert. Converter instances are borrowed. */
export class StringFormatMultiValueConverter {
    constructor(format, inner = null) {
        plan(format);
        if (inner != null && typeof inner !== 'function' && typeof inner.Convert !== 'function') throw new TypeError('Invalid inner converter.');
        Object.defineProperties(this, { Format: { value: format, enumerable: true }, Inner: { value: inner, enumerable: true } });
    }
    Convert(values, targetType, parameter, culture) {
        const value = this.Inner == null ? values : typeof this.Inner === 'function'
            ? this.Inner(values, targetType, parameter, culture) : this.Inner.Convert(values, targetType, parameter, culture);
        if (value === UnsetValue || value === DoNothing) return value;
        return FormatComposite(this.Format, this.Inner == null ? Array.from(value) : [value], culture);
    }
}
export class StringFormatValueConverter {
    constructor(format, inner = null) {
        if (typeof format !== 'string') throw new TypeError('A string format is required.');
        this._format = format.includes('{') ? format : `{0:${format}}`; plan(this._format);
        if (inner != null && typeof inner !== 'function' && typeof inner.Convert !== 'function') throw new TypeError('Invalid inner converter.');
        Object.defineProperties(this, { Format: { value: format, enumerable: true }, Inner: { value: inner, enumerable: true } });
    }
    Convert(value, targetType, parameter, culture) {
        if (this.Inner) value = typeof this.Inner === 'function' ? this.Inner(value, targetType, parameter, culture) : this.Inner.Convert(value, targetType, parameter, culture);
        if (value === UnsetValue || value === DoNothing) return value;
        return FormatComposite(this._format, [value], culture);
    }
    ConvertBack() { throw new Error('Two-way conversion is not supported with a string format.'); }
}
