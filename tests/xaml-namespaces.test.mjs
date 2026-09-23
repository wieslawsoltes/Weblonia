import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { XamlXmlParser, XDocumentXamlParser, XDocumentXamlParserSettings } from '@wieslawsoltes/xamlx';
const ava = 'https://github.com/avaloniaui';
const mc = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const x = 'http://schemas.microsoft.com/winfx/2006/xaml';
const ns = `xmlns="${ava}" xmlns:x="${x}" xmlns:mc="${mc}" xmlns:d="urn:design"`;
async function build(source, options, aot) {
    const compiled = new A.AvaloniaXamlCompiler(options).Compile(source);
    if (!aot) return compiled.Build();
    const module = await import('data:text/javascript;base64,'+Buffer.from(compiled.JavaScript).toString('base64'));
    return module.Build(new A.AvaloniaXamlServices(options));
}
for (const aot of [false, true]) {
    const mode = aot ? 'AOT' : 'runtime';
    test(`${mode} Ignorable drops attributes and complete subtrees before extension parsing`, async () => {
        const root = await build(`<StackPanel ${ns} mc:Ignorable="d" d:Width="{unfinished"><d:NotRegistered><NotAControl Bad="{also unfinished"/></d:NotRegistered><TextBlock Text="kept"/></StackPanel>`, {}, aot);
        try { assert.equal(root.Children.Count,1); assert.equal(root.Children.Get(0).Text,'kept'); assert.ok(Number.isNaN(root.Width)); }
        finally { root.Dispose(); }
    });
    test(`${mode} Ignorable is URI based when a child rebinds the lexical prefix`, async () => {
        const registry = new A.XamlTypeRegistry().RegisterAssembly(A);
        registry.RegisterType('TextBlock',A.TextBlock,'urn:real');
        const root = await build(`<StackPanel ${ns} mc:Ignorable="d"><Border xmlns:d="urn:real"><d:TextBlock xmlns:z="urn:design" z:Text="wrong" Text="real"/></Border></StackPanel>`,{Registry:registry},aot);
        try { assert.equal(root.Children.Get(0).Child.Text,'real'); } finally {root.Dispose();}
    });
    test(`${mode} local Ignorable does not leak across empty or nonempty sibling elements`, async () => {
        const registry = new A.XamlTypeRegistry().RegisterAssembly(A);registry.RegisterType('TextBlock',A.TextBlock,'urn:design');
        const root=await build(`<StackPanel ${ns}><Border mc:Ignorable="d"/><Border mc:Ignorable="d"><d:Bad/></Border><d:TextBlock Text="sibling"/></StackPanel>`,{Registry:registry},aot);
        try {assert.equal(root.Children.Count,3);assert.equal(root.Children.Get(2).Text,'sibling');}finally{root.Dispose();}
    });
    test(`${mode} mapped ignorable namespaces are understood and lexical extension aliases are mapped`, async () => {
        const registry = new A.XamlTypeRegistry().RegisterAssembly(A);
        class ValueExtension {ProvideValue(){return 'mapped extension';}}
        registry.RegisterType('ValueExtension',ValueExtension,'urn:new');
        const options={Registry:registry,CompatibleNamespaces:new Map([['urn:old',ava],['urn:ext-old','urn:new']])};
        const root=await build(`<old:StackPanel ${ns} xmlns:old="urn:old" xmlns:e="urn:ext-old" mc:Ignorable="old e"><old:TextBlock Text="{e:Value}"/></old:StackPanel>`,options,aot);
        try{assert.equal(root.Children.Get(0).Text,'mapped extension');}finally{root.Dispose();}
    });
    test(`${mode} namespaced attached members resolve the specified owner, not its default-namespace homonym`, async () => {
        class OtherGrid {}
        OtherGrid.RowProperty=A.AvaloniaProperty.RegisterAttached(OtherGrid,'Row',0,{Convert:Number});
        const registry=new A.XamlTypeRegistry().RegisterAssembly(A);registry.RegisterType('Grid',OtherGrid,'urn:other');
        const root=await build(`<Border ${ns} xmlns:o="urn:other" o:Grid.Row="7" Grid.Row="2"/>`,{Registry:registry},aot);
        try{assert.equal(root.GetValue(OtherGrid.RowProperty),7);assert.equal(A.Grid.GetRow(root),2);}finally{root.Dispose();}
    });
    test(`${mode} namespaced property elements provide the correct actual target property to extensions`,async()=>{
        class OtherGrid {};OtherGrid.RowProperty=A.AvaloniaProperty.RegisterAttached(OtherGrid,'Row',0,{Convert:Number});
        const registry=new A.XamlTypeRegistry().RegisterAssembly(A);registry.RegisterType('Grid',OtherGrid,'urn:other');
        let property, target;
        class ProbeExtension {ProvideValue(p){({TargetProperty:property,TargetObject:target}=p.GetService(A.IProvideValueTarget));return 9;}}
        registry.RegisterType('ProbeExtension',ProbeExtension,'urn:other');
        const root=await build(`<Border ${ns} xmlns:o="urn:other"><o:Grid.Row><o:ProbeExtension/></o:Grid.Row></Border>`,{Registry:registry},aot);
        try{assert.equal(property,OtherGrid.RowProperty);assert.equal(target,root);assert.equal(root.GetValue(property),9);assert.equal(A.Grid.GetRow(root),0);}finally{root.Dispose();}
    });
    test(`${mode} unknown nonignorable attributes cannot masquerade as local properties or events`,async()=>{
        for(const attr of ['d:Width="100"','d:Name="hijacked"','d:Classes="bad"','d:Click="Clicked"'])
            await assert.rejects(build(`<Button ${ns} ${attr}/>`,{},aot),/Unknown namespaced/);
    });
    test(`${mode} namespace mappings survive deferred template construction and binding updates`,async()=>{
        const registry=new A.XamlTypeRegistry().RegisterAssembly(A),options={Registry:registry,CompatibleNamespaces:{'urn:old':ava}};
        const root=await build(`<Border ${ns} xmlns:old="urn:old" mc:Ignorable="d"><Border.Resources><DataTemplate x:Key="view"><old:TextBlock Text="{Binding Text}" d:Ignored="{bad"/></DataTemplate></Border.Resources></Border>`,options,aot);
        const view=root.Resources.get('view').Build({Text:'template'});
        try{assert.equal(view.Text,'template');}finally{view.Dispose();root.Dispose();}
    });
    test(`${mode} XML attribute normalization preserves character references and xml:space text`,async()=>{
        const root=await build(`<StackPanel ${ns}><TextBlock Text="a\tb\r\nc&#x9;d&#xD;e"/><TextBlock xml:space="preserve"> a\r\nb </TextBlock></StackPanel>`,{},aot);
        try{assert.equal(root.Children.Get(0).Text,'a b c\td\re');assert.equal(root.Children.Get(1).Text,' a\nb ');}finally{root.Dispose();}
    });
    test(`${mode} ignored content never runs registered constructors or captures names`,async()=>{
        let created=0;class Bad extends A.Border{constructor(){super();created++;}}
        const registry=new A.XamlTypeRegistry().RegisterAssembly(A);registry.RegisterType('Bad',Bad,'urn:design');
        const root=await build(`<StackPanel ${ns} mc:Ignorable="d"><d:Bad x:Name="unused"/><TextBlock x:Name="kept"/></StackPanel>`,{Registry:registry},aot);
        try{assert.equal(created,0);assert.equal(root.FindControl('unused'),null);assert.ok(root.FindControl('kept'));}finally{root.Dispose();}
    });
}
test('XDocumentXamlParser and settings expose upstream-compatible mapping names',()=>{
    for(const mapping of [{'urn:old':ava},new Map([['urn:old',ava]]),new XDocumentXamlParserSettings({CompatibleNamespaces:{'urn:old':ava}})]){
        const doc=XDocumentXamlParser.Parse('<TextBlock xmlns="urn:old"/>',mapping);
        assert.equal(doc.Root.Type.XmlNamespace,ava);assert.equal(doc.NamespaceAliases[''],ava);
    }
});
test('namespace mapping is a single step, not transitive',()=>{
    const doc=XamlXmlParser.Parse('<p:Thing xmlns:p="urn:a"/>',{CompatibleNamespaces:{'urn:a':'urn:b','urn:b':'urn:c'}});
    assert.equal(doc.Root.Type.XmlNamespace,'urn:b');assert.equal(doc.Root.Namespaces.p,'urn:b');
});
test('mapping to the same expanded attribute name is rejected before construction',()=>{
    assert.throws(()=>XamlXmlParser.Parse('<Thing xmlns:a="urn:a" xmlns:b="urn:b" a:Name="1" b:Name="2"/>',{CompatibleNamespaces:{'urn:a':'urn:c','urn:b':'urn:c'}}),/Duplicate expanded/);
});
test('namespace mappings are snapshotted per parse and do not mutate caller input',()=>{
    const mapping=new Map([['urn:a','urn:b']]),options={CompatibleNamespaces:mapping};
    const a=XamlXmlParser.Parse('<Item xmlns="urn:a"/>',options);mapping.set('urn:a','urn:c');
    assert.equal(a.Root.Type.XmlNamespace,'urn:b');assert.equal(XamlXmlParser.Parse('<Item xmlns="urn:a"/>',options).Root.Type.XmlNamespace,'urn:c');
});
for(const [name,source,pattern] of [
    ['undeclared Ignorable',`<Border ${ns} mc:Ignorable="absent"/>`,/Undeclared ignorable/],
    ['unsupported compatibility directive',`<Border ${ns} mc:MustUnderstand="d"/>`,/not implemented/],
    ['unsupported AlternateContent',`<Border ${ns}><mc:AlternateContent/></Border>`,/not implemented/],
    ['ignored XML remains well-formed',`<Border ${ns} mc:Ignorable="d"><d:Bad></d:Wrong></Border>`,/Mismatched/],
    ['ignored references remain valid',`<Border ${ns} mc:Ignorable="d"><d:Bad Value="&#1;"/></Border>`,/Invalid XML character reference/],
    ['DTD still rejected','<!DOCTYPE a><a/>',/DOCTYPE/],
    ['reserved xml binding','<a xmlns:xml="urn:bad"/>',/reserved XML/],
    ['reserved xmlns binding','<a xmlns:xmlns="urn:bad"/>',/reserved XML/],
    ['XML URI alias','<a xmlns:p="http://www.w3.org/XML/1998/namespace"/>',/reserved XML/],
    ['undeclared prefix','<p:a/>',/Undeclared/],
    ['empty prefix mapping','<a xmlns:p=""/>',/reserved XML/],
    ['multiple colons','<a:b:c xmlns:a="urn:a"/>',/qualified name/],
    ['empty local name','<a: xmlns:a="urn:a"/>',/qualified name/],
    ['invalid local name','<a:1 xmlns:a="urn:a"/>',/qualified name/],
    ['unsafe prefix','<a xmlns:__proto__="urn:a"/>',/Unsafe XML/],
    ['unescaped CDATA terminator','<a>]]></a>',/CDATA terminator/],
    ['invalid xml:space','<a xml:space="unknown"/>',/xml:space/],
    ['literal control character','<a>\u0001</a>',/Invalid XML character/],
    ['literal isolated surrogate','<a>\ud800</a>',/Invalid XML character/],
    ['literal U+FFFE','<a>\ufffe</a>',/Invalid XML character/],
    ['invalid referenced U+FFFF','<a>&#xFFFF;</a>',/Invalid XML character/],
    ['non-XML whitespace outside root','\u00A0<a/>',/outside the root/],
])test(`XML compatibility rejects ${name}`,()=>assert.throws(()=>XamlXmlParser.Parse(source,{SourceFile:'test.axaml'}),pattern));
test('skipped descendants count against depth, node and character limits',()=>{
    const source=`<Border ${ns} mc:Ignorable="d"><d:A><d:B><d:C/></d:B></d:A></Border>`;
    assert.throws(()=>XamlXmlParser.Parse(source,{MaxDepth:3}),/nesting limit/);
    assert.throws(()=>XamlXmlParser.Parse(source,{MaxNodes:3}),/node limit/);
    assert.throws(()=>XamlXmlParser.Parse(source,{MaxCharacters:10}),/character limit/);
});
test('XML normalization retains significant Unicode content and nested whitespace modes',()=>{
    const d=XamlXmlParser.Parse('\uFEFF<a xml:space="preserve"> \r\n<b xml:space="default">  </b>\u00A0\u2003😀</a>');
    assert.equal(d.Root.Children[0].Text,' \n');assert.equal(d.Root.Children[1].Children.length,0);
    assert.equal(d.Root.Children[2].Text,'\u00A0\u2003😀');
});
test('compatibility diagnostics keep source file and original element positions',()=>{
    assert.throws(()=>XamlXmlParser.Parse(`<Border ${ns}>\r\n <Border mc:Ignorable="missing"/>\r\n</Border>`,{SourceFile:'source.axaml'}),e=>e.SourceFile==='source.axaml'&&e.Line===2&&e.Position>1);
});
test('invalid namespace mapping tables reject reserved namespaces without following a chain',()=>{
    for(const mapping of [[],42,{'urn:a':3},{'http://www.w3.org/XML/1998/namespace':'urn:x'}])
        assert.throws(()=>XamlXmlParser.Parse('<a/>',{CompatibleNamespaces:mapping}),TypeError);
});
for(const [name,source,pattern] of [
    ['adjacent attributes','<a b="1"c="2"/>',/separated by whitespace/],
    ['hexadecimal marker case','<a>&#X41;</a>',/not allowed/],
    ['CDATA outside root','<![CDATA[ ]]><a/>',/CDATA is not allowed/],
])test(`XML compatibility rejects ${name}`,()=>assert.throws(()=>XamlXmlParser.Parse(source),pattern));
test('an already ignored subtree does not evaluate inner compatibility directives',()=>{
    const root=XamlXmlParser.Parse(`<Border ${ns} mc:Ignorable="d"><d:Skip mc:MustUnderstand="unknown"><mc:AlternateContent/></d:Skip><TextBlock/></Border>`).Root;
    assert.equal(root.Children.length,1);assert.equal(root.Children[0].Type.Name,'TextBlock');
});
test('ordinary XAML takes the compatibility allocation fast path without cloning attributes or namespaces',async()=>{
    const {ApplyXamlCompatibility}=await import('../packages/xamlx/src/compatibility.js');
    const doc=XamlXmlParser.Parse(`<Border ${ns}><TextBlock Text="hello"/></Border>`);
    const root=doc.Root,child=root.Children[0],tables=[root.Namespaces,root.Attributes,root.Children,child.Namespaces,child.Attributes,child.Children];
    assert.equal(ApplyXamlCompatibility(doc),doc);
    assert.deepEqual([root.Namespaces,root.Attributes,root.Children,child.Namespaces,child.Attributes,child.Children].map((v,i)=>v===tables[i]),[true,true,true,true,true,true]);
});
for(const aot of [false,true])test(`${aot?'AOT':'runtime'} mapping preserves x:Type and prefixed attached members in nested lexical scopes`,async()=>{
    const options={CompatibleNamespaces:{'urn:old':ava}},source=`<Border ${ns} xmlns:q="urn:old" Tag="{x:Type q:TextBlock}"><Border.Child><Border xmlns:q="${ava}" q:Canvas.Left="12"/></Border.Child></Border>`;
    const view=await build(source,options,aot);
    try{assert.equal(view.Tag,A.TextBlock);assert.equal(A.Canvas.GetLeft(view.Child),12);}finally{view.Dispose();}
});
test('namespace AOT fixture is the reproducible direct compiler output',async()=>{
    const {readFile}=await import('node:fs/promises');
    const {NamespaceXaml,NamespaceMappings}=await import('./xaml-namespace-fixture.js');
    const compiled=new A.AvaloniaXamlCompiler({CompatibleNamespaces:NamespaceMappings}).Compile(NamespaceXaml);
    assert.equal(await readFile(new URL('./xaml-namespace-aot.js',import.meta.url),'utf8'),compiled.JavaScript);
});

for(const aot of [false,true])test(`${aot?'AOT':'runtime'} custom Design attached property is not silently discarded`,async()=>{
    class Design{};Design.ValueProperty=A.AvaloniaProperty.RegisterAttached(Design,'Value',0,{Convert:Number});
    const registry=new A.XamlTypeRegistry().RegisterAssembly(A);registry.RegisterType('Design',Design,'urn:custom-design');
    for(const member of ['<c:Design.Value><x:Int32>9</x:Int32></c:Design.Value>','<Design.Value xmlns="urn:custom-design"><x:Int32>9</x:Int32></Design.Value>']){
        const root=await build(`<Border ${ns} xmlns:c="urn:custom-design">${member}</Border>`,{Registry:registry},aot);
        try{assert.equal(root.GetValue(Design.ValueProperty),9);}finally{root.Dispose();}
    }
});
