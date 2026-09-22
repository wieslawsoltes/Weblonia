import { Rect } from "../packages/browser/worker-assets/packages/base/src/index.js";
/** Explicitly registered render-worker code. It has no UI/DOM references. */
export default class CatalogWorkerVisualHandler {
    constructor(){this.Messages=0;this.AnimationTicks=0;this.Color='#4361ee';this.Running=false;}
    OnStateChanged(state){this.Color=state?.Color??'#4361ee';}
    OnMessage(message){++this.Messages;if(message.Start){this.Running=true;this.RegisterForNextAnimationFrameUpdate();}if(message.Stop)this.Running=false;this.Invalidate();}
    OnAnimationFrameUpdate(){++this.AnimationTicks;if(this.Running)this.RegisterForNextAnimationFrameUpdate();}
    OnRender(context){context.DrawRectangle(this.Color,null,new Rect(0,0,this.EffectiveSize.Width,this.EffectiveSize.Height),12);}
    GetDiagnostics(){return{Messages:this.Messages,AnimationTicks:this.AnimationTicks,HasDocument:typeof document!=='undefined',Color:this.Color};}
    OnDispose(){this.Running=false;}
}
