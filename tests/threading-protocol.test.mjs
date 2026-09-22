import test from 'node:test';
import assert from 'node:assert/strict';
import { EncodeCompositionBatch, DecodeCompositionBatch, CompositionBufferPool, CompositionChangeAccumulator, CompositionSceneRecorder, ServerCompositionScene, ReplayDrawingCommands, PortableDrawingContext } from '@wieslawsoltes/avalonia-rendering';
import { Control, Border, TextBlock, StackPanel } from '@wieslawsoltes/avalonia-controls';
import { Size, Rect, Point } from '@wieslawsoltes/avalonia-base';
import { RecordingDrawingContext, LinearGradientBrush, GradientStop, Color } from '@wieslawsoltes/avalonia-media';
const snapshot = (nodes = new Map(), resources = new Map()) => ({ Root: 1, Width: 800, Height: 600, Scale: 1, Nodes: nodes, Resources: resources, Composition: new Map(), FontVersion: 0 });
test('threading: binary round-trip retains UTF8, floating values, typed buffers and isolated ownership', () => {
 const input = { Text:'مرحبا 👩🏽‍💻 Łąka', Values:[null,undefined,true,false,42,-3.14159,Infinity,NaN], Pixels:new Uint8Array([0,128,255]), Floats:new Float32Array([.25,3]), Buffer:new ArrayBuffer(12) };
 const packet = EncodeCompositionBatch(input,{Sequence:15,BaseSequence:14,Generation:2});
 const result = DecodeCompositionBatch(packet.Buffer, packet.ByteLength);
 assert.equal(result.Sequence,15); assert.deepEqual(result.Value,input); result.Value.Pixels[0]=12; assert.equal(input.Pixels[0],0);
});
test('threading: malformed protocol, cycles, dangerous keys and unsupported functions fail closed', () => {
 assert.throws(()=>EncodeCompositionBatch(()=>{}),/Nonportable/);
 const a={};a.a=a;assert.throws(()=>EncodeCompositionBatch(a),/cycles/);
 assert.throws(()=>EncodeCompositionBatch(JSON.parse('{"__proto__": 1}')),/Forbidden/);
 const p=EncodeCompositionBatch({a:[1,2,3]});new DataView(p.Buffer).setUint16(4,999,true);assert.throws(()=>DecodeCompositionBatch(p.Buffer,p.ByteLength),/Unsupported/);
 assert.throws(()=>DecodeCompositionBatch(new ArrayBuffer(10)),/buffer/);
});
test('threading: buffer pool is byte bounded and never reuses transferred detached memory', () => {
 const pool=new CompositionBufferPool({MaxBytes:8192,MaxBufferBytes:8192,MaxBuffers:2}), b=pool.Rent(2048);pool.Return(b);assert.equal(pool.Rent(1000),b);
 const cloned=structuredClone(b,{transfer:[b]});pool.Return(b);assert.equal(pool.Bytes,0);pool.Return(cloned);pool.Return(new ArrayBuffer(8192));assert(pool.Bytes<=8192);
});
test('threading: backpressure computes the next delta from acknowledged state, preserving prerequisite objects', () => {
 const acc=new CompositionChangeAccumulator(),one={Id:1},two={Id:2};acc.Update(snapshot(new Map([[1,one]])));const first=acc.Prepare();assert(first.Full);assert.equal(acc.Prepare(),null);
 acc.Update(snapshot(new Map([[1,one],[2,two]])));acc.Update(snapshot(new Map([[2,two]])));assert.equal(acc.Prepare(),null);
 acc.Acknowledge(first.Sequence,first.Generation);const second=acc.Prepare();assert.deepEqual(second.Value.Nodes.Remove,[1]);assert.deepEqual(second.Value.Nodes.Upsert,[two]);assert.equal(second.BaseSequence,1);
});
test('threading: clean scene capture does not call Control.Render and placement changes do not rerecord content', () => {
 class Painted extends Control { Render(c){this.Count=(this.Count??0)+1;c.DrawRectangle('#3a71de',null,new Rect(this.Bounds.Size));} }
 const root=new Border(),child=new Painted();root.Child=child;root.ClientSize=new Size(300,200);root.RenderScaling=1;root.Measure(root.ClientSize);root.Arrange(new Rect(root.ClientSize));
 const recorder=new CompositionSceneRecorder(root,{});const a=recorder.Capture(),count=child.Count;recorder.Capture();assert.equal(child.Count,count);
 child.Arrange(new Rect(10,10,child.Bounds.Width,child.Bounds.Height));const b=recorder.Capture();assert.equal(child.Count,count);assert.notEqual(a.Nodes.get(child.VisualId),b.Nodes.get(child.VisualId));
 child.InvalidateVisual();recorder.Capture();assert.equal(child.Count,count+1);recorder.Dispose();root.Dispose();
});
test('threading: server applies a portable gradient/text scene without accessing UI controls', async () => {
 const root=new Border(),panel=new StackPanel(),t=new TextBlock();t.Text='Hello retained worker';panel.Children.Add(t);root.Child=panel;
 const gradient=new LinearGradientBrush();gradient.GradientStops.AddRange([new GradientStop(Color.Parse('#336699'),0),new GradientStop(Color.Parse('#112233'),1)]);root.Background=gradient;
 root.ClientSize=new Size(300,200);root.RenderScaling=1;root.Measure(root.ClientSize);root.Arrange(new Rect(root.ClientSize));
 const recorder=new CompositionSceneRecorder(root,{}),acc=new CompositionChangeAccumulator();acc.Update(recorder.Capture());const batch=acc.Prepare();
 const p=EncodeCompositionBatch(batch.Value,batch),scene=new ServerCompositionScene({});await scene.Apply(DecodeCompositionBatch(p.Buffer,p.ByteLength));
 const c=new RecordingDrawingContext();scene.Render(c);c.Dispose();assert(c.Commands.some(x=>x.Op==='Text'));assert(c.Commands.some(x=>x.Op==='Rectangle'&&x.Brush instanceof LinearGradientBrush));
 root.Dispose();const c2=new RecordingDrawingContext();scene.Render(c2);assert.equal(c2.Commands.length,c.Commands.length);scene.Dispose();recorder.Dispose();
});
test('threading: invalid graph and sequence are rejected without changing the committed scene', async () => {
 const root=new Border();root.ClientSize=new Size(200,150);root.RenderScaling=1;root.Measure(root.ClientSize);root.Arrange(new Rect(root.ClientSize));
 const r=new CompositionSceneRecorder(root,{}),a=new CompositionChangeAccumulator();a.Update(r.Capture());const b=a.Prepare(),s=new ServerCompositionScene({});await s.Apply(b);
 const bad=structuredClone(b);bad.Full=false;bad.BaseSequence=1;bad.Sequence=2;bad.Value.Nodes.Upsert[0].Children=[{Id:root.VisualId,Clip:null}];await assert.rejects(s.Apply(bad),/cycle/);assert.equal(s.Sequence,1);assert.equal(s.Nodes.size,1);
 await assert.rejects(s.Apply({...b,Full:false,Sequence:5,BaseSequence:4}),/sequence gap/);s.Dispose();r.Dispose();root.Dispose();
});

