import test from 'node:test';
import assert from 'node:assert/strict';
import { Dispatcher, DispatcherPriority as P, DispatcherOperationStatus as S, DispatcherTimer, DispatcherProcessingDisabled } from '@wieslawsoltes/avalonia-base';
function rig(options={}) {
    const micro=[],macro=[];let now=0;
    const dispatcher=new Dispatcher({QueueMicrotask:f=>micro.push(f),QueueTask:f=>macro.push(f),Now:()=>now,...options});
    return {d:dispatcher,micro,macro,advance:v=>now+=v,step:()=>micro.shift()?.(),turn:()=>macro.shift()?.()};
}
test('dispatcher priority values and invalid sentinels match Avalonia',()=>{
    assert.equal(P.Inactive.Value,-6);assert.equal(P.SystemIdle.Value,-5);assert.equal(P.Input.Value,-1);assert.equal(P.Default.Value,0);
    assert.equal(P.Render.Value,4);assert.equal(P.DataBind.Value,7);assert.equal(P.Normal.Value,8);assert.equal(P.Send.Value,9);
    for(let i=-6;i<=9;i++){const p=P.FromValue(i);assert.equal(+p,i);assert.ok(p.Equals(new P(i)));assert.equal(String(p),p.ToString());}
    for(const x of [-7,10,NaN,1.5,'8',null])assert.throws(()=>P.Validate(x),RangeError);
    assert.equal(P.Invalid.Value,-7);assert.equal(P.MaxValue,P.Send);assert.equal(P.Input.CompareTo(P.Render),-1);
});
test('dispatcher orders active work by priority and stable original FIFO after reprioritization',()=>{
    const {d}=rig(),out=[];const a=d.Post(()=>out.push('a'),P.Background),b=d.Post(()=>out.push('b'),P.Normal);d.Post(()=>out.push('c'),P.Normal);
    a.Priority=P.Normal;b.Priority=P.Input;b.Priority=P.Normal;assert.equal(d.RunJobs(),3);assert.deepEqual(out,['a','b','c']);
});
test('inactive operations remain pending without host wakeups until explicitly promoted',async()=>{
    const r=rig(),op=r.d.InvokeAsync(()=>42,P.Inactive);assert.equal(r.micro.length,0);assert.equal(r.d.RunJobs(),0);assert.equal(op.Status,S.Pending);
    assert.ok(r.d.HasJobsWithPriority(P.Inactive));op.Priority=P.Loaded;assert.equal(r.micro.length,1);r.step();assert.equal(await op,42);
});
test('InvokeAsync operations expose lazy tasks, statuses, results and one completion event',async()=>{
    const {d}=rig();let op,count=0;op=d.InvokeAsync(()=>{assert.equal(op.Status,S.Executing);assert.equal(op.Abort(),false);return 17;});
    op.Completed.Add(()=>count++);assert.equal(op._task,null);assert.throws(()=>op.Result,/not completed/);const p=op.GetTask();assert.equal(p,op.GetTask());
    d.RunJobs();assert.equal(op.Status,S.Completed);assert.equal(op.Result,17);assert.equal(await op,17);assert.equal(count,1);assert.equal(op.Abort(),false);
});
test('queued abortion removes work and callback immediately and settles lazy task exactly once',async()=>{
    const {d}=rig();const op=d.InvokeAsync(()=>assert.fail('Aborted callback executed'));let count=0;op.Aborted.Add(()=>count++);
    assert.ok(op.Abort());assert.equal(op.Abort(),false);assert.equal(d.PendingJobs,0);assert.equal(op._callback,null);assert.equal(op.Status,S.Aborted);
    assert.throws(()=>op.Result,{name:'AbortError'});await assert.rejects(op.GetTask(),{name:'AbortError'});assert.equal(count,1);
});
test('cancellation before enqueue and after enqueue preserves reason and never dispatches',async()=>{
    const {d}=rig(),c=new AbortController(),reason=new Error('cancel now');c.abort(reason);const a=d.InvokeAsync(()=>assert.fail(),P.Normal,c.signal);
    const c2=new AbortController(),b=d.InvokeAsync(()=>assert.fail(),P.Normal,c2.signal);c2.abort(reason);
    assert.equal(d.PendingJobs,0);assert.equal(b._signal,null);await assert.rejects(a.GetTask(),e=>e===reason);await assert.rejects(b.GetTask(),e=>e===reason);
});
test('executing work detaches cancellation without treating a late abort as a pending cancellation',async()=>{
    const {d}=rig(),c=new AbortController();const op=d.InvokeAsync(()=>{c.abort();return 5;},P.Normal,c.signal);d.RunJobs();assert.equal(await op,5);assert.equal(op._signal,null);
});
test('callback fault completes operation but rejects Task and Result without dispatcher unhandled event',async()=>{
    const {d}=rig();let events=0;d.UnhandledException.Add(()=>assert.fail('InvokeAsync fault escaped task'));const error=new Error('failure');
    const op=d.InvokeAsync(()=>{throw error;});op.Completed.Add(()=>events++);d.RunJobs();assert.equal(op.Status,S.Completed);assert.equal(events,1);
    await assert.rejects(op.GetTask(),e=>e===error);assert.throws(()=>op.Result,e=>e===error);
});
test('async result assimilation does not block subsequent dispatcher jobs',async()=>{
    const {d}=rig();let resolve,after=false;const op=d.InvokeAsync(()=>new Promise(r=>resolve=r));d.Post(()=>after=true);d.RunJobs();
    assert.equal(op.Status,S.Completed);assert.ok(after);resolve(23);assert.equal(await op,23);
});
test('self-return and hostile then getter reject without leaving executing operations',async()=>{
    const {d}=rig();let op;op=d.InvokeAsync(()=>op);const hostile=d.InvokeAsync(()=>({get then(){throw new Error('then getter');}}));d.RunJobs();
    await assert.rejects(op.GetTask(),/own operation/);await assert.rejects(hostile.GetTask(),/then getter/);assert.equal(hostile.Status,S.Completed);
});
test('handled Post exceptions continue draining while unhandled errors leave remaining queue usable',()=>{
    const {d}=rig();let calls=0;const token=d.UnhandledException.Add((_,e)=>{e.Handled=true;calls++;});d.Post(()=>{throw new Error('handled');});d.Post(()=>calls++);d.RunJobs();assert.equal(calls,2);
    token.Dispose();d.Post(()=>{throw new Error('unhandled');});d.Post(()=>calls++);assert.throws(()=>d.RunJobs(),/unhandled/);assert.equal(d.PendingJobs,1);d.RunJobs();assert.equal(calls,3);
});
test('exception filter can refuse catching a Post error',()=>{
    const {d}=rig();d.UnhandledExceptionFilter.Add((_,e)=>e.RequestCatch=false);d.UnhandledException.Add(()=>assert.fail());d.Post(()=>{throw new Error('filter');});assert.throws(()=>d.RunJobs(),/filter/);
});
test('automatic dispatch yields to host by job count without spinning a microtask queue',()=>{
    const r=rig({MaxJobsPerTurn:3}),out=[];for(let i=0;i<10;i++)r.d.Post(()=>out.push(i));assert.equal(r.micro.length,1);
    r.step();assert.equal(out.length,3);assert.equal(r.micro.length,0);assert.equal(r.macro.length,1);r.turn();r.turn();r.turn();assert.deepEqual(out,[0,1,2,3,4,5,6,7,8,9]);assert.equal(r.macro.length,0);
});
test('automatic dispatch also yields on elapsed budget',()=>{
    const r=rig({TimeBudgetMilliseconds:4});for(let i=0;i<5;i++)r.d.Post(()=>r.advance(2));r.step();assert.equal(r.d.PendingJobs,3);assert.equal(r.macro.length,1);
});
test('nested processing suspension defers dispatch and re-enables only after last disposal',()=>{
    const r=rig();const a=r.d.DisableProcessing(),b=new DispatcherProcessingDisabled(r.d);let calls=0;r.d.Post(()=>calls++);
    assert.equal(r.micro.length,0);assert.throws(()=>r.d.RunJobs(),/suspended/);a.Dispose();a.Dispose();assert.equal(r.micro.length,0);b.Dispose();r.step();assert.equal(calls,1);assert.equal(r.d._disabled,0);
});
test('indexed priority heap agrees with stable reference under 10000 adversarial mutations',()=>{
    const {d}=rig(),entries=[],actual=[];let seed=17;const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    for(let i=0;i<10000;i++){const priority=random()%15-5;entries.push({id:i,priority,op:d.Post(()=>actual.push(i),priority),aborted:false});}
    for(let i=0;i<20000;i++){const e=entries[random()%entries.length];if(random()%3===0){e.op.Abort();e.aborted=true;}else {e.priority=random()%15-5;e.op.Priority=e.priority;}}
    const expected=entries.filter(e=>!e.aborted).sort((a,b)=>b.priority-a.priority||a.id-b.id).map(e=>e.id);d.RunJobs();assert.deepEqual(actual,expected);assert.equal(d.PendingJobs,0);
});
test('shutdown aborts pending and future operations, announces ordered events and tolerates observer failures',async()=>{
    const {d}=rig(),events=[];d.ShutdownStarted.Add(()=>events.push('start'));d.ShutdownFinished.Add(()=>events.push('end'));
    const pending=d.InvokeAsync(()=>assert.fail(),P.Inactive),shutdown=d.BeginInvokeShutdown(P.Send);d.RunJobs();await shutdown;
    assert.deepEqual(events,['start','end']);assert.equal(d.PendingJobs,0);assert.ok(d.HasShutdownFinished);await assert.rejects(pending.GetTask(),{name:'AbortError'});
    await assert.rejects(d.InvokeAsync(()=>1).GetTask(),{name:'AbortError'});d.InvokeShutdown();assert.equal(events.length,2);
});
test('same-realm Send Invoke is synchronous and unsupported nested-loop priorities fail explicitly',()=>{
    const {d}=rig();assert.equal(d.Invoke(()=>42),42);assert.equal(d.SupportsRunLoops,false);assert.throws(()=>d.Invoke(()=>1,P.Normal),{name:'NotSupportedError'});
    assert.throws(()=>d.InvokeAsync(null),TypeError);assert.throws(()=>d.InvokeAsync(()=>1,P.Normal,{}),TypeError);
});
test('AwaitWithPriority queues continuation result at the requested priority',async()=>{
    const r=rig(),out=[];const p=r.d.AwaitWithPriority(Promise.resolve(7),P.Input);await Promise.resolve();r.d.Post(()=>out.push('normal'));r.step();assert.equal(await p,7);assert.deepEqual(out,['normal']);
});
test('timer maintains at most one queued tick while dispatcher delivery is blocked',t=>{
    t.mock.timers.enable({apis:['setTimeout']});const r=rig();let ticks=0;const timer=new DispatcherTimer(10,P.Normal,()=>ticks++,r.d);
    assert.equal(r.d.ShutdownStarted.Count,0);timer.Start();t.mock.timers.tick(1000);assert.equal(r.d.PendingJobs,1);assert.equal(ticks,0);
    r.d.RunJobs();assert.equal(ticks,1);t.mock.timers.tick(10);assert.equal(r.d.PendingJobs,1);timer.Stop();assert.equal(r.d.PendingJobs,0);assert.equal(r.d.ShutdownStarted.Count,0);timer.Dispose();
});
test('timer Stop/Start, interval change and priority promotion cannot revive stale ticks',t=>{
    t.mock.timers.enable({apis:['setTimeout']});const r=rig();let ticks=0;const timer=new DispatcherTimer(10,P.Inactive,()=>ticks++,r.d);timer.Start();t.mock.timers.tick(10);
    assert.equal(r.d.RunJobs(),0);timer.Stop();timer.Start();timer.Interval=20;t.mock.timers.tick(10);assert.equal(r.d.PendingJobs,0);t.mock.timers.tick(10);
    timer.Priority=P.Send;r.d.RunJobs();assert.equal(ticks,1);timer.Dispose();t.mock.timers.tick(100);assert.equal(r.d.PendingJobs,0);
});
test('timer stops at dispatcher shutdown and RunOnce disposes even on callback failure',t=>{
    t.mock.timers.enable({apis:['setTimeout']});const r=rig();r.d.UnhandledException.Add((_,e)=>e.Handled=true);
    const once=DispatcherTimer.RunOnce(()=>{throw new Error('once');},1,P.Normal,r.d);t.mock.timers.tick(1);r.d.RunJobs();assert.ok(once.IsDisposed);assert.equal(r.d.ShutdownStarted.Count,0);
    const timer=new DispatcherTimer(2,P.Normal,()=>assert.fail(),r.d);timer.Start();r.d.InvokeShutdown();assert.equal(timer.IsEnabled,false);assert.equal(r.d.ShutdownStarted.Count,0);timer.Dispose();
});
