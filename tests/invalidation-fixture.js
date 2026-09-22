/** Autonomous invalidation fixture. Mutating commands intentionally never call
 * RenderNow, FlushAsync, snapshots or dispatch synthetic pointer movement. */
export function CreateInvalidationFixture(A, root, handlerUrl) {
    const app=new A.Application();new A.FluentTheme().Install(app);app.RequestedThemeVariant='Light';
    root.Background='#ffffff';root.Foreground='#202020';
    class StableVisual extends A.Control { Render(c){this.Calls=(this.Calls??0)+1;c.DrawRectangle('#243653',null,new A.Rect(0,0,this.Bounds.Width,this.Bounds.Height));} }
    class ReentrantVisual extends A.Control { Render(c){this.Calls=(this.Calls??0)+1;c.DrawRectangle(this.Calls===1?'#ff0000':'#0000ff',null,new A.Rect(this.Bounds.Size));if(this.Calls===1)this.InvalidateVisual();} }
    const stable=new StableVisual();stable.Height=28;const content=new A.ContentControl();content.Height=285;
    const panel=new A.StackPanel();panel.Spacing=12;panel.Children.AddRange([stable,content]);
    const border=new A.Border(panel);border.Padding=new A.Thickness(20);root.Content=border;
    let view,table,progress,transition,clock,previousClock,customVisual;const timers=new Set();
    const rect=c=>{const r=new A.Rect(c.Bounds.Size).TransformToAABB(c.TransformToVisual(root)??A.Matrix.Identity);return{X:r.X,Y:r.Y,Width:r.Width,Height:r.Height};};
    function clear(){customVisual?.Dispose();customVisual=null;for(const t of timers)clearTimeout(t);timers.clear();content.Content=null;view?.Dispose();view=table=progress=transition=null;if(previousClock){A.Clock.GlobalClock=previousClock;previousClock=null;}}
    function mount(kind){clear();
        if(kind==='table'){
            table=view=new A.TableView();table.Height=285;table.AllowAutoHide=false;table.Columns.AddRange([new A.TableViewTextColumn('First','a',160),new A.TableViewTextColumn('Second','b',180)]);
            table.ItemsSource=Array.from({length:60},(_,i)=>({a:'First value '+i,b:'Second value '+i}));
        }else if(kind==='progress'){
            progress=view=new A.ProgressBar();progress.Height=22;progress.VerticalAlignment='Top';progress.IsIndeterminate=true;progress.Foreground='#2469e4';
        }else if(kind==='transition'){
            clock=new A.ManualClock();previousClock=A.Clock.GlobalClock;A.Clock.GlobalClock=clock;
            transition=view=new A.TransitioningContentControl();transition.Height=180;
        }else if(kind==='reentrant')view=new ReentrantVisual();
        else if(kind==='cached-reentrant'){view=new ReentrantVisual();view.CacheMode=new A.BitmapCache();}
        else if(kind==='custom'){
            view=new A.Border();view.Background='#ffffff';content.Content=view;A.ElementComposition.GetElementVisual(view);
            const handler=new A.CompositionCustomVisualHandler();handler.WorkerModule=handlerUrl;
            customVisual=root.Compositor.CreateCustomVisual(handler);customVisual.Size={X:480,Y:180};A.ElementComposition.SetElementChildVisual(view,customVisual);
        }else throw new Error('Unknown invalidation fixture: '+kind);
        content.Content=view;return true;
    }
    function state(){return{Error:root.LastRenderError?.stack??root.Renderer?.LastError?.stack??null,Kind:view?.constructor.name,StableCalls:stable.Calls??0,RenderCalls:view?.Calls??0,ContentRect:rect(content),ViewRect:view?rect(view):null,
        Pending:root._frameId!=null,Dirty:root._dirty,LayoutDirty:root._layoutDirty,ContentRecords:root.Renderer?.Recorder?.Statistics.ContentRecords??null,
        Table:table?{Width:table.Columns.Get(0).ActualWidth,Cells:[...table._realized.values()].map(r=>[...r.CellsPresenter.Children].map(c=>({Id:c.VisualId,X:c.Bounds.X,Width:c.Bounds.Width}))),Header:rect(table.HeadersPresenter)}:null,
        Transition:transition?{Opacity:transition._contentChild?.Opacity??null,Text:transition._contentChild?.Content??null}:null,
        Requests:root._animationFrameRequests?.size??0};}
    mount('table');
    return{Root:root,Commands:{
        Mount:mount,State:state,Resize:value=>{table.Columns.Get(0).Width=new A.GridLength(value);return true;},
        ResizeLater:value=>{const timer=setTimeout(()=>{timers.delete(timer);table.Columns.Get(0).Width=new A.GridLength(value);},60);timers.add(timer);return true;},
        Progress:value=>{progress.IsIndeterminate=value;return true;},Show:value=>{content.IsVisible=value;return true;},
        SetTransition:value=>{const tile=new A.Border();tile.Background=value;transition.Content=tile;return true;},
        Advance:value=>{clock.Advance(value);return true;},
        Force:async()=>{await root.RenderNow();return true;},
        Diagnostics:async()=>root.Renderer?.GetDiagnosticsAsync?await root.Renderer.GetDiagnosticsAsync():{Single:true},
    },Dispose(){clear();root.Compositor?.Dispose();root.Dispose();}};
}
