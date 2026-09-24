import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';

const ns = 'xmlns="https://github.com/avaloniaui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:t="urn:resource-binding"';
class Model extends A.AvaloniaObject {
    constructor() { super(); this.Writes = []; }
    OnPropertyChanged(e) { super.OnPropertyChanged(e); if (e.PropertyName === 'Value') this.Writes.push(e.NewValue); }
}
A.DefineProperties(Model, { Value: ['initial', { Type: String }], Amount: [16, { Type: Number }] });
function registry() {
    const result = new A.XamlTypeRegistry().RegisterAssembly(A);
    result.RegisterType('Model', Model, 'urn:resource-binding');
    result.RegisterModel('Schema', { Value: String, Amount: Number }, 'urn:resource-binding');
    return result;
}
async function build(xml, aot, options = {}) {
    options = { Registry: registry(), ...options };
    const compilation = new A.AvaloniaXamlCompiler(options).Compile(xml);
    if (!aot) return compilation.Build();
    const module = await import('data:text/javascript;base64,' + Buffer.from(compilation.JavaScript).toString('base64'));
    return module.Build(new A.AvaloniaXamlServices(options));
}
function clock(t) {
    let now = 0, nextId = 0;
    const timeouts = new Map(), queued = [], previous = A.Dispatcher.UIThread;
    const dispatcher = new A.Dispatcher({ Now: () => now, QueueMicrotask: cb => queued.push(cb), QueueTask: cb => queued.push(cb) });
    A.Dispatcher.UIThread = dispatcher;
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => { const id = ++nextId; timeouts.set(id, { At: now + delay, callback }); return id; });
    t.mock.method(globalThis, 'clearTimeout', id => timeouts.delete(id));
    t.after(() => { dispatcher.InvokeShutdown(); A.Dispatcher.UIThread = previous; });
    return { get Count() { return timeouts.size; },
        Advance(duration) {
            const end = now + duration; let budget = 10000;
            for (;;) {
                const next = [...timeouts].sort((a,b) => a[1].At - b[1].At)[0];
                if (!next || next[1].At > end) break;
                assert.ok(--budget > 0, 'Resource binding timers must converge');
                now = next[1].At; timeouts.delete(next[0]); next[1].callback(); dispatcher.RunJobs(); queued.length = 0;
            }
            now = end; dispatcher.RunJobs(); queued.length = 0;
        }
    };
}
const expression = target => A.BindingOperations.GetBindingExpressionBase(target, A.TextBox.TextProperty);

