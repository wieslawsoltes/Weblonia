# Threaded execution — 0.6.1-alpha.1

## Implemented execution modes

The ControlCatalog accepts `?threading=single`, `?threading=render-worker`, and
`?threading=full-isolation`. Add `&backend=canvas` for a deterministic native Skia
raster comparison; `auto` probes WebGPU, WebGL and raster inside the render worker.
The default remains `single` for existing applications and unsupported browsers.
An explicitly requested threaded mode fails clearly if workers/OffscreenCanvas
are unavailable; it does not silently claim that single-thread rendering is threaded.

| Mode | Browser main | Dedicated worker 1 | Dedicated worker 2 |
|---|---|---|---|
| single | Browser services, UI, native Skia | — | — |
| render-worker | Browser services, controls, bindings, layout, recording | Server composition and native Skia | — |
| full-isolation | Thin DOM/input/accessibility/window host | Controls, RxJS/ReactiveWeb, layout, recording | Server composition and native Skia |

Composition and Skia stay together. There is no extra mandatory compositor-to-GPU
worker hop. Browser-internal threads are independent of this application topology.
The UI and rendering workers communicate through a direct MessagePort; the browser
host does not forward scene packets. No SharedArrayBuffer/COOP/COEP is required.

## Two-thread integration

Keep ordinary application construction on the document's UI thread:

```js
import { Window, TextBlock, BrowserThreadingMode, SkiaPlatform }
  from '@wieslawsoltes/avalonia';

const platform = await SkiaPlatform.Initialize({ assetBaseUrl: '/vendor/skiasharpweb/dist/vendor/' });
const root = new Window();
root.Content = new TextBlock('Retained rendering on a dedicated worker');
await root.Attach(document.getElementById('app'), {
  Platform: platform,
  ThreadingMode: BrowserThreadingMode.RenderWorker,
  Backend: 'auto'
});
await root.RenderNow(); // Complete native submission, not physical presentation.
const diagnostics = await root.Renderer.GetDiagnosticsAsync();
const bytes = await root.CapturePngAsync();
```

Supply deployment-specific asset paths. `GetBrowserWorkerUrls()` resolves the
packaged static worker entries relative to the browser package. `WorkerUrls`,
`RenderWorkerUrl`, `LoaderUrl` and `AssetBaseUrl` provide explicit override points.

## Three-thread integration

The browser entry creates only the platform host:

```js
import { StartWorkerApplicationAsync } from '@wieslawsoltes/avalonia-browser';
const host = await StartWorkerApplicationAsync(document.getElementById('app'), {
  ApplicationModule: new URL('./app.ui.js', import.meta.url).href,
  Backend: 'auto',
  ApplicationOptions: { Greeting: 'Isolated UI and rendering' }
});
await host.InvokeAsync('SetGreeting', 'Still responsive during UI work');
const diagnostics = await host.GetDiagnosticsAsync();
const png = await host.CapturePngAsync();
// await host.RestartRendererAsync();
// await host.DisposeAsync();
```

`app.ui.js` is a worker-safe module. It must use imports resolvable within the
worker; the document import map is not a worker resolver. For the delivered static
distribution the following explicit graph import works when `app.ui.js` is placed
at the deployment root:

```js
import { TextBlock, StackPanel, ReactiveUI }
  from './packages/browser/worker-assets/packages/avalonia/src/index.js';

export function CreateWorkerApplication({ CreateTopLevel, Options }) {
  ReactiveUI.UseReactiveUI();
  const root = CreateTopLevel();
  const panel = new StackPanel();
  const label = new TextBlock(Options.Greeting);
  panel.Children.Add(label);
  root.Content = panel;
  return {
    Root: root,
    Commands: {
      async SetGreeting(value) {
        label.Text = String(value);
        await root.RenderNow();
      }
    },
    Dispose() { root.Dispose(); }
  };
}
```

The factory receives `{Platform, Options, Snapshot, Host, CreateTopLevel}` and
returns `{Root}` or `{View}`, optional `Start(root)`, registered `Commands` and
`Dispose`. Arbitrary functions, controls or native handles cannot be transferred.
UI-owned commands run in their owning realm. The facade and XAML type registry,
ReactiveWeb and RxJS are the actual JavaScript implementations in both UI modes.

## Retained scene and transaction contract

`Control.Render` and `RenderAfter` record portable drawing operations on content
invalidation. Position changes update transforms instead of recording the same
text and geometry again. Clean scene branches and immutable resources are reused.
The server keeps decoded drawing arguments and native resources between frames;
it never calls `GetValue` on a control tree.

Transactions have protocol version, sequence, acknowledged base, canvas generation,
font generation and input acknowledgement. Each contains create/update/remove sets
for visual, composition and resource tables. A packet is bounded to 64 MiB; object
nesting, item counts, scene depth, IDs, graph references and drawing-stack balance
are validated. Materialization completes before the scene is switched. Unknown
native objects/functions are rejected rather than serialized as empty objects.
Trusted custom callback side effects cannot be transactionally rolled back.

