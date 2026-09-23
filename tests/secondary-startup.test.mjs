import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WaitForWindowDocumentAsync, WaitForSecondaryRendererAsync, OpenSecondaryDocumentAsync } from '../packages/browser/src/secondary-startup.js';
import { InstallWorkerWindowFactory } from '../packages/browser/src/worker-top-level.js';
import { Window } from '../packages/browser/src/index.js';
import { ThreadChannel } from '../packages/browser/src/thread-channel.js';
import { BrowserWorkerApplication } from '../packages/browser/src/isolated-host.js';
import { SkiaWasmModuleSource, ReceiveSkiaWasmModuleAsync } from '../packages/skia/src/wasm-module-source.js';

const wasm = new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));
const tick = () => new Promise(resolve=>setImmediate(resolve));
class Target extends EventTarget {
    emit(type, value = {}) {
        const event = new Event(type); Object.assign(event, value);
        this['on'+type]?.(event); this.dispatchEvent(event);
    }
}
function noListeners(target, names) {
    for (const name of names) assert.equal(getEventListeners(target, name).length, 0, name+' leaked');
}
function fakeWindow(readyState='loading') {
    const window = new Target(); window.closed=false;
    const document=window.document={readyState,defaultView:window,documentElement:{style:{}},body:{style:{},append(){}},
        createElement(){return{ownerDocument:document,style:{},remove(){}};}};
    window.close=()=>{if(window.closed)return;window.closed=true;window.emit('beforeunload');window.emit('pagehide');};
    return window;
}

test('secondary document waits for load, then releases all lifecycle listeners',async()=>{
    const window=fakeWindow(),controller=new AbortController();let done=false;
    const p=WaitForWindowDocumentAsync(window,{Timeout:1000,Signal:controller.signal}).then(()=>done=true);
    await tick();assert.equal(done,false);window.document.readyState='complete';window.emit('load');await p;
    noListeners(window,['load','pagehide']);noListeners(controller.signal,['abort']);
});
test('secondary already-complete document needs no timer or listener after completion',async()=>{
    const window=fakeWindow('complete');await WaitForWindowDocumentAsync(window,{Timeout:1000});noListeners(window,['load','pagehide']);
});
test('secondary document replacement and closed-window startup reject',async()=>{
    for(const closed of [false,true]){
        const window=fakeWindow();const p=WaitForWindowDocumentAsync(window,{Timeout:1000});
        if(closed)window.close();else{window.document={readyState:'complete'};window.emit('load');}
        await assert.rejects(p,/closed|navigated/);noListeners(window,['load','pagehide']);
    }
});
test('secondary document cancellation propagates the exact reason and removes listeners',async()=>{
    const window=fakeWindow(),controller=new AbortController(),reason=new Error('owner stopped');
    const p=WaitForWindowDocumentAsync(window,{Signal:controller.signal});controller.abort(reason);
    await assert.rejects(p,error=>error===reason);noListeners(window,['load','pagehide']);noListeners(controller.signal,['abort']);
});
test('secondary document timeout is bounded and removes its lifecycle listeners',async()=>{
    const window=fakeWindow();await assert.rejects(WaitForWindowDocumentAsync(window,{Timeout:5}),/timed out/);noListeners(window,['load','pagehide']);
});
test('secondary renderer starts with listeners already installed and accepts only native-ready render role',async()=>{
    const worker=new Target();let resolved=false;
    const p=WaitForSecondaryRendererAsync(worker,'/render.js',()=>{
        assert.equal(getEventListeners(worker,'message').length,1);
        worker.emit('message',{data:{Type:'startup-progress',Role:'ui',Stage:'ready'}});
        worker.emit('message',{data:{Type:'startup-progress',Role:'render',Stage:'module-import'}});
    },{Timeout:1000}).then(()=>resolved=true);
    await tick();assert.equal(resolved,false);
    worker.emit('message',{data:{Type:'startup-progress',Role:'render',Stage:'ready'}});await p;
    noListeners(worker,['message','messageerror','error']);
});
for(const kind of ['throw','error','messageerror','bootstrap'])test(`secondary ${kind} failure settles before publishing channels`,async()=>{
    const worker=new Target(),controller=new AbortController();
    const p=WaitForSecondaryRendererAsync(worker,'/render.js',()=>{
        if(kind==='throw')throw new Error('postMessage failed');
        if(kind==='error')worker.emit('error',{message:'bad entry',filename:'/failure.js',lineno:7,colno:3});
        if(kind==='messageerror')worker.emit('messageerror');
        if(kind==='bootstrap')worker.emit('message',{data:{Role:'render',Type:'bootstrap-error',Error:'native link failed'}});
    },{Signal:controller.signal,Timeout:1000});
    await assert.rejects(p,kind==='error'?/\/render.js.*bad entry.*\/failure.js:7:3/:/failed|deserialized/);
    noListeners(worker,['message','messageerror','error']);noListeners(controller.signal,['abort']);
});
test('secondary renderer abort before start allocates no worker delivery or listener',async()=>{
    const worker=new Target(),controller=new AbortController();controller.abort(new Error('pre-canceled'));
    await assert.rejects(WaitForSecondaryRendererAsync(worker,'/render.js',()=>assert.fail('started'),{Signal:controller.signal}),/pre-canceled/);
    noListeners(worker,['message','messageerror','error']);
});
test('one canceled native-module delivery does not dispose the shared source or affect its sibling',async t=>{
    const source=new SkiaWasmModuleSource({WasmModule:wasm}),controller=new AbortController();t.after(()=>source.Dispose());
    const port=source.CreatePort({Signal:controller.signal});t.after(()=>port.close());
    const rejected=assert.rejects(ReceiveSkiaWasmModuleAsync(port),/child stopped/);
    controller.abort(new Error('child stopped'));await rejected;
    assert.equal(source.PendingDeliveries,0);assert.equal(source.IsDisposed,false);
    await ReceiveSkiaWasmModuleAsync(source.CreatePort());
    for(let i=0;i<50&&source.PendingDeliveries;i++)await delay(1);
    assert.equal(source.PendingDeliveries,0);assert.equal(source.Statistics.Deliveries,1);
    noListeners(controller.signal,['abort']);
});
test('pre-aborted delivery never creates a MessageChannel and successful delivery removes its abort listener',async t=>{
    const source=new SkiaWasmModuleSource({WasmModule:wasm});t.after(()=>source.Dispose());
    const before=new AbortController();before.abort();assert.throws(()=>source.CreatePort({Signal:before.signal}),{name:'AbortError'});assert.equal(source.PendingDeliveries,0);
    const controller=new AbortController();await ReceiveSkiaWasmModuleAsync(source.CreatePort({Signal:controller.signal}));
    for(let i=0;i<50&&source.PendingDeliveries;i++)await delay(1);
    controller.abort();noListeners(controller.signal,['abort']);assert.equal(source.Statistics.Deliveries,1);
});

