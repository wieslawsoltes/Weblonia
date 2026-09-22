// Keep the document entry independent of the application and graphics graphs.
import { ResolveCatalogThreadingMode } from './threading-mode.js';
const mode=ResolveCatalogThreadingMode();
if(mode==='full-isolation') {
    try {
        const { StartWorkerApplicationAsync } = await import("../../../packages/browser/worker-assets/packages/browser/src/isolated-host.js");
        const host=await StartWorkerApplicationAsync(document.getElementById('app'),{Backend:new URLSearchParams(location.search).get('backend')??'auto',ApplicationModule:new URL('./worker/catalog.js',import.meta.url).href,HandlerModules:[new URL('./worker/worker-custom-handler.js',import.meta.url).href],HostModules:[new URL('./native-demo.js',import.meta.url).href],SnapshotData:{NativeDemoModule:new URL('./native-demo.js',import.meta.url).href,CustomHandlerModule:new URL('./worker/worker-custom-handler.js',import.meta.url).href},...globalThis.AVALONIA_BOOT_OPTIONS});
        document.getElementById('loading')?.remove();globalThis.catalogHost=host;globalThis.catalogReady=true;
        host.Errors.Add((_,e)=>globalThis.catalogError=e.Error.stack);
    }catch(error){globalThis.catalogError=error.stack;console.error(error);const loading=document.getElementById('loading');if(loading)loading.textContent=error.stack;}
} else {
    await (await import('./app-main.js')).StartCatalogMainAsync(mode);
}
