import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { BindingDelayXaml, BindingDelayRegistry, BindingDelayModel } from './binding-delay-fixture.js';
import { Build } from './binding-delay-aot.js';
for (const aot of [false,true]) {
    test(`Delay ${aot?'AOT':'runtime'}: compiled markup and reflected object-element definitions retain integer milliseconds`,()=>{
        const model=BindingDelayModel(A),options={Registry:BindingDelayRegistry(A),DataContext:model};
        const view=aot?Build(new A.AvaloniaXamlServices(options)):new A.AvaloniaXamlCompiler(options).Compile(BindingDelayXaml).Build();
        try{for(const [name,Type] of [['FirstEditor',A.CompiledBindingExpression],['SecondEditor',A.BindingExpression]]){
            const editor=view.FindControl(name),e=A.BindingOperations.GetBindingExpressionBase(editor,A.TextBox.TextProperty);
            assert.ok(e instanceof Type);assert.equal(e.ParentBinding.Delay,200);assert.equal(e._delay,200);
            const before=[...model.Writes];editor.SetCurrentValue(A.TextBox.TextProperty,'pending');assert.deepEqual(model.Writes,before);
            e.UpdateSource();assert.equal(name==='FirstEditor'?model.First:model.Second,'pending');assert.equal(e._delayTimer.IsEnabled,false);
        }}finally{view.Dispose();assert.equal(model.PropertyChanged.Count+model._propertyChanges.observers.length,0);model.Dispose();}
    });
}
for(const kind of ['Binding','CompiledBinding','ReflectionBinding'])for(const object of [false,true]) {
    test(`Delay XAML ${kind} ${object?'object':'markup'} rejects non-integer and nondecimal literals`,()=>{
        for(const literal of ['NaN','Infinity','1.5','0x10','1e3','','2147483648']){
            const content=object?`<TextBox><TextBox.Text><${kind} Path="First" Delay="${literal}"/></TextBox.Text></TextBox>`:`<TextBox Text="{${kind} First, Delay='${literal}'}"/>`;
            const xaml=content.replace('<TextBox','<TextBox xmlns="https://github.com/avaloniaui"');
            assert.throws(()=>new A.AvaloniaXamlCompiler({Registry:BindingDelayRegistry(A)}).Compile(xaml).Build(),/Delay/,`${kind}/${literal}`);
        }
    });
}
test('Delay XAML parses signed milliseconds from resource-backed markup values',()=>{
    const xaml=`<StackPanel xmlns="https://github.com/avaloniaui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
        <StackPanel.Resources><x:Int32 x:Key="Wait">250</x:Int32></StackPanel.Resources>
        <TextBox x:Name="Editor" Text="{Binding First, Mode=TwoWay, Delay={StaticResource Wait}}"/>
    </StackPanel>`;
    // Resource expressions remain objects until the per-target binding preparation.
    const model=BindingDelayModel(A);const view=new A.AvaloniaXamlCompiler({Registry:BindingDelayRegistry(A),DataContext:model}).Compile(xaml).Build();
    try{assert.equal(A.BindingOperations.GetBindingExpressionBase(view.FindControl('Editor'),A.TextBox.TextProperty)._delay,250);}
    finally{view.Dispose();model.Dispose();}
});
