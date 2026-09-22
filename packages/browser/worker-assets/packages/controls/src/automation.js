import { AvaloniaProperty, Event, CompositeDisposable, Rect, Point } from "../../base/src/index.js";
import { Control, RegisterAutomationPeerFactory } from './core.js';
import { TextBlock, Expander, ScrollViewer } from './content.js';
import { Button, ToggleButton, RadioButton, ToggleSwitch, CheckBox, TextBox, RangeBase, Slider, ProgressBar, NumericUpDown } from './input-controls.js';
import { SelectingItemsControl, ListBox, ListBoxItem, ComboBox, TreeView, TreeViewItem, TabControl, TabItem } from './items.js';
import { ScrollBar } from './scroll-bar.js';
import { TableView, TableViewRow, TableViewCell, TableViewColumnHeader, TableViewColumnHeadersPresenter } from './table-view.js';

export const ToggleState = Object.freeze({ Off: 0, On: 1, Indeterminate: 2 });
export const ExpandCollapseState = Object.freeze({ Collapsed: 0, Expanded: 1, PartiallyExpanded: 2, LeafNode: 3 });
export const AutomationLiveSetting = Object.freeze({ Off: 0, Polite: 1, Assertive: 2 });
export const AccessibilityView = Object.freeze({ Raw: 0, Control: 1, Content: 2 });
export const AutomationControlType = Object.freeze(Object.fromEntries([
    'Button','Calendar','CheckBox','ComboBox','Edit','Hyperlink','Image','ListItem','List','Menu',
    'MenuBar','MenuItem','ProgressBar','RadioButton','ScrollBar','Slider','Spinner','StatusBar',
    'Tab','TabItem','Text','ToolBar','ToolTip','Tree','TreeItem','Custom','Group','Thumb','DataGrid',
    'DataItem','Document','SplitButton','Window','Pane','Header','HeaderItem','Table','TitleBar','Separator'
].map(name => [name, name])));

export class ElementNotEnabledException extends Error { constructor() { super('The automation element is not enabled.'); this.name = 'ElementNotEnabledException'; } }
export class ElementNotAvailableException extends Error { constructor() { super('The automation element is no longer available.'); this.name = 'ElementNotAvailableException'; } }

/** Attached accessibility metadata. Setters participate in property notifications and XAML. */
export class AutomationProperties {}
for (const [name, value] of Object.entries({ Name: '', AutomationId: '', HelpText: '', LabeledBy: null, LiveSetting: AutomationLiveSetting.Off, AccessibilityView: AccessibilityView.Content, HeadingLevel: 0, IsRequiredForForm: false, PositionInSet: -1, SizeOfSet: -1 })) {
    const property = AutomationProperties[`${name}Property`] = AvaloniaProperty.RegisterAttached(AutomationProperties, name, value);
    AutomationProperties[`Get${name}`] = control => control.GetValue(property);
    AutomationProperties[`Set${name}`] = (control, v) => control.SetValue(property, v);
}
const patternName = pattern => String(pattern?.Name ?? pattern?.name ?? pattern).replace(/^I(?=[A-Z])/, '').replace(/Provider$/, '');
const ancestor = (control, type) => control?.GetVisualAncestors().find(c => c instanceof type) ?? null;
const contentName = c => typeof c?.Content === 'string' || typeof c?.Content === 'number' ? String(c.Content) :
    c?.Content instanceof TextBlock ? c.Content.EffectiveText : typeof c?.Header === 'string' ? c.Header : '';

