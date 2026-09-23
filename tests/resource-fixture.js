/** A small analytic scene; no fonts, artificial renderer, or runtime evaluation. */
export const ResourceXaml = `
<Canvas xmlns="https://github.com/avaloniaui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:t="urn:resource-fixture" Background="White">
  <Canvas.Resources>
    <ResourceDictionary>
      <t:TrackedBrush x:Key="Unused" Color="Red"/>
      <t:TrackedBrush x:Key="PerUse" x:Shared="False" Color="Blue"/>
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
</Canvas>`;
export function ResourceRegistry(A) {
    const Created = [];
    class TrackedBrush extends A.SolidColorBrush { constructor(){super();Created.push(this);} }
    const Registry = new A.XamlTypeRegistry().RegisterAssembly(A);
    Registry.RegisterType('TrackedBrush',TrackedBrush,'urn:resource-fixture');
    return {Registry,Created};
}
export async function BuildResourceView(A, aot = false) {
    const {Registry,Created} = ResourceRegistry(A);
    const view = aot ? (await import('./resource-aot.js')).Build(new A.AvaloniaXamlServices({Registry}))
        : new A.AvaloniaXamlCompiler({Registry}).Compile(ResourceXaml).Build();
    const left=view.FindControl('LeftScope'),right=view.FindControl('RightScope'),moved=view.FindControl('Movable');
    const first=view.FindControl('FirstPaint'),second=view.FindControl('SecondPaint'),painted=view.FindControl('Painted');
    const borrowed = [left.Resources.ThemeDictionaries.get('Light'),left.Resources.ThemeDictionaries.get('Dark')];
    const owned = new Set([first.Background,second.Background,painted.Background]);
    function Remember(){ if(painted.Background)owned.add(painted.Background); }
    return {View:view,
        State:()=>({Created:Created.length,Deferred:view.Resources.ContainsDeferredKey('Unused'),Distinct:first.Background!==second.Background,
            ParentIsRight:moved.Parent===right,Paint:painted.Background?.Color?.ToString()??null,First:first.Background.Color.ToString(),Second:second.Background.Color.ToString()}),
        Change(step){
            if(step==='theme'){left.RequestedThemeVariant=A.ThemeVariant.Dark;Remember();}
            else if(step==='move'){left.Child=null;right.Child=moved;Remember();}
            else if(step==='mutate'){
                const obsolete=left.Resources.ThemeDictionaries.get('Dark');obsolete.set('Tone',A.Brushes.Black);
                right.Resources.set('Tone',A.Brushes.Yellow);first.Background.Color=A.Color.Parse('Magenta');
            }else if(step==='realize'){
                const a=view.Resources.get('Unused'),b=view.Resources.get('Unused');
                if(a!==b)throw new Error('Shared resource did not preserve identity');
            }else throw new Error('Unknown resource scene step');
            return this.State();
        },
        Dispose(){view.Dispose();for(const value of Created)value.Dispose();for(const value of owned)if(!Created.includes(value))value.Dispose();for(const value of borrowed)value.Dispose();}
    };
}
