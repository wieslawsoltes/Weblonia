# Production HTTP window integration qualification

The complete CI sweep caught intermittent secondary-worker entry failures in the
intercepted data-URL variant of threading-integration.py. The primary window and
most child windows worked; an occasional child failed before any bootstrap stage.
A local repeated-open probe reproduced a child-host `Secondary render worker entry
failed` with no startup events. This does not identify an underlying browser cause
and must not be represented as an application/native-engine fix.

That data-URL wrapper exists solely because local administrator-managed Chromium
blocks ordinary HTTP navigation. CI does not have that constraint. CI and the
release qualifier now run `threading-integration.py --http`: the actual Node source
server, page.goto, original application, canonical HTTP module workers, no route
interception and no worker/bootstrap overrides. All existing 17 input, UI-stall,
independent-clock, wheel, bitmap/restart, native-host, real-window and exact modal
result assertions are retained. The report records this transport and initial
worker URLs. The local intercepted variant remains available explicitly; it is
not the production HTTP release qualification.

Window waiting now observes actual lifecycle and late user-activation prompts
instead of assuming the prompt appeared in 120/150 milliseconds. The startup
budget stays 30 seconds and no worker retry, forced rendering or partial-success
acceptance is introduced. Child-host failures include their bootstrap stages and
native module delivery diagnostics instead of silently waiting on the UI's still
pending renderer handshake. The new core scene separately checks autonomous
updates from browser-presented pixels, never a snapshot RPC that calls render().
