import { DefineProperties, Size, Rect, Event } from "../../base/src/index.js";
import { Control } from './core.js';
export class TemplatedControl extends Control {
    constructor() {
        super();
        this.TemplateApplied = new Event();
        this._templateRoot = null;
        this._appliedTemplate = null;
    }
    ApplyTemplate() {
        if (this.Template === this._appliedTemplate)
            return false;
        if (this._templateRoot) {
            this.RemoveVisualChild(this._templateRoot);
            this._templateRoot.Dispose();
            this._templateRoot = null;
        }
        this._appliedTemplate = this.Template;
        if (this.Template) {
            const result = this.Template.Build(this);
            this._templateRoot = result.Control ?? result;
            this.AddVisualChild(this._templateRoot, false);
            this.TemplateApplied.Raise(this, { NameScope: result.NameScope });
            this.OnApplyTemplate({ NameScope: result.NameScope });
        }
        return true;
    }
    OnApplyTemplate() {
    }
    MeasureOverride(size) {
        if (this._templateRoot) {
            this._templateRoot.Measure(size);
            return this._templateRoot.DesiredSize;
        }
        return Size.Empty;
    }
    ArrangeOverride(size) {
        this._templateRoot?.Arrange(new Rect(size));
        return size;
    }
}
DefineProperties(TemplatedControl, { Template: [null, { AffectsMeasure: true }] });
