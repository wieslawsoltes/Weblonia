/**
 * The generated worker entry embeds this dependency-free bootstrap. Do not add
 * static imports or top-level await: an asynchronous dependency graph can yield
 * before the worker installs its message handler, losing the transferred canvas
 * and ports in the first initialize message.
 *
 * Accept ownership first, then load the graph and call its explicit entry. The
 * same code works as a classic or module entry. No eval, polling, unbounded queue,
 * document import map, or application-data replay is involved.
 */
function InstallWorkerBootstrap(scope, loadModule, exportName, role) {
    let accepted = false;
    let failed = false;
    const started = scope.performance?.now() ?? Date.now();
    const progress = (stage, url) => {
        if (failed) return;
        scope.postMessage({
            Type: 'startup-progress', Role: role, Stage: stage,
            ElapsedMilliseconds: (scope.performance?.now() ?? Date.now()) - started,
            ...(url ? { Url: String(url) } : {}),
        });
    };
    const fail = error => {
        if (failed) return;
        failed = true;
        const message = error?.message ?? String(error);
        scope.postMessage({ Type: 'bootstrap-error', Role: role,
            Error: `${role} worker startup failed: ${message}`,
            Name: error?.name ?? 'Error', Stack: error?.stack ?? message });
        scope.close();
    };
    scope.onmessage = event => {
        if (event.data?.Type !== 'initialize' || accepted) return;
        accepted = true;
        const initialization = event.data;
        progress('module-import');
        // Promise.then catches both synchronous loader errors and async failures.
        Promise.resolve().then(loadModule).then(module => {
            const start = module[exportName];
            if (typeof start !== 'function')
                throw new TypeError(`Worker module does not export ${exportName}. Rebuild all worker assets together.`);
            return start(initialization, { Progress: progress });
        }).then(() => progress('ready')).catch(fail);
    };
    progress('waiting-for-initialize');
}

InstallWorkerBootstrap(self, () => import('./packages/browser/src/render-worker.js'), 'StartRenderWorker', 'render');
