import { SourceFingerprint } from './source-fingerprint.mjs';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const fingerprint = SourceFingerprint(root);
const input = path.join(root, 'artifacts/npm'), fixture = path.join(root, 'artifacts/package-consumer');
const { Packages } = JSON.parse(await readFile(path.join(input, 'manifest.json'), 'utf8'));
await rm(fixture, { recursive: true, force: true });
await mkdir(fixture, { recursive: true });
// Minimal safe tar reader for npm's regular-file package archives. No external tar dependency.
for (const item of Packages) {
    const tar = gunzipSync(await readFile(path.join(input, item.File)));
    for (let offset = 0; offset + 512 <= tar.length;) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every(x => x === 0)) break;
        const text = (a, n) => header.subarray(a, a + n).toString('utf8').replace(/\0.*$/s, '');
        const name = text(0, 100), prefix = text(345, 155), type = text(156, 1);
        const size = parseInt(text(124, 12).trim() || '0', 8);
        if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('Invalid tar size');
        const relative = (prefix ? prefix + '/' : '') + name;
        if (type === '0' || type === '') {
            if (!relative.startsWith('package/') || relative.split('/').includes('..') || relative.includes('\\')) throw new Error('Unsafe archive path');
            const file = path.join(fixture, 'node_modules', item.Name, relative.slice(8));
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file, tar.subarray(offset + 512, offset + 512 + size));
        } else if (!['5', 'x', 'g'].includes(type)) throw new Error(`Unsupported tar entry type: ${type}`);
        offset += 512 + Math.ceil(size / 512) * 512;
    }
}
await writeFile(path.join(fixture, 'package.json'), '{"private":true,"type":"module"}\n');
const vendor = new URL('../vendor/', import.meta.url);
const mappings = {
    rxjs: new URL('rxjs.js', vendor).href,
    'rxjs/operators': new URL('rxjs.js', vendor).href,
    '@wieslawsoltes/reactiveweb': new URL('reactiveweb.browser.js', vendor).href,
    '@wieslawsoltes/skiasharpweb/browser-text': new URL('skiasharpweb/dist/lib/browser-text.js', vendor).href,
    '@wieslawsoltes/skiasharpweb/wasm': new URL('skiasharpweb/dist/lib/wasm.js', vendor).href,
    '@wieslawsoltes/skiasharpweb/browser': new URL('skiasharpweb/dist/package/browser.js', vendor).href,
    '@wieslawsoltes/skiasharpweb': new URL('skiasharpweb/dist/package/node.js', vendor).href
};
await writeFile(path.join(fixture, 'vendor-loader.mjs'), `const map=${JSON.stringify(mappings)}; export async function resolve(s,c,n){return map[s]?{url:map[s],shortCircuit:true}:n(s,c);}`);
await writeFile(path.join(fixture, 'register.mjs'), `import{register}from'node:module';register('./vendor-loader.mjs',import.meta.url);`);
await writeFile(path.join(fixture, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { ReactiveObject } from '@wieslawsoltes/reactiveweb';
import { AvaloniaXamlCompiler } from '@wieslawsoltes/avalonia-markup-xaml';
const names=${JSON.stringify(Packages.map(p=>p.Name))};
for (const name of names) assert.ok(Object.keys(await import(name)).length > 0, name);
const thinHost = await import('@wieslawsoltes/avalonia-browser/worker-host');
const wasm = await import('@wieslawsoltes/avalonia-skia/wasm');
assert.equal(thinHost.StartWorkerApplicationAsync, A.StartWorkerApplicationAsync);
const module = new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0]));
const source = new wasm.SkiaWasmModuleSource({WasmModule:module});
try {
    const received = await wasm.ReceiveSkiaWasmModuleAsync(source.CreatePort(), 5000);
    assert.ok(received instanceof WebAssembly.Module);
} finally { source.Dispose(); }
const model=new ReactiveObject({Text:'Packed modules'});
const view=new A.StackPanel(); view.DataContext=model;
const label=new A.TextBlock(); view.Children.Add(label);
label.Bind(A.TextBlock.TextProperty,new A.Binding('Text'));
assert.equal(label.Text,'Packed modules'); model.Text='Changed'; assert.equal(label.Text,'Changed');
const compiled=new AvaloniaXamlCompiler().Compile('<TextBlock xmlns="https://github.com/avaloniaui" Text="Packed XAML"/>');
const xaml=compiled.Build(); assert.equal(xaml.Text,'Packed XAML');
view.Dispose(); xaml.Dispose();
const {HeadlessTopLevel}=await import('@wieslawsoltes/avalonia-headless');
const scroller=new A.ScrollViewer();scroller.Content=Object.assign(new A.Border(),{Width:1200,Height:2400});scroller.HorizontalScrollBarVisibility='Auto';
const host=new HeadlessTopLevel(new A.Size(400,240));host.Content=scroller;host.Layout();assert(scroller.VerticalScrollBar instanceof A.TemplatedControl);
scroller.VerticalScrollBar.Value=500;host.Layout();assert.equal(scroller.Offset.Y,500);host.Dispose();

