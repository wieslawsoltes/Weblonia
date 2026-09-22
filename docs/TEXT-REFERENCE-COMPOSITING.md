# Equivalent text compositing references

Startup PR #1 does not change the production text rasterizer. The complete CI
suite nevertheless exposed a reference mismatch on system Chromium 152.0.7977.0:
18 repeated combining marks produced a maximum difference of 13 on 13 pixels.
There was no missing ink. The same test on Chromium 144 had a maximum of 1.

`tests/text-ink-diagnostic.py` isolates the stages. On the affected runner both
native Skia tile sizes (128 and 2048) AND the entirely Canvas2D alpha-layer paths
produced the same 13 differing pixels, including identical RGBA values. Direct
opaque drawing with float32 translation, and direct drawing with rebased origins,
matched the original reference exactly. Therefore this is not native upload,
interpolation, tile seams, float32 placement or lost line ink. It is the difference
between direct opaque drawing and the browser's transparent-line compositing
boundary for highly overlapping glyphs. Finite-precision compositing is not an
exact algebraic regrouping of independently rounded raster operations.

The extreme-overhang fixture now uses an independent full-viewport transparent
Canvas2D layer for EACH source line, then composites that layer over white. It
visits every line and uses no production visibility query, tile planner, phase
rebasing or native Skia operation. This tests the actual cached-line compositing
contract instead of comparing two different browser pipelines. The original
direct reference is still computed and its difference reported as
`DirectVersusIsolatedMaximum`; it is not silently discarded. Ordinary direct-text
comparisons remain unchanged. Additional colored and semitransparent repeated-mark
cases exercise the corrected reference.

The all-four-channel tolerance remains 2, with zero above-tolerance pixels and
zero missing-ink pixels required by the release gate. No production rendering
quality, antialiasing, font settings or native binary was altered for this fix.
The diagnostic and numerical results are retained in artifacts/startup/.
