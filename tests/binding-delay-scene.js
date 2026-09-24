import { BindingDelayXaml, BindingDelayRegistry, BindingDelayModel } from './binding-delay-fixture.js';
/** Real property-change/dispatcher timers run in the owner UI realm. State RPCs
 * only observe; they never pump frames, finish timers or update the source. */
export async function CreateBindingDelayScene(A,root,aot=false){
    const model=BindingDelayModel(A),options={Registry:BindingDelayRegistry(A),DataContext:model};
    const view=aot?(await import('./binding-delay-aot.js')).Build(new A.AvaloniaXamlServices(options))
        :new A.AvaloniaXamlCompiler(options).Compile(BindingDelayXaml).Build();
    const editors=['FirstEditor','SecondEditor'].map(name=>view.FindControl(name));
    const expressions=editors.map(editor=>A.BindingOperations.GetBindingExpressionBase(editor,A.TextBox.TextProperty));
    const previous=root.Content;let frames=0,disposed=false;
    const rendered=root.Renderer.FrameRendered.Add(()=>frames++);root.Content=view;await root.RenderNow();
    const state=()=>({Aot:aot,HasDocument:typeof document!=='undefined',Frames:frames,Values:[model.First,model.Second],
        Writes:[...model.Writes],Positions:[model.Left1,model.Left2],Pending:expressions.filter(e=>e._delayTimer?.IsEnabled).length,
        Subscriptions:model.PropertyChanged.Count+model._propertyChanges.observers.length,
        RenderError:root.LastRenderError?.message??null});
    const edit=value=>{for(const editor of editors){editor.SetCurrentValue(A.TextBox.TextProperty,'intermediate');editor.SetCurrentValue(A.TextBox.TextProperty,value);}};
    const release=()=>{if(!disposed){disposed=true;rendered.Dispose();root.Content=previous;view.Dispose();}return state();};
    return{
        State:state,
        Queue:()=>A.Dispatcher.UIThread.InvokeAsync(()=>{const before=frames;edit('final');return{...state(),FramesBefore:before};},A.DispatcherPriority.Normal),
        Flush:()=>A.Dispatcher.UIThread.InvokeAsync(()=>{edit('reset');for(const expression of expressions)expression.UpdateSource();return state();},A.DispatcherPriority.Normal),
        ReleasePending:()=>A.Dispatcher.UIThread.InvokeAsync(()=>{edit('cancelled');return release();},A.DispatcherPriority.Normal),
        Dispose(){release();model.Dispose();}
    };
}
