import { CopyCompositionValue, DefaultCompositionValue, ValidateCompositionKey, CompositionValueTypes } from './values.js';
import { Disposable, Event, CompositeDisposable, Point, Vector, Size, Rect, Matrix } from '@wieslawsoltes/avalonia-base';
import { Brush, SolidColorBrush, Color, Colors, Bitmap, IEffect, EffectExtensions } from '@wieslawsoltes/avalonia-media';
import { Clock, ParseDuration, Interpolate, LinearEasing } from '@wieslawsoltes/avalonia-animation';
import { CompositionExpression } from './expression.js';
export { CompositionExpression } from './expression.js';

let objectId=0, animationId=0;
const propertyTypes=new WeakMap();
function propertyType(object,name) {
    if(object instanceof CompositionPropertySet)return object._types.get(name);
    for(let p=Object.getPrototypeOf(object);p;p=Object.getPrototypeOf(p)) {
        const properties=propertyTypes.get(p);if(properties?.has(name))return properties.get(name);
    }
}
function equalValue(a,b,type) {
    if(Object.is(a,b))return true;
    if(a instanceof IEffect&&b instanceof IEffect)return EffectExtensions.EffectEquals(a,b);
    return !!type && a!=null && b!=null && typeof a==='object' && typeof b==='object'
        && Object.keys(a).length===Object.keys(b).length && Object.keys(a).every(k=>Object.is(a[k],b[k]));
}
function presentationValue(target,state,time,current) {
    const value=state.Component?current?.[state.Component]:current;
    return state.Animation.Sample(Math.max(0,time-state.StartedAt),state.Start,target,state.FinalValue,value);
}
const clone=value=>{
    if(value==null||typeof value!=='object'||value instanceof CompositionObject||value instanceof Bitmap||value instanceof Brush)return value;
    if(value instanceof IEffect)return EffectExtensions.ToImmutable(value);
    if(value instanceof Color)return new Color(value.A,value.R,value.G,value.B);
    if(value instanceof Matrix)return new Matrix(value.M11,value.M12,value.M21,value.M22,value.M31,value.M32);
    if(value instanceof Size)return new Size(value.Width,value.Height);
    if(value instanceof Point)return new value.constructor(value.X,value.Y);
    if(Array.isArray(value))return value.map(clone);
    return Object.fromEntries(Object.entries(value).map(([key,val])=>[key,clone(val)]));
};
function define(type,properties) {
    const types=new Map();propertyTypes.set(type.prototype,types);
    for(const [name,initial] of Object.entries(properties)) {
        const sample=typeof initial==='function'?initial():initial;
        const valueType=typeof sample==='number'?'Scalar':typeof sample==='boolean'?'Boolean':sample instanceof Color?'Color'
            :sample instanceof Matrix?'Matrix3x2':sample instanceof Point?'Vector2':sample&&'Z' in Object(sample)?'Vector3':null;
        types.set(name,valueType);
        Object.defineProperty(type.prototype,name,{configurable:true,enumerable:true,
            get(){const value=Object.hasOwn(this._values,name)?this._values[name]:typeof initial==='function'?this._values[name]=initial():initial;
                // Public struct reads are snapshots; internal committed reads stay allocation-free.
                return valueType&&value!=null&&typeof value==='object'?clone(value):value;},
            set(value){this._Set(name,value,valueType);}
        });
    }
}
function interpolate(a,b,t) {
    if(t===0)return clone(a);if(t===1)return clone(b);
    if(a&&b&&typeof a==='object'&&typeof b==='object'&&Object.hasOwn(a,'X')&&Object.hasOwn(a,'Z'))return {X:a.X+(b.X-a.X)*t,Y:a.Y+(b.Y-a.Y)*t,Z:a.Z+(b.Z-a.Z)*t};
    return Interpolate(a,b,t);
}
export class CompositionObject extends Disposable {
    constructor(compositor) {
        super();if(!(compositor instanceof Compositor)||compositor.IsDisposed)throw new TypeError('A live Compositor is required.');
        this.Id=++objectId;this.Compositor=compositor;this.Comment='';this._values={};this._committed={};this._animated=new Map();this._animations=new Map();this._instances=new Map();
        compositor._objects.add(this);compositor._Dirty(this);
    }
    get ImplicitAnimations(){return this._implicitAnimations??null;}
    set ImplicitAnimations(value) {
        if(this.IsDisposed)throw new Error('Composition object is disposed.');
        if(value!=null&&(!(value instanceof ImplicitAnimationCollection)||value.IsDisposed||value.Compositor!==this.Compositor))
            throw new TypeError('Implicit animations require a live collection from this compositor.');
        if(this._implicitAnimations===value)return;
        this._implicitAnimations?._owners.delete(this);this._implicitAnimations=value??null;value?._owners.add(this);
    }
    _Set(name,value,type=propertyType(this,name)) {
        if(this.IsDisposed)throw new Error('Composition object is disposed.');
        if(value instanceof CompositionObject&&(value.IsDisposed||value.Compositor!==this.Compositor))throw new Error('Composition resources must belong to the same live Compositor.');
        if(name==='Effect'&&value!=null&&!(value instanceof IEffect))throw new TypeError('Composition effects must implement IEffect.');
        const desired=type?CopyCompositionValue(type,value):clone(value);
        const before=Object.hasOwn(this._values,name)?this._values[name]:this[name];
        if(equalValue(before,desired,type))return;
        const trigger=this._implicitAnimations?._items.get(name);
        // A malformed trigger must not publish either a new base value or a partially started group.
        const states=trigger?this._PrepareGroup(trigger,this.Compositor.Clock.Now(),name,desired):[];
        for(const state of [...this._instances.values()])if(state.Property===name)this.StopAnimation(state.Name);
        this._animated.delete(name);this._serverValues?.delete(name);this._values[name]=desired;
        for(const state of states)this._InstallAnimation(state);
        this.Compositor._Dirty(this);if(states.length)this.Compositor._EnsureClock();
    }
    _Commit() {
        // Materialize default properties as part of the immutable value snapshot.
        for(let proto=Object.getPrototypeOf(this);proto&&proto!==CompositionObject.prototype;proto=Object.getPrototypeOf(proto))
            for(const name of Object.getOwnPropertyNames(proto))if(Object.getOwnPropertyDescriptor(proto,name)?.get&&name!=='Parent')void this[name];
        this._committed=Object.fromEntries(Object.entries(this._values).map(([key,value])=>[key,clone(value)]));
    }
    _Read(name){return this._serverValues?.has(name)?this._serverValues.get(name):this._animated.has(name)?this._animated.get(name):Object.hasOwn(this._committed,name)?this._committed[name]:Object.hasOwn(this._values,name)?this._values[name]:this[name];}
    GetExpressionValue(name) {
        if(name.startsWith('_')||['constructor','prototype','__proto__'].includes(name)||!(name in this))throw new ReferenceError(`Composition member '${name}' is not available.`);
        return this._Read(name);
    }
    _PresentationAt(property,time) {
        let value=clone(this._Read(property));
        // Sample without advancing the live instances: failed group preparation is side-effect free.
        if(!this.Compositor.ServerTransport)for(const state of this._animations.values())if(state.Property===property) {
            const sample=presentationValue(this,state,time,value);
            if(sample.HasValue)value=state.Component?{...value,[state.Component]:sample.Value}:clone(sample.Value);
        }
        return value;
    }
    _PrepareAnimation(propertyName, animation, startedAt, finalValue, hasFinalValue=false, implicit=false) {
        if(this.IsDisposed)throw new Error('Composition object is disposed.');
        if(!(animation instanceof CompositionAnimation)||animation.IsDisposed||animation.Compositor!==this.Compositor)
            throw new TypeError('A live animation from the same compositor is required.');
        const [property,component,...rest]=String(propertyName).split('.'),type=propertyType(this,property);
        if(rest.length||!type||component&&!['X','Y','Z','W'].includes(component))throw new RangeError(`Invalid animation property '${propertyName}'.`);
        animation.Validate();
        const base=this._PresentationAt(property,startedAt);
        if(component&&!Number.isFinite(base?.[component]))throw new RangeError(`Invalid animation component '${propertyName}'.`);
        const valueType=component?'Scalar':type;
        if(animation.ValueType&&animation.ValueType!==valueType)throw new TypeError(`Animation ${animation.ValueType} cannot target ${valueType} '${propertyName}'.`);
        const start=clone(component?base[component]:base),final=hasFinalValue?CopyCompositionValue(valueType,finalValue):clone(start);
        if(!Number.isSafeInteger(animationId+1))throw new RangeError('Animation identity space exhausted.');
        return {Id:++animationId,Name:String(propertyName),Property:property,Component:component,Base:base,Start:start,FinalValue:final,
            HasFinalValue:hasFinalValue,UseServerStartingValue:implicit,ValueType:valueType,Animation:Object.assign(animation.Clone(),{_targetValueType:valueType}),StartedAt:startedAt};
    }
    _InstallAnimation(state) {
        for(const old of [...this._instances.values()])if(old.Property===state.Property&&(!old.Component||!state.Component))this.StopAnimation(old.Name);
        this.StopAnimation(state.Name);this._animations.set(state.Name,state);this._instances.set(state.Name,state);
        // Hold the captured presentation across the base-value commit and before the first tick.
        if(state.Component)this._animated.set(state.Property,{...this._Read(state.Property),[state.Component]:state.Start});
        else this._animated.set(state.Property,clone(state.Start));
        this.Compositor._animatedObjects.add(this);this.Compositor._Dirty(this);
    }
    StartAnimation(propertyName,animation) {
        const state=this._PrepareAnimation(propertyName,animation,this.Compositor.Clock.Now());
        this._InstallAnimation(state);this.Compositor._EnsureClock();
    }
    _PrepareGroup(group,startedAt,trigger,finalValue) {
        const states=[];
        try {
            for(const animation of this._GroupAnimations(group)) {
                if(!animation.Target)throw new Error('Grouped animations require a Target.');
                states.push(this._PrepareAnimation(animation.Target,animation,startedAt,finalValue,animation.Target===trigger,trigger!==undefined));
            }
        }catch(error){for(const state of states)state.Animation.Dispose();throw error;}
        return states;
    }
    StartAnimationGroup(group) {
        const states=this._PrepareGroup(group,this.Compositor.Clock.Now());
        for(const state of states)this._InstallAnimation(state);
        if(states.length)this.Compositor._EnsureClock();
    }
    StopAnimationGroup(group) {
        const targets=this._GroupAnimations(group).map(a=>{if(!a.Target)throw new Error('Grouped animations require a Target.');return a.Target;});
        for(const target of targets)this.StopAnimation(target);
    }
    _GroupAnimations(group) {
        if(!(group instanceof CompositionAnimationGroup || group instanceof CompositionAnimation)||group.IsDisposed||group.Compositor!==this.Compositor)
            throw new TypeError('A live animation or group from this compositor is required.');
        return group instanceof CompositionAnimationGroup ? group.Animations.slice() : [group];
    }
    StopAnimation(name) {
        const state=this._instances.get(name);this._instances.delete(name);this._animations.delete(name);state?.Animation.Dispose();
        const [property,component]=String(name).split('.');
        if(component && this._animated.has(property)) {
            const value=clone(this._Read(property)),base=this._committed[property]??this._values[property]??this[property];
            value[component]=base?.[component];this._animated.set(property,value);
            if(![...this._instances.values()].some(s=>s.Property===property))this._animated.delete(property);
        } else this._animated.delete(state?.Property??property);
        if(!this._animations.size)this.Compositor._animatedObjects.delete(this);
        this.Compositor._Dirty(this);this.Compositor._ReleaseIdleClock();
    }
    StopAllAnimations() {for(const name of [...this._instances.keys()])this.StopAnimation(name);this._animated.clear();}
    _Tick(time) {
        for(const [key,state] of this._animations) {
            const result=presentationValue(this,state,time,this._Read(state.Property));
            if(!result.HasValue)continue;
            if(state.Component){const vector={...this._Read(state.Property)};vector[state.Component]=result.Value;this._animated.set(state.Property,vector);}
            else this._animated.set(state.Property,result.Value);
            if(result.Done){
                this._animations.delete(key);
                if(state.Animation.StopBehavior==='SetToInitialValue') {
                    if(state.Component)this._animated.set(state.Property,{...this._Read(state.Property),[state.Component]:state.Start});
                    else this._animated.set(state.Property,clone(state.Start));
                }
                state.Animation.Dispose();
            }
        }
        if(!this._animations.size)this.Compositor._animatedObjects.delete(this);
    }
    Dispose() {
        if(this.IsDisposed)return;
        this._implicitAnimations?._owners.delete(this);this._implicitAnimations=null;
        this.StopAllAnimations();this.Compositor._objects.delete(this);this.Compositor._dirty.delete(this);this._serverValues=null;super.Dispose();
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
    CreateImplicitAnimationCollection(){return new ImplicitAnimationCollection(this);}
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
        const states = [], unwind = () => { const errors = []; while (states.length) { try { states.pop().Dispose(); } catch (e) { errors.push(e); } } if (errors.length) throw new AggregateError(errors, 'Composition drawing state cleanup failed.'); };
        try {
            if (includeTransform) states.push(context.PushTransform(this.GetLocalTransform()));
            const opacity=this._Read('Opacity'); if(opacity<1) states.push(context.PushOpacity(opacity));
            const size=this._Read('Size'); if(this._Read('ClipToBounds')) states.push(context.PushClip(new Rect(0,0,size.X,size.Y)));
            if(this._Read('Clip')) states.push(context.PushGeometryClip(this._Read('Clip')));
            if(this._Read('Effect')) states.push(context.PushEffect(this._Read('Effect')));
        } catch (error) { try { unwind(); } catch (cleanup) { throw new AggregateError([error,cleanup], 'Composition drawing push failed.'); } throw error; }
        return Disposable.Create(unwind);
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
export const CompositionGetValueStatus = Object.freeze({Succeeded:'Succeeded',TypeMismatch:'TypeMismatch',NotFound:'NotFound'});
export class CompositionPropertySet extends CompositionObject {
    constructor(compositor) { super(compositor); this._types=new Map(); }
    _InsertTyped(name,type,value) {
        ValidateCompositionKey(name);
        if(name in this && !Object.hasOwn(this._values,name))throw new RangeError('Invalid property-set key.');
        value=CopyCompositionValue(type,value);this._Set(name,value,type);this._types.set(name,type);
    }
    _TryGet(name,type) {
        ValidateCompositionKey(name);
        const declared=this._types.get(name),Status=declared===undefined?'NotFound':declared===type?'Succeeded':'TypeMismatch';
        return {Status,Value:Status==='Succeeded'?CopyCompositionValue(type,this._values[name]):DefaultCompositionValue(type)};
    }
    GetExpressionValue(name) {
        ValidateCompositionKey(name);
        if(!Object.hasOwn(this._values,name))throw new ReferenceError(`Property '${name}' is not in the property set.`);
        return clone(this._Read(name));
    }
    Dispose() { if(!this.IsDisposed){this._types.clear();super.Dispose();} }
}
for(const type of CompositionValueTypes) {
    Object.defineProperty(CompositionPropertySet.prototype,`Insert${type}`,{value:function(name,value){this._InsertTyped(name,type,value);}});
    Object.defineProperty(CompositionPropertySet.prototype,`TryGet${type}`,{value:function(name){return this._TryGet(name,type);}});
}
export class CompositionAnimation extends Disposable {
    constructor(compositor){super();this.Compositor=compositor;this.Target='';this.Duration=1000;this.DelayTime=0;this.DelayBehavior='SetInitialValueAfterDelay';this.IterationCount=1;this.IterationBehavior='Count';this.Direction='Normal';this.StopBehavior='SetToFinalValue';this.Parameters=new Map();}
    _SetParameter(name,type,value) {
        if(this.IsDisposed)throw new Error('Composition animation is disposed.');
        this.Parameters.set(ValidateCompositionKey(name),CopyCompositionValue(type,value));
    }
    SetReferenceParameter(name,value) {
        if(this.IsDisposed||!(value instanceof CompositionObject)||value.IsDisposed||value.Compositor!==this.Compositor)
            throw new TypeError('Reference parameter requires a live object from this compositor.');
        this.Parameters.set(ValidateCompositionKey(name),value);
    }
    ClearParameter(name){this.Parameters.delete(ValidateCompositionKey(name));}
    ClearAllParameters(){this.Parameters.clear();}
    Dispose(){if(!this.IsDisposed){this.Parameters.clear();if(this.KeyFrames)this.KeyFrames.length=0;super.Dispose();}}
    Clone(){const result=Object.assign(Object.create(Object.getPrototypeOf(this)),this);result.Parameters=new Map([...this.Parameters].map(([k,v])=>[k,clone(v)]));if(this.KeyFrames)result.KeyFrames=this.KeyFrames.map(frame=>({...frame,Value:clone(frame.Value),Easing:frame.Easing?Object.assign(Object.create(Object.getPrototypeOf(frame.Easing)),frame.Easing):null}));return result;}
    Validate(){
        if(this.IsDisposed)throw new Error('Composition animation is disposed.');
        const duration=ParseDuration(this.Duration),delay=ParseDuration(this.DelayTime);
        if(!Number.isFinite(duration)||duration<0||!Number.isFinite(delay)||delay<0||!Number.isSafeInteger(this.IterationCount)||this.IterationCount<1
            ||!['Count','Forever'].includes(this.IterationBehavior)||!['Normal','Reverse','Alternate','AlternateReverse'].includes(this.Direction)
            ||!['SetToFinalValue','SetToInitialValue','LeaveCurrentValue'].includes(this.StopBehavior)
            ||!['SetInitialValueAfterDelay','SetInitialValueBeforeDelay'].includes(this.DelayBehavior))throw new RangeError('Invalid composition animation timing.');
    }
    _ValidateResult(value){return this._targetValueType||this.ValueType?CopyCompositionValue(this._targetValueType??this.ValueType,value):value;}
    _Environment(start,target,finalValue=start,currentValue=start){return {...Object.fromEntries(this.Parameters),this:{StartingValue:start,CurrentValue:currentValue,FinalValue:finalValue,Target:target}};}
}
export class KeyFrameAnimation extends CompositionAnimation {
    constructor(compositor){super(compositor);this.KeyFrames=[];}
    InsertKeyFrame(progress,value,easing=null){this._Insert(progress,{Value:clone(value),Easing:easing});}
    InsertExpressionKeyFrame(progress,expression,easing=null){this._Insert(progress,{Expression:new CompositionExpression(expression),Easing:easing});}
    _Insert(progress,frame){if(this.IsDisposed)throw new Error('Composition animation is disposed.');if(this.ValueType&&Object.hasOwn(frame,'Value'))frame.Value=CopyCompositionValue(this.ValueType,frame.Value);if(!Number.isFinite(progress)||progress<0||progress>1)throw new RangeError('Keyframe progress must be in [0,1].');const old=this.KeyFrames.findIndex(f=>f.Progress===progress);if(old>=0)this.KeyFrames.splice(old,1);this.KeyFrames.push({Progress:progress,...frame});this.KeyFrames.sort((a,b)=>a.Progress-b.Progress);}
    Validate(){
        super.Validate();if(!this.KeyFrames.length)throw new Error('A keyframe animation must contain a frame.');
        if(this.KeyFrames.length>100000)throw new RangeError('Keyframe budget exceeded.');
        let previous=-1;
        for(const frame of this.KeyFrames){
            if(!Number.isFinite(frame.Progress)||frame.Progress<0||frame.Progress>1||frame.Progress<=previous)throw new RangeError('Keyframes must be strictly ordered in [0,1].');
            if(frame.Expression&&!(frame.Expression instanceof CompositionExpression)||frame.Easing&&typeof frame.Easing.Ease!=='function')throw new TypeError('Invalid keyframe expression or easing.');
            if(!frame.Expression&&this.ValueType)CopyCompositionValue(this.ValueType,frame.Value);
            previous=frame.Progress;
        }
    }
    Sample(elapsed,start,target,finalValue=start,currentValue=start){
        const env=this._Environment(start,target,finalValue,currentValue),value=frame=>frame.Expression?frame.Expression.Evaluate(env):frame.Value;
        const time=elapsed-ParseDuration(this.DelayTime);
        if(time<0)return this.DelayBehavior==='SetInitialValueBeforeDelay'?{HasValue:true,Value:this._ValidateResult(value(this.KeyFrames[0])),Done:false}:{HasValue:false};
        const duration=ParseDuration(this.Duration),infinite=this.IterationBehavior==='Forever';
        const total=infinite?Infinity:duration*this.IterationCount,done=time>=total;
        let iteration=duration>0?Math.floor(time/duration):0,progress=duration>0?(time%duration)/duration:1;
        if(done){iteration=Math.max(0,this.IterationCount-1);progress=1;}
        if(this.Direction==='Reverse'||this.Direction==='Alternate'&&iteration%2===1||this.Direction==='AlternateReverse'&&iteration%2===0)progress=1-progress;
        const frames=this.KeyFrames[0].Progress>0?[{Progress:0,Value:start},...this.KeyFrames]:this.KeyFrames;
        let a=frames[0],b=frames.at(-1);for(let i=1;i<frames.length;i++)if(progress<=frames[i].Progress){a=frames[i-1];b=frames[i];break;}
        const fraction=b.Progress===a.Progress?1:Math.max(0,Math.min(1,(progress-a.Progress)/(b.Progress-a.Progress)));
        return {HasValue:true,Value:this._ValidateResult(interpolate(value(a),value(b),b.Easing?.Ease(fraction)??fraction)),Done:done};
    }
}
export class ScalarKeyFrameAnimation extends KeyFrameAnimation {get ValueType(){return 'Scalar';}}
export class Vector2KeyFrameAnimation extends KeyFrameAnimation {get ValueType(){return 'Vector2';}}
export class Vector3KeyFrameAnimation extends KeyFrameAnimation {get ValueType(){return 'Vector3';}}
export class ColorKeyFrameAnimation extends KeyFrameAnimation {get ValueType(){return 'Color';}}
export class ExpressionAnimation extends CompositionAnimation {
    constructor(compositor){super(compositor);this._expression='';this._ast=null;}
    get Expression(){return this._expression;}
    set Expression(value){this._expression=String(value);this._ast=value?new CompositionExpression(value):null;}
    Validate(){if(!this._ast)throw new Error('An expression animation must contain an expression.');}
    Sample(time,start,target,finalValue=start,currentValue=start){return {HasValue:true,Value:this._ValidateResult(this._ast.Evaluate(this._Environment(start,target,finalValue,currentValue))),Done:false};}
}
for(const type of CompositionValueTypes) Object.defineProperty(CompositionAnimation.prototype,`Set${type}Parameter`,{value:function(name,value){this._SetParameter(name,type,value);}});
/** Client-only grouping resource: running animations are cloned and flattened
 * into normal server animation descriptors, never serialized as a group object. */
export class CompositionAnimationGroup extends CompositionObject {
    constructor(compositor){super(compositor);this.Animations=[];}
    Add(animation){
        if(this.IsDisposed||!(animation instanceof CompositionAnimation)||animation.IsDisposed||animation.Compositor!==this.Compositor)
            throw new TypeError('Animation requires a live group and matching compositor.');
        this.Animations.push(animation);
    }
    Remove(animation){const i=this.Animations.indexOf(animation);if(i<0)return false;this.Animations.splice(i,1);return true;}
    RemoveAll(){this.Animations.length=0;}
    [Symbol.iterator](){return this.Animations[Symbol.iterator]();}
    Dispose(){if(!this.IsDisposed){this.RemoveAll();super.Dispose();}}
}

/** Client-only keyed trigger definitions. Collections borrow animations and can
 * be shared by many targets; every trigger creates independently owned instances. */
export class ImplicitAnimationCollection extends CompositionObject {
    constructor(compositor){super(compositor);this._items=new Map();this._owners=new Set();}
    get Count(){return this._items.size;}
    get Size(){return this.Count;}
    get Keys(){return [...this._items.keys()];}
    get Values(){return [...this._items.values()];}
    _Check(key,animation) {
        if(this.IsDisposed)throw new Error('Implicit animation collection is disposed.');
        ValidateCompositionKey(key);
        if(!(animation instanceof CompositionAnimation||animation instanceof CompositionAnimationGroup)||animation.IsDisposed||animation.Compositor!==this.Compositor)
            throw new TypeError('A live animation or group from this compositor is required.');
    }
    Add(key,animation){this._Check(key,animation);if(this._items.has(key))throw new Error(`Duplicate implicit animation key '${key}'.`);this._items.set(key,animation);}
    Insert(key,animation){this.Add(key,animation);}
    Set(key,animation){this._Check(key,animation);this._items.set(key,animation);}
    Get(key){ValidateCompositionKey(key);if(!this._items.has(key))throw new RangeError(`Implicit animation '${key}' was not found.`);return this._items.get(key);}
    Lookup(key){ValidateCompositionKey(key);return this._items.get(key)??null;}
    ContainsKey(key){ValidateCompositionKey(key);return this._items.has(key);}
    HasKey(key){return this.ContainsKey(key);}
    TryGetValue(key){return {Found:this.ContainsKey(key),Value:this.Lookup(key)};}
    Remove(key){if(this.IsDisposed)throw new Error('Implicit animation collection is disposed.');ValidateCompositionKey(key);return this._items.delete(key);}
    Clear(){if(this.IsDisposed)throw new Error('Implicit animation collection is disposed.');this._items.clear();}
    GetView(){return new ImplicitAnimationView(this._items);}
    [Symbol.iterator](){return this._items[Symbol.iterator]();}
    get(key){return this.Lookup(key);}
    set(key,animation){this.Set(key,animation);return this;}
    has(key){return this.ContainsKey(key);}
    delete(key){return this.Remove(key);}
    clear(){this.Clear();}
    Dispose(){if(this.IsDisposed)return;for(const owner of this._owners)owner._implicitAnimations=null;this._owners.clear();this._items.clear();super.Dispose();}
}
class ImplicitAnimationView {
    #items;
    constructor(items){this.#items=new Map(items);Object.freeze(this);}
    get Count(){return this.#items.size;}
    get Size(){return this.Count;}
    get Keys(){return [...this.#items.keys()];}
    get Values(){return [...this.#items.values()];}
    Get(key){if(!this.#items.has(key))throw new RangeError('Implicit animation key was not found.');return this.#items.get(key);}
    Lookup(key){return this.#items.get(key)??null;}
    HasKey(key){return this.#items.has(key);}
    ContainsKey(key){return this.HasKey(key);}
    TryGetValue(key){return {Found:this.HasKey(key),Value:this.Lookup(key)};}
    get(key){return this.Lookup(key);}
    has(key){return this.HasKey(key);}
    [Symbol.iterator](){return this.#items[Symbol.iterator]();}
}

export class CompositionDrawListVisual extends CompositionVisual {
    constructor(compositor,control){super(compositor);this.Control=control;this.Size=new Vector(control.Bounds.Width,control.Bounds.Height);this.Offset={X:control.Bounds.X,Y:control.Bounds.Y,Z:0};}
    GetRenderTransform(bounds){return this.GetLocalTransform().Multiply(Matrix.CreateTranslation(-bounds.X,-bounds.Y));}
    Dispose(){
        if(this.IsDisposed)return;const control=this.Control;this._attachmentLifetime?.Dispose();this._attachmentLifetime=null;
        if(control?._compositionSelf===this){control._compositionSelf=null;control._compositionChild=null;this.Compositor._attachments.delete(control);control.InvalidateVisual();}
        this.Control=null;super.Dispose();
    }
}
export class ElementComposition {
    static GetElementVisual(control) {
        if(control._compositionSelf&&!control._compositionSelf.IsDisposed)return control._compositionSelf;
        const root=control.GetVisualRoot();if(!root)return null;
        const compositor=root.Compositor??=new Compositor({ServerTransport:root.Renderer?.CompositionTransport});compositor.Platform=root.Platform;
        const visual=new CompositionDrawListVisual(compositor,control);control._compositionSelf=visual;
        const lifetime=new CompositeDisposable();
        visual._attachmentLifetime=lifetime;
        lifetime.Add(control.SizeChanged.Add(()=>{visual.Offset={X:control.Bounds.X,Y:control.Bounds.Y,Z:0};visual.Size=new Vector(control.Bounds.Width,control.Bounds.Height);}));
        lifetime.Add(control.Disposed.Add(()=>visual.Dispose()));
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
