/** Run unchanged with each checkout's register-loader.mjs. All numbers isolate
 * JavaScript work using fixed-width metrics, not native shaping or GPU frames. */
import * as A from '@wieslawsoltes/avalonia';
import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';
import { readFileSync,writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.resolve('@wieslawsoltes/avalonia')))).version;
let measurements=0,consumed=0;
const metrics=A.RegisterTextMetricsProvider({Measure(text,face,size){measurements++;return {Width:text.length*8,Ascent:size*.8,Descent:size*.2,FontAscent:size*.8,FontDescent:size*.2};}});
function record(name,action) {
    action();const samples=[];for(let i=0;i<3;i++)samples.push(action());
    const times=samples.map(s=>s.Milliseconds).sort((a,b)=>a-b);
    return {Name:name,MedianMilliseconds:times[1],Samples:samples};
}
const results=[];
results.push(record('5000 unchanged TextBox measure invalidations',()=>{
    const c=new A.TextBox('Retained measurement and layout ownership'),size=new A.Size(500,100);c.Measure(size);
    const before=A.GetTextLayoutStatistics().Created;measurements=0;const start=performance.now();
    for(let i=0;i<5000;i++){c.InvalidateMeasure();c.Measure(size);consumed+=c.DesiredSize.Width;}
    const r={Iterations:5000,Milliseconds:performance.now()-start,NewLayouts:A.GetTextLayoutStatistics().Created-before,Measurements:measurements};c.Dispose();return r;
}));
results.push(record('5000 paired FormattedText width/height reads',()=>{
    const c=new A.FormattedText('A stable formatted label');void c.Width;
    const before=A.GetTextLayoutStatistics().Created;measurements=0;const start=performance.now();
    for(let i=0;i<5000;i++)consumed+=c.Width+c.Height;
    const r={Iterations:5000,Milliseconds:performance.now()-start,NewLayouts:A.GetTextLayoutStatistics().Created-before,Measurements:measurements};c.Dispose?.();return r;
}));
results.push(record('20 caret placements in a 10000-line document',()=>{
    const l=new A.TextLayout('document text line\n'.repeat(10000));A.ClearTextBoundaryCache();
    const start=performance.now();for(let i=0;i<20;i++)consumed+=l.HitTestTextPosition(l.TextLines[9000+i].Start+7).X;
    const r={Iterations:20,Milliseconds:performance.now()-start,BoundaryCache:A.GetTextBoundaryCacheStatistics()};l.Dispose();return r;
}));
results.push(record('150 disjoint ListBox viewport jumps across 10000 items',()=>{
    let created=0;
    class CountingList extends A.ListBox{CreateContainerForItemOverride(...args){created++;return super.CreateContainerForItemOverride(...args);}}
    const c=new CountingList();c.ItemsSource=Array.from({length:10000},(_,i)=>'Row '+i);c.HorizontalScrollBarVisibility='Disabled';
    const root=new HeadlessTopLevel(new A.Size(400,240));root.Content=c;root.Layout();c._SetOffset(1000*c.ItemHeight);root.Layout();created=0;
    const start=performance.now();let maximumRealized=0;
    for(let i=0;i<150;i++){c._SetOffset((2000+(i*37)%7000)*c.ItemHeight);root.Layout();maximumRealized=Math.max(maximumRealized,c.GetRealizedContainers().length);}
    const r={Iterations:150,Milliseconds:performance.now()-start,NewContainers:created,MaximumRealized:maximumRealized};root.Dispose();return r;
}));
results.push(record('5000 unchanged visual ordering queries on 100 children',()=>{
    const p=new A.Panel();for(let i=0;i<100;i++){const c=new A.Border();c.ZIndex=i%7;p.Children.Add(c);}
    const identities=new Set();const start=performance.now();for(let i=0;i<5000;i++)identities.add(p.GetZOrderedChildren());
    const r={Iterations:5000,Milliseconds:performance.now()-start,DistinctReturnedArrays:identities.size};p.Dispose();return r;
}));
metrics.Dispose();
const report={Version:version,Scope:'Fixed-width counting text provider; deterministic JavaScript allocation/work counts, NOT end-to-end UI/GPU frame rates',Node:process.version,Architecture:process.arch,Cpu:os.cpus()[0]?.model,SamplesPerCase:3,Results:results,Consumed:consumed};
const text=JSON.stringify(report,null,2)+'\n';if(process.argv[2])writeFileSync(process.argv[2],text);else console.log(text);
