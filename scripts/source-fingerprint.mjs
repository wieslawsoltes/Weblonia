/** Runtime/source evidence key. Generated files, docs, vendor and artifacts are
 * excluded; vendor bytes are independently checked by verify:vendor. */
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function SourceFingerprint(root = fileURLToPath(new URL('../',import.meta.url))) {
    const files = ['package.json'];
    const walk = relative => {
        for (const entry of readdirSync(path.join(root,relative),{withFileTypes:true})) {
            if (['compiled','node_modules','__pycache__','worker-assets','worker'].includes(entry.name)) continue;
            const name = `${relative}/${entry.name}`;
            if (entry.isDirectory()) walk(name);
            else if (entry.isFile() && name !== 'samples/ControlCatalog/index.html') files.push(name);
        }
    };
    for (const scope of ['packages','scripts','tests','samples','.github']) walk(scope);
    const hash = createHash('sha256');
    for (const name of files.sort()) hash.update(name+'\0'+createHash('sha256').update(readFileSync(path.join(root,name))).digest('hex')+'\n');
    return hash.digest('hex');
}
