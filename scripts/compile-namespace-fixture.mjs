/** Emit the same XAML used by the real worker/browser integration test. */
import { writeFile } from 'node:fs/promises';
import { AvaloniaXamlCompiler } from '@wieslawsoltes/avalonia-markup-xaml';
import '@wieslawsoltes/avalonia';
import { NamespaceXaml, NamespaceMappings } from '../tests/xaml-namespace-fixture.js';
const result = new AvaloniaXamlCompiler({ CompatibleNamespaces: NamespaceMappings }).Compile(NamespaceXaml);
await writeFile(new URL('../tests/xaml-namespace-aot.js', import.meta.url), result.JavaScript);
