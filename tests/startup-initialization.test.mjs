import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { SkiaWasmModuleSource, ReceiveSkiaWasmModuleAsync } from '../packages/skia/src/wasm-module-source.js';
import { ClearWasmModuleCache } from '@wieslawsoltes/skiasharpweb/wasm';

const fetchOriginal = globalThis.fetch, bytes = new Uint8Array([0,97,115,109,1,0,0,0]);
const options = {AssetBaseUrl:'https://example.test/native/', InitializationTimeout:1000};
const sources = [];
const own = o => { const s=new SkiaWasmModuleSource({...options,...o});sources.push(s);return s; };
afterEach(() => {for(const s of sources.splice(0))s.Dispose();globalThis.fetch=fetchOriginal;ClearWasmModuleCache();});
async function drained(source) {
    for(let i=0;i<50&&source.PendingDeliveries;i++)await delay(2);
    assert.equal(source.PendingDeliveries,0);
}
test('startup: two workers receive one compilation over distinct original ports', async () => {
    let count=0;
    globalThis.fetch=async()=>{count++;return new Response(bytes,{headers:{'Content-Type':'application/wasm'}});};
    const source=own(),a=source.CreatePort(),b=source.CreatePort();
    assert.notEqual(a,b);
    const [ma,mb]=await Promise.all([ReceiveSkiaWasmModuleAsync(a),ReceiveSkiaWasmModuleAsync(b)]);
    assert.deepEqual(WebAssembly.Module.exports(ma),[]);
    assert.deepEqual(WebAssembly.Module.exports(mb),[]);
    assert.equal(count,1);
    await drained(source); assert.equal(source.Statistics.Deliveries,2);
    assert.equal(source.Statistics.CloneFallbacks,0);
});
test('startup: a renderer restart gets a fresh port without downloading again', async () => {
    let count=0;globalThis.fetch=async()=>{count++;return new Response(bytes);};
    const source=own();
    await ReceiveSkiaWasmModuleAsync(source.CreatePort());await drained(source);
    await ReceiveSkiaWasmModuleAsync(source.CreatePort());await drained(source);
    assert.equal(count,1);assert.equal(source.Statistics.Deliveries,2);
});
test('startup: module readiness before the request does not drop the delivery', async () => {
    const source=own({WasmModule:new WebAssembly.Module(bytes)});
    await source.Promise;await delay(1);
    await ReceiveSkiaWasmModuleAsync(source.CreatePort());await drained(source);
});
test('startup: pending compilation is delivered after an early request', async () => {
    let done;globalThis.fetch=()=>new Promise(r=>done=r);
    const source=own(),pending=ReceiveSkiaWasmModuleAsync(source.CreatePort());
    await delay(2);assert.equal(source.PendingDeliveries,1);
    done(new Response(bytes));assert.ok(await pending instanceof WebAssembly.Module);await drained(source);
});
test('startup: compilation failures reject every waiting worker and permit a retry', async () => {
    globalThis.fetch=async()=>new Response('failed',{status:503});
    const source=own();
    const results=await Promise.allSettled([ReceiveSkiaWasmModuleAsync(source.CreatePort()),ReceiveSkiaWasmModuleAsync(source.CreatePort())]);
    assert.ok(results.every(x=>x.status==='rejected'&&/503/.test(x.reason.message)));await drained(source);
    globalThis.fetch=async()=>new Response(bytes);
    await ReceiveSkiaWasmModuleAsync(own().CreatePort());
});
test('startup: disposal settles waiters, closes ports, and ignores late compilation', async () => {
    let done;globalThis.fetch=()=>new Promise(r=>done=r);
    const source=own(),pending=ReceiveSkiaWasmModuleAsync(source.CreatePort());
    const rejected=assert.rejects(pending,/disposed/);
    source.Dispose();source.Dispose();await rejected;
    done(new Response(bytes));await source.Promise;await delay(2);
    assert.equal(source.PendingDeliveries,0);assert.equal(source.Statistics.Deliveries,0);
    assert.throws(()=>source.CreatePort(),/disposed/);
});
test('startup: invalid prepared modules reject through the protocol without stranded source ports', async () => {
    const source=own({WasmModule:{}});
    await assert.rejects(ReceiveSkiaWasmModuleAsync(source.CreatePort()),/Module|WebAssembly/);
    await drained(source);
});
test('startup: caller timeout bounds both request and preparation lifetimes', async () => {
    globalThis.fetch=()=>new Promise(()=>{});
    const source=own({InitializationTimeout:10});
    await assert.rejects(ReceiveSkiaWasmModuleAsync(source.CreatePort(),100),/timed out/);await drained(source);
    const {port1,port2}=new MessageChannel();
    try{await assert.rejects(ReceiveSkiaWasmModuleAsync(port2,10),/timed out/);}finally{port1.close();}
});
test('startup: explicit clone fallback acknowledges local compilation', async () => {
    const {port1,port2}=new MessageChannel();
    const acknowledged=new Promise(resolve=>{port1.onmessage=e=>{
        if(e.data.Type==='skia-module-request')port1.postMessage({Type:'skia-module-local'});
        else if(e.data.Type==='skia-module-ack')resolve(e.data.Shared);
    };});
    try{assert.equal(await ReceiveSkiaWasmModuleAsync(port2),null);assert.equal(await acknowledged,false);}
    finally{port1.close();}
});
test('startup: agent-cluster messageerror falls back without sharing native state', async () => {
    let handler,closed=0,ack;
    const port={start(){},close(){closed++;},postMessage(m){if(m.Type==='skia-module-ack')ack=m;},
        set onmessageerror(f){handler=f;},set onmessage(f){}};
    const pending=ReceiveSkiaWasmModuleAsync(port);handler();
    assert.equal(await pending,null);assert.equal(closed,1);assert.equal(ack.Shared,false);
});
test('startup: malformed protocol, missing port and invalid timeouts reject', async () => {
    assert.throws(()=>own({InitializationTimeout:0}),/timeout/);
    await assert.rejects(ReceiveSkiaWasmModuleAsync(null),TypeError);
    const {port1,port2}=new MessageChannel();
    const pending=ReceiveSkiaWasmModuleAsync(port2);
    port1.postMessage({Type:'unexpected'});
    try{await assert.rejects(pending,/Invalid/);}finally{port1.close();}
});
test('startup: duplicate worker requests never produce duplicate module deliveries', async () => {
    const source=own({WasmModule:new WebAssembly.Module(bytes)}),port=source.CreatePort();
    let messages=0;
    await new Promise(resolve=>{
        port.onmessage=()=>{messages++;port.postMessage({Type:'skia-module-ack',Shared:true});resolve();};
        port.start();port.postMessage({Type:'skia-module-request'});port.postMessage({Type:'skia-module-request'});
    });
    await drained(source);await delay(2);port.close();
    assert.equal(messages,1);assert.equal(source.Statistics.Deliveries,1);
});
test('startup: moved browser service classes preserve public constructor identity', async () => {
    const publicApi=await import('../packages/browser/src/index.js');
    const services=await import('../packages/browser/src/browser-services.js');
    const options=await import('../packages/browser/src/threading-options.js');
    for(const key of Object.keys(services))assert.equal(publicApi[key],services[key],key);
    assert.equal(publicApi.BrowserThreadingMode,options.BrowserThreadingMode);
    assert.deepEqual(publicApi.GetBrowserWorkerUrls(),options.GetBrowserWorkerUrls());
});
test('startup: default catalog entry has no eager application or graphics import', async () => {
    const entry=await readFile(new URL('../samples/ControlCatalog/app.js',import.meta.url),'utf8');
    assert.match(entry,/await import\('@wieslawsoltes\/avalonia-browser\/worker-host'\)/);
    assert.doesNotMatch(entry,/^import.*(?:catalog\.js|@wieslawsoltes\/avalonia['"])/m);
    const host=await readFile(new URL('../packages/browser/src/isolated-host.js',import.meta.url),'utf8');
    assert.doesNotMatch(host,/from ['"]\.\/(?:index|render-thread)\.js/);
    assert.match(host,/from '\.\/browser-services\.js'/);
});
test('startup: lazy AOT inventory loads only MainView eagerly and preserves all original builders', async () => {
    const lazy=await import('../samples/ControlCatalog/compiled/lazy.js?startup-test');
    const sync=await import('../samples/ControlCatalog/compiled/index.js');
    assert.deepEqual(Object.keys(lazy.Builders),['MainView']);
    await assert.rejects(lazy.LoadBuilder('__proto__'),/Unknown/);
    await assert.rejects(lazy.LoadBuilder('../Buttons'),/Unknown/);
    const a=lazy.LoadBuilder('Buttons'),b=lazy.LoadBuilder('Buttons');assert.equal(a,b);
    for(const id of Object.keys(sync.Builders))assert.equal(await lazy.LoadBuilder(id),sync.Builders[id],id);
    assert.deepEqual(lazy.Sources,sync.Sources);assert.equal(Object.keys(lazy.Builders).length,75);
});
test('startup: newer navigation wins even when an earlier AOT module resolves last', async () => {
    const {CatalogController}=await import('../samples/ControlCatalog/catalog.js');
    const A=await import('@wieslawsoltes/avalonia');
    let late;
    const c=new CatalogController({LoadBuilder:id=>id==='Buttons'?new Promise(r=>late=r):Promise.resolve(()=>new A.Border())});
    c.CreateView();c.Errors=[];c.Root={RenderNow:async()=>{}};c.ConfigurePage=async()=>{};
    c._UpdateStatus=()=>{};
    try{
        const old=c.Navigate('Buttons');await c.Navigate('Border');const current=c.Page;
        let constructed=false;late(()=>{constructed=true;return new A.Border();});await old;
        assert.equal(c.CurrentId,'Border');assert.equal(c.Page,current);assert.equal(constructed,false);
        assert.deepEqual(c.Errors,[]);
    }finally{c._query.complete();c._pageLifetime.Dispose();c.Model.Dispose();c.View.Dispose();}
});
test('startup: Home invalidates a pending route and suppresses its late import failure', async () => {
    const {CatalogController}=await import('../samples/ControlCatalog/catalog.js');
    let fail;
    const c=new CatalogController({LoadBuilder:()=>new Promise((_,j)=>fail=j)});
    c.CreateView();c.Errors=[];c._UpdateStatus=()=>{};
    try{
        const old=c.Navigate('Buttons');await c.Home();const home=c.Page;fail(new Error('late download'));
        await old;assert.equal(c.Page,home);assert.equal(c.CurrentId,null);assert.deepEqual(c.Errors,[]);
    }finally{c._query.complete();c._pageLifetime.Dispose();c.Model.Dispose();c.View.Dispose();}
});
