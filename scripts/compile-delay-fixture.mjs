import { writeFile } from 'node:fs/promises';
import * as A from '@wieslawsoltes/avalonia';
import { BindingDelayXaml, BindingDelayRegistry } from '../tests/binding-delay-fixture.js';
const compilation = new A.AvaloniaXamlCompiler({ Registry: BindingDelayRegistry(A) }).Compile(BindingDelayXaml);
await writeFile(new URL('../tests/binding-delay-aot.js', import.meta.url), compilation.JavaScript);
