import test from 'node:test';
import assert from 'node:assert/strict';
import { Size, Rect, Point, Matrix } from '@wieslawsoltes/avalonia-base';
import { Control, Border, TextBlock, StackPanel, TableView, TableViewTextColumn, GridLength, ProgressBar } from '@wieslawsoltes/avalonia-controls';
import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';
import { TopLevel } from '@wieslawsoltes/avalonia-browser';
import { ManualClock, Clock, Animation, KeyFrame, TransitioningContentControl } from '@wieslawsoltes/avalonia-animation';
import { CompositionSceneRecorder, CompositionChangeAccumulator, ServerCompositionScene, EncodeCompositionBatch, DecodeCompositionBatch } from '@wieslawsoltes/avalonia-rendering';

function fixture(content, size = new Size(520, 280)) {
    const root = new HeadlessTopLevel(size); root.Content = content;
    root._RequestAnimationFrame = TopLevel.prototype._RequestAnimationFrame;
    root._ProcessAnimationFrameRequests = TopLevel.prototype._ProcessAnimationFrameRequests;
    const recorder = new CompositionSceneRecorder(root, {}), accumulator = new CompositionChangeAccumulator(), server = new ServerCompositionScene({});
    const capture = () => { root._ProcessAnimationFrameRequests?.(); root.Layout(); return recorder.Capture(); };
    return { root, recorder, accumulator, server, capture,
        async commit() { const snapshot = capture(); accumulator.Update(snapshot); const b = accumulator.Prepare(); if(b) { const p=EncodeCompositionBatch(b.Value,b);await server.Apply(DecodeCompositionBatch(p.Buffer,p.ByteLength));accumulator.Acknowledge(b.Sequence,b.Generation); } return {snapshot,b}; },
        Dispose(){server.Dispose();recorder.Dispose();root.Dispose();}
    };
}
function makeTable() {
    const table = new TableView();table.Columns.AddRange([new TableViewTextColumn('First','a',150),new TableViewTextColumn('Second','b',180)]);
    table.ItemsSource=Array.from({length:80},(_,i)=>({a:'Cell '+i,b:'Data '+i}));return table;
}

test('invalidation: all realized cells and headers follow pixel column resize without hover', async () => {
    const table=makeTable(), f=fixture(table);
    try {
        await f.commit();const rows=[...table._realized.values()];const firstCells=rows.map(r=>r.CellsPresenter.Children.Get(0));
        table.Columns.Get(0).Width=new GridLength(240);await f.commit();
        assert.equal(table.Columns.Get(0).ActualWidth,240);
        for(const row of rows){assert.equal(row.CellsPresenter.Children.Get(0).Bounds.Width,240);assert.equal(row.CellsPresenter.Children.Get(1).Bounds.X,240);}
        assert.equal(table.HeadersPresenter.Children.Get(1).Bounds.X,240);
        assert.deepEqual(rows.map(r=>r.CellsPresenter.Children.Get(0)),firstCells,'resize must retain cell identity');
        for(const cell of firstCells)assert.equal(f.server.Nodes.get(cell.VisualId).Bounds[2],240);
    }finally{f.Dispose();}
});

