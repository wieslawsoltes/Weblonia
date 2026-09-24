import { BuildResourceView } from './resource-fixture.js';
export async function CreateResourceScene(A, root, aot = false) {
    const fixture = await BuildResourceView(A,aot), previous=root.Content;
    let frames=0;const subscription=root.Renderer.FrameRendered.Add(()=>frames++);
    root.Content=fixture.View;await root.RenderNow();
    const state=()=>({...fixture.State(),Aot:aot,HasDocument:typeof document!=='undefined',Frames:frames,RenderError:root.LastRenderError?.message??null});
    return {State:state,
        Change:step=>A.Dispatcher.UIThread.InvokeAsync(()=>{const before=frames;fixture.Change(step);return {...state(),FramesBefore:before};},A.DispatcherPriority.Render),
        Dispose(){subscription.Dispose();root.Content=previous;fixture.Dispose();}
    };
}
