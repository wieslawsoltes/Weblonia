export const BrowserThreadingMode = Object.freeze({ SingleThreaded: 'single', RenderWorker: 'render-worker', FullIsolation: 'full-isolation' });
export function GetBrowserWorkerUrls(base = new URL('../worker-assets/', import.meta.url)) {
    return { RenderWorkerUrl: new URL('render.js', base).href, UiWorkerUrl: new URL('ui.js', base).href, LoaderUrl: new URL('canvaskit-loader.mjs', base).href };
}
