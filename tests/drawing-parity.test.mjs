import test from 'node:test';
import assert from 'node:assert/strict';
import { Initialize } from '@wieslawsoltes/skiasharpweb';
import * as A from '@wieslawsoltes/avalonia';
const S=await Initialize({fonts:false});const platform=await A.SkiaPlatform.Initialize({Api:S});
test.after(()=>platform.Dispose());
function drawing(color='#ff0000',rect=new A.Rect(10,20,20,10)) {return new A.GeometryDrawing(A.Brush.Parse(color),null,new A.RectangleGeometry(rect));}
function raster(action,w=80,h=80){const surface=S.SKSurface.Create(new S.SKImageInfo(w,h));const context=new A.SkiaDrawingContext(platform,surface.Canvas);
    try {surface.Canvas.Clear(S.SKColors.White);action(context);const image=surface.Snapshot();try{return image.ReadPixels(new S.SKImageInfo(w,h,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul));}finally{image.Dispose();}}
    finally {context.Dispose();surface.Dispose();}}
const px=(bytes,x,y,w=80)=>[...bytes.slice((y*w+x)*4,(y*w+x+1)*4)];
const equals=(a,b)=>{assert.equal(a.length,b.length);let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));assert.ok(max<=2,`maximum RGBA error ${max}`);return max;};
test('drawing state tokens reject out-of-order disposal without consuming the token',()=>{
    const c=new A.RecordingDrawingContext(),a=c.PushTransform(A.Matrix.CreateTranslation(2,3)),b=c.PushOpacity(.5);
    assert.throws(()=>a.Dispose(),/LIFO/);assert.equal(a.IsDisposed,false);assert.equal(c._stack.length,2);b.Dispose();a.Dispose();a.Dispose();assert.equal(c._stack.length,0);assert.ok(c.Transform.IsIdentity);c.Dispose();
});
test('drawing push failure leaves no logical state and invalid matrices fail before backend mutation',()=>{
    class Broken extends A.DrawingContext{OnPush(){throw new Error('backend');}}
    const c=new Broken();assert.throws(()=>c.PushOpacity(.5),/backend/);assert.equal(c._stack.length,0);c.Dispose();
    const r=new A.RecordingDrawingContext();assert.throws(()=>r.PushTransform(new A.Matrix(NaN)),/finite/);assert.equal(r.Commands.length,0);r.Dispose();assert.throws(()=>r.PushOpacity(.5),/disposed/);
});
test('drawing transform scopes compose and restore in the same order as native matrix operations',()=>{
    raster(c=>{const a=c.PushTransform(A.Matrix.CreateTranslation(5,7)),b=c.PushTransform(A.Matrix.CreateScale(2,3));
        assert.deepEqual(c.Transform.Transform(new A.Point(1,1)),new A.Point(7,10));const m=c.Canvas.TotalMatrix.Values;
        assert.equal(m[0],2);assert.equal(m[4],3);assert.equal(m[2],5);assert.equal(m[5],7);b.Dispose();a.Dispose();});
});
test('native failed geometry-clip and unsupported effect push restore save count and all resource stacks',()=>{
    raster(c=>{const before=c.Canvas.SaveCount;assert.throws(()=>c.PushGeometryClip(new A.StreamGeometry('not a path')),/SVG/);
        assert.equal(c.Canvas.SaveCount,before);assert.equal(c._stack.length,0);assert.equal(c._nativeStates.length,0);
        assert.throws(()=>c.PushEffect({}),/Unsupported/);assert.equal(c.Canvas.SaveCount,before);c.DrawRectangle('#00ff00',null,new A.Rect(0,0,20,20));});
});
test('DrawingGroup restores earlier states when a valid effect fails native allocation',()=>{
    const group=new A.DrawingGroup([drawing()]),effect=new A.BlurEffect(3);group.Effect=effect;
    const acquire=platform.EffectFilters.Acquire;platform.EffectFilters.Acquire=()=>{throw new Error('effect allocation');};
    try{raster(c=>{assert.throws(()=>group.Draw(c),/effect allocation/);assert.equal(c.Canvas.SaveCount,1);assert.equal(c._stack.length,0);assert.equal(c._nativeStates.length,0);});}
    finally{platform.EffectFilters.Acquire=acquire;group.Dispose();effect.Dispose();}
});
test('composition visual restores earlier drawing states when a valid effect fails native allocation',()=>{
    const compositor=new A.Compositor({AutoCommit:false}),visual=compositor.CreateSolidColorVisual(),effect=new A.BlurEffect(3);visual.Effect=effect;compositor.Commit();
    const acquire=platform.EffectFilters.Acquire;platform.EffectFilters.Acquire=()=>{throw new Error('effect allocation');};
    try{raster(c=>{assert.throws(()=>visual.Render(c),/effect allocation/);assert.equal(c.Canvas.SaveCount,1);assert.equal(c._stack.length,0);});}
    finally{platform.EffectFilters.Acquire=acquire;compositor.Dispose();effect.Dispose();}
});
test('native opacity-mask draw failure still restores scope and releases paint state',()=>{
    raster(c=>{const state=c.PushOpacityMask(new A.SolidColorBrush('#ff0000'),new A.Rect(0,0,20,20));const paint=c._Paint;c._Paint=()=>{throw new Error('mask allocation');};
        try{assert.throws(()=>state.Dispose(),/mask allocation/);assert.equal(c.Canvas.SaveCount,1);assert.equal(c._stack.length,0);assert.equal(c._nativeStates.length,0);}finally{c._Paint=paint;}});
});
test('DrawingGroup bounds include pen and transform but not clip/effect inflation',()=>{
    const d=drawing(),pen=new A.Pen('#000000',2);d.Pen=pen;const g=new A.DrawingGroup([d]);g.Transform=new A.TranslateTransform(5,6);g.ClipGeometry=new A.RectangleGeometry(new A.Rect(0,0,1,1));g.Effect=new A.BlurEffect(20);
    assert.deepEqual(g.GetBounds(),new A.Rect(14,25,22,12));assert.deepEqual(g.Bounds,g.GetBounds());g.Dispose();assert.equal(d.IsDisposed,false);assert.equal(pen.IsDisposed,false);d.Dispose();pen.Dispose();
});
test('drawing invalidation propagates nested brush, pen, geometry, transform and stops after disposal',()=>{
    const d=drawing(),p=new A.Pen('#000000',1),g=new A.DrawingGroup([d]),image=new A.DrawingImage(g);d.Pen=p;g.Transform=new A.TranslateTransform();let changes=0;image.Invalidated.Add(()=>changes++);
    for(const action of [()=>d.Brush.Color=A.Color.Parse('#00ff00'),()=>p.Thickness=2,()=>p.Brush.Color=A.Color.Parse('#ff00ff'),()=>d.Geometry.Rect=new A.Rect(0,0,30,30),()=>g.Transform.X=4]){const n=changes;action();assert.ok(changes>n);}
    image.Dispose();const count=changes;g.Opacity=.5;assert.equal(changes,count);g.Dispose();d.Dispose();p.Dispose();
});
test('drawing group batches, sharing, reparented collections and removed child subscriptions remain correct',()=>{
    const d=drawing(),a=new A.DrawingGroup([d,d]),b=new A.DrawingGroup([d]);let ac=0,bc=0;a.Invalidated.Add(()=>ac++);b.Invalidated.Add(()=>bc++);
    const old=a.Children;const batch=a.Children.BeginUpdate();a.Children.RemoveAt(0);a.Children.Add(d);batch.Dispose();ac=bc=0;d.Brush.Color=A.Color.Parse('#123456');assert.equal(ac,1);assert.equal(bc,1);
    a.Children=new A.DrawingCollection();ac=bc=0;d.Brush.Color=A.Color.Parse('#123457');assert.equal(ac,0);assert.equal(bc,1);old.Add(d);assert.equal(ac,0);a.Dispose();b.Dispose();d.Dispose();assert.equal(d.Invalidated.Count,0);
});
test('drawing graph cycles reject atomically including cross-image edges while shared DAGs work',()=>{
    const a=new A.DrawingGroup(),b=new A.DrawingGroup([a]);assert.throws(()=>a.Children.Add(b),/cycle/);assert.equal(a.Children.Count,0);
    const image=new A.DrawingImage(b),d=new A.ImageDrawing(image,new A.Rect(0,0,10,10));assert.throws(()=>a.Children.Add(d),/cycle/);
    const standalone=new A.DrawingImage(),id=new A.ImageDrawing(standalone),g=new A.DrawingGroup([id]);assert.throws(()=>standalone.Drawing=g,/cycle/);assert.equal(standalone.Drawing,null);
    a.Dispose();b.Dispose();image.Dispose();d.Dispose();standalone.Dispose();id.Dispose();g.Dispose();
});
test('DrawingImage source crop and nonzero destination map to the exact device rectangle',()=>{
    const d=drawing(),image=new A.DrawingImage(d);const actual=raster(c=>c.DrawImage(image,new A.Rect(5,2,10,5),new A.Rect(30,40,20,10)));
    const expected=raster(c=>c.DrawRectangle('#ff0000',null,new A.Rect(30,40,20,10)));equals(actual,expected);assert.deepEqual(px(actual,30,40),[255,0,0,255]);assert.deepEqual(px(actual,29,40),[255,255,255,255]);image.Dispose();d.Dispose();
});
test('DrawingImage explicit Viewbox introduces padding and clips content without shifting destination',()=>{
    const d=drawing('#0000ff',new A.Rect(10,10,10,10)),image=new A.DrawingImage(d);image.Viewbox=new A.Rect(0,0,30,30);
    assert.deepEqual(image.Size,new A.Size(30,30));const actual=raster(c=>c.DrawImage(image,new A.Rect(0,0,30,30),new A.Rect(20,20,60,60)));
    const expected=raster(c=>c.DrawRectangle('#0000ff',null,new A.Rect(40,40,20,20)));equals(actual,expected);image.Dispose();d.Dispose();
});
test('DrawingImage empty and null content no-ops without allocating drawing states',()=>{
    const c=new A.RecordingDrawingContext(),image=new A.DrawingImage();c.DrawImage(image,new A.Rect(0,0,20,20));assert.equal(c.Commands.length,0);image.Dispose();c.Dispose();
});
test('DrawingGroup.Open replaces atomically at disposal, automatically balances scopes and aborts without publishing',()=>{
    const old=drawing(),g=new A.DrawingGroup([old]),c=g.Open();const state=c.PushTransform(new A.TranslateTransform(2,3));c.DrawRectangle('#00ff00',null,new A.Rect(0,0,10,10));assert.equal(g.Children.Get(0),old);
    c.Dispose();assert.ok(state.IsDisposed);assert.equal(g.Children.Count,1);assert.notEqual(g.Children.Get(0),old);assert.equal(old.IsDisposed,false);assert.deepEqual(g.GetBounds(),new A.Rect(2,3,10,10));
    const before=g.Children,abort=g.Open();abort.DrawDrawing(old);abort.Abort();assert.equal(g.Children,before);assert.equal(old.IsDisposed,false);g.Dispose();old.Dispose();
});
test('DrawingGroup.Open keeps an existing owned drawing live when it is borrowed into replacement',()=>{
    const g=new A.DrawingGroup(),c=g.Open();c.DrawRectangle('#ff0000',null,new A.Rect(0,0,10,10));c.Dispose();const retained=g.Children.Get(0),d=g.Open();d.DrawDrawing(retained);d.Dispose();assert.equal(retained.IsDisposed,false);assert.equal(g.Children.Get(0),retained);g.Dispose();assert.equal(retained.IsDisposed,true);
});
test('retained rounded rectangles and ellipse/line records produce actual native geometry',()=>{
    const g=new A.DrawingGroup(),c=g.Open();c.DrawRectangle('#ff0000',null,new A.Rect(10,10,30,30),8);c.DrawEllipse('#0000ff',null,new A.Point(55,25),10,5);c.DrawLine(new A.Pen('#00ff00',2),new A.Point(10,55),new A.Point(60,55));c.Dispose();
    const actual=raster(c=>g.Draw(c));assert.deepEqual(px(actual,10,10),[255,255,255,255]);assert.deepEqual(px(actual,25,25),[255,0,0,255]);assert.deepEqual(px(actual,55,25),[0,0,255,255]);assert.equal(px(actual,30,55)[1],255);g.Dispose();
});
test('retained text owns an independent shaping layout and releases it on replacement',()=>{
    const layout=new A.TextLayout('a\u0301 مرحبا',new A.Typeface(),16),g=new A.DrawingGroup(),c=g.Open();c.DrawTextLayout(layout,new A.Point(2,3));c.Dispose();const text=g.Children.Get(0);assert.notEqual(text.Layout,layout);layout.Dispose();
    const commands=new A.RecordingDrawingContext();g.Draw(commands);assert.equal(commands.Commands.find(c=>c.Op==='Text').Text,'a\u0301 مرحبا');assert.equal(text.Layout.IsDisposed,undefined);
    g.Open().Dispose();assert.ok(text.Layout.IsDisposed);g.Dispose();commands.Dispose();
});
test('StreamGeometry mutation and Open completion invalidate drawing owners once and update bounds',()=>{
    const geometry=new A.StreamGeometry('M0 0H10V10H0Z'),d=new A.GeometryDrawing('#ff0000',null,geometry);let count=0;d.Invalidated.Add(()=>count++);
    geometry.Data='M0 0H20V20H0Z';assert.equal(count,1);assert.equal(d.GetBounds().Width,20);const c=geometry.Open();c.BeginFigure(new A.Point(0,0));c.LineTo(new A.Point(30,0));c.LineTo(new A.Point(30,30));c.EndFigure(true);c.Dispose();assert.equal(count,2);assert.equal(d.GetBounds().Width,30);d.Dispose();geometry.Dispose();
});
test('WriteableBitmap Lock is idempotent and invalidates a previously uploaded native image',()=>{
    const bitmap=new A.WriteableBitmap(new A.Size(1,1));let changes=0;bitmap.Changed.Add(()=>changes++);let lock=bitmap.Lock();lock.Address.set([255,0,0,255]);lock.Dispose();lock.Dispose();assert.equal(changes,1);
    let actual=raster(c=>c.DrawImage(bitmap,new A.Rect(0,0,10,10)));assert.deepEqual(px(actual,5,5),[255,0,0,255]);lock=bitmap.Lock();lock.Address.set([0,0,255,255]);lock.Dispose();
    actual=raster(c=>c.DrawImage(bitmap,new A.Rect(0,0,10,10)));assert.deepEqual(px(actual,5,5),[0,0,255,255]);bitmap.Dispose();assert.throws(()=>bitmap.Lock(),/disposed/);
});
test('DrawingImage portable primitives survive binary transport, retain exact native pixels and update without hover',async()=>{
    const d=drawing(),g=new A.DrawingGroup([d]),image=new A.DrawingImage(g),view=new A.Image();view.Source=image;view.Width=40;view.Height=40;
    const root=new A.Border(view);root.ClientSize=new A.Size(80,80);root.RenderScaling=1;root.Measure(root.ClientSize);root.Arrange(new A.Rect(root.ClientSize));
    const recorder=new A.CompositionSceneRecorder(root,platform),acc=new A.CompositionChangeAccumulator(),server=new A.ServerCompositionScene(platform);
    try {
        const update=async()=>{acc.Update(recorder.Capture());const batch=acc.Prepare();assert.ok(batch);const packet=A.EncodeCompositionBatch(batch.Value,batch);await server.Apply(A.DecodeCompositionBatch(packet.Buffer,packet.ByteLength));acc.Acknowledge(batch.Sequence,batch.Generation);};
        await update();equals(raster(c=>root.RenderTree(c)),raster(c=>server.Render(c)));const before=recorder.Statistics.ContentRecords;recorder.Capture();assert.equal(recorder.Statistics.ContentRecords,before);
        const old=server.Nodes;d.Brush.Color=A.Color.Parse('#00ff00');await update();assert.notEqual(server.Nodes,old);const actual=raster(c=>server.Render(c));equals(raster(c=>root.RenderTree(c)),actual);assert.deepEqual(px(actual,40,40),[0,255,0,255]);
        image.Viewbox=new A.Rect(0,0,60,60);root.Measure(root.ClientSize);root.Arrange(new A.Rect(root.ClientSize));await update();equals(raster(c=>root.RenderTree(c)),raster(c=>server.Render(c)));
        root.Dispose();equals(raster(c=>server.Render(c)),raster(c=>server.Render(c)));
    }finally{server.Dispose();recorder.Dispose();root.Dispose();image.Dispose();g.Dispose();d.Dispose();}
});
for(const aot of [false,true])test(`XAML ${aot?'AOT':'runtime'} constructs native drawing graph properties, groups and DrawingImage content`,async()=>{
    const source='<Image xmlns="https://github.com/avaloniaui"><Image.Source><DrawingImage Viewbox="0,0,20,20"><DrawingGroup Opacity="0.5" Transform="translate(2,3)"><GeometryDrawing Brush="Red" Geometry="M0 0H10V10H0Z"/></DrawingGroup></DrawingImage></Image.Source></Image>';
    const compiled=new A.AvaloniaXamlCompiler().Compile(source);const module=aot?await import('data:text/javascript;base64,'+Buffer.from(compiled.JavaScript).toString('base64')):null;
    const view=aot?module.Build(new A.AvaloniaXamlServices()):compiled.Build();assert.ok(view.Source instanceof A.DrawingImage);assert.equal(view.Source.Drawing.Opacity,.5);assert.equal(view.Source.Drawing.Children.Count,1);
    const actual=raster(c=>c.DrawImage(view.Source,new A.Rect(0,0,20,20)));assert.equal(px(actual,7,8)[0],255);assert.ok(px(actual,7,8)[1]>=126 && px(actual,7,8)[1]<=128);view.Source.Drawing.Dispose();view.Source.Dispose();view.Dispose();
});
test('dash-style mutations invalidate borrowed pen drawings without retaining replaced collections',()=>{
    const dash=new A.DashStyle([2,3]),pen=new A.Pen('#000000',1),d=drawing();pen.DashStyle=dash;d.Pen=pen;let changes=0;d.Invalidated.Add(()=>changes++);
    const old=dash.Dashes;dash.Dashes.Add(4);assert.equal(changes,1);dash.Offset=2;assert.equal(changes,2);dash.Dashes=[1,2];assert.equal(changes,3);
    old.Add(5);assert.equal(changes,3);dash.Dashes.Set(0,3);assert.equal(changes,4);d.Dispose();dash.Dashes.Add(6);assert.equal(changes,4);
    assert.equal(A.DashStyle.Dash,A.DashStyle.Dash);assert.equal(A.DashStyle.Dot,A.DashStyle.Dot);const emptyPen=new A.Pen();assert.equal(emptyPen.Brush,null);emptyPen.Dispose();pen.Dispose();dash.Dispose();
});
test('drawing group and image restore all previous scopes even when a later pop fails',()=>{
    class BrokenPop extends A.RecordingDrawingContext{OnPop(kind){super.OnPop(kind);if(kind==='Opacity')throw new Error('pop failed');}}
    const d=drawing(),g=new A.DrawingGroup([d]),image=new A.DrawingImage(g),c=new BrokenPop();g.Transform=new A.TranslateTransform(3,4);
    assert.throws(()=>c.DrawImage(image,new A.Rect(0,0,30,30)),/pop failed/);assert.equal(c._stack.length,0);assert.ok(c.Transform.IsIdentity);c.Dispose();image.Dispose();g.Dispose();d.Dispose();
});
test('StreamGeometry.Open publishes fallback bounds before notification and rejects recording after disposal',()=>{
    A.RegisterGeometryBackend(null);
    const g=new A.StreamGeometry(),ctx=g.Open(),p=new A.Point(10,20);ctx.BeginFigure(p);ctx.LineTo(new A.Point(40,50));p.X=1000;
    let observed;g.PropertyChanged.Add((_,args)=>{if(args.Property===A.StreamGeometry.DataProperty){observed=g.Bounds;ctx.Dispose();}});
    try{ctx.Dispose();assert.deepEqual(observed,new A.Rect(10,20,30,30));assert.equal(g.Data,'M10 20 L40 50');assert.throws(()=>ctx.LineTo(new A.Point()),/disposed/);assert.throws(()=>ctx.EndFigure(),/disposed/);}
    finally{g.Dispose();platform._Install();}
});
test('retained text keeps warm layout identity but reshapes after borrowed foreground changes',()=>{
    const brush=A.Brush.Parse('#ff0000'),layout=new A.TextLayout('cached ink',new A.Typeface(),16,brush),g=new A.DrawingGroup(),open=g.Open();open.DrawTextLayout(layout);open.Dispose();layout.Dispose();
    const text=g.Children.Get(0),initial=text.Layout,dc=new A.RecordingDrawingContext();let invalidated=0;g.Invalidated.Add(()=>invalidated++);
    try{for(let i=0;i<20;i++)g.Draw(dc);assert.equal(text.Layout,initial);brush.Color=A.Color.Parse('#00ff00');assert.ok(invalidated>0);g.Draw(dc);assert.notEqual(text.Layout,initial);assert.ok(initial.IsDisposed);assert.deepEqual(text.Layout.Foreground.Color,A.Color.Parse('#00ff00'));}
    finally{g.Dispose();dc.Dispose();brush.Dispose();}
});
