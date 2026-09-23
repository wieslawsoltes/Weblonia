/** Emit the exact integration fixture using our ordinary direct-AOT compiler. */
import {readFile,writeFile} from 'node:fs/promises';
import {AvaloniaXamlCompiler,XamlTypeRegistry} from '@wieslawsoltes/avalonia-markup-xaml';
import * as A from '@wieslawsoltes/avalonia';
const text=await readFile(new URL('../tests/glyph-geometry-scene.js',import.meta.url),'utf8');
const source=text.match(/source=`([\s\S]*?)`;/)?.[1];if(!source)throw new Error('Missing integration XAML fixture.');
class RunExtension{ProvideValue(){throw new Error('The runtime provides the actual glyph run.');}}
const registry=new XamlTypeRegistry().RegisterAssembly(A);registry.RegisterType('RunExtension',RunExtension,'urn:glyph-integration');
const result=new AvaloniaXamlCompiler({Registry:registry}).Compile(source);
await writeFile(new URL('../tests/glyph-geometry-aot.js',import.meta.url),result.JavaScript);
