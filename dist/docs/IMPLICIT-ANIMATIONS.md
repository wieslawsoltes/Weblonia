# Implicit composition animations

This continuation implements property-triggered composition animations in the
JavaScript port. It preserves browser windowing, the SkiaSharpWeb native runtime,
full-isolation by default, and the existing bounded binary scene transport.
It is not a claim that the remaining Avalonia or XamlX APIs have all been ported.

## Source basis and JavaScript API

The behavioral references are pinned to Avalonia
`dff6a87665aa456c37b8cf89647e007f4c3066d7`:

- `src/Avalonia.Base/Rendering/Composition/CompositionObject.cs`: the
  `ImplicitAnimations` association and exact-target final-value behavior in groups.
- `src/Avalonia.Base/Rendering/Composition/Animations/ImplicitAnimationCollection.cs`:
  dictionary operations and UWP aliases. Notably `Insert` calls `Add` and rejects
  duplicates; it is not replacement. `GetView` is a snapshot.
- `src/Avalonia.Base/Rendering/Composition/Animations/KeyFrameAnimationInstance.cs`:
  starting/current/final expression values and delay behavior.

The primary source URLs and Git blob identifiers are recorded in the adjacent
reference inventory. Upstream declarations are references, not a statement of
whole-project API/behavior parity.

```js
const visual = ElementComposition.GetElementVisual(control);
const compositor = visual.Compositor;
const motion = compositor.CreateVector3KeyFrameAnimation();
motion.Duration = 650; // JavaScript adapter duration in milliseconds.
motion.Target = 'Offset';
motion.InsertExpressionKeyFrame(1, 'this.FinalValue');
const definitions = compositor.CreateImplicitAnimationCollection();
definitions.Add('Offset', motion);
visual.ImplicitAnimations = definitions;

// Layout changes update the control visual's absolute Offset and trigger motion.
Canvas.SetLeft(control, 240);

// Mapping replacement uses Set or set, not Insert.
definitions.Set('Offset', motion);
// Definitions and caller-created animations have independent ownership.
visual.ImplicitAnimations = null;
visual.StopAllAnimations();
definitions.Dispose();
motion.Dispose();
```

`ImplicitAnimationCollection` derives from `CompositionObject` but is client-only.
Its API includes Count/Size, Keys/Values snapshots, Add/Insert, Set, Get, Lookup,
ContainsKey/HasKey, TryGetValue (`{ Found, Value }`), Remove, Clear, GetView and
iteration. Lowercase get/set/has/delete/clear adapters are provided. JavaScript
bracket assignment is not a CLR dictionary indexer: use Set/set. The read-only
view uses a private copied Map, not a frozen mutable Map.

Collections and groups borrow their definitions. One collection can serve many
objects from the same compositor. Disposing a collection detaches its owners but
does not destroy caller animations or already captured running instances. Changing
or clearing definitions affects future triggers. Keys retain the existing safe
composition-identifier grammar. Foreign/disposed resources are rejected.

## Trigger, transaction and lifetime contracts

Registered composition properties compare typed values rather than object
identity. Equal vectors/colors/matrices do not trigger redundant runs. Public
struct getters are defensive snapshots; committed internal reads remain direct.
Setters validate/copy before mutation. Animation targets must be registered typed
properties or existing declared property-set keys, not methods or private fields.
An initial property-set value must exist before it can be animated.

A changed property looks up its exact trigger key. Single animations and groups
share one timestamp. Every member is validated and cloned before the base value or
existing animations are replaced. Only the group member whose Target exactly
matches the changed property receives its new value as `this.FinalValue`; other
members default FinalValue to their own captured StartingValue. A changed value
without a matching target is still committed normally. Root-vector and component
animations are mutually exclusive; independent components can run together.

The base value is available from the public property immediately, while retained
presentation holds its captured start across commit and the first animation tick.
A subsequent setter replaces presentation for that property, including completed
runs. Stop disconnects the animation and reveals the committed base value. Stopping
one component preserves unrelated active or completed components. Existing
completion stop behavior is preserved; this does not claim every UWP stop-policy
semantic. The existing zero-duration JavaScript behavior is retained.

