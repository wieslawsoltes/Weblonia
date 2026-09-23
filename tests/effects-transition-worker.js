// Wrapper only adds test inspection/commands; production catalog and bootstrap stay unchanged.
import { CreateWorkerApplication as CreateCatalog } from '../samples/ControlCatalog/worker/catalog.js';
import * as A from '../packages/browser/worker-assets/packages/avalonia/src/index.js';
import { CreateEffectsTransitionScene } from './effects-transition-scene.js';
export async function CreateWorkerApplication(context) {
    const app = await CreateCatalog(context), dispose = app.Dispose; let scene;
    app.Commands.MountEffects = async aot => { scene?.Dispose(); scene = await CreateEffectsTransitionScene(A, app.Root, aot); return scene.State(); };
    app.Commands.EffectsStep = command => scene.Step(command);
    app.Commands.EffectsState = () => scene.State();
    app.Dispose = async () => { scene?.Dispose(); await dispose?.(); }; return app;
}