export class AutomationPeer {
    constructor() { this.PropertyChanged = new Event(); this.AutomationEventRaised = new Event(); this.IsDisposed = false; }
    GetPattern(_pattern) { return null; }
    GetChildren() { return []; }
    GetParent() { return null; }
    GetName() { return ''; }
    GetAutomationControlType() { return AutomationControlType.Custom; }
    GetAriaRole() { return 'group'; }
    RaisePropertyChangedEvent(property, oldValue, newValue) { if (!Object.is(oldValue, newValue)) { this.PropertyChanged.Raise(this, { Property: property, OldValue: oldValue, NewValue: newValue }); this.Owner?.GetVisualRoot()?._InvalidateAutomation?.(this.Owner); } }
    RaiseAutomationEvent(event) { this.AutomationEventRaised.Raise(this, { Event: event }); this.Owner?.GetVisualRoot()?._InvalidateAutomation?.(this.Owner, true); }
    Dispose() { if (this.IsDisposed) return; this.IsDisposed = true; this.PropertyChanged.Clear(); this.AutomationEventRaised.Clear(); }
}
export class ControlAutomationPeer extends AutomationPeer {
    constructor(owner) {
        super(); if (!(owner instanceof Control)) throw new TypeError('Automation peers require a Control owner.');
        this.Owner = owner; this._subscriptions = new CompositeDisposable();
        this._subscriptions.Add(owner.PropertyChanged.Add((_, e) => this.RaisePropertyChangedEvent(e.Property.Name, e.OldValue, e.NewValue)));
        this._subscriptions.Add(owner.Disposed.Add(() => this.Dispose()));
    }
    static CreatePeerForElement(element) { return element.GetOrCreateAutomationPeer(); }
    static FromElement(element) { return element.GetAutomationPeer(); }
    GetOrCreate(element) { return element === this.Owner ? this : ControlAutomationPeer.CreatePeerForElement(element); }
    VerifyAvailable() { if (this.IsDisposed || this.Owner.IsDisposed) throw new ElementNotAvailableException(); }
    VerifyEnabled() { this.VerifyAvailable(); if (!this.IsEnabled()) throw new ElementNotEnabledException(); }
    GetName() { return this._GetName(new Set()); }
    _GetName(visited) {
        if (visited.has(this.Owner)) return ''; visited.add(this.Owner);
        const explicit = AutomationProperties.GetName(this.Owner) || this.Owner.AutomationName;
        if (explicit) return String(explicit);
        const label = AutomationProperties.GetLabeledBy(this.Owner);
        if (label instanceof Control) { const peer = this.GetOrCreate(label); const name = peer?._GetName?.(visited) ?? ''; if (name) return name; }
        return this.GetNameCore();
    }
    GetNameCore() { return contentName(this.Owner); }
    GetAutomationId() { return String(AutomationProperties.GetAutomationId(this.Owner) || this.Owner.Name || ''); }
    GetClassName() { return this.Owner.constructor.name; }
    GetHelpText() { return String(AutomationProperties.GetHelpText(this.Owner) || this.Owner.PlaceholderText || this.Owner.Watermark || ''); }
    GetLabeledBy() { const control = AutomationProperties.GetLabeledBy(this.Owner); return control instanceof Control ? this.GetOrCreate(control) : null; }
    GetParent() { return this.Owner.VisualParent instanceof Control ? this.GetOrCreate(this.Owner.VisualParent) : null; }
    GetChildren() { return this.Owner.VisualChildren.filter(c => c instanceof Control && c.IsEffectivelyVisible && !c.IsDisposed).map(c => this.GetOrCreate(c)); }
    IsEnabled() { return this.Owner.IsEffectivelyEnabled; }
    IsKeyboardFocusable() { return this.Owner.Focusable && this.IsEnabled(); }
    HasKeyboardFocus() { return this.Owner.IsFocused; }
    IsPassword() { return false; }
    IsControlElement() { return AutomationProperties.GetAccessibilityView(this.Owner) !== AccessibilityView.Raw; }
    IsContentElement() { return AutomationProperties.GetAccessibilityView(this.Owner) === AccessibilityView.Content; }
    GetBoundingRectangle() {
        if (!this.Owner.IsEffectivelyVisible || !this.Owner.IsAttachedToVisualTree) return Rect.Empty;
        const root = this.Owner.GetVisualRoot(), matrix = this.Owner.TransformToVisual(root);
        let bounds = matrix ? new Rect(this.Owner.Bounds.Size).TransformToAABB(matrix) : Rect.Empty;
        for (let child = this.Owner, c = child.VisualParent; c; child = c, c = c.VisualParent) {
            const m = c.TransformToVisual(root); if (!m) continue;
            if (c.ClipToBounds || c === root) bounds = bounds.Intersect(new Rect(c.Bounds.Size).TransformToAABB(m));
            const viewport = c.GetChildClip?.(child);
            if (viewport) bounds = bounds.Intersect(viewport.TransformToAABB(m));
        }
        return bounds;
    }
    IsOffscreen() { const b = this.GetBoundingRectangle(); return b.Width <= 0 || b.Height <= 0; }
    SetFocus() { this.VerifyEnabled(); this.BringIntoView(); if (!this.Owner.Focus('Programmatic')) throw new Error('This automation element cannot receive keyboard focus.'); }
    BringIntoView() { this.VerifyAvailable(); for (const c of this.Owner.GetVisualAncestors()) if (c instanceof ScrollViewer) c.BringIntoView(this.Owner); }
    GetAriaRole() { return this.Owner.IsTopLevel ? 'application' : 'group'; }
    GetAutomationControlType() { return this.Owner.IsTopLevel ? AutomationControlType.Window : AutomationControlType.Group; }
    Dispose() { if (this.IsDisposed) return; this._subscriptions.Dispose(); super.Dispose(); }
}
export class ButtonAutomationPeer extends ControlAutomationPeer {
    GetPattern(pattern) { return patternName(pattern) === 'Invoke' ? this : super.GetPattern(pattern); }
    Invoke() { this.VerifyEnabled(); this.Owner.OnClick(); this.RaiseAutomationEvent('Invoked'); }
    GetChildren() { return []; }
    GetAriaRole() { return 'button'; }
    GetAutomationControlType() { return AutomationControlType.Button; }
}
export class ToggleButtonAutomationPeer extends ButtonAutomationPeer {
    GetPattern(pattern) { return patternName(pattern) === 'Toggle' ? this : super.GetPattern(pattern); }
    get ToggleState() { return this.Owner.IsChecked === null ? ToggleState.Indeterminate : this.Owner.IsChecked ? ToggleState.On : ToggleState.Off; }
    Toggle() { this.VerifyEnabled(); this.Owner.OnToggle(); }
    GetAriaRole() { return this.Owner instanceof ToggleSwitch ? 'switch' : this.Owner instanceof CheckBox ? 'checkbox' : 'button'; }
    GetAutomationControlType() { return this.Owner instanceof CheckBox ? AutomationControlType.CheckBox : AutomationControlType.Button; }
}
export class RadioButtonAutomationPeer extends ToggleButtonAutomationPeer {
    GetPattern(pattern) { const p = patternName(pattern); return p === 'SelectionItem' ? this : p === 'Toggle' ? null : super.GetPattern(pattern); }
    get IsSelected() { return !!this.Owner.IsChecked; }
    get SelectionContainer() { return this.GetParent(); }
    Select() { this.VerifyEnabled(); this.Owner.OnToggle(); }
    AddToSelection() { this.Select(); }
    RemoveFromSelection() { throw new Error('A radio option cannot be individually deselected.'); }
    GetAriaRole() { return 'radio'; }
    GetAutomationControlType() { return AutomationControlType.RadioButton; }
}
export class TextBoxAutomationPeer extends ControlAutomationPeer {
    GetPattern(pattern) { return patternName(pattern) === 'Value' ? this : super.GetPattern(pattern); }
    get IsReadOnly() { return this.Owner.IsReadOnly; }
    get Value() { return this.IsPassword() ? '' : this.Owner.Text; }
    IsPassword() { return !!this.Owner.PasswordChar; }
    SetValue(value) { this.VerifyEnabled(); if (this.IsReadOnly) throw new Error('The text value is read-only.'); this.Owner.SelectAll(); this.Owner.ReplaceSelection(String(value)); }
    GetChildren() { return []; }
    GetAriaRole() { return 'textbox'; }
    GetAutomationControlType() { return AutomationControlType.Edit; }
}
export class RangeBaseAutomationPeer extends ControlAutomationPeer {
    GetPattern(pattern) { return patternName(pattern) === 'RangeValue' ? this : super.GetPattern(pattern); }
    get IsReadOnly() { return this.Owner instanceof ProgressBar || !!this.Owner.IsReadOnly; }
    get Value() { return this.Owner.Value; }
    get Minimum() { return this.Owner.Minimum; }
    get Maximum() { return this.Owner.Maximum; }
    get SmallChange() { return this.Owner.SmallChange ?? this.Owner.Increment ?? 1; }
    get LargeChange() { return this.Owner.LargeChange ?? this.SmallChange * 10; }
    SetValue(value) {
        this.VerifyEnabled(); if (this.IsReadOnly) throw new Error('The range value is read-only.');
        value = Number(value); if (!Number.isFinite(value) || value < this.Minimum || value > this.Maximum) throw new RangeError('Value is outside the automation range.');
        this.Owner.SetCurrentValue(this.Owner instanceof RangeBase ? RangeBase.ValueProperty : NumericUpDown.ValueProperty, value);
    }
    GetChildren() { return []; }
    GetAriaRole() { return this.Owner instanceof ProgressBar ? 'progressbar' : this.Owner instanceof NumericUpDown ? 'spinbutton' : 'slider'; }
    GetAutomationControlType() { return this.Owner instanceof ProgressBar ? AutomationControlType.ProgressBar : this.Owner instanceof NumericUpDown ? AutomationControlType.Spinner : AutomationControlType.Slider; }
}
export class ScrollBarAutomationPeer extends RangeBaseAutomationPeer {
    GetNameCore() { return `${this.Owner.Orientation === 'Horizontal' ? 'Horizontal' : 'Vertical'} scroll bar`; }
    GetAriaRole() { return 'scrollbar'; }
    GetAutomationControlType() { return AutomationControlType.ScrollBar; }
}
export class TextBlockAutomationPeer extends ControlAutomationPeer {
    GetNameCore() { return this.Owner.EffectiveText; }
    GetAriaRole() { return AutomationProperties.GetHeadingLevel(this.Owner) > 0 ? 'heading' : 'paragraph'; }
    GetAutomationControlType() { return AutomationControlType.Text; }
}
export class SelectingItemsControlAutomationPeer extends ControlAutomationPeer {
    GetPattern(pattern) { return patternName(pattern) === 'Selection' ? this : super.GetPattern(pattern); }
    get CanSelectMultiple() { return !this.Owner.Selection.SingleSelect; }
    get IsSelectionRequired() { return false; }
    GetSelection() {
        return this.Owner.Selection.SelectedIndexes.map(index => {
            const container = this.Owner.ContainerFromIndex(index);
            return container ? this.GetOrCreate(container) : new VirtualizedItemAutomationPeer(this.Owner, index);
        });
    }
    GetAriaRole() { return this.Owner instanceof TreeView ? 'tree' : this.Owner instanceof TabControl ? 'tablist' : 'listbox'; }
    GetAutomationControlType() { return this.Owner instanceof TreeView ? AutomationControlType.Tree : this.Owner instanceof TabControl ? AutomationControlType.Tab : AutomationControlType.List; }
}
export class ComboBoxAutomationPeer extends SelectingItemsControlAutomationPeer {
    GetPattern(pattern) { return patternName(pattern) === 'ExpandCollapse' ? this : super.GetPattern(pattern); }
    get ExpandCollapseState() { return this.Owner.IsDropDownOpen ? ExpandCollapseState.Expanded : ExpandCollapseState.Collapsed; }
    Expand() { this.VerifyEnabled(); this.Owner.OpenDropDown(); }
    Collapse() { this.VerifyEnabled(); this.Owner.CloseDropDown(); }
    GetAriaRole() { return 'combobox'; }
    GetAutomationControlType() { return AutomationControlType.ComboBox; }
}
export class ListBoxItemAutomationPeer extends ControlAutomationPeer {
    get ItemsOwner() { return ancestor(this.Owner, SelectingItemsControl); }
    GetPattern(pattern) { return ['SelectionItem', 'ScrollItem'].includes(patternName(pattern)) ? this : super.GetPattern(pattern); }
    get SelectionContainer() { return this.ItemsOwner ? this.GetOrCreate(this.ItemsOwner) : null; }
    get IsSelected() { return !!this.ItemsOwner?.Selection.IsSelected(this.Owner.ItemIndex); }
    Select() { this.VerifyEnabled(); if (!this.ItemsOwner) throw new ElementNotAvailableException(); this.ItemsOwner.SelectedIndex = this.Owner.ItemIndex; }
    AddToSelection() { this.VerifyEnabled(); if (!this.ItemsOwner) throw new ElementNotAvailableException(); if (this.ItemsOwner.Selection.SingleSelect && this.ItemsOwner.SelectedIndex >= 0 && !this.IsSelected) throw new Error('The selection does not permit multiple items.'); this.ItemsOwner.Selection.Select(this.Owner.ItemIndex); }
    RemoveFromSelection() { this.VerifyEnabled(); this.ItemsOwner?.Selection.Deselect(this.Owner.ItemIndex); }
    ScrollIntoView() { this.VerifyAvailable(); this.ItemsOwner?.ScrollIntoView?.(this.Owner.ItemIndex); }
    BringIntoView() { this.ScrollIntoView(); super.BringIntoView(); }
    GetAriaRole() { return this.Owner instanceof TabItem ? 'tab' : 'option'; }
    GetAutomationControlType() { return this.Owner instanceof TabItem ? AutomationControlType.TabItem : AutomationControlType.ListItem; }
}
/** A selected offscreen item exposes identity and selection without realizing every row. */
export class VirtualizedItemAutomationPeer extends AutomationPeer {
    constructor(owner, index) { super(); this.Owner = owner; this._index = index; this._item = owner.ItemsView[index]; }
    get Index() { if (this.Owner.IsDisposed || this.IsDisposed) throw new ElementNotAvailableException(); const items = this.Owner.ItemsView; const i = items[this._index] === this._item ? this._index : items.indexOf(this._item); if (i < 0) throw new ElementNotAvailableException(); return i; }
    GetPattern(pattern) { return ['SelectionItem','ScrollItem','VirtualizedItem'].includes(patternName(pattern)) ? this : null; }
    GetName() { return String(this._item?.Name ?? this._item?.Header ?? this._item ?? ''); }
    GetAriaRole() { return 'option'; }
    GetParent() { return this.SelectionContainer; }
    get SelectionContainer() { return this.Owner.GetOrCreateAutomationPeer(); }
    get IsSelected() { return this.Owner.Selection.IsSelected(this.Index); }
    VerifyEnabled() { void this.Index; if (!this.Owner.IsEffectivelyEnabled) throw new ElementNotEnabledException(); }
    Select() { this.VerifyEnabled(); this.Owner.SelectedIndex = this.Index; }
    AddToSelection() { this.VerifyEnabled(); if (this.Owner.Selection.SingleSelect && this.Owner.SelectedIndex >= 0 && !this.IsSelected) throw new Error('The selection does not permit multiple items.'); this.Owner.Selection.Select(this.Index); }
    RemoveFromSelection() { this.VerifyEnabled(); this.Owner.Selection.Deselect(this.Index); }
    ScrollIntoView() { this.Owner.ScrollIntoView?.(this.Index); }
    Realize() { this.ScrollIntoView(); }
    IsOffscreen() { return true; }
}
export class TreeViewItemAutomationPeer extends ListBoxItemAutomationPeer {
    GetPattern(pattern) { return patternName(pattern) === 'ExpandCollapse' ? this : super.GetPattern(pattern); }
    get ExpandCollapseState() { return !this.Owner.HasChildren ? ExpandCollapseState.LeafNode : this.Owner.IsExpanded ? ExpandCollapseState.Expanded : ExpandCollapseState.Collapsed; }
    _SetExpanded(value) { this.VerifyEnabled(); if (!this.Owner.HasChildren) throw new Error('A leaf item cannot expand.'); const tree = this.ItemsOwner, item = tree.ItemsView[this.Owner.ItemIndex]; value ? tree._expanded.add(item) : tree._expanded.delete(item); tree._RebuildItems(); }
    Expand() { this._SetExpanded(true); }
    Collapse() { this._SetExpanded(false); }
    GetAriaRole() { return 'treeitem'; }
    GetAutomationControlType() { return AutomationControlType.TreeItem; }
}
export class ExpanderAutomationPeer extends ControlAutomationPeer {
    GetPattern(pattern) { return patternName(pattern) === 'ExpandCollapse' ? this : super.GetPattern(pattern); }
    get ExpandCollapseState() { return this.Owner.IsExpanded ? ExpandCollapseState.Expanded : ExpandCollapseState.Collapsed; }
    Expand() { this.VerifyEnabled(); this.Owner.IsExpanded = true; }
    Collapse() { this.VerifyEnabled(); this.Owner.IsExpanded = false; }
    GetAriaRole() { return 'group'; }
}
export class ScrollViewerAutomationPeer extends ControlAutomationPeer {
    GetPattern(pattern) { return patternName(pattern) === 'Scroll' ? this : super.GetPattern(pattern); }
    get HorizontallyScrollable() { return this.Owner.Extent.Width > this.Owner.Viewport.Width && this.Owner.HorizontalScrollBarVisibility !== 'Disabled'; }
    get VerticallyScrollable() { return this.Owner.Extent.Height > this.Owner.Viewport.Height && this.Owner.VerticalScrollBarVisibility !== 'Disabled'; }
    get HorizontalScrollPercent() { return this.HorizontallyScrollable ? this.Owner.Offset.X * 100 / (this.Owner.Extent.Width - this.Owner.Viewport.Width) : -1; }
    get VerticalScrollPercent() { return this.VerticallyScrollable ? this.Owner.Offset.Y * 100 / (this.Owner.Extent.Height - this.Owner.Viewport.Height) : -1; }
    get HorizontalViewSize() { return Math.min(100, this.Owner.Viewport.Width / Math.max(1, this.Owner.Extent.Width) * 100); }
    get VerticalViewSize() { return Math.min(100, this.Owner.Viewport.Height / Math.max(1, this.Owner.Extent.Height) * 100); }
    SetScrollPercent(horizontal, vertical) {
        this.VerifyEnabled();
        for (const [value, supported] of [[horizontal, this.HorizontallyScrollable], [vertical, this.VerticallyScrollable]]) if (value !== -1 && (!supported || !Number.isFinite(value) || value < 0 || value > 100)) throw new RangeError('The requested scroll percentage is not supported.');
        const old = this.Owner.Offset; this.Owner.Offset = new Point(horizontal === -1 ? old.X : (this.Owner.Extent.Width - this.Owner.Viewport.Width) * horizontal / 100, vertical === -1 ? old.Y : (this.Owner.Extent.Height - this.Owner.Viewport.Height) * vertical / 100);
    }
    Scroll(horizontal, vertical) {
        this.VerifyEnabled(); const factors = { LargeDecrement: -1, SmallDecrement: -.1, NoAmount: 0, LargeIncrement: 1, SmallIncrement: .1 };
        if (!(horizontal in factors) || !(vertical in factors)) throw new TypeError('Unknown scroll amount.');
        this.Owner.Offset = this.Owner._Clamp(new Point(this.Owner.Offset.X + factors[horizontal] * this.Owner.Viewport.Width, this.Owner.Offset.Y + factors[vertical] * this.Owner.Viewport.Height));
    }
}
export class TableViewAutomationPeer extends SelectingItemsControlAutomationPeer {
    GetPattern(pattern) { return ['Grid','Table'].includes(patternName(pattern)) ? this : super.GetPattern(pattern); }
    GetChildren() { return [this.GetOrCreate(this.Owner.HeadersPresenter), ...this.Owner.GetRealizedContainers().sort((a,b) => a.ItemIndex - b.ItemIndex).map(c => this.GetOrCreate(c))]; }
    get RowCount() { return this.Owner.ItemsView.length; }
    get ColumnCount() { return this.Owner.VisibleColumns.length; }
    get RowOrColumnMajor() { return 'RowMajor'; }
    GetItem(row, column) {
        this.VerifyAvailable(); if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || row >= this.RowCount || column < 0 || column >= this.ColumnCount) throw new RangeError('Invalid grid coordinates.');
        this.Owner.ScrollIntoView(row); this.Owner.GetVisualRoot()?.LayoutManager.ExecuteLayoutPass();
        const cell = this.Owner.ContainerFromIndex(row)?.CellsPresenter.Children.Get(column);
        if (!cell) throw new Error('The table must be measured before accessing grid cells.');
        return this.GetOrCreate(cell);
    }
    GetColumnHeaders() { return this.Owner.HeadersPresenter.Children.map(c => this.GetOrCreate(c)); }
    GetRowHeaders() { return []; }
    GetAriaRole() { return 'grid'; }
    GetAutomationControlType() { return AutomationControlType.DataGrid; }
}
export class TableViewRowAutomationPeer extends ListBoxItemAutomationPeer {
    GetChildren() { return this.Owner.CellsPresenter.Children.map(c => this.GetOrCreate(c)); }
    GetAriaRole() { return 'row'; }
    GetAutomationControlType() { return AutomationControlType.DataItem; }
}
export class TableViewCellAutomationPeer extends ControlAutomationPeer {
    GetPattern(pattern) { return ['GridItem','TableItem'].includes(patternName(pattern)) ? this : super.GetPattern(pattern); }
    get ContainingGrid() { const table = this.Owner.Column?.TableView; return table ? this.GetOrCreate(table) : null; }
    get Row() { return ancestor(this.Owner, TableViewRow)?.ItemIndex ?? -1; }
    get Column() { return this.Owner.Column?.TableView?.VisibleColumns.indexOf(this.Owner.Column) ?? -1; }
    get RowSpan() { return 1; } get ColumnSpan() { return 1; }
    GetColumnHeaderItems() { const header = this.Owner.Column?.TableView?.HeadersPresenter.Children.Get(this.Column); return header ? [this.GetOrCreate(header)] : []; }
    GetRowHeaderItems() { return []; }
    GetAriaRole() { return 'gridcell'; }
    GetAutomationControlType() { return AutomationControlType.DataItem; }
}
export class TableViewColumnHeaderAutomationPeer extends ControlAutomationPeer {
    GetNameCore() { return String(this.Owner.Column?.Header ?? ''); }
    GetPattern(pattern) { return patternName(pattern) === 'Invoke' && this.Owner.Column?.CanUserSort ? this : super.GetPattern(pattern); }
    Invoke() { this.VerifyEnabled(); this.Owner.Column?.TableView?.SortBy(this.Owner.Column); }
    GetChildren() { return []; }
    GetAriaRole() { return 'columnheader'; }
    GetAutomationControlType() { return AutomationControlType.HeaderItem; }
}

