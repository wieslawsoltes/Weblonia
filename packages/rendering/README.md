# AvaloniaWeb retained rendering

Version 0.6.0-alpha.1. Shared UI-to-render protocol, immutable scene recorder,
portable drawing lists, atomic server scene and opt-in speculative scrolling.
No browser DOM ownership and no live Avalonia controls on the render side.

Exports include `CompositionSceneRecorder`, `PortableDrawingContext`,
`ServerCompositionScene`, `CompositionBufferPool`, `CompositionChangeAccumulator`,
`EncodeCompositionBatch`, `DecodeCompositionBatch` and `ServerScrollController`.
Consume through `@wieslawsoltes/avalonia-browser` for actual dedicated workers,
canvas lifetime, platform services, recovery and the three-thread application host.

The UI keeps synchronous property/binding/layout semantics; only explicit retained
records and resource descriptors cross ownership boundaries. One transaction is
in flight; subsequent deltas are based on acknowledged state, not dropped deltas.
No shared heap, transferred native pointer, implicit font download, or runtime eval.
Read the workspace `docs/THREADING.md` for complete contracts and qualification.

This is an implemented subset of Avalonia's composition semantics, not a binary
port of its original render-thread transport or a guarantee of full upstream API
parity. Licensed under the accompanying MIT license and third-party notices.
