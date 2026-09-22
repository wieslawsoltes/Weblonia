# Scrolling and text continuation — 0.5.0-alpha.1

## Failures addressed

ScrollViewer drew its vertical thumb after its children but dispatched input by
the child tree; a child could consume the click first. Horizontal thumb dragging
was not implemented. ListBox/TableView thumbs were only painted indicators.
The replacement uses real retained ScrollBar visual children with topmost input
priority and one geometry calculation for painting, paging and dragging.

A browser drag then exposed a second problem: virtual lists measured with the
full viewport but arranged with a smaller viewport after reserving scrollbar
space. Realized row counts oscillated, creating repeated layout passes. Both
phases now resolve the same viewport before realization. Table headers explicitly
rearrange after horizontal offset changes.

## Shared controls and coordinates

ScrollBar inherits RangeBase, which inherits TemplatedControl. It exposes Value,
Minimum/Maximum, ViewportSize, Orientation, Visibility, AllowAutoHide, ShowDelay,
HideDelay, IsExpanded, IsDirectionReversed, IsMoveToPointEnabled and Scroll events.
A compact thumb occupies a full-size interactive strip. Active dragging retains
the original pointer-to-thumb offset and continues under pointer capture outside
the viewport. Capture loss, detachment, disabling and disposal stop repeat/drag.
Track paging repeats only while the pointer remains beyond the moving thumb.

Each host owns a ScrollChrome helper containing two nonlogical visual children.
The helper publishes host extent/viewport/range values and applies Value updates
without breaking existing bindings. Deferred mode moves only the thumb during
ThumbTrack and commits content on EndScroll. Hidden permits scrolling without a
track; Disabled constrains that axis and clamps its offset to zero. Auto/Visible
and reserved/overlay track choices are resolved jointly across both axes.

Browser wheel deltaMode=0 is CSS pixels; mode=1 is converted using the host line
step and mode=2 using the viewport. Shift routes vertical wheel data horizontally.
At an exhausted boundary, an unconsumed event bubbles to an outer scroll host.
Tests record independently delivered DOM deltas rather than assuming a CDP wheel
injection always equals the requested CSS delta at fractional device scales.

GetChildClip is applied in rendering and hit testing, so clipped content cannot
capture through the viewport. Automation mirrors expose scrollbar orientation,
range and aria-controls. Actual screen-reader qualification remains outstanding.

## Editor ownership and quality

TextBox retains owner-scoped measurement/render layouts and disposes obsolete
ones. Measurement no longer leaks a new wrapper on every pass. TextLayoutCache
owns even descriptors that cannot be safely shared; it never returns a disposed
entry. FormattedText retains its layout until text, typography, brush, constraints
or the text-service generation changes. Its Dispose releases owned state.

The editor has one text origin shared by drawing, pointer hit testing, caret
visibility and browser-input placement. User scrolling does not itself reset
selection or text. Content shrink removes obsolete tracks and clamps offsets.
Wrapped text disables horizontal scrolling; unwrapped multiline text supports
both axes. The native input direction follows FlowDirection.

Fallback line baselines use font ascent/descent, not the particular glyph's ink
height. Ink bounds separately protect italic and combining-mark overhangs.
DrawCaret uses the actual Skia float32 matrix and rounds a nominal 1-DIP caret to
at least one physical pixel. At 3x DPI that caret remains three pixels wide.
Pixel tests account for float32 rounding at half-pixel ties.

## Removed repeated work

Long-document queries binary-search the relevant line and snap within that line's
grapheme boundaries rather than segmenting the entire document on each caret
move. Visible-line lookup includes ink overhang and skips hidden lines before
measurement/rasterization/upload on the simple browser-font path. MaxLines stops
after the overflow sentinel instead of formatting every hidden paragraph.

ListBox retargets attached surplus rows to the next virtual range. Its internally
owned scalar TextBlock presenter is updated in place; explicit/implicit templates
retain normal rebuild and cleanup semantics. Detached pool entries clear data,
selection and previous text before reuse. Native Control items are not silently
reparented as interchangeable generated containers. Stable visual Z ordering and
Typeface descriptors are reused while still detecting public collection/property
changes.

## Reproduce and inspect

Run `npm run test:record`, build, then `python tests/scrollbars.py` and
`python tests/scrollbars.py --scale 1.25`. These drive actual Chromium mouse,
keyboard and wheel input across all five scroll hosts. `tests/text-quality.py`
compares native Skia RGBA output, deep-document ink and carets against same-browser
references. `npm run benchmark:scrolling` records JavaScript operation counts.
All current final evidence must match the same source fingerprint; see TESTING.md.

The ScrollViewer catalog page exposes both axes, overlay and deferred controls,
and live extent/offset information. The TextBox page includes a 1,000-line editor.
Original full Fluent templates, every ControlCatalog subexample, full Unicode
text semantics and physical device qualification remain outside these results.
