import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as shared from '@wieslawsoltes/skiasharpweb/browser-text';
import * as adapter from '../packages/skia/src/text-raster.js';

test('Avalonia text raster compatibility exports are the actual upstream functions', () => {
    assert.deepEqual(Object.keys(adapter).sort(), Object.keys(shared).sort());
    for (const name of Object.keys(shared)) assert.equal(adapter[name], shared[name]);
});
test('text module matches the merged upstream Git blob and consumer pins that exact revision', async () => {
    const file = new URL('../vendor/skiasharpweb/dist/lib/browser-text.js', import.meta.url);
    const content = await readFile(file);
    const gitHash = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
    assert.equal(gitHash, 'b883b4de1a15ca3c8df6a235c92a43905e5523de');
    const manifest = JSON.parse(await readFile(new URL('../packages/skia/package.json',import.meta.url)));
    assert.equal(manifest.dependencies['@wieslawsoltes/skiasharpweb'], 'git+https://github.com/wieslawsoltes/SkiaSharpWeb.git#d5a9e8573c747804930eb76a81d05d2c5dde2d3a');
});
test('shared clipped text planning is proportional to the viewport, not line length', () => {
    const plan = shared.CreateTextRasterPlan({Width:1e9},14,{ScaleX:1,ScaleY:1},128);
    const tiles = [...adapter.CreateTextRasterPlan({Width:1e9},14,{ScaleX:1,ScaleY:1},128).Tiles({Left:900000000,Top:-30,Right:900000400,Bottom:20})];
    assert(tiles.length>=3&&tiles.length<=5);
    assert(tiles[0].Left>899999800);assert.equal(plan.Width,1000000004);
});
