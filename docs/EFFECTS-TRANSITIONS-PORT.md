# Effects and automatic property transitions

This increment follows the native GlyphRun/PathGeometry and secondary-window
lifecycle port merged in `9bdb9e97beb604af3913072c7af92d064cecd6d6`. It retains the
pinned Avalonia source reference `dff6a87665aa456c37b8cf89647e007f4c3066d7` and the
existing XamlX integration. It is not a declaration of complete framework parity.

## Implemented public contracts

`Animatable` now underlies controls, brushes, transforms and effects. Its nullable
`Transitions` property and inherited `Clock` property use Avalonia's property
store. The base package does not import the animation, media or control packages.
The animation package installs its default clock provider; provider registrations
can be removed in any order without restoring a removed service.

`TransitionBase` has direct-property metadata for `Property`, `Duration`, `Delay`
and `Easing`. `Transition` and its existing Double/Color/Brush/Thickness subclasses
remain available, with `EffectTransition` added. No-argument construction defaults
to zero duration, zero delay and linear easing. The existing JavaScript convenience
constructor `(property, duration = 200)` is retained. Durations use the port's
existing millisecond/TimeSpan-text convention, not nanoseconds or native ticks.

`Apply(owner, clock, from, to)` returns a disposable `TransitionInstance` with a
`Completion` promise. The prior JavaScript `Apply(owner, from, to, signal)` form
remains awaitable. One running transition owns one animation-priority slot, one
clock subscription and one owner-lifetime entry. Completion, cancellation,
disposal, errors and synchronous clock completion release these resources.
Definitions and collections are borrowed, not disposed with controls. Remove a
definition from its enabled owners before disposing it explicitly.

Automatic transitions track the non-animation base value, including local/bound,
style, inherited and default values. A new value retargets from the currently
animated presentation even while the old animation masks the base. Internal
replacement suppresses temporary base-value flashes and duplicate notifications.
The last matching transition in the collection wins. Collection replacement keeps
shared definitions' active instances; removal, detachment and owner disposal stop
them. Controls do not animate during unattached construction. Mutable resources
can animate without being controls. `SetCurrentValue` preserves bindings/base
slots rather than overwriting the active transition slot.

## Effect family

The exported contract tokens `IEffect`, `IMutableEffect`, `IImmutableEffect`,
`IBlurEffect` and `IDropShadowEffect` support JavaScript `instanceof` checks; they
are not constructible CLR interfaces. Concrete classes are:

- `Effect`, `BlurEffect`, `DropShadowEffectBase`, `DropShadowEffect` and
  `DropShadowDirectionEffect`.
- `ImmutableBlurEffect`, `ImmutableDropShadowEffect` and
  `ImmutableDropShadowDirectionEffect`.
- `EffectExtensions`, `EffectConverter` and `EffectTransition`.

Blur defaults to radius 5. Both shadows default to blur 5, black, opacity 1.
Cartesian offsets now default to 3.5355 (the previous port used 0); polar shadow defaults to direction 315 degrees
and depth 5. Cartesian offsets derive from cosine/sine of direction times depth,
using the pinned coordinate convention. Mutable effects invalidate once for each
changed effective property and cache their immutable snapshot until invalidated.
Color structs are copied/frozen at assignment, including bindings and SetValue.
Immutable snapshots and nested colors cannot be changed by later caller mutation.

`Effect.Parse` returns immutable values for `blur(radius)` and
`drop-shadow(x y [radius [color]])`. Runtime and direct-AOT XAML use the same
converter and nullable transition-collection materialization. Input is anchored,
case-sensitive and bounded to 4096 characters. Numeric arguments use whitespace
separation and finite native-representable numbers, including exponent notation.
There is no `px`, effect-chain or arbitrary CSS-filter evaluator. Negative blur
values render as a no-op, while negative parsed shadow radii are rejected.

Immutable `Equals(IEffect)` compares value semantics across mutable/immutable
representations. The property store deliberately does NOT suppress the final
immutable-animation -> mutable-base replacement merely because the pixels are
equal: that notification reconnects the original resource's invalidation events.
Otherwise subsequent changes to the same mutable base would stop redrawing.

### Directional snapshot correction

The pinned upstream `DropShadowDirectionEffect.ToImmutable()` supplies OffsetX/Y
to a constructor whose first two arguments are Direction/ShadowDepth. This port
uses the actual polar arguments instead. The source mismatch and the intended
constructor contract are preserved in `EFFECTS-TRANSITIONS-REFERENCE.json`; we do
not claim to reproduce that upstream defect. Direction uses modulo 360 before
trigonometry for numerical stability at large finite values.

