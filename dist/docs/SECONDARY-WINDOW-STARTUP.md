# Native-ready secondary windows and bounded startup ownership

The complete glyph/path port CI exposed an intermittent secondary render entry
failure in ordinary HTTP mode, not just the historical intercepted-data-URL
harness. The browser supplied no message, no bootstrap stages and one outstanding
shared-module delivery. The previous open-window service returned both channels
before native initialization, then silently closed the host channel on failure.
The UI remained waiting for its renderer and the modal owner stayed disabled.
A separate generation run of the same source passed: the exact browser cause of
the early entry failure is not established by these logs.

The port now opens the browser popup synchronously in the real permission click,
waits for its document to complete, and installs all worker listeners before the
initialize post. The shared UI worker receives its channels only after the
secondary worker's actual final native-ready bootstrap notification. The render
channel is not consumed by the host; its queued ready notification still belongs
to the UI. No time-delay heuristic, worker retry, bootstrap rewrite or forced
render call is introduced. One deadline covers document and native preparation.

An entry/link/deserialization error, close/navigation, timeout, or owner disposal
rejects the pending service. All untransferred ports, the partially created host,
its browser popup and listeners are released. A child cancels only its own
one-shot WASM delivery through an AbortSignal; it never disposes the parent's
shared compiled module or another window's delivery. Closed children are removed
from the parent's set instead of accumulating until application shutdown.

The UI-side Window factory rejects ShowDialog and WhenOpened, restores the owner,
and disposes the unshown Window on failure. Closing a Window before its browser
host arrives is safe; a late response is closed instead of attaching controls to
a disposed root. Post-ready secondary worker errors use the same existing
renderer-recovery route as the primary worker. Pending-host DisposeAsync does not
wait for a response from an application that was never initialized.

## Verification

Twenty-one deterministic tests cover real MessageChannels and AbortSignals plus
explicit DOM/Worker doubles for lifecycle interleavings. These are ownership
and protocol tests, not graphics qualification. Two rollback regressions were
run against the previous implementation and failed; all 21 pass with this change.
All 735 Node tests and all 18 packed consumers passed locally on Node 22.16.0.

The actual-HTTP integration suite retains its previous 17 assertions, then opens
and closes six further ordinary/modal windows and requires zero retained child
hosts and zero pending native deliveries. A separate case loads a deliberately
failing test worker via HTTP, requires the exact failure to reach the modal owner,
and verifies that the next real window still opens with the shared source.
It does not suppress unrelated errors, widen the RGBA tolerance or accept a
partial bootstrap as success. Full CI must pass these 19 integration cases,
the six runtime/AOT glyph cases and all existing release gates before merge.

Local administrator-managed Chromium blocks ordinary HTTP navigation. Those
attempts are retained as failures, not presented as browser passes. No physical
GPU, cross-browser, mobile or universal early-entry-failure guarantee is implied.

Primary browser lifecycle background:
- https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-open
- https://developer.mozilla.org/en-US/docs/Web/API/Window/open
- https://developer.mozilla.org/en-US/docs/Web/API/Worker/error_event
