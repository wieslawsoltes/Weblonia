import { AvaloniaList, AvaloniaObject, Event, DefineProperties, DefineAttached, Size, Rect, Point, Matrix, MathUtilities, Thickness, CompositeDisposable } from '@wieslawsoltes/avalonia-base';
import { Pen } from '@wieslawsoltes/avalonia-media';
import { Control, BooleanValue } from './core.js';
export class Controls extends AvaloniaList {
}
export class Panel extends Control {
    constructor(children = []) {
        super();
        this.Children = new Controls();
        this._lifetime.Add(this.Children.CollectionChanged.Add(() => this._SyncChildren()));
        if (children.length)
            this.Children.AddRange(children);
    }
    _SyncChildren() {
        const desired = this.Children.ToArray();
        if (new Set(desired).size !== desired.length)
            throw new Error('Panel.Children cannot contain duplicate controls.');
        for (const old of [...this.VisualChildren])
            if (!desired.includes(old))
                this.RemoveVisualChild(old);
        for (const child of desired)
            this.AddVisualChild(child);
        this.VisualChildren = desired.slice();
        this.LogicalChildren = desired.slice();
        this.GetVisualRoot()?._InvalidateAutomation?.(this, true);
        this.InvalidateMeasure();
    }
    MeasureOverride(available) {
        let width = 0, height = 0;
        for (const child of this.Children) {
            child.Measure(available);
            width = Math.max(width, child.DesiredSize.Width);
            height = Math.max(height, child.DesiredSize.Height);
        }
        return new Size(width, height);
    }
    ArrangeOverride(size) {
        for (const child of this.Children)
            child.Arrange(new Rect(size));
        return size;
    }
}
export class StackPanel extends Panel {
    MeasureOverride(available) {
        const horizontal = this.Orientation === 'Horizontal';
        let main = 0, cross = 0, count = 0;
        for (const c of this.Children) {
            c.Measure(new Size(horizontal ? Infinity : available.Width, horizontal ? available.Height : Infinity));
            if (!c.IsVisible)
                continue;
            main += horizontal ? c.DesiredSize.Width : c.DesiredSize.Height;
            cross = Math.max(cross, horizontal ? c.DesiredSize.Height : c.DesiredSize.Width);
            count++;
        }
        main += Math.max(0, count - 1) * this.Spacing;
        return horizontal ? new Size(main, cross) : new Size(cross, main);
    }
    ArrangeOverride(size) {
        const horizontal = this.Orientation === 'Horizontal';
        let offset = 0;
        for (const c of this.Children) {
            const main = horizontal ? c.DesiredSize.Width : c.DesiredSize.Height;
            c.Arrange(horizontal ? new Rect(offset, 0, main, size.Height) : new Rect(0, offset, size.Width, main));
            if (c.IsVisible)
                offset += main + this.Spacing;
        }
        return size;
    }
}
DefineProperties(StackPanel, { Orientation: ['Vertical', { AffectsMeasure: true }], Spacing: [0, { Convert: Number, AffectsMeasure: true }] });
export class WrapPanel extends Panel {
    _Layout(available, arrange) {
        const horizontal = this.Orientation === 'Horizontal', max = horizontal ? available.Width : available.Height;
        let main = 0, cross = 0, lineCross = 0, maxMain = 0;
        const lines = [];
        let line = [];
        for (const child of this.Children) {
            if (!arrange)
                child.Measure(new Size(Number.isNaN(this.ItemWidth) ? available.Width : this.ItemWidth, Number.isNaN(this.ItemHeight) ? available.Height : this.ItemHeight));
            if (!child.IsVisible)
                continue;
            const width = Number.isNaN(this.ItemWidth) ? child.DesiredSize.Width : this.ItemWidth, height = Number.isNaN(this.ItemHeight) ? child.DesiredSize.Height : this.ItemHeight, cm = horizontal ? width : height, cc = horizontal ? height : width;
            if (line.length && main + this.ItemSpacing + cm > max) {
                lines.push({ Items: line, Main: main, Cross: lineCross, Offset: cross });
                maxMain = Math.max(main, maxMain);
                cross += lineCross + this.LineSpacing;
                main = 0;
                lineCross = 0;
                line = [];
            }
            if (line.length)
                main += this.ItemSpacing;
            line.push({ Child: child, Main: cm, Cross: cc, Offset: main });
            main += cm;
            lineCross = Math.max(lineCross, cc);
        }
        if (line.length) {
            lines.push({ Items: line, Main: main, Cross: lineCross, Offset: cross });
            maxMain = Math.max(main, maxMain);
            cross += lineCross;
        }
        if (arrange)
            for (const l of lines)
                for (const item of l.Items)
                    item.Child.Arrange(horizontal ? new Rect(item.Offset, l.Offset, item.Main, l.Cross) : new Rect(l.Offset, item.Offset, l.Cross, item.Main));
        return horizontal ? new Size(maxMain, cross) : new Size(cross, maxMain);
    }
    MeasureOverride(available) {
        return this._Layout(available, false);
    }
    ArrangeOverride(size) {
        this._Layout(size, true);
        return size;
    }
}
DefineProperties(WrapPanel, { Orientation: ['Horizontal', { AffectsMeasure: true }], ItemWidth: [NaN, { Convert: Number, AffectsMeasure: true }], ItemHeight: [NaN, { Convert: Number, AffectsMeasure: true }], ItemSpacing: [0, { Convert: Number, AffectsMeasure: true }], LineSpacing: [0, { Convert: Number, AffectsMeasure: true }] });
export class DockPanel extends Panel {
    MeasureOverride(available) {
        let consumedW = 0, consumedH = 0, width = 0, height = 0;
        for (const c of this.Children) {
            c.Measure(new Size(Math.max(0, available.Width - consumedW), Math.max(0, available.Height - consumedH)));
            const dock = DockPanel.GetDock(c);
            if (dock === 'Left' || dock === 'Right') {
                height = Math.max(height, consumedH + c.DesiredSize.Height);
                consumedW += c.DesiredSize.Width;
            }
            else {
                width = Math.max(width, consumedW + c.DesiredSize.Width);
                consumedH += c.DesiredSize.Height;
            }
        }
        return new Size(Math.max(width, consumedW), Math.max(height, consumedH));
    }
    ArrangeOverride(size) {
        let left = 0, top = 0, right = size.Width, bottom = size.Height;
        const children = this.Children.ToArray();
        for (let i = 0; i < children.length; i++) {
            const c = children[i], dock = DockPanel.GetDock(c), w = Math.max(0, right - left), h = Math.max(0, bottom - top);
            let r = new Rect(left, top, w, h);
            if (!(this.LastChildFill && i === children.length - 1)) {
                if (dock === 'Left') {
                    r.Width = Math.min(w, c.DesiredSize.Width);
                    left += r.Width;
                }
                else if (dock === 'Right') {
                    r.Width = Math.min(w, c.DesiredSize.Width);
                    right -= r.Width;
                    r.X = right;
                }
                else if (dock === 'Top') {
                    r.Height = Math.min(h, c.DesiredSize.Height);
                    top += r.Height;
                }
                else {
                    r.Height = Math.min(h, c.DesiredSize.Height);
                    bottom -= r.Height;
                    r.Y = bottom;
                }
            }
            c.Arrange(r);
        }
        return size;
    }
}
DefineProperties(DockPanel, { LastChildFill: [true, { Convert: BooleanValue, AffectsArrange: true }] });
DefineAttached(DockPanel, 'Dock', 'Left', { AffectsMeasure: true });
export class Canvas extends Panel {
    MeasureOverride() {
        for (const c of this.Children)
            c.Measure(Size.Infinity);
        return Size.Empty;
    }
    ArrangeOverride(size) {
        for (const c of this.Children) {
            const l = Canvas.GetLeft(c), t = Canvas.GetTop(c), r = Canvas.GetRight(c), b = Canvas.GetBottom(c);
            c.Arrange(new Rect(Number.isNaN(l) ? Number.isNaN(r) ? 0 : size.Width - c.DesiredSize.Width - r : l, Number.isNaN(t) ? Number.isNaN(b) ? 0 : size.Height - c.DesiredSize.Height - b : t, c.DesiredSize.Width, c.DesiredSize.Height));
        }
        return size;
    }
}
for (const name of ['Left', 'Top', 'Right', 'Bottom'])
    DefineAttached(Canvas, name, NaN, { Convert: Number, AffectsArrange: true });
