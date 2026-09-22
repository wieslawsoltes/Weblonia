import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';
const near = (a, b, tolerance = 1e-7) => assert(Math.abs(a-b) < tolerance, `${a} != ${b}`);
function fixture(control, width = 240, height = 200) { const root = new HeadlessTopLevel(new A.Size(width, height)); root.Content = control; root.Layout(); return root; }
function mouse(root, kind, x, y) {
    const point = new A.Point(x, y);
    if (kind === 'down') { root.MouseDown(point); return; }
    if (kind === 'up') { root.MouseUp(point); return; }
    const pointer = root._pointers.get(1), target = pointer?.Captured ?? root.HitTest(point);
    target?.RaiseEvent(new A.PointerEventArgs(A.InputElement.PointerMovedEvent, target, pointer, point, {buttons:1,button:0,type:'pointermove'}));
}
function center(control, rect = control.GetThumbBounds()) { return control.GetTransformToRoot().Transform(new A.Point(rect.X + rect.Width/2, rect.Y + rect.Height/2)); }
function drag(root, bar, delta, steps = 4) {
    const p = center(bar); mouse(root, 'down', p.X, p.Y);
    for (let i = 1; i <= steps; ++i) mouse(root, 'move', p.X + (bar.Orientation === 'Horizontal' ? delta*i/steps : 0), p.Y + (bar.Orientation === 'Vertical' ? delta*i/steps : 0));
    mouse(root,'up',p.X+(bar.Orientation==='Horizontal'?delta:0),p.Y+(bar.Orientation==='Vertical'?delta:0)); root.Layout();
}
function wheel(root, target, dx, dy, mode = 0, modifiers = 0) {
    const point = target.GetTransformToRoot().Transform(new A.Point(20,20));
    const pointer = new A.Pointer(88, 'Mouse', root);
    const e = new A.PointerWheelEventArgs(A.InputElement.PointerWheelChangedEvent, target, pointer, point, {deltaX:dx,deltaY:dy,deltaMode:mode,shiftKey:!!(modifiers&4)});
    target.RaiseEvent(e); root.Layout(); return e;
}
const big = (w=600,h=1400) => Object.assign(new A.Border(),{Width:w,Height:h});
const viewer = (w=600,h=1400) => Object.assign(new A.ScrollViewer(big(w,h)),{HorizontalScrollBarVisibility:'Auto'});

