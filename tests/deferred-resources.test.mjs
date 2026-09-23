import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { take } from 'rxjs/operators';
const dict = (t, entries) => { const d = new A.ResourceDictionary(entries); t.after(() => d.Dispose()); return d; };

test('resources: shared factories stay lazy until lookup, then preserve one instance without a change signal', t => {
    const d = dict(t); let builds = 0, changes = 0;
    d.ResourcesChanged.Add(() => changes++); d.AddDeferred('key', provider => { assert.equal(provider, null); builds++; return { Value: 7 }; });
    assert.equal(d.Count, 1); assert.equal(d.HasResources, true); assert.equal(d.ContainsKey('key'), true);
    assert.equal(d.ContainsDeferredKey('key'), true); assert.equal(builds, 0);
    const a = d.GetResource('key'); assert.equal(d.TryGetValue('key').Value, a); assert.equal(d.get('key'), a);
    assert.equal(d.ContainsDeferredKey('key'), false); assert.equal(builds, 1); assert.equal(changes, 1);
});
for (const value of [null, undefined, false, 0, '']) test(`resources: shared ${String(value)} is a present cached result`, t => {
    const d = dict(t); let builds=0; d.AddDeferred('k',()=>{builds++;return value;});
    for(let i=0;i<4;i++){const found=d.TryGetResource('k');assert.equal(found.Found,true);assert.equal(found.Value,value);}
    assert.equal(builds,1);
});
test('resources: unshared Build providers construct independently and ordinary Build-valued resources remain values', t => {
    const d=dict(t); let builds=0; const factory={Build(provider){assert.equal(provider,null);return {Id:++builds};}};
    d.AddNotSharedDeferred('k',factory); d.Add('template',factory);
    assert.notEqual(d.get('k'),d.get('k'));assert.equal(builds,2);assert.equal(d.get('template'),factory);assert.equal(builds,2);
    assert.equal(d.ContainsDeferredKey('k'),true);
});
test('resources: inspection and discarded entries never invoke deferred factories', t => {
    const d=dict(t);const fail=()=>{throw new Error('must not realize');};
    for(const key of ['replace','delete','clear'])d.AddDeferred(key,fail);
    assert.equal([...d].length,3);assert.equal(d.Keys.length,3);assert.equal(d.Values.length,3);
    assert.equal([...d.values()].length,3);let count=0;d.forEach(()=>count++);assert.equal(count,3);
    assert.throws(()=>d.AddDeferred('replace',fail),/Duplicate/);
    d.set('replace',1);d.delete('delete');d.Clear();assert.equal(d.HasResources,false);
});
test('resources: a failed factory remains retryable with all recursion guards released', t => {
    const d=dict(t);let count=0;d.AddDeferred('k',()=>{if(++count===1)throw new Error('first');return 42;});
    assert.throws(()=>d.get('k'),/first/);assert.equal(d.ContainsDeferredKey('k'),true);assert.equal(d.get('k'),42);assert.equal(count,2);assert.equal(d._building.size,0);
});
test('resources: asynchronous factories reject explicitly and observe promise failures', async t => {
    const d=dict(t);d.AddDeferred('k',()=>Promise.reject(new Error('async')));
    assert.throws(()=>d.get('k'),/synchronously/);await new Promise(r=>setImmediate(r));assert.equal(d._building.size,0);
});
for(const operation of ['replace','remove','dispose'])test(`resources: reentrant ${operation} is never overwritten by stale factory result`,t=>{
    const d=dict(t);const result={};d.AddDeferred('k',()=>{if(operation==='replace')d.set('k','new');else if(operation==='remove')d.Remove('k');else d.Dispose();return result;});
    assert.equal(d.get('k'),result);if(operation==='replace')assert.equal(d.get('k'),'new');else assert.equal(d.ContainsKey('k'),false);
});
test('resources: recursive same-key override resolves the lower merged definition',t=>{
    const outer=dict(t,[['k',2]]),inner=dict(t);inner.MergedDictionaries.Add(outer);
    inner.AddDeferred('k',()=>inner.GetResource('k')+3);assert.equal(inner.GetResource('k'),5);
});
test('resources: multi-key recursive failures are finite and do not poison later resolution',t=>{
    const d=dict(t);d.AddDeferred('a',()=>d.GetResource('b'));d.AddDeferred('b',()=>d.GetResource('a'));
    assert.throws(()=>d.GetResource('a'),/not found/);assert.equal(d._building.size,0);d.set('b',17);assert.equal(d.get('a'),17);
});
test('resources: a deep distinct-key factory chain fails at a bounded depth without stack overflow',t=>{
    const d=dict(t);for(let i=0;i<200;i++)d.AddDeferred(i,()=>d.GetResource(i+1));d.Add(200,1);
    assert.throws(()=>d.GetResource(0),/nesting limit/);assert.equal(d._building.size,0);assert.equal(d.GetResource(190),1);
});
test('resources: bulk replacement validates completely before mutation and emits one change',t=>{
    const d=dict(t,[['k',1]]);let count=0;d.ResourcesChanged.Add(()=>count++);
    assert.throws(()=>d.SetItems([['k',2],['bad']]),/entries/);assert.equal(d.get('k'),1);assert.equal(count,0);
    d.SetItems([['k',2],['b',3],['k',4]]);assert.equal(d.get('k'),4);assert.equal(count,1);d.SetItems([]);assert.equal(count,1);
    d.EnsureCapacity(100);assert.throws(()=>d.EnsureCapacity(-1),RangeError);assert.throws(()=>d.EnsureCapacity(Infinity),RangeError);
});
test('resources: theme keys use ThemeVariant equality and inheritance preserves the original request in nested dictionaries',t=>{
    const d=dict(t),light=dict(t),nested=dict(t,[['k','derived']]),fallback=dict(t,[['k','fallback']]);
    const derived=new A.ThemeVariant('Custom',A.ThemeVariant.Light);
    light.ThemeDictionaries.set(derived,nested);d.ThemeDictionaries.set(new A.ThemeVariant('Light'),light);d.ThemeDictionaries.set(A.ThemeVariant.Default,fallback);
    assert.equal(d.ThemeDictionaries.get('Light'),light);assert.equal(d.GetResource('k',derived),'derived');assert.equal(d.GetResource('k',A.ThemeVariant.Dark),'fallback');
    assert.equal(d.ThemeDictionaries.Remove(new A.ThemeVariant('Light')),true);assert.equal(d.GetResource('k',derived),'fallback');
});
test('resources: local then theme then reverse merged precedence includes null resources',t=>{
    const d=dict(t),a=dict(t,[['k','a']]),b=dict(t,[['k','b']]),dark=dict(t,[['k','dark']]);
    d.MergedDictionaries.AddRange([a,b]);assert.equal(d.GetResource('k'),'b');d.ThemeDictionaries.set('Dark',dark);
    assert.equal(d.GetResource('k',A.ThemeVariant.Dark),'dark');d.set('k',null);assert.equal(d.GetResource('k',A.ThemeVariant.Dark),null);
    d.delete('k');d.MergedDictionaries.Move(0,1);assert.equal(d.GetResource('k'),'a');
});
test('resources: dictionary cycles are rejected before merged or theme mutation',t=>{
    const a=dict(t),b=dict(t),c=dict(t);a.MergedDictionaries.Add(b);b.ThemeDictionaries.Add('Dark',c);
    assert.throws(()=>c.MergedDictionaries.Add(a),/cycle/);assert.equal(c.MergedDictionaries.Count,0);
    assert.throws(()=>c.ThemeDictionaries.Add('Light',a),/cycle/);assert.equal(c.ThemeDictionaries.Count,0);
    assert.throws(()=>a.MergedDictionaries.Add({}),/provider/);assert.equal(a.MergedDictionaries.Count,1);
});
test('resources: shared dictionary DAGs deduplicate propagation and preserve incremental subscriptions',t=>{
    const root=dict(t),left=dict(t),right=dict(t),leaf=dict(t);left.MergedDictionaries.Add(leaf);right.MergedDictionaries.Add(leaf);root.MergedDictionaries.AddRange([left,right]);
    const listeners=leaf.ResourcesChanged.Count;let changes=0;root.ResourcesChanged.Add(()=>changes++);leaf.set('k',1);assert.equal(changes,1);assert.equal(listeners,2);
    root.ThemeDictionaries.set('Dark',left);assert.equal(left.ResourcesChanged.Count,1);root.MergedDictionaries.Remove(left);assert.equal(left.ResourcesChanged.Count,1);
    root.ThemeDictionaries.Remove('Dark');assert.equal(left.ResourcesChanged.Count,0);root.Dispose();assert.equal(right.ResourcesChanged.Count,0);
});
test('resources: disposing drops deferred closures, subscriptions and entries but never borrowed values',t=>{
    const root=dict(t),child=dict(t);let disposed=0,builds=0;root.Add('object',{Dispose(){disposed++;}});root.AddDeferred('lazy',()=>builds++);root.MergedDictionaries.Add(child);
    root.Dispose();assert.equal(root.Count,0);assert.equal(root._children.size,0);assert.equal(child.IsDisposed,false);assert.equal(disposed,0);assert.equal(builds,0);
    assert.throws(()=>root.Add('k',1),/disposed/);assert.throws(()=>child.MergedDictionaries.Add(root),/disposed/);
});
test('resources: deep detached subtree reparenting changes lookup and releases subscriptions to obsolete ancestors',t=>{
    const a=new A.Border(),b=new A.Border(),subtree=new A.Border(),target=new A.TextBlock();t.after(()=>{a.Dispose();b.Dispose();});
    a.Resources.Add('k','a');b.Resources.Add('k','b');subtree.Child=target;a.Child=subtree;
    const values=[];const subscription=A.GetResourceObservable(target,'k').subscribe(v=>values.push(v));
    const before=a.Resources.ResourcesChanged.Count;a.Child=null;b.Child=subtree;assert.equal(values.at(-1),'b');
    assert.ok(a.Resources.ResourcesChanged.Count<before);const count=values.length;a.Resources.set('k','old');assert.equal(values.length,count);
    b.Resources.set('k','new');assert.equal(values.at(-1),'new');subscription.unsubscribe();const listeners=b.Resources.ResourcesChanged.Count;b.Resources.set('k','ignored');assert.equal(values.at(-1),'new');assert.equal(listeners,1);
});
test('resources: synchronous take-one unsubscribes all observers created during initial emission',t=>{
    const control=new A.Border();t.after(()=>control.Dispose());control.Resources.AddDeferred('k',()=>123);
    const counts=[control.PropertyChanged.Count,control.ResourcesChanged.Count,control.Resources.ResourcesChanged.Count];let value;
    A.GetResourceObservable(control,'k').pipe(take(1)).subscribe(v=>value=v);assert.equal(value,123);
    assert.deepEqual([control.PropertyChanged.Count,control.ResourcesChanged.Count,control.Resources.ResourcesChanged.Count],counts);
});
test('resources: live themes and irrelevant resource notifications deduplicate identical shared values',t=>{
    const c=new A.Border();t.after(()=>c.Dispose());const light=dict(t,[['k','light']]),dark=dict(t,[['k','dark']]);
    c.Resources.ThemeDictionaries.Add('Light',light);c.Resources.ThemeDictionaries.Add('Dark',dark);c.RequestedThemeVariant=A.ThemeVariant.Light;
    const values=[];const s=A.GetResourceObservable(c,'k').subscribe(v=>values.push(v));t.after(()=>s.unsubscribe());
    c.Resources.set('other',1);assert.deepEqual(values,['light']);c.RequestedThemeVariant=A.ThemeVariant.Dark;assert.deepEqual(values,['light','dark']);
});
test('resources: self-mutating unshared observer fails at its bounded reentrancy guard and releases handlers',t=>{
 const c=new A.Border();t.after(()=>c.Dispose());let buildCount=0,error;
 c.Resources.AddNotSharedDeferred('k',()=>{c.Resources.set('other',++buildCount);return {};});
 const before=c.Resources.ResourcesChanged.Count;
 A.GetResourceObservable(c,'k').subscribe({next(){},error:e=>error=e});
 assert.match(error?.message??'',/reentrancy limit/);assert.equal(buildCount,128);assert.equal(c.Resources.ResourcesChanged.Count,before);
});
test('resources: thousand scope moves maintain bounded observer ownership',t=>{
 const a=new A.Border(),b=new A.Border(),child=new A.TextBlock();t.after(()=>{a.Dispose();b.Dispose();child.Dispose();});
 a.Resources.Add('k',1);b.Resources.Add('k',2);a.Child=child;let value;
 const subscription=A.GetResourceObservable(child,'k').subscribe(v=>value=v);t.after(()=>subscription.unsubscribe());
 for(let i=0;i<1000;i++){a.Child=null;b.Child=child;assert.equal(value,2);b.Child=null;a.Child=child;assert.equal(value,1);}
 assert.equal(a.Resources.ResourcesChanged.Count,2);assert.equal(b.Resources.ResourcesChanged.Count,1);assert.equal(child.AttachedToLogicalTree.Count,1);
});
