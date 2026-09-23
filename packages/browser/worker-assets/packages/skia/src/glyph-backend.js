import { Rect } from "../../base/src/index.js";
import { FontMetrics, GlyphTypeface } from "../../media/src/index.js";

const rect = b => new Rect(b.Left,b.Top,b.Width,b.Height);
function table(face, name) {
    const b=face.GetTableData(name);return b?new DataView(b.buffer,b.byteOffset,b.byteLength):null;
}
const i16=(view,offset,fallback=0)=>view&&offset+2<=view.byteLength?view.getInt16(offset,false):fallback;
const u16=(view,offset,fallback=0)=>view&&offset+2<=view.byteLength?view.getUint16(offset,false):fallback;
function metrics(face,font) {
    const os=table(face,'OS/2'),hhea=table(face,'hhea'),post=table(face,'post'),native=font.Metrics;
    // OpenType USE_TYPO_METRICS is authoritative when present; hhea otherwise.
    // Values use Avalonia's y-down ascent/descent convention, unlike font tables.
    const typo=!!(u16(os,62)&0x80),em=face.UnitsPerEm;
    let ascent=typo?i16(os,68):i16(hhea,4),descent=typo?i16(os,70):i16(hhea,6),gap=typo?i16(os,72):i16(hhea,8);
    if(ascent===0||descent===0){ascent=i16(os,68);descent=i16(os,70);gap=i16(os,72);}
    if(ascent===0||descent===0){ascent=u16(os,74,-native.Ascent);descent=-u16(os,76,native.Descent);gap=0;}
    return new FontMetrics({DesignEmHeight:em,Ascent:-ascent,Descent:-descent,LineGap:gap,IsFixedPitch:face.IsFixedPitch,
        UnderlinePosition:-i16(post,8,-(native.UnderlinePosition??0)),UnderlineThickness:i16(post,10,native.UnderlineThickness??0),
        StrikethroughPosition:-i16(os,28,-(native.StrikeoutPosition??0)),StrikethroughThickness:i16(os,26,native.StrikeoutThickness??0)});
}
function makeFont(S,face,size) {
    const font=new S.SKFont(face,size);
    try { font.Subpixel=true;font.Hinting=S.SKFontHinting.None;font.Edging=S.SKFontEdging.Antialias;
        font.LinearMetrics=true;font.BaselineSnap=false;return font;
    } catch(error){font.Dispose();throw error;}
}
/** Create an independently reference-counted font adapter; native font/heap
 * identity stays in this realm. Explicit bytes are sufficient for worker reload. */
export function CreateSkiaGlyphTypeface(S,data,options={}) {
    if(!options||typeof options!=='object')throw new TypeError('Glyph typeface options must be an object.');
    const index=options.FontIndex??0;
    if(!Number.isSafeInteger(index)||index<0||index>65535)throw new RangeError('Invalid FontIndex.');
    if(!(data instanceof ArrayBuffer)&&!ArrayBuffer.isView(data))throw new TypeError('Font data must be a byte buffer.');
    const input=data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
    if(input.byteLength===0||input.byteLength>64*1024*1024)throw new RangeError('Font data must contain 1–67108864 bytes.');
    const bytes=input.slice();let face,design;
    try {
        face=S.SKTypeface.FromData(bytes,index);
        if(!face||!(face.UnitsPerEm>0))throw new Error('Native Skia could not load the supplied glyph typeface.');
        design=makeFont(S,face,face.UnitsPerEm);
        const adapter={
            Api:S,Descriptor:Object.freeze({Bytes:bytes,FontIndex:index}),FamilyName:face.FamilyName,
            Metrics:metrics(face,design),GlyphCount:face.GlyphCount,Weight:face.FontWeight,
            Style:face.IsItalic?'Italic':'Normal',Stretch:face.FontWidth,IsColorFont:face.IsColor,
            GetGlyph:codepoint=>face.GetGlyph(codepoint),GetGlyphs:text=>face.GetGlyphs(text),
            GetGlyphAdvances:ids=>{verifyIds(ids,face.GlyphCount);return design.GetGlyphWidths(ids);},
            GetGlyphMetrics(id){verifyIds([id],face.GlyphCount);const b=design.GetGlyphBounds([id])[0];
                const vhea=table(face,'vhea'),vmtx=table(face,'vmtx'),count=u16(vhea,34);
                return Object.freeze({XBearing:b.Left,YBearing:-b.Top,Width:b.Width,Height:b.Height,
                    AdvanceWidth:design.GetGlyphWidths([id])[0],AdvanceHeight:count?u16(vmtx,Math.min(id,count-1)*4):0,
                    XOffset:0,YOffset:0,VerticalOriginX:0,VerticalOriginY:0});
            },
            GetTable:tag=>face.GetTableData(tag),
            CreateRun(size,infos,baseline){return createRun(S,face,size,infos,baseline);},
            Dispose(){design.Dispose();face.Dispose();}
        };
        return new GlyphTypeface(adapter);
    }catch(error){design?.Dispose();face?.Dispose();throw error;}
}
function verifyIds(ids,count){for(const id of ids)if(id>=count)throw new RangeError(`Glyph ${id} is outside the typeface (${count} glyphs).`);}
function createRun(S,face,size,infos,baseline) {
    const ids=infos.map(g=>g.GlyphIndex);verifyIds(ids,face.GlyphCount);
    const font=makeFont(S,face,size);let blob=null;
    try {
        let x=0;const positions=infos.map(g=>{const p={X:x+g.GlyphOffset.X,Y:g.GlyphOffset.Y};x+=g.GlyphAdvance;return p;});
        if(ids.length)blob=S.SKTextBlob.CreatePositioned(ids,font,positions);
        if(ids.length&&!blob)throw new Error('Native Skia failed to create a positioned glyph blob.');
        const b=blob?.Bounds;
        const bounds=b?new Rect(b.Left+baseline.X,b.Top+baseline.Y,b.Width,b.Height):Rect.Empty;
        let geometry=null,disposed=false;
        const verify=()=>{if(disposed)throw new Error('Native glyph run is disposed.');};
        return {
            Bounds:bounds,
            Draw(canvas,paint){verify();if(blob)canvas.DrawTextBlob(blob,baseline.X,baseline.Y,paint);},
            BuildGeometry(){verify();if(geometry!=null)return geometry;const result=new S.SKPath();
                try{for(let i=0;i<ids.length;i++){const path=font.GetGlyphPath(ids[i]);try{if(path)result.AddPath(path,positions[i].X+baseline.X,positions[i].Y+baseline.Y);}finally{path?.Dispose();}}
                    return geometry=result.ToSvgPathData();
                }finally{result.Dispose();}
            },
            GetIntersections(lower,upper){verify();if(!ids.length)return new Float32Array();
                // Upstream returns intersections in the run's local baseline frame.
                return font.GetGlyphIntercepts(ids,positions,lower,upper);
            },
            Dispose(){if(disposed)return;disposed=true;blob?.Dispose();font.Dispose();geometry=null;}
        };
    }catch(error){blob?.Dispose();font.Dispose();throw error;}
}
