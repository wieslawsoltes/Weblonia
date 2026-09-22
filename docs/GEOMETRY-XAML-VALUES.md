# Geometry literals in XAML and retained images

The cross-topology integration scene exposed missing metadata conversion on
RectangleGeometry.Rect. A literal remained a string, so DrawingImage.Size was
undefined during Image.Render. RectangleGeometry and EllipseGeometry now convert
Rect literals, RectangleGeometry converts numeric radii, and LineGeometry converts
Point literals. Existing typed values preserve identity; malformed text throws
before replacement. Runtime and directly emitted AOT use the same metadata.

The LineGeometry cases also exposed an event-discovery bug: Point.Add was mistaken
for an event subscription method. XAML event discovery now recognizes Event or a
complete Add/Remove/Raise event adapter instead of every object with an Add method.
Existing routed-event metadata remains authoritative.

Nine deterministic tests cover both compilation paths, actual rounded/elliptical
native Skia pixels through Image/DrawingImage, Point properties, malformed values
and atomic replacement. The ordinary HTTP core-port scene acquires its lazily
created compositor through ElementComposition.GetElementVisual, the same public
API used by applications. Three local intercepted-module diagnostic runs passed
all service/dispatcher and before/after RGBA probes; ordinary HTTP remains a
separate mandatory CI gate. No rendering tolerance is relaxed.
