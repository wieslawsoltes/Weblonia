/** Use the owning realm's real framework. The deterministic clock controls only
 * transition time, not invalidation, frame scheduling or native presentation. */
export async function CreateEffectsTransitionScene(A, root, aot = false) {
    const source = `<Canvas xmlns="https://github.com/avaloniaui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Background="White">
        <Border Name="EffectTarget" Canvas.Left="32" Canvas.Top="32" Width="24" Height="24" Background="Red" Effect="{Binding Shadow}">
            <Border.Transitions><EffectTransition Property="Effect" Duration="0:0:0.1"/></Border.Transitions>
        </Border>
    </Canvas>`;
    const view = aot ? (await import('./effects-transition-aot.js')).Build(new A.AvaloniaXamlServices())
        : new A.AvaloniaXamlCompiler().Compile(source).Build();
    class Model extends A.AvaloniaObject {}
    A.DefineProperties(Model, { Shadow: [null] });
    const clock = new A.ManualClock(), model = new Model(), effects = [];
    const shadow = (depth, direction = 0) => {
        const value = new A.DropShadowDirectionEffect({ Direction: direction, ShadowDepth: depth, BlurRadius: 0 });
        effects.push(value); return value;
    };
    model.Shadow = shadow(0); view.Clock = clock; view.DataContext = model;
    const target = view.FindControl('EffectTarget'), transition = target.Transitions.Get(0);
    const previous = root.Content; let frames = 0, destination, scalarTransition;
    const rendered = root.Renderer.FrameRendered.Add(() => frames++);
    root.Content = view; await root.RenderNow();
    const state = () => ({ Aot: aot, HasDocument: typeof document !== 'undefined', Frames: frames,
        Listeners: clock._listeners.size, Active: target.IsAnimating(A.Visual.EffectProperty),
        MutableBaseRestored: target.Effect === destination, OffsetX: target.Effect?.OffsetX ?? null,
        OffsetY: target.Effect?.OffsetY ?? null, Radius: target.Effect?.Radius ?? null,
        RenderError: root.LastRenderError?.message ?? null });
    return {
        State: state,
        Step: command => A.Dispatcher.UIThread.InvokeAsync(() => {
            if (command === 'middle') { model.Shadow = shadow(160); clock.Advance(50); }
            else if (command === 'retarget') { destination = shadow(40); model.Shadow = destination; clock.Advance(50); }
            else if (command === 'complete') clock.Advance(50);
            else if (command === 'mutate') destination.Direction = 90;
            else if (command === 'scalar-middle') {
                scalarTransition = new A.DoubleTransition(A.DropShadowDirectionEffect.ShadowDepthProperty, 100);
                destination.Clock = clock; destination.Transitions = new A.Transitions([scalarTransition]);
                destination.ShadowDepth = 80; clock.Advance(50);
            } else if (command === 'scalar-complete') clock.Advance(50);
            else if (command === 'clear') { model.Shadow = null; clock.Advance(100); }
            else throw new Error('Unknown effect integration command: ' + command);
            return state();
        }, A.DispatcherPriority.Render),
        Dispose() {
            rendered.Dispose(); root.Content = previous; view.Dispose(); model.Dispose();
            for (const effect of effects) effect.Dispose();
            scalarTransition?.Dispose(); transition.Dispose();
        },
    };
}
