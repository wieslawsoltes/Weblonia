import './register-loader.mjs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url)), packages = [];
for (const folder of (await readdir(path.join(root, 'packages'))).sort()) {
    const manifest = JSON.parse(await readFile(path.join(root, 'packages', folder, 'package.json'), 'utf8'));
    const namespace = await import(manifest.name);
    const exports = Object.keys(namespace).sort().map(name => {
        const value = namespace[name];
        const result = { Name: name, Kind: typeof value };
        if (typeof value === 'function' && value.prototype) {
            result.OwnInstanceMembers = Object.getOwnPropertyNames(value.prototype).filter(x => x !== 'constructor');
            result.OwnStaticMembers = Object.getOwnPropertyNames(value).filter(x => !['name', 'length', 'prototype', 'arguments', 'caller'].includes(x));
        }
        return result;
    });
    packages.push({ Name: manifest.name, Path: `packages/${folder}`, Dependencies: manifest.dependencies, Exports: exports });
}
const report = { IsUpstreamCoverageReport: false, Warning: 'Inventory of the delivered implementation only. An export is not a behavioral parity claim.', Packages: packages };
await writeFile(path.join(root, 'docs/api-inventory.json'), JSON.stringify(report, null, 2) + '\n');
let markdown = '# Delivered API inventory\n\nThis inventories this JavaScript implementation, not all upstream Avalonia/XamlX members.\nPresence does not establish behavior/overload parity. Machine-readable own members\nand dependencies are in `api-inventory.json`.\n\n';
for (const p of packages) markdown += `## ${p.Name}\n\n${p.Exports.length} exports.\n\n` + p.Exports.map(e => `\`${e.Name}\``).join(', ') + '\n\n';
await writeFile(path.join(root, 'docs/API-INVENTORY.md'), markdown);
console.log(`Inventoried ${packages.length} packages.`);
