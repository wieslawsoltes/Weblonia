import test from 'node:test';
import assert from 'node:assert/strict';
import { Initialize } from '@wieslawsoltes/skiasharpweb';
import { SkiaPlatform, SkiaDrawingContext } from '@wieslawsoltes/avalonia-skia';
import { Rect, Point } from '@wieslawsoltes/avalonia-base';
import { StreamGeometry, Pen, Geometry } from '@wieslawsoltes/avalonia-media';
const S = await Initialize();
const platform = await SkiaPlatform.Initialize({ Api: S });
test('actual native Skia surface draws pixels and encodes PNG', () => {
    const surface = S.SKSurface.Create(new S.SKImageInfo(96, 64));
    const context = new SkiaDrawingContext(platform, surface.Canvas);
    try {
        surface.Canvas.Clear(S.SKColors.White);
        context.DrawRectangle('#FF0000', null, new Rect(0, 0, 48, 64));
        context.DrawEllipse('#0000FF', new Pen('#000000', 1), new Point(70, 32), 15, 15);
        surface.Flush();
        const image = surface.Snapshot();
        try {
            const data = image.Encode(S.SKEncodedImageFormat.Png, 100);
            try {
                const bytes = data.ToArray();
                assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
                assert.ok(bytes.length > 100);
            }
            finally {
                data.Dispose();
            }
        }
        finally {
            image.Dispose();
        }
    }
    finally {
        context.Dispose();
        surface.Dispose();
    }
});
test('native SVG path geometry has accurate bounds and fill hit testing', () => {
    const geometry = StreamGeometry.Parse('M 10 10 H 90 V 50 H 10 Z');
    assert.equal(geometry.Bounds.Width, 80);
    assert.equal(geometry.FillContains(new Point(30, 20)), true);
    assert.equal(geometry.FillContains(new Point(0, 0)), false);
});
test('native path boolean intersection produces actual geometry', () => {
    const a = StreamGeometry.Parse('M0 0H50V50H0Z'), b = StreamGeometry.Parse('M25 0H75V50H25Z');
    const c = Geometry.Combine(a, b, 'Intersect');
    assert.equal(c.FillContains(new Point(30, 20)), true);
    assert.equal(c.FillContains(new Point(10, 20)), false);
});
test.after(() => platform.Dispose());
