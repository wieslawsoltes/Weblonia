import * as A from '@wieslawsoltes/avalonia';
/** Native geometry plus explicitly supplied font glyphs. This sample embeds no
 * font file and does not substitute a browser string for positioned glyph IDs. */
export class GlyphPathDemo extends A.Control {
    constructor(){
        super();this._phase=0;
        this.Segment=new A.BezierSegment(new A.Point(120,0),new A.Point(200,150),new A.Point(270,55));
        this.Figure=new A.PathFigure(new A.Point(24,55),[this.Segment,new A.LineSegment(new A.Point(270,115)),new A.LineSegment(new A.Point(24,115))],true);
        this.Geometry=new A.PathGeometry([this.Figure]);this.Geometry.Transform=new A.TranslateTransform();
        this.Brush=new A.SolidColorBrush(A.Color.Parse('#6757d9'));this.Pen=new A.Pen('#25283d',3);
        this._lifetime.Add(this.Geometry.Changed.Add(()=>this.InvalidateVisual()));
    }
    MeasureOverride(){return new A.Size(650,245);}
    ToggleFill(){this.Figure.IsFilled=!this.Figure.IsFilled;}
    ToggleStroke(){this.Segment.IsStroked=!this.Segment.IsStroked;}
    Retarget(){this._phase^=1;this.Geometry.Transform.X=this._phase?28:0;
        if(this.Glyphs)this.Glyphs.GlyphInfos=this._baseInfos.map((g,i)=>new A.GlyphInfo(g.GlyphIndex,g.GlyphCluster,g.GlyphAdvance,new A.Vector(0,Math.sin(i*.9+this._phase*Math.PI)*8)));
    }
    LoadFont(bytes){
        if(this.IsDisposed)return;
        const face=A.GlyphTypeface.FromData(bytes);let glyphs;
        try{const text='AVALONIA',ids=face.GetGlyphs(text);glyphs=new A.GlyphRun(face,36,text,ids,new A.Point(24,202));
            this._glyphChanged?.Dispose();this.Glyphs?.Dispose();this._face?.Dispose();this._face=face;this.Glyphs=glyphs;this._baseInfos=glyphs.GlyphInfos;
            this._glyphChanged=glyphs.Changed.Add(()=>this.InvalidateVisual());this.InvalidateVisual();return face.FamilyName;
        }catch(error){glyphs?.Dispose();face.Dispose();throw error;}
    }
    Render(context){
        context.DrawGeometry(this.Figure.IsFilled?this.Brush:null,this.Pen,this.Geometry);
        this.DrawText(context,`IsFilled: ${this.Figure.IsFilled} · curved segment IsStroked: ${this.Segment.IsStroked}`,new A.Rect(24,125,this.Bounds.Width-48,28),{FontSize:13});
        if(this.Glyphs)context.DrawGlyphRun(this.Brush,this.Glyphs);
        else this.DrawText(context,'Choose your own font to draw native positioned glyphs.\nNo font is bundled or downloaded automatically.',new A.Rect(24,169,this.Bounds.Width-48,66),{FontSize:14});
    }
    Dispose(){if(this.IsDisposed)return;this._glyphChanged?.Dispose();this.Glyphs?.Dispose();this._face?.Dispose();
        this.Geometry.Transform.Dispose();this.Geometry.Dispose();for(const s of this.Figure.Segments)s.Dispose();this.Figure.Dispose();this.Brush.Dispose();this.Pen.Dispose();super.Dispose();}
}