test('ScrollBar derives from RangeBase rather than inheriting reversed Slider behavior',()=>{
    const bar=new A.ScrollBar(); assert(bar instanceof A.RangeBase); assert(!(bar instanceof A.Slider)); assert.equal(bar.Orientation,'Vertical'); bar.Dispose();
});
for(const orientation of ['Vertical','Horizontal']) test(`ScrollBar ${orientation}: proportional drag without jump and release event`,()=>{
    const bar=Object.assign(new A.ScrollBar(),{Orientation:orientation,Maximum:900,ViewportSize:100,Value:300});
    const root=fixture(bar,orientation==='Horizontal'?300:16,orientation==='Vertical'?300:16);
    const initial=bar.Value,p=center(bar); mouse(root,'down',p.X,p.Y); near(bar.Value,initial);
    const delta=bar.GetTrackGeometry().Travel/3, events=[];bar.Scroll.Add((_,e)=>events.push(e.ScrollEventType));
    mouse(root,'move',p.X+(orientation==='Horizontal'?delta:0),p.Y+(orientation==='Vertical'?delta:0)); near(bar.Value,600);
    mouse(root,'up',p.X,p.Y); assert(events.includes('ThumbTrack')); assert.equal(events.at(-1),'EndScroll'); assert.equal(bar.IsDragging,false); root.Dispose();
});
test('ScrollBar tiny viewport bounds never create oversized thumbs or divide by zero',()=>{
    const bar=Object.assign(new A.ScrollBar(),{Maximum:1000,ViewportSize:1}); const root=fixture(bar,10,7);
    near(bar.GetThumbBounds().Height,7); near(bar.GetTrackGeometry().Travel,0); drag(root,bar,100); assert(Number.isFinite(bar.Value));root.Dispose();
});
test('ScrollBar reverse direction is geometry-consistent and keyboard increments follow its orientation',()=>{
    const bar=Object.assign(new A.ScrollBar(),{Maximum:100,ViewportSize:20,Value:50,IsDirectionReversed:true,Focusable:true,SmallChange:2}); const root=fixture(bar,16,300);
    drag(root,bar,25); assert(bar.Value<50);bar.Focus();const value=bar.Value;root.KeyPress('Down');near(bar.Value,value-2);root.KeyPress('Home');near(bar.Value,0);root.KeyPress('End');near(bar.Value,100);root.Dispose();
});
test('ScrollBar track press pages rather than jumps and releases repeat timers',()=>{
    const bar=Object.assign(new A.ScrollBar(),{Maximum:1000,ViewportSize:100,LargeChange:100});const root=fixture(bar,16,300);
    mouse(root,'down',8,240);near(bar.Value,100);assert(bar._repeatTimer);mouse(root,'up',8,240);assert.equal(bar._repeatTimer,null);root.Dispose();
});
test('ScrollBar page-repeat progresses while held and stops on capture loss',async()=>{
    const bar=Object.assign(new A.ScrollBar(),{Maximum:1000,ViewportSize:100,LargeChange:100,RepeatDelay:10,RepeatInterval:10});const root=fixture(bar,16,300);
    mouse(root,'down',8,250); await new Promise(r=>setTimeout(r,55));assert(bar.Value>=200);root._pointers.get(1).Cancel();const value=bar.Value;
    await new Promise(r=>setTimeout(r,30));near(bar.Value,value);assert.equal(bar._repeatTimer,null);root.Dispose();
});
test('ScrollBar ignores right clicks and additional pointers during a drag',()=>{
    const bar=Object.assign(new A.ScrollBar(),{Maximum:1000,ViewportSize:100});const root=fixture(bar,16,300),p=new A.Pointer(2,'Mouse',root);
    bar.RaiseEvent(new A.PointerPressedEventArgs(A.InputElement.PointerPressedEvent,bar,p,new A.Point(8,200),{button:2,buttons:2}));near(bar.Value,0);assert.equal(p.Captured,null);root.Dispose();
});
test('ScrollBar visibility, zero range and explicit values remain coherent',()=>{
    const bar=new A.ScrollBar();bar.Visibility='Auto';bar.Maximum=0;bar.ViewportSize=100;assert.equal(bar.IsVisible,false);bar.Maximum=30;assert.equal(bar.IsVisible,true);
    bar.Visibility='Hidden';assert.equal(bar.IsVisible,false);bar.Visibility='Visible';assert.equal(bar.IsVisible,true);assert.throws(()=>bar.ViewportSize=-1);rootless(bar);
});
function rootless(c){c.Dispose();}
test('ScrollViewer scrollbar hits win over a child Button occupying the complete content',()=>{
    const button=Object.assign(new A.Button('huge'),{Width:300,Height:2000}),v=new A.ScrollViewer(button),root=fixture(v);let clicks=0;button.Click.Add(()=>clicks++);
    const p=center(v.VerticalScrollBar);assert.equal(root.HitTest(p),v.VerticalScrollBar);drag(root,v.VerticalScrollBar,80);assert(v.Offset.Y>500);assert.equal(clicks,0);assert.equal(button.IsPressed,false);root.Dispose();
});
test('ScrollViewer horizontal and vertical thumbs can independently reach both ends',()=>{
    const v=viewer(),root=fixture(v);drag(root,v.HorizontalScrollBar,2000);near(v.Offset.X,v.ScrollBarMaximum.X);near(v.Offset.Y,0);
    drag(root,v.VerticalScrollBar,2000);near(v.Offset.Y,v.ScrollBarMaximum.Y);drag(root,v.HorizontalScrollBar,-2000);near(v.Offset.X,0);root.Dispose();
});
test('ScrollViewer deferred scrolling previews the thumb without moving content until release',()=>{
    const v=viewer(),root=fixture(v);v.IsDeferredScrollingEnabled=true;root.Layout();const bar=v.VerticalScrollBar,p=center(bar);
    mouse(root,'down',p.X,p.Y);mouse(root,'move',p.X,p.Y+65);assert(bar.Value>0);near(v.Offset.Y,0);root.Layout();assert(bar.Value>0);
    mouse(root,'up',p.X,p.Y+65);assert(v.Offset.Y>0);root.Dispose();
});
test('ScrollViewer Hidden permits scrolling but Disabled does not',()=>{
    const v=viewer(),root=fixture(v);v.VerticalScrollBarVisibility='Hidden';root.Layout();v.ScrollToVerticalOffset(300);root.Layout();near(v.Offset.Y,300);assert.equal(v.VerticalScrollBar.IsVisible,false);
    v.VerticalScrollBarVisibility='Disabled';root.Layout();near(v.Offset.Y,0);root.Dispose();
});
test('non-overlay ScrollViewer tracks reserve space and solve cross-axis overflow',()=>{
    const v=viewer(235,500);v.AllowAutoHide=false;const root=fixture(v,240,200);
    near(v.Viewport.Width,224);near(v.Viewport.Height,184);assert(v.HorizontalScrollBar.IsVisible);assert(v.VerticalScrollBar.IsVisible);
    const p=new A.Point(235,100);assert.equal(root.HitTest(p),v.VerticalScrollBar);root.Dispose();
});
test('ScrollViewer viewport clip prevents content hits and rendering in reserved chrome',()=>{
    const v=viewer(1000,1000);v.AllowAutoHide=false;const root=fixture(v);const child=v.Content;
    assert(v.GetChildClip(child).Equals(new A.Rect(v.Viewport)));const commands=root.RenderFrame();assert(commands.some(c=>c.Op==='Push'&&c.Kind==='Clip'&&c.Value.Equals(v.GetChildClip(child))));root.Dispose();
});
test('ScrollViewer resize and content replacement clamp stale offsets and notify extent deltas',()=>{
    const v=viewer(),root=fixture(v);v.ScrollToEnd();root.Layout();const changes=[];v.ScrollChanged.Add((_,e)=>changes.push(e));v.Content=big(10,10);root.Layout();near(v.Offset.X,0);near(v.Offset.Y,0);
    assert(changes.some(e=>e.ExtentDelta.Height<0&&e.OffsetDelta.Y<0));assert.equal(v.VerticalScrollBar.IsVisible,false);root.Dispose();
});
test('ScrollViewer BringIntoView handles both axes, padding and partially visible large targets',()=>{
    const panel=new A.Canvas(),target=Object.assign(new A.Border(),{Width:40,Height:30});panel.Width=1000;panel.Height=1200;A.Canvas.SetLeft(target,800);A.Canvas.SetTop(target,900);panel.Children.Add(target);
    const v=Object.assign(new A.ScrollViewer(panel),{HorizontalScrollBarVisibility:'Auto',Padding:new A.Thickness(10)}),root=fixture(v);
    assert(v.BringIntoView(target));root.Layout();const bounds=new A.Rect(target.Bounds.Size).TransformToAABB(target.TransformToVisual(v));assert(bounds.Right<=230.01&&bounds.Bottom<=190.01);assert(bounds.Left>=10&&bounds.Top>=10);root.Dispose();
});
for(const mode of [0,1,2]) test(`wheel deltaMode=${mode} respects CSS pixels, lines or viewport pages`,()=>{
    const v=viewer(),root=fixture(v);wheel(root,v,0,2,mode);near(v.Offset.Y,mode===0?2:mode===1?96:400);root.Dispose();
});
test('Shift-wheel scrolls horizontally and disabled chaining consumes boundary input',()=>{
    const v=viewer(),root=fixture(v);wheel(root,v,0,60,0,4);near(v.Offset.X,60);near(v.Offset.Y,0);
    v.ScrollToEnd();root.Layout();v.IsScrollChainingEnabled=false;assert(wheel(root,v,0,200).Handled);root.Dispose();
});
for(const Type of [A.ListBox,A.TreeView]) test(`${Type.name} has an interactive scrollbar without changing selection`,()=>{
    const list=new Type();list.ItemsSource=Array.from({length:10000},(_,i)=>Type===A.TreeView?{Header:`Row ${i}`} : `Row ${i}`);const root=fixture(list);
    list.SelectedIndex=4;drag(root,list.VerticalScrollBar,1000);near(list._offset,10000*list.ItemHeight-list._GetScrollViewport().Height);
    assert.equal(list.SelectedIndex,4);assert(list.ContainerFromIndex(9999));assert(list.GetRealizedContainers().length<16);root.Dispose();
});
test('ListBox recycles row controls rather than allocating new containers on every scroll',()=>{
    class CountingList extends A.ListBox {Created=0; CreateContainerForItemOverride(){this.Created++;return super.CreateContainerForItemOverride();}}
    const list=new CountingList();list.ItemsSource=Array.from({length:10000},(_,i)=>`Row ${i}`);const root=fixture(list);for(let i=0;i<50;i++){list._SetOffset(i*5000);root.Layout();}
    assert(list.Created<25,`Allocated ${list.Created} containers`);assert(list._recyclePool.length<20);root.Dispose();
});
test('ListBox horizontal chrome pans wide items without scrolling or selecting rows',()=>{
    const list=new A.ListBox();list.HorizontalScrollBarVisibility='Auto';list.ItemsSource=['W'.repeat(300),...Array.from({length:100},(_,i)=>`Row ${i}`)];const root=fixture(list);
    assert(list.HorizontalScrollBar.IsVisible);drag(root,list.HorizontalScrollBar,1000);assert(list.HorizontalOffset>500);near(list._offset,0);assert.equal(list.SelectedIndex,-1);root.Dispose();
});
test('TableView both-axis scrollbars exclude headers and preserve header alignment',()=>{
    const table=new A.TableView();table.AutoGenerateColumns=false;table.Columns.Add(new A.TableViewTextColumn('Name','Name'));table.Columns.Get(0).Width=new A.GridLength(800);
    table.ItemsSource=Array.from({length:10000},(_,i)=>({Name:`Row ${i}`}));const root=fixture(table,320,240);
    assert.equal(table.VerticalScrollBar.Bounds.Y,table.HeaderHeight);drag(root,table.HorizontalScrollBar,1000);near(table.HorizontalOffset,480);near(table.HeadersPresenter.Children.Get(0).Bounds.X,-480);
    drag(root,table.VerticalScrollBar,1000);assert(table.ContainerFromIndex(9999));assert.equal(table.SelectedIndex,-1);assert(table.RealizedRowCount<16);root.Dispose();
});
test('multiline TextBox supports vertical drag, wheel, and horizontal pan without changing text or selection',()=>{
    const box=Object.assign(new A.TextBox(),{AcceptsReturn:true,Text:Array.from({length:120},(_,i)=>`${i} ${'W'.repeat(120)}`).join('\n')});const root=fixture(box,320,180);
    const text=box.Text;assert(box.VerticalScrollBar.IsVisible);assert(box.HorizontalScrollBar.IsVisible);drag(root,box.VerticalScrollBar,1000);assert(box.ScrollOffset.Y>1000);
    drag(root,box.HorizontalScrollBar,1000);assert(box.ScrollOffset.X>300);near(box.CaretIndex,0);assert.equal(box.Text,text);wheel(root,box,0,-80);assert(box.ScrollOffset.Y>0);root.Dispose();
});
test('wrapped TextBox disables horizontal chrome and remaps viewport when resizing',()=>{
    const box=Object.assign(new A.TextBox(),{AcceptsReturn:true,TextWrapping:'Wrap',Text:'word '.repeat(500)});const root=fixture(box,320,180);
    assert.equal(box.HorizontalScrollBar.IsVisible,false);assert(box.VerticalScrollBar.IsVisible);drag(root,box.VerticalScrollBar,1000);root.Layout(new A.Size(800,500));assert(box.ScrollOffset.Y<=Math.max(0,box._LayoutText().Height-500+box.Padding.Vertical)+.001);root.Dispose();
});
test('TextBox measurement layouts are retained and disposed with their owner',()=>{
    let created=0,disposed=0;
    const registration=A.RegisterTextLayoutProvider({Create(d){created++;return {TextLines:[{Text:d.Text,Start:0,Length:d.Text.length,Width:100,Y:0,X:0,Height:20,Baseline:15}],Height:20,Dispose(){disposed++;},HitTestTextPosition(){return new A.Rect(0,0,1,20);}};}});
    const box=new A.TextBox('retained');for(let i=0;i<100;i++){box.InvalidateMeasure();box.Measure(new A.Size(300,200));}
    assert(created<=2,`created ${created}`);box.Dispose();assert.equal(disposed,created);registration.Dispose();
});
test('scroll chrome still works with runtime XAML attached scrollbar options',()=>{
    const v=A.AvaloniaXamlLoader.Parse('<ScrollViewer xmlns="https://github.com/avaloniaui" HorizontalScrollBarVisibility="Auto" AllowAutoHide="False"><Border Width="800" Height="1200"/></ScrollViewer>');
    const root=fixture(v);assert(v.HorizontalScrollBar.IsVisible);drag(root,v.VerticalScrollBar,1000);assert(v.Offset.Y>900);root.Dispose();
});
test('reserved horizontal chrome does not oscillate realization at an item-height boundary',()=>{
    const c=Object.assign(new A.ListBox(),{Width:420,Height:280,AllowAutoHide:false,HorizontalScrollBarVisibility:'Auto'});
    c.ItemsSource=Array.from({length:100},(_,i)=>`${i} ${'long '.repeat(100)}`);
    const canvas=new A.Canvas();canvas.Children.Add(c);const root=fixture(canvas,600,500);
    assert(root.IsMeasureValid);assert(c.HorizontalScrollBar.IsVisible);
    const rows=c.GetRealizedContainers().length;root.Layout();assert.equal(c.GetRealizedContainers().length,rows);root.Dispose();
});
test('TableView header and reserved horizontal track share a stable realization viewport',()=>{
    const c=Object.assign(new A.TableView(),{Width:420,Height:280,AllowAutoHide:false,HorizontalScrollBarVisibility:'Auto'});
    c.Columns.Add(new A.TableViewColumn('Id','Id',200));c.Columns.Add(new A.TableViewColumn('Name','Name',700));
    c.ItemsSource=Array.from({length:10000},(_,i)=>({Id:i,Name:'row '+i}));const canvas=new A.Canvas();canvas.Children.Add(c);const root=fixture(canvas,600,500);
    assert(root.IsMeasureValid);c._SetOffset(5999*c.ItemHeight+.7);root.Layout();assert(root.IsMeasureValid);assert(c.GetRealizedContainers().length<20);root.Dispose();
});

