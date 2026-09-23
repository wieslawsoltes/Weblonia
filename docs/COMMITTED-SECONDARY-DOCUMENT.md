# Committed same-origin documents for secondary render workers

After effects PR #5 passed its exact-head checks, post-merge run 35895993579
failed in the repeated-window integration case. Artifact 10766957258 reported an
entry-script error before any render bootstrap stage. No missing HTTP asset or
page error was reported. Child-host and native-delivery cleanup worked, but the
unshown Window did not retain its startup error; the test waited to its 30-second
deadline. This report does not identify a Chromium implementation cause.

Secondary windows now navigate to the packaged `src/secondary-window.html` rather
than using the initial about:blank document as the worker owner. Its external,
dependency-free script acknowledges actual document load to the opener. The host
registers its listener before the synchronously activated window.open, and checks
source WindowProxy, same origin, unique random token, final URL and complete
readyState before constructing the popup's Worker. No worker/native framework is
initialized by the acknowledgement page. No retry, delayed readiness guess or
replacement rendering backend is introduced.

The same bounded startup deadline and AbortSignal cover document and renderer
readiness. The host closes unpublished popups on cancellation, failure or timeout.
Late/wrong-origin/wrong-window/wrong-token acknowledgements cannot satisfy a pending
open. Native readiness is still required before handing channels to the shared UI
worker. The unshown Window now retains LastRenderError, making failures observable
through the existing catalog command instead of mislabeling them as no error.

The default document URL is relative to isolated-host.js and works under a Pages
subpath. Bundled/CDN applications may supply `SecondaryWindowUrl` pointing to their
own same-origin deployment of the two host files. HTTP(S) same-origin URLs only;
cross-origin URLs, credentials and a ready-page redirect fail closed. No additional
startup request is added until a secondary window is actually opened. Initial
single/render-worker/full-isolation startup and shared WASM compilation are
unchanged. General non-isolated Window.Show remains outside this change.

Six new deterministic lifecycle tests cover identity/origin/token matching,
URL/loading/closed mismatches, denied popup, timeout, abort and invalid origin.
The previous 21 ownership tests remain, including failure rollback and native
module delivery cancellation. The real HTTP integration gate doubles its
repeated-open loop from six to twelve ordinary/modal windows, checks the committed
host URL, exact modal results and zero retained hosts/native deliveries. Its
intentional worker-bootstrap failure and subsequent healthy-window test remain.
All original 19 integration cases remain mandatory. A pass demonstrates the tested
browser/transport behavior, not a universal fix for every early worker failure.

Browser specification background: the Worker constructor uses its relevant
settings object as outsideSettings. Acknowledging a committed document makes that
ownership explicit instead of inferring it from the initial WindowProxy document.
https://html.spec.whatwg.org/multipage/workers.html#dom-worker
