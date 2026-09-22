import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { ReactiveObject } from '@wieslawsoltes/reactiveweb';
import { Builders, Sources } from '../samples/ControlCatalog/compiled/index.js';
import { Catalog } from '../samples/ControlCatalog/manifest.js';
for (const [name, build] of Object.entries(Builders)) {
    test(`AOT catalog construction, layout and disposal: ${name}`, () => {
        const vm = new ReactiveObject({ Name: 'Ada', Value: 42, Counter: 0, Checked: true, Languages: ['C#', 'JavaScript'], Rows: [], LargeItems: ['A', 'B'], Query: '', CurrentTitle: 'Tests', Breadcrumb: 'TEST', Description: 'Catalog constructor test', Status: 'Tests', RendererStatus: 'Headless' });
        const codeBehind = new Proxy({}, { get() {
                return () => {
                };
            } });
        const root = build(new A.AvaloniaXamlServices({ DataContext: vm, CodeBehind: codeBehind }));
        root.Measure(new A.Size(1200, 850));
        root.Arrange(new A.Rect(0, 0, 1200, 850));
        assert.ok(root.Bounds.Width > 0);
        assert.ok(Sources[name].includes('xmlns'));
        root.Dispose();
        assert.equal(root.IsDisposed, true);
        vm.Dispose();
    });
}
test('catalog coverage manifest does not claim all upstream subexamples', () => {
    assert.equal(Catalog.length, 74);
    assert.equal(Object.keys(Builders).length, 75);
    assert.equal(Catalog.filter(p => p.Status === 'not-implemented').length, 0);
    assert.ok(Catalog.every(p => p.OriginalSubexamplesPorted === false));
});