/** Explicit DOM/Worker doubles for ownership/error interleavings, not graphics
 * qualification. Actual native pixels and canonical HTTP workers are CI gates. */
function hostFixture(t,{ready='complete',failure=null}={}) {
    const popup=fakeWindow(ready),ownerWindow=fakeWindow('complete'),workers=[];
    ownerWindow.location={href:'https://example.test/app/',origin:'https://example.test'};
    ownerWindow.crypto={randomUUID:()=> 'test-host-correlation'};
    ownerWindow.open=url=>{popup.location=new URL(url);queueMicrotask(()=>{if(popup.document.readyState==='complete')notify();});return popup;};
    const notify=()=>ownerWindow.emit('message',{source:popup,origin:ownerWindow.location.origin,data:{Type:'avalonia-secondary-document-ready',Token:'test-host-correlation'}});
    popup.addEventListener('load',notify);
    t.after(()=>popup.removeEventListener('load',notify));
    ownerWindow.navigator={userActivation:{isActive:true}};
    class Worker extends Target {
        constructor(url){super();if(failure==='constructor')throw new Error('worker constructor failed');this.Url=url;this.Terminated=false;workers.push(this);}
        postMessage(m){
            this.Message=m;
            if(failure==='post')throw new Error('worker post failed');
            queueMicrotask(async()=>{
                if(this.Terminated)return;
                if(failure==='entry'){this.emit('error',{message:'entry failed'});return;}
                if(failure==='pending')return;
                if(m.Options.WasmModulePort)await ReceiveSkiaWasmModuleAsync(m.Options.WasmModulePort);
                this.emit('message',{data:{Type:'startup-progress',Role:'render',Stage:'ready'}});
            });
        }
        terminate(){this.Terminated=true;this.Message?.Port?.close();this.Message?.Options?.WasmModulePort?.close();}
    }
    popup.Worker=Worker;
    const proto=BrowserWorkerApplication.prototype,create=proto._CreateDom,install=proto._InstallEvents,snapshot=proto._Snapshot;
    proto._CreateDom=function(){this.Canvas={transferControlToOffscreen(){return{};},remove(){}};this.Nodes=new Map();};
    proto._InstallEvents=function(){this._Listen(this.Window,'beforeunload',()=>this.Dispose());};
    proto._Snapshot=()=>({Width:10,Height:10,Scale:1});
    t.after(()=>{proto._CreateDom=create;proto._InstallEvents=install;proto._Snapshot=snapshot;});
    const parent=new BrowserWorkerApplication({ownerDocument:ownerWindow.document},{ApplicationModule:'/app.js',InitializationTimeout:200,SecondaryWindowUrl:'https://example.test/secondary-window.html'});
    const source=parent._wasmSource=new SkiaWasmModuleSource({WasmModule:wasm});
    parent._runtime={Backend:'canvas'};parent._workerUrls={RenderWorkerUrl:'/render.js'};parent.Channel={Timeout:200,Dispose(){}};
    t.after(()=>parent.Dispose());
    return {parent,popup,workers,source};
}
test('secondary OpenWindow waits for the popup document and native bootstrap before transferring UI endpoints',async t=>{
    const {parent,popup,workers}=hostFixture(t,{ready:'loading'});
    const p=parent._OpenWindow({Title:'Test',Width:10,Height:10,Backend:'canvas'});
    await tick();assert.equal(workers.length,0);assert.equal(parent.Children.size,0);
    popup.document.readyState='complete';popup.emit('load');const result=await p;
    assert.equal(result.__TransferResult,true);assert.equal(result.Transfer.length,2);assert.equal(workers.length,1);
    const child=[...parent.Children][0];assert.equal(child.Startup.render.Stage,'ready');assert.equal(child.IsDisposed,false);
    for(const port of result.Transfer)port.close();child.Dispose();assert.equal(parent.Children.size,0);
});
for(const failure of ['constructor','post','entry'])test(`secondary ${failure} failure rolls back popup, channels, host registration and only its own WASM lease`,async t=>{
    const {parent,popup,workers,source}=hostFixture(t,{failure});
    await assert.rejects(parent._OpenWindow({Title:'Test',Width:10,Height:10}),/failed/);
    assert.equal(parent.Children.size,0);assert.equal(popup.closed,true);assert.equal(source.PendingDeliveries,0);assert.equal(source.IsDisposed,false);
    assert.ok(workers.every(worker=>worker.Terminated));assert.equal(parent.LastError,undefined);
});
test('secondary disposal during native initialization cancels the pending open instead of awaiting a dead channel',async t=>{
    const {parent,popup,workers,source}=hostFixture(t,{failure:'pending'});
    const p=parent._OpenWindow({Title:'Test',Width:10,Height:10});await tick();
    const child=[...parent.Children][0];assert.ok(child);assert.equal(source.PendingDeliveries,1);
    await child.DisposeAsync();await assert.rejects(p,/disposed/);
    assert.equal(parent.Children.size,0);assert.equal(source.PendingDeliveries,0);assert.equal(popup.closed,true);assert.equal(workers[0].Terminated,true);
});
test('secondary parent disposal during document loading closes the unpublished popup',async t=>{
    const {parent,popup}=hostFixture(t,{ready:'loading'});
    const p=parent._OpenWindow({Title:'Test',Width:10,Height:10});parent.Dispose();await assert.rejects(p,/disposed/);
    assert.equal(popup.closed,true); // The fixture itself owns its readiness listener.
});

