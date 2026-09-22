import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as A from '@wieslawsoltes/avalonia';
import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';
import { XamlXmlParser, MarkupExtensionParser } from '@wieslawsoltes/xamlx';
import { ReactiveObject, ReactiveCommand } from '@wieslawsoltes/reactiveweb';
import { BehaviorSubject } from 'rxjs';
import { LruCache } from '@wieslawsoltes/avalonia-skia';
class Model extends A.AvaloniaObject {
}
A.DefineProperties(Model, { Value: [0], Inherited: ['default', { Inherits: true }], Checked: [true] });
const xml = body => `<UserControl xmlns="https://github.com/avaloniaui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">${body}</UserControl>`;
const load = (body, options) => new A.AvaloniaXamlCompiler().Compile(xml(body)).Build(options);
const control = (T, values = {}) => Object.assign(new T(), values);
test('value priorities expose lower priorities when disposed', () => {
    const m = new Model();
    const style = m.SetValue(Model.ValueProperty, 10, A.BindingPriority.Style);
    const trigger = m.SetValue(Model.ValueProperty, 20, A.BindingPriority.StyleTrigger);
    m.Value = 30;
    const animation = m.SetValue(Model.ValueProperty, 40, A.BindingPriority.Animation);
    assert.equal(m.Value, 40);
    assert.equal(m.GetBaseValue(Model.ValueProperty), 30);
    animation.Dispose();
    assert.equal(m.Value, 30);
    m.ClearValue(Model.ValueProperty);
    assert.equal(m.Value, 20);
    trigger.Dispose();
    assert.equal(m.Value, 10);
    style.Dispose();
    assert.equal(m.Value, 0);
    m.Dispose();
});
test('later same-priority value wins and removal reveals prior', () => {
    const m = new Model(), one = m.SetValue(Model.ValueProperty, 1, 3), two = m.SetValue(Model.ValueProperty, 2, 3);
    assert.equal(m.Value, 2);
    two.Dispose();
    assert.equal(m.Value, 1);
    one.Dispose();
    m.Dispose();
});
test('inheritance notifications and local overrides', () => {
    const parent = new Model(), child = new Model();
    child.SetInheritanceParent(parent);
    const values = [];
    const sub = child.GetObservable(Model.InheritedProperty).subscribe(v => values.push(v));
    parent.Inherited = 'parent';
    child.Inherited = 'local';
    parent.Inherited = 'new';
    assert.equal(child.Inherited, 'local');
    child.ClearValue(Model.InheritedProperty);
    assert.equal(child.Inherited, 'new');
    assert.deepEqual(values, ['default', 'parent', 'local', 'new']);
    sub.unsubscribe();
    child.Dispose();
    parent.Dispose();
});
test('inheritance cycles are rejected', () => {
    const a = new Model(), b = new Model();
    b.SetInheritanceParent(a);
    assert.throws(() => a.SetInheritanceParent(b), /cycle/);
    b.Dispose();
    a.Dispose();
});
test('RxJS observable binding lifecycle and SetCurrentValue', () => {
    const m = new Model(), source = new BehaviorSubject(3), binding = m.Bind(Model.ValueProperty, source);
    assert.equal(m.Value, 3);
    source.next(4);
    assert.equal(m.Value, 4);
    m.SetCurrentValue(Model.ValueProperty, 9);
    source.next(5);
    assert.equal(m.Value, 5);
    m.Value = 12;
    source.next(6);
    assert.equal(m.Value, 12);
    binding.Dispose();
    m.Dispose();
    source.complete();
});
test('style observable does not replace local observable binding', () => {
    const m = new Model(), local = new BehaviorSubject(1), style = new BehaviorSubject(2);
    m.Bind(Model.ValueProperty, local);
    m.Bind(Model.ValueProperty, style, A.BindingPriority.Style);
    assert.equal(m.Value, 1);
    local.next(3);
    assert.equal(m.Value, 3);
    m.ClearValue(Model.ValueProperty);
    assert.equal(m.Value, 2);
    m.Dispose();
    assert.equal(style.observers.length, 0);
    assert.equal(local.observers.length, 0);
});
test('direct properties call setter and publish once', () => {
    class Direct extends A.AvaloniaObject {
        constructor() {
            super();
            this._number = 0;
        }
    }
    const p = A.AvaloniaProperty.RegisterDirect(Direct, 'Number', o => o._number, (o, v) => o.SetAndRaise(p, '_number', v));
    const m = new Direct();
    let count = 0;
    m.PropertyChanged.Add(() => count++);
    m.SetValue(p, 10);
    assert.equal(m.GetValue(p), 10);
    assert.equal(count, 1);
    m.Dispose();
});
test('ReactiveWeb nested source replacement rebinds path', () => {
    const first = new ReactiveObject({ Name: 'first' }), second = new ReactiveObject({ Name: 'second' }), vm = new ReactiveObject({ Child: first });
    const t = new A.TextBlock();
    t.Bind(A.TextBlock.TextProperty, new A.Binding({ Path: 'Child.Name', Source: vm }));
    assert.equal(t.Text, 'first');
    vm.Child = second;
    assert.equal(t.Text, 'second');
    first.Name = 'ignored';
    assert.equal(t.Text, 'second');
    second.Name = 'changed';
    assert.equal(t.Text, 'changed');
    t.Dispose();
    vm.Dispose();
    first.Dispose();
    second.Dispose();
});
test('ReactiveWeb two-way textbox binding', () => {
    const vm = new ReactiveObject({ Name: 'Ada' }), t = new A.TextBox();
    t.Bind(A.TextBox.TextProperty, new A.Binding({ Path: 'Name', Source: vm, Mode: 'TwoWay' }));
    t.SetCurrentValue(A.TextBox.TextProperty, 'Grace');
    assert.equal(vm.Name, 'Grace');
    vm.Name = 'Katherine';
    assert.equal(t.Text, 'Katherine');
    t.Dispose();
    vm.Dispose();
});
test('OneTime binding takes initial source only', () => {
    const vm = new ReactiveObject({ Name: 'A' }), t = new A.TextBlock();
    t.Bind(A.TextBlock.TextProperty, new A.Binding({ Path: 'Name', Source: vm, Mode: 'OneTime' }));
    vm.Name = 'B';
    assert.equal(t.Text, 'A');
    t.Dispose();
    vm.Dispose();
});
test('binding fallback applies to missing source path', () => {
    const t = new A.TextBlock();
    t.Bind(A.TextBlock.TextProperty, new A.Binding({ Path: 'Missing', Source: {}, FallbackValue: 'fallback' }));
    assert.equal(t.Text, 'fallback');
    t.Dispose();
});
test('binding target-null replacement preserves null semantics', () => {
    const t = new A.TextBlock();
    t.Bind(A.TextBlock.TextProperty, new A.Binding({ Path: 'Name', Source: { Name: null }, TargetNullValue: '(none)' }));
    assert.equal(t.Text, '(none)');
    t.Dispose();
});
for (const path of ['__proto__.polluted', 'constructor.name', 'Value["__proto__"]'])
    test(`unsafe binding path rejected: ${path}`, () => assert.throws(() => A.PropertyPath.Parse(path), /Unsafe/));
