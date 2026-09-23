# Single-binding conversion, formatting and lifetime continuation

This change follows the nested MultiBinding increment. It does not replace the
property system or renderer, introduce a new text shaper, or claim full Avalonia
and XamlX parity. The browser default and Skia native assets are unchanged.

## Publication contract

Both `BindingExpression` and `CompiledBindingExpression` now use one publication
path. The ordering follows the pinned upstream `BindingExpression.cs`:

1. Unwrap source notifications; skip the user converter for UnsetValue/DoNothing.
2. Apply the user converter to a real source value and extract its notification.
3. DoNothing preserves the previous target AND its current validation state.
4. TargetNullValue replaces only nullish values, then converts to the target type.
   Its literal is not fed back through StringFormat or the user converter.
5. Format non-sentinel values only when targeting String, Object or a property
   whose metadata does not declare a type. Bare formats such as N2 become {0:N2}.
   Whitespace-only formats are disabled. Escaped braces, alignment and numeric
   formats use the same bounded parser/Intl caches as MultiBinding.
6. Target metadata conversion runs once. A converter-produced UnsetValue selects
   FallbackValue BEFORE publishing, so a default-value flicker is not introduced.
7. Missing, failed, or invalid results use a target-converted literal fallback.
   Fallback values do not pass through the user converter or StringFormat. If
   both conversion and fallback fail, the validation error retains both failures.

Source validation notifications with usable values remain errors while their
values are converted and rendered. A subsequent successful publication clears
that error. Native target type conversion is not a new CLR TypeConverter port:
this uses the existing registered JavaScript property metadata.

The established JavaScript function converter `(value, parameter)` adapter is
preserved. Object IValueConverter implementations still receive
`Convert(value, targetType, parameter, culture)`. ConvertBack is not routed
through display formatting; Explicit/LostFocus writeback semantics are retained.

## Ownership and reentrancy

Formatting, converters, metadata conversion and validation notification can run
application code. A disposed/replaced expression checks its ownership boundary
before publication and cannot write over its successor or clear its new error.
Reflection refresh loops now have the same finite 128-pass convergence budget as
compiled refreshes; nested notifications are drained rather than recursively
calling converters. These are realm-local synchronous semantics, not cross-worker
synchronous dispatch or an event-loop quiescence guarantee.

OneTime completes after the first successful target conversion/publication, not
a DoNothing, fallback or usable error notification. Completion releases source,
anchor and compiled-node observers. Explicit disposal removes the expression's
entry from the target lifetime even if a subscription disposer throws. Invalid
path syntax, converter/mode/trigger/format types are rejected before replacing an
existing target binding. Missing source paths remain recoverable values.

## Validation

`tests/single-binding-pipeline.test.mjs` has 54 new cases. Six selected regressions
were run against the previous implementation and failed; the new implementation
passed all 1,017 Node tests locally. Coverage includes both binding engines,
1,000 attach/dispose cycles, 1,000 updates sharing one Intl formatter, reentrant
replacement, malformed format recovery, target-null/fallback ordering, metadata
conversion, explicit writeback and bounded nonconvergent sources.

The runtime/direct-AOT native integration now also asserts aligned, localized and
null-substituted single-binding values at five device scales while comparing real
Skia and binary-server RGBA. The six ordinary-HTTP MultiBinding cases additionally
exercise both compiled and reflection display formatting in each threading mode,
with already-presented canvas pixels and zero retained source subscriptions on
release. Their release gate now requires `SingleBindingPipeline: true`.
No pixel tolerance is relaxed. Browser success must be established by executing
that gate; Node tests and intercepted diagnostics alone are not HTTP qualification.

## Boundaries

The earlier documented bounded .NET/Intl formatting differences still apply:
custom/currency/date formats and negative hexadecimal without a declared CLR bit
width are not implemented. Settings remain creation-time binding definitions;
this does not add dynamic bindings to Binding options or general source inference.
The existing OneTime contract freezes after its first successful aggregate/value;
this change does not introduce a different DataContext reset policy. Broader
validation plugins, source-update Delay, styles/setter type inference and full
CLR binding equivalents remain separate work.
