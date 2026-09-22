import { AvaloniaList, DefineProperties, DefineAttached, Disposable, CompositeDisposable, Event, Size, Rect, Point, Thickness, CornerRadius, MathUtilities, BindingMode, AvaloniaProperty } from '@wieslawsoltes/avalonia-base';
import { Pen, Color, SolidColorBrush, LinearGradientBrush, GradientStop } from '@wieslawsoltes/avalonia-media';
import { Control, BooleanValue, DefineRoutedEvent, RoutedEventArgs } from './core.js';
import { ContentControl, HeaderedContentControl, Decorator, Border, TextBlock } from './content.js';
import { StackPanel, Grid, GridLength } from './layout.js';
import { Button, ToggleButton, TextBox } from './input-controls.js';
import { ItemsControl, TabControl, Carousel, ListBox } from './items.js';
/** Popups are retained visuals in the owning browser TopLevel, not HTML widgets. */
export class Popup extends ContentControl {
    constructor() {
        super();
        this.Opened = new Event();
        this.Closed = new Event();
        this._popup = null;
    }
    Open() {
        if (this._popup)
            return;
        const owner = this.PlacementTarget?.GetVisualRoot();
        if (!owner?.ShowPopup)
            throw new Error('Popup requires an attached PlacementTarget.');
        const content = this.Content;
        if (!(content instanceof Control))
            throw new TypeError('Popup.Content must be a Control.');
        if (content.VisualParent === this)
            this.RemoveVisualChild(content);
        this._popup = owner.ShowPopup(content, this.PlacementTarget, { LightDismiss: this.IsLightDismissEnabled, OnClosed: () => {
                this._popup = null;
                this.SetCurrentValue(Popup.IsOpenProperty, false);
                this.Closed.Raise(this, {});
            } });
        this.SetCurrentValue(Popup.IsOpenProperty, true);
        this.Opened.Raise(this, {});
    }
    Close() {
        this._popup?.Dispose();
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'IsOpen')
            e.NewValue ? this.Open() : this.Close();
    }
    Dispose() {
        this.Close();
        super.Dispose();
    }
}
DefineProperties(Popup, { IsOpen: [false, { Convert: BooleanValue }], PlacementTarget: [null], Placement: ['Bottom'], IsLightDismissEnabled: [true, { Convert: BooleanValue }], HorizontalOffset: [0], VerticalOffset: [0] });
export class FlyoutBase {
    constructor() {
        this.Placement = 'Bottom';
        this.ShowMode = 'Standard';
        this.IsOpen = false;
        this.Opening = new Event();
        this.Opened = new Event();
        this.Closing = new Event();
        this.Closed = new Event();
        this._popup = null;
    }
    CreatePresenter() {
        throw new Error('Override FlyoutBase.CreatePresenter.');
    }
    ShowAt(target) {
        this.Hide();
        if (this._popup)
            return;
        const root = target?.GetVisualRoot();
        if (!root?.ShowPopup)
            throw new Error('Flyout target is not attached to a browser TopLevel.');
        this.Opening.Raise(this, {});
        const presenter = this.CreatePresenter();
        this._presenter = presenter;
        this._popup = root.ShowPopup(presenter, target, { OnClosed: () => {
                this._popup = null;
                this.IsOpen = false;
                this._ReleasePresenter(presenter);
                if (this._presenter === presenter)
                    this._presenter = null;
                this.Closed.Raise(this, {});
            } });
        this.IsOpen = true;
        this.Opened.Raise(this, {});
    }
    _ReleasePresenter(presenter) {
        presenter?.Dispose();
    }
    Hide() {
        if (!this._popup)
            return;
        const args = { Cancel: false };
        this.Closing.Raise(this, args);
        if (!args.Cancel)
            this._popup.Dispose();
    }
    Dispose() {
        this._popup?.Dispose();
        this._popup = null;
        this._presenter?.Dispose();
    }
    static SetAttachedFlyout(target, value) {
        target.AttachedFlyout = value;
    }
    static GetAttachedFlyout(target) {
        return target.AttachedFlyout ?? null;
    }
    static ShowAttachedFlyout(target) {
        this.GetAttachedFlyout(target)?.ShowAt(target);
    }
}
export class Flyout extends FlyoutBase {
    constructor(content = null) {
        super();
        this.Content = content;
    }
    CreatePresenter() {
        const b = new Border();
        b.Padding = new Thickness(16);
        b.CornerRadius = new CornerRadius(8);
        b.BorderThickness = new Thickness(1);
        b.Background = this._targetPalette?.Surface ?? '#FFFFFF';
        b.BorderBrush = '#CED2DD';
        b.Child = this.Content instanceof Control ? this.Content : new TextBlock(String(this.Content ?? ''));
        return b;
    }
    _ReleasePresenter(presenter) {
        if (presenter.Child === this.Content)
            presenter.Child = null;
        super._ReleasePresenter(presenter);
    }
    ShowAt(target) {
        this._targetPalette = target.Palette;
        super.ShowAt(target);
    }
    Dispose() {
        super.Dispose();
        this.Content?.Dispose?.();
    }
}
export class MenuItem extends Button {
    constructor(header = '') {
        super();
        this.Items = new AvaloniaList();
        this.Header = header;
        this.HorizontalContentAlignment = 'Left';
        this.Padding = new Thickness(12, 8);
        this.MinWidth = 160;
        this._lifetime.Add(this.Click.Add(() => {
            if (this.Items.Count)
                this.Open();
            else {
                if (this.ToggleType !== 'None')
                    this.IsChecked = !this.IsChecked;
                this._parentMenu?.Hide?.();
            }
        }));
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'Header')
            this.Content = String(e.NewValue ?? '').replace(/_(.)/g, '$1');
    }
    Open() {
        if (!this.Items.Count)
            return;
        this._submenu?.Dispose();
        const menu = new MenuFlyout();
        menu.OwnsItems = false;
        for (const item of this.Items)
            menu.Items.Add(item);
        menu.ShowAt(this);
        this._submenu = menu;
    }
    OnKeyDown(e) {
        if (e.Key === 'Right' && this.Items.Count) {
            this.Open();
            e.Handled = true;
        }
        else
            super.OnKeyDown(e);
    }
    Render(ctx) {
        super.Render(ctx);
        if (this.IsChecked)
            this.DrawText(ctx, '✓', new Rect(4, 0, 16, this.Bounds.Height));
        if (this.Items.Count)
            this.DrawText(ctx, '›', new Rect(this.Bounds.Width - 24, 0, 16, this.Bounds.Height));
        else if (this.InputGesture)
            this.DrawText(ctx, String(this.InputGesture), new Rect(Math.max(80, this.Bounds.Width - 100), 0, 88, this.Bounds.Height), { Foreground: this.Palette.Muted, TextAlignment: 'Right', FontSize: 12 });
    }
    Dispose() {
        this._submenu?.Dispose();
        for (const item of this.Items)
            item.Dispose?.();
        super.Dispose();
    }
}
DefineProperties(MenuItem, { Header: ['', { AffectsMeasure: true }], Icon: [null], InputGesture: [null], IsChecked: [false, { Convert: BooleanValue }], ToggleType: ['None'] });
export class MenuFlyout extends FlyoutBase {
    constructor() {
        super();
        this.Items = new AvaloniaList();
        this.OwnsItems = true;
    }
    _ReleasePresenter(presenter) {
        const panel = presenter._menuPanel;
        if (panel) {
            const children = panel.Children.ToArray();
            panel.Children.Clear();
            for (const child of children)
                if (!this.Items.Contains(child))
                    child.Dispose();
        }
        super._ReleasePresenter(presenter);
    }
    Dispose() {
        super.Dispose();
        if (this.OwnsItems)
            for (const item of this.Items)
                item.Dispose?.();
    }
    CreatePresenter() {
        const panel = new StackPanel();
        panel.MinWidth = 200;
        panel.Spacing = 2;
        for (const value of this.Items) {
            const item = value instanceof Control ? value : new MenuItem(String(value));
            if (item.VisualParent)
                item.VisualParent.RemoveVisualChild(item);
            item._parentMenu = this;
            panel.Children.Add(item);
        }
        const b = new Border(panel);
        b.Background = this._palette.Surface;
        b.BorderBrush = this._palette.Border;
        b.BorderThickness = new Thickness(1);
        b.Padding = new Thickness(4);
        b.CornerRadius = new CornerRadius(6);
        b._menuPanel = panel;
        return b;
    }
    ShowAt(target) {
        this._palette = target.Palette;
        super.ShowAt(target);
    }
    Hide() {
        super.Hide();
    }
}
export class ContextMenu extends MenuFlyout {
    Open(target) {
        this.ShowAt(target);
    }
    Close() {
        this.Hide();
    }
}
export class Menu extends ItemsControl {
    constructor() {
        super();
        this._panel.Orientation = 'Horizontal';
        this._panel.Spacing = 2;
    }
    CreateContainerForItemOverride(item) {
        return item instanceof MenuItem ? item : new MenuItem(String(item));
    }
    PrepareContainerForItemOverride(container, item, index) {
        container.ItemIndex = index;
        container.MinWidth = 50;
        if (container !== item)
            container.Header = String(item);
    }
}
export class CommandBar extends Menu {
    constructor() {
        super();
        this.PrimaryCommands = this.Items;
        this.SecondaryCommands = new AvaloniaList();
        this.OverflowButton = new Button('•••');
        this._lifetime.Add(this.SecondaryCommands.CollectionChanged.Add(() => this.InvalidateMeasure()));
        this._lifetime.Add(this.OverflowButton.Click.Add(() => {
            const menu = new MenuFlyout();
            menu.Items.AddRange(this.SecondaryCommands);
            menu.ShowAt(this.OverflowButton);
        }));
    }
    MeasureOverride(size) {
        if (this.SecondaryCommands.Count && !this.OverflowButton.VisualParent)
            this.AddVisualChild(this.OverflowButton);
        this.OverflowButton.Measure(size);
        return super.MeasureOverride(new Size(Math.max(0, size.Width - (this.SecondaryCommands.Count ? 46 : 0)), size.Height));
    }
    ArrangeOverride(size) {
        super.ArrangeOverride(new Size(Math.max(0, size.Width - (this.SecondaryCommands.Count ? 46 : 0)), size.Height));
        if (this.SecondaryCommands.Count)
            this.OverflowButton.Arrange(new Rect(size.Width - 44, 0, 44, size.Height));
        return size;
    }
}
export class ToolTip extends ContentControl {
    static SetTip(control, value) {
        control._toolTipLifetime?.Dispose();
        control._toolTipLifetime = new CompositeDisposable();
        control._toolTip = value;
        let timer = null, popup = null;
        const close = () => {
            clearTimeout(timer);
            popup?.Dispose();
            popup = null;
        };
        control._toolTipLifetime.Add(control.PointerEntered.Add(() => {
            close();
            timer = setTimeout(() => {
                if (!control.IsPointerOver)
                    return;
                const root = control.GetVisualRoot();
                if (!root?.ShowPopup)
                    return;
                const b = new Border();
                b.Background = control.Palette.Text;
                b.Padding = new Thickness(10, 6);
                b.CornerRadius = new CornerRadius(4);
                b.Child = value instanceof Control ? value : new TextBlock(String(value));
                b.Child.Foreground = control.Palette.Surface;
                popup = root.ShowPopup(b, control, { LightDismiss: false });
            }, ToolTip.GetShowDelay(control));
        }));
        control._toolTipLifetime.Add(control.PointerExited.Add(close));
        control._toolTipLifetime.Add(new Disposable(close));
        control._lifetime.Add(control._toolTipLifetime);
    }
    static GetTip(control) {
        return control._toolTip;
    }
    static SetShowDelay(control, value) {
        control._toolTipDelay = Math.max(0, Number(value));
    }
    static GetShowDelay(control) {
        return control._toolTipDelay ?? 600;
    }
}
function dateOnly(value) {
    if (value == null || value === '')
        return null;
    const d = value instanceof Date ? new Date(value) : new Date(value);
    if (Number.isNaN(+d))
        throw new TypeError('Invalid date.');
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function sameDay(a, b) {
    return a != null && b != null && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
export class Calendar extends Control {
    constructor() {
        super();
        this.Focusable = true;
        this.DisplayDate = new Date();
        this.SelectedDates = new AvaloniaList();
        this.SelectedDatesChanged = new Event();
        this._lifetime.Add(this.SelectedDates.CollectionChanged.Add(() => this.InvalidateVisual()));
    }
    _Month() {
        return new Date(this.DisplayDate.getFullYear(), this.DisplayDate.getMonth(), 1);
    }
    _Days() {
        const first = this._Month();
        first.setDate(first.getDate() - (first.getDay() - this.FirstDayOfWeek + 7) % 7);
        return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
    }
    _Allowed(date) {
        return (!this.DisplayDateStart || +date >= +dateOnly(this.DisplayDateStart)) && (!this.DisplayDateEnd || +date <= +dateOnly(this.DisplayDateEnd)) && !this.BlackoutDates?.some?.(x => sameDay(date, dateOnly(x)));
    }
    SelectDate(value) {
        const date = dateOnly(value);
        if (date && !this._Allowed(date))
            return false;
        if (this.SelectionMode === 'None')
            return false;
        this.SetCurrentValue(Calendar.SelectedDateProperty, date);
        return true;
    }
    MoveMonth(delta) {
        const d = this._Month();
        d.setMonth(d.getMonth() + delta);
        this.DisplayDate = d;
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'SelectedDate' && this.SelectedDates) {
            const old = e.OldValue;
            this.SelectedDates.ReplaceAll(e.NewValue ? [e.NewValue] : []);
            this.SelectedDatesChanged.Raise(this, { AddedItems: e.NewValue ? [e.NewValue] : [], RemovedItems: old ? [old] : [] });
        }
    }
    MeasureOverride() {
        return new Size(300, 302);
    }
    Render(ctx) {
        const w = this.Bounds.Width, h = this.Bounds.Height, p = this.Palette;
        ctx.DrawRectangle(this.Background ?? p.Surface, new Pen(p.Border, 1), new Rect(w > 0 ? this.Bounds.Size : new Size(300, 302)).Deflate(.5), 7);
        this.DrawText(ctx, this.DisplayDate.toLocaleDateString(this.Culture ?? undefined, { month: 'long', year: 'numeric' }), new Rect(44, 0, w - 88, 48), { FontSize: 15, TextAlignment: 'Center' });
        this.DrawText(ctx, '‹', new Rect(8, 0, 36, 48), { FontSize: 24, TextAlignment: 'Center' });
        this.DrawText(ctx, '›', new Rect(w - 44, 0, 36, 48), { FontSize: 24, TextAlignment: 'Center' });
        const cw = (w - 16) / 7, ch = (h - 82) / 6;
        for (let i = 0; i < 7; i++)
            this.DrawText(ctx, new Date(2024, 0, 7 + (i + this.FirstDayOfWeek) % 7).toLocaleDateString(this.Culture ?? undefined, { weekday: 'short' }), new Rect(8 + i * cw, 48, cw, 26), { FontSize: 11, Foreground: p.Muted, TextAlignment: 'Center' });
        const today = new Date();
        for (const [i, d] of this._Days().entries()) {
            const r = new Rect(8 + i % 7 * cw, 76 + Math.floor(i / 7) * ch, cw, ch);
            const selected = sameDay(d, this.SelectedDate);
            if (selected || sameDay(d, today))
                ctx.DrawRectangle(selected ? p.Accent : null, sameDay(d, today) ? new Pen(p.Accent, 1) : null, r.Deflate(2), 4);
            this.DrawText(ctx, d.getDate(), r, { TextAlignment: 'Center', Foreground: selected ? p.AccentText : !this._Allowed(d) || d.getMonth() !== this.DisplayDate.getMonth() ? p.Muted : this.Foreground });
        }
    }
    OnPointerPressed(e) {
        this.Focus('Pointer');
        const p = e.GetPosition(this), w = this.Bounds.Width;
        if (p.Y < 48) {
            if (p.X < 44)
                this.MoveMonth(-1);
            if (p.X > w - 44)
                this.MoveMonth(1);
        }
        else if (p.Y >= 76) {
            const index = Math.floor((p.Y - 76) / ((this.Bounds.Height - 82) / 6)) * 7 + Math.floor((p.X - 8) / ((w - 16) / 7));
            if (index >= 0 && index < 42)
                this.SelectDate(this._Days()[index]);
        }
        e.Handled = true;
    }
    OnKeyDown(e) {
        if (e.Key === 'PageUp' || e.Key === 'PageDown')
            this.MoveMonth(e.Key === 'PageUp' ? -1 : 1);
        else {
            const delta = { Left: -1, Right: 1, Up: -7, Down: 7 }[e.Key];
            if (delta === undefined)
                return;
            const date = dateOnly(this.SelectedDate ?? this.DisplayDate);
            date.setDate(date.getDate() + delta);
            if (this.SelectDate(date))
                this.DisplayDate = date;
        }
        e.Handled = true;
    }
}
DefineProperties(Calendar, { DisplayDate: [null, { Convert: v => dateOnly(v) ?? new Date(), AffectsRender: true }], SelectedDate: [null, { Convert: dateOnly, DefaultBindingMode: BindingMode.TwoWay }], DisplayDateStart: [null, { Convert: dateOnly }], DisplayDateEnd: [null, { Convert: dateOnly }], FirstDayOfWeek: [1, { Convert: Number }], SelectionMode: ['SingleDate'], Culture: [undefined], BlackoutDates: [null] });
export class CalendarDatePicker extends Button {
    constructor() {
        super();
        this.MinWidth = 220;
        this.SelectedDateChanged = new Event();
        this._UpdateText();
        this._lifetime.Add(this.Click.Add(() => this.OpenCalendar()));
    }
    _UpdateText() {
        this.Content = this.SelectedDate ? this.SelectedDate.toLocaleDateString(this.Culture ?? undefined) : this.Watermark;
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (['SelectedDate', 'Watermark'].includes(e.Property.Name))
            this._UpdateText();
        if (e.Property.Name === 'SelectedDate')
            this.SelectedDateChanged?.Raise(this, { OldValue: e.OldValue, NewValue: e.NewValue });
    }
    OpenCalendar() {
        const calendar = new Calendar();
        calendar.SelectedDate = this.SelectedDate;
        calendar.DisplayDate = this.SelectedDate ?? new Date();
        const root = this.GetVisualRoot();
        this._datePopup?.Dispose();
        this._datePopup = root.ShowPopup(calendar, this, { OnClosed: () => {
                this.IsDropDownOpen = false;
                calendar.Dispose();
                this._datePopup = null;
            } });
        this.IsDropDownOpen = true;
        calendar.SelectedDatesChanged.Add(() => {
            this.SetCurrentValue(CalendarDatePicker.SelectedDateProperty, calendar.SelectedDate);
            this._datePopup?.Dispose();
        });
    }
    Dispose() {
        this._datePopup?.Dispose();
        super.Dispose();
    }
}
DefineProperties(CalendarDatePicker, { SelectedDate: [null, { Convert: dateOnly, DefaultBindingMode: BindingMode.TwoWay }], Watermark: ['Select a date'], IsDropDownOpen: [false, { Convert: BooleanValue }], Culture: [undefined] });
export class DatePicker extends CalendarDatePicker {
    get DayVisible() {
        return true;
    }
}
export class TimePicker extends Control {
    constructor() {
        super();
        this.Focusable = true;
        this.SelectedTimeChanged = new Event();
        this._segment = 0;
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'SelectedTime')
            this.SelectedTimeChanged?.Raise(this, { OldValue: e.OldValue, NewValue: e.NewValue });
    }
    MeasureOverride() {
        return new Size(180, 38);
    }
    _Change(direction) {
        const v = this.SelectedTime ?? 0, step = this._segment === 0 ? 3600000 : 60000 * this.MinuteIncrement;
        this.SetCurrentValue(TimePicker.SelectedTimeProperty, (v + direction * step + 86400000) % 86400000);
    }
    Render(ctx) {
        const p = this.Palette, w = this.Bounds.Width, h = this.Bounds.Height;
        ctx.DrawRectangle(p.Surface, new Pen(this.IsFocused ? p.Accent : p.Border, 1), new Rect(this.Bounds.Size).Deflate(.5), 5);
        const minutes = Math.floor((this.SelectedTime ?? 0) / 60000), hour = Math.floor(minutes / 60);
        this.DrawText(ctx, `${String(hour).padStart(2, '0')}  :  ${String(minutes % 60).padStart(2, '0')}`, new Rect(8, 0, w - 40, h), { FontSize: 16, TextAlignment: 'Center' });
        this.DrawText(ctx, '+', new Rect(w - 30, 0, 28, h / 2), { TextAlignment: 'Center' });
        this.DrawText(ctx, '−', new Rect(w - 30, h / 2, 28, h / 2), { TextAlignment: 'Center' });
    }
    OnPointerPressed(e) {
        this.Focus('Pointer');
        const p = e.GetPosition(this);
        if (p.X > this.Bounds.Width - 30)
            this._Change(p.Y < this.Bounds.Height / 2 ? 1 : -1);
        else
            this._segment = p.X < (this.Bounds.Width - 30) / 2 ? 0 : 1;
        this.InvalidateVisual();
        e.Handled = true;
    }
    OnKeyDown(e) {
        if (e.Key === 'Left' || e.Key === 'Right')
            this._segment = e.Key === 'Left' ? 0 : 1;
        else if (e.Key === 'Up' || e.Key === 'Down')
            this._Change(e.Key === 'Up' ? 1 : -1);
        else
            return;
        e.Handled = true;
    }
}
DefineProperties(TimePicker, { SelectedTime: [null, { Convert: v => v == null ? null : MathUtilities.Clamp(Number(v), 0, 86399999), DefaultBindingMode: BindingMode.TwoWay }], MinuteIncrement: [1, { Convert: v => MathUtilities.Clamp(Math.round(Number(v)), 1, 59) }], ClockIdentifier: ['24HourClock'] });
export class ColorSpectrum extends Control {
    constructor() {
        super();
        this.Focusable = true;
        this.ColorChanged = new Event();
    }
    MeasureOverride() {
        return new Size(280, 180);
    }
    _Pick(point) {
        const w = Math.max(1, this.Bounds.Width), h = Math.max(1, this.Bounds.Height);
        const hue = MathUtilities.Clamp(point.X / w, 0, 1) * 360, value = 1 - MathUtilities.Clamp(point.Y / h, 0, 1);
        this.SetCurrentValue(ColorSpectrum.ColorProperty, Color.FromHsv(hue, .75, value));
    }
    OnPointerPressed(e) {
        this.Focus('Pointer');
        e.Pointer.Capture(this);
        this._Pick(e.GetPosition(this));
        e.Handled = true;
    }
    OnPointerMoved(e) {
        if (e.Pointer.Captured === this) {
            this._Pick(e.GetPosition(this));
            e.Handled = true;
        }
    }
    OnPointerReleased(e) {
        if (e.Pointer.Captured === this)
            e.Pointer.Capture(null);
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'Color')
            this.ColorChanged?.Raise(this, { OldColor: e.OldValue, NewColor: e.NewValue });
    }
    Render(ctx) {
        const steps = 48, rows = 24, cw = this.Bounds.Width / steps, ch = this.Bounds.Height / rows;
        for (let y = 0; y < rows; y++)
            for (let x = 0; x < steps; x++)
                ctx.DrawRectangle(new SolidColorBrush(Color.FromHsv(x / (steps - 1) * 360, .75, 1 - y / (rows - 1))), null, new Rect(x * cw, y * ch, cw + .25, ch + .25));
        const hsv = this.Color.ToHsv();
        const x = hsv.H / 360 * this.Bounds.Width, y = (1 - hsv.V) * this.Bounds.Height;
        ctx.DrawEllipse(null, new Pen('#FFFFFF', 2), new Rect(x - 6, y - 6, 12, 12));
    }
}
DefineProperties(ColorSpectrum, { Color: [Color.Parse('#6757D9'), { Convert: Color.Parse, DefaultBindingMode: BindingMode.TwoWay }] });
export class ColorView extends Control {
    constructor() {
        super();
        this._spectrum = new ColorSpectrum();
        this._editor = new TextBox();
        this._editor.Margin = new Thickness(0, 10, 0, 0);
        this.AddVisualChild(this._spectrum);
        this.AddVisualChild(this._editor);
        this._sync = false;
        this._lifetime.Add(this._spectrum.ColorChanged.Add((_, e) => {
            if (!this._sync)
                this.SetCurrentValue(ColorView.ColorProperty, e.NewColor);
        }));
        this._lifetime.Add(this._editor.TextChanged.Add(() => {
            if (!this._sync) {
                try {
                    this.SetCurrentValue(ColorView.ColorProperty, Color.Parse(this._editor.Text));
                }
                catch { /* Partial color strings remain editable until valid. */
                }
            }
        }));
        this.Color = Color.Parse('#6757D9');
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'Color' && this._spectrum) {
            this._sync = true;
            try {
                this._spectrum.Color = e.NewValue;
                this._editor.Text = e.NewValue.ToString();
            }
            finally {
                this._sync = false;
            }
        }
    }
    MeasureOverride(size) {
        this._spectrum.Measure(new Size(size.Width, 180));
        this._editor.Measure(new Size(size.Width, 44));
        return new Size(Math.max(280, this._editor.DesiredSize.Width), 234);
    }
    ArrangeOverride(size) {
        this._spectrum.Arrange(new Rect(0, 0, size.Width, Math.max(0, size.Height - 44)));
        this._editor.Arrange(new Rect(0, size.Height - 44, size.Width, 44));
        return size;
    }
}
DefineProperties(ColorView, { Color: [Color.Parse('#000000'), { Convert: Color.Parse, DefaultBindingMode: BindingMode.TwoWay }] });
export class ColorPicker extends Button {
    constructor() {
        super();
        this.Content = 'Choose color';
        this._lifetime.Add(this.Click.Add(() => {
            const view = new ColorView();
            view.Color = this.Color;
            view.Width = 280;
            view.Height = 234;
            this._colorPopup?.Dispose();
            this._colorPopup = this.GetVisualRoot().ShowPopup(view, this, { OnClosed: () => {
                    view.Dispose();
                    this._colorPopup = null;
                } });
            view.GetObservable(ColorView.ColorProperty).subscribe(color => this.SetCurrentValue(ColorPicker.ColorProperty, color));
        }));
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'Color')
            this.Background = new SolidColorBrush(e.NewValue);
    }
    Dispose() {
        this._colorPopup?.Dispose();
        super.Dispose();
    }
}
DefineProperties(ColorPicker, { Color: [Color.Parse('#6757D9'), { Convert: Color.Parse, DefaultBindingMode: BindingMode.TwoWay }] });
export class SplitView extends ContentControl {
    constructor() {
        super();
        this._paneChild = null;
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'Pane') {
            if (this._paneChild)
                this.RemoveVisualChild(this._paneChild);
            this._paneChild = e.NewValue instanceof Control ? e.NewValue : e.NewValue == null ? null : new TextBlock(String(e.NewValue));
            if (this._paneChild)
                this.AddVisualChild(this._paneChild);
        }
    }
    _PaneWidth() {
        return this.IsPaneOpen ? this.OpenPaneLength : String(this.DisplayMode).startsWith('Compact') ? this.CompactPaneLength : 0;
    }
    MeasureOverride(size) {
        const pane = this._PaneWidth(), overlay = String(this.DisplayMode).includes('Overlay');
        this._paneChild?.Measure(new Size(pane, size.Height));
        this._contentChild?.Measure(new Size(Math.max(0, size.Width - (overlay ? 0 : pane)), size.Height));
        return new Size(Math.min(size.Width, (this._contentChild?.DesiredSize.Width ?? 0) + (overlay ? 0 : pane)), Math.max(this._contentChild?.DesiredSize.Height ?? 0, this._paneChild?.DesiredSize.Height ?? 0));
    }
    ArrangeOverride(size) {
        const width = Math.min(size.Width, this._PaneWidth()), overlay = String(this.DisplayMode).includes('Overlay'), right = this.PanePlacement === 'Right';
        if (this._paneChild) {
            this._paneChild.IsVisible = width > 0;
            this._paneChild.ZIndex = overlay ? 1 : 0;
            this._paneChild.Arrange(new Rect(right ? size.Width - width : 0, 0, width, size.Height));
        }
        this._contentChild?.Arrange(new Rect(!right && !overlay ? width : 0, 0, size.Width - (overlay ? 0 : width), size.Height));
        return size;
    }
}
DefineProperties(SplitView, { Pane: [null, { AffectsMeasure: true }], IsPaneOpen: [true, { Convert: BooleanValue, AffectsMeasure: true, DefaultBindingMode: BindingMode.TwoWay }], OpenPaneLength: [240, { Convert: Number, AffectsMeasure: true }], CompactPaneLength: [48, { Convert: Number, AffectsMeasure: true }], DisplayMode: ['Inline', { AffectsMeasure: true }], PanePlacement: ['Left', { AffectsMeasure: true }] });
export class Page extends ContentControl {
    constructor(content = null) {
        super(content);
        this.Appearing = new Event();
        this.Disappearing = new Event();
    }
}
DefineProperties(Page, { Title: [''], Icon: [null] });
export class ContentPage extends Page {
}
export class NavigationPage extends Page {
    constructor(page = null) {
        super();
        this._stack = [];
        this.Navigated = new Event();
        if (page)
            this.PushAsync(page);
    }
    get NavigationStack() {
        return this._stack.slice();
    }
    get CanGoBack() {
        return this._stack.length > 1;
    }
    get CurrentPage() {
        return this._stack.at(-1) ?? null;
    }
    _Navigate(page, mode) {
        if (!(page instanceof Control))
            throw new TypeError('Navigation requires a Control or Page.');
        this.CurrentPage?.Disappearing?.Raise(this.CurrentPage, {});
        this.Content = null;
        if (mode === 'Push')
            this._stack.push(page);
        else if (mode === 'Replace') {
            if (this._stack.length)
                this._stack.pop();
            this._stack.push(page);
        }
        this.Content = page;
        page.Appearing?.Raise(page, {});
        this.Navigated.Raise(this, { Page: page, NavigationType: mode });
        return page;
    }
    async PushAsync(page) {
        return this._Navigate(page, 'Push');
    }
    async ReplaceAsync(page) {
        return this._Navigate(page, 'Replace');
    }
    async PopAsync() {
        if (!this.CanGoBack)
            return null;
        const page = this._stack.pop();
        page.Disappearing?.Raise(page, {});
        this.Content = null;
        this.Content = this.CurrentPage;
        this.CurrentPage?.Appearing?.Raise(this.CurrentPage, {});
        this.Navigated.Raise(this, { Page: this.CurrentPage, NavigationType: 'Pop' });
        return page;
    }
    async PopToRootAsync() {
        while (this.CanGoBack)
            await this.PopAsync();
    }
}
export class DrawerPage extends SplitView {
    get Drawer() {
        return this.Pane;
    }
    set Drawer(value) {
        this.Pane = value;
    }
    get IsOpen() {
        return this.IsPaneOpen;
    }
    set IsOpen(value) {
        this.IsPaneOpen = value;
    }
    get DrawerLength() {
        return this.OpenPaneLength;
    }
    set DrawerLength(value) {
        this.OpenPaneLength = value;
    }
    get CompactDrawerLength() {
        return this.CompactPaneLength;
    }
    set CompactDrawerLength(value) {
        this.CompactPaneLength = value;
    }
}
export class TabbedPage extends TabControl {
}
export class CarouselPage extends Carousel {
}
export class RefreshContainer extends Decorator {
    constructor() {
        super();
        this.RefreshRequested = new Event();
        this._refreshing = false;
    }
    get IsRefreshing() {
        return this._refreshing;
    }
    async RequestRefresh() {
        if (this._refreshing)
            return;
        this._refreshing = true;
        this.InvalidateVisual();
        const work = [];
        this.RefreshRequested.Raise(this, { GetDeferral: () => {
                let resolve;
                const promise = new Promise(r => {
                    resolve = r;
                });
                work.push(promise);
                return { Complete: resolve };
            }, AddTask: promise => work.push(Promise.resolve(promise)) });
        try {
            await Promise.all(work);
        }
        finally {
            this._refreshing = false;
            this.InvalidateVisual();
        }
    }
    OnPointerPressed(e) {
        if (e.Pointer.Type === 'Touch')
            this._pullStart = e.GetPosition(this);
    }
    OnPointerReleased(e) {
        if (this._pullStart && e.GetPosition(this).Y - this._pullStart.Y > 90)
            this.RequestRefresh();
        this._pullStart = null;
    }
    Render(ctx) {
        super.Render(ctx);
        if (this.IsRefreshing)
            this.DrawText(ctx, 'Refreshing…', new Rect(0, 0, this.Bounds.Width, 30), { Foreground: this.Palette.Accent, TextAlignment: 'Center' });
    }
}
export class GridSplitter extends Control {
    constructor() {
        super();
        this.Focusable = true;
        this.MinWidth = 5;
        this.MinHeight = 5;
        this.Cursor = 'col-resize';
    }
    _Definitions() {
        const grid = this.VisualParent;
        if (!(grid instanceof Grid))
            return null;
        const rows = this.ResizeDirection === 'Rows' || this.ResizeDirection === 'Auto' && this.Bounds.Width > this.Bounds.Height;
        const index = rows ? Grid.GetRow(this) : Grid.GetColumn(this);
        const defs = rows ? grid.RowDefinitions : grid.ColumnDefinitions;
        const prev = Math.max(0, index - 1), next = Math.min(defs.Count - 1, index + 1);
        if (prev === next)
            return null;
        return { Grid: grid, Rows: rows, First: defs.Get(prev), Second: defs.Get(next) };
    }
    _Resize(delta, info = this._drag) {
        if (!info)
            return;
        const total = info.A + info.B, a = MathUtilities.Clamp(info.A + delta, Math.max(info.First.MinWidth ?? info.First.MinHeight ?? 0, total - (info.Second.MaxWidth ?? info.Second.MaxHeight ?? Infinity)), Math.min(info.First.MaxWidth ?? info.First.MaxHeight ?? Infinity, total - (info.Second.MinWidth ?? info.Second.MinHeight ?? 0)));
        const key = info.Rows ? 'Height' : 'Width';
        info.First[key] = new GridLength(a);
        info.Second[key] = new GridLength(total - a);
        info.Grid.InvalidateMeasure();
    }
    _Start() {
        const d = this._Definitions();
        if (!d)
            return null;
        return { ...d, A: d.Rows ? d.First.ActualHeight : d.First.ActualWidth, B: d.Rows ? d.Second.ActualHeight : d.Second.ActualWidth };
    }
    OnPointerPressed(e) {
        const info = this._Start();
        if (!info)
            return;
        this.Focus('Pointer');
        this._drag = { ...info, Point: e.GetPosition(info.Grid) };
        e.Pointer.Capture(this);
        e.Handled = true;
    }
    OnPointerMoved(e) {
        if (this._drag && e.Pointer.Captured === this) {
            const p = e.GetPosition(this._drag.Grid);
            this._Resize(this._drag.Rows ? p.Y - this._drag.Point.Y : p.X - this._drag.Point.X);
            e.Handled = true;
        }
    }
    OnPointerReleased(e) {
        if (e.Pointer.Captured === this) {
            e.Pointer.Capture(null);
            this._drag = null;
        }
    }
    OnKeyDown(e) {
        if (['Left', 'Right', 'Up', 'Down'].includes(e.Key)) {
            this._Resize((['Left', 'Up'].includes(e.Key) ? -1 : 1) * this.KeyboardIncrement, this._Start());
            e.Handled = true;
        }
    }
    Render(ctx) {
        ctx.DrawRectangle(this.IsPointerOver || this.IsFocused ? this.Palette.Accent : this.Palette.Border, null, new Rect(this.Bounds.Size));
    }
}
DefineProperties(GridSplitter, { ResizeDirection: ['Auto'], KeyboardIncrement: [10, { Convert: Number }], ShowsPreview: [false, { Convert: BooleanValue }] });
export class AdornerLayer extends Control {
    constructor() {
        super();
        this.Children = new AvaloniaList();
        this._lifetime.Add(this.Children.CollectionChanged.Add(() => {
            for (const c of [...this.VisualChildren])
                if (!this.Children.Contains(c))
                    this.RemoveVisualChild(c);
            for (const c of this.Children)
                if (!c.VisualParent)
                    this.AddVisualChild(c);
            this.InvalidateMeasure();
        }));
    }
    MeasureOverride(size) {
        for (const c of this.Children)
            c.Measure(size);
        return size;
    }
    ArrangeOverride(size) {
        for (const c of this.Children) {
            const target = AdornerLayer.GetAdornedElement(c), m = target?.TransformToVisual(this);
            const r = m ? new Rect(target.Bounds.Size).TransformToAABB(m) : new Rect(size);
            c.Arrange(r);
        }
        return size;
    }
    static GetAdornerLayer(control) {
        const root = control.GetVisualRoot();
        return root?._adornerLayer ?? null;
    }
}
DefineAttached(AdornerLayer, 'AdornedElement', null);
export class Notification {
    constructor(title, message = '', type = 'Information', expiration = 5000, onClick = null, onClose = null) {
        this.Title = title;
        this.Message = message;
        this.Type = type;
        this.Expiration = expiration;
        this.OnClick = onClick;
        this.OnClose = onClose;
    }
}
export class WindowNotificationManager {
    constructor(host) {
        this.Host = host;
        this.MaxItems = 3;
        this.Position = 'TopRight';
        this._items = [];
    }
    Show(notification) {
        if (!(notification instanceof Notification))
            notification = new Notification(String(notification));
        while (this._items.length >= this.MaxItems)
            this._items[0].Close();
        const root = this.Host.GetVisualRoot?.() ?? this.Host, panel = new StackPanel();
        panel.Width = 320;
        panel.Spacing = 6;
        const title = new TextBlock(notification.Title);
        title.FontWeight = 'SemiBold';
        panel.Children.Add(title);
        const body = new TextBlock(notification.Message);
        body.TextWrapping = 'Wrap';
        panel.Children.Add(body);
        const b = new Border(panel);
        b.Padding = new Thickness(16);
        b.CornerRadius = new CornerRadius(8);
        b.Background = root.Palette.Surface;
        b.BorderBrush = root.Palette.Accent;
        b.BorderThickness = new Thickness(1);
        const handle = root.ShowPopup(b, null, { Point: new Point(Math.max(8, root.Bounds.Width - 364), 20 + this._items.length * 110), LightDismiss: false });
        let timer;
        const entry = { Close: () => {
                if (!this._items.includes(entry))
                    return;
                clearTimeout(timer);
                handle.Dispose();
                b.Dispose();
                this._items.splice(this._items.indexOf(entry), 1);
                notification.OnClose?.();
            } };
        this._items.push(entry);
        b.PointerPressed.Add(() => {
            notification.OnClick?.();
            entry.Close();
        });
        if (notification.Expiration > 0)
            timer = setTimeout(entry.Close, notification.Expiration);
        return new Disposable(entry.Close);
    }
    Dispose() {
        for (const item of [...this._items])
            item.Close();
    }
}
