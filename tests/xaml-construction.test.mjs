import test from 'node:test';
import assert from 'node:assert/strict';
import { XamlOverloadResolver, XamlTypeReference, SplitTypeArguments } from '@wieslawsoltes/xamlx';
import { XamlTypeRegistry, AvaloniaXamlCompiler, AvaloniaXamlServices } from '@wieslawsoltes/avalonia-markup-xaml';
import * as A from '@wieslawsoltes/avalonia';
const xns = 'http://schemas.microsoft.com/winfx/2006/xaml';
const registry = () => new XamlTypeRegistry().RegisterAssembly(A).RegisterAssembly(A, 'urn:test');
const xml = body => body.replace('<test:', `<test:`).replace(' xmlns:x="X"', ` xmlns:x="${xns}"`);
async function runBoth(source, r, verify) {
    const compiled = new AvaloniaXamlCompiler({ Registry: r }).Compile(xml(source));
    const runtime = compiled.Build(); verify(runtime);
    const module = await import('data:text/javascript;base64,' + Buffer.from(compiled.JavaScript).toString('base64'));
    const aot = module.Build(new AvaloniaXamlServices({ Registry: r })); verify(aot);
    runtime?.Dispose?.(); aot?.Dispose?.();
}

test('XAML explicit constructor overloads preserve argument types in runtime and direct AOT', async () => {
    class Choice { constructor(kind, value) { this.Kind = kind; this.Value = value; } }
    const r = registry();
    r.RegisterType('Choice', Choice, 'urn:test', { Constructors: [
        { Parameters: [String], Invoke: value => new Choice('string', value) },
        { Parameters: [Number], Invoke: value => new Choice('number', value) }
    ] });
    await runBoth('<test:Choice xmlns:test="urn:test" xmlns:x="X"><x:Arguments><x:Int32>42</x:Int32></x:Arguments></test:Choice>', r, x => {
        assert.equal(x.Kind, 'number'); assert.equal(x.Value, 42);
    });
    await runBoth('<test:Choice xmlns:test="urn:test" xmlns:x="X"><x:Arguments><x:String>42</x:String></x:Arguments></test:Choice>', r, x => assert.equal(x.Kind, 'string'));
});

test('XAML registered factories receive optional and variadic arguments without eval', async () => {
    class Product { constructor(name, values) { this.Name = name; this.Values = values; } }
    const r = registry();
    r.RegisterType('Product', Product, 'urn:test', { FactoryMethods: { Create: [
        { Parameters: [String, { Type: Number, Params: true }], Invoke: (s, values) => new Product(s, values) }
    ] } });
    await runBoth('<test:Product xmlns:test="urn:test" xmlns:x="X" x:FactoryMethod="Create"><x:Arguments><x:String>sum</x:String><x:Int32>2</x:Int32><x:Double>3.5</x:Double></x:Arguments></test:Product>', r, x => assert.deepEqual(x.Values, [2, 3.5]));
    assert.equal(XamlOverloadResolver.Resolve([{ Parameters: [{ Type: Number, Optional: true, DefaultValue: 10 }] }], []).Arguments[0], 10);
    assert.throws(() => XamlOverloadResolver.Construct({ Name: 'Unsafe', Type: Product }, [], 'constructor'), /Unsafe/);
});

test('XAML generic factories cache closed types and typed arrays reject incompatible elements', async () => {
    const r = registry(); let calls = 0;
    r.RegisterGenericType('Box', 1, ElementType => { ++calls; return class Box { constructor() { this.Items = []; this.ElementType = ElementType; } }; }, 'urn:test', { ContentProperty: 'Items' });
    await runBoth('<test:Box xmlns:test="urn:test" xmlns:x="X" x:TypeArguments="x:String"><x:String>a</x:String><x:String>b</x:String></test:Box>', r, x => {
        assert.deepEqual(x.Items, ['a', 'b']); assert.equal(x.ElementType, String);
    });
    assert.equal(calls, 1);
    assert.equal(r.ResolveType('t:Box(x:String)', { t: 'urn:test', x: xns }), r.MakeGenericType('Box', 'urn:test', [String]).Type);
    await runBoth('<x:Array xmlns:x="X" Type="x:Int32"><x:Int32>1</x:Int32><x:Int32>2</x:Int32></x:Array>', r, x => assert.deepEqual(x, [1, 2]));
    assert.throws(() => new AvaloniaXamlCompiler({ Registry: r }).Compile(xml('<x:Array xmlns:x="X" Type="x:Int32"><x:String>1</x:String></x:Array>')).Build(), /not assignable/);
});

