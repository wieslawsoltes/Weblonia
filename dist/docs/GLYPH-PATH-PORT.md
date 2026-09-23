# Native glyph runs and observable path geometry

This increment continues Weblonia from 239bdcccb71e3fe23047a91317976089789e5340.
It uses the existing pinned Avalonia dff6a87665aa456c37b8cf89647e007f4c3066d7
and SkiaSharpWeb 0.5.1. No native WASM or vendored dependency bytes change.
Pinned source file hashes are in GLYPH-PATH-REFERENCE.json.

## Explicit glyphs, not another text shaper

`GlyphTypeface.FromData(bytes, { FontIndex })` / `SkiaPlatform.CreateGlyphTypeface`
create actual native typefaces from caller-supplied font bytes. `GlyphInfo`,
`GlyphRunMetrics`, `FontMetrics`, `GlyphRun`, `ImmutableGlyphRunReference` and
`GlyphRunDrawing` expose the corresponding explicit-glyph rendering contracts.
`DrawingContext.DrawGlyphRun(foreground, run)` consumes that run directly.

The glyph-index constructor derives advances from design-unit metrics. The
GlyphInfo constructor preserves supplied glyph IDs, advances, offsets and UTF-16
clusters: the caller supplies shaping and bidi order. GetGlyphs is cmap mapping,
not kerning, ligature substitution, Arabic shaping or fallback. The existing
TextLayout/SkParagraph/browser-system-font pipelines are NOT replaced.

The native path uses positioned SKTextBlob glyph IDs, never reconstructed text.
One prepared native blob is retained per run revision and native API. Metrics and
caret indices are cached. Ordinary caret queries use binary search; signed advance
sequences use an explicit fallback. BuildGeometry extracts actual glyph contours
with the proper baseline/offset and nonzero winding. GetIntersections returns
native glyph intercepts in the run's local baseline frame, as upstream does.

Font data and public glyph/metric snapshots are defensively copied. Run-owned
font references survive disposal of caller handles. Immutable references survive
source-run mutation/disposal; retained DrawingGroup records own such snapshots.
Typeface, run, native blob and geometry-provider lifetimes are independently
bounded and released explicitly. Provider registrations restore the last live
registration after out-of-order disposal.

JavaScript out-parameter conventions:

- TryGetGlyph -> { Success, Glyph }.
- TryGetGlyphMetrics -> { Success, Metrics }; TryGetTable -> { Success, Table }.
- TryGetHorizontalGlyphAdvances -> { Success, Advances }, or a Boolean when an
  output buffer is supplied.
- GetCharacterHitFromDistance -> { CharacterHit, IsInside }.
- FindNearestCharacterHit -> { CharacterHit, Width }.
- Geometry TryGetPointAtDistance / TryGetPointAndTangentAtDistance ->
  { Success, Point, Tangent }; TryGetSegment -> { Success, Segment }.

## PathGeometry and native fill/stroke semantics

PathGeometry now derives from StreamGeometry and exposes observable PathFigures,
PathFigure, PathSegments, PathSegment and typed point collections. Implemented
segments include line, cubic/quadratic Bezier, all three poly families and arcs.
PathFigure defaults to closed/filled, and ArcSegment defaults to clockwise, in
accordance with the pinned upstream source. Nested mutations invalidate geometry,
retained drawings, controls and worker resources without input.

StreamGeometry/Open and PathGeometry/Open have exclusive transactional writers.
Abort leaves previous contours and caches untouched. Commit publishes a complete
path and fill rule, with one final invalidation. Writer-generated child objects
are owned and cleaned; caller-supplied shared graphs remain borrowed. Collections
validate cycles, types and disposed resources before mutation. Deep clones have
independent points, transforms and nested geometry resources.

The bounded parser handles F0/F1, M/L/H/V/C/S/Q/T/A/Z, relative forms, repeat
parameters, exponents, smooth control reflection and compact arc flags. It emits
normalized context operations and rejects malformed/unknown/nonfinite input.
There is no eval, external entity expansion or silent truncation.

