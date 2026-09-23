import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
test('effect family inherits Animatable and preserves pinned default values',()=>{
 const blur=new A.BlurEffect(),cartesian=new A.DropShadowEffect(),direction=new A.DropShadowDirectionEffect();
 try{assert.ok(blur instanceof A.Animatable);assert.ok(blur instanceof A.IBlurEffect);assert.ok(blur instanceof A.IMutableEffect);
 assert.equal(blur.Radius,5);assert.equal(cartesian.BlurRadius,5);assert.equal(cartesian.OffsetX,3.5355);assert.equal(cartesian.OffsetY,3.5355);
 assert.equal(direction.Direction,315);assert.equal(direction.ShadowDepth,5);close(direction.OffsetX,5/Math.sqrt(2));close(direction.OffsetY,-5/Math.sqrt(2));
 }finally{blur.Dispose();cartesian.Dispose();direction.Dispose();}
});
test('immutable effect snapshots copy colors, preserve direction and cache unchanged values',()=>{
 const input=A.Color.Parse('#80112233'),effect=new A.DropShadowDirectionEffect({Direction:90,ShadowDepth:10,Color:input});
 try{const first=effect.ToImmutable();assert.equal(first,effect.ToImmutable());assert.ok(first instanceof A.IImmutableEffect);
 assert.ok(first instanceof A.IDropShadowEffect);assert.equal(first.Direction,90);assert.equal(first.ShadowDepth,10);
 close(first.OffsetY,10);close(first.OffsetX,0);input.R=200;assert.equal(first.Color.R,17);assert.equal(effect.Color.R,17);
 assert.throws(()=>{first.Color.R=100;},TypeError);assert.throws(()=>{first.Direction=0;},TypeError);
 effect.Direction=180;const next=effect.ToImmutable();assert.notEqual(next,first);assert.equal(first.Direction,90);assert.equal(next.Direction,180);
 assert.equal(A.EffectExtensions.ToImmutable(next),next);
 }finally{effect.Dispose();}
});
test('SetValue and bound effect colors cannot alias caller-owned structs',()=>{
 const effect=new A.DropShadowEffect(),value=A.Color.Parse('red');
 try{effect.SetValue(A.DropShadowEffect.ColorProperty,value);value.G=42;assert.equal(effect.Color.G,0);
 const next=A.Color.Parse('blue'),slot=effect._SetPriorityValue(A.DropShadowEffect.ColorProperty,next,A.BindingPriority.Animation,Symbol());next.R=90;
 assert.equal(effect.Color.R,0);slot.Dispose();assert.equal(effect.Color.R,255);
 }finally{effect.Dispose();}
});
test('mutable effect invalidation raises once, unchanged assignments are quiet and disposal releases handlers',()=>{
 const effect=new A.BlurEffect(),events=[];effect.Invalidated.Add((_,e)=>events.push(e.Property.Name));
 effect.Radius=5;assert.equal(events.length,0);effect.Radius=7;assert.deepEqual(events,['Radius']);
 const current=effect.ToImmutable();assert.equal(current.Radius,7);effect.Dispose();assert.equal(effect.Invalidated.Count,0);assert.throws(()=>effect.ToImmutable(),/disposed/);
});
test('effect equality supports mutable and immutable offset/directional values',()=>{
 const effect=new A.DropShadowDirectionEffect({Direction:0,ShadowDepth:4}),cart=new A.ImmutableDropShadowEffect(4,0,5,A.Colors.Black,1);
 try{assert.ok(cart.Equals(effect));assert.ok(effect.ToImmutable().Equals(cart));assert.ok(new A.ImmutableBlurEffect(3).Equals(new A.ImmutableBlurEffect(3)));
 assert.equal(cart.Equals(null),false);assert.equal(cart.Equals(new A.ImmutableBlurEffect(5)),false);assert.ok(A.EffectExtensions.EffectEquals(null,null));}
 finally{effect.Dispose();}
});
for(const [text,kind,values] of [
 ['blur(4.5)','blur',[4.5]],[' blur ( -2e0 ) ','blur',[-2]],
 ['drop-shadow(2 -3)','shadow',[2,-3,0]],['drop-shadow(2 -3 4)','shadow',[2,-3,4]],
 ['drop-shadow(2 -3 4 #80112233)','shadow',[2,-3,4]],['drop-shadow(.5 2e1 0 rgba(20, 40, 80, 0.5))','shadow',[.5,20,0]],
])test(`effect grammar parses ${JSON.stringify(text)}`,()=>{
 const effect=A.Effect.Parse(text);assert.ok(effect instanceof A.IImmutableEffect);assert.equal(A.EffectExtensions.GetKind(effect),kind);
 assert.deepEqual(kind==='blur'?[effect.Radius]:[effect.OffsetX,effect.OffsetY,effect.BlurRadius],values);
 if(text.includes('#80'))assert.equal(effect.Color.A,128);if(text.includes('rgba'))assert.equal(effect.Color.B,80);
});
for(const text of ['none','blur(2px)','blur(3) trailing','blur(Infinity)','blur(1e300)','blur(1 2)','drop-shadow(2)','drop-shadow(2 3 blue)',
 'drop-shadow(2 3 -1)','drop-shadow(2 3 1 rgb(NaN,0,0))','drop-shadow(2 3 1 rgb(1,2,3,4,5))','blur(1) blur(2)'])
 test(`malformed effect is rejected: ${text}`,()=>assert.throws(()=>A.Effect.Parse(text)));
