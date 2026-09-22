# Core, XAML services and retained composition continuation

This change extends the JavaScript port from the startup baseline, not a claim
that all of Avalonia or XamlX has been translated. Browser windowing and the
existing SkiaSharpWeb 0.5.1 renderer remain the backends. No native WASM, shader,
font asset, text-antialiasing or device-scale setting is changed.

## Pinned source basis

The reference workflow records exact checked-out commits and hashes of source
files, retaining upstream licensing notices. It is a source reference inventory,
not a deterministic claim of API/behavior parity for every scanned declaration.

- Avalonia: `dff6a87665aa456c37b8cf89647e007f4c3066d7`.
- XamlX: `7ef6aef496ab6e8dcf3df04bef697be49db37c04`.
- Existing merged Weblonia startup baseline: `3e20cecb991d1d37ac6858574a123424ea5d2e6b`.

Primary references:

- https://github.com/AvaloniaUI/Avalonia/tree/dff6a87665aa456c37b8cf89647e007f4c3066d7/src/Avalonia.Base/Threading
- https://github.com/AvaloniaUI/Avalonia/blob/dff6a87665aa456c37b8cf89647e007f4c3066d7/src/Markup/Avalonia.Markup.Xaml/XamlTypes.cs
- https://github.com/AvaloniaUI/Avalonia/tree/dff6a87665aa456c37b8cf89647e007f4c3066d7/src/Avalonia.Base/Media
- https://github.com/AvaloniaUI/Avalonia/tree/dff6a87665aa456c37b8cf89647e007f4c3066d7/src/Avalonia.Base/Rendering/Composition
- https://github.com/kekekeks/XamlX/tree/7ef6aef496ab6e8dcf3df04bef697be49db37c04/src/XamlX

## Dispatcher

`DispatcherPriority` now has the upstream numeric ordering, named immutable
values, FromValue/Validate, comparison and string conversion. `InvokeAsync`
returns an awaitable DispatcherOperation with Pending/Executing/Completed/Aborted
status, Result/GetTask, Completed/Aborted events, Abort and mutable Priority.
Cancellation uses AbortSignal. A pending abort immediately removes its callback
and cancellation subscription; running callbacks are not forcibly interrupted.

An indexed stable heap gives O(log n) insertion, abort and reprioritization while
preserving original FIFO ordering at equal priority. Inactive jobs do not cause
busy-looping. RunJobs explicitly drains; automatic processing yields after its
job/time budget. DisableProcessing leases nest; shutdown aborts queued work.
Post errors follow the dispatcher filter/handled exception pipeline; InvokeAsync
errors reject the operation's task. Thenable results follow JS Promise assimilation
without blocking the dispatcher. Status Completed denotes completion of the
callback invocation, not settlement of a returned asynchronous value.

DispatcherTimer retains at most one native timeout or one pending queued tick.
Stop/restart generations prevent stale tick resurrection. Interval and priority
changes affect queued work; inactive timers release their shutdown subscription.

This is a per-JavaScript-realm dispatcher, not a CLR SynchronizationContext.
CheckAccess refers to that realm. There is no synchronous blocking cross-worker
Invoke or nested browser dispatcher frame: SupportsRunLoops is false and queued
synchronous Invoke explicitly reports unsupported semantics. Same-realm Send
Invoke is executable. Existing code awaiting InvokeAsync remains compatible;
code comparing its return value with `instanceof Promise` must use GetTask.

## XAML / XamlX

Custom synchronous ProvideValue now receives an immutable invocation snapshot
with GetService and actual target object/property, root/intermediate root,
NameScope, BaseUri, type resolution and nearest-first parent enumeration.
Exported Symbol.for service tokens also accept corresponding service names.
Services include IServiceProvider, IProvideValueTarget, IRootObjectProvider,
IUriContext, IXamlTypeResolver and both Avalonia parent-stack contracts.
Registered external services are delegated; explicit falsy values survive.
Plain JavaScript members use a named member adapter, not fictitious CLR reflection.

Runtime and direct AOT share this context. Nested extensions target their own
outer extension instance, object-element extensions see the real destination,
and attached property elements retain their qualified owner. XML base URIs are
lexically scoped; retained service snapshots do not mutate as construction moves
on. Deferred templates distinguish their file root from each fresh template root
and preserve declaration-time namespace/type/URI context.

x:CompileBindings and x:DataType are pre-scanned independently of attribute order,
inherited, and overridable inside templates. A regular Binding uses the compiled
path when enabled; explicit ReflectionBinding remains reflective. Inherited model
prefixes resolve against their declaring namespace, not a shadowing child prefix.
Custom namespace names such as Binding or DataTemplate cannot be hijacked by
built-ins. Failed builds dispose tracked construction ownership once; successful
contexts release temporary arrays. Asynchronous ProvideValue is rejected and its
promise observed; no eval, generated Function or runtime source rewriting is used.
Transformer parent stacks unwind even when nested transformations throw.

