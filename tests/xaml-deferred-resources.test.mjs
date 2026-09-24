import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
const ns='xmlns="https://github.com/avaloniaui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:t="urn:resources"';
async function build(source, aot, registry, options={}) {
    const c=new A.AvaloniaXamlCompiler({Registry:registry,...options}).Compile(source);
    if(!aot)return c.Build();
    const module=await import('data:text/javascript;base64,'+Buffer.from(c.JavaScript).toString('base64'));
    return module.Build(new A.AvaloniaXamlServices({Registry:registry,...options}));
}
function setup(t) {
    const created=[],captures=[];
    class Probe extends A.Border { constructor(){super();created.push(this);} }
    class ProviderExtension { ProvideValue(provider){captures.push(provider);return 'provided';} }
    const registry=new A.XamlTypeRegistry().RegisterAssembly(A);registry.RegisterType('Probe',Probe,'urn:resources');registry.RegisterType('ProviderExtension',ProviderExtension,'urn:resources');
    t.after(()=>{for(const value of created)value.Dispose();});
    return {created,captures,registry,Probe};
}
for(const aot of [false,true]){
 const mode=aot?'AOT':'runtime';
 test(`resource XAML ${mode}: default and explicit shared true are lazy once, false builds separately`,async t=>{
    const s=setup(t),root=await build(`<Border ${ns}><Border.Resources><t:Probe x:Key="default"/><t:Probe x:Key="true" x:Shared="True"/><t:Probe x:Key="false" x:Shared="False"/></Border.Resources></Border>`,aot,s.registry);t.after(()=>root.Dispose());
    assert.equal(s.created.length,0);assert.equal(root.Resources.ContainsDeferredKey('default'),true);
    assert.equal(root.Resources.get('default'),root.Resources.get('default'));assert.equal(root.Resources.get('true'),root.Resources.get('true'));
    assert.notEqual(root.Resources.get('false'),root.Resources.get('false'));assert.equal(s.created.length,4);
 });
 test(`resource XAML ${mode}: unshared controls can be adopted by separate content parents`,async t=>{
    const s=setup(t),root=await build(`<StackPanel ${ns}><StackPanel.Resources><t:Probe x:Key="child" x:Shared="False" Width="10"/></StackPanel.Resources><Border Child="{StaticResource child}"/><Border Child="{StaticResource child}"/></StackPanel>`,aot,s.registry);t.after(()=>root.Dispose());
    const a=root.Children.Get(0),b=root.Children.Get(1);assert.ok(a.Child instanceof s.Probe);assert.notEqual(a.Child,b.Child);assert.equal(a.Child.Parent,a);assert.equal(b.Child.Parent,b);assert.equal(s.created.length,2);
 });
 test(`resource XAML ${mode}: named values are eager; names inside templates do not force creation`,async t=>{
    const s=setup(t),root=await build(`<Border ${ns}><Border.Resources><t:Probe x:Key="eager" x:Name="eager"/><DataTemplate x:Key="template"><t:Probe x:Name="local"/></DataTemplate></Border.Resources></Border>`,aot,s.registry);t.after(()=>root.Dispose());
    assert.equal(s.created.length,1);assert.equal(root.FindControl('eager'),root.Resources.get('eager'));assert.equal(root.Resources.ContainsDeferredKey('template'),true);
    const template=root.Resources.get('template'),a=template.Build({}),b=template.Build({});t.after(()=>{a.Dispose();b.Dispose();});
    assert.notEqual(a,b);assert.equal(root.FindControl('local'),null);assert.equal(a.FindControl('local'),a);assert.equal(b.FindControl('local'),b);assert.equal(s.created.length,3);
 });
 test(`resource XAML ${mode}: value types and strings stay eager and shared false outside dictionaries does not duplicate`,async t=>{
    const s=setup(t),root=await build(`<StackPanel ${ns}><StackPanel.Resources><x:String x:Key="str">hello</x:String><Point x:Key="point">2,3</Point><x:Int32 x:Key="num">42</x:Int32></StackPanel.Resources><t:Probe x:Shared="False"/></StackPanel>`,aot,s.registry);t.after(()=>root.Dispose());
    assert.equal(root.Resources.get('str'),'hello');assert.deepEqual(root.Resources.get('point'),new A.Point(2,3));assert.equal(root.Resources.get('num'),42);
    for(const key of root.Resources.Keys)assert.equal(root.Resources.ContainsDeferredKey(key),false);assert.equal(s.created.length,1);
 });
 test(`resource XAML ${mode}: malformed sharing metadata fails before resource creation`,async t=>{
    const s=setup(t);await assert.rejects(build(`<Border ${ns}><Border.Resources><t:Probe x:Key="p" x:Shared="maybe"/></Border.Resources></Border>`,aot,s.registry),/Shared/);assert.equal(s.created.length,0);
 });
 test(`resource XAML ${mode}: forward lexical dependencies resolve inside a standalone dictionary`,async t=>{
    const s=setup(t),root=await build(`<ResourceDictionary ${ns}><SolidColorBrush x:Key="brush" Color="{StaticResource color}"/><Color x:Key="color">#ff123456</Color></ResourceDictionary>`,aot,s.registry);t.after(()=>root.Dispose());
    const brush=root.get('brush');t.after(()=>brush.Dispose());assert.equal(brush.Color.ToString(),A.Color.Parse('#123456').ToString());
 });
 test(`resource XAML ${mode}: explicit dictionary populates its real owner and observes updates before realization`,async t=>{
    const s=setup(t),root=await build(`<Border ${ns}><Border.Resources><ResourceDictionary><t:Probe x:Key="p" Tag="{StaticResource value}"/><x:String x:Key="value">initial</x:String></ResourceDictionary></Border.Resources></Border>`,aot,s.registry);t.after(()=>root.Dispose());
    root.Resources.set('value','changed');assert.equal(root.Resources.get('p').Tag,'changed');assert.equal(root.Resources.Owner,root);assert.equal(s.created.length,1);
 });
 test(`resource XAML ${mode}: deferred markup services retain declaring root, URI, namescope and parents`,async t=>{
    const s=setup(t),root=await build(`<Border ${ns} x:Name="root"><Border.Resources><ResourceDictionary xml:base="palette/"><t:Probe x:Key="p" Tag="{t:Provider}" xml:base="components/"/></ResourceDictionary></Border.Resources></Border>`,aot,s.registry,{BaseUri:'https://example.test/views/main.axaml'});t.after(()=>root.Dispose());
    assert.equal(s.captures.length,0);const child=root.Resources.get('p'),provider=s.captures[0];
    assert.equal(provider.RootObject,root);assert.equal(provider.IntermediateRootObject,child);assert.equal(provider.TargetObject,child);assert.equal(provider.TargetProperty.Name,'Tag');
    assert.equal(provider.NameScope.Get('root'),root);assert.equal(provider.BaseUri,'https://example.test/views/palette/components/');assert.equal(provider.Parents[0],child);assert.ok(provider.Parents.includes(root.Resources));assert.ok(provider.Parents.includes(root));
 });
 test(`resource XAML ${mode}: deferred bindings preserve typed compile context and inherited data context`,async t=>{
    const s=setup(t);s.registry.RegisterModel('Model',{Name:String},'urn:resources');
    const root=await build(`<Border ${ns} x:CompileBindings="True" x:DataType="t:Model"><Border.Resources><TextBlock x:Key="label" Text="{Binding Name}"/></Border.Resources></Border>`,aot,s.registry,{DataContext:{Name:'first'}});t.after(()=>root.Dispose());
    const label=root.Resources.get('label');t.after(()=>label.Dispose());assert.equal(label.Text,'first');assert.equal(label._bindings.get(A.TextBlock.TextProperty).constructor.name,'CompiledBindingExpression');root.DataContext={Name:'second'};assert.equal(label.Text,'second');
 });
 test(`resource XAML ${mode}: static override of the same key falls through to its merged value`,async t=>{
    const s=setup(t),root=await build(`<ResourceDictionary ${ns}><ResourceDictionary.MergedDictionaries><ResourceDictionary><x:String x:Key="k">base</x:String></ResourceDictionary></ResourceDictionary.MergedDictionaries><t:Probe x:Key="k" Tag="{StaticResource k}"/></ResourceDictionary>`,aot,s.registry);t.after(()=>root.Dispose());assert.equal(root.get('k').Tag,'base');
 });
 test(`resource XAML ${mode}: dynamic resource in a deferred brush follows declaration theme`,async t=>{
    const s=setup(t),root=await build(`<Border ${ns} RequestedThemeVariant="Dark"><Border.Resources><ResourceDictionary><ResourceDictionary.ThemeDictionaries><ResourceDictionary x:Key="Light"><Color x:Key="c">Red</Color></ResourceDictionary><ResourceDictionary x:Key="Dark"><Color x:Key="c">Blue</Color></ResourceDictionary></ResourceDictionary.ThemeDictionaries><SolidColorBrush x:Key="b" Color="{DynamicResource c}"/></ResourceDictionary></Border.Resources></Border>`,aot,s.registry);t.after(()=>root.Dispose());const brush=root.Resources.get('b');t.after(()=>brush.Dispose());
    assert.equal(brush.Color.ToString(),A.Color.Parse('Blue').ToString());root.RequestedThemeVariant=A.ThemeVariant.Light;assert.equal(brush.Color.ToString(),A.Color.Parse('Red').ToString());
 });
 test(`resource XAML ${mode}: nested declaration uses nearest theme not original document root`,async t=>{
    const s=setup(t),root=await build(`<Border ${ns} RequestedThemeVariant="Light"><Border RequestedThemeVariant="Dark"><Border.Resources><ResourceDictionary><ResourceDictionary.ThemeDictionaries><ResourceDictionary x:Key="Light"><Color x:Key="c">Red</Color></ResourceDictionary><ResourceDictionary x:Key="Dark"><Color x:Key="c">Blue</Color></ResourceDictionary></ResourceDictionary.ThemeDictionaries><SolidColorBrush x:Key="b" Color="{DynamicResource c}"/></ResourceDictionary></Border.Resources></Border></Border>`,aot,s.registry);t.after(()=>root.Dispose());const brush=root.Child.Resources.get('b');t.after(()=>brush.Dispose());assert.equal(brush.Color.ToString(),A.Color.Parse('Blue').ToString());root.Child.RequestedThemeVariant=A.ThemeVariant.Light;assert.equal(brush.Color.ToString(),A.Color.Parse('Red').ToString());
 });
 test(`resource XAML ${mode}: failing deferred construction disposes only failed graph and retries cleanly`,async t=>{
    const s=setup(t);let failures=0,disposed=0;class FailureExtension {ProvideValue(){if(++failures===1)throw new Error('deliberate failure');return 'ok';}Dispose(){disposed++;}}
    s.registry.RegisterType('FailureExtension',FailureExtension,'urn:resources');const root=await build(`<Border ${ns}><Border.Resources><t:Probe x:Key="p" Tag="{t:Failure}"/></Border.Resources></Border>`,aot,s.registry);t.after(()=>root.Dispose());
    assert.throws(()=>root.Resources.get('p'),/deliberate failure/);assert.equal(root.IsDisposed,false);assert.equal(s.created[0].IsDisposed,true);assert.equal(disposed,1);const next=root.Resources.get('p');assert.equal(next.Tag,'ok');assert.equal(next.IsDisposed,false);
 });
 test(`resource XAML ${mode}: declaration names survive late resource realization and independent template scopes`,async t=>{
    const s=setup(t),root=await build(`<StackPanel ${ns}><StackPanel.Resources><t:Probe x:Key="r" Tag="{x:Reference later}"/></StackPanel.Resources><TextBlock x:Name="later"/></StackPanel>`,aot,s.registry);t.after(()=>root.Dispose());assert.equal(root.Resources.get('r').Tag,root.FindControl('later'));
 });
 test(`resource XAML ${mode}: resources inside reusable templates are independent per template instance`,async t=>{
    const s=setup(t),template=await build(`<DataTemplate ${ns}><Border><Border.Resources><t:Probe x:Key="p"/></Border.Resources></Border></DataTemplate>`,aot,s.registry);
    const a=template.Build({}),b=template.Build({});t.after(()=>{a.Dispose();b.Dispose();});assert.equal(s.created.length,0);assert.notEqual(a.Resources.get('p'),b.Resources.get('p'));assert.equal(s.created.length,2);
 });
}
test('resource AOT: lazy callback invokes direct ESM constructors without interpreting resource AST',async t=>{
 const s=setup(t),compiler=new A.AvaloniaXamlCompiler({Registry:s.registry}),compilation=compiler.Compile(`<Border ${ns}><Border.Resources><t:Probe x:Key="r" Width="64"/></Border.Resources></Border>`);
 assert.match(compilation.JavaScript,/ctx\.ResourceChild/);assert.match(compilation.JavaScript,/ctx\.Create\("Probe"/);assert.doesNotMatch(compilation.JavaScript,/eval\(|new Function/);
 const root=await build(compilation.Source??`<Border ${ns}><Border.Resources><t:Probe x:Key="r" Width="64"/></Border.Resources></Border>`,true,s.registry);t.after(()=>root.Dispose());
 const original=A.XamlRuntimeContext.prototype._BuildNode;A.XamlRuntimeContext.prototype._BuildNode=()=>{throw new Error('No runtime AST builder');};
 try{assert.equal(root.Resources.get('r').Width,64);}finally{A.XamlRuntimeContext.prototype._BuildNode=original;}
});
for(const aot of [false,true])test(`resource XAML ${aot?'AOT':'runtime'}: events in late resources retain original file code-behind`,async t=>{
 const s=setup(t);let clicks=0;class Host extends A.Border { Handle(){clicks++;assert.equal(this,root);} }
 s.registry.RegisterType('Host',Host,'urn:resources');const root=await build(`<t:Host ${ns}><t:Host.Resources><Button x:Key="b" Click="Handle"/></t:Host.Resources></t:Host>`,aot,s.registry);t.after(()=>root.Dispose());
 const button=root.Resources.get('b');t.after(()=>button.Dispose());button.OnClick();assert.equal(clicks,1);
});
for(const aot of [false,true])for(const shared of ['True','False'])test(`resource XAML ${aot?'AOT':'runtime'} ${shared}: resource key extensions run at declaration exactly once`,async t=>{
    const s=setup(t),key={};let evaluations=0;class KeyExtension{ProvideValue(){evaluations++;return key;}}
    s.registry.RegisterType('KeyExtension',KeyExtension,'urn:resources');const root=await build(`<Border ${ns}><Border.Resources><t:Probe x:Key="{t:Key}" x:Shared="${shared}"/></Border.Resources></Border>`,aot,s.registry);t.after(()=>root.Dispose());
    assert.equal(evaluations,1);root.Resources.get(key);root.Resources.get(key);assert.equal(evaluations,1);assert.equal(s.created.length,shared==='True'?1:2);
});
test('resource definitions scale to a thousand dormant controls without running constructors',async t=>{
    const s=setup(t),xml=`<ResourceDictionary ${ns}>`+Array.from({length:1000},(_,i)=>`<t:Probe x:Key="key${i}" Width="${i}"/>`).join('')+'</ResourceDictionary>';
    const root=await build(xml,true,s.registry);t.after(()=>root.Dispose());assert.equal(root.Count,1000);assert.equal(s.created.length,0);
    assert.equal(root.get('key900').Width,900);assert.equal(s.created.length,1);for(let i=0;i<1000;i++)assert.equal(root.get('key900'),s.created[0]);assert.equal(s.created.length,1);
});
test('resource catalog actions change only the unshared brush and materialize the deferred control once',async()=>{
    const {CatalogController}=await import('../samples/ControlCatalog/catalog.js');
    const {Builders}=await import('../samples/ControlCatalog/compiled/index.js');
    const controller=new CatalogController(),page=Builders.ThemeVariants(new A.AvaloniaXamlServices({CodeBehind:controller}));controller.Page=page;
    const a=page.FindControl('ResourceFirst').Background,b=page.FindControl('ResourceSecond').Background;const initial=a.Color.ToString();
    try{
        assert.notEqual(a,b);controller.MutateResourceBrush();assert.notEqual(a.Color.ToString(),initial);assert.equal(b.Color.ToString(),initial);
        controller.MutateResourceBrush();assert.equal(a.Color.ToString(),initial);assert.ok(page.Resources.ContainsDeferredKey('DeferredMessage'));
        controller.MaterializeResource();const child=page.FindControl('DeferredSlot').Child;assert.ok(child instanceof A.TextBlock);controller.MaterializeResource();assert.equal(page.FindControl('DeferredSlot').Child,child);
    }finally{page.Dispose();a.Dispose();b.Dispose();controller._query.complete();controller._pageLifetime.Dispose();controller.Model.Dispose();}
});
