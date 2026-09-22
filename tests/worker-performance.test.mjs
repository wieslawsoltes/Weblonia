import test from 'node:test';
import assert from 'node:assert/strict';
import { CompositionProtocol, CompositionBufferPool, CompositionChangeAccumulator, EncodeCompositionBatch, DecodeCompositionBatch,
    CompositionSceneRecorder, ServerCompositionScene, CompositionResourceRegistry } from '@wieslawsoltes/avalonia-rendering';
import { Size, Rect, Matrix, Point } from '@wieslawsoltes/avalonia-base';
import { Border, TextBlock, StackPanel } from '@wieslawsoltes/avalonia-controls';
import { TextLayout, Typeface, VisualBrush, RecordingDrawingContext } from '@wieslawsoltes/avalonia-media';
import { CompositionReferenceIndex } from '../packages/rendering/src/references.js';
import { BrowserWorkerApplication } from '../packages/browser/src/isolated-host.js';
import { WorkerTopLevel } from '../packages/browser/src/worker-top-level.js';
import { WorkerSkiaRenderer } from '../packages/browser/src/render-thread.js';

function roundTrip(value, pool) {
    const packet = EncodeCompositionBatch(value, {}, pool);
    return { packet, decoded: DecodeCompositionBatch(packet.Buffer, packet.ByteLength) };
}
function fixture(content = new TextBlock('Retained text')) {
    const root = new Border(content); root.ClientSize = new Size(320, 180); root.RenderScaling = 1;
    root.Measure(root.ClientSize); root.Arrange(new Rect(root.ClientSize));
    const recorder = new CompositionSceneRecorder(root, {}), accumulator = new CompositionChangeAccumulator(), server = new ServerCompositionScene({});
    async function commit() {
        accumulator.Update(recorder.Capture()); const next = accumulator.Prepare();
        if (!next) return null;
        const packet = EncodeCompositionBatch(next.Value, next); await server.Apply(DecodeCompositionBatch(packet.Buffer, packet.ByteLength));
        accumulator.Acknowledge(next.Sequence, next.Generation); return next;
    }
    const delta = value => ({ Sequence: server.Sequence + 1, BaseSequence: server.Sequence, Generation: server.Generation, Full: false,
        Value: { Root: root.VisualId, Width: 320, Height: 180, Scale: 1, FontVersion: 0, InputSequence: 0,
            Nodes: { Upsert: [], Remove: [], Patch: [] }, Resources: { Upsert: [], Remove: [] }, Composition: { Upsert: [], Remove: [] }, ...value } });
    return { root, content, recorder, accumulator, server, commit, delta, Dispose() { server.Dispose(); recorder.Dispose(); root.Dispose(); } };
}

