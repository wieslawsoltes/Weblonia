import test from 'node:test';
import assert from 'node:assert/strict';
import { InstallWorkerBootstrap } from '../packages/browser/src/worker-bootstrap.js';
import { readFile } from 'node:fs/promises';
import { WorkerSkiaRenderer } from '@wieslawsoltes/avalonia-browser';
import { Window } from '@wieslawsoltes/avalonia-browser';

const flush = () => new Promise(resolve => setImmediate(resolve));
function scope() {
    return { Messages: [], Closed: false, performance: { now: () => 10 },
        postMessage(message) { this.Messages.push(message); }, close() { this.Closed = true; } };
}
function gate() { let Resolve, Reject; const PromiseValue = new Promise((r,j) => { Resolve=r; Reject=j; }); return { Promise: PromiseValue, Resolve, Reject }; }

test('bootstrap installs message handler synchronously without importing the runtime', () => {
    const s=scope();let imports=0;
    InstallWorkerBootstrap(s,()=>{imports++;},'Start','test');
    assert.equal(typeof s.onmessage,'function');assert.equal(imports,0);
    assert.equal(s.Messages[0].Stage,'waiting-for-initialize');
});
test('bootstrap owns the original transferred objects before top-level await resolves', async () => {
    const s=scope(),g=gate(),payload={Type:'initialize',Port:{},Canvas:{}};let received;
    InstallWorkerBootstrap(s,()=>g.Promise,'Start','test');
    s.onmessage({data:payload});await flush();assert.equal(s.Messages.at(-1).Stage,'module-import');
    g.Resolve({Start:p=>{received=p;}});await flush();
    assert.equal(received,payload);assert.equal(received.Port,payload.Port);assert.equal(received.Canvas,payload.Canvas);
    assert.equal(s.Messages.at(-1).Stage,'ready');assert(!s.Closed);
});
test('duplicate initialize is ignored while graph is suspended and after ready', async () => {
    const s=scope(),g=gate();let imports=0,starts=0;
    InstallWorkerBootstrap(s,()=>{imports++;return g.Promise;},'Start','test');
    s.onmessage({data:{Type:'initialize'}});s.onmessage({data:{Type:'initialize'}});
    g.Resolve({Start:()=>{starts++;}});await flush();s.onmessage({data:{Type:'initialize'}});await flush();
    assert.equal(imports,1);assert.equal(starts,1);
});
test('non-initialization messages do not trigger graph import or allocate a queue', async () => {
    const s=scope();let imports=0;InstallWorkerBootstrap(s,()=>{imports++;},'Start','test');
    for(let i=0;i<100;i++)s.onmessage({data:{Type:'other'}});
    await flush();assert.equal(imports,0);assert.equal(s.Messages.length,1);
});
for (const failure of ['sync-import','async-import','missing-export','entry-rejection']) {
    test(`bootstrap reports ${failure} and closes instead of timing out`, async () => {
        const s=scope(),error=new Error('deliberate module failure');
        const load=()=>{
            if(failure==='sync-import')throw error;
            if(failure==='async-import')return Promise.reject(error);
            return failure==='missing-export'?{}:{Start:()=>Promise.reject(error)};
        };
        InstallWorkerBootstrap(s,load,'Start','render');s.onmessage({data:{Type:'initialize'}});await flush();
        assert(s.Closed);const messages=s.Messages.filter(m=>m.Type==='bootstrap-error');assert.equal(messages.length,1);
        assert.match(messages[0].Error,failure==='missing-export'?/does not export Start/:/deliberate module failure/);
        assert(!s.Messages.some(m=>m.Stage==='ready'));
    });
}
test('startup stage notifications remain ordered while the entry is awaiting work', async () => {
    const s=scope(),g=gate();InstallWorkerBootstrap(s,()=>({Start:async(_,startup)=>{
        startup.Progress('runtime-loader','https://example.invalid/runtime.mjs');await g.Promise;startup.Progress('backend-probe');
    }}),'Start','render');s.onmessage({data:{Type:'initialize'}});await flush();assert.equal(s.Messages.at(-1).Stage,'runtime-loader');
    g.Resolve();await flush();assert.deepEqual(s.Messages.map(m=>m.Stage),['waiting-for-initialize','module-import','runtime-loader','backend-probe','ready']);
});
test('production entry generation embeds bootstrap instead of statically importing asynchronous dependencies', async () => {
    const build=await readFile(new URL('../scripts/build-workers.mjs',import.meta.url),'utf8');
    assert.match(build,/InstallWorkerBootstrap\(self, \(\) => import/);
    assert.doesNotMatch(build,/"import '\.\/packages\/browser\/src\/(render|ui)-worker\.js';/);
    const runtime=await readFile(new URL('../packages/browser/src/worker-bootstrap.js',import.meta.url),'utf8');
    assert.doesNotMatch(runtime,/^\s*import\s+(?!\()/m);assert.doesNotMatch(runtime,/^\s*await\s/m);
});
test('render-worker bootstrap failure does not attempt to reuse or retransfer its canvas', async () => {
    const root=new Window();let reports=0,terminated=0,restarts=0;
    root._ReportRenderError=()=>reports++;
    const r=new WorkerSkiaRenderer({},root,{},{});r.Worker={terminate:()=>terminated++};r.RestartAsync=()=>{restarts++;return Promise.resolve();};
    const err=new Error('entry script failed');r._Recover(err);await assert.rejects(r._ready.Promise,/entry script failed/);
    assert.equal(restarts,0);assert.equal(terminated,1);assert.equal(reports,1);
    r._Fail(err);assert.equal(reports,1);r.Dispose();root.Dispose();
});
test('disposing a not-yet-ready renderer settles initialization instead of leaving a pending promise', async () => {
    const root=new Window(),r=new WorkerSkiaRenderer({},root,{},{});let terminated=0;
    r.Worker={terminate:()=>terminated++};const ready=r._ready.Promise;r.Dispose();
    await assert.rejects(ready,/disposed during initialization/);await flush();assert.equal(terminated,1);root.Dispose();
});
