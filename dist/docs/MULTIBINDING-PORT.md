# MultiBinding and XAML aggregate bindings

This increment starts from Weblonia `f60cb93e02bbcac2f905834ab2f0a4709b8ca73c`.
It extends the existing JavaScript implementation; it is not a claim that all
Avalonia core, XamlX, or CLR formatting behavior is ported. Native Skia, the
binary scene protocol, browser windowing, lazy AOT, and full-isolation default
are unchanged.

## Binding semantics

`MultiBinding` supports nested aggregate bindings, reflection or compiled leaf
bindings, and `OneWay` / `OneTime` modes (`Default` resolves to `OneWay`). Every
leaf uses the real outer target as its binding anchor, including DataContext,
Self, TemplatedParent, named elements and existing ancestor resolution. Internal
value sinks never become the source of a relative binding. Aggregate conversion
is target-only: child TwoWay definitions cannot accidentally write into another
source through an internal sink.

A graph is validated and copied before replacing the existing target binding.
Cycles, unsupported modes/children, unsafe paths, depth over 64 or more than 4,096
binding nodes fail before replacement. Reused DAG definitions are legal. Source
objects and converter instances are borrowed, while active binding settings and
child lists are snapshots. Editing a definition applies to future attachments.

Initial publication waits for each child to actually publish. UnsetValue is an
initialized unavailable value; DoNothing is not a fabricated initial value.
Synchronous attachment publishes one complete aggregate, not prefixes of an array
of default sink values. Converters receive frozen array snapshots. With no
converter, a frozen array is itself the value, suitable for ItemsSource. Previous
published arrays cannot change underneath their consumers.

Object converters receive `Convert(values, targetType, parameter, culture)`;
plain JavaScript functions receive the same arguments. BindingNotification
values/errors are extracted; converter, formatting and target-conversion errors
publish FallbackValue and a recoverable validation error. DoNothing retains the
previous target. UnsetValue and null use FallbackValue and explicitly supplied
TargetNullValue respectively. Reentrant notifications are drained without recursive
converter calls, with a 64-conversion convergence limit. A converter replacing or
disposing its own binding cannot publish over its successor.

OneTime releases child observers after the first successful aggregate, not after
an error fallback or DoNothing. Target disposal and explicit disposal release the
full nested subscription graph and remove the aggregate's target lifetime entry.
The original implementation fails six selected regression cases, including nested
source resolution, OneTime and 1,000 attach/dispose cycles.

## XAML and emitted AOT

Both construction paths recursively prepare the aggregate graph. Child
StaticResource and x:Reference values resolve per construction without mutating a
shared graph returned by a custom markup extension. Compiled child paths are
validated against lexical x:DataType, even below several aggregate levels.
Object-element Binding honors inherited x:CompileBindings; explicit
ReflectionBinding remains reflective. The standard CompiledBinding and
ReflectionBinding object-element aliases resolve in Avalonia namespaces only.

A DataContext schema is not applied to an explicit Source, Self, ancestor, named
element or templated-parent path. Those paths are still parsed and safety-checked;
this change does not introduce full static type inference for such sources.
Deferred template declarations preserve lexical model context and per-instance
subscriptions. No eval, generated Function, or new runtime compiler is introduced.

## Composite formatting

`StringFormatMultiValueConverter` and `StringFormatValueConverter` are exported
with their Avalonia API names. MultiBinding.StringFormat formats the converter's
single result when a converter exists, or the original child arguments otherwise.
It is skipped for properties with a known non-string/non-object target type.
The two converter wrappers preserve DoNothing/UnsetValue; ConvertBack on the
single-value formatting converter is explicitly unsupported.

The bounded parser handles indexed placeholders, alignment, escaped braces and
D/X/F/N/P/E/G/R numeric specifiers. Numeric precision is limited to 99, format text
to 65,536 characters, alignment to 65,536 and output to 1,048,576 characters.
There are at most 128 parsed formats and 64 Intl number formatters in each realm.
A warm 1,000-format test constructs one locale/precision formatter; eviction is
also tested. This is bounded object reuse, not a measured application FPS claim.

JavaScript/Intl boundaries are explicit: culture is a BCP-47 locale string/list,
not CultureInfo; unspecified culture follows the JS host. F/N/P use Intl number
formatting; E/G/R use JavaScript digit/exponent conventions. CLR currency/custom
numeric/date formats and negative hexadecimal values without a declared CLR bit
width are rejected. BigInt decimal/positive hexadecimal formatting remains exact.
A user object can implement ToString(specifier, culture). The single Binding
StringFormat path is now integrated with this bounded formatter; see
`SINGLE-BINDING-PIPELINE.md` for the additional publication/lifetime contracts.

Intentional differences from the pinned source: raw result arrays are immutable
snapshots instead of a read-only view backed by mutable storage; plain converter
functions, explicit bounds and error recovery are JS integration facilities;
unspecified TargetNullValue retains null; empty bindings publish an empty result;
OneTime is implemented according to the documented mode contract. The unused
aggregate RelativeSource field is retained for API naming, not reinterpreted as a
new group-level source override. Child source options govern resolution.

## Integration and validation

The DataValidation catalog page has a live nested-binding preview of the input.
Deterministic tests cover real RxJS streams/promises, type conversions, validation
errors, reentrancy, definitions, modes, disposal and formatter ownership. Native
tests compare all RGBA channels at five device scales through direct Skia drawing
and actual binary server replay, for both runtime and emitted AOT construction.
The native viewport intentionally isolates geometry; the browser suite displays
the complete scene and separately asserts the formatted text.

`python tests/multibinding-browser.py` is the six-case ordinary-HTTP gate:
runtime/AOT in single, render-worker and full-isolation, analytic presented-pixel
assertions after dispatcher-driven nested binding updates, renderer restart, and
zero remaining source subscriptions. It uses no asset interception, input event,
or render/snapshot RPC to repair autonomous redraw. Existing full-release gates
remain mandatory with RGBA tolerance 2. The local administrator-blocked HTTP
attempts are failures, not passes. Any intercepted local diagnostic is separately
labelled and cannot satisfy the release gate.

No new npm version, GitHub PR/merge, physical-GPU/mobile/Safari/Firefox or complete
port qualification is implied by a local source delivery. See the generated
`docs/VERIFICATION.json` and `docs/MULTIBINDING-LOCAL.json` for executed status.
