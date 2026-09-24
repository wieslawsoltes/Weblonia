/** One lexical document, consumed by runtime and direct-AOT builders. */
export const BindingDelayXaml = `<Canvas xmlns="https://github.com/avaloniaui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    xmlns:t="urn:weblonia:delay" x:DataType="t:Model" x:CompileBindings="True" Background="White">
    <Canvas.Resources><x:Int32 x:Key="Wait">200</x:Int32></Canvas.Resources>
    <Border x:Name="FirstBox" Width="32" Height="32" Canvas.Left="{Binding Left1}" Canvas.Top="16" Background="Red"/>
    <Border x:Name="SecondBox" Width="32" Height="32" Canvas.Left="{Binding Left2}" Canvas.Top="56" Background="Blue"/>
    <TextBox x:Name="FirstEditor" Width="240" Canvas.Left="16" Canvas.Top="112" Text="{Binding First, Mode=TwoWay, Delay={StaticResource Wait}}"/>
    <TextBox x:Name="SecondEditor" Width="240" Canvas.Left="16" Canvas.Top="158">
        <TextBox.Text><ReflectionBinding Path="Second" Mode="TwoWay" Delay="200"/></TextBox.Text>
    </TextBox>
</Canvas>`;
export function BindingDelayRegistry(A) {
    const registry=new A.XamlTypeRegistry().RegisterAssembly(A);
    registry.RegisterModel('Model',{First:String,Second:String,Left1:Number,Left2:Number},'urn:weblonia:delay');return registry;
}
export function BindingDelayModel(A) {
    class Model extends A.AvaloniaObject {
        constructor(){super();this.Writes=[0,0];}
        OnPropertyChanged(e){super.OnPropertyChanged(e);
            if(e.PropertyName==='First'){this.Writes[0]++;this.Left1=e.NewValue==='final'?80:16;}
            if(e.PropertyName==='Second'){this.Writes[1]++;this.Left2=e.NewValue==='final'?144:16;}
        }
    }
    A.DefineProperties(Model,{First:['initial',{Type:String}],Second:['initial',{Type:String}],Left1:[16,{Type:Number}],Left2:[16,{Type:Number}]});
    return new Model();
}