test('XAML array resources remain keyed and nested object arguments do not become RootObject', async () => {
    class Holder { constructor(value) { this.Content = value; this.Root = null; } }
    const r = registry(); r.RegisterType('Holder', Holder, 'urn:test');
    await runBoth('<test:Holder xmlns:test="urn:test" xmlns:x="X" Root="{x:Reference holder}" x:Name="holder"><x:Arguments><test:Border/></x:Arguments></test:Holder>', r, x => {
        assert.equal(x.Root, x); assert.ok(x.Content instanceof A.Border);
    });
    await runBoth('<Border xmlns="https://github.com/avaloniaui" xmlns:x="X"><Border.Resources><x:Array Type="x:String" x:Key="names"><x:String>A</x:String></x:Array></Border.Resources></Border>', r, x => assert.deepEqual(x.Resources.get('names'), ['A']));
});

test('XAML failure disposes constructed objects once in both execution paths', async () => {
    let disposed = 0;
    class Tracked { Dispose() { ++disposed; } }
    const r = registry(); r.RegisterType('Tracked', Tracked, 'urn:test');
    const compiled = new AvaloniaXamlCompiler({ Registry: r }).Compile('<Tracked xmlns="urn:test" Missing="1"/>');
    assert.throws(() => compiled.Build(), /does not exist/); assert.equal(disposed, 1);
    const module = await import('data:text/javascript;base64,' + Buffer.from(compiled.JavaScript).toString('base64'));
    assert.throws(() => module.Build(new AvaloniaXamlServices({ Registry: r })), /does not exist/); assert.equal(disposed, 2);
});

test('overload ambiguity, nullability and numeric validation are explicit', () => {
    assert.throws(() => XamlOverloadResolver.Resolve([{ Parameters: [Number] }, { Parameters: [Number] }], [1]), /Ambiguous/);
    assert.throws(() => XamlOverloadResolver.Resolve([{ Parameters: [Number] }], [null]), /No applicable/);
    const integer = new XamlTypeReference(Number, { Name: 'Positive', Validate: x => Number.isInteger(x) && x > 0 });
    assert.throws(() => XamlOverloadResolver.Resolve([{ Parameters: [integer] }], ['-1']), /No applicable/);
    assert.equal(XamlOverloadResolver.Resolve([{ Parameters: [integer] }], ['4']).Arguments[0], 4);
    const r = registry(), n = { x: xns };
    assert.equal(r.ResolveTypeReference('x:Int32?', n).Accepts(null), true);
    assert.equal(r.ResolveTypeReference('x:Int32[]', n).Accepts([1, 2]), true);
    assert.equal(r.ResolveTypeReference('x:Int32[]', n).Accepts([1.5]), false);
    assert.deepEqual(SplitTypeArguments('Pair(x:String, Box(x:Int32)), x:Boolean'), ['Pair(x:String, Box(x:Int32))', 'x:Boolean']);
});

test('XAML duplicate constructor directives and missing generic arity fail before silent defaults', () => {
    const r = registry();
    assert.throws(() => new AvaloniaXamlCompiler({ Registry: r }).Compile(xml('<Border xmlns="https://github.com/avaloniaui" xmlns:x="X"><x:Arguments/><x:Arguments/></Border>')), /Only one/);
    assert.throws(() => new AvaloniaXamlCompiler({ Registry: r }).Compile(xml('<Border xmlns="https://github.com/avaloniaui" xmlns:x="X" x:TypeArguments="x:String"/>')).Build(), /Generic type/);
});
