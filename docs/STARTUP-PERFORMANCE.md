# Native startup and ControlCatalog loading

The startup work preserves the existing three execution modes, full-isolation default, original API names, native Skia renderer, text shaping, antialiasing, device scale and autonomous invalidation fixes. It does not claim complete Avalonia parity.

## Removed dependencies on the critical path

The document entry imports only threading-mode resolution. In full isolation it loads the DOM worker host without the UI controls, catalog, renderer or native API graph. Browser services and worker URL options are moved into lightweight modules and re-exported without changing constructor identities.

The host starts streaming native WASM compilation while both genuine module workers import their graphs. Each original initialize message transfers its own one-shot MessagePort. A request/acknowledgement protocol supplies a structured-cloned WebAssembly.Module when ready. Each worker instantiates its own native engine with its own heap and handles. No native runtime is initialized on the full-isolation DOM thread.

A new renderer or popup receives a fresh port from the existing source. It does not consume a port stored in reusable options and does not download native code again. Borrowed popup sources are not disposed by child teardown. Timeouts, disposal, link failure, rejected compilation and agent-cluster cloning restrictions have explicit cleanup/fallback behavior.

The UI worker overlaps application-module import with native initialization, then constructs the application only after the platform is ready. The dependency-free synchronous bootstrap still owns the original transferred objects before asynchronous evaluation; no initialization replay or test-only message queue was added.

ControlCatalog compiles all 75 original AOT modules. Its synchronous index remains available. The live shell eagerly imports only MainView and uses a fixed allowlist of dynamic route imports, cached promises, and navigation generations so stale downloads cannot replace newer pages or Home. XAML source viewing/editing remains available.

## Upstream native loader

SkiaSharpWeb PR #9 supplies parallel browser script/WASM loading and the public side-effect-free `./wasm` entry. The qualified loader previously ignored the standard instantiateWasm hook. Its deterministic JavaScript-only post-link correction accepts precompiled modules and records original/generated loader hashes. The native WASM binary is unchanged.

The consumer pins the exact merged revision in both browser/skia package dependencies and the upstream lock. `scripts/sync-skia-startup.py` verifies the upstream runtime inventory and native hashes before copying the font-free distribution. `docs/STARTUP-UPSTREAM.json` identifies the reviewed merge and checks; previous text-planner PR evidence remains unchanged in `docs/SKIASHARPWEB-UPSTREAM.json`.

## Measurement and regression gates

Run `python tests/startup-http.py --baseline /path/to/baseline --trials 5` after building both checkouts. Every sample launches a fresh Chromium process, serves ordinary HTTP at `/Weblonia/` with no-store, uses the same native raster backend and DPR 1.25, and alternates variant order. It records time-to-ready, server request counts, native downloads, eager AOT module count and native PNG output. There is no timing threshold that can hide rendering failures. Network, browser code-cache and hardware determine absolute latency; these measurements are not physical WebGPU certification.

`tests/pages-smoke.py` verifies the queryless default and all explicit execution modes over canonical HTTP module URLs. Full isolation requires one native fetch, two shared-code deliveries, no pending delivery ports, no heavy main-thread graph, one eager AOT builder, and renderer restart without another native fetch. The 17 Node startup tests additionally cover failure/cancellation races, constructor identity, every original AOT builder, and lazy navigation precedence.

The existing native text/RGBA, cross-thread pixel, scroll, catalog and autonomous invalidation suites remain in CI. In restricted opaque-origin agent clusters, module decoding may fail; that explicitly falls back to local compilation and is reported by `NativePreparation.CloneFallbacks`, rather than silently weakening isolation.

Diagnostics: `await catalogHost.GetDiagnosticsAsync()` exposes `Host.NativePreparation` and a bounded `Host.StartupEvents` history. Detailed comparison output is in `artifacts/startup/http-comparison.json`.
