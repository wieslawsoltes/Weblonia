import { AvaloniaProperty, DefineProperties, AvaloniaList, Point, Size, Rect, Matrix, Disposable } from '@wieslawsoltes/avalonia-base';
import { GeometryResource } from './geometry-resource.js';
import { ParsePathMarkup } from './path-parser.js';

const backends = [];
export function RegisterGeometryBackend(value) {
    const entry = { Value: value }; backends.push(entry);
    return Disposable.Create(() => { const i = backends.indexOf(entry); if (i >= 0) backends.splice(i, 1); });
}
const backend = () => backends.at(-1)?.Value;
export const FillRule = Object.freeze({ EvenOdd: 'EvenOdd', NonZero: 'NonZero' });
export const SweepDirection = Object.freeze({ CounterClockwise: 'CounterClockwise', Clockwise: 'Clockwise' });
export const GeometryCombineMode = Object.freeze({ Union: 'Union', Intersect: 'Intersect', Xor: 'Xor', Exclude: 'Exclude' });
const bool = v => typeof v === 'string' ? /^(true|false)$/i.test(v) ? v.toLowerCase() === 'true' : (() => { throw new TypeError('Expected Boolean.'); })() : !!v;
const finite = v => { const n = Number(v); if (!Number.isFinite(n)) throw new TypeError('Expected finite geometry coordinate.'); return n; };
const point = v => { if(v==null||typeof v!=='string'&&(!Number.isFinite(v.X)||!Number.isFinite(v.Y)))throw new TypeError('Expected finite Point.'); const p = v instanceof Point ? v : typeof v === 'string' ? Point.Parse(v) : new Point(v?.X, v?.Y); if (![p.X,p.Y].every(Number.isFinite)) throw new TypeError('Expected finite Point.'); return p; };
const size = v => { if(v==null||typeof v!=='string'&&(!Number.isFinite(v.Width)||!Number.isFinite(v.Height)))throw new TypeError('Expected nonnegative finite Size.'); const s = v instanceof Size ? v : typeof v === 'string' ? Size.Parse(v) : new Size(v?.Width,v?.Height); if (![s.Width,s.Height].every(x=>Number.isFinite(x)&&x>=0)) throw new TypeError('Expected nonnegative finite Size.'); return s; };
const choice = values => v => { if (!Object.values(values).includes(v)) throw new TypeError(`Invalid geometry option '${v}'.`); return v; };
const pair = p => `${p.X} ${p.Y}`;
function geometryChildren(g) { return g instanceof GeometryGroup ? g.Children ?? [] : g instanceof CombinedGeometry ? [g.Geometry1,g.Geometry2].filter(Boolean) : []; }
function validateGeometryEdge(owner, value) {
    if (!(value instanceof Geometry) || value.IsDisposed) throw new TypeError('A live Geometry is required.');
    const seen = new Set();
    function visit(g, depth) {
        if (g === owner) throw new Error('Geometry graph contains a cycle.');
        if (depth > 256) throw new RangeError('Geometry graph depth exceeds 256.');
        if (seen.has(g)) return; seen.add(g);
        for (const child of geometryChildren(g)) visit(child, depth+1);
    }
    visit(value, 0);
}
/** Immutable, realm-portable description. No native handles and no eager native
 * path allocation. The description and signature are computed once per change. */
