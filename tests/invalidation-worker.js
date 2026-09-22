import * as A from '../packages/browser/worker-assets/packages/avalonia/src/index.js';
import { CreateInvalidationFixture } from './invalidation-fixture.js';
export function CreateWorkerApplication(context){return CreateInvalidationFixture(A,context.CreateTopLevel(),context.Options.HandlerModule);}
