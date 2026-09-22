// Wrap the real catalog application. Only test commands are added; the actual
// worker bootstrap, dispatch, layout, compositor and renderer remain unchanged.
import { CreateWorkerApplication as CreateCatalog } from '../samples/ControlCatalog/worker/catalog.js';
import * as A from '../packages/browser/worker-assets/packages/avalonia/src/index.js';
import { CreateCorePortScene } from './core-port-scene.js';
export async function CreateWorkerApplication(context) {
    const app=await CreateCatalog(context),dispose=app.Dispose;let scene;
    app.Commands.MountCore=async()=>{scene?.Dispose();scene=await CreateCorePortScene(A,app.Root);return scene.State();};
    app.Commands.ChangeCore=()=>scene.Change();app.Commands.CoreState=()=>scene.State();
    app.Dispose=async()=>{scene?.Dispose();await dispose?.();};return app;
}
