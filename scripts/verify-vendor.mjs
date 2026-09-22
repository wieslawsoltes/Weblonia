/** Verify bundled assets offline before using the source-pinned upstream helper. */
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const expected=JSON.parse(await readFile(path.join(root,'docs/vendor-integrity.json'),'utf8'));
const found=[];
async function scan(dir) {
    for(const e of await readdir(dir,{withFileTypes:true})) {
        const file=path.join(dir,e.name);
        if(e.isSymbolicLink())throw new Error(`Unexpected vendor symlink: ${file}`);
        if(e.isDirectory())await scan(file);
        else if(e.isFile())found.push(path.relative(root,file).split(path.sep).join('/'));
    }
}
await scan(path.join(root,'vendor'));
if(found.length!==Object.keys(expected.files).length)throw new Error('Vendored file count differs from its manifest.');
for(const file of found) {
    const bytes=await readFile(path.join(root,file));
    if(createHash('sha256').update(bytes).digest('hex')!==expected.files[file])throw new Error(`Vendor integrity mismatch: ${file}`);
}
const lock=JSON.parse(await readFile(path.join(root,'docs/upstream-lock.json'),'utf8'));
const manifest=JSON.parse(await readFile(path.join(root,'packages/skia/package.json'),'utf8'));
if(!manifest.dependencies['@wieslawsoltes/skiasharpweb'].endsWith('#'+lock.SkiaSharpWeb.commit))throw new Error('Skia source pin mismatch.');
console.log(JSON.stringify({Passed:true,Files:found.length,SkiaSharpWebCommit:lock.SkiaSharpWeb.commit}));