export const GridUnitType = Object.freeze({ Auto: 'Auto', Pixel: 'Pixel', Star: 'Star' });
export class GridLength {
    static Auto = Object.freeze(new GridLength(1, 'Auto'));
    static Star = Object.freeze(new GridLength(1, 'Star'));
    constructor(value = 1, type = 'Pixel') {
        if (!Number.isFinite(value) || value < 0)
            throw new RangeError('GridLength must be finite and non-negative.');
        this.Value = value;
        this.GridUnitType = type;
    }
    get IsAuto() {
        return this.GridUnitType === 'Auto';
    }
    get IsStar() {
        return this.GridUnitType === 'Star';
    }
    get IsAbsolute() {
        return this.GridUnitType === 'Pixel';
    }
    static Parse(value) {
        if (value instanceof GridLength)
            return value;
        const s = String(value).trim();
        return s.toLowerCase() === 'auto' ? GridLength.Auto : s.endsWith('*') ? new GridLength(s.length === 1 ? 1 : Number(s.slice(0, -1)), 'Star') : new GridLength(Number(s));
    }
    toString() {
        return this.IsAuto ? 'Auto' : this.IsStar ? `${this.Value === 1 ? '' : this.Value}*` : String(this.Value);
    }
}
export class ColumnDefinition extends AvaloniaObject {
    constructor(width = GridLength.Star) {
        super();
        this.ActualWidth = 0;
        this.Width = width;
    }
}
DefineProperties(ColumnDefinition, { Width: [GridLength.Star, { Convert: GridLength.Parse }], MinWidth: [0, { Convert: Number }], MaxWidth: [Infinity, { Convert: Number }], SharedSizeGroup: [null] });
export class RowDefinition extends AvaloniaObject {
    constructor(height = GridLength.Star) {
        super();
        this.ActualHeight = 0;
        this.Height = height;
    }
}
DefineProperties(RowDefinition, { Height: [GridLength.Star, { Convert: GridLength.Parse }], MinHeight: [0, { Convert: Number }], MaxHeight: [Infinity, { Convert: Number }], SharedSizeGroup: [null] });
export class ColumnDefinitions extends AvaloniaList {
    constructor(value = []) {
        super(typeof value === 'string' ? value.split(/[, ]+/).filter(Boolean).map(v => new ColumnDefinition(GridLength.Parse(v))) : value);
    }
    static Parse(v) {
        return new ColumnDefinitions(v);
    }
}
export class RowDefinitions extends AvaloniaList {
    constructor(value = []) {
        super(typeof value === 'string' ? value.split(/[, ]+/).filter(Boolean).map(v => new RowDefinition(GridLength.Parse(v))) : value);
    }
    static Parse(v) {
        return new RowDefinitions(v);
    }
}
function allocate(tracks, available, gap, desired) {
    const sizes = tracks.map((t, i) => Math.max(t.Min, Math.min(t.Max, t.Length.IsAbsolute ? t.Length.Value : t.Length.IsAuto || !Number.isFinite(available) ? desired[i] : t.Min)));
    if (!Number.isFinite(available))
        return sizes;
    let remaining = Math.max(0, available - gap * Math.max(0, tracks.length - 1) - sizes.reduce((s, n) => s + n, 0));
    let active = tracks.map((t, i) => i).filter(i => tracks[i].Length.IsStar && tracks[i].Length.Value > 0 && sizes[i] < tracks[i].Max);
    while (remaining > .001 && active.length) {
        const weight = active.reduce((s, i) => s + tracks[i].Length.Value, 0);
        let used = 0;
        for (const i of active) {
            const delta = Math.min(tracks[i].Max - sizes[i], remaining * tracks[i].Length.Value / weight);
            sizes[i] += delta;
            used += delta;
        }
        remaining -= used;
        active = active.filter(i => sizes[i] + .001 < tracks[i].Max);
        if (used < .001)
            break;
    }
    return sizes;
}
function tracks(definitions, axis) {
    const list = definitions.Count ? definitions.ToArray() : [axis === 'Width' ? new ColumnDefinition() : new RowDefinition()];
    return list.map(d => ({ Definition: d, Length: d[axis], Min: d[`Min${axis}`], Max: d[`Max${axis}`] }));
}
function spanSize(sizes, index, span, gap) {
    return sizes.slice(index, index + span).reduce((s, n) => s + n, 0) + gap * Math.max(0, span - 1);
}
function applyDesired(t, desired, index, span, size, gap) {
    const have = spanSize(desired, index, span, gap), extra = size - have;
    if (extra <= 0)
        return;
    const eligible = Array.from({ length: span }, (_, i) => i + index).filter(i => !t[i].Length.IsAbsolute);
    if (!eligible.length)
        return;
    let left = extra, active = eligible;
    while (left > .001 && active.length) {
        let used = 0;
        const each = left / active.length;
        for (const i of active) {
            const add = Math.min(each, t[i].Max - desired[i]);
            desired[i] += add;
            used += add;
        }
        left -= used;
        active = active.filter(i => desired[i] + .001 < t[i].Max);
        if (used < .001)
            break;
    }
}
export class Grid extends Panel {
    constructor(children = []) {
        super(children);
        this._definitionSubscriptions = new CompositeDisposable();
        this._columnDefinitions = new ColumnDefinitions();
        this._rowDefinitions = new RowDefinitions();
        this._WireDefinitions();
    }
    get ColumnDefinitions() {
        return this._columnDefinitions;
    }
    set ColumnDefinitions(value) {
        this._columnDefinitions = value instanceof ColumnDefinitions ? value : new ColumnDefinitions(value);
        this._WireDefinitions();
    }
    get RowDefinitions() {
        return this._rowDefinitions;
    }
    set RowDefinitions(value) {
        this._rowDefinitions = value instanceof RowDefinitions ? value : new RowDefinitions(value);
        this._WireDefinitions();
    }
    _WireDefinitions() {
        if (!this._columnDefinitions || !this._rowDefinitions)
            return;
        this._definitionSubscriptions?.Clear();
        for (const list of [this._columnDefinitions, this._rowDefinitions]) {
            this._definitionSubscriptions.Add(list.CollectionChanged.Add(() => this._WireDefinitions()));
            for (const d of list)
                this._definitionSubscriptions.Add(d.PropertyChanged.Add(() => this.InvalidateMeasure()));
        }
        this.InvalidateMeasure();
    }
    _Cell(child, cols, rows) {
        const col = MathUtilities.Clamp(Grid.GetColumn(child), 0, cols - 1), row = MathUtilities.Clamp(Grid.GetRow(child), 0, rows - 1);
        return { Col: col, Row: row, ColSpan: MathUtilities.Clamp(Grid.GetColumnSpan(child), 1, cols - col), RowSpan: MathUtilities.Clamp(Grid.GetRowSpan(child), 1, rows - row) };
    }
    MeasureOverride(available) {
        const ct = tracks(this.ColumnDefinitions, 'Width'), rt = tracks(this.RowDefinitions, 'Height');
        let cd = ct.map(t => t.Length.IsAbsolute ? MathUtilities.Clamp(t.Length.Value, t.Min, t.Max) : t.Min), rd = rt.map(t => t.Length.IsAbsolute ? MathUtilities.Clamp(t.Length.Value, t.Min, t.Max) : t.Min);
        for (let pass = 0; pass < 3; pass++) {
            const cw = allocate(ct, available.Width, this.ColumnSpacing, cd), rh = allocate(rt, available.Height, this.RowSpacing, rd);
            for (const child of this.Children) {
                const c = this._Cell(child, ct.length, rt.length);
                const autoW = ct.slice(c.Col, c.Col + c.ColSpan).every(t => t.Length.IsAuto || (!Number.isFinite(available.Width) && t.Length.IsStar)), autoH = rt.slice(c.Row, c.Row + c.RowSpan).every(t => t.Length.IsAuto || (!Number.isFinite(available.Height) && t.Length.IsStar));
                child.Measure(new Size(autoW ? Infinity : spanSize(cw, c.Col, c.ColSpan, this.ColumnSpacing), autoH ? Infinity : spanSize(rh, c.Row, c.RowSpan, this.RowSpacing)));
                applyDesired(ct, cd, c.Col, c.ColSpan, child.DesiredSize.Width, this.ColumnSpacing);
                applyDesired(rt, rd, c.Row, c.RowSpan, child.DesiredSize.Height, this.RowSpacing);
            }
        }
        this._columnDesired = cd;
        this._rowDesired = rd;
        return new Size(cd.reduce((s, x) => s + x, 0) + this.ColumnSpacing * Math.max(0, ct.length - 1), rd.reduce((s, x) => s + x, 0) + this.RowSpacing * Math.max(0, rt.length - 1));
    }
    ArrangeOverride(size) {
        const ct = tracks(this.ColumnDefinitions, 'Width'), rt = tracks(this.RowDefinitions, 'Height');
        const cw = allocate(ct, size.Width, this.ColumnSpacing, this._columnDesired ?? ct.map(() => 0)), rh = allocate(rt, size.Height, this.RowSpacing, this._rowDesired ?? rt.map(() => 0));
        this._columnActual = cw;
        this._rowActual = rh;
        ct.forEach((t, i) => t.Definition.ActualWidth = cw[i]);
        rt.forEach((t, i) => t.Definition.ActualHeight = rh[i]);
        for (const child of this.Children) {
            const c = this._Cell(child, ct.length, rt.length);
            child.Arrange(new Rect(spanSize(cw, 0, c.Col, this.ColumnSpacing) + (c.Col ? this.ColumnSpacing : 0), spanSize(rh, 0, c.Row, this.RowSpacing) + (c.Row ? this.RowSpacing : 0), spanSize(cw, c.Col, c.ColSpan, this.ColumnSpacing), spanSize(rh, c.Row, c.RowSpan, this.RowSpacing)));
        }
        return size;
    }
    RenderAfter(ctx) {
        super.RenderAfter(ctx);
        if (!this.ShowGridLines)
            return;
        const pen = new Pen(this.Palette.Border, 1);
        let x = 0, y = 0;
        for (const w of this._columnActual ?? []) {
            x += w;
            ctx.DrawLine(pen, new Point(x, 0), new Point(x, this.Bounds.Height));
            x += this.ColumnSpacing;
        }
        for (const h of this._rowActual ?? []) {
            y += h;
            ctx.DrawLine(pen, new Point(0, y), new Point(this.Bounds.Width, y));
            y += this.RowSpacing;
        }
    }
    Dispose() {
        this._definitionSubscriptions.Dispose();
        super.Dispose();
    }
}
for (const [name, initial] of [['Row', 0], ['Column', 0], ['RowSpan', 1], ['ColumnSpan', 1]])
    DefineAttached(Grid, name, initial, { Convert: v => Math.max(initial === 1 ? 1 : 0, Math.trunc(Number(v))), AffectsMeasure: true });
