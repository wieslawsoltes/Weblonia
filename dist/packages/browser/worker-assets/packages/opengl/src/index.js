import { Disposable, Event, Rect, Size } from "../../base/src/index.js";
import { Control } from "../../controls/src/index.js";
import { Bitmap } from "../../media/src/index.js";

/** Browser GL capability, not a native pointer. A lease never exposes a foreign Skia context. */
export class GlInterface {
    constructor(gl) {
        this.Context=gl;
        return new Proxy(this,{get:(target,name,receiver)=>{
            if(name in target)return Reflect.get(target,name,receiver);
            if(typeof name!=='string')return undefined;
            const native=name[0]?.toLowerCase()+name.slice(1);
            return typeof gl[native]==='function'?gl[native].bind(gl):gl[name];
        }});
    }
    GetProcAddress(name){const value=this.Context[name]??this.Context[name.replace(/^gl/,'').replace(/^./,c=>c.toLowerCase())];if(typeof value!=='function')throw new Error(`WebGL entry point '${name}' is unavailable.`);return value.bind(this.Context);}
    GetIntegerv(parameter){return this.Context.getParameter(parameter);}
    GetInteger(parameter){return this.Context.getParameter(parameter);}
    GetShaderParameter(shader,parameter){return this.Context.getShaderParameter(shader,parameter);}
    GetProgramParameter(program,parameter){return this.Context.getProgramParameter(program,parameter);}
    GenBuffer(){return this.Context.createBuffer();}
    GenBuffers(count){return Array.from({length:count},()=>this.Context.createBuffer());}
    GenFramebuffer(){return this.Context.createFramebuffer();}
    GenFramebuffers(count){return Array.from({length:count},()=>this.Context.createFramebuffer());}
    GenTexture(){return this.Context.createTexture();}
    GenTextures(count){return Array.from({length:count},()=>this.Context.createTexture());}
    BindFramebuffer(target,framebuffer){this.Context.bindFramebuffer(target,framebuffer||null);}
    BindBuffer(target,buffer){this.Context.bindBuffer(target,buffer||null);}
    BindTexture(target,texture){this.Context.bindTexture(target,texture||null);}
    BufferData(target,dataOrSize,usageOrData,maybeUsage){
        if(maybeUsage!==undefined)this.Context.bufferData(target,usageOrData??dataOrSize,maybeUsage);
        else this.Context.bufferData(target,dataOrSize,usageOrData);
    }
    ShaderSource(shader,source){this.Context.shaderSource(shader,Array.isArray(source)?source.join(''):String(source));}
    DeleteBuffers(buffers){for(const buffer of buffers)this.Context.deleteBuffer(buffer);}
    DeleteTextures(textures){for(const texture of textures)this.Context.deleteTexture(texture);}
    DeleteFramebuffers(framebuffers){for(const framebuffer of framebuffers)this.Context.deleteFramebuffer(framebuffer);}
}
export class GlVersion {
    constructor(major=3,minor=0,type='OpenGLES'){this.Major=major;this.Minor=minor;this.Type=type;}
    toString(){return `${this.Type} ${this.Major}.${this.Minor} (WebGL2)`;}
}

