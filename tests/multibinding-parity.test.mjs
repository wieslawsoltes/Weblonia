import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { BehaviorSubject, Subject } from 'rxjs';
import { FormatComposite } from '../packages/data/src/formatting.js';
class Model {
    constructor(values = {}) { this.PropertyChanged = new A.Event(); Object.assign(this, values); }
    Set(name, value) { this[name] = value; this.PropertyChanged.Raise(this, { PropertyName: name }); }
}
class Target extends A.AvaloniaObject {}
A.DefineProperties(Target, { Value: [null, { Type: Object }], Number: [0, { Type: Number, Convert: Number }] });
const valueBinding = value => Object.assign(new A.Binding(''), { Source: value });
const multi = (bindings, converter, options = {}) => Object.assign(new A.MultiBinding(bindings, converter), options);
function attach(t, binding, model = null, property = Target.ValueProperty) {
    const target = new Target(); target.DataContext = model; t.after(() => target.Dispose());
    return { target, expression: A.BindingOperations.Apply(target, property, binding) };
}
test('MultiBinding initializes once after every synchronous child and publishes a frozen value array', t => {
    let calls = 0;
    const { target } = attach(t, multi([valueBinding('a'), valueBinding('b')], values => { calls++; assert.ok(Object.isFrozen(values)); return values.join('/'); }));
    assert.equal(target.Value, 'a/b'); assert.equal(calls, 1);
});
test('MultiBinding treats an initial UnsetValue as initialized and passes it to the converter', t => {
    let calls = 0;
    const { target } = attach(t, multi([new A.Binding('Missing'), valueBinding('ok')], values => { calls++; assert.equal(values[0], A.UnsetValue); return values[1]; }), {});
    assert.equal(target.Value, 'ok'); assert.equal(calls, 1);
});
test('MultiBinding waits for a child that initially returns DoNothing instead of formatting a phantom default', t => {
    const model = new Model({ Value: 0 }); let calls = 0;
    const child = Object.assign(new A.Binding('Value'), { Converter: value => value ? value : A.DoNothing });
    const { target } = attach(t, multi([child, valueBinding(10)], values => { calls++; return values[0] + values[1]; }), model);
    assert.equal(calls, 0); model.Set('Value', 5); assert.equal(target.Value, 15); assert.equal(calls, 1);
});
test('nested MultiBinding resolves every DataContext path against the real outer target', t => {
    const model = new Model({ Value: 'root' });
    const { target } = attach(t, multi([multi([new A.Binding('Value')], v => v[0]), valueBinding('tail')], v => v.join('/')), model);
    assert.equal(target.Value, 'root/tail'); model.Set('Value', 'changed'); assert.equal(target.Value, 'changed/tail');
});
test('nested compiled self and templated-parent roots do not resolve to internal sink objects', t => {
    const target = new A.TextBox(), parent = new A.Control(); t.after(() => { target.Dispose(); parent.Dispose(); });
    target.Tag = 'self'; parent.Tag = 'parent'; target.TemplatedParent = parent;
    const self = new A.CompiledBindingExtension(new A.CompiledBindingPathBuilder().Self().Property('Tag').Build());
    const template = new A.CompiledBindingExtension(new A.CompiledBindingPathBuilder().TemplatedParent().Property('Tag').Build());
    target.Bind(A.TextBox.TextProperty, multi([multi([self], v => v[0]), template], v => v.join('/')));
    assert.equal(target.Text, 'self/parent'); target.Tag = 'new'; assert.equal(target.Text, 'new/parent');
});
test('nested element-name binding uses the declaration namescope', t => {
    const target = new A.TextBox(), named = new A.Control(), scope = new A.NameScope(); t.after(() => { target.Dispose(); named.Dispose(); });
    named.Tag = 'found'; scope.Register('ref', named);
    const child = new A.CompiledBindingExtension(new A.CompiledBindingPathBuilder().ElementName(scope, 'ref').Property('Tag').Build());
    target.Bind(A.TextBox.TextProperty, multi([multi([child], v => v[0])], v => v[0]));
    assert.equal(target.Text, 'found'); named.Tag = 'updated'; assert.equal(target.Text, 'updated');
});
test('MultiBinding ConverterCulture, target type and parameter reach object and function converters', t => {
    for (const asObject of [false, true]) {
        const convert = (values, type, parameter, culture) => { assert.equal(type, Number); assert.equal(parameter, 3); assert.equal(culture, 'pl-PL'); return values[0] + parameter; };
        const { target } = attach(t, multi([valueBinding(7)], asObject ? { Convert: convert } : convert, { ConverterCulture: 'pl-PL', ConverterParameter: 3 }), null, Target.NumberProperty);
        assert.equal(target.Number, 10);
    }
});
test('MultiBinding applies actual target metadata conversion', t => {
    const { target } = attach(t, multi([valueBinding(7)], () => '42'), null, Target.NumberProperty);
    assert.equal(target.Number, 42); assert.equal(typeof target.Number, 'number');
});
test('MultiBinding skips StringFormat for a known numeric target', t => {
    const { target } = attach(t, multi([valueBinding(7)], v => v[0], { StringFormat: 'not a number {0}' }), null, Target.NumberProperty);
    assert.equal(target.Number, 7);
});
test('MultiBinding StringFormat formats converter output, not original inputs', t => {
    const { target } = attach(t, multi([valueBinding(2), valueBinding(3)], v => v[0] + v[1], { StringFormat: 'sum={0:F2}', ConverterCulture: 'en-US' }));
    assert.equal(target.Value, 'sum=5.00');
});
test('MultiBinding StringFormat supports indexed arguments, alignment, numeric culture and escaped braces', t => {
    const { target } = attach(t, multi([valueBinding(1234.5), valueBinding('x')], null, { StringFormat: '{{{0:N1}}} |{1,-3}|', ConverterCulture: 'de-DE' }));
    assert.equal(target.Value, '{1.234,5} |x  |');
});
test('MultiBinding DoNothing preserves both an existing value and StringFormat suppression', t => {
    const model = new Model({ Value: 1 });
    const { target } = attach(t, multi([new A.Binding('Value')], v => v[0] === 2 ? A.DoNothing : v[0], { StringFormat: 'v={0}' }), model);
    assert.equal(target.Value, 'v=1'); model.Set('Value', 2); assert.equal(target.Value, 'v=1'); model.Set('Value', 3); assert.equal(target.Value, 'v=3');
});
test('MultiBinding applies TargetNullValue and FallbackValue to distinct converter results', t => {
    const model = new Model({ Value: null });
    const { target } = attach(t, multi([new A.Binding('Value')], v => v[0], { TargetNullValue: 'NULL', FallbackValue: 'MISSING' }), model);
    assert.equal(target.Value, 'NULL'); model.Set('Value', A.UnsetValue); assert.equal(target.Value, 'MISSING');
});
test('MultiBinding BindingNotification errors publish their value and clear on recovery', t => {
    const model = new Model({ Value: 0 }), error = new Error('invalid input');
    const { target } = attach(t, multi([new A.Binding('Value')], v => v[0] ? v[0] : new A.BindingNotification(error, A.BindingErrorType.DataValidationError, 'usable')), model);
    assert.equal(target.Value, 'usable'); assert.equal(target._bindingErrors.get(Target.ValueProperty), error);
    model.Set('Value', 4); assert.equal(target.Value, 4); assert.equal(target._bindingErrors.size, 0);
});
test('MultiBinding converter failure publishes fallback, remains subscribed and recovers', t => {
    const model = new Model({ Value: 0 });
    const { target } = attach(t, multi([new A.Binding('Value')], v => { if (!v[0]) throw new Error('bad conversion'); return v[0]; }, { FallbackValue: 9 }), model);
    assert.equal(target.Value, 9); assert.match(target._bindingErrors.get(Target.ValueProperty).message, /bad conversion/);
    model.Set('Value', 5); assert.equal(target.Value, 5); assert.equal(target._bindingErrors.size, 0);
});
test('MultiBinding invalid format publishes fallback and reports a recoverable error', t => {
    const { target } = attach(t, multi([valueBinding(5)], null, { StringFormat: '{1}', FallbackValue: 'format error' }));
    assert.equal(target.Value, 'format error'); assert.match(target._bindingErrors.get(Target.ValueProperty).message, /no argument/);
});
test('MultiBinding without converter returns immutable snapshots that never mutate a retained previous output', t => {
    const model = new Model({ Value: 1 }); const { target } = attach(t, multi([new A.Binding('Value')]), model);
    const first = target.Value; assert.ok(Object.isFrozen(first)); model.Set('Value', 2); assert.deepEqual(first, [1]); assert.deepEqual(target.Value, [2]);
});
test('MultiBinding active definitions do not change when a caller edits the shared binding graph', t => {
    const model = new Model({ Value: 1, Other: 50 }), child = new A.Binding('Value');
    const definition = multi([child], v => v[0]); const { target } = attach(t, definition, model);
    child.Path = 'Other'; definition.Bindings.push(valueBinding(99)); definition.Converter = () => 'wrong';
    model.Set('Value', 2); assert.equal(target.Value, 2);
    const second = attach(t, definition, model).target; assert.equal(second.Value, 'wrong');
});
test('shared MultiBinding definitions have independent targets and disposal ownership', t => {
    const definition = multi([new A.Binding('Value')], v => v[0]);
    const a = new Model({ Value: 'a' }), b = new Model({ Value: 'b' });
    const one = attach(t, definition, a), two = attach(t, definition, b);
    one.expression.Dispose(); assert.equal(a.PropertyChanged.Count, 0); assert.equal(b.PropertyChanged.Count, 1);
    b.Set('Value', 'b2'); assert.equal(two.target.Value, 'b2');
});
test('MultiBinding OneTime detaches child observers after the first successful aggregate', t => {
    const model = new Model({ Value: 1 }); const { target, expression } = attach(t, multi([new A.Binding('Value')], v => v[0], { Mode: A.BindingMode.OneTime }), model);
    assert.equal(model.PropertyChanged.Count, 0); model.Set('Value', 2); assert.equal(target.Value, 1);
    expression.UpdateTarget(); assert.equal(target.Value, 1);
});
test('MultiBinding OneTime does not freeze converter fallback or DoNothing', t => {
    const model = new Model({ Value: 0 });
    const { target } = attach(t, multi([new A.Binding('Value')], v => v[0] === 0 ? A.UnsetValue : v[0] === 1 ? A.DoNothing : v[0], { Mode: A.BindingMode.OneTime, FallbackValue: -1 }), model);
    assert.equal(target.Value, -1); assert.equal(model.PropertyChanged.Count, 1);
    model.Set('Value', 1); assert.equal(target.Value, -1); model.Set('Value', 2); assert.equal(target.Value, 2); assert.equal(model.PropertyChanged.Count, 0);
});
test('MultiBinding child TwoWay definitions never write converted aggregate values back to sources', t => {
    const model = new Model({ Value: 10 }); const child = new A.Binding('Value', A.BindingMode.TwoWay);
    const { target } = attach(t, multi([child], v => v[0] * 2), model);
    target.SetCurrentValue(Target.ValueProperty, 123); assert.equal(model.Value, 10); assert.equal(child.Mode, A.BindingMode.TwoWay);
    model.Set('Value', 11); assert.equal(target.Value, 22);
});
test('MultiBinding cycles and invalid child definitions leave the prior target binding intact', t => {
    const { target, expression } = attach(t, multi([valueBinding('old')], v => v[0]));
    const cycle = new A.MultiBinding(); cycle.Bindings.push(cycle);
    for (const definition of [cycle, multi([{}]), multi([new A.Binding('__proto__.x')]), multi([], null, { Mode: 'TwoWay' })]) {
        assert.throws(() => target.Bind(Target.ValueProperty, definition)); assert.equal(target.Value, 'old'); assert.equal(expression.IsDisposed, false);
    }
});
test('MultiBinding rejects excessive graph depth and child count before subscribing', t => {
    const target = new Target(); t.after(() => target.Dispose()); let deep = valueBinding(1);
    for (let i = 0; i < 66; i++) deep = multi([deep]);
    assert.throws(() => target.Bind(Target.ValueProperty, deep), /budget/);
    assert.throws(() => target.Bind(Target.ValueProperty, multi(Array(4097).fill(valueBinding(1)))), /budget/);
});
test('MultiBinding supports repeated child definitions without treating a shared DAG as a cycle', t => {
    const child = valueBinding(3); const { target } = attach(t, multi([child, child], v => v[0] + v[1])); assert.equal(target.Value, 6);
});
test('MultiBinding can be replaced from inside its own converter without stale publication', t => {
    const target = new Target(); t.after(() => target.Dispose());
    const expression = target.Bind(Target.ValueProperty, multi([valueBinding(1)], () => { target.Value = 'replacement'; return 'obsolete'; }));
    assert.equal(target.Value, 'replacement'); assert.equal(expression.IsDisposed, true); assert.equal(target._bindings.size, 0);
});
test('MultiBinding converter reentrant source changes converge without recursive converter calls', t => {
    const model = new Model({ Value: 0 }); let depth = 0, maximum = 0;
    const { target } = attach(t, multi([new A.Binding('Value')], values => {
        maximum = Math.max(maximum, ++depth); try { if (values[0] < 3) model.Set('Value', values[0] + 1); return values[0]; } finally { depth--; }
    }), model);
    assert.equal(target.Value, 3); assert.equal(maximum, 1);
});
test('MultiBinding nonconvergent reentrant converter is bounded and reports failure', t => {
    const model = new Model({ Value: 0 }); let calls = 0;
    const { target } = attach(t, multi([new A.Binding('Value')], v => { calls++; model.Set('Value', v[0] + 1); return v[0]; }, { FallbackValue: -1 }), model);
    assert.equal(target.Value, -1); assert.ok(calls <= 64); assert.match(target._bindingErrors.get(Target.ValueProperty).message, /converge/);
});
test('1000 MultiBinding attach/dispose cycles leave no target lifetime entries or source subscriptions', t => {
    const target = new Target(); t.after(() => target.Dispose()); const model = new Model({ Value: 1 }); target.DataContext = model;
    const count = target._lifetime.Count, definition = multi([new A.Binding('Value')], v => v[0]);
    for (let i = 0; i < 1000; i++) target.Bind(Target.ValueProperty, definition).Dispose();
    assert.equal(target._lifetime.Count, count); assert.equal(model.PropertyChanged.Count, 0); assert.equal(target._bindings.size, 0);
});
test('MultiBinding priority removal reveals a lower-priority binding without disposing it', t => {
    const { target } = attach(t, multi([valueBinding('style')], v => v[0], { Priority: A.BindingPriority.Style }));
    const top = target.Bind(Target.ValueProperty, multi([valueBinding('local')], v => v[0])); assert.equal(target.Value, 'local'); top.Dispose(); assert.equal(target.Value, 'style');
});
test('nested compiled observable streams retain null, reject stale streams and release subscriptions', t => {
    const one = new BehaviorSubject('one'), two = new Subject(), model = new Model({ Stream: one });
    const nested = multi([new A.CompiledBindingExtension('Stream^')], v => v[0]);
    const { target, expression } = attach(t, multi([nested], v => v[0], { TargetNullValue: 'NULL' }), model);
    assert.equal(target.Value, 'one'); model.Set('Stream', two); assert.equal(one.observers.length, 0);
    two.next(null); assert.equal(target.Value, 'NULL'); expression.Dispose(); assert.equal(two.observers.length, 0); assert.equal(model.PropertyChanged.Count, 0);
});
test('MultiBinding deferred compiled Promise values ignore completion after disposal', async t => {
    let resolve; const model = new Model({ Value: new Promise(r => resolve = r) });
    const { target, expression } = attach(t, multi([new A.CompiledBindingExtension('Value^')], v => v[0], { FallbackValue: 'waiting' }), model);
    expression.Dispose(); resolve('late'); await new Promise(r => setImmediate(r)); assert.notEqual(target.Value, 'late'); assert.equal(model.PropertyChanged.Count, 0);
});
test('MultiBinding direct properties execute their real setter', t => {
    class Direct extends A.AvaloniaObject { constructor() { super(); this.Value = ''; } }
    const property = A.AvaloniaProperty.RegisterDirect(Direct, 'Value', o => o.Value, (o, value) => o.Value = value);
    const target = new Direct(); t.after(() => target.Dispose()); target.Bind(property, multi([valueBinding('set')], v => v[0])); assert.equal(target.Value, 'set');
});
for (const [format, values, expected] of [
    ['{0,5:D3}', [7], '  007'], ['{0:X4}', [255], '00FF'], ['{0:D20}', [9007199254740993n], '00009007199254740993'],
    ['{{{0}}}', ['text'], '{text}'], ['{0}/{1}', [null, true], '/True'], ['{0:F2}', [1.25], '1.25'], ['{0:P0}', [.5], '50%']
]) test(`composite formatting ${format} preserves its value contract`, () => assert.equal(FormatComposite(format, values, 'en-US'), expected));
test('composite formatting malformed, unsupported or oversized requests fail explicitly', () => {
    for (const format of ['{', '}', '{x}', '{0,100000000}', '{99999999999999}', '{0:{1}}', '{0:C2}', '{0:Q}']) assert.throws(() => FormatComposite(format, [1], 'en-US'));
    assert.throws(() => FormatComposite('x'.repeat(65537), []), /budget/);
    assert.throws(() => FormatComposite('{0:X}', [-1]), /bit width/);
});
test('public format converters preserve inner converter output and cannot convert back', () => {
    const one = new A.StringFormatValueConverter('F1', { Convert: v => v * 2 });
    assert.equal(one.Convert(1.25, String, null, 'en-US'), '2.5'); assert.throws(() => one.ConvertBack(), /not supported/);
    const many = new A.StringFormatMultiValueConverter('answer {0}', { Convert: v => v[0] + v[1] });
    assert.equal(many.Convert([2, 5], String), 'answer 7'); assert.throws(() => { many.Format = '{1}'; }, TypeError);
    assert.equal(new A.StringFormatMultiValueConverter('{0}', () => A.DoNothing).Convert([]), A.DoNothing);
});

test('composite numeric formatter cache reuses warm culture/precision and evicts past its bound', () => {
    const Native=Intl.NumberFormat;let constructed=0;
    Intl.NumberFormat=function(...args){constructed++;return new Native(...args);};
    try {
        for(let i=0;i<1000;i++)assert.equal(FormatComposite('{0:F3}',[12.5],'de-AT-u-nu-latn'),'12,500');
        assert.equal(constructed,1);
        for(let digits=0;digits<65;digits++)FormatComposite(`{0:N${digits}}`,[1],'en-NZ');
        const before=constructed;FormatComposite('{0:F3}',[12.5],'de-AT-u-nu-latn');assert.equal(constructed,before+1);
    }finally{Intl.NumberFormat=Native;}
});

test('child fallback values are initialized converter inputs rather than aggregate errors', t => {
    const target=new A.TextBlock();t.after(()=>target.Dispose());target.DataContext={A:1};
    const binding=new A.MultiBinding([new A.Binding('A'),new A.Binding({Path:'Missing',FallbackValue:'child fallback'})],v=>v.join('/'));
    A.BindingOperations.Apply(target,A.TextBlock.TextProperty,binding);assert.equal(target.Text,'1/child fallback');
});
