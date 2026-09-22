import { Disposable, Event, CompositeDisposable, Point, Vector, Size, Rect, Matrix } from '@wieslawsoltes/avalonia-base';
import { Brush, SolidColorBrush, Color, Colors, Bitmap } from '@wieslawsoltes/avalonia-media';
import { Clock, ParseDuration, Interpolate, LinearEasing } from '@wieslawsoltes/avalonia-animation';
import { CompositionExpression } from './expression.js';
export { CompositionExpression } from './expression.js';

let objectId=0;
const clone=value=>{
    if(value==null||typeof value!=='object'||value instanceof CompositionObject||value instanceof Bitmap||value instanceof Brush)return value;
    if(value instanceof Color)return new Color(value.A,value.R,value.G,value.B);
    if(value instanceof Matrix)return new Matrix(value.M11,value.M12,value.M21,value.M22,value.M31,value.M32);
    if(value instanceof Size)return new Size(value.Width,value.Height);
    if(value instanceof Point)return new value.constructor(value.X,value.Y);
    if(Array.isArray(value))return value.map(clone);
    return Object.fromEntries(Object.entries(value).map(([key,val])=>[key,clone(val)]));
};
function define(type,properties) {
    for(const [name,initial] of Object.entries(properties))Object.defineProperty(type.prototype,name,{configurable:true,enumerable:true,
        get(){return Object.hasOwn(this._values,name)?this._values[name]:typeof initial==='function'?this._values[name]=initial():initial;},
        set(value){this._Set(name,value);}
    });
}
function interpolate(a,b,t) {
    if(a&&b&&typeof a==='object'&&typeof b==='object'&&Object.hasOwn(a,'X')&&Object.hasOwn(a,'Z'))return {X:a.X+(b.X-a.X)*t,Y:a.Y+(b.Y-a.Y)*t,Z:a.Z+(b.Z-a.Z)*t};
    return Interpolate(a,b,t);
}
export class CompositionObject extends Disposable {
    constructor(compositor) {
        super();if(!(compositor instanceof Compositor)||compositor.IsDisposed)throw new TypeError('A live Compositor is required.');
        this.Id=++objectId;this.Compositor=compositor;this.Comment='';this._values={};this._committed={};this._animated=new Map();this._animations=new Map();
        compositor._objects.add(this);compositor._Dirty(this);
    }
    _Set(name,value) {
        if(this.IsDisposed)throw new Error('Composition object is disposed.');
        if(value instanceof CompositionObject&&value.Compositor!==this.Compositor)throw new Error('Composition resources must belong to the same Compositor.');
        if(Object.is(this._values[name],value))return;
        this._values[name]=clone(value);this.Compositor._Dirty(this);
    }
    _Commit() {
        // Materialize default properties as part of the immutable value snapshot.
        for(let proto=Object.getPrototypeOf(this);proto&&proto!==CompositionObject.prototype;proto=Object.getPrototypeOf(proto))
            for(const name of Object.getOwnPropertyNames(proto))if(Object.getOwnPropertyDescriptor(proto,name)?.get&&name!=='Parent')void this[name];
        this._committed=Object.fromEntries(Object.entries(this._values).map(([key,value])=>[key,clone(value)]));
    }
    _Read(name){return this._serverValues?.has(name)?this._serverValues.get(name):this._animated.has(name)?this._animated.get(name):Object.hasOwn(this._committed,name)?this._committed[name]:this[name];}
    GetExpressionValue(name) {
        if(name.startsWith('_')||['constructor','prototype','__proto__'].includes(name)||!(name in this))throw new ReferenceError(`Composition member '${name}' is not available.`);
        return this._Read(name);
    }
    StartAnimation(propertyName,animation) {
        if(!(animation instanceof CompositionAnimation)||animation.Compositor!==this.Compositor)throw new TypeError('Animation belongs to a different compositor.');
        const [property,component,...rest]=String(propertyName).split('.');
        if(rest.length||property.startsWith('_')||['constructor','prototype','__proto__'].includes(property)||!(property in this)||component&&!['X','Y','Z','W'].includes(component))throw new RangeError(`Invalid animation property '${propertyName}'.`);
        animation.Validate();this.StopAnimation(propertyName);
        const base=clone(this._Read(property)),start=clone(component?base?.[component]:base);
        const state={Name:propertyName,Property:property,Component:component,Base:base,Start:start,Animation:animation.Clone(),StartedAt:this.Compositor.Clock.Now()};
        this._animations.set(propertyName,state);this.Compositor._animatedObjects.add(this);this.Compositor._EnsureClock();this.Compositor._Dirty(this);
    }
    StopAnimation(name) {
        const state=this._animations.get(name);this._animations.delete(name);
        this._animated.delete(state?.Property??String(name).split('.')[0]);
        if(!this._animations.size)this.Compositor._animatedObjects.delete(this);
        this.Compositor._Dirty(this);this.Compositor._ReleaseIdleClock();
    }
    StopAllAnimations() {for(const name of [...this._animations.keys()])this.StopAnimation(name);this._animated.clear();}
    _Tick(time) {
        for(const [key,state] of this._animations) {
            const result=state.Animation.Sample(time-state.StartedAt,state.Start,this);
            if(!result.HasValue)continue;
            if(state.Component){const vector={...this._Read(state.Property)};vector[state.Component]=result.Value;this._animated.set(state.Property,vector);}
            else this._animated.set(state.Property,result.Value);
            if(result.Done){this._animations.delete(key);if(state.Animation.StopBehavior==='SetToInitialValue')this._animated.delete(state.Property);}
        }
        if(!this._animations.size)this.Compositor._animatedObjects.delete(this);
    }
    Dispose() {
        if(this.IsDisposed)return;
        this.StopAllAnimations();this.Compositor._objects.delete(this);this.Compositor._dirty.delete(this);super.Dispose();
    }
}
export class CompositionBatch {
    constructor() {
        this.CommittedAt=null;this.Revision=null;
        this.Processed=new Promise((resolve,reject)=>{this._resolve=resolve;this._reject=reject;});
        // Automatic scheduling may not have a caller; still expose rejection to explicit awaiters.
        this.Processed.catch(()=>{});
    }
}
export class Compositor extends Disposable {
    constructor(options={}) {
        super();this.Clock=options.Clock??Clock.GlobalClock;this.AutoCommit=options.AutoCommit!==false;
        this.ServerTransport=options.ServerTransport??null;this._objects=new Set();this._dirty=new Set();this._animatedObjects=new Set();this._attachments=new Map();this._updates=[];
        this._nextBatch=null;this._scheduled=false;this._clock=null;this._committing=false;this.Revision=0;this.AfterCommit=new Event();this.Errors=new Event();
    }
    _Dirty(object) {if(this.IsDisposed)return;object._transportVersion=(object._transportVersion??0)+1;this._dirty.add(object);this.RequestCompositionBatchCommitAsync();}
    RequestCompositionBatchCommitAsync() {
        if(this.IsDisposed)throw new Error('Compositor is disposed.');
        const batch=this._nextBatch??=new CompositionBatch();
        if(this.AutoCommit&&!this._scheduled){this._scheduled=true;queueMicrotask(()=>{this._scheduled=false;if(!this.IsDisposed&&this._nextBatch)this.Commit();});}
        return batch;
    }
    RequestCommitAsync(){return this.RequestCompositionBatchCommitAsync().Processed;}
    RequestCompositionUpdate(action){if(typeof action!=='function')throw new TypeError('An update callback is required.');this._updates.push(action);this.RequestCompositionBatchCommitAsync();}
    Commit() {
        if(this._committing)throw new Error('A composition commit cannot be re-entered.');
        if(this.IsDisposed)throw new Error('Compositor is disposed.');
        const batch=this._nextBatch??new CompositionBatch();this._nextBatch=null;this._committing=true;
        try {
            const updates=this._updates.splice(0);for(const action of updates)action();
            const changed=[...this._dirty];this._dirty.clear();for(const object of changed)if(!object.IsDisposed)object._Commit();
            batch.CommittedAt=this.Clock.Now();batch.Revision=++this.Revision;
            this._InvalidateAttachments();if(this.ServerTransport)this.ServerTransport.RequestCommitAsync().then(batch._resolve,batch._reject);else batch._resolve();this.AfterCommit.Raise(this,{Batch:batch,ChangedObjects:changed.length});
        } catch(error){batch._reject(error);this.Errors.Raise(this,{Error:error});}
        finally{this._committing=false;}
        return batch;
    }
    _InvalidateAttachments(){for(const control of this._attachments.keys())if(!control.IsDisposed)control.InvalidateVisual(false);}
    SetServerTransport(transport){
        if(this.ServerTransport===transport)return;this._clock?.Dispose();this._clock=null;this.ServerTransport=transport;
        for(const object of this._objects){object._serverValues=null;object._transportVersion=(object._transportVersion??0)+1;}
        if(!transport&&this._animatedObjects.size)this._EnsureClock();this._InvalidateAttachments();
    }
    _EnsureClock(){if(this.ServerTransport)return;if(!this._clock)this._clock=this.Clock.Subscribe(time=>{for(const object of [...this._animatedObjects]){try{object._Tick(time);}catch(error){object.StopAllAnimations();this.Errors.Raise(this,{Error:error});}}this._InvalidateAttachments();this._ReleaseIdleClock();});}
    _ReleaseIdleClock(){if(!this._animatedObjects.size){this._clock?.Dispose();this._clock=null;}}
    CreateContainerVisual(){return new CompositionContainerVisual(this);}
    CreateSolidColorVisual(color=Colors.Transparent){const v=new CompositionSolidColorVisual(this);v.Color=color;return v;}
    CreateSurfaceVisual(){return new CompositionSurfaceVisual(this);}
    CreateCustomVisual(handler){return new CompositionCustomVisual(this,handler);}
    CreateDrawingSurface(){return new CompositionDrawingSurface(this);}
    CreateColorBrush(color=Colors.Transparent){const brush=new CompositionColorBrush(this);brush.Color=color;return brush;}
    CreateSurfaceBrush(surface=null){const brush=new CompositionSurfaceBrush(this);brush.Surface=surface;return brush;}
    CreatePropertySet(){return new CompositionPropertySet(this);}
    CreateScalarKeyFrameAnimation(){return new ScalarKeyFrameAnimation(this);}
    CreateVector2KeyFrameAnimation(){return new Vector2KeyFrameAnimation(this);}
    CreateVector3KeyFrameAnimation(){return new Vector3KeyFrameAnimation(this);}
    CreateColorKeyFrameAnimation(){return new ColorKeyFrameAnimation(this);}
    CreateExpressionAnimation(expression=''){const animation=new ExpressionAnimation(this);animation.Expression=expression;return animation;}
    CreateAnimationGroup(){return new CompositionAnimationGroup(this);}
    async CreateCompositionVisualSnapshot(visual,scaling=1) {
        if(visual.Compositor!==this)throw new Error('Visual belongs to another Compositor.');
        const platform=this.Platform;if(!platform)throw new Error('A Skia platform must be attached before taking composition snapshots.');
        this.Commit();const S=platform.Api,size=visual._Read('Size');
        const surface=S.SKSurface.Create(new S.SKImageInfo(Math.max(1,Math.ceil(size.X*scaling)),Math.max(1,Math.ceil(size.Y*scaling))));
        const {SkiaDrawingContext}=await import('@wieslawsoltes/avalonia-skia');
        try{surface.Canvas.Clear(S.SKColors.Transparent);surface.Canvas.Scale(scaling,scaling);const context=new SkiaDrawingContext(platform,surface.Canvas,scaling);context.Surface=surface;visual.Render(context);context.Dispose();surface.Flush();const bitmap=new Bitmap(null);bitmap._native=surface.Snapshot();bitmap.PixelSize=new Size(bitmap._native.Width,bitmap._native.Height);return bitmap;}finally{surface.Dispose();}
    }
    Dispose() {
        if (this.IsDisposed) return;
        // Mark disposed before removing objects: removal must not enqueue more commits.
        super.Dispose(); this._clock?.Dispose(); this._clock = null;
        for (const object of [...this._objects]) object.Dispose();
        for (const [control, lifetime] of this._attachments) {
            control._compositionChild = null; control._compositionSelf = null; lifetime.Dispose();
        }
        this._attachments.clear(); this._updates.length = 0; this._dirty.clear(); this._animatedObjects.clear();
        this._nextBatch?._reject(new Error('Compositor disposed before commit.')); this._nextBatch = null;
        this.AfterCommit.Clear(); this.Errors.Clear();
    }
}
export class CompositionVisual extends CompositionObject {
    constructor(compositor){super(compositor);this._parent=null;}
    get Parent(){return this._parent;}
    GetLocalTransform() {
        const offset=this._Read('Offset'),scale=this._Read('Scale'),center=this._Read('CenterPoint');
        const matrix=Matrix.CreateTranslation(-center.X,-center.Y).Multiply(Matrix.CreateScale(scale.X,scale.Y))
            .Multiply(Matrix.CreateRotation(this._Read('RotationAngle'))).Multiply(this._Read('TransformMatrix'))
            .Multiply(Matrix.CreateTranslation(center.X+offset.X,center.Y+offset.Y));
        return matrix;
    }
    _PushState(context, includeTransform = true) {
        const states=includeTransform?[context.PushTransform(this.GetLocalTransform())]:[];const opacity=this._Read('Opacity');if(opacity<1)states.push(context.PushOpacity(opacity));
        const size=this._Read('Size');if(this._Read('ClipToBounds'))states.push(context.PushClip(new Rect(0,0,size.X,size.Y)));
        if(this._Read('Clip'))states.push(context.PushGeometryClip(this._Read('Clip')));if(this._Read('Effect'))states.push(context.PushEffect(this._Read('Effect')));
        return Disposable.Create(()=>{for(const state of states.reverse())state.Dispose();});
    }
    Render(context){if(this.IsDisposed||!this._Read('IsVisible')||this._Read('Opacity')<=0)return;const state=this._PushState(context);try{this._RenderCore(context);}finally{state.Dispose();}}
    _RenderCore(){}
    Dispose(){this.Parent?.Children.Remove(this);super.Dispose();}
}
define(CompositionVisual,{Offset:()=>({X:0,Y:0,Z:0}),Size:()=>new Vector(),Scale:()=>({X:1,Y:1,Z:1}),CenterPoint:()=>({X:0,Y:0,Z:0}),RotationAngle:0,Opacity:1,IsVisible:true,ClipToBounds:false,Clip:null,TransformMatrix:()=>Matrix.Identity,Effect:null});
Object.defineProperty(CompositionVisual.prototype,'RotationAngleInDegrees',{get(){return this.RotationAngle*180/Math.PI;},set(value){this.RotationAngle=Number(value)*Math.PI/180;}});