## Interpolation and rendering

Effect transitions interpolate blur radii, shadow coordinates, blur, opacity and
colors. Both polar endpoints interpolate direction/depth; a Cartesian endpoint
selects Cartesian offset interpolation. Effect color interpolation converts sRGB
to linear light, interpolates, converts back, and uses ties-to-even byte rounding.
Null endpoints transition against the corresponding transparent/zero family.
Incompatible families switch at the halfway point. Effect keyframes use the same
family interpolation but keep the existing midpoint fallback for null values.
Endpoint effect snapshots are independent of mutations after a run starts.
This increment does not replace the general Color/Brush animator implementation.

The Skia effect path uses the pinned radius-to-sigma formula, including float32
operation order: `0.288675f * radius + 0.5f` for positive radii and zero otherwise.
This intentionally corrects the prior `radius / 2` approximation, so existing blur
appearance changes toward the pinned native backend. Shadow alpha is clamped and
truncated as the native byte conversion requires. Existing browser/native text
shaping, glyph raster settings, native WASM and SkiaSharpWeb sources are unchanged.

A bounded native filter LRU (default 128, configurable `EffectCacheEntries`, 0 to
disable, maximum 4096) keys the actual native values. A drawing scope pins its
filter through eviction or platform disposal. Zero-radius blur/transparent shadow
are no-ops and allocate no native filter. Repeated unchanged drawing reuses filters
rather than creating/discarding one on every frame. `SkiaPlatform.GetDiagnostics()`
reports EffectCache counts, hits, misses, creations, disposals and active leases.
Native layer failure unwinds filter/paint ownership and canvas state; visual/server
scope stacks unwind earlier transforms/clips when a later effect push fails.

Worker transactions encode immutable validated effect descriptors. They cannot
carry mutable UI objects or native pointers. Unknown fields, malformed channels
and nonfinite/native-overflow values fail before replacing the committed scene.
Composition-object assignments snapshot effect values; explicitly assign a new
snapshot to publish later mutations of an externally held mutable source.
Control and retained-drawing effects instead observe their resource invalidation.

Automatic property/effect transitions tick on the owning UI clock and publish
immutable effect values through the retained renderer. This is NOT a claim that
EffectTransition interpolates autonomously on the compositor worker. Existing
composition keyframes and implicit animations keep their independent server clock.

## Example

```xml
<Border xmlns="https://github.com/avaloniaui" Effect="blur(0)">
  <Border.Transitions>
    <EffectTransition Property="Effect" Duration="0:0:0.6"/>
  </Border.Transitions>
</Border>
```

Assign `border.Effect = Effect.Parse('blur(12)')` after attachment. Subsequent
assignments retarget automatically. A mutable directional effect can independently
have `new Transitions([new DoubleTransition(DropShadowDirectionEffect.DirectionProperty, 650)])`.
The Composition catalog page contains real Blur / shadow, Rotate shadow and Clear
effect controls using these APIs without an extra drawing loop.

## Executable validation and boundaries

`effects-values.test.mjs`, `animatable-transitions.test.mjs` and
`effects-native.test.mjs` cover model/XAML, lifecycle and real native RGBA. They
include 1,000 completed transition lifetimes, 1,000 warm native filter scopes,
LRU eviction while leases remain active, malformed packet rollback and pixel
comparison against independently constructed native filters at five scales.
Existing drawing rollback tests now inject native allocation failure into a valid
effect instead of assigning an unknown object (which is rejected earlier).

`effects-transitions-browser.py` uses ordinary HTTP and unmodified production
worker bootstrap for all six runtime/AOT x single/render-worker/full-isolation
cases. Its deterministic clock controls time, NOT invalidation. It verifies
browser-presented shadow pixels after binding retargeting, immutable completion,
mutable resource updates, scalar resource transitions and null completion, plus
worker restart. No input or renderer/snapshot RPC repairs the mutation frames.
The all-four-channel tolerance stays 2. Local HTTP administrator blocks are not
browser passes; intercepted local diagnostics are labeled separately from CI.
The complete pre-existing release suite remains mandatory.

Remaining boundaries include full CLR type/reflection/dispatcher equivalents,
all XAML transformations and original catalog subexamples, additional composition
surface APIs and arbitrary custom effect/shader pipelines. Reset/Clear is supported
for the JavaScript Transitions list as atomic removal even though the pinned
upstream list rejects Reset. Effect scalars and parser inputs are explicitly
validated more strictly than unvalidated CLR property writes. No physical-GPU,
Safari, Firefox, mobile/IME or universal performance qualification is asserted.
No npm version or upstream Skia release is introduced by this increment.