DefineProperties(Grid, { ShowGridLines: [false, { Convert: BooleanValue }], RowSpacing: [0, { Convert: Number, AffectsMeasure: true }], ColumnSpacing: [0, { Convert: Number, AffectsMeasure: true }] });
export class UniformGrid extends Panel {
    _Counts() {
        const count = Math.max(1, this.Children.Count + this.FirstColumn), rows = this.Rows || (this.Columns ? Math.ceil(count / this.Columns) : Math.ceil(Math.sqrt(count))), cols = this.Columns || Math.ceil(count / rows);
        return [rows, cols];
    }
    MeasureOverride(available) {
        const [rows, cols] = this._Counts();
        let w = 0, h = 0;
        for (const c of this.Children) {
            c.Measure(new Size(available.Width / cols, available.Height / rows));
            w = Math.max(w, c.DesiredSize.Width);
            h = Math.max(h, c.DesiredSize.Height);
        }
        return new Size(w * cols, h * rows);
    }
    ArrangeOverride(size) {
        const [rows, cols] = this._Counts(), w = size.Width / cols, h = size.Height / rows;
        let index = this.FirstColumn;
        for (const c of this.Children) {
            c.Arrange(new Rect(index % cols * w, Math.floor(index / cols) * h, w, h));
            index++;
        }
        return size;
    }
}
DefineProperties(UniformGrid, { Rows: [0, { Convert: Number, AffectsMeasure: true }], Columns: [0, { Convert: Number, AffectsMeasure: true }], FirstColumn: [0, { Convert: Number, AffectsMeasure: true }] });
export class RelativePanel extends Panel {
    _Arrange(size, arrange) {
        const result = new Map(), visiting = new Set();
        const children = this.Children.ToArray();
        const resolve = child => {
            if (result.has(child))
                return result.get(child);
            if (visiting.has(child))
                throw new Error('RelativePanel dependency cycle.');
            visiting.add(child);
            let x = 0, y = 0, w = child.DesiredSize.Width, h = child.DesiredSize.Height;
            const target = name => {
                let t = RelativePanel[`Get${name}`](child);
                if (typeof t === 'string')
                    t = children.find(c => c.Name === t);
                if (t && !children.includes(t))
                    throw new Error(`RelativePanel.${name} target is not a sibling.`);
                return t ? resolve(t) : null;
            };
            const rightOf = target('RightOf'), leftOf = target('LeftOf'), below = target('Below'), above = target('Above'), left = target('AlignLeftWith'), top = target('AlignTopWith'), right = target('AlignRightWith'), bottom = target('AlignBottomWith');
            if (rightOf)
                x = rightOf.Right;
            if (below)
                y = below.Bottom;
            if (left)
                x = left.Left;
            if (top)
                y = top.Top;
            if (leftOf)
                x = leftOf.Left - w;
            if (above)
                y = above.Top - h;
            if (right)
                x = right.Right - w;
            if (bottom)
                y = bottom.Bottom - h;
            if (RelativePanel.GetAlignRightWithPanel(child))
                x = size.Width - w;
            if (RelativePanel.GetAlignBottomWithPanel(child))
                y = size.Height - h;
            if (RelativePanel.GetAlignHorizontalCenterWithPanel(child))
                x = (size.Width - w) / 2;
            if (RelativePanel.GetAlignVerticalCenterWithPanel(child))
                y = (size.Height - h) / 2;
            if (RelativePanel.GetAlignLeftWithPanel(child)) {
                if (RelativePanel.GetAlignRightWithPanel(child))
                    w = size.Width;
                x = 0;
            }
            if (RelativePanel.GetAlignTopWithPanel(child)) {
                if (RelativePanel.GetAlignBottomWithPanel(child))
                    h = size.Height;
                y = 0;
            }
            const rect = new Rect(x, y, w, h);
            result.set(child, rect);
            visiting.delete(child);
            if (arrange)
                child.Arrange(rect);
            return rect;
        };
        for (const c of children)
            resolve(c);
        return new Size(Math.max(0, ...[...result.values()].map(r => r.Right)), Math.max(0, ...[...result.values()].map(r => r.Bottom)));
    }
    MeasureOverride(size) {
        for (const c of this.Children)
            c.Measure(size);
        return this._Arrange(new Size(Number.isFinite(size.Width) ? size.Width : 0, Number.isFinite(size.Height) ? size.Height : 0), false);
    }
    ArrangeOverride(size) {
        this._Arrange(size, true);
        return size;
    }
}
for (const name of ['RightOf', 'LeftOf', 'Above', 'Below', 'AlignLeftWith', 'AlignTopWith', 'AlignRightWith', 'AlignBottomWith'])
    DefineAttached(RelativePanel, name, null, { AffectsMeasure: true });
