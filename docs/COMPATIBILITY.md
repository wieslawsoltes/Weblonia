# 0.6.2 invalidation continuation

Current changes are documented in [INVALIDATION-FIXES.md](INVALIDATION-FIXES.md).
The complete implementation includes the recovered post-0.6.1 performance files.
The known full-port and hardware/IME/accessibility qualification boundaries below
remain. Autonomous invalidation is checked in all three modes; passing this suite
is not exhaustive upstream API/behavioral equivalence.

# Compatibility contract — 0.6.1-alpha.1

## Startup repair

The 0.6.0 asynchronous module-entry race is repaired by accepting initialize
before loading dependencies. Source and distribution application worker imports
are generated separately for their actual directory depth. Executed startup
qualification uses real module workers and the unchanged production graph with
locally intercepted assets; direct HTTP/physical GPU status is stated separately
in VERIFICATION.json. This is a startup/build fix, not a complete parity claim.

## Threaded continuation

The release implements a retained server compositor in a real dedicated render
worker and an optional separate UI worker. A direct channel, bounded transferable
transactions, independent clocks and explicit browser-service projections replace
same-realm painting in those modes. `single` remains available and is the default.
See THREADING.md for exact ownership, memory, callback, text and platform limits.

The full-isolation wheel fast path is explicit opt-in and coverage-bounded. Touch
and general hit testing remain UI-owned, including presentation-time hit-target
ambiguities under speculative/animated transforms. Ordinary callback closures do
not cross realms. Registered custom handlers recover declared WorkerState; transient
messages are not replayed after acknowledgement. UI-worker crash persistence is
application-owned. Both UI and renderer currently initialize native Skia for their
respective synchronous services; this is not a shared-heap or zero-overhead mode.

## Optimized continuation

The optimized continuation adds cache/invalidation, attached-row recycling and
incremental browser accessibility behavior. Direct getters/coercers remain live;
label dependencies, command state, focused editors and subtree changes receive
explicit invalidation. A focused editor switching to password mode immediately
selects the protected native input and clears its inactive plain-text buffer.
No accessibility, resolution or text-quality downgrade is used to reduce work.

## Release scope

This is an executable manual JavaScript port with an expanded catalog and tests.
It is **not a complete translation or behaviorally equivalent replacement for
all of Avalonia or XamlX**. It does not run the .NET Avalonia runtime in WASM.
The native renderer is the actual SkiaSharpWeb distribution. ReactiveWeb and RxJS
are actual vendored dependencies. The new source ZIP contains all implemented
source; it does not contain full upstream Git source checkouts.

PascalCase names identify corresponding contracts. They do not guarantee every
C# overload, enum representation, thread-affinity rule, template part or edge
case. JavaScript-facing overload metadata and convenience extensions are explicit
parts of this port, not CLR metadata compatibility. There is no generated full
TypeScript declaration surface, C# code-behind transpiler, NuGet compatibility,
CommonJS build, or source-derived full upstream member-coverage denominator.

## Subsystem matrix

