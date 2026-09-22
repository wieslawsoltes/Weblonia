import { AvaloniaProperty } from "../../base/src/index.js";
export function GetVisualTree(control, options = {}) {
    const budget = { remaining: options.MaxNodes ?? 10000 };
    const walk = c => {
        if (--budget.remaining < 0)
            return { Truncated: true };
        return { Id: c.VisualId, Type: c.constructor.name, Name: c.Name, Bounds: { X: c.Bounds.X, Y: c.Bounds.Y, Width: c.Bounds.Width, Height: c.Bounds.Height }, IsVisible: c.IsVisible, IsEnabled: c.IsEffectivelyEnabled, Classes: [...c.Classes], RealizedContainers: c.GetRealizedContainers?.().length, Children: c.VisualChildren.map(walk) };
    };
    return walk(control);
}
export function GetPropertyDiagnostics(control) {
    const result = [];
    for (const [property, entries] of control._values) {
        result.push({ Property: `${property.OwnerType?.name ?? ''}.${property.Name}`, EffectiveValue: String(control.GetValue(property)), Entries: [...entries.values()].map(e => ({ Priority: e.Priority, Order: e.Order, Value: String(e.Value) })) });
    }
    return result;
}
export function GetRuntimeDiagnostics(root) {
    const visuals = [root, ...root.GetVisualDescendants()];
    return { VisualCount: visuals.length, FocusedElement: root.FocusManager?.FocusedElement?.Name || root.FocusManager?.FocusedElement?.constructor.name || null, LayoutPasses: root.LayoutManager?.LayoutPasses, RenderScaling: root.RenderScaling, ClientSize: root.ClientSize, Renderer: root.Renderer?.Backend, NativeSkia: root.Platform?.GetDiagnostics?.(), Virtualization: visuals.filter(v => typeof v.GetRealizedContainers === 'function').map(v => ({ Type: v.constructor.name, Items: v.ItemCount, Realized: v.GetRealizedContainers().length })) };
}
