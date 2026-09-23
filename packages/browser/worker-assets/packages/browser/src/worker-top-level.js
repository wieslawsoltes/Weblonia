import { Window, BrowserScreens, BrowserPlatformSettings } from './index.js';
import { ThreadChannel } from './thread-channel.js';
import { WorkerSkiaRenderer } from './render-thread.js';
import { AutomationProjection } from './automation-projection.js';
import { Size, Point, Event, Disposable } from "../../base/src/index.js";
import { InputElement, TextBox, PointerWheelEventArgs } from "../../controls/src/index.js";
import { NextTextPosition, PreviousTextPosition, TextServicesChanged } from "../../media/src/index.js";

/** Host-independent Window implementation. Native services are asynchronous;
 * controls, bindings, layout, events and application callbacks remain synchronous
 * and exclusively owned by this UI worker. */
export class WorkerTopLevel extends Window {
    async AttachWorker(connection, renderPort, platform, snapshot) {
        this.HostConnection=connection;this.HostSnapshot=snapshot;this.IsWorkerRoot=true;this._hostFocused=true;this.LastInputSequence=0;
        this.Platform=platform;this.ClientSize=new Size(snapshot.Width,snapshot.Height);this.RenderScaling=snapshot.Scale;
        this._window={requestAnimationFrame:cb=>self.requestAnimationFrame(cb),cancelAnimationFrame:id=>{if(id!=null){if(this._frameKind==='timer')clearTimeout(id);else self.cancelAnimationFrame(id);}},get devicePixelRatio(){return snapshot.Scale;},focus:()=>connection.Send({Type:'focus-window'}),close:()=>connection.Send({Type:'close-window'}),closed:false};
        this._projection=new AutomationProjection(message=>connection.Send(message));this._document=this._projection;
        this._aria=this._projection.Create(0,'div',true);this._canvas=this._projection.Create(1,'canvas',true);
        let cursor='default';this._canvas.style={get cursor(){return cursor;},set cursor(value){if(cursor!==value){cursor=value;connection.Send({Type:'cursor',Value:value});}}};
        this._plainTextInput=this._projection.Create(2,'textarea',true);this._passwordInput=this._projection.Create(3,'input',true);this._textInput=this._plainTextInput;
        this._container={isConnected:true,contains:()=>this._hostFocused};this._projection.activeElement=this._canvas;
        Object.defineProperty(this._projection,'title',{set:value=>connection.Send({Type:'title',Value:value})});
        this.Clipboard={GetTextAsync:()=>connection.RequestAsync('clipboard-read'),SetTextAsync:text=>connection.RequestAsync('clipboard-write',{Text:String(text)}),ClearAsync:()=>connection.RequestAsync('clipboard-write',{Text:''})};
        this.StorageProvider=new RemoteStorageProvider(connection,snapshot);
        this._platformMedia=new Map();
        const windowSnapshot={screen:snapshot.Screen,get devicePixelRatio(){return snapshot.Scale;},matchMedia:q=>{let media=this._platformMedia.get(q);if(!media){const listeners=new Set();media={matches:!!snapshot.Media[q],addEventListener:(type,listener)=>{if(type==='change')listeners.add(listener);},removeEventListener:(type,listener)=>listeners.delete(listener),Update(value){if(this.matches!==value){this.matches=value;for(const listener of listeners)listener({matches:value,media:q});}}};this._platformMedia.set(q,media);}return media;}};
        this.Screens=new BrowserScreens(windowSnapshot);this.Screens.RequestScreenDetailsAsync=()=>connection.RequestAsync('screen-details');this.PlatformSettings=new BrowserPlatformSettings(windowSnapshot);
        this.Renderer=new WorkerSkiaRenderer(platform,this,null,{Port:renderPort,RequestTimeout:30000,RestartRenderer:()=>connection.RequestAsync('restart-renderer')});this.Renderer.Mode='full-isolation';
        connection.Root=this;connection.OnEvent=message=>this.ProcessHostMessage(message);
        this._hostLifetime.Add(TextServicesChanged.Add(()=>{for(const c of [this,...this.GetVisualDescendants()])c.InvalidateMeasure();}));
        await this.Renderer.Resize(this.ClientSize.Width,this.ClientSize.Height,this.RenderScaling);this._Attach(this);this._dirty=this._layoutDirty=true;
        await this.RenderNow();this.Opened.Raise(this,{});return this;
    }
    _EventPosition(e){return new Point(e.Position.X,e.Position.Y);}
    _CapturePointer(pointer,control){this.HostConnection.Send({Type:'capture',PointerId:pointer.Id,Capture:!!control});}
    _OnFocusChanged(control){this._InvalidateAutomation(control);this._SyncTextInput(control);this._RequestRender();}
    _SyncTextInput(control){
        if(this.FocusManager.FocusedElement!==control)return;
        const sequence=this.LastInputSequence;
        if(!(control instanceof TextBox)){
            this._textInput=this._plainTextInput;const state={Owner:null,AcknowledgedInput:sequence};this._SendEditor(state);if(control?.FocusNative)control.FocusNative();return;
        }
        this._textInput=control.PasswordChar?this._passwordInput:this._plainTextInput;
        if(this._composing)return;
        const layout=control._LayoutText(),caret=layout.HitTestTextPosition(control.CaretIndex),origin=control._TextOrigin(layout),p=control.TranslatePoint(new Point(origin.X+caret.X,origin.Y+caret.Bottom),this);
        this._SendEditor({Owner:control.VisualId,Password:!!control.PasswordChar,Value:control.Text,Start:Math.min(control.SelectionStart,control.SelectionEnd),End:Math.max(control.SelectionStart,control.SelectionEnd),Direction:control.CaretIndex===control.SelectionStart?'backward':'forward',ReadOnly:control.IsReadOnly||!control.IsEffectivelyEnabled,AcceptsReturn:control.AcceptsReturn,AcceptsTab:control.AcceptsTab,InputMode:control.InputScope??'text',Dir:control.FlowDirection==='RightToLeft'?'rtl':'ltr',X:Math.max(0,Math.min(this.ClientSize.Width-1,p.X)),Y:Math.max(0,Math.min(this.ClientSize.Height-1,p.Y)),AcknowledgedInput:sequence});
    }
    _SendEditor(value){const key=value.Owner==null?'unfocused':JSON.stringify(value);if(this._editorKey===key)return;this._editorKey=key;this.HostConnection.Send({Type:'editor',State:value});}
    _UpdateAccessibility(){super._UpdateAccessibility();this._projection.Flush();}
    _ScheduleFrame(){if(!this.Renderer||this.Renderer.LastError||this.IsDisposed||this._runningFrame||this._frameId!=null)return;try{this._frameKind='raf';this._frameId=self.requestAnimationFrame(()=>{this._frameId=null;this.RenderNow(false).catch(e=>this._ReportRenderError(e));});}catch{this._frameKind='timer';this._frameId=setTimeout(()=>{this._frameId=null;this.RenderNow(false).catch(e=>this._ReportRenderError(e));},16);}}
    async RenderNow(force=true){
        if(!this.Renderer||this.IsDisposed||this._runningFrame)return;
        if(this._frameId!=null){this._window.cancelAnimationFrame(this._frameId);this._frameId=null;}
        this._runningFrame=true;const uiStart=performance.now();let layoutMs=0,recordMs=0,automationMs=0;
        try{
            this._ProcessAnimationFrameRequests();
            const layout=this._layoutDirty||!this.IsMeasureValid||!this.IsArrangeValid;
            if(layout){this._layoutDirty=false;const t=performance.now();this.LayoutManager.ExecuteLayoutPass(this.ClientSize);layoutMs=performance.now()-t;this._layoutDirty=!this.IsMeasureValid||!this.IsArrangeValid;}
            if(force||this._dirty||layout){this._dirty=false;const t=performance.now();this.Renderer.Render();recordMs=performance.now()-t;}
            for(const host of this._remoteNativeHosts?.values()??[])host._SyncNative();
            this._SyncTextInput(this.FocusManager.FocusedElement);
            if(this._automationBridge.NeedsUpdate){const t=performance.now();this._UpdateAccessibility();automationMs=performance.now()-t;}this._projection.Flush();
        }finally{this.LastUiFrame={Milliseconds:performance.now()-uiStart,LayoutMilliseconds:layoutMs,RenderOrRecordMilliseconds:recordMs,AutomationMilliseconds:automationMs};this._runningFrame=false;if(this._dirty||this._layoutDirty||this._automationBridge.NeedsUpdate)this._ScheduleFrame();}
        if(force)await this.Renderer.FlushAsync();
    }
    ProcessHostMessage(message){
        if(this.IsDisposed)return;this.LastInputSequence=Math.max(this.LastInputSequence,message.Sequence??0);
        const event=message.Event?{...message.Event,preventDefault(){},stopPropagation(){}}:null;
        switch(message.Type){
            case 'pointer':this._HandlePointer(event);break;
            case 'wheel':{const target=this.HitTest(this._EventPosition(event));if(target){const pointer=this._GetPointer({pointerId:0,pointerType:'mouse'});target.RaiseEvent(new PointerWheelEventArgs(InputElement.PointerWheelChangedEvent,target,pointer,this._EventPosition(event),event));}this._RequestRender();break;}
            case 'key':this._HandleKey(event,message.Down);break;
            case 'blur':this._hostFocused=false;for(const p of this._pointers.values())p.Cancel();break;
            case 'focus':this._hostFocused=true;break;
            case 'automation-event':this._projection.Dispatch(message.Id,message.Name,event);break;
            case 'resize':{const s=message.Snapshot;this.HostSnapshot.Width=s.Width;this.HostSnapshot.Height=s.Height;this.HostSnapshot.Scale=s.Scale;this.ClientSize=new Size(s.Width,s.Height);this.RenderScaling=s.Scale;this.IsMeasureValid=this.IsArrangeValid=false;this.Renderer.Resize(s.Width,s.Height,s.Scale).then(()=>this._RequestLayout()).catch(e=>this._ReportRenderError(e));this.Resized.Raise(this,{ClientSize:this.ClientSize});break;}
            case 'native-message':{const host=this._remoteNativeHosts?.get(message.Id);if(host?.IsEffectivelyEnabled)host.NativeMessage.Raise(host,{Value:message.Value});this._RequestRender();break;}
            case 'native-focus':this._remoteNativeHosts?.get(message.Id)?.Focus();break;
            case 'platform-media':this.HostSnapshot.Media[message.Query]=!!message.Matches;this._platformMedia.get(message.Query)?.Update(!!message.Matches);break;
            case 'visibility':this.Renderer.SetVisible(message.Visible);break;
            case 'edit':{
                const c=this.FocusManager.FocusedElement;if(!(c instanceof TextBox)||c.VisualId!==message.Owner||c.IsReadOnly||!c.IsEffectivelyEnabled)break;
                this._composing=!!message.Composing;
                if(message.Kind==='delete'){
                    c.SelectionStart=message.Start;c.SelectionEnd=message.End;c.CaretIndex=message.End;
                    if(message.Start===message.End){if(message.Backward)c.SelectionStart=PreviousTextPosition(c.Text,message.Start);else c.SelectionEnd=NextTextPosition(c.Text,message.End);}c.ReplaceSelection('');
                }else if(message.Kind==='selection'){c.SelectionStart=message.Start;c.SelectionEnd=message.End;c.CaretIndex=message.Direction==='backward'?message.Start:message.End;c._EnsureCaretVisible();}
                else c.ApplyTextEdit(message.Value,message.Start,message.End,!!message.Composing);
                this._SyncTextInput(c);this._RequestRender();break;
            }
            case 'close':this.Close();break;
        }
    }
    _ReportRenderError(error){super._ReportRenderError(error);this.HostConnection?.Send({Type:'application-error',Error:{Name:error.name,Message:error.message,Stack:error.stack}});}
    SetFullScreenAsync(enabled){return this.HostConnection.RequestAsync('fullscreen',{Enabled:!!enabled});}
    Dispose(){if(this.IsDisposed)return;super.Dispose();this._projection?.Flush();this._projection?.Dispose();this.PlatformSettings?.Dispose();}
}
export function InstallWorkerTopLevel(root){
    for(const name of Object.getOwnPropertyNames(WorkerTopLevel.prototype))if(name!=='constructor')Object.defineProperty(root,name,Object.getOwnPropertyDescriptor(WorkerTopLevel.prototype,name));return root;
}
class RemoteStorageProvider {
    constructor(connection,snapshot){this.Connection=connection;this.CanOpen=true;this.CanSave=snapshot.CanSave;this.CanPickFolder=false;}
    async OpenFilePickerAsync(options={}){const files=await this.Connection.RequestAsync('open-files',options);return files.map(f=>({Name:f.Name,Path:null,OpenReadAsync:async()=>new Uint8Array(f.Bytes),GetBasicPropertiesAsync:async()=>({Size:f.Bytes.byteLength,DateModified:new Date(f.Modified)})}));}
    async SaveFilePickerAsync(options={}){const f=await this.Connection.RequestAsync('save-file',options);if(!f)return null;const connection=this.Connection;return{Name:f.Name,OpenWriteAsync:async()=>({write:bytes=>connection.RequestAsync('write-file',{Id:f.Id,Bytes:bytes}),close:()=>connection.RequestAsync('close-file',{Id:f.Id})})};}
    DownloadAsync(name,bytes,mimeType='application/octet-stream'){return this.Connection.RequestAsync('download',{Name:name,Bytes:bytes,MimeType:mimeType});}
}

