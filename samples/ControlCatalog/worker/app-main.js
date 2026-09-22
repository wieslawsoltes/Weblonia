import * as A from "../../../packages/browser/worker-assets/packages/avalonia/src/index.js";
import { CatalogController, CatalogApplication } from './catalog.js';
function resource(target,property,key){target.Bind(A.AvaloniaProperty.FindRegistered(target,property),A.GetResourceObservable(target,`System${key}Brush`));}
export async function StartCatalogMainAsync(mode) {
const controller = new CatalogController();
try {
    A.ReactiveUI.UseReactiveUI();
    const app = new CatalogApplication();
    app.Initialize();
    const view = controller.CreateView(), root = new A.Window();
    app.ApplicationLifetime = new A.BrowserApplicationLifetime();
    app.ApplicationLifetime.MainWindow = root;
    app.ApplicationLifetime.MainView = view;
    root.Content = view;
    resource(root, 'Foreground', 'Text');
    const platform = await A.SkiaPlatform.Initialize({ assetBaseUrl: new URL('../vendor/', import.meta.resolve("../../../packages/browser/worker-assets/vendor/skiasharpweb/dist/package/browser.js")).href });
    // Packaged deployment has vendor/ at the site root; use the import map's canonical package location.
    await root.Attach(document.getElementById('app'), { HandlerModules:[new URL('./worker/worker-custom-handler.js',import.meta.url).href],Platform: platform, Backend: new URLSearchParams(location.search).get('backend') ?? 'auto', ThreadingMode: mode, ...globalThis.AVALONIA_BOOT_OPTIONS });
    await controller.Start(root);
    document.getElementById('loading')?.remove();
    window.catalog = controller;
    window.catalogApi = A;
    window.catalogReady = true;
    window.addEventListener('beforeunload', () => {
        controller._pageLifetime.Dispose();
        controller._notifications.Dispose();
        root.Dispose();
    });
}
catch (error) {
    window.catalogError = error.stack;
    console.error(error);
    const box = document.getElementById('loading') ?? document.body.appendChild(document.createElement('pre'));
    box.className = 'error';
    box.textContent = `AvaloniaWeb failed to initialize.\n${error.stack}`;
}

}
