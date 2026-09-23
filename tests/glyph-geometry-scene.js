/** Production primitives; caller injects its actual realm's framework namespace. */
export async function CreateGlyphGeometryScene(A, root, fontUrl, aot = false) {
    const response=await fetch(fontUrl);if(!response.ok)throw new Error('Test system font could not be loaded.');
    const face=A.GlyphTypeface.FromData(await response.arrayBuffer());
    const run=new A.GlyphRun(face,32,'█',[new A.GlyphInfo(face.GetGlyph(0x2588),0,35)],new A.Point(16,100));
    class RunExtension{ProvideValue(){return run;}}
    const registry=new A.XamlTypeRegistry().RegisterAssembly(A);registry.RegisterType('RunExtension',RunExtension,'urn:glyph-integration');
    const compiler=new A.AvaloniaXamlCompiler({Registry:registry}),source=`
    <DrawingGroup xmlns="https://github.com/avaloniaui" xmlns:t="urn:glyph-integration">
        <GeometryDrawing Brush="Red">
            <GeometryDrawing.Pen><Pen Brush="Black" Thickness="4"/></GeometryDrawing.Pen>
            <GeometryDrawing.Geometry><PathGeometry><PathFigure StartPoint="16,16">
                <LineSegment Point="76,16" IsStroked="False"/><LineSegment Point="76,60"/>
            </PathFigure></PathGeometry></GeometryDrawing.Geometry>
        </GeometryDrawing>
        <GlyphRunDrawing Foreground="Black" GlyphRun="{t:Run}"/>
    </DrawingGroup>`;
    const compilation=compiler.Compile(source);
    // AOT is imported from a test-server generated ESM endpoint, never evaluated.
    // The separate Node suite checks direct compiler output as an installed module.
    let group;
    if(aot){
        const emitted=await import(new URL('glyph-geometry-aot.js',fontUrl).href);
        group=emitted.Build(new A.AvaloniaXamlServices({Registry:registry}));
    }else group=compilation.Build();
    const geometryDrawing=group.Children.Get(0),glyphDrawing=group.Children.Get(1),path=geometryDrawing.Geometry;
    class SceneControl extends A.Control{Render(c){c.DrawRectangle(A.Brushes.White,null,new A.Rect(0,0,400,240));group.Draw(c);}}
    const view=new SceneControl();const previous=root.Content;let frames=0;
    const changed=group.Invalidated.Add(()=>view.InvalidateVisual()),rendered=root.Renderer.FrameRendered.Add(()=>frames++);
    root.Content=view;await root.RenderNow();
    return {
        State:()=>({Frames:frames,HasDocument:typeof document!=='undefined',Aot:aot,FontFamily:face.FamilyName,
            GlyphCount:run.GlyphInfos.length,IsStroked:path.Figures.Get(0).Segments.Get(0).IsStroked,RenderError:root.LastRenderError?.message??null}),
        Change:()=>A.Dispatcher.UIThread.InvokeAsync(()=>{const before=frames;path.Figures.Get(0).Segments.Get(0).IsStroked=true;
            run.BaselineOrigin=new A.Point(76,100);glyphDrawing.Foreground=A.Brushes.Blue;return{FramesBefore:before};},A.DispatcherPriority.Render),
        Dispose(){changed.Dispose();rendered.Dispose();root.Content=previous;view.Dispose();group.Dispose();
            for(const f of path.Figures){for(const s of f.Segments)s.Dispose();f.Dispose();}path.Dispose();
            geometryDrawing.Pen.Dispose();geometryDrawing.Brush.Dispose();geometryDrawing.Dispose();glyphDrawing.Dispose();run.Dispose();face.Dispose();}
    };
}
