import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';
import { Initialize } from '@wieslawsoltes/skiasharpweb';
import { Build } from './binding-delay-aot.js';
import { BindingDelayXaml, BindingDelayRegistry, BindingDelayModel } from './binding-delay-fixture.js';
const S=await Initialize({fonts:false,isolated:true}),platform=new A.SkiaPlatform(S);
test.after(()=>platform.Dispose());
function pixels(draw,scale){
    const w=240*scale,h=104*scale,surface=S.SKSurface.Create(new S.SKImageInfo(w,h)),dc=new A.SkiaDrawingContext(platform,surface.Canvas,scale);
    try{surface.Canvas.Clear(S.SKColors.White);surface.Canvas.Scale(scale,scale);draw(dc);const image=surface.Snapshot();
        try{return image.ReadPixels(new S.SKImageInfo(w,h,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul));}finally{image.Dispose();}
    }finally{dc.Dispose();surface.Dispose();}
}
function compare(a,b){assert.equal(a.length,b.length);let maximum=0;for(let i=0;i<a.length;i++)maximum=Math.max(maximum,Math.abs(a[i]-b[i]));assert.ok(maximum<=2,`Full RGBA error ${maximum}`);}
for(const aot of [false,true])for(const scale of [1,1.25,1.5,2,3])test(`Delayed ${aot?'AOT':'runtime'} source commits retain and replay native pixels at ${scale}x`,async()=>{
    const model=BindingDelayModel(A),options={Registry:BindingDelayRegistry(A),DataContext:model};
    const view=aot?Build(new A.AvaloniaXamlServices(options)):new A.AvaloniaXamlCompiler(options).Compile(BindingDelayXaml).Build();
    const root=new HeadlessTopLevel(new A.Size(320,220));root.Platform=platform;root.RenderScaling=scale;root.Content=view;
    const recorder=new A.CompositionSceneRecorder(root,platform),acc=new A.CompositionChangeAccumulator(),server=new A.ServerCompositionScene(platform);
    async function verify(changed){
        root.Layout();assert.equal(model.Left1,changed?80:16);assert.equal(model.Left2,changed?144:16);
        const expected=pixels(c=>{c.DrawRectangle(A.Brushes.Red,null,new A.Rect(changed?80:16,16,32,32));c.DrawRectangle(A.Brushes.Blue,null,new A.Rect(changed?144:16,56,32,32));},scale);
        compare(pixels(c=>root.RenderTree(c),scale),expected);
        acc.Update(recorder.Capture());const batch=acc.Prepare();assert.ok(batch);
        const packet=A.EncodeCompositionBatch(batch.Value,batch);await server.Apply(A.DecodeCompositionBatch(packet.Buffer,packet.ByteLength));acc.Acknowledge(batch.Sequence,batch.Generation);
        compare(pixels(c=>server.Render(c),scale),expected);
    }
    try{
        for(const name of ['FirstEditor','SecondEditor']){const editor=view.FindControl(name);editor.SetCurrentValue(A.TextBox.TextProperty,'intermediate');editor.SetCurrentValue(A.TextBox.TextProperty,'final');}
        assert.deepEqual(model.Writes,[0,0]);await verify(false);
        await new Promise(resolve=>setTimeout(resolve,240));A.Dispatcher.UIThread.RunJobs();assert.deepEqual(model.Writes,[1,1]);await verify(true);
        for(const name of ['FirstEditor','SecondEditor'])view.FindControl(name).SetCurrentValue(A.TextBox.TextProperty,'cancelled');
    }finally{server.Dispose();recorder.Dispose();root.Dispose();assert.equal(model.PropertyChanged.Count+model._propertyChanges.observers.length,0);model.Dispose();}
});
