import { ScrollChrome } from './scroll-bar.js';
import { ScrollGestureRecognizer } from './gestures.js';
import { AvaloniaList, DefineProperties, Event, Disposable, CompositeDisposable, Size, Rect, Point, Thickness, BindingMode, MathUtilities, UnsetValue } from "../../base/src/index.js";
import { SelectionModel, Binding, PropertyPath, ReadMember } from "../../data/src/index.js";
import { Pen } from "../../media/src/index.js";
import { Control, BooleanValue, DefineRoutedEvent, RoutedEventArgs } from './core.js';
import { ContentControl, ContentPresenter, TextBlock, Border, ScrollViewer } from './content.js';
import { StackPanel } from './layout.js';
import { Button, TextBox, ToggleButton } from './input-controls.js';
export class ItemsControl extends Control {
    constructor() {
        super();
        this.Items = new AvaloniaList();
        this._items = [];
        this._containers = [];
        this._itemsSubscription = null;
        this._panel = new StackPanel();
        this.AddVisualChild(this._panel);
        this._lifetime.Add(this.Items.CollectionChanged.Add(() => {
            if (!this.ItemsSource)
                this._RebuildItems();
        }));
    }
    get ItemCount() {
        return this._items.length;
    }
    get ItemsView() {
        return this._items;
    }
    _ReadItems() {
        const source = this.ItemsSource ?? this.Items;
        if (typeof source === 'string' || !source?.[Symbol.iterator])
            throw new TypeError('ItemsSource must be an iterable collection, not a string.');
        return Array.from(source);
    }
    _BindItemsSource() {
        this._itemsSubscription?.Dispose?.();
        this._itemsSubscription?.unsubscribe?.();
        const source = this.ItemsSource;
        this._itemsSubscription = source?.CollectionChanged?.Add?.(() => this._RebuildItems()) ?? source?.CollectionChanged?.subscribe?.(() => this._RebuildItems());
        this._RebuildItems();
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'ItemsSource')
            this._BindItemsSource();
        if (['ItemTemplate', 'DisplayMemberBinding'].includes(e.Property.Name))
            this._RebuildItems();
    }
    CreateContainerForItemOverride() {
        return new ContentPresenter();
    }
    PrepareContainerForItemOverride(container, item, index) {
        container.ItemIndex = index;
        container.DataContext = item;
        container.ContentTemplate = this.ItemTemplate;
        container.Content = item;
        container.Theme = this.ItemContainerTheme;
        if (this.DisplayMemberBinding && !this.ItemTemplate) {
            const path = this.DisplayMemberBinding.Path ?? this.DisplayMemberBinding;
            const text = new TextBlock();
            text.Bind(TextBlock.TextProperty, new Binding({ Path: path, Source: item }));
            container.Content = text;
            container._itemPresentationOwned = text;
        }
    }
    _RebuildItems() {
        this._items = this._ReadItems();
        if (!this._panel)
            return;
        for (const c of this._containers) {
            this._panel.Children.Remove(c);
            if (this._items.includes(c))
                continue;
            if (c.Content instanceof Control && this._items.includes(c.Content))
                c.Content = null;
            c.Dispose();
        }
        this._containers = this._items.map((item, i) => {
            const c = this.CreateContainerForItemOverride(item, i);
            this.PrepareContainerForItemOverride(c, item, i);
            return c;
        });
        this._panel.Children.AddRange(this._containers);
        this.InvalidateMeasure();
    }
    ContainerFromIndex(index) {
        return this._containers[index] ?? null;
    }
    ContainerFromItem(item) {
        return this.ContainerFromIndex(this._items.indexOf(item));
    }
    IndexFromContainer(container) {
        return container.ItemIndex ?? -1;
    }
    GetRealizedContainers() {
        return this._containers.slice();
    }
    MeasureOverride(available) {
        this._panel.Measure(available);
        return this._panel.DesiredSize;
    }
    ArrangeOverride(size) {
        this._panel.Arrange(new Rect(size));
        return size;
    }
    Dispose() {
        this._itemsSubscription?.Dispose?.();
        this._itemsSubscription?.unsubscribe?.();
        super.Dispose();
    }
}
DefineProperties(ItemsControl, { ItemsSource: [null, { AffectsMeasure: true }], ItemTemplate: [null, { AffectsMeasure: true }], DisplayMemberBinding: [null, { AffectsMeasure: true }], ItemContainerTheme: [null, { AffectsMeasure: true }] });
export class SelectingItemsControl extends ItemsControl {
    constructor() {
        super();
        this.Selection = new SelectionModel();
        this.SelectionChanged = new Event();
        this._lifetime.Add(this.Selection.SelectionChanged.Add((_, e) => {
            this._selectionUpdating = true;
            try {
                this.SetCurrentValue(SelectingItemsControl.SelectedIndexProperty, this.Selection.SelectedIndex);
                this.SetCurrentValue(SelectingItemsControl.SelectedItemProperty, this.Selection.SelectedItem);
            }
            finally {
                this._selectionUpdating = false;
            }
            this._UpdateContainerSelection();
            this.SelectionChanged.Raise(this, { AddedItems: e.SelectedItems, RemovedItems: e.DeselectedItems, ...e });
            this.InvalidateVisual();
        }));
    }
    _RebuildItems() {
        super._RebuildItems();
        if (this.Selection) {
            const index = this.SelectedIndex;
            this.Selection.Source = this._items;
            if (this.Selection.SelectedIndex < 0 && index >= 0 && index < this._items.length)
                this.Selection.SelectedIndex = index;
            this._UpdateContainerSelection();
        }
    }
    _UpdateContainerSelection() {
        for (const c of this.GetRealizedContainers())
            if ('IsSelected' in c)
                c.IsSelected = this.Selection.IsSelected(c.ItemIndex);
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (!this.Selection || this._selectionUpdating)
            return;
        if (e.Property.Name === 'SelectedIndex')
            this.Selection.SelectedIndex = e.NewValue;
        if (e.Property.Name === 'SelectedItem')
            this.Selection.SelectedItem = e.NewValue;
        if (e.Property.Name === 'SelectionMode')
            this.Selection.SingleSelect = !String(e.NewValue).includes('Multiple') && !String(e.NewValue).includes('Extended');
    }
    Dispose() {
        this.Selection.Dispose();
        super.Dispose();
    }
}
DefineProperties(SelectingItemsControl, { SelectedIndex: [-1, { Convert: Number, DefaultBindingMode: BindingMode.TwoWay }], SelectedItem: [null, { DefaultBindingMode: BindingMode.TwoWay }], SelectionMode: ['Single'] });
export class ListBoxItem extends ContentControl {
    constructor() {
        super();
        this.Padding = new Thickness(12, 6);
        this.VerticalContentAlignment = 'Center';
        this.ClipToBounds = true;
    }
    OnPropertyChanged(e) {
        super.OnPropertyChanged(e);
        if (e.Property.Name === 'IsSelected')
            this.PseudoClasses.Set(':selected', e.NewValue);
    }
    Render(ctx) {
        if (this.IsSelected || this.IsPointerOver || this.Background)
            ctx.DrawRectangle(this.Background ?? (this.IsSelected ? this.Palette.Selection : this.Palette.Hover), null, new Rect(this.Bounds.Size).Deflate(2), 4);
        if (this.IsSelected)
            ctx.DrawRectangle(this.Palette.Accent, null, new Rect(2, 8, 3, Math.max(0, this.Bounds.Height - 16)), 1.5);
    }
}
DefineProperties(ListBoxItem, { IsSelected: [false, { Convert: BooleanValue, DefaultBindingMode: BindingMode.TwoWay }] });
export class ListBox extends SelectingItemsControl {
    constructor() {
        super();
        this.RemoveVisualChild(this._panel);
        this._panel.Dispose();
        this._panel = null;
        this._realized = new Map();
        this._offset = 0;
        this.Focusable = true;
        this.ClipToBounds = true;
        this.MinWidth = 120;
        this._recyclePool = []; this._listExtentWidth = 0; this._scrollViewport = Size.Empty;
        this._chrome = new ScrollChrome(this, offset => { this._SetHorizontalOffset(offset.X); this._SetOffset(offset.Y); });
        this._touchScroll = new ScrollGestureRecognizer(); this._touchScroll.IsScrollInertiaEnabled = true;
        this.GestureRecognizers.Add(this._touchScroll);
        this._lifetime.Add(this.ScrollGesture.Add((_, e) => {
            const x = this._SetHorizontalOffset(this.HorizontalOffset + e.Delta.X), y = this._SetOffset(this._offset + e.Delta.Y);
            if (x || y) e.Handled = true;
            else if (this._touchScroll._gestureId === e.Id) e.ShouldEndScrollGesture = true;
        }));
    }
    get SelectedItems() {
        return this.Selection.SelectedItems;
    }
    _ClearContainer(container) {
        if (container._itemPresentationOwned) { container.Content = null; container._itemPresentationOwned.Dispose(); container._itemPresentationOwned = null; }
        if (container._contentIsText && !container.ContentTemplate) container.Content = '';
        else { container.ContentTemplate = null; container.Content = null; }
        container.DataContext = null; container.ItemIndex = -1; container.IsSelected = false;
    }
    _RebuildItems() {
        this._items = this._ReadItems(); this._listExtentWidth = 0;
        if (this.Selection) {
            const old = this.SelectedIndex; this.Selection.Source = this._items;
            if (this.Selection.SelectedIndex < 0 && old >= 0) this.Selection.SelectedIndex = Math.min(old, this._items.length - 1);
        }
        for (const c of this._realized?.values() ?? []) { this.RemoveVisualChild(c); this._ClearContainer(c); this._recyclePool?.push(c); }
        this._realized?.clear(); this._TrimRecyclePool();
        this._offset = Math.max(0, Math.min(this._offset ?? 0, this._items.length * this.ItemHeight - this._GetScrollViewport().Height));
        this.InvalidateMeasure();
    }
    _TrimRecyclePool() {
        const max = Math.max(4, Math.ceil(this._GetScrollViewport().Height / Math.max(1, this.ItemHeight)) + this.OverscanCount * 2);
        while (this._recyclePool?.length > max) this._recyclePool.pop().Dispose();
    }
    get HorizontalScrollBar() { return this._chrome.Horizontal; }
    get VerticalScrollBar() { return this._chrome.Vertical; }
    get ScrollOffset() { return new Point(this.HorizontalOffset, this._offset); }
    _GetScrollViewport() { return this._scrollViewport?.Height > 0 ? this._scrollViewport : this.Bounds.Size; }
    _GetExtentWidth() { return this._listExtentWidth ?? 0; }
    _ResolveScrollViewport(size, top = 0) {
        let width = size.Width, height = Math.max(0, size.Height - top);
        if (!this.AllowAutoHide) {
            let h = this.HorizontalScrollBarVisibility === 'Visible', v = this.VerticalScrollBarVisibility === 'Visible';
            for (let i = 0; i < 3; ++i) {
                width = Math.max(0, size.Width - (v ? 16 : 0)); height = Math.max(0, size.Height - top - (h ? 16 : 0));
                const nh = this.HorizontalScrollBarVisibility === 'Visible' || this.HorizontalScrollBarVisibility === 'Auto' && this._GetExtentWidth() > width;
                const nv = this.VerticalScrollBarVisibility === 'Visible' || this.VerticalScrollBarVisibility === 'Auto' && this.ItemCount * this.ItemHeight > height;
                if (nh === h && nv === v) break; h = nh; v = nv;
            }
        }
        return new Rect(0, top, width, height);
    }
    _SyncScrollChrome(rect) {
        this._scrollViewport = rect.Size;
        const extent = new Size(Math.max(rect.Width, this._GetExtentWidth()), this.ItemCount * this.ItemHeight);
        this._chrome.Sync(rect, extent, this.ScrollOffset, { Horizontal: this.HorizontalScrollBarVisibility, Vertical: this.VerticalScrollBarVisibility,
            AllowAutoHide: this.AllowAutoHide, Overlay: this.AllowAutoHide, Deferred: this.IsDeferredScrollingEnabled, SmallChange: new Point(16, this.ItemHeight) });
        this._touchScroll.CanHorizontallyScroll = this.HorizontalScrollBarVisibility !== 'Disabled';
        this._touchScroll.CanVerticallyScroll = this.VerticalScrollBarVisibility !== 'Disabled';
        this._touchScroll.Extent = extent; this._touchScroll.Viewport = rect.Size; this._touchScroll.Offset = this.ScrollOffset;
    }
    GetChildClip(child) { return child !== this._chrome?.Horizontal && child !== this._chrome?.Vertical ? new Rect(this._GetScrollViewport()) : null; }
    _SetHorizontalOffset(value) {
        const next = this.HorizontalScrollBarVisibility === 'Disabled' ? 0 : MathUtilities.Clamp(value, 0, Math.max(0, this._GetExtentWidth() - this._GetScrollViewport().Width));
        if (next === this.HorizontalOffset) return false;
        this.SetCurrentValue(this.constructor.HorizontalOffsetProperty, next); this.InvalidateArrange(); this.InvalidateVisual(); return true;
    }
    OnPropertyChanged(change) {
        super.OnPropertyChanged(change);
        if (change.Property.Name === 'HorizontalOffset') this.InvalidateArrange();
    }
    CreateContainerForItemOverride() {
        return new ListBoxItem();
    }
    _Realize(height) {
        const itemHeight = Math.max(1, this.ItemHeight), first = Math.max(0, Math.floor(this._offset / itemHeight) - this.OverscanCount), last = Math.min(this._items.length, Math.ceil((this._offset + height) / itemHeight) + this.OverscanCount);
        const reusable = [];
        let changed = false;
        for (const [index, c] of this._realized) if (index < first || index >= last) {
            this._realized.delete(index); reusable.push(c); changed = true;
        }
        for (let index = first; index < last; index++) if (!this._realized.has(index)) {
            const item = this._items[index], c = reusable.pop() ?? this._recyclePool.pop() ?? this.CreateContainerForItemOverride(item, index);
            const scalar = c._contentIsText && !this.ItemTemplate && !this.DisplayMemberBinding && item != null && !(item instanceof Control) && !c._FindDataTemplate(item);
            if (c.ItemIndex >= 0 && !scalar) this._ClearContainer(c);
            this.PrepareContainerForItemOverride(c, item, index);
            this.GetVisualRoot()?._InvalidateAutomation?.(c, false, true); changed = true;
            c.IsSelected = this.Selection.IsSelected(index); this._realized.set(index,c);
            if (c.VisualParent !== this) this.AddVisualChild(c);
        }
        // Only surplus containers are detached. Retargeting an attached default
        // text row retains its presenter, style and tree subscriptions.
        for (const c of reusable) { this.RemoveVisualChild(c); this._ClearContainer(c); this._recyclePool.push(c); }
        if (changed) this.GetVisualRoot()?._InvalidateAutomation?.(this, true);
    }
    GetRealizedContainers() {
        return this._realized ? [...this._realized.values()] : [];
    }
    ContainerFromIndex(index) {
        return this._realized?.get(index) ?? null;
    }
    MeasureOverride(available) {
        const height = Math.min(Number.isFinite(available.Height) ? available.Height : 280, Math.max(this.ItemHeight, this._items.length * this.ItemHeight));
        // Use the same scrollbar-adjusted viewport in measure and arrange.
        // Alternating full-height and reserved-height row counts can otherwise
        // attach/remove one row forever at an item-height boundary.
        this._Realize(this._ResolveScrollViewport(new Size(available.Width, height)).Height);
        let width = 140;
        for (const c of this.GetRealizedContainers()) {
            c.Measure(new Size(this.HorizontalScrollBarVisibility === 'Disabled' ? available.Width : Infinity, this.ItemHeight));
            width = Math.max(width, c.DesiredSize.Width);
        }
        this._listExtentWidth = Math.max(this._listExtentWidth, width);
        return new Size(Math.min(width, available.Width), height);
    }
    ArrangeOverride(size) {
        const viewport = this._ResolveScrollViewport(size); this._scrollViewport = viewport.Size;
        this._offset = this.VerticalScrollBarVisibility === 'Disabled' ? 0 : Math.max(0, Math.min(this._offset, this._items.length * this.ItemHeight - viewport.Height));
        this._SetHorizontalOffset(this.HorizontalOffset); this._Realize(viewport.Height);
        for (const [index, c] of this._realized) {
            c.Measure(new Size(this.HorizontalScrollBarVisibility === 'Disabled' ? viewport.Width : Infinity, this.ItemHeight));
            this._listExtentWidth = Math.max(this._listExtentWidth, c.DesiredSize.Width);
            c.Arrange(new Rect(-this.HorizontalOffset, index * this.ItemHeight - this._offset, this.HorizontalScrollBarVisibility === 'Disabled' ? viewport.Width : Math.max(viewport.Width, this._listExtentWidth), this.ItemHeight));
        }
        this._TrimRecyclePool(); this._SyncScrollChrome(viewport);
        return size;
    }
    Render(ctx) {
        ctx.DrawRectangle(this.Background ?? this.Palette.Surface, this.BorderThickness.Left > 0 ? new Pen(this.BorderBrush ?? this.Palette.Border, this.BorderThickness.Left) : null, new Rect(this.Bounds.Size), 4);
    }
    RenderAfter(ctx) { super.RenderAfter(ctx); }
    _SetOffset(offset) {
        const next = this.VerticalScrollBarVisibility === 'Disabled' ? 0 : MathUtilities.Clamp(offset, 0, Math.max(0, this._items.length * this.ItemHeight - this._GetScrollViewport().Height));
        if (next === this._offset) return false;
        this._offset = next;
        if (this._chrome) this._chrome.Offset = this.ScrollOffset;
        this.InvalidateArrange(); this.InvalidateVisual(); return true;
    }
    OnPointerWheelChanged(e) {
        const delta = e.GetPixelDelta?.(this._GetScrollViewport(), this.ItemHeight * 2) ?? new Point(-e.Delta.X * 48, -e.Delta.Y * this.ItemHeight * 2);
        let x = delta.X, y = delta.Y;
        if (e.KeyModifiers & 4 && !x) { x = y; y = 0; }
        const movedX = this._SetHorizontalOffset(this.HorizontalOffset + x), movedY = this._SetOffset(this._offset + y);
        if (movedX || movedY || !this.IsScrollChainingEnabled) e.Handled = true;
    }
    _SelectIndex(index, modifiers = 0) {
        if (index < 0 || index >= this._items.length)
            return;
        if (this.Selection.SingleSelect)
            this.Selection.Select(index);
        else if (modifiers & 4)
            this.Selection.SelectRange(this.Selection.AnchorIndex < 0 ? index : this.Selection.AnchorIndex, index);
        else if (modifiers & 10)
            this.Selection.Toggle(index);
        else {
            this.Selection.Clear();
            this.Selection.Select(index);
        }
    }
    OnPointerPressed(e) {
        this.Focus('Pointer');
        this._SelectIndex(Math.floor((e.GetPosition(this).Y + this._offset) / this.ItemHeight), e.KeyModifiers);
        e.Handled = true;
    }
    OnKeyDown(e) {
        let index = this.SelectedIndex;
        if (e.Key === 'Down')
            index++;
        else if (e.Key === 'Up')
            index--;
        else if (e.Key === 'Home')
            index = 0;
        else if (e.Key === 'End')
            index = this.ItemCount - 1;
        else if (e.Key === 'PageDown')
            index += Math.max(1, Math.floor(this._GetScrollViewport().Height / this.ItemHeight));
        else if (e.Key === 'PageUp')
            index -= Math.max(1, Math.floor(this._GetScrollViewport().Height / this.ItemHeight));
        else if ((e.KeyModifiers & 10) && e.Key.toLowerCase() === 'a') {
            this.Selection.SelectAll();
            e.Handled = true;
            return;
        }
        else
            return;
        this._SelectIndex(MathUtilities.Clamp(index, 0, this.ItemCount - 1), e.KeyModifiers);
        this.ScrollIntoView(this.SelectedIndex);
        e.Handled = true;
    }
    ScrollIntoView(indexOrItem) {
        const index = typeof indexOrItem === 'number' ? indexOrItem : this._items.indexOf(indexOrItem);
        if (index < 0)
            return;
        const top = index * this.ItemHeight;
        if (top < this._offset)
            this._SetOffset(top);
        else if (top + this.ItemHeight > this._offset + this._GetScrollViewport().Height)
            this._SetOffset(top + this.ItemHeight - this._GetScrollViewport().Height);
    }
    Dispose() {
        if (this.IsDisposed) return;
        for (const c of this._recyclePool ?? []) c.Dispose();
        if (this._recyclePool) this._recyclePool.length = 0;
        super.Dispose();
    }
    SelectAll() {
        this.Selection.SelectAll();
    }
    UnselectAll() {
        this.Selection.Clear();
    }
}
DefineProperties(ListBox, { ItemHeight: [34, { Convert: Number, Validate: v => Number.isFinite(v) && v > 0, AffectsMeasure: true }], OverscanCount: [2, { Convert: Number, Validate: v => Number.isInteger(v) && v >= 0 && v <= 1000, AffectsMeasure: true }], HorizontalOffset: [0, { Convert: Number, Validate: Number.isFinite, AffectsArrange: true }] });
for (const name of ['HorizontalScrollBarVisibility', 'VerticalScrollBarVisibility', 'AllowAutoHide', 'IsDeferredScrollingEnabled', 'IsScrollChainingEnabled']) {
    const property = ScrollViewer[`${name}Property`].AddOwner(ListBox);
    ListBox[`${name}Property`] = property;
    Object.defineProperty(ListBox.prototype, name, { configurable: true, get() { return this.GetValue(property); }, set(value) { this.SetValue(property, value); } });
}
export class ComboBox extends SelectingItemsControl {
    constructor() {
        super();
        this.RemoveVisualChild(this._panel);
        this._panel.Dispose();
        this._panel = null;
        this.Focusable = true;
        this.MinWidth = 140;
        this.MinHeight = 34;
        this._popup = null;
    }
    _RebuildItems() {
        this._items = this._ReadItems();
        if (this.Selection) {
            const old = this.SelectedIndex;
            this.Selection.Source = this._items;
            if (old >= 0 && this.Selection.SelectedIndex < 0)
                this.Selection.SelectedIndex = Math.min(old, this._items.length - 1);
        }
        this.InvalidateMeasure();
    }
    MeasureOverride() {
        return new Size(180, 34);
    }
    ArrangeOverride(size) {
        return size;
    }
    _Display(item) {
        if (item == null)
            return this.PlaceholderText;
        if (this.DisplayMemberBinding) {
            const path = PropertyPath.Parse(this.DisplayMemberBinding.Path ?? this.DisplayMemberBinding);
            return String(path.reduce((o, s) => ReadMember(o, s), item) ?? '');
        }
        return String(item.Header ?? item.Name ?? item);
    }
    Render(ctx) {
        const p = this.Palette;
        ctx.DrawRectangle(this.Background ?? (this.IsPointerOver ? p.Hover : p.Surface), new Pen(p.Border, 1), new Rect(this.Bounds.Size).Deflate(.5), 4);
        this.DrawText(ctx, this._Display(this.SelectedItem), new Rect(11, 0, Math.max(0, this.Bounds.Width - 40), this.Bounds.Height), { Foreground: this.SelectedIndex < 0 ? p.Muted : this.Foreground });
        const x = this.Bounds.Width - 17, y = this.Bounds.Height / 2;
        ctx.DrawLine(new Pen(this.Foreground, 1.3), new Point(x - 4, y - 2), new Point(x, y + 2));
        ctx.DrawLine(new Pen(this.Foreground, 1.3), new Point(x, y + 2), new Point(x + 4, y - 2));
    }
    OpenDropDown() {
        if (this._popup || !this.IsEffectivelyEnabled)
            return;
        const root = this.GetVisualRoot();
        if (!root?.ShowPopup)
            return;
        const list = new ListBox();
        list.Width = Math.max(180, this.Bounds.Width);
        list.Height = Math.min(this.MaxDropDownHeight, this._items.length * list.ItemHeight + 4);
        list.ItemsSource = this._items;
        list.SelectedIndex = this.SelectedIndex;
        list.ItemTemplate = this.ItemTemplate;
        list.DisplayMemberBinding = this.DisplayMemberBinding;
        this.IsDropDownOpen = true;
        const selection = list.SelectionChanged.Add(() => {
            this.SetCurrentValue(SelectingItemsControl.SelectedIndexProperty, list.SelectedIndex);
            this.CloseDropDown();
        });
        this._popup = root.ShowPopup(list, this, { OnClosed: () => {
                selection.Dispose();
                this._popup = null;
                this.IsDropDownOpen = false;
                list.Dispose();
                this.Focus();
            } });
        list.Focus();
    }
    CloseDropDown() {
        this._popup?.Dispose();
    }
    OnPointerPressed(e) {
        this.Focus('Pointer');
        this._popup ? this.CloseDropDown() : this.OpenDropDown();
        e.Handled = true;
    }
    OnKeyDown(e) {
        if (['Space', 'Enter', 'F4'].includes(e.Key) || e.Key === 'Down' && (e.KeyModifiers & 1)) {
            this.OpenDropDown();
            e.Handled = true;
        }
        else if (['Up', 'Down'].includes(e.Key)) {
            this.SetCurrentValue(SelectingItemsControl.SelectedIndexProperty, MathUtilities.Clamp(this.SelectedIndex + (e.Key === 'Down' ? 1 : -1), 0, this._items.length - 1));
            e.Handled = true;
        }
    }
    Dispose() {
        this.CloseDropDown();
        super.Dispose();
    }
}
DefineProperties(ComboBox, { PlaceholderText: ['Select an item'], MaxDropDownHeight: [280, { Convert: Number }], IsDropDownOpen: [false, { Convert: BooleanValue, DefaultBindingMode: BindingMode.TwoWay }] });
export class AutoCompleteBox extends TextBox {
    constructor() {
        super();
        this._lifetime.Add(this.TextChanged.Add(() => this._Suggestions()));
    }
    _Suggestions() {
        if (this._accepting || !this.IsFocused || this.Text.length < this.MinimumPrefixLength) {
            this._popup?.Dispose();
            return;
        }
        const query = this.Text.toLocaleLowerCase(), items = Array.from(this.ItemsSource ?? []).filter(item => (this.ItemFilter ? this.ItemFilter(this.Text, item) : String(item).toLocaleLowerCase().includes(query))).slice(0, 100);
        this._popup?.Dispose();
        if (!items.length)
            return;
        const root = this.GetVisualRoot();
        if (!root?.ShowPopup)
            return;
        const list = new ListBox();
        list.ItemsSource = items;
        list.Width = Math.max(180, this.Bounds.Width);
        list.Height = Math.min(240, items.length * 34);
        list.SelectionChanged.Add(() => {
            this._accepting = true;
            try {
                this.SelectedItem = list.SelectedItem;
                this.SetCurrentValue(TextBox.TextProperty, String(list.SelectedItem));
                this.CaretIndex = this.SelectionStart = this.SelectionEnd = this.Text.length;
            }
            finally {
                this._accepting = false;
            }
            this._popup?.Dispose();
            this.Focus();
        });
        this._popup = root.ShowPopup(list, this, { OnClosed: () => {
                this._popup = null;
                list.Dispose();
            } });
    }
    Dispose() {
        this._popup?.Dispose();
        super.Dispose();
    }
}
DefineProperties(AutoCompleteBox, { ItemsSource: [null], SelectedItem: [null, { DefaultBindingMode: BindingMode.TwoWay }], MinimumPrefixLength: [1, { Convert: Number }], ItemFilter: [null] });
export class TabItem extends ContentControl {
    constructor(header = '', content = null) {
        super(content);
        this.Header = header;
    }
}
DefineProperties(TabItem, { Header: [''], IsSelected: [false, { Convert: BooleanValue }], HeaderTemplate: [null] });
export class TabControl extends SelectingItemsControl {
    constructor() {
        super();
        this.RemoveVisualChild(this._panel);
        this._panel.Dispose();
        this._panel = null;
        this._headerRects = [];
        this._selectedControl = null;
        this.Focusable = true;
        this._lifetime.Add(this.SelectionChanged.Add(() => this._ShowSelected()));
    }
    _RebuildItems() {
        this._items = this._ReadItems();
        if (this.Selection) {
            const index = this.SelectedIndex;
            this.Selection.Source = this._items;
            this.Selection.SelectedIndex = MathUtilities.Clamp(index < 0 ? 0 : index, 0, this._items.length - 1);
        }
        this._ShowSelected();
        this.InvalidateMeasure();
    }
    _ShowSelected() {
        if (this._selectedControl) {
            this.RemoveVisualChild(this._selectedControl);
            if (this._selectedOwned)
                this._selectedControl.Dispose();
        }
        this._selectedControl = null;
        const item = this._items[this.SelectedIndex];
        if (item != null) {
            this._selectedOwned = !(item instanceof Control);
            this._selectedControl = item instanceof TabItem ? item : item instanceof Control ? item : this.ItemTemplate ? this.ItemTemplate.Build(item) : new TextBlock(String(item));
            if (item instanceof TabItem)
                this._selectedOwned = false;
            this.AddVisualChild(this._selectedControl);
        }
        this.InvalidateMeasure();
    }
    MeasureOverride(available) {
        this._selectedControl?.Measure(new Size(available.Width, Math.max(0, available.Height - this.HeaderHeight)));
        return new Size(Math.max(240, this._selectedControl?.DesiredSize.Width ?? 0), this.HeaderHeight + (this._selectedControl?.DesiredSize.Height ?? 0));
    }
    ArrangeOverride(size) {
        this._selectedControl?.Arrange(new Rect(0, this.HeaderHeight + 8, size.Width, Math.max(0, size.Height - this.HeaderHeight - 8)));
        this._headerRects = this._items.map((item, i) => new Rect(i * Math.min(150, size.Width / Math.max(1, this._items.length)), 0, Math.min(150, size.Width / Math.max(1, this._items.length)), this.HeaderHeight));
        return size;
    }
    Render(ctx) {
        super.Render(ctx);
        this._headerRects.forEach((r, i) => {
            if (i === this.SelectedIndex)
                ctx.DrawRectangle(this.Palette.Surface, null, r, 4);
            this.DrawText(ctx, this._items[i]?.Header ?? this._items[i]?.Name ?? String(this._items[i]), r.Deflate(new Thickness(12, 0)), { TextAlignment: 'Center' });
            if (i === this.SelectedIndex)
                ctx.DrawRectangle(this.Palette.Accent, null, new Rect(r.X + 12, r.Bottom - 3, r.Width - 24, 3), 1.5);
        });
    }
    OnPointerPressed(e) {
        const p = e.GetPosition(this), index = this._headerRects.findIndex(r => r.Contains(p));
        if (index >= 0) {
            this.Focus('Pointer');
            this.SetCurrentValue(SelectingItemsControl.SelectedIndexProperty, index);
            e.Handled = true;
        }
    }
    OnKeyDown(e) {
        if (['Left', 'Right'].includes(e.Key)) {
            this.SetCurrentValue(SelectingItemsControl.SelectedIndexProperty, (this.SelectedIndex + (e.Key === 'Right' ? 1 : this.ItemCount - 1)) % Math.max(1, this.ItemCount));
            e.Handled = true;
        }
    }
}
DefineProperties(TabControl, { HeaderHeight: [42, { Convert: Number, AffectsMeasure: true }], TabStripPlacement: ['Top'] });
export class TabStrip extends TabControl {
    _ShowSelected() {
        this.InvalidateMeasure();
    }
    MeasureOverride() {
        return new Size(240, this.HeaderHeight);
    }
}
export class Carousel extends TabControl {
    constructor() {
        super();
        this.HeaderHeight = 0;
    }
    Render(ctx) {
        Control.prototype.Render.call(this, ctx);
    }
    ArrangeOverride(size) {
        this._selectedControl?.Arrange(new Rect(size));
        return size;
    }
    Next() {
        if (this.ItemCount)
            this.SetCurrentValue(SelectingItemsControl.SelectedIndexProperty, (this.SelectedIndex + 1) % this.ItemCount);
    }
    Previous() {
        if (this.ItemCount)
            this.SetCurrentValue(SelectingItemsControl.SelectedIndexProperty, (this.SelectedIndex + this.ItemCount - 1) % this.ItemCount);
    }
    OnPointerPressed() {
    }
}
export class PipsPager extends Control {
    constructor() {
        super();
        this.Focusable = true;
    }
    MeasureOverride() {
        return new Size(Math.min(this.NumberOfPages, this.MaxVisiblePips) * 24, 32);
    }
    Render(ctx) {
        const n = Math.min(this.NumberOfPages, this.MaxVisiblePips), start = MathUtilities.Clamp(this.SelectedPageIndex - Math.floor(n / 2), 0, Math.max(0, this.NumberOfPages - n));
        this._start = start;
        for (let i = 0; i < n; i++)
            ctx.DrawEllipse(start + i === this.SelectedPageIndex ? this.Palette.Accent : this.Palette.Track, null, new Point(12 + i * 24, this.Bounds.Height / 2), start + i === this.SelectedPageIndex ? 5 : 3.5, start + i === this.SelectedPageIndex ? 5 : 3.5);
    }
    OnPointerPressed(e) {
        this.Focus('Pointer');
        this.SetCurrentValue(PipsPager.SelectedPageIndexProperty, MathUtilities.Clamp((this._start ?? 0) + Math.floor(e.GetPosition(this).X / 24), 0, this.NumberOfPages - 1));
        e.Handled = true;
    }
    OnKeyDown(e) {
        if (['Left', 'Right'].includes(e.Key)) {
            this.SetCurrentValue(PipsPager.SelectedPageIndexProperty, MathUtilities.Clamp(this.SelectedPageIndex + (e.Key === 'Right' ? 1 : -1), 0, this.NumberOfPages - 1));
            e.Handled = true;
        }
    }
}
DefineProperties(PipsPager, { NumberOfPages: [5, { Convert: Number, AffectsMeasure: true }], MaxVisiblePips: [7, { Convert: Number, AffectsMeasure: true }], SelectedPageIndex: [0, { Convert: Number, DefaultBindingMode: BindingMode.TwoWay }] });
export class TreeViewItem extends ListBoxItem {
    constructor() {
        super();
        this.Depth = 0;
        this.HasChildren = false;
    }
    Render(ctx) {
        super.Render(ctx);
        if (this.HasChildren) {
            const x = 10 + this.Depth * 20, y = this.Bounds.Height / 2, p = new Pen(this.Foreground, 1.2);
            if (this.IsExpanded) {
                ctx.DrawLine(p, new Point(x - 3, y - 2), new Point(x, y + 2));
                ctx.DrawLine(p, new Point(x, y + 2), new Point(x + 3, y - 2));
            }
            else {
                ctx.DrawLine(p, new Point(x - 2, y - 3), new Point(x + 2, y));
                ctx.DrawLine(p, new Point(x + 2, y), new Point(x - 2, y + 3));
            }
        }
    }
}
DefineProperties(TreeViewItem, { IsExpanded: [false, { Convert: BooleanValue }], Header: [null] });
export class TreeView extends ListBox {
    constructor() {
        super();
        this._expanded = new Set();
        this._nodes = [];
    }
    _ReadItems() {
        const roots = Array.from(this.ItemsSource ?? this.Items), nodes = [];
        const visiting = new Set();
        const walk = (items, depth) => {
            for (const item of items) {
                if (visiting.has(item))
                    throw new Error('TreeView item hierarchy contains a cycle.');
                const children = Array.from(this.ItemsSelector?.(item) ?? this.ItemTemplate?.ItemsSelector?.(item) ?? item?.Children ?? []);
                nodes.push({ Item: item, Depth: depth, HasChildren: children.length > 0 });
                if (this._expanded?.has(item)) {
                    visiting.add(item);
                    walk(children, depth + 1);
                    visiting.delete(item);
                }
            }
        };
        walk(roots, 0);
        this._nodes = nodes;
        return nodes.map(n => n.Item);
    }
    CreateContainerForItemOverride() {
        return new TreeViewItem();
    }
    PrepareContainerForItemOverride(c, item, index) {
        const n = this._nodes[index];
        c.ItemIndex = index;
        c.DataContext = item;
        c.ContentTemplate = this.ItemTemplate;
        c.Content = this.ItemTemplate ? item : item?.Header ?? item?.Name ?? String(item);
        c.Depth = n.Depth;
        c.HasChildren = n.HasChildren;
        c.IsExpanded = this._expanded.has(item);
        c.Padding = new Thickness(24 + n.Depth * 20, 6, 8, 6);
    }
    OnPointerPressed(e) {
        const point = e.GetPosition(this), index = Math.floor((point.Y + this._offset) / this.ItemHeight), n = this._nodes[index];
        if (n?.HasChildren && new Rect(this._GetScrollViewport()).Contains(point) && point.X + this.HorizontalOffset < 25 + n.Depth * 20) {
            this._expanded.has(n.Item) ? this._expanded.delete(n.Item) : this._expanded.add(n.Item);
            this._RebuildItems();
            e.Handled = true;
        }
        else
            super.OnPointerPressed(e);
    }
    OnKeyDown(e) {
        const n = this._nodes[this.SelectedIndex];
        if (n && (e.Key === 'Right' || e.Key === 'Left')) {
            e.Key === 'Right' ? this._expanded.add(n.Item) : this._expanded.delete(n.Item);
            this._RebuildItems();
            e.Handled = true;
        }
        else
            super.OnKeyDown(e);
    }
    ExpandSubTree(item) {
        const seen = new Set();
        const walk = x => {
            if (seen.has(x))
                return;
            seen.add(x);
            this._expanded.add(x);
            for (const c of this.ItemsSelector?.(x) ?? x.Children ?? [])
                walk(c);
        };
        walk(item);
        this._RebuildItems();
    }
    CollapseSubTree(item) {
        this._expanded.delete(item);
        this._RebuildItems();
    }
}
DefineProperties(TreeView, { ItemsSelector: [null] });
