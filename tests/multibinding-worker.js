import { CreateWorkerApplication as CreateCatalog } from '../samples/ControlCatalog/worker/catalog.js';
import * as A from '../packages/browser/worker-assets/packages/avalonia/src/index.js';
import { CreateMultiBindingScene } from './multibinding-scene.js';
export async function CreateWorkerApplication(context) {
    const app = await CreateCatalog(context), dispose = app.Dispose; let scene;
    app.Commands.MountMultiBinding = async aot => { scene?.Dispose(); scene = await CreateMultiBindingScene(A, app.Root, aot); return scene.State(); };
    app.Commands.ChangeMultiBinding = () => scene.Change(); app.Commands.MultiBindingState = () => scene.State();
    app.Commands.ReleaseMultiBinding = () => scene.Release();
    app.Dispose = async () => { scene?.Dispose(); await dispose?.(); }; return app;
}
