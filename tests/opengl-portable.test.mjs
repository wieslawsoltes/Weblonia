import test from 'node:test';
import assert from 'node:assert/strict';
import { Event, Size, Rect } from '@wieslawsoltes/avalonia-base';
import { WriteableBitmap } from '@wieslawsoltes/avalonia-media';
import { OpenGlControlBase } from '@wieslawsoltes/avalonia-opengl';
import { CompositionResourceRegistry, PortableDrawingContext } from '@wieslawsoltes/avalonia-rendering';
import { SkiaPlatform, SkiaDrawingContext } from '@wieslawsoltes/avalonia-skia';
import { Initialize } from '../vendor/skiasharpweb/dist/package/node.js';

// Deliberate fake GL for deterministic control/transport ownership tests, not a
// substitute for the real shader/pixel/browser catalog tests.
function fixture(t, worker = true) {
    let reads=0, contexts=0, nativeDisposed=0;
    const parameters={VIEWPORT:[0,0,1,1],SCISSOR_BOX:[0,0,1,1],COLOR_CLEAR_VALUE:[0,0,0,0],COLOR_WRITEMASK:[true,true,true,true],PACK_ALIGNMENT:4};
    const gl=new Proxy({
        getParameter:p=>parameters[p]??null, isEnabled:()=>false,isContextLost:()=>false,getExtension:()=>null,
        readPixels(x,y,w,h,format,type,bytes){reads++;for(let row=0;row<h;row++)for(let col=0;col<w;col++)bytes.set([reads*40,row?160:20,60,255],(row*w+col)*4);}
    },{get:(target,key)=>key in target?target[key]:/^[A-Z_]+$/.test(key)?key:()=>{}});
    class Canvas extends EventTarget {constructor(w=1,h=1){super();this.width=w;this.height=h;}getContext(type){assert.equal(type,'webgl2');contexts++;return gl;}}
    const original=globalThis.OffscreenCanvas;globalThis.OffscreenCanvas=Canvas;
    t.after(()=>{if(original===undefined)delete globalThis.OffscreenCanvas;else globalThis.OffscreenCanvas=original;});
    const root={IsWorkerRoot:worker,RenderScaling:1,RenderError:new Event(),_document:{createElement(name){assert.equal(worker,false,'Semantic worker DOM must not be used for native canvas allocation');assert.equal(name,'canvas');return new Canvas();}}};
    class Demo extends OpenGlControlBase {
        OnOpenGlInit(){this.Inits=(this.Inits??0)+1;}
        OnOpenGlRender(){this.Draws=(this.Draws??0)+1;}
        OnOpenGlDeinit(){assert.ok(this.Context,'Context remains available during deinitialization');this.Deinits=(this.Deinits??0)+1;}
        OnOpenGlLost(){this.Losses=(this.Losses??0)+1;}
    }
    const c=new Demo();c.Arrange(new Rect(0,0,2,2));c.GetVisualRoot=()=>root;
    const resources=new CompositionResourceRegistry({});const dc=new PortableDrawingContext(resources);
    t.after(()=>{c.Dispose();resources.Dispose();dc.Dispose();});
    return {c,root,resources,dc,gl,Canvas,get reads(){return reads;},get contexts(){return contexts;},
        draw(){c.Render(dc);assert.equal(c.InitializationError,null);return resources.Entries.get(dc.Commands.at(-1)[1].$ref);},
        fakeNative(){c._bitmap._native={Dispose(){nativeDisposed++;}};},get nativeDisposed(){return nativeDisposed;}};
}
for(const worker of [false,true])test(`GL ${worker?'worker':'DOM'} owner records RGBA without a Skia API and flips rows once`,t=>{
    const f=fixture(t,worker),entry=f.draw();assert.ok(f.c._bitmap instanceof WriteableBitmap);
    assert.deepEqual([...entry.Data.Pixels.slice(0,4)],[40,160,60,255]);assert.deepEqual([...entry.Data.Pixels.slice(8,12)],[40,20,60,255]);
    assert.equal(f.c.Inits,1);assert.equal(f.c.Draws,1);assert.equal(f.reads,1);assert.equal(f.dc.Api,undefined);
});
test('GL warm captures reuse the bitmap descriptor and never read pixels again',t=>{
    const f=fixture(t),first=f.draw();assert.equal(f.draw(),first);assert.equal(f.reads,1);assert.equal(f.resources.Statistics.ImageBytes,16);
});
test('GL requested frame replaces immutable descriptor bytes without mutating an in-flight snapshot',t=>{
    const f=fixture(t),first=f.draw(),saved=first.Data.Pixels.slice();f.fakeNative();f.c.RequestNextFrameRendering();const next=f.draw();
    assert.equal(first.Id,next.Id);assert.notEqual(first,next);assert.deepEqual(first.Data.Pixels,saved);
    assert.notEqual(first.Data.Pixels[0],next.Data.Pixels[0]);assert.equal(next.Data.Pixels[0],80);assert.equal(f.nativeDisposed,1);
    assert.notEqual(next.Data.Pixels.buffer,f.c._flipped.buffer);
});
test('GL resize releases old bitmap and publishes fresh dimensions',t=>{
    const f=fixture(t);f.draw();const old=f.c._bitmap;f.c.Arrange(new Rect(0,0,3,2));const next=f.draw();
    assert.ok(old.IsDisposed);assert.equal(next.Data.Width,3);assert.equal(next.Data.Pixels.length,24);assert.equal(f.c.Inits,1);
});
test('GL buffer limits fail before native context creation or allocation',t=>{
    const f=fixture(t);f.c.MaxReadbackBytes=4;f.c.Render(f.dc);assert.match(f.c.InitializationError.message,/budget/);assert.equal(f.contexts,0);assert.equal(f.c._pixels,null);
});
test('GL context loss drops cached pixels and restoration reinitializes once',t=>{
    const f=fixture(t);f.draw();const canvas=f.c.Context.Canvas,old=f.c._bitmap;
    canvas.dispatchEvent(new EventGlobal('webglcontextlost',{cancelable:true}));assert.equal(f.c._bitmap,null);assert.ok(old.IsDisposed);assert.equal(f.c.Losses,1);
    canvas.dispatchEvent(new EventGlobal('webglcontextrestored'));f.draw();assert.equal(f.c.Inits,2);assert.equal(f.c.Draws,2);
});
const EventGlobal=globalThis.Event;
test('GL teardown always releases native context and bitmap even when deinit throws',t=>{
    const f=fixture(t);f.draw();const context=f.c.Context,bitmap=f.c._bitmap;
    f.c.OnOpenGlDeinit=()=>{throw new Error('deinit failed');};assert.throws(()=>f.c.Dispose(),/deinit failed/);
    assert.ok(f.c.IsDisposed);assert.ok(context.IsDisposed);assert.ok(bitmap.IsDisposed);assert.equal(f.c.Context,null);assert.equal(f.c._pixels,null);
});
test('GL direct native upload refreshes pixels after a requested frame',async t=>{
    const S=await Initialize({fonts:false,isolated:true}),f=fixture(t,false);
    // The fake OffscreenCanvas is GL-only; disable browser text measurement for this native test.
    const offscreen=globalThis.OffscreenCanvas;delete globalThis.OffscreenCanvas;
    const platform=await SkiaPlatform.Initialize({Api:S});globalThis.OffscreenCanvas=offscreen;
    const surface=S.SKSurface.Create(new S.SKImageInfo(2,2));const context=new SkiaDrawingContext(platform,surface.Canvas);
    const pixels=()=>{const image=surface.Snapshot();try{return image.ReadPixels(new S.SKImageInfo(2,2,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul));}finally{image.Dispose();}};
    try{f.c.Render(context);assert.equal(f.c.InitializationError,null);assert.deepEqual([...pixels().slice(0,4)],[40,160,60,255]);
        f.c.RequestNextFrameRendering();f.c.Render(context);assert.equal(f.c.InitializationError,null);assert.deepEqual([...pixels().slice(0,4)],[80,160,60,255]);
    }finally{context.Dispose();surface.Dispose();f.c.Dispose();platform.Dispose();}
});
