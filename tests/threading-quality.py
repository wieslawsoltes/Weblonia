"""Main/worker rendering conformance at fractional and high DPI. An installed
system font is served to the test realms in memory only, never copied or packaged.
"""
from pathlib import Path
import json,time,base64,io
from PIL import Image,ImageChops
from playwright.sync_api import sync_playwright
from threading_support import browser_executable,ROOT,install_assets,load,invoke,png
from verification_support import source_fingerprint
out=ROOT/'artifacts/threading';out.mkdir(exist_ok=True)
report={'Version':json.loads((ROOT/'package.json').read_text())['version'],'SourceFingerprint':source_fingerprint(ROOT),'Completed':False,'Tests':[],'Errors':[],'MissingAssets':[],'FontBytesBundled':False,'PixelChannelTolerance':2,'Qualification':'Actual native Skia raster in Chromium; compare identical 0.6 source in three topologies. System font used by test only; no font redistribution or physical GPU qualification.'}
font=next((p for p in [Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),Path('/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf')]if p.is_file()),None)
if font is None:raise SystemExit('Native font qualification requires an installed DejaVu Sans or Liberation Sans font.')
def save():(out/'quality-results.json').write_text(json.dumps(report,indent=2))
def check(name,action):
 try:value=action();report['Tests'].append({'Name':name,'Passed':True,'Evidence':value});print('PASS',name,flush=True)
 except Exception as e:report['Tests'].append({'Name':name,'Passed':False,'Error':str(e)});print('FAIL',name,str(e)[:1800],flush=True)
 save()
def demand(x,m):
 if not x:raise AssertionError(m)
def snapshot(page,mode):
 if mode=='full-isolation':return png(page)
 data=page.evaluate('''async()=>{const bytes=await catalog.Root.CapturePngAsync();let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);}''')
 return Image.open(io.BytesIO(base64.b64decode(data))).convert('RGBA')
def navigate(page,mode,route):
 if mode=='full-isolation':invoke(page,'Navigate',route)
 else:page.evaluate('async id=>{await catalog.Navigate(id);await catalog.Root.RenderNow();}',route)
with sync_playwright()as p:
 b=p.chromium.launch(executable_path=browser_executable(),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 for scale in [1.25,2]:
  ctx=b.new_context(viewport={'width':1100,'height':800},device_scale_factor=scale);install_assets(ctx,report['MissingAssets'],font)
  pages={m:load(ctx,m,report['Errors'])for m in ['single','render-worker','full-isolation']}
  for case in ['browser-fonts','scrolled-editor','native-fonts']:
   for mode,page in pages.items():
    navigate(page,mode,'TextBox'if case=='scrolled-editor'else'TextBlock')
    if case=='scrolled-editor':
     if mode=='full-isolation':invoke(page,'Scroll',{'Name':'LongDocumentEditor','X':180.25,'Y':7200.5})
     else:page.evaluate('async()=>{catalog.Root.FindControl("LongDocumentEditor")._SetTextScroll(new catalogApi.Point(180.25,7200.5));await catalog.Root.RenderNow();}')
    elif case=='native-fonts':
     if mode=='full-isolation':invoke(page,'RegisterTestFont','http://localhost:4173/__thread_test_font__');invoke(page,'SetNativeTextFace')
     else:page.evaluate('''async()=>{const bytes=new Uint8Array(await(await fetch('http://localhost:4173/__thread_test_font__')).arrayBuffer());catalog.Root.Platform.RegisterTypeface('ThreadConformance',bytes);for(const c of catalog.Root.FindControl('PageHost').GetVisualDescendants().filter(c=>c instanceof catalogApi.TextBlock))c.FontFamily='ThreadConformance';await catalog.Root.RenderNow();}''')
   reference=snapshot(pages['single'],'single').crop((0,0,round(1100*scale),round(765*scale)))
   for mode in ['render-worker','full-isolation']:
    def compare(mode=mode):
     actual=snapshot(pages[mode],mode).crop((0,0,*reference.size))
     demand(actual.size==reference.size,'surface sizes differ')
     diff=ImageChops.difference(reference,actual);maximum=max(v[1]for v in diff.getextrema());bad=sum(1 for px in diff.getdata()if max(px)>2)
     if maximum>2:diff.save(out/f'{mode}-{case}-{scale}-difference.png');reference.save(out/f'{case}-{scale}-reference.png');actual.save(out/f'{mode}-{case}-{scale}.png')
     demand(maximum<=2,f'RGBA mismatch max={maximum}, pixelsAbove2={bad}')
     return{'Scale':scale,'Case':case,'Mode':mode,'Channels':4,'MaximumChannelError':maximum,'PixelsAboveTolerance':bad,'ComparedPixels':reference.width*reference.height}
    check(f'{mode} {case} {scale}x RGBA',compare)
  for page in pages.values():page.close()
  ctx.close()
 b.close()
report['Completed']=True;report['Passed']=sum(t['Passed']for t in report['Tests']);report['Failed']=len(report['Tests'])-report['Passed'];report['FinalSourceFingerprint']=source_fingerprint(ROOT);save();print(json.dumps({k:report[k]for k in ['Passed','Failed','Errors','MissingAssets']},indent=2));raise SystemExit(1 if report['Failed']or report['Errors']or report['MissingAssets']else 0)
