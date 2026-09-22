/** Verify both generated ESM graphs against their source fingerprint and every
 * output hash. No worker, native runtime or external package is initialized. */
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SourceFingerprint} from './source-fingerprint.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function VerifyWorkerAssets(){
 const out=path.join(root,'packages/browser/worker-assets'),manifest=JSON.parse(await readFile(path.join(out,'manifest.json'),'utf8'));
 if(manifest.SourceFingerprint!==SourceFingerprint(root))throw new Error('Generated worker graph is stale; run npm run build.');
 if(manifest.Bootstrap!=='dependency-free receiver before dynamic import')throw new Error('Missing race-free worker entry metadata.');
 for(const name of ['render','ui']) {
  const code=await readFile(path.join(out,name+'.js'),'utf8');
  if(/^\s*import\s+(?!\()/m.test(code)||/^\s*await\s/m.test(code)||!code.includes('InstallWorkerBootstrap(self, () => import('))
   throw new Error(`Unsafe worker entry: ${name}.js must receive initialize before loading its asynchronous graph.`);
 }
 let count=0;
 const distOut=path.join(root,'dist/packages/browser/worker-assets');
 const distManifest=JSON.parse(await readFile(path.join(distOut,'manifest.json'),'utf8'));
 if(distManifest.SourceFingerprint!==manifest.SourceFingerprint||distManifest.Deployment!=='distribution')throw new Error('Stale distribution worker graph.');
 for(const[base,files]of[[out,manifest.Files],[path.join(root,'samples/ControlCatalog/worker'),manifest.ApplicationFiles],[distOut,distManifest.Files],[path.join(root,'dist/worker'),distManifest.ApplicationFiles]]){
  const seen=new Set();
  async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())await walk(file);else{const name=path.relative(base,file).split(path.sep).join('/');if((base===out||base===distOut)&&name==='manifest.json')continue;seen.add(name);if(files[name]!==createHash('sha256').update(await readFile(file)).digest('hex'))throw new Error(`Worker graph bytes disagree: ${name}`);count++;}}}await walk(base);
  if(seen.size!==Object.keys(files).length)throw new Error('Worker graph has missing or unexpected entries.');
 }
 return {Passed:true,Files:count,SourceFingerprint:manifest.SourceFingerprint,NativeWasm:'not duplicated',WorkerImportMaps:false};
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await VerifyWorkerAssets()));
