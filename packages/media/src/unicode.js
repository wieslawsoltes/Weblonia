/** UTF-16 coordinates with extended-grapheme-safe editing boundaries.
 * Cached results are immutable. Cache diagnostics never contain user text.
 */
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const wordSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
const cache = new Map();
const MaxEntries = 128, MaxBytes = 2 * 1024 * 1024;
let bytes = 0, hits = 0, misses = 0;
function entryFor(value) {
    const text = String(value);
    let entry = cache.get(text);
    if (entry) { ++hits; cache.delete(text); cache.set(text, entry); return entry; }
    ++misses;
    let offset = 0;
    const segments = segmenter
        ? Array.from(segmenter.segment(text), x => Object.freeze({ Text: x.segment, Start: x.index, End: x.index + x.segment.length }))
        : Array.from(text, value => { const s = Object.freeze({ Text: value, Start: offset, End: offset + value.length }); offset = s.End; return s; });
    entry = { Segments: Object.freeze(segments), Boundaries: Object.freeze([0, ...segments.map(s => s.End)]), Bytes: text.length * 4 + segments.length * 64 + 128 };
    // Oversized input remains usable without retaining it in the global cache.
    if (entry.Bytes <= MaxBytes) {
        while (cache.size && (cache.size >= MaxEntries || bytes + entry.Bytes > MaxBytes)) {
            const [key, old] = cache.entries().next().value;
            cache.delete(key); bytes -= old.Bytes;
        }
        cache.set(text, entry); bytes += entry.Bytes;
    }
    return entry;
}
export function ClearTextBoundaryCache() { cache.clear(); bytes = hits = misses = 0; }
export function GetTextBoundaryCacheStatistics() { return Object.freeze({ Count: cache.size, EstimatedBytes: bytes, Hits: hits, Misses: misses, MaxEntries, MaxBytes }); }
export function GraphemeSegments(text) { return entryFor(text).Segments; }
export function GraphemeBoundaries(text) { return entryFor(text).Boundaries; }
export function SnapTextPosition(text, index, direction = 'Nearest') {
    text = String(text);
    index = Math.max(0, Math.min(text.length, Number.isFinite(index) ? Math.trunc(index) : 0));
    const boundaries = GraphemeBoundaries(text);
    let low = 0, high = boundaries.length - 1;
    while (low <= high) { const mid = (low + high) >>> 1; if (boundaries[mid] === index) return index; if (boundaries[mid] < index) low = mid + 1; else high = mid - 1; }
    const before = boundaries[Math.max(0, high)], after = boundaries[Math.min(boundaries.length - 1, low)];
    return direction === 'Backward' ? before : direction === 'Forward' ? after : index - before <= after - index ? before : after;
}
export function PreviousTextPosition(text, index) { return SnapTextPosition(text, Math.max(0, index - 1), 'Backward'); }
export function NextTextPosition(text, index) { return SnapTextPosition(text, Math.min(text.length, index + 1), 'Forward'); }
export function TruncateText(text, utf16Length) { return String(text).slice(0, SnapTextPosition(String(text), utf16Length, 'Backward')); }
export function GetWordRange(text, position) {
    text = String(text); position = SnapTextPosition(text, position);
    if (wordSegmenter) {
        let last;
        for (const part of wordSegmenter.segment(text)) {
            last = part;
            if (position >= part.index && position < part.index + part.segment.length) return { Start: part.index, End: part.index + part.segment.length };
        }
        return last ? { Start: last.index, End: last.index + last.segment.length } : { Start: 0, End: 0 };
    }
    const before = text.slice(0, position).match(/[\p{L}\p{N}_]+$/u)?.[0].length ?? 0;
    const after = text.slice(position).match(/^[\p{L}\p{N}_]+/u)?.[0].length ?? 0;
    return { Start: position - before, End: position + after };
}