export class Geometry extends GeometryResource {
    _GetDependencies() { return [this.Transform]; }
    get Bounds() { this._verifyAlive(); return backend()?.GetBounds?.(this) ?? this._bounds ?? Rect.Empty; }
    get Data() { return ''; }
    get FillData() { return this.Data; }
    get StrokeData() { return this.Data; }
    FillContains(p) { this._verifyAlive(); return backend()?.FillContains?.(this, point(p)) ?? false; }
    StrokeContains(pen, p) { this._verifyAlive(); return !!pen && (backend()?.StrokeContains?.(this,pen,point(p)) ?? false); }
    GetRenderBounds(pen = null) { return backend()?.GetRenderBounds?.(this,pen) ?? (pen ? this.Bounds.Inflate(pen.Thickness/2) : this.Bounds); }
    GetWidenedGeometry(pen) { const data=backend()?.Widen?.(this,pen); if(data==null)throw new Error('Widening geometry requires a native geometry backend.'); return new StreamGeometry(data); }
    get ContourLength() { return backend()?.Measure?.(this)?.Length ?? 0; }
    TryGetPointAtDistance(distance) { const q=this.TryGetPointAndTangentAtDistance(distance);return {Success:q.Success,Point:q.Point}; }
    TryGetPointAndTangentAtDistance(distance) { return backend()?.Measure?.(this,finite(distance)) ?? {Success:false,Point:new Point(),Tangent:new Point()}; }
    TryGetSegment(start,stop,startOnBeginFigure=true) { return backend()?.Segment?.(this,finite(start),finite(stop),bool(startOnBeginFigure)) ?? {Success:false,Segment:null}; }
    _DescribePaths() { return {Kind:'Paths',Data:this.Data,FillData:this.FillData,StrokeData:this.StrokeData}; }
    GetPathDescription() {
        this._verifyAlive();
        if (!this._pathDescription) {
            const transform=this.Transform?.Value??this.Transform;
            const values=transform?[transform.M11,transform.M12,transform.M21,transform.M22,transform.M31,transform.M32].map(finite):null;
            this._pathDescription=Object.freeze({...this._DescribePaths(),FillRule:this.FillRule,Transform:values?Object.freeze(values):null});
            this._pathSignature=JSON.stringify(this._pathDescription);
        }
        return this._pathDescription;
    }
    get PathSignature() { this.GetPathDescription();return this._pathSignature; }
    Clone() { return Geometry.FromPathDescription(this.GetPathDescription()); }
    ToString() { return this.Data; }
    static Parse(value) { return value instanceof Geometry ? value : StreamGeometry.Parse(value); }
    static Combine(a,b,mode='Union',transform=null) { return new CombinedGeometry(mode,a,b,transform); }
    static FromPathDescription(value) {
        let count=0;
        // Validate the complete descriptor before allocating event subscriptions or
        // native resources. Cycles and excessive nesting fail at the bounded walk.
        const validate=(d,depth=0)=>{
            if(!d||typeof d!=='object'||depth>256||++count>200000)throw new TypeError('Invalid geometry description.');
            choice(FillRule)(d.FillRule);
            if(d.Transform!=null&&(!Array.isArray(d.Transform)||d.Transform.length!==6||!d.Transform.every(Number.isFinite)))throw new TypeError('Invalid geometry matrix.');
            if(d.Kind==='Paths'){
                for(const key of ['Data','FillData','StrokeData'])if(typeof d[key]!=='string'||d[key].length>8*1024*1024)throw new TypeError('Invalid path data.');
            }else if(d.Kind==='Group'){
                if(!Array.isArray(d.Children)||d.Children.length>200000)throw new TypeError('Invalid geometry children.');
                for(const child of d.Children)validate(child,depth+1);
            }else if(d.Kind==='Combined'){
                choice(GeometryCombineMode)(d.Mode);for(const key of ['Geometry1','Geometry2'])if(d[key]!=null)validate(d[key],depth+1);
            }else throw new TypeError('Unknown geometry description kind.');
        };
        validate(value);
        const create=d=>{
            let g;
            try{
                if(d.Kind==='Paths'){g=new StreamGeometry(d.Data);g._fillData=d.FillData;g._strokeData=d.StrokeData;}
                else if(d.Kind==='Group'){
                    g=new GeometryGroup();g._ownedGeometry=[];
                    for(const child of d.Children){const item=create(child);g._ownedGeometry.push(item);g.Children.Add(item);}
                }else{
                    g=new CombinedGeometry(d.Mode);g._ownedGeometry=[];
                    for(const key of ['Geometry1','Geometry2'])if(d[key]!=null){const child=create(d[key]);g._ownedGeometry.push(child);g[key]=child;}
                }
                g.FillRule=d.FillRule;if(d.Transform)g.Transform=new Matrix(...d.Transform);return g;
            }catch(error){g?.Dispose();throw error;}
        };
        return create(value);
    }
    Dispose(){if(!this.IsDisposed){super.Dispose();for(const child of this._ownedGeometry??[])child.Dispose();this._ownedGeometry=null;}}
}
DefineProperties(Geometry,{Transform:[null],FillRule:['EvenOdd',{Convert:choice(FillRule)}]});

