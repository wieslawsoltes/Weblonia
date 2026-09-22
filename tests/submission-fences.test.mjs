import test from 'node:test';
import assert from 'node:assert/strict';
import { Size } from '@wieslawsoltes/avalonia-base';
import { WorkerSkiaRenderer } from '../packages/browser/src/render-thread.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const snapshot = n => ({ Root: 1, Width: 20, Height: 20, Scale: 1, FontVersion: 0,
    InputSequence: n, Nodes: new Map(), Resources: new Map(), Composition: new Map() });
function rig(t, options = {}) {
    const r = new WorkerSkiaRenderer({}, { RenderScaling: 1, ClientSize: new Size(20,20), _RequestRender(){} }, null,
        { RequestTimeout: 1000, ...options });
    const sent = []; let frame = 0;
    r.Backend = 'canvas'; r.Port = { postMessage(m) { sent.push(m); }, close(){} }; r._ready.Resolve(r);
    t.after(() => { r._Fail(new Error('Test teardown')); r.Recorder.Dispose(); r.BufferPool.Clear(); });
    return { r, sent,
        capture(n) { r.Accumulator.Update(snapshot(n)); r._Pump(); },
        processed() { const f = r.Accumulator.InFlight; assert.ok(f); r._Message({ Type:'processed', Sequence:f.Batch.Sequence, Generation:f.Batch.Generation }); },
        submitted(sequence, generation=r.Accumulator.Generation) { r._Message({ Type:'submitted', Sequence:sequence,
            Generation:generation, Frame:++frame, Duration:0, Backend:'canvas' }); }
    };
}
function watch(p) { const result = { Resolved:false }; result.Promise = p.then(() => { result.Resolved=true; }); result.Promise.catch(()=>{}); return result; }

test('submission fence resolves its captured frame while a newer animation batch is in flight', async t => {
    const a=rig(t);a.capture(1);const first=watch(a.r.FlushAsync());await tick();
    a.capture(2);a.processed();assert.equal(a.r.Accumulator.InFlight.Batch.Sequence,2);
    a.submitted(1);await tick();assert.equal(first.Resolved,true);await first.Promise;
    assert.equal(a.r.Accumulator.InFlight.Batch.Sequence,2,'Completion must not discard later animation');
});
test('submission fence includes backpressured work but never chases later revisions', async t => {
    const a=rig(t);a.capture(1);a.capture(2);const wait=watch(a.r.FlushAsync());await tick();
    a.submitted(1);await tick();assert.equal(wait.Resolved,false,'Old submitted scene is insufficient');
    a.capture(3);a.processed();assert.equal(a.r.Accumulator.InFlight.Revision,3);
    assert.equal(a.r._waiters[0].Sequence,2);
    a.capture(4);a.processed();a.submitted(2);await tick();
    assert.equal(wait.Resolved,true);assert.equal(a.r.Accumulator.InFlight.Revision,4);await wait.Promise;
});
test('submission fences retain independent targets across multiple callers', async t => {
    const a=rig(t);a.capture(1);const first=watch(a.r.FlushAsync());await tick();
    a.capture(2);const second=watch(a.r.FlushAsync());await tick();
    a.processed();a.submitted(1);await tick();assert.equal(first.Resolved,true);assert.equal(second.Resolved,false);
    a.processed();a.submitted(2);await second.Promise;assert.equal(a.r._waiters.length,0);
});
test('semantic no-op capture waits for submission of the acknowledged transaction, not another frame', async t => {
    const a=rig(t);a.capture(1);a.processed();a.capture(1);const wait=watch(a.r.FlushAsync());await tick();
    assert.equal(a.sent.filter(m=>m.Type==='batch').length,1);assert.equal(wait.Resolved,false);
    a.submitted(1);await wait.Promise;
    await a.r.FlushAsync();assert.equal(a.sent.filter(m=>m.Type==='batch').length,1);
});
test('submission notification before processed acknowledgement can complete a prepared fence', async t => {
    const a=rig(t);a.capture(1);const wait=watch(a.r.FlushAsync());await tick();
    a.submitted(1);await wait.Promise;assert.ok(a.r.Accumulator.InFlight);
    a.processed();assert.equal(a.r._waiters.length,0);
});
test('hidden submission is requested only for processed work and coalesces outstanding fences', async t => {
    const a=rig(t);a.r.SetVisible(false);a.capture(1);let renders=0,finish;
    a.r.RequestAsync=async method=>{assert.equal(method,'render');renders++;await new Promise(resolve=>finish=resolve);};
    const first=a.r.FlushAsync(),second=a.r.FlushAsync();await tick();assert.equal(renders,0);
    a.processed();await tick();assert.equal(renders,1);a.r._CheckWaiters();assert.equal(renders,1);
    a.submitted(1);finish();await Promise.all([first,second]);await tick();assert.equal(renders,1);
});
test('stale generation submissions cannot satisfy current fences', async t => {
    const a=rig(t);a.capture(1);const wait=watch(a.r.FlushAsync());await tick();
    a.submitted(999,0);await tick();assert.equal(wait.Resolved,false);assert.equal(a.r.Statistics.SubmittedSequence,0);
    a.submitted(1);await wait.Promise;
});
test('renderer failure rejects all pending fences and releases their queue slots', async t => {
    const a=rig(t);a.capture(1);const wait=a.r.FlushAsync();await tick();a.r._Fail(new Error('Device failed'));
    await assert.rejects(wait,/Device failed/);assert.equal(a.r._waiters.length,0);
});
test('submission fence timeout releases its queue slot', async t => {
    const a=rig(t,{RequestTimeout:10});a.capture(1);await assert.rejects(a.r.FlushAsync(),/submission timed out/);
    assert.equal(a.r._waiters.length,0);
});
test('submission fence queue remains bounded without abandoning its existing caller', async t => {
    const a=rig(t,{MaxRequests:1});a.capture(1);const wait=a.r.FlushAsync();await tick();
    await assert.rejects(a.r.FlushAsync(),/queue is full/);a.submitted(1);await wait;assert.equal(a.r._waiters.length,0);
});
test('restart during initialization rejects a flush of the previous generation', async t => {
    const a=rig(t);let ready;a.r._ready={Promise:new Promise(resolve=>ready=resolve),Reject(){}};
    const wait=a.r.FlushAsync();a.r.Accumulator.Reset();ready();await assert.rejects(wait,/restarted/);
});

test('old hidden-render rejection cannot poison or unlock a restarted renderer', async t => {
    const a=rig(t);a.r.SetVisible(false);a.capture(1);let reject;
    a.r.RequestAsync=()=>new Promise((_,j)=>reject=j);
    const wait=a.r.FlushAsync();await tick();a.processed();await tick();
    a.r.Accumulator.Reset();a.r._CheckWaiters();await assert.rejects(wait,/restarted/);
    a.r._hiddenSubmission=true; // A request belonging to the replacement generation.
    reject(new Error('Old renderer interrupted'));await tick();
    assert.equal(a.r.LastError,undefined);assert.equal(a.r._hiddenSubmission,true);
});
