# Tests and evidence — 0.6.1-alpha.1

`VERIFICATION.json` is generated only after all required executions pass for the
same version and source fingerprint. Runtime code, compiler, sample sources,
tests, scripts, package manifests and CI are fingerprinted. Generated XAML modules,
docs, artifacts and vendor are excluded from that source hash; the build regenerates
modules and `verify:vendor` independently checks every immutable dependency byte.
Node and browser runners write an incomplete checkpoint before execution, then
record the final fingerprint. Interrupted runs cannot masquerade as completed ones.

The final gate requires the Node suite, the original 109 catalog cases (three
WebGL2 capability skips), 20 scrollbar cases at each of two DPI scales, 27
text/caret checks, 12 incremental-accessibility cases, all 18 packed-package
consumers and every threaded suite listed below. Executed counts are recorded in
VERIFICATION.json; all reports must share one current source fingerprint.

## Reproduce

```sh
npm run verify:vendor
npm run test:record
npm run build
npm run pack:all
npm run test:packages
npm run inventory
npm run benchmark:scrolling
python -m pip install -r tests/requirements.txt
python -m playwright install chromium
python tests/browser.py --dist
python tests/text-quality.py
python tests/scrollbars.py
python tests/scrollbars.py --scale 1.25
python tests/automation-incremental.py
python tests/worker-startup.py
python tests/worker-startup.py --http
python tests/threading-browser.py
python tests/threading-integration.py
python tests/threading-quality.py
python tests/threading-catalog.py
python tests/threading-performance.py
npm run verify:release
python scripts/archive.py --output ../releases
```

`npm test` remains available as the plain Node suite. The recorded run additionally
writes `artifacts/validation-optimized/node-final.json` and its TAP log. Release validation
checks that they agree. Browser suites use `/usr/bin/chromium` when installed;
otherwise they use Playwright's browser. CHROMIUM_PATH overrides that selection.
Do not edit fingerprinted source while the qualification suites run.

The package consumer installs no registry dependencies: it safely extracts all
18 npm tarballs, resolves local siblings using Node's ESM resolver, maps genuine
bundled external dependencies and checks imports, bindings, XAML and scrollbar
range/hierarchy behavior. It records its source fingerprint separately.

## Scrollbars and text

`scrollbars.py` performs 20 actual-input cases for each device scale: vertical
and horizontal dragging, capture beyond the viewport, page clicks, deferred mode,
wheel units/Shift routing, host/automation keyboard focus, Hidden/Disabled,
content shrink, mid-drag disabling, overlay hit testing and live range projection.
Repeated scales are not represented as 40 different features. Delivered CSS wheel
deltas are independently recorded because automation injection can scale them.

`text-quality.py` contains 25 four-channel RGBA pixel comparisons and two operation
checks. Text cases include fractional origins and 1/1.25/1.5/2/3x scaling, overhangs,
combining marks, mixed scripts, letter spacing, nonuniform transforms, tiled lines,
deep 10,000-line scrolling and overhanging ink. Five caret cases use the actual
float32 Skia transform. The declared per-channel tolerance is two 8-bit levels;
missing-ink pixels are separately rejected. The reference is the same browser's
Canvas2D shaping, not .NET Avalonia or native SkParagraph equivalence.

Operation checks verify four visible tiles in a very long horizontal line and
zero new layout/measurement/raster/upload work over 1,000 warm redraws. These do
not assert zero total allocation, drawing or GPU work. Separate synthetic Node
benchmarks isolate algorithmic work; see PERFORMANCE.md.

## Qualification boundaries

Current successful browser tests use local-asset interception with actual Skia
WASM, input dispatch, popups and accessibility trees. Ordinary HTTP browser
navigation is not qualified by these tests. The separate current smoke probe
received HTTP 200 from the server, then Chromium rejected navigation with
ERR_BLOCKED_BY_ADMINISTRATOR; no browser policy was changed. `python tests/http-smoke.py` is a
separate probe; administrator blocking is reported, never bypassed. The supplied
CI tests an ordinary local HTTP deployment, but that workflow was not run remotely
for this delivery.

Native font tests read installed fonts in place. AVALONIA_TEST_FONT and
AVALONIA_TEST_BOLD_FONT can select suitable existing regular/bold files. Missing
fonts produce explicit skips; the release gate requires no skips in its local
Node qualification. No font files are redistributed.

Unavailable WebGL2 checks are explicit skips, not passes. Physical GPUs, touchpads,
touch hardware, IMEs/mobile keyboards, screen readers, Safari/Firefox, long-duration
heap stability, original upstream suites, full Fluent/catalog equivalence and
exhaustive security/differential testing remain unqualified. Historical reports
and intermediate failures are retained with their original identities.

## Incremental accessibility and scheduling

`automation-incremental.py` verifies no-op repaints without DOM mutations; detached
and transitive labels; cycle handling; control-content names; visibility/reordering;
command/inherited enabled state; editor ownership and focus; password conversion;
row-node recycling; and cancellation of redundant animation-frame callbacks.
The tests use actual Chromium DOM nodes and native Skia, not an accessibility
mock. They do not certify a physical screen reader.

## Threaded release qualification

```sh
npm run verify:vendor
npm run test:record
npm run build
npm run verify:workers
npm run pack:all
npm run test:packages
python tests/browser.py --dist
python tests/scrollbars.py
python tests/scrollbars.py --scale 1.25
python tests/text-quality.py
python tests/automation-incremental.py
python tests/worker-startup.py
python tests/worker-startup.py --http
python tests/threading-browser.py
python tests/threading-integration.py
python tests/threading-quality.py
python tests/threading-catalog.py
python tests/threading-performance.py
npm run verify:release
```

The new worker suites use actual native Skia/OffscreenCanvas with a direct
UI/render channel. Tests distinguish document, UI-worker and render-worker ownership;
independent animation during a deliberately stalled UI; real input, native DOM
echo races, scoped callbacks/messages, renderer restart, hidden/idle behavior,
platform changes, resize and actual modal browser windows. Every catalog route
is swept in both worker modes. Fractional/high-DPI comparisons include native
registered fonts and deep editor scrolling. Font bytes are read only from an
installed system face and served in memory, not saved into the package.

`threading-performance.py` compares the same current source and native raster
backend in all three modes. UI stage times exclude awaited render submission;
serial submission latency is retained separately and can be higher with workers.
The unchanged-repaint checks require no new recorded content or transactions.
Report heap/buffer counts as executed observations, not proof of a long soak.

The worker suites use `/usr/bin/chromium` when present, `CHROMIUM_PATH` when set,
or Playwright's installed Chromium otherwise. Real module workers statically
import the unchanged production entry using a data URL; no test queue or replay
is injected. Local asset interception preserves the asynchronous module graph
that exposed the original startup race. `worker-startup.py --http` uses ordinary
HTTP navigation and canonical worker URLs with no interception. A policy-block
exit 2 is reported as not qualified, not a pass. CI requires HTTP success. No
browser policy or secure-context restriction is modified.


The 0.6.1 release additionally requires all 17 startup regression cases, including
slow top-level-await dependencies and intentionally failing module imports. The
source and distribution application graphs have distinct import-depth manifests;
`verify:workers` validates both deployments and their dependency-free entrypoints.
