import { AvaloniaList, AvaloniaProperty, DefineProperties, Event, CompositeDisposable, BindingMode, Size, Rect, Point, Thickness, MathUtilities, UnsetValue } from "../../base/src/index.js";
import { Binding, PropertyPath, ReadMember, BindingOperations } from "../../data/src/index.js";
import { Pen } from "../../media/src/index.js";
import { StyledElement, Control, BooleanValue } from './core.js';
import { ContentControl, TextBlock } from './content.js';
import { ListBox, ListBoxItem, ItemsControl } from './items.js';
import { Panel, GridLength } from './layout.js';
import { CheckBox } from './input-controls.js';

/** Read-only TableView column. Binding is assigned as a binding definition, not bound to this object. */
export class TableViewColumn extends StyledElement {
    constructor(header = '', binding = null, width = GridLength.Star) {
        super(); this._tableView = null; this._actualWidth = NaN;
        this.Header = header; this.Binding = typeof binding === 'string' ? new Binding(binding) : binding; this.Width = width;
    }
    get TableView() { return this._tableView; }
    get ActualWidth() { return this._actualWidth; }
    get CanUserEffectivelyResize() { return this.CanUserResize ?? this.TableView?.CanUserResizeColumns ?? true; }
    _Attach(table) { this.SetAndRaise(TableViewColumn.TableViewProperty, '_tableView', table); this._parent = table; this.SetInheritanceParent(table); this.ApplyStyling(); }
    _SetActualWidth(width) { this.SetAndRaise(TableViewColumn.ActualWidthProperty, '_actualWidth', width); }
    OnPropertyChanged(change) {
        super.OnPropertyChanged(change);
        if (!['ActualWidth', 'TableView', 'CanUserEffectivelyResize'].includes(change.Property.Name)) this.TableView?._ColumnChanged(this, change.Property.Name);
    }
    GetCellValue(item) {
        if (typeof this.Binding === 'function') return this.Binding(item);
        let value = PropertyPath.Parse(this.Binding?.Path ?? '').reduce((o, segment) => ReadMember(o, segment), item);
        if (value === UnsetValue) return this.Binding?.FallbackValue === UnsetValue ? '' : this.Binding?.FallbackValue ?? '';
        if (this.Binding?.Converter) value = typeof this.Binding.Converter === 'function' ? this.Binding.Converter(value) : this.Binding.Converter.Convert(value, null, this.Binding.ConverterParameter);
        return value;
    }
}
DefineProperties(TableViewColumn, {
    Header: [''], HeaderTemplate: [null], HeaderTheme: [null], CellTemplate: [null], CellTheme: [null],
    Binding: [null, { AssignBinding: true }], Width: [GridLength.Star, { Convert: GridLength.Parse }],
    MinWidth: [0, { Convert: Number, Validate: x => Number.isFinite(x) && x >= 0 }], MaxWidth: [Infinity, { Convert: Number, Validate: x => x > 0 }],
    IsVisible: [true, { Convert: BooleanValue }], CanUserResize: [null, { Convert: v => v == null ? null : BooleanValue(v) }],
    HorizontalContentAlignment: ['Left'], CanUserSort: [true, { Convert: BooleanValue }], SortDirection: [null]
});
TableViewColumn.TableViewProperty = AvaloniaProperty.RegisterDirect(TableViewColumn, 'TableView', o => o.TableView);
TableViewColumn.ActualWidthProperty = AvaloniaProperty.RegisterDirect(TableViewColumn, 'ActualWidth', o => o.ActualWidth);
TableViewColumn.CanUserEffectivelyResizeProperty = AvaloniaProperty.RegisterDirect(TableViewColumn, 'CanUserEffectivelyResize', o => o.CanUserEffectivelyResize);
/** Convenience browser extension retained from the first release. */
export class TableViewTextColumn extends TableViewColumn { constructor(header = '', binding = '', width = 160) { super(header, binding, width); } }
export class TableViewCheckBoxColumn extends TableViewTextColumn {}

