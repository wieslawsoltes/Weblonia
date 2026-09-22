import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';

const layout = (control, width = 500, height = 240) => { const root = new HeadlessTopLevel(new A.Size(width,height)); root.Content = control; root.Layout(); return root; };
test('Automation peers are cached, dispatch notifications, and release owner subscriptions', () => {
    const b = new A.Button('Send'); assert.equal(A.ControlAutomationPeer.FromElement(b), null);
    const count = b.PropertyChanged.Count, p = A.ControlAutomationPeer.CreatePeerForElement(b);
    assert.ok(p instanceof A.ButtonAutomationPeer); assert.equal(b.GetOrCreateAutomationPeer(), p);
    const events = []; p.PropertyChanged.Add((_,e) => events.push(e.Property)); b.Content = 'Sent';
    assert.equal(p.GetName(), 'Sent'); assert.ok(events.includes('Content')); assert.ok(b.PropertyChanged.Count > count);
    b.Dispose(); assert.equal(p.IsDisposed, true); assert.throws(() => p.Invoke(), A.ElementNotAvailableException);
});
test('Automation XAML metadata, labeled-by cycles and custom peer overrides', () => {
    const xaml = '<StackPanel xmlns="https://github.com/avaloniaui"><TextBlock Name="Caption" Text="Full name"/><TextBox AutomationProperties.Name="Customer" AutomationProperties.HelpText="Enter a name"/></StackPanel>';
    const panel = new A.AvaloniaXamlCompiler().Compile(xaml).Build(); const text = panel.Children.Get(1), peer = text.GetOrCreateAutomationPeer();
    assert.equal(peer.GetName(), 'Customer'); assert.equal(peer.GetHelpText(), 'Enter a name');
    A.AutomationProperties.SetName(text, ''); A.AutomationProperties.SetLabeledBy(text, panel.Children.Get(0)); assert.equal(peer.GetName(), 'Full name');
    A.AutomationProperties.SetLabeledBy(panel.Children.Get(0), text); assert.equal(peer.GetName(), 'Full name');
    class Custom extends A.Button { OnCreateAutomationPeer() { const peer = new A.ButtonAutomationPeer(this); peer.GetNameCore = () => 'Custom contract'; return peer; } }
    const custom = new Custom(); assert.equal(custom.GetOrCreateAutomationPeer().GetName(), 'Custom contract'); panel.Dispose(); custom.Dispose();
});
test('Invoke/toggle/radio providers enforce disabled and mutually exclusive behavior', () => {
    const stack = new A.StackPanel(), b = new A.Button('Push'), c = new A.CheckBox(), r1 = new A.RadioButton(), r2 = new A.RadioButton(); stack.Children.AddRange([b,c,r1,r2]);
    let clicks = 0; b.Click.Add(() => clicks++); const p = b.GetOrCreateAutomationPeer(); p.GetPattern('IInvokeProvider').Invoke(); assert.equal(clicks, 1);
    b.IsEnabled = false; assert.throws(() => p.Invoke(), A.ElementNotEnabledException); assert.equal(clicks, 1);
    c.GetOrCreateAutomationPeer().Toggle(); assert.equal(c.IsChecked, true);
    const one = r1.GetOrCreateAutomationPeer(), two = r2.GetOrCreateAutomationPeer(); one.Select(); two.Select(); assert.equal(r1.IsChecked, false); assert.equal(r2.IsChecked, true);
    assert.equal(one.GetPattern('Toggle'), null); assert.throws(() => two.RemoveFromSelection()); stack.Dispose();
});
test('Value and range providers preserve password privacy and read-only/range contracts', () => {
    const text = new A.TextBox(), p = text.GetOrCreateAutomationPeer(); p.SetValue('confidential'); assert.equal(text.Text, 'confidential');
    text.PasswordChar = '*'; assert.equal(p.Value, ''); assert.equal(p.IsPassword(), true);
    assert.equal(JSON.stringify(A.GetAutomationAriaProperties(p)).includes('confidential'), false);
    text.IsReadOnly = true; assert.throws(() => p.SetValue('bad'), /read-only/); assert.equal(text.Text, 'confidential');
    const slider = new A.Slider(), sp = slider.GetOrCreateAutomationPeer(); sp.SetValue(35); assert.equal(slider.Value, 35); assert.throws(() => sp.SetValue(101), RangeError); assert.throws(() => sp.SetValue(NaN), RangeError);
    const progress = new A.ProgressBar(); assert.throws(() => progress.GetOrCreateAutomationPeer().SetValue(50), /read-only/);
    text.Dispose(); slider.Dispose(); progress.Dispose();
});
test('Selection peers represent offscreen items without allocating the whole list', () => {
    const list = new A.ListBox(); list.ItemsSource = Array.from({length:10000},(_,i) => ({Name:'Item '+i})); const root = layout(list);
    list.SelectedIndex = 8000; const peer = list.GetOrCreateAutomationPeer(), selected = peer.GetSelection()[0];
    assert.ok(selected instanceof A.VirtualizedItemAutomationPeer); assert.equal(selected.GetName(), 'Item 8000'); assert.equal(selected.IsSelected, true);
    assert.ok(list.GetRealizedContainers().length < 30); selected.Realize(); root.Layout();
    assert.ok(peer.GetSelection()[0] instanceof A.ListBoxItemAutomationPeer); assert.ok(list.GetRealizedContainers().length < 30);
    const live = peer.GetSelection()[0]; live.RemoveFromSelection(); assert.equal(list.SelectedIndex,-1);
    root.Dispose(); assert.throws(() => selected.Select(), A.ElementNotAvailableException);
});
test('Table automation exposes actual headers, rows, grid cell identity and current row indices', () => {
    const table = new A.TableView(); table.Columns.AddRange([new A.TableViewColumn('Name','Name'),new A.TableViewColumn('Age','Age')]);
    table.ItemsSource = Array.from({length:10000},(_,i) => ({Name:'Person '+i,Age:i})); const root = layout(table);
    const peer = table.GetOrCreateAutomationPeer(); assert.equal(peer.RowCount,10000); assert.equal(peer.ColumnCount,2); assert.equal(peer.GetColumnHeaders()[0].GetName(),'Name');
    const cell = peer.GetItem(6000,1); assert.equal(cell.Row,6000); assert.equal(cell.Column,1); assert.equal(cell.GetName(),'6000'); assert.equal(cell.ContainingGrid,peer);
    assert.equal(cell.GetColumnHeaderItems()[0].GetName(),'Age'); assert.equal(A.GetAutomationAriaProperties(cell)['aria-rowindex'],'6002');
    assert.ok(table.RealizedRowCount < 30); assert.throws(() => peer.GetItem(-1,1), RangeError);
    const row = table.ContainerFromIndex(6000).GetOrCreateAutomationPeer(); row.Select(); assert.equal(table.SelectedIndex,6000); assert.equal(row.GetChildren().length,2);
    root.Dispose();
});
test('Tree expansion peers update underlying hierarchy and report sibling positions', () => {
    const tree = new A.TreeView(); tree.ItemsSource = [{Name:'A',Children:[{Name:'A1'},{Name:'A2'}]},{Name:'B'}]; const root = layout(tree);
    let p = tree.ContainerFromIndex(0).GetOrCreateAutomationPeer(); assert.equal(p.ExpandCollapseState,A.ExpandCollapseState.Collapsed); p.Expand(); root.Layout();
    assert.equal(tree.ItemsView.length,4); const child = tree.ContainerFromIndex(2).GetOrCreateAutomationPeer(), aria = A.GetAutomationAriaProperties(child);
    assert.equal(aria['aria-level'],'2'); assert.equal(aria['aria-posinset'],'2'); assert.equal(aria['aria-setsize'],'2'); assert.equal(child.ExpandCollapseState,A.ExpandCollapseState.LeafNode);
    p = tree.ContainerFromIndex(0).GetOrCreateAutomationPeer(); p.Collapse(); root.Layout(); assert.equal(tree.ItemsView.length,2); root.Dispose();
});
test('Scroll and clipping automation use measured viewport and enforce unsupported axes', () => {
    const content = new A.Border(); content.Height = 1200; const scroll = new A.ScrollViewer(content), root = layout(scroll,300,200), peer = scroll.GetOrCreateAutomationPeer();
    assert.equal(peer.VerticallyScrollable,true); assert.equal(peer.HorizontallyScrollable,false);
    peer.SetScrollPercent(-1,50); root.Layout(); assert.equal(scroll.Offset.Y,500); assert.equal(peer.VerticalScrollPercent,50);
    assert.throws(() => peer.SetScrollPercent(20,-1),RangeError); assert.throws(() => peer.SetScrollPercent(-1,NaN),RangeError);
    const box = content.GetOrCreateAutomationPeer().GetBoundingRectangle(); assert.equal(box.Height,200); assert.equal(box.Width,300); root.Dispose();
});
test('Visual adoption rejects a conflicting logical parent without a partial mutation', () => {
    const a = new A.Control(), b = new A.Control(), child = new A.Control(); child._parent = a;
    assert.throws(() => b.AddVisualChild(child), /logical parent/); assert.equal(child.VisualParent,null); assert.equal(b.VisualChildren.length,0);
    child._parent = null; a.Dispose(); b.Dispose(); child.Dispose();
});