Geometry descriptions retain distinct all/fill/stroke contours. Unfilled figures
are excluded from fill; unstroked segments introduce stroke gaps while preserving
the fill boundary. Closing a broken stroke returns to the original figure start,
not the last gap move. Native groups retain child and group transforms. Combined
geometry uses real native Boolean operations, not concatenated SVG approximations.
Native widening, stroke hit/render bounds, contour length, point/tangent and
segment extraction use SKPaint.GetFillPath / SKPathMeasure. Temporary native paths
are always owned independently of the bounded native-path LRU cache.

## Isolated rendering and atomic transport

Portable glyph resources encode exact font bytes once per shared typeface identity
and independently revisioned glyph data. Both resource descriptors copy mutable
buffers before publication. Run/font native handles NEVER cross worker heaps.
The receiver validates glyph IDs, dependencies, paths and dimensions and prepares
native resources before committing the scene. Invalid packets dispose provisional
allocations without corrupting the previously committed scene. Renderer restart
reconstructs native glyphs from the recorded font resource, without another font
network request. Native tests also render into a genuinely independent WASM heap.

Geometry resources use structured descriptions, not a lossy shared Data string;
recursive decoding validates the entire graph before allocating native resources.
Warm captures and replays reuse immutable descriptors and native prepared state.

## Sample and validation

CustomDrawing now has a retained path/glyph card with fill, stroke-gap, retarget
and font-loading controls. The user selects a font through the real storage
provider. No font is embedded, distributed or downloaded automatically. The sample
cmap/offset demonstration deliberately does not claim to be a text shaper.

Tests read an existing installed system font (`AVALONIA_TEST_FONT`, default
/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf) directly. They do not copy it into
the repository, package archives or evidence. The HTTP fixture exposes only that
font to its local browser session. Its six tests cover runtime/AOT XAML in single,
render-worker and full-isolation modes, actual presented RGBA pixels, autonomous
resource mutation, glyph movement, stroke-gap changes and renderer restart.
Screenshot checks do not call render/snapshot RPCs or inject mouse input to repair
invalidation. Maximum channel tolerance stays 2.

`node --import ./scripts/register-loader.mjs scripts/compile-glyph-fixture.mjs`
regenerates the ordinary direct-AOT test module before source fingerprinting.
The complete release qualifier runs all previous startup/catalog/text/worker/
OpenGL/invalidation/package gates, the new Node/native tests and new HTTP scene.
Local HTTP navigation is administrator-blocked; local browser attempts are not
reported as passes. Actual successful CI evidence is required before merge.

## Explicit parity boundaries

This does not finish the Avalonia/XamlX port. In particular, no complete
GlyphDrawingOptions/TextOptions, font simulations/variable-font selection,
vertical glyph-run layout, upstream Typeface.GlyphTypeface font-family resolution,
all FontManager APIs or universal shaping-cluster parity is asserted. The glyph
backend deliberately uses unhinted grayscale antialiasing, subpixel positioning,
linear metrics and unsnapped baselines; it does not implement upstream's full
text-options matrix. Color-font contour extraction cannot reproduce colored
bitmap/SVG glyph layers as a monochrome Geometry. Exact glyph table metrics are
provided where native Skia exposes them; no exhaustive malformed-font or complete
OpenType table parser qualification is claimed.

Path geometry Bounds are conservative bounds of the complete contour (including
unstroked/unfilled pieces); RenderBounds and fill/stroke queries respect their
separate contours. This differs from upstream Skia's stroke-path-only Bounds for
some degenerate role-limited figures. PreciseArcTo currently uses the same native
arc contour rather than a separate higher-precision implementation. Measure/query
methods use the first contour, matching the exposed SKPathMeasure semantics.
Broader effect/surface/core/XAML families and original catalog subexamples remain.
No physical-GPU/mobile/Safari/Firefox or new npm-release qualification is implied.
