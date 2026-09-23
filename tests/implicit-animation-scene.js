/** One production scene shared by all execution topologies. XAML binding changes
 * layout; only layout/property setters trigger the animation. No per-frame UI work. */
export async function CreateImplicitAnimationScene(A,root){
    const previous=root.Content;
    class Position extends A.AvaloniaObject {}
    A.DefineProperties(Position,{Left:[16]});
    const model=new Position();
    const view=new A.AvaloniaXamlCompiler().Compile(`<Canvas xmlns="https://github.com/avaloniaui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Background="White">
        <Border x:Name="tile" Width="24" Height="24" Background="Red" Canvas.Left="{Binding Left}" Canvas.Top="16"/>
        <TextBlock Canvas.Left="16" Canvas.Top="112" Text="Implicit layout and grouped composition"/>
    </Canvas>`).Build();
    view.DataContext=model;root.Content=view;await root.RenderNow();
    const tile=view.FindControl('tile'),visual=A.ElementComposition.GetElementVisual(tile),c=visual.Compositor;
    const marker=c.CreateSolidColorVisual(A.Color.Parse('#0000ff'));marker.Size=new A.Vector(24,24);marker.Offset={X:16,Y:64,Z:0};
    A.ElementComposition.SetElementChildVisual(view,marker);
    const offset=c.CreateVector3KeyFrameAnimation();offset.Duration=900;offset.Target='Offset';offset.InsertExpressionKeyFrame(1,'this.FinalValue');
    const opacity=c.CreateScalarKeyFrameAnimation();opacity.Duration=900;opacity.Target='Opacity';opacity.InsertKeyFrame(1,.5);
    const group=c.CreateAnimationGroup();group.Add(offset);group.Add(opacity);
    const layout=c.CreateImplicitAnimationCollection(),grouped=c.CreateImplicitAnimationCollection();layout.Add('Offset',offset);grouped.Add('Offset',group);
    visual.ImplicitAnimations=layout;marker.ImplicitAnimations=grouped;
    let frames=0;const subscription=root.Renderer.FrameRendered.Add(()=>frames++);
    await root.RenderNow();
    const change=(left,disable=false)=>A.Dispatcher.UIThread.InvokeAsync(()=>{
        const before=frames;if(disable){visual.ImplicitAnimations=null;marker.ImplicitAnimations=null;}
        model.Left=left;marker.Offset={X:left,Y:64,Z:0};return {FramesBefore:before,Left:left};
    },A.DispatcherPriority.Render);
    return {
        State:()=>({Frames:frames,DesiredLeft:model.Left,LayoutLeft:A.Canvas.GetLeft(tile),HasDocument:typeof document!=='undefined',RenderError:root.LastRenderError?.message??null}),
        Move:()=>change(216),Retarget:()=>change(80),Clear:()=>change(144,true),
        Unrelated:()=>A.Dispatcher.UIThread.InvokeAsync(()=>{const before=frames;marker.ClipToBounds=!marker.ClipToBounds;return {FramesBefore:before};}),
        Dispose:()=>{subscription.Dispose();A.ElementComposition.SetElementChildVisual(view,null);root.Content=previous;view.Dispose();visual.Dispose();marker.Dispose();layout.Dispose();grouped.Dispose();group.Dispose();offset.Dispose();opacity.Dispose();model.Dispose();}
    };
}
