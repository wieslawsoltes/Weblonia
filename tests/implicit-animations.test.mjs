import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';
function fixture(){const clock=new A.ManualClock();clock.TimeOrigin=0;const compositor=new A.Compositor({Clock:clock,AutoCommit:false}),visual=compositor.CreateSolidColorVisual();compositor.Commit();return {clock,c:compositor,v:visual,dispose:()=>compositor.Dispose()};}
function implicit(c,v,target='Opacity',duration=100,type='Scalar'){
    const a=c[`Create${type}KeyFrameAnimation`]();a.Target=target;a.Duration=duration;a.InsertExpressionKeyFrame(1,'this.FinalValue');
    const collection=c.CreateImplicitAnimationCollection();collection.Add(target,a);v.ImplicitAnimations=collection;return {a,collection};
}

test('implicit collection has dictionary and UWP contracts, immutable snapshot and duplicate rejection',()=>{
    const {c,dispose}=fixture();try{
        const map=c.CreateImplicitAnimationCollection(),a=c.CreateScalarKeyFrameAnimation(),b=c.CreateAnimationGroup();
        assert.ok(map instanceof A.CompositionObject);map.Add('Offset',a);const view=map.GetView();
        assert.equal(map.Count,1);assert.equal(map.Size,1);assert.deepEqual(map.Keys,['Offset']);assert.deepEqual(map.Values,[a]);
        assert.deepEqual(map.TryGetValue('Offset'),{Found:true,Value:a});assert.deepEqual(map.TryGetValue('Opacity'),{Found:false,Value:null});
        assert.throws(()=>map.Insert('Offset',b),/Duplicate/);assert.throws(()=>map.Get('Missing'),/not found/);
        assert.equal(map.set('Offset',b),map);assert.equal(map.Get('Offset'),b);assert.equal(view.Get('Offset'),a);
        assert.ok(Object.isFrozen(view));assert.equal(view.set,undefined);view.Keys.pop();assert.equal(view.Count,1);
        assert.deepEqual([...map],[['Offset',b]]);assert.ok(map.HasKey('Offset'));assert.equal(map.Lookup('Missing'),null);
        assert.equal(map.Remove('Offset'),true);assert.equal(map.Remove('Offset'),false);map.Add('Opacity',a);map.Clear();assert.equal(map.Count,0);
        map.Dispose();assert.equal(a.IsDisposed,false);assert.equal(b.IsDisposed,false);assert.throws(()=>map.Add('X',a),/disposed/);a.Dispose();
    }finally{dispose();}
});
test('implicit ownership accepts shared collections but rejects cross-compositor and disposed resources',()=>{
    const {c,v,dispose}=fixture(),other=new A.Compositor({AutoCommit:false});try{
        const w=c.CreateSolidColorVisual(),map=c.CreateImplicitAnimationCollection(),a=c.CreateScalarKeyFrameAnimation();
        v.ImplicitAnimations=map;w.ImplicitAnimations=map;assert.equal(map._owners.size,2);
        assert.throws(()=>{v.ImplicitAnimations=other.CreateImplicitAnimationCollection();},/compositor/);
        assert.throws(()=>map.Add('Opacity',other.CreateScalarKeyFrameAnimation()),/compositor/);
        for(const key of ['__proto__','constructor','prototype','_private','Offset.X'])assert.throws(()=>map.Add(key,a),RangeError);
        v.Dispose();assert.equal(map._owners.size,1);map.Dispose();assert.equal(w.ImplicitAnimations,null);assert.equal(a.IsDisposed,false);
        assert.throws(()=>{w.ImplicitAnimations=map;},/live/);a.Dispose();
    }finally{dispose();other.Dispose();}
});
test('implicit FinalValue changes base immediately while holding presentation until commit/tick',()=>{
    const {c,v,clock,dispose}=fixture();try{
        const {a}=implicit(c,v);v.Opacity=.2;const state=v._animations.get('Opacity');
        assert.equal(v.Opacity,.2);assert.equal(v._Read('Opacity'),1);assert.equal(state.Start,1);assert.equal(state.FinalValue,.2);
        c.Commit();assert.equal(v._Read('Opacity'),1);clock.Advance(50);assert.ok(Math.abs(v._Read('Opacity')-.6)<1e-12);
        clock.Advance(50);assert.ok(Math.abs(v._Read('Opacity')-.2)<1e-12);assert.equal(clock._listeners.size,0);
        assert.equal(state.Animation.IsDisposed,true);assert.equal(a.IsDisposed,false);a.Dispose();
    }finally{dispose();}
});
test('equal values and defensive struct snapshots do not retrigger or change the desired state',()=>{
    const {c,v,dispose}=fixture();try{
        const {a}=implicit(c,v,'Offset',100,'Vector3');const value={X:50,Y:20,Z:0};v.Offset=value;
        const state=v._animations.get('Offset'),version=v._transportVersion;value.X=999;v.Offset.X=777;
        assert.equal(v.Offset.X,50);v.Offset={X:50,Y:20,Z:0};assert.equal(v._animations.get('Offset'),state);assert.equal(v._transportVersion,version);
        assert.throws(()=>{v.Offset={X:NaN,Y:20,Z:0};},/finite/);assert.equal(v.Offset.X,50);a.Dispose();
    }finally{dispose();}
});
test('implicit retarget samples the interrupted presentation at setter time without waiting for a frame',()=>{
    const {c,v,clock,dispose}=fixture();try{
        const {a}=implicit(c,v);v.Opacity=0;c.Commit();const old=v._animations.get('Opacity');clock.Time=50;
        v.Opacity=.8;const next=v._animations.get('Opacity');assert.equal(next.Start,.5);assert.equal(old.Animation.IsDisposed,true);
        c.Commit();clock.Advance(50);assert.equal(v._Read('Opacity'),.65);clock.Advance(50);assert.equal(v._Read('Opacity'),.8);a.Dispose();
    }finally{dispose();}
});
test('same-clock triggers have distinct identities and captured FinalValue snapshots',()=>{
    const {c,v,dispose}=fixture();try{const {a}=implicit(c,v);v.Opacity=.2;const x=v._animations.get('Opacity');v.Opacity=.4;const y=v._animations.get('Opacity');assert.equal(x.StartedAt,y.StartedAt);assert.notEqual(x.Id,y.Id);assert.equal(x.FinalValue,.2);assert.equal(y.FinalValue,.4);a.Dispose();}finally{dispose();}
});
test('implicit grouped triggers share a clock and pass FinalValue only to the exactly matching target',()=>{
    const {c,v,clock,dispose}=fixture();try{
        const {a,collection}=implicit(c,v),g=c.CreateAnimationGroup(),b=c.CreateScalarKeyFrameAnimation();b.Target='Offset.X';b.Duration=100;b.InsertExpressionKeyFrame(1,'this.FinalValue + 20');g.Add(a);g.Add(b);collection.Set('Opacity',g);
        v.Opacity=.4;const [x,y]=v._animations.values();assert.equal(x.StartedAt,y.StartedAt);assert.equal(x.FinalValue,.4);assert.equal(y.FinalValue,0);
        c.Commit();clock.Advance(100);assert.equal(v._Read('Offset').X,20);assert.equal(v._Read('Opacity'),.4);a.Dispose();b.Dispose();
    }finally{dispose();}
});
test('invalid grouped triggers leave both desired value and running instances untouched',()=>{
    const {c,v,dispose}=fixture();try{
        const {a,collection}=implicit(c,v);v.Opacity=.5;const old=v._animations.get('Opacity'),g=c.CreateAnimationGroup(),bad=c.CreateScalarKeyFrameAnimation();bad.Target='Missing';bad.InsertKeyFrame(1,1);g.Add(a);g.Add(bad);collection.Set('Opacity',g);
        assert.throws(()=>{v.Opacity=.2;},/Invalid animation/);assert.equal(v.Opacity,.5);assert.equal(v._animations.get('Opacity'),old);assert.equal(old.Animation.IsDisposed,false);
        bad.Target='Dispose';assert.throws(()=>{v.Opacity=.1;},/Invalid animation/);bad.Target='';assert.throws(()=>{v.Opacity=.1;},/Target/);a.Dispose();bad.Dispose();
    }finally{dispose();}
});
test('failed clone releases earlier prepared instances without disposing caller animations',()=>{
    const {c,v,dispose}=fixture();try{
        const {a,collection}=implicit(c,v);let prepared;const original=a.Clone.bind(a);a.Clone=()=>prepared=original();
        class Broken extends A.ScalarKeyFrameAnimation {Clone(){throw new Error('clone failed');}}
        const bad=new Broken(c);bad.Target='Offset.X';bad.InsertKeyFrame(1,20);const g=c.CreateAnimationGroup();g.Add(a);g.Add(bad);collection.Set('Opacity',g);
        assert.throws(()=>{v.Opacity=.5;},/clone failed/);assert.equal(v.Opacity,1);assert.equal(prepared.IsDisposed,true);assert.equal(a.IsDisposed,false);a.Dispose();bad.Dispose();
    }finally{dispose();}
});
test('replacing/removing an implicit collection changes future triggers, not borrowed running snapshots',()=>{
    const {c,v,clock,dispose}=fixture();try{
        const {a,collection}=implicit(c,v);v.Opacity=.2;c.Commit();collection.Dispose();assert.equal(v.ImplicitAnimations,null);
        clock.Advance(100);assert.equal(v._Read('Opacity'),.2);v.Opacity=.9;c.Commit();assert.equal(v._Read('Opacity'),.9);assert.equal(v._animations.size,0);a.Dispose();
    }finally{dispose();}
});
test('StopAnimation releases its clone and reveals the new implicit base value',()=>{
    const {c,v,clock,dispose}=fixture();try{const {a}=implicit(c,v);v.Opacity=.2;c.Commit();clock.Advance(20);const run=v._animations.get('Opacity');v.StopAnimation('Opacity');assert.equal(v._Read('Opacity'),.2);assert.equal(run.Animation.IsDisposed,true);assert.equal(clock._listeners.size,0);a.Dispose();}finally{dispose();}
});
test('expression StartingValue, CurrentValue and FinalValue are independent inputs',()=>{
    const {c,v,dispose}=fixture();try{const a=c.CreateExpressionAnimation('this.StartingValue + this.CurrentValue + this.FinalValue');assert.equal(a.Sample(0,1,v,2,3).Value,6);a.Dispose();}finally{dispose();}
});
for(const behavior of ['SetInitialValueBeforeDelay','SetInitialValueAfterDelay'])test(`implicit ${behavior} preserves delay and FinalValue`,()=>{
    const {c,v,clock,dispose}=fixture();try{const {a}=implicit(c,v);a.DelayTime=20;a.DelayBehavior=behavior;a.InsertKeyFrame(0,.7);v.Opacity=.2;c.Commit();clock.Advance(10);assert.equal(v._Read('Opacity'),behavior==='SetInitialValueBeforeDelay'?.7:1);clock.Advance(110);assert.equal(v._Read('Opacity'),.2);a.Dispose();}finally{dispose();}
});
for(const [name,value] of [['Duration',Infinity],['DelayTime',NaN],['DelayTime',Infinity],['IterationCount',1.5],['IterationBehavior','invalid'],['Direction','invalid'],['DelayBehavior','invalid'],['StopBehavior','invalid']])test(`implicit rejects invalid ${name}=${value} atomically`,()=>{
    const {c,v,dispose}=fixture();try{const {a}=implicit(c,v);a[name]=value;assert.throws(()=>{v.Opacity=.5;},/timing/);assert.equal(v.Opacity,1);assert.equal(v._animations.size,0);a.Dispose();}finally{dispose();}
});
test('implicit keyframe type must match its actual property/component',()=>{
    const {c,v,dispose}=fixture();try{const {a}=implicit(c,v,'Opacity',100,'Vector3');assert.throws(()=>{v.Opacity=.5;},/cannot target/);assert.equal(v.Opacity,1);a.Dispose();}finally{dispose();}
});
test('whole-vector replacement removes conflicting component animations but not sibling properties',()=>{
    const {c,v,dispose}=fixture();try{const x=c.CreateScalarKeyFrameAnimation();x.InsertKeyFrame(1,20);v.StartAnimation('Offset.X',x);v.StartAnimation('Opacity',x);const old=v._animations.get('Offset.X');const a=c.CreateVector3KeyFrameAnimation();a.InsertKeyFrame(1,{X:20,Y:30,Z:0});v.StartAnimation('Offset',a);assert.equal(old.Animation.IsDisposed,true);assert.equal(v._animations.has('Offset.X'),false);assert.equal(v._animations.has('Opacity'),true);x.Dispose();a.Dispose();}finally{dispose();}
});
async function makeView(aot){const compiled=new A.AvaloniaXamlCompiler().Compile('<Canvas xmlns="https://github.com/avaloniaui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><Border x:Name="tile" Background="Red" Width="20" Height="20" Canvas.Left="10" Canvas.Top="15"/></Canvas>');return aot?(await import('data:text/javascript;base64,'+Buffer.from(compiled.JavaScript).toString('base64'))).Build(new A.AvaloniaXamlServices()):compiled.Build();}
for(const aot of [false,true])test(`implicit ${aot?'AOT':'runtime'} XAML layout Offset is absolute, compensated in rendering and hit testing`,async()=>{
    const root=new HeadlessTopLevel(new A.Size(200,80)),{c,clock,dispose}=fixture();root.Compositor=c;const view=await makeView(aot);root.Content=view;root.LayoutManager.ExecuteLayoutPass();const tile=view.FindControl('tile'),visual=A.ElementComposition.GetElementVisual(tile);
    try{assert.deepEqual(visual.Offset,{X:10,Y:15,Z:0});c.Commit();assert.equal(tile.GetLocalTransform().M31,10);
        const {a}=implicit(c,visual,'Offset',100,'Vector3');A.Canvas.SetLeft(tile,110);root.LayoutManager.ExecuteLayoutPass();c.Commit();assert.equal(visual.Offset.X,110);assert.equal(tile.GetLocalTransform().M31,10);
        clock.Advance(50);assert.equal(tile.GetLocalTransform().M31,60);assert.equal(root.HitTest(new A.Point(65,20)),tile);
        clock.Advance(50);assert.equal(tile.GetLocalTransform().M31,110);assert.equal(tile.GetLocalTransform().M32,15);
        const count=tile.SizeChanged.Count;visual.Dispose();assert.equal(tile._compositionSelf,null);assert.equal(c._attachments.has(tile),false);assert.equal(tile.SizeChanged.Count,count-1);assert.equal(tile.GetLocalTransform().M31,110);a.Dispose();
    }finally{root.Dispose();dispose();}
});
test('stopping one locally completed component preserves a different completed component',()=>{
    const {c,v,clock,dispose}=fixture();try{const x=c.CreateScalarKeyFrameAnimation(),y=c.CreateScalarKeyFrameAnimation();x.Duration=y.Duration=100;x.InsertKeyFrame(1,40);y.InsertKeyFrame(1,50);v.StartAnimation('Offset.X',x);v.StartAnimation('Offset.Y',y);clock.Advance(100);v.StopAnimation('Offset.X');assert.equal(v._Read('Offset').X,0);assert.equal(v._Read('Offset').Y,50);assert.equal(v._instances.size,1);x.Dispose();y.Dispose();}finally{dispose();}
});
test('animation easing and keyframe values are copied for each implicit instance',()=>{
    const {c,v,clock,dispose}=fixture();try{const {a}=implicit(c,v);const easing=new A.SplineEasing(.1,.2,.3,.4);a.KeyFrames[0].Easing=easing;v.Opacity=.2;const run=v._animations.get('Opacity');assert.notEqual(run.Animation.KeyFrames[0].Easing,easing);a.KeyFrames[0].Expression=new A.CompositionExpression('0.9');c.Commit();clock.Advance(100);assert.equal(v._Read('Opacity'),.2);a.Dispose();}finally{dispose();}
});
test('SplineEasing has exact endpoints so an implicit final value does not retain bisection error',()=>{
    for(const easing of [new A.SplineEasing(.1,.2,.3,.4),new A.SplineEasing(0,0,1,1)]){assert.equal(easing.Ease(0),0);assert.equal(easing.Ease(1),1);}
});
