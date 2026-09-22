import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
function metrics() {
    let count = 0;
    const registration = A.RegisterTextMetricsProvider({ Measure(text) { ++count; return { Width: A.GraphemeSegments(text).length * 8, Ascent: 10, Descent: 3 }; } });
    return { get Count() { return count; }, Dispose() { registration.Dispose(); } };
}
function arranged(T = A.TextBlock, text = 'Retained office text') {
    const c = new T(text); c.Measure(new A.Size(400, 100)); c.Arrange(new A.Rect(0, 0, 400, 100)); return c;
}
test('repeated TextBlock rendering retains the same layout without measuring', () => {
    const provider = metrics(), block = arranged();
    try {
        const layout = block.TextLayout, count = provider.Count;
        for (let i = 0; i < 1000; ++i) block.Render(new A.RecordingDrawingContext());
        assert.equal(block.TextLayout, layout); assert.equal(provider.Count, count);
    } finally { block.Dispose(); provider.Dispose(); }
});
test('TextBlock invalidates retained layout for shaping properties, width and inline changes', () => {
    const block = arranged(); let previous = block.TextLayout;
    for (const [name, value] of [['Text', 'changed'], ['FontSize', 23], ['FontFamily', 'serif'], ['FontWeight', 700], ['TextAlignment', 'Center'], ['LetterSpacing', 2], ['FontStretch', 3]]) {
        block[name] = value; const next = block.TextLayout; assert.notEqual(next, previous, name); previous = next;
    }
    assert.notEqual(block.GetTextLayout(180), previous);
    block.Inlines.Add(new A.Run('Inline')); previous = block.TextLayout;
    block.Inlines.Get(0).Text = 'new inline'; assert.notEqual(block.TextLayout, previous); block.Dispose();
});
test('in-place foreground brush changes invalidate native descriptor snapshots', () => {
    const block = arranged(); block.Foreground = new A.SolidColorBrush(A.Colors.Red);
    const before = block.TextLayout; block.Foreground.Color = A.Colors.Blue;
    assert.notEqual(block.TextLayout, before); assert.equal(block.TextLayout.Foreground.Color, A.Colors.Blue); block.Dispose();
});
test('text service generations invalidate retained layouts after font changes', () => {
    const block = arranged(), before = block.TextLayout;
    A.InvalidateTextServices(); assert.notEqual(block.TextLayout, before); block.Dispose();
});
test('Control.DrawText retains bounded label layouts and respects mutable brush colors', () => {
    const c = new A.Control(), ctx = new A.RecordingDrawingContext(), bounds = new A.Rect(0, 0, 250, 40);
    const a = c.DrawText(ctx, 'label', bounds); assert.equal(c.DrawText(ctx, 'label', bounds), a);
    for (let i = 0; i < 40; ++i) c.DrawText(ctx, `item ${i}`, bounds);
    assert.equal(c._drawTextLayouts.Count, 8); c.Dispose(); assert.equal(c._drawTextLayouts.Count, 0);
});
test('text editor does not rebuild layout on caret or selection changes', () => {
    const box = arranged(A.TextBox), before = box._LayoutText();
    for (let i = 0; i < 10; ++i) { box.CaretIndex = i; box.SelectionStart = i; box._EnsureCaretVisible(); assert.equal(box._LayoutText(), before); }
    box.Text = 'replacement'; assert.notEqual(box._LayoutText(), before); box.Dispose(); assert.equal(box._editorLayouts.Count, 0);
});
test('password layout reuse refreshes the logical mapping when equal-length masks hide different clusters', () => {
    const box = arranged(A.TextBox, 'A😀B'); box.PasswordChar = '•'; const first = box._LayoutText();
    box.Text = 'A👨‍👩‍👧‍👦B'; const second = box._LayoutText(); assert.equal(first, second);
    const middle = second.HitTestTextPosition(12); assert.equal(second.HitTestPoint(new A.Point(middle.X, middle.Y + 4)).TextPosition, 12);
    box.Text = '•••'; box.RevealPassword = true; const reveal = box._LayoutText();
    assert.equal(reveal.HitTestPoint(new A.Point(reveal.HitTestTextPosition(2).X, 4)).TextPosition, 2); box.Dispose();
});
test('grapheme cache is immutable, bounded, and does not expose text in diagnostics', () => {
    A.ClearTextBoundaryCache(); const text = 'A👨‍👩‍👧‍👦e\u0301B';
    const boundaries = A.GraphemeBoundaries(text); assert.deepEqual(boundaries, [0, 1, 12, 14, 15]);
    assert.throws(() => boundaries.push(99), TypeError); assert.equal(A.GraphemeBoundaries(text), boundaries);
    for (let i = 0; i < 300; ++i) A.GraphemeBoundaries(`entry ${i}`);
    const stats = A.GetTextBoundaryCacheStatistics(); assert.ok(stats.Count <= stats.MaxEntries); assert.ok(stats.EstimatedBytes <= stats.MaxBytes); assert.ok(stats.Hits >= 1);
    assert.doesNotMatch(JSON.stringify(stats), /entry|👨/);
});
test('fallback caret hit testing uses logarithmic prefix measurements and reuses them', () => {
    const provider = metrics();
    try {
        const layout = new A.TextLayout('a'.repeat(10000)); const count = provider.Count;
        const hit = layout.HitTestPoint(new A.Point(23456, 5)); assert.equal(hit.TextPosition, 2932);
        assert.ok(provider.Count - count < 20, `used ${provider.Count-count} measures`);
        const warmed = provider.Count;
        for (let i = 0; i < 1000; ++i) layout.HitTestPoint(new A.Point(23456, 5));
        assert.equal(provider.Count, warmed);
    } finally { provider.Dispose(); }
});
test('negative letter spacing retains a non-monotonic fallback hit-test path', () => {
    const provider = metrics();
    try { const layout = new A.TextLayout('abc', new A.Typeface(), 14, A.Brushes.Black, { LetterSpacing: -10 }); assert.equal(layout.HitTestPoint(new A.Point(-4, 2)).TextPosition, 2); }
    finally { provider.Dispose(); }
});
test('provider registrations restore the previous provider after out-of-order disposal', () => {
    const a = A.RegisterTextMetricsProvider({ Measure: () => ({ Width: 111 }) });
    const b = A.RegisterTextMetricsProvider({ Measure: () => ({ Width: 222 }) });
    a.Dispose(); assert.equal(A.MeasureText('x').Width, 222); b.Dispose(); assert.notEqual(A.MeasureText('x').Width, 111);
});
test('font stretch and letter spacing survive XAML property conversion', () => {
    const c = A.AvaloniaXamlLoader.Load('<TextBlock xmlns="https://github.com/avaloniaui" FontStretch="Condensed" LetterSpacing="1.25" Text="Text"/>');
    assert.equal(c.FontStretch, 3); assert.equal(c.Typeface.Stretch, 3); assert.equal(c.LetterSpacing, 1.25); c.Dispose();
});
test('text raster plan includes italic overhang and unusually tall combining-mark ink', () => {
    const p = A.CreateTextRasterPlan({ Width: 20, Left: 7, Right: 31, Ascent: 45, Descent: 21 }, 14, { ScaleX: 2, ScaleY: 2, PhaseX: .2, PhaseY: .7 }, 128);
    assert.ok(p.Left <= -14); assert.ok(p.Left + p.Width >= 62); assert.ok(p.Top <= -89); assert.ok(p.Top + p.Height >= 43);
});
test('text tiles cover large lines exactly without requiring an oversized canvas', () => {
    const p = A.CreateTextRasterPlan({ Width: 20000, Left: 0, Right: 20000, Ascent: 12, Descent: 4 }, 14, { ScaleX: 2, ScaleY: 2, PhaseX: 0, PhaseY: 0 }, 256);
    let area = 0; for (const tile of p.Tiles()) { assert.ok(tile.PixelWidth <= 256 && tile.PixelHeight <= 256); area += tile.PixelWidth * tile.PixelHeight; }
    assert.equal(area, p.Width * p.Height);
});
test('device-phase raster destinations land on the original physical pixel grid', () => {
    const matrix = [1.25, 0, .7, 0, 1.75, .4, 0, 0, 1], x = 10.3, y = 26.2;
    const g = A.GetDeviceTextGeometry(matrix, x, y);
    const p = A.CreateTextRasterPlan({ Width: 30, Left: 3, Right: 31, Ascent: 12, Descent: 4 }, 14, g);
    const tile = p.Tiles().next().value;
    const left = matrix[0] * (x - tile.OffsetX) + matrix[2], top = matrix[4] * (y - tile.Baseline) + matrix[5];
    assert.ok(Math.abs(left - Math.round(left)) < 1e-5); assert.ok(Math.abs(top - Math.round(top)) < 1e-5);
});
test('rotated or sheared text uses the largest affine stretch rather than device DPR alone', () => {
    const g = A.GetDeviceTextGeometry([1, 4, 0, 0, 1, 0, 0, 0, 1], 10, 10);
    assert.equal(g.AxisAligned, false); assert.ok(g.ScaleX > 4); assert.equal(g.ScaleX, g.ScaleY);
});
test('invalid raster sizes fail explicitly before allocation', () => {
    assert.throws(() => A.CreateTextRasterPlan({ Width: 10 }, 14, { ScaleX: 0, ScaleY: 1 }), /positive/);
    assert.throws(() => A.CreateTextRasterPlan({ Width: 10 }, 14, { ScaleX: 1, ScaleY: 1 }, 2), /tile size/);
});
test('wide fallback paragraph wrapping searches break candidates instead of every prefix', () => {
    const provider = metrics();
    try {
        const layout = new A.TextLayout('a'.repeat(10000), new A.Typeface(), 14, A.Brushes.Black, { MaxWidth: 40000, TextWrapping: 'Wrap' });
        assert.equal(layout.TextLines.length, 2); assert.equal(layout.TextLines[0].Length, 5000); assert.ok(provider.Count < 80, `used ${provider.Count} measurements`);
        assert.equal(layout.TextLines.map(l => l.Text).join(''), layout.Text);
    } finally { provider.Dispose(); }
});
test('fallback ellipsis binary search never splits a grapheme and avoids a quadratic scan', () => {
    const provider = metrics();
    try {
        const layout = new A.TextLayout('😀'.repeat(10000), new A.Typeface(), 14, A.Brushes.Black, { MaxWidth: 80, TextTrimming: 'CharacterEllipsis' });
        assert.equal(layout.TextLines[0].Text, '😀'.repeat(9) + '…'); assert.ok(provider.Count < 25);
    } finally { provider.Dispose(); }
});
test('WrapWithOverflow preserves an unbreakable word while Wrap can split it', () => {
    const provider = metrics();
    try {
        const options = { MaxWidth: 24, TextWrapping: 'WrapWithOverflow' };
        const a = new A.TextLayout('longword next', new A.Typeface(), 14, A.Brushes.Black, options);
        assert.equal(a.TextLines[0].Text, 'longword ');
        const b = new A.TextLayout('longword', new A.Typeface(), 14, A.Brushes.Black, { ...options, TextWrapping: 'Wrap' });
        assert.deepEqual(b.TextLines.map(l => l.Text), ['lon', 'gwo', 'rd']);
    } finally { provider.Dispose(); }
});