export class BrowserGlContext extends Disposable {
    constructor(canvas,options={}) {
        super();this.Canvas=canvas;this.Gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true,antialias:false,...options});
        if(!this.Gl)throw new Error('This browser has no available WebGL2 context.');
        this.GlInterface=new GlInterface(this.Gl);this.Version=new GlVersion();this._lease=null;this.Generation=0;
        this.Lost=new Event();this.Restored=new Event();
        this._onLost=event=>{event.preventDefault();this.Generation++;this.Lost.Raise(this,{});};
        this._onRestored=()=>{this.Generation++;this.Restored.Raise(this,{});};
        canvas.addEventListener('webglcontextlost',this._onLost);canvas.addEventListener('webglcontextrestored',this._onRestored);
    }
    get IsLost(){return this.IsDisposed||this.Gl.isContextLost();}
    EnsureCurrent(){return this.MakeCurrent();}
    MakeCurrent() {
        if(this.IsLost)throw new Error('The WebGL context is lost or disposed.');
        if(this._lease)throw new Error('This WebGL context already has an active lease.');
        const gl=this.Gl;
        // An isolated context permits explicit state restoration without guessing Skia's state.
        const state={framebuffer:gl.getParameter(gl.FRAMEBUFFER_BINDING),readFramebuffer:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),renderbuffer:gl.getParameter(gl.RENDERBUFFER_BINDING),
            viewport:gl.getParameter(gl.VIEWPORT),scissor:gl.getParameter(gl.SCISSOR_BOX),program:gl.getParameter(gl.CURRENT_PROGRAM),vao:gl.getParameter(gl.VERTEX_ARRAY_BINDING),array:gl.getParameter(gl.ARRAY_BUFFER_BINDING),
            clear:gl.getParameter(gl.COLOR_CLEAR_VALUE),active:gl.getParameter(gl.ACTIVE_TEXTURE),texture:gl.getParameter(gl.TEXTURE_BINDING_2D),pack:gl.getParameter(gl.PACK_ALIGNMENT),
            enabled:[gl.BLEND,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST].map(key=>[key,gl.isEnabled(key)]),colorMask:gl.getParameter(gl.COLOR_WRITEMASK),depthMask:gl.getParameter(gl.DEPTH_WRITEMASK)};
        const generation=this.Generation;
        const lease=Disposable.Create(()=>{
            if(this._lease!==lease)throw new Error('WebGL leases must be disposed by their owner.');this._lease=null;
            if(this.IsLost||generation!==this.Generation)return;
            gl.bindFramebuffer(gl.FRAMEBUFFER,state.framebuffer);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,state.readFramebuffer);gl.bindRenderbuffer(gl.RENDERBUFFER,state.renderbuffer);
            gl.viewport(...state.viewport);gl.scissor(...state.scissor);gl.useProgram(state.program);gl.bindVertexArray(state.vao);gl.bindBuffer(gl.ARRAY_BUFFER,state.array);
            gl.clearColor(...state.clear);gl.activeTexture(state.active);gl.bindTexture(gl.TEXTURE_2D,state.texture);gl.pixelStorei(gl.PACK_ALIGNMENT,state.pack);
            for(const [key,enabled]of state.enabled)enabled?gl.enable(key):gl.disable(key);gl.colorMask(...state.colorMask);gl.depthMask(state.depthMask);
        });
        this._lease=lease;lease.GlInterface=this.GlInterface;lease.Context=this;lease.Framebuffer=0;return lease;
    }
    CreateProgram(vertexSource,fragmentSource) {
        const gl=this.Gl,shaders=[];let program;
        try {
            for(const [type,source]of [[gl.VERTEX_SHADER,vertexSource],[gl.FRAGMENT_SHADER,fragmentSource]]) {
                const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
                if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(`WebGL shader compilation failed: ${gl.getShaderInfoLog(shader)}`);
            }
            program=gl.createProgram();for(const shader of shaders)gl.attachShader(program,shader);gl.linkProgram(program);
            if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(`WebGL program link failed: ${gl.getProgramInfoLog(program)}`);
            return program;
        } catch(error){if(program)gl.deleteProgram(program);throw error;}
        finally{for(const shader of shaders){if(program)gl.detachShader(program,shader);gl.deleteShader(shader);}}
    }
    Dispose(){if(this.IsDisposed)return;this._lease?.Dispose();this.Canvas.removeEventListener('webglcontextlost',this._onLost);this.Canvas.removeEventListener('webglcontextrestored',this._onRestored);this.Lost.Clear();this.Restored.Clear();this.Gl.getExtension('WEBGL_lose_context')?.loseContext();super.Dispose();}
}

