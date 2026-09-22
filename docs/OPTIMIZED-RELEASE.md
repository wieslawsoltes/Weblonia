# 0.5.1-alpha.1 optimized source package

This combines the complete 0.5 source with the recovered trace-driven property,
layout, browser accessibility, scheduling and TableView optimizations. No native
Skia bytes, rendering resolution or text-quality settings were downgraded.

## Verification and measurements

`docs/VERIFICATION.json` is generated only after complete tests agree on the current
source fingerprint. `artifacts/validation-optimized/` contains executed current
logs. Original intermediate trace/benchmark reports remain under
`artifacts/history/performance-session/`; their timings are not final-release
claims. `tests/performance-trace.py` reproduces the TableView workloads against an
extracted source tree, separately measuring timings and operation counts.

Browser tests use local-asset interception with real Skia and DOM input. Software
Chromium measurements do not establish hardware WebGPU speed, physical IME,
mobile input or screen-reader quality. Native text tests use installed fonts only;
font binaries are not distributed. Complete upstream Avalonia/XamlX parity remains
unestablished; this is not a new claim of full API or Fluent-template equivalence.

## Run

```sh
npm run verify:vendor
npm run build
npm start
```

Open http://127.0.0.1:4173/. Node 22+ is required. No npm install or .NET runtime is
needed for the bundled sample. All 17 workspace libraries, generated XAML modules,
standalone `dist/`, tests, licenses and regenerated npm tarballs are included.

## Executed release checks

The combined source passed 345 Node tests, all 109 catalog browser checks
(with three explicit WebGL2 capability skips), 20 scrollbar tests at each of
1x/1.25x, 27 text/caret checks, 12 incremental browser-accessibility checks,
75 AOT XAML module builds and all 17 packed-library consumer imports.
The release gate requires matching current source fingerprints across these
reports. Text/caret checks retain their original RGBA tolerances; no scale or
quality setting was reduced.

## Final local TableView benchmark

| Workload | Baseline median / p95 (ms) | Optimized median / p95 (ms) |
|---|---:|---:|
| repaint | 57.5 / 87 | 43.7 / 53.6 |
| scroll | 74.3 / 126.1 | 42.7 / 57.6 |
| horizontal | 59.8 / 91.4 | 38.1 / 48.3 |

Both builds used Chromium 144.0.7559.96 with the native Skia canvas backend and 2x device scaling. Each workload used three timing trials of 20 requested frames; separate instrumented runs recorded operation counts. These local CPU timings are not a hardware-GPU frame-rate claim. All three captured table scenes were byte-identical after RGBA decoding (zero differing pixels).
