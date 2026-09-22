import test from 'node:test';
import assert from 'node:assert/strict';
import { ResolveCatalogThreadingMode as resolve } from '../samples/ControlCatalog/threading-mode.js';

test('catalog defaults to full isolation with no override', () => assert.equal(resolve(''), 'full-isolation'));
for (const mode of ['single', 'render-worker', 'full-isolation']) {
    test(`catalog keeps explicit ${mode} URL override`, () => assert.equal(resolve(`?threading=${mode}`), mode));
}
test('catalog legacy override precedes the URL', () => assert.equal(resolve('?threading=full-isolation', undefined, 'single'), 'single'));
test('catalog boot options precede legacy and URL overrides', () => assert.equal(resolve('?threading=single', { ThreadingMode: 'full-isolation' }, 'render-worker'), 'full-isolation'));