for (const aot of [false, true]) {
    const label = aot ? 'AOT' : 'runtime';
    test(`resource/binding ${label}: nested graph keeps standalone declaration scopes after construction stack unwinds`, async t => {
        const r = registry(), source = new A.StaticResourceExtension('Source'), converter = new A.StaticResourceExtension('Flatten');
        const child = new A.Binding({ Source: source, Path: 'Value' });
        const graph = new A.MultiBinding([new A.MultiBinding([child])], converter);
        graph.ConverterParameter = new A.StaticResourceExtension('Prefix');
        class GraphExtension { ProvideValue() { return graph; } }
        class Flatten { Convert(values, type, parameter) { return parameter + values[0][0]; } }
        r.RegisterType('GraphExtension', GraphExtension, 'urn:resource-binding'); r.RegisterType('Flatten', Flatten, 'urn:resource-binding');
        const root = await build(`<ResourceDictionary ${ns}><TextBlock x:Key="Eager" x:Name="Eager" Text="{t:Graph}"/>
          <t:Model x:Key="Source" Value="one"/><t:Flatten x:Key="Flatten"/><x:String x:Key="Prefix">scope:</x:String></ResourceDictionary>`, aot, { Registry: r });
        const target = root.get('Eager'), model = root.get('Source');
        t.after(() => { target.Dispose(); model.Dispose(); root.Dispose(); });
        assert.equal(target.Text, 'scope:one'); model.Value = 'two'; assert.equal(target.Text, 'scope:two');
        assert.equal(child.Source, source); assert.equal(graph.Converter, converter); assert.ok(graph.ConverterParameter instanceof A.StaticResourceExtension);
    });
    test(`resource/binding ${label}: unshared delayed editors resolve timing per realization and retain compiled schema`, async t => {
        const time = clock(t), model = new Model();
        const root = await build(`<Border ${ns} x:CompileBindings="True" x:DataType="t:Schema"><Border.Resources>
          <x:Int32 x:Key="Wait">100</x:Int32><TextBox x:Key="Editor" x:Shared="False" Text="{Binding Value,Mode=TwoWay,Delay={StaticResource Wait}}"/>
        </Border.Resources></Border>`, aot, { DataContext: model });
        const first = root.Resources.get('Editor'); root.Resources.set('Wait', 250); const second = root.Resources.get('Editor');
        t.after(() => { first.Dispose(); second.Dispose(); root.Dispose(); model.Dispose(); });
        assert.notEqual(first, second); assert.ok(expression(first) instanceof A.CompiledBindingExpression); assert.ok(expression(second) instanceof A.CompiledBindingExpression);
        first.SetCurrentValue(A.TextBox.TextProperty, 'first'); second.SetCurrentValue(A.TextBox.TextProperty, 'second');
        assert.equal(time.Count, 2); time.Advance(100); assert.deepEqual(model.Writes, ['first']);
        // A source notification refreshes the second target. A later delivery must
        // never replay its obsolete draft into the shared source.
        assert.equal(second.Text, 'first'); time.Advance(150); assert.deepEqual(model.Writes, ['first']);
        second.SetCurrentValue(A.TextBox.TextProperty, 'next'); time.Advance(249); assert.deepEqual(model.Writes, ['first']);
        time.Advance(1); assert.deepEqual(model.Writes, ['first', 'next']); assert.equal(time.Count, 0);
    });
    test(`resource/binding ${label}: late shared editor inherits current owner and cancels obsolete delayed source writes`, async t => {
        const time = clock(t), firstModel = new Model(), secondModel = new Model(); secondModel.Value = 'replacement'; secondModel.Writes.length = 0;
        const root = await build(`<Border ${ns}><Border.Resources><TextBox x:Key="Editor" Text="{ReflectionBinding Value,Mode=TwoWay,Delay=100}"/></Border.Resources></Border>`, aot, { DataContext: firstModel });
        root.DataContext = secondModel; const editor = root.Resources.get('Editor');
        t.after(() => { editor.Dispose(); root.Dispose(); firstModel.Dispose(); secondModel.Dispose(); });
        assert.equal(editor.Text, 'replacement'); assert.equal(root.Resources.get('Editor'), editor);
        editor.SetCurrentValue(A.TextBox.TextProperty, 'obsolete'); root.DataContext = firstModel; time.Advance(100);
        assert.deepEqual(firstModel.Writes, []); assert.deepEqual(secondModel.Writes, []); assert.equal(editor.Text, 'initial');
        editor.SetCurrentValue(A.TextBox.TextProperty, 'explicit'); expression(editor).UpdateSource();
        assert.deepEqual(firstModel.Writes, ['explicit']); assert.equal(time.Count, 0);
        editor.SetCurrentValue(A.TextBox.TextProperty, 'disposed'); editor.Dispose(); time.Advance(1000);
        assert.deepEqual(firstModel.Writes, ['explicit']); assert.equal(time.Count, 0);
    });
    test(`resource/binding ${label}: invalid delayed resource fails transactionally and can be repaired before retry`, async t => {
        const time = clock(t), model = new Model(), made = [], r = registry();
        class Editor extends A.TextBox { constructor() { super(); made.push(this); } }
        r.RegisterType('Editor', Editor, 'urn:resource-binding');
        const root = await build(`<Border ${ns}><Border.Resources><x:String x:Key="Wait">bad</x:String>
          <t:Editor x:Key="Editor" Text="{Binding Value,Mode=TwoWay,Delay={StaticResource Wait}}"/></Border.Resources></Border>`, aot, { Registry: r, DataContext: model });
        t.after(() => { for (const editor of made) editor.Dispose(); root.Dispose(); model.Dispose(); });
        const subscriptions = model.PropertyChanged.Count;
        assert.equal(made.length, 0); assert.throws(() => root.Resources.get('Editor'), /Delay/);
        assert.equal(made.length, 1); assert.equal(made[0].IsDisposed, true); assert.equal(model.PropertyChanged.Count, subscriptions);
        assert.equal(root.Resources.ContainsDeferredKey('Editor'), true); assert.equal(time.Count, 0);
        root.Resources.set('Wait', 100); const editor = root.Resources.get('Editor'); assert.equal(made.length, 2);
        editor.SetCurrentValue(A.TextBox.TextProperty, 'repaired'); time.Advance(100); assert.deepEqual(model.Writes, ['repaired']);
        assert.equal(root.Resources.get('Editor'), editor); assert.equal(root.Resources.ContainsDeferredKey('Editor'), false);
    });
    test(`resource/binding ${label}: deferred MultiBinding resource preserves nested compiled leaves and live declaration data`, async t => {
        const model = new Model(), next = new Model(); next.Value = 'next'; next.Amount = 42;
        const root = await build(`<Border ${ns} x:DataType="t:Schema" x:CompileBindings="True"><Border.Resources>
          <TextBlock x:Key="Label"><TextBlock.Text><MultiBinding StringFormat="{}{0}:{1}">
            <MultiBinding StringFormat="{}[{0}]"><Binding Path="Value"/></MultiBinding><Binding Path="Amount"/>
          </MultiBinding></TextBlock.Text></TextBlock></Border.Resources></Border>`, aot, { DataContext: model });
        const label = root.Resources.get('Label'); t.after(() => { label.Dispose(); root.Dispose(); model.Dispose(); next.Dispose(); });
        assert.equal(label.Text, '[initial]:16'); const outer = A.BindingOperations.GetBindingExpressionBase(label, A.TextBlock.TextProperty);
        assert.ok(outer._expressions[0]._expressions[0] instanceof A.CompiledBindingExpression);
        assert.ok(outer._expressions[1] instanceof A.CompiledBindingExpression);
        root.DataContext = next; assert.equal(label.Text, '[next]:42'); model.Value = 'obsolete'; assert.equal(label.Text, '[next]:42');
        next.Amount = 7; assert.equal(label.Text, '[next]:7'); label.Dispose(); assert.equal(next.PropertyChanged.Count, 0);
    });
    test(`resource/binding ${label}: unshared graph resolves nested converter resources without poisoning other instances`, async t => {
        const r = registry(), model = new Model(), parameter = new A.StaticResourceExtension('Prefix');
        const graph = new A.MultiBinding([new A.MultiBinding([new A.Binding('Value')])], { Convert: (v, type, p) => p + v[0][0] }); graph.ConverterParameter = parameter;
        class GraphExtension { ProvideValue() { return graph; } }
        r.RegisterType('GraphExtension', GraphExtension, 'urn:resource-binding');
        const root = await build(`<Border ${ns}><Border.Resources><x:String x:Key="Prefix">A:</x:String>
          <TextBlock x:Key="Label" x:Shared="False" Text="{t:Graph}"/></Border.Resources></Border>`, aot, { Registry: r, DataContext: model });
        const first = root.Resources.get('Label'); root.Resources.set('Prefix', 'B:'); const second = root.Resources.get('Label');
        t.after(() => { first.Dispose(); second.Dispose(); root.Dispose(); model.Dispose(); });
        assert.equal(first.Text, 'A:initial'); assert.equal(second.Text, 'B:initial'); model.Value = 'changed';
        assert.equal(first.Text, 'A:changed'); assert.equal(second.Text, 'B:changed'); assert.equal(graph.ConverterParameter, parameter);
        first.Dispose(); model.Value = 'alive'; assert.equal(second.Text, 'B:alive');
    });
    test(`resource/binding ${label}: 1000 unshared edit/dispose cycles retain no timers or source observers`, async t => {
        const time = clock(t), model = new Model();
        const root = await build(`<Border ${ns}><Border.Resources><TextBox x:Key="Editor" x:Shared="False"
          Text="{Binding Value,Mode=TwoWay,Delay=100}"/></Border.Resources></Border>`, aot, { DataContext: model });
        t.after(() => { root.Dispose(); model.Dispose(); });
        const observers = model.PropertyChanged.Count, rootObservers = root.PropertyChanged.Count;
        for (let index = 0; index < 1000; ++index) {
            const editor = root.Resources.get('Editor');
            editor.SetCurrentValue(A.TextBox.TextProperty, String(index));
            assert.equal(time.Count, 1); editor.Dispose();
            assert.equal(time.Count, 0); assert.equal(model.PropertyChanged.Count, observers);
            assert.equal(root.PropertyChanged.Count, rootObservers);
        }
        time.Advance(1000); assert.deepEqual(model.Writes, []); assert.equal(root.Resources.ContainsDeferredKey('Editor'), true);
    });
}
