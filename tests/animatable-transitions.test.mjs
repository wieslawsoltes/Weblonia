import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BehaviorSubject } from 'rxjs';
import * as A from '@wieslawsoltes/avalonia';
class Item extends A.Animatable {}
A.DefineProperties(Item,{Value:[0,{Convert:Number}],Other:[0,{Convert:Number}],Inherited:[1,{Inherits:true}]});
function fixture(t,transition=new A.DoubleTransition(Item.ValueProperty,100)){
 const item=new Item(),clock=new A.ManualClock();item.Clock=clock;item.Transitions=new A.Transitions([transition]);
 t.after(()=>{item.Dispose();transition.Dispose();});return {item,clock,transition};
}
test('Animatable transitions apply automatically and release clock/value slots on completion',t=>{
 const {item,clock,transition}=fixture(t),count=item._lifetime.Count;item.Value=10;assert.equal(item.Value,0);assert.ok(item.IsAnimating(Item.ValueProperty));
 clock.Advance(25);assert.equal(item.Value,2.5);clock.Advance(75);assert.equal(item.Value,10);assert.equal(item.IsAnimating(Item.ValueProperty),false);
 assert.equal(clock._listeners.size,0);assert.equal(item._lifetime.Count,count);assert.equal(item.TryGetTransitionInstance(transition),null);
});
test('masked base updates retarget from current presentation without temporary target notifications',t=>{
 const {item,clock}=fixture(t),values=[];item.PropertyChanged.Add((_,e)=>{if(e.Property===Item.ValueProperty)values.push(e.NewValue);});
 item.Value=10;clock.Advance(40);assert.equal(item.Value,4);item.Value=20;assert.equal(item.Value,4);assert.deepEqual(values,[4]);
 clock.Advance(50);assert.equal(item.Value,12);clock.Advance(50);assert.equal(item.Value,20);assert.deepEqual(values,[4,12,20]);
});
test('equal underlying writes and unrelated property changes do not restart an active transition',t=>{
 const {item,clock,transition}=fixture(t);item.Value=10;clock.Advance(25);const instance=item.TryGetTransitionInstance(transition);
 item.Value=10;item.Other=50;assert.equal(item.TryGetTransitionInstance(transition),instance);clock.Advance(75);assert.equal(item.Value,10);
});
test('base-priority removal transitions to default rather than the currently animated value',t=>{
 const {item,clock}=fixture(t);item.Value=10;clock.Advance(50);item.ClearValue(Item.ValueProperty);assert.equal(item.Value,5);
 clock.Advance(50);assert.equal(item.Value,2.5);clock.Advance(50);assert.equal(item.Value,0);
});
test('observable replacement and updates retain the binding while retargeting',t=>{
 const {item,clock}=fixture(t),source=new BehaviorSubject(10),binding=item.Bind(Item.ValueProperty,source);
 clock.Advance(50);source.next(20);clock.Advance(50);assert.equal(item.Value,12.5);clock.Advance(50);assert.equal(item.Value,20);
 source.next(30);clock.Advance(100);assert.equal(item.Value,30);binding.Dispose();clock.Advance(100);assert.equal(item.Value,0);assert.equal(source.observers.length,0);
});
test('disable cancels immediately, updates without animation and enable establishes a fresh baseline',t=>{
 const {item,clock}=fixture(t);item.Value=10;clock.Advance(20);item.DisableTransitions();assert.equal(item.Value,10);assert.equal(clock._listeners.size,0);
 item.Value=20;assert.equal(item.Value,20);item.EnableTransitions();item.Value=30;clock.Advance(50);assert.equal(item.Value,25);
});
test('visual attachment enables transitions and detachment cancels owned instances',t=>{
 const root=new HeadlessTopLevel(new A.Size(40,40)),view=new A.Border(),clock=new A.ManualClock(),transition=new A.DoubleTransition('Opacity',100);
 t.after(()=>{root.Dispose();view.Dispose();transition.Dispose();});view.Clock=clock;view.Transitions=new A.Transitions([transition]);view.Opacity=.2;
 assert.equal(clock._listeners.size,0);root.Content=view;root.Layout();view.Opacity=1;clock.Advance(50);assert.ok(Math.abs(view.Opacity-.6)<1e-9);
 root.Content=null;assert.equal(view.Opacity,1);assert.equal(clock._listeners.size,0);
});
test('collection clear cancels only its own animation and keeps an unrelated explicit slot',t=>{
 const {item,clock}=fixture(t),key=Symbol();item.Value=10;clock.Advance(10);const other=item._SetPriorityValue(Item.OtherProperty,50,A.BindingPriority.Animation,key);
 item.Transitions.Clear();assert.equal(item.Value,10);assert.equal(item.Other,50);assert.equal(clock._listeners.size,0);other.Dispose();
});
test('last matching transition wins and reordering changes future selection',t=>{
 const {item,clock,transition}=fixture(t),last=new A.DoubleTransition('Value',200);t.after(()=>last.Dispose());item.Transitions.Add(last);item.Value=20;clock.Advance(100);assert.equal(item.Value,10);
 item.Transitions.Move(1,0);assert.equal(item.Value,20);item.Value=40;clock.Advance(50);assert.equal(item.Value,30);assert.ok(item.TryGetTransitionInstance(transition));
});
test('replacement collection preserves a shared running definition and detaches old owner references',t=>{
 const {item,clock,transition}=fixture(t),old=item.Transitions;item.Value=10;clock.Advance(20);const instance=item.TryGetTransitionInstance(transition);
 item.Transitions=new A.Transitions([transition]);assert.equal(item.TryGetTransitionInstance(transition),instance);assert.equal(old._owners.size,0);assert.equal(old._definitions.size,0);
 clock.Advance(80);assert.equal(item.Value,10);
});
test('collection mutation validates duplicate, direct and unknown properties before publication',t=>{
 const {item,transition}=fixture(t),list=item.Transitions;assert.throws(()=>list.Add(transition),/distinct/);assert.equal(list.Count,1);
 const unknown=new A.DoubleTransition('Missing'),direct=new A.DoubleTransition(A.AvaloniaProperty.RegisterDirect(Item,'Direct',()=>0,()=>{}));
 try{assert.throws(()=>list.Add(unknown),/registered/);assert.throws(()=>list.Add(direct),/styled/);assert.equal(list.Count,1);
 assert.throws(()=>list.Item.push(unknown),TypeError);assert.throws(()=>{transition.Property='Missing';},/registered/);assert.equal(transition.Property,Item.ValueProperty);
 }finally{unknown.Dispose();direct.Dispose();}
});
test('changing a definition target cancels its old property and tracks the new target',t=>{
 const {item,clock,transition}=fixture(t);item.Value=10;clock.Advance(25);transition.Property='Other';assert.equal(item.Value,10);assert.equal(clock._listeners.size,0);
 item.Other=20;clock.Advance(50);assert.equal(item.Other,10);
});
test('shared transition definitions run independently and release per-owner subscriptions',t=>{
 const {item,clock,transition}=fixture(t),other=new Item();other.Clock=clock;other.Transitions=item.Transitions;t.after(()=>other.Dispose());
 item.Value=10;other.Value=20;clock.Advance(50);assert.equal(item.Value,5);assert.equal(other.Value,10);item.DisableTransitions();clock.Advance(50);assert.equal(other.Value,20);other.Dispose();
});
test('inherited clock drives descendants without a second scheduling loop',t=>{
 const parent=new Item(),child=new Item(),clock=new A.ManualClock(),transition=new A.DoubleTransition('Value',100);t.after(()=>{child.Dispose();parent.Dispose();transition.Dispose();});
 parent.Clock=clock;child.SetInheritanceParent(parent);child.Transitions=new A.Transitions([transition]);child.Value=10;clock.Advance(50);assert.equal(child.Value,5);assert.equal(child.Clock,clock);
});
test('inherited property removal reveals the inherited base, not an animation snapshot',t=>{
 const {item,clock}=fixture(t,new A.DoubleTransition('Inherited',100)),parent=new Item();parent.Inherited=4;item.SetInheritanceParent(parent);t.after(()=>parent.Dispose());
 item.Inherited=10;clock.Advance(50);item.ClearValue(Item.InheritedProperty);clock.Advance(100);assert.equal(item.Inherited,4);
});
test('delayed and zero-duration transitions keep one finite subscription and release it',t=>{
 const {item,clock,transition}=fixture(t);transition.Duration=0;transition.Delay=50;item.Value=8;clock.Advance(49);assert.equal(item.Value,0);clock.Advance(1);assert.equal(item.Value,8);assert.equal(clock._listeners.size,0);
 transition.Delay=0;item.Value=9;assert.equal(item.Value,9);assert.equal(clock._listeners.size,0);
});
test('malformed easing releases its value slot and reports the failure exactly once',async t=>{
 const {item,clock,transition}=fixture(t),errors=[];item.TransitionError.Add((_,e)=>errors.push(e.Error));transition.Easing={Ease:p=>p===0?0:NaN};item.Value=10;
 const instance=item.TryGetTransitionInstance(transition);clock.Advance(50);await assert.rejects(instance.Completion,/nonfinite/);assert.equal(item.Value,10);assert.equal(clock._listeners.size,0);assert.equal(errors.length,1);
});
test('legacy awaitable Apply remains usable and obeys AbortSignal cancellation',async t=>{
 const {item,clock,transition}=fixture(t),abort=new AbortController();item.DisableTransitions();item.Value=10;
 const done=transition.Apply(item,0,10,abort.signal);assert.ok(done instanceof Promise);clock.Advance(50);assert.equal(item.Value,5);abort.abort();await done;assert.equal(item.Value,10);assert.equal(clock._listeners.size,0);
});
test('synchronously ticking clock completion does not leak its late subscription',t=>{
 const {item,transition}=fixture(t),clock={Now:()=>0,Subscribe(fn){fn(100);return {Dispose(){clock.Disposals++;}};},Disposals:0};item.DisableTransitions();item.Value=10;
 const instance=transition.Apply(item,clock,0,10);assert.equal(instance.IsCompleted,true);assert.equal(clock.Disposals,1);assert.equal(item.IsAnimating(Item.ValueProperty),false);
});
test('reentrant disabling from an easing callback cannot resurrect a transition',t=>{
 const {item,clock,transition}=fixture(t);transition.Easing={Ease:p=>{item.DisableTransitions();return p;}};item.Value=10;
 assert.equal(item.Value,10);assert.equal(clock._listeners.size,0);assert.equal(item._transitionStates,null);
});
test('1000 retarget/completion cycles have bounded owner lifetime and value-store size',t=>{
 const {item,clock}=fixture(t),count=item._lifetime.Count;
 for(let i=1;i<=1000;i++){item.Value=i;clock.Advance(100);assert.equal(item.Value,i);}
 assert.equal(item._lifetime.Count,count);assert.equal(clock._listeners.size,0);assert.equal(item._values.get(Item.ValueProperty).size,1);
});

