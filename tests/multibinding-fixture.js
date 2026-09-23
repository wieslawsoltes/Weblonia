/** The runtime builder and direct-AOT fixture consume exactly the same XAML. */
export const MultiBindingXaml = `<Canvas xmlns="https://github.com/avaloniaui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    xmlns:t="urn:weblonia:multibinding" x:DataType="t:Model" x:CompileBindings="True" Background="White">
    <Border x:Name="Box" Width="32" Height="32" Canvas.Top="16">
        <Canvas.Left><MultiBinding Converter="{t:Sum}">
            <MultiBinding Converter="{t:Sum}"><Binding Path="Left"/><Binding Path="Delta"/></MultiBinding><Binding Path="Margin"/>
        </MultiBinding></Canvas.Left>
        <Border.Background><MultiBinding Converter="{t:Color}">
            <MultiBinding Converter="{x:Static BoolConverters.And}"><Binding Path="Enabled"/><Binding Path="Ready"/></MultiBinding>
        </MultiBinding></Border.Background>
    </Border>
    <TextBlock x:Name="Summary" Tag="LABEL" Canvas.Left="16" Canvas.Top="80">
        <TextBlock.Text><MultiBinding StringFormat="{}{0} / {1}">
            <MultiBinding StringFormat="{}{0}:{1:F1}" ConverterCulture="en-US"><Binding Path="Status"/><Binding Path="Value"/></MultiBinding>
            <Binding Path="Tag" RelativeSource="{RelativeSource Self}"/>
        </MultiBinding></TextBlock.Text>
    </TextBlock>
</Canvas>`;
export function MultiBindingRegistry(A) {
    const registry = new A.XamlTypeRegistry().RegisterAssembly(A);
    class SumExtension { ProvideValue() { return { Convert: values => values.some(v => v === A.UnsetValue) ? A.UnsetValue : values.reduce((a,b) => a + Number(b), 0) }; } }
    class ColorExtension { ProvideValue() { return { Convert: values => values[0] ? 'Red' : 'Lime' }; } }
    registry.RegisterType('SumExtension', SumExtension, 'urn:weblonia:multibinding');
    registry.RegisterType('ColorExtension', ColorExtension, 'urn:weblonia:multibinding');
    registry.RegisterModel('Model', { Left: Number, Delta: Number, Margin: Number, Enabled: Boolean, Ready: Boolean, Status: String, Value: Number }, 'urn:weblonia:multibinding');
    return registry;
}
export function MultiBindingModel(A) {
    class Model extends A.AvaloniaObject {}
    A.DefineProperties(Model, { Left: [8], Delta: [8], Margin: [0], Enabled: [true], Ready: [true], Status: ['ready'], Value: [42.5] });
    return new Model();
}
export function ChangeMultiBinding(model) {
    model.Left = 40; model.Delta = 24; model.Margin = 16;
    model.Enabled = false; model.Status = 'updated'; model.Value = 99;
}