Private animation clones release their keyframes and parameters on stop,
replacement, completion and disposal. Only bounded per-target identity/presentation
metadata remains while needed for completed-component semantics. Caller definitions
are not disposed. Keyframe values and easing data are snapshotted for each run;
malformed timing, target types and frames fail before installation. Cubic Bezier
endpoint evaluation now returns exactly 0/1, avoiding residual endpoint error.
`this.CurrentValue` is distinct from StartingValue and FinalValue. Both documented
delay policies work on the client and server.

## Independent render-worker state

Every animation instance has a monotonically increasing identity. Time is not an
identity: two triggers in one clock tick must still replace one another. The
binary descriptor carries the instance ID, target type, captured final value and
implicit-start policy. Client-only collections/groups never cross the protocol.
Property-set type tags preserve distinctions such as Quaternion versus Vector4;
this is value transport, not a new 3D renderer or new quaternion keyframe API.

Implicit retargets sample the render worker's actual interrupted presentation at
the trigger timestamp. A stale client readback cannot supply the wrong start.
Preparation does not advance the old live animation; a rejected transaction
releases newly created clones and preserves the committed scene. Reusing an ID
with a different immutable descriptor in the same generation is rejected.

Unrelated commits reuse active instances and their current presentation. Finished
instances retain bounded identity/endpoint metadata, so the still-present client
descriptor cannot restart them or keep the animation clock alive. There is no
unbounded animation history and no per-frame UI setter/render loop.

Authoritative implicit starting values are returned in the existing processed
acknowledgement for updated composition objects, not in every frame notification.
The UI stores them only for the matching instance ID. Renderer restart seeds the
new full snapshot from acknowledged starts; stale acknowledgements cannot rewrite
a successor. As with any interrupted transport, a server decision that was never
acknowledged is not claimed to be durably recoverable.

## Control layout and rendering

`ElementComposition.GetElementVisual` exposes absolute layout Offset and current
Size. Actual arrange changes update both. The existing layout translation is
compensated exactly once when the self-composition transform is applied, both in
control rendering/hit testing and in the isolated server visual. Consequently a
bound Canvas.Left can move layout to its desired destination immediately while the
rendered visual moves smoothly from its old location; it is not translated twice.
Explicit disposal removes layout/disposal subscriptions and the old attachment.

The ControlCatalog Composition page includes reusable implicit Offset/Scale groups,
repeated destination retargeting, and definition clearing alongside the prior
explicit keyframe/expression demonstration. No existing route was removed.

## Qualification

`implicit-animations.test.mjs` and `implicit-server.test.mjs` exercise collection
semantics, defensive copies, atomic failure, current/final values, grouping, timing,
component ownership, runtime/direct-AOT XAML layout, actual native Skia RGBA,
malformed binary input, stale-readback retargeting, completion across unrelated
commits, acknowledged restart recovery and 1,000 sequential trigger lifetimes.

`implicit-animations-browser.py` uses ordinary HTTP and the production worker
bootstrap in single, render-worker and full-isolation modes. A real XAML binding
changes layout. Tests inspect initial, intermediate, retargeted, stable-completed
and cleared-definition browser-presented pixels, with no input injection or
render/snapshot RPC after mounting. RGBA tolerance remains 2. The release verifier
requires this completed evidence at the exact current source fingerprint, plus all
previous browser, text, startup, native, package and invalidation gates. The new
APIs are also exercised from all 18 packed package consumers.

The local administrator-managed Chromium blocks HTTP navigation; this is a local
qualification failure, not a pass. GitHub Actions supplies the ordinary-HTTP gate.
Physical GPU, Safari/Firefox/mobile-device and full original catalog-subexample
parity are separate qualification work. GlyphRun/effect/surface families, broader
XAML directives/binding transformations and the remaining core APIs are not marked
complete by this change.