import { Compositor, ElementComposition } from '@wieslawsoltes/avalonia-composition';
import { AutomationProjection } from '../packages/browser/src/automation-projection.js';
import { ThreadChannel, TransferResult } from '../packages/browser/src/thread-channel.js';
import { WorkerSkiaRenderer } from '../packages/browser/src/render-thread.js';

test('threading: server materializes primitive visual defaults and ticks keyframes without UI access', async()=>{
 const root=new Border(new TextBlock('independent'));root.ClientSize=new Size(400,300);root.RenderScaling=1;root.Measure(root.ClientSize);root.Arrange(new Rect(root.ClientSize));
 const compositor=root.Compositor=new Compositor({AutoCommit:false});const group=compositor.CreateContainerVisual(),tile=compositor.CreateSolidColorVisual(Color.Parse('#ff0000'));tile.Size={X:30,Y:30};group.Children.Add(tile);root._compositionChild=group;
 const animation=compositor.CreateScalarKeyFrameAnimation();animation.Duration=1000;animation.InsertKeyFrame(0,10);animation.InsertKeyFrame(1,110);tile.StartAnimation('Offset.X',animation);compositor.Commit();compositor.SetServerTransport({RequestCommitAsync:()=>Promise.resolve()});
 const recorder=new CompositionSceneRecorder(root,{}),acc=new CompositionChangeAccumulator();acc.Update(recorder.Capture());const batch=acc.Prepare(),server=new ServerCompositionScene({});await server.Apply({...batch,Value:structuredClone(batch.Value)});
 const object=server.CompositionObjects.get(tile.Id);assert.equal(object.Read('Opacity'),1);assert.equal(object.Read('IsVisible'),true);
 const started=[...object.Animations.values()][0].StartedAt;server.Tick(started+500);assert.equal(object.Read('Offset').X,60);assert.equal(tile.Offset.X,0);
 tile.StopAnimation('Offset.X');compositor.Commit();acc.Acknowledge(batch.Sequence,batch.Generation);acc.Update(recorder.Capture());await server.Apply(acc.Prepare());assert.equal(server.CompositionObjects.get(tile.Id).Read('Offset').X,0);assert(server.GetReadback().find(v=>v.Id===tile.Id).Values.length===0);
 recorder.Dispose();server.Dispose();compositor.Dispose();root.Dispose();
});
test('threading: all node arguments are prepared before scene mutation',async()=>{
 const root=new Border(new TextBlock('atomic'));root.ClientSize=new Size(300,100);root.RenderScaling=1;root.Measure(root.ClientSize);root.Arrange(new Rect(root.ClientSize));const recorder=new CompositionSceneRecorder(root,{}),acc=new CompositionChangeAccumulator();acc.Update(recorder.Capture());let b=acc.Prepare();const server=new ServerCompositionScene({});await server.Apply(b);acc.Acknowledge(b.Sequence,b.Generation);const before=server.Nodes;
 root.InvalidateVisual();acc.Update(recorder.Capture());b=structuredClone(acc.Prepare());(b.Value.Nodes.Upsert[0] ?? b.Value.Nodes.Patch[0].Set).Clip={$:'InvalidNativeObject',V:[]};
 await assert.rejects(server.Apply(b),/Unknown|Unsupported|Invalid/);assert.equal(server.Sequence,1);assert.equal(server.Nodes,before);server.Dispose();recorder.Dispose();root.Dispose();
});
test('threading: delta references cannot delete a still-live resource',async()=>{
 const root=new Border(new TextBlock('retained'));root.ClientSize=new Size(300,100);root.RenderScaling=1;root.Measure(root.ClientSize);root.Arrange(new Rect(root.ClientSize));const r=new CompositionSceneRecorder(root,{}),a=new CompositionChangeAccumulator();a.Update(r.Capture());const b=a.Prepare(),s=new ServerCompositionScene({});await s.Apply(b);
 const id=b.Value.Resources.Upsert[0].Id;const broken={Sequence:2,BaseSequence:1,Generation:1,Full:false,Value:{...b.Value,Nodes:{Upsert:[],Remove:[]},Resources:{Upsert:[],Remove:[id]},Composition:{Upsert:[],Remove:[]}}};await assert.rejects(s.Apply(broken),/Missing/);assert.equal(s.Sequence,1);s.Dispose();r.Dispose();root.Dispose();
});
test('threading: an unrecorded composition mutation cannot receive an early processed acknowledgement',async()=>{
 const root={_RequestRender(){},RenderScaling:1,ClientSize:new Size(1,1)},renderer=new WorkerSkiaRenderer({},root,null);renderer.Backend='canvas';renderer.Port={postMessage(){},close(){}};
 let resolved=false;const wait=renderer.CompositionTransport.RequestCommitAsync().then(()=>resolved=true);renderer._Pump();assert.equal(renderer._processedWaiters.length,1);assert.equal(resolved,false);
 renderer._Fail(Error('test shutdown'));await assert.rejects(wait,/test shutdown/);renderer.Recorder.Dispose();renderer.BufferPool.Clear();
});
test('threading: semantic projection emits incremental mutations and preserves node identity',()=>{
 const sent=[],p=new AutomationProjection(m=>sent.push(m)),root=p.Create(0,'div',true),a=p.createElement('div'),b=p.createElement('div');a.id='a';a.setAttribute('role','button');root.append(a,b);p.Flush();assert.equal(sent.length,1);a.setAttribute('role','button');p.Flush();assert.equal(sent.length,1);root.insertBefore(b,a);p.Flush();assert.deepEqual(sent.at(-1).Operations,[['insert',0,b.NodeId,a.NodeId]]);let invoked=0;a.addEventListener('click',()=>invoked++);p.Dispatch(a.NodeId,'click',{});assert.equal(invoked,1);b.remove();p.Flush();assert.equal(root.firstChild,a);p.Dispose();
});
test('threading: control RPC transfers buffers and rejects unknown operations',async()=>{
 const c=new MessageChannel(),server=new ThreadChannel(c.port1,{OnRequest:(method,value)=>{if(method==='echo')return TransferResult(value,value.buffer);throw Error('unregistered');}}),client=new ThreadChannel(c.port2);
 const bytes=new Uint8Array([1,2,3]),result=await client.RequestAsync('echo',bytes,[bytes.buffer]);assert.equal(bytes.byteLength,0);assert.deepEqual(result,new Uint8Array([1,2,3]));await assert.rejects(client.RequestAsync('no'),/unregistered/);server.Dispose();client.Dispose();
});
test('threading: control RPC is bounded and rejects pending work on disposal',async()=>{
 const c=new MessageChannel(),server=new ThreadChannel(c.port1,{OnRequest:()=>new Promise(()=>{})}),client=new ThreadChannel(c.port2,{MaxRequests:1});const pending=client.RequestAsync('long');await assert.rejects(client.RequestAsync('overflow'),/full/);client.Dispose();await assert.rejects(pending,/disposed/);server.Dispose();
});