export class StreamGeometry extends Geometry {
    constructor(data='') { super();this._data=String(data);this._fillData=this._strokeData=null;this._writer=null; }
    get Data(){return this._data;}
    set Data(value){this._SetData(value);}
    get FillData(){return this._fillData??this.Data;}
    get StrokeData(){return this._strokeData??this.Data;}
    _SetData(value,bounds=null,fillData=null,strokeData=null){
        this._verifyAlive();value=String(value);
        if(value===this._data&&fillData===this._fillData&&strokeData===this._strokeData)return;
        this._bounds=bounds;this._fillData=fillData;this._strokeData=strokeData;
        if(value!==this._data)this.SetAndRaise(StreamGeometry.DataProperty,'_data',value);else this._InvalidateGeometry();
    }
    static Parse(value){
        if(value instanceof StreamGeometry)return value;
        const g=new StreamGeometry(),c=g.Open();try{ParsePathMarkup(value,c);c.Dispose();return g;}catch(error){c.Abort();g.Dispose();throw error;}
    }
    Open(){this._verifyAlive();if(this._writer)throw new Error('Geometry already has an open writer.');return this._writer=new StreamGeometryContext(this);}
}
StreamGeometry.DataProperty=AvaloniaProperty.RegisterDirect(StreamGeometry,'Data',o=>o.Data,(o,v)=>{o.Data=v;});
/** Three paths preserve geometry, fill membership and stroke gaps independently.
 * A gap breaks the stroked contour; closing it emits a line to the original start,
 * not Close(), which would close to the point following the last stroke gap. */
