# Deferred resources and lexical XAML resource contexts

This increment continues the JavaScript port from Weblonia commit
f60cb93e02bbcac2f905834ab2f0a4709b8ca73c. It changes the resource dictionary,
lookup observer and both XAML construction paths. It does not change native
SkiaSharpWeb, text rasterization, worker transport, full-isolation default or the
shared native-code startup path.

## Dictionary contract

ResourceDictionary now implements AddDeferred(key, factoryOrBuildProvider),
AddNotSharedDeferred, ContainsDeferredKey, SetItems, Keys, Values, HasResources
and EnsureCapacity alongside the existing Map-compatible API. Factories receive
null as their service-provider argument. Ordinary objects with a Build method are
ordinary values unless explicitly registered as deferred entries. Factories must
be synchronous; returned promises are rejected explicitly with their eventual
rejections observed.

Shared entries realize on first successful lookup, including null/undefined/false,
and preserve that identity on subsequent lookups. Nonshared entries build on each
lookup. Failures do not poison an entry. Realization is not a resource-change
notification. Enumeration, ContainsKey, replacement, removal, bulk replacement,
clear and disposal never invoke discarded factories. Enumeration exposes raw
entries, like the pinned dictionary's enumerator; it is not a materialize-all API.

All active keys are guarded, not just the last key: same-key lookups fall through
to lower dictionary definitions, multi-key cycles terminate, and distinct-key
nesting is limited to 128. A factory that changes its own entry cannot overwrite
that newer mutation when it returns. Dispose releases retained factories, entries
and dictionary subscriptions, not borrowed value objects or child dictionaries.
Consumers remain responsible for borrowed disposable resources.

EnsureCapacity validates its argument but cannot reserve JavaScript Map storage.
SetItems materializes and validates [key,value] pairs before publication, and emits
one notification. This is deliberately stronger than upstream's partial update on
an enumerator failure. The public Map and existing Owner field remain compatible;
this increment does not introduce the complete ResourceProvider/IResourceHost
single-owner lifecycle or ITemplateResult-unwrapping interface family.

## Lookup and notifications

Precedence is local, requested theme/inherited themes, default theme, then merged
dictionaries in reverse order. Nested providers keep the ORIGINAL requested theme
while locating an inherited fallback. ThemeVariant keys and their string keys
resolve consistently. HasResources preserves the pinned implementation's direct
and merged-resource semantics (theme-only dictionaries are not included).

Known dictionary cycles are rejected before adding/replacing an edge. Shared DAGs
are supported. Child subscriptions are incrementally retained, and a propagation
token prevents duplicate diamond notifications. Reverse merged lookup does not
allocate a reversed copy. Arbitrary external provider implementations and deliberate
Map/array prototype bypasses are outside graph validation.

GetResourceObservable watches the live ancestry, including each ancestor's logical
and visual attachment events. Moving an entire detached subtree rewires a nested
consumer; changing an obsolete ancestor no longer reaches it. Theme changes are
observed, duplicate equal values suppressed, and unsubscribe (including synchronous
Rx take(1)) releases handlers. Reentrant notifications are bounded to 128 iterations.
This is an explicit error for a factory that perpetually mutates its own lookup
scope, not an unbounded event-loop task.

## Runtime and direct AOT XAML

Reference-type resources are deferred by default. x:Shared=True uses one successful
instance; x:Shared=False constructs independent instances. Scalar values/strings
and resources with names in the current scope stay eager. Names inside a template's
nested scope do not force the template resource. x:Shared outside resources does
not introduce duplication. Boolean syntax is validated. Unlike the pinned upstream
transformer's omitted out-value assignment, explicit True is honored as True.

A deferred entry keeps declaration-time resource providers, the nearest resource
host, root/code-behind, namespace/type context, URI and parent-stack services.
Static dependencies therefore resolve inside standalone and explicit resource
dictionaries, including same-key overrides and later declarations. Explicit
ResourceDictionary property elements populate the actual existing owner dictionary
instead of copying factories that capture a temporary table. Deferred controls
inherit the host's live data context rather than copying a local value. Brush
DynamicResource bindings follow the declaration host's theme. Styled controls use
live ancestry so their resource lookup changes when adopted elsewhere.

Resource keys are evaluated once at declaration; reconstructed resource builders
reuse the declared key. Parsed source location/type metadata identifies that entry
in both execution paths. Each realization has a separate construction context,
with failure cleanup and no mutation of the declaring context's construction arrays.
Its shared namescope is not completed again; template instances own independent
completed scopes. Named descendants, code-behind, type validation and lexical
xml:base are covered explicitly by runtime and emitted-AOT tests.

The AOT emitter creates ordinary ESM factory callbacks containing direct ctx.Create,
Attribute, Property and Content instructions. Realizing an ordinary compiled
resource does not call the AST interpreter. No eval or Function construction is
added. The pre-existing template implementation still uses CreateTemplate; this is
not a claim that all template/compiler transformations have been ported. Unknown
members in a deferred resource are diagnosed upon its construction, not via a new
whole-program static validation pass. Resource extension-result and template-result
interface generalization remain separate work.

## Sample and qualification

ControlCatalog's ThemeVariants page demonstrates independent unshared brush
instances, live theme resources and a control constructed only when requested.
Its actions use property mutation and normal resource lookup, not a manual redraw.

New deterministic tests cover lazy identity/null/failure/reentrancy, atomic updates,
theme fallback, DAG validation, independent subscriptions, 1,000 ancestry moves,
1,000 dormant resource definitions, runtime/AOT service lifetimes, key evaluation,
live bindings, code-behind and sample actions. Native raster tests compare all four
RGBA channels at 1x, 1.25x, 1.5x, 2x and 3x in both runtime/AOT paths.

The six-case ordinary-HTTP suite tests runtime/AOT in single, render-worker and
full-isolation modes. It inspects browser-presented pixels through a theme switch,
whole-subtree reparenting, old-scope mutation, independent brush mutation, lazy
creation and renderer restart. No input or render/snapshot RPC repairs these
updates. Tolerance remains 2. This gate is source-fingerprint-bound and added to
complete CI/release validation. A locally intercepted diagnostic is not a substitute
for ordinary HTTP qualification; local administrator-blocked HTTP attempts are
reported as failures, never passes. Physical-GPU/multibrowser/mobile and full
Avalonia/XamlX parity are not asserted.
