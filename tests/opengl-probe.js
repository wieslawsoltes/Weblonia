/** Test-only bounded readback evidence; no native handle leaves its owning realm. */
export function DescribeOpenGl(control, root) {
    if (!control) return { Available: false };
    const pixels=control._bitmap?.Pixels, width=control._bitmap?.PixelSize.Width??0,height=control._bitmap?.PixelSize.Height??0;
    let hash=2166136261;
    if(pixels)for(const value of pixels)hash=Math.imul(hash^value,16777619)>>>0;
    const matrix=control.GetTransformToRoot(), samples=[];
    for(const [rx,ry] of [[.5,.5],[.5,.15],[.25,.7]]) {
        const x=Math.floor(width*rx),y=Math.floor(height*ry),i=(y*width+x)*4;
        const position=matrix.Transform({X:(x+.5)*control.Bounds.Width/width,Y:(y+.5)*control.Bounds.Height/height});
        samples.push({X:Math.floor(position.X*root.RenderScaling),Y:Math.floor(position.Y*root.RenderScaling),Rgba:pixels?[...pixels.slice(i,i+4)]:[]});
    }
    return {Available:true,Ready:control.IsInitializedSuccessfully,Error:control.InitializationError?.message??null,
        Frames:control.FrameCount,Width:width,Height:height,PixelHash:hash,Samples:samples,
        NativeHandleInUi:!!control._bitmap?._native,WorkerCanvas:typeof OffscreenCanvas==='function'&&control.Context?.Canvas instanceof OffscreenCanvas};
}
