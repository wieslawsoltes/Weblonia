import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { XamlTypeRegistry, AvaloniaXamlCompiler, AvaloniaXamlServices, IProvideValueTarget, IRootObjectProvider,
    IUriContext, IXamlTypeResolver, IAvaloniaXamlIlParentStackProvider, IAvaloniaXamlIlEagerParentStackProvider,
    IServiceProvider, XamlRuntimeContext } from '@wieslawsoltes/avalonia-markup-xaml';
const ns='xmlns="https://github.com/avaloniaui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:t="urn:test"';
function setup() {
    const captures=[];
    class ProbeExtension { constructor(){this.Value='probe';} ProvideValue(p){captures.push({p,extension:this});return this.Value;} }
    class OuterExtension { constructor(){this.Value=null;} ProvideValue(p){captures.push({p,extension:this});return this.Value;} }
    const registry=new XamlTypeRegistry().RegisterAssembly(A);registry.RegisterType('ProbeExtension',ProbeExtension,'urn:test');registry.RegisterType('OuterExtension',OuterExtension,'urn:test');
    return {captures,registry,ProbeExtension,OuterExtension};
}
async function build(source,registry,options={},aot=false){const compiled=new AvaloniaXamlCompiler({Registry:registry,...options}).Compile(source);
    if(!aot)return compiled.Build();const module=await import('data:text/javascript;base64,'+Buffer.from(compiled.JavaScript).toString('base64'));return module.Build(new AvaloniaXamlServices({Registry:registry,...options}));}
