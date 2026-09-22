# Weblonia publication

Repository: wieslawsoltes/Weblonia; branch: main.

This is the complete 0.6.2-alpha.1 source archive, including its worker-performance
and invalidation fixes, plus the publication integration. ControlCatalog now
defaults to `full-isolation`; `?threading=single` and `?threading=render-worker`
remain supported. The library default has not been changed.

The original manifest is retained at
`docs/publication/archive-0.6.2-alpha.1-manifest.json`. The root manifest describes
this imported file tree. Original browser/performance reports are historical and
do not qualify changed sources. `docs/publication/local-validation.json` records
what the publisher actually ran. CI reruns the original full regression workflow.

The Pages workflow builds `dist/`, verifies generated worker assets and packaged
libraries, then runs `tests/pages-smoke.py` against an ordinary HTTP server mounted
under `/Weblonia/`. It checks the queryless default and all three explicit
modes, canonical module workers, native nonblank output and missing assets.
It uses no request interception, worker-URL replacements or cross-origin isolation
headers. A successful deployment is stamped in `dist/deployment.json`.

No npm install is needed for the delivered JavaScript application. Python browser
tests use tests/requirements.txt. No fonts are copied from the developer machine.
This publication does not claim complete upstream Avalonia/XamlX parity.
