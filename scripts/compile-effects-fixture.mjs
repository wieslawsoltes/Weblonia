/** Emit the actual integration XAML through the normal direct-AOT compiler. */
import { readFile, writeFile } from 'node:fs/promises';
import { AvaloniaXamlCompiler } from '@wieslawsoltes/avalonia-markup-xaml';
import '@wieslawsoltes/avalonia';
const file = new URL('../tests/effects-transition-scene.js', import.meta.url);
const text = await readFile(file, 'utf8'), source = text.match(/const source = `([\s\S]*?)`;/)?.[1];
if (!source) throw new Error('Missing effects integration XAML fixture.');
const result = new AvaloniaXamlCompiler().Compile(source);
await writeFile(new URL('../tests/effects-transition-aot.js', import.meta.url), result.JavaScript);