export class TableViewColumnHeadersPresenterAutomationPeer extends ControlAutomationPeer {
    GetAriaRole() { return 'row'; }
}
RegisterAutomationPeerFactory(owner => {
    const constructors = [[TableViewColumnHeadersPresenter, TableViewColumnHeadersPresenterAutomationPeer],[TableView, TableViewAutomationPeer],[TableViewRow,TableViewRowAutomationPeer],[TableViewCell,TableViewCellAutomationPeer],[TableViewColumnHeader,TableViewColumnHeaderAutomationPeer],
        [RadioButton,RadioButtonAutomationPeer],[ToggleButton,ToggleButtonAutomationPeer],[Button,ButtonAutomationPeer],[TextBox,TextBoxAutomationPeer],[ScrollBar,ScrollBarAutomationPeer],[RangeBase,RangeBaseAutomationPeer],[NumericUpDown,RangeBaseAutomationPeer],
        [TreeViewItem,TreeViewItemAutomationPeer],[ListBoxItem,ListBoxItemAutomationPeer],[ComboBox,ComboBoxAutomationPeer],[SelectingItemsControl,SelectingItemsControlAutomationPeer],
        [Expander,ExpanderAutomationPeer],[ScrollViewer,ScrollViewerAutomationPeer],[TextBlock,TextBlockAutomationPeer]];
    const type = constructors.find(([type]) => owner instanceof type)?.[1] ?? ControlAutomationPeer;
    return new type(owner);
});