test('invalidation: one control invalidating itself during recording is redrawn on the next capture',()=>{
    class Painted extends Control { Render(){this.Calls=(this.Calls??0)+1;if(this.Calls===1)this.InvalidateVisual();} }
    const c=new Painted(),f=fixture(new Border(c));try{f.capture();f.capture();assert.equal(c.Calls,2);f.capture();assert.equal(c.Calls,2);}finally{f.Dispose();}
});
test('invalidation: later sibling invalidating an already recorded sibling survives clean-parent reuse',()=>{
    class Painted extends Control { Render(){this.Calls=(this.Calls??0)+1;} }
    const a=new Painted(),b=new Painted(),p=new StackPanel();p.Children.AddRange([a,b]);
    b.Render=function(){this.Calls=(this.Calls??0)+1;if(this.Calls===1)a.InvalidateVisual();};const f=fixture(p);
    try{f.capture();f.capture();assert.equal(a.Calls,2);assert.equal(b.Calls,1);}finally{f.Dispose();}
});
test('invalidation: RenderAfter requests do not mark newer content revisions as already recorded',()=>{
    class Painted extends Control { RenderAfter(){this.Calls=(this.Calls??0)+1;if(this.Calls===1)this.InvalidateVisual();} }
    const c=new Painted(),f=fixture(c);try{f.capture();f.capture();assert.equal(c.Calls,2);}finally{f.Dispose();}
});
test('invalidation: indeterminate progress records changing content without input and stops when disabled',async()=>{
    const c=new ProgressBar();c.IsIndeterminate=true;const f=fixture(c);
    try{const before=(await f.commit()).snapshot.Nodes.get(c.VisualId).Before;await new Promise(r=>setTimeout(r,30));const after=(await f.commit()).snapshot.Nodes.get(c.VisualId).Before;
        assert.notDeepEqual(after,before,'animation must not replay a frozen progress display list');
        c.IsIndeterminate=false;await f.commit();const n=f.recorder.Statistics.ContentRecords;await f.commit();await f.commit();assert.equal(f.recorder.Statistics.ContentRecords,n);
    }finally{f.Dispose();}
});
test('invalidation: transition from transparent content reaches the worker scene without mouse input',async()=>{
    const prior=Clock.GlobalClock,clock=Clock.GlobalClock=new ManualClock(),c=new TransitioningContentControl(),f=fixture(c);
    try{await f.commit();c.Content=new TextBlock('New content');const child=c._contentChild;await f.commit();assert.equal(f.server.Nodes.get(child.VisualId).Opacity,0);
        clock.Advance(100);await f.commit();assert(f.server.Nodes.get(child.VisualId).Opacity>0&&f.server.Nodes.get(child.VisualId).Opacity<1);
        clock.Advance(150);await Promise.resolve();await f.commit();assert.equal(f.server.Nodes.get(child.VisualId).Opacity,1);
    }finally{f.Dispose();Clock.GlobalClock=prior;}
});
test('invalidation: property keyframes generate worker deltas through their final frame',async()=>{
    const clock=new ManualClock(),c=new Border();c.Background='#e03010';const f=fixture(c);const a=new Animation();a.Clock=clock;a.Duration=100;
    a.Children.AddRange([new KeyFrame(0,[{Property:'Opacity',Value:0}]),new KeyFrame(1,[{Property:'Opacity',Value:1}])]);
    try{await f.commit();const task=a.RunAsync(c);await f.commit();clock.Advance(50);await f.commit();assert.equal(f.server.Nodes.get(c.VisualId).Opacity,.5);clock.Advance(60);await task;await f.commit();assert.equal(f.server.Nodes.get(c.VisualId).Opacity,1);}finally{f.Dispose();}
});

