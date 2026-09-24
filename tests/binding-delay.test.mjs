import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';

/** Drive the real DispatcherTimer deterministically, including the gap between
 * timer expiry and dispatcher delivery. No sleeping or replacing binding logic. */
function timing(t) {
    let now = 0, id = 0; const scheduled = new Map(), callbacks = [];
    const previous = A.Dispatcher.UIThread;
    const dispatcher = new A.Dispatcher({ QueueMicrotask: cb => callbacks.push(cb), QueueTask: cb => callbacks.push(cb), Now: () => now });
    A.Dispatcher.UIThread = dispatcher;
    t.mock.method(globalThis, 'setTimeout', (callback, delay) => { const handle = ++id; scheduled.set(handle, { At: now + delay, callback }); return handle; });
    t.mock.method(globalThis, 'clearTimeout', handle => scheduled.delete(handle));
    const state = { dispatcher, get Count() { return scheduled.size; },
        Advance(milliseconds, flush = true) {
            const end = now + milliseconds; let remaining = 10000;
            while (true) {
                const next = [...scheduled].sort((a,b) => a[1].At-b[1].At)[0];
                if (!next || next[1].At > end) break;
                assert.ok(--remaining > 0, 'Timer loop must converge'); now = next[1].At; scheduled.delete(next[0]); next[1].callback();
                if (flush) state.Flush();
            }
            now = end; if (flush) state.Flush();
        },
        Flush() { dispatcher.RunJobs(); callbacks.length = 0; }
    };
    t.after(() => { dispatcher.InvokeShutdown(); A.Dispatcher.UIThread = previous; });
    return state;
}
class Model {
    constructor(value = 'initial') { this._value = value; this.Writes = []; this.PropertyChanged = new A.Event(); }
    get Value() { return this._value; }
    set Value(value) { this.Writes.push(value); this._value = value; this.PropertyChanged.Raise(this, { PropertyName: 'Value' }); }
}
class Target extends A.AvaloniaObject { constructor() { super(); this.LostFocus = new A.Event(); } }
A.DefineProperties(Target, { DataContext: [null], Value: ['initial', { Type: String, DefaultBindingMode: A.BindingMode.TwoWay }] });
for (const Type of [A.Binding, A.CompiledBindingExtension]) {
    const label = Type.name;
    function attach(t, options = {}, property = Target.ValueProperty, TargetType = Target) {
        const clock = timing(t), model = new Model(), target = new TargetType(); target.DataContext = model;
        const binding = Object.assign(new Type('Value', A.BindingMode.TwoWay), { Delay: 100 }, options);
        const expression = target.Bind(property, binding);
        t.after(() => target.Dispose());
        return { clock, model, target, expression, binding, edit: value => target.SetCurrentValue(property, value) };
    }
    test(`${label} Delay: latest target wins only after its complete quiet period`, t => {
        const { clock, model, target, edit } = attach(t);
        edit('a'); assert.equal(target.Value, 'a'); assert.deepEqual(model.Writes, []);
        clock.Advance(60); edit('ab'); clock.Advance(99); assert.equal(model.Value, 'initial');
        clock.Advance(1); assert.deepEqual(model.Writes, ['ab']); assert.equal(clock.Count, 0);
        clock.Advance(1000); assert.deepEqual(model.Writes, ['ab']);
    });
    test(`${label} Delay: one lazy reusable timer across 1000 edits and no retained value queue`, t => {
        const { clock, expression, edit, model } = attach(t); assert.equal(expression._delayTimer, null);
        edit('0'); const timer = expression._delayTimer;
        for (let i=1;i<1000;i++) edit(String(i));
        assert.equal(clock.Count, 1); assert.equal(expression._delayTimer, timer); assert.deepEqual(model.Writes, []);
        clock.Advance(100); assert.deepEqual(model.Writes, ['999']); assert.equal(clock.Count, 0);
        edit('next'); assert.equal(expression._delayTimer, timer);
    });
    test(`${label} Delay: explicit UpdateSource flushes pending work synchronously exactly once`, t => {
        const { clock, expression, edit, model } = attach(t); edit('manual'); expression.UpdateSource();
        assert.deepEqual(model.Writes, ['manual']); assert.equal(clock.Count, 0); clock.Advance(1000);
        assert.deepEqual(model.Writes, ['manual']);
    });
    for (const trigger of ['Explicit','LostFocus']) test(`${label} Delay: ${trigger} never allocates a debounce timer`, t => {
        const { clock, expression, edit, model, target } = attach(t, { UpdateSourceTrigger: trigger });
        edit('pending'); clock.Advance(1000); assert.deepEqual(model.Writes, []); assert.equal(clock.Count, 0);
        if (trigger === 'Explicit') expression.UpdateSource(); else target.LostFocus.Raise(target, {});
        assert.deepEqual(model.Writes, ['pending']); assert.equal(expression._delayTimer, null);
    });
    for (const delay of [0,-1,-2147483648]) test(`${label} Delay: nonpositive ${delay} remains synchronous`, t => {
        const { clock, model, edit, expression } = attach(t, { Delay: delay }); edit('now');
        assert.deepEqual(model.Writes, ['now']); assert.equal(clock.Count, 0); assert.equal(expression._delayTimer, null);
    });
    test(`${label} Delay: source-to-target notifications are never delayed`, t => {
        const { clock, model, target } = attach(t); model.Value = 'external';
        assert.equal(target.Value, 'external'); assert.equal(clock.Count, 0);
    });
    test(`${label} Delay: external source refresh cannot later write a stale edited value`, t => {
        const { clock, model, target, edit } = attach(t); edit('stale'); model.Value = 'external';
        assert.equal(target.Value, 'external'); clock.Advance(100);
        assert.equal(model.Value, 'external'); assert.ok(!model.Writes.includes('stale'));
    });
    test(`${label} Delay: a newer edit invalidates an expired but undispatched tick`, t => {
        const { clock, model, edit } = attach(t); edit('old'); clock.Advance(100,false);
        assert.equal(clock.dispatcher.PendingJobs, 1); edit('new'); clock.Flush(); assert.deepEqual(model.Writes, []);
        clock.Advance(99); assert.deepEqual(model.Writes, []); clock.Advance(1); assert.deepEqual(model.Writes, ['new']);
    });
    for (const operation of ['dispose','replace','clear','shutdown']) test(`${label} Delay: ${operation} cancels even an already queued tick`, t => {
        const { clock, expression, model, target, edit } = attach(t); edit('obsolete'); clock.Advance(100,false);
        if (operation === 'dispose') expression.Dispose();
        else if (operation === 'replace') target.Bind(Target.ValueProperty, new Type({ Source: { Value: 'successor' }, Path: 'Value' }));
        else if (operation === 'clear') target.ClearValue(Target.ValueProperty);
        else clock.dispatcher.InvokeShutdown();
        clock.Flush(); clock.Advance(1000); assert.deepEqual(model.Writes, []); assert.equal(clock.Count, 0);
    });
    test(`${label} Delay: obscuring the binding prevents delayed animation values entering the model`, t => {
        const { clock, model, target, edit } = attach(t); edit('draft');
        const lease = target.SetValue(Target.ValueProperty, 'animation', A.BindingPriority.Animation);
        clock.Advance(100); assert.deepEqual(model.Writes, []); lease.Dispose();
    });
    test(`${label} Delay: definition timing is captured independently by each expression`, t => {
        const { clock, model, target, edit, binding } = attach(t); binding.Delay = 200;
        const second = new Target(); second.DataContext = new Model(); t.after(()=>second.Dispose());
        second.Bind(Target.ValueProperty, binding); edit('first'); second.SetCurrentValue(Target.ValueProperty,'second');
        clock.Advance(100); assert.equal(model.Value, 'first'); assert.equal(second.DataContext.Value,'initial');
        clock.Advance(100); assert.equal(second.DataContext.Value,'second'); assert.equal(target.Value,'first');
    });
    test(`${label} Delay: OneWayToSource initial and replacement owners update immediately`, t => {
        const { clock, model, target, edit } = attach(t, { Mode: A.BindingMode.OneWayToSource });
        edit('latest'); const next = new Model('different'); target.DataContext = next;
        assert.equal(next.Value,'latest'); assert.ok(!model.Writes.includes('latest')); assert.equal(clock.Count,0);
        clock.Advance(100); assert.equal(next.Writes.filter(x=>x==='latest').length,1);
    });
    test(`${label} Delay: OneWayToSource nested owner replacement bypasses the delay`, t => {
        const first = new Model('first'), holder = { Child: first, PropertyChanged: new A.Event() };
        const { clock, target, edit } = attach(t,{ Path:'Child.Value',Source:holder,Mode:A.BindingMode.OneWayToSource });
        edit('latest'); holder.Child = new Model('second'); holder.PropertyChanged.Raise(holder,{PropertyName:'Child'});
        assert.equal(holder.Child.Value,'latest'); assert.equal(clock.Count,0); clock.Advance(100);
        assert.equal(holder.Child.Writes.length,1); assert.ok(!first.Writes.includes('latest')); assert.equal(target.Value,'latest');
    });
    test(`${label} Delay: stale converter cannot write after replacing its expression`, t => {
        let target;
        const converter = { Convert:v=>v, ConvertBack:v=> { target.Bind(Target.ValueProperty,new Type({Path:'Value',Source:{Value:'successor'}})); return v; } };
        const scene = attach(t,{Converter:converter}); target=scene.target;
        scene.edit('obsolete'); scene.clock.Advance(100); assert.deepEqual(scene.model.Writes,[]); assert.equal(target.Value,'successor');
    });
    test(`${label} Delay: converter changing DataContext cannot write into an obsolete owner`, t => {
        let target; const next=new Model('next');
        const converter={Convert:v=>v,ConvertBack:v=>{target.DataContext=next;return v;}};
        const scene=attach(t,{Converter:converter});target=scene.target;scene.edit('obsolete');scene.clock.Advance(100);
        assert.deepEqual(scene.model.Writes,[]);assert.deepEqual(next.Writes,[]);assert.equal(target.Value,'next');
    });
    test(`${label} Delay: failed reverse conversion is recoverable and leaves no active timer`, t => {
        const {clock,model,expression,target,edit}=attach(t,{Converter:{Convert:v=>v,ConvertBack:v=>{if(v==='bad')throw new Error('invalid input');return v;}}});
        edit('bad');clock.Advance(100);assert.deepEqual(model.Writes,[]);assert.match(target._bindingErrors.get(Target.ValueProperty).message,/invalid input/);
        assert.equal(clock.Count,0);edit('valid');clock.Advance(100);assert.equal(model.Value,'valid');assert.equal(target._bindingErrors.size,0);assert.equal(expression._delayTimer.IsEnabled,false);
    });
    test(`${label} Delay: sentinel ConvertBack values survive boolean negation`, t => {
        const scene=attach(t,{Path:'!Value',Converter:{Convert:()=>false,ConvertBack:()=>A.DoNothing}});
        scene.edit('edit');scene.clock.Advance(100);assert.deepEqual(scene.model.Writes,[]);
    });
    test(`${label} Delay: target lifetime and dispatcher shutdown observers remain bounded`, t => {
        const clock=timing(t),target=new Target(),model=new Model();target.DataContext=model;t.after(()=>target.Dispose());
        const count=target._lifetime.Count;
        for(let i=0;i<1000;i++){const e=target.Bind(Target.ValueProperty,Object.assign(new Type('Value',A.BindingMode.TwoWay),{Delay:100}));target.SetCurrentValue(Target.ValueProperty,String(i));e.Dispose();}
        assert.equal(clock.Count,0);assert.equal(clock.dispatcher.ShutdownStarted.Count,0);assert.equal(target._lifetime.Count,count);assert.equal(model.PropertyChanged.Count,0);
    });
}
test('Binding Delay defaults to zero and invalid values fail before replacing an attached binding', () => {
    assert.equal(new A.Binding().Delay,0); const target=new Target();target.DataContext=new Model();
    const live=target.Bind(Target.ValueProperty,new A.Binding('Value'));
    try{for(const Delay of [NaN,Infinity,-Infinity,0.5,2147483648,-2147483649,null,undefined,'100',{},true]){
        assert.throws(()=>target.Bind(Target.ValueProperty,new A.Binding({Path:'Value',Delay})),/Delay/);
        assert.equal(target._bindings.get(Target.ValueProperty),live);assert.equal(live.IsDisposed,false);
    }}finally{target.Dispose();}
});

