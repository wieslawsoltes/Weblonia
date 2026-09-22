import { BrowserClipboard, BrowserStorageFile, BrowserStorageProvider, BrowserScreens } from './browser-services.js';
export { BrowserClipboard, BrowserStorageFile, BrowserStorageProvider, BrowserScreens } from './browser-services.js';
import { WorkerSkiaRenderer, BrowserThreadingMode } from './render-thread.js';
import { BrowserAutomationBridge } from './automation-bridge.js';
import { TextServicesChanged } from '@wieslawsoltes/avalonia-media';
import { DefineProperties, Size, Rect, Point, Event, Disposable, CompositeDisposable, NotSupportedException, AvaloniaList } from '@wieslawsoltes/avalonia-base';
import { ResourceDictionary, Styles, ThemeVariant, ResourceEnvironment } from '@wieslawsoltes/avalonia-styling';
import { ContentControl, Control, Canvas, FocusManager, LayoutManager, InputElement, TextBox, Pointer, PointerEventArgs, PointerPressedEventArgs, PointerReleasedEventArgs, PointerWheelEventArgs, KeyEventArgs, RoutedEventArgs, ModifiersFromDom, Palettes, NameScope, ToggleButton, Slider, Button, AutomationProperties, GetAutomationAriaProperties, TextBoxAutomationPeer, TextBlockAutomationPeer, TableViewColumnHeaderAutomationPeer } from '@wieslawsoltes/avalonia-controls';
import { PreviousTextPosition, NextTextPosition } from '@wieslawsoltes/avalonia-media';
import { SkiaPlatform, SkiaRenderer } from '@wieslawsoltes/avalonia-skia';
const keyMap = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space', Backspace: 'Back', Escape: 'Escape', PageUp: 'PageUp', PageDown: 'PageDown' };
const cursorMap = { Default: 'default', Arrow: 'default', Hand: 'pointer', Ibeam: 'text', Cross: 'crosshair', Wait: 'wait', Help: 'help', SizeAll: 'move', SizeNorthSouth: 'ns-resize', SizeWestEast: 'ew-resize', No: 'not-allowed', None: 'none' };
export class BrowserPlatformSettings {
    constructor(window) {
        this.Window = window;
        this.ColorValuesChanged = new Event();
        this._media = window.matchMedia('(prefers-color-scheme: dark)');
        this._change = () => this.ColorValuesChanged.Raise(this, this.GetColorValues());
        this._media.addEventListener('change', this._change);
    }
    GetColorValues() {
        return { ThemeVariant: this._media.matches ? ThemeVariant.Dark : ThemeVariant.Light, HighContrast: this.Window.matchMedia('(forced-colors: active)').matches };
    }
    get ReducedMotion() {
        return this.Window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    Dispose() {
        this._media.removeEventListener('change', this._change);
    }
}
export class TopLevel extends ContentControl {
    static GetTopLevel(visual) {
        return visual?.GetVisualRoot() ?? null;
    }
    constructor() {
        super();
        this.IsTopLevel = true;
        this.ClientSize = Size.Empty;
        this.RenderScaling = 1;
        this.Clipboard = null;
        this.StorageProvider = null;
        this.Screens = null;
        this.PlatformSettings = null;
        this.FocusManager = new FocusManager(this);
        this.LayoutManager = new LayoutManager(this);
        this.Renderer = null;
        this.Opened = new Event();
        this.Closed = new Event();
        this.Resized = new Event();
        this.RenderError = new Event();
        this._hostLifetime = new CompositeDisposable();
        this._pointerLifetime = new CompositeDisposable();
        this._pointers = new Map();
        this._hover = [];
        this._popupEntries = [];
        this._dirty = true;
        this._layoutDirty = true;
        this._runningFrame = false;
        this._frameId = null;
        this._sizeDirty = true;
        this._UsesNativeTextInput = true;
        this._ariaNodes = new Map();
        this._automationBridge = new BrowserAutomationBridge(this);
    }
    Measure(available) {
        this.ApplyStyling();
        this.ApplyTemplate();
        if (this.IsMeasureValid && this._lastMeasure?.Equals(available)) return;
        this._lastMeasure = available;
        this._measuring = true; this._invalidatedDuringMeasure = false;
        try {
            this.DesiredSize = this.MeasureOverride(available);
            this.IsMeasureValid = !this._invalidatedDuringMeasure;
            this.IsArrangeValid = false;
        } finally { this._measuring = false; }
    }
    Arrange(rect) {
        if (this.IsArrangeValid && this._lastArrange?.Equals(rect)) return;
        const old = this.Bounds;
        this._lastArrange = rect; this.Bounds = rect;
        this._arranging = true; this._invalidatedDuringArrange = false;
        try {
            this.ArrangeOverride(rect.Size);
            this.IsArrangeValid = !this._invalidatedDuringArrange && this.IsMeasureValid;
            if (!old.Equals(rect)) {
                if (!old.Size.Equals(rect.Size)) this.SizeChanged.Raise(this, { PreviousSize: old.Size, NewSize: rect.Size });
                this.InvalidateVisual(!old.Size.Equals(rect.Size));
            }
        } finally { this._arranging = false; }
    }
    ArrangeOverride(size) {
        super.ArrangeOverride(size);
        for (const entry of this._popupEntries) {
            entry.Control.Measure(new Size(Math.min(640, size.Width), Math.min(600, size.Height)));
            const desired = entry.Control.DesiredSize;
            const point = entry.Point ?? entry.Anchor?.TranslatePoint(new Point(0, entry.Anchor.Bounds.Height + 4), this) ?? new Point(20, 20);
            const x = Math.max(4, Math.min(size.Width - desired.Width - 4, point.X));
            const y = point.Y + desired.Height > size.Height - 4 ? Math.max(4, (entry.Anchor?.TranslatePoint(new Point(), this)?.Y ?? point.Y) - desired.Height - 4) : point.Y;
            entry.Control.Arrange(new Rect(x, y, Math.min(desired.Width, size.Width - 8), Math.min(desired.Height, size.Height - 8)));
        }
        return size;
    }
    Render(ctx) {
        ctx.DrawRectangle(this.Background ?? this.Palette.Window, null, new Rect(this.Bounds.Size));
    }
    async Attach(container, options = {}) {
        if (!container?.ownerDocument)
            throw new TypeError('Attach requires a DOM element.');
        if (this._container)
            throw new Error('This TopLevel is already attached.');
        this._container = container;
        this._window = container.ownerDocument.defaultView;
        this._document = container.ownerDocument;
        this._options = options;
        this.Platform = options.Platform ?? SkiaPlatform.Instance ?? await SkiaPlatform.Initialize(options.Skia ?? {});
        this._hostLifetime.Add(TextServicesChanged.Add(() => {
            if (this.IsDisposed) return;
            for (const visual of this.GetVisualDescendants()) visual.InvalidateMeasure?.();
            this.InvalidateMeasure(); this.InvalidateVisual();
        }));
        this.Clipboard = new BrowserClipboard(this._window);
        this.StorageProvider = new BrowserStorageProvider(this._window);
        this.Screens = new BrowserScreens(this._window);
        this.PlatformSettings = new BrowserPlatformSettings(this._window);
        this._hostLifetime.Add(this.PlatformSettings);
        this._container.style.position ||= 'relative';
        this._container.style.overflow = 'hidden';
        const canvas = this._document.createElement('canvas');
        canvas.style.cssText = 'display:block;position:absolute;inset:0;width:100%;height:100%;touch-action:none;outline:none;';
        canvas.tabIndex = 0;
        canvas.setAttribute('aria-label', options.Title ?? 'Avalonia application');
        this._container.append(canvas);
        this._canvas = canvas;
        this._plainTextInput = this._CreateTextInput(false);
        this._passwordInput = this._CreateTextInput(true);
        this._textInput = this._plainTextInput;
        this._aria = this._document.createElement('div');
        this._aria.style.cssText = 'position:absolute;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;';
        this._container.append(this._aria);
        this.ThreadingMode = options.ThreadingMode ?? BrowserThreadingMode.SingleThreaded;
        if (![BrowserThreadingMode.SingleThreaded,BrowserThreadingMode.RenderWorker].includes(this.ThreadingMode)) throw new Error('Full isolation is started with StartWorkerApplicationAsync and an application module.');
        this.Renderer = this.ThreadingMode === BrowserThreadingMode.RenderWorker ? new WorkerSkiaRenderer(this.Platform, this, canvas, options) : new SkiaRenderer(this.Platform, this, canvas, options);
        this._InstallHostEvents();
        this._Attach(this);
        this._OnCanvasChanged(canvas, null);
        this.RenderScaling = this._window.devicePixelRatio || 1;
        const bounds = container.getBoundingClientRect();
        this.ClientSize = new Size(Math.max(1, bounds.width), Math.max(1, bounds.height));
        await this.Renderer.Resize(this.ClientSize.Width, this.ClientSize.Height, this.RenderScaling);
        this._RequestLayout();
        await this.RenderNow();
        this.Opened.Raise(this, {});
        return this;
    }
    _Listen(target, name, handler, options, lifetime = this._hostLifetime) {
        target.addEventListener(name, handler, options);
        lifetime.Add(Disposable.Create(() => target.removeEventListener(name, handler, options)));
    }
    _CreateTextInput(password) {
        const input = this._document.createElement(password ? 'input' : 'textarea');
        if (password) input.type = 'password';
        input.setAttribute('aria-label', password ? 'Password' : 'Text input');
        input.autocomplete = 'off'; input.spellcheck = false; input.hidden = true; input.tabIndex = -1;
        input.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;z-index:100;resize:none;pointer-events:none;padding:0;border:0;font-size:16px;';
        this._container.append(input); return input;
    }
    _InstallTextInputEvents(input) {
        const doc = this._document;
        this._Listen(input, 'compositionstart', () => {
            if (input !== this._textInput) return;
            this._composing = true;
        });
        this._Listen(input, 'compositionend', () => {
            if (input !== this._textInput) return;
            this._composing = false;
            this._CommitInput(false);
        });
        this._Listen(input, 'input', () => { if (input === this._textInput) this._CommitInput(this._composing); });
        this._Listen(doc, 'selectionchange', () => {
            const control = input._avaloniaOwner;
            if (doc.activeElement === input && control instanceof TextBox && !this._syncingText) {
                control.SelectionStart = input.selectionStart;
                control.SelectionEnd = input.selectionEnd;
                control.CaretIndex = input.selectionDirection === 'backward' ? input.selectionStart : input.selectionEnd;
                control._EnsureCaretVisible();
            }
        });
        this._Listen(input, 'beforeinput', e => {
            const c = input._avaloniaOwner;
            if (!(c instanceof TextBox)) return;
            if (c.IsReadOnly || !c.AcceptsReturn && ['insertLineBreak', 'insertParagraph'].includes(e.inputType)) { e.preventDefault(); return; }
            // Chromium's native Backspace can remove only a combining mark. Keep the
            // retained editor's grapheme contract for keyboard and mobile beforeinput,
            // while leaving IME preedit, word deletion and clipboard to the browser.
            if (!this._composing && !e.isComposing && ['deleteContentBackward', 'deleteContentForward'].includes(e.inputType)) {
                e.preventDefault();
                const start = input.selectionStart, end = input.selectionEnd;
                c.SelectionStart = start; c.SelectionEnd = end; c.CaretIndex = end;
                if (start === end) {
                    if (e.inputType === 'deleteContentBackward') c.SelectionStart = PreviousTextPosition(c.Text, start);
                    else c.SelectionEnd = NextTextPosition(c.Text, end);
                }
                c.ReplaceSelection('');
            }
        });
    }
    _SelectNativeEditor(control) {
        const next = control.PasswordChar ? this._passwordInput : this._plainTextInput;
        const old = this._textInput;
        if (old !== next || old._avaloniaOwner !== control) {
            const previous = old?._avaloniaOwner;
            if (this._composing && previous && !previous.IsDisposed) previous.ApplyTextEdit(old.value, old.selectionStart, old.selectionEnd, false);
            this._composing = false;
            if (old) { old.hidden = true; old.value = ''; old._avaloniaOwner = null; }
        }
        this._textInput = next; next._avaloniaOwner = control; next.hidden = false;
        next.readOnly = control.IsReadOnly; next.inputMode = control.InputScope ?? 'text';
        next.removeAttribute('maxlength');
        return next;
    }
    _InstallHostEvents() {
        const doc = this._document, win = this._window;
        this._InstallTextInputEvents(this._plainTextInput);
        this._InstallTextInputEvents(this._passwordInput);
        const resize = new win.ResizeObserver(() => this._RequestResize());
        resize.observe(this._container);
        this._hostLifetime.Add(Disposable.Create(() => resize.disconnect()));
        this._Listen(win, 'resize', () => this._RequestResize());
        this._Listen(doc, 'visibilitychange', () => this.Renderer?.SetVisible?.(!doc.hidden));
        this._Listen(win, 'blur', () => {
            for (const p of this._pointers.values())
                p.Cancel();
        });
        this._Listen(doc, 'keydown', e => this._HandleKey(e, true), true);
        this._Listen(doc, 'keyup', e => this._HandleKey(e, false), true);
        this._Listen(this._container, 'contextmenu', e => {
            const target = this.HitTest(this._EventPosition(e));
            let owner = target;
            while (owner && !owner.ContextMenu && !owner.ContextFlyout)
                owner = owner.VisualParent;
            if (owner) {
                e.preventDefault();
                (owner.ContextMenu ?? owner.ContextFlyout).ShowAt(owner, this._EventPosition(e));
            }
        });
        this._Listen(this._container, 'dragover', e => {
            if (this.AllowDrop)
                e.preventDefault();
        });
        this._Listen(this._container, 'drop', e => {
            if (!this.AllowDrop)
                return;
            e.preventDefault();
            this.Drop.Raise(this, { Data: e.dataTransfer, Files: [...e.dataTransfer.files], Position: this._EventPosition(e), OriginalEvent: e });
        });
    }
    _OnCanvasChanged(canvas, old) {
        if (this._eventsCanvas === canvas)
            return;
        this._pointerLifetime.Clear();
        this._eventsCanvas = this._canvas = canvas;
        if (old && old !== canvas && old.parentNode)
            old.replaceWith(canvas);
        for (const type of ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'pointerleave', 'lostpointercapture'])
            this._Listen(canvas, type, e => this._HandlePointer(e), false, this._pointerLifetime);
        this._Listen(canvas, 'wheel', e => {
            this.Renderer.PreprocessWheel?.(e);
            const target = this.HitTest(this._EventPosition(e));
            if (!target)
                return;
            const pointer = this._GetPointer({ pointerId: 0, pointerType: 'mouse' }), args = new PointerWheelEventArgs(InputElement.PointerWheelChangedEvent, target, pointer, this._EventPosition(e), e);
            target.RaiseEvent(args);
            if (args.Handled)
                e.preventDefault();
        }, { passive: false }, this._pointerLifetime);
    }
    _GetPointer(e) {
        const id = e.pointerId ?? 0;
        if (!this._pointers.has(id))
            this._pointers.set(id, new Pointer(id, e.pointerType === 'touch' ? 'Touch' : e.pointerType === 'pen' ? 'Pen' : 'Mouse', this));
        return this._pointers.get(id);
    }
    _EventPosition(e) {
        const rect = this._canvas.getBoundingClientRect();
        return new Point(e.clientX - rect.left, e.clientY - rect.top);
    }
    _CapturePointer(pointer, control) {
        try {
            control ? this._canvas.setPointerCapture(pointer.Id) : this._canvas.releasePointerCapture(pointer.Id);
        }
        catch {
        }
    }
    _HandlePointer(e) {
        if (!this.IsEffectivelyEnabled)
            return;
        if (e.type === 'lostpointercapture') {
            const pointer = this._pointers.get(e.pointerId);
            if (pointer && (pointer.Captured || pointer.CapturedGestureRecognizer)) pointer.Cancel();
            return;
        }
        // Browsers send pointerleave after pointerup/cancel. A terminated touch
        // must not be recreated by that hover event (or a delayed pointermove).
        if (e.pointerType === 'touch' && e.type !== 'pointerdown' && !this._pointers.has(e.pointerId)) return;
        const pointer = this._GetPointer(e), pos = this._EventPosition(e), hit = this.HitTest(pos);
        this._UpdateHover(e.type === 'pointerleave' ? null : hit, pointer, pos, e);
        if (e.type === 'pointercancel') {
            this._UpdateHover(null, pointer, pos, e);
            pointer.Dispose();
            this._pointers.delete(pointer.Id);
            return;
        }
        if (e.type === 'pointerleave')
            return;
        if (e.type === 'pointerdown') {
            for (const entry of [...this._popupEntries].reverse())
                if (entry.LightDismiss && !entry.Control.FindDescendant(v => v === hit)) {
                    entry.Close();
                    break;
                }
        }
        if (e.type === 'pointermove' && pointer._pressPosition && Math.hypot(pos.X - pointer._pressPosition.X, pos.Y - pointer._pressPosition.Y) > 8)
            pointer._suppressTap = true;
        const target = pointer.CapturedGestureRecognizer?.Target ?? pointer.Captured ?? hit ?? pointer._pressTarget;
        if (!target || !target.IsEffectivelyEnabled)
            return;
        const type = e.type === 'pointerdown' ? InputElement.PointerPressedEvent : e.type === 'pointerup' ? InputElement.PointerReleasedEvent : InputElement.PointerMovedEvent, Ctor = e.type === 'pointerdown' ? PointerPressedEventArgs : e.type === 'pointerup' ? PointerReleasedEventArgs : PointerEventArgs;
        const args = new Ctor(type, target, pointer, pos, e);
        if (e.type === 'pointerdown') {
            pointer._pressTarget = target; pointer._pressPosition = pos;
            pointer._suppressTap = false;
        }
        target.RaiseEvent(args);
        if (e.type === 'pointerup') {
            if (pointer._pressTarget === hit && !pointer._suppressTap) {
                target.RaiseEvent(new PointerEventArgs(InputElement.TappedEvent, target, pointer, pos, e));
                if (e.detail === 2) target.RaiseEvent(new PointerEventArgs(InputElement.DoubleTappedEvent, target, pointer, pos, e));
            }
            pointer._pressTarget = null; pointer._pressPosition = null;
            if (pointer.Type !== 'Mouse') {
                this._UpdateHover(null, pointer, pos, e);
                pointer.Dispose();
                this._pointers.delete(pointer.Id);
            }
        }
        if (args.Handled)
            e.preventDefault();
    }
    _UpdateHover(hit, pointer, pos, event) {
        const path = hit ? [hit, ...hit.GetVisualAncestors()] : [];
        for (const node of this._hover)
            if (!path.includes(node)) {
                node.IsPointerOver = false;
                node.PseudoClasses.Set(':pointerover', false);
                node.RaiseEvent(new PointerEventArgs(InputElement.PointerExitedEvent, node, pointer, pos, event));
            }
        for (const node of path)
            if (!this._hover.includes(node)) {
                node.IsPointerOver = true;
                node.PseudoClasses.Set(':pointerover', true);
                node.RaiseEvent(new PointerEventArgs(InputElement.PointerEnteredEvent, node, pointer, pos, event));
            }
        this._hover = path;
        this._canvas.style.cursor = cursorMap[hit?.Cursor] ?? hit?.Cursor ?? 'default';
    }
    _HandleKey(e, down) {
        if (!this._container?.isConnected || !this._container.contains(this._document.activeElement))
            return;
        const key = keyMap[e.key] ?? e.key, target = this.FocusManager.FocusedElement ?? this;
        if (down && key === 'Escape' && this._popupEntries.length) {
            this._popupEntries.at(-1).Close();
            e.preventDefault();
            return;
        }
        if (target?._NativeWantsKey?.(e)) return;
        if (down && key === 'Tab' && !(target instanceof TextBox && target.AcceptsTab)) {
            this.FocusManager.MoveFocus(!e.shiftKey);
            e.preventDefault();
            return;
        }
        if (down && key === 'Tab' && target instanceof TextBox && target.AcceptsTab) {
            target.ReplaceSelection('\t');
            e.preventDefault();
            return;
        }
        const args = new KeyEventArgs(down ? InputElement.KeyDownEvent : InputElement.KeyUpEvent, target, key, ModifiersFromDom(e), e);
        target.RaiseEvent(args);
        if (down && !args.Handled) {
            const commandKey = `${e.ctrlKey ? 'Ctrl+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.metaKey ? 'Meta+' : ''}${key}`.toLowerCase();
            const hot = this.GetVisualDescendants().find(c => String(c.HotKey ?? '').toLowerCase() === commandKey && c.IsEffectivelyEnabled && c.IsEffectivelyVisible);
            if (hot?.OnClick) {
                hot.OnClick();
                args.Handled = true;
            }
            if (!args.Handled && key === 'Enter' && !(target instanceof TextBox && target.AcceptsReturn)) {
                const b = this.GetVisualDescendants().find(c => c instanceof Button && c.IsDefault);
                if (b) {
                    b.OnClick();
                    args.Handled = true;
                }
            }
        }
        if (args.Handled)
            e.preventDefault();
    }
    _OnFocusChanged(control) {
        this._InvalidateAutomation(control);
        if (!this._textInput)
            return;
        if (control instanceof TextBox) {
            this._SelectNativeEditor(control);
            this._SyncTextInput(control);
            this._textInput.focus({ preventScroll: true });
        }
        else {
            this._textInput.hidden = true; this._textInput.value = ''; this._textInput._avaloniaOwner = null;
            this._composing = false;
            if (control?.FocusNative) control.FocusNative();
            else this._canvas.focus({ preventScroll: true });
        }
        this._RequestRender();
    }
    _SyncTextInput(control) {
        if (!this._textInput || this.FocusManager.FocusedElement !== control || this._composing)
            return;
        const prior = this._textInput;
        this._SelectNativeEditor(control);
        if (prior !== this._textInput && prior === this._document.activeElement) this._textInput.focus({ preventScroll: true });
        this._syncingText = true;
        try {
            this._textInput.dir = control.FlowDirection === 'RightToLeft' ? 'rtl' : 'ltr';
            if (this._textInput.value !== control.Text)
                this._textInput.value = control.Text;
            this._textInput.setSelectionRange(Math.min(control.SelectionStart, control.SelectionEnd), Math.max(control.SelectionStart, control.SelectionEnd), control.CaretIndex === control.SelectionStart ? 'backward' : 'forward');
            const layout = control._LayoutText(), caret = layout.HitTestTextPosition(control.CaretIndex), origin = control._TextOrigin(layout), p = control.TranslatePoint(new Point(origin.X + caret.X, origin.Y + caret.Bottom), this);
            this._textInput.style.left = `${Math.max(0, Math.min(this.ClientSize.Width - 1, p.X))}px`;
            this._textInput.style.top = `${Math.max(0, Math.min(this.ClientSize.Height - 1, p.Y))}px`;
        }
        finally {
            this._syncingText = false;
        }
    }
    _CommitInput(composing) {
        if (!this.IsEffectivelyEnabled)
            return;
        const control = this._textInput?._avaloniaOwner;
        if (!(control instanceof TextBox) || control.IsDisposed)
            return;
        control.ApplyTextEdit(this._textInput.value, this._textInput.selectionStart, this._textInput.selectionEnd, composing);
    }
    _RequestRender() {
        this._dirty = true;
        this._ScheduleFrame();
    }
    _RequestLayout() {
        this._layoutDirty = true;
        this._dirty = true;
        this._ScheduleFrame();
    }
    _RequestResize() {
        this._sizeDirty = true;
        this._ScheduleFrame();
    }
    _RequestAnimationFrame(visual = null) {
        // A scheduled frame is not a drawing-content invalidation. Retained
        // renderers must know WHICH time-dependent control needs recording.
        // Defer its invalidation until the next frame, so this capture can finish
        // and multiple requests from the same control coalesce into one update.
        if (visual && !visual.IsDisposed)
            (this._animationFrameRequests ??= new Set()).add(visual);
        this._RequestRender();
    }
    _ProcessAnimationFrameRequests() {
        const requests = this._animationFrameRequests;
        this._animationFrameRequests = null;
        if (!requests) return;
        for (const visual of requests) {
            if (visual.IsDisposed || visual.GetVisualRoot() !== this) continue;
            let visible = true;
            for (let current = visual; current; current = current.VisualParent)
                if (!current.IsVisible || current.Opacity <= 0) { visible = false; break; }
            if (visible) visual.InvalidateVisual();
        }
    }
    _ScheduleFrame() {
        if (!this._window || !this.Renderer || this.Renderer.LastError || this.IsDisposed || this._frameId != null || this._runningFrame) return;
        this._frameId = this._window.requestAnimationFrame(() => {
            this._frameId = null;
            this.RenderNow(false).catch(error => this._ReportRenderError(error));
        });
    }
    async RenderNow(force = true) {
        if (!this.Renderer || this.IsDisposed || this._runningFrame) return;
        // An explicit render consumes pending work instead of leaving a second
        // RAF callback queued to paint the same state again.
        if (this._frameId != null) { this._window.cancelAnimationFrame(this._frameId); this._frameId = null; }
        this._runningFrame = true;
        const uiStart=performance.now();let layoutMs=0,recordMs=0,automationMs=0;
        try {
            this._ProcessAnimationFrameRequests();
            let size = this.ClientSize;
            const scale = this._window.devicePixelRatio || 1;
            if (force || this._sizeDirty || scale !== this.RenderScaling) {
                this._sizeDirty = false;
                const rect = this._container.getBoundingClientRect();
                const next = new Size(Math.max(1, rect.width), Math.max(1, rect.height));
                if (!next.Equals(size) || scale !== this.RenderScaling) {
                    size = this.ClientSize = next;
                    this.RenderScaling = scale;
                    this.IsMeasureValid = this.IsArrangeValid = false;
                    this._layoutDirty = this._dirty = true;
                    await this.Renderer.Resize(size.Width, size.Height, scale);
                    this.Resized.Raise(this, { ClientSize: size });
                }
            }
            const layout = this._layoutDirty || !this.IsMeasureValid || !this.IsArrangeValid;
            if (layout) {
                this._layoutDirty = false;
                const beforeLayout=performance.now();this.LayoutManager.ExecuteLayoutPass(size);layoutMs=performance.now()-beforeLayout;
                // A converged pass consumed invalidations raised while realizing
                // rows. Do not repeat it solely because its queue flag was set.
                this._layoutDirty = !this.IsMeasureValid || !this.IsArrangeValid;
            }
            if (force || this._dirty || layout) {
                this._dirty = false;
                const beforeRecord=performance.now();this.Renderer.Render();recordMs=performance.now()-beforeRecord;
                for (const host of this._nativeHosts ?? []) host._SyncNative();
            }
            if (this._automationBridge.NeedsUpdate){const beforeAutomation=performance.now();this._UpdateAccessibility();automationMs=performance.now()-beforeAutomation;}
        } finally {
            this.LastUiFrame={Milliseconds:performance.now()-uiStart,LayoutMilliseconds:layoutMs,RenderOrRecordMilliseconds:recordMs,AutomationMilliseconds:automationMs};
            this._runningFrame = false;
            if (this._dirty || this._layoutDirty || this._sizeDirty || this._automationBridge.NeedsUpdate) this._ScheduleFrame();
        }
        if (force) await this.Renderer.FlushAsync?.();
    }
    _ReportRenderError(error) {
        if (this.LastRenderError === error) return;
        this.LastRenderError = error;
        this.RenderError.Raise(this, { Error: error });
        console.error(error);
    }
    _OnRendererLost(info) {
        this.RenderError.Raise(this, { Error: new Error(`Graphics device lost: ${info?.message ?? info}`) });
    }
    _InvalidateAutomation(control, structure = false, subtree = false) {
        this._automationBridge?.Invalidate(control, structure, subtree);
        this._ScheduleFrame();
    }
    _UpdateAccessibility() { this._automationBridge.Flush(); }
    ShowPopup(control, anchor = null, options = {}) {
        const entry = { Control: control, Anchor: anchor, Point: options.Point, LightDismiss: options.LightDismiss !== false, Close: () => {
                const i = this._popupEntries.indexOf(entry);
                if (i < 0)
                    return;
                this._popupEntries.splice(i, 1);
                this.RemoveVisualChild(control);
                options.OnClosed?.();
                this._RequestLayout();
            } };
        control.ZIndex = 10000 + this._popupEntries.length;
        this._popupEntries.push(entry);
        this.AddVisualChild(control);
        this._RequestLayout();
        return Disposable.Create(entry.Close);
    }
    async CapturePngAsync() {
        await this.RenderNow();
        return this.Renderer.SnapshotPng();
    }
    Dispose() {
        if (this.IsDisposed)
            return;
        this._window?.cancelAnimationFrame(this._frameId);
        this._animationFrameRequests?.clear();
        this._animationFrameRequests = null;
        this._pointerLifetime.Dispose();
        this._hostLifetime.Dispose();
        for (const entry of [...this._popupEntries])
            entry.Close();
        this.Compositor?.Dispose();
        this._nativeHostLayer?.remove();
        this.Renderer?.Dispose();
        this._canvas?.remove();
        this._plainTextInput?.remove();
        this._passwordInput?.remove();
        this._aria?.remove();
        this._automationBridge.Dispose();
        super.Dispose();
    }
}
DefineProperties(TopLevel, { AllowDrop: [false] });
Object.defineProperty(TopLevel.prototype, 'Drop', { get() {
        return this._drop ??= new Event();
    } });
