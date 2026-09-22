import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Initialize } from '@wieslawsoltes/skiasharpweb';
import * as A from '@wieslawsoltes/avalonia';

const S = await Initialize();
const platform = await A.SkiaPlatform.Initialize({ Api: S, ParagraphCacheEntries: 4 });
const fontPath = process.env.AVALONIA_TEST_FONT ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const hasFont = fs.existsSync(fontPath);
const fontRegistration = hasFont ? platform.RegisterTypeface('TestFont', fs.readFileSync(fontPath)) : null;
const nativeOptions = { skip: hasFont ? false : 'Set AVALONIA_TEST_FONT to an existing font; no fonts are bundled.' };
const face = new A.Typeface('TestFont');

test('grapheme boundaries preserve emoji ZWJ, combining marks, flags and CRLF', () => {
    const value = 'A👨‍👩‍👧‍👦e\u0301🇵🇱\r\nZ';
    assert.deepEqual(A.GraphemeSegments(value).map(x => x.Text), ['A', '👨‍👩‍👧‍👦', 'é', '🇵🇱', '\r\n', 'Z']);
    assert.equal(A.PreviousTextPosition(value, 12), 1);
    assert.equal(A.NextTextPosition(value, 1), 12);
    assert.equal(A.TruncateText(value, 8), 'A');
});
test('TextBox deletes complete graphemes and enforces MaxLength without lone surrogates', () => {
    const box = new A.TextBox('A👨‍👩‍👧‍👦Z');
    box.SelectionStart = box.SelectionEnd = box.CaretIndex = 12;
    box.OnKeyDown({ Key: 'Back', KeyModifiers: 0 });
    assert.equal(box.Text, 'AZ');
    box.Undo(); assert.equal(box.Text, 'A👨‍👩‍👧‍👦Z');
    box.Text = ''; box.MaxLength = 3; box.SelectionStart = box.SelectionEnd = box.CaretIndex = 0;
    box.ReplaceSelection('A😀B'); assert.equal(box.Text, 'A😀');
    box.Dispose();
});
test('a native IME composition is a single undo/redo transaction', () => {
    const box = new A.TextBox('prefix');
    box.ApplyTextEdit('prefixn', 7, 7, true);
    box.ApplyTextEdit('prefixni', 8, 8, true);
    box.ApplyTextEdit('prefix你', 7, 7, false);
    assert.equal(box._undo.length, 1);
    box.Undo(); assert.equal(box.Text, 'prefix');
    box.Redo(); assert.equal(box.Text, 'prefix你');
    box.Dispose();
});
test('password masking maps visual caret positions to original UTF-16 boundaries and supports reveal', () => {
    const box = new A.TextBox('A👨‍👩‍👧‍👦Z'); box.PasswordChar = '•';
    const layout = box._LayoutText();
    assert.equal(layout.Text, '•••');
    const first = layout.HitTestTextPosition(1), second = layout.HitTestTextPosition(12);
    assert.ok(second.X > first.X);
    box.RevealPassword = true; assert.equal(box._LayoutText().Text, box.Text);
    box.Dispose();
});
test('fallback line breaking retains source indices across CRLF and never truncates a grapheme', () => {
    const layout = new A.TextLayout('A\r\n😀B', new A.Typeface('not-registered'), 14);
    assert.equal(layout.TextLines[1].Start, 3);
    assert.equal(layout.HitTestTextPosition(3).Y, layout.TextLines[1].Y);
    const trimmed = new A.TextLayout('A👨‍👩‍👧‍👦Z', new A.Typeface('not-registered'), 14, A.Brushes.Black, { MaxWidth: 18, TextTrimming: 'CharacterEllipsis' });
    assert.equal(trimmed.TextLines[0].Text.isWellFormed(), true);
});
test('rich inline ownership, inheritance, dynamic invalidation and XAML loading are functional', () => {
    const block = A.AvaloniaXamlLoader.Load('<TextBlock xmlns="https://github.com/avaloniaui" FontSize="22">Hello <Bold>bold <Italic>and italic</Italic></Bold><LineBreak/><Run Text="World"/></TextBlock>');
    const flat = A.FlattenInlines(block.Inlines);
    assert.match(flat.Text, /Hello.*bold.*and italic\nWorld/);
    assert.equal(flat.Runs.find(r => r.Inline instanceof A.Run && r.Inline.Text.includes('and italic')).Typeface.Weight, 700);
    assert.ok(flat.Runs.every(r => r.FontSize === 22));
    const child = block.Inlines.Get(1);
    assert.throws(() => new A.Span().Inlines.Add(child), /owner/);
    const run = block.Inlines.Get(block.Inlines.Count - 1);
    block.Measure(new A.Size(300, 300)); assert.equal(block.IsMeasureValid, true);
    run.Text = 'Changed'; assert.equal(block.IsMeasureValid, false);
    block.FontSize = 26; assert.equal(run.FontSize, 26);
    block.Dispose(); assert.equal(run.IsDisposed, true);
});
test('native SkParagraph shapes ligatures, Arabic and mixed-direction text with cluster hit testing', nativeOptions, () => {
    const layout = new A.TextLayout('office سلام אבג XYZ 😀', face, 22);
    assert.ok(layout._nativeLayout);
    assert.ok(layout.Width > 50 && layout.Height > 15);
    const rtlStart = 'office سلام '.length;
    const first = layout.HitTestTextPosition(rtlStart), second = layout.HitTestTextPosition(rtlStart + 1);
    assert.ok(first.X > second.X, 'RTL caret advances visually left');
    const native = layout._nativeLayout._Entry().Parts[0].Paragraph;
    const lines = native.GetShapedLines();
    const glyphs = lines.flatMap(l => l.runs.flatMap(r => Array.from(r.glyphs)));
    assert.ok(glyphs.length < Array.from(layout.Text).length, 'actual ligature shaping reduces glyph count');
    for (const g of A.GraphemeSegments(layout.Text)) {
        const caret = layout.HitTestTextPosition(g.Start), hit = layout.HitTestPoint(new A.Point(caret.X, caret.Y + caret.Height / 2));
        assert.ok(A.GraphemeBoundaries(layout.Text).includes(hit.TextPosition));
    }
});
test('native rich paragraph rendering uses per-run sizes, colors, wrapping and source indices', nativeOptions, () => {
    const block = new A.TextBlock(); block.FontFamily = 'TestFont'; block.FontSize = 16; block.TextWrapping = 'Wrap';
    const big = new A.Bold('RED '); big.FontSize = 30; big.Foreground = A.Brushes.Red;
    block.Inlines.Add(big); block.Inlines.Add(new A.Run('text سلام אבג mixed direction and wrapping text\r\nlast line'));
    const layout = block.CreateTextLayout(180);
    assert.ok(layout._nativeLayout); assert.ok(layout.TextLines.length >= 3);
    assert.ok(layout.TextLines[0].Height > layout.TextLines.at(-1).Height);
    const surface = S.SKSurface.Create(new S.SKImageInfo(240, 220)), context = new A.SkiaDrawingContext(platform, surface.Canvas);
    try {
        surface.Canvas.Clear(S.SKColors.White); context.DrawTextLayout(layout, new A.Point(4, 4)); surface.Flush();
        const image = surface.Snapshot();
        try {
            const pixels = image.ReadPixels(new S.SKImageInfo(240, 220, S.SKColorType.Rgba8888, S.SKAlphaType.Unpremul));
            let red = 0, dark = 0; for (let i = 0; i < pixels.length; i += 4) { if (pixels[i] > 150 && pixels[i + 1] < 100) ++red; if (pixels[i] < 80 && pixels[i + 1] < 80) ++dark; }
            assert.ok(red > 10 && dark > 10);
        } finally { image.Dispose(); }
    } finally { context.Dispose(); surface.Dispose(); block.Dispose(); }
});
test('native paragraph cache eviction cannot invalidate a retained TextLayout', nativeOptions, () => {
    const layout = new A.TextLayout('retained layout', face, 18), before = layout.HitTestTextPosition(4);
    for (let i = 0; i < 20; ++i) new A.TextLayout(`temporary ${i}`, face, 18);
    assert.ok(platform.TextService.Cache.Count <= 4);
    assert.equal(layout.HitTestTextPosition(4).X, before.X);
});
test.after(() => { fontRegistration?.Dispose(); platform.Dispose(); });

test('inline UI containers participate in native text layout, visual arrangement and hit testing', nativeOptions, () => {
    const block = new A.TextBlock(); block.FontFamily = 'TestFont'; block.TextWrapping = 'Wrap';
    const button = new A.Button('Embedded'); button.Width = 92; button.Height = 36;
    block.Inlines.Add('Before '); block.Inlines.Add(new A.InlineUIContainer(button)); block.Inlines.Add(' after.');
    block.Measure(new A.Size(300, 200)); block.Arrange(new A.Rect(0, 0, 300, block.DesiredSize.Height));
    assert.equal(button.VisualParent, block);
    assert.equal(button.Bounds.Width, 92); assert.equal(button.Bounds.Height, 36);
    assert.ok(button.Bounds.X > 20);
    assert.ok(block._textLayout._nativeLayout);
    const position = block.EffectiveText.indexOf('\ufffc');
    assert.equal(block._textLayout.GetInlineBounds(position).Width, 92);
    block.Inlines.RemoveAt(1); assert.equal(button.VisualParent, null);
    button.Dispose(); block.Dispose();
});
