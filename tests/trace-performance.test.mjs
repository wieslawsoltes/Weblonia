import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';
import { ReactiveObject } from '@wieslawsoltes/reactiveweb';
import { BehaviorSubject } from 'rxjs';

const tree = () => {
    class Owner extends A.AvaloniaObject {}
    const property = A.AvaloniaProperty.Register(Owner, 'Inherited', 7, { Inherits: true });
    const root = new Owner(), child = new Owner(), leaf = new Owner();
    child.SetInheritanceParent(root); leaf.SetInheritanceParent(child);
    return { Owner, property, root, child, leaf, dispose() { leaf.Dispose(); child.Dispose(); root.Dispose(); } };
};

test('property cache: repeated inherited reads do not resolve metadata or priorities again', () => {
    const t = tree(); t.root.SetValue(t.property, 42); assert.equal(t.leaf.GetValue(t.property), 42);
    const original = t.property.GetMetadata; let metadata = 0;
    t.property.GetMetadata = function(type) { metadata++; return original.call(this, type); };
    for (let i = 0; i < 10000; ++i) assert.equal(t.leaf.GetValue(t.property), 42);
    assert.equal(metadata, 0); t.property.GetMetadata = original; t.dispose();
});
test('property cache: parent handlers immediately observe fresh descendant values', () => {
    const t = tree(); t.leaf.GetValue(t.property); let observed;
    t.root.PropertyChanged.Add((_, e) => { if (e.Property === t.property) observed = t.leaf.GetValue(t.property); });
    t.root.SetValue(t.property, 8); assert.equal(observed, 8); assert.equal(t.leaf.GetValue(t.property), 8); t.dispose();
});
test('property cache: reparent notifications see all newly inherited descendant properties', () => {
    const t = tree(); const second = A.AvaloniaProperty.Register(t.Owner, 'Other', 3, { Inherits: true });
    const other = new t.Owner(); other.SetValue(t.property, 100); other.SetValue(second, 200);
    t.leaf.GetValue(t.property); t.leaf.GetValue(second); let observed;
    t.child.PropertyChanged.Add((_, e) => { if (e.Property === t.property) observed = [t.leaf.GetValue(t.property), t.leaf.GetValue(second)]; });
    t.child.SetInheritanceParent(other); assert.deepEqual(observed, [100, 200]); t.dispose(); other.Dispose();
});
test('property cache: local shadows isolate their descendants and ClearValue reconnects inheritance', () => {
    const t=tree();t.child.SetValue(t.property,17); assert.equal(t.leaf.GetValue(t.property),17);
    t.root.SetValue(t.property,44);assert.equal(t.leaf.GetValue(t.property),17);
    t.child.ClearValue(t.property);assert.equal(t.leaf.GetValue(t.property),44);t.dispose();
});
test('property cache: priority removal, animation base values and same-priority order remain correct', () => {
    const t=tree(),p=t.property; const s=t.leaf.SetValue(p,20,A.BindingPriority.Style),s2=t.leaf.SetValue(p,21,A.BindingPriority.Style);
    assert.equal(t.leaf.GetValue(p),21);const animation=t.leaf.SetValue(p,90,A.BindingPriority.Animation);
    assert.equal(t.leaf.GetValue(p),90);assert.equal(t.leaf.GetBaseValue(p),21);
    s2.Dispose();assert.equal(t.leaf.GetValue(p),90);assert.equal(t.leaf.GetBaseValue(p),20);
    animation.Dispose();assert.equal(t.leaf.GetValue(p),20);s.Dispose();assert.equal(t.leaf.GetValue(p),7);t.dispose();
});
test('property cache: changing the order on an existing slot invalidates its winning entry', () => {
    const t=tree(),a=Symbol(),b=Symbol();t.leaf._SetPriorityValue(t.property,1,3,a,10);t.leaf._SetPriorityValue(t.property,2,3,b,20);
    assert.equal(t.leaf.GetValue(t.property),2);t.leaf._SetPriorityValue(t.property,3,3,a,30);assert.equal(t.leaf.GetValue(t.property),3);t.dispose();
});
test('property cache: observable bindings replace cached values and dispose without stale roots', () => {
    const t=tree(),source=new BehaviorSubject(12),binding=t.root.Bind(t.property,source);
    assert.equal(t.leaf.GetValue(t.property),12);source.next(14);assert.equal(t.leaf.GetValue(t.property),14);
    binding.Dispose();assert.equal(t.leaf.GetValue(t.property),7);source.next(18);assert.equal(t.leaf.GetValue(t.property),7);t.dispose();
});
test('property cache: coerced values are never frozen, including through inherited nodes', () => {
    let multiplier=2;class Owner extends A.AvaloniaObject {}
    const p=A.AvaloniaProperty.Register(Owner,'Coerced',3,{Inherits:true,Coerce:(_,v)=>v*multiplier});
    const root=new Owner(),child=new Owner();child.SetInheritanceParent(root);
    assert.equal(child.GetValue(p),12);multiplier=3;assert.equal(child.GetValue(p),27);child.Dispose();root.Dispose();
});
test('property cache: direct getters continue to execute on every read', () => {
    class Owner extends A.AvaloniaObject {};let value=0;
    const p=A.AvaloniaProperty.RegisterDirect(Owner,'Direct',()=>++value);const o=new Owner();
    assert.equal(o.GetValue(p),1);assert.equal(o.GetValue(p),2);o.Dispose();
});
test('property cache: null, undefined, NaN and per-instance factories preserve value semantics', () => {
    class Owner extends A.AvaloniaObject {};let built=0;
    const p=A.AvaloniaProperty.Register(Owner,'Value',null),factory=A.AvaloniaProperty.Register(Owner,'Factory',null,{DefaultValueFactory:()=>({Id:++built})});
    const o=new Owner(),other=new Owner();for(const value of [undefined,null,NaN,0,false]) {o.SetValue(p,value);assert(Object.is(o.GetValue(p),value));assert(Object.is(o.GetValue(p),value));}
    assert.equal(o.GetValue(factory),o.GetValue(factory));assert.notEqual(o.GetValue(factory),other.GetValue(factory));assert.equal(built,2);o.Dispose();other.Dispose();
});
test('property cache: metadata override invalidates already cached derived defaults', () => {
    class Base extends A.AvaloniaObject {} class Derived extends Base {}
    const p=A.AvaloniaProperty.Register(Base,'Value',1);const o=new Derived();assert.equal(o.GetValue(p),1);
    p.OverrideDefaultValue(Base,2);assert.equal(o.GetValue(p),2);
    p.OverrideMetadata(Derived,{DefaultValue:4});assert.equal(o.GetValue(p),4);
    p.OverrideMetadata(Derived,{Coerce:(_,v)=>v+3});assert.equal(o.GetValue(p),7);o.Dispose();
});
test('property cache: AddOwner and newly registered inherited properties invalidate lookup inventories', () => {
    const t=tree();assert.equal(A.AvaloniaProperty.FindRegistered(t.Owner,'Later'),null);
    const later=A.AvaloniaProperty.Register(t.Owner,'Later',0,{Inherits:true});const other=new t.Owner();other.SetValue(later,15);
    t.child.SetInheritanceParent(other);assert.equal(t.leaf.GetValue(later),15);assert.equal(A.AvaloniaProperty.FindRegistered(t.Owner,'Later'),later);
    class Extra extends A.AvaloniaObject {} later.AddOwner(Extra,{DefaultValue:55});assert.equal(new Extra().GetValue(later),55);t.dispose();other.Dispose();
});
test('property cache: metadata can disable inheritance for a derived node and its descendants', () => {
    const t=tree();class Independent extends t.Owner {}t.property.OverrideMetadata(Independent,{Inherits:false,DefaultValue:33});
    const independent=new Independent(),child=new t.Owner();independent.SetInheritanceParent(t.root);child.SetInheritanceParent(independent);
    assert.equal(child.GetValue(t.property),33);let changes=0;child.PropertyChanged.Add(()=>changes++);
    t.root.SetValue(t.property,44);assert.equal(child.GetValue(t.property),33);assert.equal(changes,0);child.Dispose();independent.Dispose();t.dispose();
});
test('property cache: disposed objects release retained resolved entries and factories', () => {
    const t=tree();t.leaf.GetValue(t.property);t.leaf.Dispose();assert.equal(t.leaf._effectiveValues.size,0);assert.equal(t.leaf._effectiveEntries.size,0);t.dispose();
});

