# Threaded performance — 0.6.0-alpha.1

The current executed comparison is
`artifacts/threading/performance-results.json`. It runs the same source, viewport,
DPR and genuine native Skia raster backend in single, render-worker and
full-isolation modes. The CPU and transport optimizations from 0.5.1 remain.

UI CPU timings explicitly exclude the await for render submission. Serial
submission latency is reported separately and may increase after moving rendering
to a worker. This is not a hardware-WebGPU FPS comparison. Worker animations are
independently tested during an actual stalled UI; that demonstrates concurrency,
not a claim that rendering is free.

The unchanged-repaint workloads require zero new content records and zero new
composition transactions after warm-up. Transfer buffers and outstanding requests
are bounded; native resources stay on the render side. The UI still initializes
a native heap for synchronous geometry/text services, so a threaded window has
more native memory than single-thread execution. See THREADING.md for the exact
ownership and scrolling/qualification boundaries.

The release verification embeds current samples and source fingerprint. Older
benchmarks below preserve their original baseline identities.

## Historical trace-optimization release

# Optimized continuation — 0.5.1-alpha.1

The historical 0.5.1 trace workload reports are in
`artifacts/validation-optimized/browser-performance.json` and
`artifacts/validation-optimized/browser-baseline.json`. The final comparison and
three independent canvas pixel checks are recorded in
`artifacts/validation-optimized/performance-comparison.json`.
Instrumentation and timings use separate runs; these native Skia raster timings
are local CPU measurements, not hardware-GPU frame-rate promises.

The earlier interrupted-session results in
`artifacts/history/performance-session/` are historical only.

## Historical 0.5 scrolling/text benchmark

# Scrolling and text performance — 0.5.0-alpha.1

## Method and evidence

The untouched, hash-verified 0.4.0 baseline and this continuation execute the same
`scripts/benchmark-scrolling.mjs` using each checkout's ESM loader in separate
Node processes. A fixed-width counting text provider isolates JavaScript layout,
caret, realization and ordering work. Each case warms up, then records three
samples. These are **not native shaping, browser frame-rate or GPU benchmarks**.

Raw samples: `artifacts/validation-0.5/benchmark-baseline.json` and
`artifacts/validation-0.5/benchmark-current.json`. The machine-readable comparison
also records the benchmark script's SHA-256. Local timings vary with scheduling,
JIT and contention; work/allocation counts are the more useful invariant.

| Workload | Baseline median | Continuation median |
| --- | ---: | ---: |
| 5000 unchanged TextBox measure invalidations | 77.832 ms | 56.352 ms |
| 5000 paired FormattedText width/height reads | 18.143 ms | 2.714 ms |
| 20 caret placements in a 10000-line document | 4511.277 ms | 0.227 ms |
| 150 disjoint ListBox viewport jumps across 10000 items | 1515.161 ms | 142.012 ms |
| 5000 unchanged visual ordering queries on 100 children | 1463.502 ms | 145.800 ms |

## Removed work

5,000 repeated unchanged TextBox measurements produce zero new layouts and zero
text measurements after warm-up, instead of 5,000 each. 5,000 paired FormattedText
Width/Height reads similarly produce zero instead of 10,000 layouts/measurements.

Twenty caret placements in a 10,000-line document now use one line-local grapheme
cache miss followed by 19 hits, rather than 20 repeated whole-document misses.
This case previously exceeded the boundary cache's budget, so it could not retain
its whole-document segmentation. Construction of the initial layout is outside
this timed lookup loop and is not claimed eliminated.

Across 150 disjoint ListBox range jumps, new containers fall from 1,800 to zero;
maximum realized containers remain 12. Reusing only container objects was not
sufficient: detaching rows and rebuilding their text presenters still churned
styles and bindings. Rows and internally owned scalar presenters now remain
attached and are retargeted in place. Custom templates retain normal teardown and
rebuild behavior. A bounded detached pool clears previous data/text/selection.

5,000 unchanged ordering queries on 100 children return one retained immutable
array instead of 5,000 newly allocated arrays. Public array/ZIndex changes still
trigger validation; the operation is not claimed O(1) or allocation-free under
mutation. Typeface descriptors are likewise retained until typography changes.

## Actual raster and pixel checks

The separate Chromium text suite performs 1,000 warm redraws through native Skia
and checks zero new layouts, text measurements, rasterizations and uploads. A
10,000-character line in a 400px viewport visits only four relevant tiles. Deep
vertical scrolling in a 10,000-line document visits only its ink-intersecting
visible lines before rasterization. See the per-case TextLinesVisited counters.

Twenty-five RGBA comparisons cover browser-font transport, overhangs, combining
marks, tiled/deeply scrolled text and 1/1.25/1.5/2/3x caret alignment. Tolerance is
two 8-bit channel levels; actual maxima and missing-ink counts are recorded in
`artifacts/text-quality-results.json`. This reference is the same browser's
Canvas2D shaping, not an independent shaping oracle or .NET differential test.

The executed final pixel run has maximum channel error **1**, with **zero missing
ink pixels**. The 10,000-line deep-scroll case visited **8** lines and matched its
reference with zero channel error. These are specific corpus results, not a
claim about every font, script or transform.

## Ownership and boundaries

TextBox, TextBlock and FormattedText own their retained layout lifetimes. Native
SkParagraph remains the path for explicitly registered fonts. Browser system-font
text uses Canvas2D shaping/rasterization composed by Skia; these paths are not
claimed identical. Font binaries are never included in release packages.

Entry/estimated-byte budgets bound cache structures, not total browser/WASM heap.
Typography/text may remain in bounded caches until eviction, so no secure-memory
zeroization is promised. Initial shaping/layout, large keys and complex scripts
still cost CPU. Binary prefix searches assume monotonic advances for nonnegative
spacing; full Unicode bidi caret/line-breaking parity remains incomplete. Native
or rich runs are not promised the simple path's vertical raster culling.

Reports under `artifacts/benchmark-*.json` outside validation-0.5 and the old recovery
directories belong to earlier releases and are retained as historical evidence.
