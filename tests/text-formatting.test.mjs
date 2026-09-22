import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
const props = new A.GenericTextRunProperties(new A.Typeface(), 14);
const paragraph = () => new A.GenericTextParagraphProperties(props, 'Left', 'Wrap');
test('TextFormatter consumes source runs, preserves CRLF indices, and returns line-break continuations', () => {
    const source = new A.StringTextSource('first line\r\nsecond line', props), formatter = new A.TextFormatter();
    const one = formatter.FormatLine(source, 0, 400, paragraph());
    assert.equal(one.Text, 'first line'); assert.equal(one.NewLineLength, 2); assert.equal(one.Length, 12);
    const two = formatter.FormatLine(source, one.TextLineBreak.NextTextSourceIndex, 400, paragraph(), one.TextLineBreak);
    assert.equal(two.Text, 'second line'); assert.equal(two.FirstTextSourceIndex, 12); assert.equal(two.Length, 11);
    assert.equal(formatter.FormatLine(source, 23, 400, paragraph(), two.TextLineBreak), null);
    one.Dispose(); two.Dispose();
});
test('wrapped formatter lines reuse a paragraph rather than rereading and reshaping the source', () => {
    const source = new A.StringTextSource('one two three four five six seven eight nine ten', props); let reads = 0;
    const get = source.GetTextRun.bind(source); source.GetTextRun = index => { ++reads; return get(index); };
    const formatter = new A.TextFormatter(), p = paragraph(), first = formatter.FormatLine(source, 0, 65, p), consumed = [first]; let line = first;
    while (line.TextLineBreak.HasRemaining) { line = formatter.FormatLine(source, line.TextLineBreak.NextTextSourceIndex, 65, p, line.TextLineBreak); consumed.push(line); }
    assert.ok(consumed.length > 2); assert.equal(reads, 2); assert.equal(consumed.map(x => x.Text).join(''), source.Text);
    const old = line; source.Text = 'changed'; const cache = new A.TextRunCache(); cache.Invalidate(source);
    const newLine = formatter.FormatLine(source, 0, 300, p, old.TextLineBreak, cache); assert.equal(newLine.Text, 'changed'); newLine.Dispose(); consumed.forEach(x => x.Dispose());
});
test('source run styles survive formatting and drawing records', () => {
    class Source extends A.TextSource { GetTextRun(index) { return index === 0 ? new A.TextCharacters('Red ', new A.GenericTextRunProperties(new A.Typeface(), 18, null, A.Brushes.Red)) : index === 4 ? new A.TextCharacters('Blue', new A.GenericTextRunProperties(new A.Typeface(), 24, null, A.Brushes.Blue)) : new A.TextEndOfParagraph(0); } }
    const line = A.TextFormatter.Current.FormatLine(new Source(), 0, 300, paragraph()); assert.equal(line.TextRuns.length, 2); assert.equal(line.TextRuns[1].Properties.FontRenderingEmSize, 24);
    const ctx = new A.RecordingDrawingContext(); line.Draw(ctx, new A.Point(10, 20)); assert.ok(ctx.Commands.some(c => c.Op === 'Text')); line.Dispose();
});
test('TextLine caret navigation is UTF-16-indexed and grapheme safe', () => {
    const line = A.TextFormatter.Current.FormatLine(new A.StringTextSource('A👩‍💻é', props), 0, 300, paragraph());
    const hit = line.GetNextCaretCharacterHit(new A.CharacterHit(1)); assert.equal(hit.FirstCharacterIndex, 6);
    assert.equal(line.GetPreviousCaretCharacterHit(hit).FirstCharacterIndex, 1);
    const distance = line.GetDistanceFromCharacterHit(hit); const reverse = line.GetCharacterHitFromDistance(distance); assert.equal(reverse.FirstCharacterIndex + reverse.TrailingLength, 6);
    assert.ok(line.GetTextBounds(1, 5)[0].Rectangle.Width > 0); line.Dispose(); assert.throws(() => line.GetTextBounds(0, 1), /disposed/);
});
test('formatter rejects non-advancing runs and oversized paragraphs', () => {
    assert.throws(() => A.TextFormatter.Current.FormatLine({ GetTextRun: () => new A.TextCharacters('', props) }, 0, 300, paragraph()), /advancing/);
    assert.throws(() => new A.TextFormatter({ MaxParagraphCharacters: 3 }).FormatLine(new A.StringTextSource('oversized', props), 0, 300, paragraph()), /budget/);
});
test('TextLine collapse and interword justification are executable layout operations', () => {
    const p = new A.GenericTextParagraphProperties(props, 'Left', 'NoWrap');
    const line = A.TextFormatter.Current.FormatLine(new A.StringTextSource('one two three four', props), 0, 400, p);
    const collapsed = line.Collapse(new A.TextTrailingCharacterEllipsis(65, props)); assert.ok(collapsed.HasCollapsed); assert.equal(collapsed.Length, line.Length); assert.ok(collapsed.Width <= 70);
    line.Justify(new A.InterWordJustification(350)); assert.ok(line.Width >= 349); collapsed.Dispose(); line.Dispose();
});
