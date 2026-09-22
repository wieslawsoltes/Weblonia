import test from 'node:test';
import assert from 'node:assert/strict';
import { Initialize } from '@wieslawsoltes/skiasharpweb';
import { SkiaPlatform, SkiaDrawingContext } from '@wieslawsoltes/avalonia-skia';
import { Rect, Matrix, Point } from '@wieslawsoltes/avalonia-base';
import { BlurEffect, StreamGeometry } from '@wieslawsoltes/avalonia-media';

const S = await Initialize();
const rectangle = c => [c.Left, c.Top, c.Right, c.Bottom];
function withContext(action) {
    const platform = new SkiaPlatform(S), surface = S.SKSurface.Create(new S.SKImageInfo(120, 90));
    const context = new SkiaDrawingContext(platform, surface.Canvas);
    try { return action(context, platform, surface); }
    finally { context.Dispose(); surface.Dispose(); platform.Dispose(); }
}
test('worker native perf: device clips are reused through transform-only state changes', () => withContext((ctx, p) => {
    ctx.CacheDeviceClip = true;
    const first = rectangle(ctx.GetDeviceClipBounds()), queries = p.DeviceClipQueries;
    for (let i = 0; i < 1000; ++i) {
        const state = ctx.PushTransform(Matrix.CreateTranslation(i / 7, i / 11));
        assert.deepEqual(rectangle(ctx.GetDeviceClipBounds()), first); state.Dispose();
    }
    assert.equal(p.DeviceClipQueries, queries);
}));
test('worker native perf: nested clip and layer changes refresh only at the relevant scope', () => withContext((ctx, p) => {
    ctx.CacheDeviceClip = true;
    const initial = rectangle(ctx.GetDeviceClipBounds()), n = p.DeviceClipQueries;
    const clip = ctx.PushClip(new Rect(10, 15, 30, 35));
    const clipped = rectangle(ctx.GetDeviceClipBounds()); assert.deepEqual(clipped, [10,15,40,50]);
    const effect = ctx.PushEffect(new BlurEffect(4));
    assert.deepEqual(rectangle(ctx.GetDeviceClipBounds()), rectangle(ctx.Canvas.DeviceClipBounds));
    effect.Dispose(); assert.deepEqual(rectangle(ctx.GetDeviceClipBounds()), clipped);
    clip.Dispose(); assert.deepEqual(rectangle(ctx.GetDeviceClipBounds()), initial);
    assert.equal(p.DeviceClipQueries, n + 2);
}));
test('worker native perf: direct native mutation is uncached by default and explicit invalidation is honored', () => withContext((ctx, p) => {
    assert.equal(ctx.CacheDeviceClip, false);
    ctx.GetDeviceClipBounds(); ctx.Canvas.ClipRect(new S.SKRect(5, 6, 25, 26));
    assert.deepEqual(rectangle(ctx.GetDeviceClipBounds()), [5,6,25,26]); assert.equal(p.DeviceClipQueries, 2);
    ctx.CacheDeviceClip = true; ctx.GetDeviceClipBounds(); const queries = p.DeviceClipQueries;
    ctx.Canvas.ClipRect(new S.SKRect(10, 10, 20, 20)); ctx.InvalidateNativeState();
    assert.deepEqual(rectangle(ctx.GetDeviceClipBounds()), [10,10,20,20]); assert.equal(p.DeviceClipQueries, queries + 1);
}));
test('worker native perf: cached clip state preserves RGBA through transforms clips opacity geometry and effects', () => {
    function draw(cached) { return withContext((ctx, p, surface) => {
        ctx.CacheDeviceClip = cached; surface.Canvas.Clear(S.SKColors.White);
        const transform = ctx.PushTransform(Matrix.CreateScale(1.25,1.5));
        const clip = ctx.PushClip(new Rect(4.5,5.25,60,40)); ctx.GetDeviceClipBounds();
        const opacity = ctx.PushOpacity(.6); ctx.GetDeviceClipBounds();
        ctx.DrawRectangle('#8040ff',null,new Rect(0,0,90,60));
        const geometry = ctx.PushGeometryClip(StreamGeometry.Parse('M5 5L55 5L30 45Z')); ctx.GetDeviceClipBounds();
        const blur = ctx.PushEffect(new BlurEffect(3)); ctx.GetDeviceClipBounds();
        ctx.DrawEllipse('#cc1100', null, new Point(30,25),19,18);
        blur.Dispose(); geometry.Dispose(); opacity.Dispose(); clip.Dispose(); transform.Dispose();
        ctx.GetDeviceClipBounds(); ctx.DrawRectangle('#008030',null,new Rect(95,10,20,65)); surface.Flush();
        const image=surface.Snapshot(); try { return Uint8Array.from(image.ReadPixels(new S.SKImageInfo(120,90,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul))); }
        finally { image.Dispose(); }
    }); }
    assert.deepEqual(draw(true), draw(false));
});
