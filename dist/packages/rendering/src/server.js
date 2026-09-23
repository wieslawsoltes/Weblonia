import { Event, Disposable, Point, Vector, Size, Rect, Matrix } from '@wieslawsoltes/avalonia-base';
import { Color } from '@wieslawsoltes/avalonia-media';
import { CompositionResourceResolver } from './resources.js';
import { ServerScrollController } from './scrolling.js';
import { ReplayDrawingCommands, DrawingOpcode } from './recording.js';
import { CompositionProtocolError, SameCompositionValue } from './protocol.js';
import { CompositionReferenceIndex } from './references.js';
import { CompositionExpression, ScalarKeyFrameAnimation, Vector2KeyFrameAnimation, Vector3KeyFrameAnimation, ColorKeyFrameAnimation, ExpressionAnimation } from '@wieslawsoltes/avalonia-composition';
import * as Easings from '@wieslawsoltes/avalonia-animation';

const fail = message => { throw new CompositionProtocolError(message); };
const finite = values => Array.isArray(values) && values.every(Number.isFinite);
const visualTypes = new Set(['CompositionContainerVisual','CompositionSolidColorVisual','CompositionSurfaceVisual','CompositionCustomVisual','CompositionDrawListVisual']);
const objectTypes = new Set([...visualTypes,'CompositionDrawingSurface','CompositionColorBrush','CompositionSurfaceBrush','CompositionPropertySet']);
const animationTypes = { ScalarKeyFrameAnimation, Vector2KeyFrameAnimation, Vector3KeyFrameAnimation, ColorKeyFrameAnimation, ExpressionAnimation };
const valueTypes=new Set(['Scalar','Boolean','Color','Vector2','Vector3','Vector4','Quaternion','Matrix3x2','Matrix4x4']);
const plainId = id => Number.isSafeInteger(id) && id > 0;
function validateCommands(commands) {
    if (!Array.isArray(commands) || commands.length > 200000) fail('Invalid display list.'); let depth = 0;
    for (const command of commands) {
        if (!Array.isArray(command) || !Number.isInteger(command[0]) || command[0] < 1 || command[0] > 11) fail('Invalid drawing opcode.');
        if (command[0] === DrawingOpcode.Push) { if (!['Transform','Clip','GeometryClip','Opacity','Effect','OpacityMask'].includes(command[1]) || ++depth > 96) fail('Invalid drawing push.'); }
        if (command[0] === DrawingOpcode.Pop && --depth < 0) fail('Display-list pop underflow.');
    }
    if (depth) fail('Display-list state leak.');
}
function acyclic(map, children, name) {
    const active = new Set(), seen = new Set();
    const visit = (id, depth) => {
        if (depth > 512) fail(`${name} exceeds maximum depth.`);
        if (active.has(id)) fail(`${name} contains a cycle.`); if (seen.has(id)) return;
        const item = map.get(id); if (!item) fail(`Missing ${name} child ${id}.`);
        active.add(id); for (const child of children(item)) visit(child, depth + 1); active.delete(id); seen.add(id);
    };
    for (const id of map.keys()) visit(id, 0);
}
const nodeFields = new Set(['Version','FontVersion','Bounds','Transform','IsVisible','Opacity','ClipToBounds','Clip','Effect',
    'CacheScale','Children','Before','After','Scroll','ScrollBar','SelfComposition','ChildComposition','ContentVersion','ContentWidth','ContentHeight','Resources']);
const updateMap = (old, changes, full, patches = false) => {
    if (!changes || !Array.isArray(changes.Upsert) || !Array.isArray(changes.Remove) || changes.Patch != null && (!patches || !Array.isArray(changes.Patch))) fail('Malformed composition delta.');
    const map = new Map(full ? [] : old), ids = new Set();
    for (const id of changes.Remove) { if (!plainId(id) || ids.has(id)) fail('Invalid or duplicate removed id.'); ids.add(id); map.delete(id); }
    for (const value of changes.Upsert) { if (!value || !plainId(value.Id) || ids.has(value.Id)) fail('Invalid or duplicate updated id.'); ids.add(value.Id); map.set(value.Id, value); }
    for (const patch of changes.Patch ?? []) {
        if (full || !plainId(patch?.Id) || ids.has(patch.Id) || !map.has(patch.Id)) fail('Invalid or duplicate patched id.');
        if (!patch.Set || Array.isArray(patch.Set) || ![Object.prototype, null].includes(Object.getPrototypeOf(patch.Set))) fail('Invalid visual patch.');
        for (const key of Object.keys(patch.Set)) if (!nodeFields.has(key)) fail(`Invalid visual patch field '${key}'.`);
        ids.add(patch.Id); map.set(patch.Id, { ...map.get(patch.Id), ...patch.Set });
    }
    if (map.size > 100000) fail('Scene-object budget exceeded.'); return map;
};
const idsChanged = (changes, old) => changes.Remove.length > 0 || changes.Upsert.some(x => !old.has(x.Id));
const updatedIds = changes => new Set([...changes.Upsert.map(x => x.Id), ...(changes.Patch ?? []).map(x => x.Id)]);
const metadataMap = (old, changes, full) => { const result = new Map(full ? [] : old); for (const id of changes.Remove) result.delete(id); return result; };
const makeMatrix = values => new Matrix(...values);
const popAll = states => { for (let i = states.length - 1; i >= 0; --i) states[i].Dispose(); };
const sameState = (a,b) => !!a && a.Name===b.Name && (b.Id!==undefined ? a.Id===b.Id : a.Id===undefined&&a.StartedAt===b.StartedAt);
const componentValue=(state,value)=>state.Component?value?.[state.Component]:value;
const writeAnimated=(map,values,state,value)=>map.set(state.Property,state.Component?{...(map.get(state.Property)??values[state.Property]),[state.Component]:value}:value);
const sampleState=(target,state,epoch,current)=>state.Animation.Sample(Math.max(0,epoch-state.StartedAt),state.Start,target,state.FinalValue,componentValue(state,current));

