import test from 'node:test';
import assert from 'node:assert/strict';
import { Initialize } from '@wieslawsoltes/skiasharpweb';
import { SkiaPlatform, SkiaDrawingContext } from '@wieslawsoltes/avalonia-skia';
import { Control, Border } from '@wieslawsoltes/avalonia-controls';
import { Rect, Size } from '@wieslawsoltes/avalonia-base';
import { Color, BitmapCache } from '@wieslawsoltes/avalonia-media';
import { ManualClock } from '@wieslawsoltes/avalonia-animation';
import { Compositor } from '@wieslawsoltes/avalonia-composition';
import { CompositionSceneRecorder, CompositionChangeAccumulator, ServerCompositionScene } from '@wieslawsoltes/avalonia-rendering';
const S=await Initialize();
function pixel(image,x,y,w=120){return [...image.ReadPixels(new S.SKImageInfo(w,80,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul)).slice((y*w+x)*4,(y*w+x)*4+4)];}
test('native invalidation: a visual cache never consumes invalidation raised while rendering its snapshot',()=>{
 const platform=new SkiaPlatform(S);
 class Painted extends Control{Render(c){this.Count=(this.Count??0)+1;c.DrawRectangle(this.Count===1?'#ff0000':'#0000ff',null,new Rect(0,0,120,80));if(this.Count===1)this.InvalidateVisual();}}
 const v=new Painted();v.Measure(new Size(120,80));v.Arrange(new Rect(0,0,120,80));
 try{const first=platform.GetVisualImage(v,1,false);assert.deepEqual(pixel(first.Image,20,20),[255,0,0,255]);const second=platform.GetVisualImage(v,1,false);assert.deepEqual(pixel(second.Image,20,20),[0,0,255,255]);assert.equal(v.Count,2);platform.GetVisualImage(v,1,false);assert.equal(v.Count,2);}finally{v.Dispose();platform.Dispose();}
});
test('native invalidation: cached worker visual retains the final composition animation frame',async()=>{
 const platform=new SkiaPlatform(S),root=new Border();root.Background='#ffffff';root.CacheMode=new BitmapCache();root.ClientSize=new Size(120,80);root.RenderScaling=1;root.Measure(root.ClientSize);root.Arrange(new Rect(root.ClientSize));
 const clock=new ManualClock(),compositor=root.Compositor=new Compositor({AutoCommit:false,Clock:clock});
 const tile=compositor.CreateSolidColorVisual(Color.Parse('#ff0000'));tile.Size={X:20,Y:20};root._compositionChild=tile;compositor.Commit();compositor.SetServerTransport({RequestCommitAsync:()=>Promise.resolve()});
 const recorder=new CompositionSceneRecorder(root,platform),acc=new CompositionChangeAccumulator(),scene=new ServerCompositionScene(platform),surface=S.SKSurface.Create(new S.SKImageInfo(120,80));
 const commit=async()=>{acc.Update(recorder.Capture());const b=acc.Prepare();if(b){await scene.Apply(b);acc.Acknowledge(b.Sequence,b.Generation);}};
 const read=(x)=>{surface.Canvas.Clear(S.SKColors.White);const c=new SkiaDrawingContext(platform,surface.Canvas);try{scene.Render(c);}finally{c.Dispose();}surface.Flush();const image=surface.Snapshot();try{return pixel(image,x,10);}finally{image.Dispose();}};
 try{
  await commit();assert.deepEqual(read(10),[255,0,0,255]);
  const animation=compositor.CreateScalarKeyFrameAnimation();animation.Duration=100;animation.InsertKeyFrame(0,0);animation.InsertKeyFrame(1,80);tile.StartAnimation('Offset.X',animation);compositor.Commit();await commit();
  const state=scene.CompositionObjects.get(tile.Id),start=[...state.Animations.values()][0].StartedAt;
  scene.Tick(start+50);assert.deepEqual(read(50),[255,0,0,255]);
  scene.Tick(start+110);assert.equal(scene.HasAnimations,false);assert.deepEqual(read(90),[255,0,0,255]);assert.deepEqual(read(10),[255,255,255,255]);
  const cached=platform.VisualImages.Get(`${root.VisualId}|1|false`);read(90);assert.equal(platform.VisualImages.Get(`${root.VisualId}|1|false`),cached,'terminal image must be reused while idle');
 }finally{scene.Dispose();recorder.Dispose();compositor.Dispose();root.Dispose();surface.Dispose();platform.Dispose();}
});
