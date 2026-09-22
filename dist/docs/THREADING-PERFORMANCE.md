# Executed threaded comparison — 0.6.0-alpha.1

Same current source; native Skia raster backend; 562 × 820 viewport; device scale 2. Two 30-sample trials per workload and topology. These are local CPU/submit measurements, not physical GPU FPS.

| Workload | Single UI CPU median | Render worker UI CPU median | Isolated UI worker CPU median |
|---|---:|---:|---:|
| repaint | 23.05 ms | 0.50 ms | 0.40 ms |
| vertical | 26.55 ms | 7.20 ms | 7.25 ms |
| horizontal | 23.35 ms | 3.50 ms | 3.60 ms |

**Serial submission latency is distinct:** the vertical workload median was single 26.6 ms, render-worker 33.75 ms, full-isolation 37.5 ms. Threading frees the browser/UI ownership lane; it does not automatically reduce native raster cost or a serial request/response duration.

The 100 unchanged warm redraw requests in each threaded mode produce zero new content records and zero new composition transactions. The measured transferable pool retained 1,044,480 bytes, below its 16 MiB cap, with one transaction in flight. This avoids unnecessary work instead of painting identical pixels again.

The current UI initializes native Skia for synchronous geometry and text services, and each render worker initializes a separate native runtime. The observed render heap was 128 MiB plus the UI-side heap; these are separate memory owners, not a shared/zero-copy native heap. Additional JS/resource caches are not included in that heap figure.

During the 1,200 ms deliberate UI-worker stall, two host-to-render requests completed while the UI was still blocked, and 13 animation/render ticks occurred between reads. The browser main host and render server remained independently scheduled. The exact input, time and reconciliation evidence is in integration-results.json.

All 14 worker-versus-single content comparisons and all 12 fractional/native-font text comparisons had a maximum RGBA channel error of zero. These are the qualified corpus, not every possible font/effect/platform.

Raw samples: `../artifacts/threading/performance-results.json`. Test code: `../tests/threading-performance.py`. Scope: `THREADING.md` and `TESTING.md`.

Source fingerprint: `93bd3c924ade6b353c6ca18432cbb8104ae0f51262c7c30a7dc9c7493495894c`.
