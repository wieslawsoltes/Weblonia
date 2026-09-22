import { DefineProperties, BindingMode, MathUtilities } from '@wieslawsoltes/avalonia-base';
import { TemplatedControl } from './templated-control.js';
import { DefineRoutedEvent, RoutedEventArgs } from './core.js';
const prior = (owner, property) => owner._lastEffective?.get(property) ?? property.GetMetadata(owner).DefaultValue;
/** Finite ranges, previous-value retention for NaN/infinity, and non-destructive
 * base-value coercion. The JS property store reevaluates coercion on reads. */
export class RangeBase extends TemplatedControl {
    constructor() {
        super();
        this._lastEffective ??= new Map();
        for (const property of [RangeBase.MinimumProperty, RangeBase.MaximumProperty, RangeBase.ValueProperty])
            if (!this._lastEffective.has(property)) this._lastEffective.set(property, this.GetValue(property));
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property === RangeBase.MinimumProperty) {
            this.CoerceValue(RangeBase.MaximumProperty);
            this.CoerceValue(RangeBase.ValueProperty);
        } else if (e.Property === RangeBase.MaximumProperty) this.CoerceValue(RangeBase.ValueProperty);
        if (e.Property === RangeBase.ValueProperty) this.RaiseEvent(new RangeBaseValueChangedEventArgs(e.OldValue,e.NewValue,RangeBase.ValueChangedEvent,this));
    }
    get Percentage() {
        return this.Maximum === this.Minimum ? 0 : (this.Value - this.Minimum) / (this.Maximum - this.Minimum);
    }
}
export class RangeBaseValueChangedEventArgs extends RoutedEventArgs {
    constructor(oldValue,newValue,routedEvent = RangeBase.ValueChangedEvent,source = null) {
        super(routedEvent,source);this.OldValue=oldValue;this.NewValue=newValue;
    }
}
DefineProperties(RangeBase, {
    Minimum: [0, {Convert:Number,Coerce:(o,v)=>Number.isFinite(v)?v:prior(o,RangeBase.MinimumProperty)}],
    Maximum: [100, {Convert:Number,Coerce:(o,v)=>Math.max(o.Minimum,Number.isFinite(v)?v:prior(o,RangeBase.MaximumProperty))}],
    Value: [0, {Convert:Number,DefaultBindingMode:BindingMode.TwoWay,Coerce:(o,v)=>MathUtilities.Clamp(Number.isFinite(v)?v:prior(o,RangeBase.ValueProperty),o.Minimum,o.Maximum)}],
    SmallChange: [1, {Convert:Number}], LargeChange: [10, {Convert:Number}]
});
DefineRoutedEvent(RangeBase,'ValueChanged');
