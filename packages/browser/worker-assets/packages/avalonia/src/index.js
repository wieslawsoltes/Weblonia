export * from "../../base/src/index.js";
export * from "../../media/src/index.js";
export * from "../../data/src/index.js";
export * from "../../styling/src/index.js";
export * from "../../controls/src/index.js";
export * from "../../animation/src/index.js";
export * from "../../skia/src/index.js";
export * from "../../browser/src/index.js";
export * from "../../markup-xaml/src/index.js";
export * from "../../themes-fluent/src/index.js";
import * as Browser from "../../browser/src/index.js";
import * as Animation from "../../animation/src/index.js";
import * as Themes from "../../themes-fluent/src/index.js";
import * as ReactiveUI from "../../reactiveui/src/index.js";
import { XamlTypeRegistry } from "../../markup-xaml/src/index.js";
XamlTypeRegistry.Default.RegisterAssembly(Browser).RegisterAssembly(Animation).RegisterAssembly(Themes).RegisterAssembly(ReactiveUI, 'using:Avalonia.ReactiveUI');
export { ReactiveUI };

export * from "../../composition/src/index.js";
import * as Composition from "../../composition/src/index.js";
XamlTypeRegistry.Default.RegisterAssembly(Composition);

export * from "../../opengl/src/index.js";
import * as OpenGL from "../../opengl/src/index.js";
XamlTypeRegistry.Default.RegisterAssembly(OpenGL);

export * from "../../rendering/src/index.js";
