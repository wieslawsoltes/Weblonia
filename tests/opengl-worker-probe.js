// Test-only wrapper around the actual built catalog entry. It adds one inspection
// command, without replacing startup, navigation, controls, shaders or rendering.
import { CreateWorkerApplication as CreateCatalog } from '../samples/ControlCatalog/worker/catalog.js';
import { DescribeOpenGl } from './opengl-probe.js';
export async function CreateWorkerApplication(context) {
    const app=await CreateCatalog(context);
    app.Commands.GetOpenGlProbe=()=>DescribeOpenGl(app.Root.FindControl('GlSlot')?.Child,app.Root);
    return app;
}
