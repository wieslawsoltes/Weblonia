# Gesture input and the upstream SkiaSharpWeb boundary

## Upstream changes

SkiaSharpWeb PR **#8** was merged as
`0a33427592e788d042ab69eedeb4bd7f29f35564` after its package, native/.NET,
browser, Linux/Windows/macOS Node 22/24, and Blazor net8.0/net10.0 jobs passed.
The connector-observed details are in `SKIASHARPWEB-UPSTREAM.json`.

The recovered release had **103 vendored SkiaSharpWeb files identical to upstream**.
There was no native wrapper/WASM patch to recover. The reusable browser-system-font
raster planner was in the Avalonia adapter. That implementation was extracted into
SkiaSharpWeb's `@wieslawsoltes/skiasharpweb/browser-text` module, including explicit
TypeScript declarations, packaging/installed-consumer checks, and ten unit tests.
The adapter's `text-raster.js` now only re-exports upstream functions. A regression
checks JavaScript function identity and the exact merged Git blob.

The new subpath is **not in the previously published npm 0.5.0**. Consequently the
Skia adapter's dependency is the immutable Git source revision, not a misleading
`0.5.0` dependency. The complete ZIP supplies all necessary local assets and needs
no npm install. Independently installing its npm tarballs requires resolving the
Git dependency, which has not been exercised here; the consumer test uses the
included assets. A future versioned upstream release can replace this Git pin.
No npm/NuGet publication was performed by this continuation.

`npm run verify:vendor` validates every bundled asset and the source lock offline.
`docs/recovery/SkiaSharpWeb-PR8.patch` preserves the text-only upstream delta.
No font binaries or modified native WASM are included in that patch.

### Viewport-proportional text work

`CreateTextRasterPlan(...).Tiles(clip)` jumps directly to tiles intersecting the
viewport. Clip bounds are **device-pixel coordinates relative to the text raster
origin**, not absolute viewport coordinates. The adapter converts its Skia device
clip accordingly, retaining fractional-origin phase. It then keeps the existing
visibility guard for transformed clips. Rotated/sheared text conservatively uses
an unclipped plan and the largest singular value; perspective is explicitly rejected.

The module does not own caches, allocate canvas images, or enumerate/load fonts.
Those remain caller-owned. `TextTilesVisited` counts planned tiles, independently
of `TextRasterizations` and `TextUploads`; a billion-pixel logical line requires
only a few visited tiles for a narrow clip. The pixel suite also tests text drawn
more than 20,000 logical pixels left of the viewport, rather than only leading tiles. Comparisons inspect all four RGBA channels; the letter-spacing cases use colored glyphs, not only grayscale text.

## Gesture contracts

```js
import {
    Border, PinchGestureRecognizer, ScrollGestureRecognizer,
    TransformOperations, ScrollViewer, StackPanel, Button
} from '@wieslawsoltes/avalonia';

const surface = new Border();
surface.ClipToBounds = true;
surface.GestureRecognizers.Add(new PinchGestureRecognizer());
surface.Pinch.Add((_, e) => {
    // Apply the transform to content, not to the recognizer's coordinate space.
    surface.Child.RenderTransform = TransformOperations.Parse(`scale(${e.Scale})`);
    e.Handled = true;
});
surface.PinchEnded.Add(() => { /* Commit accumulated scale/rotation here. */ });

const items = new StackPanel();
for (let i = 0; i < 40; i++) items.Children.Add(new Button(`Item ${i + 1}`));
const viewer = new ScrollViewer(items);
viewer.Height = 240; // A finite viewport; touch scrolling and inertia are installed.
```

```xml
<Border xmlns="https://github.com/avaloniaui">
  <Border.GestureRecognizers>
    <PinchGestureRecognizer />
    <ScrollGestureRecognizer CanVerticallyScroll="True"
                             IsScrollInertiaEnabled="True"
                             ScrollStartDistance="5" />
  </Border.GestureRecognizers>
</Border>
```

A standalone scroll recognizer emits `ScrollGesture` events; the consumer must
apply their `Delta` and set `Handled` when it actually consumes movement. A
`ScrollViewer` does this automatically using its clamped offset. `ShouldEndScrollGesture`
ends a gesture. `ScrollGestureEnded` occurs once per assigned gesture identifier.
`ScrollGestureInertiaStarting` reports pixels/second, not pixels/frame.

The recognizer collection enforces one owner and rejects duplicates/disposed
recognizers. Mutation updates ownership immediately, including inside `BeginUpdate`.
Removing a recognizer cancels its state but does not dispose the reusable object.
Owner detach/dispose and disabled state cancel contacts and scheduled inertia.

### Capture and browser routing

Element capture (`Pointer.Captured`) and gesture capture
(`Pointer.CapturedGestureRecognizer`) are distinct. A winning gesture releases
button capture and raises capture-lost before a release can trigger `Button.Click`.
A two-contact pinch can take over a one-contact scroll. Tunneling handlers can
call `PreventGestureRecognition`; active captured recognizers still receive input.

Browser press/release tracking is per pointer, not a single global pressed target.
Cancel, blur, native capture loss, and tree detach clean up contacts. Browser
`pointerleave` arriving after touch release cannot resurrect a terminated pointer.
The tests exercise actual Chromium PointerEvents dispatched through CDP's touch
emulation, rather than only directly calling recognizer methods. These are software
browser tests, not physical-device qualification.

### Performance and numerical behavior

Velocity tracking keeps at most **20 samples over 100 ms**, uses centered least
squares, ignores time reversal/nonfinite samples, replaces duplicate timestamps,
and discards a stale release velocity. Scroll distance excludes the recognition
dead zone, avoiding a discontinuous jump at activation.

Inertia uses `v(t)=v0*exp(-k*t)` and analytic displacement
`delta=v0*(exp(-k*t0)-exp(-k*t1))/k`, with `k=-log(0.15)/0.25` in inverse seconds.
The final interval is clamped to the 5 pixels/second stop time, giving the same total
displacement at different frame cadences. An optional injected frame clock on the
JavaScript constructor allows deterministic tests; its `Request` callback must be
asynchronous and return an object with `Dispose()`.

Pinch derives scale from contact distance and origin from the initial midpoint.
Coincident contacts establish a baseline on first separation instead of dividing
by zero. Angle deltas are normalized at the 0/360-degree boundary. The surviving
contact retains capture until release or until it participates in another pinch.

## Explicit remaining scope

This is not the entire upstream gesture/input implementation. It does not establish
all platform gesture arbitration rules, overscroll/bounce physics, automatic
mid-gesture nested-scroll handoff, every holding/tap/pull gesture recognizer,
coalesced/predicted event processing, pen-device conventions, or physical touchscreen
and screen-reader qualification. The optional clock and normalized angle deltas
are explicit JavaScript implementation choices, not CLR overload equivalence.

Similarly, the upstream raster planner does not claim full Avalonia text shaping,
font fallback, text options/hinting, native paragraph, or GPU equivalence. The
framework remains a partial port; see `COMPATIBILITY.md`.
