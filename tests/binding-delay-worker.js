import { CreateWorkerApplication as CreateCatalog } from '../samples/ControlCatalog/worker/catalog.js';
import * as A from '../packages/browser/worker-assets/packages/avalonia/src/index.js';
import { CreateBindingDelayScene } from './binding-delay-scene.js';
export async function CreateWorkerApplication(context){
    const app=await CreateCatalog(context),dispose=app.Dispose;let scene;
    app.Commands.MountBindingDelay=async aot=>{scene?.Dispose();scene=await CreateBindingDelayScene(A,app.Root,aot);return scene.State();};
    app.Commands.QueueBindingDelay=()=>scene.Queue();app.Commands.FlushBindingDelay=()=>scene.Flush();
    app.Commands.ReleaseBindingDelay=()=>scene.ReleasePending();app.Commands.BindingDelayState=()=>scene.State();
    app.Dispose=async()=>{scene?.Dispose();await dispose?.();};return app;
}
