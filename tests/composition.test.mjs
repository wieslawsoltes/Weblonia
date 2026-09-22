import test from 'node:test';
import assert from 'node:assert/strict';
import { Compositor, ManualClock, CompositionExpression, RecordingDrawingContext, Point, Vector, Colors, Color, ElementComposition, Border, Size, Rect } from '@wieslawsoltes/avalonia';
function record(visual) {const context=new RecordingDrawingContext();visual.Render(context);context.Dispose();return context.Commands;}

test('composition snapshots publish atomically at commit, not at property assignment', async () => {
    const compositor=new Compositor({AutoCommit:false}),visual=compositor.CreateSolidColorVisual(Colors.Red);visual.Size=new Vector(30,40);visual.Offset={X:3,Y:7,Z:0};
    await compositor.Commit().Processed;visual.Color=Colors.Blue;visual.Offset={X:50,Y:20,Z:0};
    const before=record(visual);assert.ok(before.find(c=>c.Op==='Rectangle').Brush.Equals(Colors.Red));assert.equal(before[0].Value.M31,3);
    const batch=compositor.Commit();await batch.Processed;assert.equal(batch.Revision,2);const after=record(visual);assert.ok(after.find(c=>c.Op==='Rectangle').Brush.Equals(Colors.Blue));assert.equal(after[0].Value.M31,50);compositor.Dispose();
});
test('visual collections reject duplicate parents, cycles, and cross-compositor resources', () => {
    const c=new Compositor({AutoCommit:false}),other=new Compositor({AutoCommit:false}),a=c.CreateContainerVisual(),b=c.CreateContainerVisual(),v=c.CreateSolidColorVisual();
    a.Children.Add(b);b.Children.Add(v);assert.throws(()=>a.Children.Add(v),/parent/);assert.throws(()=>b.Children.Add(a),/cycle/);assert.throws(()=>a.Children.Add(other.CreateContainerVisual()),/compositor/);
    c.Commit();assert.equal(a.Children._committed.length,1);a.Children.Remove(b);assert.equal(a.Children._committed.length,1);c.Commit();assert.equal(a.Children._committed.length,0);c.Dispose();other.Dispose();
});
test('scalar keyframes are deterministic and cancellation restores the base property', () => {
    const clock=new ManualClock(),c=new Compositor({Clock:clock,AutoCommit:false}),v=c.CreateSolidColorVisual();v.Opacity=.4;c.Commit();
    const animation=c.CreateScalarKeyFrameAnimation();animation.Duration=100;animation.InsertKeyFrame(1,1);v.StartAnimation('Opacity',animation);
    clock.Advance(50);assert.ok(Math.abs(v._Read('Opacity')-.7)<1e-10);assert.equal(v.Opacity,.4);
    v.StopAnimation('Opacity');assert.equal(v._Read('Opacity'),.4);assert.equal(clock._listeners.size,0);c.Dispose();
});
test('keyframe clocks stop after completion and retain final presentation state', () => {
    const clock=new ManualClock(),c=new Compositor({Clock:clock,AutoCommit:false}),v=c.CreateSolidColorVisual();v.Offset={X:10,Y:0,Z:0};c.Commit();
    const a=c.CreateScalarKeyFrameAnimation();a.Duration=100;a.InsertKeyFrame(0,10);a.InsertKeyFrame(1,30);v.StartAnimation('Offset.X',a);clock.Advance(100);
    assert.equal(v._Read('Offset').X,30);assert.equal(v.Offset.X,10);assert.equal(clock._listeners.size,0);c.Dispose();
});
test('alternating keyframes and delay use the injected clock', () => {
    const clock=new ManualClock(),c=new Compositor({Clock:clock,AutoCommit:false}),v=c.CreateSolidColorVisual();v.Opacity=0;c.Commit();
    const a=c.CreateScalarKeyFrameAnimation();a.Duration=100;a.DelayTime=20;a.IterationCount=2;a.Direction='Alternate';a.InsertKeyFrame(0,0);a.InsertKeyFrame(1,1);v.StartAnimation('Opacity',a);
    clock.Advance(10);assert.equal(v._Read('Opacity'),0);clock.Advance(60);assert.equal(v._Read('Opacity'),.5);clock.Advance(100);assert.equal(v._Read('Opacity'),.5);clock.Advance(50);assert.equal(v._Read('Opacity'),0);c.Dispose();
});
test('expression parser supports vectors, arithmetic, functions and lazy conditionals', () => {
    const expr=new CompositionExpression('enabled ? Vector3(Clamp(value * 2, 0, 100), Sin(Pi / 2) * 20, 0) : missing');
    assert.deepEqual(expr.Evaluate({enabled:true,value:80}),{X:100,Y:20,Z:0});
    assert.equal(new CompositionExpression('false && missing').Evaluate(),false);
    assert.deepEqual(new CompositionExpression('Vector2(1,2) * 3 + Vector2(2,1)').Evaluate(),{X:5,Y:7});
    for(const text of ['window.alert(1)','this.constructor.constructor(1)','x.__proto__','1; globalThis()','unknown(2)','a[0]'])assert.throws(()=>new CompositionExpression(text));
    assert.throws(()=>new CompositionExpression('thing.bad').Evaluate({thing:{}}),/not available/);
});
test('expression references observe committed property-set values', () => {
    const clock=new ManualClock(),c=new Compositor({Clock:clock,AutoCommit:false}),v=c.CreateSolidColorVisual(),state=c.CreatePropertySet();
    state.InsertScalar('Progress',.2);c.Commit();const a=c.CreateExpressionAnimation('Clamp(state.Progress * factor, 0, 1)');a.SetReferenceParameter('state',state);a.SetScalarParameter('factor',2);v.StartAnimation('Opacity',a);
    clock.Advance(16);assert.equal(v._Read('Opacity'),.4);state.InsertScalar('Progress',.4);clock.Advance(16);assert.equal(v._Read('Opacity'),.4);c.Commit();clock.Advance(16);assert.equal(v._Read('Opacity'),.8);c.Dispose();assert.equal(clock._listeners.size,0);
});
test('custom visuals receive queued messages before rendering', () => {
    const c=new Compositor({AutoCommit:false});let number=0;const visual=c.CreateCustomVisual({OnMessage(n){number=n;},OnRender(ctx){ctx.DrawRectangle('#ff0000',null,new Rect(0,0,number,10));}});
    visual.SendHandlerMessage(47);assert.equal(number,0);c.Commit();assert.equal(number,47);assert.equal(record(visual).find(x=>x.Op==='Rectangle').Rect.Width,47);c.Dispose();
});
test('commit failures reject the batch and do not strand subsequent commits', async () => {
    const c=new Compositor({AutoCommit:false});c.RequestCompositionUpdate(()=>{throw new Error('bad update');});const batch=c.Commit();await assert.rejects(batch.Processed,/bad update/);
    let done=false;c.RequestCompositionUpdate(()=>{done=true;});await c.Commit().Processed;assert.equal(done,true);c.Dispose();
});
test('disposing a compositor rejects pending batches and disposes its object graph', async () => {
    const c=new Compositor({AutoCommit:false}),v=c.CreateContainerVisual(),batch=c.RequestCompositionBatchCommitAsync();c.Dispose();await assert.rejects(batch.Processed,/disposed/);assert.equal(v.IsDisposed,true);
});
test('compositor disposal clears events and invokes custom handler disposal only once', () => {
    const c = new Compositor({AutoCommit:false}); let disposed = 0;
    const visual = c.CreateCustomVisual({OnDispose(){disposed++;}});
    c.AfterCommit.Add(()=>{}); c.Errors.Add(()=>{}); visual.Dispose(); visual.Dispose();
    assert.equal(disposed,1); c.Dispose(); assert.equal(c.AfterCommit.Count,0); assert.equal(c.Errors.Count,0);
    assert.equal(c._dirty.size,0); assert.equal(c._animatedObjects.size,0);
});