test('invalidation: progress resumes after a hidden ancestor is shown without hover',async()=>{
    const p=new ProgressBar();p.IsIndeterminate=true;const holder=new Border(p),f=fixture(holder);
    try{await f.commit();holder.IsVisible=false;await f.commit();assert(!f.root._animationFrameRequests?.size);
        holder.IsVisible=true;await f.commit();assert(f.root._animationFrameRequests?.has(p),'resumed display list must renew animation ownership');
        const before=f.recorder.Statistics.ContentRecords;await f.commit();assert(f.recorder.Statistics.ContentRecords>before);
    }finally{f.Dispose();}
});
test('invalidation: transparent ancestor stops frame requests and showing it resumes progress',async()=>{
    const p=new ProgressBar();p.IsIndeterminate=true;const holder=new Border(p),f=fixture(holder);
    try{await f.commit();holder.Opacity=0;await f.commit();assert(!f.root._animationFrameRequests?.size);holder.Opacity=1;await f.commit();assert(f.root._animationFrameRequests?.has(p));}finally{f.Dispose();}
});
test('invalidation: detached/disposed animation requests do not keep the old root active',async()=>{
    const p=new ProgressBar();p.IsIndeterminate=true;const f=fixture(p);
    try{await f.commit();f.root.Content=null;p.Dispose();f.root._ProcessAnimationFrameRequests();assert(!f.root._animationFrameRequests?.size);}finally{f.Dispose();}
});
test('invalidation: next-frame requests coalesce by owner and preserve unrelated retained drawing',()=>{
    class Painted extends Control{Render(){this.Count=(this.Count??0)+1;}}
    const p=new ProgressBar();p.IsIndeterminate=true;const stable=new Painted(),stack=new StackPanel();stack.Children.AddRange([p,stable]);const f=fixture(stack);
    try{f.capture();const count=stable.Count;for(let i=0;i<100;i++)f.root._RequestAnimationFrame(p);assert.equal(f.root._animationFrameRequests.size,1);f.capture();assert.equal(stable.Count,count);}finally{f.Dispose();}
});
test('invalidation: column resize preserves existing binding subscriptions and recycled content presenters',()=>{
    const table=makeTable(),f=fixture(table);
    try{f.capture();const cells=[...table._realized.values()].flatMap(r=>r.CellsPresenter.Children.ToArray()),texts=cells.map(c=>c._contentChild);let prepare=0;
        for(const c of cells){const original=c.Prepare;c.Prepare=function(...a){prepare++;return original.apply(this,a);};}
        for(const width of [220,180,250,140]){table.Columns.Get(0).Width=new GridLength(width);f.capture();for(const row of table._realized.values())assert.equal(row.CellsPresenter.Children.Get(1).Bounds.X,width);}
        assert.equal(prepare,0);assert.deepEqual(cells.map(c=>c._contentChild),texts);
    }finally{f.Dispose();}
});
test('invalidation: column constraints and star redistribution update cell arrangement in the same pass',()=>{
    const table=makeTable();table.AllowAutoHide=false;table.Columns.Get(1).Width=GridLength.Parse('*');const f=fixture(table);
    try{f.capture();table.Columns.Get(0).MinWidth=230;f.capture();assert.equal(table.Columns.Get(0).ActualWidth,230);
        for(const row of table._realized.values())assert.equal(row.CellsPresenter.Children.Get(1).Bounds.X,230);
        table.Columns.Get(0).MinWidth=0;table.Columns.Get(0).MaxWidth=110;f.capture();assert.equal(table.Columns.Get(0).ActualWidth,110);
        for(const row of table._realized.values())assert.equal(row.CellsPresenter.Children.Get(1).Bounds.X,110);
        assert(f.root.IsArrangeValid);
    }finally{f.Dispose();}
});
test('invalidation: column hiding and showing update both control layout and retained scene membership',async()=>{
    const table=makeTable(),f=fixture(table);
    try{await f.commit();const c=table.Columns.Get(0);c.IsVisible=false;await f.commit();for(const row of table._realized.values())assert.equal(row.CellsPresenter.Children.Count,1);
        c.Width=new GridLength(205);c.IsVisible=true;await f.commit();for(const row of table._realized.values()){assert.equal(row.CellsPresenter.Children.Count,2);assert.equal(row.CellsPresenter.Children.Get(1).Bounds.X,205);}
    }finally{f.Dispose();}
});
test('invalidation: backpressure does not consume a render-time invalidation before the next transaction',async()=>{
    class Painted extends Control{Render(c){this.Count=(this.Count??0)+1;c.DrawRectangle(this.Count===1?'red':'blue',null,new Rect(this.Bounds.Size));if(this.Count===1)this.InvalidateVisual();}}
    const c=new Painted(),f=fixture(c);try{
        f.accumulator.Update(f.capture());const first=f.accumulator.Prepare();f.accumulator.Update(f.capture());assert.equal(f.accumulator.Prepare(),null);
        await f.server.Apply(first);f.accumulator.Acknowledge(first.Sequence,first.Generation);const second=f.accumulator.Prepare();assert(second);await f.server.Apply(second);assert.equal(c.Count,2);assert.equal(f.server.Nodes.get(c.VisualId).Before[0][1],'blue');
    }finally{f.Dispose();}
});
test('invalidation: replacing content during an active transition reaches the latest content and final opacity',async()=>{
    const old=Clock.GlobalClock,clock=Clock.GlobalClock=new ManualClock(),c=new TransitioningContentControl(),f=fixture(c);
    try{await f.commit();c.Content=new TextBlock('First');await f.commit();clock.Advance(70);await f.commit();const first=c._contentChild;
        c.Content=new TextBlock('Second');clock.Advance(60);await f.commit();assert(!f.server.Nodes.has(first.VisualId));clock.Advance(250);await Promise.resolve();await f.commit();assert.equal(f.server.Nodes.get(c._contentChild.VisualId).Opacity,1);assert.equal(c._contentChild.Text,'Second');
    }finally{f.Dispose();Clock.GlobalClock=old;}
});
test('invalidation: animation clock falls back when a worker RAF exists but has no owner window',async t=>{
    const original=globalThis.requestAnimationFrame,cancel=globalThis.cancelAnimationFrame;let ticks=0;
    globalThis.requestAnimationFrame=()=>{throw new DOMException('No owner window','NotSupportedError');};globalThis.cancelAnimationFrame=()=>assert.fail('timer must not be canceled with RAF');
    let subscription;try{await new Promise(resolve=>{subscription=new Clock().Subscribe(()=>{ticks++;subscription.Dispose();resolve();});});const n=ticks;await new Promise(r=>setTimeout(r,30));assert.equal(ticks,n);}finally{subscription?.Dispose();if(original===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=original;if(cancel===undefined)delete globalThis.cancelAnimationFrame;else globalThis.cancelAnimationFrame=cancel;}
});
