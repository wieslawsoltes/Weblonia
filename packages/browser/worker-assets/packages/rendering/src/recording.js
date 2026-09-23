import { Point, Size, Rect, Matrix, Disposable } from "../../base/src/index.js";
import { DrawingContext, DrawingImage, GetTextServiceVersion } from "../../media/src/index.js";
import { CompositionObject, CompositionAnimationGroup, ImplicitAnimationCollection, CompositionPropertySet, CompositionCustomVisual, CompositionDrawListVisual } from "../../composition/src/index.js";
import { CompositionResourceRegistry, MatrixValues, RectValues } from './resources.js';
import { CaptureScrollPolicy } from './scrolling.js';
import { CompositionProtocolError } from './protocol.js';
import { CompositionReferenceIndex } from './references.js';

export const DrawingOpcode = Object.freeze({ Push: 1, Pop: 2, Rectangle: 3, Ellipse: 4, Line: 5, Geometry: 6, Image: 7, Text: 8, Caret: 9, Acrylic: 10, GlyphRun: 11 });
/** A UI-side portable display-list recorder. Render is called only on invalidated
 * content. No native graphics handle is retained in its command stream. */
export class PortableDrawingContext extends DrawingContext {
    constructor(resources, scale = 1) { super(); this.Resources = resources; this.Commands = []; this.Platform = resources.Platform; this.RenderScaling = scale; }
    OnPush(kind, value) { this.Commands.push([DrawingOpcode.Push, kind, this.Resources.Encode(value)]); }
    OnPop() { this.Commands.push([DrawingOpcode.Pop]); }
    _command(op, values) { this.Commands.push([op, ...values.map(this.Resources.Encode)]); }
    DrawRectangle(...args) { this._command(DrawingOpcode.Rectangle, args); }
    DrawEllipse(...args) { this._command(DrawingOpcode.Ellipse, args); }
    DrawLine(...args) { this._command(DrawingOpcode.Line, args); }
    DrawGeometry(...args) { this._command(DrawingOpcode.Geometry, args); }
    DrawImage(source, sourceRect, destRect) {
        if (source instanceof DrawingImage) source.Draw(this, sourceRect, destRect);
        else this._command(DrawingOpcode.Image, [source, sourceRect, destRect]);
    }
    DrawGlyphRun(...args) { this._command(DrawingOpcode.GlyphRun, args); }
    DrawTextLayout(...args) { this._command(DrawingOpcode.Text, args); }
    DrawCaret(...args) { this._command(DrawingOpcode.Caret, args); }
    DrawAcrylic(...args) { this._command(DrawingOpcode.Acrylic, args); }
    DrawVisualCache() { return false; }
}
const identity = value => value;
export function ReplayDrawingCommands(commands, context, decode = identity) {
    const states = [];
    try {
        // No rest/destructuring/map arrays on the per-frame drawing path. Decoding
        // is normally completed once during atomic server transaction installation.
        for (let i=0;i<commands.length;++i) {
            const c=commands[i], d=decode;
            switch(c[0]) {
                case DrawingOpcode.Push:states.push(context._push(c[1],d(c[2])));break;
                case DrawingOpcode.Pop:if(!states.length)throw new CompositionProtocolError('Unbalanced display-list pop.');states.pop().Dispose();break;
                case DrawingOpcode.Rectangle:context.DrawRectangle(d(c[1]),d(c[2]),d(c[3]),d(c[4]),d(c[5]),d(c[6]));break;
                case DrawingOpcode.Ellipse:context.DrawEllipse(d(c[1]),d(c[2]),d(c[3]),d(c[4]),d(c[5]));break;
                case DrawingOpcode.Line:context.DrawLine(d(c[1]),d(c[2]),d(c[3]));break;
                case DrawingOpcode.Geometry:context.DrawGeometry(d(c[1]),d(c[2]),d(c[3]));break;
                case DrawingOpcode.Image:context.DrawImage(d(c[1]),d(c[2]),d(c[3]),d(c[4]));break;
                case DrawingOpcode.GlyphRun:context.DrawGlyphRun(d(c[1]),d(c[2]));break;
                case DrawingOpcode.Text:context.DrawTextLayout(d(c[1]),d(c[2]));break;
                case DrawingOpcode.Caret:if(context.DrawCaret)context.DrawCaret(d(c[1]),d(c[2]));else context.DrawRectangle(d(c[1]),null,d(c[2]));break;
                case DrawingOpcode.Acrylic:context.DrawAcrylic(d(c[1]),d(c[2]),d(c[3]));break;
                default:throw new CompositionProtocolError(`Unknown drawing operation ${c[0]}.`);
            }
        }
        if(states.length)throw new CompositionProtocolError('Unbalanced display-list push.');
    }finally{while(states.length)states.pop().Dispose();}
}
const baseTransform = visual => {
    if (!visual._compositionSelf) return visual.GetLocalTransform();
    const origin = visual.RenderTransformOrigin.ToPixels(visual.Bounds.Size), m = visual.RenderTransform?.Value ?? visual.RenderTransform ?? Matrix.Identity;
    return Matrix.CreateTranslation(-origin.X, -origin.Y).Multiply(m).Multiply(Matrix.CreateTranslation(origin.X + visual.Bounds.X, origin.Y + visual.Bounds.Y));
};
function describeEasing(easing) {
    if (!easing) return null;
    const name = easing.constructor.name;
    const known = new Set(['LinearEasing','QuadraticEaseIn','QuadraticEaseOut','QuadraticEaseInOut','CubicEaseIn','CubicEaseOut','CubicEaseInOut','SineEaseIn','SineEaseOut','SineEaseInOut','BounceEaseOut','ElasticEaseOut','BackEaseOut','SplineEasing']);
    if (!known.has(name)) throw new CompositionProtocolError(`Easing '${name}' requires a portable easing type.`);
    return { Type: name, Values: Object.fromEntries(Object.entries(easing).filter(([, v]) => typeof v === 'number')) };
}
/** Stateful scene capture. Clean branches are reused as immutable snapshots.
 * Text layouts, paths and bitmap payloads are installed once per resource version. */
