import { Disposable, CompositeDisposable, Rect, Point, Size, Event } from '@wieslawsoltes/avalonia-base';
import { Control } from '@wieslawsoltes/avalonia-controls';

export class PlatformHandle {
    constructor(handle,descriptor='HTMLElement'){this.Handle=handle;this.HandleDescriptor=descriptor;}
}
const corners=(rect,matrix)=>[new Point(rect.Left,rect.Top),new Point(rect.Right,rect.Top),new Point(rect.Right,rect.Bottom),new Point(rect.Left,rect.Bottom)].map(p=>matrix.Transform(p));
function area(points){return points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.X*q.Y-q.X*p.Y;},0);}
function clipPolygon(polygon,clip) {
    const sign=area(clip)>=0?1:-1;
    for(let i=0;i<clip.length&&polygon.length;i++) {
        const a=clip[i],b=clip[(i+1)%clip.length],cross=p=>sign*((b.X-a.X)*(p.Y-a.Y)-(b.Y-a.Y)*(p.X-a.X));
        const input=polygon;polygon=[];let prior=input.at(-1),before=cross(prior);
        for(const point of input){const after=cross(point);if((after>=0)!==(before>=0)){const t=before/(before-after);polygon.push(new Point(prior.X+(point.X-prior.X)*t,prior.Y+(point.Y-prior.Y)*t));}if(after>=0)polygon.push(point);prior=point;before=after;}
    }
    return polygon;
}