| Area | Implemented and exercised | Remaining boundary |
| --- | --- | --- |
| Properties | Styled/direct/attached properties, metadata, priorities, inheritance, notifications and lifetime-owned subscriptions. | Full upstream validation/coercion/binding-expression corpus and thread-access semantics. |
| Binding | Nested observed paths; incremental compiled stages/getter/setter/accessor delegates; RxJS/Promise unwrapping with stale rejection; two-way updates, roots, indexers, converters, commands, templates and validation. | Complete upstream grammar, generated CLR type semantics, every accessor/plugin, source-tree change edge case and diagnostic. |
| Styling | Resources/theme dictionaries, classes/pseudoclasses, selectors, setters/control templates; parsed container size queries and observation. | Original Fluent resource/template tree, every selector/query operator and exact upstream precedence edge case. |
| Layout | Grid/stack/dock/wrap/canvas/uniform/relative/flex, measure/arrange, constraints, scrolling and transforms. | All shared-size, rounding, transform and solver edge cases. No exhaustive differential qualification. |
| Controls | Interactive input/range/content/selection/date/color/menu/navigation controls, shared H/V ScrollBar with capture/page repeat/deferred updates, RangeBase finite coercion and TemplatedControl inheritance. | Full public member set, all template parts and original control semantics. |
| Collections | Fixed-height ListBox realization with in-place row/scalar-presenter reuse and bounded pools; TreeView hierarchy; read-only TableView with Binding/CellTemplate, column sizing/ownership, sorting/resizing and bounded real row/cell recycling. | Variable-height virtualization and complete upstream item/container policies. TableView is read-only in the pinned upstream; editable DataGrid behavior is not claimed or conflated with TableView. |
| Text | Native SkParagraph for registered faces, independently owned multi-face families, rich runs/placeholders, cluster bounds/carets; retained browser-font fallback with device-aligned ink tiles, stable font-metric baselines, ink-aware visible-line culling and aligned 1-DIP carets. | Full automatic font matching/fallback, every script/typography case and all Avalonia.TextFormatting contracts. Default system-font rasterization is not the native paragraph path. |
| TextFormatter | TextSource/TextRun/paragraph properties, continuation/cache, TextLine and CharacterHit, collapse/justification, source-index-preserving CRLF and cluster navigation. | Exact black-pixel extent/overhang metrics, all collapse/justification strategies, full text-run cache/fallback semantics and every bidi range detail. Some metrics are approximations. |
| Editing | Grapheme-safe deletion/truncation, retained multiline editor layouts, two-axis viewport/caret scrolling, selection/caret mapping, protected password bridge, synthetic IME commit/undo grouping. | Physical IME, mobile keyboards, all clipboard/word-navigation and script-specific editing conventions. Password content intentionally is not returned by automation Value. |
| Rendering | Native geometry/Boolean paths/images/gradients, ImageBrush/VisualBrush, blur/shadows, visual snapshots/bitmap caches and in-canvas acrylic. | All brush/effect/native drawing overloads, complex composition interop and physical GPU qualification. Acrylic samples only the canvas, not desktop/OS content. |
| Animation/composition | Actual dedicated server compositor/render worker; optional separate UI worker; retained records, typed resource transport, coherent commits, independent clocks, keyframes/expressions, module-based custom handlers, restart and drawing surfaces. | Complete original Avalonia server internals/expression APIs, OS thread identity, shared heaps, GPU-fence/presentation semantics, zero-copy external textures and hardware qualification. |
| Browser windows | Actual secondary windows, per-window Skia surface, owner inhibition and modal result promises. | Browser popup/permission restrictions remain; native OS modality, z-order, chrome and unrestricted placement are not provided. |
| Native hosting | Real HTMLElement handles with transforms, clipping, input/focus coordination and disposal. | HWND/NSView/native desktop controls cannot be hosted by this adapter. Browser-native hosting is the explicit platform substitution. |
| OpenGL | WebGL2 callback lifecycle, scoped leases with selected-state restoration, loss/restoration handlers and RGBA transfer to Skia. | Browser GL execution could not be qualified here. No desktop GL pointers, every-state restoration promise, cross-context native texture import or zero-copy transfer. |
| Input | Pointer/gesture capture, per-contact browser routing, pinch/rotation, scroll thresholds, bounded velocity/inertia, detach/cancel/disabled cleanup, keyboard focus and text bridge. | Full platform arbitration, mid-gesture scroll chaining/overscroll, other recognizer families, KeyBinding/access keys, coalesced input and physical-device qualification. |
| Accessibility | Cached/control-specific peers, invoke/toggle/value/range/selection/scroll/expand/grid providers, bounded realized-tree projection, password privacy and Chromium AX-tree checks. | Complete upstream peer/provider surface, platform automation integration and actual screen-reader/accessibility certification. Browser peer bounds are clipped client-space DIPs, not OS physical-screen coordinates. |
| XAML | XML/AST/transforms, diagnostics, type registry, names/content/properties/events/resources/bindings/templates, runtime/AOT builders; explicit constructor/factory overloads, generics, arguments and typed arrays. | Complete XamlX AST/type/member/overload behavior, arbitrary .NET assemblies, CLR generics/type metadata, IL/Cecil/Reflection.Emit and exact source-map diagnostics. |
| Services | Browser clipboard, storage, screens and settings adapters where supported. | Universal permissions/API availability and desktop interoperability. |

## Catalog interpretation

