import { Disposable, Event, Point, Vector, Rect, Size } from "../../base/src/index.js";
import { CharacterHit } from './text-formatting.js';
import { StreamGeometry } from './geometry.js';

const providers = [];
/** Register a realm-local native glyph provider. Disposing registrations out of
 * order restores the most recent remaining provider, without retaining a platform. */
export function RegisterGlyphTypefaceBackend(factory) {
    if (typeof factory !== 'function') throw new TypeError('A glyph typeface factory is required.');
    const entry = { Factory: factory }; providers.push(entry);
    return Disposable.Create(() => { const i = providers.indexOf(entry); if (i >= 0) providers.splice(i, 1); });
}
const finite = (v, name) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${name} must be finite.`); return v; };
const integer = (v, name, max = Number.MAX_SAFE_INTEGER) => {
    if (!Number.isSafeInteger(v) || v < 0 || v > max) throw new RangeError(`${name} is outside its supported range.`); return v;
};
const coordinate = (p, name) => { if (!p) throw new TypeError(`${name} is required.`); return Object.freeze(new Point(finite(p.X, name+'.X'), finite(p.Y, name+'.Y'))); };
const MAX_GLYPHS = 1000000;

export class FontMetrics {
    constructor(values) {
        for (const name of ['DesignEmHeight','Ascent','Descent','LineGap','UnderlinePosition','UnderlineThickness','StrikethroughPosition','StrikethroughThickness'])
            this[name] = finite(values[name], name);
        if (this.DesignEmHeight <= 0) throw new RangeError('DesignEmHeight must be positive.');
        this.IsFixedPitch = !!values.IsFixedPitch;
        Object.freeze(this);
    }
    get LineSpacing() { return this.Descent - this.Ascent + this.LineGap; }
}
/** Native font resource with independently disposable references. No font is
 * downloaded, substituted or embedded implicitly. Caller-supplied bytes are
 * copied by the platform before constructing the native face. */
export class GlyphTypeface extends Disposable {
    constructor(platformTypeface, sharedState = null) {
        super();
        if (!sharedState && (!platformTypeface || typeof platformTypeface.CreateRun !== 'function' || typeof platformTypeface.Dispose !== 'function'))
            throw new TypeError('A platform glyph typeface implementation is required.');
        this._state = sharedState ?? { Adapter: platformTypeface, References: 0 };
        ++this._state.References;
    }
    _Verify() { if (this.IsDisposed) throw new Error('GlyphTypeface is disposed.'); return this._state.Adapter; }
    static FromData(bytes, options = {}) {
        const provider = providers.at(-1)?.Factory;
        if (!provider) throw new Error('GlyphTypeface.FromData requires a native glyph backend.');
        return provider(bytes, options);
    }
    Clone() { this._Verify(); return new GlyphTypeface(null, this._state); }
    get PlatformTypeface() { return this._Verify(); }
    get FamilyName() { return this._Verify().FamilyName; }
    get Metrics() { return this._Verify().Metrics; }
    get GlyphCount() { return this._Verify().GlyphCount; }
    get Weight() { return this._Verify().Weight; }
    get Style() { return this._Verify().Style; }
    get Stretch() { return this._Verify().Stretch; }
    get IsColorFont() { return this._Verify().IsColorFont; }
    get FontSimulations() { return this._Verify().FontSimulations ?? 'None'; }
    GetGlyph(codepoint) { return this._Verify().GetGlyph(integer(codepoint, 'codepoint', 0x10ffff)); }
    TryGetGlyph(codepoint) { const glyph = this.GetGlyph(codepoint); return { Success: glyph !== 0, Glyph: glyph }; }
    GetGlyphs(text) { return this._Verify().GetGlyphs(String(text)); }
    GetGlyphAdvance(glyph) { return this.GetGlyphAdvances([glyph])[0]; }
    GetGlyphAdvances(glyphs) { return this._Verify().GetGlyphAdvances(validateGlyphIds(glyphs)); }
    TryGetHorizontalGlyphAdvances(glyphs, advances = null) {
        const values = this.GetGlyphAdvances(glyphs);
        if (advances != null) {
            if (advances.length < values.length) throw new RangeError('The advance output buffer is too small.');
            for (let i=0;i<values.length;i++) advances[i]=values[i];
            return true;
        }
        return { Success: true, Advances: values };
    }
    TryGetGlyphMetrics(glyph) { return { Success: true, Metrics: this._Verify().GetGlyphMetrics(integer(glyph,'glyph',65535)) }; }
    TryGetTable(tag) { const table=this._Verify().GetTable(tag);return {Success:table!=null,Table:table?.slice()??null}; }
    /** Immutable descriptor access is internal to the portable resource encoder.
     * Public byte export always returns a copy. */
    GetFontData() { return this._Verify().Descriptor.Bytes.slice(); }
    _Descriptor() { return this._Verify().Descriptor; }
    _Identity() { this._Verify(); return this._state; }
    Dispose() {
        if (this.IsDisposed) return;
        const state=this._state;this._state=null;super.Dispose();
        if (--state.References === 0) { state.Adapter.Dispose(); state.Adapter=null; }
    }
}
function validateGlyphIds(value) {
    if (!value || !Number.isSafeInteger(value.length) || value.length > MAX_GLYPHS) throw new RangeError('Invalid glyph sequence length.');
    return Array.from(value, g => integer(g,'glyph',65535));
}
export class GlyphInfo {
    constructor(glyphIndex, glyphCluster, glyphAdvance, glyphOffset = new Vector()) {
        this.GlyphIndex=integer(glyphIndex,'GlyphIndex',65535);
        this.GlyphCluster=integer(glyphCluster,'GlyphCluster');
        this.GlyphAdvance=finite(glyphAdvance,'GlyphAdvance');
        const offset=coordinate(glyphOffset,'GlyphOffset');this.GlyphOffset=Object.freeze(new Vector(offset.X,offset.Y));Object.freeze(this);
    }
}
export class GlyphRunMetrics {
    constructor(values) { Object.assign(this, values); Object.freeze(this); }
}
/** Explicit positioned glyph IDs from ONE font. This is not a text shaper:
 * callers of the GlyphInfo overload supply shaping, bidi order and UTF-16
 * clusters. Existing TextLayout/SkParagraph shaping is intentionally unchanged.
 * Immutable snapshots protect retained and in-flight render transactions. */
export class GlyphRun extends Disposable {
    constructor(glyphTypeface, fontRenderingEmSize, characters = '', glyphs = [], baselineOrigin = null, biDiLevel = 0) {
        super();
        if (!(glyphTypeface instanceof GlyphTypeface) || glyphTypeface.IsDisposed) throw new TypeError('A live GlyphTypeface is required.');
        this.Changed=new Event();this.Invalidated=this.Changed;this._revision=0;
        this._size=checkSize(fontRenderingEmSize);this._characters=String(characters);
        this._level=integer(biDiLevel,'BiDiLevel',125);this._baseline=baselineOrigin==null?null:coordinate(baselineOrigin,'BaselineOrigin');
        this._face=glyphTypeface.Clone();
        try { this._infos=this._CopyInfos(glyphs); this._BuildClusters(); }
        catch(error){this._face.Dispose();super.Dispose();throw error;}
    }
    _Verify() { if(this.IsDisposed)throw new Error('GlyphRun is disposed.'); }
    get GlyphTypeface(){this._Verify();return this._face;}
    get FontRenderingEmSize(){return this._size;}
    set FontRenderingEmSize(value){this._Set('_size',checkSize(value));}
    get Characters(){return this._characters;}
    set Characters(value){this._Set('_characters',String(value));}
    get BiDiLevel(){return this._level;}
    set BiDiLevel(value){this._Set('_level',integer(value,'BiDiLevel',125));}
    get IsLeftToRight(){return (this._level&1)===0;}
    get Scale(){this._Verify();return this._size/this._face.Metrics.DesignEmHeight;}
    get BaselineOrigin(){this._Verify();return this._baseline??Object.freeze(new Point(0,this.Metrics.Baseline));}
    set BaselineOrigin(value){this._Set('_baseline',value==null?null:coordinate(value,'BaselineOrigin'));}
    get GlyphInfos(){this._Verify();return this._infos;}
    set GlyphInfos(value){this._Verify();const infos=this._CopyInfos(value);validateClusters(infos);this._Set('_infos',infos);}
    _CopyInfos(values){
        if(!values||!Number.isSafeInteger(values.length)||values.length>MAX_GLYPHS)throw new RangeError('Invalid glyph run length.');
        if(values.length && typeof values[0]==='number'){
            const ids=validateGlyphIds(values),advances=this._face.GetGlyphAdvances(ids),scale=this.Scale;
            return Object.freeze(ids.map((id,i)=>new GlyphInfo(id,i,advances[i]*scale)));
        }
        return Object.freeze(Array.from(values,v=>new GlyphInfo(v.GlyphIndex,v.GlyphCluster,v.GlyphAdvance,v.GlyphOffset??new Vector())));
    }
    _Set(field,value){
        this._Verify();const old=this[field];
        if(old===value || field==='_baseline'&&old&&value&&old.X===value.X&&old.Y===value.Y)return;
        this[field]=value;this._metrics=this._clusters=this._descriptor=null;
        this._native?.Dispose();this._native=null;this._nativeApi=null;++this._revision;this.Changed.Raise(this,{});
    }
    _BuildClusters(){
        if(this._clusters)return this._clusters;
        validateClusters(this._infos);
        const physical=[];let x=0,monotonic=true;
        for(let i=0;i<this._infos.length;i++){
            const info=this._infos[i];let group=physical.at(-1);
            if(!group||group.Start!==info.GlyphCluster){group={Start:info.GlyphCluster,FirstGlyph:i,LastGlyph:i,Left:x,Right:x};physical.push(group);}
            x+=info.GlyphAdvance;if(!Number.isFinite(x))throw new RangeError('Glyph advance sum is not finite.');
            monotonic&&=info.GlyphAdvance>=0;group.Right=x;group.LastGlyph=i;
        }
        const logical=[...physical].sort((a,b)=>a.Start-b.Start),first=logical[0]?.Start??0;
        for(let i=0;i<logical.length;i++){
            const end=logical[i+1]?.Start??Math.max(logical[i].Start+1,first+this._characters.length);
            logical[i].Length=end-logical[i].Start;logical[i].LogicalIndex=i;Object.freeze(logical[i]);
        }
        return this._clusters={Physical:physical,Logical:logical,Width:x,Monotonic:monotonic};
    }
    get Metrics(){
        this._Verify();if(this._metrics)return this._metrics;
        const c=this._BuildClusters(),f=this._face.Metrics,s=this.Scale;
        const trailing=this._characters.match(/\s+$/u)?.[0].length??0;
        const newline=this._characters.match(/(?:\r\n|[\n\r\u0085\u2028\u2029])$/u)?.[0].length??0;
        const first=c.Logical[0]?.Start??0,last=c.Logical.at(-1)?.Start??Math.max(0,this._characters.length-1);
        const trailingStart=first+this._characters.length-trailing;let width=c.Width;
        if(trailing)for(const group of c.Logical)if(group.Start>=trailingStart)width-=group.Right-group.Left;
        this._metrics=new GlyphRunMetrics({Baseline:(-f.Ascent+f.LineGap*.5)*s,Width:width,
            WidthIncludingTrailingWhitespace:c.Width,Height:f.LineSpacing*s,TrailingWhitespaceLength:trailing,
            NewLineLength:newline,FirstCluster:first,LastCluster:last});return this._metrics;
    }
    get Bounds(){const m=this.Metrics;return new Rect(this.BaselineOrigin.X,0,m.WidthIncludingTrailingWhitespace,m.Height);}
    get InkBounds(){return this._GetNative().Bounds;}
    _Logical(index){const groups=this._BuildClusters().Logical;if(!groups.length)return null;
        let lo=0,hi=groups.length;while(lo<hi){const mid=(lo+hi)>>>1;if(groups[mid].Start<=index)lo=mid+1;else hi=mid;}return groups[Math.max(0,lo-1)];}
    FindGlyphIndex(characterIndex){this._Verify();if(!Number.isSafeInteger(characterIndex))throw new TypeError('characterIndex must be an integer.');const g=this._Logical(characterIndex);return g?(this.IsLeftToRight?g.FirstGlyph:g.LastGlyph):0;}
    /** JavaScript out-parameter form: { CharacterHit, Width }. */
    FindNearestCharacterHit(characterIndex){this._Verify();if(!Number.isSafeInteger(characterIndex))throw new TypeError('characterIndex must be an integer.');const g=this._Logical(characterIndex);
        return {CharacterHit:g?new CharacterHit(g.Start,g.Length):new CharacterHit(0,this._characters.length),Width:g?g.Right-g.Left:0};}
    GetDistanceFromCharacterHit(hit){
        this._Verify();integer(hit?.FirstCharacterIndex,'FirstCharacterIndex');integer(hit?.TrailingLength,'TrailingLength');
        const c=this._BuildClusters();if(!c.Logical.length)return 0;
        const index=hit.FirstCharacterIndex+hit.TrailingLength,first=c.Logical[0],last=c.Logical.at(-1);
        if(index<=first.Start)return this.IsLeftToRight?first.Left:first.Right;
        if(index>=last.Start+last.Length)return this.IsLeftToRight?last.Right:last.Left;
        const g=this._Logical(index);
        return index>g.Start?(this.IsLeftToRight?g.Right:g.Left):(this.IsLeftToRight?g.Left:g.Right);
    }
    /** JavaScript out-parameter form: { CharacterHit, IsInside }. */
    GetCharacterHitFromDistance(distance){
        this._Verify();finite(distance,'distance');const c=this._BuildClusters(),p=c.Physical;
        if(!p.length)return{CharacterHit:new CharacterHit(0),IsInside:false};
        let group;
        if(c.Monotonic){let lo=0,hi=p.length;while(lo<hi){const mid=(lo+hi)>>>1;if(p[mid].Right<=distance)lo=mid+1;else hi=mid;}group=p[Math.min(lo,p.length-1)];}
        else{let best=Infinity;for(const g of p){const d=Math.min(Math.abs(distance-g.Left),Math.abs(distance-g.Right));if(d<best){best=d;group=g;}}}
        const leading=this.IsLeftToRight?group.Left:group.Right,trailingEdge=this.IsLeftToRight?group.Right:group.Left;
        const trailing=Math.abs(distance-trailingEdge)<Math.abs(distance-leading);
        return{CharacterHit:new CharacterHit(group.Start,trailing?group.Length:0),IsInside:distance>0&&distance<c.Width};
    }
    GetNextCaretCharacterHit(hit){this._Verify();const c=this._BuildClusters().Logical;if(!c.length)return new CharacterHit(0,this._characters.length);
        const index=integer(hit.FirstCharacterIndex,'FirstCharacterIndex')+integer(hit.TrailingLength,'TrailingLength'),g=this._Logical(index),i=g.LogicalIndex;
        if(hit.TrailingLength>0)return new CharacterHit(g.Start,g.Length);
        return i+1<c.length?new CharacterHit(c[i+1].Start):new CharacterHit(g.Start,g.Length);
    }
    GetPreviousCaretCharacterHit(hit){this._Verify();const c=this._BuildClusters().Logical;if(!c.length)return new CharacterHit(0);
        const g=this._Logical(integer(hit.FirstCharacterIndex,'FirstCharacterIndex')),i=g.LogicalIndex;
        return hit.TrailingLength>0?new CharacterHit(g.Start):new CharacterHit(c[Math.max(0,i-1)].Start);
    }
    _GetNative(platform=null){
        this._Verify();const own=this._face.PlatformTypeface,api=platform?.Api??own.Api;
        if(this._native && this._nativeApi===api)return this._native;
        let foreign;
        try{
            const adapter=api===own.Api?own:(foreign=platform.CreateGlyphTypeface(own.Descriptor.Bytes,{FontIndex:own.Descriptor.FontIndex})).PlatformTypeface;
            const next=adapter.CreateRun(this._size,this._infos,this.BaselineOrigin);
            this._native?.Dispose();this._native=next;this._nativeApi=api;return next;
        }finally{foreign?.Dispose();}
    }
    BuildGeometry(){const geometry=new StreamGeometry(this._GetNative().BuildGeometry());geometry.FillRule='NonZero';return geometry;}
    GetIntersections(lowerLimit,upperLimit){finite(lowerLimit,'lowerLimit');finite(upperLimit,'upperLimit');if(upperLimit<lowerLimit)throw new RangeError('Intersection limits are reversed.');return this._GetNative().GetIntersections(lowerLimit,upperLimit);}
    TryCreateImmutableGlyphRunReference(){this._Verify();return new ImmutableGlyphRunReference(this);}
    _Snapshot(){this._Verify();return new GlyphRun(this._face,this._size,this._characters,this._infos,this._baseline,this._level);}
    _Descriptor(){this._Verify();return this._descriptor??=Object.freeze({Size:this._size,Characters:this._characters,BiDiLevel:this._level,
        Baseline:Object.freeze([this.BaselineOrigin.X,this.BaselineOrigin.Y]),
        Glyphs:Object.freeze(this._infos.map(g=>Object.freeze([g.GlyphIndex,g.GlyphCluster,g.GlyphAdvance,g.GlyphOffset.X,g.GlyphOffset.Y])))});}
    Dispose(){if(this.IsDisposed)return;this._native?.Dispose();this._native=null;this._nativeApi=null;this._face.Dispose();this.Changed.Clear();this._infos=[];this._characters='';this._clusters=this._metrics=this._descriptor=null;super.Dispose();}
}
function checkSize(v){finite(v,'FontRenderingEmSize');if(v<=0||v>1000000)throw new RangeError('FontRenderingEmSize must be positive and bounded.');return v;}
function validateClusters(infos){const seen=new Set();let previous=-1,total=0;for(const g of infos){if(g.GlyphCluster!==previous){if(seen.has(g.GlyphCluster))throw new TypeError('One glyph cluster must be contiguous in visual glyph order.');seen.add(g.GlyphCluster);previous=g.GlyphCluster;}total+=g.GlyphAdvance;if(!Number.isFinite(total))throw new RangeError('Glyph advance sum is not finite.');}}
/** Retained immutable reference. Its native and font lifetimes are independent
 * of both the mutable run and the caller's original typeface handle. */
export class ImmutableGlyphRunReference extends Disposable {
    constructor(run){super();this._run=run._Snapshot();}
    _Verify(){if(this.IsDisposed)throw new Error('ImmutableGlyphRunReference is disposed.');return this._run;}
    get BaselineOrigin(){return this._Verify().BaselineOrigin;}
    get Bounds(){return this._Verify().Bounds;}
    get InkBounds(){return this._Verify().InkBounds;}
    get GlyphTypeface(){return this._Verify().GlyphTypeface;}
    _Descriptor(){return this._Verify()._Descriptor();}
    _GetNative(platform){return this._Verify()._GetNative(platform);}
    _Snapshot(){return this._Verify()._Snapshot();}
    TryCreateImmutableGlyphRunReference(){return new ImmutableGlyphRunReference(this._Verify());}
    Dispose(){if(this.IsDisposed)return;this._run.Dispose();this._run=null;super.Dispose();}
}
