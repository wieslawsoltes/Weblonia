#!/usr/bin/env bash
# Complete release qualification, shared with the branch regeneration workflow.
# Every command is a hard gate; neither capability/policy failures nor old
# committed reports count as a completed run for this source fingerprint.
set -euo pipefail
cd "$(dirname "$0")/.."
node --import ./scripts/register-loader.mjs scripts/compile-glyph-fixture.mjs
node --import ./scripts/register-loader.mjs scripts/compile-effects-fixture.mjs
node --import ./scripts/register-loader.mjs scripts/compile-namespace-fixture.mjs
node --import ./scripts/register-loader.mjs scripts/compile-multibinding-fixture.mjs
node --import ./scripts/register-loader.mjs scripts/compile-delay-fixture.mjs
npm run verify:vendor
npm run test:record
npm run build
npm run verify:workers
npm run pack:all
npm run test:packages
node scripts/serve.mjs --dist > artifacts/http-server.log 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
for attempt in {1..30}; do
  if curl --fail --silent http://127.0.0.1:4173/ >/dev/null; then break; fi
  sleep 1
done
python tests/browser.py --dist --url http://127.0.0.1:4173/
kill "$server" 2>/dev/null || true
trap - EXIT
python tests/text-quality.py
python tests/scrollbars.py
python tests/scrollbars.py --scale 1.25
python tests/automation-incremental.py
python tests/worker-startup.py
python tests/worker-startup.py --http
python tests/pages-smoke.py
python tests/startup-http.py
python tests/threading-browser.py
python tests/threading-integration.py --http
python tests/threading-quality.py
python tests/threading-catalog.py
python tests/threading-performance.py
python tests/invalidation-browser.py
python tests/worker-performance-browser.py
python tests/core-port-browser.py
python tests/implicit-animations-browser.py
python tests/glyph-geometry-browser.py
python tests/effects-transitions-browser.py
python tests/xaml-namespaces-browser.py
python tests/multibinding-browser.py
python tests/binding-delay-browser.py
npm run verify:release
npm run benchmark