/** Dedicated WebGL2 surface -> RGBA readback -> native Skia image. No zero-copy claim. */
export class OpenGlControlBase extends Control {
    constructor() {
        super();this.GlVersion=new GlVersion();this.Context=null;this.InitializationError=null;this.RenderError=new Event();this.MaxReadbackBytes=64*1024*1024;
        this._frameRequested=true;this._bitmap=new Bitmap(null);this._pixels=null;this._flipped=null;this._glInitialized=false;
        this._lifetime.Add(this.AttachedToVisualTree.Add(()=>this.RequestNextFrameRendering()));
        this._lifetime.Add(this.DetachedFromVisualTree.Add(()=>this._Cleanup()));
        this._lifetime.Add(this.SizeChanged.Add(()=>this.RequestNextFrameRendering()));
    }
    get IsInitializedSuccessfully(){return this._glInitialized&&!this.Context?.IsLost;}
    RequestNextFrameRendering(){this._frameRequested=true;this.InvalidateVisual();}
    _Initialize() {
        const root=this.GetVisualRoot();if(!root?._document)return false;
        const canvas=root._document.createElement('canvas');this.Context=new BrowserGlContext(canvas);
        this.Context.Lost.Add(()=>{this._glInitialized=false;this._bitmap._native?.Dispose();this._bitmap._native=null;this.OnOpenGlLost();});
        this.Context.Restored.Add(()=>{this._glInitialized=false;this.InitializationError=null;this.RequestNextFrameRendering();});
        return true;
    }
    Render(context) {
        super.Render(context);
        if(this.InitializationError||!this.Bounds.Width||!this.Bounds.Height)return;
        try {
            if(!this.Context&&!this._Initialize())return;if(this.Context.IsLost)return;
            const scale=this.GetVisualRoot()?.RenderScaling??1,width=Math.max(1,Math.round(this.Bounds.Width*scale)),height=Math.max(1,Math.round(this.Bounds.Height*scale));
            const count=width*height*4;if(count>this.MaxReadbackBytes)throw new RangeError('WebGL readback exceeds the control buffer budget.');
            const canvas=this.Context.Canvas;
            if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;this._pixels=new Uint8Array(count);this._flipped=new Uint8Array(count);this._frameRequested=true;}
            if(!this._pixels||this._pixels.length!==count){this._pixels=new Uint8Array(count);this._flipped=new Uint8Array(count);}
            if(this._frameRequested) {
                this._frameRequested=false;const lease=this.Context.MakeCurrent(),gl=this.Context.Gl;
                try {
                    if(!this._glInitialized){this.OnOpenGlInit(this.Context.GlInterface);this._glInitialized=true;}
                    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);
                    this.OnOpenGlRender(this.Context.GlInterface,0);
                    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.pixelStorei(gl.PACK_ALIGNMENT,1);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,this._pixels);
                    const stride=width*4;for(let y=0;y<height;y++)this._flipped.set(this._pixels.subarray(y*stride,(y+1)*stride),(height-y-1)*stride);
                    const S=context.Api;
                    if(!S)throw new Error('OpenGL interop requires SkiaDrawingContext.');
                    const image=S.SKImage.FromPixels(new S.SKImageInfo(width,height,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul),this._flipped);
                    this._bitmap._native?.Dispose();this._bitmap._native=image;this._bitmap.PixelSize=new Size(width,height);
                } finally{lease.Dispose();}
            }
            if(this._bitmap._native)context.DrawImage(this._bitmap,new Rect(0,0,this._bitmap.PixelSize.Width,this._bitmap.PixelSize.Height),new Rect(this.Bounds.Size));
        } catch(error){this.InitializationError=error;this.RenderError.Raise(this,{Error:error});this.GetVisualRoot()?.RenderError.Raise(this,{Error:error});}
    }
    OnOpenGlInit(){} OnOpenGlDeinit(){} OnOpenGlLost(){}
    OnOpenGlRender(){throw new Error('Override OnOpenGlRender(gl, framebuffer).');}
    _Cleanup(){if(this.Context){if(this._glInitialized&&!this.Context.IsLost){const lease=this.Context.MakeCurrent();try{this.OnOpenGlDeinit(this.Context.GlInterface);}finally{lease.Dispose();}}this.Context.Dispose();this.Context=null;}this._glInitialized=false;this._bitmap._native?.Dispose();this._bitmap._native=null;this._pixels=null;this._flipped=null;this.InitializationError=null;}
    Dispose(){if(this.IsDisposed)return;this._Cleanup();this._bitmap.Dispose();this.RenderError.Clear();super.Dispose();}
}
