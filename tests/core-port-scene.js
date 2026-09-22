/** Test scene uses the production controls/XAML/dispatcher/renderer in each realm.
 * Dependency injection here selects the realm's real module graph, not mocks. */
export async function CreateCorePortScene(A, root) {
    const previous = root.Content, captures = [];
    class ProbeExtension {
        ProvideValue(provider) {
            const target=provider.GetService(A.IProvideValueTarget),uri=provider.GetService(A.IUriContext);
            captures.push({Property:target.TargetProperty.Name,Type:target.TargetObject.constructor.name,BaseUri:uri.BaseUri});
            return 'Core / XAML / composition';
        }
    }
    const registry=new A.XamlTypeRegistry().RegisterAssembly(A);registry.RegisterType('ProbeExtension',ProbeExtension,'urn:core-test');
    const view=new A.AvaloniaXamlCompiler({Registry:registry,BaseUri:'https://example.test/core.axaml'}).Compile(`
        <Canvas xmlns="https://github.com/avaloniaui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:t="urn:core-test" Background="White">
            <Image x:Name="drawing" Width="64" Height="64" Canvas.Left="16" Canvas.Top="16" Stretch="Fill">
                <Image.Source><DrawingImage><DrawingGroup><GeometryDrawing Brush="#ff0000"><RectangleGeometry Rect="0,0,64,64"/></GeometryDrawing></DrawingGroup></DrawingImage></Image.Source>
            </Image>
            <TextBlock Canvas.Left="16" Canvas.Top="120" Text="{t:Probe}"/>
        </Canvas>`).Build();
    root.Content=view;
    const image=view.FindControl('drawing'),source=image.Source,group=source.Drawing,drawing=group.Children.Get(0),brush=drawing.Brush,geometry=drawing.Geometry;
    const compositor=A.ElementComposition.GetElementVisual(view).Compositor,values=compositor.CreatePropertySet(),visual=compositor.CreateSolidColorVisual();
    visual.Size=new A.Vector(64,64);visual.Offset={X:0,Y:16,Z:0};visual.Color=A.Color.Parse('#0000ff');
    values.InsertBoolean('Enabled',true);values.InsertVector4('Components',{X:0,Y:0,Z:0,W:.5});values.InsertMatrix3x2('Placement',A.Matrix.CreateTranslation(120,0));
    const opacity=compositor.CreateExpressionAnimation('config.Enabled ? config.Components.W : 0.25'),offset=compositor.CreateExpressionAnimation('config.Placement.M31');
    opacity.Target='Opacity';offset.Target='Offset.X';opacity.SetReferenceParameter('config',values);offset.SetReferenceParameter('config',values);
    const animations=compositor.CreateAnimationGroup();animations.Add(opacity);animations.Add(offset);visual.StartAnimationGroup(animations);A.ElementComposition.SetElementChildVisual(view,visual);
    let frames=0;const subscription=root.Renderer.FrameRendered.Add(()=>frames++);
    const jobs=[],inactive=A.Dispatcher.UIThread.InvokeAsync(()=>jobs.push('inactive'),A.DispatcherPriority.Inactive);
    inactive.Abort();await inactive.catch(()=>{});
    const task=A.Dispatcher.UIThread.InvokeAsync(()=>{jobs.push('normal');return 17;},A.DispatcherPriority.Normal);
    const value=await task;
    await root.RenderNow();
    return {
        State:()=>({Frames:frames,Services:captures,Dispatcher:{Value:value,Status:task.Status,Aborted:inactive.Status,Jobs:jobs},
            GroupCount:group.Children.Count,HasDocument:typeof document!=='undefined',RenderError:root.LastRenderError?.message??null}),
        Change:async()=>{const before=frames;await A.Dispatcher.UIThread.InvokeAsync(()=>{brush.Color=A.Color.Parse('#00ff00');values.InsertBoolean('Enabled',false);},A.DispatcherPriority.Render);return{FramesBefore:before};},
        Dispose:()=>{subscription.Dispose();A.ElementComposition.SetElementChildVisual(view,null);root.Content=previous;view.Dispose();source.Dispose();group.Dispose();drawing.Dispose();geometry.Dispose();brush.Dispose();animations.Dispose();opacity.Dispose();offset.Dispose();visual.Dispose();values.Dispose();}
    };
}