export function InstallWorkerWindowFactory(platform) {
    Window.WorkerWindowFactory = (root, owner, options = {}) => {
        root._ownsBrowserWindow = true;
        let connection, renderPort;
        root.WhenOpened = owner.HostConnection.RequestAsync('open-window', {
            Title:root.Title, Width:Number.isFinite(root.Width) ? root.Width : 800,
            Height:Number.isFinite(root.Height) ? root.Height : 600, Backend:options.Backend ?? owner.Renderer.Backend
        }).then(async service => {
            connection = new ThreadChannel(service.Port, {OnError:e=>root._ReportRenderError(e)});
            renderPort = service.RenderPort;
            if (root.IsDisposed || owner.IsDisposed) throw new Error('Window closed while its browser host was opening.');
            InstallWorkerTopLevel(root);
            await root.AttachWorker(connection, renderPort, platform, service.Snapshot);
            connection.OnEvent = message => {
                if (message.Type === 'render-worker-failed') { root.Renderer._Recover(new Error(message.Message)); return; }
                if (message.Type === 'events') {
                    try { for (const event of message.Events) root.ProcessHostMessage(event); }
                    finally { connection.Send({Type:'events-ack'}); }
                }
            };
            Window.Windows.add(root);
            connection.Send({Type:'ready'});
            return root;
        }).catch(error => {
            // Preserve startup failures even before a renderer/host is attached.
            root.LastRenderError = error;
            connection?.Send({Type:'close-window'});
            connection?.Dispose();
            renderPort?.close();
            root._dialogReject?.(error);
            root._dialogResolve = root._dialogReject = null;
            if (owner && !owner.IsDisposed && root._ownerEnabled !== undefined) owner.IsEnabled = root._ownerEnabled;
            root._FinishClose();
            throw error;
        });
        return root;
    };
}