for(const aot of [false,true]) {
    const label=aot?'AOT':'runtime';
    test(`XAML ${label}: target property, root, scoped names, URI and type resolver are real services`,async()=>{
        const s=setup();const root=await build(`<StackPanel ${ns} x:Name="root"><TextBlock x:Name="label" Text="{t:Probe}"/></StackPanel>`,s.registry,{BaseUri:'https://example.test/views/Main.axaml'},aot);
        try{const p=s.captures[0].p;assert.equal(p.GetService(IProvideValueTarget),p);assert.equal(p.TargetObject,root.Children.Get(0));assert.equal(p.TargetProperty,A.TextBlock.TextProperty);
            assert.equal(p.GetService(IRootObjectProvider).RootObject,root);assert.equal(p.IntermediateRootObject,root);assert.equal(p.GetService(IUriContext).BaseUri,'https://example.test/views/Main.axaml');
            assert.equal(p.GetService(IXamlTypeResolver).Resolve('TextBlock'),A.TextBlock);assert.equal(p.GetService(A.NameScope).Get('label'),root.Children.Get(0));
            assert.equal(p.GetService(IServiceProvider),p);assert.equal(p.GetService('IProvideValueTarget'),p);assert.equal(p.GetService('Avalonia.Markup.Xaml.IRootObjectProvider'),p);
            assert.deepEqual(p.GetService(IAvaloniaXamlIlParentStackProvider).Parents,[root.Children.Get(0),root]);assert.deepEqual(p.GetService(IAvaloniaXamlIlEagerParentStackProvider).DirectParentsStack,[root,root.Children.Get(0)]);
            assert.ok(Object.isFrozen(p.Parents));assert.throws(()=>p.Resolve('bad:Type'),/prefix/);
        }finally{root.Dispose();}
    });
    test(`XAML ${label}: nested named extensions see their immediate outer extension and property`,async()=>{
        const s=setup(),root=await build(`<TextBlock ${ns} Text="{t:Outer Value={t:Probe Value=nested}}"/>`,s.registry,{},aot);
        try{assert.equal(root.Text,'nested');assert.equal(s.captures.length,2);assert.ok(s.captures[0].p.TargetObject instanceof s.OuterExtension);
            assert.equal(s.captures[0].p.TargetProperty.Name,'Value');assert.equal(s.captures[1].p.TargetObject,root);assert.equal(s.captures[1].p.TargetProperty,A.TextBlock.TextProperty);
            assert.equal(s.captures[0].p.Parents[0],s.captures[1].extension);
        }finally{root.Dispose();}
    });
    test(`XAML ${label}: xml:base is nested and restored for siblings; retained service snapshots do not change`,async()=>{
        const s=setup(),root=await build(`<StackPanel ${ns} xml:base="sub/"><Border xml:base="deep/"><TextBlock Text="{t:Probe Value=one}"/></Border><TextBlock Text="{t:Probe Value=two}"/></StackPanel>`,s.registry,{BaseUri:'https://example.test/views/main.axaml'},aot);
        try{assert.deepEqual(s.captures.map(x=>x.p.BaseUri),['https://example.test/views/sub/deep/','https://example.test/views/sub/']);
            assert.equal(s.captures[0].p.Parents[1],root.Children.Get(0));assert.equal(s.captures[1].p.Parents[1],root);assert.equal(s.captures[0].p.Parents.length,3);
        }finally{root.Dispose();}
    });
    test(`XAML ${label}: unknown services delegate and explicit Map entries preserve false and null`,async()=>{
        const s=setup(),token=Symbol('custom'),root=await build(`<TextBlock ${ns} Text="{t:Probe}"/>`,s.registry,{Services:new Map([[token,false]]),ServiceProvider:{GetService:t=>t==='external'?17:null}},aot);
        try{const p=s.captures[0].p;assert.equal(p.GetService(token),false);assert.equal(p.GetService('external'),17);assert.equal(p.GetService('missing'),null);}finally{root.Dispose();}
    });
    test(`XAML ${label}: object-element extensions get actual attached-property target`,async()=>{
        const s=setup(),root=await build(`<TextBlock ${ns}><Grid.Row><t:ProbeExtension Value="3"/></Grid.Row></TextBlock>`,s.registry,{},aot);
        try{assert.equal(A.Grid.GetRow(root),3);assert.equal(s.captures.length,1);assert.equal(s.captures[0].p.TargetObject,root);assert.equal(s.captures[0].p.TargetProperty,A.Grid.RowProperty);}finally{root.Dispose();}
    });
    test(`XAML ${label}: a custom namespace Binding name is not hijacked by built-in binding`,async()=>{
        const s=setup();s.registry.RegisterType('Binding',s.ProbeExtension,'urn:test');const root=await build(`<TextBlock ${ns} Text="{t:Binding Value=custom}"/>`,s.registry,{},aot);
        try{assert.equal(root.Text,'custom');assert.equal(s.captures.length,1);}finally{root.Dispose();}
    });
    test(`XAML ${label}: inherited CompileBindings honors order, false scopes and explicit ReflectionBinding`,async()=>{
        const s=setup(),root=await build(`<StackPanel ${ns} x:CompileBindings="True"><TextBlock Text="{Binding Name}"/><Border x:CompileBindings="False"><TextBlock Text="{Binding Name}"/></Border><TextBlock Text="{ReflectionBinding Name}"/><TextBlock Text="{Binding Name}" x:CompileBindings="True"/></StackPanel>`,s.registry,{DataContext:{Name:'live'}},aot);
        try{const expressions=[root.Children.Get(0),root.Children.Get(1).Child,root.Children.Get(2),root.Children.Get(3)].map(c=>c._bindings.get(A.TextBlock.TextProperty));
            assert.deepEqual(expressions.map(e=>e.constructor.name),['CompiledBindingExpression','BindingExpression','BindingExpression','CompiledBindingExpression']);
            assert.equal(root.Children.Get(0).Text,'live');
        }finally{root.Dispose();}
    });
    test(`XAML ${label}: inherited typed compiled binding rejects unknown members instead of silently reflecting`,async()=>{
        const s=setup();s.registry.RegisterModel('Model',{Name:String},'urn:test');await assert.rejects(build(`<StackPanel ${ns} x:DataType="t:Model" x:CompileBindings="True"><TextBlock Text="{Binding Missing}"/></StackPanel>`,s.registry,{},aot),/member 'Missing'/);
    });
    test(`XAML ${label}: deferred template distinguishes original file root and intermediate template root`,async()=>{
        const s=setup(),root=await build(`<Border ${ns}><Border.Resources><DataTemplate x:Key="template"><StackPanel><TextBlock Text="{t:Probe}"/></StackPanel></DataTemplate></Border.Resources></Border>`,s.registry,{BaseUri:'avares://App/Views/Main.axaml'},aot);
        const template=root.Resources.get('template'),one=template.Build({}),two=template.Build({});
        try{assert.equal(s.captures.length,2);const [a,b]=s.captures.map(x=>x.p);assert.equal(a.RootObject,root);assert.equal(a.IntermediateRootObject,one);assert.equal(b.IntermediateRootObject,two);
            assert.notEqual(a.NameScope,b.NameScope);assert.equal(a.BaseUri,'avares://App/Views/Main.axaml');assert.deepEqual(a.Parents,[one.Children.Get(0),one,root]);
        }finally{one.Dispose();two.Dispose();root.Dispose();}
    });
    test(`XAML ${label}: failed extension releases partial constructed graph exactly once`,async()=>{
        const s=setup();let disposed=0;
        class BadExtension {ProvideValue(){throw new Error('extension failure');}Dispose(){disposed++;}}
        s.registry.RegisterType('BadExtension',BadExtension,'urn:test');await assert.rejects(build(`<TextBlock ${ns}><TextBlock.Text><t:BadExtension/></TextBlock.Text></TextBlock>`,s.registry,{},aot),/extension failure/);assert.equal(disposed,1);
    });
    test(`XAML ${label}: asynchronous ProvideValue is rejected rather than assigning an unresolved Promise`,async()=>{
        const s=setup();class AsyncExtension{ProvideValue(){return Promise.resolve('wrong');}}s.registry.RegisterType('AsyncExtension',AsyncExtension,'urn:test');
        await assert.rejects(build(`<TextBlock ${ns} Text="{t:Async}"/>`,s.registry,{},aot),/synchronously/);
    });
}
test('successful XAML context drops construction ownership arrays and rejects reuse',()=>{
    const s=setup(),compiler=new AvaloniaXamlCompiler({Registry:s.registry}),c=new XamlRuntimeContext({Registry:s.registry});
    const root=c.Build(compiler.Compile(`<TextBlock ${ns} Text="hello"/>`).Ast);assert.equal(c._objects.length,0);assert.equal(c._parents.length,0);assert.equal(c._baseUris.length,0);
    assert.throws(()=>c.Complete(root),/once/);root.Dispose();
});
for(const aot of [false,true])test(`XAML ${aot?'AOT':'runtime'}: inherited DataType resolves at its declaring namespace, not a shadowed child prefix`,async()=>{
    const s=setup();s.registry.RegisterModel('Model',{Name:String},'urn:model');
    const root=await build(`<StackPanel ${ns} xmlns:m="urn:model" x:DataType="m:Model" x:CompileBindings="True"><TextBlock xmlns:m="urn:shadow" Text="{Binding Name}"/></StackPanel>`,s.registry,{DataContext:{Name:'correct'}},aot);
    try{assert.equal(root.Children.Get(0).Text,'correct');}finally{root.Dispose();}
});
for(const aot of [false,true])test(`XAML ${aot?'AOT':'runtime'}: extension-local URI survives EndInit and attribute extension failure releases its instance`,async()=>{
    const s=setup();const root=await build(`<TextBlock ${ns}><TextBlock.Text><t:ProbeExtension xml:base="extension/"/></TextBlock.Text></TextBlock>`,s.registry,{BaseUri:'https://example.test/main.axaml'},aot);
    try{assert.equal(s.captures[0].p.BaseUri,'https://example.test/extension/');}finally{root.Dispose();}
    let count=0;class FailureExtension{ProvideValue(){throw new Error('bad extension');}Dispose(){count++;}}
    s.registry.RegisterType('FailureExtension',FailureExtension,'urn:test');await assert.rejects(build(`<TextBlock ${ns} Text="{t:Failure}"/>`,s.registry,{},aot),/bad extension/);assert.equal(count,1);
});
for(const aot of [false,true])test(`XAML ${aot?'AOT':'runtime'}: template-local directives override declaration scope without losing URI or typed context`,async()=>{
    const s=setup();s.registry.RegisterModel('Model',{Name:String},'urn:test');
    const root=await build(`<Border ${ns} x:CompileBindings="False"><Border.Resources><DataTemplate x:Key="template" x:CompileBindings="True" x:DataType="t:Model" xml:base="templates/"><StackPanel><TextBlock Text="{Binding Name}"/><TextBlock Text="{t:Probe}"/></StackPanel></DataTemplate></Border.Resources></Border>`,s.registry,{BaseUri:'https://example.test/main.axaml'},aot);
    const view=root.Resources.get('template').Build({Name:'template model'});
    try{assert.equal(view.Children.Get(0).Text,'template model');assert.equal(view.Children.Get(0)._bindings.get(A.TextBlock.TextProperty).constructor.name,'CompiledBindingExpression');
        assert.equal(s.captures[0].p.BaseUri,'https://example.test/templates/');assert.equal(s.captures[0].p.RootObject,root);assert.equal(s.captures[0].p.IntermediateRootObject,view);
    }finally{view.Dispose();root.Dispose();}
});
for(const aot of [false,true])test(`XAML ${aot?'AOT':'runtime'}: custom namespace DataTemplate is an ordinary registered object, not a deferred template`,async()=>{
    const s=setup();class DataTemplate extends A.TextBlock {}s.registry.RegisterType('DataTemplate',DataTemplate,'urn:test');
    const root=await build(`<t:DataTemplate ${ns} Text="custom type"/>`,s.registry,{},aot);
    try{assert.ok(root instanceof DataTemplate);assert.equal(root.Text,'custom type');}finally{root.Dispose();}
});
test('XamlX transformer restores parent stack after a nested transformation failure',async()=>{
    const {XamlAstTransformer}=await import('@wieslawsoltes/xamlx');const context={Parents:[]};const sentinel={};context.Parents.push(sentinel);
    class Failing extends XamlAstTransformer{Transform(c,node){if(node.Fail)throw new Error('transform failed');return node;}}
    assert.throws(()=>new Failing().Visit(context,{Children:[{Children:[{Fail:true}]}]}),/transform failed/);assert.deepEqual(context.Parents,[sentinel]);
});
