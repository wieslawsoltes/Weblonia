import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { Subject } from 'rxjs';
class Model {
    constructor(value) { this.Value = value; this.PropertyChanged = new A.Event(); }
    Set(value) { this.Value = value; this.PropertyChanged.Raise(this, { PropertyName: 'Value' }); }
}
class Target extends A.AvaloniaObject {}
A.DefineProperties(Target, {
    Value: [null, { Type: Object }], Text: ['', { Type: String, Convert: value => String(value ?? '') }],
    Number: [0, { Type: Number, Convert: Number, Validate: Number.isFinite }],
    Checked: [0, { Type: Number, Convert: value => value === 'reject' ? A.UnsetValue : Number(value), Validate: Number.isFinite }],
});
for (const compiled of [false, true]) {
    const name = compiled ? 'compiled' : 'reflection';
    const definition = options => Object.assign(new (compiled ? A.CompiledBindingExtension : A.Binding)('Value'), options);
    function attach(t, value, options = {}, property = Target.TextProperty) {
        const model = new Model(value), target = new Target(); target.DataContext = model;
        const expression = target.Bind(property, definition(options));
        t.after(() => target.Dispose());
        return { model, target, expression };
    }
    test(`single ${name}: shorthand numeric format and aligned escaped composite text`, t => {
        assert.equal(attach(t, 1234.5, { StringFormat: 'N1', ConverterCulture: 'de-DE' }).target.Text, '1.234,5');
        assert.equal(attach(t, 12, { StringFormat: '{{{0,6:D4}}}' }).target.Text, '{  0012}');
        assert.equal(attach(t, 7, { StringFormat: '   ' }).target.Text, '7');
    });
    test(`single ${name}: fallback bypasses converter, null substitution and formatting`, t => {
        let calls = 0;
        const { target } = attach(t, A.UnsetValue, { FallbackValue: 'unavailable', TargetNullValue: 'NULL', StringFormat: '[{0}]', Converter: () => { calls++; return 'wrong'; } });
        assert.equal(target.Text, 'unavailable'); assert.equal(calls, 0);
    });
    test(`single ${name}: converter UnsetValue selects literal fallback after conversion`, t => {
        const { target } = attach(t, 1, { Converter: () => A.UnsetValue, FallbackValue: 'retry', StringFormat: '{0:F2}' });
        assert.equal(target.Text, 'retry');
    });
    test(`single ${name}: TargetNullValue bypasses StringFormat but is target-converted`, t => {
        assert.equal(attach(t, null, { TargetNullValue: 'NULL', StringFormat: '[{0}]' }).target.Text, 'NULL');
        assert.equal(attach(t, null, { TargetNullValue: '42', StringFormat: 'bad {0}' }, Target.NumberProperty).target.Number, 42);
    });
    test(`single ${name}: incompatible target ignores even malformed StringFormat`, t => {
        assert.equal(attach(t, 7, { StringFormat: '{invalid' }, Target.NumberProperty).target.Number, 7);
    });
    test(`single ${name}: metadata converter UnsetValue selects converted fallback without a transient default`, t => {
        const { target, model } = attach(t, 4, { FallbackValue: '9' }, Target.CheckedProperty), seen = [];
        target.PropertyChanged.Add((_, e) => { if (e.Property === Target.CheckedProperty) seen.push(e.NewValue); });
        model.Set('reject'); assert.equal(target.Checked, 9); assert.deepEqual(seen, [9]);
    });
    test(`single ${name}: source BindingNotification unwraps before conversion and retains its error`, t => {
        const error = new Error('source invalid'); let seen;
        const { target, model } = attach(t, new A.BindingNotification(error, A.BindingErrorType.Error, 12), {
            Converter: value => { seen = value; return value + 1; }, StringFormat: '{0:D3}' });
        assert.equal(seen, 12); assert.equal(target.Text, '013'); assert.equal(target._bindingErrors.get(Target.TextProperty), error);
        model.Set(5); assert.equal(target.Text, '006'); assert.equal(target._bindingErrors.size, 0);
    });
    test(`single ${name}: DoNothing leaves value and validation error untouched`, t => {
        const error = new Error('still invalid');
        const { target, model } = attach(t, 1, { Converter: value => value === 1 ? new A.BindingNotification(error, A.BindingErrorType.DataValidationError, 'usable') : A.DoNothing });
        model.Set(2); assert.equal(target.Text, 'usable'); assert.equal(target._bindingErrors.get(Target.TextProperty), error);
    });
    test(`single ${name}: formatting failure uses literal fallback and recovers`, t => {
        const { target, model } = attach(t, -1, { StringFormat: 'X2', FallbackValue: 'invalid' });
        assert.equal(target.Text, 'invalid'); assert.match(target._bindingErrors.get(Target.TextProperty).message, /hexadecimal/);
        model.Set(15); assert.equal(target.Text, '0F'); assert.equal(target._bindingErrors.size, 0);
    });
    test(`single ${name}: OneTime retries converter and target conversion failures`, t => {
        const { target, model, expression } = attach(t, 'bad', { Mode: A.BindingMode.OneTime, FallbackValue: 3 }, Target.NumberProperty);
        assert.equal(target.Number, 3); assert.equal(expression._oneTimeDone, false); assert.ok(model.PropertyChanged.Count);
        model.Set(8); assert.equal(target.Number, 8); assert.equal(expression._oneTimeDone, true); assert.equal(model.PropertyChanged.Count, 0);
        model.Set(9); assert.equal(target.Number, 8);
    });
    test(`single ${name}: OneTime waits after DoNothing and releases anchor subscriptions on success`, t => {
        const model = new Model(0), target = new Target(); target.DataContext = model; t.after(() => target.Dispose());
        const count = target.PropertyChanged.Count;
        const expression = target.Bind(Target.TextProperty, definition({ Mode: A.BindingMode.OneTime, Converter: value => value || A.DoNothing }));
        assert.equal(expression._oneTimeDone, false); model.Set(7);
        assert.equal(target.Text, '7'); assert.equal(model.PropertyChanged.Count, 0); assert.equal(target.PropertyChanged.Count, count);
    });
    test(`single ${name}: converter replacing its binding cannot write or clear successor errors`, t => {
        const model = new Model(1), target = new Target(); target.DataContext = model; t.after(() => target.Dispose());
        const successorError = new Error('new owner');
        const old = target.Bind(Target.TextProperty, definition({ Converter: value => {
            if (value === 2) target.Bind(Target.TextProperty, definition({ Converter: () => new A.BindingNotification(successorError, A.BindingErrorType.Error, 'successor') }));
            return 'old';
        }}));
        model.Set(2); assert.equal(old.IsDisposed, true); assert.equal(target.Text, 'successor');
        assert.equal(target._bindingErrors.get(Target.TextProperty), successorError);
    });
    test(`single ${name}: converter can dispose target without resurrecting a value slot`, t => {
        const { model, target, expression } = attach(t, 1);
        expression.ParentBinding.Converter = value => { target.Dispose(); return 'late'; };
        assert.doesNotThrow(() => model.Set(2)); assert.ok(target.IsDisposed); assert.equal(target._values.size, 0);
    });
    test(`single ${name}: explicit disposal does not accumulate target lifetime entries`, t => {
        const target = new Target(), model = new Model(1); target.DataContext = model; t.after(() => target.Dispose());
        const before = target._lifetime.Count;
        for (let i = 0; i < 1000; i++) target.Bind(Target.TextProperty, definition()).Dispose();
        assert.equal(target._lifetime.Count, before); assert.equal(model.PropertyChanged.Count, 0);
    });
    test(`single ${name}: invalid fallback is reported without an escaping disposal/conversion exception`, t => {
        const { target, model } = attach(t, 'bad', { FallbackValue: 'also bad' }, Target.NumberProperty);
        assert.equal(target.Number, 0); assert.ok(target._bindingErrors.get(Target.NumberProperty) instanceof AggregateError);
        assert.doesNotThrow(() => model.Set(2)); assert.equal(target.Number, 2); assert.equal(target._bindingErrors.size, 0);
    });
    test(`single ${name}: explicit TwoWay reverse conversion is not sent through the display format`, t => {
        const { model, target, expression } = attach(t, 5, { Mode: A.BindingMode.TwoWay, StringFormat: 'D3', UpdateSourceTrigger: 'Explicit',
            Converter: { Convert: value => value, ConvertBack: value => Number(value) } });
        assert.equal(target.Text, '005'); target.SetCurrentValue(Target.TextProperty, '9'); assert.equal(model.Value, 5);
        expression.UpdateSource(); assert.equal(model.Value, 9);
    });
}
test('single compiled: stream DoNothing keeps OneTime pending until the first successful result', t => {
    const stream = new Subject(), target = new Target(); target.DataContext = { Value: stream }; t.after(() => { target.Dispose(); stream.complete(); });
    const b = new A.CompiledBindingExtension('Value^', A.BindingMode.OneTime); b.StringFormat = 'D2'; b.FallbackValue = 'retry';
    target.Bind(Target.TextProperty, b); stream.next(A.DoNothing); assert.equal(stream.observers.length, 1);
    stream.next(3); assert.equal(target.Text, '03'); assert.equal(stream.observers.length, 0);
});
test('single binding warm numeric formatting reuses the MultiBinding Intl cache', t => {
    const Original = Intl.NumberFormat; let created = 0;
    Intl.NumberFormat = function(...args) { created++; return new Original(...args); };
    try {
        const target = new Target(), model = new Model(0); target.DataContext = model; t.after(() => target.Dispose());
        const b = new A.Binding('Value'); b.StringFormat = 'N7'; b.ConverterCulture = 'ja-JP'; target.Bind(Target.TextProperty, b);
        for (let i=1;i<=1000;i++) model.Set(i);
        assert.equal(created, 1); assert.equal(target.Text, '1,000.0000000');
    } finally { Intl.NumberFormat = Original; }
});
for (const compiled of [false,true]) {
    const label=compiled?'compiled':'reflection';
    const bind=options=>Object.assign(new (compiled?A.CompiledBindingExtension:A.Binding)('Value'),options);
    test(`single ${label}: bounded converter reentrancy does not recurse or strand a subscription`, t=>{
        const model=new Model(1),target=new Target();target.DataContext=model;t.after(()=>target.Dispose());let calls=0,depth=0,maximum=0;
        const expression=target.Bind(Target.TextProperty,bind({FallbackValue:'limit',Converter:value=>{
            depth++;maximum=Math.max(maximum,depth);calls++;try{if(calls<1000)model.Set(value+1);return value;}finally{depth--;}
        }}));
        assert.ok(calls<=128);assert.equal(maximum,1);assert.equal(target.Text,'limit');assert.match(target._bindingErrors.get(Target.TextProperty).message,/stabilize/);
        expression.ParentBinding.Converter=null;model.Set(10);assert.equal(target.Text,'10');assert.equal(target._bindingErrors.size,0);
    });
    test(`single ${label}: OneTime errors with usable notification values do not count as success`, t=>{
        const model=new Model(0),target=new Target();target.DataContext=model;t.after(()=>target.Dispose());
        const expression=target.Bind(Target.TextProperty,bind({Mode:A.BindingMode.OneTime,Converter:value=>value?value:new A.BindingNotification(new Error('retry'),A.BindingErrorType.Error,'usable')}));
        assert.equal(target.Text,'usable');assert.equal(expression._oneTimeDone,false);model.Set(4);
        assert.equal(target.Text,'4');assert.equal(model.PropertyChanged.Count,0);assert.equal(target._bindingErrors.size,0);
    });
    test(`single ${label}: metadata conversion can replace its binding without a late write`, t=>{
        class Reentrant extends A.AvaloniaObject {}
        let target;
        A.DefineProperties(Reentrant,{Value:[0,{Type:Number,Convert:value=>{
            if(value===2)target.SetValue(Reentrant.ValueProperty,77);
            return value;
        }}]});
        const model=new Model(1);target=new Reentrant();target.DataContext=model;t.after(()=>target.Dispose());
        const old=target.Bind(Reentrant.ValueProperty,bind());model.Set(2);
        assert.ok(old.IsDisposed);assert.equal(target.Value,77);
    });
    test(`single ${label}: a throwing subscription disposer still releases target ownership`, t=>{
        const model=new Model(1),target=new Target();target.DataContext=model;t.after(()=>target.Dispose());
        const baseline=target._lifetime.Count,expression=target.Bind(Target.TextProperty,bind());
        expression._lifetime.Add(A.Disposable.Create(()=>{throw new Error('unsubscribe failed');}));
        assert.throws(()=>expression.Dispose(),AggregateError);assert.equal(target._lifetime.Count,baseline);
        assert.equal(target._bindings.size,0);assert.equal(model.PropertyChanged.Count,0);assert.equal(target.Text,'');
    });
}
for(const compiled of [false,true]) {
    const label=compiled?'compiled':'reflection';
    for(const [kind,options] of Object.entries({Path:{Path:'Value.__proto__'},Mode:{Mode:'Invalid'},Converter:{Converter:42},Format:{StringFormat:3},Trigger:{UpdateSourceTrigger:'Invalid'}}))
        test(`single ${label}: invalid ${kind} is rejected before replacing a live binding`,t=>{
            const target=new Target(),model=new Model(1);target.DataContext=model;t.after(()=>target.Dispose());
            const Type=compiled?A.CompiledBindingExtension:A.Binding;
            const existing=target.Bind(Target.TextProperty,new Type('Value'));
            assert.throws(()=>target.Bind(Target.TextProperty,Object.assign(new Type('Value'),options)));
            assert.equal(target._bindings.get(Target.TextProperty),existing);assert.equal(existing.IsDisposed,false);
            model.Set(2);assert.equal(target.Text,'2');
        });
    test(`single ${label}: disposed targets reject binding without retaining source subscriptions`,()=>{
        const target=new Target(),model=new Model(1);target.Dispose();
        const b=new (compiled?A.CompiledBindingExtension:A.Binding)('Value');b.Source=model;
        assert.throws(()=>A.BindingOperations.Apply(target,Target.TextProperty,b),/live binding target/);assert.equal(model.PropertyChanged.Count,0);
    });
}
