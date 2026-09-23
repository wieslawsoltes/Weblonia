import { CreateWorkerApplication as CreateCatalog } from '../samples/ControlCatalog/worker/catalog.js';
import * as A from '../packages/browser/worker-assets/packages/avalonia/src/index.js';
import { CreateImplicitAnimationScene } from './implicit-animation-scene.js';
export async function CreateWorkerApplication(context){
    const app=await CreateCatalog(context),dispose=app.Dispose;let scene;
    app.Commands.MountImplicit=async()=>{scene?.Dispose();scene=await CreateImplicitAnimationScene(A,app.Root);return scene.State();};
    for(const command of ['State','Move','Retarget','Unrelated','Clear'])app.Commands['Implicit'+command]=()=>scene[command]();
    app.Dispose=async()=>{scene?.Dispose();await dispose?.();};return app;
}
