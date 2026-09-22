/** ControlCatalog policy only; the library's default is intentionally unchanged. */
export function ResolveCatalogThreadingMode(
    search = globalThis.location?.search ?? '',
    bootOptions = globalThis.AVALONIA_BOOT_OPTIONS,
    legacyMode = globalThis.AVALONIA_THREADING
) {
    return bootOptions?.ThreadingMode ?? legacyMode
        ?? new URLSearchParams(search).get('threading') ?? 'full-isolation';
}
