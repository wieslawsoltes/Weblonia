import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';
import { Initialize } from '@wieslawsoltes/skiasharpweb';
const S=await Initialize({fonts:false});
function rig(){
    const platform=new A.SkiaPlatform(S),root=new HeadlessTopLevel(new A.Size(240,100));root.Platform=platform;root.RenderScaling=1;
    const clock=new A.ManualClock();clock.TimeOrigin=0;
    const c=root.Compositor=new A.Compositor({AutoCommit:false,Clock:clock,ServerTransport:{RequestCommitAsync:()=>Promise.resolve()}});
    const v=c.CreateSolidColorVisual(A.Colors.Red);v.Size={X:20,Y:20};v.Offset={X:10,Y:15,Z:0};root._compositionChild=v;root.LayoutManager.ExecuteLayoutPass();
    const recorder=new A.CompositionSceneRecorder(root,platform),acc=new A.CompositionChangeAccumulator(),scene=new A.ServerCompositionScene(platform);
    const surface=S.SKSurface.Create(new S.SKImageInfo(240,100));
    function prepare(){c.Commit();acc.Update(recorder.Capture());return acc.Prepare();}
    async function commit(){const b=prepare();if(b){const packet=A.EncodeCompositionBatch(b.Value,b);await scene.Apply(A.DecodeCompositionBatch(packet.Buffer,packet.ByteLength));acc.Acknowledge(b.Sequence,b.Generation);}return b;}
    function pixels(){surface.Canvas.Clear(S.SKColors.White);const dc=new A.SkiaDrawingContext(platform,surface.Canvas);try{scene.Render(dc);}finally{dc.Dispose();}const image=surface.Snapshot();try{return image.ReadPixels(new S.SKImageInfo(240,100,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul));}finally{image.Dispose();}}
    const at=(x,y=20)=>[...pixels().slice((y*240+x)*4,(y*240+x)*4+4)];
    function implicit(target='Opacity',duration=100,type='Scalar',object=v){const animation=c[`Create${type}KeyFrameAnimation`]();animation.Target=target;animation.Duration=duration;animation.InsertExpressionKeyFrame(1,'this.FinalValue');const collection=c.CreateImplicitAnimationCollection();collection.Add(target,animation);object.ImplicitAnimations=collection;return {animation,collection};}
    return {platform,root,c,v,clock,scene,recorder,acc,prepare,commit,at,implicit,dispose(){scene.Dispose();recorder.Dispose();root.Dispose();c.Dispose();surface.Dispose();platform.Dispose();}};
}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} differs from ${b}`);
test('binary implicit trigger carries immutable FinalValue and excludes the client-only collection',async()=>{
    const r=rig();try{const {animation}=r.implicit();await r.commit();r.v.Opacity=.2;const b=await r.commit();assert.ok(!b.Value.Composition.Upsert.some(o=>o.Type==='ImplicitAnimationCollection'));
        const server=r.scene.CompositionObjects.get(r.v.Id);r.scene.Tick(50);near(server.Read('Opacity'),.6);assert.equal(r.v.Opacity,.2);
        const rgba=r.at(15);assert.equal(rgba[0],255);assert.ok(Math.abs(rgba[1]-102)<=1);assert.equal(rgba[3],255);
        r.scene.Tick(100);near(server.Read('Opacity'),.2);assert.equal(r.scene.HasAnimations,false);assert.equal(server.Instances.get('Opacity').Animation.IsDisposed,true);assert.equal(animation.IsDisposed,false);animation.Dispose();
    }finally{r.dispose();}
});
test('unrelated commits preserve active server presentation and do not replay completed instances',async()=>{
    const r=rig();try{const {animation}=r.implicit();await r.commit();r.v.Opacity=0;await r.commit();const server=r.scene.CompositionObjects.get(r.v.Id),first=server.Instances.get('Opacity');r.scene.Tick(50);near(server.Read('Opacity'),.5);
        r.v.Offset={X:30,Y:15,Z:0};await r.commit();assert.equal(server.Instances.get('Opacity'),first);near(server.Read('Opacity'),.5);
        r.scene.Tick(100);assert.equal(r.scene.HasAnimations,false);near(server.Read('Opacity'),0);r.v.Offset={X:50,Y:15,Z:0};await r.commit();assert.equal(server.Instances.get('Opacity'),first);assert.equal(r.scene.HasAnimations,false);near(server.Read('Opacity'),0);
        assert.equal(first.Animation.IsDisposed,true);animation.Dispose();
    }finally{r.dispose();}
});
test('retarget derives starting value from render-worker presentation, not a stale client acknowledgement',async()=>{
    const r=rig();try{const {animation}=r.implicit();await r.commit();r.v.Opacity=0;await r.commit();r.scene.Tick(50);const server=r.scene.CompositionObjects.get(r.v.Id),old=server.Instances.get('Opacity');
        r.clock.Time=50;r.v._serverValues=new Map([['Opacity',1]]);r.v.Opacity=.8;assert.equal(r.v._animations.get('Opacity').Start,1);await r.commit();const run=server.Instances.get('Opacity');near(run.Start,.5);assert.equal(old.Animation.IsDisposed,true);
        r.scene.Tick(100);near(server.Read('Opacity'),.65);r.scene.Tick(150);near(server.Read('Opacity'),.8);animation.Dispose();
    }finally{r.dispose();}
});
test('same-clock replacements do not collide in binary server identity',async()=>{
    const r=rig();try{const {animation}=r.implicit();await r.commit();r.v.Opacity=.2;await r.commit();const server=r.scene.CompositionObjects.get(r.v.Id),first=server.Instances.get('Opacity');r.v.Opacity=.7;await r.commit();const next=server.Instances.get('Opacity');assert.equal(first.StartedAt,next.StartedAt);assert.notEqual(first.Id,next.Id);assert.equal(first.Animation.IsDisposed,true);r.scene.Tick(100);near(server.Read('Opacity'),.7);animation.Dispose();}finally{r.dispose();}
});
test('a new trigger after completion starts from the retained server endpoint without replay',async()=>{
    const r=rig();try{const {animation}=r.implicit();await r.commit();r.v.Opacity=0;await r.commit();r.scene.Tick(100);r.clock.Time=100;r.v.Opacity=.8;await r.commit();const server=r.scene.CompositionObjects.get(r.v.Id);near(server.Instances.get('Opacity').Start,0);r.scene.Tick(150);near(server.Read('Opacity'),.4);animation.Dispose();}finally{r.dispose();}
});
test('clearing implicit definitions and assigning a value releases server metadata and final presentation',async()=>{
    const r=rig();try{const {animation,collection}=r.implicit();await r.commit();r.v.Opacity=.2;await r.commit();r.scene.Tick(100);collection.Clear();r.v.Opacity=.9;await r.commit();const server=r.scene.CompositionObjects.get(r.v.Id);near(server.Read('Opacity'),.9);assert.equal(server.Instances.size,0);assert.equal(server.Animations.size,0);animation.Dispose();}finally{r.dispose();}
});
for(const behavior of ['SetInitialValueBeforeDelay','SetInitialValueAfterDelay'])test(`binary ${behavior} retains delay semantics`,async()=>{
    const r=rig();try{const {animation}=r.implicit();animation.DelayTime=20;animation.DelayBehavior=behavior;animation.InsertKeyFrame(0,.7);await r.commit();r.v.Opacity=.2;await r.commit();const server=r.scene.CompositionObjects.get(r.v.Id);r.scene.Tick(10);near(server.Read('Opacity'),behavior==='SetInitialValueBeforeDelay'?.7:1);r.scene.Tick(120);near(server.Read('Opacity'),.2);animation.Dispose();}finally{r.dispose();}
});
test('reused instance identity with a changed descriptor is rejected without changing live server state',async()=>{
    const r=rig();try{const {animation}=r.implicit();await r.commit();r.v.Opacity=0;await r.commit();r.scene.Tick(40);const server=r.scene.CompositionObjects.get(r.v.Id),first=server.Instances.get('Opacity');r.v.Offset={X:30,Y:15,Z:0};const b=r.prepare();const forged=structuredClone(b);forged.Value.Composition.Upsert.find(o=>o.Id===r.v.Id).Animations[0].FinalValue=.9;
        await assert.rejects(r.scene.Apply(forged),/identity/);assert.equal(server.Instances.get('Opacity'),first);near(server.Read('Opacity'),.6);assert.equal(first.Animation.IsDisposed,false);animation.Dispose();
    }finally{r.dispose();}
});
test('invalid second animation rolls back new clones and preserves the entire server scene',async()=>{
    const r=rig();try{const {animation}=r.implicit();await r.commit();r.v.Opacity=.2;const other=r.c.CreateSolidColorVisual();const {animation:b}=r.implicit('Opacity',100,'Scalar',other);other.Opacity=.4;const batch=r.prepare(),forged=structuredClone(batch);
        forged.Value.Composition.Upsert.find(o=>o.Id===other.Id).Animations[0].Animation.Duration=-1;
        let disposed=0;const original=A.ScalarKeyFrameAnimation.prototype.Dispose;A.ScalarKeyFrameAnimation.prototype.Dispose=function(){if(!this.IsDisposed)disposed++;return original.call(this);};
        try{await assert.rejects(r.scene.Apply(forged),/timing/);}finally{A.ScalarKeyFrameAnimation.prototype.Dispose=original;}
        assert.ok(disposed>=2);assert.equal(r.scene.CompositionObjects.has(other.Id),false);assert.equal(r.scene.CompositionObjects.get(r.v.Id).Read('Opacity'),1);animation.Dispose();b.Dispose();
    }finally{r.dispose();}
});
test('component completion, unrelated commits and component stop preserve another completed component',async()=>{
    const r=rig();try{await r.commit();const x=r.c.CreateScalarKeyFrameAnimation(),y=r.c.CreateScalarKeyFrameAnimation();x.Duration=100;x.InsertKeyFrame(1,70);y.Duration=200;y.InsertKeyFrame(1,55);r.v.StartAnimation('Offset.X',x);r.v.StartAnimation('Offset.Y',y);await r.commit();r.scene.Tick(100);
        r.v.Color=A.Colors.Blue;await r.commit();const server=r.scene.CompositionObjects.get(r.v.Id);near(server.Read('Offset').X,70);near(server.Read('Offset').Y,35);r.scene.Tick(200);r.v.StopAnimation('Offset.X');await r.commit();near(server.Read('Offset').X,10);near(server.Read('Offset').Y,55);assert.equal(server.Instances.size,1);assert.equal(r.scene.HasAnimations,false);x.Dispose();y.Dispose();
    }finally{r.dispose();}
});
test('thousands of repeated implicit triggers keep instance ownership bounded and release clocks',async()=>{
    const r=rig();try{const {animation}=r.implicit();await r.commit();for(let i=1;i<=1000;i++){r.clock.Time=i*100;r.v.Opacity=i%2?.2:.8;await r.commit();r.scene.Tick(r.clock.Time+100);const server=r.scene.CompositionObjects.get(r.v.Id);assert.equal(server.Instances.size,1);assert.equal(server.Animations.size,0);assert.equal(server.Instances.get('Opacity').Animation.IsDisposed,true);}assert.equal(r.clock._listeners.size,0);animation.Dispose();}finally{r.dispose();}
});
for(const aot of [false,true])test(`native binary ${aot?'AOT':'runtime'} XAML layout animation avoids doubled translation and stale retained pixels`,async()=>{
    const r=rig();try{r.root._compositionChild=null;const compiled=new A.AvaloniaXamlCompiler().Compile('<Canvas xmlns="https://github.com/avaloniaui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"><Border x:Name="tile" Width="20" Height="20" Background="Red" Canvas.Left="10" Canvas.Top="15"/></Canvas>');
        const view=aot?(await import('data:text/javascript;base64,'+Buffer.from(compiled.JavaScript).toString('base64'))).Build(new A.AvaloniaXamlServices()):compiled.Build();r.root.Content=view;r.root.LayoutManager.ExecuteLayoutPass();const tile=view.FindControl('tile'),visual=A.ElementComposition.GetElementVisual(tile);const {animation}=r.implicit('Offset',100,'Vector3',visual);await r.commit();assert.deepEqual(r.at(15),[255,0,0,255]);
        A.Canvas.SetLeft(tile,110);r.root.LayoutManager.ExecuteLayoutPass();await r.commit();assert.deepEqual(r.at(15),[255,0,0,255]);r.scene.Tick(50);assert.deepEqual(r.at(65),[255,0,0,255]);assert.deepEqual(r.at(15),[255,255,255,255]);r.scene.Tick(100);assert.deepEqual(r.at(115),[255,0,0,255]);assert.deepEqual(r.at(215),[255,255,255,255]);assert.equal(r.scene.HasAnimations,false);animation.Dispose();
    }finally{r.dispose();}
});
for(const [type,initial,final] of [
    ['Vector4',{X:1,Y:2,Z:3,W:4},{X:4,Y:3,Z:2,W:1}],
    ['Quaternion',{X:0,Y:0,Z:0,W:1},{X:0,Y:0,Z:1,W:0}],
    ['Matrix4x4',Object.fromEntries(Array.from({length:16},(_,i)=>['M'+(Math.floor(i/4)+1)+(i%4+1),i])),Object.fromEntries(Array.from({length:16},(_,i)=>['M'+(Math.floor(i/4)+1)+(i%4+1),16-i]))]
])test(`binary implicit property-set expression preserves ${type} declared type and FinalValue`,async()=>{
    const r=rig();try{const properties=r.c.CreatePropertySet();properties['Insert'+type]('Value',initial);const a=r.c.CreateExpressionAnimation('this.FinalValue');a.Target='Value';const map=r.c.CreateImplicitAnimationCollection();map.Add('Value',a);properties.ImplicitAnimations=map;await r.commit();properties['Insert'+type]('Value',final);const batch=await r.commit();
        assert.equal(batch.Value.Composition.Upsert.find(x=>x.Id===properties.Id).PropertyTypes.Value,type);r.scene.Tick(1);assert.deepEqual(r.scene.CompositionObjects.get(properties.Id).Read('Value'),final);properties.StopAnimation('Value');await r.commit();assert.equal(r.scene.HasAnimations,false);a.Dispose();
    }finally{r.dispose();}
});
test('acknowledged render-worker starting values survive a full renderer recovery snapshot',async()=>{
    const {WorkerSkiaRenderer}=await import('../packages/browser/src/render-thread.js');
    const r=rig();let fresh;try{const {animation}=r.implicit();await r.commit();r.v.Opacity=0;await r.commit();r.scene.Tick(50);r.clock.Time=50;r.v._serverValues=new Map([['Opacity',1]]);r.v.Opacity=.8;await r.commit();
        const proxy=Object.create(WorkerSkiaRenderer.prototype);proxy.Root=r.root;proxy._ApplyAnimationReadback(r.scene.GetAnimationReadback());
        const run=r.v._animations.get('Opacity');assert.equal(run.Start,1);assert.equal(run._serverStart,.5);proxy._RestoreAnimationStarts();
        r.acc.Reset();r.recorder.ResetServerState();r.acc.Update(r.recorder.Capture());const batch=r.acc.Prepare();fresh=new A.ServerCompositionScene(r.platform);const packet=A.EncodeCompositionBatch(batch.Value,batch);await fresh.Apply(A.DecodeCompositionBatch(packet.Buffer,packet.ByteLength));fresh.Tick(100);near(fresh.CompositionObjects.get(r.v.Id).Read('Opacity'),.65);
        // Stale metadata from a previous instance is never attached to the next one.
        const stale=r.scene.GetAnimationReadback();r.v.Opacity=.9;const next=r.v._animations.get('Opacity');proxy._ApplyAnimationReadback(stale);assert.equal(Object.hasOwn(next,'_serverStart'),false);animation.Dispose();
    }finally{fresh?.Dispose();r.dispose();}
});
