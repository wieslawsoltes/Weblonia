/** A small analytic scene; no fonts, artificial renderer, or runtime evaluation. */
export const ResourceXaml = `
<Canvas xmlns="https://github.com/avaloniaui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:t="urn:resource-fixture" x:CompileBindings="True" x:DataType="t:Model" Background="White">
  <Canvas.Resources>
    <ResourceDictionary>
      <t:TrackedBrush x:Key="Unused" Color="Red"/>
      <t:TrackedBrush x:Key="PerUse" x:Shared="False" Color="Blue"/>
      <x:Int32 x:Key="Wait">200</x:Int32>
      <t:Sum x:Key="Sum"/>
      <t:DeferredEditor x:Key="Editor" x:Shared="False" Width="{Binding Position,Mode=TwoWay,Delay={StaticResource Wait}}"/>
    </ResourceDictionary>
  </Canvas.Resources>
  <Border x:Name="LeftScope" Canvas.Left="16" Canvas.Top="16" Width="64" Height="64" RequestedThemeVariant="Light">
    <Border.Resources>
      <ResourceDictionary>
        <ResourceDictionary.ThemeDictionaries>
          <ResourceDictionary x:Key="Light"><SolidColorBrush x:Key="Tone" Color="Red"/></ResourceDictionary>
          <ResourceDictionary x:Key="Dark"><SolidColorBrush x:Key="Tone" Color="Blue"/></ResourceDictionary>
        </ResourceDictionary.ThemeDictionaries>
      </ResourceDictionary>
    </Border.Resources>
    <Border x:Name="Movable"><Border x:Name="Painted" Background="{DynamicResource Tone}"/></Border>
  </Border>
  <Border x:Name="RightScope" Canvas.Left="112" Canvas.Top="16" Width="64" Height="64">
    <Border.Resources><SolidColorBrush x:Key="Tone" Color="Lime"/></Border.Resources>
  </Border>
  <Border x:Name="FirstPaint" Canvas.Left="208" Canvas.Top="16" Width="64" Height="64" Background="{StaticResource PerUse}"/>
  <Border x:Name="SecondPaint" Canvas.Left="304" Canvas.Top="16" Width="64" Height="64" Background="{StaticResource PerUse}"/>
  <Border x:Name="DelayedPaint" Canvas.Top="112" Width="32" Height="32" Background="Black">
    <Canvas.Left><MultiBinding Converter="{StaticResource Sum}">
      <MultiBinding Converter="{StaticResource Sum}"><Binding Path="Position"/></MultiBinding>
    </MultiBinding></Canvas.Left>
  </Border>
</Canvas>`;
export function ResourceRegistry(A) {
    const Created = [], Editors = [];
    class Model extends A.AvaloniaObject {
        constructor(){super();this.Writes=[];}
        OnPropertyChanged(e){super.OnPropertyChanged(e);if(e.PropertyName==='Position')this.Writes.push(e.NewValue);}
    }
    A.DefineProperties(Model,{Position:[16,{Type:Number}]});
    class Sum { Convert(values){return values.reduce((sum,value)=>sum+Number(value),0);} }
    class DeferredEditor extends A.Border { constructor(){super();Editors.push(this);} }
    class TrackedBrush extends A.SolidColorBrush { constructor(){super();Created.push(this);} }
    const Registry = new A.XamlTypeRegistry().RegisterAssembly(A);
    Registry.RegisterType('TrackedBrush',TrackedBrush,'urn:resource-fixture');
    Registry.RegisterType('Sum',Sum,'urn:resource-fixture');
    Registry.RegisterType('DeferredEditor',DeferredEditor,'urn:resource-fixture');
    Registry.RegisterModel('Model',{Position:Number},'urn:resource-fixture');
    return {Registry,Created,Editors,Model};
}
export async function BuildResourceView(A, aot = false) {
    const {Registry,Created,Editors,Model} = ResourceRegistry(A), models=[new Model()];
    const options={Registry,DataContext:models[0]};
    const view = aot ? (await import('./resource-aot.js')).Build(new A.AvaloniaXamlServices(options))
        : new A.AvaloniaXamlCompiler(options).Compile(ResourceXaml).Build();
    const writeExpression=editor=>A.BindingOperations.GetBindingExpressionBase(editor,A.Border.WidthProperty);
    const aggregate=A.BindingOperations.GetBindingExpressionBase(view.FindControl('DelayedPaint'),A.Canvas.LeftProperty);
    const left=view.FindControl('LeftScope'),right=view.FindControl('RightScope'),moved=view.FindControl('Movable');
    const first=view.FindControl('FirstPaint'),second=view.FindControl('SecondPaint'),painted=view.FindControl('Painted');
    const borrowed = [left.Resources.ThemeDictionaries.get('Light'),left.Resources.ThemeDictionaries.get('Dark')];
    const owned = new Set([first.Background,second.Background,painted.Background]);
    function Remember(){ if(painted.Background)owned.add(painted.Background); }
    return {View:view,
        State:()=>({Created:Created.length,Deferred:view.Resources.ContainsDeferredKey('Unused'),Distinct:first.Background!==second.Background,
            ParentIsRight:moved.Parent===right,Paint:painted.Background?.Color?.ToString()??null,First:first.Background.Color.ToString(),Second:second.Background.Color.ToString(),
            Editors:Editors.length,EditorDisposed:Editors[1]?.IsDisposed??false,Position:view.DataContext.Position,
            SourceWrites:models.map(model=>[...model.Writes]),
            PendingTimers:Editors.filter(editor=>!editor.IsDisposed&&writeExpression(editor)?._delayTimer?.IsEnabled).length,
            NestedCompiled:aggregate._expressions[0]._expressions[0] instanceof A.CompiledBindingExpression}),
        Change(step){
            if(step==='theme'){left.RequestedThemeVariant=A.ThemeVariant.Dark;Remember();}
            else if(step==='move'){left.Child=null;right.Child=moved;Remember();}
            else if(step==='mutate'){
                const obsolete=left.Resources.ThemeDictionaries.get('Dark');obsolete.set('Tone',A.Brushes.Black);
                right.Resources.set('Tone',A.Brushes.Yellow);first.Background.Color=A.Color.Parse('Magenta');
            }else if(step==='realize'){
                const a=view.Resources.get('Unused'),b=view.Resources.get('Unused');
                if(a!==b)throw new Error('Shared resource did not preserve identity');
            }else if(step==='binding'){
                if(Editors.length)throw new Error('Editors must remain dormant before explicit realization');
                const editor=view.Resources.get('Editor'),other=view.Resources.get('Editor');
                if(editor===other)throw new Error('Unshared editors must be independent');
                for(const position of [64,128,208])editor.SetCurrentValue(A.Border.WidthProperty,position);
            }else if(step==='flush'){
                Editors[0].SetCurrentValue(A.Border.WidthProperty,112);writeExpression(Editors[0]).UpdateSource();
            }else if(step==='dispose-pending'){
                Editors[1].SetCurrentValue(A.Border.WidthProperty,304);Editors[1].Dispose();
            }else if(step==='replace-source'){
                Editors[0].SetCurrentValue(A.Border.WidthProperty,304);
                models.push(new Model());view.DataContext=models.at(-1);
            }else throw new Error('Unknown resource scene step');
            return this.State();
        },
        Dispose(){for(const editor of Editors)editor.Dispose();view.Dispose();for(const model of models)model.Dispose();for(const value of Created)value.Dispose();for(const value of owned)if(!Created.includes(value))value.Dispose();for(const value of borrowed)value.Dispose();}
    };
}
