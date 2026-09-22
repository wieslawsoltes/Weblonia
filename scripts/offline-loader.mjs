import { readFileSync, readdirSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const mappings = new Map();
for (const name of readdirSync(new URL('packages/', root))) {
    const p = JSON.parse(readFileSync(new URL(`packages/${name}/package.json`, root)));
    mappings.set(p.name, new URL(`packages/${name}/src/index.js`, root).href);
}
mappings.set('rxjs', new URL('vendor/rxjs.js', root).href);
mappings.set('rxjs/operators', new URL('vendor/rxjs.js', root).href);
mappings.set('@wieslawsoltes/reactiveweb', new URL('vendor/reactiveweb.browser.js', root).href);
mappings.set('@wieslawsoltes/skiasharpweb/browser-text', new URL('vendor/skiasharpweb/dist/lib/browser-text.js', root).href);
mappings.set('@wieslawsoltes/skiasharpweb/browser', new URL('vendor/skiasharpweb/dist/package/browser.js', root).href);
mappings.set('@wieslawsoltes/skiasharpweb', new URL('vendor/skiasharpweb/dist/package/node.js', root).href);
mappings.set('@wieslawsoltes/avalonia-browser/worker-host', new URL('packages/browser/src/isolated-host.js', root).href);
mappings.set('@wieslawsoltes/avalonia-skia/wasm', new URL('packages/skia/src/wasm-module-source.js', root).href);
mappings.set('@wieslawsoltes/skiasharpweb/wasm', new URL('vendor/skiasharpweb/dist/lib/wasm.js', root).href);
export async function resolve(specifier, context, next) {
    return mappings.has(specifier) ? { url: mappings.get(specifier), shortCircuit: true } : next(specifier, context);
}