test('worker perf: packet-local UTF8 dictionary eliminates repeated field and value encoding', () => {
    const value = Array.from({ length: 1000 }, (_, Id) => ({ Id, Name: 'Repeated label', Offset: [0, Id], IsVisible: true }));
    const { packet, decoded } = roundTrip(value);
    assert.deepEqual(decoded.Value, value); assert.equal(CompositionProtocol.Version, 2);
    assert(packet.Statistics.StringDefinitions <= 5); assert(packet.Statistics.StringReferences > 4900);
    assert.equal(decoded.DecodeStatistics.StringDefinitions, packet.Statistics.StringDefinitions);
    assert.equal(decoded.DecodeStatistics.StringReferences, packet.Statistics.StringReferences);
});
test('worker perf: string definitions encode into destination storage without temporary encode arrays', () => {
    const original = TextEncoder.prototype.encode; let calls = 0;
    TextEncoder.prototype.encode = function (...args) { ++calls; return original.apply(this, args); };
    try { roundTrip({ Label: 'Łąka مرحبا 🧑🏽‍💻', Again: 'Łąka مرحبا 🧑🏽‍💻' }); assert.equal(calls, 0); }
    finally { TextEncoder.prototype.encode = original; }
});
test('worker perf: dictionary scope is one transaction including transfer-buffer reuse', () => {
    const pool = new CompositionBufferPool(), first = roundTrip({ a: 'one', b: 'one' }, pool);
    pool.Return(first.packet.Buffer); const second = roundTrip({ a: 'two', b: 'two' }, pool);
    assert.equal(second.packet.Buffer, first.packet.Buffer); assert.deepEqual(second.decoded.Value, { a: 'two', b: 'two' });
    assert.equal(second.packet.Statistics.StringDefinitions, 3); pool.Clear();
});
test('worker perf: strings preserve Unicode and standard lone-surrogate replacement', () => {
    const value = ['', 'e\u0301', 'العربية', 'אבג', '👨‍👩‍👧', '\ud800', '\udc00', '\ufffd', 'long'.repeat(2000)];
    assert.deepEqual(roundTrip(value).decoded.Value, value.map(x => new TextDecoder().decode(new TextEncoder().encode(x))));
});
test('worker perf: inline string encoding respects an exact small byte budget', () => {
    const value = 'a'.repeat(100), exact = 40 + 1 + 4 + 100;
    assert.equal(EncodeCompositionBatch(value, {}, undefined, exact).ByteLength, exact);
    assert.throws(() => EncodeCompositionBatch(value, {}, undefined, exact - 1), /budget/);
    assert.throws(() => EncodeCompositionBatch('x', {}, undefined, NaN), /budget/);
    assert.throws(() => EncodeCompositionBatch('é'.repeat(50), {}, undefined, exact - 1), /budget/);
});
test('worker perf: invalid and forward dictionary references fail closed', () => {
    const { packet } = roundTrip('a'); new DataView(packet.Buffer).setUint32(41, 0x80000000, true);
    assert.throws(() => DecodeCompositionBatch(packet.Buffer, packet.ByteLength), /dictionary reference/);
});
test('worker perf: malformed UTF8 and truncated dictionary payloads fail closed', () => {
    const { packet } = roundTrip('a'); new Uint8Array(packet.Buffer)[45] = 255;
    assert.throws(() => DecodeCompositionBatch(packet.Buffer, packet.ByteLength));
    const b = roundTrip('hello').packet; new DataView(b.Buffer).setUint32(41, 100000, true);
    assert.throws(() => DecodeCompositionBatch(b.Buffer, b.ByteLength), /Truncated/);
});
test('worker perf: v1 transaction reading remains available for recorded diagnostics', () => {
    const bytes = new Uint8Array(51), view = new DataView(bytes.buffer);
    view.setUint32(0, CompositionProtocol.Magic, true); view.setUint16(4, 1, true);
    view.setFloat64(8, 1, true); view.setFloat64(24, 1, true); view.setUint32(32, bytes.length, true);
    bytes[40] = 5; view.setUint32(41, 6, true); bytes.set([108,101,103,97,99,121], 45);
    assert.equal(DecodeCompositionBatch(bytes.buffer).Value, 'legacy');
});
test('worker perf: non-string reference identity is never shared by the dictionary', () => {
    const item = { Name: 'same' }, d = roundTrip([item, item, new Float64Array([Infinity, -0, NaN])]).decoded.Value;
    assert.notEqual(d[0], d[1]); assert.equal(d[0].Name, d[1].Name); assert(Object.is(d[2][1], -0)); assert(Number.isNaN(d[2][2]));
});
test('worker perf: deterministic nested Unicode/typed-array corpus roundtrips', () => {
    let state = 0x2a879; const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
    const value = depth => depth > 5 ? next() : [null, true, 'δ' + (next() % 11), new Uint8Array([next() & 255]), { Value: depth, Child: next() % 2 ? value(depth + 1) : [] }][next() % 5];
    for (let i = 0; i < 100; ++i) { const v = value(0); assert.deepEqual(roundTrip(v).decoded.Value, v); }
});
test('worker perf: deeply repeated objects still respect nesting and key safety', () => {
    let v = 'x'; for (let i = 0; i < 100; ++i) v = [v];
    assert.throws(() => EncodeCompositionBatch(v), /nesting/);
    assert.throws(() => EncodeCompositionBatch(JSON.parse('{"constructor":1}')), /Forbidden/);
});

