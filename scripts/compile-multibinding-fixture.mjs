import { writeFile } from 'node:fs/promises';
import * as A from '@wieslawsoltes/avalonia';
import { MultiBindingXaml, MultiBindingRegistry } from '../tests/multibinding-fixture.js';
const result = new A.AvaloniaXamlCompiler({ Registry: MultiBindingRegistry(A) }).Compile(MultiBindingXaml);
await writeFile(new URL('../tests/multibinding-aot.js', import.meta.url), result.JavaScript);
