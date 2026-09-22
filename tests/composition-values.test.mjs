import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
const values={Scalar:7,Boolean:true,Color:A.Color.Parse('#ff336699'),Vector2:new A.Vector(2,3),Vector3:{X:2,Y:3,Z:4},Vector4:{X:2,Y:3,Z:4,W:5},Quaternion:{X:0,Y:0,Z:0,W:1},Matrix3x2:new A.Matrix(1,2,3,4,5,6),Matrix4x4:Object.fromEntries(Array.from({length:16},(_,i)=>[`M${Math.floor(i/4)+1}${i%4+1}`,i+1]))};
for(const [type,value] of Object.entries(values))test(`composition ${type} properties distinguish type, copy values and expose status`,()=>{
    const c=new A.Compositor({AutoCommit:false}),p=c.CreatePropertySet();
    try {assert.equal(p[`TryGet${type}`]('Value').Status,A.CompositionGetValueStatus.NotFound);p[`Insert${type}`]('Value',value);
        const a=p[`TryGet${type}`]('Value');assert.equal(a.Status,A.CompositionGetValueStatus.Succeeded);assert.deepEqual(a.Value,value);
        if(typeof value==='object'){assert.notEqual(a.Value,value);const key=Object.keys(value)[0],saved=value[key];a.Value[key]=999;assert.equal(p[`TryGet${type}`]('Value').Value[key],saved);}
        const wrong=type==='Scalar'?'Boolean':'Scalar';assert.equal(p[`TryGet${wrong}`]('Value').Status,A.CompositionGetValueStatus.TypeMismatch);
        c.Commit();assert.deepEqual(p.GetExpressionValue('Value'),value);
    }finally{c.Dispose();}
});
test('composition Quaternion and Vector4 keep distinct declared tags, including overwriting the same key',()=>{
    const c=new A.Compositor({AutoCommit:false}),p=c.CreatePropertySet();p.InsertQuaternion('Rotation',values.Quaternion);assert.equal(p.TryGetVector4('Rotation').Status,'TypeMismatch');p.InsertVector4('Rotation',values.Quaternion);assert.equal(p.TryGetQuaternion('Rotation').Status,'TypeMismatch');assert.equal(p.TryGetVector4('Rotation').Status,'Succeeded');c.Dispose();
});
test('composition values reject nonfinite components and invalid keys before changing prior data',()=>{
    const c=new A.Compositor({AutoCommit:false}),p=c.CreatePropertySet();p.InsertScalar('Value',1);
    for(const [type,v] of [['Scalar',NaN],['Boolean','true'],['Vector2',{X:1,Y:Infinity}],['Vector3',{X:1,Y:2}],['Matrix4x4',{M11:1}],['Quaternion',{X:0,Y:0,Z:NaN,W:1}]])assert.throws(()=>p[`Insert${type}`]('Value',v),TypeError);
    for(const name of ['__proto__','constructor','prototype','Comment','_private','dot.name'])assert.throws(()=>p.InsertScalar(name,2),RangeError);
    assert.equal(p.TryGetScalar('Value').Value,1);c.Dispose();assert.throws(()=>p.InsertScalar('Value',2),/disposed/);
});
test('typed animation parameters are copied, cleared and reject foreign/disposed references',()=>{
    const c=new A.Compositor({AutoCommit:false}),other=new A.Compositor({AutoCommit:false}),a=c.CreateExpressionAnimation('v.X');
    for(const [type,value]of Object.entries(values)){a[`Set${type}Parameter`](type,value);assert.deepEqual(a.Parameters.get(type),value);if(typeof value==='object')assert.notEqual(a.Parameters.get(type),value);}
    a.ClearParameter('Scalar');assert.equal(a.Parameters.has('Scalar'),false);const p=c.CreatePropertySet();a.SetReferenceParameter('Ref',p);assert.equal(a.Parameters.get('Ref'),p);
    assert.throws(()=>a.SetReferenceParameter('Other',other.CreatePropertySet()),/compositor/);p.Dispose();assert.throws(()=>a.SetReferenceParameter('Disposed',p),/live/);
    a.ClearAllParameters();assert.equal(a.Parameters.size,0);a.Dispose();assert.throws(()=>a.SetScalarParameter('s',1),/disposed/);c.Dispose();other.Dispose();
});
function clock(){let now=0,active=0;return {Now:()=>++now,Subscribe:()=>{active++;return A.Disposable.Create(()=>active--);},get Active(){return active;}};}
function animation(c,target,value=1){const a=c.CreateScalarKeyFrameAnimation();a.Target=target;a.InsertKeyFrame(1,value);return a;}
test('animation group is a client CompositionObject with Remove/RemoveAll and does not own supplied animations',()=>{
    const c=new A.Compositor({AutoCommit:false}),g=c.CreateAnimationGroup(),a=animation(c,'Opacity');assert.ok(g instanceof A.CompositionObject);assert.equal(g instanceof A.CompositionAnimation,false);
    g.Add(a);g.Add(a);assert.equal([...g].length,2);assert.ok(g.Remove(a));assert.equal([...g].length,1);g.RemoveAll();assert.equal(g.Remove(a),false);g.Add(a);g.Dispose();assert.equal(a.IsDisposed,false);assert.throws(()=>g.Add(a),/live/);a.Dispose();c.Dispose();
});
test('animation group starts every member at the identical clock instant and clones parameter ownership',()=>{
    const clk=clock(),c=new A.Compositor({AutoCommit:false,Clock:clk}),v=c.CreateSolidColorVisual(),g=c.CreateAnimationGroup(),a=animation(c,'Opacity',.5),b=animation(c,'Offset.X',20);
    a.SetScalarParameter('s',1);g.Add(a);g.Add(b);v.StartAnimationGroup(g);const states=[...v._animations.values()];assert.equal(states.length,2);assert.equal(states[0].StartedAt,states[1].StartedAt);assert.equal(clk.Active,1);
    a.SetScalarParameter('s',2);assert.equal(states[0].Animation.Parameters.get('s'),1);v.StopAnimationGroup(g);assert.equal(v._animations.size,0);assert.equal(clk.Active,0);c.Dispose();
});
test('invalid group target leaves prior running animations unchanged',()=>{
    const c=new A.Compositor({AutoCommit:false,Clock:clock()}),v=c.CreateSolidColorVisual(),old=animation(c,'Opacity',.5);v.StartAnimation('Opacity',old);const before=v._animations.get('Opacity'),g=c.CreateAnimationGroup();
    g.Add(animation(c,'Opacity',.1));g.Add(animation(c,'Missing',10));assert.throws(()=>v.StartAnimationGroup(g),/Invalid animation/);assert.equal(v._animations.get('Opacity'),before);assert.equal(v._animations.size,1);c.Dispose();
});
test('single targeted animation supports StartAnimationGroup and stopping one component preserves another',()=>{
    const c=new A.Compositor({AutoCommit:false,Clock:clock()}),v=c.CreateSolidColorVisual(),x=animation(c,'Offset.X',20),y=animation(c,'Offset.Y',30);c.Commit();v.StartAnimationGroup(x);v.StartAnimationGroup(y);v._Tick(500);
    const prior=v._Read('Offset');assert.ok(prior.X>0 && prior.Y>0);v.StopAnimationGroup(x);assert.equal(v._Read('Offset').X,0);assert.equal(v._Read('Offset').Y,prior.Y);assert.ok(v._animations.has('Offset.Y'));c.Dispose();
});
test('typed parameters and grouped animations execute on isolated server state through binary transport',async()=>{
    const root=new A.Border();root.ClientSize=new A.Size(100,100);root.RenderScaling=1;root.Measure(root.ClientSize);root.Arrange(new A.Rect(root.ClientSize));
    const c=root.Compositor=new A.Compositor({AutoCommit:false,Clock:clock()}),p=c.CreatePropertySet(),v=c.CreateSolidColorVisual();root._compositionChild=v;
    p.InsertBoolean('Enabled',true);p.InsertVector4('Shift',{X:11,Y:12,Z:13,W:14});p.InsertMatrix3x2('Transform',new A.Matrix(1,0,0,1,15,16));p.InsertQuaternion('Rotation',{X:0,Y:0,Z:0,W:1});
    const a=c.CreateExpressionAnimation('config.Enabled ? config.Shift.W + config.Transform.M31 : 0');a.SetReferenceParameter('config',p);a.Target='Offset.X';const g=c.CreateAnimationGroup();g.Add(a);v.StartAnimationGroup(g);c.Commit();c.SetServerTransport({RequestCommitAsync:()=>Promise.resolve()});
    const recorder=new A.CompositionSceneRecorder(root,{}),acc=new A.CompositionChangeAccumulator(),server=new A.ServerCompositionScene({});
    try{acc.Update(recorder.Capture());const b=acc.Prepare();assert.equal(b.Value.Composition.Upsert.some(o=>o.Type==='CompositionAnimationGroup'),false);
        const packet=A.EncodeCompositionBatch(b.Value,b);await server.Apply(A.DecodeCompositionBatch(packet.Buffer,packet.ByteLength));server.Tick(1000);const sv=server.CompositionObjects.get(v.Id);
        assert.equal(sv.Read('Offset').X,29);assert.equal(v.Offset.X,0);p.InsertScalar('Uncommitted',42);assert.equal(server.CompositionObjects.get(p.Id).Read('Uncommitted'),undefined);
    }finally{server.Dispose();recorder.Dispose();c.Dispose();root.Dispose();}
});