for (const name of ['AlignLeftWithPanel', 'AlignTopWithPanel', 'AlignRightWithPanel', 'AlignBottomWithPanel', 'AlignHorizontalCenterWithPanel', 'AlignVerticalCenterWithPanel'])
    DefineAttached(RelativePanel, name, false, { Convert: BooleanValue, AffectsMeasure: true });
export class Flex extends AvaloniaObject {
}
DefineAttached(Flex, 'Grow', 0, { Convert: Number, AffectsMeasure: true });
DefineAttached(Flex, 'Shrink', 1, { Convert: Number, AffectsMeasure: true });
DefineAttached(Flex, 'Basis', NaN, { Convert: Number, AffectsMeasure: true });
DefineAttached(Flex, 'Order', 0, { Convert: Number, AffectsMeasure: true });
DefineAttached(Flex, 'AlignSelf', 'Auto', { AffectsArrange: true });
export class FlexPanel extends Panel {
    _Layout(size, arrange) {
        const horizontal = this.Direction.startsWith('Row'), reverse = this.Direction.endsWith('Reverse'), max = horizontal ? size.Width : size.Height, children = this.Children.ToArray().filter(c => c.IsVisible).sort((a, b) => Flex.GetOrder(a) - Flex.GetOrder(b));
        if (reverse)
            children.reverse();
        const lines = [];
        let line = [], used = 0;
        for (const c of children) {
            if (!arrange)
                c.Measure(new Size(horizontal ? Infinity : size.Width, horizontal ? size.Height : Infinity));
            const basis = Flex.GetBasis(c), main = Number.isNaN(basis) ? horizontal ? c.DesiredSize.Width : c.DesiredSize.Height : basis, cross = horizontal ? c.DesiredSize.Height : c.DesiredSize.Width;
            if (this.Wrap !== 'NoWrap' && line.length && used + this.Gap + main > max) {
                lines.push(line);
                line = [];
                used = 0;
            }
            line.push({ c, main, cross });
            used += main + (line.length > 1 ? this.Gap : 0);
        }
        if (line.length)
            lines.push(line);
        let crossOffset = 0, desiredMain = 0;
        for (const items of lines) {
            const natural = items.reduce((s, i) => s + i.main, 0) + this.Gap * Math.max(0, items.length - 1), free = Number.isFinite(max) ? max - natural : 0;
            const total = items.reduce((s, i) => s + (free >= 0 ? Flex.GetGrow(i.c) : Flex.GetShrink(i.c) * i.main), 0);
            const cross = Math.max(0, ...items.map(i => i.cross), this.Wrap === 'NoWrap' && arrange ? horizontal ? size.Height : size.Width : 0);
            let mainOffset = total || !arrange ? 0 : this.JustifyContent === 'Center' ? free / 2 : this.JustifyContent === 'FlexEnd' ? free : 0;
            const gap = this.Gap + (!total && arrange && free > 0 && this.JustifyContent === 'SpaceBetween' && items.length > 1 ? free / (items.length - 1) : 0);
            for (const item of items) {
                const weight = free >= 0 ? Flex.GetGrow(item.c) : Flex.GetShrink(item.c) * item.main, length = Math.max(0, item.main + (arrange && total ? free * weight / total : 0));
                const align = Flex.GetAlignSelf(item.c) === 'Auto' ? this.AlignItems : Flex.GetAlignSelf(item.c), cs = align === 'Stretch' ? cross : item.cross, offset = align === 'Center' ? (cross - cs) / 2 : align === 'FlexEnd' ? cross - cs : 0;
                if (arrange)
                    item.c.Arrange(horizontal ? new Rect(mainOffset, crossOffset + offset, length, cs) : new Rect(crossOffset + offset, mainOffset, cs, length));
                mainOffset += length + gap;
            }
            crossOffset += cross + this.Gap;
            desiredMain = Math.max(desiredMain, natural);
        }
        const cross = Math.max(0, crossOffset - this.Gap);
        return horizontal ? new Size(desiredMain, cross) : new Size(cross, desiredMain);
    }
    MeasureOverride(size) {
        return this._Layout(size, false);
    }
    ArrangeOverride(size) {
        this._Layout(size, true);
        return size;
    }
}
DefineProperties(FlexPanel, { Direction: ['Row', { AffectsMeasure: true }], Wrap: ['NoWrap', { AffectsMeasure: true }], AlignItems: ['Stretch', { AffectsArrange: true }], JustifyContent: ['FlexStart', { AffectsArrange: true }], Gap: [0, { Convert: Number, AffectsMeasure: true }] });