/** Browser implementation of NativeControlHost. The native handle is an HTMLElement, never an OS child HWND/NSView. */
export class NativeControlHost extends Control {
    constructor(){super();this.Focusable=true;this.NativeControl=null;this.NativeControlFactory=null;this.WorkerModule=null;this.WorkerExport='CreateControl';this.WorkerState=null;this.NativeMessage=new Event();this._nativeLifetime=new CompositeDisposable();
        this._lifetime.Add(this.AttachedToVisualTree.Add((_,e)=>this._Mount(e.Root)));
        this._lifetime.Add(this.DetachedFromVisualTree.Add(()=>this._Unmount()));
    }
    CreateNativeControlCore(parent){return this.NativeControlFactory?this.NativeControlFactory(parent):this.NativeControl;}
    DestroyNativeControlCore(control){(control?.Handle??control)?.remove();}
    _Mount(root) {
        if(root?.IsWorkerRoot){
            if(!this.WorkerModule)throw new TypeError('A UI-worker NativeControlHost requires a registered WorkerModule; DOM factory closures cannot cross workers.');
            this._nativeRoot=root;(root._remoteNativeHosts??=new Map()).set(this.VisualId,this);root.HostConnection.Send({Type:'native-create',Id:this.VisualId,Module:String(this.WorkerModule),Export:this.WorkerExport});return;
        }
        if(this._wrapper||!root?._document)return;
        this._nativeRoot=root;const doc=root._document,wrapper=doc.createElement('div');wrapper.style.cssText='position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:auto;overflow:hidden;';
        this._wrapper=wrapper;
        if(!root._nativeHostLayer){root._nativeHostLayer=doc.createElement('div');root._nativeHostLayer.style.cssText='position:absolute;inset:0;pointer-events:none;overflow:hidden;';root._container.append(root._nativeHostLayer);root._nativeHosts=new Set();}
        root._nativeHostLayer.append(wrapper);root._nativeHosts.add(this);
        try {
            const result=this.CreateNativeControlCore(new PlatformHandle(wrapper));const element=result?.Handle??result;
            if(!element||element.nodeType!==1)throw new TypeError('NativeControlHost must return an HTMLElement.');
            this.NativeControl=element;this.NativeHandle=new PlatformHandle(element);wrapper.append(element);
            const focus=()=>this.Focus();element.addEventListener('focusin',focus);this._nativeLifetime.Add(Disposable.Create(()=>element.removeEventListener('focusin',focus)));
            this._SyncNative();
        } catch(error){root._nativeHosts.delete(this);wrapper.remove();this._wrapper=null;throw error;}
    }
    _SyncNative() {
        if(this._nativeRoot?.IsWorkerRoot){this._SyncRemote();return;}
        if(!this._wrapper)return;
        const matrix=this.GetTransformToRoot(),style=this._wrapper.style;
        if(!this.IsEffectivelyVisible||!matrix.HasInverse){style.display='none';return;}
        let polygon=corners(new Rect(this.Bounds.Size),matrix),opacity=this.Opacity;
        for(let ancestor=this.VisualParent;ancestor;ancestor=ancestor.VisualParent){opacity*=ancestor.Opacity;if(ancestor.ClipToBounds||ancestor.IsTopLevel)polygon=clipPolygon(polygon,corners(new Rect(ancestor.Bounds.Size),ancestor.GetTransformToRoot()));}
        style.display=polygon.length?'block':'none';style.width=`${this.Bounds.Width}px`;style.height=`${this.Bounds.Height}px`;style.opacity=String(opacity);
        style.transform=`matrix(${matrix.M11},${matrix.M12},${matrix.M21},${matrix.M22},${matrix.M31},${matrix.M32})`;
        const inverse=matrix.Invert();style.clipPath=`polygon(${polygon.map(p=>inverse.Transform(p)).map(p=>`${p.X}px ${p.Y}px`).join(',')})`;
        style.pointerEvents=this.IsEffectivelyEnabled?'auto':'none';this.NativeControl?.setAttribute('aria-disabled',String(!this.IsEffectivelyEnabled));
        if(this.NativeControl&&'disabled'in this.NativeControl)this.NativeControl.disabled=!this.IsEffectivelyEnabled;
    }
    _SyncRemote(){
        const root=this._nativeRoot,matrix=this.GetTransformToRoot();let polygon=corners(new Rect(this.Bounds.Size),matrix),opacity=this.Opacity;
        for(let a=this.VisualParent;a;a=a.VisualParent){opacity*=a.Opacity;if(a.ClipToBounds||a.IsTopLevel)polygon=clipPolygon(polygon,corners(new Rect(a.Bounds.Size),a.GetTransformToRoot()));}
        const inverse=matrix.HasInverse?matrix.Invert():null;
        const style={display:this.IsEffectivelyVisible&&inverse&&polygon.length?'block':'none',width:this.Bounds.Width+'px',height:this.Bounds.Height+'px',opacity:String(opacity),transform:`matrix(${matrix.M11},${matrix.M12},${matrix.M21},${matrix.M22},${matrix.M31},${matrix.M32})`,clipPath:inverse?`polygon(${polygon.map(p=>inverse.Transform(p)).map(p=>`${p.X}px ${p.Y}px`).join(',')})`:'none',pointerEvents:this.IsEffectivelyEnabled?'auto':'none'};
        const key=JSON.stringify([style,this.WorkerState,this.IsEffectivelyEnabled,root.LastInputSequence??0]);if(key===this._remoteKey)return;if(key.length>1048576)throw new RangeError('Native control state exceeds 1 MiB.');this._remoteKey=key;root.HostConnection.Send({Type:'native-state',Id:this.VisualId,Style:style,Value:this.WorkerState,Enabled:this.IsEffectivelyEnabled,AcknowledgedInput:root.LastInputSequence??0});
    }
    FocusNative(){if(this._nativeRoot?.IsWorkerRoot){this._nativeRoot.HostConnection.Send({Type:'native-focus',Id:this.VisualId});return;}const element=this.NativeControl;if(!element)return;const active=element.ownerDocument.activeElement;if(active!==element&&!element.contains(active)){const target=element.matches('input,select,textarea,button,[tabindex]')?element:element.querySelector('input,select,textarea,button,[tabindex]')??element;target.focus({preventScroll:true});}}
    _NativeWantsKey(event){if(this._nativeRoot?.IsWorkerRoot)return event.key!=='Tab';
        if(event.key!=='Tab')return true;
        const element=this.NativeControl;if(!element)return false;
        const selector='input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex="0"]';
        const children=[...(element.matches(selector)?[element]:[]),...element.querySelectorAll(selector)],index=children.indexOf(element.ownerDocument.activeElement);
        return event.shiftKey?index>0:index>=0&&index<children.length-1;
    }
    MeasureOverride(available){const element=this.NativeControl;return new Size(Number.isFinite(this.Width)?this.Width:Math.min(available.Width,element?.scrollWidth||240),Number.isFinite(this.Height)?this.Height:Math.min(available.Height,element?.scrollHeight||44));}
    _Unmount(){if(this._nativeRoot?.IsWorkerRoot){this._nativeRoot.HostConnection.Send({Type:'native-remove',Id:this.VisualId});this._nativeRoot._remoteNativeHosts.delete(this.VisualId);this._nativeRoot=null;this._remoteKey=null;return;}if(!this._wrapper)return;this._nativeLifetime.Clear();this._nativeRoot?._nativeHosts?.delete(this);this.DestroyNativeControlCore(this.NativeHandle);this.NativeHandle=null;this._wrapper.remove();this._wrapper=null;this._nativeRoot=null;}
    Dispose(){if(this.IsDisposed)return;this._Unmount();this._nativeLifetime.Dispose();this.NativeMessage.Clear();super.Dispose();}
}
export class HtmlControlHost extends NativeControlHost {}
