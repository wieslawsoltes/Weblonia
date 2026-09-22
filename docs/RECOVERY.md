# 0.6.2 recovery and invalidation continuation

The 0.6.1 source archive was extracted intact and all **1,839** manifest-listed
files matched their SHA-256 hashes. All **15** individually supplied performance
runtime/test files were overlaid; that recovered baseline passed **421 Node tests**
before this invalidation work. None of the recovered performance changes is omitted
from the new full source package. Baseline and recovered input hashes are in
[`recovery/recovery-invalidation.json`](recovery/recovery-invalidation.json).

All current worker graphs, static assets and npm tarballs are rebuilt from the
combined implementation. Historical provenance below describes older releases.

# 0.6.0 threaded continuation provenance

The original `0.5.1-alpha.1` source archive was recovered intact. All **1,137**
baseline manifest files match their hashes and its **345** original Node tests
passed before modification. The archive remains unchanged. This continuation
adds actual worker/protocol/browser-integration source, generated worker graphs
and executable qualification; no source is inferred from screenshots.
`recovery/recovery-threading.json` records the archive and baseline identities.

The 18th reusable package is `@wieslawsoltes/avalonia-rendering`. The original
SkiaSharpWeb vendor bytes and previously merged source pin remain unchanged.
Native worker bootstrap is an adapter alongside the existing renderer, not an
unreported native binary patch. This release contains no remote repository write.

The earlier provenance records below are historical.

# Optimized package recovery

The 0.5.0-alpha.1 source archive was recovered intact and all 1,073 baseline
manifest entries verified. Eleven supplied source/test files from the performance
session were overlaid into a separate workspace. The original files and archive
remain unchanged. `recovery/recovery-optimized.json` records their hashes.
Current tests, builds and packages are regenerated; historical benchmark reports
are marked as intermediate evidence, not final qualification.

# 0.5.0 continuation provenance

The mounted `AvaloniaWeb-0.4.0-alpha.1-source.zip` was recovered intact. All **991**
baseline manifest hashes matched. Its **268** original Node tests passed before
modification. The original archive remains unchanged; a separate clean extraction
is the comparison baseline. `recovery/recovery-0.5.json` records its SHA-256 and
fresh baseline results. All changes in this release are actual source changes;
no absent snapshot or screenshot was claimed as recovered source.

The final source archive contains all implemented code plus a generated hash
manifest. Extraction and patch-application checks are separate executed release
evidence. The sections below retain the identities of previous recoveries.

# 0.4.0 continuation provenance

The mounted `AvaloniaWeb-0.3.0-alpha.1-source.zip` was recovered without loss.
All 928 source-manifest hashes were verified, and its 242-test baseline passed
before this continuation. `recovery/recovery-0.4.json` records its SHA-256 and the
local baseline commit. SkiaSharpWeb integration is pinned to the merged upstream
PR, not to an unverified development snapshot. The records below document the
older 0.2-to-0.3 recovery and retain their original identities.

# Recovery provenance

The mounted `AvaloniaWeb-0.2.0-alpha.1-source.zip` is the recoverable source baseline.
Its SHA-256 is `b00330e60a45fd229a90cee7d437ae6e5af643646bfadd13c6c92c08dbb6e7ca`.
All 882 file entries in its manifest matched their recorded hashes. The archive
was preserved unchanged and extracted to a separate baseline. The recovered
checkout independently passed all 196 baseline Node tests before modification.

The later `AvaloniaWeb-text-performance-source.zip` mentioned in an earlier reply
was not present among the mounted files. Only two later screenshots survived.
They are preserved in `recovery/surviving-later-screenshots/` as historical visual
evidence, not as proof of implementation or current rendering results. No source
was reconstructed from pixels or falsely attributed to that unavailable ZIP.

This release retains the baseline's complete implemented source, 17 libraries,
local SkiaSharpWeb/ReactiveWeb/RxJS dependencies, ControlCatalog, XAML modules,
licenses and build tools. The text/cache/compiled-binding improvements were newly
implemented and tested on this recovered baseline. Current images and reports
are under `artifacts/`, including `screenshots/text-quality.png`.

`recovery/recovery-report.json` records baseline validation.
`recovery/baseline-verification.json` is explicitly historical.
`recovery/source-changes.json` and `recovery/continuation.patch` identify the new
source relative to the verified baseline. Local Git checkpoints preserve progress;
there has been no remote repository write or publication.

The source ZIP is a complete package of the implemented release. It is not the
complete upstream Avalonia/XamlX Git history or a claim of full behavioral parity.
See COMPATIBILITY.md. The new SOURCE-MANIFEST.json records packaged file sizes and
SHA-256 hashes, excluding itself. The release extraction report is generated by
checking the final archive and rerunning its tests/build/package consumer.