test('failed secondary bootstrap rejects actual ShowDialog and WhenOpened, restores owner and disposes the unshown Window',async t=>{
    const {parent}=hostFixture(t,{failure:'entry'}),pair=new MessageChannel();
    const caller=new ThreadChannel(pair.port1,{Timeout:1000}),callee=new ThreadChannel(pair.port2,{OnRequest:(method,value)=>parent._Service(method,value)});
    const original=Window.WorkerWindowFactory;InstallWorkerWindowFactory({});
    const owner={HostConnection:caller,IsWorkerRoot:true,IsEnabled:true,Renderer:{Backend:'canvas'},Activate(){}};
    const root=new Window();root.Width=10;root.Height=10;
    t.after(()=>{root.Dispose();caller.Dispose();callee.Dispose();Window.WorkerWindowFactory=original;});
    const dialog=root.ShowDialog(owner);assert.equal(owner.IsEnabled,false);
    await assert.rejects(dialog,/entry failed/);await assert.rejects(root.WhenOpened,/entry failed/);
    assert.match(root.LastRenderError.message,/entry failed/);
    assert.equal(owner.IsEnabled,true);assert.ok(root.IsDisposed);assert.equal(parent.Children.size,0);
});
test('closing a pending worker Window is safe and rejects late host attachment while releasing its returned ports',async t=>{
    let deliver;const original=Window.WorkerWindowFactory;InstallWorkerWindowFactory({});
    const owner={HostConnection:{RequestAsync:()=>new Promise(resolve=>deliver=resolve)},IsWorkerRoot:true,IsEnabled:true,Renderer:{Backend:'canvas'},Activate(){}};
    const root=new Window();const dialog=root.ShowDialog(owner);
    assert.doesNotThrow(()=>root.Close('canceled'));assert.equal(await dialog,'canceled');assert.equal(owner.IsEnabled,true);
    const pair=new MessageChannel(),render=new MessageChannel();
    const close=new Promise(resolve=>{pair.port1.onmessage=e=>resolve(e.data);pair.port1.start();});
    t.after(()=>{for(const port of [pair.port1,pair.port2,render.port1,render.port2])port.close();root.Dispose();Window.WorkerWindowFactory=original;});
    deliver({Port:pair.port2,RenderPort:render.port1,Snapshot:{}});
    await assert.rejects(root.WhenOpened,/closed while/);assert.equal((await close).Type,'close-window');assert.equal(Window.Windows.has(root),false);
});

