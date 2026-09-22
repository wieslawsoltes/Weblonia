# 0.6.2-alpha.1 — fix retained invalidation and ship worker performance

- Recover all 15 previously unpackaged protocol/server/adapter/performance-test files.
- Re-layout all realized TableView cells on pixel, constrained, star and visibility changes without replacing width-only cell bindings.
- Coalesce owner-specific next-frame invalidations for progress drawing; resume after visibility changes and stop idle requests.
- Preserve capture-entry revisions when Render/RenderAfter, children, or resources invalidate during recording.
- Preserve dirty requests raised by custom render-worker drawing callbacks.
- Version server bitmap caches across independent composition changes and final animation frames; preserve snapshot-entry revisions.
- Fall back from unsupported worker RAF clocks with correct timer cancellation.
- Add headless, native-pixel and no-input browser regressions in every execution mode.
- Extend the source-fingerprinted release gate and CI to require invalidation and recovered-performance suites.
- Regenerate every worker graph, static distribution and all 18 npm packages.

# 0.6.1-alpha.1 — fix module-worker startup race

- Install a dependency-free initialize receiver before importing Skia or the UI graph.
- Preserve ownership of transferred canvas/ports through asynchronous module evaluation.
- Export explicit worker entry functions instead of late onmessage side effects.
- Report startup stages and failed imports immediately; terminate failed owners.
- Avoid automatic startup retries and settle disposal while initializing.
- Replace test-only message queues with real module-worker startup regressions.
- Test delayed imports, source/dist/nested paths, auto-backend and failure cleanup.
- Require ordinary HTTP startup of both modes in CI; record local policy blocks honestly.
- Re-resolve standalone application worker imports for their deployment depth; verify both graph manifests.
- Preserve the loading indicator until render-worker startup completes.
- Rebuild worker graphs, sample, local distribution and all 18 library tarballs.

# 0.5.1-alpha.1 — trace-driven performance optimization

- Recover all 11 supplied optimization/test files on the intact 0.5 baseline.
- Cache effective properties, metadata, inheritance inventories and priority winners.
- Preserve attached TableView scalar cell and row identities while recycling.
- Incrementally project browser automation state; retain accessibility nodes and label dependencies.
- Coalesce layout invalidation and animation-frame scheduling without reducing drawing resolution.
- Synchronize masking/read-only changes on an already focused native editor; invalidate masked text metrics.
- Rebuild the offline sample and all 17 npm packages from the combined source.
- Retain the full-port and hardware/accessibility qualification boundaries.

# Changelog

## 0.6.0-alpha.1

- Added `avalonia-rendering`: bounded binary transactions, immutable resource IDs, retained recording, server-only composition and coherent backpressure.
- Added real OffscreenCanvas/Skia render worker and independent UI-worker topology, static ESM graphs and integrity validation.
- Added independent composition clocks, custom module handlers, durable recovery state and generation-safe canvas/renderer restart.
- Added isolated native editing, incremental semantic projection, browser services, registered HTML modules and multiwindow/modal results. Fixed stale native-input echoes under rapid typing.
- Added opt-in compositor wheel scrolling with input acknowledgement and virtualized coverage clamps.
- Retained glyph-ink/fractional-DPI quality; explicit native font-byte synchronization; no transferred native pointers or shared heaps.
- Added protocol/lifecycle regressions, worker catalog and RGBA suites, independent-clock/input tests and topology-specific CPU/submission benchmarks.
- Native vendor bytes unchanged; no full Avalonia/XamlX parity or physical-GPU qualification claim.


## 0.5.0-alpha.1

- Replace painted scroll indicators with a shared RangeBase/TemplatedControl ScrollBar: both axes, proportional thumb, grab-preserving capture, page repeat, seek, reversed direction, keyboard/wheel and range automation.
- Integrate into ScrollViewer, virtual lists/trees/tables and text editors. Preserve deferred offsets, nested clipping/chaining, focus and selection; fix horizontal header arrangement, content-shrink coercion and scrollbar-dependent layout oscillation.
- Reuse attached virtual rows and default scalar text presenters; pool unused rows without retaining the previous item/label. Preserve custom template rebuild/ownership semantics.
- Retain editor and FormattedText layouts, binary-search long documents and visible lines, snap graphemes within the selected line, stop MaxLines formatting early, use stable font baselines, and align 1-DIP carets to actual float32 device transforms.
- Add full mouse-driven scrollbar tests at integer/fractional DPI, RGBA caret/deep-document ink cases, same-script 0.4/0.5 operation benchmarks and source-fingerprinted release evidence gates.
- Keep genuine SkiaSharpWeb native assets and the immutable upstream text-helper revision unchanged. This is not full upstream API/behavioral parity; see docs/COMPATIBILITY.md.


