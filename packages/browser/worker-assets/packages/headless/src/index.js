import { Size, Rect, Point, Event } from "../../base/src/index.js";
import { RecordingDrawingContext } from "../../media/src/index.js";
import { ContentControl, FocusManager, LayoutManager, InputElement, Pointer, PointerPressedEventArgs, PointerReleasedEventArgs, KeyEventArgs } from "../../controls/src/index.js";
export class HeadlessTopLevel extends ContentControl {
    constructor(size = new Size(800, 600)) {
        super();
        this.IsTopLevel = true;
        this.ClientSize = size;
        this.RenderScaling = 1;
        this.FocusManager = new FocusManager(this);
        this.LayoutManager = new LayoutManager(this);
        this._pointers = new Map();
        this._Attach(this);
    }
    _RequestLayout() {
    }
    _RequestRender() {
    }
    _SyncTextInput() {
    }
    _OnFocusChanged() {
    }
    Measure(size) {
        super.Measure(size);
    }
    Layout(size = this.ClientSize) {
        this.ClientSize = size;
        this.LayoutManager.ExecuteLayoutPass(size);
        return this;
    }
    RenderFrame() {
        this.Layout();
        const context = new RecordingDrawingContext();
        this.RenderTree(context);
        return context.Commands;
    }
    _CapturePointer() {
        // Pointer owns logical/gesture capture. A headless host has no OS capture.
    }
    MouseDown(point, modifiers = 0) {
        const pointer = this._pointers.get(1) ?? new Pointer(1, 'Mouse', this);
        this._pointers.set(1, pointer);
        const target = this.HitTest(point);
        if (target)
            target.RaiseEvent(new PointerPressedEventArgs(InputElement.PointerPressedEvent, target, pointer, point, { type: 'pointerdown', buttons: 1, button: 0, altKey: !!(modifiers & 1), ctrlKey: !!(modifiers & 2), shiftKey: !!(modifiers & 4), metaKey: !!(modifiers & 8) }));
    }
    MouseUp(point, modifiers = 0) {
        const pointer = this._pointers.get(1);
        if (!pointer)
            return;
        const target = pointer.Captured ?? this.HitTest(point);
        target?.RaiseEvent(new PointerReleasedEventArgs(InputElement.PointerReleasedEvent, target, pointer, point, { type: 'pointerup', buttons: 0, button: 0, altKey: !!(modifiers & 1), ctrlKey: !!(modifiers & 2), shiftKey: !!(modifiers & 4), metaKey: !!(modifiers & 8) }));
    }
    Click(point) {
        this.MouseDown(point);
        this.MouseUp(point);
    }
    KeyPress(key, modifiers = 0) {
        const target = this.FocusManager.FocusedElement ?? this;
        target.RaiseEvent(new KeyEventArgs(InputElement.KeyDownEvent, target, key, modifiers));
        target.RaiseEvent(new KeyEventArgs(InputElement.KeyUpEvent, target, key, modifiers));
    }
}
export class HeadlessUnitTestSession {
    static StartNew() {
        return new HeadlessUnitTestSession();
    }
    async Dispatch(action) {
        return action();
    }
    Dispose() {
    }
}
