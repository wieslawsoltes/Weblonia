import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '@wieslawsoltes/avalonia';
import { Initialize } from '@wieslawsoltes/skiasharpweb';
const S=await Initialize({fonts:false});const platform=await A.SkiaPlatform.Initialize({Api:S});
test.after(()=>platform.Dispose());
async function build(source,aot){const c=new A.AvaloniaXamlCompiler().Compile(source);return aot?(await import('data:text/javascript;base64,'+Buffer.from(c.JavaScript).toString('base64'))).Build(new A.AvaloniaXamlServices()):c.Build();}
for(const aot of [false,true]){
 for(const type of ['RectangleGeometry','EllipseGeometry'])test(`${aot?'AOT':'runtime'} XAML ${type} has typed Rect bounds and renders inside Image`,async()=>{
  const view=await build(`<Image xmlns="https://github.com/avaloniaui" Width="64" Height="64" Stretch="Fill"><Image.Source><DrawingImage><DrawingGroup><GeometryDrawing Brush="Red"><${type} Rect="0,0,64,64"${type==='RectangleGeometry'?' RadiusX="8" RadiusY="8"':''}/></GeometryDrawing></DrawingGroup></DrawingImage></Image.Source></Image>`,aot);
  const source=view.Source,group=source.Drawing,drawing=group.Children.Get(0),geometry=drawing.Geometry,brush=drawing.Brush;
  const surface=S.SKSurface.Create(new S.SKImageInfo(64,64)),dc=new A.SkiaDrawingContext(platform,surface.Canvas);
  try{assert.ok(geometry.Rect instanceof A.Rect);assert.deepEqual(source.Size,new A.Size(64,64));
   if(type==='RectangleGeometry'){assert.equal(geometry.RadiusX,8);assert.equal(geometry.RadiusY,8);assert.match(geometry.Data,/A8 8/);}
   view.Measure(new A.Size(64,64));view.Arrange(new A.Rect(0,0,64,64));surface.Canvas.Clear(S.SKColors.White);view.Render(dc);
   const image=surface.Snapshot();try{const bytes=image.ReadPixels(new S.SKImageInfo(64,64,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul));assert.deepEqual([...bytes.slice((32*64+32)*4,(32*64+32)*4+4)],[255,0,0,255]);assert.deepEqual([...bytes.slice(0,4)],[255,255,255,255]);}finally{image.Dispose();}
  }finally{dc.Dispose();surface.Dispose();view.Dispose();source.Dispose();group.Dispose();drawing.Dispose();geometry.Dispose();brush.Dispose();}
 });
 test(`${aot?'AOT':'runtime'} XAML LineGeometry parses Point literals`,async()=>{
  const geometry=await build('<LineGeometry xmlns="https://github.com/avaloniaui" StartPoint="2,3" EndPoint="40,50"/>',aot);
  try{assert.deepEqual(geometry.StartPoint,new A.Point(2,3));assert.deepEqual(geometry.EndPoint,new A.Point(40,50));assert.deepEqual(geometry.Bounds,new A.Rect(2,3,38,47));assert.equal(geometry.Data,'M2 3L40 50');}finally{geometry.Dispose();}
 });
 test(`${aot?'AOT':'runtime'} XAML rejects malformed geometry value literals`,async()=>{
  for(const source of ['<RectangleGeometry Rect="1,2,3"/>','<EllipseGeometry Rect="0,0,NaN,10"/>','<LineGeometry StartPoint="1,2,3"/>'])await assert.rejects(build(source,aot),/Invalid numeric/);
 });
}
test('geometry literal conversion rejects before replacing an existing typed property value',()=>{
 const geometry=new A.RectangleGeometry(new A.Rect(1,2,3,4));
 try{const before=geometry.Rect;assert.throws(()=>{geometry.Rect='bad';},/Invalid numeric/);assert.equal(geometry.Rect,before);geometry.Rect='5,6,7,8';assert.deepEqual(geometry.Bounds,new A.Rect(5,6,7,8));}finally{geometry.Dispose();}
});
