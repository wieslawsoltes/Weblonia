import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';

function provider() {
    let count = 0;
    const lease = A.RegisterTextMetricsProvider({ Measure(text) { ++count; return { Width: text.length * 8, Ascent: text.includes('^') ? 80 : 10, Descent: 3, FontAscent: 12, FontDescent: 4 }; } });
    return { get Count() { return count; }, Dispose() { lease.Dispose(); } };
}
test('font metrics establish stable baselines; combining ink does not move line spacing', () => {
    const p = provider();
    try {
        const l = new A.TextLayout('a\n^\na', new A.Typeface(), 14);
        assert(Math.abs(l.TextLines[0].Baseline - ((19.6 - 16) / 2 + 12)) < 1e-9);
        assert.equal(l.TextLines[1].Baseline, l.TextLines[0].Baseline);
        assert(l.TextLines[1].InkTop < -60);
        const range = l.GetVisibleLineRange(-30, -10);
        assert(range.Start <= 1 && range.End > 1, 'ink above the line box is retained');
    } finally { p.Dispose(); }
});
test('viewport and caret line lookup are logarithmic for a 10000-line document', () => {
    const p = provider();
    try {
        const l = new A.TextLayout(Array.from({length:10000},(_,i)=>'Row '+i).join('\n'));
        const before = A.GetTextLayoutStatistics().LineSearchComparisons;
        const line = l.TextLines[9010];
        const range = l.GetVisibleLineRange(line.Y, line.Y + 120, 2);
        assert(range.Start <= 9010 && range.Start > 9000 && range.End < 9020);
        const hit = l.HitTestPoint(new A.Point(10, line.Y + 4));
        assert(hit.TextPosition >= line.Start && hit.TextPosition < line.Start + line.Length);
        assert(A.GetTextLayoutStatistics().LineSearchComparisons - before < 60);
        const ranges = l.HitTestTextRange(line.Start + 1, 3); assert.equal(ranges.length, 1); assert.equal(ranges[0].Y, line.Y);
    } finally { p.Dispose(); }
});
test('line aggregation handles documents beyond the JavaScript argument-count limit', () => {
    const p = provider();
    try {
        const l = new A.TextLayout('x\n'.repeat(130000));
        assert.equal(l.TextLines.length,130001); assert.equal(l.Width,8);
        assert.equal(l.GetVisibleLineRange(l.Height-20,l.Height).End,130001);
        l.Dispose();
    } finally { p.Dispose(); }
});
test('MaxLines stops shaping invisible paragraphs after one overflow sentinel', () => {
    const p = provider();
    try {
        const l = new A.TextLayout('first\n'+'another\n'.repeat(10000),new A.Typeface(),14,A.Brushes.Black,{MaxLines:1});
        assert.equal(l.TextLines.length,1); assert.equal(l.TextLines[0].Text,'first'); assert(p.Count<=3,`${p.Count} measurements`);
    } finally { p.Dispose(); }
});
test('MaxLines with wrapped overflow still marks and fits the ellipsis', () => {
    const p = provider();
    try {
        const l = new A.TextLayout('word '.repeat(2000),new A.Typeface(),14,A.Brushes.Black,{MaxLines:1,MaxWidth:120,TextWrapping:'Wrap',TextTrimming:'CharacterEllipsis'});
        assert.equal(l.TextLines.length,1); assert(l.TextLines[0].IsCollapsed); assert(l.Width<=120); assert(p.Count<45,`${p.Count} measurements`);
    } finally { p.Dispose(); }
});
test('FormattedText retains a borrowed layout and invalidates on brush/font/width changes', () => {
    const p = provider(), f = new A.FormattedText('hello');
    try {
        const l=f.TextLayout,n=p.Count;
        for(let i=0;i<1000;i++){assert.equal(f.TextLayout,l);void f.Width;void f.Height;}
        assert.equal(p.Count,n);
        f.MaxTextWidth=30;assert.notEqual(f.TextLayout,l);assert(l.IsDisposed);
        f.Foreground=new A.SolidColorBrush(A.Colors.Red);const b=f.TextLayout;
        f.Foreground.Color=A.Colors.Blue;assert.notEqual(f.TextLayout,b);assert(b.IsDisposed);
        const c=f.TextLayout;A.InvalidateTextServices();assert.notEqual(f.TextLayout,c);
        f.Dispose();assert.throws(()=>f.TextLayout,/disposed/);
    } finally { f.Dispose();p.Dispose(); }
});
test('uncacheable rich/feature descriptors still have bounded layout ownership', () => {
    let released=0;
    const lease=A.RegisterTextLayoutProvider({Create(d){return {TextLines:[],Height:0,Dispose(){released++;}};}});
    const c=new A.TextLayoutCache(2);
    try{
        for(let i=0;i<10;i++)c.GetOrCreate('text',new A.Typeface(),14,A.Brushes.Black,{FontFeatures:['kern']});
        assert.equal(c.Count,2);assert.equal(released,8);c.Dispose();assert.equal(released,10);
    }finally{c.Dispose();lease.Dispose();}
});
test('z-order snapshots are reused and invalidate for values, add/remove and public reorder', () => {
    const p=new A.Panel(),a=new A.Button(),b=new A.Button();p.Children.Add(a);p.Children.Add(b);
    const before=p.GetZOrderedChildren();assert.equal(p.GetZOrderedChildren(),before);
    a.ZIndex=5;assert.deepEqual(p.GetZOrderedChildren(),[b,a]);b.ZIndex=5;
    assert.deepEqual(p.GetZOrderedChildren(),[a,b]);p.VisualChildren.reverse();assert.deepEqual(p.GetZOrderedChildren(),[b,a]);
    p.Children.Remove(a);assert.deepEqual(p.GetZOrderedChildren(),[b]);a.Dispose();p.Dispose();
});
test('typeface descriptors are retained and external mutations do not alter control properties',()=>{
    const c=new A.TextBlock('x'),a=c.Typeface;assert.equal(c.Typeface,a);
    a.Weight=999;assert.notEqual(c.Typeface,a);assert.equal(c.Typeface.Weight,c.FontWeight);
    const b=c.Typeface;c.FontFamily='serif';assert.notEqual(c.Typeface,b);c.Dispose();
});
test('scrollbars expose correct automation role/range and automation changes scroll the owner',()=>{
    const c=new A.ScrollViewer();c.Content=new A.Border();c.Content.Height=1000;
    c.Measure(new A.Size(300,200));c.Arrange(new A.Rect(0,0,300,200));
    const b=c.VerticalScrollBar,peer=b.GetOrCreateAutomationPeer();assert(peer instanceof A.ScrollBarAutomationPeer);
    const props=A.GetAutomationAriaProperties(peer);assert.equal(props.role,'scrollbar');assert.equal(props['aria-orientation'],'vertical');
    peer.SetValue(300);assert.equal(c.Offset.Y,300);c.Dispose();assert(peer.IsDisposed);
});
test('wheel mode is sampled before delta values',()=>{
    const calls=[],original={get deltaMode(){calls.push('mode');return 1;},get deltaX(){calls.push('x');return 2;},get deltaY(){calls.push('y');return 3;}};
    const e=new A.PointerWheelEventArgs(A.InputElement.PointerWheelChangedEvent,new A.Control(),new A.Pointer(0,'mouse'),new A.Point(),original);
    assert.equal(calls[0],'mode');const d=e.GetPixelDelta();assert.equal(d.X,32);assert.equal(d.Y,48);
});

