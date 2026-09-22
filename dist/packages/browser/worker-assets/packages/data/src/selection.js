import { AvaloniaObject, AvaloniaList, Event, Disposable, AreValuesEqual } from "../../base/src/index.js";
export class SelectionModel extends AvaloniaObject {
    constructor(source = []) {
        super();
        this.SelectionChanged = new Event();
        this.LostSelection = new Event();
        this.SingleSelect = true;
        this._source = [];
        this._indexes = new Set();
        this.AnchorIndex = -1;
        this.Source = source;
    }
    get Source() {
        return this._source;
    }
    set Source(value) {
        this._collectionSubscription?.Dispose();
        this._collectionSubscription?.unsubscribe?.();
        const selected = this.SelectedItems;
        this._source = value ?? [];
        this._collectionSubscription = this._source.CollectionChanged?.Add?.(() => this._reconcile(this._selectedSnapshot ?? []));
        this._reconcile(selected);
    }
    get SelectedIndex() {
        return this.SelectedIndexes[0] ?? -1;
    }
    set SelectedIndex(index) {
        this._setIndexes(index < 0 ? [] : [index]);
    }
    get SelectedItem() {
        return this.SelectedItems[0] ?? null;
    }
    set SelectedItem(value) {
        this.SelectedIndex = this._array().indexOf(value);
    }
    get SelectedIndexes() {
        return [...this._indexes].sort((a, b) => a - b);
    }
    get SelectedItems() {
        const a = this._array();
        return this.SelectedIndexes.map(i => a[i]).filter(v => v !== undefined);
    }
    IsSelected(index) {
        return this._indexes.has(index);
    }
    Select(index) {
        if (index < 0 || index >= this._array().length)
            return;
        this._setIndexes(this.SingleSelect ? [index] : [...this._indexes, index]);
        this.AnchorIndex = index;
    }
    Deselect(index) {
        this._setIndexes([...this._indexes].filter(i => i !== index));
    }
    Toggle(index) {
        this.IsSelected(index) ? this.Deselect(index) : this.Select(index);
    }
    SelectRange(start, end) {
        const min = Math.max(0, Math.min(start, end)), max = Math.min(this._array().length - 1, Math.max(start, end));
        this._setIndexes(this.SingleSelect ? [end] : Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => i + min));
    }
    SelectAll() {
        this._setIndexes(this.SingleSelect ? this._array().length ? [0] : [] : this._array().map((_, i) => i));
    }
    Clear() {
        this._setIndexes([]);
    }
    _array() {
        return Array.from(this._source ?? []);
    }
    _reconcile(previous) {
        const a = this._array();
        this._setIndexes(previous.map(v => a.indexOf(v)).filter(i => i >= 0));
    }
    _setIndexes(indexes) {
        const a = this._array();
        const next = new Set(indexes.filter(i => Number.isInteger(i) && i >= 0 && i < a.length));
        if (this.SingleSelect && next.size > 1) {
            const first = next.values().next().value;
            next.clear();
            next.add(first);
        }
        const oldIndexes = [...this._indexes], oldItems = this._selectedSnapshot ?? [];
        const nextItems = [...next].sort((x, y) => x - y).map(i => a[i]);
        if (next.size === this._indexes.size && [...next].every(i => this._indexes.has(i)) && nextItems.length === oldItems.length && nextItems.every((v, i) => v === oldItems[i]))
            return;
        this._indexes = next;
        this._selectedSnapshot = nextItems;
        const selected = nextItems.filter(v => !oldItems.includes(v)), deselected = oldItems.filter(v => !nextItems.includes(v));
        this.SelectionChanged.Raise(this, { SelectedIndexes: [...next].filter(i => !oldIndexes.includes(i)), DeselectedIndexes: oldIndexes.filter(i => !next.has(i)), SelectedItems: selected, DeselectedItems: deselected, OldItems: oldItems, NewItems: nextItems });
        if (oldItems.length && !nextItems.length)
            this.LostSelection.Raise(this, {});
    }
    Dispose() {
        this._collectionSubscription?.Dispose();
        this.SelectionChanged.Clear();
        this.LostSelection.Clear();
        super.Dispose();
    }
}
export class IndexPath {
    constructor(...indexes) {
        this.Indexes = indexes.flat();
    }
    get Count() {
        return this.Indexes.length;
    }
    GetAt(index) {
        return this.Indexes[index];
    }
    Append(index) {
        return new IndexPath(...this.Indexes, index);
    }
    Equals(other) {
        return other instanceof IndexPath && other.Count === this.Count && this.Indexes.every((v, i) => v === other.Indexes[i]);
    }
    CompareTo(other) {
        for (let i = 0; i < Math.min(this.Count, other.Count); i++)
            if (this.Indexes[i] !== other.Indexes[i])
                return this.Indexes[i] - other.Indexes[i];
        return this.Count - other.Count;
    }
    toString() {
        return this.Indexes.join('.');
    }
}
export class FuncDataTemplate {
    constructor(build, match = () => true) {
        this._build = build;
        this._match = match;
        this.SupportsRecycling = false;
    }
    Build(data, scope) {
        return this._build(data, scope);
    }
    Match(data) {
        return this._match(data);
    }
}
export class FuncTreeDataTemplate extends FuncDataTemplate {
    constructor(build, itemsSelector, match) {
        super(build, match);
        this.ItemsSelector = itemsSelector;
    }
    Items(data) {
        return this.ItemsSelector(data);
    }
}