export class CompositionVisualCollection {
    constructor(owner){this.Owner=owner;this._items=[];this._committed=[];}
    get Count(){return this._items.length;}
    [Symbol.iterator](){return this._items[Symbol.iterator]();}
    Get(index){return this._items[index];}
    Add(visual){this.InsertAtTop(visual);}
    InsertAtTop(visual){this._Insert(this.Count,visual);}
    InsertAtBottom(visual){this._Insert(0,visual);}
    InsertAbove(visual,sibling){const i=this._items.indexOf(sibling);if(i<0)throw new Error('Sibling is not in this collection.');this._Insert(i+1,visual);}
    InsertBelow(visual,sibling){const i=this._items.indexOf(sibling);if(i<0)throw new Error('Sibling is not in this collection.');this._Insert(i,visual);}
    _Insert(index,visual){
        if(!(visual instanceof CompositionVisual)||visual.IsDisposed||visual.Compositor!==this.Owner.Compositor)throw new TypeError('A live visual from the same compositor is required.');
        for(let parent=this.Owner;parent;parent=parent.Parent)if(parent===visual)throw new Error('Composition visual cycle.');
        if(visual.Parent)throw new Error('A composition visual already has a parent.');
        this._items.splice(index,0,visual);visual._parent=this.Owner;this.Owner.Compositor._Dirty(this.Owner);
    }
    Remove(visual){const i=this._items.indexOf(visual);if(i<0)return false;this._items.splice(i,1);visual._parent=null;this.Owner.Compositor._Dirty(this.Owner);return true;}
    RemoveAll(){for(const visual of this._items)visual._parent=null;this._items=[];this.Owner.Compositor._Dirty(this.Owner);}
    Clear(){this.RemoveAll();}
}
export class CompositionContainerVisual extends CompositionVisual {
    constructor(compositor){super(compositor);this.Children=new CompositionVisualCollection(this);}
    _Commit(){super._Commit();this.Children._committed=[...this.Children._items];}
    _RenderCore(context){for(const child of this.Children._committed)child.Render(context);}
    Dispose(){this.Children.RemoveAll();super.Dispose();}
}
export class CompositionSolidColorVisual extends CompositionContainerVisual {
    _RenderCore(context){const s=this._Read('Size');context.DrawRectangle(this._Read('Color'),null,new Rect(0,0,s.X,s.Y));super._RenderCore(context);}
}
define(CompositionSolidColorVisual,{Color:()=>Colors.Transparent});
export class CompositionSurfaceVisual extends CompositionContainerVisual {
    _RenderCore(context){const size=this._Read('Size'),surface=this._Read('Surface'),image=surface?._committedBitmap??surface;if(image)context.DrawImage(image,new Rect(0,0,size.X,size.Y));super._RenderCore(context);}
}
define(CompositionSurfaceVisual,{Surface:null});
export class CompositionCustomVisual extends CompositionVisual {
    constructor(compositor,handler){super(compositor);if(!handler)throw new TypeError('A custom visual handler is required.');this.Handler=handler;handler._visual=this;}
    SendHandlerMessage(message){
        if(this.IsDisposed)throw new Error('Custom visual disposed.');
        if(this.Handler.WorkerModule){
            this._workerMessages??=[];
            if(this._workerMessages.length>=1024)throw new Error('Custom visual message backlog exceeds 1024; await RequestCommitAsync.');
            this._workerMessages.push({Sequence:(this._nextWorkerMessage=(this._nextWorkerMessage??0)+1),Value:message});this.Compositor._Dirty(this);
        }else this.Compositor.RequestCompositionUpdate(()=>{if(!this.IsDisposed){this.Handler.OnMessage?.(message);this.Compositor._Dirty(this);}});
    }
    _RenderCore(context){
        if(!this.Compositor.ServerTransport&&this.Handler.WorkerModule){
            if(this._localWorkerState!==this.Handler.WorkerState){this._localWorkerState=this.Handler.WorkerState;this.Handler.OnStateChanged?.(this.Handler.WorkerState);}
            for(const message of this._workerMessages?.splice(0)??[])this.Handler.OnMessage?.(message.Value);
        }
        this.Handler.OnRender?.(context);
    }
    Dispose(){if(this.IsDisposed)return;this.Handler._frameSubscription?.Dispose();this.Handler.OnDispose?.();super.Dispose();}
}
export class CompositionCustomVisualHandler {
    /** Durable serializable state for worker creation/recovery. Messages are
     * transient and acknowledged; replaying an unbounded event log is forbidden. */
    get WorkerState(){return this._workerState??null;}
    set WorkerState(value){if(Object.is(this._workerState,value))return;this._workerState=value;this.Invalidate();}
    OnStateChanged(){}
    get EffectiveSize(){const size=this._visual?._Read('Size');return new Size(size?.X??0,size?.Y??0);}
    Invalidate(){const v=this._visual;if(v){v.Compositor._Dirty(v);v.Compositor._InvalidateAttachments();}}
    RegisterForNextAnimationFrameUpdate(){const v=this._visual;if(!v||v.IsDisposed)return;const clock=v.Compositor.Clock;let subscription;this._frameSubscription?.Dispose();subscription=clock.Subscribe(time=>{subscription.Dispose();this._frameSubscription=null;if(!v.IsDisposed)this.OnAnimationFrameUpdate?.(time);});this._frameSubscription=subscription;}
    OnMessage(){} OnRender(){} OnAnimationFrameUpdate(){} OnDispose(){}
}
export class CompositionDrawingSurface extends CompositionObject {
    constructor(compositor){super(compositor);this.Size=Size.Empty;this._bitmap=null;this._committedBitmap=null;this._retired=[];}
    Update(bitmap){if(!(bitmap instanceof Bitmap))throw new TypeError('DrawingSurface.Update requires a Bitmap.');if(this._bitmap&&this._bitmap!==this._committedBitmap)this._retired.push(this._bitmap);this._bitmap=bitmap;this.Size=bitmap.PixelSize;this.Compositor._Dirty(this);}
    _Commit(){super._Commit();this._committedBitmap=this._bitmap;this._retired.length=0;}
    // Caller owns externally supplied images. Replacing a surface never disposes them.
    Dispose(){this._bitmap=null;this._committedBitmap=null;this._retired=[];super.Dispose();}
}
export class CompositionBrush extends CompositionObject {}
export class CompositionColorBrush extends CompositionBrush {}
define(CompositionColorBrush,{Color:()=>Colors.Transparent});
export class CompositionSurfaceBrush extends CompositionBrush {}
define(CompositionSurfaceBrush,{Surface:null,Stretch:'Uniform'});
export class CompositionPropertySet extends CompositionObject {
    InsertScalar(name,value){if(!Number.isFinite(value))throw new TypeError('Scalar must be finite.');this._Insert(name,Number(value));}
    InsertVector2(name,value){this._Insert(name,new Vector(value.X,value.Y));}
    InsertVector3(name,value){this._Insert(name,{X:value.X,Y:value.Y,Z:value.Z});}
    InsertColor(name,value){this._Insert(name,Color.Parse(value));}
    _Insert(name,value){if(!/^[A-Za-z]\w*$/.test(name)||name in this&&!Object.hasOwn(this._values,name))throw new RangeError('Invalid property-set key.');this._Set(name,value);}
    TryGetScalar(name){const value=this._values[name];return {Status:typeof value==='number'?'Succeeded':value===undefined?'NotFound':'TypeMismatch',Value:value};}
    GetExpressionValue(name){if(!Object.hasOwn(this._values,name))throw new ReferenceError(`Property '${name}' is not in the property set.`);return this._Read(name);}
}
export class CompositionAnimation extends Disposable {
    constructor(compositor){super();this.Compositor=compositor;this.Target='';this.Duration=1000;this.DelayTime=0;this.IterationCount=1;this.IterationBehavior='Count';this.Direction='Normal';this.StopBehavior='SetToFinalValue';this.Parameters=new Map();}
    SetScalarParameter(name,value){this.Parameters.set(name,Number(value));}
    SetVector2Parameter(name,value){this.Parameters.set(name,new Vector(value.X,value.Y));}
    SetVector3Parameter(name,value){this.Parameters.set(name,{X:value.X,Y:value.Y,Z:value.Z});}
    SetColorParameter(name,value){this.Parameters.set(name,Color.Parse(value));}
    SetReferenceParameter(name,value){if(!(value instanceof CompositionObject)||value.Compositor!==this.Compositor)throw new TypeError('Reference parameter requires an object from this compositor.');this.Parameters.set(name,value);}
    ClearParameter(name){this.Parameters.delete(name);}
    Clone(){const result=Object.assign(Object.create(Object.getPrototypeOf(this)),this);result.Parameters=new Map([...this.Parameters].map(([k,v])=>[k,clone(v)]));if(this.KeyFrames)result.KeyFrames=this.KeyFrames.map(frame=>({...frame,Value:clone(frame.Value)}));return result;}
    Validate(){if(ParseDuration(this.Duration)<0||ParseDuration(this.DelayTime)<0||!Number.isFinite(ParseDuration(this.Duration))||!(this.IterationCount>0))throw new RangeError('Invalid composition animation timing.');}
    _Environment(start,target){return {...Object.fromEntries(this.Parameters),this:{StartingValue:start,CurrentValue:start,Target:target}};}
}
export class KeyFrameAnimation extends CompositionAnimation {
    constructor(compositor){super(compositor);this.KeyFrames=[];}
    InsertKeyFrame(progress,value,easing=null){this._Insert(progress,{Value:clone(value),Easing:easing});}
    InsertExpressionKeyFrame(progress,expression,easing=null){this._Insert(progress,{Expression:new CompositionExpression(expression),Easing:easing});}
    _Insert(progress,frame){if(!Number.isFinite(progress)||progress<0||progress>1)throw new RangeError('Keyframe progress must be in [0,1].');const old=this.KeyFrames.findIndex(f=>f.Progress===progress);if(old>=0)this.KeyFrames.splice(old,1);this.KeyFrames.push({Progress:progress,...frame});this.KeyFrames.sort((a,b)=>a.Progress-b.Progress);}
    Validate(){super.Validate();if(!this.KeyFrames.length)throw new Error('A keyframe animation must contain a frame.');}
    Sample(elapsed,start,target){
        const time=elapsed-ParseDuration(this.DelayTime);if(time<0)return {HasValue:false};
        const duration=ParseDuration(this.Duration),infinite=this.IterationBehavior==='Forever';
        const total=infinite?Infinity:duration*this.IterationCount,done=time>=total;
        let iteration=duration>0?Math.floor(time/duration):0,progress=duration>0?(time%duration)/duration:1;
        if(done){iteration=Math.max(0,this.IterationCount-1);progress=1;}
        if(this.Direction==='Reverse'||this.Direction==='Alternate'&&iteration%2===1||this.Direction==='AlternateReverse'&&iteration%2===0)progress=1-progress;
        const frames=this.KeyFrames[0].Progress>0?[{Progress:0,Value:start},...this.KeyFrames]:this.KeyFrames;
        let a=frames[0],b=frames.at(-1);for(let i=1;i<frames.length;i++)if(progress<=frames[i].Progress){a=frames[i-1];b=frames[i];break;}
        const env=this._Environment(start,target),value=frame=>frame.Expression?frame.Expression.Evaluate(env):frame.Value;
        const fraction=b.Progress===a.Progress?1:Math.max(0,Math.min(1,(progress-a.Progress)/(b.Progress-a.Progress)));
        return {HasValue:true,Value:interpolate(value(a),value(b),b.Easing?.Ease(fraction)??fraction),Done:done};
    }
}
export class ScalarKeyFrameAnimation extends KeyFrameAnimation {}
export class Vector2KeyFrameAnimation extends KeyFrameAnimation {}
export class Vector3KeyFrameAnimation extends KeyFrameAnimation {}
export class ColorKeyFrameAnimation extends KeyFrameAnimation {}
export class ExpressionAnimation extends CompositionAnimation {
    constructor(compositor){super(compositor);this._expression='';this._ast=null;}
    get Expression(){return this._expression;}
    set Expression(value){this._expression=String(value);this._ast=value?new CompositionExpression(value):null;}
    Validate(){if(!this._ast)throw new Error('An expression animation must contain an expression.');}
    Sample(time,start,target){return {HasValue:true,Value:this._ast.Evaluate(this._Environment(start,target)),Done:false};}
}
export class CompositionAnimationGroup extends CompositionAnimation {
    constructor(compositor){super(compositor);this.Animations=[];}
    Add(animation){if(animation.Compositor!==this.Compositor)throw new Error('Animation has a different compositor.');this.Animations.push(animation);}
    [Symbol.iterator](){return this.Animations[Symbol.iterator]();}
}
CompositionObject.prototype.StartAnimationGroup=function(group){for(const animation of group){if(!animation.Target)throw new Error('Grouped animations require a Target.');this.StartAnimation(animation.Target,animation);}};
CompositionObject.prototype.StopAnimationGroup=function(group){for(const animation of group)this.StopAnimation(animation.Target);};

