import { CompositionProtocolError } from './protocol.js';

const empty = Object.freeze({ Resources: Object.freeze([]), Composition: Object.freeze([]), Visuals: Object.freeze([]) });
/** Per-owner cache for immutable portable data. Shared display-list arrays are
 * walked once, not once per visual-placement transaction. The server seals new
 * descriptor containers so retained validation cannot be invalidated by mutation.
 * Typed payloads are leaves: neither scanned nor copied nor frozen here. */
export class CompositionReferenceIndex {
    constructor({ Seal = false } = {}) {
        this.Seal = Seal; this.Cache = new WeakMap(); this.Active = new WeakSet();
        this.Statistics = { ObjectsWalked: 0, CacheHits: 0 };
    }
    Get(value, depth = 0) {
        if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return empty;
        const known = this.Cache.get(value);
        if (known) { ++this.Statistics.CacheHits; return known; }
        if (depth > 96 || this.Active.has(value)) throw new CompositionProtocolError('Cyclic or excessively nested descriptor.');
        this.Active.add(value); ++this.Statistics.ObjectsWalked;
        try {
            let resources, composition, visuals;
            if (Object.hasOwn(value, '$ref')) resources = new Set([value.$ref]);
            else if (Object.hasOwn(value, 'CompositionRef')) composition = new Set([value.CompositionRef]);
            else {
                if (value.$ === 'Brush' && value.Type === 'VisualBrush' && value.Visual != null) visuals = new Set([value.Visual]);
                for (const key of Object.keys(value)) {
                    const child = this.Get(value[key], depth + 1);
                    for (const id of child.Resources) (resources ??= new Set()).add(id);
                    for (const id of child.Composition) (composition ??= new Set()).add(id);
                    for (const id of child.Visuals) (visuals ??= new Set()).add(id);
                }
            }
            const result = resources || composition || visuals ? Object.freeze({
                Resources: resources ? Object.freeze([...resources]) : empty.Resources,
                Composition: composition ? Object.freeze([...composition]) : empty.Composition,
                Visuals: visuals ? Object.freeze([...visuals]) : empty.Visuals,
            }) : empty;
            if (this.Seal) Object.freeze(value);
            this.Cache.set(value, result); return result;
        } finally { this.Active.delete(value); }
    }
}