test('invalid effect scalar writes leave the prior value and snapshot unchanged',()=>{
 const effect=new A.BlurEffect(2),old=effect.ToImmutable();
 try{for(const value of [NaN,Infinity,-Infinity,1e100]){assert.throws(()=>{effect.Radius=value;},RangeError);assert.equal(effect.Radius,2);assert.equal(effect.ToImmutable(),old);}}
 finally{effect.Dispose();}
});
test('effect output padding follows separate blur and signed shadow extents',()=>{
 assert.deepEqual(A.EffectExtensions.GetEffectOutputPadding(null),new A.Thickness(0));
 assert.deepEqual(A.EffectExtensions.GetEffectOutputPadding(new A.ImmutableBlurEffect(2.1)),new A.Thickness(4));
 assert.deepEqual(A.EffectExtensions.GetEffectOutputPadding(new A.ImmutableBlurEffect(-1)),new A.Thickness(0));
 assert.deepEqual(A.EffectExtensions.GetEffectOutputPadding(new A.ImmutableDropShadowEffect(10,-5,2.1,A.Colors.Black,1)),new A.Thickness(0,9,14,0));
});
test('effect transition blends null blur, directional depth and gamma-correct shadow color',()=>{
 const transition=new A.EffectTransition();
 try{const blur=transition.Interpolate(null,new A.ImmutableBlurEffect(12),.25);assert.equal(blur.Radius,3);
 const a=new A.ImmutableDropShadowDirectionEffect(0,2,0,A.Colors.Black,1),b=new A.ImmutableDropShadowDirectionEffect(180,6,10,A.Colors.White,.5);
 const half=transition.Interpolate(a,b,.5);assert.equal(half.Direction,90);assert.equal(half.ShadowDepth,4);assert.equal(half.BlurRadius,5);assert.equal(half.Opacity,.75);
 assert.equal(half.Color.R,188);assert.equal(half.Color.A,255);
 const disappear=transition.Interpolate(b,null,.5);assert.equal(disappear.ShadowDepth,3);assert.equal(disappear.Opacity,.25);
 const cart=new A.ImmutableDropShadowEffect(12,4,0,A.Colors.Black,1),mixed=transition.Interpolate(a,cart,.5);assert.ok(mixed instanceof A.ImmutableDropShadowEffect);assert.equal(mixed.OffsetX,7);
 }finally{transition.Dispose();}
});
test('incompatible effects and null keyframes use a midpoint switch, not an end jump',()=>{
 const a=new A.ImmutableBlurEffect(4),b=new A.ImmutableDropShadowEffect(1,2,0,A.Colors.Black,1);
 assert.equal(A.EffectExtensions.Interpolate(a,b,.49),a);assert.equal(A.EffectExtensions.Interpolate(a,b,.5),b);
 assert.equal(A.Interpolate(null,a,.49),null);assert.equal(A.Interpolate(null,a,.5),a);
});
for(const aot of [false,true])test(`${aot?'AOT':'runtime'} XAML effect strings, polar resources and transition collections`,async()=>{
 const c=new A.AvaloniaXamlCompiler().Compile(`<Border xmlns="https://github.com/avaloniaui" Effect="blur(2)"><Border.Transitions><EffectTransition Property="Effect" Duration="0:0:0.1"/></Border.Transitions></Border>`);
 const view=aot?(await import('data:text/javascript;base64,'+Buffer.from(c.JavaScript).toString('base64'))).Build(new A.AvaloniaXamlServices()):c.Build();
 const transition=view.Transitions.Get(0),clock=new A.ManualClock();
 try{assert.equal(view.Effect.Radius,2);assert.ok(transition instanceof A.EffectTransition);assert.equal(transition.Duration,100);
 view.Clock=clock;view.EnableTransitions();view.Effect=new A.DropShadowDirectionEffect({Direction:0,ShadowDepth:10});clock.Advance(50);assert.equal(view.Effect.OffsetX,10);
 }finally{view.DisableTransitions();const effect=view.GetBaseValue(A.Visual.EffectProperty);effect?.Dispose?.();view.Dispose();transition.Dispose();}
});

test('effect interface tokens are nonconstructible contracts',()=>{
 for(const token of [A.IEffect,A.IMutableEffect,A.IImmutableEffect,A.IBlurEffect,A.IDropShadowEffect])assert.throws(()=>new token(),/contract/);
});

test('effect colors reject nonfinite or malformed RGB components before generic color clamping',()=>{
 for(const color of ['rgb(1e999,0,0)','rgba(0,0,0,1e999)','rgb(1x,0,0)','rgba(0,0,0,1,2)']){
  assert.throws(()=>A.Effect.Parse('drop-shadow(0 0 0 '+color+')'),/color/);
  assert.throws(()=>new A.ImmutableDropShadowEffect(0,0,0,color,1),/color/);
 }
});