import { ServerScrollController, CaptureScrollPolicy } from '@wieslawsoltes/avalonia-rendering';
import { ScrollViewer, Canvas } from '@wieslawsoltes/avalonia-controls';
import { CompositionCustomVisualHandler } from '@wieslawsoltes/avalonia-composition';

test('threading: ellipse replay preserves center and both radii without per-frame argument arrays',()=>{
 const r=new CompositionSceneRecorder({},{}),c=new PortableDrawingContext(r.Resources);c.DrawEllipse('#246',null,new Point(8,9),5,7);c.Dispose();let observed;
 ReplayDrawingCommands(c.Commands,{DrawEllipse(...args){observed=args; }},v=>v?.$==='Point'?new Point(...v.V):v);
 assert.deepEqual(observed,['#246',null,new Point(8,9),5,7]);r.Dispose();
});
const policy=(values={})=>({Id:1,Offset:[0,0],Extent:[1000,2000],Viewport:[200,300],Region:[0,0,200,300],CoverageY:[0,1700],Content:[2],Headers:[3],Horizontal:true,Vertical:true,LineHeight:48,Depth:1,...values});
const nodes=p=>new Map([[1,{Id:1,Scroll:p}],[2,{Id:2}],[3,{Id:3}]]);
const wheel=(sequence,x=0,y=80,extra={})=>({Sequence:sequence,Event:{Position:{X:60,Y:60},deltaX:x,deltaY:y,deltaMode:0,...extra}});
test('threading: compositor scroll acknowledgement reconciles sequenced deltas once',()=>{
 const s=new ServerScrollController({});s.Commit(0,nodes(policy()));assert(s.Wheel(wheel(1)));assert(s.Wheel(wheel(2)));assert.equal(s.Offsets.get(1)[1],160);
 s.Commit(1,nodes(policy({Offset:[0,80]})));assert.equal(s.Pending.length,1);assert.equal(s.Offsets.get(1)[1],160);
 s.Commit(2,nodes(policy({Offset:[0,160]})));assert.equal(s.Pending.length,0);assert.equal(s.Transform(2),null);assert.equal(s.Offsets.get(1)[1],160);
 assert(!s.Wheel(wheel(1)));s.Dispose();assert.equal(s.Policies.size,0);
});
test('threading: virtual scroll coverage prevents speculative blank rows and rejects duplicate events',()=>{
 const s=new ServerScrollController({});s.Commit(0,nodes(policy({CoverageY:[0,60]})));assert(s.Wheel(wheel(1,0,1800)));assert.equal(s.Offsets.get(1)[1],60);assert(!s.Wheel(wheel(1)));assert.equal(s.Pending.length,1);
 assert(s.Statistics.CoverageClamps>0);s.Commit(1,nodes(policy({Offset:[0,1700],CoverageY:[1600,1700]})));assert.equal(s.Offsets.get(1)[1],1700);s.Dispose();
});
test('threading: scroll fast path maps CSS delta modes and updates header and thumb transforms',()=>{
 const s=new ServerScrollController({});s.Commit(0,nodes(policy()));s.Wheel(wheel(1,0,2,{deltaMode:1,shiftKey:true}));assert.equal(s.Offsets.get(1)[0],96);assert.equal(s.Transform(3).M31,-96);assert.equal(s.Transform(3).M32,0);
 assert.equal(s.BarDelta({Owner:1,Horizontal:true,Range:800,Travel:100,Reversed:false}),12);
 assert.equal(s.BarDelta({Owner:1,Horizontal:true,Range:800,Travel:100,Reversed:true}),-12);
 s.Wheel(wheel(2,0,1,{deltaMode:2}));assert.equal(s.Offsets.get(1)[1],300);s.Dispose();
});
test('threading: scroll queues are bounded and removed policies cannot retain input',()=>{
 const s=new ServerScrollController({});s.Commit(0,nodes(policy({Extent:[1000,1e9],CoverageY:[0,1e9]})));
 for(let i=1;i<=256;i++)assert(s.Wheel(wheel(i)));assert(!s.Wheel(wheel(257)));assert(!s.Wheel(wheel(258,0,Infinity)));
 s.Commit(0,new Map());assert.equal(s.Pending.length,0);assert.equal(s.Policies.size,0);s.Dispose();
});
test('threading: fast-scroll policy is explicit and excludes editor, rotated or animated content',()=>{
 const root=new ScrollViewer();root.Content=Object.assign(new Border(),{Width:1000,Height:2000});root.HorizontalScrollBarVisibility='Auto';root.AllowAutoHide=false;root.ClientSize=new Size(400,300);root.Measure(root.ClientSize);root.Arrange(new Rect(root.ClientSize));
 assert.equal(CaptureScrollPolicy(root),null);root.IsCompositorScrollingEnabled='False';assert.equal(root.IsCompositorScrollingEnabled,false);root.IsCompositorScrollingEnabled=true;assert(CaptureScrollPolicy(root));
 root._compositionSelf={};assert.equal(CaptureScrollPolicy(root),null);root._compositionSelf=null;root.Dispose();
});
test('threading: custom worker messages are queued before connection and acknowledgement trims only consumed messages',()=>{
 const compositor=new Compositor({AutoCommit:false}),handler=new CompositionCustomVisualHandler();handler.WorkerModule='fixture';const visual=compositor.CreateCustomVisual(handler);visual.SendHandlerMessage({Ping:1});visual.SendHandlerMessage({Ping:2});
 const root={Compositor:compositor,RenderScaling:1,_RequestRender(){}};const renderer=new WorkerSkiaRenderer({},root,null);renderer._AcknowledgeMessages({Composition:new Map([[visual.Id,{Custom:{Messages:[{Sequence:1}]}}]])});assert.deepEqual(visual._workerMessages.map(m=>m.Sequence),[2]);
 for(let i=0;i<1023;i++)visual.SendHandlerMessage({});assert.throws(()=>visual.SendHandlerMessage({}),/backlog/);assert.equal(visual._workerMessages.length,1024);
 renderer._AcknowledgeMessages({Composition:new Map([[visual.Id,{Custom:{Messages:[{Sequence:1025}]}}]])});assert.equal(visual._workerMessages.length,0);renderer.Recorder.Dispose();compositor.Dispose();
});
test('threading: registered worker custom handler receives durable state and messages only on server',async()=>{
 const url=new URL('../samples/ControlCatalog/worker-custom-handler.js',import.meta.url).href,root=new Border();root.ClientSize=new Size(300,200);root.RenderScaling=1;root.Measure(root.ClientSize);root.Arrange(new Rect(root.ClientSize));root.Compositor=new Compositor({AutoCommit:false});
 const handler=new CompositionCustomVisualHandler();handler.WorkerModule=url;handler.WorkerState={Color:'#d1495b'};
 const visual=root.Compositor.CreateCustomVisual(handler);visual.Size={X:100,Y:100};root._compositionChild=visual;visual.SendHandlerMessage({Start:true});root.Compositor.Commit();
 const recorder=new CompositionSceneRecorder(root,{}),acc=new CompositionChangeAccumulator();acc.Update(recorder.Capture());const batch=acc.Prepare();const scene=new ServerCompositionScene({},{HandlerModules:[url]});await scene.Apply(batch);const server=scene.CompositionObjects.get(visual.Id);assert.equal(server.CustomHandler.Color,'#d1495b');assert.equal(server.CustomHandler.Messages,1);scene.Tick(1);assert.equal(server.CustomHandler.AnimationTicks,1);
 const denied=new ServerCompositionScene({});await assert.rejects(denied.Apply(batch),/not registered/);assert.equal(denied.Sequence,0);denied.Dispose();scene.Dispose();recorder.Dispose();root.Dispose();root.Compositor.Dispose();
});
test('threading: a burst of pre-capture composition waits shares one bounded promise',async()=>{
 const root={RenderScaling:1,ClientSize:new Size(1,1),_RequestRender(){}};const r=new WorkerSkiaRenderer({},root,null);const a=r.CompositionTransport.RequestCommitAsync();for(let i=0;i<2000;i++)assert.equal(r.CompositionTransport.RequestCommitAsync(),a);assert.equal(r._processedWaiters.length,1);r._Fail(new Error('shutdown'));await assert.rejects(a,/shutdown/);r.Recorder.Dispose();r.BufferPool.Clear();
});
test('threading: concurrent render RPCs are bounded after initialization and reject on failure',async()=>{
 const r=new WorkerSkiaRenderer({},{RenderScaling:1,ClientSize:new Size(1,1)},null,{MaxRequests:1});r.Port={postMessage(){}};r._ready.Resolve();const a=r.RequestAsync('long');await Promise.resolve();await assert.rejects(r.RequestAsync('overflow'),/queue is full/);r._Fail(new Error('shutdown'));await assert.rejects(a,/shutdown/);r.Recorder.Dispose();r.BufferPool.Clear();
});
test('threading: clean off-tree VisualBrush retains every nested descendant and tracks changed ink',async()=>{
 const {VisualBrush}=await import('@wieslawsoltes/avalonia-media');const text=new TextBlock('off tree');let source=text;for(let i=0;i<6;i++)source=new Border(source);source.Width=150;source.Height=50;
 const root=new Border();root.Background=new VisualBrush(source);root.ClientSize=new Size(300,200);root.RenderScaling=1;root.Measure(root.ClientSize);root.Arrange(new Rect(root.ClientSize));const r=new CompositionSceneRecorder(root,{}),first=r.Capture(),second=r.Capture();assert.equal(first.Nodes.size,second.Nodes.size);assert(second.Nodes.has(text.VisualId));
 text.Text='changed ink';const third=r.Capture();assert.notEqual(third.Nodes.get(text.VisualId).Before,second.Nodes.get(text.VisualId).Before);r.Dispose();root.Dispose();source.Dispose();
});