export class StreamGeometryContext extends Disposable {
    constructor(geometry=null){super();this._geometry=geometry;this._all=[];this._fill=[];this._stroke=[];this._points=[];this._figure=false;this._rule=geometry?.FillRule??'EvenOdd';}
    _VerifyOpen(){if(this.IsDisposed)throw new Error('StreamGeometryContext is disposed.');}
    _VerifyFigure(){this._VerifyOpen();if(!this._figure)throw new Error('A segment requires BeginFigure.');}
    _Point(value){const p=point(value);return new Point(p.X,p.Y);}
    BeginFigure(value,isFilled=true){this._VerifyOpen();if(this._figure)throw new Error('End the current figure before beginning another.');const p=this._Point(value),cmd=`M${pair(p)}`;this._start=p;this._figure=true;this._filled=bool(isFilled);this._broken=false;this._all.push(cmd);this._stroke.push(cmd);if(this._filled)this._fill.push(cmd);this._points.push(p);}
    _Append(cmd,end,isStroked,points){this._VerifyFigure();this._all.push(cmd);if(this._filled)this._fill.push(cmd);if(bool(isStroked))this._stroke.push(cmd);else{this._stroke.push(`M${pair(end)}`);this._broken=true;}for(const p of points)this._points.push(p);}
    LineTo(value,isStroked=true){this._VerifyFigure();const p=this._Point(value);this._Append(`L${pair(p)}`,p,isStroked,[p]);}
    CubicBezierTo(a,b,c,isStroked=true){this._VerifyFigure();a=this._Point(a);b=this._Point(b);c=this._Point(c);this._Append(`C${pair(a)} ${pair(b)} ${pair(c)}`,c,isStroked,[a,b,c]);}
    QuadraticBezierTo(a,b,isStroked=true){this._VerifyFigure();a=this._Point(a);b=this._Point(b);this._Append(`Q${pair(a)} ${pair(b)}`,b,isStroked,[a,b]);}
    ArcTo(value,radii,rotationAngle=0,isLargeArc=false,sweepDirection='Clockwise',isStroked=true){this._VerifyFigure();const p=this._Point(value),s=size(radii),r=finite(rotationAngle),direction=choice(SweepDirection)(sweepDirection),large=bool(isLargeArc);this._Append(`A${s.Width} ${s.Height} ${r} ${+large} ${+(direction==='Clockwise')} ${pair(p)}`,p,isStroked,[p]);}
    PreciseArcTo(...args){this.ArcTo(...args);}
    EndFigure(isClosed=false){this._VerifyFigure();if(bool(isClosed)){this._all.push('Z');if(this._filled)this._fill.push('Z');this._stroke.push(this._broken?`L${pair(this._start)}`:'Z');}this._figure=false;}
    SetFillRule(rule){this._VerifyOpen();this._rule=choice(FillRule)(rule);}
    _Result(){if(this._figure)this.EndFigure(false);return {Data:this._all.join(' '),FillData:this._fill.join(' '),StrokeData:this._stroke.join(' '),FillRule:this._rule};}
    Abort(){if(this.IsDisposed)return;const g=this._geometry;if(g?._writer===this)g._writer=null;this._geometry=null;this._all.length=this._fill.length=this._stroke.length=this._points.length=0;super.Dispose();}
    Dispose(){if(this.IsDisposed)return;const result=this._Result(),g=this._geometry;let bounds=Rect.Empty;
        if(this._points.length){let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;for(const p of this._points){l=Math.min(l,p.X);t=Math.min(t,p.Y);r=Math.max(r,p.X);b=Math.max(b,p.Y);}bounds=new Rect(l,t,r-l,b-t);}
        this.Abort();if(g&&!g.IsDisposed){g._UpdateGeometry(()=>{g._SetData(result.Data,bounds,result.FillData,result.StrokeData);g.FillRule=result.FillRule;});}
    }
}
export class RectangleGeometry extends Geometry {
    constructor(rect=Rect.Empty){super();this.Rect=rect;}
    get Data(){const r=this.Rect,rx=Math.min(Math.abs(this.RadiusX),Math.max(0,r.Width/2)),ry=Math.min(Math.abs(this.RadiusY),Math.max(0,r.Height/2));if(!rx||!ry)return`M${r.X} ${r.Y}H${r.Right}V${r.Bottom}H${r.X}Z`;return`M${r.X+rx} ${r.Y}H${r.Right-rx}A${rx} ${ry} 0 0 1 ${r.Right} ${r.Y+ry}V${r.Bottom-ry}A${rx} ${ry} 0 0 1 ${r.Right-rx} ${r.Bottom}H${r.X+rx}A${rx} ${ry} 0 0 1 ${r.X} ${r.Bottom-ry}V${r.Y+ry}A${rx} ${ry} 0 0 1 ${r.X+rx} ${r.Y}Z`;}
    get Bounds(){return this.Transform?this.Rect.TransformToAABB(this.Transform.Value??this.Transform):this.Rect;}
}
DefineProperties(RectangleGeometry,{Rect:[Rect.Empty,{Convert:v=>v instanceof Rect?v:Rect.Parse(v)}],RadiusX:[0,{Convert:finite}],RadiusY:[0,{Convert:finite}]});
export class EllipseGeometry extends Geometry {
    constructor(rect=Rect.Empty){super();this.Rect=rect;}
    get Data(){const r=this.Rect,cx=r.Center.X,cy=r.Center.Y,rx=r.Width/2,ry=r.Height/2;return`M${cx-rx} ${cy}A${rx} ${ry} 0 1 0 ${cx+rx} ${cy}A${rx} ${ry} 0 1 0 ${cx-rx} ${cy}Z`;}
    get Bounds(){return backend()?.GetBounds?.(this)??(this.Transform?this.Rect.TransformToAABB(this.Transform.Value??this.Transform):this.Rect);}
}
DefineProperties(EllipseGeometry,{Rect:[Rect.Empty,{Convert:v=>v instanceof Rect?v:Rect.Parse(v)}]});
export class LineGeometry extends Geometry {
    constructor(start=new Point(),end=new Point()){super();this.StartPoint=start;this.EndPoint=end;}
    get Data(){return`M${this.StartPoint.X} ${this.StartPoint.Y}L${this.EndPoint.X} ${this.EndPoint.Y}`;}
    get Bounds(){const a=this.StartPoint,b=this.EndPoint,r=new Rect(Math.min(a.X,b.X),Math.min(a.Y,b.Y),Math.abs(b.X-a.X),Math.abs(b.Y-a.Y));return this.Transform?r.TransformToAABB(this.Transform.Value??this.Transform):r;}
}
DefineProperties(LineGeometry,{StartPoint:[new Point(),{Convert:point}],EndPoint:[new Point(),{Convert:point}]});