function documentFixture() {
    const owner=new Target(),popup=fakeWindow('complete');
    owner.location=new URL('https://example.test/subpath/');owner.crypto={randomUUID:()=> 'unique-token'};
    owner.open=url=>{popup.location=new URL(url);return popup;};
    const ready=(overrides={})=>owner.emit('message',{source:popup,origin:owner.location.origin,
        data:{Type:'avalonia-secondary-document-ready',Token:'unique-token'},...overrides});
    return{owner,popup,ready};
}
test('secondary committed document requires source, origin, token, final URL and ready state',async()=>{
    const {owner,popup,ready}=documentFixture();let done=false;
    const p=OpenSecondaryDocumentAsync(owner,'./host.html','',{Timeout:1000}).then(w=>{done=true;return w;});
    ready({source:{}});ready({origin:'https://other.test'});ready({data:{Type:'avalonia-secondary-document-ready',Token:'wrong'}});
    await tick();assert.equal(done,false); // complete initial document alone is insufficient
    ready();assert.equal(await p,popup);assert.equal(popup.location.pathname,'/subpath/host.html');noListeners(owner,['message']);
});
for(const kind of ['url','loading','closed'])test(`secondary acknowledged ${kind} mismatch rejects and closes only that popup`,async()=>{
    const {owner,popup,ready}=documentFixture();const p=OpenSecondaryDocumentAsync(owner,'./host.html','',{Timeout:1000});
    if(kind==='url')popup.location=new URL('https://example.test/wrong');
    if(kind==='loading')popup.document.readyState='loading';
    if(kind==='closed')popup.close();ready();await assert.rejects(p,/changed/);assert.ok(popup.closed);noListeners(owner,['message']);
});
test('secondary document blocked popup, timeout, cancellation and pre-abort leave no owner listener',async()=>{
    for(const kind of ['blocked','timeout','abort','pre-abort']){
        const {owner,popup}=documentFixture(),controller=new AbortController();let opened=0;
        const open=owner.open;owner.open=url=>{opened++;return kind==='blocked'?null:open(url);};
        if(kind==='pre-abort')controller.abort(new Error('pre-canceled'));
        const p=OpenSecondaryDocumentAsync(owner,'./host.html','',{Signal:controller.signal,Timeout:10});
        if(kind==='abort')controller.abort(new Error('canceled'));
        await assert.rejects(p,/blocked|timed out|canceled/);noListeners(owner,['message']);noListeners(controller.signal,['abort']);
        assert.equal(opened,kind==='pre-abort'?0:1);
        if(kind==='timeout'||kind==='abort')assert.ok(popup.closed);
    }
});
test('secondary host rejects cross-origin and non-HTTP documents before opening',async()=>{
    const {owner}=documentFixture();owner.open=()=>assert.fail('opened');
    for(const url of ['https://other.test/','data:text/html,hi','about:blank','https://user@example.test/'])
        await assert.rejects(OpenSecondaryDocumentAsync(owner,url,''),/origin|credentials/);
});
