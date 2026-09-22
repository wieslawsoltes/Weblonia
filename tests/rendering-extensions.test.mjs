import test from 'node:test';
import assert from 'node:assert/strict';
import { Initialize } from '@wieslawsoltes/skiasharpweb';
import { SkiaPlatform, SkiaDrawingContext, Border, Canvas, BitmapCache, BlurEffect, DropShadowEffect, ImageBrush, VisualBrush, WriteableBitmap, ExperimentalAcrylicMaterial, SolidColorBrush, Size, Rect, Point, BoxShadow } from '@wieslawsoltes/avalonia';
const S = await Initialize();
const platform = await SkiaPlatform.Initialize({ Api: S });
function render(action, width = 100, height = 100) {
    const surface = S.SKSurface.Create(new S.SKImageInfo(width, height));
    const context = new SkiaDrawingContext(platform, surface.Canvas); context.Surface = surface;
    try {
        surface.Canvas.Clear(S.SKColors.Transparent); action(context); surface.Flush();
        const image = surface.Snapshot();
        try { return image.ReadPixels(new S.SKImageInfo(width, height, S.SKColorType.Rgba8888, S.SKAlphaType.Unpremul)); }
        finally { image.Dispose(); }
    } finally { context.Dispose(); surface.Dispose(); }
}
const pixel = (pixels, x, y, width=100) => [...pixels.slice((y*width+x)*4,(y*width+x)*4+4)];
function box(color='#ff0000', w=40, h=40) { const b=new Border(); b.Background=color; b.Width=w; b.Height=h; b.Measure(new Size(w,h)); b.Arrange(new Rect(0,0,w,h)); return b; }

test('ImageBrush uses native image shader with transparent uniform letterboxing', () => {
    const bitmap = new WriteableBitmap(new Size(2,1)); bitmap.Pixels.set([255,0,0,255,0,0,255,255]);
    const brush = new ImageBrush(bitmap); brush.Stretch='Fill';
    let pixels=render(ctx=>ctx.DrawRectangle(brush,null,new Rect(0,0,100,100)));
    assert.ok(pixel(pixels,10,50)[0]>200); assert.ok(pixel(pixels,90,50)[2]>200);
    brush.Stretch='Uniform'; pixels=render(ctx=>ctx.DrawRectangle(brush,null,new Rect(0,0,100,100)));
    assert.equal(pixel(pixels,50,5)[3],0); assert.equal(pixel(pixels,50,50)[3],255); bitmap.Dispose();
});

test('VisualBrush snapshots actual retained content and refreshes mutable brushes', () => {
    const source = box(), brush = new VisualBrush(source); brush.Stretch='Fill';
    let pixels=render(ctx=>ctx.DrawRectangle(brush,null,new Rect(0,0,100,100)));
    assert.deepEqual(pixel(pixels,50,50),[255,0,0,255]);
    source.Background = new SolidColorBrush('#0000ff');
    pixels=render(ctx=>ctx.DrawRectangle(brush,null,new Rect(0,0,100,100)));
    assert.deepEqual(pixel(pixels,50,50),[0,0,255,255]);
    source.Background.Color='#00ff00';
    pixels=render(ctx=>ctx.DrawRectangle(brush,null,new Rect(0,0,100,100)));
    assert.deepEqual(pixel(pixels,50,50),[0,255,0,255]); source.Dispose();
});

test('BitmapCache reuses unchanged content, refreshes descendants, and releases on dispose', () => {
    const parent=new Border(), child=box(); parent.Child=child; parent.Width=40;parent.Height=40;parent.CacheMode=new BitmapCache(2);
    parent.Measure(new Size(40,40));parent.Arrange(new Rect(0,0,40,40));
    let renders=0;const original=child.Render.bind(child);child.Render=ctx=>{renders++;original(ctx);};
    render(ctx=>parent.RenderTree(ctx));render(ctx=>parent.RenderTree(ctx));assert.equal(renders,1);
    child.Background='#0000ff';const pixels=render(ctx=>parent.RenderTree(ctx));assert.equal(renders,2);assert.deepEqual(pixel(pixels,20,20),[0,0,255,255]);
    const count=platform.VisualImages.Count;parent.Dispose();assert.ok(platform.VisualImages.Count<count);
});

test('native blur and drop shadow affect pixels outside original geometry', () => {
    const blur=render(ctx=>{const s=ctx.PushEffect(new BlurEffect(12));try {ctx.DrawRectangle('#ff0000',null,new Rect(30,30,40,40));}finally{s.Dispose();}});
    assert.ok(pixel(blur,25,50)[3]>0);assert.ok(pixel(blur,50,50)[3]>200);
    const shadow=render(ctx=>{const s=ctx.PushEffect(new DropShadowEffect({OffsetX:15,OffsetY:0,BlurRadius:2,Color:'#0000ff'}));try{ctx.DrawRectangle('#ff0000',null,new Rect(30,30,30,30));}finally{s.Dispose();}});
    assert.ok(pixel(shadow,70,45)[2]>100);
});

test('inset shadows are clipped to the border and darken interior edge', () => {
    const pixels=render(ctx=>ctx.DrawRectangle('#ffffff',null,new Rect(10,10,80,80),8,8,[new BoxShadow({IsInset:true,OffsetX:5,OffsetY:5,Blur:6,Color:'#000000'})]));
    assert.equal(pixel(pixels,0,0)[3],0);assert.ok(pixel(pixels,13,45)[0]<pixel(pixels,50,50)[0]);
});

test('acrylic filters the existing native surface before applying material tint', () => {
    const material=new ExperimentalAcrylicMaterial({TintColor:'#ffffff',TintOpacity:.2,BlurRadius:20});
    const pixels=render(ctx=>{ctx.DrawRectangle('#ff0000',null,new Rect(0,0,50,100));ctx.DrawRectangle('#0000ff',null,new Rect(50,0,50,100));ctx.DrawAcrylic(material,new Rect(10,10,80,80),8);});
    const p=pixel(pixels,49,50);assert.ok(p[0]>60 && p[2]>60);assert.equal(pixel(pixels,0,0)[1],0);
});
test.after(()=>platform.Dispose());
