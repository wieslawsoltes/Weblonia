import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { Initialize } from '../vendor/skiasharpweb/dist/package/node.js';
const S=await Initialize({fonts:false}),platform=await A.SkiaPlatform.Initialize({Api:S});
test.after(()=>platform.Dispose());
const p=(x,y)=>new A.Point(x,y);
function path(t){const g=new A.PathGeometry(),f=new A.PathFigure(p(10,10),[new A.LineSegment(p(60,10)),new A.LineSegment(p(60,60))],true);g.Figures.Add(f);
    t.after(()=>{g.Dispose();for(const s of f.Segments)s.Dispose();f.Dispose();});return {g,f};}
function at(action){const surface=S.SKSurface.Create(new S.SKImageInfo(100,100)),c=new A.SkiaDrawingContext(platform,surface.Canvas);
    try{surface.Canvas.Clear(S.SKColors.White);action(c);const image=surface.Snapshot();try{const data=image.ReadPixels(new S.SKImageInfo(100,100,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul));return (x,y)=>[...data.slice((y*100+x)*4,(y*100+x)*4+4)];}finally{image.Dispose();}}
    finally{c.Dispose();surface.Dispose();}}
const white=[255,255,255,255],red=[255,0,0,255],black=[0,0,0,255];

test('PathGeometry is a StreamGeometry with upstream figure and segment defaults',t=>{
    const {g,f}=path(t);assert.ok(g instanceof A.StreamGeometry);assert.ok(f.Segments.Get(0) instanceof A.PathSegment);
    const fresh=new A.PathFigure();try{assert.equal(fresh.IsFilled,true);assert.equal(fresh.IsClosed,true);assert.equal(f.Segments.Get(0).IsStroked,true);}finally{fresh.Dispose();}
});
test('unfilled figures contribute stroke but never fill, including geometry hit testing',t=>{
    const {g,f}=path(t);f.IsFilled=false;const pen=new A.Pen(A.Brushes.Black,4);
    try{const pixel=at(c=>c.DrawGeometry(A.Brushes.Red,pen,g));assert.deepEqual(pixel(45,25),white);assert.deepEqual(pixel(40,10),black);assert.equal(g.FillContains(p(45,25)),false);assert.equal(g.StrokeContains(pen,p(40,10)),true);}
    finally{pen.Dispose();}
});
test('non-stroked segments still fill and closed broken contours return to original start',t=>{
    const {g,f}=path(t);f.Segments.Get(0).IsStroked=false;const pen=new A.Pen(A.Brushes.Black,4);
    try{const pixel=at(c=>c.DrawGeometry(A.Brushes.Red,pen,g));assert.deepEqual(pixel(40,9),white);assert.deepEqual(pixel(45,25),red);assert.deepEqual(pixel(61,35),black);assert.deepEqual(pixel(35,35),black);
        assert.equal(g.FillContains(p(45,25)),true);assert.equal(g.StrokeContains(pen,p(40,9)),false);assert.match(g.StrokeData,/L10 10$/);
    }finally{pen.Dispose();}
});
test('StreamGeometry writer retains independent fill/stroke flags and rejects a concurrent writer',()=>{
    const g=new A.StreamGeometry();const c=g.Open();assert.throws(()=>g.Open(),/open writer/);c.BeginFigure(p(10,10));c.LineTo(p(60,10),false);c.LineTo(p(60,60));c.EndFigure(true);c.Dispose();
    try{assert.equal(g.FillData,'M10 10 L60 10 L60 60 Z');assert.equal(g.StrokeData,'M10 10 M60 10 L60 60 L10 10');assert.equal(g.FillContains(p(45,25)),true);}
    finally{g.Dispose();}
});
test('StreamGeometry writer abort preserves old path, rule and cache descriptor',()=>{
    const g=A.StreamGeometry.Parse('M0 0L10 0L0 10Z'),before=g.GetPathDescription(),c=g.Open();c.SetFillRule('NonZero');c.BeginFigure(p(80,80));c.LineTo(p(90,90));c.Abort();
    try{assert.equal(g.GetPathDescription(),before);assert.equal(g.FillRule,'EvenOdd');const next=g.Open();next.Abort();assert.throws(()=>c.LineTo(p(0,0)),/disposed/);}finally{g.Dispose();}
});
test('stream writer publishes path and fill rule as one observable geometry revision',()=>{
    const g=new A.StreamGeometry();let events=0;g.Changed.Add(()=>{events++;assert.equal(g.FillRule,'NonZero');assert.match(g.Data,/L/);});
    const c=g.Open();c.SetFillRule('NonZero');c.BeginFigure(p(0,0));c.LineTo(p(10,10));c.Dispose();assert.equal(events,1);g.Dispose();
});
test('path geometry writer builds real figures and segment objects with transactional abort',()=>{
    const g=A.PathGeometry.Parse('M1 2L10 20Z'),old=g.Figures,c=g.Open();c.BeginFigure(p(30,30),false);c.QuadraticBezierTo(p(40,0),p(50,30),false);c.EndFigure(false);c.Abort();assert.equal(g.Figures,old);
    const d=g.Open();d.BeginFigure(p(20,20),false);d.CubicBezierTo(p(20,40),p(40,20),p(40,40));d.EndFigure(false);d.Dispose();
    try{assert.ok(g.Figures.Get(0).Segments.Get(0) instanceof A.BezierSegment);assert.equal(g.Figures.Get(0).IsFilled,false);assert.equal(g.Figures.Get(0).IsClosed,false);assert.equal(old.Get(0).IsDisposed,true);}
    finally{g.Dispose();}
});
for(const [source,expected] of [
    ['m10 20 5 5 h10 v-5 z','M10 20 L15 25 L25 25 L25 20 Z'],
    ['M0 0C1 2 3 4 5 6s2 3 4 5','M0 0 C1 2 3 4 5 6 C7 8 7 9 9 11'],
    ['M0 0Q10 20 30 0t30 0','M0 0 Q10 20 30 0 Q50 -20 60 0'],
    ['M.1 -.2 L1e1 +2.5e+1','M0.1 -0.2 L10 25'],
    ['F1 M10 20 A30 40 45 0110 60','M10 20 A30 40 45 0 1 10 60'],
    ['M1 2L3 4Z m10 10l2 2','M1 2 L3 4 Z M11 12 L13 14']]){
    test(`path markup normalizes complete command stream: ${source}`,()=>{
        for(const T of [A.StreamGeometry,A.PathGeometry]){const g=T.Parse(source);try{assert.equal(g.Data,expected);assert.equal(g.FillRule,source.startsWith('F1')?'NonZero':'EvenOdd');}finally{g.Dispose();}}
    });
}
for(const source of ['L10 20','M0','M0 0L','M0 0 X1 2','M0 0L1e999 2','M0 0,','M0 0,,1 2','M0 0A1 2 3 2 0 5 6','M0 0A-1 2 3 0 0 5 6','Z','M0 0Z Z'])
    test(`path parser rejects malformed or ambiguous input: ${source}`,()=>{assert.throws(()=>A.PathGeometry.Parse(source));assert.throws(()=>A.StreamGeometry.Parse(source));});