There is at most one in-flight composition packet. Pending changes are coalesced
against acknowledged state; dependency-bearing deltas are never arbitrarily
skipped. Transferable buffers return to a byte-bounded pool (16 MiB default, eight
buffers, at most 8 MiB per retained buffer). Decoded byte resources have separate
ownership, so a returned packet can be safely reused. Resource disposal follows
committed replacement. GPU work is owned by one native runtime; no native pointer
or live Skia object crosses a worker boundary.

UI/render control requests are bounded, have timeouts, and reject on shutdown.
Default render RPC/submission queues allow 128 outstanding requests. Pre-capture
commit requests share a completion promise. A custom visual has at most 1,024
unacknowledged messages; acknowledged messages are retired. The independent render
clock uses one queued frame and one credited readback notification, not an unbounded
queue while the UI is blocked. Idle/hidden targets sleep. An explicit hidden flush
is allowed to submit once without starting an idle spin loop.

`Compositor.RequestCommitAsync()` resolves after server application. `RenderNow()`
and `FlushAsync()` wait for native submission of committed state, not GPU completion
or a physical display timestamp. Screenshots explicitly await the snapshot operation.
Frame and transaction readback carry the corresponding generation/sequence.

## Animations, custom visuals and recovery

Keyframes, supported easing functions and parsed expressions are recreated in the
server realm with an absolute clock origin. Committed animations continue without
UI callbacks. Readback updates the UI's composition values without transferring
native objects. Ordinary custom drawing handlers record on the UI when invalidated.
A render-side handler must be an explicitly registered module/export:

```js
// During host initialization:
// HandlerModules: [new URL('./my-render-handler.js', import.meta.url).href]

handler.WorkerModule = handlerModuleUrl;
handler.WorkerExport = 'default';
handler.WorkerState = { Color: '#4361ee' }; // Durable state for restart.
const visual = root.Compositor.CreateCustomVisual(handler);
visual.Size = { X: 240, Y: 120 };
visual.SendHandlerMessage({ Start: true }); // Transient, acknowledged once.
await root.Compositor.RequestCommitAsync();
```

The registered module class may implement `OnStateChanged`, `OnMessage`,
`OnAnimationFrameUpdate`, `OnRender`, `OnDispose`, and optional diagnostics. The
server supplies `EffectiveSize`, `Invalidate`, and `RegisterForNextAnimationFrameUpdate`.
Use worker-resolvable imports in that module. `WorkerState` must hold any durable
state needed to recover; acknowledged transient messages are intentionally not
replayed. Captured UI/DOM closures are not render-worker callbacks.

Renderer restart rejects interrupted operations, replaces the transferred canvas,
advances its generation, recreates the native runtime and rebuilds retained state.
DOM editors, semantic nodes, native hosts and UI controls remain owned by their
original host/UI. Device-loss/worker-error handlers request bounded automatic
recovery; hardware device-loss qualification is not established. Explicit restart
is exercised for full isolation. A crashed UI worker does not have automatic model
persistence/replay; restore application state using application-level persistence.

## Input, scrolling, native hosting and windows

In full isolation, document input is sent in bounded sequenced batches. Adjacent
moves from the same pointer may coalesce; presses/releases are not dropped. The
UI owns routed events, focus, selection, commands, text editing and layout. Native
text entry remains a real browser textarea/password input with IME/preedit events,
selection, caret anchoring and stale-echo rejection. Synthetic input is tested;
physical IMEs, every clipboard/undo timing pattern and mobile keyboards are not.

`IsCompositorScrollingEnabled = true` opts a scroll region into the wheel fast path.
The main host sends the same input sequence directly to the renderer and UI. The
renderer changes committed scroll transforms and scrollbar thumbs while the UI is
busy, then reconciles against acknowledged authoritative offsets exactly once.
Virtualized rows are limited to committed overscan coverage to avoid blank content.
Animated/rotated/native-host/editor/deferred-scroll regions do not enter this path.

This path accelerates wheel scrolling, not all arbitrary routed/touch input.
Pinch/touch recognition and click hit testing remain UI-owned. Full presentation-time
hit testing under speculative/animated transforms is not implemented. Leave the opt-in
off for applications that require custom wheel cancellation or strict snapshot-based
hit targeting. Two-thread mode cannot receive new DOM events while its main/UI thread
is blocked; the three-thread host can. Existing committed render animations remain
independent in either threaded mode.

A `NativeControlHost` in the UI worker declares a registered `WorkerModule` and
`WorkerState`. Host modules return `{Element, Update, Dispose}` and receive
`{Document, Container, Send}`. Only state/messages cross threads. Sequenced native
messages prevent stale model echoes from overwriting rapid local typing. Disabled
wrappers are inert; geometry/clipping/focus are projected explicitly. The sample
`native-demo.js` is the complete bidirectional implementation.

