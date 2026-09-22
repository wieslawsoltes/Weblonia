import { Event, Disposable } from './disposable.js';
export const NotifyCollectionChangedAction = Object.freeze({ Add: 'Add', Remove: 'Remove', Replace: 'Replace', Move: 'Move', Reset: 'Reset' });
export class AvaloniaList {
    constructor(items = []) {
        this._items = Array.from(items);
        this.CollectionChanged = new Event();
        this.PropertyChanged = new Event();
        this._batch = 0;
        this._changed = false;
    }
    get Count() {
        return this._items.length;
    }
    get length() {
        return this.Count;
    }
    get Item() {
        return this._items;
    }
    Get(index) {
        return this._items[index];
    }
    Set(index, value) {
        this._check(index);
        const old = this._items[index];
        if (Object.is(old, value))
            return;
        this.ValidateMutation?.({ Action: 'Replace', NewItems: [value], OldItems: [old], NewStartingIndex: index, OldStartingIndex: index });
        this._items[index] = value;
        this._notify('Replace', [value], [old], index, index);
    }
    Add(value) {
        const i = this.Count;
        this.ValidateMutation?.({ Action: 'Add', NewItems: [value], OldItems: [], NewStartingIndex: i, OldStartingIndex: -1 });
        this._items.push(value);
        this._notify('Add', [value], [], i, -1);
        return i;
    }
    AddRange(values) {
        const a = Array.from(values);
        if (!a.length)
            return;
        const i = this.Count;
        this.ValidateMutation?.({ Action: 'Add', NewItems: a, OldItems: [], NewStartingIndex: i, OldStartingIndex: -1 });
        this._items.push(...a);
        this._notify('Add', a, [], i, -1);
    }
    Insert(index, value) {
        this._check(index, true);
        this.ValidateMutation?.({ Action: 'Add', NewItems: [value], OldItems: [], NewStartingIndex: index, OldStartingIndex: -1 });
        this._items.splice(index, 0, value);
        this._notify('Add', [value], [], index, -1);
    }
    InsertRange(index, values) {
        this._check(index, true);
        const a = Array.from(values);
        this.ValidateMutation?.({ Action: 'Add', NewItems: a, OldItems: [], NewStartingIndex: index, OldStartingIndex: -1 });
        this._items.splice(index, 0, ...a);
        if (a.length)
            this._notify('Add', a, [], index, -1);
    }
    Remove(value) {
        const i = this.IndexOf(value);
        if (i < 0)
            return false;
        this.RemoveAt(i);
        return true;
    }
    RemoveAt(index) {
        this._check(index);
        const old = this._items.splice(index, 1);
        this._notify('Remove', [], old, -1, index);
    }
    RemoveRange(index, count) {
        this._check(index, !count);
        if (!Number.isInteger(count) || count < 0 || index + count > this.Count)
            throw new RangeError('Invalid range.');
        const a = this._items.splice(index, count);
        if (a.length)
            this._notify('Remove', [], a, -1, index);
    }
    Move(oldIndex, newIndex) {
        this._check(oldIndex);
        this._check(newIndex);
        if (oldIndex === newIndex)
            return;
        const [item] = this._items.splice(oldIndex, 1);
        this._items.splice(newIndex, 0, item);
        this._notify('Move', [item], [item], newIndex, oldIndex);
    }
    Clear() {
        if (!this.Count)
            return;
        const a = this._items.splice(0);
        this._notify('Reset', [], a, -1, -1);
    }
    ReplaceAll(values) {
        const old = this._items, next = Array.from(values);
        this.ValidateMutation?.({ Action: 'Reset', NewItems: next, OldItems: old, NewStartingIndex: -1, OldStartingIndex: -1 });
        this._items = next;
        this._notify('Reset', this.ToArray(), old, -1, -1);
    }
    Contains(v) {
        return this._items.includes(v);
    }
    IndexOf(v) {
        return this._items.indexOf(v);
    }
    ToArray() {
        return this._items.slice();
    }
    [Symbol.iterator]() {
        return this._items[Symbol.iterator]();
    }
    forEach(fn) {
        this._items.forEach(fn);
    }
    map(fn) {
        return this._items.map(fn);
    }
    filter(fn) {
        return this._items.filter(fn);
    }
    BeginUpdate() {
        this._batch++;
        return Disposable.Create(() => {
            if (!--this._batch && this._changed) {
                this._changed = false;
                this._notify('Reset', this.ToArray(), [], -1, -1);
            }
        });
    }
    _check(i, end = false) {
        if (!Number.isInteger(i) || i < 0 || i >= this.Count + (end ? 1 : 0))
            throw new RangeError(`Index ${i} is outside the collection.`);
    }
    _notify(action, added, removed, newIndex, oldIndex) {
        if (this._batch) {
            this._changed = true;
            return;
        }
        this.CollectionChanged.Raise(this, { Action: action, NewItems: added, OldItems: removed, NewStartingIndex: newIndex, OldStartingIndex: oldIndex });
        if (action !== 'Move' && action !== 'Replace')
            this.PropertyChanged.Raise(this, { PropertyName: 'Count' });
        this.PropertyChanged.Raise(this, { PropertyName: 'Item[]' });
    }
}
export class ObservableCollection extends AvaloniaList {
}
export class AvaloniaDictionary extends Map {
    constructor(values) {
        super();
        this.CollectionChanged = new Event();
        if (values)
            for (const [k, v] of values)
                super.set(k, v);
    }
    get Count() {
        return this.size;
    }
    Add(k, v) {
        if (this.has(k))
            throw new Error(`Duplicate key '${String(k)}'.`);
        this.set(k, v);
    }
    set(k, v) {
        const had = this.has(k), old = this.get(k);
        super.set(k, v);
        this.CollectionChanged?.Raise(this, { Action: had ? 'Replace' : 'Add', Key: k, OldValue: old, NewValue: v });
        return this;
    }
    delete(k) {
        if (!this.has(k))
            return false;
        const old = this.get(k);
        super.delete(k);
        this.CollectionChanged.Raise(this, { Action: 'Remove', Key: k, OldValue: old });
        return true;
    }
    clear() {
        if (!this.size)
            return;
        super.clear();
        this.CollectionChanged.Raise(this, { Action: 'Reset' });
    }
    ContainsKey(k) {
        return this.has(k);
    }
    TryGetValue(k) {
        return { Found: this.has(k), Value: this.get(k) };
    }
    Remove(k) {
        return this.delete(k);
    }
    Clear() {
        this.clear();
    }
}
export class Classes extends Set {
    constructor(values = []) {
        super();
        this.Changed = new Event();
        for (const v of typeof values === 'string' ? values.split(/\s+/) : values)
            if (v)
                super.add(v);
    }
    Add(v) {
        this.add(v);
    }
    Remove(v) {
        return this.delete(v);
    }
    Contains(v) {
        return this.has(v);
    }
    add(v) {
        if (!this.has(v)) {
            super.add(v);
            this.Changed?.Raise(this, { Value: v, Added: true });
        }
        return this;
    }
    delete(v) {
        const r = super.delete(v);
        if (r)
            this.Changed?.Raise(this, { Value: v, Added: false });
        return r;
    }
    clear() {
        if (this.size) {
            super.clear();
            this.Changed?.Raise(this, {});
        }
    }
    Set(name, value) {
        value ? this.add(name) : this.delete(name);
    }
    Replace(values) {
        const next = new Set(typeof values === 'string' ? values.split(/\s+/).filter(Boolean) : values);
        if (next.size === this.size && [...next].every(x => this.has(x)))
            return;
        super.clear();
        for (const v of next)
            super.add(v);
        this.Changed.Raise(this, {});
    }
    toString() {
        return [...this].join(' ');
    }
}
