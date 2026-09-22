import test from 'node:test';
import assert from 'node:assert/strict';
import { StackPanel, Border, TextBlock, AvaloniaXamlLoader, Size, Rect, Container, ContainerSizing, ContainerQuery, StyleQuery, Style, Setter } from '@wieslawsoltes/avalonia';

test('container query grammar validates full input, axes, and Boolean precedence', () => {
    const q = StyleQuery.Parse('(min-width: 200) and (height <= 300 or orientation: landscape)');
    assert.equal(q.RequiredAxes, 3);
    assert.equal(q.Match(new Size(400, 500)), false);
    assert.equal(q.Match(new Size(400, 200)), true);
    assert.equal(StyleQuery.Parse('not (width < 100)').Match(new Size(150, 5)), true);
    assert.equal(StyleQuery.Parse('min-aspect-ratio: 16/9').Match(new Size(1920, 1080)), true);
    for (const invalid of ['width: garbage', 'width: 200 garbage', 'bad: 10', 'aspect-ratio: 1/0', '(width:20', 'width: 10; evil()']) assert.throws(() => StyleQuery.Parse(invalid));
});

test('ancestor resize applies and removes query setters without replacing local values', () => {
    const parent = new Border(), text = new TextBlock(); parent.Child = text;
    Container.SetName(parent, 'Host'); Container.SetSizing(parent, ContainerSizing.Width);
    const query = new ContainerQuery('min-width: 300', 'Host'), style = new Style('TextBlock');
    style.Setters.Add(new Setter('FontSize', 32)); query.Children.Add(style); parent.Styles.Add(query);
    parent.Measure(new Size(400, 100)); parent.Arrange(new Rect(0, 0, 400, 100)); text.ApplyStyling();
    assert.equal(text.FontSize, 32);
    parent.Measure(new Size(200, 100)); parent.Arrange(new Rect(0, 0, 200, 100)); text.ApplyStyling();
    assert.notEqual(text.FontSize, 32);
    text.FontSize = 17; parent.Measure(new Size(500, 100)); parent.Arrange(new Rect(0, 0, 500, 100)); text.ApplyStyling();
    assert.equal(text.FontSize, 17); parent.Dispose();
});

test('XAML Container attached properties and conditional children instantiate', () => {
    const view = AvaloniaXamlLoader.Load(`<Border xmlns="https://github.com/avaloniaui" Container.Name="Host" Container.Sizing="Width"><Border.Styles><ContainerQuery Name="Host" Query="min-width: 300"><Style Selector="TextBlock"><Setter Property="FontSize" Value="29"/></Style></ContainerQuery></Border.Styles><TextBlock Text="Responsive"/></Border>`);
    view.Measure(new Size(600,100)); view.Arrange(new Rect(0,0,600,100)); view.Child.ApplyStyling();
    assert.equal(view.Child.FontSize,29); view.Dispose();
});
