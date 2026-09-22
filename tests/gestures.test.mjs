import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';

const pointer = (id = 1, type = 'Touch') => new A.Pointer(id, type, true);
function input(control, p, kind, x, y, time = 0) {
    const types = { down: ['PointerPressed', A.PointerPressedEventArgs], move: ['PointerMoved', A.PointerEventArgs], up: ['PointerReleased', A.PointerReleasedEventArgs] };
    const [name, Type] = types[kind];
    const target = p.CapturedGestureRecognizer?.Target ?? p.Captured ?? control;
    const e = new Type(A.InputElement[name + 'Event'], target, p, new A.Point(x, y), { buttons: kind === 'up' ? 0 : 1, button: 0, timeStamp: time });
    target.RaiseEvent(e);
    return e;
}
function scrollFixture(clock) {
    const target = new A.Border(), gesture = new A.ScrollGestureRecognizer(clock);
    gesture.CanVerticallyScroll = true;
    target.GestureRecognizers.Add(gesture);
    const deltas = [], ended = [], inertia = [];
    target.ScrollGesture.Add((_, e) => { deltas.push(e.Delta); e.Handled = true; });
    target.ScrollGestureEnded.Add((_, e) => ended.push(e.Id));
    target.ScrollGestureInertiaStarting.Add((_, e) => inertia.push(e.Inertia));
    return { target, gesture, deltas, ended, inertia };
}
class Clock {
    time = 0;
    queue = new Set();
    Now() { return this.time; }
    Request(fn) { this.queue.add(fn); return A.Disposable.Create(() => this.queue.delete(fn)); }
    Step(ms) { this.time += ms; const callbacks = [...this.queue]; this.queue.clear(); for (const fn of callbacks) fn(this.time); }
}

