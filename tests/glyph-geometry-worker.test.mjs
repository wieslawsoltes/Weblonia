import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as A from '@wieslawsoltes/avalonia';
import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';
import { Initialize } from '../vendor/skiasharpweb/dist/package/node.js';
const bytes=readFileSync(process.env.AVALONIA_TEST_FONT??'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
const S=await Initialize({fonts:false});
function rig(t,renderApi=S){
    const ui=new A.SkiaPlatform(S),renderer=new A.SkiaPlatform(renderApi),face=ui.CreateGlyphTypeface(bytes);
    const glyphs=new A.GlyphRun(face,32,'█',[new A.GlyphInfo(face.GetGlyph(0x2588),0,35)],new A.Point(16,100));
    const first=new A.LineSegment(new A.Point(76,16),false),second=new A.LineSegment(new A.Point(76,60)),f=new A.PathFigure(new A.Point(16,16),[first,second]),geometry=new A.PathGeometry([f]);
    const pen=new A.Pen(A.Brushes.Black,4),view=new A.Control();view.Width=200;view.Height=130;
    const root=new HeadlessTopLevel(new A.Size(200,130));root.Platform=ui;root.Content=view;root.RenderScaling=1;root.Layout();
    view.Render=c=>{c.DrawGeometry(A.Brushes.Red,pen,geometry);c.DrawGlyphRun(A.Brushes.Black,glyphs);};
    const recorder=new A.CompositionSceneRecorder(root,ui),acc=new A.CompositionChangeAccumulator(),scene=new A.ServerCompositionScene(renderer);
    const surface=renderApi.SKSurface.Create(new renderApi.SKImageInfo(200,130));
    const prepare=()=>{acc.Update(recorder.Capture());return acc.Prepare();};
    const apply=async batch=>{if(batch){const packet=A.EncodeCompositionBatch(batch.Value,batch),decoded=A.DecodeCompositionBatch(packet.Buffer,packet.ByteLength);await scene.Apply(decoded);acc.Acknowledge(batch.Sequence,batch.Generation);}return batch;};
    const commit=()=>apply(prepare());
    const snapshot=()=>{surface.Canvas.Clear(renderApi.SKColors.White);const dc=new A.SkiaDrawingContext(renderer,surface.Canvas);try{scene.Render(dc);}finally{dc.Dispose();}
        const image=surface.Snapshot();try{return image.ReadPixels(new renderApi.SKImageInfo(200,130,renderApi.SKColorType.Rgba8888,renderApi.SKAlphaType.Unpremul));}finally{image.Dispose();}};
    const at=(x,y)=>[...snapshot().slice((y*200+x)*4,(y*200+x)*4+4)];
    t.after(()=>{scene.Dispose();recorder.Dispose();root.Dispose();glyphs.Dispose();face.Dispose();geometry.Dispose();f.Dispose();first.Dispose();second.Dispose();pen.Dispose();surface.Dispose();renderer.Dispose();ui.Dispose();});
    return{ui,renderer,face,glyphs,first,second,geometry,view,root,recorder,acc,scene,prepare,apply,commit,at,snapshot};
}
test('binary worker transport publishes explicit glyph indices and independent fill/stroke roles',async t=>{
    const r=rig(t),b=await r.commit();assert.equal(b.Value.Resources.Upsert.filter(x=>x.Kind==='GlyphTypeface').length,1);assert.equal(b.Value.Resources.Upsert.filter(x=>x.Kind==='GlyphRun').length,1);
    const run=b.Value.Resources.Upsert.find(x=>x.Kind==='GlyphRun'),font=b.Value.Resources.Upsert.find(x=>x.Kind==='GlyphTypeface');assert.deepEqual(run.Depends,[font.Id]);
    assert.deepEqual(run.Data.Glyphs,[[r.face.GetGlyph(0x2588),0,35,0,0]]);assert.notEqual(font.Data.Bytes.buffer,bytes.buffer);
    assert.deepEqual(r.at(45,30),[255,0,0,255]);assert.deepEqual(r.at(45,15),[255,255,255,255]);assert.deepEqual(r.at(26,90),[0,0,0,255]);
});
test('glyph/path mutations generate immutable resource deltas and preserve font/native reuse',async t=>{
    const r=rig(t);await r.commit();const fontId=[...r.scene.Resources.values()].find(v=>v.Kind==='GlyphTypeface').Id,font=r.scene.Resolver.Values.get(fontId);
    const oldRun=[...r.scene.Resources.values()].find(v=>v.Kind==='GlyphRun'),oldPath=[...r.scene.Resources.values()].find(v=>v.Kind==='Geometry');
    r.first.IsStroked=true;r.glyphs.BaselineOrigin=new A.Point(76,100);const next=await r.commit();assert.ok(next);
    assert.equal(next.Value.Resources.Upsert.filter(x=>x.Kind==='GlyphTypeface').length,0);assert.equal(r.scene.Resolver.Values.get(fontId),font);
    assert.equal(oldRun.Data.Baseline[0],16);assert.ok(oldPath.Data.Path.StrokeData.includes('M76 16'));assert.deepEqual(r.at(45,15),[0,0,0,255]);
    assert.deepEqual(r.at(26,90),[255,255,255,255]);assert.deepEqual(r.at(86,90),[0,0,0,255]);
});
test('warm scene capture shares native glyph blob, font descriptor and structured geometry across repaints',async t=>{
    const r=rig(t);await r.commit();const native=[...r.scene.Resolver.Values.values()].find(v=>v instanceof A.GlyphRun)._GetNative(r.renderer);
    const created=r.recorder.Resources.Statistics.Created;
    for(let i=0;i<100;i++){r.view.InvalidateVisual();await r.commit();r.snapshot();}
    assert.equal(r.recorder.Resources.Statistics.Created,created);assert.equal([...r.scene.Resolver.Values.values()].find(v=>v instanceof A.GlyphRun)._GetNative(r.renderer),native);
});
test('a second run with the same cloned face reuses exactly one immutable font resource',t=>{
    const r=rig(t),second=new A.GlyphRun(r.face,20,'B',r.face.GetGlyphs('B'));
    try{const registry=r.recorder.Resources;registry.Encode(r.glyphs);registry.Encode(second);assert.equal([...registry.Entries.values()].filter(x=>x.Kind==='GlyphTypeface').length,1);}
    finally{second.Dispose();}
});
for(const fault of ['unknown-glyph','invalid-baseline','wrong-font-kind','malformed-path'])test(`malformed ${fault} rejects before replacing committed render state`,async t=>{
    const r=rig(t);await r.commit();const before=r.snapshot(),sequence=r.scene.Sequence;
    r.glyphs.BaselineOrigin=new A.Point(76,100);r.first.IsStroked=true;const batch=structuredClone(r.prepare());
    const g=batch.Value.Resources.Upsert.find(v=>v.Kind==='GlyphRun'),path=batch.Value.Resources.Upsert.find(v=>v.Kind==='Geometry');
    if(fault==='unknown-glyph')g.Data.Glyphs[0][0]=65535;
    if(fault==='invalid-baseline')g.Data.Baseline=[NaN,100];
    if(fault==='wrong-font-kind'){g.Data.Typeface={$ref:path.Id};g.Depends=[path.Id];}
    if(fault==='malformed-path')path.Data.Path.FillData='Mwat';
    await assert.rejects(r.scene.Apply(batch));assert.equal(r.scene.Sequence,sequence);assert.deepEqual(r.snapshot(),before);
});
test('a forged cyclic geometry description fails bounded validation without poisoning native caches',async t=>{
    const r=rig(t);await r.commit();r.first.IsStroked=true;const b=structuredClone(r.prepare()),entry=b.Value.Resources.Upsert.find(x=>x.Kind==='Geometry');
    const data={Kind:'Group',FillRule:'EvenOdd',Transform:null,Children:[]};data.Children.push(data);entry.Data.Path=data;
    await assert.rejects(r.scene.Apply(b));assert.deepEqual(r.at(45,15),[255,255,255,255]);
});
test('removed glyph sources release their server font and run references',async t=>{
    const r=rig(t);await r.commit();const font=[...r.scene.Resolver.Values.values()].find(v=>v instanceof A.GlyphTypeface),run=[...r.scene.Resolver.Values.values()].find(v=>v instanceof A.GlyphRun);
    r.view.Render=()=>{};r.view.InvalidateVisual();await r.commit();assert.equal(font.IsDisposed,true);assert.equal(run.IsDisposed,true);assert.equal([...r.scene.Resources.values()].some(x=>x.Kind==='GlyphRun'||x.Kind==='GlyphTypeface'),false);
});
test('full worker scene replay reconstructs paths and native glyphs without any UI native handles',async t=>{
    const r=rig(t);await r.commit();const before=r.snapshot();r.scene.Dispose();r.scene=new A.ServerCompositionScene(r.renderer);
    // Explicit rehydration uses the serialized snapshot, just as a replacement render worker.
    const acc=new A.CompositionChangeAccumulator();acc.Update(r.recorder.Capture());const b=acc.Prepare(),wire=A.EncodeCompositionBatch(b.Value,b),copy=A.DecodeCompositionBatch(wire.Buffer,wire.ByteLength);
    try{await r.scene.Apply(copy);assert.equal(r.scene.Resources.size,3);const sf=S.SKSurface.Create(new S.SKImageInfo(200,130)),c=new A.SkiaDrawingContext(r.renderer,sf.Canvas);
        try{sf.Canvas.Clear(S.SKColors.White);r.scene.Render(c);const image=sf.Snapshot();try{assert.deepEqual(image.ReadPixels(new S.SKImageInfo(200,130,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul)),before);}finally{image.Dispose();}}
        finally{c.Dispose();sf.Dispose();}
    }finally{r.scene.Dispose();}
});
test('positioned glyph transport renders in an actually independent WASM heap',async t=>{
    const factory=createRequire(import.meta.url)('../vendor/skiasharpweb/dist/vendor/canvaskit.cjs');
    const K=await factory({wasmBinary:readFileSync(new URL('../vendor/skiasharpweb/dist/vendor/canvaskit.wasm',import.meta.url))});
    const separate=await Initialize({fonts:false,CanvasKit:K,isolated:true});assert.notEqual(S.CanvasKit.HEAPU8.buffer,K.HEAPU8.buffer);
    const r=rig(t,separate);await r.commit();assert.deepEqual(r.at(26,90),[0,0,0,255]);assert.deepEqual(r.at(45,30),[255,0,0,255]);
});