`Window.Show` creates a real browser window with the same UI worker and its own
render worker/canvas. `ShowDialog` inhibits the owner and resolves its result on
close. The browser host may ask for an actual Continue click when a delayed worker
request no longer has transient user activation. Browser permission/popup limitations
remain. Clipboard/file/fullscreen operations use explicit browser-owned services;
OS-native unrestricted modality, pointers and child HWND/NSView hosting are not provided.

## Text quality and memory

Synchronous UI layout retains its measurement contract. Registered native font
bytes have independent UI/render handles; native paragraph reconstruction checks
line metrics before use. Browser-system-font layouts transfer authoritative line
breaks, baseline/ink metrics and typography; device-scale/phase-aware rasterization
happens on the render side. Document CSS-connected fonts are not automatically
installed in workers. Register native fonts through `SkiaPlatform.RegisterTypeface`
for the synchronized, tested path; a custom browser FontFace deployment needs explicit
registration in each participating realm.

The current UI layer initializes native Skia for synchronous geometry and font
services, even when it does not paint the presentation surface. Therefore either
threaded topology uses **two native WASM heaps** for one window, not a shared heap.
The executed environment showed a 128 MiB render heap (plus a UI-side heap), before
all JS/text/bitmap caches. No claim of zero-copy shared native resources or zero
memory overhead is made. Multiwindow adds a render heap per child. Refactoring the
UI's synchronous native services into a smaller runtime is separate work.

Existing glyph-ink bounds, fractional placement, line culling, caret alignment and
bounded text caches remain enabled. The same pixel dimensions and native Skia renderer
are used for comparisons; no quality downgrade is substituted for threading.

## Deployment, build and verification

`npm run build` creates static ESM worker graphs and the complete application. The
worker package contains the generated graph and a SHA-256 manifest; native WASM is
referenced through the explicit asset URL, not duplicated inside that graph.
`npm run verify:workers` checks all graph bytes and the source fingerprint.

Serve modules with a JavaScript MIME type and WASM with `application/wasm`. Serve
assets from the same origin or configure intentional CORS/CSP. A usual native-WASM
policy needs permitted module/worker sources and WASM compilation (for example
`script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'`, adjusted
for the application's actual resources). There is no JS `eval` or `new Function`.
The source's inline import map needs its own CSP nonce/hash in a hardened deployment.

The local execution environment blocks ordinary HTTP Chromium navigation.
Worker tests use local asset interception and real module workers. Their
entire data-URL entry is one static import of the unmodified production entry;
there is no test message queue or initialize replay. Ordinary canonical-URL HTTP
startup is tested separately and required by CI. These tests do not qualify
physical WebGPU devices, hardware IMEs, screen readers, Safari or Firefox.

Run the complete commands in `docs/TESTING.md`. Each final report records source
fingerprints at start/end. The release gate rejects interrupted, stale or mismatched
evidence. CPU timing reports separate UI work, native rendering, transport and
submission latency; they are not hardware frame-rate guarantees. Worker queues can
increase serial submission latency even while greatly reducing main/UI blocking.

### Primary standards consulted

- WHATWG HTML, animation frames and transferable canvas:
  `https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html`
- W3C CSS Font Loading, worker font sources:
  `https://drafts.csswg.org/css-font-loading/#font-face-source`
- GPU for the Web, worker GPU interface:
  `https://gpuweb.github.io/types/interfaces/WorkerNavigator.html`

These support platform design choices; executable qualification is recorded in
`artifacts/threading/`, not inferred from browser API availability alone.


## Module startup fix (0.6.1)

The 0.6.0 worker entries statically imported an asynchronous Skia dependency graph.
`font-instance.js` performs top-level WebAssembly initialization. A worker can
process its first `initialize` event while that graph is suspended, before the
late `self.onmessage` assignment; the transferred objects are then lost to the
application. The former classic test wrapper queued that event and accidentally
hid the production bug.

The new generated `render.js` and `ui.js` have no static imports or top-level
await. Each immediately installs `InstallWorkerBootstrap`. After receiving
the original canvas/ports it dynamically imports the implementation and invokes
`StartRenderWorker` or `StartUiWorker` exactly once. No timeout extension, repeated
canvas transfer, polling or application message replay is used.

Hosts retain bounded `Startup` status (graph, loader, WASM, backend probe,
application module, ready). Import failures report their cause instead of
waiting for a generic timeout. Terminal startup errors close workers and channels.
Native vendor bytes are unchanged.

`npm run test:worker-startup` uses real module workers that statically import
the unmodified production entry from a data-URL wrapper with no queue/replay.
It tests source, dist and nested paths, delayed async graph evaluation, backend
fallback, nonblank frames, restart and failure cleanup. Assets are intercepted
only to accommodate the execution environment. `npm run test:http-workers`
separately runs actual HTTP servers and canonical Worker URLs without request
interception. A policy block is recorded (exit 2), never an HTTP pass; CI requires
this check to succeed. Consult the current report for executed qualifications.