export class CompositionDrawListVisual extends CompositionVisual {
    constructor(compositor,control){super(compositor);this.Control=control;this.Size=new Vector(control.Bounds.Width,control.Bounds.Height);}
}
export class ElementComposition {
    static GetElementVisual(control) {
        if(control._compositionSelf&&!control._compositionSelf.IsDisposed)return control._compositionSelf;
        const root=control.GetVisualRoot();if(!root)return null;
        const compositor=root.Compositor??=new Compositor({ServerTransport:root.Renderer?.CompositionTransport});compositor.Platform=root.Platform;
        const visual=new CompositionDrawListVisual(compositor,control);control._compositionSelf=visual;
        const lifetime=new CompositeDisposable();
        lifetime.Add(control.SizeChanged.Add(()=>{visual.Size=new Vector(control.Bounds.Width,control.Bounds.Height);}));
        lifetime.Add(control.Disposed.Add(()=>{control._compositionSelf=null;control._compositionChild=null;compositor._attachments.delete(control);lifetime.Dispose();visual.Dispose();}));
        compositor._attachments.set(control,lifetime);compositor._Dirty(visual);return visual;
    }
    static SetElementChildVisual(control,visual) {
        const element=this.GetElementVisual(control);
        if(!element)throw new Error('The element must be attached to a TopLevel before attaching a composition visual.');
        if(visual&&(!(visual instanceof CompositionVisual)||visual.Compositor!==element.Compositor||visual.Parent))throw new Error('A parentless visual from the element compositor is required.');
        control._compositionChild=visual;control.InvalidateVisual();
    }
    static GetElementChildVisual(control){return control._compositionChild??null;}
}