for (const Type of [A.Binding, A.CompiledBindingExtension]) {
    test(`${Type.name} Delay: current target is reread after an earlier synchronous handler changes it`, t => {
        const clock=timing(t),model=new Model(),target=new Target();target.DataContext=model;t.after(()=>target.Dispose());
        target.PropertyChanged.Add((_,e)=>{if(e.Property===Target.ValueProperty&&e.NewValue==='raw')target.SetCurrentValue(Target.ValueProperty,'normalized');});
        target.Bind(Target.ValueProperty,Object.assign(new Type('Value',A.BindingMode.TwoWay),{Delay:100}));
        target.SetCurrentValue(Target.ValueProperty,'raw');clock.Advance(100);
        assert.deepEqual(model.Writes,['normalized']);assert.equal(target.Value,'normalized');
    });
    test(`${Type.name} Delay: direct-property targets participate in source updates`, t => {
        const clock=timing(t),model=new Model();class DirectTarget extends Target{constructor(){super();this._value='initial';}}
        const property=A.AvaloniaProperty.RegisterDirect(DirectTarget,'DirectValue',x=>x._value,(x,v)=>x.SetAndRaise(property,'_value',v),{DefaultValue:'initial',Type:String});
        const target=new DirectTarget();target.DataContext=model;t.after(()=>target.Dispose());
        target.Bind(property,Object.assign(new Type('Value',A.BindingMode.TwoWay),{Delay:100}));
        target.SetCurrentValue(property,'delayed');assert.equal(target.GetValue(property),'delayed');assert.deepEqual(model.Writes,[]);
        clock.Advance(100);assert.deepEqual(model.Writes,['delayed']);
    });
    test(`${Type.name} Delay: normalization is read back without scheduling another write`, t => {
        const clock=timing(t);class Normalized extends Model{get Value(){return super.Value;}set Value(v){super.Value=String(v).trim().toUpperCase();}}
        const model=new Normalized(),target=new Target();target.DataContext=model;t.after(()=>target.Dispose());
        target.Bind(Target.ValueProperty,Object.assign(new Type('Value',A.BindingMode.TwoWay),{Delay:100}));
        target.SetCurrentValue(Target.ValueProperty,' normalized ');clock.Advance(100);
        assert.equal(target.Value,'NORMALIZED');assert.deepEqual(model.Writes,['NORMALIZED']);assert.equal(clock.Count,0);
    });
    test(`${Type.name} Delay: maximum positive Int32 remains bounded without timer overflow`, t => {
        const clock=timing(t),model=new Model(),target=new Target();target.DataContext=model;t.after(()=>target.Dispose());
        target.Bind(Target.ValueProperty,Object.assign(new Type('Value',A.BindingMode.TwoWay),{Delay:2147483647}));
        target.SetCurrentValue(Target.ValueProperty,'last');clock.Advance(2147483646);assert.deepEqual(model.Writes,[]);
        clock.Advance(1);assert.deepEqual(model.Writes,['last']);
    });
    test(`${Type.name} Delay: OneWay and OneTime do not schedule source writes`, t => {
        const clock=timing(t),model=new Model();for(const Mode of ['OneWay','OneTime']){
            const target=new Target();target.DataContext=model;t.after(()=>target.Dispose());
            const e=target.Bind(Target.ValueProperty,new Type({Path:'Value',Mode,Delay:10}));target.SetCurrentValue(Target.ValueProperty,'draft');
            clock.Advance(1000);assert.equal(e._delayTimer,null);assert.equal(clock.Count,0);assert.deepEqual(model.Writes,[]);
        }
    });
    test(`${Type.name} Delay: unshared reusable definitions own independent timers and lifetimes`, t => {
        const clock=timing(t),binding=new Type({Path:'Value',Mode:'TwoWay',Delay:100});const targets=[new Target(),new Target()];
        for(const target of targets){target.DataContext=new Model();target.Bind(Target.ValueProperty,binding);t.after(()=>target.Dispose());}
        targets[0].SetCurrentValue(Target.ValueProperty,'first');targets[1].SetCurrentValue(Target.ValueProperty,'second');assert.equal(clock.Count,2);
        targets[0].Dispose();clock.Advance(100);assert.equal(targets[1].DataContext.Value,'second');assert.equal(clock.Count,0);
    });
    test(`${Type.name} Delay: reverse notification errors preserve target drafts until recovery`, t => {
        const clock=timing(t),model=new Model(),target=new Target();target.DataContext=model;t.after(()=>target.Dispose());
        const error=new Error('validation');target.Bind(Target.ValueProperty,new Type({Path:'Value',Mode:'TwoWay',Delay:20,
            Converter:{Convert:v=>v,ConvertBack:v=>v==='bad'?new A.BindingNotification(error,A.BindingErrorType.DataValidationError,'do not write'):v}}));
        target.SetCurrentValue(Target.ValueProperty,'bad');clock.Advance(20);assert.equal(target.Value,'bad');assert.deepEqual(model.Writes,[]);
        assert.equal(target._bindingErrors.get(Target.ValueProperty),error);target.SetCurrentValue(Target.ValueProperty,'good');clock.Advance(20);
        assert.equal(model.Value,'good');assert.equal(target._bindingErrors.size,0);
    });
    test(`${Type.name} Delay: target disposal cancels native timeout before expiry`, t => {
        const clock=timing(t),model=new Model(),target=new Target();target.DataContext=model;
        target.Bind(Target.ValueProperty,new Type({Path:'Value',Mode:'TwoWay',Delay:100}));target.SetCurrentValue(Target.ValueProperty,'draft');
        assert.equal(clock.Count,1);target.Dispose();clock.Advance(1000);assert.equal(clock.Count,0);assert.deepEqual(model.Writes,[]);
    });
    test(`${Type.name} Delay: malformed nested leaf fails before aggregate replaces the target`, () => {
        const target=new Target();target.DataContext=new Model();const live=target.Bind(Target.ValueProperty,new Type('Value'));
        try{assert.throws(()=>target.Bind(Target.ValueProperty,new A.MultiBinding([new Type({Path:'Value',Delay:NaN})])),/Delay/);
            assert.equal(target._bindings.get(Target.ValueProperty),live);assert.equal(live.IsDisposed,false);
        }finally{target.Dispose();}
    });
}
