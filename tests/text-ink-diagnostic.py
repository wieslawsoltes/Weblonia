"""Diagnostic only: compare direct, translated, and tiled Canvas2D glyph rasterization.
Does not change the renderer or loosen tests/text-quality.js's RGBA tolerance.
Uses an installed system font, with no font copying or distribution.
"""
import json, os, re
from pathlib import Path
from urllib.parse import unquote, urlparse
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
out=ROOT/'artifacts/startup';out.mkdir(parents=True,exist_ok=True)
imports=re.search(r'<script type="importmap">(.*?)</script>',(ROOT/'dist/index.html').read_text(),re.S).group(1)
with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
    executable=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium')
    if Path(executable).is_file():launch['executable_path']=executable
    with p.chromium.launch(**launch) as b:
        context=b.new_context()
        def asset(route):
            path=(ROOT/'dist'/unquote(urlparse(route.request.url).path).lstrip('/')).resolve()
            if not path.is_relative_to(ROOT/'dist') or not path.is_file():route.fulfill(status=404,body='Missing');return
            route.fulfill(body=path.read_bytes(),headers={'Access-Control-Allow-Origin':'*','Content-Type':'application/wasm' if path.suffix=='.wasm' else 'text/javascript'})
        context.route('http://localhost:4173/**',asset)
        page=context.new_page();page.set_content('<base href="http://localhost:4173/"><script type="importmap">'+imports+'</script>')
        report=page.evaluate('''async()=>{
            const A=await import('@wieslawsoltes/avalonia');
            const platform=await A.SkiaPlatform.Initialize({assetBaseUrl:new URL('../vendor/',import.meta.resolve('@wieslawsoltes/skiasharpweb/browser')).href,TextTileSize:128});
            const S=platform.Api,scale=1.5,w=750,h=188,x=14.37,y=-33600.4;
            const lines=Array.from({length:2000},()=> 'text line');lines[1002]='a'+'\\u0301'.repeat(18)+' e'+'\\u0308'.repeat(18);
            const layout=new A.TextLayout(lines.join('\\n'),new A.Typeface('serif'),24,A.Brushes.Black);
            const make=()=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
            const direct=make(),d=direct.getContext('2d',{willReadFrequently:true});
            d.fillStyle='white';d.fillRect(0,0,w,h);d.setTransform(scale,0,0,scale,.31,.63);A.ConfigureCanvasText(d,layout.Typeface,24,layout);d.fillStyle='black';
            for(const line of layout.TextLines)d.fillText(line.Text,x+line.X,y+line.Y+line.Baseline);
            const expected=d.getImageData(0,0,w,h).data;
            const difference=actual=>{let max=0,bad=0;const samples=[];for(let i=0;i<actual.length;i+=4){let delta=0;for(let k=0;k<4;k++)delta=Math.max(delta,Math.abs(actual[i+k]-expected[i+k]));max=Math.max(max,delta);if(delta>2){bad++;if(samples.length<40)samples.push({X:(i/4)%w,Y:Math.floor(i/4/w),Actual:[...actual.slice(i,i+4)],Expected:[...expected.slice(i,i+4)]});}}return{Maximum:max,PixelsAbove2:bad,Samples:samples};};
            const variants=[];
            for(const tileSize of [128,2048]){
                platform.Options.TextTileSize=tileSize;platform.TextImages.Clear();
                const surface=S.SKSurface.Create(new S.SKImageInfo(w,h));surface.Canvas.Clear(S.SKColors.White);surface.Canvas.Translate(.31,.63);surface.Canvas.Scale(scale,scale);
                const dc=new A.SkiaDrawingContext(platform,surface.Canvas,scale);dc.DrawTextLayout(layout,new A.Point(x,y));
                const image=surface.Snapshot();try{variants.push({Name:'native-'+tileSize,...difference(image.ReadPixels(new S.SKImageInfo(w,h,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul)))});}finally{image.Dispose();dc.Dispose();surface.Dispose();}
            }
            for(const mode of ['translated','line-alpha','tiled-alpha']){
                const canvas=make(),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,w,h);
                for(const line of layout.TextLines){
                    const bx=x+line.X,by=y+line.Y+line.Baseline;
                    if(mode==='translated'){ctx.setTransform(scale,0,0,scale,scale*bx+.31,scale*by+.63);A.ConfigureCanvasText(ctx,layout.Typeface,24,layout);ctx.fillStyle='black';ctx.fillText(line.Text,0,0);continue;}
                    const geometry=A.GetDeviceTextGeometry([scale,0,.31,0,scale,.63,0,0,1],bx,by,scale),metrics=platform.MeasureText(line.Text,layout.Typeface,24,layout);
                    const plan=A.CreateTextRasterPlan(metrics,24,geometry,mode==='tiled-alpha'?128:2048);
                    const ox=Math.floor(scale*bx+.31),oy=Math.floor(scale*by+.63);
                    for(const tile of plan.Tiles({Left:-ox,Top:-oy,Right:w-ox,Bottom:h-oy})){
                        const c=new OffscreenCanvas(tile.PixelWidth,tile.PixelHeight),r=c.getContext('2d',{willReadFrequently:true});A.ConfigureCanvasText(r,layout.Typeface,24,layout);r.fillStyle='black';r.setTransform(scale,0,0,scale,geometry.PhaseX-tile.Left,geometry.PhaseY-tile.Top);r.fillText(line.Text,0,0);
                        ctx.drawImage(c,ox+tile.Left,oy+tile.Top);
                    }
                }
                variants.push({Name:mode,...difference(ctx.getImageData(0,0,w,h).data)});
            }
            const info={Font: d.font,Variants:variants,Lines:layout.TextLines.slice(998,1007).map(l=>({Y:l.Y,Baseline:l.Baseline,Text:l.Text})),Metrics:platform.MeasureText(lines[1002],layout.Typeface,24,layout)};
            layout.Dispose();return info;
        }''')
        report['Browser']=b.version
(out/'text-ink-diagnostic.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
