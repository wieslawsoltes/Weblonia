import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { BehaviorSubject, Subject } from 'rxjs';
class Model {
    constructor(values = {}) { this.PropertyChanged = new A.Event(); Object.assign(this, values); }
    Set(name, value) { this[name] = value; this.PropertyChanged.Raise(this, { PropertyName: name }); }
}
function bind(model, path, mode = 'OneWay', options = {}) {
    const target = new A.TextBox(), binding = new A.CompiledBindingExtension(path, mode); target.DataContext = model; Object.assign(binding, options);
    return { target, binding, expression: A.BindingOperations.Apply(target, A.TextBox.TextProperty, binding) };
}
test('CompiledBindingExtension creates an executable incremental expression, not the reflection expression', () => {
    const model = new Model({ Value: 'first' }); const { target, expression } = bind(model, 'Value');
    assert.ok(expression instanceof A.CompiledBindingExpression); assert.equal(target.Text, 'first');
    model.Set('Value', 'second'); assert.equal(target.Text, 'second'); target.Dispose(); assert.equal(model.PropertyChanged.Count, 0);
});
test('compiled nested leaf updates do not reread ancestors or recreate subscriptions', () => {
    const leaf = new Model({ Value: '0' }); let reads = 0;
    const root = new Model(); Object.defineProperty(root, 'Child', { get() { ++reads; return leaf; } });
    const { target, expression } = bind(root, 'Child.Value'); const initialReads = reads, initialSubs = expression.Diagnostics.Subscriptions;
    for (let i = 1; i <= 100; ++i) leaf.Set('Value', String(i));
    assert.equal(target.Text, '100'); assert.equal(reads, initialReads); assert.equal(expression.Diagnostics.Subscriptions, initialSubs); target.Dispose();
});
test('compiled branch replacement detaches only the obsolete suffix', () => {
    const one = new Model({ Value: 'one' }), two = new Model({ Value: 'two' }), root = new Model({ Child: one });
    const { target } = bind(root, 'Child.Value'); root.Set('Child', two);
    assert.equal(target.Text, 'two'); assert.equal(one.PropertyChanged.Count, 0); assert.equal(two.PropertyChanged.Count, 1); assert.equal(root.PropertyChanged.Count, 1);
    one.Set('Value', 'stale'); assert.equal(target.Text, 'two'); target.Dispose(); assert.equal(two.PropertyChanged.Count, 0);
});
test('compiled paths preserve terminal null and TargetNullValue without treating it as missing', () => {
    const model = new Model({ Value: null }); const { target } = bind(model, 'Value', 'OneWay', { TargetNullValue: 'NULL', FallbackValue: 'MISSING' });
    assert.equal(target.Text, 'NULL'); delete model.Value; model.PropertyChanged.Raise(model, { PropertyName: 'Value' }); assert.equal(target.Text, 'MISSING'); target.Dispose();
});
test('null intermediate compiled paths recover when the branch appears', () => {
    const model = new Model({ Child: null }); const { target } = bind(model, 'Child.Value', 'OneWay', { FallbackValue: 'waiting' });
    assert.equal(target.Text, 'waiting'); model.Set('Child', new Model({ Value: 'ready' })); assert.equal(target.Text, 'ready'); target.Dispose();
});
test('compiled TwoWay setters reread normalized source values after assignment', () => {
    const model = new Model(); let value = 'first';
    Object.defineProperty(model, 'Value', { get: () => value, set: v => { value = v.toUpperCase(); model.PropertyChanged.Raise(model, { PropertyName: 'Value' }); } });
    const { target } = bind(model, 'Value', 'TwoWay'); target.SetCurrentValue(A.TextBox.TextProperty, 'mixed');
    assert.equal(model.Value, 'MIXED'); assert.equal(target.Text, 'MIXED'); target.Dispose();
});
test('compiled delegates and declared read-only accessors are enforced', () => {
    const model = new Model({ Value: 'direct' }); let gets = 0;
    const path = new A.CompiledBindingPathBuilder().Property({ Name: 'Value', Get: m => { ++gets; return m.Value; }, CanWrite: false }).Build();
    const { target } = bind(model, path, 'TwoWay'); assert.equal(target.Text, 'direct'); assert.ok(gets > 0);
    target.SetCurrentValue(A.TextBox.TextProperty, 'edit'); assert.equal(model.Value, 'direct'); assert.match(target._bindingErrors.get(A.TextBox.TextProperty).message, /read-only/); target.Dispose();
});
test('compiled observable streams switch subscriptions and continue through emitted objects', () => {
    const a = new BehaviorSubject(new Model({ Value: 'A' })), b = new BehaviorSubject(new Model({ Value: 'B' })), model = new Model({ Stream: a });
    const { target } = bind(model, 'Stream^.Value'); assert.equal(target.Text, 'A'); model.Set('Stream', b);
    assert.equal(target.Text, 'B'); assert.equal(a.observers.length, 0); b.value.Set('Value', 'B2'); assert.equal(target.Text, 'B2');
    a.next(new Model({ Value: 'stale' })); assert.equal(target.Text, 'B2'); target.Dispose(); assert.equal(b.observers.length, 0);
});
test('compiled Promise streams ignore stale completions after replacement', async () => {
    let oldResolve, newResolve;
    const model = new Model({ Task: new Promise(r => { oldResolve = r; }) });
    const { target } = bind(model, 'Task^', 'OneWay', { FallbackValue: 'loading' }); assert.equal(target.Text, 'loading');
    model.Set('Task', new Promise(r => { newResolve = r; })); newResolve('new'); await Promise.resolve(); assert.equal(target.Text, 'new');
    oldResolve('old'); await Promise.resolve(); assert.equal(target.Text, 'new'); target.Dispose();
});
test('compiled Promise rejection publishes fallback and exposes the binding error', async () => {
    const { target } = bind(new Model({ Task: Promise.reject(new Error('failed task')) }), 'Task^', 'OneWay', { FallbackValue: 'error' });
    await Promise.resolve(); await Promise.resolve(); assert.equal(target.Text, 'error'); assert.match(target._bindingErrors.get(A.TextBox.TextProperty).message, /failed task/); target.Dispose();
});
test('compiled stream disposal rejects late results and releases child observers', async () => {
    let resolve; const { target, expression } = bind(new Model({ Task: new Promise(r => { resolve = r; }) }), 'Task^');
    target.Dispose(); resolve('late'); await Promise.resolve(); assert.equal(expression.IsDisposed, true); assert.equal(expression._nodes.length, 0);
});
test('compiled OneTime bindings release stream subscriptions after the first real value', () => {
    const stream = new Subject(), { target } = bind(new Model({ Stream: stream }), 'Stream^', 'OneTime', { FallbackValue: 'pending' });
    assert.equal(stream.observers.length, 1); stream.next('first'); assert.equal(target.Text, 'first'); assert.equal(stream.observers.length, 0); target.Dispose();
});
test('builder ArrayElement, TypeCast and Not compose executable operations', () => {
    const path = new A.CompiledBindingPathBuilder().Property('Values').ArrayElement([1]).TypeCast(Boolean).Not().Build();
    const { target } = bind(new Model({ Values: [false, true] }), path); assert.equal(target.Text, 'false'); target.Dispose();
    assert.throws(() => path.Elements.push({}), TypeError);
});
test('compiled self, templated parent and namescope roots resolve without DataContext', () => {
    const target = new A.TextBox(); target.Tag = 'self';
    A.BindingOperations.Apply(target, A.TextBox.TextProperty, new A.CompiledBindingExtension(new A.CompiledBindingPathBuilder().Self().Property('Tag').Build())); assert.equal(target.Text, 'self');
    const parent = new A.Control(); parent.Tag = 'parent'; target.TemplatedParent = parent;
    A.BindingOperations.Apply(target, A.TextBox.TextProperty, new A.CompiledBindingExtension(new A.CompiledBindingPathBuilder().TemplatedParent().Property('Tag').Build())); assert.equal(target.Text, 'parent');
    const scope = new A.NameScope(); scope.Register('ref', parent);
    A.BindingOperations.Apply(target, A.TextBox.TextProperty, new A.CompiledBindingExtension(new A.CompiledBindingPathBuilder().ElementName(scope, 'ref').Property('Tag').Build())); assert.equal(target.Text, 'parent'); target.Dispose(); parent.Dispose();
});
test('compiled command dependencies notify CanExecuteChanged and dispose observers', () => {
    const model = new Model({ Enabled: false }); let executed = 0;
    const path = new A.CompiledBindingPathBuilder().Command('Run', (_m, n) => executed += n, m => m.Enabled, ['Enabled']).Build();
    const target = new A.Button(), binding = new A.CompiledBindingExtension(path); binding.Source = model;
    A.BindingOperations.Apply(target, A.Button.CommandProperty, binding); const command = target.Command; let changes = 0; command.CanExecuteChanged.Add(() => ++changes);
    command.Execute(3); assert.equal(executed, 0); model.Set('Enabled', true); assert.equal(changes, 1); command.Execute(3); assert.equal(executed, 3); target.Dispose(); assert.equal(model.PropertyChanged.Count, 0);
});
test('compiled paths reject unsafe names and preserve carets inside quoted map keys', () => {
    for (const path of ['__proto__.x', 'Value.constructor', "Value['prototype']"]) assert.throws(() => A.CompiledBindingPath.Parse(path), /Unsafe/);
    assert.throws(() => new A.CompiledBindingPathBuilder().Property('__proto__'), /Unsafe/);
    const { target } = bind(new Model({ Values: new Map([['a^b', 'safe']]) }), "Values['a^b']"); assert.equal(target.Text, 'safe'); target.Dispose();
});
test('runtime XAML and emitted AOT modules both execute compiled stream bindings', async () => {
    const xml = '<TextBlock xmlns="https://github.com/avaloniaui" Text="{CompiledBinding Stream^}"/>';
    const result = new A.AvaloniaXamlCompiler().Compile(xml);
    const generated = await import('data:text/javascript;base64,' + Buffer.from(result.JavaScript).toString('base64'));
    for (const build of [options => result.Build(options), options => generated.Build(new A.AvaloniaXamlServices(options))]) {
        const stream = new BehaviorSubject('native compiler path'), control = build({ DataContext: new Model({ Stream: stream }) });
        assert.equal(control.Text, 'native compiler path'); assert.ok(A.BindingOperations.GetBindingExpressionBase(control, A.TextBlock.TextProperty) instanceof A.CompiledBindingExpression);
        stream.next('updated'); assert.equal(control.Text, 'updated'); control.Dispose(); assert.equal(stream.observers.length, 0);
    }
});
test('compiled accessor factories observe, set and dispose without retaining obsolete branches', () => {
    let created = 0, disposed = 0;
    const accessorFactory = (weak, info) => {
        ++created; let disposedHere = false;
        return {
            get Value() { return weak.deref()?.[info.Name] ?? A.UnsetValue; },
            Subscribe(observer) { const source = weak.deref(); observer.OnNext(source[info.Name]); return source.PropertyChanged.Add((_, e) => { if (e.PropertyName === info.Name) observer.OnNext(source[info.Name]); }); },
            SetValue(value) { const source = weak.deref(); if (!source) return false; source.Set(info.Name, value); return true; },
            Dispose() { if (!disposedHere) { ++disposed; disposedHere = true; } },
        };
    };
    const one = new Model({ Value: 'one' }), two = new Model({ Value: 'two' }), root = new Model({ Child: one });
    const path = new A.CompiledBindingPathBuilder().Property('Child').Property({ Name: 'Value' }, accessorFactory).Build();
    const { target } = bind(root, path, 'TwoWay'); assert.equal(target.Text, 'one');
    target.SetCurrentValue(A.TextBox.TextProperty, 'written'); assert.equal(one.Value, 'written');
    root.Set('Child', two); assert.equal(target.Text, 'two'); assert.equal(one.PropertyChanged.Count, 0); assert.equal(disposed, 1);
    target.Dispose(); assert.equal(created, 2); assert.equal(disposed, 2); assert.equal(two.PropertyChanged.Count, 0);
});
test('compiled accessor errors are cleared by the next successful value', () => {
    let observer;
    const factory = () => ({ Subscribe(o) { observer = o; o.OnNext('first'); return A.Disposable.Empty; }, Dispose() {} });
    const path = new A.CompiledBindingPathBuilder().Property({ Name: 'Value' }, factory).Build();
    const { target } = bind(new Model(), path); observer.OnError(new Error('temporary'));
    assert.equal(target._bindingErrors.size, 1); observer.OnNext('restored'); assert.equal(target.Text, 'restored'); assert.equal(target._bindingErrors.size, 0); target.Dispose();
});
test('OneWayToSource preserves the initial target and keeps an active source-only priority entry', () => {
    for (const Ctor of [A.Binding, A.CompiledBindingExtension]) {
        const model = new Model({ Value: 'source' }), target = new A.TextBox(); target.Text = 'initial target'; target.DataContext = model;
        A.BindingOperations.Apply(target, A.TextBox.TextProperty, new Ctor('Value', 'OneWayToSource'));
        assert.equal(model.Value, 'initial target'); assert.equal(target.Text, 'initial target');
        model.Set('Value', 'source change'); assert.equal(target.Text, 'initial target');
        target.SetCurrentValue(A.TextBox.TextProperty, 'edited'); assert.equal(model.Value, 'edited'); target.Dispose();
    }
});
test('compiled explicit source updates do not write before UpdateSource is requested', () => {
    const model = new Model({ Value: 'first' }); const { target, expression } = bind(model, 'Value', 'TwoWay', { UpdateSourceTrigger: 'Explicit' });
    target.SetCurrentValue(A.TextBox.TextProperty, 'pending'); assert.equal(model.Value, 'first'); expression.UpdateSource(); assert.equal(model.Value, 'pending'); target.Dispose();
});
test('compiled builder validates casts and can evaluate nullable getter delegates', () => {
    const p = new A.CompiledBindingPathBuilder().Property('Value').TypeCast(Number).Build();
    const { target } = bind(new Model({ Value: 'not number' }), p, 'OneWay', { FallbackValue: 'cast failed' });
    assert.equal(target.Text, 'cast failed'); assert.match(target._bindingErrors.get(A.TextBox.TextProperty).message, /Number/); target.Dispose();
    const nullable = new A.CompiledBindingPathBuilder().Property('Child').Property({ Name: 'Display', Get: value => value?.Display ?? 'NULL' }, null, true).Build();
    const { target: n } = bind(new Model({ Child: null }), nullable); assert.equal(n.Text, 'NULL'); n.Dispose();
});