export class TableViewCell extends ContentControl {
    constructor() { super(); this.Padding = new Thickness(10, 4); this.ClipToBounds = true; this._cellBindings = new CompositeDisposable(); }
    Prepare(column, item) {
        // Default cells are owned presenters. Retarget their DataContext instead
        // of destroying bindings and the complete visual subtree on every row.
        const reuse = this.Column === column && !column.CellTemplate &&
            this._preparedBinding === column.Binding && this._preparedTheme === column.CellTheme &&
            !this.ContentTemplate && !this.Template &&
            this._contentIsText;
        if (reuse) {
            this.HorizontalContentAlignment = column.HorizontalContentAlignment;
            this.DataContext = item;
            if (!(column.Binding instanceof Binding)) {
                const value = column.GetCellValue(item);
                if (this._ownedCellContent) this._ownedCellContent.IsChecked = !!value;
                else this.Content = value;
            }
            return;
        }
        this._cellBindings.Clear(); this._ReleaseOwnedContent(); this.Column = column; this.DataContext = item;
        this._preparedBinding = column.Binding; this._preparedTheme = column.CellTheme;
        this.Theme = column.CellTheme; this.HorizontalContentAlignment = column.HorizontalContentAlignment; this.VerticalContentAlignment = 'Center';
        this.ContentTemplate = column.CellTemplate;
        if (column.CellTemplate) this.Content = item;
        else if (column instanceof TableViewCheckBoxColumn) {
            const editor = new CheckBox(); editor.IsHitTestVisible = false; editor.Focusable = false;
            this.Content = editor; this._ownedCellContent = editor;
            if (column.Binding instanceof Binding) editor.Bind(CheckBox.IsCheckedProperty, new Binding({ ...column.Binding, Source: UnsetValue, Mode: BindingMode.OneWay }));
            else editor.IsChecked = !!column.GetCellValue(item);
        } else if (column.Binding instanceof Binding) {
            this._cellBindings.Add(this.Bind(ContentControl.ContentProperty, new Binding({ ...column.Binding, Source: UnsetValue, Mode: BindingMode.OneWay })));
        } else this.Content = column.GetCellValue(item);
    }
    _ReleaseOwnedContent() { if (this._ownedCellContent) { const old = this._ownedCellContent; this._ownedCellContent = null; if (this.Content === old) this.Content = null; old.Dispose(); } }
    Clear() { this._cellBindings.Clear(); this._ReleaseOwnedContent(); this.Content = null; this.DataContext = null; this.Column = null; }
    Dispose() { this._cellBindings.Dispose(); this._ReleaseOwnedContent(); super.Dispose(); }
}
export class TableViewColumnHeader extends ContentControl {
    constructor(column = null) { super(); this.Padding = new Thickness(10, 5); this.ClipToBounds = true; if (column) this.Prepare(column); }
    Prepare(column) {
        this.Column = column; this.DataContext = column; this.Theme = column.HeaderTheme;
        this.ContentTemplate = column.HeaderTemplate;
        this.Content = column.HeaderTemplate ? column.Header : `${column.Header ?? ''}${column.SortDirection === 'Ascending' ? '  ↑' : column.SortDirection === 'Descending' ? '  ↓' : ''}`;
        this.HorizontalContentAlignment = column.HorizontalContentAlignment; this.VerticalContentAlignment = 'Center';
    }
    Render(context) { context.DrawRectangle(this.Background ?? this.Palette.SurfaceAlt, null, new Rect(this.Bounds.Size)); }
    RenderAfter(context) { context.DrawLine(new Pen(this.Palette.Border, 1), new Point(this.Bounds.Width - .5, 8), new Point(this.Bounds.Width - .5, this.Bounds.Height - 8)); }
}
export class TableViewCellsPresenter extends Panel {
    constructor(row) { super(); this.Row = row; }
    Prepare(columns, item) {
        const current = new Map(this.Children.map(c => [c.Column, c]));
        const next = columns.map(column => { const cell = current.get(column) ?? new TableViewCell(); current.delete(column); cell.Prepare(column, item); return cell; });
        if (next.length !== this.Children.Count || next.some((cell, i) => cell !== this.Children.Get(i))) this.Children.ReplaceAll(next);
        for (const cell of current.values()) cell.Dispose();
    }
    ClearCells() { for (const cell of this.Children) cell.Clear(); }
    MeasureOverride(size) {
        let width = 0, height = 0;
        for (const cell of this.Children) {
            cell.Measure(new Size(cell.Column.Width.IsAbsolute ? cell.Column.Width.Value : Infinity, size.Height));
            width += cell.DesiredSize.Width; height = Math.max(height, cell.DesiredSize.Height);
        }
        return new Size(width, height);
    }
    ArrangeOverride(size) {
        let x = 0;
        for (const cell of this.Children) { const width = cell.Column.ActualWidth; cell.Arrange(new Rect(x, 0, width, size.Height)); x += width; }
        return size;
    }
}
export class TableViewRow extends ListBoxItem {
    constructor() {
        super(); this.Padding = Thickness.Empty; this.CellsPresenter = new TableViewCellsPresenter(this); this.Content = this.CellsPresenter;
    }
    Prepare(table, item, index) {
        const oldIndex = this.ItemIndex;
        this.TableView = table; this.ItemIndex = index; this.DataContext = item; this.Theme = table.ItemContainerTheme;
        if (oldIndex !== index) this.GetVisualRoot()?._InvalidateAutomation?.(this, false, true);
        this.CellsPresenter.Prepare(table.VisibleColumns, item);
        this.IsSelected = table.Selection.IsSelected(index);
    }
    ClearCells() { this.CellsPresenter.ClearCells(); this.DataContext = null; this.ItemIndex = -1; }
    RebuildCells() { if (this.ItemIndex >= 0) this.CellsPresenter.Prepare(this.TableView.VisibleColumns, this.DataContext); }
    Render(context) {
        if (this.IsSelected) context.DrawRectangle(this.Palette.Selection, null, new Rect(this.Bounds.Size));
        else if (this.TableView?.AlternatingRowBackground && this.ItemIndex % 2) context.DrawRectangle(this.TableView.AlternatingRowBackground, null, new Rect(this.Bounds.Size));
        else super.Render(context);
    }
    RenderAfter(context) {
        if (this.TableView?.GridLinesVisibility !== 'None') context.DrawLine(new Pen(this.Palette.Border, .5), new Point(0, this.Bounds.Height - .5), new Point(this.Bounds.Width, this.Bounds.Height - .5));
    }
}
export class TableViewColumnHeadersPresenter extends Panel {
    constructor(table) { super(); this.TableView = table; this.ZIndex = 2; this.ClipToBounds = true; }
    RebuildHeaders() {
        const current = new Map(this.Children.map(c => [c.Column, c]));
        const next = this.TableView.VisibleColumns.map(column => { const header = current.get(column) ?? new TableViewColumnHeader(); current.delete(column); header.Prepare(column); return header; });
        this.Children.ReplaceAll(next); for (const header of current.values()) header.Dispose();
    }
    MeasureOverride(size) {
        let width = 0;
        for (const header of this.Children) { header.Measure(new Size(Infinity, size.Height)); width += header.DesiredSize.Width; }
        return new Size(width, this.TableView.HeaderHeight);
    }
    ArrangeOverride(size) {
        let x = -this.TableView.HorizontalOffset;
        for (const header of this.Children) { const width = header.Column.ActualWidth; header.Arrange(new Rect(x, 0, width, size.Height)); x += width; }
        return size;
    }
    Render(context) { context.DrawRectangle(this.Palette.SurfaceAlt, null, new Rect(this.Bounds.Size)); }
}

