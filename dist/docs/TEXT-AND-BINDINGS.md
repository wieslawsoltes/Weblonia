# Retained text and compiled binding integration

## Native and browser-system fonts

Controls retain text layouts across redraws. Changes to text, layout width,
typography, inherited font settings, inline runs, foreground resources or text
service generation invalidate the appropriate owner. Caret-only movement does
not reconstruct the editor's layout. Cache owners dispose retained layouts.

Browser-system fonts are shaped/rasterized by Canvas2D and uploaded to native
Skia in bounded visible tiles. Actual ink metrics include italic left overhang,
right overhang, ascenders and descenders. Text is rasterized at the destination
fractional physical-pixel phase, then composed on that same pixel grid. No DOM
text overlay is used for these controls.

Applications that supply a licensed font byte buffer can use native SkParagraph:

```js
const registration = platform.RegisterTypeface('Application Sans', fontBytes);
const text = new TextBlock('office · سلام');
text.FontFamily = 'Application Sans';
text.FontSize = 20;
// Different faces can be registered under the same case-insensitive family name.
const boldRegistration = platform.RegisterTypeface('Application Sans', boldBytes);
text.FontWeight = 700;
// Each registration has independent ownership. Dispose at application teardown.
registration.Dispose();
boldRegistration.Dispose();
```

Font bytes must be provided by the application. This package contains no fonts and
performs no implicit font downloads. Family registration is not a complete port
of Avalonia FontManager/fallback rules. A descriptor should not be retained and
used after its platform is disposed.

`TextLayoutCache` exposes `GetOrCreate`, `Clear`, `Dispose`, `Count`, `Hits` and
`Misses`. Normal cached layouts are borrowed; do not mutate their descriptors or
dispose them individually. Rich/feature-modified descriptors deliberately bypass
cache reuse, so callers using these uncommon paths should own their disposal.
`TextBlock.GetTextLayout(width)` is the invalidation-aware retained accessor;
`CreateTextLayout(width)` remains the overridable construction hook.

`SkiaPlatform.GetDiagnostics()` reports rasterizations, uploads, measurements,
paragraph builds/key serializations and cache statistics. `GetTextLayoutStatistics()`
and `GetTextBoundaryCacheStatistics()` expose implementation counters without
returning stored text contents. Numeric cache byte estimates are not process heap
measurements or a full memory-leak qualification.

## Incremental compiled paths

```js
import {
  TextBox, BindingMode, BindingOperations,
  CompiledBindingPathBuilder, CompiledBindingExtension,
} from '@wieslawsoltes/avalonia';

const path = new CompiledBindingPathBuilder()
  .Property('Customer')
  .Property({
    Name: 'Name',
    Get: customer => customer.Name,
    Set: (customer, value) => { customer.Name = value; },
  })
  .Build();

const editor = new TextBox();
editor.DataContext = viewModel;
const expression = BindingOperations.Apply(
  editor, TextBox.TextProperty,
  new CompiledBindingExtension(path, BindingMode.TwoWay),
);
```

The source must notify changes through supported property-change observables
(such as ReactiveWeb) or an explicit `Observe(source, changed)` accessor. Getter
and setter delegates alone do not make arbitrary JavaScript objects observable.
An optional accessor factory receives a WeakRef and property metadata and returns
an accessor with `Subscribe(observer)`, optional `Value` and `SetValue`, and
`Dispose`. Accessor notifications accept `OnNext`/`OnError` or `next` for values.

A leaf notification rereads that stage and only invalidates the affected suffix.
It does not detach/recreate every ancestor subscription. Replacing a branch
releases obsolete downstream observers. `expression.Diagnostics` exposes reads,
new subscriptions, rewired nodes and stream emissions.

Observable and Promise paths can use a caret:

```xml
<TextBlock xmlns="https://github.com/avaloniaui"
           Text="{CompiledBinding CurrentCustomer^.Name}" />
```

or explicit builder steps:

```js
const path = new CompiledBindingPathBuilder()
  .Property('CurrentCustomer')
  .StreamObservable()
  .Property('Name')
  .Build();
```

Streams are switched when their source changes; late Promise completions are
ignored after replacement/disposal. Stream errors produce binding validation
errors and fallback values. OneTime detaches after the first actual value.
`Self`, `TemplatedParent`, `ElementName`, logical/visual `Ancestor`, array indexers,
casts, boolean negation, bound methods and command delegates are implemented.

Both runtime XAML loading and generated modules construct these executable paths.
This is not full CLR metadata, every compiled-binding grammar feature, reflection
plugin compatibility or complete XamlX compile-time generic/type-system parity.