All **74 routes** in the pinned page list are represented. All now have browser
implementations, including the eight previously missing demonstrations. The
three GL routes report unavailable capability rather than pretending a triangle
rendered when WebGL2 cannot be created. Their rendering/lifecycle tests skip in
this environment. Route construction is not GL feature qualification.

`OriginalSubexamplesPorted` remains `false` on every manifest entry: the original
XAML/C# pages have not been translated losslessly. The AdornerLayer example is a
retained overlay, Gestures exercises pinch/rotate/scroll rather than every upstream
recognizer and subexample, Accelerator uses local key handling, Calendar demonstrates
single-date selection, and Theme Variants uses a Fluent-style subset.

## Evidence and unresolved full-port work

The current source-fingerprinted results are in `VERIFICATION.json`. The final gate
requires zero Node failures/skips, a full 74-route Chromium run, actual scrollbar
interaction at two DPI scales, RGBA text/caret comparisons, and all 17 extracted
package consumers. These are regression results, not a compatibility percentage.
Native text cases read an existing local font in place. No font binaries are included.

Not executed: upstream Avalonia/XamlX test suites, a .NET-to-JavaScript differential
harness, full original theme/catalog construction, successful ordinary HTTP browser navigation,
public npm installation, physical GPU runs, Safari/Firefox/mobile, physical IMEs,
actual screen readers, broad fuzzing or a security penetration test.

Full-port completion would require the remaining API/member implementations and
behavioral tests, original themes/templates and sample code-behind, fuller text,
input/gestures, compositor/interop and automation behavior, and qualified browser/
platform adaptations. None is declared completed merely because a similarly
named export exists. `api-inventory.json` inventories this implementation only.


## Additional text/performance qualifications

Positive axis-aligned scales are covered by actual pixel comparisons at 1, 1.25,
1.5, 2 and 3, plus a nonuniform 1.25/1.75 transform. Browser raster text is compared
against the same browser's direct Canvas2D shaping, not against .NET Avalonia or
native SkParagraph. Rotation/shear uses a conservative largest-singular-value
raster scale; perspective/reflections are not pixel-qualified.

Font hinting, LCD subpixel antialiasing, all OpenType-feature controls, complete
font fallback and every script's caret/line-breaking behavior are not established.
Fallback wrapping and caret lookup assume monotonic advances when spacing is
nonnegative; they do not replace a complete Unicode shaping/line-breaking engine.
Negative spacing uses the existing linear path. Rich/feature-modified descriptors
avoid shape reuse unless their owning control can invalidate them safely.

Caches are bounded by entry counts and documented estimated sizes, not an exact
upper bound on the browser or WASM process heap. A raster tile fits the selected
text-image cache budget; extremely long text can still consume CPU for shaping,
keys and tile enumeration. No long-duration heap stability or physical GPU
performance claim follows from the microbenchmarks. See PERFORMANCE.md.

## SkiaSharpWeb source boundary

PR #8 is merged as `0a33427592e788d042ab69eedeb4bd7f29f35564`.
The adapter consumes the exact upstream `browser-text` module; native WASM is unchanged.
The new export is not present in previously published npm 0.5.0, so the package
manifest uses an immutable Git dependency and the source ZIP supplies local assets.
No public-registry/Git dependency installation was executed; the package-consumer
suite uses bundled dependencies. See `GESTURES-AND-UPSTREAM.md` for the coordinate,
ownership, threading, text and gesture constraints.

## Scrollbar and virtualization qualifications (0.5)

Shared ScrollBar controls are tested in ScrollViewer, ListBox, TreeView, TableView
and TextBox. Browser wheel distances follow delivered CSS-pixel delta units;
physical touchpads and operating-system acceleration are not certified. Timing
properties are numeric milliseconds, not .NET TimeSpan. The scrollbar is template
capable, but the complete original Fluent PART_Thumb/line-button template contract,
context menus and every upstream ScrollBar API are not claimed implemented.
Virtualization still assumes fixed row heights. TableView remains read-only.

The browser-font fallback is not a full Unicode bidi caret/selection engine.
Caret placement uses prefix advances and line-local grapheme boundaries; native
SkParagraph is a distinct path for registered font faces. Full directional-run
selection affinity, all Unicode line breaking, font fallback, every feature and
physical IME convention remain incomplete. Native/rich layout paths are not
promised the same visible-line raster culling as the simple browser-font path.