export class Window extends TopLevel {
    static Windows = new Set();
    constructor() {
        super();
        this.Closing = new Event();
        this.Activated = new Event();
        this.Deactivated = new Event();
        this.IsActive = false;
        this.Owner = null;
        this._dialogResolve = null;
    }
    Show(owner = null, options = {}) {
        if (this.IsDisposed)
            throw new Error('A closed window cannot be shown again.');
        if (this._container) {
            this._window.focus();
            return this;
        }
        this.Owner = owner;
        if(owner?.IsWorkerRoot){if(!Window.WorkerWindowFactory)throw new Error('Worker window services are not installed.');return Window.WorkerWindowFactory(this,owner,options);}
        const parentWindow = owner?._window ?? globalThis.window;
        // Must remain synchronous: window.open happens in the initiating user gesture, before WASM or renderer awaits.
        const width = Number.isFinite(this.Width) ? this.Width : 800, height = Number.isFinite(this.Height) ? this.Height : 600;
        const popup = parentWindow.open('', '_blank', `popup=yes,width=${Math.round(width)},height=${Math.round(height)}`);
        if (!popup)
            throw new Error('The browser blocked the window. Open Window.Show from a trusted click or keyboard gesture and allow popups.');
        this._ownsBrowserWindow = true;
        popup.document.title = this.Title;
        popup.document.documentElement.style.cssText = 'height:100%;';
        popup.document.body.style.cssText = 'margin:0;height:100%;overflow:hidden;';
        const host = popup.document.createElement('div');
        host.style.cssText = 'width:100%;height:100%;';
        popup.document.body.append(host);
        this.WhenOpened = this.Attach(host, { Platform: owner?.Platform ?? SkiaPlatform.Instance, ...options }).then(() => {
            Window.Windows.add(this);
            this._Listen(popup, 'beforeunload', () => this._FinishClose());
            this._Listen(popup, 'focus', () => {
                this.IsActive = true;
                this.Activated.Raise(this, {});
            });
            this._Listen(popup, 'blur', () => {
                this.IsActive = false;
                this.Deactivated.Raise(this, {});
            });
            return this;
        }).catch(error => {
            this._dialogReject?.(error);
            this._dialogResolve = null;
            this._dialogReject = null;
            popup.close();
            this._FinishClose();
            throw error;
        });
        return this;
    }
    ShowDialog(owner, options = {}) {
        if (!owner)
            return Promise.reject(new TypeError('A dialog requires an owner window.'));
        const promise = new Promise((resolve, reject) => {
            this._dialogResolve = resolve;
            this._dialogReject = reject;
        });
        this._ownerEnabled = owner.IsEnabled;
        owner.IsEnabled = false;
        try {
            this.Show(owner, options);
            this.WhenOpened.catch(() => {
            });
        }
        catch (error) {
            owner.IsEnabled = this._ownerEnabled;
            this._dialogResolve = null;
            return Promise.reject(error);
        }
        return promise;
    }
    Close(result = undefined) {
        if (this.IsDisposed)
            return;
        const e = { Cancel: false, CloseReason: 'WindowClosing' };
        this.Closing.Raise(this, e);
        if (e.Cancel)
            return;
        this._dialogResult = result;
        const win = this._window;
        this._FinishClose();
        if (this._ownsBrowserWindow && !win.closed)
            win.close();
    }
    _FinishClose() {
        if (this.IsDisposed)
            return;
        Window.Windows.delete(this);
        if (this.Owner && this._ownerEnabled !== undefined && !this.Owner.IsDisposed) {
            this.Owner.IsEnabled = this._ownerEnabled;
            this.Owner.Activate();
        }
        this._dialogResolve?.(this._dialogResult);
        this._dialogResolve = null;
        this._dialogReject = null;
        this.Closed.Raise(this, { Result: this._dialogResult });
        this.Dispose();
    }
    Activate() {
        this._window?.focus();
    }
    Hide() {
        if (this._ownsBrowserWindow)
            throw new NotSupportedException('Browsers do not provide a general API to hide native popup windows.');
        if (this._container)
            this._container.style.display = 'none';
    }
    async SetFullScreenAsync(enabled) {
        if (!this._container)
            return;
        if (enabled) {
            if (!this._container.requestFullscreen)
                throw new NotSupportedException('Fullscreen is not supported by this browser.');
            await this._container.requestFullscreen();
        }
        else if (this._document.fullscreenElement)
            await this._document.exitFullscreen();
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'Title' && this._document)
            this._document.title = e.NewValue;
    }
}
DefineProperties(Window, { Title: ['Avalonia Web'], CanResize: [true], ShowInTaskbar: [true], WindowState: ['Normal'], SizeToContent: ['Manual'], WindowStartupLocation: ['Manual'], SystemDecorations: ['Full'] });
export class BrowserWindowingPlatform {
    constructor(options = {}) {
        this.Options = options;
    }
    CreateWindow() {
        return new Window();
    }
    CreateEmbeddableWindow() {
        return new TopLevel();
    }
    get Capabilities() {
        return { NativeBrowserWindows: true, PopupBlocking: true, ArbitraryDesktopWindowMove: false, DesktopMinimize: false, NativeMenuBar: false, BrowserFullscreen: typeof document !== 'undefined' && !!document.documentElement.requestFullscreen, UnrestrictedFileSystem: false };
    }
}
export class BrowserApplicationLifetime {
    constructor() {
        this.MainView = null;
        this.MainWindow = null;
        this.Startup = new Event();
        this.Exit = new Event();
    }
    Shutdown(exitCode = 0) {
        for (const w of [...Window.Windows])
            w.Close();
        this.MainWindow?.Close();
        this.Exit.Raise(this, { ApplicationExitCode: exitCode });
    }
}
export class Application {
    static Current = null;
    constructor() {
        Application.Current = this;
        ResourceEnvironment.Application = this;
        this.Resources = new ResourceDictionary();
        this.Styles = new Styles();
        this.DataTemplates = new AvaloniaList();
        this.ResourcesChanged = new Event();
        this._requestedTheme = ThemeVariant.Default;
        this.ApplicationLifetime = null;
        this.Name = '';
    }
    get RequestedThemeVariant() {
        return this._requestedTheme;
    }
    set RequestedThemeVariant(value) {
        this._requestedTheme = ThemeVariant.Parse(value);
        const root = this.ApplicationLifetime?.MainWindow;
        root?.InvalidateStyles(true);
        root?._NotifyThemeChanged();
        this.ResourcesChanged.Raise(this, {});
    }
    get ActualThemeVariant() {
        return this._requestedTheme.Key === 'Default' ? ResourceEnvironment.SystemTheme : this._requestedTheme;
    }
    Initialize() {
    }
    OnFrameworkInitializationCompleted() {
    }
    InvalidateStyles() {
        this.ApplicationLifetime?.MainWindow?.InvalidateStyles(true);
        for (const w of Window.Windows)
            w.InvalidateStyles(true);
    }
    Dispose() {
        this.ApplicationLifetime?.Shutdown();
        this.Styles.Dispose();
        this.Resources.Dispose();
        if (Application.Current === this)
            Application.Current = null;
        if (ResourceEnvironment.Application === this)
            ResourceEnvironment.Application = null;
    }
}
export class AppBuilder {
    static Configure(factory) {
        return new AppBuilder(factory);
    }
    constructor(factory) {
        this.Factory = factory;
        this.Options = {};
        this._afterSetup = [];
    }
    UseBrowser(options = {}) {
        Object.assign(this.Options, options);
        return this;
    }
    UseSkia(options = {}) {
        this.Options.Skia = options;
        return this;
    }
    UseReactiveUI() {
        this.Options.ReactiveUI = true;
        return this;
    }
    With(options) {
        Object.assign(this.Options, options);
        return this;
    }
    AfterSetup(callback) {
        this._afterSetup.push(callback);
        return this;
    }
    async StartBrowserAppAsync(elementOrId, options = {}) {
        const container = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
        if (!container)
            throw new Error('Browser application host was not found.');
        const config = { ...this.Options, ...options }, platform = config.Platform ?? await SkiaPlatform.Initialize(config.Skia ?? {}), app = this.Factory.prototype instanceof Application || this.Factory === Application ? new this.Factory() : this.Factory();
        this.Instance = app;
        app.ApplicationLifetime = new BrowserApplicationLifetime();
        const win = container.ownerDocument.defaultView;
        ResourceEnvironment.SystemTheme = win.matchMedia('(prefers-color-scheme: dark)').matches ? ThemeVariant.Dark : ThemeVariant.Light;
        if (config.ReactiveUI)
            (await import('@wieslawsoltes/avalonia-reactiveui')).UseReactiveUI();
        await app.Initialize();
        app.OnFrameworkInitializationCompleted();
        for (const callback of this._afterSetup)
            callback(this);
        const main = app.ApplicationLifetime.MainWindow ?? new Window();
        main.Content ??= app.ApplicationLifetime.MainView;
        app.ApplicationLifetime.MainWindow = main;
        main.Foreground = main.Palette.Text;
        await main.Attach(container, { ...config, Platform: platform });
        app.ApplicationLifetime.Startup.Raise(app, {});
        return app;
    }
    SetupBrowserAppAsync(...args) {
        return this.StartBrowserAppAsync(...args);
    }
}

export * from './native-host.js';

export * from './render-thread.js';
export { BrowserWorkerApplication, StartWorkerApplicationAsync } from './isolated-host.js';
