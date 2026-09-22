# Usage and integration

## Start with the delivered application

From the source root, run `npm run build`, then `npm start`. The catalog uses
only the supplied local modules and native assets. Its import map is generated
into `samples/ControlCatalog/index.html` and `dist/index.html`; retain it when
replacing the sample with your own application. The host element must have a
nonzero CSS width and height before attaching a Window.

## Native renderer and application host

```js
import * as A from '@wieslawsoltes/avalonia';
import { ReactiveObject, ReactiveCommand } from '@wieslawsoltes/reactiveweb';

const model = new ReactiveObject({ Name: 'Hello, AvaloniaWeb', Count: 0 });
model.IncrementCommand = ReactiveCommand.Create(() => { model.Count++; });

const platform = await A.SkiaPlatform.Initialize({
    // Resolves from the package import map, independent of the page base path.
    assetBaseUrl: new URL(
        '../vendor/',
        import.meta.resolve('@wieslawsoltes/skiasharpweb/browser')
    ).href
});
const app = new A.Application();
new A.FluentTheme().Install(app);
app.RequestedThemeVariant = 'Light';

const view = A.AvaloniaXamlLoader.Load(`
<StackPanel xmlns="https://github.com/avaloniaui"
            xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
            Spacing="12" Margin="24">
  <TextBox x:Name="NameEditor" Text="{Binding Name, Mode=TwoWay}" />
  <TextBlock Text="{Binding Name}" FontSize="24" />
  <Button Content="Increment" Command="{Binding IncrementCommand}" />
  <TextBlock Text="{Binding Count}" />
</StackPanel>`, { DataContext: model });

const mainWindow = new A.Window();
mainWindow.Content = view;
app.ApplicationLifetime = new A.BrowserApplicationLifetime();
app.ApplicationLifetime.MainWindow = mainWindow;
await mainWindow.Attach(document.getElementById('app'), {
    Platform: platform,
    Backend: 'canvas'
});

// Run when the application host is removed. Do not dispose a shared platform
// while other windows/applications still use its native resources.
function disposeApplication() {
    mainWindow.Dispose();
    model.IncrementCommand.Dispose();
    app.Dispose();
    platform.Dispose();
}
```

`Backend: 'canvas'` selects the native Skia raster surface. `'auto'` delegates
available backend selection to SkiaSharpWeb. This release tests native raster,
not actual WebGL/WebGPU devices. A font-free default text path rasterizes browser
system-font glyphs and composes them with Skia; provide native typefaces explicitly
through `platform.RegisterTypeface(family, bytes)` for the available native path.

`AppBuilder.Configure(ApplicationSubclass).UseBrowser().UseSkia(options)
.UseReactiveUI().StartBrowserAppAsync(element)` is also available. Use its
application lifecycle consistently rather than mixing two independently created
main-window lifetimes.

## Observable properties and two-way binding

```js
const input = new A.TextBox();
input.DataContext = model;
const binding = input.Bind(
    A.TextBox.TextProperty,
    new A.Binding('Name', A.BindingMode.TwoWay)
);
model.Name = 'Updated model';
console.assert(input.Text === 'Updated model');
input.SetCurrentValue(A.TextBox.TextProperty, 'Updated control');
console.assert(model.Name === 'Updated control');
binding.Dispose();
input.Dispose();
```

For explicitly sourced bindings use `new A.Binding({ Path: 'Name', Source: model,
Mode: A.BindingMode.TwoWay })`. The path/mode overload takes a BindingMode value,
not an options object as its second argument. Ordinary JavaScript objects do not
automatically become observable; use ReactiveWeb or the framework object/property
system for changes that must propagate.

Use `SetCurrentValue` for a programmatic change that must preserve an existing
binding, as the interactive controls do internally. A property setter/`SetValue`
assigns a local value and can replace the local binding.

The object model uses exact PascalCase naming: `Children.Add`, `Content`,
`DataContext`, `SetValue`, `GetObservable`, `Measure`, `Arrange`, `InvalidateVisual`
and `Dispose`. JavaScript numbers/classes replace only selected C# abstractions;
matching a name does not supply every generic or overload.

