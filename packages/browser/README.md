# @wieslawsoltes/avalonia-browser

Version 0.2.0-alpha.1. ESM package in the independent AvaloniaWeb JavaScript
compatibility implementation. Not an official or complete upstream port.

Import from `@wieslawsoltes/avalonia-browser`. This package ships JavaScript source with PascalCase APIs.
The parent source delivery contains usage, architecture, tests, API inventory and
a compatibility matrix. There are no generated TypeScript declarations or CJS
entry points in this alpha.

Run `npm run pack:all` in the source workspace to create all sibling packages.
They have not been published to npm. Install unpublished siblings together or
use the workspace's offline loader/import maps. Native Skia/browser services
have the platform and dependency boundaries described in the root documentation.

New code is MIT licensed. Preserve LICENSE, NOTICE and all dependency notices.

## Dedicated workers (0.6)

`BrowserThreadingMode.RenderWorker` selects UI plus retained render worker.
`StartWorkerApplicationAsync` starts a separate UI worker as well as the render
worker, leaving a thin browser host. `GetBrowserWorkerUrls` resolves the packaged
static ESM entries. `WorkerSkiaRenderer` owns the UI-side recording/transaction
proxy; no native handles cross its channel. Read the source workspace's
`docs/THREADING.md` for factory, lifecycle, callbacks, native hosting and memory
contracts. The package ships generated `worker-assets/` but not a duplicate WASM
binary; the application's explicit asset base supplies native runtime files.