test('ScrollBarMaximum and LargeChange notify bindings for extent-only and viewport-only changes',()=>{
    const c=new A.ScrollViewer();c.Content=Object.assign(new A.Border(),{Height:1000});const root=fixture(c,300,200);
    const maxima=[],pages=[];const a=c.GetObservable(A.ScrollViewer.ScrollBarMaximumProperty).subscribe(v=>maxima.push(v.Y));
    const b=c.GetObservable(A.ScrollViewer.LargeChangeProperty).subscribe(v=>pages.push(v.Y));
    c.Content.Height=2000;root.Layout();assert.equal(maxima.at(-1),1800);
    root.Layout(new A.Size(300,300));assert.equal(maxima.at(-1),1700);assert.equal(pages.at(-1),300);
    a.unsubscribe();b.unsubscribe();root.Dispose();
});

test('RangeBase matches the templated hierarchy and retains finite values on invalid assignments',()=>{
    const range=new A.RangeBase();assert(range instanceof A.TemplatedControl);
    range.Minimum=10;range.Maximum=90;range.Value=45;
    for(const value of [NaN,Infinity,-Infinity]){range.Minimum=value;range.Maximum=value;range.Value=value;assert.equal(range.Minimum,10);assert.equal(range.Maximum,90);assert.equal(range.Value,45);}
    range.Minimum=100;assert.equal(range.Maximum,100);assert.equal(range.Value,100);
    range.Maximum=200;range.Value=175;range.Maximum=120;assert.equal(range.Value,120);range.Maximum=200;assert.equal(range.Value,175,'coercion must not overwrite the bound/local base value');range.Dispose();
});
test('RangeBase raises typed ValueChanged events and ScrollBar custom templates have layout and lifetime',()=>{
    const bar=new A.ScrollBar(),events=[];bar.ValueChanged.Add((_,e)=>events.push(e));bar.Value=20;
    assert(events[0] instanceof A.RangeBaseValueChangedEventArgs);assert.equal(events[0].NewValue,20);
    let child;bar.Template=new A.ControlTemplate(()=>child=Object.assign(new A.Border(),{Width:28,Height:150}));const root=fixture(bar,28,200);
    assert.equal(child.Bounds.Height,150);assert.equal(child.TemplatedParent,bar);
    bar.Template=null;root.Layout();assert(child.IsDisposed);root.Dispose();
});

