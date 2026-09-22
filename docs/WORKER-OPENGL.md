# OpenGL controls in dedicated-worker modes

The full catalog sweep on a WebGL-capable CI browser found that OpenGlControlBase
still assumed a DOM canvas and an immediate SkiaDrawingContext. The UI worker
instead has a semantic DOM projection, and both worker modes record through a
PortableDrawingContext. Creating a DOM canvas or requiring context.Api failed.

The GL context now remains local to the control's owning UI realm: a real DOM
canvas in ordinary UI mode, OffscreenCanvas in the UI worker. OnOpenGlInit,
OnOpenGlRender, context leases, loss/restoration and deinitialization retain their
existing ownership and API. No GL handle or native image pointer crosses realms.

An explicit requested frame reads RGBA once, flips rows into a retained
WriteableBitmap and invalidates any previous native upload. The composition
resource registry clones the pixel bytes into an immutable descriptor. Thus an
in-flight transaction cannot see a later frame mutate its buffer. Native Skia
uploads in the render worker; the single-thread renderer uploads locally.
Unchanged redraws do not read pixels or recopy descriptors. Resize, context loss,
teardown and failed deinitialization release owned buffers and native resources.
The existing per-buffer readback budget is checked before allocating; this is a
CPU readback/upload bridge, not zero-copy GPU sharing.

Nine deterministic tests cover both realm paths, row ordering, warm reuse,
immutable publication, resize/budget/loss/disposal and actual native Skia RGBA
refresh using an explicitly fake GL source. All 484 Node tests pass locally.
The full worker catalog adds real shader/readback/frame-change and exact native
presentation pixel checks on capable browsers, with a test-only inspection RPC
that wraps the unchanged catalog. Capability absence is recorded explicitly, not
counted as physical-GPU or shader qualification. Canonical HTTP/startup tests keep
the actual production app/worker URLs.
