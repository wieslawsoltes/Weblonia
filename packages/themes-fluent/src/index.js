import { Styles, Style, Setter, ResourceDictionary, DynamicResourceExtension, ThemeVariant } from '@wieslawsoltes/avalonia-styling';
import { SolidColorBrush, Color } from '@wieslawsoltes/avalonia-media';
import { Palettes } from '@wieslawsoltes/avalonia-controls';
/** Fluent-inspired default theme. This is not a byte-for-byte Avalonia Fluent template port. */
export class FluentTheme extends Styles {
    constructor() {
        super();
        this.DensityStyle = 'Normal';
        for (const [name, palette] of Object.entries(Palettes)) {
            const d = new ResourceDictionary();
            for (const [key, value] of Object.entries(palette))
                d.set(`System${key}Brush`, value);
            d.set('SystemBackgroundBrush', palette.Window);
            this.Resources.ThemeDictionaries.set(name, d);
        }
        this._Style('Button.accent', { Background: new DynamicResourceExtension('SystemAccentBrush'), Foreground: new DynamicResourceExtension('SystemAccentTextBrush') });
        this._Style('TextBlock.h1', { FontSize: 32, FontWeight: 'SemiBold' });
        this._Style('TextBlock.h2', { FontSize: 20, FontWeight: 'SemiBold' });
        this._Style('TextBlock.muted', { Foreground: new DynamicResourceExtension('SystemMutedBrush') });
        this._Style('Border.card', { Background: new DynamicResourceExtension('SystemSurfaceBrush'), BorderBrush: new DynamicResourceExtension('SystemBorderBrush'), BorderThickness: '1', CornerRadius: '8', Padding: '24' });
    }
    _Style(selector, setters) {
        const style = new Style(selector);
        for (const [property, value] of Object.entries(setters))
            style.Setters.Add(new Setter(property, value));
        this.Add(style);
    }
    Install(application) {
        application.Styles.Add(this);
        application.Resources.MergedDictionaries.Add(this.Resources);
        return this;
    }
}