test('disjoint virtual scrolling retargets attached scalar presenters without tree churn',()=>{
    const c=new A.ListBox();c.ItemsSource=Array.from({length:10000},(_,i)=>'Row '+i);const root=fixture(c,400,240);
    c._SetOffset(1000*c.ItemHeight);root.Layout();const rows=c.GetRealizedContainers(),presenters=new Set(rows.map(r=>r.Presenter));
    let detach=0,attach=0;for(const r of rows){r.DetachedFromVisualTree.Add(()=>detach++);r.AttachedToVisualTree.Add(()=>attach++);}
    for(let j=0;j<10;j++){c._SetOffset((2000+j*100)*c.ItemHeight);root.Layout();for(const r of c.GetRealizedContainers()){assert(presenters.has(r.Presenter));assert.equal(r.Presenter.Text,'Row '+r.ItemIndex);assert.equal(r.DataContext,'Row '+r.ItemIndex);}}
    assert.equal(detach,0);assert.equal(attach,0);root.Dispose();
});
test('surplus recycled scalar rows release prior item data and their empty presenter is owned',()=>{
    const c=new A.ListBox();c.ItemsSource=Array.from({length:100},(_,i)=>'private-'+i);const root=fixture(c,400,300);
    root.Layout(new A.Size(400,100));assert(c._recyclePool.length>0);
    const pooled=c._recyclePool.slice();for(const r of pooled){assert.equal(r.DataContext,null);assert.equal(r.ItemIndex,-1);assert.equal(r.Content,'');assert.equal(r.Presenter.Text,'');}
    root.Dispose();assert(pooled.every(r=>r.IsDisposed));
});