test('binding path parses array and dictionary indexers', () => {
    assert.deepEqual(A.PropertyPath.Parse('Items[2].Name').map(s => s.Name), ['Items', 2, 'Name']);
    assert.equal(A.ReadMember(new Map([['key', 17]]), { Kind: 'Indexer', Name: 'key' }), 17);
});
test('dynamic resource updates existing target', () => {
    const root = new A.StackPanel(), t = new A.TextBlock();
    root.Resources.set('caption', 'first');
    root.Children.Add(t);
    t.Bind(A.TextBlock.TextProperty, A.GetResourceObservable(t, 'caption'));
    assert.equal(t.Text, 'first');
    root.Resources.set('caption', 'second');
    assert.equal(t.Text, 'second');
    root.Dispose();
});
test('conditional styles activate and deactivate without defeating local values', () => {
    const root = new HeadlessTopLevel(), b = new A.Button();
    const style = new A.Style('Button.active');
    style.Setters.Add(new A.Setter('Opacity', .5));
    root.Styles.Add(style);
    root.Content = b;
    root.Layout();
    assert.equal(b.Opacity, 1);
    b.Classes.Add('active');
    root.Layout();
    assert.equal(b.Opacity, .5);
    b.Opacity = .8;
    b.Classes.Remove('active');
    root.Layout();
    assert.equal(b.Opacity, .8);
    root.Dispose();
});
test('attached properties are supported in style setters', () => {
    const b = new A.Button();
    const subscription = new A.Setter('Grid.Column', 2).Apply(b, A.BindingPriority.Style);
    assert.equal(A.Grid.GetColumn(b), 2);
    subscription.Dispose();
    assert.equal(A.Grid.GetColumn(b), 0);
    b.Dispose();
});
test('measure/arrange applies margin and alignment', () => {
    const b = control(A.Border, { Width: 100, Height: 40, Margin: new A.Thickness(10), HorizontalAlignment: 'Center', VerticalAlignment: 'Center' });
    b.Measure(new A.Size(400, 300));
    assert.equal(b.DesiredSize.Width, 120);
    b.Arrange(new A.Rect(0, 0, 400, 300));
    assert.equal(b.Bounds.X, 150);
    assert.equal(b.Bounds.Y, 130);
    b.Dispose();
});
test('Grid resolves pixel and weighted star columns', () => {
    const grid = new A.Grid();
    grid.ColumnDefinitions = '100,*,2*';
    grid.RowDefinitions = '*';
    for (let i = 0; i < 3; i++) {
        const b = new A.Border();
        A.Grid.SetColumn(b, i);
        grid.Children.Add(b);
    }
    grid.Measure(new A.Size(700, 100));
    grid.Arrange(new A.Rect(0, 0, 700, 100));
    assert.deepEqual(grid.Children.ToArray().map(c => c.Bounds.Width), [100, 200, 400]);
    grid.Dispose();
});
test('Grid star row behaves as auto under infinite measure', () => {
    const g = new A.Grid(), b = control(A.Border, { Width: 90, Height: 42 });
    g.Children.Add(b);
    g.Measure(new A.Size(300, Infinity));
    assert.equal(g.DesiredSize.Height, 42);
    g.Dispose();
});
test('Grid layout invalidates after definition changes', () => {
    const root = new HeadlessTopLevel(new A.Size(600, 100)), g = new A.Grid();
    g.ColumnDefinitions = '100,*';
    const b = new A.Border();
    g.Children.Add(b);
    root.Content = g;
    root.Layout();
    assert.equal(b.Bounds.Width, 100);
    g.ColumnDefinitions.Get(0).Width = new A.GridLength(150);
    root.Layout();
    assert.equal(b.Bounds.Width, 150);
    root.Dispose();
});
test('StackPanel sums children and spacing', () => {
    const p = new A.StackPanel([control(A.Border, { Width: 40, Height: 30 }), control(A.Border, { Width: 70, Height: 20 })]);
    p.Spacing = 5;
    p.Measure(A.Size.Infinity);
    assert.equal(p.DesiredSize.Height, 55);
    assert.equal(p.DesiredSize.Width, 70);
    p.Dispose();
});
test('WrapPanel starts a new line when width is exceeded', () => {
    const p = new A.WrapPanel([control(A.Border, { Width: 60, Height: 20 }), control(A.Border, { Width: 60, Height: 20 })]);
    p.Measure(new A.Size(100, 300));
    assert.equal(p.DesiredSize.Height, 40);
    p.Dispose();
});
test('RelativePanel detects circular sibling references', () => {
    const a = control(A.Border, { Name: 'a', Width: 20, Height: 20 }), b = control(A.Border, { Name: 'b', Width: 20, Height: 20 });
    const p = new A.RelativePanel([a, b]);
    A.RelativePanel.SetRightOf(a, b);
    A.RelativePanel.SetRightOf(b, a);
    assert.throws(() => p.Measure(new A.Size(100, 100)), /cycle/);
    p.Dispose();
});
test('visual ownership rejects duplicates and cycles', () => {
    const a = new A.Panel(), b = new A.Panel();
    a.Children.Add(b);
    assert.throws(() => b.AddVisualChild(a), /cycle/i);
    a.Dispose();
});
test('headless mouse click invokes a genuine ReactiveCommand', () => {
    const root = new HeadlessTopLevel(new A.Size(200, 100));
    let count = 0;
    const command = ReactiveCommand.Create(() => count++);
    root.Content = control(A.Button, { Content: 'Click', Command: command });
    root.Layout();
    root.Click(new A.Point(50, 50));
    assert.equal(count, 1);
    command.Dispose();
    root.Dispose();
});
test('button keyboard activation and disabled state', () => {
    const root = new HeadlessTopLevel(new A.Size(200, 100)), b = new A.Button('Test');
    let count = 0;
    b.Click.Add(() => count++);
    root.Content = b;
    root.Layout();
    b.Focus();
    root.KeyPress('Enter');
    assert.equal(count, 1);
    b.IsEnabled = false;
    root.Click(new A.Point(20, 20));
    assert.equal(count, 1);
    root.Dispose();
});
test('routed event tunnels before bubbling', () => {
    const root = new A.Panel(), child = new A.Button();
    root.Children.Add(child);
    const e = new A.RoutedEvent(A.Control, 'Probe', A.RoutingStrategies.Tunnel | A.RoutingStrategies.Bubble), order = [];
    root.AddHandler(e, () => order.push('root-tunnel'), A.RoutingStrategies.Tunnel);
    child.AddHandler(e, () => order.push('child-bubble'), A.RoutingStrategies.Bubble);
    root.AddHandler(e, () => order.push('root-bubble'), A.RoutingStrategies.Bubble);
    child.RaiseEvent(new A.RoutedEventArgs(e, child));
    assert.deepEqual(order, ['root-tunnel', 'child-bubble', 'root-bubble']);
    root.Dispose();
});
test('virtual ListBox realizes a bounded viewport for 10,000 items', () => {
    const root = new HeadlessTopLevel(new A.Size(400, 300)), list = new A.ListBox();
    list.ItemsSource = Array.from({ length: 10000 }, (_, i) => `Item ${i}`);
    root.Content = list;
    root.Layout();
    assert.ok(list.GetRealizedContainers().length < 20);
    list.ScrollIntoView(9999);
    root.Layout();
    assert.ok(list.ContainerFromIndex(9999));
    assert.ok(list.GetRealizedContainers().length < 20);
    root.Dispose();
});
test('virtual ListBox nested in unconstrained Grid converges', () => {
    const root = new HeadlessTopLevel(new A.Size(500, 600)), stack = new A.StackPanel(), grid = new A.Grid(), list = control(A.ListBox, { Height: 300 });
    list.ItemsSource = Array.from({ length: 10000 }, (_, i) => `Item ${i}`);
    grid.Children.Add(list);
    stack.Children.Add(grid);
    root.Content = stack;
    root.Layout();
    assert.ok(list.GetRealizedContainers().length < 20);
    root.Dispose();
});
test('Menu rebuild preserves caller-owned MenuItem instances', () => {
    const menu = new A.Menu(), file = new A.MenuItem('File'), edit = new A.MenuItem('Edit');
    menu.Items.Add(file);
    menu.Items.Add(edit);
    assert.equal(file.IsDisposed, false);
    assert.equal(menu.ContainerFromIndex(0), file);
    menu.Dispose();
});
test('scalar XAML resources, attached properties and namescope', () => {
    const page = load(`<UserControl.Resources><x:Double x:Key="size">45</x:Double></UserControl.Resources><Grid><Button x:Name="hello" Grid.Column="2" Height="{StaticResource size}" Content="Hello" /></Grid>`);
    const b = page.FindControl('hello');
    assert.equal(b.Height, 45);
    assert.equal(A.Grid.GetColumn(b), 2);
    assert.equal(b.Content, 'Hello');
    page.Dispose();
});
test('XAML two-way bindings integrate ReactiveWeb', () => {
    const vm = new ReactiveObject({ Name: 'Ada' });
    const page = load('<TextBox x:Name="editor" Text="{Binding Name, Mode=TwoWay}"/>', { DataContext: vm });
    const t = page.FindControl('editor');
    assert.equal(t.Text, 'Ada');
    t.SetCurrentValue(A.TextBox.TextProperty, 'Grace');
    assert.equal(vm.Name, 'Grace');
    page.Dispose();
    vm.Dispose();
});
test('AOT emitter produces executable ESM without eval', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'avalonia-xaml-'));
    try {
        const compiled = new A.AvaloniaXamlCompiler().Compile(xml('<Button x:Name="go" Content="AOT" Click="OnClick"/>'));
        assert.doesNotMatch(compiled.JavaScript, /\beval\s*\(|new Function\s*\(/);
        const file = join(dir, 'view.mjs');
        await writeFile(file, compiled.JavaScript);
        const module = await import(pathToFileURL(file));
        let count = 0;
        const page = module.Build(new A.AvaloniaXamlServices({ CodeBehind: { OnClick() {
                    count++;
                } } }));
        const b = page.FindControl('go');
        b.RaiseEvent(new A.RoutedEventArgs(A.Button.ClickEvent, b));
        assert.equal(count, 1);
        assert.equal(b.Content, 'AOT');
        page.Dispose();
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
});
test('ControlTemplate and TemplateBinding propagate content', () => {
    const page = load(`<Button x:Name="button" Content="Template"><Button.Template><ControlTemplate><Border Background="Red"><ContentPresenter x:Name="presenter" Content="{TemplateBinding Content}"/></Border></ControlTemplate></Button.Template></Button>`);
    const root = new HeadlessTopLevel();
    root.Content = page;
    root.Layout();
    const button = page.FindControl('button');
    assert.ok(button.VisualChildren.length > 0);
    assert.equal(button.VisualChildren.length, 1);
    button.Content = 'Updated';
    root.Layout();
    root.Dispose();
});
for (const [name, source] of [
    ['DOCTYPE', '<!DOCTYPE a SYSTEM "file:///etc/passwd"><a/>'], ['external entity', '<a>&external;</a>'], ['bare ampersand', '<a>A & B</a>'], ['duplicate attribute', '<a x="1" x="2"/>'], ['mismatched close', '<a></b>'], ['undeclared namespace', '<unknown:a/>'], ['multiple roots', '<a/><b/>'], ['invalid codepoint', '<a>&#xD800;</a>'],
])
    test(`XML parser rejects ${name}`, () => assert.throws(() => XamlXmlParser.Parse(source)));
test('XML parser enforces nesting limit', () => assert.throws(() => XamlXmlParser.Parse('<a><a><a/></a></a>', { MaxDepth: 2 }), /nesting/));
test('XML parser handles namespaced attributes and escaped text', () => {
    const d = XamlXmlParser.Parse('<a xmlns:x="urn:x" x:name="n">A &amp; B</a>');
    assert.equal(d.Root.Attributes[0].Namespace, 'urn:x');
    assert.equal(d.Root.Children[0].Text, 'A & B');
});
test('markup extension parser preserves nested expressions and quoted commas', () => {
    const m = MarkupExtensionParser.Parse('{Binding Name, Converter={StaticResource C}, StringFormat="A, {0}"}');
    assert.equal(m.Name, 'Binding');
    assert.equal(m.NamedArguments.Converter.Name, 'StaticResource');
    assert.equal(m.NamedArguments.StringFormat, 'A, {0}');
});
test('unknown XAML types and properties fail rather than being ignored', () => {
    assert.throws(() => load('<MissingControl/>'));
    assert.throws(() => load('<Button MadeUpProperty="true"/>'));
});
test('XAML property assignment cannot pollute prototypes', () => assert.throws(() => load('<Button __proto__="bad"/>')));
test('animation samples keyframes and restores base value', async () => {
    const target = new A.Control(), clock = new A.ManualClock(), animation = new A.Animation();
    animation.Duration = 100;
    animation.Clock = clock;
    animation.Children.Add(new A.KeyFrame(0, [new A.Setter(A.Control.OpacityProperty, 0)]));
    animation.Children.Add(new A.KeyFrame(1, [new A.Setter(A.Control.OpacityProperty, 1)]));
    const completion = animation.RunAsync(target, null, clock);
    assert.equal(target.Opacity, 0);
    clock.Advance(50);
    assert.equal(target.Opacity, .5);
    clock.Advance(50);
    await completion;
    assert.equal(target.Opacity, 1);
    assert.equal(target.IsAnimating(A.Control.OpacityProperty), false);
    target.Dispose();
});
test('animation abort releases priority values and subscription', async () => {
    const target = new A.Control(), clock = new A.ManualClock(), abort = new AbortController(), a = new A.Animation();
    a.Duration = 100;
    a.Clock = clock;
    a.Children.Add(new A.KeyFrame(0, [new A.Setter('Opacity', 0)]));
    a.Children.Add(new A.KeyFrame(1, [new A.Setter('Opacity', 1)]));
    const promise = a.RunAsync(target, abort.signal, clock);
    abort.abort();
    await promise;
    assert.equal(target.Opacity, 1);
    assert.equal(clock._listeners.size, 0);
    target.Dispose();
});
test('LRU cache eviction disposes native resources', () => {
    let disposed = 0;
    const cache = new LruCache(2, 20);
    cache.Set('a', { Dispose() {
            disposed++;
        } }, 8);
    cache.Set('b', { Dispose() {
            disposed++;
        } }, 8);
    cache.Get('a');
    cache.Set('c', { Dispose() {
            disposed++;
        } }, 8);
    assert.equal(cache.Get('b'), null);
    assert.equal(disposed, 1);
    cache.Dispose();
    assert.equal(disposed, 3);
});
test('affine matrix inverse restores transformed coordinates', () => {
    const m = new A.Matrix(2, .3, -.4, 3, 50, 70), p = new A.Point(17, -5), q = m.Invert().Transform(m.Transform(p));
    assert.ok(Math.abs(q.X - p.X) < 1e-9);
    assert.ok(Math.abs(q.Y - p.Y) < 1e-9);
});
test('Color uses Avalonia ARGB hexadecimal ordering', () => {
    const c = A.Color.Parse('#80402010');
    assert.deepEqual([c.A, c.R, c.G, c.B], [128, 64, 32, 16]);
});
test('Calendar selected date updates the selected-date collection', () => {
    const c = new A.Calendar();
    let changes = 0;
    c.SelectedDatesChanged.Add(() => changes++);
    c.SelectedDate = new Date(2026, 8, 20);
    assert.equal(c.SelectedDates.Count, 1);
    c.SelectedDate = null;
    assert.equal(c.SelectedDates.Count, 0);
    assert.equal(changes, 2);
    c.Dispose();
});
