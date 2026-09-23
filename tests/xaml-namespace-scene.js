import { NamespaceXaml, NamespaceMappings } from './xaml-namespace-fixture.js';
/** Namespace-aware construction/binding, using the production realm's framework. */
export async function CreateNamespaceScene(A, root, aot = false) {
    const view = aot ? (await import('./xaml-namespace-aot.js')).Build(new A.AvaloniaXamlServices())
        : new A.AvaloniaXamlCompiler({ CompatibleNamespaces: NamespaceMappings }).Compile(NamespaceXaml).Build();
    class Model extends A.AvaloniaObject {}
    A.DefineProperties(Model, { Left: [16, { Convert: Number }], Fill: ['Red'] });
    const model = new Model(); view.DataContext = model;
    const box = view.FindControl('MovingBox'), label = view.FindControl('Whitespace');
    const previous = root.Content; let frames = 0;
    const rendered = root.Renderer.FrameRendered.Add(() => frames++);
    root.Content = view; await root.RenderNow();
    const state = () => ({ Aot: aot, HasDocument: typeof document !== 'undefined', Frames: frames,
        Children: view.Children.Count, Left: A.Canvas.GetLeft(box), Top: A.Canvas.GetTop(box),
        Text: label.Text, RenderError: root.LastRenderError?.message ?? null });
    return {
        State: state,
        Change: () => A.Dispatcher.UIThread.InvokeAsync(() => {
            const framesBefore = frames; model.Left = 96; model.Fill = 'Blue';
            return { ...state(), FramesBefore: framesBefore };
        }, A.DispatcherPriority.Render),
        Dispose() { rendered.Dispose(); root.Content = previous; view.Dispose(); model.Dispose(); },
    };
}
