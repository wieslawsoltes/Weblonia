/** Produce a release summary only from completed, mutually consistent executions.
 * This gate does not run tests, infer missing results, or reuse evidence from an
 * older source fingerprint. Vendor bytes have a separate immutable-hash gate.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SourceFingerprint } from './source-fingerprint.mjs';
import { VerifyWorkerAssets } from './verify-workers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const require = (condition, message) => { if (!condition) throw new Error(message); };
const pkg = await read('package.json');
const fingerprint = SourceFingerprint(root);
function current(report, name, lowerCase = false, final = true) {
    const key = lowerCase ? 'sourceFingerprint' : 'SourceFingerprint';
    require(report[lowerCase ? 'version' : 'Version'] === pkg.version, `${name}: incorrect version`);
    require(report[key] === fingerprint, `${name}: source fingerprint is stale`);
    if (final) require(report[lowerCase ? 'finalSourceFingerprint' : 'FinalSourceFingerprint'] === fingerprint, `${name}: source changed during execution`);
}
const node = await read('artifacts/validation-optimized/node-final.json');
current(node, 'Node');
require(node.Completed && node.Passed && node.Pass > 0 && node.Fail === 0 && node.Skip === 0 && node.Cancelled === 0 && node.ExitCode === 0, 'Node run is not a complete pass');
const tap = await readFile(path.join(root, 'artifacts/validation-optimized/node-final.log'), 'utf8');
const tapCount = name => Number(tap.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1] ?? NaN);
require(tapCount('pass') === node.Pass && tapCount('fail') === 0 && tapCount('cancelled') === 0 && tapCount('skipped') === 0, 'Node report and TAP log disagree');
const browser = await read('artifacts/browser-results.json');
current(browser, 'Catalog browser', true);
require(browser.completed && browser.failed === 0 && browser.passed > 0 && !browser.catalogSweepSkipped && !browser.pageErrors.length && !browser.missingAssets.length, 'Full catalog browser run did not complete cleanly');
const scrollbars = [];
for (const scale of [1, 1.25]) {
    const report = await read(`artifacts/scrollbar-browser-${scale}.json`);
    current(report, `Scrollbars ${scale}x`, true);
    require(report.completed && report.deviceScale === scale && report.failed === 0 && report.passed > 0 && !report.pageErrors.length && !report.missingAssets.length, `Scrollbar browser ${scale}x failed`);
    scrollbars.push(report);
}
const text = await read('artifacts/text-quality-results.json');
current(text, 'Text quality');
require(text.Completed && text.Failed === 0 && text.Passed >= 29 && !text.PageErrors.length && !text.MissingAssets.length && text.Tests.every(t => t.Passed), 'Text quality run failed');
const pixels = text.Tests.filter(t => t.MaximumChannelError != null);
require(text.PixelChannelTolerance === 2 && pixels.length >= 27 && pixels.every(t => t.ComparedChannels === 4 && t.MaximumChannelError <= text.PixelChannelTolerance && !t.PixelsAboveTolerance && !t.MissingInkPixels), 'Text/caret RGBA comparison failed');
const automation = await read('artifacts/validation-optimized/automation-final.json');
current(automation, 'Incremental automation');
require(automation.Completed && automation.Failed === 0 && automation.Passed > 0 && !automation.PageErrors.length && !automation.MissingAssets.length, 'Incremental automation failed');
const consumer = await read('artifacts/package-consumer-result.json');
current(consumer, 'Packed consumer');
require(consumer.Passed && consumer.Packages === 18 && consumer.StartupSubpaths && consumer.CorePortApis && consumer.ImplicitAnimationApis && consumer.GlyphPathApis && consumer.EffectTransitionApis && consumer.XamlNamespaceApis && consumer.MultiBindingApis && !consumer.PublicRegistryInstalled, 'Packed offline consumer failed');
const corePort = await read('artifacts/core-port/browser-results.json');
current(corePort, 'Core port browser');
require(corePort.Completed && corePort.Passed === 3 && corePort.Failed === 0 && !corePort.Interception && !corePort.WorkerBootstrapOverrides
    && !corePort.Errors.length && !corePort.MissingAssets.length && corePort.Tests.every(t => t.Passed && t.AutonomousRedraw && t.ComparedChannels === 4 && t.MaximumChannelError <= 2), 'Core/XAML/drawing/composition HTTP qualification failed');
const implicitAnimations=await read('artifacts/implicit-animations/browser-results.json');
current(implicitAnimations,'Implicit animations');
require(implicitAnimations.Completed && implicitAnimations.Passed===3 && implicitAnimations.Failed===0 && !implicitAnimations.Interception
    && !implicitAnimations.WorkerBootstrapOverrides && !implicitAnimations.SnapshotForcesRender && !implicitAnimations.Errors.length && !implicitAnimations.MissingAssets.length
    && implicitAnimations.Tests.every(t=>t.Passed&&t.AutonomousRedraw&&t.BindingDrivenLayout&&t.GroupedTrigger&&t.Retargeted&&t.CompletedRunNotReplayed&&t.ClearedDefinitions
        && t.IntermediatePositions.some(x=>x>24&&x<200)&&t.ComparedChannels===4&&t.MaximumChannelError<=2),'Implicit animation HTTP qualification failed');
const glyphGeometry=await read('artifacts/glyph-geometry/browser-results.json');
current(glyphGeometry,'Glyph/path geometry');
require(glyphGeometry.Completed && glyphGeometry.Passed===6 && glyphGeometry.Failed===0 && !glyphGeometry.Interception
    && !glyphGeometry.WorkerBootstrapOverrides && !glyphGeometry.SnapshotForcesRender && !glyphGeometry.FontFilesDistributed
    && !glyphGeometry.Errors.length && !glyphGeometry.MissingAssets.length && glyphGeometry.PixelChannelTolerance===2
    && glyphGeometry.Tests.every(t=>t.Passed&&t.AutonomousRedraw&&t.ComparedChannels===4&&t.MaximumChannelError<=2&&t.FontRequests===1
        && (t.Mode==='single'||t.RestartPassed)), 'Positioned glyph/path HTTP qualification failed');
for(const mode of ['single','render-worker','full-isolation'])for(const aot of [false,true])
    require(glyphGeometry.Tests.some(t=>t.Mode===mode&&t.Aot===aot), 'Missing glyph/path runtime or AOT topology');
const effectTransitions = await read('artifacts/effects-transitions/browser-results.json');
current(effectTransitions,'Effects and transitions');
require(effectTransitions.Completed && effectTransitions.Passed===6 && effectTransitions.Failed===0 && effectTransitions.Tests.length===6
    && !effectTransitions.Interception && !effectTransitions.WorkerBootstrapOverrides && !effectTransitions.SnapshotForcesRender
    && effectTransitions.DeterministicTransitionClock && effectTransitions.PixelChannelTolerance===2
    && !effectTransitions.Errors.length && !effectTransitions.MissingAssets.length
    && effectTransitions.Tests.every(t=>t.Passed&&t.AutonomousRedraw&&t.BindingRetargeted&&t.MutableBaseRestored&&t.ScalarResourceTransition
        && t.NullCompleted&&t.ComparedChannels===4&&t.MaximumChannelError<=2&&(t.Mode==='single'||t.RestartPassed)), 'Effect transition HTTP qualification failed');
for(const mode of ['single','render-worker','full-isolation'])for(const aot of [false,true])
    require(effectTransitions.Tests.some(t=>t.Mode===mode&&t.Aot===aot),'Missing effect transition runtime or AOT topology');
const xamlNamespaces = await read('artifacts/xaml-namespaces/browser-results.json');
current(xamlNamespaces,'XAML namespace compatibility');
require(xamlNamespaces.Completed && xamlNamespaces.Passed===6 && xamlNamespaces.Failed===0 && xamlNamespaces.Tests.length===6
    && !xamlNamespaces.Interception && !xamlNamespaces.WorkerBootstrapOverrides && !xamlNamespaces.SnapshotForcesRender
    && xamlNamespaces.NamespaceMappings && xamlNamespaces.PixelChannelTolerance===2
    && !xamlNamespaces.Errors.length && !xamlNamespaces.MissingAssets.length
    && xamlNamespaces.Tests.every(t=>t.Passed&&t.AutonomousRedraw&&t.IgnorableFiltered&&t.QualifiedAttachedBindings&&t.XmlWhitespacePreserved
        && t.ComparedChannels===4&&t.MaximumChannelError<=2&&(t.Mode==='single'||t.RestartPassed)), 'XAML namespace HTTP qualification failed');
for(const mode of ['single','render-worker','full-isolation'])for(const aot of [false,true])
    require(xamlNamespaces.Tests.some(t=>t.Mode===mode&&t.Aot===aot),'Missing namespace runtime or AOT topology');
const multiBinding = await read('artifacts/multibinding/browser-results.json');
current(multiBinding, 'MultiBinding');
require(multiBinding.Completed && multiBinding.Passed===6 && multiBinding.Failed===0 && multiBinding.Tests.length===6
    && !multiBinding.Interception && !multiBinding.WorkerBootstrapOverrides && !multiBinding.SnapshotForcesRender
    && multiBinding.PixelChannelTolerance===2 && !multiBinding.Errors.length && !multiBinding.MissingAssets.length
    && multiBinding.Tests.every(t=>t.Passed && t.AutonomousRedraw && t.NestedCompiledBindings && t.ConverterFormatting && t.DisposedSubscriptions
        && t.ComparedChannels===4 && t.MaximumChannelError<=2 && (t.Mode==='single'||t.RestartPassed)), 'MultiBinding HTTP qualification failed');
for(const mode of ['single','render-worker','full-isolation'])for(const aot of [false,true])
    require(multiBinding.Tests.some(t=>t.Mode===mode&&t.Aot===aot), 'Missing MultiBinding runtime or AOT topology');
const build = await read('artifacts/build-result.json');
current(build, 'Build', false, false);
require(build.XamlModules === 75 && build.NoEval && build.FontFiles === 0, 'AOT build contract changed');
const inventory = await read('artifacts/npm/manifest.json');
require(inventory.Packages.length === 18 && inventory.Packages.every(p => p.Version === pkg.version), 'Packed library versions disagree');
const workerGraph=await VerifyWorkerAssets();
const threaded={};
for(const [name,minimum]of [['browser',39],['integration',19],['quality',12],['catalog',148]]){
 const result=await read(`artifacts/threading/${name}-results.json`);current(result,`Threaded ${name}`);
 require(result.Completed&&result.Failed===0&&result.Passed>=minimum&&!result.Errors.length&&!result.MissingAssets.length&&result.Tests.every(t=>t.Passed),`Threaded ${name} did not complete cleanly`);
 for(const t of result.Tests)if(t.Evidence?.MaximumChannelError!=null)require(t.Evidence.Channels===4||name==='integration',`Threaded ${name} did not compare all RGBA channels`);
 threaded[name]=result;
}
const startup=await read('artifacts/threading/startup-results.json');current(startup,'Module worker startup');
require(startup.Completed&&startup.Failed===0&&startup.Passed>=17&&!startup.Errors.length&&!startup.MissingAssets.length&&startup.WorkerType==='module'&&!startup.TestMessageQueue&&!startup.InitializationReplay,'Production module entry regression did not pass');
let httpStartup=null;try{httpStartup=await read('artifacts/threading/http-startup-results.json');current(httpStartup,'HTTP worker startup');}catch(error){if(error.code!=='ENOENT')throw error;}
if(process.env.CI==='true')require(httpStartup?.Completed&&httpStartup.Failed===0,'CI must qualify ordinary HTTP worker startup without interception');
const threadPerformance=await read('artifacts/threading/performance-results.json');current(threadPerformance,'Threading performance');
require(threadPerformance.Completed&&threadPerformance.Passed&&!threadPerformance.Errors.length&&!threadPerformance.MissingAssets.length,'Thread performance failed');
for(const mode of ['single','render-worker','full-isolation'])for(const kind of ['repaint','vertical','horizontal'])require(threadPerformance.Modes[mode]?.Workloads[kind]?.Samples.length>=30,`Missing ${mode}/${kind} timing evidence`);
const invalidation=await read('artifacts/invalidation/browser-results.json');current(invalidation,'Autonomous invalidation');
require(invalidation.Completed&&invalidation.Failed===0&&invalidation.Passed>=26&&!invalidation.Errors.length&&!invalidation.MissingAssets.length&&invalidation.Tests.every(t=>t.Passed),'Autonomous invalidation did not pass in all three modes');
const workerPerformance=await read('artifacts/threading/worker-performance-results.json');current(workerPerformance,'Recovered worker performance');
require(workerPerformance.Completed&&workerPerformance.Failed===0&&workerPerformance.Passed>=9&&!workerPerformance.Errors.length&&!workerPerformance.MissingAssets.length&&workerPerformance.Tests.every(t=>t.Passed),'Recovered worker performance regressions failed');
// Structural startup gates are deterministic. Timing is evidence, not a flaky
// wall-clock threshold. These reports have no Version field; bind both ends to
// the exact source fingerprint instead of trusting stale committed measurements.
const pages = await read('artifacts/publication/pages-smoke.json');
const coldStartup = await read('artifacts/startup/http-comparison.json');
for (const [name, value] of [['Pages startup', pages], ['Cold startup', coldStartup]])
    require(value.Completed && value.SourceFingerprint === fingerprint && value.FinalSourceFingerprint === fingerprint,
        `${name}: incomplete or stale source evidence`);
require(pages.Passed === 4 && pages.Failed === 0 && pages.Tests.length === 4 && !pages.Interception && !pages.WorkerBootstrapOverrides
    && pages.SitePrefix === '/Weblonia/' && pages.Tests.every(t => t.Passed && t.WasmRequests === 1 && !t.Errors.length && !t.MissingAssets.length), 'Canonical Pages startup did not pass');
require(pages.Tests.find(t => t.Name === 'default')?.ExpectedMode === 'full-isolation'
    && pages.Tests.find(t => t.Name === 'full-isolation')?.RestartReusedNativeModule, 'Default or renderer restart no longer shares native preparation');
const optimizedTrials = coldStartup.Trials.filter(t => t.Variant === 'optimized');
require(coldStartup.Passed && coldStartup.ColdBrowserPerTrial && !coldStartup.Interception && !coldStartup.WorkerOverrides
    && optimizedTrials.length >= 3 && coldStartup.Trials.every(t => t.Passed && !t.Errors.length), 'Cold startup trials did not complete');
require(optimizedTrials.every(t => t.WasmRequests === 1 && t.AotBuilderRequests === 1 && t.PngBytes > 256
    && t.Diagnostics.Host.MainHasSkiaRuntime === false && t.Diagnostics.Host.NativePreparation.Deliveries === 2
    && t.Diagnostics.Host.NativePreparation.PendingDeliveries === 0), 'Startup duplicated native downloads, eagerly loaded XAML, or leaked module delivery ports');
const files = [];
async function scan(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
        if(['worker-assets','node_modules'].includes(e.name))continue;
        const file = path.join(dir, e.name);
        if (e.isDirectory()) await scan(file);
        else if (e.name.endsWith('.js')) files.push(file);
    }
}
await scan(path.join(root, 'packages'));
const lines = (await Promise.all(files.map(f => readFile(f, 'utf8')))).reduce((n, s) => n + s.split('\n').length, 0);
const report = {
    FullReleaseQualified: true, Version: pkg.version, SourceFingerprint: fingerprint, GeneratedAt: new Date().toISOString(),
    ImplicitAnimations: implicitAnimations, GlyphGeometry: glyphGeometry, EffectTransitions: effectTransitions, XamlNamespaces: xamlNamespaces, MultiBinding: multiBinding,
    FullAvaloniaParity: false, FullXamlXParity: false, FullUpstreamClonesIncluded: false, OriginalCatalogSubexamplesFullyPorted: false,
    Recovery: await read('docs/recovery/recovery-invalidation.json'),
    UpstreamSkia: await read('docs/SKIASHARPWEB-UPSTREAM.json'),
    UpstreamSkiaStartup: await read('docs/STARTUP-UPSTREAM.json'),
    SkiaSourceChangedThisRelease: true, NativeWasmChangedThisRelease: false,
    WorkspacePackages: consumer.Packages, FacadeExports: consumer.FacadeExports,
    LibraryJavaScriptFiles: files.length, LibraryJavaScriptLines: lines, AotXamlModules: build.XamlModules, CatalogRoutes: 74,
    NodeTests: { Passed: node.Pass, Failed: node.Fail, Skipped: node.Skip, Completed: node.Completed, FinalLog: 'artifacts/validation-optimized/node-final.log' },
    BrowserTests: {
        Passed: browser.passed, Failed: browser.failed, Skipped: browser.skipped, Completed: browser.completed,
        Browser: browser.browser, Mode: browser.mode, Backend: browser.backend, CatalogSweepSkipped: browser.catalogSweepSkipped,
        PageErrors: browser.pageErrors, MissingAssets: browser.missingAssets, FinalLog: 'artifacts/validation-optimized/catalog-final.log'
    },
    ScrollbarBrowserTests: scrollbars.map(b => ({
        DeviceScale: b.deviceScale, Passed: b.passed, Failed: b.failed, Completed: b.completed,
        Mode: b.mode, WheelEvidence: b.wheelEvidence, PageErrors: b.pageErrors, MissingAssets: b.missingAssets,
        Report: `artifacts/scrollbar-browser-${b.deviceScale}.json`
    })),
    TextQualityTests: {
        Passed: text.Passed, Failed: text.Failed, PixelComparisons: pixels.length, ComparedChannels: 4,
        MaximumChannelError: Math.max(...pixels.map(t => t.MaximumChannelError)), Tolerance: text.PixelChannelTolerance,
        MissingInkPixels: pixels.reduce((n, t) => n + (t.MissingInkPixels ?? 0), 0),
        Tests: text.Tests, PageErrors: text.PageErrors, MissingAssets: text.MissingAssets,
        FinalLog: 'artifacts/validation-optimized/text-final.log'
    },
    IncrementalAutomationTests: automation,
    AutonomousInvalidationTests: invalidation, RecoveredWorkerPerformance: workerPerformance,
    CorePortBrowser: corePort, PackedPackageConsumer: consumer, PagesStartup: pages, ColdStartup: coldStartup,
    WorkerGraph:workerGraph, ModuleWorkerStartup:startup, HttpWorkerStartup:httpStartup, OrdinaryHttpWorkersQualified:!!httpStartup?.Completed&&httpStartup.Failed===0, ThreadedBrowser:threaded.browser, ThreadedIntegration:threaded.integration, ThreadedQuality:threaded.quality, ThreadedCatalog:threaded.catalog, ThreadingPerformance:threadPerformance,
    Performance: { HistoricalIntermediateReports: 'artifacts/history/performance-session/', Current: 'artifacts/threading/performance-results.json', Startup: 'artifacts/startup/http-comparison.json', Scope: 'Current source in all three topologies; separate UI CPU and submission latency, equal native raster scale/quality. No physical GPU FPS qualification.' },
    PhysicalGpuQualified: false, PhysicalTouchQualified: false, PhysicalImeQualified: false, ScreenReaderQualified: false,
    SafariQualified: false, FirefoxQualified: false, PublicRegistryInstalled: false, UpstreamGitDependencyInstalled: false,
    SkiaDependencyResolution: 'immutable Git dependency in manifest; bundled assets used by verified offline consumer',
    AvaloniaRemoteChanges: false, SkiaRemoteChangesThisRelease: true, NewNpmReleasePublished: false,
    UpstreamNpmRelease: { Package: '@wieslawsoltes/skiasharpweb', Version: '0.5.1', VerificationRun: 35769480279, VerificationJob: 106887919262, Source: 'docs/UPSTREAM-NPM-PUBLICATION.json' }, FontFiles: 0,
    HistoricalLogs: 'Earlier reports and interrupted/progress runs are retained as history. Only final reports with this version and source fingerprint qualify this release.'
};
await writeFile(path.join(root, 'docs/VERIFICATION.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(path.join(root, 'artifacts/verification-summary.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ Version: pkg.version, SourceFingerprint: fingerprint, Node: node.Pass, Browser: browser.passed, Scrollbars: scrollbars.map(b => [b.deviceScale, b.passed]), Text: text.Passed, Packages: consumer.Packages, Threading:{Browser:threaded.browser.Passed,Integration:threaded.integration.Passed,Quality:threaded.quality.Passed,Catalog:threaded.catalog.Passed} }));