## 0.4.0-alpha.1

- Upstreamed browser-system-font raster planning through SkiaSharpWeb PR #8 and merged after all validation jobs passed. Replaced the adapter duplicate with upstream re-exports; pinned the Git revision until a versioned npm release provides the new export.
- Clipped tile enumeration is proportional to the visible region; preserved fractional-origin and ink-bound rendering, with an additional deep-horizontal-scroll pixel comparison.
- Added gesture collections, pinch/rotation events, scroll recognizers, bounded velocity estimation, analytically integrated inertia, separate gesture capture and XAML construction.
- Integrated touch scrolling into ScrollViewer and replaced the Gestures sample's raw pointer demonstration with interactive pinch/rotate/scroll examples.
- Fixed per-contact browser press tracking and terminated-touch resurrection from delayed pointerleave. Added cancellation, disposal, nested-boundary and multi-contact regressions.
- Added vendor/source-pin verification, upstream patch/provenance records, 26 Node tests and four Chromium CDP touch checks. Full upstream parity remains unestablished.

## 0.3.0-alpha.1 — recovery and text-performance continuation

Recovered the exact mounted 0.2.0-alpha.1 archive and verified all 882 manifest
entries. The subsequently claimed text-performance ZIP was not available; the
new code below is reconstructed work, not a claim to have recovered that ZIP.

Added retained TextBlock/editor/control-label layouts, bounded grapheme and
prefix-measurement caches, binary caret/wrap/ellipsis searches, device-grid text
raster origins, actual glyph-ink bounds, clipped text tiling, reusable solid
native paints, multiple independently owned font faces per family, font/provider
invalidation, and memoized native paragraph descriptors.

Implemented executable CompiledBindingPath/Builder and incremental expressions,
including getter/setter/accessor delegates, rooted paths, observable/Promise
streams, stale-result rejection, method/command delegates, casts, indexers and
runtime/AOT XAML integration. Fixed OneWayToSource initial-target preservation,
accessor-error recovery and explicit source-update regression cases.

Added operation-count/timing comparisons with the untouched recovered baseline,
19 native-Skia/browser-font pixel and redraw tests, and an ordinary HTTP smoke
test which records environment policy blocking rather than treating it as a pass.
Final execution evidence is in artifacts/verification-summary.json. This remains
a partial manual Avalonia/XamlX port; no full upstream parity is claimed.

## 0.2.0-alpha.1 — 2026-09-20

Rebuilt the unpreserved follow-up work from the original 0.1.0-alpha.1 source,
then added and executed new tests. This archive contains actual new code rather
than merely repeating the earlier interrupted implementation report.

Added container queries; native image/visual brushes, snapshots, bitmap caching,
effects and acrylic; a composition scene and expression/keyframe engine; generic/
factory/argument-aware XAML construction and AOT emission; WebGL2/HTML-host browser
adapters; native paragraph layout, rich inline elements, grapheme-safe editing and
TextFormatter contracts; real-cell read-only TableView; and automation peers with
browser accessibility hierarchy and protected password inputs.

Replaced all eight former catalog boundary pages with browser implementations.
Added two standalone packages: avalonia-composition and avalonia-opengl. Existing
packages remain individually packable with updated dependency manifests.

Fixed ownership validation before visual-tree mutation, text deletion at
combining/ZWJ boundaries, native paragraph failure cleanup, custom visual double
disposal, compositor listener cleanup, password accessibility disclosure, and
missing direct browser/media dependency metadata.

Evidence: 196 Node passes; 105 Chromium passes; three explicit unavailable-WebGL
skips; 75 generated/imported XAML modules; 17 packed-package consumer imports.
Full upstream API, template, sample, text/IME, GPU and accessibility parity are
not established; see docs/COMPATIBILITY.md.

## 0.1.0-alpha.1

Initial partial manual JavaScript framework and catalog: 15 packages, 135 Node
passes, 93 browser checks, 66 browser demonstrations and eight boundary pages.
The old release's evidence is not attributed to the new release without reruns.
