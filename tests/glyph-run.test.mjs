import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as A from '@wieslawsoltes/avalonia';
import { Initialize } from '../vendor/skiasharpweb/dist/package/node.js';
const bytes=readFileSync(process.env.AVALONIA_TEST_FONT??'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
const S=await Initialize({fonts:false}),platform=await A.SkiaPlatform.Initialize({Api:S});
test.after(()=>platform.Dispose());
function face(){return platform.CreateGlyphTypeface(bytes);}
function run(t,infos=null,text='ABC',level=0){const f=face(),r=new A.GlyphRun(f,24,text,infos??f.GetGlyphs(text),null,level);t.after(()=>{r.Dispose();f.Dispose();});return r;}
const info=(cluster,advance=10,x=0,y=0)=>new A.GlyphInfo(36,cluster,advance,new A.Vector(x,y));
function pixels(action,width=160,height=90){const surface=S.SKSurface.Create(new S.SKImageInfo(width,height)),c=new A.SkiaDrawingContext(platform,surface.Canvas);
    try{surface.Canvas.Clear(S.SKColors.White);action(c,surface.Canvas);const image=surface.Snapshot();try{return image.ReadPixels(new S.SKImageInfo(width,height,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul));}finally{image.Dispose();}}
    finally{c.Dispose();surface.Dispose();}}
function difference(a,b){assert.equal(a.length,b.length);let max=0,ink=0;for(let i=0;i<a.length;i++){max=Math.max(max,Math.abs(a[i]-b[i]));if(i%4!==3&&a[i]<250)ink++;}assert.ok(ink>10);assert.ok(max<=2,`maximum RGBA error ${max}`);return max;}

test('glyph typeface exposes native font metrics and independently owned data/table copies',()=>{
    const f=face();try{assert.ok(f.GlyphCount>1000);assert.equal(f.Metrics.DesignEmHeight,2048);assert.ok(f.Metrics.Ascent<0&&f.Metrics.Descent>0);
        assert.equal(f.Metrics.LineSpacing,f.Metrics.Descent-f.Metrics.Ascent+f.Metrics.LineGap);assert.ok(Object.isFrozen(f.Metrics));
        const copy=f.GetFontData();copy.fill(0);assert.notEqual(f.GetFontData()[1],0);const table=f.TryGetTable('head');assert.ok(table.Success);table.Table.fill(0);assert.notEqual(f.TryGetTable('head').Table[18],0);
        assert.deepEqual(f.TryGetTable('nope'),{Success:false,Table:null});assert.equal(f.TryGetGlyph(65).Glyph,f.GetGlyph(65));assert.equal(f.TryGetGlyph(0x10ffff).Success,false);
    }finally{f.Dispose();}
});
test('glyph typeface design advances and metrics agree with native unhinted font',()=>{
    const f=face(),native=S.SKTypeface.FromData(bytes),font=new S.SKFont(native,f.Metrics.DesignEmHeight);
    try{font.Hinting=S.SKFontHinting.None;font.LinearMetrics=true;const ids=f.GetGlyphs('AB '),advance=f.GetGlyphAdvances(ids);assert.deepEqual(advance,font.GetGlyphWidths(ids));
        const target=new Float32Array(3);assert.equal(f.TryGetHorizontalGlyphAdvances(ids,target),true);assert.deepEqual(target,advance);assert.throws(()=>f.TryGetHorizontalGlyphAdvances(ids,new Uint16Array(1)),/small/);
        assert.equal(f.TryGetGlyphMetrics(ids[0]).Metrics.AdvanceWidth,advance[0]);assert.ok(f.TryGetGlyphMetrics(ids[0]).Metrics.Height>0);
    }finally{font.Dispose();native.Dispose();f.Dispose();}
});
test('glyph typeface and immutable run survive disposal of caller-owned original handles',()=>{
    const f=face(),r=new A.GlyphRun(f,24,'AB',f.GetGlyphs('AB'));f.Dispose();const reference=r.TryCreateImmutableGlyphRunReference();r.Dispose();
    try{const result=pixels(c=>c.DrawGlyphRun(A.Brushes.Black,reference));assert.ok(result.some((v,i)=>i%4!==3&&v<100));assert.ok(reference.InkBounds.Width>0);}
    finally{reference.Dispose();reference.Dispose();}
    assert.throws(()=>reference.InkBounds,/disposed/);
});
test('glyph input records and offsets are immutable snapshots, not caller-owned buffers',t=>{
    const values=[{GlyphIndex:36,GlyphCluster:0,GlyphAdvance:10,GlyphOffset:{X:1,Y:2}}],r=run(t,values,'A');values[0].GlyphOffset.X=99;values.push(info(1));
    assert.equal(r.GlyphInfos.length,1);assert.equal(r.GlyphInfos[0].GlyphOffset.X,1);assert.throws(()=>r.GlyphInfos[0].GlyphOffset.X=8,TypeError);assert.throws(()=>r.GlyphInfos.push(info(2)),TypeError);
});
for(const [name,change]of[['size',r=>r.FontRenderingEmSize=31],['baseline',r=>r.BaselineOrigin=new A.Point(6,36)],['characters',r=>r.Characters='ABC '],['glyphs',r=>r.GlyphInfos=[info(0,20)]],['bidi',r=>r.BiDiLevel=1]]){
    test(`glyph run ${name} mutation invalidates immutable descriptors/native state once`,t=>{
        const r=run(t),native=r._GetNative(),description=r._Descriptor();let changes=0;r.Changed.Add(()=>changes++);change(r);
        assert.equal(changes,1);assert.notEqual(r._Descriptor(),description);assert.notEqual(r._GetNative(),native);assert.throws(()=>native.Draw(null,null),/disposed/);
    });
}
test('unchanged native glyph redraws and equivalent baseline assignments retain the same blob',t=>{
    const r=run(t);r.BaselineOrigin=new A.Point(3,30);const n=r._GetNative(),d=r._Descriptor();let changes=0;r.Changed.Add(()=>changes++);
    for(let i=0;i<1000;i++){r.BaselineOrigin=new A.Point(3,30);assert.equal(r._GetNative(),n);assert.equal(r._Descriptor(),d);}assert.equal(changes,0);
});
test('invalid glyph fields and malformed replacement leave original run intact',t=>{
    const r=run(t),before=r.GlyphInfos;
    for(const values of [[info(0),info(1),info(0)],[{GlyphIndex:70000,GlyphCluster:0,GlyphAdvance:10}], [{GlyphIndex:1,GlyphCluster:0,GlyphAdvance:NaN}]])assert.throws(()=>r.GlyphInfos=values);
    assert.equal(r.GlyphInfos,before);for(const v of [NaN,Infinity,0,-1])assert.throws(()=>r.FontRenderingEmSize=v);
    assert.equal(r.FontRenderingEmSize,24);assert.throws(()=>r.BaselineOrigin={X:NaN,Y:0});assert.throws(()=>r.BiDiLevel=-1);
});
test('glyph-less text has finite baseline metrics and native empty ink',t=>{
    const r=run(t,[],'\r\n');assert.equal(r.Metrics.NewLineLength,2);assert.equal(r.Metrics.TrailingWhitespaceLength,2);assert.equal(r.Metrics.Width,0);assert.ok(r.Metrics.Height>0);assert.equal(r.InkBounds.Width,0);
    assert.deepEqual(r.GetCharacterHitFromDistance(0),{CharacterHit:new A.CharacterHit(0),IsInside:false});assert.deepEqual(r.GetIntersections(-10,-5),new Float32Array());
});
test('glyph run excludes trailing whitespace without dropping Unicode UTF-16 cluster lengths',t=>{
    const r=run(t,[info(0,12),info(2,6),info(3,0),info(4,0)],'😀 \r\n');
    assert.equal(r.Metrics.Width,12);assert.equal(r.Metrics.WidthIncludingTrailingWhitespace,18);assert.equal(r.Metrics.TrailingWhitespaceLength,3);assert.equal(r.Metrics.NewLineLength,2);
    assert.deepEqual(r.FindNearestCharacterHit(1),{CharacterHit:new A.CharacterHit(0,2),Width:12});assert.equal(r.GetDistanceFromCharacterHit(new A.CharacterHit(0,2)),12);
});
for(const rtl of [false,true])test(`glyph caret cluster navigation in ${rtl?'RTL':'LTR'} visual order`,t=>{
    const records=[info(0,10),info(0,5),info(2,20),info(3,10)];if(rtl)records.reverse();const r=run(t,records,'fiAB',rtl?1:0);
    assert.deepEqual(r.FindNearestCharacterHit(1),{CharacterHit:new A.CharacterHit(0,2),Width:15});
    assert.equal(r.GetDistanceFromCharacterHit(new A.CharacterHit(0)),rtl?45:0);
    assert.equal(r.GetDistanceFromCharacterHit(new A.CharacterHit(0,2)),rtl?30:15);
    assert.equal(r.GetDistanceFromCharacterHit(new A.CharacterHit(3,1)),rtl?0:45);
    assert.deepEqual(r.GetCharacterHitFromDistance(rtl?40:4).CharacterHit,new A.CharacterHit(0));
    assert.deepEqual(r.GetCharacterHitFromDistance(rtl?31:14).CharacterHit,new A.CharacterHit(0,2));
    assert.deepEqual(r.GetNextCaretCharacterHit(new A.CharacterHit(0)),new A.CharacterHit(2));
    assert.deepEqual(r.GetPreviousCaretCharacterHit(new A.CharacterHit(2)),new A.CharacterHit(0));
    assert.deepEqual(r.GetNextCaretCharacterHit(new A.CharacterHit(3)),new A.CharacterHit(3,1));
    assert.equal(r.GetCharacterHitFromDistance(0).IsInside,false);assert.equal(r.GetCharacterHitFromDistance(45).IsInside,false);
});
test('glyph navigation handles nonzero source clusters and negative-advance fallback',t=>{
    const r=run(t,[info(10,20),info(11,-3),info(12,10)],'ABC');assert.equal(r.Metrics.FirstCluster,10);assert.equal(r.Metrics.LastCluster,12);
    assert.equal(r.GetDistanceFromCharacterHit(new A.CharacterHit(12)),17);assert.ok(Number.isFinite(r.GetDistanceFromCharacterHit(r.GetCharacterHitFromDistance(21).CharacterHit)));
});
for(const scale of [1,1.25,1.5,2,3])test(`native positioned glyph IDs and offsets preserve all RGBA at ${scale}x`,t=>{
    const f=face(),ids=f.GetGlyphs('CAB'),records=Array.from(ids,(id,i)=>new A.GlyphInfo(id,i,24+i,new A.Vector(i*.37,i%2?-4:3)));
    const r=new A.GlyphRun(f,24,'CAB',records,new A.Point(6.31,27.6));t.after(()=>{r.Dispose();f.Dispose();});
    const actual=pixels((c,canvas)=>{canvas.Scale(scale,scale);c.DrawGlyphRun(A.Brushes.Black,r);},480,180);
    const expected=pixels((_,canvas)=>{canvas.Scale(scale,scale);const native=S.SKTypeface.FromData(bytes),font=new S.SKFont(native,24),paint=new S.SKPaint({Color:S.SKColors.Black,IsAntialias:true});let blob;
        try{font.Hinting=S.SKFontHinting.None;font.Edging=S.SKFontEdging.Antialias;font.Subpixel=true;font.LinearMetrics=true;font.BaselineSnap=false;
            blob=S.SKTextBlob.CreatePositioned(ids,font,[{X:0,Y:3},{X:24.37,Y:-4},{X:49.74,Y:3}]);canvas.DrawTextBlob(blob,6.31,27.6,paint);
        }finally{blob?.Dispose();paint.Dispose();font.Dispose();native.Dispose();}},480,180);
    difference(actual,expected);
});
test('glyph run BuildGeometry includes explicit offsets and baseline; overlapping outlines remain filled',t=>{
    const f=face(),id=f.GetGlyph(65),r=new A.GlyphRun(f,30,'AA',[new A.GlyphInfo(id,0,0,new A.Vector(5,-2)),new A.GlyphInfo(id,1,20,new A.Vector(5,-2))],new A.Point(10,35));
    const g=r.BuildGeometry();try{assert.ok(g.Bounds.X>=15);const p=pixels(c=>c.DrawGeometry(A.Brushes.Red,null,g));assert.ok(p.some((v,i)=>i%4===1&&v<10));assert.ok(g.FillContains(new A.Point(20,26))||g.FillContains(new A.Point(21,25)));}
    finally{g.Dispose();r.Dispose();f.Dispose();}
});
test('GlyphRunDrawing tracks mutable runs while DrawingGroup.Open owns an immutable snapshot',t=>{
    const r=run(t),drawing=new A.GlyphRunDrawing(A.Brushes.Black,r),group=new A.DrawingGroup();let changes=0;drawing.Invalidated.Add(()=>changes++);
    try{const c=group.Open();c.DrawGlyphRun(A.Brushes.Black,r);c.Dispose();const before=pixels(c=>group.Draw(c));r.BaselineOrigin=new A.Point(70,30);assert.ok(changes>0);
        difference(pixels(c=>group.Draw(c)),before);r.Dispose();difference(pixels(c=>group.Draw(c)),before);
    }finally{drawing.Dispose();group.Dispose();}
});
for(const aot of [false,true])test(`${aot?'AOT':'runtime'} XAML GlyphRunDrawing uses actual extension resource and native rendering`,async t=>{
    const r=run(t);class RunExtension{ProvideValue(){return r;}}
    const registry=new A.XamlTypeRegistry().RegisterAssembly(A);registry.RegisterType('RunExtension',RunExtension,'urn:glyph-test');
    const c=new A.AvaloniaXamlCompiler({Registry:registry}).Compile('<GlyphRunDrawing xmlns="https://github.com/avaloniaui" xmlns:t="urn:glyph-test" Foreground="Blue" GlyphRun="{t:Run}"/>');
    const drawing=aot?(await import('data:text/javascript;base64,'+Buffer.from(c.JavaScript).toString('base64'))).Build(new A.AvaloniaXamlServices({Registry:registry})):c.Build();
    try{assert.equal(drawing.GlyphRun,r);difference(pixels(ctx=>drawing.Draw(ctx)),pixels(ctx=>ctx.DrawGlyphRun(A.Brushes.Blue,r)));}finally{drawing.Dispose();}
});
test('glyph backend registration unwinds out of order and never loads a fallback font silently',()=>{
    const one=A.RegisterGlyphTypefaceBackend(()=>1),two=A.RegisterGlyphTypefaceBackend(()=>2);
    assert.equal(A.GlyphTypeface.FromData(bytes),2);one.Dispose();assert.equal(A.GlyphTypeface.FromData(bytes),2);two.Dispose();const f=A.GlyphTypeface.FromData(bytes);assert.ok(f instanceof A.GlyphTypeface);f.Dispose();
});
test('native glyph validation rejects unknown IDs and invalid or oversized font bytes',()=>{
    assert.throws(()=>platform.CreateGlyphTypeface(new Uint8Array()),/Font data/);assert.throws(()=>platform.CreateGlyphTypeface(bytes,{FontIndex:-1}));
    assert.throws(()=>platform.CreateGlyphTypeface(new Uint8Array([1,2,3,4])));const f=face();try{assert.throws(()=>f.GetGlyphAdvance(65535),/outside/);}finally{f.Dispose();}
});
