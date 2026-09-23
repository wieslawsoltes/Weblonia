import { CreateWorkerApplication as CreateCatalog } from '../samples/ControlCatalog/worker/catalog.js';
import * as A from '../packages/browser/worker-assets/packages/avalonia/src/index.js';
import { CreateNamespaceScene } from './xaml-namespace-scene.js';
export async function CreateWorkerApplication(context) {
    const app = await CreateCatalog(context), dispose = app.Dispose; let scene;
    app.Commands.MountNamespaces = async aot => { scene?.Dispose(); scene = await CreateNamespaceScene(A, app.Root, aot); return scene.State(); };
    app.Commands.ChangeNamespaces = () => scene.Change(); app.Commands.NamespaceState = () => scene.State();
    app.Dispose = async () => { scene?.Dispose(); await dispose?.(); }; return app;
}