test('deep document caret positions segment only the touched line and preserve CRLF ties',()=>{
    const p=provider();
    try{
        const text='a\r\nb\u0301😀\n'.repeat(20000),l=new A.TextLayout(text);
        A.ClearTextBoundaryCache();
        for(let i=1;i<=20;i++){
            const line=l.TextLines[30000+i];
            l.HitTestTextPosition(line.Start+1);
        }
        const stats=A.GetTextBoundaryCacheStatistics();
        assert(stats.EstimatedBytes<10000,JSON.stringify(stats)); assert(stats.Misses<4);
        const small=new A.TextLayout('a\r\nb\u0301😀');
        assert.equal(small.HitTestTextPosition(2).Y,0);
        assert(small.HitTestTextPosition(3).Y>0);
        assert.equal(small.HitTestTextPosition(4).X,0); // within b + combining acute
        assert.equal(small.HitTestTextPosition(6).X,16); // inside surrogate pair snaps before
        l.Dispose();small.Dispose();
    }finally{p.Dispose();}
});
test('FormattedText culture and disposed borrowed layouts invalidate safely',()=>{
    const p=provider(),f=new A.FormattedText('language');
    try{const first=f.TextLayout;f.Culture='tr';const second=f.TextLayout;assert.notEqual(first,second);assert(first.IsDisposed);assert.equal(second.Culture,'tr');
      const cache=new A.TextLayoutCache(1);const a=cache.GetOrCreate('x',new A.Typeface(),14,A.Brushes.Black);a.Dispose();assert.notEqual(cache.GetOrCreate('x',new A.Typeface(),14,A.Brushes.Black),a);cache.Dispose();
    }finally{f.Dispose();p.Dispose();}
});

test('default scalar content updates retain the owned TextBlock presenter',()=>{
    const c=new A.ContentControl('first'),text=c.Presenter;
    c.Content='second';assert.equal(c.Presenter,text);assert.equal(text.Text,'second');assert.equal(text.IsDisposed,false);
    c.Content=123;assert.equal(c.Presenter,text);assert.equal(text.Text,'123');
    const explicit=new A.Border();c.Content=explicit;assert(text.IsDisposed);assert.equal(c.Presenter,explicit);c.Dispose();
});
test('implicit and explicit templates never inherit the default scalar presenter fast path',()=>{
    const c=new A.ContentControl('first'),old=c.Presenter;
    c.DataTemplates.Add(new A.DataTemplate(d=>new A.TextBlock('templated:'+d)));
    c.Content='next';assert(old.IsDisposed);assert.equal(c.Presenter.Text,'templated:next');const next=c.Presenter;
    c.Content='third';assert(next.IsDisposed);assert.equal(c.Presenter.Text,'templated:third');c.Dispose();
});
