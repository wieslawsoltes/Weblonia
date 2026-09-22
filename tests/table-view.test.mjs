import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';
import { ReactiveObject } from '@wieslawsoltes/reactiveweb';
const arrange = (table, width = 600, height = 280) => { table.Measure(new A.Size(width, height)); table.Arrange(new A.Rect(0, 0, width, height)); };
const cell = (table, row = 0, column = 0) => table.ContainerFromIndex(row)?.CellsPresenter.Children.Get(column);
test('TableView is a ListBox with live read-only Binding definitions and actual cell controls', () => {
    const model = new ReactiveObject({ Name: 'Ada', Checked: true });
    const table = new A.TableView(); table.AutoGenerateColumns = false;
    const col = new A.TableViewColumn('Name', new A.Binding('Name'));
    table.Columns.Add(col); table.ItemsSource = [model]; arrange(table);
    assert.ok(table instanceof A.ListBox); assert.ok(cell(table) instanceof A.TableViewCell);
    assert.equal(cell(table).Content, 'Ada'); assert.equal(col.TableView, table); assert.equal(col.Parent, table);
    model.Name = 'Grace'; assert.equal(cell(table).Content, 'Grace');
    cell(table).Content = 'local'; assert.equal(model.Name, 'Grace');
    table.Dispose(); assert.equal(col.TableView, null); model.Dispose();
});
test('TableView XAML assigns Binding rather than evaluating on the column DataContext', () => {
    const table = new A.AvaloniaXamlCompiler().Compile(`<TableView xmlns="https://github.com/avaloniaui"><TableView.Columns><TableViewColumn Header="Name" Binding="{Binding Name}" Width="2*"/></TableView.Columns></TableView>`).Build();
    const col = table.Columns.Get(0); assert.ok(col.Binding instanceof A.Binding); assert.equal(col.Binding.Path, 'Name');
    table.ItemsSource = [{ Name: 'Katherine' }]; arrange(table);
    assert.equal(cell(table).Content, 'Katherine'); assert.equal(col.Width.Value, 2); table.Dispose();
});
test('TableView CellTemplate receives row data and takes precedence over Binding', () => {
    const table = new A.TableView(), model = { Name: 'row' }; table.AutoGenerateColumns = false;
    const col = new A.TableViewColumn('Name', 'Missing'); let built = 0;
    col.CellTemplate = new A.DataTemplate(item => { built++; return new A.TextBlock('Template: ' + item.Name); });
    table.Columns.Add(col); table.ItemsSource = [model]; arrange(table);
    assert.equal(cell(table).Content, model); assert.equal(cell(table).Presenter.Text, 'Template: row');
    assert.ok(built >= 1); table.Dispose();
});
test('TableView rejects duplicate or cross-owned columns before mutating collections', () => {
    const one = new A.TableView(), two = new A.TableView(), c = new A.TableViewColumn();
    one.Columns.Add(c); assert.throws(() => one.Columns.Add(c), /Duplicate/); assert.equal(one.Columns.Count, 1);
    assert.throws(() => two.Columns.Add(c), /already belongs/); assert.equal(two.Columns.Count, 0);
    const old = one.Columns; one.Columns = new A.AvaloniaList(); assert.equal(c.TableView, null);
    two.Columns.Add(c); assert.equal(c.TableView, two); assert.equal(old.ValidateMutation, undefined);
    assert.throws(() => two.Columns.Set(0, new A.TextBlock()), /TableViewColumn/); assert.equal(two.Columns.Get(0), c);
    one.Dispose(); two.Dispose();
});
test('TableView star, auto, pixel and constrained column widths share one row/header layout', () => {
    const table = new A.TableView(); table.AutoGenerateColumns = false;
    const columns = [new A.TableViewColumn('Fixed', 'A', 100), new A.TableViewColumn('Auto', 'B', 'Auto'), new A.TableViewColumn('Star', 'C', '*'), new A.TableViewColumn('Two', 'D', '2*')];
    columns[2].MaxWidth = 90; table.Columns.AddRange(columns); table.ItemsSource = [{ A: 1, B: 'Long automatic text', C: 3, D: 4 }]; arrange(table, 700);
    assert.equal(columns[0].ActualWidth, 100); assert.ok(columns[1].ActualWidth > 50); assert.equal(columns[2].ActualWidth, 90);
    assert.ok(Math.abs(columns.reduce((s, c) => s + c.ActualWidth, 0) - 700) < .001);
    const cells = table.ContainerFromIndex(0).CellsPresenter.Children;
    for (let i = 0; i < 4; ++i) assert.equal(cells.Get(i).Bounds.Width, table.HeadersPresenter.Children.Get(i).Bounds.Width);
    columns[1].IsVisible = false; arrange(table); assert.equal(cells.Count, 3); table.Dispose();
});
test('TableView 10,000 rows recycle real cell containers and release stale bindings', () => {
    const models = Array.from({ length: 10000 }, (_, i) => new ReactiveObject({ Name: `row-${i}` }));
    const table = new A.TableView(); table.Columns.Add(new A.TableViewColumn('Name', 'Name')); table.ItemsSource = models; arrange(table);
    const firstRows = new Set(table.GetRealizedContainers()); const firstCell = cell(table); assert.equal(firstCell.Content, 'row-0');
    table.ScrollIntoView(5000); arrange(table); const realized = table.GetRealizedContainers();
    assert.ok(realized.length < 30); assert.ok(realized.some(r => firstRows.has(r))); assert.equal(cell(table, 5000).Content, 'row-5000');
    const previous = firstCell.Content; models[0].Name = 'obsolete'; assert.equal(firstCell.Content, previous);
    table.Dispose(); for (const m of models) m.Dispose();
});
test('TableView checkbox cell subscriptions and controls are disposed when recycled', () => {
    const a = new ReactiveObject({ Checked: true }), b = new ReactiveObject({ Checked: false });
    const column = new A.TableViewCheckBoxColumn('Active', 'Checked'); const c = new A.TableViewCell();
    c.Prepare(column, a); const old = c.Content; assert.equal(old.IsChecked, true);
    c.Prepare(column, b); assert.equal(old.IsDisposed, true); assert.equal(c.Content.IsChecked, false);
    b.Checked = true; assert.equal(c.Content.IsChecked, true); c.Clear(); assert.equal(c.Content, null);
    c.Dispose(); a.Dispose(); b.Dispose();
});
test('TableView header click sorting preserves selection identity and can be cancelled', () => {
    const host = new HeadlessTopLevel(new A.Size(600, 300)); const table = new A.TableView(); host.Content = table;
    const col = new A.TableViewColumn('Name', 'Name'); table.Columns.Add(col);
    const b = { Name: 'B' }, a = { Name: 'A' }; table.ItemsSource = [b, a]; table.SelectedIndex = 0; host.Layout();
    host.Click(new A.Point(25, 18)); host.Layout(); assert.equal(col.SortDirection, 'Ascending'); assert.equal(table.ItemsView[0], a);
    assert.equal(table.SelectedItem, b); assert.equal(table.SelectedIndex, 1);
    const d = table.Sorting.Add((_, e) => { e.Cancel = true; }); table.SortBy(col); assert.equal(col.SortDirection, 'Ascending');
    d.Dispose(); host.Dispose();
});
test('TableView nullable resize override respects owning table changes', () => {
    const table = new A.TableView(), col = new A.TableViewColumn(); table.Columns.Add(col);
    assert.equal(col.CanUserEffectivelyResize, true); table.CanUserResizeColumns = false; assert.equal(col.CanUserEffectivelyResize, false);
    col.CanUserResize = true; assert.equal(col.CanUserEffectivelyResize, true); col.CanUserResize = null; assert.equal(col.CanUserEffectivelyResize, false);
    table.Dispose(); assert.equal(col.CanUserEffectivelyResize, true);
});