export class CompositionSceneRecorder {
    constructor(root, platform) {
        this.Root = root; this.Platform = platform; this.Resources = new CompositionResourceRegistry(platform, () => { this._resourceVersion = (this._resourceVersion ?? 0) + 1; this._invalidateResources = true; root.InvalidateVisual(); });
        this.Resources.BaseUrl = root._document?.baseURI ?? root._options?.BaseUrl;
        this.Resources.RecordVisual = visual => {
            if (!visual) return null;
            if (this._visiting.has(visual)) throw new CompositionProtocolError('VisualBrush references its active source ancestry.');
            this._extraVisuals.add(visual); this._visualSources.set(visual.VisualId, new WeakRef(visual)); return visual.VisualId;
        };
        this._nodes = new Map(); this._composition = new Map(); this._content = new WeakMap(); this._visiting = new Set(); this._extraVisuals = new Set();
        this._references = new CompositionReferenceIndex(); this._visualSources = new Map();
        this._fontVersion = -1; this.Statistics = { Captures: 0, VisualVisits: 0, CleanBranches: 0, ContentRecords: 0, Commands: 0, CaptureMilliseconds: 0 };
    }
    _record(control, version) {
        const cached = this._content.get(control);
        if (!this._invalidateResources && cached && !cached.TimeDependent && cached.Version === version && cached.Width === control.Bounds.Width && cached.Height === control.Bounds.Height && cached.FontVersion === this._fontVersion) return cached;
        const before = new PortableDrawingContext(this.Resources, this.Root.RenderScaling), after = new PortableDrawingContext(this.Resources, this.Root.RenderScaling);
        control.Render(before); before.Dispose(); control.RenderAfter(after); after.Dispose();
        const result = { Version: version, Width: control.Bounds.Width, Height: control.Bounds.Height, FontVersion: this._fontVersion, Before: before.Commands, After: after.Commands,
            TimeDependent: !!this.Root._animationFrameRequests?.has(control) };
        this._content.set(control, result); ++this.Statistics.ContentRecords; this.Statistics.Commands += before.Commands.length + after.Commands.length; return result;
    }
    _visit(control, next, force = false) {
        if (control.IsDisposed) return null;
        // Capture the subtree revision BEFORE calling user Render/RenderAfter or
        // descending. A callback may invalidate itself or an earlier sibling.
        // Publishing the revision *after* that callback would incorrectly mark
        // work we have not recorded as clean and lose the subsequent update.
        const id = control.VisualId, previous = this._nodes.get(id), capturedVersion = control._renderVersion;
        if (this._visiting.has(control)) throw new CompositionProtocolError('Visual hierarchy contains a cycle.');
        if (!force && !this._invalidateResources && previous && previous.Version === capturedVersion && previous.FontVersion === this._fontVersion) {
            ++this.Statistics.CleanBranches;
            const reuse = node => { if (next.has(node.Id)) return; next.set(node.Id, node); for (const child of node.Children) { const n = this._nodes.get(child.Id); if (n) reuse(n); } };
            reuse(previous); return id;
        }
        this._visiting.add(control); ++this.Statistics.VisualVisits;
        try {
            control.ApplyStyling?.();
            const visible = control.IsVisible && control.Opacity > 0;
            const content = visible ? this._record(control, control._renderContentVersion ?? control._renderVersion) : { Before: [], After: [], Version: -1, Width: 0, Height: 0 };
            const children = [];
            for (const child of (visible ? control.GetZOrderedChildren() : [])) {
                const childId = this._visit(child, next, force);
                if (childId !== null) children.push({ Id: childId, Clip: control.GetChildClip?.(child) ? RectValues(control.GetChildClip(child)) : null });
            }
            const node = { Id: id, Version: capturedVersion, FontVersion: this._fontVersion,
                Bounds: RectValues(control.Bounds), Transform: MatrixValues(baseTransform(control)), IsVisible: !!control.IsVisible, Opacity: control.Opacity,
                ClipToBounds: !!control.ClipToBounds, Clip: this.Resources.Encode(control.Clip), Effect: this.Resources.Encode(control.Effect),
                CacheScale: control.CacheMode?.RenderAtScale ?? null, Children: children, Before: content.Before, After: content.After,
                Scroll:CaptureScrollPolicy(control),
                ScrollBar:control._scrollOwner?.IsCompositorScrollingEnabled&&!control._templateRoot?{Owner:control._scrollOwner.VisualId,Horizontal:control.Orientation==='Horizontal',Range:control.ScrollableRange,Travel:control.GetTrackGeometry().Travel,Reversed:control.IsDirectionReversed}:null,
                SelfComposition: control._compositionSelf?.Id ?? null, ChildComposition: control._compositionChild?.Id ?? null };
            // Only the content revision changes when owner painting changes. Server
            // command materialization can be reused for placement-only updates.
            node.ContentVersion = content.Version; node.ContentWidth = content.Width; node.ContentHeight = content.Height;
            node.Resources = this._references.Get(node).Resources;
            next.set(id, Object.freeze(node)); return id;
        } finally { this._visiting.delete(control); }
    }
    _compositionValue(value) {
        if (value instanceof CompositionObject) return { CompositionRef: value.Id };
        return this.Resources.Encode(value);
    }
    _captureComposition(compositor) {
        const next = new Map();
        if (!compositor || compositor.IsDisposed) return next;
        for (const object of compositor._objects) {
            if (object.IsDisposed || object instanceof CompositionAnimationGroup || object instanceof ImplicitAnimationCollection) continue;
            const old = this._composition.get(object.Id), version = object._transportVersion ?? compositor.Revision;
            if (old && old.Version === version && old.FontVersion === this._fontVersion) { next.set(object.Id, old); continue; }
            // Defaults must be materialized before cross-realm serialization.
            object._Commit();
            const raw={...object._committed};
            for(let p=Object.getPrototypeOf(object);p&&p!==CompositionObject.prototype;p=Object.getPrototypeOf(p))for(const key of Object.getOwnPropertyNames(p))if(key!=='Parent'&&Object.getOwnPropertyDescriptor(p,key)?.get&&!Object.hasOwn(raw,key))raw[key]=object[key];
            const values = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, this._compositionValue(v)]));
            const animations = [];
            for (const state of object._animations.values()) {
                const a = state.Animation;
                const animation = { Type: a.constructor.name, Duration: a.Duration, DelayTime: a.DelayTime, IterationCount: a.IterationCount, IterationBehavior: a.IterationBehavior,
                    Direction: a.Direction, DelayBehavior:a.DelayBehavior, StopBehavior: a.StopBehavior, Parameters: [...a.Parameters].map(([k, v]) => [k, this._compositionValue(v)]),
                    Expression: a.Expression, KeyFrames: a.KeyFrames?.map(frame => ({ Progress: frame.Progress, Value: this.Resources.Encode(frame.Value), Expression: frame.Expression?.Text ?? frame.Expression?.Source, Easing: describeEasing(frame.Easing) })) };
                animations.push({ Id:state.Id, ValueType:state.ValueType, HasFinalValue:state.HasFinalValue, UseServerStartingValue:state.UseServerStartingValue, FinalValue:this.Resources.Encode(state.FinalValue), Name: state.Name, Property: state.Property, Component: state.Component, Base: this.Resources.Encode(state.Base), Start: this.Resources.Encode(state.Start),
                    StartedAt: (compositor.Clock.TimeOrigin ?? performance.timeOrigin ?? 0) + state.StartedAt, Animation: animation });
            }
            let custom = null, customCommands = null;
            if (object instanceof CompositionCustomVisual) {
                if (object.Handler.WorkerModule) custom = { Module: String(object.Handler.WorkerModule), Export: object.Handler.WorkerExport ?? 'default', State:this.Resources.Encode(object.Handler.WorkerState),Messages: object._workerMessages?.slice() ?? [] };
                else {
                    // Existing custom handlers remain valid: run their CPU drawing
                    // callback only when invalidated and send a portable display list.
                    const context = new PortableDrawingContext(this.Resources, this.Root.RenderScaling); object.Handler.OnRender?.(context); context.Dispose(); customCommands = context.Commands;
                }
            }
            const item = { Id: object.Id, Version: version, FontVersion: this._fontVersion, Type: object.constructor.name, Values: values,
                PropertyTypes:object instanceof CompositionPropertySet?Object.fromEntries(object._types):undefined,
                Children: object.Children?._committed?.map(x => x.Id) ?? [], Animations: animations, Animated: [...object._animated].map(([k, v]) => [k, this.Resources.Encode(v)]),
                Surface: object._committedBitmap ? this.Resources.Encode(object._committedBitmap) : null, Custom: custom, Commands: customCommands };
            item.Resources = this._references.Get(item).Resources; next.set(object.Id, Object.freeze(item));
        }
        return next;
    }
    Capture() {
        const started = performance.now(), resourceVersion = this._resourceVersion; ++this.Statistics.Captures;
        const fontVersion = GetTextServiceVersion(), fontsChanged = this._fontVersion !== fontVersion;
        this._fontVersion = fontVersion; this._extraVisuals.clear(); const nodes = new Map();
        const root = this._visit(this.Root, nodes, fontsChanged);
        const composition = this._captureComposition(this.Root.Compositor);
        // Retained reference summaries replace a recursive walk of every paint,
        // line, brush and glyph descriptor on each frame. Off-tree VisualBrush
        // sources are still revisited using their LIVE control version, including
        // sources reachable through resource descriptors rather than node fields.
        const resources = new Map(), queue = [], visited = new Set(), liveSources = new Set();
        const enqueueVisual = id => {
            if (!nodes.has(id)) {
                const visual = this._visualSources.get(id)?.deref();
                if (!visual || visual.IsDisposed) throw new CompositionProtocolError('Missing live VisualBrush source.');
                if (!visual.IsArrangeValid && !visual.IsAttachedToVisualTree) {
                    visual.Measure(new Size(Number.isFinite(visual.Width) ? visual.Width : 256, Number.isFinite(visual.Height) ? visual.Height : 256));
                    visual.Arrange(new Rect(visual.DesiredSize));
                }
                this._visit(visual, nodes, fontsChanged);
            }
            queue.push(nodes.get(id));
        };
        const enqueueResource = id => {
            if (resources.has(id)) return;
            const entry = this.Resources.Entries.get(id);
            if (!entry) throw new CompositionProtocolError(`Missing UI resource ${id}.`);
            resources.set(id, entry); queue.push(entry.Data);
            for (const dependency of entry.Depends) enqueueResource(dependency);
        };
        if (root != null) enqueueVisual(root);
        for (const descriptor of composition.values()) queue.push(descriptor);
        for (const entries of this.Platform._fontRegistrations?.values() ?? []) for (const font of entries) if (font.Bytes) {
            const ref = this.Resources.Define('Font', font, font.Id, () => ({ Family: font.Family, Bytes: font.Bytes })); enqueueResource(ref.$ref);
        }
        for (let cursor = 0; cursor < queue.length; ++cursor) {
            const descriptor = queue[cursor];
            if (visited.has(descriptor)) continue;
            visited.add(descriptor);
            // Nodes have children; composition hierarchy uses its own snapshot map.
            if (nodes.get(descriptor.Id) === descriptor) for (const child of descriptor.Children) enqueueVisual(child.Id);
            const references = this._references.Get(descriptor);
            for (const id of references.Resources) enqueueResource(id);
            for (const id of references.Visuals) { liveSources.add(id); enqueueVisual(id); }
        }
        for (const id of this._visualSources.keys()) if (!liveSources.has(id)) this._visualSources.delete(id);
        this.Statistics.ReferenceObjectsWalked = this._references.Statistics.ObjectsWalked;
        this.Statistics.ReferenceCacheHits = this._references.Statistics.CacheHits;
        this._nodes = nodes; this._composition = composition; this.Resources.Sweep(resources); this._invalidateResources = this._resourceVersion !== resourceVersion;
        this.Statistics.CaptureMilliseconds = performance.now() - started;
        return { Root: root, Width: this.Root.ClientSize.Width, Height: this.Root.ClientSize.Height, Scale: this.Root.RenderScaling,
            InputSequence:this.Root.LastInputSequence??0,FontVersion: fontVersion, Nodes: nodes, Resources: resources, Composition: composition };
    }
    ResetServerState(){this._composition.clear();}
    Dispose() { this.Resources.Dispose(); this._nodes.clear(); this._composition.clear(); this._content = new WeakMap(); this._visualSources.clear(); this._references = new CompositionReferenceIndex(); }
}
