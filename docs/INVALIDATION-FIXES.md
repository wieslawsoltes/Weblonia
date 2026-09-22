# 0.6.2-alpha.1 — autonomous invalidation and recovered worker performance

This release combines the complete 0.6.1 source with all 15 recovered files from
the subsequent, previously unpackaged worker-performance continuation. The original
archive and recovered inputs are unchanged. `recovery/recovery-invalidation.json`
records the baseline archive, all 1,839 matching manifest entries and recovered-file
hashes. The recovered implementation passed its 421-test Node baseline before these
fixes. There are no new SkiaSharpWeb native/vendor changes.

## Reproduced defects and repairs

### Column sizes changed, but realized cells stayed at the old width

Changing a TableView column updated its ActualWidth and the headers but did not
invalidate the cells presenter's layout. The row's outer Bounds stayed the same, so
retained Arrange legitimately reused its cached result. An unrelated hover later
invalidated drawing and exposed the changed state.

Width/minimum/maximum changes now invalidate layout for the header and every
realized cells presenter. Actual pixel/star-width redistribution invalidates arrange
where needed. Width-only changes do not rebuild cell bindings, scalar presenters or
containers. Hiding/showing columns still performs the required structure change.

### Scheduling a frame did not invalidate a time-dependent display list

The indeterminate ProgressBar requested another root frame but its retained drawing
commands were still clean. The worker repeatedly replayed the same progress segment.

A frame request can now name its visual owner. The next UI frame consumes a set of
owners and invalidates only their drawing content before capture. Multiple requests
coalesce. Disposed, detached, hidden and fully transparent owners are pruned. A
previously time-dependent cached list is re-recorded when it re-enters the visible
tree, so it can renew its request. Determinate progress and unrelated clean siblings
do not continually serialize or re-record after the animation stops.

This private scheduling helper is not a substitute for public InvalidateVisual().
Custom control authors should invalidate when their rendered state changes.

### Invalidations raised during drawing were incorrectly consumed

The recorder saved a visual's live subtree version after calling Render/RenderAfter
and visiting children. A callback could invalidate itself, or an earlier sibling,
and the recorder would then mark that newer revision as already recorded.

Capture now records the version that existed at entry. A newer revision remains
pending for the next capture. Resource-change generations are handled similarly.
This remains correct with one transaction in flight: deltas are still computed
against acknowledged state, not arbitrarily discarded intermediate transactions.

The render worker likewise consumes its dirty bit before, not after, drawing.
Registered custom handlers calling Invalidate() from OnRender now schedule the
next render instead of waiting for another input or commit.

### Bitmap caches could restore stale animation terminal frames

The server bypassed bitmap caches while animations were active, but resumed a
pre-animation cached image when the final animation completed. UI descriptor versions
do not change for independent render-side animation samples.

Server cached visuals now have lazy numeric revision stamps incorporating dynamic
composition/resource state. Terminal animation frames invalidate the old cache and
become reusable while idle. Speculative scrolling bypasses caches while its temporary
transform is active. Snapshot caches also preserve their entry revision, so an
invalidation raised while generating a bitmap is not swallowed.

A native pixel regression demonstrates both defects before the repair and verifies
red-to-blue reentrant snapshots and the final position of a cached animated child.

### Worker clocks whose requestAnimationFrame cannot run

A worker may expose requestAnimationFrame but reject it with NotSupportedError.
Animation.Clock now uses a cancellable timer fallback for that specific case. Other
exceptions are not concealed. Manual clocks and normal owner-window RAF remain
unchanged.

## Previous performance continuation is included

The package contains transaction-local UTF-8 string dictionaries, direct buffer
encoding, sparse visual patches, immutable reference-summary caches, interned text
resources, exact-identity canvas transform skipping, scoped native clip caches,
and deduplicated frame notifications. Validation of graph dependencies, resource
retirement and malformed packets remains enabled. Protocol v1 decoding is retained;
new transactions use the v2 dictionary/patch format.

The worker-performance browser suite checks counters and compares seven static,
scrolled, text and effect scenes against the untouched 0.6.1 source when supplied
with `--baseline`. The changed invalidation scenarios are tested separately rather
than incorrectly expecting equality with known-stale baseline pixels.

## Reproduce the checks

```sh
npm run test:record
npm run build
npm run verify:workers
npm run test:invalidation
python tests/worker-performance-browser.py --baseline /path/to/untouched/AvaloniaWeb
```

`tests/invalidation-browser.py` exercises all three execution modes using genuine
module-worker entry points. Mutating test commands deliberately never invoke
RenderNow, FlushAsync, renderer snapshots, or synthetic pointer movement. Tests
first wait for automatically updated state, sample the presentation canvas, and
only then force a diagnostic redraw to establish that no further pixel change was
needed. Timer column changes, header-only dragging, progress without input,
hide/show, intermediate/final and replaced transitions, reentrant ordinary/cached
controls, and render-side custom invalidation are covered.

The single-threaded renderer still performs immediate tree drawing. The assertion
that a stable sibling is not re-recorded applies to the two retained worker modes,
not to that immediate-rendering reference path.

Current completed results and source fingerprints are in `VERIFICATION.json` and
`../artifacts/invalidation/browser-results.json`. The new checks are part of the
release gate and CI. Earliest failing/passing logs are retained under
`../artifacts/invalidation/reproduction/` as historical root-cause evidence, not as
final qualification.

## Boundaries

This is a correctness/performance continuation, not full upstream Avalonia/XamlX
parity. No lower text resolution, font substitution, suppressed accessibility or
native-binary modification was introduced. Browser qualification uses native Skia's
raster path in Chromium and local asset interception; ordinary HTTP worker results
are recorded separately, and hardware WebGPU, physical IME/touch and screen readers
are not qualified by these tests. Single-thread mode remains the default.
