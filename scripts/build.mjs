import './register-loader.mjs';
import { SourceFingerprint } from './source-fingerprint.mjs';
import { readFile, writeFile, readdir, mkdir, rm, cp, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await mkdir(path.join(root, 'artifacts'), { recursive: true });
const { AvaloniaXamlCompiler } = await import('@wieslawsoltes/avalonia-markup-xaml');
await import('@wieslawsoltes/avalonia');
const sample = path.join(root, 'samples/ControlCatalog'), compiled = path.join(sample, 'compiled');
await mkdir(compiled, { recursive: true });
const inputs = ['MainView.axaml', ...(await readdir(path.join(sample, 'Pages'))).filter(x => x.endsWith('.axaml')).sort().map(x => `Pages/${x}`)];
const sources = {}, imports = [], builders = [];
for (const input of inputs) {
    const name = path.basename(input, '.axaml'), text = await readFile(path.join(sample, input), 'utf8');
    const result = new AvaloniaXamlCompiler().Compile(text, { SourceFile: input });
    await writeFile(path.join(compiled, `${name}.g.js`), result.JavaScript);
    imports.push(`import { Build as Build_${name} } from './${name}.g.js';`);
    builders.push(`${JSON.stringify(name)}: Build_${name}`);
    sources[name] = text;
}
await writeFile(path.join(compiled, 'index.js'), `${imports.join('\n')}\nexport const Builders = { ${builders.join(',\n')} };\nexport const Sources = ${JSON.stringify(sources)};\n`);
await (await import('./build-workers.mjs')).BuildWorkerAssets();
const mappings = {};
for (const folder of await readdir(path.join(root, 'packages'))) {
    const p = JSON.parse(await readFile(path.join(root, 'packages', folder, 'package.json')));
    mappings[p.name] = `./packages/${folder}/src/index.js`;
}
mappings.rxjs = './vendor/rxjs.js';
mappings['rxjs/operators'] = './vendor/rxjs.js';
mappings['@wieslawsoltes/reactiveweb'] = './vendor/reactiveweb.browser.js';
mappings['@wieslawsoltes/skiasharpweb/browser-text'] = './vendor/skiasharpweb/dist/lib/browser-text.js';
mappings['@wieslawsoltes/skiasharpweb/browser'] = './vendor/skiasharpweb/dist/package/browser.js';
function html(prefix) {
    const imports = Object.fromEntries(Object.entries(mappings).map(([k, v]) => [k, `${prefix}${v.slice(2)}`]));
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#6757d9"><title>Avalonia Web · Control Catalog</title><style>html,body,#app{width:100%;height:100%;margin:0;overflow:hidden}body{font-family:system-ui,sans-serif;background:#f6f7fb;color:#222634}#loading{position:absolute;inset:0;display:grid;place-content:center;gap:12px;text-align:center}#loading b{font-size:25px}#loading span{color:#6d7383;font-size:14px}.error{max-width:80vw;white-space:pre-wrap;color:#b63648}</style><script type="importmap">${JSON.stringify({ imports })}</script></head><body><main id="app" aria-label="Avalonia Web Control Catalog"><div id="loading"><b>Avalonia / Control Catalog</b><span>Initializing the native Skia renderer…</span></div></main><script type="module" src="./app.js"></script></body></html>`;
}
await writeFile(path.join(sample, 'index.html'), html('../../'));
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist);
for (const dir of ['packages', 'vendor'])
    await cp(path.join(root, dir), path.join(dist, dir), { recursive: true, filter: source => !/\.(ttf|otf|woff2?|ttc)$/i.test(source) });
for (const entry of await readdir(sample))
    if (entry !== 'index.html')
        await cp(path.join(sample, entry), path.join(dist, entry), { recursive: true });
// The distribution moves the app from samples/ControlCatalog to the site root.
// Re-resolve its worker imports at that depth, including nested-site deployment.
const distWorkerRoot = path.join(dist, 'packages/browser/worker-assets');
const distWorkerManifest = JSON.parse(await readFile(path.join(distWorkerRoot, 'manifest.json'), 'utf8'));
distWorkerManifest.ApplicationFiles = await (await import('./build-workers.mjs')).BuildWorkerApplicationAssets(sample, path.join(dist, 'worker'), distWorkerRoot);
distWorkerManifest.Deployment = 'distribution';
await writeFile(path.join(distWorkerRoot, 'manifest.json'), JSON.stringify(distWorkerManifest, null, 2) + '\n');
await writeFile(path.join(dist, 'index.html'), html('./'));
await writeFile(path.join(dist, '.nojekyll'), '');
await writeFile(path.join(dist, 'README.txt'), `AvaloniaWeb ${version} ControlCatalog\nServe this entire directory over HTTP (for example: python -m http.server 4173).\nOpen http://127.0.0.1:4173/. No CDN or npm install is required.\nSee docs/COMPATIBILITY.md and docs/TESTING.md for release boundaries.\n`);
for (const entry of ['LICENSE', 'NOTICE', 'CHANGELOG.md', 'licenses', 'docs'])
    await cp(path.join(root, entry), path.join(dist, entry), { recursive: true });
await writeFile(path.join(root, 'artifacts/build-result.json'), JSON.stringify({ Version: version, SourceFingerprint: SourceFingerprint(root), XamlModules: inputs.length, BuildMode: 'AOT direct construction modules', NoEval: true, GeneratedAt: new Date().toISOString(), RuntimeAssets: 'local native SkiaSharpWeb + ReactiveWeb/RxJS', FontFiles: 0 }, null, 2));
console.log(`Compiled ${inputs.length} XAML modules. Static distribution: dist/`);
