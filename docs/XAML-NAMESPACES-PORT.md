# XamlX namespace compatibility and qualified member resolution

This increment ports the semantic behavior of the pinned XamlX
CompatibleXmlReader and its CompatibleNamespaces parser settings to the existing
bounded JavaScript XML/AST pipeline. It does not replace XamlX with a DOM parser,
reflection evaluator, or string-based runtime code generation.

## Public entry points

`XamlXmlParser.Parse(source, {CompatibleNamespaces})` accepts a Map or namespace
dictionary, as does `new AvaloniaXamlCompiler({CompatibleNamespaces}).Compile`.
The XamlX package now also exports `XDocumentXamlParserSettings` and
`XDocumentXamlParser.Parse(source, settingsOrNamespaceMappings)` with their upstream
names. The JavaScript input is a string, not a CLR TextReader. Mapping values are
snapshotted per parse. Mapping is one-step, not transitive.

`mc:Ignorable` is resolved against the lexical namespace declarations on its own
element, including declarations later in the start tag. The inherited set stores
namespace URIs, not prefix spellings: rebinding a prefix does not change the
meaning of an ancestor declaration, and child declarations do not leak into a
sibling. A mapped/understood namespace remains active even if listed as ignorable.

Ignored attributes and complete ignored element subtrees are removed before
markup-extension parsing, construction, binding creation and AOT emission. An
ignored custom constructor is never called and ignored names never enter the
namescope. Nevertheless the complete source still passes XML character, nesting,
node and size checks before compatibility processing: ignored content cannot
hide malformed XML, DTDs, external entities or an oversized source.

Type namespaces, attribute namespaces and lexical namespace tables are mapped
together. Deferred templates and custom extensions see the same resolved
namespaces as normal construction. Duplicate expanded attributes introduced by
mapping fail explicitly. Without mappings, the compatibility pass reuses lexical
tables and attribute arrays when no filtering is needed; child compaction is
in-place. It adds one linear AST traversal, not another serialized document or a
per-frame rendering operation.

## Actual attached-member owners

Prefixed attached attributes and property elements now keep their prefix through
runtime and direct-AOT services. `other:Grid.Row` is resolved against `other`, not
against whichever Grid exists in the default namespace. A markup extension's
IProvideValueTarget receives that exact registered attached property and actual
target object. A custom type named Design is not discarded as built-in design
metadata. Unsupported non-ignorable namespaced ordinary attributes fail instead
of impersonating unqualified Name, Classes, Width or an event.

The Canvas catalog example uses explicitly qualified layout properties and
ignorable design metadata. Its layout is intentionally unchanged. The isolated
worker receives compiled structures/resources; it does not need a new namespace
transport protocol or a native handle from the main thread.

## XML normalization and validation

Raw CRLF/CR normalize to LF before parsing. Literal attribute tabs/newlines become
spaces before references are expanded, so `&#x9;` still denotes a real tab and
`&#xD;` a real carriage return. `xml:space="preserve"` remains inherited and
`default` resets it. XML whitespace is distinguished from arbitrary JavaScript
Unicode whitespace when building the AST.

Raw and referenced XML 1.0 characters are checked, including ignored content,
comments and CDATA. Invalid QNames, reserved xml/xmlns bindings, undeclared or
empty prefixed bindings, missing whitespace between attributes, raw `]]>`, and
CDATA outside the document element are rejected. Numeric hex references require
the XML lowercase `x` marker (hex digits may use either case).

## Verification and limitations

Sixty deterministic parser/runtime/direct-AOT tests and ten native tests cover
five render scales (1, 1.25, 1.5, 2, 3), all-RGBA immediate and binary server replay,
namespace-qualified binding movement and colors. The generated AOT test module is
checked byte-for-byte against fresh compiler output. Before/after probes confirmed
that ignored subtree construction, qualified owner resolution and literal-tab
normalization fail on the previous implementation and pass on this one.

The six-case ordinary-HTTP browser gate constructs runtime/AOT scenes in single,
render-worker and full-isolation modes. It checks browser-presented pixels after
binding mutation without input or render/snapshot RPCs, then checks worker
restart. It also verifies ignored child counts, qualified attached bindings and
preserved text. Local Chromium administrator policy blocks ordinary navigation;
those local attempts are not browser passes. Actual HTTP qualification is a CI
requirement, with the existing two-channel-unit RGBA tolerance unchanged.

This is not complete XML or ECMA markup-compatibility conformance. AlternateContent,
MustUnderstand, ProcessContent and preservation directives are explicitly
unsupported rather than silently misinterpreted. The pinned XamlX reader ignores
more MC directives; this port intentionally fails unsupported directives on live
nodes. The port retains nested lexical namespace support rather than the pinned
XDocument parser's root-only xmlns restriction, rejects invalid xml:space values,
and rejects __proto__/constructor/prototype prefixes because of the existing
plain-object AOT/worker metadata ABI. General processing-instruction/XML-declaration
validation and exhaustive XML NameStartChar coverage are not claimed. No broader
CLR IL/reflection or compiled-binding transformation parity is implied.