test('layout: a batch of leaf arrange invalidations reaches the root only once', () => {
    const host=new HeadlessTopLevel(new A.Size(500,300)),panel=new A.StackPanel(),leaf=new A.TextBlock('stable');panel.Children.Add(leaf);host.Content=panel;host.Layout();
    let requests=0;host._RequestLayout=()=>requests++;
    for(let i=0;i<100;i++)leaf.InvalidateArrange();assert.equal(requests,1);host.Layout();assert.equal(host.IsArrangeValid,true);host.Dispose();
});
test('layout: a batch of leaf measure invalidations reaches the root only once', () => {
    const host=new HeadlessTopLevel(new A.Size(500,300)),leaf=new A.TextBlock('stable');host.Content=leaf;host.Layout();let requests=0;host._RequestLayout=()=>requests++;
    for(let i=0;i<100;i++)leaf.InvalidateMeasure();assert.equal(requests,1);host.Layout();assert.equal(host.IsMeasureValid,true);host.Dispose();
});
test('layout: invalidation raised inside ArrangeOverride is not overwritten', () => {
    class Mutating extends A.Control {ArrangeOverride(s){if(!this.done){this.done=true;this.InvalidateArrange();}return s;}}
    const host=new HeadlessTopLevel(new A.Size(200,100));host.Content=new Mutating();const passes=host.LayoutManager.ExecuteLayoutPass();assert.equal(passes,2);assert.equal(host.IsArrangeValid,true);host.Dispose();
});
test('layout: identity-transform translations are cached but track bounds and nonidentity transforms', () => {
    const c=new A.Control();c.Bounds=new A.Rect(10,20,40,30);const a=c.GetLocalTransform();assert.equal(c.GetLocalTransform(),a);
    c.Bounds=new A.Rect(11,20,40,30);assert.notEqual(c.GetLocalTransform(),a);assert.equal(c.GetLocalTransform().Transform(new A.Point(0,0)).X,11);
    c.RenderTransform=A.Matrix.CreateScale(2);assert.equal(c.GetLocalTransform().Transform(new A.Point(0,0)).X,-9);c.Dispose();
});