/** Server-owned composition objects contain no Avalonia property store, bindings,
 * controls or DOM references. All reads here are from committed scalar state. */
class ServerCompositionObject {
    constructor(id, scene) { this.Id = id; this.Scene = scene; this.Values = {}; this.Animated = new Map(); this.Animations = new Map(); this.Instances = new Map(); this.Children = []; }
    Read(name) { return this.Animated.has(name) ? this.Animated.get(name) : this.Values[name]; }
    GetExpressionValue(name) { if (['__proto__','prototype','constructor'].includes(name) || !(name in this.Values)) throw new ReferenceError(`Unknown composition member ${name}.`); return this.Read(name); }
    Transform() {
        const o = this.Read('Offset'), s = this.Read('Scale'), c = this.Read('CenterPoint');
        return Matrix.CreateTranslation(-c.X, -c.Y).Multiply(Matrix.CreateScale(s.X, s.Y)).Multiply(Matrix.CreateRotation(this.Read('RotationAngle')))
            .Multiply(this.Read('TransformMatrix')).Multiply(Matrix.CreateTranslation(c.X + o.X, c.Y + o.Y));
    }
    Push(context, withTransform = true) {
        const states = withTransform ? [context.PushTransform(this.Transform())] : [];
        if (this.Read('Opacity') < 1) states.push(context.PushOpacity(this.Read('Opacity')));
        const size = this.Read('Size'); if (this.Read('ClipToBounds')) states.push(context.PushClip(new Rect(0, 0, size.X, size.Y)));
        if (this.Read('Clip')) states.push(context.PushGeometryClip(this.Read('Clip')));
        if (this.Read('Effect')) states.push(context.PushEffect(this.Read('Effect')));
        return Disposable.Create(() => popAll(states));
    }
    Render(context) {
        if (!this.Read('IsVisible') || this.Read('Opacity') <= 0 || !visualTypes.has(this.Type)) return;
        const state = this.Push(context);
        try {
            if (this.Type === 'CompositionSolidColorVisual') { const s = this.Read('Size'); context.DrawRectangle(this.Read('Color'), null, new Rect(0, 0, s.X, s.Y)); }
            if (this.Type === 'CompositionSurfaceVisual') { const s = this.Read('Size'), source = this.Read('Surface'), image = source?.Bitmap ?? source; if (image) context.DrawImage(image, new Rect(0, 0, s.X, s.Y)); }
            if (this.Commands) ReplayDrawingCommands(this.Commands, context);
            if (this.CustomHandler) {
                // Registered custom handlers may use native canvas methods directly.
                // Do not assume their native state is represented by portable pushes.
                const cached = context.CacheDeviceClip; context.CacheDeviceClip = false;
                try { this.CustomHandler.OnRender?.(context); }
                finally { context.InvalidateNativeState?.(); context.CacheDeviceClip = cached; }
            }
            for (const child of this.Children) this.Scene.CompositionObjects.get(child)?.Render(context);
        } finally { state.Dispose(); }
    }
    PresentationAt(property,epoch) {
        let value=this.Read(property);
        for(const state of this.Animations.values())if(state.Property===property) {
            const sample=sampleState(this,state,epoch,value);
            if(sample.HasValue)value=state.Component?{...value,[state.Component]:sample.Value}:sample.Value;
        }
        return value;
    }
    Tick(epoch) {
        let changed=false;
        for(const [name,state] of this.Animations) {
            const sample=sampleState(this,state,epoch,this.Read(state.Property));
            if(sample.HasValue){state.HasValue=true;state.LastValue=sample.Value;writeAnimated(this.Animated,this.Values,state,sample.Value);changed=true;}
            if(sample.Done) {
                state.Done=true;this.Animations.delete(name);
                if(state.Animation.StopBehavior==='SetToInitialValue'){state.LastValue=state.Start;state.HasValue=true;writeAnimated(this.Animated,this.Values,state,state.Start);}
                // Keep only bounded identity/presentation metadata for descriptors
                // still present on the UI side. An unrelated commit must not replay a finished run.
                state.Animation.Dispose();
            }
        }
        if(this.CustomHandler?._nextFrame){this.CustomHandler._nextFrame=false;this.CustomHandler.OnAnimationFrameUpdate?.(epoch);changed=true;}
        return changed;
    }
    Dispose(){this.CustomHandler?.OnDispose?.();for(const state of this.Instances.values())state.Animation.Dispose();this.Instances.clear();this.Animations.clear();this.Animated.clear();}

}
class ServerVisual {
    constructor(id, scene) { this.VisualId = id; this.Scene = scene; this.Disposed = new Event(); this.IsDisposed = false; this.IsArrangeValid = true; this.IsAttachedToVisualTree = true; }
    get Bounds() { return this._bounds; }
    get _renderVersion() {
        // Server animations/resources can mutate pixels without a UI descriptor
        // replacement. A lazy numeric stamp avoids stale cached terminal frames
        // without walking the static visual tree on every compositor tick.
        if (this._cacheDescriptor !== this.Descriptor || this._cacheEpoch !== this.Scene._dynamicContentVersion) {
            this._cacheDescriptor = this.Descriptor; this._cacheEpoch = this.Scene._dynamicContentVersion;
            this._cacheStamp = ++this.Scene._nextCacheStamp;
        }
        return this._cacheStamp;
    }
    get CacheMode() { return { RenderAtScale: this.Descriptor.CacheScale }; }
    GetLocalTransform() {
        const c = this.Descriptor.SelfComposition == null ? null : this.Scene.CompositionObjects.get(this.Descriptor.SelfComposition);
        const base=c?(c.Type==='CompositionDrawListVisual'?c.Transform().Multiply(Matrix.CreateTranslation(-this.Bounds.X,-this.Bounds.Y)):c.Transform()).Multiply(this._transform):this._transform;
        if (!this.Scene.ScrollController.Adjustments.size) return base;
        const scroll=this.Scene.ScrollController.Transform(this.VisualId);return scroll?base.Multiply(scroll):base;
    }
    _RenderContents(context) {
        const n = this.Descriptor, scene = this.Scene;
        let before=this.Before;
        if(n.ScrollBar){
            const delta=scene.ScrollController.BarDelta(n.ScrollBar);
            if(delta){
                if(!this._thumbCommands||this._thumbSource!==this.Before){this._thumbSource=this.Before;this._thumbCommands=this.Before.map(c=>c.slice());this._thumbIndex=this.Before.findLastIndex(c=>c[0]===DrawingOpcode.Rectangle);this._thumbDelta=NaN;}
                if(this._thumbIndex>=0){if(delta!==this._thumbDelta){const r=this.Before[this._thumbIndex][3];this._thumbCommands[this._thumbIndex][3]=new Rect(r.X+(n.ScrollBar.Horizontal?delta:0),r.Y+(n.ScrollBar.Horizontal?0:delta),r.Width,r.Height);this._thumbDelta=delta;}before=this._thumbCommands;}
            }
        }
        ReplayDrawingCommands(before, context);
        for (let i = 0; i < this.Children.length; ++i) {
            const { Visual, Clip } = this.Children[i], state = Clip ? context.PushClip(Clip) : null;
            try { Visual.RenderTree(context); } finally { state?.Dispose(); }
        }
        if (n.ChildComposition) scene.CompositionObjects.get(n.ChildComposition)?.Render(context);
        ReplayDrawingCommands(this.After, context);
    }
    RenderTree(context) {
        const n = this.Descriptor, scene = this.Scene, comp = n.SelfComposition == null ? null : scene.CompositionObjects.get(n.SelfComposition);
        if (!n.IsVisible || n.Opacity <= 0 || this.IsDisposed || comp && (!comp.Read('IsVisible') || comp.Read('Opacity') <= 0)) return;
        ++scene.Statistics.VisualsVisited;
        const localTransform = this.GetLocalTransform(), states = [];
        // Exact identity only: no rounding, quantization, or pixel-grid changes.
        if (!localTransform.IsIdentity) states.push(context.PushTransform(localTransform));
        else ++scene.Statistics.IdentityTransformsSkipped;
        if (comp) states.push(comp.Push(context, false));
        if (n.Opacity < 1) states.push(context.PushOpacity(n.Opacity));
        if (n.ClipToBounds) states.push(context.PushClip(this._localBounds));
        if (this.Clip) states.push(context.PushGeometryClip(this.Clip));
        if (this.Effect) states.push(context.PushEffect(this.Effect));
        try {
            const clip = context.GetDeviceClipBounds?.() ?? context.Canvas?.DeviceClipBounds;
            if (clip && (clip.Width <= 0 || clip.Height <= 0)) { ++scene.Statistics.ClippedBranches; return; }
            if (!n.CacheScale || scene.HasAnimations || scene.ScrollController.Adjustments.size || !context.DrawVisualCache?.(this)) this._RenderContents(context);
        } finally { popAll(states); }
    }
    Dispose() { if (this.IsDisposed) return; this.IsDisposed = true; this.Disposed.Raise(this, {}); this.Disposed.Clear(); }
}
export class ServerCompositionScene {
    constructor(platform, { HandlerModules = [], MaxSurfacePixels = 32 * 1024 * 1024 } = {}) {
        this.Platform = platform;this.ScrollController=new ServerScrollController(this); this.HandlerModules = new Set(HandlerModules); this.MaxSurfacePixels = MaxSurfacePixels;
        this.Nodes = new Map(); this.Resources = new Map(); this.Composition = new Map(); this.Visuals = new Map(); this.CompositionObjects = new Map();
        this.Resolver = new CompositionResourceResolver(platform, id => this.Visuals.get(id)); this.Sequence = 0; this.Generation = 0;
        this._references = new CompositionReferenceIndex({ Seal: true });
        this._validation = { Nodes: new Map(), Resources: new Map(), Composition: new Map(), ReverseResources: new Map() };
        this._dynamicContentVersion = 0; this._nextCacheStamp = 0;
        this._fonts = new Map(); this.Statistics = { ValidatedDescriptors: 0, ReferenceChecks: 0, GraphChecks: 0, ValidationMilliseconds: 0, TotalValidationMilliseconds: 0, TotalApplyMilliseconds: 0, IdentityTransformsSkipped: 0, Transactions: 0, ContentInstalls: 0, VisualsVisited: 0, ClippedBranches: 0, AnimationTicks: 0, ApplyMilliseconds: 0 };
    }
    _validate(batch) {
        const started = performance.now();
        if (batch.Generation < this.Generation) fail('Stale scene generation.');
        if (!batch.Full && (batch.Generation !== this.Generation || batch.BaseSequence !== this.Sequence || batch.Sequence !== this.Sequence + 1)) fail('Composition sequence gap; a full resynchronization is required.');
        if (batch.Full && (batch.Sequence < 1 || batch.Generation === this.Generation && batch.Sequence <= this.Sequence)) fail('Invalid full scene sequence.');
        const s = batch.Value;
        if(s.InputSequence!==undefined&&(!Number.isSafeInteger(s.InputSequence)||s.InputSequence<0))fail('Invalid input acknowledgement.');
        if (![s.Width, s.Height, s.Scale].every(n => Number.isFinite(n) && n > 0) || Math.round(s.Width * s.Scale) * Math.round(s.Height * s.Scale) > this.MaxSurfacePixels) fail('Invalid or oversized composition surface.');
        const nodes = updateMap(this.Nodes, s.Nodes, batch.Full, true), resources = updateMap(this.Resources, s.Resources, batch.Full), composition = updateMap(this.Composition, s.Composition, batch.Full);
        if (!nodes.has(s.Root)) fail('Composition root is missing.');
        const dirtyNodes = updatedIds(s.Nodes), dirtyResources = updatedIds(s.Resources), dirtyComposition = updatedIds(s.Composition);
        const metadata = {
            Nodes: metadataMap(this._validation.Nodes, s.Nodes, batch.Full),
            Resources: metadataMap(this._validation.Resources, s.Resources, batch.Full),
            Composition: metadataMap(this._validation.Composition, s.Composition, batch.Full),
            ReverseResources: this._validation.ReverseResources,
        };
        let nodeGraphChanged = batch.Full || idsChanged(s.Nodes, this.Nodes), resourceGraphChanged = batch.Full || idsChanged(s.Resources, this.Resources),
            compositionGraphChanged = batch.Full || idsChanged(s.Composition, this.Composition);
        for (const id of dirtyNodes) {
            const node = nodes.get(id), old = this.Nodes.get(id), prior = this._validation.Nodes.get(id);
            if (!finite(node.Transform) || node.Transform.length !== 6 || !finite(node.Bounds) || node.Bounds.length !== 4 || node.Bounds[2] < 0 || node.Bounds[3] < 0 || !Number.isFinite(node.Opacity) || node.Opacity < 0 || node.Opacity > 1 || !Array.isArray(node.Children)) fail('Invalid visual descriptor.');
            // Retained display lists were already validated and sealed. A patch
            // cannot mutate those arrays; replacement commands are fully checked.
            if (!old || old.Before !== node.Before) validateCommands(node.Before);
            if (!old || old.After !== node.After) validateCommands(node.After);
            if(node.Scroll){const p=node.Scroll;if(!finite(p.Offset)||p.Offset.length!==2||!finite(p.Extent)||!finite(p.Viewport)||!finite(p.Region)||p.Region.length!==4||!finite(p.CoverageY)||!Array.isArray(p.Content)||!Array.isArray(p.Headers)||[...p.Content,...p.Headers].some(id=>!nodes.has(id)))fail('Invalid scroll coverage contract.');}
            if(node.ScrollBar&&(!Number.isFinite(node.ScrollBar.Range)||!Number.isFinite(node.ScrollBar.Travel)))fail('Invalid scrollbar contract.');
            for (const child of node.Children) if (!plainId(child.Id) || child.Clip && (!finite(child.Clip) || child.Clip.length !== 4)) fail('Invalid visual child ownership/clip.');
            const info = { Data: node, References: this._references.Get(node), Children: node.Children.map(c => c.Id) };
            if (!prior || !SameCompositionValue(prior.Children, info.Children) || !SameCompositionValue(prior.References.Visuals, info.References.Visuals)) nodeGraphChanged = true;
            metadata.Nodes.set(id, info); ++this.Statistics.ValidatedDescriptors;
        }
        for (const id of dirtyResources) {
            const entry = resources.get(id), prior = this._validation.Resources.get(id);
            if (!['Text','Image','Geometry','Font','GlyphTypeface','GlyphRun'].includes(entry.Kind) || !Array.isArray(entry.Depends) || entry.Depends.some(x=>!plainId(x))) fail('Invalid resource descriptor.');
            if (entry.Kind === 'Image' && entry.Data.Pixels && (!Number.isSafeInteger(entry.Data.Width) || !Number.isSafeInteger(entry.Data.Height) || entry.Data.Width < 1 || entry.Data.Height < 1 || entry.Data.Pixels.byteLength !== entry.Data.Width * entry.Data.Height * 4)) fail('Invalid image dimensions/pixels.');
            const references = this._references.Get(entry), edges = [...new Set([...entry.Depends, ...references.Resources])];
            if (!prior || !SameCompositionValue(prior.Children, edges)) resourceGraphChanged = true;
            metadata.Resources.set(id, { Data: entry, References: references, Children: edges }); ++this.Statistics.ValidatedDescriptors;
        }
        for (const id of dirtyComposition) {
            const c = composition.get(id), prior = this._validation.Composition.get(id);
            if (!objectTypes.has(c.Type) || !Array.isArray(c.Children) || c.Children.some(x=>!plainId(x)) || !Array.isArray(c.Animations)) fail('Invalid composition object.');
            if(c.PropertyTypes!=null&&(c.Type!=='CompositionPropertySet'||Array.isArray(c.PropertyTypes)||typeof c.PropertyTypes!=='object'||Object.entries(c.PropertyTypes).some(([k,v])=>!Object.hasOwn(c.Values,k)||!valueTypes.has(v))))fail('Invalid property-set type metadata.');
            if (c.Commands && c.Commands !== this.Composition.get(id)?.Commands) validateCommands(c.Commands);
            const info = { Data: c, References: this._references.Get(c), Children: c.Children };
            if (!prior || !SameCompositionValue(prior.Children, c.Children)) compositionGraphChanged = true;
            metadata.Composition.set(id, info); ++this.Statistics.ValidatedDescriptors;
        }
        const check = (ids, targets, label) => { for (const id of ids) { ++this.Statistics.ReferenceChecks; if (!plainId(id) || !targets.has(id)) fail(`Missing ${label} ${id}.`); } };
        // Addition-only transactions cannot invalidate unchanged references. On
        // removal, recheck cached adjacency lists, not entire display-list trees.
        for (const [group, dirty] of [[metadata.Nodes,dirtyNodes],[metadata.Resources,dirtyResources],[metadata.Composition,dirtyComposition]]) {
            for (const [id, info] of group) {
                const changed = dirty.has(id), refs = info.References;
                if (changed || s.Resources.Remove.length) check(refs.Resources, resources, 'resource');
                if (changed || s.Composition.Remove.length) check(refs.Composition, composition, 'composition object');
                if (changed || s.Nodes.Remove.length) check(refs.Visuals, nodes, 'VisualBrush source');
            }
        }
        for (const [id, info] of metadata.Nodes) {
            const n = info.Data;
            if (dirtyNodes.has(id) || s.Composition.Remove.length) {
                if (n.SelfComposition != null) check([n.SelfComposition], composition, 'attached composition visual');
                if (n.ChildComposition != null) check([n.ChildComposition], composition, 'attached composition visual');
            }
            if (s.Nodes.Remove.length && n.Scroll) { check(n.Scroll.Content,nodes,'scroll content'); check(n.Scroll.Headers,nodes,'scroll header'); }
        }
        if (nodeGraphChanged) {
            const parents = new Map();
            for (const [id, info] of metadata.Nodes) for (const child of info.Children) {
                if (parents.has(child)) fail('Invalid visual child ownership/clip.'); parents.set(child, id);
            }
            acyclic(metadata.Nodes, n => n.References.Visuals.length ? [...n.Children,...n.References.Visuals] : n.Children, 'visual hierarchy'); ++this.Statistics.GraphChecks;
        }
        if (resourceGraphChanged) {
            acyclic(metadata.Resources, n => n.Children, 'resource graph'); ++this.Statistics.GraphChecks;
            const reverse = new Map();
            for (const [id, info] of metadata.Resources) for (const child of info.Children) {
                let consumers = reverse.get(child); if (!consumers) reverse.set(child, consumers = []); consumers.push(id);
            }
            metadata.ReverseResources = reverse;
        }
        if (compositionGraphChanged) { acyclic(metadata.Composition, n => n.Children, 'composition hierarchy'); ++this.Statistics.GraphChecks; }
        this.Statistics.ReferenceObjectsWalked = this._references.Statistics.ObjectsWalked;
        this.Statistics.ReferenceCacheHits = this._references.Statistics.CacheHits;
        this.Statistics.ValidationMilliseconds = performance.now() - started; this.Statistics.TotalValidationMilliseconds += this.Statistics.ValidationMilliseconds;
        return { nodes, resources, composition, metadata };
    }
    async Apply(batch) {
        const start = performance.now(), { nodes, resources, composition, metadata } = this._validate(batch);
        const futureVisuals = new Map([...nodes.keys()].map(id => [id, this.Visuals.get(id) ?? new ServerVisual(id, this)]));
        const resolver = new CompositionResourceResolver(this.Platform, id => futureVisuals.get(id)); resolver.Entries = resources;
        const changedResources = new Set(batch.Value.Resources.Upsert.map(r => r.Id));
        for (const id of batch.Value.Resources.Remove) changedResources.add(id);
        // Transitive invalidation is a bounded graph walk, not repeated full-map scans.
        const changedQueue = [...changedResources];
        for (let i = 0; i < changedQueue.length; ++i) for (const id of metadata.ReverseResources.get(changedQueue[i]) ?? []) {
            if (!changedResources.has(id)) { changedResources.add(id); changedQueue.push(id); }
        }
        for (const [id, value] of this.Resolver.Values) if (resources.get(id) === this.Resources.get(id) && !changedResources.has(id)) resolver.Values.set(id, value);
        const newFonts = new Map(this._fonts), createdFonts = [];
        const createdAnimations=[];
        try {
            // Registration precedes reconstruction of shaped/native text. UI and
            // rendering realms own independent handles for the exact same bytes.
            for (const [id, resource] of resources) if (resource.Kind === 'Font' && !newFonts.has(id)) {
                const d = resource.Data; if (!(d.Bytes instanceof Uint8Array) || typeof d.Family !== 'string') fail('Invalid font resource.');
                const token = this.Platform.RegisterTypeface(d.Family, d.Bytes); newFonts.set(id, token); createdFonts.push(id);
            }
            for (const [id, resource] of resources) {
                if (resource.Kind === 'Font' || resolver.Values.has(id)) continue;
                if (resource.Kind === 'Image' && resource.Data.Url) {
                    const { Bitmap } = await import('@wieslawsoltes/avalonia-media'); const bitmap = new Bitmap(resource.Data.Url);
                    await this.Platform.LoadBitmap(bitmap); resolver.Values.set(id, bitmap);
                } else resolver.Get(id);
            }
            const objects = new Map();
            for (const [id] of composition) objects.set(id, this.CompositionObjects.get(id) ?? new ServerCompositionObject(id, this));
            const decode = v => {
                if (v?.CompositionRef !== undefined) return objects.get(v.CompositionRef);
                return resolver.Decode(v);
            };
            const objectStates = new Map();
            for (const [id, data] of composition) {
                const prior = this.Composition.get(id), object = objects.get(id);
                if (prior === data) continue;
                const Values = Object.fromEntries(Object.entries(data.Values).map(([k, v]) => [k, decode(v)]));
                const Animations=new Map(),Instances=new Map(),Animated=new Map(data.Animated.map(([k,v])=>[k,decode(v)]));
                for(const old of object.Instances.values())Animated.delete(old.Property);
                for (const a of data.Animations) {
                    const old=object.Instances.get(a.Name),spec=a.Animation,Type=animationTypes[spec.Type];if(!Type)fail('Unknown composition animation.');
                    const parts=typeof a.Name==='string'?a.Name.split('.'):[];
                    if(parts.length<1||parts.length>2||parts[0]!==a.Property||parts[1]!==a.Component||!Object.hasOwn(Values,a.Property)
                        ||a.Property.startsWith('_')||['constructor','prototype','__proto__'].includes(a.Property)
                        ||a.Component&&!['X','Y','Z','W'].includes(a.Component)||!Number.isFinite(a.StartedAt)
                        ||a.Id!==undefined&&!plainId(a.Id)||Instances.has(a.Name))fail('Invalid animation instance.');
                    if(batch.Generation===this.Generation&&sameState(old,a)) {
                        if(!SameCompositionValue(old.Wire,a))fail('Animation identity was reused for a different immutable descriptor.');
                        Instances.set(a.Name,old);if(!old.Done)Animations.set(a.Name,old);
                        if(old.HasValue)writeAnimated(Animated,Values,old,old.LastValue);
                        continue;
                    }
                    const animation=new Type(null);createdAnimations.push(animation);
                    for (const key of ['Duration','DelayTime','IterationCount','IterationBehavior','Direction','StopBehavior','DelayBehavior']) if(spec[key]!==undefined)animation[key] = spec[key];
                    animation.Parameters = new Map(spec.Parameters.map(([k, v]) => [k, decode(v)]));
                    if (spec.Expression !== undefined) animation.Expression = spec.Expression;
                    if (spec.KeyFrames) for (const key of spec.KeyFrames) {
                        let easing = null;
                        if (key.Easing) { const T = Easings[key.Easing.Type]; if (!T) fail('Unknown easing.'); easing = Object.assign(new T(), key.Easing.Values); }
                        if (key.Expression) animation.InsertExpressionKeyFrame(key.Progress, key.Expression, easing);
                        else animation.InsertKeyFrame(key.Progress, decode(key.Value), easing);
                    }
                    animation.Validate();
                    const Start=a.UseServerStartingValue&&prior&&batch.Generation===this.Generation?componentValue(a,object.PresentationAt(a.Property,a.StartedAt)):decode(a.Start);
                    const targetValue=componentValue(a,Values[a.Property]);
                    const inferredType=data.PropertyTypes?.[a.Property]&&!a.Component?data.PropertyTypes[a.Property]:typeof targetValue==='number'?'Scalar':typeof targetValue==='boolean'?'Boolean':targetValue instanceof Color?'Color'
                        :targetValue instanceof Matrix?'Matrix3x2':targetValue&&'X' in Object(targetValue)?('Z' in targetValue?'Vector3':'Vector2'):null;
                    if(!inferredType||a.ValueType&&a.ValueType!==inferredType||animation.ValueType&&animation.ValueType!==inferredType)fail('Animation value type does not match its target.');
                    animation._targetValueType=inferredType;animation._ValidateResult(targetValue);animation._ValidateResult(Start);
                    const state={...a,Wire:a,Animation:animation,Base:decode(a.Base),Start,
                        FinalValue:a.HasFinalValue?decode(a.FinalValue):Start,HasValue:true,LastValue:Start,Done:false};
                    Instances.set(a.Name,state);Animations.set(a.Name,state);writeAnimated(Animated,Values,state,Start);
                }
                let handler = object.CustomHandler;
                if (data.Custom && (!handler || data.Custom.Module !== prior?.Custom?.Module || data.Custom.Export !== prior?.Custom?.Export)) {
                    if (!this.HandlerModules.has(data.Custom.Module)) fail('Custom compositor worker module was not registered by the host.');
                    const module = await import(data.Custom.Module), T = module[data.Custom.Export]; if (typeof T !== 'function') fail('Invalid custom compositor handler export.'); handler = new T();
                }
                objectStates.set(id, { Values, Animations, Instances, Animated, Handler: handler, CustomState: data.Custom?resolver.Decode(data.Custom.State):null, Commands: data.Commands?.map(c => c.map((v, i) => i ? resolver.Decode(v) : v)), Bitmap: data.Surface ? resolver.Decode(data.Surface) : null });
            }
            const visualStates=new Map();
            for(const [id,data] of nodes){
                const v=futureVisuals.get(id),previous=v.Descriptor,resourceChanged=metadata.Nodes.get(id).References.Resources.some(id=>changedResources.has(id));
                if(previous===data&&!resourceChanged)continue;
                const state={Descriptor:data,_bounds:new Rect(...data.Bounds),_localBounds:new Rect(0,0,data.Bounds[2],data.Bounds[3]),_transform:makeMatrix(data.Transform),Clip:resolver.Decode(data.Clip),Effect:resolver.Decode(data.Effect),Children:data.Children.map(c=>({Visual:futureVisuals.get(c.Id),Clip:c.Clip?new Rect(...c.Clip):null}))};
                if(!previous||previous.ContentVersion!==data.ContentVersion||previous.ContentWidth!==data.ContentWidth||previous.ContentHeight!==data.ContentHeight||previous.FontVersion!==data.FontVersion||previous.Before!==data.Before||previous.After!==data.After||resourceChanged){
                    state.Before=data.Before.map(c=>c.map((x,i)=>i?resolver.Decode(x):x));state.After=data.After.map(c=>c.map((x,i)=>i?resolver.Decode(x):x));
                }
                visualStates.set(id,state);
            }
            // Everything has validated and materialized. Only now replace the
            // committed scene, so a failed batch cannot partially mutate it.
            if (objectStates.size || batch.Value.Composition.Remove.length || this.ScrollController.Adjustments.size ||
                changedQueue.some(id => this.Resources.has(id))) ++this._dynamicContentVersion;
            const oldResolver = this.Resolver; this.Resolver = resolver; this.Nodes = nodes; this.Resources = resources; this._fonts = newFonts;
            for (const [id, object] of this.CompositionObjects) if (!objects.has(id)) object.Dispose();
            this.CompositionObjects = objects;
            for (const [id, state] of objectStates) {
                const o = objects.get(id), d = composition.get(id), previous = this.Composition.get(id);
                if (o.CustomHandler && o.CustomHandler !== state.Handler) o.CustomHandler.OnDispose?.();
                for(const [name,old] of o.Instances)if(state.Instances.get(name)!==old)old.Animation.Dispose();
                o.Type = d.Type; o.Values = state.Values; o.Animations = state.Animations; o.Instances=state.Instances; o.Children = d.Children; o.Bitmap = state.Bitmap; o.Commands = state.Commands; o.CustomHandler = state.Handler;
                o.Animated = state.Animated;
                if (o.CustomHandler) {
                    const h = o.CustomHandler;
                    Object.defineProperty(h, 'EffectiveSize', { configurable: true, get: () => { const s = o.Read('Size'); return new Size(s.X, s.Y); } });
                    h.Invalidate = () => { ++this._dynamicContentVersion; this.OnInvalidate?.(); }; h.RegisterForNextAnimationFrameUpdate = () => { h._nextFrame = true; this.OnInvalidate?.(); };
                    if(!previous||JSON.stringify(previous.Custom?.State)!==JSON.stringify(d.Custom.State)){try{h.OnStateChanged?.(state.CustomState);}catch(error){this.OnCallbackError?.(error);}}
                    for (const message of d.Custom.Messages.filter(m => m.Sequence > (o.LastMessageSequence ?? 0))) { try{h.OnMessage?.(resolver.Decode(message.Value));}catch(error){this.OnCallbackError?.(error);} o.LastMessageSequence = message.Sequence; }
                }
            }
            this.Composition = composition;
            for (const [id, v] of this.Visuals) if (!nodes.has(id)) { v.Dispose(); this.Visuals.delete(id); }
            this.Visuals = futureVisuals;
            for(const [id,state] of visualStates){Object.assign(this.Visuals.get(id),state);if(state.Before)++this.Statistics.ContentInstalls;}
            this.Root = batch.Value.Root; this.Width = batch.Value.Width; this.Height = batch.Value.Height; this.Scale = batch.Value.Scale;
            this.ScrollController.Commit(batch.Value.InputSequence,nodes);
            this._validation = metadata; this.Sequence = batch.Sequence; this.Generation = batch.Generation; this.FontVersion = batch.Value.FontVersion;
            for (const [id, value] of oldResolver.Values) if (resolver.Values.get(id) !== value) oldResolver.DisposeValue(id);
            oldResolver.Values.clear();
            for (const [id, token] of this._fonts) if (!resources.has(id)) { token.Dispose(); this._fonts.delete(id); }
            ++this.Statistics.Transactions; this.Statistics.ApplyMilliseconds = performance.now() - start; this.Statistics.TotalApplyMilliseconds += this.Statistics.ApplyMilliseconds;
        } catch (e) {
            for(const animation of createdAnimations)animation.Dispose();
            for (const [id, value] of resolver.Values) if (this.Resolver.Values.get(id) !== value) value?.Dispose?.();
            for (const id of createdFonts) newFonts.get(id)?.Dispose();
            throw e;
        }
    }
    get HasAnimations() { for (const object of this.CompositionObjects.values()) if (object.Animations.size || object.CustomHandler?._nextFrame) return true; return false; }
    Tick(epoch = performance.timeOrigin + performance.now()) { let changed = false; for (const object of this.CompositionObjects.values()) changed = object.Tick(epoch) || changed; if (changed) { ++this.Statistics.AnimationTicks; ++this._dynamicContentVersion; } return changed; }
    Render(context) { if(this.ScrollController.Pending.length)this.ScrollController.Statistics.SpeculativeFrames++;this.Visuals.get(this.Root)?.RenderTree(context); }
    GetAnimationReadback(ids=this.CompositionObjects.keys()) {
        const encode=value=>value instanceof Matrix?{Matrix:[value.M11,value.M12,value.M21,value.M22,value.M31,value.M32]}:value instanceof Color?{Color:[value.A,value.R,value.G,value.B]}:value;
        const result=[];
        for(const id of ids){const object=this.CompositionObjects.get(id);if(!object)continue;
            const animations=[...object.Instances.values()].filter(state=>state.UseServerStartingValue).map(state=>({Id:state.Id,Name:state.Name,Start:encode(state.Start)}));
            if(animations.length)result.push({Id:id,Animations:animations});
        }
        return result;
    }
    GetReadback() {
        const result = [];
        for (const [id, o] of this.CompositionObjects) result.push({ Id: id, Values: [...o.Animated].map(([k, v]) => [k, v instanceof Matrix ? { Matrix: [v.M11,v.M12,v.M21,v.M22,v.M31,v.M32] } : v instanceof Color ? { Color: [v.A,v.R,v.G,v.B] } : v]) });
        return result;
    }
    Dispose() { this.ScrollController.Dispose();for (const v of this.Visuals.values()) v.Dispose(); for (const o of this.CompositionObjects.values()) o.Dispose(); this.Resolver.Dispose(); for (const t of this._fonts.values()) t.Dispose(); this._fonts.clear(); this.Visuals.clear(); this.CompositionObjects.clear(); this.Nodes.clear(); this.Resources.clear(); this.Composition.clear(); for (const map of Object.values(this._validation)) map.clear(); this._references = new CompositionReferenceIndex({ Seal: true }); }
}
