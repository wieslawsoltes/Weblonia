import { CreateWorkerApplication as CreateCatalog } from '../samples/ControlCatalog/worker/catalog.js';
import * as A from '../packages/browser/worker-assets/packages/avalonia/src/index.js';
import { CreateResourceScene } from './resource-scene.js';
export async function CreateWorkerApplication(context) {
    const app=await CreateCatalog(context),dispose=app.Dispose;let scene;
    app.Commands.MountResources=async aot=>{scene?.Dispose();scene=await CreateResourceScene(A,app.Root,aot);return scene.State();};
    app.Commands.ResourceState=()=>scene.State();app.Commands.ChangeResources=step=>scene.Change(step);
    app.Dispose=async()=>{scene?.Dispose();await dispose?.();};return app;
}
