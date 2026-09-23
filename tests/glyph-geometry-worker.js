import { CreateWorkerApplication as CreateCatalog } from '../samples/ControlCatalog/worker/catalog.js';
import * as A from '../packages/browser/worker-assets/packages/avalonia/src/index.js';
import { CreateGlyphGeometryScene } from './glyph-geometry-scene.js';
export async function CreateWorkerApplication(context) {
    const app=await CreateCatalog(context),dispose=app.Dispose;let scene;
    app.Commands.MountGlyphGeometry=async(fontUrl,aot)=>{scene?.Dispose();scene=await CreateGlyphGeometryScene(A,app.Root,fontUrl,aot);return scene.State();};
    app.Commands.ChangeGlyphGeometry=()=>scene.Change();app.Commands.GlyphGeometryState=()=>scene.State();
    app.Dispose=async()=>{scene?.Dispose();await dispose?.();};return app;
}
