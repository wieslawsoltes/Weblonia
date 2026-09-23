/** Shared by the build-time AOT compiler and both UI realms. */
export const NamespaceMappings = Object.freeze({ 'urn:weblonia:legacy-ui': 'https://github.com/avaloniaui' });
export const NamespaceXaml = `<Canvas xmlns="urn:weblonia:legacy-ui"
    xmlns:layout="urn:weblonia:legacy-ui" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:d="urn:weblonia:design-only"
    mc:Ignorable="d layout" Background="White">
    <d:Unregistered d:Broken="{not a valid extension"><d:Nested/></d:Unregistered>
    <Border x:Name="MovingBox" Width="32" Height="32" layout:Canvas.Top="16"
            Background="{Binding Fill}" d:Width="{malformed">
        <layout:Canvas.Left><Binding Path="Left"/></layout:Canvas.Left>
    </Border>
    <TextBlock x:Name="Whitespace" Canvas.Left="16" Canvas.Top="100" xml:space="preserve">  Namespaces&#xA;  preserved  </TextBlock>
</Canvas>`;