class TypedGeometryList extends AvaloniaList {
    constructor(items,type){super(items);this._owners=new Set();this._type=type;this.ValidateMutation=change=>{for(const item of change.NewItems)this._Validate(item);};for(const item of this)this._Validate(item);}
    _Validate(item){if(!(item instanceof this._type)||item.IsDisposed)throw new TypeError(`Expected a live ${this._type.name}.`);if(item instanceof Geometry)for(const owner of this._owners)validateGeometryEdge(owner,item);}
    get Item(){return this.ToArray();}
}
export class GeometryCollection extends TypedGeometryList {constructor(items=[]){super(items,Geometry);}}
export class PathFigures extends TypedGeometryList {constructor(items=[]){super(items,PathFigure);}static Parse(value){const geometry=PathGeometry.Parse(value),figures=geometry.Figures;geometry.Figures=null;geometry._ownedGeometry=null;geometry.Dispose();return figures;}}
export class PathSegments extends TypedGeometryList {constructor(items=[]){super(items,PathSegment);}}
export class Points extends AvaloniaList {
    constructor(items=[]){super(Array.from(items,point));this.ValidateMutation=change=>{for(const p of change.NewItems){if(!(p instanceof Point))throw new TypeError('Points mutations require Point values.');point(p);}};}
    static Parse(value){const nums=String(value).trim().split(/[\s,]+/).filter(Boolean).map(finite);if(nums.length%2)throw new TypeError('Point lists require coordinate pairs.');const points=[];for(let i=0;i<nums.length;i+=2)points.push(new Point(nums[i],nums[i+1]));return new Points(points);}
    get Item(){return this.ToArray();}
}
function collection(Type,name,ListType){
    const field=`_${name}`;
    Object.defineProperty(Type.prototype,name,{get(){return this[field]??null;},set(value){
        this._verifyAlive();const next=value==null?null:value instanceof ListType?value:typeof value==='string'&&ListType.Parse?ListType.Parse(value):new ListType(value);
        if(next===this[field])return;
        if(next&&next._owners){for(const child of next){next._Validate(child);if(child instanceof Geometry)validateGeometryEdge(this,child);}next._owners.add(this);}
        this[field]?._owners?.delete(this);this.SetAndRaise(Type[`${name}Property`],field,next);
    }});
    Type[`${name}Property`]=AvaloniaProperty.RegisterDirect(Type,name,o=>o[name],(o,v)=>{o[name]=v;});
}
export class GeometryGroup extends Geometry {
    constructor(children=[]){super();this.Children=children;}
    _GetDependencies(){return[...super._GetDependencies(),this.Children];}
    get Data(){return Array.from(this.Children??[],c=>c.Data).join(' ');}
    _DescribePaths(){return{Kind:'Group',Children:Object.freeze(Array.from(this.Children??[],c=>c.GetPathDescription()))};}
    get Bounds(){return backend()?.GetBounds?.(this)??Array.from(this.Children??[]).reduce((r,c)=>r.Union(c.Bounds),Rect.Empty);}
    Dispose(){if(!this.IsDisposed){this.Children?._owners.delete(this);super.Dispose();}}
}
collection(GeometryGroup,'Children',GeometryCollection);
export class CombinedGeometry extends Geometry {
    constructor(mode='Union',a=null,b=null,transform=null){super();this.GeometryCombineMode=mode;this.Geometry1=a;this.Geometry2=b;this.Transform=transform;}
    _GetDependencies(){return[...super._GetDependencies(),this.Geometry1,this.Geometry2];}
    _SetPriorityValue(property,value,...args){if(['Geometry1','Geometry2'].includes(property.Name)&&value!=null)validateGeometryEdge(this,value);return super._SetPriorityValue(property,value,...args);}
    _DescribePaths(){return{Kind:'Combined',Mode:this.GeometryCombineMode,Geometry1:this.Geometry1?.GetPathDescription()??null,Geometry2:this.Geometry2?.GetPathDescription()??null};}
    get Data(){const data=backend()?.Combine?.(this.Geometry1,this.Geometry2,this.GeometryCombineMode);if(data==null)throw new Error('Geometry Boolean operations require the Skia backend.');return data;}
}
DefineProperties(CombinedGeometry,{GeometryCombineMode:['Union',{Convert:choice(GeometryCombineMode)}],Geometry1:[null],Geometry2:[null]});
export class PathGeometry extends StreamGeometry {
    constructor(figures=[]){super();this.Figures=figures;}
    _GetDependencies(){return[...super._GetDependencies(),this.Figures];}
    _Paths(){if(!this._compiledPaths){const c=new StreamGeometryContext();try{c.SetFillRule(this.FillRule);for(const f of this.Figures??[])f.ApplyTo(c);this._compiledPaths=c._Result();}finally{c.Abort();}}return this._compiledPaths;}
    get Data(){return this._Paths().Data;}
    get FillData(){return this._Paths().FillData;}
    get StrokeData(){return this._Paths().StrokeData;}
    static Parse(value){const g=new PathGeometry(),c=new PathGeometryContext(g);try{ParsePathMarkup(value,c);c.Dispose();return g;}catch(error){c.Abort();g.Dispose();throw error;}}
    Clone(){const g=new PathGeometry(Array.from(this.Figures??[],f=>f.Clone()));g.FillRule=this.FillRule;const m=this.Transform?.Value??this.Transform;g.Transform=m?new Matrix(m.M11,m.M12,m.M21,m.M22,m.M31,m.M32):null;g._ownedGeometry=[...g.Figures];return g;}
    Open(){this._verifyAlive();if(this._writer)throw new Error('Geometry already has an open writer.');return this._writer=new PathGeometryContext(this);}
    Dispose(){if(!this.IsDisposed){this.Figures?._owners.delete(this);super.Dispose();}}
}
collection(PathGeometry,'Figures',PathFigures);
export class PathFigure extends GeometryResource {
    constructor(startPoint=new Point(),segments=[],isClosed=true){super();this.StartPoint=startPoint;this.Segments=segments;this.IsClosed=isClosed;}
    _GetDependencies(){return[this.Segments];}
    ApplyTo(context){context.BeginFigure(this.StartPoint,this.IsFilled);for(const s of this.Segments??[])s.ApplyTo(context);context.EndFigure(this.IsClosed);}
    get Data(){const c=new StreamGeometryContext();try{this.ApplyTo(c);return c._Result().Data;}finally{c.Abort();}}
    Clone(){const f=new PathFigure(new Point(this.StartPoint.X,this.StartPoint.Y),Array.from(this.Segments??[],s=>s.Clone()),this.IsClosed);f.IsFilled=this.IsFilled;f._ownedSegments=[...f.Segments];return f;}
    Dispose(){if(!this.IsDisposed){this.Segments?._owners.delete(this);super.Dispose();for(const s of this._ownedSegments??[])s.Dispose();this._ownedSegments=null;}}
}
DefineProperties(PathFigure,{StartPoint:[new Point(),{Convert:point}],IsClosed:[true,{Convert:bool}],IsFilled:[true,{Convert:bool}]});collection(PathFigure,'Segments',PathSegments);
export class PathSegment extends GeometryResource {
    ApplyTo(){throw new Error('PathSegment.ApplyTo is abstract.');}
    Clone(){const s=new this.constructor();for(const name of ['Point','Point1','Point2','Point3','Size','RotationAngle','IsLargeArc','SweepDirection','IsStroked'])if(name in this){const v=this[name];s[name]=v instanceof Point?new Point(v.X,v.Y):v instanceof Size?new Size(v.Width,v.Height):v;}if(this.Points)s.Points=new Points(Array.from(this.Points,p=>new Point(p.X,p.Y)));return s;}
    ToString(){return this.Data;}
}
DefineProperties(PathSegment,{IsStroked:[true,{Convert:bool}]});
export class LineSegment extends PathSegment {constructor(p=new Point(),isStroked=true){super();this.Point=p;this.IsStroked=isStroked;}get Data(){return`L${pair(this.Point)}`;}ApplyTo(c){c.LineTo(this.Point,this.IsStroked);}}
DefineProperties(LineSegment,{Point:[new Point(),{Convert:point}]});
export class BezierSegment extends PathSegment {constructor(a=new Point(),b=new Point(),c=new Point(),isStroked=true){super();this.Point1=a;this.Point2=b;this.Point3=c;this.IsStroked=isStroked;}get Data(){return`C${pair(this.Point1)} ${pair(this.Point2)} ${pair(this.Point3)}`;}ApplyTo(c){c.CubicBezierTo(this.Point1,this.Point2,this.Point3,this.IsStroked);}}
DefineProperties(BezierSegment,{Point1:[new Point(),{Convert:point}],Point2:[new Point(),{Convert:point}],Point3:[new Point(),{Convert:point}]});
export class QuadraticBezierSegment extends PathSegment {constructor(a=new Point(),b=new Point(),isStroked=true){super();this.Point1=a;this.Point2=b;this.IsStroked=isStroked;}get Data(){return`Q${pair(this.Point1)} ${pair(this.Point2)}`;}ApplyTo(c){c.QuadraticBezierTo(this.Point1,this.Point2,this.IsStroked);}}
DefineProperties(QuadraticBezierSegment,{Point1:[new Point(),{Convert:point}],Point2:[new Point(),{Convert:point}]});
export class ArcSegment extends PathSegment {constructor(p=new Point(),s=new Size()){super();this.Point=p;this.Size=s;}get Data(){return`A${this.Size.Width} ${this.Size.Height} ${this.RotationAngle} ${+this.IsLargeArc} ${+(this.SweepDirection==='Clockwise')} ${pair(this.Point)}`;}ApplyTo(c){c.ArcTo(this.Point,this.Size,this.RotationAngle,this.IsLargeArc,this.SweepDirection,this.IsStroked);}}
DefineProperties(ArcSegment,{Point:[new Point(),{Convert:point}],Size:[new Size(),{Convert:size}],RotationAngle:[0,{Convert:finite}],IsLargeArc:[false,{Convert:bool}],SweepDirection:['Clockwise',{Convert:choice(SweepDirection)}]});
class PolySegment extends PathSegment {
    constructor(points=[],isStroked=true){super();this.Points=points;this.IsStroked=isStroked;}
    _GetDependencies(){return[this.Points];}
    _Apply(c,n,method){const points=this.Points;if(!points)return;if(points.Count%n)throw new TypeError(`${this.constructor.name} requires a multiple of ${n} points.`);for(let i=0;i<points.Count;i+=n){if(n===1)c[method](points.Get(i),this.IsStroked);else if(n===2)c[method](points.Get(i),points.Get(i+1),this.IsStroked);else c[method](points.Get(i),points.Get(i+1),points.Get(i+2),this.IsStroked);}}
}
collection(PolySegment,'Points',Points);
export class PolyLineSegment extends PolySegment {get Data(){return Array.from(this.Points??[],p=>`L${pair(p)}`).join(' ');}ApplyTo(c){this._Apply(c,1,'LineTo');}}
export class PolyBezierSegment extends PolySegment {get Data(){return`C${Array.from(this.Points??[],pair).join(' ')}`;}ApplyTo(c){this._Apply(c,3,'CubicBezierTo');}}
export class PolyQuadraticBezierSegment extends PolySegment {get Data(){return`Q${Array.from(this.Points??[],pair).join(' ')}`;}ApplyTo(c){this._Apply(c,2,'QuadraticBezierTo');}}
export class PathGeometryContext extends StreamGeometryContext {
    constructor(geometry){super(geometry);this._figures=[];}
    BeginFigure(p,filled=true){super.BeginFigure(p,filled);this._currentFigure=new PathFigure(point(p),[],false);this._currentFigure.IsFilled=filled;this._figures.push(this._currentFigure);}
    LineTo(p,stroked=true){super.LineTo(p,stroked);this._currentFigure.Segments.Add(new LineSegment(p,stroked));}
    CubicBezierTo(a,b,c,stroked=true){super.CubicBezierTo(a,b,c,stroked);this._currentFigure.Segments.Add(new BezierSegment(a,b,c,stroked));}
    QuadraticBezierTo(a,b,stroked=true){super.QuadraticBezierTo(a,b,stroked);this._currentFigure.Segments.Add(new QuadraticBezierSegment(a,b,stroked));}
    ArcTo(p,s,r=0,l=false,d='Clockwise',stroked=true){super.ArcTo(p,s,r,l,d,stroked);const a=new ArcSegment(p,s);a.RotationAngle=r;a.IsLargeArc=l;a.SweepDirection=d;a.IsStroked=stroked;this._currentFigure.Segments.Add(a);}
    EndFigure(closed=false){super.EndFigure(closed);this._currentFigure.IsClosed=closed;}
    Abort(){if(this.IsDisposed)return;for(const f of this._figures){for(const s of f.Segments)s.Dispose();f.Dispose();}this._figures=[];super.Abort();}
    Dispose(){
        if(this.IsDisposed)return;if(this._figure)this.EndFigure(false);
        const g=this._geometry,figures=this._figures,rule=this._rule;
        this._figures=[];super.Abort();
        for(const f of figures)f._ownedSegments=[...f.Segments];
        if(g.IsDisposed){for(const f of figures)f.Dispose();return;}
        const old=g._ownedGeometry;g._ownedGeometry=figures;
        try{g._UpdateGeometry(()=>{g.Figures=figures;g.FillRule=rule;});}
        finally{for(const f of old??[])f.Dispose();}
    }
}
