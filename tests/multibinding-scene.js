import { MultiBindingXaml, MultiBindingRegistry, MultiBindingModel, ChangeMultiBinding } from './multibinding-fixture.js';
/** Real framework instances, dispatched updates and retained bindings in each UI realm. */
export async function CreateMultiBindingScene(A, root, aot = false) {
    const model = MultiBindingModel(A), options = { Registry: MultiBindingRegistry(A), DataContext: model };
    const view = aot ? (await import('./multibinding-aot.js')).Build(new A.AvaloniaXamlServices(options))
        : new A.AvaloniaXamlCompiler(options).Compile(MultiBindingXaml).Build();
    const box = view.FindControl('Box'), label = view.FindControl('Summary'), previous = root.Content;
    let frames = 0, disposed = false;
    const rendered = root.Renderer.FrameRendered.Add(() => frames++);
    root.Content = view; await root.RenderNow();
    const state = () => ({ Aot: aot, HasDocument: typeof document !== 'undefined', Frames: frames,
        SingleFormatting: [view.FindControl('SingleFormat').Text, view.FindControl('ReflectedFormat').Text, view.FindControl('NullFormat').Text],
        Left: A.Canvas.GetLeft(box), Text: label.Text, Subscriptions: model.PropertyChanged.Count + model._propertyChanges.observers.length,
        RenderError: root.LastRenderError?.message ?? null });
    return {
        State: state,
        Change: () => A.Dispatcher.UIThread.InvokeAsync(() => { const before = frames; ChangeMultiBinding(model); return { ...state(), FramesBefore: before }; }, A.DispatcherPriority.Render),
        Release() {
            if (!disposed) { disposed = true; rendered.Dispose(); root.Content = previous; view.Dispose(); }
            const remaining = model.PropertyChanged.Count + model._propertyChanges.observers.length; model.Dispose(); return { RemainingSubscriptions: remaining };
        },
        Dispose() { this.Release(); },
    };
}
