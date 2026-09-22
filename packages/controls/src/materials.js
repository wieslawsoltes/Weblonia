import { DefineProperties, Rect } from '@wieslawsoltes/avalonia-base';
import { ExperimentalAcrylicMaterial, Pen } from '@wieslawsoltes/avalonia-media';
import { Border } from './content.js';

/** Acrylic samples the owning Skia surface; it does not sample the desktop behind a browser window. */
export class ExperimentalAcrylicBorder extends Border {
    Render(context) {
        const material = this.Material, bounds = new Rect(this.Bounds.Size), radius = this.CornerRadius.TopLeft;
        if (material && context.DrawAcrylic) context.DrawAcrylic(material, bounds, radius);
        else context.DrawRectangle(material?.FallbackColor ?? this.Background, null, bounds, radius);
        if (this.BorderBrush && this.BorderThickness.Left > 0) context.DrawRectangle(null, new Pen(this.BorderBrush, this.BorderThickness.Left), bounds.Deflate(this.BorderThickness.Left / 2), radius);
    }
}
DefineProperties(ExperimentalAcrylicBorder, { Material: [null, { DefaultValueFactory: () => new ExperimentalAcrylicMaterial() }] });
