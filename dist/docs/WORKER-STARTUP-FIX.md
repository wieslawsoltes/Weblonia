# Worker startup diagnosis and fix

The original 0.6.0 archive reproduces a render-worker timeout with a real module
Worker statically importing the production entry and receiving canvas/ports
immediately. After timeout its onmessage handler exists, but Skia never started.
A fresh test initialization sent after import completion succeeds and creates a
real Skia canvas surface. This isolates loss of the first message during async
module evaluation, not slow rendering or the unrelated password-form warning.

The entry now installs a dependency-free receiver before dynamic imports. It
accepts ownership once, then explicitly starts the render/UI implementation.
Slow font-engine WebAssembly initialization no longer competes with installing
that receiver. Test-only classic wrappers that queued the lost event have been
removed from qualification; tests use real module workers with a static-import
wrapper and no queue/replay. Ordinary HTTP has a separate CI requirement.

Extract the complete updated ZIP to a fresh directory. Do not mix old
worker-assets with new source. Run `npm run build`, `npm run verify:workers`, and
`npm start`. Open `/?threading=render-worker` or `/?threading=full-isolation`.
The complete prebuilt dist directory is included and can be served directly.
The original archive and pinned native Skia assets remain unchanged.


## Standalone deployment path correction

The original build copied the worker application graph from
`samples/ControlCatalog/worker/` to `dist/worker/` without adjusting its
relative library imports. Root deployments could accidentally work after URL
normalization; deployment under a path prefix resolved above that prefix.
The distribution now independently resolves all application imports against its
final worker-assets location. Source and dist graph manifests are both checked;
the startup suite exercises a nested prefix and restart on all three layouts.
