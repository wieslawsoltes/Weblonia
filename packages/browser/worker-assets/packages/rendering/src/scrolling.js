import { Rect, Point, Matrix } from "../../base/src/index.js";
/** Opt-in compositor wheel scrolling. Captures a coverage contract, not controls.
 * Arbitrary wheel handlers, editable/native descendants and animated ancestors
 * require UI-thread handling and must not opt into this fast path. */
export function CaptureScrollPolicy(control) {
    if(!control.IsCompositorScrollingEnabled||!control.IsEffectivelyEnabled||!control.IsEffectivelyVisible||control.IsDeferredScrollingEnabled)return null;
    const ancestors=[control,...control.GetVisualAncestors()];if(ancestors.some(c=>c._compositionSelf||c._compositionChild))return null;
    if(control.GetVisualDescendants().some(c=>c.constructor.name==='TextBox'||c.NativeControlFactory||c.WorkerModule))return null;
    const chrome=control._chrome;if(!chrome||chrome.Horizontal.IsDragging||chrome.Vertical.IsDragging)return null;
    const offset=control.Offset??control.ScrollOffset,extent=control.Extent??control._touchScroll?.Extent,viewport=control.Viewport??control._touchScroll?.Viewport;
    if(!offset||!extent||!viewport)return null;
    const matrix=control.GetTransformToRoot();if(!matrix.HasInverse||Math.abs(matrix.M12)>1e-10||Math.abs(matrix.M21)>1e-10||matrix.M11<=0||matrix.M22<=0||ancestors.some(c=>c.Clip))return null;
    let rect=control._viewportRect??control._viewport?.Bounds??new Rect(viewport),global=rect.TransformToAABB(matrix);
    let child=control;for(const ancestor of control.GetVisualAncestors()){
        if(ancestor.ClipToBounds||ancestor.IsTopLevel)global=global.Intersect(new Rect(ancestor.Bounds.Size).TransformToAABB(ancestor.GetTransformToRoot()));
        const clip=ancestor.GetChildClip?.(child);if(clip)global=global.Intersect(clip.TransformToAABB(ancestor.GetTransformToRoot()));child=ancestor;
    }
    if(global.IsEmpty)return null;
    let content=[],headers=[],minY=0,maxY=Math.max(0,extent.Height-viewport.Height);
    if(control._realized){const realized=[...control._realized.entries()];if(!realized.length)return null;const indices=realized.map(([i])=>i);minY=Math.min(...indices)*control.ItemHeight;maxY=Math.max(minY,(Math.max(...indices)+1)*control.ItemHeight-viewport.Height);content=realized.map(([,c])=>c.VisualId);headers=control.HeadersPresenter?.VisualChildren.map(c=>c.VisualId)??[];}
    else if(control._contentChild)content=[control._contentChild.VisualId];else return null;
    const axisX=control.HorizontalScrollBarVisibility!=='Disabled',axisY=control.VerticalScrollBarVisibility!=='Disabled';
    return {Id:control.VisualId,Offset:[offset.X,offset.Y],Extent:[extent.Width,extent.Height],Viewport:[viewport.Width,viewport.Height],Region:[global.X,global.Y,global.Width,global.Height],Matrix:[matrix.M11,matrix.M12,matrix.M21,matrix.M22,matrix.M31,matrix.M32],Content:content,Headers:headers,CoverageY:[minY,maxY],Horizontal:axisX,Vertical:axisY,LineHeight:control.ItemHeight?control.ItemHeight*2:48,Depth:ancestors.length};
}
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export class ServerScrollController {
    constructor(scene){this.Scene=scene;this.Pending=[];this.Policies=new Map();this.Offsets=new Map();this.Adjustments=new Map();this.ProcessedInput=0;this.Statistics={Inputs:0,SpeculativeFrames:0,CoverageClamps:0,MaxPending:0,Reconciliations:0};}
    Commit(inputSequence,nodes){this.ProcessedInput=Math.max(this.ProcessedInput,inputSequence??0);const before=this.Pending.length;this.Pending=this.Pending.filter(p=>p.Sequence>this.ProcessedInput&&nodes.has(p.Id));this.Statistics.Reconciliations+=before-this.Pending.length;this.Policies=new Map([...nodes.values()].filter(n=>n.Scroll).map(n=>[n.Id,n.Scroll]));this._Rebuild();}
    Wheel(input){
        if(!Number.isSafeInteger(input.Sequence)||input.Sequence<=this.ProcessedInput||this.Pending.some(p=>p.Sequence===input.Sequence)||this.Pending.length>=256)return false;
        const e=input.Event;if(!e?.Position||![e.Position.X,e.Position.Y,e.deltaX,e.deltaY].every(Number.isFinite))return false;
        const point=new Point(e.Position.X,e.Position.Y),candidates=[...this.Policies.values()].filter(p=>new Rect(...p.Region).Contains(point)).sort((a,b)=>b.Depth-a.Depth);
        for(const p of candidates){const mode=e.deltaMode??0;let dx=e.deltaX*(mode===1?p.LineHeight:mode===2?p.Viewport[0]:1),dy=e.deltaY*(mode===1?p.LineHeight:mode===2?p.Viewport[1]:1);if(e.shiftKey&&!dx){dx=dy;dy=0;}if(!p.Vertical&&p.Horizontal&&!dx){dx=dy;dy=0;}if(!p.Horizontal)dx=0;if(!p.Vertical)dy=0;
            const current=this.Offsets.get(p.Id)??p.Offset,desired=[clamp(current[0]+dx,0,Math.max(0,p.Extent[0]-p.Viewport[0])),clamp(current[1]+dy,0,Math.max(0,p.Extent[1]-p.Viewport[1]))];if(desired[0]===current[0]&&desired[1]===current[1])continue;
            this.Pending.push({Sequence:input.Sequence,Id:p.Id,Delta:[dx,dy]});this.Statistics.Inputs++;this.Statistics.MaxPending=Math.max(this.Statistics.MaxPending,this.Pending.length);this._Rebuild();return true;
        }return false;
    }
    _Rebuild(){
        this.Offsets.clear();this.Adjustments.clear();
        for(const p of this.Policies.values())this.Offsets.set(p.Id,p.Offset.slice());
        for(const input of this.Pending){const p=this.Policies.get(input.Id);if(!p)continue;const old=this.Offsets.get(input.Id),x=clamp(old[0]+input.Delta[0],0,Math.max(0,p.Extent[0]-p.Viewport[0])),wantedY=clamp(old[1]+input.Delta[1],0,Math.max(0,p.Extent[1]-p.Viewport[1])),y=clamp(wantedY,p.CoverageY[0],p.CoverageY[1]);if(y!==wantedY)this.Statistics.CoverageClamps++;this.Offsets.set(input.Id,[x,y]);}
        for(const [id,p]of this.Policies){const o=this.Offsets.get(id),dx=p.Offset[0]-o[0],dy=p.Offset[1]-o[1];if(!dx&&!dy)continue;for(const child of p.Content)this.Adjustments.set(child,[dx,dy]);for(const header of p.Headers)this.Adjustments.set(header,[dx,0]);}
    }
    Transform(id){const value=this.Adjustments.get(id);return value?Matrix.CreateTranslation(value[0],value[1]):null;}
    BarDelta(bar){const p=this.Policies.get(bar.Owner),offset=this.Offsets.get(bar.Owner);if(!p||!offset)return 0;const axis=bar.Horizontal?0:1;return bar.Range>0?(offset[axis]-p.Offset[axis])/bar.Range*bar.Travel*(bar.Reversed?-1:1):0;}
    Readback(){return{...this.Statistics,ProcessedInput:this.ProcessedInput,Pending:this.Pending.length,Offsets:[...this.Offsets].map(([Id,Offset])=>({Id,Offset,Base:this.Policies.get(Id).Offset,CoverageY:this.Policies.get(Id).CoverageY}))};}
    Dispose(){this.Pending=[];this.Offsets.clear();this.Adjustments.clear();this.Policies.clear();}
}
