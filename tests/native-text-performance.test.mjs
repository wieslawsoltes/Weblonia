import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as A from '@wieslawsoltes/avalonia';
import { Initialize } from '@wieslawsoltes/skiasharpweb';
const S = await Initialize();
const regular = process.env.AVALONIA_TEST_FONT ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const bold = process.env.AVALONIA_TEST_BOLD_FONT ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const qualified = { skip: !existsSync(regular) || !existsSync(bold) };
test('multiple registered faces in one family retain independent native ownership', qualified, () => {
    const platform = new A.SkiaPlatform(S);
    const one = platform.RegisterTypeface('FaceStack', readFileSync(regular)), two = platform.RegisterTypeface('facestack', readFileSync(bold));
    try {
        const a = new A.TextLayout('Weight matching', new A.Typeface('FACESTACK', 'Normal', 400));
        const b = new A.TextLayout('Weight matching', new A.Typeface('facestack', 'Normal', 700));
        assert.ok(a._nativeLayout && b._nativeLayout); assert.notEqual(a.Width, b.Width);
        one.Dispose(); assert.ok(new A.TextLayout('Remaining face', new A.Typeface('FaceStack'))._nativeLayout);
        two.Dispose(); assert.equal(platform.TextService._fonts.size, 0);
    } finally { one.Dispose(); two.Dispose(); platform.Dispose(); }
});
test('retained native paragraph keys are serialized once across repeated shaping queries', qualified, () => {
    const platform = new A.SkiaPlatform(S); const registration = platform.RegisterTypeface('TestFont', readFileSync(regular));
    try {
        const layout = new A.TextLayout('office سلام text', new A.Typeface('TestFont'));
        const keys = platform.TextService.KeySerializations, builds = platform.TextService.ParagraphBuilds;
        for (let i = 0; i < 1000; ++i) layout.HitTestTextPosition(4);
        assert.equal(platform.TextService.KeySerializations, keys); assert.equal(platform.TextService.ParagraphBuilds, builds);
        platform.TextService.Cache.Clear(); layout.HitTestTextPosition(4);
        assert.equal(platform.TextService.KeySerializations, keys); assert.equal(platform.TextService.ParagraphBuilds, builds + 1);
    } finally { registration.Dispose(); platform.Dispose(); }
});
test('font handles remain safe when disposed after their owning platform', qualified, () => {
    const platform = new A.SkiaPlatform(S); const a = platform.RegisterTypeface('Test', readFileSync(regular)); const b = platform.RegisterTypeface('Test', readFileSync(bold));
    platform.Dispose(); assert.doesNotThrow(() => { a.Dispose(); b.Dispose(); a.Dispose(); });
});
test('solid native paints are reused without changing the rendered color after eviction', () => {
    const platform = new A.SkiaPlatform(S, { SolidPaintCacheEntries: 2 });
    const surface = S.SKSurface.Create(new S.SKImageInfo(64, 32)), context = new A.SkiaDrawingContext(platform, surface.Canvas);
    try {
        for (let i = 0; i < 50; ++i) context.DrawRectangle('#ff0000', null, new A.Rect(0, 0, 64, 32));
        assert.equal(platform.SolidPaints.Count, 1); assert.ok(platform.SolidPaints.Hits >= 49);
        for (const color of ['#00ff00', '#0000ff', '#ff0000']) context.DrawRectangle(color, null, new A.Rect(0, 0, 64, 32));
        assert.equal(platform.SolidPaints.Count, 2);
        const image = surface.Snapshot();
        try { const pixels = image.ReadPixels(new S.SKImageInfo(64, 32, S.SKColorType.Rgba8888, S.SKAlphaType.Unpremul)); assert.deepEqual([...pixels.slice(0, 4)], [255, 0, 0, 255]); }
        finally { image.Dispose(); }
    } finally { context.Dispose(); surface.Dispose(); platform.Dispose(); }
});
