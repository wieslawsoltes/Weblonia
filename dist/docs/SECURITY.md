# Security and hosting

XAML is application code expressed as object construction. Registering a type,
markup extension, converter or event handler grants its capabilities. The XML
parser's limits and prototype-path checks do not make arbitrary registered
constructors safe to execute on untrusted documents. Only load trusted XAML,
or supply a tightly restricted registry inside an independently isolated host.

The implemented parser rejects DTD/entity declarations and malformed entities;
it bounds input/node/depth work. Bindings reject prototype-pollution paths. AOT
output uses normal ES modules, not eval or new Function. Runtime plan execution
also does not require unsafe-eval. No credentials, telemetry service or public
API keys are embedded.

The native WASM dependency and browser raster backends carry their own security
surface. Retain the recorded dependency versions, validate vendor-integrity.json
and perform independent vulnerability review before production distribution.

The sample has an inline import map. A strict CSP must authorize that exact map
with a nonce/hash or move the application to an appropriately bundled deployment.
WASM/WebGPU policies and cross-origin headers depend on the selected vendor
backend. This release does not claim CSP/COEP qualification. The bundled static
server is a local development utility, not a hardened internet-facing server.

Window.open, clipboard, file pickers, full screen and screen details require
browser support and may require secure context, permission and user activation.
No bypass is attempted. Popups remain same-origin and share application state;
do not navigate them to untrusted origins and expect continued framework control.
Window modality inhibits framework input but is not an OS security boundary.

The accessibility mirror, native input bridge and browser text rasterization
need independent accessibility and input auditing. Dispose hosts, bindings,
images and animation subscriptions when removing applications.

Password TextBox editing uses a native input with type=password. Automation Value
returns no password text, and the browser mirror does not copy it into labels or
values. Inactive editor buffers are cleared. Application code can still read the
model by design; binding that model into another public TextBlock intentionally
exposes it and is an application responsibility. No memory-zeroization guarantee
is made for JavaScript strings or browser-managed storage.

Composition expressions use a dedicated parser/interpreter, not eval. XAML
factories and overload metadata still invoke registered JavaScript code: adding
types to a registry grants their capabilities. Neither mechanism makes untrusted
application constructors safe.