## Compile XAML ahead of time

Create `compile-example.mjs` at the source root:

```js
import './scripts/register-loader.mjs';
import { writeFile } from 'node:fs/promises';
import '@wieslawsoltes/avalonia'; // Register browser/framework XAML types.
import { AvaloniaXamlCompiler } from '@wieslawsoltes/avalonia-markup-xaml';

const result = new AvaloniaXamlCompiler().Compile(`
<Button xmlns="https://github.com/avaloniaui"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        x:Name="ApplyButton" Content="Apply" Click="OnApply" />`, {
    SourceFile: 'Example.axaml'
});
await writeFile('Example.g.js', result.JavaScript);
```

Run `node compile-example.mjs`. Then statically import the generated module:

```js
import { Build } from './Example.g.js';
import { AvaloniaXamlServices } from '@wieslawsoltes/avalonia-markup-xaml';

const codeBehind = {
    OnApply(sender, event) {
        sender.Content = 'Applied';
    }
};
const view = Build(new AvaloniaXamlServices({ DataContext: model, CodeBehind: codeBehind }));
```

Build receives a service object, whereas `compiler.Compile(xaml).Build({...})`
receives an options object. That latter path builds from the transformed runtime
plan; it does not evaluate the emitted JavaScript string. Both are tested. The
catalog uses the statically imported AOT modules for its shell and routes.

`x:Name` populates the scope used by `FindControl(name)`. Register custom classes
with `XamlTypeRegistry.Default.RegisterAssembly(namespaceObject, xmlNamespace)`;
code-behind remains explicit JavaScript. XAML loading does not compile C# partial
classes or load arbitrary .NET assemblies. Trusted type registration is required.

## Native browser windows and dialogs

Call Show directly in a user-activation handler so popup blocking is not
introduced by unrelated awaited work. The call returns a promise because native
surface initialization is asynchronous.

```js
const openButton = new A.Button('Open browser window');
openButton.Click.Add(() => {
    const child = new A.Window();
    child.Title = 'AvaloniaWeb child';
    child.Width = 560;
    child.Height = 360;
    child.Content = new A.TextBlock('Independent browser document and Skia surface');
    child.Show(mainWindow).catch(error => console.error(error));
});

const dialogButton = new A.Button('Open modal dialog');
dialogButton.Click.Add(async () => {
    const dialog = new A.Window();
    dialog.Title = 'Confirm';
    const accept = new A.Button('Accept');
    accept.Click.Add(() => dialog.Close(true));
    dialog.Content = accept;
    try {
        const result = await dialog.ShowDialog(mainWindow);
        console.log('Result:', result);
    } catch (error) {
        console.error('Browser denied opening or initialization failed:', error);
    }
});
```

These are browser windows, not desktop-native OS handles. Dialog ownership
inhibits input to the owner framework, not every OS/browser surface. Browser
permissions and same-origin rules remain in effect.

## Custom drawing

```js
class Swatch extends A.Control {
    MeasureOverride() { return new A.Size(200, 120); }
    Render(context) {
        context.DrawRectangle('#EEEAFB', null, new A.Rect(this.Bounds.Size), 12);
        context.DrawEllipse('#6757D9', new A.Pen('#34276D', 2),
            new A.Rect(45, 20, 110, 80));
    }
}
```

Drawing coordinates are local. Dispose drawing-context push scopes to restore
transforms/clips/opacity. Rendering uses native Skia; unsupported brush/effect
realizations throw rather than silently promising full upstream fidelity.

## Ownership and cleanup

A visual cannot have two visual/logical parents. Remove it from its current
owner before inserting elsewhere. Collections distinguish their own generated
containers from caller-owned controls; navigation code disposes views that will
not be reused. Subscribe with a CompositeDisposable for application-specific
listeners, reactive commands, animations and transient bitmaps. Dispose the
native platform only after the last renderer using it has been disposed.

Do not count JavaScript garbage collection as prompt native WASM-resource
cleanup. Also do not keep destroyed views in debug globals during memory tests.
The diagnostic API returns serializable summaries rather than the control graph.
