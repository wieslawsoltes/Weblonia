export * from '@wieslawsoltes/avalonia-base';
export * from '@wieslawsoltes/avalonia-media';
export * from '@wieslawsoltes/avalonia-data';
export * from '@wieslawsoltes/avalonia-styling';
export * from '@wieslawsoltes/avalonia-controls';
export * from '@wieslawsoltes/avalonia-animation';
export * from '@wieslawsoltes/avalonia-skia';
export * from '@wieslawsoltes/avalonia-browser';
export * from '@wieslawsoltes/avalonia-markup-xaml';
export * from '@wieslawsoltes/avalonia-themes-fluent';
import * as Browser from '@wieslawsoltes/avalonia-browser';
import * as Animation from '@wieslawsoltes/avalonia-animation';
import * as Themes from '@wieslawsoltes/avalonia-themes-fluent';
import * as ReactiveUI from '@wieslawsoltes/avalonia-reactiveui';
import { XamlTypeRegistry } from '@wieslawsoltes/avalonia-markup-xaml';
XamlTypeRegistry.Default.RegisterAssembly(Browser).RegisterAssembly(Animation).RegisterAssembly(Themes).RegisterAssembly(ReactiveUI, 'using:Avalonia.ReactiveUI');
export { ReactiveUI };

export * from '@wieslawsoltes/avalonia-composition';
import * as Composition from '@wieslawsoltes/avalonia-composition';
XamlTypeRegistry.Default.RegisterAssembly(Composition);

export * from '@wieslawsoltes/avalonia-opengl';
import * as OpenGL from '@wieslawsoltes/avalonia-opengl';
XamlTypeRegistry.Default.RegisterAssembly(OpenGL);

export * from '@wieslawsoltes/avalonia-rendering';