test('worker perf: placement-only patches omit retained drawing instructions and resource metadata', async () => {
    const f = fixture(); try {
        await f.commit(); const old = f.server.Visuals.get(f.content.VisualId).Before;
        f.content.Arrange(new Rect(7, 4, f.content.Bounds.Width, f.content.Bounds.Height));
        const batch = await f.commit(), patch = batch.Value.Nodes.Patch.find(x => x.Id === f.content.VisualId);
        assert(patch); assert(!Object.hasOwn(patch.Set, 'Before')); assert(!Object.hasOwn(patch.Set, 'After')); assert(!Object.hasOwn(patch.Set, 'Resources'));
        assert.equal(f.server.Visuals.get(f.content.VisualId).Before, old);
    } finally { f.Dispose(); }
});
test('worker perf: pending patches are rebased against ACK, not an intermediate desired state', () => {
    const acc = new CompositionChangeAccumulator();
    const snap = x => ({ Root: 1, Width: 1, Height: 1, Scale: 1, Nodes: new Map([[1, { Id: 1, Version: x, Bounds: [x,0,1,1] }]]), Resources: new Map(), Composition: new Map() });
    acc.Update(snap(0)); const first = acc.Prepare(); acc.Update(snap(10)); acc.Update(snap(20)); assert.equal(acc.Prepare(), null);
    acc.Acknowledge(first.Sequence, first.Generation); const second = acc.Prepare(); assert.deepEqual(second.Value.Nodes.Patch[0].Set.Bounds, [20,0,1,1]);
});
for (const [name, make] of [
    ['missing target', f => ({ Id: 999999, Set: { Opacity: .5 } })],
    ['Id replacement', f => ({ Id: f.root.VisualId, Set: { Id: 999999 } })],
    ['unknown field', f => ({ Id: f.root.VisualId, Set: { NotAVersion: 1 } })],
    ['prototype member', f => ({ Id: f.root.VisualId, Set: JSON.parse('{"__proto__":null}') })],
]) test(`worker perf: patch rejects ${name} without mutating scene`, async () => {
    const f = fixture(); try { await f.commit(); const old = f.server.Nodes;
        await assert.rejects(f.server.Apply(f.delta({ Nodes: { Upsert: [], Remove: [], Patch: [make(f)] } })), /Invalid/);
        assert.equal(f.server.Nodes, old); assert.equal(f.server.Sequence, 1);
    } finally { f.Dispose(); }
});
test('worker perf: conflicting patch/remove operations and patches in full snapshots are rejected', async () => {
    const f = fixture(); try {
        await f.commit(); const changes = { Upsert: [], Remove: [f.content.VisualId], Patch: [{ Id: f.content.VisualId, Set: { Opacity: 0 } }] };
        await assert.rejects(f.server.Apply(f.delta({ Nodes: changes })), /Invalid/);
        const full = f.delta(); full.Full = true; full.Generation++;
        full.Value.Nodes = { Upsert: [...f.server.Nodes.values()], Remove: [], Patch: [{ Id: f.root.VisualId, Set: { Opacity: .5 } }] };
        await assert.rejects(f.server.Apply(full), /Invalid/);
    } finally { f.Dispose(); }
});
test('worker perf: patched commands are checked even when content revision is unchanged', async () => {
    const f = fixture(); try {
        await f.commit(); const old = f.server.Nodes;
        const patch = { Id: f.content.VisualId, Set: { Before: [[2]] } };
        await assert.rejects(f.server.Apply(f.delta({ Nodes: { Upsert: [], Remove: [], Patch: [patch] } })), /underflow/); assert.equal(f.server.Nodes, old);
    } finally { f.Dispose(); }
});
test('worker perf: changed native descriptors fail before committed state is replaced', async () => {
    const f = fixture(); try { await f.commit(); const old = f.server.Nodes;
        await assert.rejects(f.server.Apply(f.delta({ Nodes: { Upsert: [], Remove: [], Patch: [{ Id: f.root.VisualId, Set: { Clip: { $: 'Impossible' } } }] } })), /Unknown/);
        assert.equal(f.server.Nodes, old); assert.equal(f.server.Sequence, 1);
    } finally { f.Dispose(); }
});
test('worker perf: removal revalidates cached references of untouched display lists', async () => {
    const f = fixture(); try { await f.commit(); const id = [...f.server.Resources.keys()][0];
        await assert.rejects(f.server.Apply(f.delta({ Resources: { Upsert: [], Remove: [id] } })), /Missing resource/); assert.equal(f.server.Sequence, 1);
    } finally { f.Dispose(); }
});
test('worker perf: placement-only transaction does not repeat graph validation', async () => {
    const f = fixture(); try { await f.commit(); const graph = f.server.Statistics.GraphChecks, walked = f.server.Statistics.ReferenceObjectsWalked;
        f.content.Arrange(new Rect(4, 6, f.content.Bounds.Width, f.content.Bounds.Height)); await f.commit();
        assert.equal(f.server.Statistics.GraphChecks, graph); assert(f.server.Statistics.ReferenceObjectsWalked - walked < 35);
    } finally { f.Dispose(); }
});
test('worker perf: cached descriptors are immutable, including nested clip arrays', async () => {
    const f = fixture(); try { await f.commit(); const node = f.server.Nodes.get(f.root.VisualId);
        assert(Object.isFrozen(node)); assert(Object.isFrozen(node.Children)); assert(Object.isFrozen(node.Bounds));
        assert.throws(() => node.Bounds[0] = 12, TypeError);
    } finally { f.Dispose(); }
});
test('worker perf: cycle inserted by a patch is rejected after prior topology was cached', async () => {
    const f = fixture(); try { await f.commit(); const node = f.server.Nodes.get(f.content.VisualId);
        const patch = { Id: node.Id, Set: { Children: [{ Id: f.root.VisualId, Clip: null }] } };
        await assert.rejects(f.server.Apply(f.delta({ Nodes: { Upsert: [], Remove: [], Patch: [patch] } })), /cycle/);
    } finally { f.Dispose(); }
});
test('worker perf: actual resource references participate in cycle checks even without declared Depends', async () => {
    const f = fixture(); try { await f.commit();
        const make = (Id, target) => ({ Id, Kind: 'Geometry', Depends: [], Data: { Data: 'M0 0L1 1', Transform: { $ref: target } } });
        await assert.rejects(f.server.Apply(f.delta({ Resources: { Upsert: [make(70001,70002),make(70002,70001)], Remove: [] } })), /cycle/);
    } finally { f.Dispose(); }
});
test('worker perf: retained reference summaries handle deep shared descriptors without rescanning', () => {
    const index = new CompositionReferenceIndex(); const drawing = Array.from({ length: 300 }, (_, i) => [8, { $ref: i + 1 }, { $: 'Point', V: [i,0] }]);
    index.Get({ Before: drawing }); const initial = index.Statistics.ObjectsWalked;
    index.Get({ Before: drawing }); assert.equal(index.Statistics.ObjectsWalked, initial + 1);
    const loop = {}; loop.Value = loop; assert.throws(() => index.Get(loop), /Cyclic/);
});
test('worker perf: off-tree VisualBrush in a TEXT RESOURCE stays live and invalidates independently', () => {
    const source = new Border(new TextBlock('source')), text = new TextBlock('brush text'); source.Width = 100; source.Height = 50; text.Foreground = new VisualBrush(source);
    const f = fixture(text); try { const a = f.recorder.Capture(); assert(a.Nodes.has(source.VisualId));
        source.Child.Text = 'changed'; const b = f.recorder.Capture(); assert.notEqual(a.Nodes.get(source.Child.VisualId), b.Nodes.get(source.Child.VisualId));
        text.Foreground = '#000000'; f.recorder.Capture(); assert.equal(f.recorder._visualSources.size, 0);
    } finally { f.Dispose(); source.Dispose(); }
});
test('worker perf: equal independent text layouts share one immutable resource', () => {
    const registry = new CompositionResourceRegistry({}), a = new TextLayout('Same label'), b = new TextLayout('Same label');
    try { const x = registry.Encode(a), y = registry.Encode(b); assert.equal(x.$ref, y.$ref); assert.equal(registry.Entries.size, 1); assert.equal(registry.Statistics.InternHits, 1); }
    finally { registry.Dispose(); a.Dispose(); b.Dispose(); }
});
test('worker perf: text resource interning preserves width, color, typeface and spacing differences', () => {
    const registry = new CompositionResourceRegistry({}), layouts = [
        new TextLayout('Same label'), new TextLayout('Same label', new Typeface('serif')),
        new TextLayout('Same label', undefined, 12, '#ff0000'), new TextLayout('Same label', undefined, 12, undefined, { LetterSpacing: 1 }),
        new TextLayout('Same label', undefined, 12, undefined, { MaxWidth: 15, TextWrapping: 'Wrap' }),
    ];
    try { const ids = layouts.map(x => registry.Encode(x).$ref); assert.equal(new Set(ids).size, ids.length); }
    finally { registry.Dispose(); for (const layout of layouts) layout.Dispose(); }
});
test('worker perf: one shared-resource owner changing revision cannot overwrite another owner', () => {
    const registry = new CompositionResourceRegistry({}), a = {}, b = {};
    try {
        const x = registry.Define('Text', a, 1, () => ({ Text: 'first' }), 'text:first');
        const y = registry.Define('Text', b, 1, () => ({ Text: 'first' }), 'text:first'); assert.equal(x.$ref, y.$ref);
        const z = registry.Define('Text', a, 2, () => ({ Text: 'second' }), 'text:second'); assert.notEqual(z.$ref, y.$ref);
        assert.equal(registry.Entries.get(y.$ref).Data.Text, 'first');
        registry.Sweep(new Map([[z.$ref, registry.Entries.get(z.$ref)]])); assert.equal(registry._interned.size, 1);
    } finally { registry.Dispose(); }
});
test('worker perf: shared text is retained until its last visible consumer is gone', async () => {
    const panel = new StackPanel(), a = new TextBlock('duplicate'), b = new TextBlock('duplicate'); panel.Children.AddRange([a,b]); const f = fixture(panel);
    try { await f.commit(); assert.equal(f.server.Resources.size, 1); const id = [...f.server.Resources.keys()][0];
        panel.Children.Remove(a); await f.commit(); assert(f.server.Resources.has(id));
        panel.Children.Remove(b); await f.commit(); assert.equal(f.server.Resources.size, 0);
    } finally { f.Dispose(); a.Dispose(); b.Dispose(); }
});
test('worker perf: no-editor acknowledgement traffic is suppressed but focus/editor updates are not', () => {
    const sent = [], root = { HostConnection: { Send: value => sent.push(value) } };
    for (let i = 0; i < 1000; ++i) WorkerTopLevel.prototype._SendEditor.call(root, { Owner: null, AcknowledgedInput: i });
    assert.equal(sent.length, 1);
    WorkerTopLevel.prototype._SendEditor.call(root, { Owner: 4, Value: 'a', AcknowledgedInput: 1000 });
    WorkerTopLevel.prototype._SendEditor.call(root, { Owner: 4, Value: 'ab', AcknowledgedInput: 1001 });
    WorkerTopLevel.prototype._SendEditor.call(root, { Owner: null, AcknowledgedInput: 1002 }); assert.equal(sent.length, 4);
});
test('worker perf: key/focus event forwarding does not force a canvas layout read', () => {
    let calls = 0; const host = { Canvas: { getBoundingClientRect() { ++calls; return { left: 10, top: 20 }; } } };
    assert.equal(BrowserWorkerApplication.prototype._Event.call(host, { type: 'keydown', key: 'A' }).key, 'A'); assert.equal(calls, 0);
    const pointer = BrowserWorkerApplication.prototype._Event.call(host, { type: 'pointermove', clientX: 40, clientY: 60 });
    assert.equal(calls, 1); assert.deepEqual(pointer.Position, { X: 30, Y: 40 });
});
test('worker perf: submitted/frame duplicate notification projects state once but acknowledges credit', () => {
    const messages = [], r = new WorkerSkiaRenderer({}, { RenderScaling: 1 }, null); r.Port = { postMessage: value => messages.push(value) };
    let frames = 0; r.FrameRendered.Add(() => ++frames);
    r._Message({ Type: 'submitted', Sequence: 0, Generation: 1, Frame: 1, Duration: 0, Backend: 'canvas' });
    r._Message({ Type: 'frame', Sequence: 0, Generation: 1, Frame: 1, Duration: 0, Backend: 'canvas' });
    assert.equal(frames, 1); assert.equal(messages.filter(x => x.Type === 'frame-ack').length, 1);
    r.Recorder.Dispose(); r.BufferPool.Clear();
});
test('worker perf: exact identity transforms skip native state operations without losing ink', async () => {
    const f = fixture(); try { await f.commit(); const ctx = new RecordingDrawingContext(); f.server.Render(ctx); ctx.Dispose();
        assert(f.server.Statistics.IdentityTransformsSkipped > 0); assert(ctx.Commands.some(x => x.Op === 'Text'));
    } finally { f.Dispose(); }
});
