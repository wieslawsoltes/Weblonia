import { OpenSecondaryDocumentAsync, WaitForSecondaryRendererAsync, SecondaryWorkerError } from './secondary-startup.js';
import { SkiaWasmModuleSource } from "../../skia/src/wasm-module-source.js";
import { Disposable, Event } from "../../base/src/index.js";
import { GetBrowserWorkerUrls, BrowserThreadingMode } from './threading-options.js';
import { ThreadChannel, TransferResult } from './thread-channel.js';
import { BrowserStorageProvider, BrowserScreens } from './browser-services.js';

/** Thin document owner. No Avalonia controls, bindings, layout or native Skia
 * runtime are instantiated here. UI and render workers communicate directly. */
export class BrowserWorkerApplication extends Disposable {
    constructor(container,options={}){super();if(!container?.ownerDocument)throw new TypeError('A document container is required.');if(!options.ApplicationModule)throw new TypeError('A worker-safe ApplicationModule URL is required.');this.Container=container;this.Options=options;this.Window=container.ownerDocument.defaultView;this.Document=container.ownerDocument;this.Errors=new Event();this.Mode=BrowserThreadingMode.FullIsolation;this._events=[];this._inputFlight=false;this._inputSequence=0;this._latestEditSequence=0;this._listeners=[];this._startupAbort=new AbortController();this._requests=new Set();this._handles=new Map();this.Children=new Set();this.NativeHosts=new Map();this._nextHandle=1;this._fastRequests=new Map();this._nextFast=1;this.Statistics={EventsSent:0,EventBatches:0,CoalescedMoves:0,MaxQueuedEvents:0,AutomationWrites:0,MainHasSkiaRuntime:false};this._ready=new Promise((r,j)=>{this._readyResolve=r;this._readyReject=j;});this._ready.catch(()=>{});this.Startup={};this.StartupEvents=[];}
    async StartAsync(){
        if(typeof Worker!=='function'||!this.Window.HTMLCanvasElement.prototype.transferControlToOffscreen)throw new Error('Full isolation requires workers and transferable OffscreenCanvas.');
        this._CreateDom();const urls={...GetBrowserWorkerUrls(),...this.Options.WorkerUrls};
        const runtime={Backend:this.Options.Backend??'auto',AllowFallback:this.Options.AllowFallback,LoaderUrl:this.Options.LoaderUrl??urls.LoaderUrl,AssetBaseUrl:this.Options.AssetBaseUrl??new URL('../vendor/',import.meta.resolve("../../../vendor/skiasharpweb/dist/package/browser.js")).href,HandlerModules:this.Options.HandlerModules??[]};
        if(this.Options.ShareWasmModule!==false)this._wasmSource=new SkiaWasmModuleSource({...runtime,WasmModule:this.Options.WasmModule,InitializationTimeout:this.Options.InitializationTimeout});
        this.UiWorker=new this.Window.Worker(this.Options.UiWorkerUrl??urls.UiWorkerUrl,{type:this.Options.UiWorkerType??'module',name:'Avalonia.UI'});
        this.RenderWorker=new this.Window.Worker(this.Options.RenderWorkerUrl??urls.RenderWorkerUrl,{type:this.Options.WorkerType??'module',name:'Avalonia.Composition.Render'});
        for(const [name,worker]of[['UI',this.UiWorker],['render',this.RenderWorker]]){
            worker.onerror=e=>name==='render'&&this._initialized?this.Channel.Send({Type:'render-worker-failed',Message:e.message || 'worker script failed'}):this._Fail(new Error(`${name} worker failed: ${e.message || 'could not load entry script; check worker URL, MIME type and CSP'}`));
            worker.onmessageerror=()=>this._Fail(new Error(`${name} worker startup message could not be deserialized.`));
            worker.onmessage=e=>this._WorkerMessage(e.data);
        }
        const control=new MessageChannel(),render=new MessageChannel(),input=new MessageChannel();this._ConnectFast(input.port1);this.Channel=new ThreadChannel(control.port1,{OnEvent:m=>this._Message(m),OnRequest:(m,v)=>this._Service(m,v),OnError:e=>this._Fail(e)});
        const canvas=this.Canvas.transferControlToOffscreen();
        this._runtime=runtime;this._workerUrls=urls;
        const renderTransfer=[canvas,render.port1,input.port2],uiTransfer=[control.port2,render.port2];
        const renderRuntime=this._PrepareRuntime(runtime,renderTransfer),uiRuntime=this._PrepareRuntime(runtime,uiTransfer);
        this.RenderWorker.postMessage({Type:'initialize',Canvas:canvas,Port:render.port1,InputPort:input.port2,Options:renderRuntime},renderTransfer);
        this.UiWorker.postMessage({Type:'initialize',Port:control.port2,RenderPort:render.port2,ApplicationModule:String(this.Options.ApplicationModule),ApplicationExport:this.Options.ApplicationExport??'CreateWorkerApplication',ApplicationOptions:this.Options.ApplicationOptions??{},Snapshot:this._Snapshot(),Runtime:uiRuntime},uiTransfer);
        this._InstallEvents();this._initTimer=setTimeout(()=>this._Fail(new Error('Isolated application initialization timed out. Last stages: '+Object.entries(this.Startup).map(([role,status])=>role+': '+status.Stage+(status.Url?' ('+status.Url+')':'')).join('; '))),this.Options.InitializationTimeout??45000);return this._ready;
    }
    _PrepareRuntime(runtime,transfer){
        if(!this._wasmSource)return runtime;
        const WasmModulePort=this._wasmSource.CreatePort({Signal:this._startupAbort.signal});transfer.push(WasmModulePort);
        return{...runtime,WasmModulePort,InitializationTimeout:this.Options.InitializationTimeout??45000};
    }
    _WorkerMessage(message){
        if(this.IsDisposed||this.LastError)return;
        if(message?.Type==='startup-progress'){this.Startup[message.Role]=message;if(this.StartupEvents.length>=64)this.StartupEvents.shift();this.StartupEvents.push({...message,ObservedAt:performance.now()});}
        else if(message?.Type==='bootstrap-error')this._Fail(new Error(message.Error));
    }
    _CreateDom(){
        const doc=this.Document;this.Container.style.position||='relative';this.Container.style.overflow='hidden';
        this.Canvas=doc.createElement('canvas');this.Canvas.tabIndex=0;this.Canvas.style.cssText='width:100%;height:100%;display:block;outline:none;touch-action:none;';this.Container.append(this.Canvas);
        const editor=password=>{const e=doc.createElement(password?'input':'textarea');if(password)e.type='password';e.hidden=true;e.tabIndex=-1;e.autocomplete='off';e.spellcheck=false;e.style.cssText='position:absolute;width:1px;height:1px;opacity:0;z-index:100;resize:none;pointer-events:none;padding:0;border:0;font-size:16px;';this.Container.append(e);return e;};
        this.PlainInput=editor(false);this.PasswordInput=editor(true);this.Input=this.PlainInput;
        this.Aria=doc.createElement('div');this.Aria.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);';this.Container.append(this.Aria);this.Nodes=new Map([[0,this.Aria],[1,this.Canvas],[2,this.PlainInput],[3,this.PasswordInput]]);
    }
    _Snapshot(){const rect=this.Container.getBoundingClientRect(),w=this.Window,s=w.screen;return{...this.Options.SnapshotData,Width:Math.max(1,rect.width),Height:Math.max(1,rect.height),Scale:w.devicePixelRatio||1,UserAgent:w.navigator.userAgent,Languages:w.navigator.languages,HardwareConcurrency:w.navigator.hardwareConcurrency,SecureContext:w.isSecureContext,WebGPU:!!w.navigator.gpu,CanSave:!!w.showSaveFilePicker,Screen:{width:s.width,height:s.height,availWidth:s.availWidth,availHeight:s.availHeight,availLeft:s.availLeft??0,availTop:s.availTop??0,colorDepth:s.colorDepth},Media:Object.fromEntries(['(prefers-color-scheme: dark)','(prefers-reduced-motion: reduce)','(forced-colors: active)','(pointer: coarse)'].map(q=>[q,w.matchMedia(q).matches]))};}
    _Listen(target,type,handler,options){target.addEventListener(type,handler,options);this._listeners.push(()=>target.removeEventListener(type,handler,options));}
    _Event(e){const positioned=Number.isFinite(e.clientX)&&Number.isFinite(e.clientY),r=positioned?this.Canvas.getBoundingClientRect():null,v={Position:{X:positioned?e.clientX-r.left:0,Y:positioned?e.clientY-r.top:0}};for(const key of ['type','pointerId','pointerType','isPrimary','button','buttons','pressure','tiltX','tiltY','twist','width','height','detail','timeStamp','key','code','repeat','ctrlKey','altKey','shiftKey','metaKey','deltaX','deltaY','deltaMode','isComposing'])if(e[key]!==undefined)v[key]=e[key];return v;}
    _Queue(message){message.Sequence=++this._inputSequence;const last=this._events.at(-1);if(message.Type==='pointer'&&message.Event.type==='pointermove'&&last?.Type==='pointer'&&last.Event.type==='pointermove'&&last.Event.pointerId===message.Event.pointerId){this._events[this._events.length-1]=message;this.Statistics.CoalescedMoves++;}else if(message.Type==='resize'&&last?.Type==='resize')this._events[this._events.length-1]=message;else this._events.push(message);this.Statistics.MaxQueuedEvents=Math.max(this.Statistics.MaxQueuedEvents,this._events.length);if(this._events.length>8192){this._Fail(new Error('UI input queue exceeded its safety budget.'));return;}this._PumpInput();return message.Sequence;}
    _PumpInput(){if(!this._initialized||!this.Channel||this._inputFlight||!this._events.length||this.IsDisposed)return;this._inputFlight=true;const events=this._events.splice(0,256);this.Statistics.EventsSent+=events.length;this.Statistics.EventBatches++;this.Channel.Send({Type:'events',Events:events});}
    _InstallEvents(){
        for(const type of ['pointerdown','pointerup','pointermove','pointercancel','pointerleave','lostpointercapture'])this._Listen(this.Canvas,type,e=>{if(type==='pointerdown'){this.Canvas.focus({preventScroll:true});try{this.Canvas.setPointerCapture(e.pointerId);}catch{}}this._Queue({Type:'pointer',Event:this._Event(e)});if(type!=='pointermove'||e.buttons)e.preventDefault();});
        this._Listen(this.Canvas,'wheel',e=>{const event=this._Event(e),sequence=this._Queue({Type:'wheel',Event:event});this.FastPort?.postMessage({Type:'input-wheel',Sequence:sequence,Event:event});e.preventDefault();},{passive:false});
        this._Listen(this.Canvas,'contextmenu',e=>e.preventDefault());
        for(const down of [true,false])this._Listen(this.Document,down?'keydown':'keyup',e=>{
            if(!this.Container.contains(this.Document.activeElement)||e.target.closest?.('dialog')||this.Aria.contains(e.target)&&e.key!=='Tab')return;
            const native=e.target===this.Input&&!this.Input.hidden,hosted=[...this.NativeHosts.values()].find(h=>h.Wrapper.contains(e.target));
            if(hosted&&e.key==='Tab'){
                const element=hosted.Control?.Element,selector='input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex="0"]';
                const children=element?[...(element.matches(selector)?[element]:[]),...element.querySelectorAll(selector)]:[],index=children.indexOf(this.Document.activeElement);
                if(e.shiftKey?index>0:index>=0&&index<children.length-1)return;
            }
            const event=this._Event(e);event.BrowserEditorOwned=native;
            this._Queue({Type:'key',Down:down,Event:event});
            if(hosted){if(e.key==='Tab')e.preventDefault();return;}
            if(!native||e.key==='Tab'||e.key==='Escape'||e.key==='Enter'&&!this.Editor?.AcceptsReturn||(e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase()))e.preventDefault();
        },true);
        for(const input of [this.PlainInput,this.PasswordInput]){
            const edit=(kind,composing=false)=>{if(input!==this.Input||!this.Editor?.Owner)return;this._latestEditSequence=this._Queue({Type:'edit',Owner:this.Editor.Owner,Kind:kind,Value:input.value,Start:input.selectionStart,End:input.selectionEnd,Direction:input.selectionDirection,Composing:composing});};
            this._Listen(input,'compositionstart',()=>{this._composing=true;edit('input',true);});this._Listen(input,'compositionend',()=>{this._composing=false;edit('input',false);});this._Listen(input,'input',()=>edit('input',this._composing));
            this._Listen(input,'beforeinput',e=>{if(this.Editor?.ReadOnly||!this.Editor?.AcceptsReturn&&['insertLineBreak','insertParagraph'].includes(e.inputType)){e.preventDefault();return;}if(!this._composing&&!e.isComposing&&['deleteContentBackward','deleteContentForward'].includes(e.inputType)){e.preventDefault();this._latestEditSequence=this._Queue({Type:'edit',Owner:this.Editor.Owner,Kind:'delete',Backward:e.inputType==='deleteContentBackward',Start:input.selectionStart,End:input.selectionEnd});}});
            this._Listen(this.Document,'selectionchange',()=>{if(this.Document.activeElement===input&&input===this.Input&&!this._updatingEditor&&!this._composing){const key=[input.selectionStart,input.selectionEnd,input.selectionDirection].join(':');if(key!==this._selectionKey){this._selectionKey=key;edit('selection');}}});
        }
        this._Listen(this.Window,'blur',()=>this._Queue({Type:'blur'}));this._Listen(this.Window,'focus',()=>this._Queue({Type:'focus'}));this._Listen(this.Document,'visibilitychange',()=>this._Queue({Type:'visibility',Visible:!this.Document.hidden}));
        for(const query of ['(prefers-color-scheme: dark)','(prefers-reduced-motion: reduce)','(forced-colors: active)','(pointer: coarse)'])this._Listen(this.Window.matchMedia(query),'change',e=>this._Queue({Type:'platform-media',Query:query,Matches:e.matches}));
        this._resize=new this.Window.ResizeObserver(()=>this._Queue({Type:'resize',Snapshot:this._Snapshot()}));this._resize.observe(this.Container);this._Listen(this.Window,'resize',()=>this._Queue({Type:'resize',Snapshot:this._Snapshot()}));this._Listen(this.Window,'beforeunload',()=>{this.Channel?.Send({Type:'events',Events:[{Type:'close',Sequence:++this._inputSequence}]});this.Dispose();});
    }
    _Message(m){
        switch(m.Type){
            case 'ready':this._initialized=true;clearTimeout(this._initTimer);this._readyResolve(this);this._PumpInput();break;
            case 'events-ack':this._inputFlight=false;this._PumpInput();break;
            case 'application-error':this._Fail(Object.assign(new Error(m.Error.Message),{name:m.Error.Name}));break;
            case 'automation':this._Automation(m.Operations);break;
            case 'editor':this._Editor(m.State);break;
            case 'native-create':this._CreateNative(m).catch(e=>this._Fail(e));break;
            case 'native-state':{const h=this.NativeHosts.get(m.Id);if(h){h.State=m;this._SyncNative(h);}break;}
            case 'native-remove':{const h=this.NativeHosts.get(m.Id);if(h){h.Disposed=true;h.Control?.Dispose?.();h.Wrapper.remove();this.NativeHosts.delete(m.Id);}break;}
            case 'native-focus':{const h=this.NativeHosts.get(m.Id),e=h?.Control?.Element;const target=e?.matches('input,select,textarea,button,[tabindex]')?e:e?.querySelector('input,select,textarea,button,[tabindex]');target?.focus({preventScroll:true});break;}
            case 'cursor':this.Canvas.style.cursor=m.Value;break;
            case 'capture':try{m.Capture?this.Canvas.setPointerCapture(m.PointerId):this.Canvas.releasePointerCapture(m.PointerId);}catch{}break;
            case 'title':this.Document.title=m.Value;break;
            case 'focus-window':this.Window.focus();break;
            case 'close-window':this.Options.OwnsWindow?this.Window.close():this.Dispose();break;
        }
    }
    _Automation(ops){for(const op of ops){const[k,id,a,b]=op;let node=this.Nodes.get(id);if(k==='create'){if(a!=='div'||this.Nodes.has(id))throw new Error('Invalid semantic node creation.');node=this.Document.createElement('div');this.Nodes.set(id,node);for(const name of ['click','keydown','focus'])node.addEventListener(name,e=>{if(name==='keydown'&&e.key==='Tab')return;this._Queue({Type:'automation-event',Id:id,Name:name,Event:this._Event(e)});if(name!=='focus'){e.preventDefault();e.stopPropagation();}});}
        else if(k==='attr'){if(!node)continue;if(a!=='id'&&a!=='role'&&a!=='tabindex'&&!a.startsWith('aria-'))throw new Error('Invalid semantic attribute.');b==null?node.removeAttribute(a):node.setAttribute(a,b);}
        else if(k==='text'){if(node)node.textContent=a;}
        else if(k==='insert'){const child=this.Nodes.get(a),before=b==null?null:this.Nodes.get(b);if(node&&child&&child!==before)node.insertBefore(child,before);}
        else if(k==='remove'){if(id<10)continue;node?.remove();this.Nodes.delete(id);}else throw new Error('Invalid semantic mutation.');this.Statistics.AutomationWrites++;}}
    _Editor(state){
        if(state.AcknowledgedInput<this._latestEditSequence&&state.Owner===this.Editor?.Owner)return;
        const old=this.Editor;this.Editor=state;
        if(!state.Owner&&!old?.Owner){this._composing=false;return;}
        if(!state.Owner){for(const input of [this.PlainInput,this.PasswordInput]){input.hidden=true;input.value='';}if(old?.Owner)this.Canvas.focus({preventScroll:true});this._composing=false;return;}
        const next=state.Password?this.PasswordInput:this.PlainInput;
        if(next!==this.Input||old?.Owner!==state.Owner){this.Input.hidden=true;this.Input.value='';this._composing=false;}
        this.Input=next;next.hidden=false;next.readOnly=state.ReadOnly;next.inputMode=state.InputMode;next.dir=state.Dir;next.style.left=state.X+'px';next.style.top=state.Y+'px';
        if(!this._composing){this._updatingEditor=true;try{if(next.value!==state.Value)next.value=state.Value;if(next.selectionStart!==state.Start||next.selectionEnd!==state.End||next.selectionDirection!==state.Direction)next.setSelectionRange(state.Start,state.End,state.Direction);this._selectionKey=[state.Start,state.End,state.Direction].join(':');}finally{this._updatingEditor=false;}}
        if(this.Document.activeElement!==next)next.focus({preventScroll:true});
    }
    async _Privileged(label,action){
        if(this.Window.navigator.userActivation?.isActive)return action();
        // Worker messages do not inherit transient user activation. Ask for a real
        // browser click instead of pretending that a delayed RPC retains it.
        return new Promise((resolve,reject)=>{const d=this.Document.createElement('dialog'),p=this.Document.createElement('p'),yes=this.Document.createElement('button'),no=this.Document.createElement('button');p.textContent=label;yes.textContent='Continue';no.textContent='Cancel';d.append(p,yes,no);this.Container.append(d);const finish=()=>{this._requests.delete(cancel);d.close();d.remove();};const cancel=()=>{finish();reject(new DOMException('User canceled the browser operation.','AbortError'));};this._requests.add(cancel);yes.onclick=()=>{try{const task=action();finish();Promise.resolve(task).then(resolve,reject);}catch(e){finish();reject(e);}};no.onclick=cancel;d.oncancel=e=>{e.preventDefault();cancel();};d.showModal();});
    }
    _ConnectFast(port){this.FastPort?.close();for(const r of this._fastRequests.values()){clearTimeout(r.Timer);r.Reject(new Error('Render channel was replaced.'));}this._fastRequests.clear();this.FastPort=port;port.onmessage=e=>{const m=e.data,r=this._fastRequests.get(m.Id);if(!r)return;this._fastRequests.delete(m.Id);clearTimeout(r.Timer);m.Error?r.Reject(new Error(m.Error)):r.Resolve(m.Value);};port.start();}
    _FastRequest(method){if(!this.FastPort||this.IsDisposed)return Promise.reject(new Error('Render channel unavailable.'));if(this._fastRequests.size>=16)return Promise.reject(new Error('Fast request queue is full.'));const id=this._nextFast++;return new Promise((Resolve,Reject)=>{const Timer=setTimeout(()=>{this._fastRequests.delete(id);Reject(new Error('Fast render request timed out.'));},30000);this._fastRequests.set(id,{Resolve,Reject,Timer});this.FastPort.postMessage({Type:'fast-request',Id:id,Method:method});});}
    GetRenderDiagnosticsAsync(){return this._FastRequest('diagnostics');}
    async CaptureRenderedFrameAsync(){return(await this._FastRequest('snapshot-png')).Bytes;}
    async _CreateNative(message){
        if(!(this.Options.HostModules??[]).includes(message.Module))throw new Error('The browser native-control module was not registered by the host.');
        const wrapper=this.Document.createElement('div');wrapper.style.cssText='position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden;';this.Container.append(wrapper);
        const h={Wrapper:wrapper,State:null,Disposed:false};this.NativeHosts.set(message.Id,h);
        try { const module=await import(message.Module),factory=module[message.Export??'CreateControl'];if(typeof factory!=='function')throw new TypeError('Invalid browser native-control factory export.');
        const result=await factory({Document:this.Document,Container:wrapper,Send:value=>{h.LatestInput=this._Queue({Type:'native-message',Id:message.Id,Value:value});return h.LatestInput;}});
        if(!result?.Element||result.Element.ownerDocument!==this.Document)throw new TypeError('Browser native-control factories must return their owned Element.');
        if(h.Disposed){result.Dispose?.();return;}h.Control=result;result.Element.id='avalonia-native-'+message.Id;wrapper.append(result.Element);wrapper.addEventListener('focusin',()=>this._Queue({Type:'native-focus',Id:message.Id}));this._SyncNative(h);} catch(error){h.Disposed=true;h.Control?.Dispose?.();wrapper.remove();this.NativeHosts.delete(message.Id);throw error;}
    }
    _SyncNative(h){if(!h.State||!h.Control)return;h.Wrapper.inert=!h.State.Enabled;const s=h.State.Style;for(const[key,value]of Object.entries(s))if(['display','width','height','opacity','transform','clipPath','pointerEvents'].includes(key))h.Wrapper.style[key]=value;if((h.State.AcknowledgedInput??0)>=(h.LatestInput??0))h.Control.Update?.(h.State.Value);h.Control.Element.setAttribute('aria-disabled',String(!h.State.Enabled));if('disabled'in h.Control.Element)h.Control.Element.disabled=!h.State.Enabled;}
    async _OpenWindow(value) {
        return this._Privileged('Open '+(value.Title || 'an application window')+'?', async () => {
            this._startupAbort.signal.throwIfAborted();
            // Open synchronously inside the actual user activation. Native setup
            // may then wait for the new document, with the popup still owned here.
            const deadline = performance.now() + Math.min(this.Options.InitializationTimeout ?? 45000, this.Channel?.Timeout ?? 30000);
            let host, popup;
            const ports = [];
            try {
                popup = await OpenSecondaryDocumentAsync(this.Window, this.Options.SecondaryWindowUrl ?? new URL('./secondary-window.html', import.meta.url),
                    `popup=yes,width=${Math.round(value.Width)},height=${Math.round(value.Height)}`,
                    {Signal:this._startupAbort.signal, Timeout:deadline-performance.now()});
                const doc = popup.document;
                doc.title = value.Title;
                doc.documentElement.style.height = '100%';
                doc.body.style.cssText = 'margin:0;height:100%;overflow:hidden;';
                const container = doc.createElement('div');
                container.style.cssText = 'width:100%;height:100%';
                doc.body.append(container);
                host = new BrowserWorkerApplication(container, {...this.Options, OwnsWindow:true});
                host._parentHost = this;
                this.Children.add(host);
                host._CreateDom();
                host._runtime = {...this._runtime, Backend:value.Backend};
                host._workerUrls = this._workerUrls;
                host._wasmSource = this._wasmSource;
                host._borrowsWasmSource = true;
                const control = new MessageChannel(), render = new MessageChannel();
                ports.push(control.port1, control.port2, render.port1, render.port2);
                host.Channel = new ThreadChannel(control.port1, {OnEvent:m=>host._Message(m), OnRequest:(m,v)=>host._Service(m,v), OnError:e=>host._Fail(e)});
                const url = host.Options.RenderWorkerUrl ?? host._workerUrls.RenderWorkerUrl;
                const worker = host.RenderWorker = new popup.Worker(url, {type:host.Options.WorkerType ?? 'module', name:'Avalonia.Composition.Window'});
                worker.onerror = event => {
                    const error = SecondaryWorkerError(event, url);
                    if (host._initialized) host.Channel.Send({Type:'render-worker-failed', Message:error.message});
                    else host._Fail(error);
                };
                worker.onmessage = event => host._WorkerMessage(event.data);
                worker.onmessageerror = () => host._Fail(new Error('Secondary render worker startup message could not be deserialized.'));
                host._InstallEvents();
                const canvas = host.Canvas.transferControlToOffscreen();
                const transfer = [canvas, render.port1];
                const runtime = host._PrepareRuntime(host._runtime, transfer);
                await WaitForSecondaryRendererAsync(worker, url, () => worker.postMessage({Type:'initialize', Canvas:canvas, Port:render.port1, Options:runtime}, transfer),
                    {Signal:host._startupAbort.signal, Timeout:deadline-performance.now()});
                this._startupAbort.signal.throwIfAborted();
                host._startupAbort.signal.throwIfAborted();
                // Only a native-ready renderer is handed to the UI. A failure
                // rejects open-window itself, allowing ShowDialog to restore its
                // owner immediately rather than stranding a renderer handshake.
                return TransferResult({Port:control.port2, RenderPort:render.port2, Snapshot:host._Snapshot()}, control.port2, render.port2);
            } catch (error) {
                host?.Dispose();
                for (const port of ports) port.close();
                popup?.close();
                throw error;
            }
        });
    }
    async _RestartRenderer() {
        this.RenderWorker?.terminate();
        const old=this.Canvas,canvas=this.Document.createElement('canvas');for(const a of [...old.attributes])if(a.name!=='width'&&a.name!=='height')canvas.setAttribute(a.name,a.value);
        for(const remove of this._listeners.splice(0))remove();this._resize?.disconnect();old.replaceWith(canvas);this.Canvas=canvas;this.Nodes.set(1,canvas);
        const worker=this.RenderWorker=new this.Window.Worker(this.Options.RenderWorkerUrl??this._workerUrls.RenderWorkerUrl,{type:this.Options.WorkerType??'module',name:'Avalonia.Composition.Render'});
        worker.onerror=e=>this.Channel.Send({Type:'render-worker-failed',Message:e.message});worker.onmessage=e=>this._WorkerMessage(e.data);
        const channel=new MessageChannel(),input=new MessageChannel(),offscreen=canvas.transferControlToOffscreen();this._ConnectFast(input.port1);
        const transfer=[offscreen,channel.port1,input.port2];worker.postMessage({Type:'initialize',Canvas:offscreen,Port:channel.port1,InputPort:input.port2,Options:this._PrepareRuntime(this._runtime,transfer)},transfer);this._InstallEvents();this._Queue({Type:'blur'});this._Queue({Type:'focus'});
        return TransferResult({Port:channel.port2},channel.port2);
    }
    async _Service(method,v){switch(method){
        case 'open-window':return this._OpenWindow(v);
        case 'restart-renderer':return this._RestartRenderer();
        case 'clipboard-read':return this._Privileged('Allow the application to read the clipboard?',()=>this.Window.navigator.clipboard.readText());
        case 'clipboard-write':return this.Window.navigator.clipboard.writeText(v.Text);
        case 'open-files':return this._Privileged(v.Title??'Choose files for the application',async()=>{const files=await new BrowserStorageProvider(this.Window).OpenFilePickerAsync(v);const data=await Promise.all(files.map(async f=>({Name:f.Name,Bytes:await f.OpenReadAsync(),Modified:(await f.GetBasicPropertiesAsync()).DateModified?.getTime()})));return data;});
        case 'save-file':return this._Privileged(v.Title??'Save a file',async()=>{const file=await new BrowserStorageProvider(this.Window).SaveFilePickerAsync(v);if(!file)return null;const id=this._nextHandle++;this._handles.set(id,{file});return{Id:id,Name:file.Name};});
        case 'write-file':{const h=this._handles.get(v.Id);if(!h)throw new Error('Unknown granted file.');h.writer??=await h.file.OpenWriteAsync();await h.writer.write(v.Bytes);return true;}
        case 'close-file':{const h=this._handles.get(v.Id);await h?.writer?.close();this._handles.delete(v.Id);return true;}
        case 'download':return new BrowserStorageProvider(this.Window).DownloadAsync(v.Name,v.Bytes,v.MimeType);
        case 'screen-details':return this._Privileged('Enumerate additional screens?',()=>new BrowserScreens(this.Window).RequestScreenDetailsAsync());
        case 'fullscreen':return this._Privileged('Change fullscreen mode?',()=>v.Enabled?this.Container.requestFullscreen():this.Document.exitFullscreen());
        default:if(this.Options.Services?.[method])return this.Options.Services[method](v,this);throw new Error(`Browser service '${method}' is not registered.`);
    }}
    _Fail(error){if(this.LastError||this.IsDisposed)return;this.LastError=error;this._startupAbort.abort(error);clearTimeout(this._initTimer);this._readyReject(error);
        // Before ready there is no application capable of recovering. Terminate
        // both owners so a late init cannot continue drawing into a failed host.
        if(!this._initialized){if(!this._borrowsWasmSource)this._wasmSource?.Dispose();this.UiWorker?.terminate();this.RenderWorker?.terminate();this.FastPort?.close();this.Channel?.Dispose();}
        this.Errors.Raise(this,{Error:error});
    }
    async InvokeAsync(command,value=null){await this._ready;return this.Channel.RequestAsync('invoke',{Command:command,Value:value});}
    async GetDiagnosticsAsync(){await this._ready;return{Mode:this.Mode,Host:{...this.Statistics,NativePreparation:this._wasmSource?{...this._wasmSource.Statistics,PendingDeliveries:this._wasmSource.PendingDeliveries}:null,StartupEvents:[...this.StartupEvents],QueuedEvents:this._events.length,HasDocument:true},...await this.Channel.RequestAsync('diagnostics')};}
    async RestartRendererAsync(){await this._ready;return this.Channel.RequestAsync('restart-renderer');}
    async CapturePngAsync(){await this._ready;return this.Channel.RequestAsync('snapshot-png');}
    async DisposeAsync(){if(this.IsDisposed)return;if(!this._initialized||this.LastError){this.Dispose();return;}try{await this.Channel?.RequestAsync('dispose');}finally{this.Dispose();}}
    Dispose(){if(this.IsDisposed)return;super.Dispose();this._startupAbort.abort(new Error('Application disposed during initialization.'));this._parentHost?.Children.delete(this);this._parentHost=null;if(!this._borrowsWasmSource)this._wasmSource?.Dispose();clearTimeout(this._initTimer);if(!this._initialized)this._readyReject(new Error('Application disposed during initialization.'));for(const f of this._listeners.splice(0))f();this._resize?.disconnect();for(const cancel of this._requests)cancel();this.FastPort?.close();for(const r of this._fastRequests.values()){clearTimeout(r.Timer);r.Reject(new Error('Application disposed.'));}this._fastRequests.clear();this.Channel?.Dispose();this.UiWorker?.terminate();this.RenderWorker?.terminate();for(const e of [this.Canvas,this.PlainInput,this.PasswordInput,this.Aria])e?.remove();for(const h of this.NativeHosts.values()){h.Disposed=true;h.Control?.Dispose?.();h.Wrapper.remove();}this.NativeHosts.clear();for(const child of this.Children){child.Dispose();if(child.Options.OwnsWindow)child.Window.close();}this.Children.clear();this._events=[];this.Nodes?.clear();this.Errors.Clear();}
}
export async function StartWorkerApplicationAsync(container,options){const host=new BrowserWorkerApplication(container,options);try{return await host.StartAsync();}catch(e){host.Dispose();throw e;}}
