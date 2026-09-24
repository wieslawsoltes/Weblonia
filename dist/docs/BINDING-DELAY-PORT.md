# Binding.Delay and source-write lifetime

This increment builds on `ccaa49188645247119d7980af0bb862f56a7dc7d`
(MultiBinding and shared single-binding publication). It ports single-binding
source-update Delay without changing Skia, text shaping, the renderer protocol,
windowing, full-isolation default, or startup compilation sharing.

## Public and XAML contract

`Binding.Delay` is a signed Int32 number of milliseconds, default zero. It is
inherited by the existing ReflectionBindingExtension/CompiledBindingExtension
classes. A positive value debounces target-to-source PropertyChanged updates in
TwoWay and OneWayToSource modes. Each edit restarts the complete quiet period.
Zero and negative values remain synchronous, following the pinned Avalonia
implementation's `Ticks > 0` test. Invalid noninteger/out-of-range/type values
fail before an existing binding is replaced, including nested MultiBinding leaves.

Neither source-to-target publication nor frame scheduling is delayed.
LostFocus, explicit `UpdateSource()`, and initial/replacement OneWayToSource source
owners bypass the wait. Explicit updates cancel pending timer work before running
application code. Both default and explicitly selected PropertyChanged triggers
participate. Timing and trigger settings are captured per expression; changing a
reusable definition affects future attachments, not an existing timer.

Runtime and directly emitted AOT use the same XAML services. Decimal signed
integer literals work in markup extensions and object-element bindings. Static
resource values are resolved per construction before validation, including nested
compiled-binding graphs. Whitespace surrounding a decimal literal is allowed;
hexadecimal/exponential/fractional strings are not Int32 XAML literals. Dynamic
resource bindings on binding options are not added by this change.

```xml
<TextBox Text="{Binding SearchText, Mode=TwoWay, Delay=300}" />
```

```js
const binding = new Binding({ Path: 'SearchText', Mode: BindingMode.TwoWay, Delay: 300 });
const expression = editor.Bind(TextBox.TextProperty, binding);
// An explicit commit flushes synchronously and prevents a second timer write.
expression.UpdateSource();
```

## Scheduling, ownership and reentrancy

A binding allocates at most one DispatcherTimer, lazily on its first delayed
edit. The timer is reused, executes at DispatcherPriority.Normal, and stops before
reading/converting the target value. It is not a per-frame polling loop. There is
no queue of draft strings. Repeated edits replace the deadline rather than retain
one task per edit. DispatcherTimer's generation/abort mechanism rejects expired
but not yet dispatched ticks after retargeting, disposal, replacement or shutdown.

Automatic source writes read the current target, not an event's potentially stale
NewValue. Direct-property targets are supported. An animation-priority value that
masks the binding cannot be copied into the source by an expiring timer. A changed
source owner cancels the obsolete deadline; OneWayToSource immediately writes the
current target into its new owner. TwoWay instead publishes the new source value.
This explicit owner-change cancellation is a safety/efficiency improvement over
leaving an old timer to read back the newly published target.

ConvertBack is an application callback. Source revisions and disposal checks stop
an obsolete expression/terminal from writing after that callback replaces the
binding or changes its source graph. Source changes raised during a reflected
write are drained afterward instead of being discarded. Normalized source values
are read back under the existing forward-publication guard. The compiled engine
retains suffix-only refreshes; source setters are not called for unchanged values
unless an existing validation error needs recovery. DoNothing/UnsetValue survive
boolean negation, and reverse BindingNotification errors do not write fallback
values into the model. Prior display-formatting/null/fallback ordering is preserved.

The lifecycle remains owned by the binding/UI realm. Detaching a live control
without disposing its binding does not invent a new cancellation policy. Browser
background-tab throttling can postpone delivery; Delay is a minimum quiet period,
not a real-time deadline or a synchronous cross-worker operation. Binding options
other than the timing/trigger pair retain their established behavior.

## Executed regressions and required release gates

86 new Node regressions cover both engines, direct targets, source replacement,
queued expiry cancellation, trigger exceptions, Int32 boundaries, sentinels,
reverse validation, runtime/AOT and native pixels. Twelve selected semantic cases
fail against the previous binding implementation and pass after the change.
Stress cases include 1,000 rapid edits sharing one timer, and 1,000 attach/edit/
dispose cycles with no remaining timeout, source, target-lifetime or dispatcher
shutdown observers. They measure bounded work/ownership, not application FPS.

Ten native cases (runtime/AOT at scales 1, 1.25, 1.5, 2 and 3) execute actual
DispatcherTimer writes and compare complete RGBA buffers against analytic geometry
both through direct Skia rendering and binary server replay. The native viewport
excludes editor text; existing text-quality gates remain mandatory unchanged.

`python tests/binding-delay-browser.py` is the new six-case ordinary-HTTP gate.
It verifies immediate source-write suppression, natural timer coalescing, autonomous
presented-pixel changes, explicit flushing, renderer restart, and disposal with a
pending timer. It uses no intercepted assets, input injection, fake clocks or
render/snapshot RPCs to repair the frame. RGBA tolerance remains 2. CI and the
release verifier require all six cases in addition to every prior release gate.

Local execution of all 1,105 Node tests passed with concurrency 4. The unconstrained
local runner did not complete within its 120-second observation budget and is not
counted as a pass. All six local ordinary-HTTP attempts were blocked by Chromium
administrator policy and are also not passes. Remote CI qualification must be
established by its actual reports; local Node/native checks do not substitute.

ControlCatalog DataValidation adds a separate delayed editor, a committed model
preview and a Commit now button; the original immediate validator and nested
MultiBinding preview remain. No font binary is bundled. The separate deferred-
resources PR #7 is not included, changed or superseded by this increment.

This is not complete Avalonia/XamlX parity, a new CLR binding type system, or a
physical-GPU/mobile/Safari/Firefox qualification. No npm version is published by
source generation. Pinned reference paths and blobs are recorded alongside this
file; current execution status belongs to docs/VERIFICATION.json and CI reports.
