import { Rect } from '../packages/browser/worker-assets/packages/base/src/index.js';
/** One repaint requested during rendering, not an animation-clock request. */
export default class ReentrantWorkerHandler {
    OnRender(c){this.Calls=(this.Calls??0)+1;c.DrawRectangle(this.Calls===1?'#ff0000':'#0000ff',null,new Rect(0,0,480,180));if(this.Calls===1)this.Invalidate();}
    GetDiagnostics(){return{Calls:this.Calls??0};}
}