function tableFixture(){
    const host=new HeadlessTopLevel(new A.Size(600,280)),table=new A.TableView();table.AutoGenerateColumns=false;
    table.Columns.Add(new A.TableViewColumn('Name','Name',300));table.Columns.Add(new A.TableViewColumn('Number','Id',160));
    const items=Array.from({length:1000},(_,i)=>new ReactiveObject({Name:`record-${i}`,Id:i}));table.ItemsSource=items;host.Content=table;host.Layout();
    return {host,table,items,dispose(){host.Dispose();for(const item of items)item.Dispose();}};
}
test('table: steady-state disjoint viewport jumps keep row/cell/text visual identities attached', () => {
    const f=tableFixture();f.table._SetOffset(500);f.host.Layout();const rows=new Set(f.table.GetRealizedContainers()),presenters=new Set([...rows].flatMap(r=>r.CellsPresenter.Children.map(c=>c.Presenter)));
    let detached=0;for(const row of rows)row.DetachedFromVisualTree.Add(()=>detached++);
    for(let i=20;i<50;i++){f.table._SetOffset(i*f.table.ItemHeight);f.host.Layout();for(const row of f.table.GetRealizedContainers()){assert(rows.has(row));for(const cell of row.CellsPresenter.Children)assert(presenters.has(cell.Presenter));}}
    assert.equal(detached,0);f.dispose();
});
test('table: recycled scalar bindings unsubscribe old rows and observe their new row', () => {
    const f=tableFixture();const old=f.table.ContainerFromIndex(0).CellsPresenter.Children.Get(0),presenter=old.Presenter;
    f.table._SetOffset(500*f.table.ItemHeight);f.host.Layout();const row=f.table.GetRealizedContainers().find(r=>r.CellsPresenter.Children.Contains(old));assert(row);
    assert.equal(old.Presenter,presenter);const expected=`record-${row.ItemIndex}`;assert.equal(old.Content,expected);f.items[0].Name='stale';assert.equal(old.Content,expected);
    f.items[row.ItemIndex].Name='current';assert.equal(old.Content,'current');f.dispose();
});
test('table: visible-column cache updates for visibility, replacement and order changes', () => {
    const f=tableFixture(),columns=f.table.VisibleColumns;assert.equal(f.table.VisibleColumns,columns);f.table.Columns.Get(0).IsVisible=false;
    assert.equal(f.table.VisibleColumns.length,1);f.table.Columns.Get(0).IsVisible=true;f.table.Columns.Move(0,1);assert.equal(f.table.VisibleColumns[0].Header,'Number');f.dispose();
});
test('table: custom data templates still rebuild and dispose obsolete instances', () => {
    const column=new A.TableViewColumn('Name','Name'),built=[];column.CellTemplate=new A.DataTemplate(item=>{const t=new A.TextBlock(item.Name);built.push(t);return t;});
    const cell=new A.TableViewCell();cell.Prepare(column,{Name:'one'});cell.Prepare(column,{Name:'two'});assert.equal(built.length,2);assert(built[0].IsDisposed);assert.equal(cell.Presenter.Text,'two');cell.Dispose();assert(built[1].IsDisposed);
});
test('render transform: caller mutation cannot poison a cached translation', () => {
    const c=new A.Control();c.Bounds=new A.Rect(12,24,10,10);const value=c.GetLocalTransform();value.M31=200;value.M11=3;
    const fresh=c.GetLocalTransform();assert.equal(fresh.M31,12);assert.equal(fresh.M11,1);c.Dispose();
});
test('button command: parameter and CanExecute notifications invalidate automation state', () => {
    const host=new HeadlessTopLevel(new A.Size(200,80)),button=new A.Button('Action');let queued=0;
    host._InvalidateAutomation=()=>queued++;host.Content=button;host.Layout();
    const command={CanExecute:p=>p==='enabled',CanExecuteChanged:new A.Event(),Execute(){}};
    button.Command=command;assert.equal(button.IsEffectivelyEnabled,false);queued=0;
    button.CommandParameter='enabled';assert.equal(button.IsEffectivelyEnabled,true);assert(queued>0);
    command.CanExecute=()=>false;queued=0;command.CanExecuteChanged.Raise(command,{});assert.equal(button.IsEffectivelyEnabled,false);assert(queued>0);
    host.Dispose();
});

test('editor: masking and read-only changes synchronize the existing native input without a text edit', () => {
    const host=new HeadlessTopLevel(new A.Size(240,100)), editor=new A.TextBox();
    editor.Text='unchanged';host.Content=editor;host.Layout();let syncs=0;
    host._SyncTextInput=control=>{assert.equal(control,editor);syncs++;};
    editor.PasswordChar='*';assert(syncs>0);assert.equal(editor.IsMeasureValid,false);
    host.Layout();syncs=0;editor.RevealPassword=true;assert(syncs>0);assert.equal(editor.IsMeasureValid,false);
    syncs=0;editor.IsReadOnly=true;assert(syncs>0);assert.equal(editor.Text,'unchanged');
    host.Dispose();
});