test('gesture collections enforce single ownership, duplicate rejection and immediate batched ownership', () => {
    const a = new A.Border(), b = new A.Border(), r = new A.PinchGestureRecognizer();
    const batch = a.GestureRecognizers.BeginUpdate();
    a.GestureRecognizers.Add(r);
    assert.equal(r.Target, a);
    assert.throws(() => b.GestureRecognizers.Add(r), /another collection/);
    assert.throws(() => a.GestureRecognizers.Add(r), /Duplicate/);
    assert.throws(() => a.GestureRecognizers.Add({}), /GestureRecognizer/);
    batch.Dispose(); a.GestureRecognizers.Remove(r); b.GestureRecognizers.Add(r);
    assert.equal(r.Target, b); r.Dispose(); assert.equal(b.GestureRecognizers.Count, 0);
    a.Dispose(); b.Dispose();
});
test('gesture collection replacement and owner disposal detach contacts without sharing lifetimes', () => {
    const target = new A.Border(), a = new A.PinchGestureRecognizer(), b = new A.ScrollGestureRecognizer();
    target.GestureRecognizers.Add(a); target.GestureRecognizers.ReplaceAll([b]);
    assert.equal(a.Target, null); assert.equal(b.Target, target);
    target.Dispose(); assert.equal(b.Target, null);
    assert.throws(() => target.GestureRecognizers.Add(a), /disposed/);
});
test('scroll threshold subtracts its dead zone and captures separately from element capture', () => {
    const f = scrollFixture(), p = pointer();
    input(f.target, p, 'down', 0, 100, 0); input(f.target, p, 'move', 0, 97, 10);
    assert.equal(f.deltas.length, 0);
    input(f.target, p, 'move', 0, 80, 20);
    assert.equal(f.deltas[0].Y, 15); assert.equal(p.Captured, null); assert.equal(p.CapturedGestureRecognizer, f.gesture);
    input(f.target, p, 'move', 0, 70, 30); assert.equal(f.deltas[1].Y, 10);
    input(f.target, p, 'up', 0, 70, 35);
    assert.equal(f.ended.length, 1); assert.equal(p.CapturedGestureRecognizer, null); assert.equal(p._gestureCandidates.length, 0);
    f.target.Dispose();
});
test('Mouse contacts are never converted into touch scrolling', () => {
    const f = scrollFixture(), p = pointer(1, 'Mouse');
    input(f.target, p, 'down', 0, 100); input(f.target, p, 'move', 0, 0, 20); input(f.target, p, 'up', 0, 0, 30);
    assert.equal(f.deltas.length, 0); f.target.Dispose();
});
test('Pen contacts use the same threshold and release contracts as touch', () => {
    const f = scrollFixture(), p = pointer(1, 'Pen');
    input(f.target, p, 'down', 0, 100); input(f.target, p, 'move', 0, 70, 20);
    assert.equal(f.deltas[0].Y, 25); p.Cancel(); assert.equal(f.ended.length, 1); f.target.Dispose();
});
test('unhandled scroll does not steal element capture', () => {
    const target = new A.Border(), r = new A.ScrollGestureRecognizer(), p = pointer();
    r.CanVerticallyScroll = true; target.GestureRecognizers.Add(r);
    input(target, p, 'down', 0, 100); p.Capture(target); input(target, p, 'move', 0, 50, 20);
    assert.equal(p.Captured, target); assert.equal(p.CapturedGestureRecognizer, null);
    p.Cancel(); target.Dispose();
});
test('ScrollViewer cancels a pressed button before dragging can invoke Click', () => {
    const button = Object.assign(new A.Button('Drag me'), { Width: 200, Height: 800 });
    const viewer = new A.ScrollViewer(button), root = new HeadlessTopLevel(new A.Size(240, 200));
    root.Content = viewer; root.Layout(); viewer._touchScroll.IsScrollInertiaEnabled = false;
    let clicks = 0; button.Click.Add(() => clicks++);
    const p = new A.Pointer(1, 'Touch', root);
    input(button, p, 'down', 40, 120); assert.equal(button.IsPressed, true);
    input(button, p, 'move', 40, 50, 20);
    assert.equal(button.IsPressed, false); assert.equal(p.Captured, null);
    assert.equal(p.CapturedGestureRecognizer, viewer._touchScroll); assert.equal(viewer.Offset.Y, 65);
    input(button, p, 'up', 40, 50, 30); assert.equal(clicks, 0); assert(p._suppressTap);
    root.Dispose();
});
test('a normal touch tap still invokes Button.Click once', () => {
    const button = Object.assign(new A.Button('Tap'), { Width: 100, Height: 100 });
    const root = new HeadlessTopLevel(new A.Size(100, 100)); root.Content = button; root.Layout();
    let clicks = 0; button.Click.Add(() => clicks++); const p = new A.Pointer(2, 'Touch', root);
    input(button, p, 'down', 50, 50); input(button, p, 'up', 50, 50, 20);
    assert.equal(clicks, 1); assert(!p._suppressTap); root.Dispose();
});
test('nested boundary-aware scroll recognizers yield to an ancestor that can consume movement', () => {
    const child = new A.Border(), parent = new A.Border(); parent.Child = child;
    const inner = new A.ScrollGestureRecognizer(), outer = new A.ScrollGestureRecognizer();
    for (const r of [inner, outer]) r.CanVerticallyScroll = true;
    inner.Offset = new A.Point(); inner.Extent = inner.Viewport = new A.Size(100,100);
    child.GestureRecognizers.Add(inner); parent.GestureRecognizers.Add(outer);
    parent.ScrollGesture.Add((_, e) => e.Handled = true);
    const p = pointer(); input(child,p,'down',0,100); input(child,p,'move',0,50,20);
    assert.equal(p.CapturedGestureRecognizer,outer); p.Cancel(); parent.Dispose();
});
test('pinch reports finite scale, midpoint, angle and exactly one end event', () => {
    const target = new A.Border(), r = new A.PinchGestureRecognizer(), p = pointer(1), q = pointer(2), values = [];
    target.GestureRecognizers.Add(r); target.Pinch.Add((_, e) => values.push(e)); let ended = 0; target.PinchEnded.Add(() => ended++);
    input(target,p,'down',0,0); input(target,q,'down',100,0);
    input(target,q,'move',200,0,10); assert.equal(values[0].Scale,2); assert.equal(values[0].ScaleOrigin.X,50);
    input(target,q,'move',0,200,20); assert.equal(Math.abs(values[1].AngleDelta),90);
    input(target,q,'up',0,200,30); input(target,p,'up',0,0,35);
    assert.equal(ended,1); assert.equal(r._contacts.size,0); target.Dispose();
});
test('coincident pinch contacts and an extra third contact do not produce NaN or extra captures', () => {
    const target = new A.Border(), r = new A.PinchGestureRecognizer(); target.GestureRecognizers.Add(r);
    const p=pointer(1),q=pointer(2),third=pointer(3); let last;
    target.Pinch.Add((_,e)=>last=e);
    input(target,p,'down',0,0); input(target,q,'down',0,0); input(target,third,'down',50,50);
    input(target,q,'move',0,0,10); assert.equal(last.Scale,1); assert.equal(third.CapturedGestureRecognizer,null);
    input(target,q,'move',100,0,20); assert.equal(last.Scale,1);
    input(target,q,'move',200,0,30); assert.equal(last.Scale,2);
    p.Cancel();q.Cancel();third.Cancel(); assert.equal(r._contacts.size,0); target.Dispose();
});
test('cancel and collection removal release both pinch capture and pending contacts', () => {
    const target=new A.Border(),r=new A.PinchGestureRecognizer(),p=pointer(1),q=pointer(2);target.GestureRecognizers.Add(r);
    let ended=0;target.PinchEnded.Add(()=>ended++);
    input(target,p,'down',0,0);input(target,q,'down',100,0);target.GestureRecognizers.Remove(r);
    assert.equal(p.CapturedGestureRecognizer,null);assert.equal(q.CapturedGestureRecognizer,null);assert.equal(ended,1);
    assert.equal(r._contacts.size,0);assert.equal(p._gestureCandidates.length,0);target.Dispose();
});
test('a second contact upgrades a running scroll to a pinch without leaving scroll state active', () => {
    const f=scrollFixture(),pinch=new A.PinchGestureRecognizer(),p=pointer(1),q=pointer(2);
    f.target.GestureRecognizers.Insert(0,pinch);
    input(f.target,p,'down',0,100);input(f.target,p,'move',0,50,10);assert.equal(p.CapturedGestureRecognizer,f.gesture);
    input(f.target,q,'down',100,50,20);assert.equal(p.CapturedGestureRecognizer,pinch);assert.equal(q.CapturedGestureRecognizer,pinch);
    assert.equal(f.ended.length,1);assert.equal(f.gesture._tracking,null);p.Cancel();q.Cancel();f.target.Dispose();
});
test('PreventGestureRecognition in a tunnel handler suppresses recognizers without suppressing ordinary input', () => {
    const f=scrollFixture(),p=pointer();let moved=0;
    f.target.AddHandler(A.InputElement.PointerPressedEvent,(_,e)=>e.PreventGestureRecognition(),A.RoutingStrategies.Tunnel);
    f.target.PointerMoved.Add(()=>moved++);
    input(f.target,p,'down',0,100);input(f.target,p,'move',0,0,20);input(f.target,p,'up',0,0,30);
    assert.equal(f.deltas.length,0);assert.equal(moved,1);assert(!p.IsGestureRecognitionSkipped);f.target.Dispose();
});
test('velocity estimator is bounded, rejects reversed time, tolerates duplicate timestamps and stale release', () => {
    const r=new A.VelocityTracker();
    for(let i=0;i<10000;i++)r.AddPosition(i,new A.Point(i*2,i*3));
    assert(r._samples.length<=20);assert.equal(r.GetVelocity().X,2000);assert.equal(r.GetVelocity().Y,3000);
    r.AddPosition(9999,new A.Point(19998,29997));r.AddPosition(1,new A.Point(1e9,1e9));
    assert.equal(r.GetVelocity().X,2000);assert.equal(r.GetVelocity(10101).Length,0);
});
function runInertia(frameMs) {
    const clock=new Clock(),f=scrollFixture(clock),p=pointer();f.gesture.IsScrollInertiaEnabled=true;
    input(f.target,p,'down',0,200,0);input(f.target,p,'move',0,180,10);input(f.target,p,'move',0,150,20);input(f.target,p,'up',0,150,21);
    assert.equal(f.inertia.length,1);
    for(let i=0;clock.queue.size&&i<1000;i++)clock.Step(frameMs);
    const sum=f.deltas.reduce((n,d)=>n+d.Y,0);
    assert.equal(clock.queue.size,0);assert.equal(f.ended.length,1);f.target.Dispose();return sum;
}
test('inertial displacement is frame-rate independent using analytic integration', () => {
    assert(Math.abs(runInertia(8)-runInertia(32))<1e-9);assert(Math.abs(runInertia(16)-runInertia(1000))<1e-9);
});
test('new press, disabled target, explicit cancellation and disposal stop inertia callbacks', () => {
    for(const action of ['press','disable','cancel','dispose']) {
        const clock=new Clock(),f=scrollFixture(clock),p=pointer();f.gesture.IsScrollInertiaEnabled=true;
        input(f.target,p,'down',0,100);input(f.target,p,'move',0,50,20);input(f.target,p,'up',0,50,21);
        assert.equal(clock.queue.size,1);
        if(action==='press')input(f.target,pointer(2),'down',0,100,30);
        if(action==='disable')f.target.IsEnabled=false;
        if(action==='cancel')f.gesture.Cancel();
        if(action==='dispose')f.target.Dispose();
        const count=f.deltas.length;clock.Step(1000);assert.equal(f.deltas.length,count);assert.equal(clock.queue.size,0);assert.equal(f.ended.length,1);
        f.target.Dispose();
    }
});
test('capture-lost reentrancy preserves the latest capturer', () => {
    const first=new A.Border(),second=new A.Border(),third=new A.Border(),p=pointer();
    first.PointerCaptureLost.Add(()=>p.Capture(third));p.Capture(first);p.Capture(second);
    assert.equal(p.Captured,third);p.Dispose();assert.equal(p.Captured,null);first.Dispose();second.Dispose();third.Dispose();
});
test('XAML builds recognizer collections and validates scalar options', () => {
    const view=new A.AvaloniaXamlCompiler().Compile(`<Border xmlns="https://github.com/avaloniaui"><Border.GestureRecognizers><PinchGestureRecognizer/><ScrollGestureRecognizer CanVerticallyScroll="True" ScrollStartDistance="9" /></Border.GestureRecognizers></Border>`).Build();
    assert.equal(view.GestureRecognizers.Count,2);assert.equal(view.GestureRecognizers.Get(0).Target,view);assert.equal(view.GestureRecognizers.Get(1).ScrollStartDistance,9);
    assert.throws(()=>view.GestureRecognizers.Get(1).ScrollStartDistance=-1,/nonnegative/);view.Dispose();
});
test('cancellation cannot be defeated by a capture-lost handler recapturing', () => {
    const first=new A.Border(),other=new A.Border(),p=pointer();
    first.PointerCaptureLost.Add(()=>p.Capture(other));p.Capture(first);p.Cancel();
    assert.equal(p.Captured,null);first.Dispose();other.Dispose();
});
test('detaching a visual subtree cancels active scroll and releases every contact', () => {
    const f=scrollFixture(),root=new HeadlessTopLevel();root.Content=f.target;root.Layout();const p=pointer();
    input(f.target,p,'down',0,100);input(f.target,p,'move',0,50,20);
    root.Content=null;
    assert.equal(p.CapturedGestureRecognizer,null);assert.equal(f.gesture._tracking,null);assert.equal(f.ended.length,1);
    f.target.Dispose();root.Dispose();
});
test('a disposed recognizer stops scheduled inertia, unsubscribes and can never be re-added', () => {
    const clock=new Clock(),f=scrollFixture(clock),p=pointer();f.gesture.IsScrollInertiaEnabled=true;
    input(f.target,p,'down',0,100);input(f.target,p,'move',0,50,20);input(f.target,p,'up',0,50,21);
    f.gesture.Dispose();const count=f.deltas.length;clock.Step(1000);
    assert.equal(f.deltas.length,count);assert.equal(f.target.GestureRecognizers.Count,0);
    assert.throws(()=>f.target.GestureRecognizers.Add(f.gesture),/undisposed/);f.target.Dispose();
});
test('scroll gesture end requests cancel before a subsequent movement is emitted', () => {
    const f=scrollFixture(),p=pointer();f.target.AddHandler(A.InputElement.ScrollGestureEvent,(_,e)=>e.ShouldEndScrollGesture=true,A.RoutingStrategies.Bubble,true);
    input(f.target,p,'down',0,100);input(f.target,p,'move',0,50,20);input(f.target,p,'move',0,0,30);
    assert.equal(f.deltas.length,1);assert.equal(f.ended.length,1);assert.equal(p.CapturedGestureRecognizer,null);
    p.Cancel();f.target.Dispose();
});
