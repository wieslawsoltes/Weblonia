/** Versioned, bounded binary transport. This module has no DOM or Skia dependency.
 * Transfers own their ArrayBuffer until it is returned by the consumer. No shared
 * mutable JavaScript objects, pointers, eval, implicit globals, or unbounded queues.
 */
export const CompositionProtocol = Object.freeze({ Magic: 0x41565254, Version: 2, HeaderBytes: 40, MaxBytes: 64 * 1024 * 1024, MaxItems: 1_000_000, MaxDepth: 96 });
export class CompositionProtocolError extends Error { constructor(message) { super(message); this.name = 'CompositionProtocolError'; } }
const fail = message => { throw new CompositionProtocolError(message); };
const textEncoder = new TextEncoder(), textDecoder = new TextDecoder('utf-8', { fatal: true });
const safeKey = key => key !== '__proto__' && key !== 'prototype' && key !== 'constructor';
const typed = [Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array];
export class CompositionBufferPool {
    constructor({ MaxBytes = 16 * 1024 * 1024, MaxBufferBytes = 8 * 1024 * 1024, MaxBuffers = 8 } = {}) {
        this.MaxBytes = MaxBytes; this.MaxBufferBytes = MaxBufferBytes; this.MaxBuffers = MaxBuffers;
        this.Buffers = []; this.Bytes = 0; this.Hits = 0; this.Misses = 0;
    }
    Rent(minimum) {
        if (!Number.isSafeInteger(minimum) || minimum < 1 || minimum > CompositionProtocol.MaxBytes) fail('Invalid buffer size.');
        const i = this.Buffers.findIndex(b => b.byteLength >= minimum);
        if (i >= 0) { const [b] = this.Buffers.splice(i, 1); this.Bytes -= b.byteLength; ++this.Hits; return b; }
        ++this.Misses; return new ArrayBuffer(Math.min(CompositionProtocol.MaxBytes, 2 ** Math.ceil(Math.log2(Math.max(1024, minimum)))));
    }
    Return(buffer) {
        if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength || buffer.byteLength > this.MaxBufferBytes || this.Bytes + buffer.byteLength > this.MaxBytes || this.Buffers.length >= this.MaxBuffers || this.Buffers.includes(buffer)) return;
        this.Buffers.push(buffer); this.Bytes += buffer.byteLength; this.Buffers.sort((a, b) => a.byteLength - b.byteLength);
    }
    Clear() { this.Buffers.length = 0; this.Bytes = 0; }
}
class Writer {
    constructor(pool, maxBytes) { this.pool = pool; this.limit = maxBytes; this.buffer = pool.Rent(4096); this.view = new DataView(this.buffer); this.offset = CompositionProtocol.HeaderBytes; this.items = 0; this.seen = new Set(); this.strings = new Map(); this.statistics = { StringWrites: 0, StringDefinitions: 0, StringReferences: 0, Utf8Bytes: 0, BufferGrowths: 0 }; }
    ensure(n) {
        if (this.offset + n > this.limit) fail('Composition transaction exceeds its byte budget.');
        if (this.offset + n <= this.buffer.byteLength) return;
        const next = this.pool.Rent(this.offset + n); new Uint8Array(next).set(new Uint8Array(this.buffer, 0, this.offset)); this.pool.Return(this.buffer); this.buffer = next; this.view = new DataView(next); ++this.statistics.BufferGrowths;
    }
    u8(x) { this.ensure(1); this.view.setUint8(this.offset++, x); }
    u32(x) { this.ensure(4); this.view.setUint32(this.offset, x, true); this.offset += 4; }
    number(x) { this.ensure(8); this.view.setFloat64(this.offset, x, true); this.offset += 8; }
    bytes(bytes) { this.ensure(bytes.byteLength); new Uint8Array(this.buffer, this.offset, bytes.byteLength).set(bytes); this.offset += bytes.byteLength; }
    string(s) {
        ++this.statistics.StringWrites;
        const existing = this.strings.get(s);
        if (existing !== undefined) { this.u32(0x80000000 + existing); ++this.statistics.StringReferences; return; }
        // A packet-local dictionary needs no shared mutable state or reset handshake.
        // Encode new UTF-8 directly into the transferable buffer: no temporary typed
        // array per field/value, and no repeated UTF-8 conversion for common keys.
        if (this.strings.size >= CompositionProtocol.MaxItems) fail('String dictionary budget exceeded.');
        const lengthOffset = this.offset; this.u32(0);
        if (s.length > this.limit - this.offset) fail('Composition string exceeds its byte budget.');
        const capacity = Math.min(s.length * 3, this.limit - this.offset);
        this.ensure(capacity);
        const { read, written } = textEncoder.encodeInto(s, new Uint8Array(this.buffer, this.offset, capacity));
        if (read !== s.length) fail('Composition string exceeds its byte budget.');
        this.view.setUint32(lengthOffset, written, true); this.offset += written;
        this.strings.set(s, this.strings.size); ++this.statistics.StringDefinitions; this.statistics.Utf8Bytes += written;
    }
    value(value, depth = 0) {
        if (++this.items > CompositionProtocol.MaxItems || depth > CompositionProtocol.MaxDepth) fail('Composition value nesting/item budget exceeded.');
        if (value === null) return this.u8(0);
        if (value === false) return this.u8(1);
        if (value === true) return this.u8(2);
        if (value === undefined) return this.u8(3);
        if (typeof value === 'number') { this.u8(4); this.number(value); return; }
        if (typeof value === 'string') { this.u8(5); this.string(value); return; }
        if (typeof value !== 'object') fail(`Nonportable composition value: ${typeof value}.`);
        if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
            const kind = typed.findIndex(T => value instanceof T); if (kind < 0) fail('Unsupported typed array.');
            this.u8(8); this.u8(kind); this.u32(value.length); this.bytes(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)); return;
        }
        if (value instanceof ArrayBuffer) { this.u8(9); this.u32(value.byteLength); this.bytes(new Uint8Array(value)); return; }
        if (this.seen.has(value)) fail('Composition values must not contain cycles.');
        this.seen.add(value);
        try {
            if (Array.isArray(value)) { this.u8(6); this.u32(value.length); for (const item of value) this.value(item, depth + 1); }
            else {
                const proto = Object.getPrototypeOf(value);
                if (proto !== Object.prototype && proto !== null) fail(`An explicit descriptor is required for ${value.constructor?.name ?? 'this object'}.`);
                const keys = Object.keys(value); this.u8(7); this.u32(keys.length);
                for (const key of keys) { if (!safeKey(key)) fail(`Forbidden composition key '${key}'.`); this.string(key); this.value(value[key], depth + 1); }
            }
        } finally { this.seen.delete(value); }
    }
}
export function EncodeCompositionBatch(value, header = {}, pool = new CompositionBufferPool(), maxBytes = CompositionProtocol.MaxBytes) {
    const { Sequence = 1, BaseSequence = 0, Generation = 1, Full = false } = header;
    for (const [name, n] of Object.entries({ Sequence, BaseSequence, Generation })) if (!Number.isSafeInteger(n) || n < (name === 'BaseSequence' ? 0 : 1)) fail(`Invalid ${name}.`);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < CompositionProtocol.HeaderBytes || maxBytes > CompositionProtocol.MaxBytes) fail('Invalid composition byte budget.');
    const w = new Writer(pool, maxBytes);
    try {
        w.value(value); const v = w.view;
        v.setUint32(0, CompositionProtocol.Magic, true); v.setUint16(4, CompositionProtocol.Version, true); v.setUint16(6, Full ? 1 : 0, true);
        v.setFloat64(8, Sequence, true); v.setFloat64(16, BaseSequence, true); v.setFloat64(24, Generation, true);
        v.setUint32(32, w.offset, true); v.setUint32(36, 0, true);
        return { Buffer: w.buffer, ByteLength: w.offset, Sequence, BaseSequence, Generation, Full, Statistics: { ...w.statistics, Values: w.items } };
    } catch (error) { pool.Return(w.buffer); throw error; }
}
export function DecodeCompositionBatch(buffer, byteLength = buffer?.byteLength) {
    if (!(buffer instanceof ArrayBuffer) || !Number.isSafeInteger(byteLength) || byteLength < CompositionProtocol.HeaderBytes || byteLength > buffer.byteLength || byteLength > CompositionProtocol.MaxBytes) fail('Invalid composition buffer.');
    const v = new DataView(buffer, 0, byteLength); let offset = CompositionProtocol.HeaderBytes, items = 0;
    const version = v.getUint16(4, true);
    if (v.getUint32(0, true) !== CompositionProtocol.Magic || (version !== 1 && version !== CompositionProtocol.Version)) fail('Unsupported composition protocol.');
    const strings = [], statistics = { StringDefinitions: 0, StringReferences: 0, Utf8Bytes: 0 };
    if (v.getUint32(32, true) !== byteLength || v.getUint32(36, true) !== 0 || v.getUint16(6, true) > 1) fail('Invalid composition header.');
    const header = { Sequence: v.getFloat64(8, true), BaseSequence: v.getFloat64(16, true), Generation: v.getFloat64(24, true), Full: !!v.getUint16(6, true), ByteLength: byteLength };
    for (const [name, n] of Object.entries(header).slice(0, 3)) if (!Number.isSafeInteger(n) || n < (name === 'BaseSequence' ? 0 : 1)) fail(`Invalid ${name}.`);
    const need = n => { if (!Number.isSafeInteger(n) || n < 0 || offset + n > byteLength) fail('Truncated composition payload.'); };
    const u8 = () => { need(1); return v.getUint8(offset++); };
    const u32 = () => { need(4); const n = v.getUint32(offset, true); offset += 4; return n; };
    const string = () => {
        const n = u32();
        if (version >= 2 && n >= 0x80000000) {
            const id = n - 0x80000000;
            if (id >= strings.length) fail('Invalid or forward string dictionary reference.');
            ++statistics.StringReferences; return strings[id];
        }
        need(n); const s = textDecoder.decode(new Uint8Array(buffer, offset, n)); offset += n;
        if (version >= 2) { if (strings.length >= CompositionProtocol.MaxItems) fail('String dictionary budget exceeded.'); strings.push(s); }
        ++statistics.StringDefinitions; statistics.Utf8Bytes += n; return s;
    };
    const read = (depth = 0) => {
        if (++items > CompositionProtocol.MaxItems || depth > CompositionProtocol.MaxDepth) fail('Composition value nesting/item budget exceeded.');
        const tag = u8();
        switch (tag) {
            case 0: return null; case 1: return false; case 2: return true; case 3: return undefined;
            case 4: { need(8); const n = v.getFloat64(offset, true); offset += 8; return n; }
            case 5: return string();
            case 6: { const n = u32(); if (n > CompositionProtocol.MaxItems - items) fail('Array budget exceeded.'); const a = []; for (let i = 0; i < n; ++i) a.push(read(depth + 1)); return a; }
            case 7: {
                const n = u32(); if (n > CompositionProtocol.MaxItems - items) fail('Object budget exceeded.'); const o = {};
                for (let i = 0; i < n; ++i) { const key = string(); if (!safeKey(key) || Object.hasOwn(o, key)) fail('Forbidden or duplicate composition key.'); o[key] = read(depth + 1); } return o;
            }
            case 8: { const T = typed[u8()]; if (!T) fail('Unknown typed array.'); const n = u32(), bytes = n * T.BYTES_PER_ELEMENT; need(bytes); const a = new T(buffer.slice(offset, offset + bytes)); offset += bytes; return a; }
            case 9: { const n = u32(); need(n); const a = buffer.slice(offset, offset + n); offset += n; return a; }
            default: fail(`Unknown composition value tag ${tag}.`);
        }
    };
    const Value = read(); if (offset !== byteLength) fail('Trailing composition payload.');
    return { ...header, Value, DecodeStatistics: { ...statistics, Values: items } };
}
/** Keeps the latest desired scene, never drops prerequisite deltas. Only one
 * transaction is in flight. The next delta is computed against its acknowledged
 * snapshot, not against an intermediate unsent or discarded frame. */
