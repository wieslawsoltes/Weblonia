import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as A from '@wieslawsoltes/avalonia';
import { HeadlessTopLevel } from '@wieslawsoltes/avalonia-headless';
import { Initialize } from '@wieslawsoltes/skiasharpweb';
import { BuildResourceView,ResourceRegistry,ResourceXaml } from './resource-fixture.js';
const S=await Initialize({fonts:false}),platform=await A.SkiaPlatform.Initialize({Api:S});
test.after(()=>platform.Dispose());
const white=[255,255,255,255],red=[255,0,0,255],blue=[0,0,255,255],green=[0,255,0,255],yellow=[255,255,0,255],magenta=[255,0,255,255];
for(const scale of [1,1.25,1.5,2,3])for(const aot of [false,true])test(`resource native ${aot?'AOT':'runtime'} ${scale}x: theme/reparent/shared mutation updates actual RGBA`,async()=>{
    const fixture=await BuildResourceView(A,aot),host=new HeadlessTopLevel(new A.Size(400,160));
    host.Content=fixture.View;host.Layout();const surface=S.SKSurface.Create(new S.SKImageInfo(400*scale,160*scale));
    const dc=new A.SkiaDrawingContext(platform,surface.Canvas,scale);surface.Canvas.Scale(scale,scale);
    function compare(expected){host.Layout();surface.Canvas.Clear(S.SKColors.White);fixture.View.RenderTree(dc);const image=surface.Snapshot();
        try{const pixels=image.ReadPixels(new S.SKImageInfo(400*scale,160*scale,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul));
            for(let i=0;i<4;i++){const offset=(Math.floor(32*scale)*400*scale+Math.floor((32+i*96)*scale))*4;
                for(let c=0;c<4;c++)assert.ok(Math.abs(pixels[offset+c]-expected[i][c])<=2,`${i}/${c}: ${pixels[offset+c]} != ${expected[i][c]}`);}
        }finally{image.Dispose();}
    }
    try{
        assert.equal(fixture.State().Created,2);assert.equal(fixture.State().Deferred,true);assert.equal(fixture.State().Distinct,true);
        compare([red,white,blue,blue]);fixture.Change('theme');compare([blue,white,blue,blue]);fixture.Change('move');compare([white,green,blue,blue]);
        fixture.Change('mutate');compare([white,yellow,magenta,blue]);fixture.Change('realize');assert.equal(fixture.State().Created,3);assert.equal(fixture.State().Deferred,false);
    }finally{dc.Dispose();surface.Dispose();host.Content=null;fixture.Dispose();host.Dispose();}
});
test('resource AOT fixture is reproducible emitted ESM and does not embed runtime evaluation',async()=>{
    const {Registry}=ResourceRegistry(A),text=new A.AvaloniaXamlCompiler({Registry}).Compile(ResourceXaml).JavaScript;
    assert.equal(text,await readFile(new URL('./resource-aot.js',import.meta.url),'utf8'));assert.match(text,/ctx\.ResourceChild/);assert.doesNotMatch(text,/eval\(|new Function/);
});