This does not implement all upstream XamlX IL emitters, CLR generic/reflection
metadata, every XAML service/directive, or all compiled binding transformations.
Registered JavaScript model schemas and accessors remain the type-checking model.

## Drawings, native state and invalidation

Drawing/GeometryDrawing/ImageDrawing/DrawingGroup/DrawingImage are observable
resources with typed property metadata. DrawingCollection supports shared DAGs,
rejects cycles before mutation and rewires nested invalidation subscriptions on
change rather than on each frame. Borrowed brushes, pens, geometries and drawings
are not disposed by their consumers. Pen and DashStyle mutations propagate;
removed children/collections stop notifying their old owners.

DrawingGroup.Open records a fresh retained tree and atomically replaces Children
on disposal. Abort discards unpublished records. The builder owns records it
creates, retains ownership when an old record is explicitly reused, and borrows
DrawDrawing inputs. Nested transform, opacity, clip, geometry clip, opacity mask
and effect states are retained. Text records own an independent TextLayout,
reusing it until text-service generation or observed brush state changes; this is
not a fabricated native GlyphRun implementation.

DrawingImage respects source cropping, explicit Viewbox and nonzero destinations.
Its coordinate mapping is explicitly `dest + (point - boundsOrigin - sourceOrigin)
* scale`: the destination is not scaled twice. This is a deliberate numerical
correction of the equivalent-looking translate/scale construction in the pinned
reference. Independent native pixel expectations qualify that mapping. Positive
rounded RectangleGeometry radii emit actual elliptical arcs instead of sharp
rectangles. StreamGeometry publishes bounds before synchronous notifications;
native Skia remains authoritative for exact curve/path bounds. Without a native
backend, its recorded-point fallback is not an exact curve-extrema algorithm.

Immediate Skia and worker recording expand DrawingImage into the same primitive
commands. The portable descriptor registry captures immutable resource values;
no new native handle crosses realms. WriteableBitmap.Lock invalidates an old
native upload when released, preventing stale pixels after mutation.

DrawingContextPushedState validates LIFO order without consuming a misplaced
token. Native push failures roll back saves and temporary paints/filters. Mask
pop failures also restore state. Drawing/group/composition cleanup unwinds all
successful earlier pushes even if a later push/pop throws. Success uses the
native save return value, avoiding an extra save-count query per scope.

Specialized full GlyphRun parity, arbitrary GPU composition surfaces, dirty-tile
rendering equivalence, all effect families and all native backend interop are
not asserted. Retained Open rectangle shadows require an explicit effect rather
than silently dropping unsupported shadow arguments.

## Composition values and groups

CompositionPropertySet implements Insert/TryGet for Boolean, Scalar, Color,
Vector2/3/4, Quaternion, Matrix3x2/4x4 with declared type tags and
Succeeded/TypeMismatch/NotFound statuses. Values are copied and finite-validated
before mutation; Quaternion is distinct from Vector4. JavaScript structs are
ordinary value records (existing Vector/Matrix adapters where applicable).
Expression parameters support the same typed setters and ClearAllParameters;
references require a live object from the same compositor. Existing identifier
restrictions remain: arbitrary unsafe property keys are not accepted.

CompositionAnimationGroup is a client CompositionObject with Add, Remove,
RemoveAll and enumeration. StartAnimationGroup accepts a group or targeted single
animation. All members validate/clone before any running state changes and share
one start timestamp. Stopping one component preserves other running components.
Groups themselves are not serialized; the existing immutable animation records
and typed values travel through the established binary scene protocol and execute
against isolated server state. Matrix4x4 value transport does not imply a new
perspective/3D renderer. Implicit animation coverage and other unported compositor
APIs remain separate work.

## Executable qualification

New deterministic suites: dispatcher-parity, xaml-services, drawing-parity and
composition-values. They include 10,000 queued operations and 20,000 adversarial
abort/priority updates; runtime and emitted AOT; actual native Skia RGBA; failed
push/pop rollback; resource mutation/lifetime; and binary server composition.
Core-port-browser exercises services, dispatcher cancellation, DrawingImage
invalidation and typed grouped expressions over ordinary HTTP in all three
production topologies, without replacing worker startup or intercepting assets.
Its analytic RGBA expectations include opacity, and mutations must redraw without
mouse input or an explicit RenderNow call. Installed-package consumers exercise
new public APIs. Full existing catalog/text/scrollbar/worker/startup/invalidation
regressions remain gates. Local HTTP browser policy failure is never a pass; the
remote GitHub runner supplies that browser qualification.