/** ListBox-derived, virtualized, read-only table with real cell controls and templates. */
export class TableView extends ListBox {
    constructor() {
        super(); this._columnSubscriptions = new Map(); this._pool = []; this._source = []; this._rows = this._items;
        this._viewport = new Control(); this._viewport.ClipToBounds = true; this.AddVisualChild(this._viewport);
        this.HeadersPresenter = new TableViewColumnHeadersPresenter(this); this.AddVisualChild(this.HeadersPresenter);
        this.Sorting = new Event(); this._columnVersion = 0;
        this.Columns = new AvaloniaList();
        this.HorizontalScrollBarVisibility = 'Auto';
    }
    get Columns() { return this._columns; }
    set Columns(value) {
        value ??= new AvaloniaList(); if (!(value instanceof AvaloniaList)) value = new AvaloniaList(value);
        if (value === this._columns) return;
        this._ValidateColumns(value.ToArray());
        this._UnbindColumns();
        this.SetAndRaise(TableView.ColumnsProperty, '_columns', value);
        const prior = value.ValidateMutation;
        this._columnValidator = change => {
            prior?.(change);
            let proposed = value.ToArray();
            if (change.Action === 'Reset') proposed = change.NewItems;
            else proposed.splice(change.NewStartingIndex, change.Action === 'Replace' ? change.OldItems.length : 0, ...change.NewItems);
            this._ValidateColumns(proposed);
        };
        value.ValidateMutation = this._columnValidator;
        this._priorColumnValidator = prior;
        this._columnsSubscription = value.CollectionChanged.Add(() => this._ColumnsChanged());
        this._ColumnsChanged();
    }
    get VisibleColumns() {
        return this._visibleColumns ??= Object.freeze(this.Columns?.filter(c => c.IsVisible) ?? []);
    }
    get RealizedRowCount() { return this._realized.size; }
    get RowHeight() { return this.ItemHeight; }
    set RowHeight(value) { this.ItemHeight = value; }
    _ValidateColumns(columns) {
        if (new Set(columns).size !== columns.length) throw new Error('Duplicate table column.');
        for (const column of columns) {
            if (!(column instanceof TableViewColumn)) throw new TypeError('Columns must be TableViewColumn objects.');
            if (column.TableView && column.TableView !== this) throw new Error('A column already belongs to another TableView.');
        }
    }
    _UnbindColumns() {
        this._columnsSubscription?.Dispose(); this._columnsSubscription = null;
        if (this._columns && this._columns.ValidateMutation === this._columnValidator) this._columns.ValidateMutation = this._priorColumnValidator;
        for (const column of this._columnSubscriptions.keys()) { column._Attach(null); column._SetActualWidth(NaN); }
        this._columnSubscriptions.clear();
    }
    _ColumnsChanged() {
        this._visibleColumns = null;
        if (this._updatingColumns) return;
        this._updatingColumns = true;
        try {
            const alive = new Set(this.Columns);
            for (const column of this._columnSubscriptions.keys()) if (!alive.has(column)) { column._Attach(null); column._SetActualWidth(NaN); this._columnSubscriptions.delete(column); }
            for (const column of alive) if (!this._columnSubscriptions.has(column)) { this._columnSubscriptions.set(column, true); column._Attach(this); }
            ++this._columnVersion;
            this.HeadersPresenter.RebuildHeaders();
            for (const row of this._realized.values()) { row.RebuildCells(); row.CellsPresenter.InvalidateMeasure(); }
            for (const row of this._pool) { row.Dispose(); } this._pool.length = 0;
            this.InvalidateMeasure();
        } finally { this._updatingColumns = false; }
    }
    _InvalidateColumnLayout(measure = false) {
        // Column dimensions are external inputs to the cell/header presenters.
        // Row bounds can stay identical after a resize, so invalidating only the
        // table leaves cached Arrange calls (and display lists) using old widths.
        if (measure) this.HeadersPresenter.InvalidateMeasure();
        else this.HeadersPresenter.InvalidateArrange();
        for (const row of this._realized.values()) {
            if (measure) row.CellsPresenter.InvalidateMeasure();
            else row.CellsPresenter.InvalidateArrange();
        }
    }
    _ColumnChanged(column, property) {
        if (this._updatingColumns || this._sorting) return;
        if (property === 'Width' || property === 'MinWidth' || property === 'MaxWidth') {
            // Width-only edits must not rebuild headers, bindings or cell trees.
            ++this._columnVersion;
            this._InvalidateColumnLayout(true);
            this.InvalidateMeasure();
            return;
        }
        if (property === 'SortDirection') this._RebuildItems();
        this._ColumnsChanged();
    }
    OnPropertyChanged(change) {
        super.OnPropertyChanged(change);
        if (change.Property.Name === 'HorizontalOffset') { this.HeadersPresenter?.InvalidateArrange(); this.InvalidateArrange(); }
        if (change.Property.Name === 'CanUserResizeColumns') for (const column of this.Columns ?? []) column._RaiseChange(TableViewColumn.CanUserEffectivelyResizeProperty, change.OldValue, column.CanUserEffectivelyResize, 0);
    }
    _RebuildItems() {
        this._source = this._ReadItems();
        if (!this.Columns) { this._items = this._source; return; }
        if (!this.Columns.Count && this.AutoGenerateColumns && this._source.length && typeof this._source[0] === 'object' && this._source[0] != null) {
            const keys = this._source[0].GetPropertyNames?.() ?? Object.keys(this._source[0]).filter(k => !k.startsWith('_') && typeof this._source[0][k] !== 'function');
            this.Columns.AddRange(keys.map(key => new TableViewTextColumn(key, key)));
        }
        const column = [...this.Columns].find(c => c.SortDirection);
        const compare = this.Comparer ?? ((a, b) => a == null ? b == null ? 0 : -1 : b == null ? 1 : typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true }));
        const direction = column?.SortDirection === 'Descending' ? -1 : 1;
        this._items = column ? this._source.map((value, index) => ({ value, index })).sort((a, b) => direction * compare(column.GetCellValue(a.value), column.GetCellValue(b.value)) || a.index - b.index).map(x => x.value) : this._source.slice();
        this._rows = this._items;
        this.Selection.Source = this._items;
        for (const row of this._realized.values()) { this._viewport.RemoveVisualChild(row); row.ClearCells(); this._pool.push(row); }
        this._realized.clear(); this._TrimPool(); this.InvalidateMeasure();
    }
    SortBy(column) {
        if (!this.Columns.Contains(column) || !this.CanUserSortColumns || !column.CanUserSort) return;
        const args = { Column: column, Cancel: false }; this.Sorting.Raise(this, args); if (args.Cancel) return;
        this._sorting = true;
        try { const direction = column.SortDirection === 'Ascending' ? 'Descending' : 'Ascending'; for (const c of this.Columns) c.SortDirection = c === column ? direction : null; }
        finally { this._sorting = false; }
        this._RebuildItems(); this._ColumnsChanged();
    }
    _TrimPool() {
        const max = Math.max(4, Math.ceil(Math.max(1, this.Bounds.Height) / Math.max(1, this.ItemHeight)) + this.OverscanCount * 2);
        while (this._pool.length > max) this._pool.pop().Dispose();
    }
    _Realize(height) {
        const h = Math.max(1, this.ItemHeight), first = Math.max(0, Math.floor(this._offset / h) - this.OverscanCount), last = Math.min(this._items.length, Math.ceil((this._offset + height) / h) + this.OverscanCount);
        const reusable = [];
        let changed = false;
        for (const [index, row] of this._realized) if (index < first || index >= last) {
            this._realized.delete(index); reusable.push(row); changed = true;
        }
        for (let index = first; index < last; ++index) if (!this._realized.has(index)) {
            const row = reusable.pop() ?? this._pool.pop() ?? new TableViewRow();
            row.Prepare(this, this._items[index], index); this._realized.set(index, row);
            if (row.VisualParent !== this._viewport) this._viewport.AddVisualChild(row);
            changed = true;
        }
        // Only surplus rows leave the tree. Attached recycled rows preserve
        // inheritance, styles, automation peers, cells, and text presenters.
        for (const row of reusable) { this._viewport.RemoveVisualChild(row); row.ClearCells(); this._pool.push(row); }
        if (changed) this.GetVisualRoot()?._InvalidateAutomation?.(this, true);
        this._TrimPool();
    }
    _ResolveWidths(width) {
        const columns = this.VisibleColumns, auto = new Map(columns.map(c => [c, c.MinWidth]));
        let widthsChanged = false;
        const setWidth = (column, width) => {
            widthsChanged ||= !Object.is(column.ActualWidth, width);
            column._SetActualWidth(width);
        };
        for (const header of this.HeadersPresenter.Children) auto.set(header.Column, Math.max(auto.get(header.Column), header.DesiredSize.Width));
        for (const row of this._realized.values()) for (const cell of row.CellsPresenter.Children) auto.set(cell.Column, Math.max(auto.get(cell.Column), cell.DesiredSize.Width));
        let fixed = 0; const stars = [];
        for (const column of columns) {
            const size = GridLength.Parse(column.Width);
            if (size.IsStar && Number.isFinite(width)) stars.push(column);
            else { const actual = MathUtilities.Clamp(size.IsAbsolute ? size.Value : auto.get(column), column.MinWidth, Math.max(column.MinWidth, column.MaxWidth)); setWidth(column, actual); fixed += actual; }
        }
        let remaining = Math.max(0, width - fixed), active = stars.slice();
        while (active.length) {
            const weight = active.reduce((sum, c) => sum + c.Width.Value, 0), constrained = [];
            for (const c of active) { const proposed = weight ? remaining * c.Width.Value / weight : 0; if (proposed < c.MinWidth || proposed > c.MaxWidth) constrained.push([c, MathUtilities.Clamp(proposed, c.MinWidth, Math.max(c.MinWidth, c.MaxWidth))]); }
            if (!constrained.length) { for (const c of active) setWidth(c, weight ? remaining * c.Width.Value / weight : 0); break; }
            for (const [c, actual] of constrained) { setWidth(c, actual); remaining = Math.max(0, remaining - actual); active.splice(active.indexOf(c), 1); }
        }
        this._extentWidth = columns.reduce((sum, c) => sum + c.ActualWidth, 0);
        if (widthsChanged) this._InvalidateColumnLayout();
    }
    MeasureOverride(available) {
        const height = Math.min(Number.isFinite(available.Height) ? available.Height : 320, Math.max(120, this.HeaderHeight + this._items.length * this.ItemHeight));
        // Match arrange's reserved tracks when choosing the realized row window.
        // Initial auto widths may require a second pass, but never an endless
        // alternating attach/remove at the header/scrollbar boundary.
        this._Realize(this._ResolveScrollViewport(new Size(available.Width, height), this.HeaderHeight).Height);
        this.HeadersPresenter.Measure(new Size(available.Width, this.HeaderHeight));
        for (const row of this._realized.values()) row.Measure(new Size(available.Width, this.ItemHeight));
        this._ResolveWidths(available.Width);
        return new Size(Math.min(available.Width, Math.max(260, this._extentWidth)), height);
    }
    _GetExtentWidth() { return this._extentWidth ?? 0; }
    GetChildClip(child) { return child === this._viewport || child === this.HeadersPresenter ? null : super.GetChildClip(child); }
    ArrangeOverride(size) {
        this._ResolveWidths(size.Width);
        const viewport = this._ResolveScrollViewport(size, this.HeaderHeight); this._scrollViewport = viewport.Size;
        this._offset = MathUtilities.Clamp(this._offset, 0, Math.max(0, this._items.length * this.ItemHeight - viewport.Height));
        this._Realize(viewport.Height);
        for (const row of this._realized.values()) row.Measure(new Size(viewport.Width, this.ItemHeight));
        this._ResolveWidths(viewport.Width);
        this._viewport.Arrange(viewport);
        this._SetHorizontalOffset(this.HorizontalOffset);
        for (const [index, row] of this._realized) row.Arrange(new Rect(-this.HorizontalOffset, index * this.ItemHeight - this._offset, Math.max(viewport.Width, this._extentWidth), this.ItemHeight));
        this.HeadersPresenter.Arrange(new Rect(0, 0, viewport.Width, this.HeaderHeight));
        this._SyncScrollChrome(viewport);
        return size;
    }
    _ColumnRects() { let x = -this.HorizontalOffset; return this.VisibleColumns.map(Column => { const r = { Column, X: x, Width: Column.ActualWidth }; x += r.Width; return r; }); }
    _SetOffset(offset) { return super._SetOffset(offset); }
    ScrollIntoView(indexOrItem) { return super.ScrollIntoView(indexOrItem); }
    OnPointerPressed(e) {
        const p = e.GetPosition(this); this.Focus('Pointer');
        if (p.Y < this.HeaderHeight) {
            const columns = this._ColumnRects(), edge = columns.find(c => Math.abs(p.X - c.X - c.Width) < 5 && c.Column.CanUserEffectivelyResize);
            if (edge) { this._resize = { Column: edge.Column, X: p.X, Width: edge.Width }; e.Pointer.Capture(this); }
            else { const column = columns.find(c => p.X >= c.X && p.X < c.X + c.Width)?.Column; if (column) this.SortBy(column); }
        } else this._SelectIndex(Math.floor((p.Y - this.HeaderHeight + this._offset) / this.ItemHeight), e.KeyModifiers);
        e.Handled = true;
    }
    OnPointerMoved(e) { if (this._resize && e.Pointer.Captured === this) { const r = this._resize; r.Column.Width = new GridLength(MathUtilities.Clamp(r.Width + e.GetPosition(this).X - r.X, r.Column.MinWidth, r.Column.MaxWidth)); e.Handled = true; } }
    OnPointerReleased(e) { if (e.Pointer.Captured === this) { this._resize = null; e.Pointer.Capture(null); e.Handled = true; } }
    OnPointerCaptureLost() { this._resize = null; }
    OnPointerWheelChanged(e) { super.OnPointerWheelChanged(e); }
    RenderAfter(context) { super.RenderAfter(context); }
    Dispose() { if (this.IsDisposed) return; this._UnbindColumns(); for (const row of this._pool) row.Dispose(); this._pool.length = 0; this.Sorting.Clear(); super.Dispose(); }
}
TableView.ColumnsProperty = AvaloniaProperty.RegisterDirect(TableView, 'Columns', o => o.Columns, (o, v) => { o.Columns = v; });
TableView.RowHeightProperty = ListBox.ItemHeightProperty;
DefineProperties(TableView, {
    HeaderHeight: [38, { Convert: Number, AffectsMeasure: true, Validate: x => Number.isFinite(x) && x >= 0 }],
    HorizontalOffset: [0, { Convert: Number, AffectsArrange: true }],
    AutoGenerateColumns: [true, { Convert: BooleanValue }], CanUserSortColumns: [true, { Convert: BooleanValue }],
    CanUserResizeColumns: [true, { Convert: BooleanValue }], GridLinesVisibility: ['Horizontal'], AlternatingRowBackground: [null], Comparer: [null]
});
