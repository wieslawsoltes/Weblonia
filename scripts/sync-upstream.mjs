import { readFile, mkdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await readFile(path.join(root, 'docs/upstream-lock.json'), 'utf8'));
const targetRoot = path.join(root, 'upstream');
const entries = process.argv.includes('--all') ? ['Avalonia', 'XamlX', 'SkiaSharpWeb', 'ReactiveWeb'] : ['Avalonia', 'XamlX'];
const dryRun = process.argv.includes('--dry-run');
function git(args, cwd, capture = false) {
    const run = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
    if (run.error) throw run.error;
    if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed (${run.status}).`);
    return (run.stdout ?? '').trim();
}
await mkdir(targetRoot, { recursive: true });
for (const name of entries) {
    const pin = lock[name];
    if (!/^[a-f\d]{40}$/i.test(pin.commit)) throw new Error(`${name}: missing full commit pin`);
    const destination = path.join(targetRoot, name), url = `https://github.com/${pin.repository}.git`;
    console.log(`${name}: full clone ${url}, detached checkout ${pin.commit}`);
    if (dryRun) continue;
    let exists = false;
    try { await access(destination); exists = true; } catch { }
    if (!exists) {
        // No --depth/filter: this is a full Git source clone, not a source stub.
        git(['clone', '--no-checkout', url, destination], root);
    } else {
        const origin = git(['remote', 'get-url', 'origin'], destination, true).replace(/\.git$/, '').replace(/\/$/, '');
        if (origin !== url.replace(/\.git$/, '')) throw new Error(`Refusing unrelated origin in ${destination}: ${origin}`);
        if (git(['status', '--porcelain'], destination, true)) throw new Error(`Refusing dirty worktree: ${destination}`);
        git(['fetch', 'origin', '--tags'], destination);
    }
    git(['checkout', '--detach', pin.commit], destination);
    git(['submodule', 'update', '--init', '--recursive'], destination);
    const actual = git(['rev-parse', 'HEAD'], destination, true);
    if (actual !== pin.commit) throw new Error(`Pin mismatch: ${actual}`);
}
console.log(dryRun ? 'Dry run: no repositories were cloned or changed.' : 'Pinned upstream source checkouts ready. This does not change JavaScript compatibility coverage.');
