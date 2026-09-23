import { writeFile } from 'node:fs/promises';
import * as A from '@wieslawsoltes/avalonia';
import { ResourceXaml, ResourceRegistry } from '../tests/resource-fixture.js';
const {Registry} = ResourceRegistry(A);
const result = new A.AvaloniaXamlCompiler({Registry}).Compile(ResourceXaml);
await writeFile(new URL('../tests/resource-aot.js',import.meta.url), result.JavaScript);
