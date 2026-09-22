import { readFile, readdir, mkdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'artifacts/npm');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const result = [];
const npmCli = process.env.npm_execpath;
for (const folder of (await readdir(path.join(root, 'packages'))).sort()) {
    const cwd = path.join(root, 'packages', folder);
    const manifest = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
    const args = ['pack', '--json', '--offline', '--ignore-scripts', '--workspaces=false', '--pack-destination', output];
    const run = npmCli
        ? spawnSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8' })
        : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
    if (run.error) throw run.error;
    if (run.status !== 0) throw new Error(`${manifest.name}: npm pack failed\n${run.stderr}\n${run.stdout}`);
    const [packed] = JSON.parse(run.stdout);
    if (packed.files.some(file => /\.(?:ttf|otf|woff2?|ttc)$/i.test(file.path))) throw new Error('Font files must not be packaged.');
    const bytes = await readFile(path.join(output, packed.filename));
    result.push({ Name: manifest.name, Version: manifest.version, File: packed.filename, Bytes: bytes.length, Sha256: createHash('sha256').update(bytes).digest('hex'), Files: packed.files.map(file => file.path), Dependencies: manifest.dependencies });
    console.log(`${manifest.name}: ${packed.filename} (${bytes.length} bytes)`);
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ Published: false, Packages: result }, null, 2) + '\n');
console.log(`Packed ${result.length} packages; nothing published.`);
