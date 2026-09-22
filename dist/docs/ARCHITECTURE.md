# Architecture

## Threaded server architecture (0.6)

`browser main -> UI worker -> direct MessagePort -> composition/render worker` is
implemented alongside `main UI -> render worker` and single-thread execution.
The UI records invalidated drawings; the server owns committed scalar visuals,
resources, animation clocks and native Skia. No live control property reads occur
on the render side. See [THREADING.md](THREADING.md) for the protocol, deployment
examples, lifetime and input/text contracts. The diagram below describes the
logical dependency direction, not a requirement to execute every stage together.


## Dependency direction

```text
              application + JavaScript code-behind + ReactiveWeb model
                                  |
                 XAML -> XamlX XML/AST/transforms -> emitted ES modules
                                  |
                       AvaloniaXamlServices / type registry
                                  |
       properties <-> bindings <-> resources/styles <-> retained controls
                                  |
                    layout -> hit testing -> routed input
                                  |
                 Browser TopLevel / actual Window / text bridge
                                  |
                    SkiaRenderer -> SKDrawingContext
                                  |
                      actual SkiaSharpWeb native WASM
                                  |
              browser canvas / WebGL / WebGPU (capability dependent)
```

The framework object graph is not a DOM tree. A control does not become an HTML
button or CSS grid. Browser DOM is confined to hosts/canvases, native text input,
accessibility mirroring, storage input and actual browser windows. The stock
system-font path uses browser rasterization then native Skia image composition.

`base` is platform-independent and RxJS-backed. `media`, `data`, and `styling`
layer on it. `controls` consumes those abstractions. `skia` realizes drawings;
`browser` hosts controls and translates browser events. The aggregate facade
registers available types for XAML. `reactiveui` bridges ReactiveWeb activation,
view location and scheduling; it does not replace ReactiveWeb with a toy shim.

## Property values and lifetime

Each registered property has identity, owner metadata, default/inheritance
behavior and per-object effective-value entries. Priority follows the inspected
Avalonia names and numeric ordering: Animation (-1), LocalValue (0),
StyleTrigger (1), Template (2), Style (3), Inherited (4), Unset (Int32.MaxValue).
Lower priorities win. Disposal removes only the corresponding owned entry and
reveals the next candidate. Inherited change propagation is prevented by an
object's own higher-precedence value. Property notifications invalidate layout,
rendering and style activation according to the property metadata/control logic.

Observable and expression bindings belong to the target lifetime. Nested path
subscriptions rebuild when an intermediate object changes. A two-way update
writes to the resolved source path while guarding feedback recursion. ReactiveWeb
objects provide the actual observable property source. The implementation does
not claim every Avalonia binding plugin or metadata semantic.

## Retained scene and layout

Controls have parent/child ownership, logical data inheritance, visual children,
local bounds and render transforms. Measure computes DesiredSize under a
constraint; arrange establishes local bounds. LayoutManager processes invalid
layout until stable or a safety budget is exceeded. Root rendering is scheduled
through the browser frame dispatcher, not a continuously spinning loop.

Grid supports absolute/Auto/star tracks and span-aware distribution. Infinite
measure constraints deliberately make star tracks content-sized; allocating
infinity would create NaN bounds or collapse nested scroll/list content. Layout
rounding and complex upstream shared-sizing semantics still need differential
qualification.

Hit testing transforms root coordinates down the visual hierarchy and observes
visibility/clips. Routed events support tunnel/bubble paths and handled-event
policy. Pointer capture routes subsequent moves/up to the capture target. Focus
and keyboard routing share that control graph rather than native HTML focus
being treated as the complete framework focus system.

## Rendering and resource ownership

SkiaPlatform initializes the real vendored SkiaSharpWeb API and supplies surfaces,
paint/path/image conversion and geometry services. SKDrawingContext implements
framework drawing operations with deterministic push/pop state. Paths/text
images use bounded LRU caches. Bitmaps/native handles and cached resources are
released by explicit disposal; JavaScript GC is not relied on to free WASM
allocations promptly. Application hosts must dispose their controls and platform
when unloading the runtime.

