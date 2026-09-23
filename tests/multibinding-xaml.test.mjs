import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { Subject } from 'rxjs';
const ns = 'xmlns="https://github.com/avaloniaui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:t="urn:multi-test"';
class Model { constructor(values) { Object.assign(this, values); this.PropertyChanged = new A.Event(); } Set(name, value) { this[name] = value; this.PropertyChanged.Raise(this, { PropertyName: name }); } }
function registry() { return new A.XamlTypeRegistry().RegisterAssembly(A); }
async function build(source, options, aot) {
    const result = new A.AvaloniaXamlCompiler(options).Compile(source);
    if (!aot) return result.Build();
    const module = await import('data:text/javascript;base64,' + Buffer.from(result.JavaScript).toString('base64'));
    return module.Build(new A.AvaloniaXamlServices(options));
}
for (const aot of [false, true]) {
    const label = aot ? 'AOT' : 'runtime';
    test(`MultiBinding ${label}: nesting shares the actual target and supports forward named-element references`, async () => {
        const view = await build(`<StackPanel ${ns}>
          <TextBlock x:Name="result"><TextBlock.Text><MultiBinding StringFormat="{}{0}/{1}">
            <MultiBinding StringFormat="{}{0}+{1}"><Binding Path="Name"/><Binding ElementName="input" Path="Text"/></MultiBinding>
            <Binding Path="Value"/>
          </MultiBinding></TextBlock.Text></TextBlock>
          <TextBox x:Name="input" Text="input"/>
        </StackPanel>`, { DataContext: new Model({ Name: 'first', Value: 2 }) }, aot);
        const result = view.FindControl('result'), input = view.FindControl('input'), old = view.DataContext;
        try {
            assert.equal(result.Text, 'first+input/2'); input.Text = 'changed'; assert.equal(result.Text, 'first+changed/2');
            view.DataContext = new Model({ Name: 'other', Value: 5 }); assert.equal(result.Text, 'other+changed/5');
            assert.equal(old.PropertyChanged.Count, 0); view.DataContext.Set('Value', 9); assert.equal(result.Text, 'other+changed/9');
        } finally { const model = view.DataContext; view.Dispose(); assert.equal(model.PropertyChanged.Count, 0); }
    });
    test(`MultiBinding ${label}: object-element Binding honors inherited CompileBindings and lexical DataType`, async () => {
        const r = registry().RegisterModel('Model', { Name: String, Value: Number }, 'urn:multi-test');
        const view = await build(`<TextBlock ${ns} x:DataType="t:Model" x:CompileBindings="True"><TextBlock.Text>
          <MultiBinding xmlns:t="urn:shadow" StringFormat="{}{0}/{1}"><Binding Path="Name"/><Binding Path="Value"/></MultiBinding>
        </TextBlock.Text></TextBlock>`, { Registry: r, DataContext: new Model({ Name: 'typed', Value: 5 }) }, aot);
        try {
            assert.equal(view.Text, 'typed/5');
            const expression = A.BindingOperations.GetBindingExpressionBase(view, A.TextBlock.TextProperty);
            assert.ok(expression._expressions.every(child => child instanceof A.CompiledBindingExpression));
            view.DataContext.Set('Name', 'updated'); assert.equal(view.Text, 'updated/5');
        } finally { view.Dispose(); }
    });
    test(`MultiBinding ${label}: invalid nested compiled member fails before subscribing any child`, async () => {
        const model = new Model({ Name: 'valid' }), r = registry().RegisterModel('Model', { Name: String }, 'urn:multi-test');
        await assert.rejects(build(`<TextBlock ${ns} x:DataType="t:Model" x:CompileBindings="True"><TextBlock.Text>
          <MultiBinding><Binding Path="Name"/><MultiBinding><Binding Path="Missing"/></MultiBinding></MultiBinding>
        </TextBlock.Text></TextBlock>`, { Registry: r, DataContext: model }, aot), /member 'Missing'/);
        assert.equal(model.PropertyChanged.Count, 0);
    });
    test(`MultiBinding ${label}: explicit ReflectionBinding opts out of an inherited compiled schema`, async () => {
        const r = registry().RegisterModel('Model', { Name: String }, 'urn:multi-test');
        const view = await build(`<TextBlock ${ns} x:DataType="t:Model" x:CompileBindings="True"><TextBlock.Text>
          <MultiBinding StringFormat="{}{0}/{1}"><Binding Path="Name"/><ReflectionBinding Path="Other"/></MultiBinding>
        </TextBlock.Text></TextBlock>`, { Registry: r, DataContext: new Model({ Name: 'declared', Other: 'dynamic' }) }, aot);
        try { assert.equal(view.Text, 'declared/dynamic'); const e = A.BindingOperations.GetBindingExpressionBase(view, A.TextBlock.TextProperty);
            assert.ok(e._expressions[0] instanceof A.CompiledBindingExpression); assert.ok(!(e._expressions[1] instanceof A.CompiledBindingExpression));
        } finally { view.Dispose(); }
    });
    test(`MultiBinding ${label}: explicit Self/Source roots are not checked against the DataContext schema`, async () => {
        const r = registry().RegisterModel('Model', { Name: String }, 'urn:multi-test');
        const view = await build(`<TextBlock ${ns} x:Name="label" Tag="self" x:DataType="t:Model" x:CompileBindings="True"><TextBlock.Text>
          <MultiBinding StringFormat="{}{0}/{1}"><Binding RelativeSource="{RelativeSource Self}" Path="Tag"/>
            <Binding Source="{x:Reference label}" Path="Name"/></MultiBinding>
        </TextBlock.Text></TextBlock>`, { Registry: r, DataContext: new Model({ Name: 'wrong' }) }, aot);
        try { assert.equal(view.Text, 'self/label'); view.Tag = 'new'; assert.equal(view.Text, 'new/label'); } finally { view.Dispose(); }
    });
    test(`MultiBinding ${label}: custom reusable graph resolves nested x:Reference per construction without mutation`, async () => {
        const source = new A.XamlRuntimeContext().Value({ Kind: 'MarkupExtension', Name: 'x:Reference', PositionalArguments: ['input'], NamedArguments: {} }, null, { x: 'http://schemas.microsoft.com/winfx/2006/xaml' }), child = new A.Binding({ Source: source, Path: 'Text' });
        const graph = new A.MultiBinding([new A.MultiBinding([child])], v => v[0][0]);
        class GraphExtension { ProvideValue() { return graph; } }
        const r = registry(); r.RegisterType('GraphExtension', GraphExtension, 'urn:multi-test');
        const xml = `<StackPanel ${ns}><TextBlock Text="{t:Graph}"/><TextBox x:Name="input" Text="fresh"/></StackPanel>`;
        const one = await build(xml, { Registry: r }, aot), two = await build(xml, { Registry: r }, aot);
        try { assert.equal(child.Source, source); one.FindControl('input').Text = 'one'; two.FindControl('input').Text = 'two';
            assert.equal(one.Children.Get(0).Text, 'one'); assert.equal(two.Children.Get(0).Text, 'two');
        } finally { one.Dispose(); two.Dispose(); }
    });
    test(`MultiBinding ${label}: converter resource, parameter and culture retain declared values`, async () => {
        const seen = [];
        class Converter { Convert(v, t, parameter, culture) { seen.push({ parameter, culture }); return v[0] * Number(parameter); } }
        const r = registry(); r.RegisterType('Converter', Converter, 'urn:multi-test');
        const view = await build(`<TextBlock ${ns}><TextBlock.Resources><t:Converter x:Key="multiply"/></TextBlock.Resources><TextBlock.Text>
          <MultiBinding Converter="{StaticResource multiply}" ConverterParameter="2" ConverterCulture="de-DE" StringFormat="{}{0:F1}">
            <Binding Path="Value"/></MultiBinding></TextBlock.Text></TextBlock>`, { Registry: r, DataContext: new Model({ Value: 3.5 }) }, aot);
        try { assert.equal(view.Text, '7,0'); assert.deepEqual(seen, [{ parameter: '2', culture: 'de-DE' }]); } finally { view.Dispose(); }
    });
    test(`MultiBinding ${label}: template child streams and bindings have per-instance lifetime`, async () => {
        const r = registry().RegisterModel('Model', { Stream: Object, Name: String }, 'urn:multi-test');
        const owner = await build(`<Border ${ns}><Border.Resources><DataTemplate x:Key="template" x:CompileBindings="True" x:DataType="t:Model">
          <TextBlock><TextBlock.Text><MultiBinding StringFormat="{}{0}:{1}"><Binding Path="Stream^"/><Binding Path="Name"/></MultiBinding></TextBlock.Text></TextBlock>
        </DataTemplate></Border.Resources></Border>`, { Registry: r }, aot);
        const template = owner.Resources.get('template'), s1 = new Subject(), s2 = new Subject();
        const one = template.Build(new Model({ Stream: s1, Name: 'one' })), two = template.Build(new Model({ Stream: s2, Name: 'two' }));
        try { s1.next('A'); s2.next('B'); assert.equal(one.Text, 'A:one'); assert.equal(two.Text, 'B:two');
            one.Dispose(); assert.equal(s1.observers.length, 0); assert.equal(s2.observers.length, 1);
        } finally { one.Dispose(); two.Dispose(); owner.Dispose(); assert.equal(s2.observers.length, 0); }
    });
}