const packet=A.EncodeCompositionBatch({Message:'Packed transport',Bytes:new Uint8Array([1,2,3])});
assert.equal(A.DecodeCompositionBatch(packet.Buffer,packet.ByteLength).Value.Message,'Packed transport');
assert.equal(A.BrowserThreadingMode.FullIsolation,'full-isolation');
const {readFile}=await import('node:fs/promises');
const worker=new URL('../worker-assets/render.js',import.meta.resolve('@wieslawsoltes/avalonia-browser'));
assert.match(await readFile(worker,'utf8'),/render-worker/);
const operation=A.Dispatcher.UIThread.InvokeAsync(()=>42,A.DispatcherPriority.Render);
assert(operation instanceof A.DispatcherOperation);assert.equal(await operation,42);assert.equal(operation.Status,A.DispatcherOperationStatus.Completed);
assert.equal(typeof A.IProvideValueTarget,'symbol');assert.equal(typeof A.XamlServiceProvider,'function');
const group=new A.DrawingGroup();const context=group.Open();context.DrawRectangle('#ff0000',null,new A.Rect(0,0,10,10));context.Dispose();
assert.equal(group.Children.Count,1);assert.equal(group.GetBounds().Width,10);group.Dispose();
const compositor=new A.Compositor({AutoCommit:false}),properties=compositor.CreatePropertySet();properties.InsertQuaternion('Rotation',{X:0,Y:0,Z:0,W:1});
assert.equal(properties.TryGetQuaternion('Rotation').Status,A.CompositionGetValueStatus.Succeeded);
assert.equal(properties.TryGetVector4('Rotation').Status,A.CompositionGetValueStatus.TypeMismatch);compositor.Dispose();
const animationClock=new A.ManualClock(),implicitCompositor=new A.Compositor({AutoCommit:false,Clock:animationClock});
const implicitVisual=implicitCompositor.CreateSolidColorVisual();implicitCompositor.Commit();
const implicitAnimation=implicitCompositor.CreateScalarKeyFrameAnimation();implicitAnimation.Duration=100;implicitAnimation.Target='Opacity';implicitAnimation.InsertExpressionKeyFrame(1,'this.FinalValue');
const definitions=implicitCompositor.CreateImplicitAnimationCollection();definitions.Add('Opacity',implicitAnimation);implicitVisual.ImplicitAnimations=definitions;
implicitVisual.Opacity=.2;implicitCompositor.Commit();animationClock.Advance(50);assert.ok(Math.abs(implicitVisual._Read('Opacity')-.6)<1e-12);
animationClock.Advance(50);assert.equal(implicitVisual._Read('Opacity'),.2);assert.equal(animationClock._listeners.size,0);implicitCompositor.Dispose();implicitAnimation.Dispose();
const figure=new A.PathFigure(new A.Point(0,0),[new A.LineSegment(new A.Point(12,0),false),new A.LineSegment(new A.Point(12,12))]);
const pathGeometry=new A.PathGeometry([figure]);assert.ok(pathGeometry instanceof A.StreamGeometry);assert.equal(pathGeometry.FillData,'M0 0 L12 0 L12 12 Z');assert.equal(pathGeometry.StrokeData,'M0 0 M12 0 L12 12 L0 0');
const glyphInfo=new A.GlyphInfo(1,0,12,new A.Vector(.5,1));assert.equal(glyphInfo.GlyphAdvance,12);assert.ok(Object.isFrozen(glyphInfo.GlyphOffset));
assert.equal(typeof A.GlyphRun,'function');assert.equal(typeof A.GlyphTypeface.FromData,'function');assert.equal(typeof A.GlyphRunDrawing,'function');
pathGeometry.Dispose();for(const segment of figure.Segments)segment.Dispose();figure.Dispose();
console.log(JSON.stringify({Passed:true,GlyphPathApis:true,ImplicitAnimationApis:true,Packages:names.length,FacadeExports:Object.keys(A).length,PublicRegistryInstalled:false,StartupSubpaths:true,CorePortApis:true}));
`);
const run = spawnSync(process.execPath, ['--import', './register.mjs', 'consumer.mjs'], { cwd: fixture, encoding: 'utf8', timeout: 30000 });
if (run.error || run.status !== 0) throw new Error(`${run.error ?? ''}\n${run.stdout}\n${run.stderr}`);
const report = JSON.parse(run.stdout.trim());
Object.assign(report,{Version:Packages[0].Version,SourceFingerprint:fingerprint,FinalSourceFingerprint:SourceFingerprint(root)});
if(report.SourceFingerprint!==report.FinalSourceFingerprint)throw new Error('Source changed during package qualification');
await writeFile(path.join(root, 'artifacts/package-consumer-result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(report);
await rm(fixture, { recursive: true, force: true });
