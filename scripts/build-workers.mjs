import { readFile, readdir, mkdir, rm, writeFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { SourceFingerprint } from './source-fingerprint.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

async function Targets(assetRoot) {
    const targets = new Map();
    for (const folder of await readdir(path.join(root, 'packages'))) {
        const pkg = JSON.parse(await readFile(path.join(root, 'packages', folder, 'package.json')));
        targets.set(pkg.name, path.join(assetRoot, 'packages', folder, 'src/index.js'));
    }
    for (const name of ['rxjs', 'rxjs/operators']) targets.set(name, path.join(assetRoot, 'vendor/rxjs.js'));
    targets.set('@wieslawsoltes/reactiveweb', path.join(assetRoot, 'vendor/reactiveweb.browser.js'));
    targets.set('@wieslawsoltes/skiasharpweb/browser', path.join(assetRoot, 'vendor/skiasharpweb/dist/package/browser.js'));
    targets.set('@wieslawsoltes/skiasharpweb/browser-text', path.join(assetRoot, 'vendor/skiasharpweb/dist/lib/browser-text.js'));
    return targets;
}
function Rewrite(source, destination, targets) {
    for (const [name, file] of targets) {
        let relative = path.relative(path.dirname(destination), file).split(path.sep).join('/');
        if (!relative.startsWith('.')) relative = './' + relative;
        source = source.split(`'${name}'`).join(JSON.stringify(relative)).split(`"${name}"`).join(JSON.stringify(relative));
    }
    return source;
}
async function CopyGraph(from, to, targets) {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
        if (['worker-assets', 'node_modules', '.git', 'worker', '__pycache__'].includes(entry.name)) continue;
        const source = path.join(from, entry.name), target = path.join(to, entry.name);
        if (entry.isDirectory()) await CopyGraph(source, target, targets);
        else if (/\.(?:js|mjs)$/.test(entry.name)) await writeFile(target, Rewrite(await readFile(source, 'utf8'), target, targets));
        else if (/\.(json|txt|md|cjs)$/.test(entry.name) && !entry.name.includes('canvaskit.cjs')) await cp(source, target);
    }
}
async function Inventory(directory) {
    const files = {};
    async function walk(relative) {
        for (const item of (await readdir(path.join(directory, relative), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
            const name = path.posix.join(relative, item.name);
            if (item.isDirectory()) await walk(name);
            else files[name] = createHash('sha256').update(await readFile(path.join(directory, name))).digest('hex');
        }
    }
    await walk(''); return files;
}
/** Resolve from the final deployment location, never copy source-relative imports
 * into a different directory depth. Workers do not inherit document import maps. */
export async function BuildWorkerApplicationAssets(applicationRoot, destination, assetRoot) {
    await rm(destination, { recursive: true, force: true });
    await CopyGraph(applicationRoot, destination, await Targets(assetRoot));
    return Inventory(destination);
}
export async function BuildWorkerAssets() {
    const out = path.join(root, 'packages/browser/worker-assets');
    await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
    const targets = await Targets(out);
    for (const folder of await readdir(path.join(root, 'packages')))
        await CopyGraph(path.join(root, 'packages', folder, 'src'), path.join(out, 'packages', folder, 'src'), targets);
    await CopyGraph(path.join(root, 'vendor'), path.join(out, 'vendor'), targets);
    const nativeLoader = await readFile(path.join(root, 'vendor/skiasharpweb/dist/vendor/canvaskit.js'), 'utf8');
    await writeFile(path.join(out, 'canvaskit-loader.mjs'), nativeLoader + '\nexport default CanvasKitInit;\n');
    const bootstrap = (await readFile(path.join(root, 'packages/browser/src/worker-bootstrap.js'), 'utf8'))
        .replace('export function InstallWorkerBootstrap', 'function InstallWorkerBootstrap');
    for (const [name, entry] of [['render', 'StartRenderWorker'], ['ui', 'StartUiWorker']]) {
        await writeFile(path.join(out, name + '.js'), bootstrap +
            `\nInstallWorkerBootstrap(self, () => import('./packages/browser/src/${name}-worker.js'), '${entry}', '${name}');\n`);
    }
    const sample = path.join(root, 'samples/ControlCatalog');
    const applicationFiles = await BuildWorkerApplicationAssets(sample, path.join(sample, 'worker'), out);
    await writeFile(path.join(out, 'manifest.json'), JSON.stringify({
        Schema: 1, SourceFingerprint: SourceFingerprint(root),
        SourceLoaderSha256: createHash('sha256').update(nativeLoader).digest('hex'),
        LoaderTransformation: 'Append export default CanvasKitInit;', NativeWasm: 'external; supplied via AssetBaseUrl',
        UsesEval: false, WorkerImportMaps: false, Bootstrap: 'dependency-free receiver before dynamic import',
        Deployment: 'source', Files: await Inventory(out), ApplicationFiles: applicationFiles,
    }, null, 2) + '\n');
    console.log('Built race-free worker ESM entries and source application graph; native WASM is not duplicated.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await BuildWorkerAssets();