test('nested geometry changes propagate once and unchanged signatures do not recompile paths',t=>{
    const {g,f}=path(t),group=new A.GeometryGroup([g]);let events=0;group.Changed.Add(()=>events++);const first=group.GetPathDescription();
    for(let i=0;i<1000;i++){assert.equal(group.GetPathDescription(),first);platform.GetPath(group);}
    f.Segments.Get(0).Point=p(80,10);assert.equal(events,1);assert.notEqual(group.GetPathDescription(),first);assert.equal(first.Children[0].Data.includes('80'),false);
    group.Children.Clear();events=0;f.Segments.Get(0).Point=p(90,10);assert.equal(events,0);group.Dispose();assert.equal(g.IsDisposed,false);
});
test('path collections enforce typed mutations and reject geometry DAG cycles before mutation',()=>{
    const child=new A.RectangleGeometry(new A.Rect(0,0,10,10)),a=new A.GeometryGroup([child]),b=new A.GeometryGroup([child,a]);
    try{assert.throws(()=>a.Children.Add(b),/cycle/);assert.equal(a.Children.Count,1);assert.throws(()=>a.Children.Add({}),/Geometry/);
        const snapshot=a.Children.Item;snapshot.push(child);assert.equal(a.Children.Count,1);
        const combined=new A.CombinedGeometry('Union',a,child);try{assert.throws(()=>a.Children.Add(combined),/cycle/);assert.throws(()=>combined.Geometry1=combined,/cycle/);}finally{combined.Dispose();}
    }finally{a.Dispose();b.Dispose();assert.equal(child.IsDisposed,false);child.Dispose();}
});
test('group and child affine transforms participate in native fill/hit/bounds rather than concatenated SVG text',()=>{
    const rect=new A.RectangleGeometry(new A.Rect(0,0,20,10));rect.Transform=new A.TranslateTransform(10,10);const group=new A.GeometryGroup([rect]);group.Transform=new A.ScaleTransform(2,2);
    try{assert.deepEqual(group.Bounds,new A.Rect(20,20,40,20));assert.equal(group.FillContains(p(30,30)),true);assert.equal(group.FillContains(p(5,5)),false);
        rect.Transform.X=20;assert.deepEqual(group.Bounds,new A.Rect(40,20,40,20));assert.deepEqual(at(c=>c.DrawGeometry(A.Brushes.Red,null,group))(50,30),red);
    }finally{group.Dispose();rect.Transform.Dispose();rect.Dispose();}
});
test('geometry Boolean operations retain nested transforms and do not borrow an evicted native input',()=>{
    const tiny=new A.SkiaPlatform(S,{PathCacheEntries:1}),a=new A.RectangleGeometry(new A.Rect(0,0,20,20)),b=new A.RectangleGeometry(new A.Rect(0,0,20,20));b.Transform=new A.TranslateTransform(10,0);
    const combined=A.Geometry.Combine(a,b,'Intersect');try{assert.deepEqual(combined.Bounds,new A.Rect(10,0,10,20));assert.equal(combined.FillContains(p(15,10)),true);assert.equal(combined.FillContains(p(5,10)),false);assert.ok(combined.Data.length>0);}
    finally{combined.Dispose();b.Transform.Dispose();b.Dispose();a.Dispose();tiny.Dispose();}
});
test('geometry backend leases restore prior native provider after a temporary platform is disposed',()=>{
    const temp=new A.SkiaPlatform(S),g=new A.RectangleGeometry(new A.Rect(0,0,5,5));temp.Dispose();try{assert.equal(g.FillContains(p(2,2)),true);}finally{g.Dispose();}
});
test('native stroked geometry bounds, cap, dash hit testing and widening use actual path outline',()=>{
    const g=new A.LineGeometry(p(20,20),p(60,20)),pen=new A.Pen(A.Brushes.Black,10);pen.LineCap='Round';
    try{assert.equal(g.StrokeContains(pen,p(17,20)),true);const outline=g.GetWidenedGeometry(pen);try{assert.equal(outline.FillContains(p(17,20)),true);assert.ok(outline.Bounds.Width>=49);}finally{outline.Dispose();}
        pen.DashStyle=new A.DashStyle([1,1]);assert.equal(g.StrokeContains(pen,p(45,20)),true);assert.ok(g.GetRenderBounds(pen).Height>=10);
    }finally{pen.DashStyle?.Dispose();pen.Dispose();g.Dispose();}
});
test('contour position/tangent and extraction operate on actual native curve',()=>{
    const g=A.PathGeometry.Parse('M10 10L40 10L40 50');try{assert.equal(g.ContourLength,70);const at=g.TryGetPointAndTangentAtDistance(15);assert.equal(at.Success,true);assert.deepEqual(at.Point,p(25,10));assert.deepEqual(at.Tangent,p(1,0));assert.equal(g.TryGetPointAtDistance(-1).Success,false);
        const segment=g.TryGetSegment(5,20);assert.equal(segment.Success,true);try{assert.equal(segment.Segment.ContourLength,15);}finally{segment.Segment.Dispose();}
    }finally{g.Dispose();}
});
for(const [T,points,op]of[[A.PolyLineSegment,[p(20,10),p(30,20)],'L'],[A.PolyBezierSegment,[p(10,40),p(30,10),p(40,40)],'C'],[A.PolyQuadraticBezierSegment,[p(20,40),p(40,10)],'Q']]){
    test(`${T.name} collections notify, clone deeply, and record valid native commands`,()=>{
        const s=new T(points),f=new A.PathFigure(p(10,10),[s],false),g=new A.PathGeometry([f]);try{assert.ok(g.Data.includes(op));const clone=g.Clone();try{s.Points.Set(0,p(60,60));assert.equal(clone.Figures.Get(0).Segments.Get(0).Points.Get(0).X,points[0].X);assert.notEqual(clone.Figures.Get(0).StartPoint,f.StartPoint);assert.throws(()=>s.Points.Add('1,2'),/Point/);}finally{clone.Dispose();}}
        finally{g.Dispose();f.Dispose();s.Dispose();}
    });
}
for(const aot of [false,true])test(`${aot?'AOT':'runtime'} XAML constructs all path segments and string Figures with typed values`,async()=>{
    const source='<PathGeometry xmlns="https://github.com/avaloniaui"><PathFigure StartPoint="10,10" IsClosed="False" IsFilled="False"><LineSegment Point="20,10" IsStroked="False"/><BezierSegment Point1="30,20" Point2="40,0" Point3="50,10"/><QuadraticBezierSegment Point1="60,20" Point2="70,10"/><ArcSegment Point="80,20" Size="10,10" SweepDirection="CounterClockwise"/><PolyLineSegment Points="80,30 70,30"/><PolyBezierSegment Points="60,30 60,40 50,40"/><PolyQuadraticBezierSegment Points="40,50 30,40"/></PathFigure></PathGeometry>';
    const compiler=new A.AvaloniaXamlCompiler();
    async function build(s){const c=compiler.Compile(s);return aot?(await import('data:text/javascript;base64,'+Buffer.from(c.JavaScript).toString('base64'))).Build(new A.AvaloniaXamlServices()):c.Build();}
    const g=await build(source);try{assert.equal(g.Figures.Count,1);const f=g.Figures.Get(0);assert.equal(f.Segments.Count,7);assert.equal(f.IsFilled,false);assert.equal(g.FillData,'');assert.equal(f.Segments.Get(0).IsStroked,false);assert.ok(platform.GetPath(g,'stroke').Bounds.Width>0);}finally{for(const f of g.Figures){for(const s of f.Segments)s.Dispose();f.Dispose();}g.Dispose();}
    const literal=await build('<PathGeometry xmlns="https://github.com/avaloniaui" Figures="M10 10H30V30Z"/>');try{assert.equal(literal.Figures.Count,1);assert.equal(literal.FillContains(p(25,20)),true);}finally{for(const f of literal.Figures){for(const s of f.Segments)s.Dispose();f.Dispose();}literal.Dispose();}
});
test('malformed nested geometry descriptions do not allocate partial owned child graphs',()=>{
    const good=new A.RectangleGeometry(new A.Rect(0,0,10,10)),d={Kind:'Group',FillRule:'EvenOdd',Transform:null,Children:[good.GetPathDescription(),{Kind:'bad'}]};
    try{assert.throws(()=>A.Geometry.FromPathDescription(d),/Invalid geometry|Unknown geometry/);assert.equal(good.IsDisposed,false);}
    finally{good.Dispose();}
});
