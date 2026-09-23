import { Rect, Point, Matrix } from "../../base/src/index.js";
import { RegisterGeometryBackend, StreamGeometry } from "../../media/src/index.js";

const bounds = p => { const r=p.TightBounds;return new Rect(r.Left,r.Top,r.Width,r.Height); };
const nativeMatrix = a => [a[0],a[2],a[4],a[1],a[3],a[5],0,0,1];
/** Build native contour membership from a pure descriptor. Children are owned
 * only while assembling their parent, never borrowed from an evictable LRU. */
export function CreateGeometryPath(api,d,kind='fill',depth=0) {
    if(depth>256)throw new RangeError('Geometry depth limit exceeded.');
    let path;
    try {
        if(d.Kind==='Paths') {
            const data=kind==='all'?d.Data:kind==='stroke'?d.StrokeData:d.FillData;
            path=data?api.SKPath.ParseSvgPathData(data):new api.SKPath();
            if(!path)throw new SyntaxError('Invalid SVG geometry.');
        }else if(d.Kind==='Group') {
            path=new api.SKPath();
            for(const child of d.Children){const p=CreateGeometryPath(api,child,kind,depth+1);try{path.AddPath(p);}finally{p.Dispose();}}
        }else if(d.Kind==='Combined') {
            const a=d.Geometry1?CreateGeometryPath(api,d.Geometry1,'fill',depth+1):new api.SKPath();let b;
            try {b=d.Geometry2?CreateGeometryPath(api,d.Geometry2,'fill',depth+1):new api.SKPath();path=a.Op(b,d.Mode==='Exclude'?'Difference':d.Mode);if(!path)throw new Error('Skia path operation failed.');}
            finally{a.Dispose();b?.Dispose();}
        }else throw new TypeError('Unknown geometry description kind.');
        path.FillType=d.FillRule==='NonZero'?api.SKPathFillType.Winding:api.SKPathFillType.EvenOdd;
        if(d.Transform)path.Transform(nativeMatrix(d.Transform));
        return path;
    }catch(error){path?.Dispose();throw error;}
}
export function GetGeometryPath(platform,g,kind='fill') {
    if(!['fill','stroke','all'].includes(kind))throw new TypeError('Unknown geometry path role.');
    const description=g?.GetPathDescription?.()??{Kind:'Paths',Data:'',FillData:'',StrokeData:'',FillRule:'EvenOdd',Transform:null};
    const key=kind+'|'+(g?.PathSignature??'empty');let path=platform.Paths.Get(key);
    if(!path){path=CreateGeometryPath(platform.Api,description,kind);platform.Paths.Set(key,path,key.length*2+128);}
    return path;
}
function stroke(platform,g,pen) {
    const S=platform.Api,p=new S.SKPaint();let effect;
    try{
        p.Style=S.SKPaintStyle.Stroke;p.StrokeWidth=pen?.Thickness??0;
        p.StrokeCap=S.SKStrokeCap[pen?.LineCap==='Flat'?'Butt':pen?.LineCap]??S.SKStrokeCap.Butt;
        p.StrokeJoin=S.SKStrokeJoin[pen?.LineJoin]??S.SKStrokeJoin.Miter;p.StrokeMiter=pen?.MiterLimit??10;
        if(pen?.DashStyle?.Dashes.length){effect=S.SKPathEffect.CreateDash(pen.DashStyle.Dashes.map(x=>x*pen.Thickness),pen.DashStyle.Offset*pen.Thickness);p.PathEffect=effect;}
        return p.GetFillPath(platform.GetPath(g,'stroke'));
    }finally{p.Dispose();effect?.Dispose();}
}
export function InstallGeometryBackend(platform) {
    return RegisterGeometryBackend({
        GetBounds:g=>bounds(platform.GetPath(g,'all')),
        FillContains:(g,p)=>platform.GetPath(g,'fill').Contains(p.X,p.Y),
        StrokeContains(g,pen,p){if(!(pen.Thickness>0))return false;const path=stroke(platform,g,pen);try{return path?.Contains(p.X,p.Y)??false;}finally{path?.Dispose();}},
        GetRenderBounds(g,pen){const result=bounds(platform.GetPath(g,'fill'));if(!pen||!(pen.Thickness>0))return result;const path=stroke(platform,g,pen);try{return path?result.Union(bounds(path)):result;}finally{path?.Dispose();}},
        Widen(g,pen){const path=stroke(platform,g,pen);try{return path?.ToSvgPathData()??'';}finally{path?.Dispose();}},
        Combine(a,b,mode){const pa=platform.GetPath(a).Clone();let result;try{result=pa.Op(platform.GetPath(b),mode==='Exclude'?'Difference':mode);if(!result)throw new Error('Skia path operation failed.');return result.ToSvgPathData();}finally{pa.Dispose();result?.Dispose();}},
        Measure(g,distance){const m=new platform.Api.SKPathMeasure(platform.GetPath(g,'stroke'),false);try{
            if(distance===undefined)return{Length:m.Length};
            if(distance<0||distance>m.Length)return{Success:false,Point:new Point(),Tangent:new Point()};
            const q=m.GetPositionAndTangent(distance);return{Success:!!q,Point:q?new Point(q.Position.X,q.Position.Y):new Point(),Tangent:q?new Point(q.Tangent.X,q.Tangent.Y):new Point()};
        }finally{m.Dispose();}},
        Segment(g,a,b,start){const m=new platform.Api.SKPathMeasure(platform.GetPath(g,'stroke'),false);let p;try{p=m.GetSegment(a,b,start);return{Success:!!p,Segment:p?new StreamGeometry(p.ToSvgPathData()):null};}finally{p?.Dispose();m.Dispose();}}
    });
}