The browser backend supports renderer preferences; only native software canvas
was qualified here. The rendering implementation does not fall back to drawing
the entire UI with ordinary Canvas2D. Canvas2D is used for the default glyph image
path and its measurement, which is an explicit text-compatibility boundary.

## Actual browser windows and realms

Window.Show creates an actual browser popup, not a draggable DIV. Each window
has its own browser document, native Skia surface and input bridge. The browser
may deny opening without user activation; this is surfaced as an error. Modal
results are promises; owner framework input is inhibited until the dialog closes.
This is application modality, not unrestricted desktop OS modality.

CanvasKit/SkiasharpWeb initialization uses realm-sensitive DOM type checks. A
canvas created directly in the popup can fail `instanceof` against the initializing
realm. The adapter creates and initializes the canvas in the Skia realm before
adopting it into the popup; fallback-created canvases follow the same rule. This
keeps the vendor library unchanged and is tested with real popup windows.

## XAML compiler

The compiler has distinct parse, transform, resolution and emission stages.
An XML parser produces source-positioned AST nodes and rejects DTD declarations,
invalid entities and malformed structures. Limits bound node counts and depth.
Transformers resolve framework type/member names and build assignments,
collections, resources, bindings, named objects and deferred templates.

The JavaScript emitter produces direct constructors and property operations with
runtime service calls. A generated module exports Build; it can be statically
imported without unsafe-eval. Runtime loading constructs the same supported
object model from the transformed plan. Code-behind names resolve only against
an explicitly supplied JavaScript object. Unknown members/types report errors;
there is no transparent C# or .NET assembly execution.

XamlX upstream separates compilation from backend-specific emission. This port
adopts that architecture and selected names, but is independently implemented
and does not include every upstream AST node, type-system backend or IL emitter.

## Catalog

The shell itself is AOT-compiled XAML. It creates a retained navigation pane,
source editor and page host. A ReactiveWeb model drives search, headings and
status. Debounced search uses actual RxJS. Page navigation disposes prior pages,
bindings and example lifetimes. The manifest records source revision and feature
boundary separately from route presence; rendering an unavailable-feature page
cannot turn its status into implemented.

## 0.2 composition, text and automation extensions

The `composition` package adds a committed object graph above the immediate
Skia drawing interface. UI mutations collect into batches; render snapshots do
not observe subsequent assignments until commit. Keyframes and expressions use
an injectable clock. This is a single-JavaScript-thread execution model, not the
upstream render-server transport. Per-root attachment disposal cancels clocks
and releases the associated scene. Custom handlers have deterministic disposal.

Native text layout is a SkParagraph-backed service selected when all run families
are registered. It creates native run styles and inline placeholders, then uses
native line/cluster information for drawing and hit testing. Ephemeral TextLayout
wrappers retain descriptors, not raw paragraph ownership; a bounded cache can
evict/rebuild a paragraph without leaving dangling native pointers. Font registry
changes invalidate that cache. The system-font fallback is explicitly separate.
TextFormatter wraps the layout service with source/run/line contracts and a
continuation token so wrapping a paragraph does not reshape the same prefix for
every requested line.

TableView creates retained row, header and cell controls. Each cell owns its
binding subscriptions and releases them when recycled. Column collection mutations
are validated before collection state changes. Headers and rows share resolved
column widths. Viewport realization bounds the number of actual cells without
pretending the data model itself is lazily loaded.

ControlAutomationPeer instances are cached per control. Provider actions route
through control behavior and reject disabled/read-only mutations. Table peers
expose current realized cells and can realize a requested offscreen row. Selected
offscreen list items use virtual peers without allocating the entire list.
The browser projects this tree into stable semantic DOM nodes. Native HTML hosts
remain native DOM; password editing uses an actual protected input, not a text
textarea with cosmetic masking. This is browser accessibility integration, not
platform automation or screen-reader certification.

The WebGL adapter owns a separate WebGL2 context. Lifecycle callbacks execute
inside an explicit lease. Its integration path reads RGBA pixels, corrects row
orientation and creates a native Skia image. This costs a copy and is intentionally
not labeled zero-copy compositor or foreign-context texture interop.
