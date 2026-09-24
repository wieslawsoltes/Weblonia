import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';
import { Initialize } from '@wieslawsoltes/skiasharpweb';
import { Build } from './multibinding-aot.js';
import { MultiBindingXaml, MultiBindingRegistry, MultiBindingModel, ChangeMultiBinding } from './multibinding-fixture.js';
const S = await Initialize({ fonts: false, isolated: true }), platform = new A.SkiaPlatform(S);
test.after(() => platform.Dispose());
function pixels(draw, scale) {
    // Deliberately isolate the geometry viewport. Text strings are asserted below;
    // browser integration separately renders the complete scene using system fonts.
    const w=160*scale,h=64*scale,surface=S.SKSurface.Create(new S.SKImageInfo(w,h)),dc=new A.SkiaDrawingContext(platform,surface.Canvas,scale);
    try { surface.Canvas.Clear(S.SKColors.White);surface.Canvas.Scale(scale,scale);draw(dc);const image=surface.Snapshot();
        try{return image.ReadPixels(new S.SKImageInfo(w,h,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul));}finally{image.Dispose();}
    }finally{dc.Dispose();surface.Dispose();}
}
function compare(a,b) { assert.equal(a.length,b.length);let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));assert.ok(max<=2,`RGBA error ${max}`); }
for(const aot of [false,true])for(const scale of [1,1.25,1.5,2,3])test(`MultiBinding ${aot?'AOT':'runtime'} drives retained and binary-server Skia geometry at ${scale}x`,async()=>{
    const model=MultiBindingModel(A),options={Registry:MultiBindingRegistry(A),DataContext:model};
    const view=aot?Build(new A.AvaloniaXamlServices(options)):new A.AvaloniaXamlCompiler(options).Compile(MultiBindingXaml).Build();
    const root=new HeadlessTopLevel(new A.Size(320,200));root.Platform=platform;root.RenderScaling=scale;root.Content=view;
    const recorder=new A.CompositionSceneRecorder(root,platform),acc=new A.CompositionChangeAccumulator(),server=new A.ServerCompositionScene(platform);
    try{
        for(const changed of [false,true]){
            if(changed)ChangeMultiBinding(model);root.Layout();assert.equal(A.Canvas.GetLeft(view.FindControl('Box')),changed?80:16);
            assert.equal(view.FindControl('Summary').Text,changed?'updated:99.0 / LABEL':'ready:42.5 / LABEL');
            assert.deepEqual(['SingleFormat','ReflectedFormat','NullFormat'].map(name=>view.FindControl(name).Text),changed?['{    99.0}','99,00','[13]']:['{    42.5}','42,50','NULL']);
            const expected=pixels(c=>c.DrawRectangle(changed?A.Brushes.Lime:A.Brushes.Red,null,new A.Rect(changed?80:16,16,32,32)),scale);
            compare(pixels(c=>root.RenderTree(c),scale),expected);
            acc.Update(recorder.Capture());const batch=acc.Prepare();assert.ok(batch);
            const packet=A.EncodeCompositionBatch(batch.Value,batch);await server.Apply(A.DecodeCompositionBatch(packet.Buffer,packet.ByteLength));acc.Acknowledge(batch.Sequence,batch.Generation);
            compare(pixels(c=>server.Render(c),scale),expected);
        }
    }finally{server.Dispose();recorder.Dispose();root.Dispose();assert.equal(model.PropertyChanged.Count + model._propertyChanges.observers.length,0);model.Dispose();}
});
