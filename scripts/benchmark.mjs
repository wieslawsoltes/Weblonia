/** Deterministic algorithm/ownership microbenchmarks plus local timing samples.
 * Use this exact file with either checkout's register-loader.mjs for A/B runs.
 * Measurements use a counting fixed-width provider, NOT browser/GPU timing.
 */
import * as A from '@wieslawsoltes/avalonia';
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.resolve('@wieslawsoltes/avalonia')))).version;
let measures = 0, layouts = 0, consumed = 0;
A.RegisterTextMetricsProvider({ Measure(text, _typeface, size) { ++measures; return { Width: text.length * 8, Ascent: size * .8, Descent: size * .2 }; } });
class CountingBlock extends A.TextBlock {
    CreateTextLayout(width) { ++layouts; return super.CreateTextLayout(width); }
}
class NullContext extends A.DrawingContext { DrawTextLayout(layout) { consumed += layout.Width; } DrawRectangle() {} }
class Model {
    constructor(values = {}) { this.PropertyChanged = new A.Event(); Object.assign(this, values); }
    Set(name, value) { this[name] = value; this.PropertyChanged.Raise(this, { PropertyName: name }); }
}
function trial(name, action) {
    const samples = [];
    action(); // JIT warm-up excluded from recorded samples.
    for (let i = 0; i < 5; ++i) samples.push(action());
    const sorted = samples.map(s => s.Milliseconds).sort((a, b) => a - b);
    return { Name: name, MedianMilliseconds: sorted[2], MinMilliseconds: sorted[0], MaxMilliseconds: sorted[4], Samples: samples };
}
const results = [];
results.push(trial('5000 unchanged TextBlock renders', () => {
    const block = new CountingBlock('A retained UI label: stable text and stable layout.');
    block.Measure(new A.Size(600, 80)); block.Arrange(new A.Rect(0, 0, 600, 80)); const c = new NullContext();
    for (let i = 0; i < 10; ++i) block.Render(c);
    measures = layouts = 0; const start = performance.now();
    for (let i = 0; i < 5000; ++i) block.Render(c);
    const ms = performance.now() - start, counts = { Measurements: measures, Layouts: layouts }; block.Dispose();
    return { Iterations: 5000, Milliseconds: ms, ...counts };
}));
results.push(trial('100 repeated caret hit tests on a 5000-character line', () => {
    const layout = new A.TextLayout('a'.repeat(5000)); measures = 0;
    const point = new A.Point(19842, 5); layout.HitTestPoint(point); const cold = measures; measures = 0;
    const start = performance.now();
    for (let i = 0; i < 100; ++i) consumed += layout.HitTestPoint(point).TextPosition;
    const ms = performance.now() - start, count = measures; layout.Dispose();
    return { Iterations: 100, Milliseconds: ms, Measurements: count, FirstHitMeasurements: cold };
}));
results.push(trial('20 wrapped layouts of a 10000-character line', () => {
    measures = 0; const text = 'a'.repeat(10000), start = performance.now();
    for (let i = 0; i < 20; ++i) { const layout = new A.TextLayout(text, new A.Typeface(), 14, A.Brushes.Black, { TextWrapping: 'Wrap', MaxWidth: 40000 }); consumed += layout.Height; layout.Dispose(); }
    return { Iterations: 20, Milliseconds: performance.now() - start, Measurements: measures };
}));
results.push(trial('5000 nested compiled-binding leaf updates', () => {
    let reads = 0, subscriptions = 0; const leaf = new Model({ Value: '0' }), model = new Model();
    Object.defineProperty(model, 'Child', { get() { ++reads; return leaf; } });
    for (const m of [model, leaf]) { const add = m.PropertyChanged.Add.bind(m.PropertyChanged); m.PropertyChanged.Add = (...args) => { ++subscriptions; return add(...args); }; }
    const target = new A.TextBlock(); target.DataContext = model;
    A.BindingOperations.Apply(target, A.TextBlock.TextProperty, new A.CompiledBindingExtension('Child.Value'));
    for (let i = 0; i < 10; ++i) leaf.Set('Value', String(i));
    reads = subscriptions = 0; const start = performance.now();
    for (let i = 0; i < 5000; ++i) leaf.Set('Value', String(i));
    const ms = performance.now() - start; if (target.Text !== '4999') throw new Error('Binding workload failed'); target.Dispose();
    return { Iterations: 5000, Milliseconds: ms, AncestorReads: reads, NewSubscriptions: subscriptions };
}));
const result = { Version: version, Node: process.version, Architecture: process.arch, Platform: process.platform, Cpu: os.cpus()[0]?.model,
    Scope: 'Single-process JavaScript microbenchmarks with a counting fixed-width metrics provider; not end-to-end UI/GPU frame rate', SamplesPerCase: 5, Results: results, Consumed: consumed };
const json = JSON.stringify(result, null, 2) + '\n';
if (process.argv[2]) writeFileSync(process.argv[2], json); else process.stdout.write(json);