export class CompositionChangeAccumulator {
    constructor() { this.Desired = null; this.Acknowledged = null; this.InFlight = null; this.Sequence = 0; this.Generation = 1; this.Revision = 0; }
    Update(snapshot) { this.Desired = snapshot; ++this.Revision; }
    Prepare() {
        if (this.InFlight || !this.Desired) return null;
        const current = this.Desired, previous = this.Acknowledged, full = !previous;
        const diff = (next, old) => {
            const Upsert = [], Remove = [];
            for (const [id, value] of next) if (old?.get(id) !== value) Upsert.push(value);
            if (old) for (const id of old.keys()) if (!next.has(id)) Remove.push(id);
            return { Upsert, Remove };
        };
        const Nodes = { Upsert: [], Remove: [], Patch: [] };
        for (const [id, node] of current.Nodes) {
            const old = previous?.Nodes.get(id);
            if (old === node) continue;
            if (!old) { Nodes.Upsert.push(node); continue; }
            // Replacement fields are compared against ACKNOWLEDGED state, never an
            // unsent intermediate snapshot. Drawing arrays survive placement-only
            // changes without being cloned or encoded again.
            const Set = {};
            for (const key of Object.keys(node)) if (key !== 'Id' && !SameCompositionValue(old[key], node[key])) Set[key] = node[key];
            if (Object.keys(Set).length) Nodes.Patch.push({ Id: id, Set });
        }
        if (previous) for (const id of previous.Nodes.keys()) if (!current.Nodes.has(id)) Nodes.Remove.push(id);
        const Resources = diff(current.Resources, previous?.Resources), Composition = diff(current.Composition, previous?.Composition);
        if (!full && !Nodes.Upsert.length && !Nodes.Remove.length && !Nodes.Patch.length && !Resources.Upsert.length && !Resources.Remove.length && !Composition.Upsert.length && !Composition.Remove.length && current.Root === previous.Root && current.Width === previous.Width && current.Height === previous.Height && current.Scale === previous.Scale && current.FontVersion === previous.FontVersion && current.InputSequence === previous.InputSequence) return null;
        const Value = { InputSequence:current.InputSequence??0,Root: current.Root, Width: current.Width, Height: current.Height, Scale: current.Scale, FontVersion: current.FontVersion ?? 0, Nodes, Resources, Composition };
        const batch = { Sequence: this.Sequence + 1, BaseSequence: full ? 0 : this.Sequence, Generation: this.Generation, Full: full, Value };
        this.InFlight = { Batch: batch, Snapshot: current, Revision: this.Revision }; return batch;
    }
    Acknowledge(sequence, generation) {
        const flight = this.InFlight;
        if (!flight || generation !== this.Generation || flight.Batch.Sequence !== sequence) fail('Unexpected composition acknowledgement.');
        this.Sequence = sequence; this.Acknowledged = flight.Snapshot; this.InFlight = null;
    }
    Reset(generation = this.Generation + 1) { this.Generation = generation; this.Sequence = 0; this.Acknowledged = this.InFlight = null; }
}

/** Value equality only for portable descriptors, bounded by the protocol nesting
 * limit. Identity is the common path for retained drawing lists. Typed payloads
 * are resources and deliberately never deep-compared here. */
export function SameCompositionValue(a, b, depth = 0) {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || depth > CompositionProtocol.MaxDepth ||
        ArrayBuffer.isView(a) || ArrayBuffer.isView(b) || a instanceof ArrayBuffer || b instanceof ArrayBuffer) return false;
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; ++i) if (!SameCompositionValue(a[i], b[i], depth + 1)) return false;
        return true;
    }
    if (Array.isArray(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) if (!Object.hasOwn(b, key) || !SameCompositionValue(a[key], b[key], depth + 1)) return false;
    return true;
}
