import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';
import { Initialize } from '@wieslawsoltes/skiasharpweb';
import { SkiaEffectCache, SkBlurRadiusToSigma } from '../packages/skia/src/effect-cache.js';
const S=await Initialize({fonts:false}),platform=new A.SkiaPlatform(S);test.after(()=>platform.Dispose());
function image(action,scale=1){const w=Math.ceil(110*scale),surface=S.SKSurface.Create(new S.SKImageInfo(w,w)),context=new A.SkiaDrawingContext(platform,surface.Canvas,scale);
 try{surface.Canvas.Clear(S.SKColors.White);surface.Canvas.Translate(.31,.63);surface.Canvas.Scale(scale,scale);action(context);const snapshot=surface.Snapshot();
 try{return snapshot.ReadPixels(new S.SKImageInfo(w,w,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul));}finally{snapshot.Dispose();}}
 finally{context.Dispose();surface.Dispose();}}
function compare(a,b){assert.equal(a.length,b.length);let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));assert.ok(max<=2,`RGBA channel error ${max}`);return max;}
for(const scale of [1,1.25,1.5,2,3])for(const shadow of [false,true])test(`native ${shadow?'directional shadow':'blur'} matches independent Skia filter at ${scale}x`,()=>{
 const effect=shadow?new A.DropShadowDirectionEffect({Direction:90,ShadowDepth:12,BlurRadius:6,Color:'#80336699',Opacity:.75}):new A.BlurEffect(6);
 try{const actual=image(c=>{const state=c.PushEffect(effect);try{c.DrawRectangle(A.Brushes.Red,null,new A.Rect(30,30,24,24));}finally{state.Dispose();}},scale);
 const expected=image(c=>{const sigma=Math.fround(Math.fround(Math.fround(.288675)*Math.fround(6))+.5),filter=shadow?S.SKImageFilter.CreateDropShadow(0,12,sigma,sigma,new S.SKColor(51,102,153,96)):S.SKImageFilter.CreateBlur(sigma,sigma),paint=new S.SKPaint();paint.ImageFilter=filter;
 const count=c.Canvas.SaveLayer(paint);try{c.DrawRectangle(A.Brushes.Red,null,new A.Rect(30,30,24,24));}finally{c.Canvas.RestoreToCount(count);paint.Dispose();filter.Dispose();}},scale);compare(actual,expected);
 }finally{effect.Dispose();}
});
test('native blur conversion uses the upstream float32 radius/sigma rule and nonpositive no-op',()=>{
 assert.equal(SkBlurRadiusToSigma(0),0);assert.equal(SkBlurRadiusToSigma(-5),0);assert.equal(SkBlurRadiusToSigma(10),Math.fround(Math.fround(Math.fround(.288675)*10)+.5));
});
test('1000 warm native effect pushes reuse one filter without accumulating active leases',()=>{
 const p=new A.SkiaPlatform(S),surface=S.SKSurface.Create(new S.SKImageInfo(80,80)),context=new A.SkiaDrawingContext(p,surface.Canvas),effect=new A.BlurEffect(3);
 try{for(let i=0;i<1000;i++){const state=context.PushEffect(effect);context.DrawRectangle(A.Brushes.Red,null,new A.Rect(30,30,10,10));state.Dispose();}
 assert.equal(p.EffectFilters.NativeCreated,1);assert.equal(p.EffectFilters.Hits,999);assert.equal(p.EffectFilters.ActiveLeases,0);assert.equal(p.EffectFilters.Count,1);}
 finally{context.Dispose();surface.Dispose();effect.Dispose();p.Dispose();}assert.equal(p.EffectFilters.NativeDisposed,1);
});
test('LRU eviction and cache disposal retain active filters until their final layer lease closes',()=>{
 const cache=new SkiaEffectCache(S,1),a=cache.Acquire(new A.ImmutableBlurEffect(2)),b=cache.Acquire(new A.ImmutableBlurEffect(3));
 assert.equal(cache.Count,1);assert.equal(cache.NativeDisposed,0);assert.equal(a.Filter.IsDisposed,false);cache.Dispose();assert.equal(cache.NativeDisposed,0);
 a.Dispose();assert.equal(cache.NativeDisposed,1);b.Dispose();b.Dispose();assert.equal(cache.ActiveLeases,0);assert.equal(cache.NativeDisposed,2);assert.throws(()=>cache.Acquire(new A.ImmutableBlurEffect(3)),/disposed/);
});
test('disabled native effect cache keeps no entries and zero-radius effects allocate no filter',()=>{
 const cache=new SkiaEffectCache(S,0);try{for(let i=0;i<3;i++)cache.Acquire(new A.ImmutableBlurEffect(2)).Dispose();
 assert.equal(cache.Count,0);assert.equal(cache.NativeCreated,3);assert.equal(cache.NativeDisposed,3);
 cache.Acquire(new A.ImmutableBlurEffect(-1)).Dispose();cache.Acquire(new A.ImmutableDropShadowEffect(1,2,3,A.Colors.Black,0)).Dispose();assert.equal(cache.NativeCreated,3);assert.equal(cache.NoOps,2);
 }finally{cache.Dispose();}
});
test('native effect filter remains valid through a cache clear inside a live drawing scope',()=>{
 const effect=new A.ImmutableBlurEffect(4);
 const actual=image(c=>{const scope=c.PushEffect(effect);platform.EffectFilters.Clear();try{c.DrawRectangle(A.Brushes.Blue,null,new A.Rect(30,30,20,20));}finally{scope.Dispose();}});
 const expected=image(c=>{const scope=c.PushEffect(effect);try{c.DrawRectangle(A.Brushes.Blue,null,new A.Rect(30,30,20,20));}finally{scope.Dispose();}});compare(actual,expected);assert.equal(platform.EffectFilters.ActiveLeases,0);
});
test('partial native SaveLayer failure restores both canvas state and filter ownership',()=>{
 image(c=>{const before=c.Canvas.SaveCount,save=c.Canvas.SaveLayer;c.Canvas.SaveLayer=function(p){save.call(this,p);throw new Error('after layer allocation');};
 try{assert.throws(()=>c.PushEffect(new A.ImmutableBlurEffect(2)),/layer allocation/);assert.equal(c.Canvas.SaveCount,before);assert.equal(c._stack.length,0);assert.equal(c._nativeStates.length,0);assert.equal(platform.EffectFilters.ActiveLeases,0);}
 finally{c.Canvas.SaveLayer=save;}});
});
test('control effect allocation failure unwinds its earlier transform and opacity scopes',()=>{
 const b=new A.Border();b.Background=A.Brushes.Red;b.Effect=new A.ImmutableBlurEffect(2);b.Opacity=.5;b.Measure(new A.Size(30,30));b.Arrange(new A.Rect(0,0,30,30));
 const acquire=platform.EffectFilters.Acquire;platform.EffectFilters.Acquire=()=>{throw new Error('native effect unavailable');};
 try{image(c=>{assert.throws(()=>b.RenderTree(c),/native effect unavailable/);assert.equal(c.Canvas.SaveCount,1);assert.equal(c._stack.length,0);});}
 finally{platform.EffectFilters.Acquire=acquire;b.Dispose();}
});
function worker(t){
 const p=new A.SkiaPlatform(S),root=new HeadlessTopLevel(new A.Size(110,110)),view=new A.Border();root.Platform=p;view.Width=view.Height=24;view.Margin=new A.Thickness(30);view.Background=A.Brushes.Red;view.Effect=new A.DropShadowEffect({OffsetX:20,OffsetY:0,BlurRadius:0,Color:'blue'});root.Content=view;root.Layout();
 const recorder=new A.CompositionSceneRecorder(root,p),acc=new A.CompositionChangeAccumulator(),scene=new A.ServerCompositionScene(p);
 const prepare=()=>{acc.Update(recorder.Capture());return acc.Prepare();};
 const apply=async b=>{if(!b)return;const encoded=A.EncodeCompositionBatch(b.Value,b);await scene.Apply(A.DecodeCompositionBatch(encoded.Buffer,encoded.ByteLength));acc.Acknowledge(b.Sequence,b.Generation);};
 const pixels=()=>image(c=>scene.Render(c));
 t.after(()=>{scene.Dispose();recorder.Dispose();view.Effect.Dispose?.();root.Dispose();p.Dispose();});return {p,root,view,recorder,acc,scene,prepare,apply,pixels};
}
test('mutable effects publish value snapshots and restored worker scenes reproduce native pixels',async t=>{
 const r=worker(t);await r.apply(r.prepare());const before=r.pixels();r.view.Effect.OffsetX=-20;const update=r.prepare();assert.ok(update);await r.apply(update);assert.notDeepEqual(before,r.pixels());
 const next=new A.ServerCompositionScene(r.p),acc=new A.CompositionChangeAccumulator();acc.Update(r.recorder.Capture());const b=acc.Prepare(),packet=A.EncodeCompositionBatch(b.Value,b);
 try{await next.Apply(A.DecodeCompositionBatch(packet.Buffer,packet.ByteLength));compare(r.pixels(),image(c=>next.Render(c)));}finally{next.Dispose();}
});
for(const fault of ['scalar','color','field'])test(`malformed effect ${fault} cannot replace committed worker pixels`,async t=>{
 const r=worker(t);await r.apply(r.prepare());const before=r.pixels(),sequence=r.scene.Sequence;r.view.Effect.OffsetX=-20;const b=structuredClone(r.prepare());
 const node=b.Value.Nodes.Upsert.find(n=>n.Id===r.view.VisualId)??b.Value.Nodes.Patch.find(n=>n.Id===r.view.VisualId)?.Set;
 assert.ok(node?.Effect);if(fault==='scalar')node.Effect.V.OffsetX=NaN;else if(fault==='color')node.Effect.V.Color.V=[255,1,2,999];else node.Effect.V.Unsupported=1;
 await assert.rejects(r.scene.Apply(b),/effect|color|descriptor|nonfinite/i);assert.equal(r.scene.Sequence,sequence);assert.deepEqual(r.pixels(),before);
});
test('worker render failure unwinds existing visual scopes without modifying committed descriptors',async t=>{
 const r=worker(t);r.view.Opacity=.7;await r.apply(r.prepare());const before=r.scene.Sequence,acquire=platform.EffectFilters.Acquire;platform.EffectFilters.Acquire=()=>{throw new Error('server filter failure');};
 try{image(c=>{assert.throws(()=>r.scene.Render(c),/server filter failure/);assert.equal(c.Canvas.SaveCount,1);assert.equal(c._stack.length,0);});assert.equal(r.scene.Sequence,before);}
 finally{platform.EffectFilters.Acquire=acquire;}
});
test('composition effect assignment copies mutable values and preserves immutable type identity',()=>{
 const compositor=new A.Compositor({AutoCommit:false}),visual=compositor.CreateSolidColorVisual(),effect=new A.DropShadowDirectionEffect({Direction:0,ShadowDepth:10});
 try{visual.Effect=effect;compositor.Commit();effect.ShadowDepth=50;assert.equal(visual._Read('Effect').ShadowDepth,10);assert.ok(visual.Effect instanceof A.IImmutableEffect);
 assert.throws(()=>{visual.Effect={};},/IEffect/);assert.equal(visual.Effect.ShadowDepth,10);}
 finally{compositor.Dispose();effect.Dispose();}
});
