# Finite submission fences during continuous animation

The complete dedicated-worker catalog sweep found a real starvation bug on the
ProgressBar route: navigation could hit its RPC timeout while frames continued
rendering. `WorkerSkiaRenderer.FlushAsync` previously waited for no in-flight
transaction and for the submitted sequence to catch up with the CURRENT desired
scene. An indeterminate animation could advance that goal indefinitely.

Flush now captures the current source revision and renderer generation at call
time. A fence binds once to a transaction whose snapshot includes or supersedes
that revision. Later captures, coalescing and animation never move that bound
sequence. Submission of that sequence or a later sequence completes the fence,
even when a newer transaction is in flight. Processed-only acknowledgements cannot
substitute for submission. A semantically unchanged capture maps to the last
accepted transaction and does not need a redundant frame.

Only two scalar preparation counters and bounded per-request fence records are
required. There is no unbounded sequence history, frozen animation, polling loop,
extra native readback or alteration of the one-in-flight delta protocol. Hidden
explicit requests coalesce one render RPC at a time. Generation checks prevent an
old hidden-render rejection from poisoning or unlocking its replacement renderer.
Restart, disposal, failure and request timeouts retain bounded ownership.

`tests/submission-fences.test.mjs` supplies 12 deterministic interleaving tests.
The first test was executed against the original renderer and failed; the fixed
renderer passed it and all 475 Node tests locally. The full browser catalog,
threading, restart and autonomous invalidation suites remain release gates.

The contract is at-least-the-requested-revision submission, not global renderer
quiescence and not physical display/GPU completion. Coalesced intermediate scenes
retain the existing latest-desired-state semantics.