test('transition metadata is direct, no-argument duration is zero and easing is linear',()=>{
 const transition=new A.DoubleTransition();try{assert.ok(transition instanceof A.TransitionBase);assert.ok(transition instanceof A.ITransition);
 assert.equal(transition.Duration,0);assert.equal(transition.Delay,0);assert.ok(transition.Easing instanceof A.LinearEasing);
 for(const p of [A.TransitionBase.PropertyProperty,A.TransitionBase.DurationProperty,A.TransitionBase.DelayProperty,A.TransitionBase.EasingProperty])assert.ok(p.IsDirect);
 }finally{transition.Dispose();}
});
test('SetCurrentValue changes the underlying value during a transition, preserving its priority',t=>{
 const {item,clock}=fixture(t);const style=item.SetValue(Item.ValueProperty,10,A.BindingPriority.Style);clock.Advance(50);
 item.SetCurrentValue(Item.ValueProperty,20);assert.equal(item.GetBaseValue(Item.ValueProperty),20);assert.equal(item._effectiveEntry(Item.ValueProperty,true).Priority,A.BindingPriority.Style);
 clock.Advance(100);assert.equal(item.Value,20);style.Dispose();clock.Advance(100);assert.equal(item.Value,0);
});
test('an inherited base change reaches a child even while that child is animating',t=>{
 const {item,clock}=fixture(t,new A.DoubleTransition('Inherited',100)),parent=new Item();t.after(()=>parent.Dispose());item.SetInheritanceParent(parent);
 parent.Inherited=11;clock.Advance(50);assert.equal(item.Inherited,6);parent.Inherited=21;assert.equal(item.Inherited,6);
 clock.Advance(50);assert.equal(item.Inherited,13.5);clock.Advance(50);assert.equal(item.Inherited,21);
});
test('brush and transform also share the real Animatable transition foundation',t=>{
 const clock=new A.ManualClock(),brush=new A.SolidColorBrush('red'),transform=new A.TranslateTransform(),tb=new A.DoubleTransition('Opacity',100),tt=new A.DoubleTransition('X',100);
 t.after(()=>{brush.Dispose();transform.Dispose();tb.Dispose();tt.Dispose();});brush.Clock=transform.Clock=clock;
 brush.Transitions=new A.Transitions([tb]);transform.Transitions=new A.Transitions([tt]);brush.Opacity=0;transform.X=20;clock.Advance(50);
 assert.equal(brush.Opacity,.5);assert.equal(transform.Value.M31,10);
});
test('completion restores observation of a mutable effect with equal immutable endpoint values',t=>{
 const view=new A.Border(),clock=new A.ManualClock(),from=new A.BlurEffect(0),to=new A.BlurEffect(10),transition=new A.EffectTransition('Effect',100);
 t.after(()=>{view.Dispose();from.Dispose();to.Dispose();transition.Dispose();});view.Clock=clock;view.Effect=from;view.Transitions=new A.Transitions([transition]);view.EnableTransitions();
 view.Effect=to;clock.Advance(100);assert.equal(view.Effect,to);let invalidated=0;view.VisualInvalidated.Add(()=>invalidated++);to.Radius=11;
 assert.ok(invalidated>0,'Restored mutable effect must be subscribed, even though the final snapshot compared equal');assert.equal(from.PropertyChanged.Count,0);
});
test('animation-driven mutable effect radius notifies its owner without replacing the Effect',t=>{
 const view=new A.Border(),effect=new A.BlurEffect(0),clock=new A.ManualClock(),transition=new A.DoubleTransition('Radius',100);
 t.after(()=>{view.Dispose();effect.Dispose();transition.Dispose();});view.Effect=effect;effect.Clock=clock;effect.Transitions=new A.Transitions([transition]);
 let invalidated=0;view.VisualInvalidated.Add(()=>invalidated++);effect.Radius=10;clock.Advance(50);assert.equal(effect.Radius,5);assert.ok(invalidated>0);
 clock.Advance(50);assert.equal(clock._listeners.size,0);
});

test('out-of-order transition clock provider disposal never resurrects an obsolete service',()=>{
 const clocks=[new A.ManualClock(),new A.ManualClock(),new A.ManualClock()];
 const providers=clocks.map(clock=>A.RegisterTransitionClockProvider(()=>clock));
 const owner=new A.Animatable(),property=A.AvaloniaProperty.RegisterAttached(class ClockProviderProbe{},'ClockProviderProbe',0);
 const transition=new A.DoubleTransition(property,100);
 try{providers[1].Dispose();providers[2].Dispose();owner.Transitions=new A.Transitions([transition]);owner.SetValue(property,10);
  assert.equal(clocks[0]._listeners.size,1);assert.equal(clocks[1]._listeners.size,0);assert.equal(clocks[2]._listeners.size,0);
  clocks[0].Advance(50);assert.equal(owner.GetValue(property),5);
 }finally{owner.Dispose();transition.Dispose();for(const p of providers)p.Dispose();}
});