/** Browser projection: values are data, never markup. No password contents are exposed. */
export function GetAutomationAriaProperties(peer) {
    const c = peer.Owner, role = peer.GetAriaRole(), attributes = { role };
    const name = peer.GetName(), help = peer.GetHelpText?.();
    if (name) attributes['aria-label'] = name;
    if (help) attributes['aria-description'] = help;
    attributes['aria-disabled'] = String(!peer.IsEnabled());
    if (peer instanceof ToggleButtonAutomationPeer) attributes[role === 'button' ? 'aria-pressed' : 'aria-checked'] = c.IsChecked == null ? 'mixed' : String(!!c.IsChecked);
    if (peer instanceof TextBoxAutomationPeer) {
        attributes['aria-multiline'] = String(!!c.AcceptsReturn); attributes['aria-readonly'] = String(!!c.IsReadOnly);
        if (c.PasswordChar) attributes['aria-description'] = help ? `${help}. Password field` : 'Password field';
    }
    if (peer instanceof ScrollBarAutomationPeer && c._scrollOwner) attributes['aria-controls'] = `avalonia-peer-${c._scrollOwner.VisualId}`;
    if (peer instanceof RangeBaseAutomationPeer) {
        attributes['aria-valuemin'] = String(peer.Minimum); attributes['aria-valuemax'] = String(peer.Maximum);
        if (!(c instanceof ProgressBar && c.IsIndeterminate)) attributes['aria-valuenow'] = String(peer.Value);
        if (peer.IsReadOnly) attributes['aria-readonly'] = 'true';
        if (c.Orientation) attributes['aria-orientation'] = c.Orientation.toLowerCase();
    }
    if (peer instanceof SelectingItemsControlAutomationPeer && role !== 'combobox') attributes['aria-multiselectable'] = String(peer.CanSelectMultiple);
    if (peer instanceof ListBoxItemAutomationPeer) {
        attributes['aria-selected'] = String(peer.IsSelected);
        if (peer instanceof TableViewRowAutomationPeer) attributes['aria-rowindex'] = String(c.ItemIndex + 2);
        else { attributes['aria-posinset'] = String(c.ItemIndex + 1); attributes['aria-setsize'] = String(peer.ItemsOwner?.ItemCount ?? -1); }
    }
    const expand = peer.GetPattern('ExpandCollapse');
    if (expand && expand.ExpandCollapseState !== ExpandCollapseState.LeafNode) attributes['aria-expanded'] = String(expand.ExpandCollapseState === ExpandCollapseState.Expanded);
    if (role === 'combobox') attributes['aria-haspopup'] = 'listbox';
    if (role === 'treeitem') {
        attributes['aria-level'] = String(c.Depth + 1);
        const tree = peer.ItemsOwner, nodes = tree?._nodes ?? [], index = c.ItemIndex;
        let first = index, last = index + 1;
        while (first > 0 && nodes[first - 1].Depth >= c.Depth) first--;
        while (last < nodes.length && nodes[last].Depth >= c.Depth) last++;
        const siblings = nodes.slice(first, last).map((n, i) => ({ ...n, Index: i + first })).filter(n => n.Depth === c.Depth);
        attributes['aria-posinset'] = String(siblings.findIndex(n => n.Index === index) + 1); attributes['aria-setsize'] = String(siblings.length);
    }
    if (peer instanceof TableViewAutomationPeer) { attributes['aria-rowcount'] = String(peer.RowCount + 1); attributes['aria-colcount'] = String(peer.ColumnCount); attributes['aria-readonly'] = 'true'; }
    if (peer instanceof TableViewColumnHeadersPresenterAutomationPeer) attributes['aria-rowindex'] = '1';
    if (peer instanceof TableViewCellAutomationPeer) { attributes['aria-colindex'] = String(peer.Column + 1); attributes['aria-rowindex'] = String(peer.Row + 2); }
    if (peer instanceof TableViewColumnHeaderAutomationPeer) { attributes['aria-sort'] = c.Column?.SortDirection?.toLowerCase() ?? 'none'; attributes['aria-colindex'] = String((c.Column?.TableView?.VisibleColumns.indexOf(c.Column) ?? -1) + 1); }
    if (c) {
        const heading = Number(AutomationProperties.GetHeadingLevel(c)); if (heading > 0) attributes['aria-level'] = String(heading);
        const live = AutomationProperties.GetLiveSetting(c); if (live !== AutomationLiveSetting.Off) attributes['aria-live'] = live === AutomationLiveSetting.Assertive ? 'assertive' : 'polite';
        if (AutomationProperties.GetIsRequiredForForm(c)) attributes['aria-required'] = 'true';
        for (const [key, value] of [['aria-posinset',AutomationProperties.GetPositionInSet(c)],['aria-setsize',AutomationProperties.GetSizeOfSet(c)]]) if (value >= 0) attributes[key] = String(value);
    }
    return attributes;
}
