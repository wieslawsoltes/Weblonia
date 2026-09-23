import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
for (const Type of [A.Binding, A.CompiledBindingExtension]) test(`${Type.name}: metadata conversion must not write a presentation adjustment back to the source`, () => {
    class Model extends A.AvaloniaObject {}
    A.DefineProperties(Model, { Value: [1] });
    class Target extends A.AvaloniaObject {}
    let target;
    A.DefineProperties(Target, { Value: [0, { Type: Number, Convert: value => {
        if (value === 2) target.SetCurrentValue(Target.ValueProperty, 77);
        return value;
    }}] });
    const model = new Model(); target = new Target(); target.DataContext = model;
    target.Bind(Target.ValueProperty, new Type('Value', A.BindingMode.TwoWay));
    try { model.Value = 2; assert.equal(model.Value, 2); assert.equal(target.Value, 2); }
    finally { target.Dispose(); model.Dispose(); }
});
