import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';
import { Initialize } from '@wieslawsoltes/skiasharpweb';
import { NamespaceXaml, NamespaceMappings } from './xaml-namespace-fixture.js';
const S = await Initialize({ fonts: false }), platform = new A.SkiaPlatform(S);
test.after(() => platform.Dispose());
class Model extends A.AvaloniaObject {}
A.DefineProperties(Model, { Left: [16, { Convert: Number }], Fill: ['Red'] });
function pixels(draw, scale) {
    const w = Math.ceil(160*scale), h = Math.ceil(80*scale);
    const surface = S.SKSurface.Create(new S.SKImageInfo(w,h)), context = new A.SkiaDrawingContext(platform,surface.Canvas,scale);
    try {
        surface.Canvas.Clear(S.SKColors.White);surface.Canvas.Scale(scale,scale);draw(context);
        const snapshot = surface.Snapshot();
        try { return snapshot.ReadPixels(new S.SKImageInfo(w,h,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul)); }
        finally { snapshot.Dispose(); }
    } finally { context.Dispose();surface.Dispose(); }
}
function compare(actual, expected) {
    assert.equal(actual.length,expected.length);let maximum=0;
    for(let i=0;i<actual.length;i++)maximum=Math.max(maximum,Math.abs(actual[i]-expected[i]));
    assert.ok(maximum<=2,`RGBA error ${maximum}`);
}
for(const aot of [false,true])for(const scale of [1,1.25,1.5,2,3])test(`namespace runtime/AOT ${aot}: attached binding and worker pixels at ${scale}x`,async()=>{
    const view=aot?(await import('./xaml-namespace-aot.js')).Build(new A.AvaloniaXamlServices())
        :new A.AvaloniaXamlCompiler({CompatibleNamespaces:NamespaceMappings}).Compile(NamespaceXaml).Build();
    const model=new Model(),root=new HeadlessTopLevel(new A.Size(320,200));root.Platform=platform;root.RenderScaling=scale;view.DataContext=model;root.Content=view;
    const recorder=new A.CompositionSceneRecorder(root,platform),acc=new A.CompositionChangeAccumulator(),server=new A.ServerCompositionScene(platform);
    try {
        assert.equal(view.Children.Count,2);assert.equal(view.FindControl('Whitespace').Text,'  Namespaces\n  preserved  ');
        for(const changed of [false,true]) {
            if(changed){model.Left=96;model.Fill='Blue';}
            root.Layout();const box=view.FindControl('MovingBox');assert.equal(box.Bounds.X,changed?96:16);assert.equal(box.Bounds.Y,16);
            const expected=pixels(c=>c.DrawRectangle(changed?A.Brushes.Blue:A.Brushes.Red,null,new A.Rect(changed?96:16,16,32,32)),scale);
            compare(pixels(c=>root.RenderTree(c),scale),expected);
            acc.Update(recorder.Capture());const batch=acc.Prepare();assert.ok(batch);
            const encoded=A.EncodeCompositionBatch(batch.Value,batch);await server.Apply(A.DecodeCompositionBatch(encoded.Buffer,encoded.ByteLength));acc.Acknowledge(batch.Sequence,batch.Generation);
            compare(pixels(c=>server.Render(c),scale),expected);
        }
    } finally {server.Dispose();recorder.Dispose();root.Dispose();model.Dispose();}
});
